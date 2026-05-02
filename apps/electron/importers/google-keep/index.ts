import { promises as fs } from 'fs';
import * as path from 'path';
import { ImportContext, ImportedAttachment, ImportedNote, Importer } from '../types';

/**
 * Google Keep importer (#248).
 *
 * First-party importer for Google Takeout exports of Google Keep. The user
 * picks an unzipped Takeout folder (the directory that contains `Takeout/`),
 * a `Takeout/Keep/` directory directly, or a folder of Keep `.json` files
 * already pulled out of Takeout — the importer auto-detects which.
 *
 * Mapping rules (per #248):
 * - `labels[].name`            → frontmatter `tags:`
 * - `isPinned: true`           → frontmatter `pinned: true`
 * - `color`                    → frontmatter `color:` (lower-cased; preserved
 *                                verbatim if a hex value happens to be present)
 * - `listContent[]`            → markdown `- [ ]` / `- [x]` task list
 * - `textContent`              → plain markdown body
 * - `attachments[]`            → yielded as `ImportedAttachment`s. The host
 *                                writes them under
 *                                `Imported/google-keep/attachments/<note>/…`
 *                                and we reference them inline so the markdown
 *                                renders correctly once persisted.
 * - `createdTimestampUsec`     → frontmatter `created:` (ISO)
 * - `userEditedTimestampUsec`  → frontmatter `updated:` (ISO)
 * - `isTrashed: true`          → skipped by default. Set the env var
 *                                `MID_IMPORTER_INCLUDE_TRASHED=1` to include.
 * - `isArchived: true`         → frontmatter `archived: true`
 * - `source: google-keep`      → always present in frontmatter
 *
 * Zip handling: this importer requires the export to be unzipped first. The
 * Electron host has no zip dependency and we keep it that way. If the user
 * picks a `.zip` path we log an actionable message asking them to extract it.
 */

interface KeepLabel {
  name?: string;
}

interface KeepListItem {
  text?: string;
  isChecked?: boolean;
}

interface KeepAttachment {
  filePath?: string;
  mimetype?: string;
}

interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: KeepListItem[];
  labels?: KeepLabel[];
  attachments?: KeepAttachment[];
  color?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  /** Microseconds since epoch — Keep export uses µs, not ms. */
  createdTimestampUsec?: number | string;
  userEditedTimestampUsec?: number | string;
}

interface DiscoveredJson {
  /** Absolute path to the .json on disk. */
  abs: string;
  /** Path relative to the import root, POSIX-style. */
  rel: string;
}

const SKIP_DIRS = new Set(['.git', 'node_modules']);

const googleKeep: Importer = {
  id: 'google-keep',
  name: 'Google Keep',
  icon: 'note',
  supportedFormats: ['folder'],
  description:
    'Imports notes from a Google Takeout export of Google Keep — point at the unzipped Takeout folder.',

  async detect(input: string): Promise<boolean> {
    try {
      const stat = await fs.stat(input);
      if (!stat.isDirectory()) return false;
    } catch {
      return false;
    }
    // Cheap probes, in order of confidence:
    // 1. <input>/Takeout/Keep/                       (full Takeout root)
    // 2. <input>/Keep/                               (Takeout/ directly)
    // 3. directory itself contains Keep-shaped .json (already-extracted Keep folder)
    if (await isDirectory(path.join(input, 'Takeout', 'Keep'))) return true;
    if (await isDirectory(path.join(input, 'Keep'))) return true;
    return await containsKeepJson(input);
  },

  async *import(input: string, ctx: ImportContext): AsyncIterable<ImportedNote> {
    if (input.toLowerCase().endsWith('.zip')) {
      ctx.log(
        '[google-keep] zip input not supported — please unzip the Takeout export first and pick the resulting folder',
      );
      return;
    }

    let stat;
    try {
      stat = await fs.stat(input);
    } catch (err) {
      ctx.log(`[google-keep] cannot read ${input}: ${(err as Error).message}`);
      return;
    }
    if (!stat.isDirectory()) {
      ctx.log(`[google-keep] not a directory: ${input}`);
      return;
    }

    const keepDir = await resolveKeepDir(input);
    if (!keepDir) {
      ctx.log(
        `[google-keep] could not find a Keep export under ${input} (looked for Takeout/Keep/, Keep/, or *.json files)`,
      );
      return;
    }
    ctx.log(`[google-keep] scanning ${keepDir}`);

    const includeTrashed = process.env.MID_IMPORTER_INCLUDE_TRASHED === '1';
    if (includeTrashed) {
      ctx.log('[google-keep] MID_IMPORTER_INCLUDE_TRASHED=1 — trashed notes will be included');
    }

    const jsons = await collectJsonFiles(keepDir, ctx.signal);
    if (jsons.length === 0) {
      ctx.log('[google-keep] no .json files found');
      return;
    }

    const usedSlugs = new Map<string, number>();
    let yielded = 0;
    let skippedTrashed = 0;
    let skippedNonNote = 0;

    for (const file of jsons) {
      if (ctx.signal?.aborted) {
        ctx.log('[google-keep] aborted by caller');
        return;
      }
      let raw: string;
      try {
        raw = await fs.readFile(file.abs, 'utf8');
      } catch (err) {
        ctx.log(`[google-keep] skip ${file.rel} — ${(err as Error).message}`);
        continue;
      }
      let parsed: KeepNote;
      try {
        parsed = JSON.parse(raw) as KeepNote;
      } catch (err) {
        ctx.log(`[google-keep] skip ${file.rel} — invalid JSON (${(err as Error).message})`);
        continue;
      }
      // Heuristic: a Keep note has at least one of these fields. Anything else
      // (Labels.txt → Labels.json sidecar, e.g.) we ignore.
      const looksLikeNote =
        parsed &&
        (typeof parsed.textContent === 'string' ||
          Array.isArray(parsed.listContent) ||
          typeof parsed.title === 'string' ||
          typeof parsed.createdTimestampUsec === 'number' ||
          typeof parsed.createdTimestampUsec === 'string');
      if (!looksLikeNote) {
        skippedNonNote += 1;
        continue;
      }

      if (parsed.isTrashed && !includeTrashed) {
        skippedTrashed += 1;
        continue;
      }

      const createdAt = usecToIso(parsed.createdTimestampUsec);
      const updatedAt = usecToIso(parsed.userEditedTimestampUsec);
      const title = deriveTitle(parsed, createdAt);
      const slug = uniqueSlug(slugify(title), usedSlugs);

      // Resolve attachments first so body refs use the same names the host
      // will write to disk.
      const attachments: ImportedAttachment[] = [];
      const attachmentRefs: { name: string; mime?: string }[] = [];
      for (const att of parsed.attachments ?? []) {
        if (!att.filePath) continue;
        const found = await locateAttachment(keepDir, att.filePath);
        if (!found) {
          ctx.log(`[google-keep] missing attachment ${att.filePath} for "${title}"`);
          continue;
        }
        try {
          const data = await fs.readFile(found);
          const name = path.basename(found);
          attachments.push({ name, data, mime: att.mimetype });
          attachmentRefs.push({ name, mime: att.mimetype });
        } catch (err) {
          ctx.log(
            `[google-keep] could not read attachment ${att.filePath} — ${(err as Error).message}`,
          );
        }
      }

      const body = renderBody(parsed, slug, attachmentRefs);

      const tags = (parsed.labels ?? [])
        .map((l) => (typeof l?.name === 'string' ? l.name.trim() : ''))
        .filter((s) => s.length > 0);

      const meta: Record<string, unknown> = {
        source: 'google-keep',
        pinned: Boolean(parsed.isPinned),
        color: normaliseColor(parsed.color),
      };
      if (parsed.isArchived) meta.archived = true;
      if (parsed.isTrashed) meta.trashed = true;

      yield {
        title,
        body,
        tags: tags.length > 0 ? tags : undefined,
        createdAt,
        updatedAt,
        attachments: attachments.length > 0 ? attachments : undefined,
        meta,
      };
      yielded += 1;
    }

    ctx.log(
      `[google-keep] yielded ${yielded} note${yielded === 1 ? '' : 's'}` +
        (skippedTrashed > 0 ? ` (skipped ${skippedTrashed} trashed)` : '') +
        (skippedNonNote > 0 ? ` (skipped ${skippedNonNote} non-note .json)` : ''),
    );
  },
};

export default googleKeep;

// ---------------------------------------------------------------------------
// internals

async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function containsKeepJson(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (path.extname(e.name).toLowerCase() !== '.json') continue;
    // Probe the first .json file we hit — Keep exports always have at least
    // one of these top-level fields. Cheap and decisive.
    try {
      const raw = await fs.readFile(path.join(dir, e.name), 'utf8');
      const parsed = JSON.parse(raw) as KeepNote;
      if (
        parsed &&
        (typeof parsed.textContent === 'string' ||
          Array.isArray(parsed.listContent) ||
          typeof parsed.createdTimestampUsec === 'number' ||
          typeof parsed.createdTimestampUsec === 'string')
      ) {
        return true;
      }
    } catch {
      // try the next one
    }
  }
  return false;
}

async function resolveKeepDir(input: string): Promise<string | null> {
  const takeoutKeep = path.join(input, 'Takeout', 'Keep');
  if (await isDirectory(takeoutKeep)) return takeoutKeep;
  const keep = path.join(input, 'Keep');
  if (await isDirectory(keep)) return keep;
  if (await containsKeepJson(input)) return input;
  return null;
}

async function collectJsonFiles(root: string, signal?: AbortSignal): Promise<DiscoveredJson[]> {
  const out: DiscoveredJson[] = [];
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
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') {
        const rel = toPosix(path.relative(root, full));
        out.push({ abs: full, rel });
      }
    }
  }
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

/**
 * Convert Keep's microsecond timestamp to ISO 8601. Returns undefined for
 * missing or unparseable values so the host's frontmatter formatter omits the
 * key entirely.
 */
function usecToIso(usec: unknown): string | undefined {
  if (usec === undefined || usec === null) return undefined;
  const n = typeof usec === 'string' ? Number(usec) : (usec as number);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = Math.round(n / 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function deriveTitle(note: KeepNote, createdAt: string | undefined): string {
  const t = (note.title ?? '').trim();
  if (t.length > 0) return t;
  const text = (note.textContent ?? '').trim();
  if (text.length > 0) {
    const firstLine = text.split(/\r?\n/, 1)[0].trim();
    if (firstLine.length > 0) return firstLine.slice(0, 32);
    return text.slice(0, 32);
  }
  const list = note.listContent ?? [];
  for (const item of list) {
    const txt = (item?.text ?? '').trim();
    if (txt.length > 0) return txt.slice(0, 32);
  }
  return createdAt ? `Untitled ${createdAt}` : 'Untitled';
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : 'untitled';
}

function uniqueSlug(base: string, used: Map<string, number>): string {
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  if (seen === 0) return base;
  return `${base}-${seen + 1}`;
}

/**
 * Normalise Keep's enum-style colour values (`RED`, `YELLOW`, `DEFAULT`, …)
 * to lower-case strings. If the source happens to ship a hex (`#fce8b2`) it
 * is preserved verbatim. `DEFAULT` collapses to `null` because it is not a
 * meaningful colour.
 */
function normaliseColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase() === 'DEFAULT') return null;
  if (trimmed.startsWith('#')) return trimmed;
  return trimmed.toLowerCase();
}

function renderBody(
  note: KeepNote,
  slug: string,
  attachmentRefs: { name: string; mime?: string }[],
): string {
  const out: string[] = [];

  const text = (note.textContent ?? '').replace(/\r\n/g, '\n').trim();
  const list = Array.isArray(note.listContent) ? note.listContent : [];

  if (list.length > 0) {
    for (const item of list) {
      const txt = (item?.text ?? '').replace(/\r?\n/g, ' ').trim();
      const checked = item?.isChecked === true;
      out.push(`- [${checked ? 'x' : ' '}] ${txt}`);
    }
  } else if (text.length > 0) {
    out.push(text);
  }

  if (attachmentRefs.length > 0) {
    if (out.length > 0) out.push('');
    for (const ref of attachmentRefs) {
      // Reference points at where the host will persist the attachment:
      // <note-md-folder>/attachments/<sanitised-title>/<filename>. Since the
      // host names the attachments dir from the note title (not the slug),
      // and the slug is for our own cross-note disambiguation, we link
      // through the host's actual layout.
      const href = `attachments/${slug}/${encodeURI(ref.name)}`;
      const isImage =
        (ref.mime ?? '').startsWith('image/') ||
        /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(ref.name);
      out.push(isImage ? `![${ref.name}](${href})` : `[${ref.name}](${href})`);
    }
  }

  if (out.length === 0) return '';
  return out.join('\n');
}

/**
 * Locate an attachment file referenced from a note. Keep stores attachments
 * alongside the .json files in the same Keep folder, but historical exports
 * have used different conventions (sometimes nested in subfolders), so we
 * look in:
 *   1. <keepDir>/<filePath>            (relative as written)
 *   2. <keepDir>/<basename(filePath)>  (flat — most common today)
 *   3. <keepDir>/Takeout/Keep/<basename> (defensive — caller pointed at the
 *                                          Takeout root in detect()'s third branch)
 *
 * Returns the first hit or `null`. Missing attachments do not abort the
 * import — they're logged and skipped per the issue spec.
 */
async function locateAttachment(keepDir: string, filePath: string): Promise<string | null> {
  const base = path.basename(filePath);
  const candidates = [
    path.join(keepDir, filePath),
    path.join(keepDir, base),
    path.join(keepDir, '..', 'Keep', base),
  ];
  for (const c of candidates) {
    try {
      const s = await fs.stat(c);
      if (s.isFile()) return c;
    } catch {
      // try next
    }
  }
  return null;
}
