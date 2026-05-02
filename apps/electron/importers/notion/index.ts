import { promises as fs } from 'fs';
import * as path from 'path';
import { ImportContext, ImportedAttachment, ImportedNote, Importer } from '../types';
import {
  notionSlug,
  normaliseNotionMarkdown,
  stripNotionHash,
  stripNotionHashFromPath,
} from './normalize';
import { buildIndexMarkdown, dbNameFromCsv, parseCsv } from './db';

/**
 * First-party importer for Notion's "Export → Markdown & CSV" output (#249).
 *
 * The user points the chooser at an **unzipped** Notion export folder.
 * Detection accepts either:
 *
 *  - any directory containing one or more `<page-name> <32-hex>.md` files
 *    (the canonical Notion export pattern), OR
 *  - a directory containing a top-level `<dbname> <hash>.csv` paired with
 *    a sibling `<dbname> <hash>/` folder of row pages.
 *
 * The importer walks the tree recursively, yielding one `ImportedNote`
 * per `.md` (with hash-stripped filename + Notion-specific markdown
 * normalised to GFM) and one extra index note per database CSV.
 *
 * Files inside Notion's per-page asset folders (`<page> <hash>/image.png`,
 * etc.) are attached to the owning note, so the host's default attachment
 * layout (`Imported/notion/attachments/<title>/<file>`) puts them right
 * where the rewritten relative refs point.
 *
 * The implementation deliberately leans on the helpers in `normalize.ts`
 * and `db.ts` so this file stays a slim orchestrator. See those modules
 * for the per-concern unit-style logic and the CSV parser.
 */

const NOTION_HEX_RE = /\s[0-9a-f]{32}(?:\.|$|\b)/i;
const NOTION_HEX_FILE_RE = /\s[0-9a-f]{32}\.(md|markdown|csv)$/i;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store']);
const MARKDOWN_EXTS = new Set(['.md', '.markdown']);
const LARGE_FILE_BYTES = 50 * 1024 * 1024;

interface DiscoveredMarkdown {
  /** Absolute path on disk. */
  abs: string;
  /** Path relative to the import root, using POSIX separators. */
  rel: string;
  /** Page name with the hash stripped. */
  title: string;
  /** The 32-char hex id, if present. */
  hash?: string;
  /** POSIX-relative path with hashes stripped from every segment. */
  cleanRel: string;
}

interface DiscoveredCsv {
  abs: string;
  rel: string;
  /** Database display name (hash-stripped). */
  dbName: string;
  /** POSIX-relative path of the sibling folder of row pages, if it exists. */
  pagesDirRel?: string;
}

const notion: Importer = {
  id: 'notion',
  name: 'Notion',
  icon: 'edit',
  supportedFormats: ['folder'],
  description:
    'Imports a Notion "Export → Markdown & CSV" folder. Strips id hashes, normalises callouts and toggles, and folds databases into a linked index page.',

  async detect(input: string): Promise<boolean> {
    try {
      const stat = await fs.stat(input);
      if (!stat.isDirectory()) {
        // Reject zips up front — the importer needs an unzipped folder.
        return false;
      }
    } catch {
      return false;
    }
    return await containsNotionExport(input);
  },

  async *import(input: string, ctx: ImportContext): AsyncIterable<ImportedNote> {
    let root: string;
    try {
      const stat = await fs.stat(input);
      if (!stat.isDirectory()) {
        ctx.log(`[notion] expected a folder, got: ${input}`);
        if (input.toLowerCase().endsWith('.zip')) {
          ctx.log('[notion] please unzip the Notion export first and pick the resulting folder');
        }
        return;
      }
      root = input;
    } catch (err) {
      ctx.log(`[notion] cannot read ${input}: ${(err as Error).message}`);
      return;
    }

    ctx.log(`[notion] scanning ${root}`);
    const { markdownFiles, csvFiles } = await collectExport(root, ctx);
    if (markdownFiles.length === 0 && csvFiles.length === 0) {
      ctx.log('[notion] no Notion-shaped files found');
      return;
    }

    // Pre-compute the slug for every page so cross-page links resolve to
    // the actual on-disk filenames the host writes. Collisions get a
    // numeric suffix (`-2`, `-3`, …) so two pages with the same title
    // don't overwrite each other.
    const usedSlugs = new Set<string>();
    const slugFor = new Map<string, string>(); // cleanRel → slug
    for (const f of markdownFiles) {
      const baseSlug = notionSlug(f.title);
      let slug = baseSlug;
      let n = 2;
      while (usedSlugs.has(slug.toLowerCase())) {
        slug = `${baseSlug}-${n++}`;
      }
      usedSlugs.add(slug.toLowerCase());
      slugFor.set(f.cleanRel.toLowerCase(), slug);
    }

    let yielded = 0;
    for (const file of markdownFiles) {
      if (ctx.signal?.aborted) {
        ctx.log('[notion] aborted by caller');
        return;
      }
      const note = await readNotionPage(file, root, slugFor, ctx);
      if (!note) continue;
      yield note;
      yielded += 1;
    }

    // Database index pages: one extra note per CSV, titled after the
    // database, with each row linking to the matching imported page.
    for (const csv of csvFiles) {
      if (ctx.signal?.aborted) return;
      const note = await readDatabaseIndex(csv, root, slugFor, ctx);
      if (!note) continue;
      // Avoid colliding with a same-named page slug — bump if needed.
      let title = note.title;
      let n = 2;
      while (usedSlugs.has(notionSlug(title).toLowerCase())) {
        title = `${note.title} (database ${n++})`;
      }
      usedSlugs.add(notionSlug(title).toLowerCase());
      yield { ...note, title };
      yielded += 1;
    }

    ctx.log(`[notion] yielded ${yielded} note${yielded === 1 ? '' : 's'}`);
  },
};

export default notion;

// ---------------------------------------------------------------------------
// discovery

async function containsNotionExport(root: string): Promise<boolean> {
  const stack: string[] = [root];
  let depth = 0;
  while (stack.length > 0 && depth < 4096) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      if (entry.isFile()) {
        if (NOTION_HEX_FILE_RE.test(entry.name)) return true;
      } else if (entry.isDirectory()) {
        // A folder named `<x> <hash>` is also a strong signal.
        if (NOTION_HEX_RE.test(entry.name)) return true;
        stack.push(path.join(dir, entry.name));
      }
    }
    depth += 1;
  }
  return false;
}

async function collectExport(
  root: string,
  ctx: ImportContext,
): Promise<{ markdownFiles: DiscoveredMarkdown[]; csvFiles: DiscoveredCsv[] }> {
  const markdownFiles: DiscoveredMarkdown[] = [];
  const csvFiles: DiscoveredCsv[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    if (ctx.signal?.aborted) break;
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
      const rel = toPosix(path.relative(root, full));
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (MARKDOWN_EXTS.has(ext)) {
        const stripped = stripNotionHash(entry.name);
        const title = path.basename(stripped.name, path.extname(stripped.name));
        markdownFiles.push({
          abs: full,
          rel,
          title,
          hash: stripped.hash,
          cleanRel: stripNotionHashFromPath(rel),
        });
      } else if (ext === '.csv') {
        const dbName = dbNameFromCsv(entry.name);
        // Pair with a sibling folder if one exists with the same hash.
        const stripped = stripNotionHash(entry.name.replace(/\.csv$/i, ''));
        let pagesDirRel: string | undefined;
        if (stripped.hash) {
          const sibling = path.join(dir, `${dbName} ${stripped.hash}`);
          try {
            const s = await fs.stat(sibling);
            if (s.isDirectory()) pagesDirRel = toPosix(path.relative(root, sibling));
          } catch {
            // no sibling — that's fine, we still emit an index page.
          }
        }
        csvFiles.push({ abs: full, rel, dbName, pagesDirRel });
      }
    }
  }

  markdownFiles.sort((a, b) => a.rel.localeCompare(b.rel));
  csvFiles.sort((a, b) => a.rel.localeCompare(b.rel));
  return { markdownFiles, csvFiles };
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

// ---------------------------------------------------------------------------
// per-page import

async function readNotionPage(
  file: DiscoveredMarkdown,
  root: string,
  slugFor: Map<string, string>,
  ctx: ImportContext,
): Promise<ImportedNote | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file.abs, 'utf8');
  } catch (err) {
    ctx.log(`[notion] skip ${file.rel} — ${(err as Error).message}`);
    return null;
  }

  const pageSlug = slugFor.get(file.cleanRel.toLowerCase()) ?? notionSlug(file.title);
  const sourceDir = toPosix(path.dirname(file.rel));

  const body = normaliseNotionMarkdown(raw, {
    pageSlug,
    pageIndex: slugFor,
    sourceDir,
    log: ctx.log,
  });

  // Collect attachments from the per-page asset folder, if it exists.
  const attachments: ImportedAttachment[] = [];
  if (file.hash) {
    const assetDirAbs = path.join(path.dirname(file.abs), `${file.title} ${file.hash}`);
    try {
      const s = await fs.stat(assetDirAbs);
      if (s.isDirectory()) {
        await collectAttachments(assetDirAbs, '', attachments, ctx);
      }
    } catch {
      // No asset folder for this page — skip silently.
    }
  }

  const stat = await fs.stat(file.abs).catch(() => null);
  const createdAt = stat?.birthtime?.toISOString();
  const updatedAt = stat?.mtime?.toISOString();

  return {
    title: pageSlug,
    body,
    createdAt,
    updatedAt,
    attachments: attachments.length ? attachments : undefined,
    meta: {
      source: 'notion',
      ...(file.hash ? { 'notion-id': file.hash } : {}),
      relativePath: file.cleanRel,
    },
  };
}

async function collectAttachments(
  dir: string,
  prefix: string,
  out: ImportedAttachment[],
  ctx: ImportContext,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Notion can nest sub-pages inside a page's asset folder. Those are
      // handled by their own .md walk; for attachments we only flatten
      // file children.
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (MARKDOWN_EXTS.has(ext) || ext === '.csv') continue; // not attachments
    let data: Buffer;
    try {
      const stat = await fs.stat(full);
      if (stat.size > LARGE_FILE_BYTES) {
        ctx.log(`[notion] large attachment (${(stat.size / 1024 / 1024).toFixed(1)}MB): ${entry.name}`);
      }
      data = await fs.readFile(full);
    } catch (err) {
      ctx.log(`[notion] skip attachment ${entry.name} — ${(err as Error).message}`);
      continue;
    }
    out.push({
      name: prefix ? `${prefix}/${entry.name}` : entry.name,
      data,
    });
  }
}

// ---------------------------------------------------------------------------
// database index

async function readDatabaseIndex(
  csv: DiscoveredCsv,
  root: string,
  slugFor: Map<string, string>,
  ctx: ImportContext,
): Promise<ImportedNote | null> {
  let raw: string;
  try {
    raw = await fs.readFile(csv.abs, 'utf8');
  } catch (err) {
    ctx.log(`[notion] skip db ${csv.rel} — ${(err as Error).message}`);
    return null;
  }
  const table = parseCsv(raw);
  if (!table) {
    ctx.log(`[notion] empty database CSV: ${csv.rel}`);
    return null;
  }

  // Build the row → slug map by walking the slug index for any page whose
  // cleaned relative path lives inside the sibling folder.
  const rowPageSlugs = new Map<string, string>();
  if (csv.pagesDirRel) {
    const prefix = stripNotionHashFromPath(csv.pagesDirRel) + '/';
    for (const [cleanRel, slug] of slugFor.entries()) {
      if (!cleanRel.startsWith(prefix.toLowerCase())) continue;
      // The row's title in the CSV matches the page filename basename.
      const base = cleanRel.slice(prefix.length).replace(/\.(md|markdown)$/i, '');
      const last = base.split('/').pop() || base;
      rowPageSlugs.set(last.toLowerCase(), slug);
    }
  }

  const body = buildIndexMarkdown(table, {
    dbName: csv.dbName,
    rowPageSlugs,
  });

  const stat = await fs.stat(csv.abs).catch(() => null);

  return {
    title: csv.dbName,
    body,
    createdAt: stat?.birthtime?.toISOString(),
    updatedAt: stat?.mtime?.toISOString(),
    meta: {
      source: 'notion',
      kind: 'database',
      relativePath: stripNotionHashFromPath(csv.rel),
    },
  };
}
