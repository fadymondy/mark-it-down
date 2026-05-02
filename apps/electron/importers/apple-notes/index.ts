/**
 * Apple Notes importer (#247).
 *
 * On macOS, walks Notes.app via the AppleScript bridge in `applescript.ts`
 * and yields one {@link ImportedNote} per note. On every other platform it
 * yields nothing — the contract calls for an `.exporter` archive fallback,
 * but that's out of scope for the first cut.
 *
 * Two-phase flow (dry-run preview):
 *   - First call: `confirm` is false (the default). The importer enumerates
 *     notes, skips writing any attachments, and yields a single synthetic
 *     "preview" note that lists what would be written. The host writes that
 *     preview as a normal markdown file under `Imported/apple-notes/` so the
 *     user can read it like any other note.
 *   - Second call: the renderer re-invokes with `input` set to a JSON blob
 *     `{ "confirm": true }`. The importer enumerates again, writes
 *     attachments to `assets/<note-slug>/<n>.<ext>` next to each note, and
 *     yields the real notes.
 *
 * The renderer wires confirm into `input` because the contract doesn't have
 * a first-class dry-run flag — keeping the contract narrow was the whole
 * point of #246.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { ImportContext, ImportedNote, Importer } from '../types';
import { listAppleNotes, readAttachment, RawAppleNote } from './applescript';
import { extractHashtags, htmlToMarkdown } from './html-to-md';

interface RunOptions {
  confirm: boolean;
}

const appleNotes: Importer = {
  id: 'apple-notes',
  name: 'Apple Notes',
  icon: 'bx-note',
  supportedFormats: ['live'],
  description: 'Imports notes from the macOS Notes.app via AppleScript. macOS only.',

  async detect(_input: string): Promise<boolean> {
    return process.platform === 'darwin';
  },

  async *import(input: string, ctx: ImportContext): AsyncIterable<ImportedNote> {
    const opts = parseOptions(input);

    if (process.platform !== 'darwin') {
      ctx.log('[apple-notes] not running on macOS — yielding nothing.');
      return;
    }

    ctx.log(`[apple-notes] mode=${opts.confirm ? 'write' : 'dry-run'}`);

    let notes: RawAppleNote[];
    try {
      notes = await listAppleNotes();
    } catch (err) {
      ctx.log(`[apple-notes] failed to enumerate notes: ${(err as Error).message}`);
      throw err;
    }

    if (!notes.length) {
      ctx.log('[apple-notes] Notes.app returned zero notes.');
      return;
    }

    ctx.log(`[apple-notes] enumerated ${notes.length} notes across ${countFolders(notes)} folders.`);

    if (!opts.confirm) {
      yield buildPreviewNote(notes);
      return;
    }

    // Write phase. We touch disk for attachments ourselves so they land at
    // assets/<note-slug>/<n>.<ext> per the spec, then return notes WITHOUT
    // an `attachments` array so the host doesn't double-write them under
    // its standard `attachments/<title>/` layout.
    const outRoot = path.join(ctx.workspaceFolder, 'Imported', 'apple-notes');
    await fs.mkdir(outRoot, { recursive: true });

    let skippedLocked = 0;
    let skippedEmpty = 0;
    let written = 0;

    for (const raw of notes) {
      if (ctx.signal?.aborted) {
        ctx.log('[apple-notes] cancelled.');
        return;
      }

      if (raw.locked) {
        skippedLocked += 1;
        ctx.log(`[apple-notes] skipped locked note "${raw.title}".`);
        continue;
      }
      const bodyMd = htmlToMarkdown(raw.bodyHtml);
      if (!bodyMd.trim() && !raw.attachmentNames.length) {
        skippedEmpty += 1;
        continue;
      }

      const slug = slugify(raw.title || 'untitled');
      const folderPath = sanitiseFolder(raw.folder);
      const noteDir = path.join(outRoot, folderPath);
      await fs.mkdir(noteDir, { recursive: true });

      // Persist attachments first so we can rewrite body references.
      const assetMap = await persistAttachments(raw, slug, outRoot, folderPath, ctx);
      const finalBody = rewriteImageRefs(bodyMd, assetMap);

      const tags = collectTags(raw, finalBody);

      // Two-step write strategy:
      //
      //   1. Yield the note so the host writes its standard copy at
      //      Imported/apple-notes/<title>.md with the host frontmatter shape
      //      and any attachments under attachments/<title>/. This keeps the
      //      contract clean and lets the renderer's progress events fire.
      //
      //   2. Also write a hierarchy-preserving canonical copy at
      //      Imported/apple-notes/<folder>/<slug>.md with attachments at
      //      assets/<slug>/<n>.<ext>. This is what the spec wants on disk.
      //
      // The yielded note has no `attachments` property because we already
      // persisted them ourselves — this stops the host from double-writing
      // the same bytes under its own attachments/ layout.
      yield {
        title: raw.title,
        body: finalBody,
        tags,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        meta: {
          source: 'apple-notes',
          'apple-notes-folder': raw.folder,
          'apple-notes-id': raw.id,
        },
      };

      const canonicalPath = path.join(noteDir, `${slug}.md`);
      await fs.writeFile(canonicalPath, formatNoteFile(raw, finalBody, tags), 'utf8');
      ctx.log(`[apple-notes] wrote ${path.relative(ctx.workspaceFolder, canonicalPath)}`);
      written += 1;
    }

    ctx.log(
      `[apple-notes] wrote ${written} note${written === 1 ? '' : 's'}` +
      (skippedLocked ? `, skipped ${skippedLocked} locked` : '') +
      (skippedEmpty ? `, skipped ${skippedEmpty} empty` : '') +
      '.',
    );
  },
};

export default appleNotes;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the `input` string the renderer hands us. The contract types it as
 * a freeform string (it's the "source path" for most importers). We treat a
 * leading `{` as a JSON config object so the renderer can opt into the
 * write phase without us inventing a new IPC channel.
 */
function parseOptions(input: string): RunOptions {
  if (typeof input === 'string' && input.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(input) as { confirm?: unknown };
      return { confirm: parsed.confirm === true };
    } catch {
      // fall through — treat as default
    }
  }
  return { confirm: false };
}

function countFolders(notes: RawAppleNote[]): number {
  return new Set(notes.map(n => n.folder)).size;
}

function buildPreviewNote(notes: RawAppleNote[]): ImportedNote {
  const byFolder = new Map<string, RawAppleNote[]>();
  for (const n of notes) {
    const arr = byFolder.get(n.folder) ?? [];
    arr.push(n);
    byFolder.set(n.folder, arr);
  }
  const folders = Array.from(byFolder.keys()).sort();

  const lines: string[] = [
    '# Apple Notes — import preview',
    '',
    'This is a **dry-run preview**. Nothing has been written to disk yet.',
    '',
    `- Notes found: **${notes.length}**`,
    `- Folders: **${folders.length}**`,
    `- Locked notes (will be skipped): **${notes.filter(n => n.locked).length}**`,
    `- Notes with attachments: **${notes.filter(n => n.attachmentNames.length).length}**`,
    '',
    '## What would be written',
    '',
  ];
  for (const folder of folders) {
    const items = byFolder.get(folder) ?? [];
    lines.push(`### ${folder} (${items.length})`);
    lines.push('');
    for (const n of items.slice(0, 50)) {
      const lockedTag = n.locked ? ' _(locked — will be skipped)_' : '';
      const attTag = n.attachmentNames.length ? ` _(${n.attachmentNames.length} attachment${n.attachmentNames.length === 1 ? '' : 's'})_` : '';
      lines.push(`- ${n.title}${lockedTag}${attTag}`);
    }
    if (items.length > 50) lines.push(`- _… and ${items.length - 50} more._`);
    lines.push('');
  }

  lines.push(
    '## Confirm',
    '',
    'Re-run the importer with the **Confirm** option to write these notes ',
    'into `Imported/apple-notes/<folder>/<note>.md`. Attachments will land ',
    'next to each note under `assets/<note-slug>/<n>.<ext>`.',
    '',
  );

  const now = new Date().toISOString();
  return {
    title: 'Apple Notes — Import preview',
    body: lines.join('\n'),
    tags: ['imported', 'apple-notes', 'preview'],
    createdAt: now,
    updatedAt: now,
    meta: { source: 'apple-notes', 'apple-notes-mode': 'dry-run' },
  };
}

async function persistAttachments(
  raw: RawAppleNote,
  slug: string,
  outRoot: string,
  folderPath: string,
  ctx: ImportContext,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!raw.attachmentNames.length) return out;

  const assetsDir = path.join(outRoot, folderPath, 'assets', slug);
  await fs.mkdir(assetsDir, { recursive: true });

  let i = 1;
  for (const name of raw.attachmentNames) {
    if (ctx.signal?.aborted) break;
    const ext = (name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const filename = `${i}.${ext}`;
    const dest = path.join(assetsDir, filename);
    try {
      const att = await readAttachment(raw.id, name);
      if (!att) {
        ctx.log(`[apple-notes] could not read attachment "${name}" of "${raw.title}".`);
        i += 1;
        continue;
      }
      await fs.writeFile(dest, att.data);
      // Record both the original filename and a generic "image N" key so the
      // body rewriter can swap matches for either.
      out.set(name, `assets/${slug}/${filename}`);
      out.set(name.toLowerCase(), `assets/${slug}/${filename}`);
    } catch (err) {
      ctx.log(`[apple-notes] failed to save attachment "${name}": ${(err as Error).message}`);
    }
    i += 1;
  }
  return out;
}

/**
 * Replace `<img src="…">`-derived markdown image refs with our local asset
 * paths. After {@link htmlToMarkdown} runs, `<img>` tags become `![](src)` —
 * but Apple's `src` is a private URL we can't fetch. So we strip those
 * refs and append local images in order at the bottom of the body.
 */
function rewriteImageRefs(body: string, assetMap: Map<string, string>): string {
  if (!assetMap.size) {
    // Strip any leftover image refs (Apple's internal URLs) so they don't
    // render as broken images.
    return body.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  }
  // Drop opaque Apple image refs.
  let out = body.replace(/!\[[^\]]*\]\([^)]*x-coredata[^)]*\)/g, '');
  out = out.replace(/!\[[^\]]*\]\(applewebdata:[^)]+\)/g, '');

  // Append all locally-stored attachments at the end. We only emit each
  // unique relative path once — the asset map keys both original-cased and
  // lower-cased names at the same value.
  const seen = new Set<string>();
  const trail: string[] = [];
  for (const rel of assetMap.values()) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    trail.push(`![](${rel})`);
  }
  if (trail.length) {
    out = `${out.trimEnd()}\n\n${trail.join('\n')}\n`;
  }
  return out;
}

function collectTags(raw: RawAppleNote, body: string): string[] {
  const fromBody = extractHashtags(body);
  const seed = ['imported', 'apple-notes'];
  return Array.from(new Set([...seed, ...fromBody]));
}

function formatNoteFile(raw: RawAppleNote, body: string, tags: string[]): string {
  const fm: string[] = ['---'];
  fm.push(`title: ${yamlString(raw.title)}`);
  fm.push(`created: ${raw.createdAt}`);
  fm.push(`updated: ${raw.updatedAt}`);
  fm.push(`tags: [${tags.map(t => yamlString(t)).join(', ')}]`);
  fm.push('source: apple-notes');
  fm.push('---', '');
  return fm.join('\n') + body + (body.endsWith('\n') ? '' : '\n');
}

function yamlString(s: string): string {
  // Quote if needed (contains :, #, etc.); otherwise leave bare for readability.
  if (/[:#\[\]\{\},&*!|>'"%@`\n]/.test(s) || /^\s/.test(s) || /\s$/.test(s) || s === '') {
    return JSON.stringify(s);
  }
  return s;
}

function slugify(s: string): string {
  return (s || 'untitled')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

function sanitiseFolder(name: string): string {
  return (name || 'Notes')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Notes';
}
