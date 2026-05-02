/**
 * Notion → GFM markdown normalisation.
 *
 * Notion's "Export → Markdown & CSV" produces markdown that is _close_ to
 * GFM but diverges in three load-bearing places:
 *
 *  1. **Callouts** — emitted as a blockquote whose first line is an emoji
 *     followed by the content. We collapse them to standard GFM blockquotes
 *     keeping the emoji as plain text on the first line so the visual cue
 *     survives.
 *  2. **Toggle blocks** — emitted as a heading line whose marker is a
 *     downward triangle (`▾` or `▸`) followed by the toggle title. The body
 *     is the indented block beneath. We rewrite the whole construct to
 *     `<details><summary>title</summary>body</details>` which renders in
 *     every GFM viewer (and in our own preview).
 *  3. **Filename hashes** — every Notion page filename and any internal
 *     link target ends with a 32-char hex hash separated by a space. We
 *     strip the hash from filenames AND from any `[label](path)` links so
 *     the imported tree is human-readable.
 *
 * Image / file references are also rewritten here: Notion exports each
 * page's assets into a sibling folder named `<page> <hash>/`. We map those
 * relative refs to `attachments/<sanitised-title>/<filename>` so the host's
 * default attachment layout works without further plumbing.
 *
 * All other markdown is preserved verbatim — including code fences with
 * language hints, tables, ordered/unordered lists, and inline emphasis.
 */

/** A 32-char hex string preceded by a single space — the Notion id suffix. */
const NOTION_HEX_RE = /\s([0-9a-f]{32})/i;
const NOTION_HEX_GLOBAL_RE = /\s([0-9a-f]{32})(?=\b|[/.\s)\]])/gi;

/**
 * Strip the trailing ` <hash>` from a single path segment. Returns the
 * input unchanged if no hash is present. The hash is preserved in the
 * second return value so the caller can stash it in frontmatter.
 */
export function stripNotionHash(segment: string): { name: string; hash?: string } {
  // Notion uses spaces in filenames, so we have to match the LAST hex run
  // before the file extension (or end of segment).
  const ext = segment.lastIndexOf('.');
  const stem = ext === -1 ? segment : segment.slice(0, ext);
  const tail = ext === -1 ? '' : segment.slice(ext);

  const m = stem.match(/^(.*?)(?:\s([0-9a-f]{32}))$/i);
  if (!m) return { name: segment };
  return { name: (m[1] + tail).trim(), hash: m[2].toLowerCase() };
}

/**
 * Strip Notion hashes from every segment of a POSIX-relative path. Used
 * for both filename normalisation and link-target rewriting.
 */
export function stripNotionHashFromPath(p: string): string {
  return p
    .split('/')
    .map(seg => stripNotionHash(seg).name)
    .join('/');
}

/**
 * Slugify a title into something safe for the host's flat
 * `Imported/notion/<title>.md` layout. We keep this conservative so it
 * matches what `sanitiseFilename` in main.ts would do — replacing the
 * filesystem-hostile characters and trimming length. Spaces are kept so
 * titles read naturally on disk.
 */
export function notionSlug(title: string): string {
  return (title || 'untitled')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

export interface NormaliseOptions {
  /** Sanitised title of the source page — used to compute attachment paths. */
  pageSlug: string;
  /**
   * Map of `<original-relative-path>` → `<sanitised-page-slug>` for every
   * markdown page in the import set. Lookups are case-insensitive on the
   * stripped form. Used to rewrite cross-page links so they point at the
   * flat-on-disk filenames the host writes.
   */
  pageIndex: Map<string, string>;
  /**
   * URL-decoded relative folder of the SOURCE page within the export tree.
   * Needed so that a relative ref like `image.png` in `Sub/Page <h>.md`
   * can be resolved against `Sub/` first.
   */
  sourceDir: string;
  /** Per-importer logger. */
  log: (msg: string) => void;
}

/**
 * Apply every Notion-specific transformation to a markdown body in one
 * pass. The result is plain GFM that the host can write to disk and the
 * preview renderer can display without further massage.
 */
export function normaliseNotionMarkdown(body: string, opts: NormaliseOptions): string {
  let out = body;

  // 1. Callouts → blockquotes. Notion emits callouts as a blockquote whose
  //    first line is `> <emoji> <text>`. We don't actually have to change
  //    the markdown — it's already a valid blockquote. But Notion sometimes
  //    wraps callouts in `<aside>` HTML; collapse that.
  out = out.replace(/<aside>([\s\S]*?)<\/aside>/g, (_match, inner) => {
    const lines = String(inner).trim().split(/\r?\n/);
    return lines.map(l => `> ${l}`.trimEnd()).join('\n');
  });

  // 2. Toggle blocks. Notion exports these as a level-N heading whose
  //    text starts with `▾ ` or `▸ `, followed by an indented body. We
  //    convert the heading + indented block into <details><summary>.
  out = collapseToggles(out);

  // 3. Strip the 32-char hash from every link target. Both `[label](path)`
  //    and `![alt](path)` are handled in one pass.
  out = out.replace(/(!?\[[^\]\n]*\])\(([^)\n]+)\)/g, (_match, label, target) => {
    const rewritten = rewriteTarget(String(target), opts);
    return `${label}(${rewritten})`;
  });

  // 4. Empty-paragraph collapse: Notion sprinkles 3+ blank lines around
  //    blocks. Squash to a single blank line for cleaner storage.
  out = out.replace(/\n{3,}/g, '\n\n');

  return out;
}

/**
 * Walk the body line-by-line, replacing toggle headings + their indented
 * bodies with `<details><summary>…</summary>…</details>`. The export uses
 * 4-space indentation for toggle children.
 */
function collapseToggles(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^(#{1,6})\s+[▾▸▼►]\s*(.+?)\s*$/);
    if (!m) {
      out.push(line);
      i += 1;
      continue;
    }
    const summary = m[2].trim();
    const childLines: string[] = [];
    i += 1;
    // Eat blank lines immediately after the toggle heading.
    while (i < lines.length && lines[i].trim() === '') i += 1;
    // Greedy collect: any non-empty indented line, plus blank lines that
    // are followed by more indented lines.
    while (i < lines.length) {
      const c = lines[i];
      if (c.trim() === '') {
        // Look ahead — keep the blank line if the next non-blank is still
        // indented; otherwise we've left the toggle body.
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j += 1;
        if (j < lines.length && /^(    |\t)/.test(lines[j])) {
          childLines.push('');
          i = j;
          continue;
        }
        break;
      }
      if (!/^(    |\t)/.test(c)) break;
      // Strip one level of indent (4 spaces or one tab).
      childLines.push(c.replace(/^(    |\t)/, ''));
      i += 1;
    }
    out.push('<details>');
    out.push(`<summary>${summary}</summary>`);
    out.push('');
    if (childLines.length) out.push(...childLines);
    out.push('');
    out.push('</details>');
  }
  return out.join('\n');
}

/**
 * Rewrite a single link target.
 *
 * - `http(s)://...` and `mailto:`, `tel:` → unchanged.
 * - `<Page Title> <hash>.md` (or any `.md` link) → matched against the
 *   page index by the hash-stripped relative path. If found, rewritten to
 *   the sanitised page slug + `.md` (the on-disk flat filename).
 * - Asset references (e.g. `<page> <hash>/image.png`) → rewritten to
 *   `attachments/<page-slug>/<filename>`.
 * - Anything else → hash-stripped only.
 */
function rewriteTarget(target: string, opts: NormaliseOptions): string {
  const trimmed = target.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed; // protocol
  if (trimmed.startsWith('#')) return trimmed; // anchor

  // Notion percent-encodes spaces in hrefs even though filenames don't.
  let decoded: string;
  try {
    decoded = decodeURI(trimmed);
  } catch {
    decoded = trimmed;
  }

  // Split off optional `#anchor`.
  let anchor = '';
  const hashIdx = decoded.indexOf('#');
  if (hashIdx !== -1) {
    anchor = decoded.slice(hashIdx);
    decoded = decoded.slice(0, hashIdx);
  }

  // Resolve relative-to-source-dir → POSIX path inside the export root.
  const resolvedSource = joinPosix(opts.sourceDir, decoded);
  const stripped = stripNotionHashFromPath(resolvedSource);

  // Markdown page link?
  if (/\.(md|markdown)$/i.test(stripped)) {
    const lookup = stripped.toLowerCase();
    const slug = opts.pageIndex.get(lookup);
    if (slug) return encodeForLink(slug + '.md') + anchor;
    // Fallback — at least drop the hash so the link is readable.
    const base = stripped.split('/').pop() || stripped;
    return encodeForLink(base) + anchor;
  }

  // Asset reference inside a Notion page asset folder. Notion exports
  // assets into `<page name> <hash>/<file>`; after stripping, we want
  // `attachments/<pageSlug>/<file>` so the host's attachment writer works.
  const segments = stripped.split('/').filter(Boolean);
  if (segments.length >= 1) {
    const filename = segments[segments.length - 1];
    return encodeForLink(`attachments/${opts.pageSlug}/${filename}`) + anchor;
  }
  return encodeForLink(stripped) + anchor;
}

/** POSIX-style join that treats `from` as a directory. */
function joinPosix(from: string, rel: string): string {
  if (rel.startsWith('/')) return rel.replace(/^\/+/, '');
  const fromParts = from.split('/').filter(Boolean);
  const relParts = rel.split('/').filter(Boolean);
  for (const p of relParts) {
    if (p === '.') continue;
    if (p === '..') {
      fromParts.pop();
      continue;
    }
    fromParts.push(p);
  }
  return fromParts.join('/');
}

function encodeForLink(p: string): string {
  // Encode spaces (and only spaces) so the markdown link parses cleanly
  // without uglifying the path. Other characters are already URL-safe in
  // the slugged form.
  return p.replace(/ /g, '%20');
}

export const __test = {
  collapseToggles,
  rewriteTarget,
  joinPosix,
  NOTION_HEX_RE,
  NOTION_HEX_GLOBAL_RE,
};
