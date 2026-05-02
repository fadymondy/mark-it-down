import { promises as fs } from 'fs';
import * as path from 'path';
import { ImportContext, ImportedNote, Importer } from '../types';

/**
 * Generic markdown importer (#250).
 *
 * Catch-all importer for plain folders of markdown — Bear exports, Obsidian
 * vaults, plain note collections. Walks the folder recursively, yields one
 * `ImportedNote` per `.md` / `.markdown` / `.txt` file, preserves the source
 * tree under the host's `Imported/<importer-id>/…` target, keeps frontmatter
 * verbatim, and rewrites Obsidian-style wikilinks to relative markdown links
 * when the target file is part of the imported set.
 *
 * Intentionally skipped:
 * - Hidden files / directories (`.git`, `.obsidian`, `.DS_Store`, etc.)
 * - `node_modules` (defensive — unlikely in a notes folder, but free)
 *
 * The host owns frontmatter persistence, so we leave whatever frontmatter the
 * source file already had baked into `body` and let the host wrap its own
 * `created` / `updated` / `tags` keys around it. The `meta.relativePath` field
 * tells the host where the file came from in the source tree — downstream
 * tooling that wants to mirror the layout can read it from frontmatter.
 */

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.txt']);
const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules']);

interface DiscoveredFile {
  /** Absolute path on disk. */
  abs: string;
  /** Path relative to the import root, using POSIX separators. */
  rel: string;
  /** Filename without extension — used for wikilink target matching. */
  basename: string;
}

const generic: Importer = {
  id: 'generic',
  name: 'Markdown folder (Bear / Obsidian / plain)',
  icon: 'folder',
  supportedFormats: ['folder'],
  description:
    'Imports a folder of plain markdown — Bear exports, Obsidian vaults, or any directory of .md / .markdown / .txt files.',

  async detect(input: string): Promise<boolean> {
    try {
      const stat = await fs.stat(input);
      if (!stat.isDirectory()) return false;
    } catch {
      return false;
    }
    // Cheap probe: look for at least one markdown-ish file anywhere in the tree.
    return await containsMarkdown(input);
  },

  async *import(input: string, ctx: ImportContext): AsyncIterable<ImportedNote> {
    let root: string;
    try {
      const stat = await fs.stat(input);
      if (!stat.isDirectory()) {
        ctx.log(`[generic] not a directory: ${input}`);
        return;
      }
      root = input;
    } catch (err) {
      ctx.log(`[generic] cannot read ${input}: ${(err as Error).message}`);
      return;
    }

    ctx.log(`[generic] scanning ${root}`);
    const files = await collectMarkdownFiles(root, ctx.signal);
    if (files.length === 0) {
      ctx.log('[generic] no .md / .markdown / .txt files found');
      return;
    }

    // Build the wikilink target index ONCE — basename → POSIX relative path.
    // First-write-wins on collisions; logged so the user knows.
    const targets = new Map<string, string>();
    for (const f of files) {
      const key = f.basename.toLowerCase();
      if (!targets.has(key)) {
        targets.set(key, f.rel);
      } else {
        ctx.log(`[generic] duplicate basename "${f.basename}" — wikilinks will resolve to ${targets.get(key)}`);
      }
    }

    let yielded = 0;
    for (const file of files) {
      if (ctx.signal?.aborted) {
        ctx.log('[generic] aborted by caller');
        return;
      }
      let raw: string;
      try {
        raw = await fs.readFile(file.abs, 'utf8');
      } catch (err) {
        ctx.log(`[generic] skip ${file.rel} — ${(err as Error).message}`);
        continue;
      }

      const body = rewriteWikilinks(raw, file.rel, targets);
      const title = deriveTitle(raw, file.basename);

      let createdAt: string | undefined;
      let updatedAt: string | undefined;
      try {
        const stat = await fs.stat(file.abs);
        createdAt = stat.birthtime.toISOString();
        updatedAt = stat.mtime.toISOString();
      } catch {
        // best-effort
      }

      yield {
        title,
        body,
        createdAt,
        updatedAt,
        meta: {
          source: 'generic',
          relativePath: file.rel,
        },
      };
      yielded += 1;
    }
    ctx.log(`[generic] yielded ${yielded} note${yielded === 1 ? '' : 's'}`);
  },
};

export default generic;

// ---------------------------------------------------------------------------
// internals

async function containsMarkdown(root: string): Promise<boolean> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && MARKDOWN_EXTS.has(path.extname(entry.name).toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

async function collectMarkdownFiles(root: string, signal?: AbortSignal): Promise<DiscoveredFile[]> {
  const out: DiscoveredFile[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    if (signal?.aborted) return out;
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && MARKDOWN_EXTS.has(path.extname(entry.name).toLowerCase())) {
        const rel = toPosix(path.relative(root, full));
        const basename = path.basename(entry.name, path.extname(entry.name));
        out.push({ abs: full, rel, basename });
      }
    }
  }
  // Stable order so progress is predictable.
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

function shouldSkip(name: string): boolean {
  if (!name) return true;
  if (name.startsWith('.')) return true;
  if (SKIP_DIRS.has(name)) return true;
  return false;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function deriveTitle(raw: string, fallback: string): string {
  // Skip frontmatter when looking for an H1.
  let body = raw;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) {
      body = body.slice(end + 4);
    }
  }
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  if (m) return m[1].trim();
  return fallback;
}

/**
 * Rewrite `[[Page]]` and `[[Page|alias]]` to `[Page](Page.md)` /
 * `[alias](Page.md)` when a target with that basename exists in the imported
 * set. Embeds (`![[…]]`) and links with no match are left untouched so the
 * source semantics are preserved when the user re-imports later.
 *
 * The link target is the POSIX relative path of the matched file, so a note
 * deep in the tree resolves to the right place when the host writes the
 * imported tree out verbatim.
 *
 * @param sourceRel POSIX-relative path of the file being rewritten — used to
 * compute `..`-style links so a wikilink doesn't break when the host preserves
 * folder layout.
 */
export function rewriteWikilinks(
  text: string,
  sourceRel: string,
  targets: Map<string, string>,
): string {
  // Non-embed wikilinks only. Group 1 = page, group 2 = optional alias.
  return text.replace(/(^|[^!])\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (match, lead, page, alias) => {
    const key = String(page).trim().toLowerCase();
    const target = targets.get(key);
    if (!target) return match;
    const linkText = (alias ?? page).toString().trim();
    const href = relativeLink(sourceRel, target);
    return `${lead}[${linkText}](${href})`;
  });
}

function relativeLink(fromRel: string, toRel: string): string {
  const fromDir = path.posix.dirname(fromRel);
  if (fromDir === '.' || fromDir === '') return toRel;
  let rel = path.posix.relative(fromDir, toRel);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}
