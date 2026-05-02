/**
 * AppleScript bridge for the Apple Notes importer.
 *
 * Exposes two operations:
 *   - {@link listAppleNotes} — enumerate every (folder, note) pair with its
 *     title, body HTML, container folder name, and ISO timestamps.
 *   - {@link readAttachment}  — pull the on-disk bytes of a single attachment
 *     for a given note id.
 *
 * Both are guarded by `process.platform === 'darwin'` at the call site and
 * shell out to `/usr/bin/osascript`. Output is delimited by sentinel strings
 * so we can safely round-trip note bodies that contain newlines.
 *
 * Why not JXA? We could — but plain AppleScript is the path the
 * `osascript` examples in `Notes.app`'s scripting dictionary all use, and the
 * dictionary is the most reliable contract Apple offers here.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface RawAppleNote {
  id: string;
  title: string;
  bodyHtml: string;
  folder: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  locked: boolean;
  attachmentNames: string[];
}

const FIELD_SEP = '␟'; // ASCII unit separator (printable variant)
const RECORD_SEP = '␞'; // ASCII record separator (printable variant)

/** Run `osascript -e <script>` and return stdout. Rejects on non-zero exit. */
function runOsascript(script: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString('utf8'); });
    child.stderr.on('data', d => { stderr += d.toString('utf8'); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (killed) return reject(new Error(`osascript timed out after ${timeoutMs}ms`));
      if (code !== 0) {
        // Detect the canonical permission-denied case so the host can surface
        // an actionable error to the user.
        if (/not authorized|not allowed|errAEEventNotPermitted|-1743/i.test(stderr)) {
          return reject(new Error(
            'AppleScript permission denied for Notes. Open System Settings → Privacy & Security → Automation, ' +
            'find the running Mark It Down application (or your terminal in dev), and enable Notes.'
          ));
        }
        return reject(new Error(`osascript exited ${code}: ${stderr.trim() || 'unknown error'}`));
      }
      resolve(stdout);
    });
  });
}

/**
 * Enumerate every note in Notes.app. Yields a flat array — folder hierarchy
 * is reconstructed by the caller from {@link RawAppleNote.folder}.
 *
 * Skips notes that the user has locked (we can't read their body without
 * prompting for a password) but reports them via the `locked` flag so the
 * caller can log a one-line summary.
 */
export async function listAppleNotes(): Promise<RawAppleNote[]> {
  // The script writes records separated by RECORD_SEP, fields by FIELD_SEP.
  // We deliberately stream via `set output to output & …` rather than building
  // a list of records — Apple's text item delimiters become unreliable on
  // very large libraries.
  const script = [
    'set fieldSep to (ASCII character 31)',
    'set recordSep to (ASCII character 30)',
    'set output to ""',
    'tell application "Notes"',
    '  set allNotes to every note',
    '  repeat with n in allNotes',
    '    set noteId to (id of n) as string',
    '    set noteTitle to (name of n) as string',
    '    set noteBody to (body of n) as string',
    '    set noteFolder to (name of (container of n)) as string',
    '    set noteCreated to (creation date of n)',
    '    set noteUpdated to (modification date of n)',
    '    try',
    '      set noteLocked to (password protected of n) as boolean',
    '    on error',
    '      set noteLocked to false',
    '    end try',
    '    set attNames to ""',
    '    try',
    '      set atts to every attachment of n',
    '      repeat with a in atts',
    '        try',
    '          set aName to (name of a) as string',
    '          if aName is missing value then set aName to "attachment"',
    '          if attNames is "" then',
    '            set attNames to aName',
    '          else',
    '            set attNames to attNames & "|" & aName',
    '          end if',
    '        end try',
    '      end repeat',
    '    end try',
    '    set output to output & noteId & fieldSep & noteTitle & fieldSep & noteFolder & fieldSep & ((noteCreated as «class isot» as string)) & fieldSep & ((noteUpdated as «class isot» as string)) & fieldSep & (noteLocked as string) & fieldSep & attNames & fieldSep & noteBody & recordSep',
    '  end repeat',
    'end tell',
    'return output',
  ].join('\n');

  const raw = await runOsascript(script, 5 * 60_000);
  const records = raw.split(RECORD_SEP).map(r => r.trim()).filter(Boolean);
  const out: RawAppleNote[] = [];
  for (const rec of records) {
    const parts = rec.split(FIELD_SEP);
    if (parts.length < 8) continue;
    const [id, title, folder, createdRaw, updatedRaw, lockedRaw, attsRaw, body] = parts;
    out.push({
      id: id.trim(),
      title: title.trim() || 'Untitled',
      folder: folder.trim() || 'Notes',
      bodyHtml: body,
      createdAt: normaliseIsoDate(createdRaw.trim()),
      updatedAt: normaliseIsoDate(updatedRaw.trim()),
      locked: /true/i.test(lockedRaw.trim()),
      attachmentNames: attsRaw.trim() ? attsRaw.split('|').map(s => s.trim()).filter(Boolean) : [],
    });
  }
  return out;
}

/**
 * Save a single attachment to disk and return the absolute path. Apple Notes
 * exposes an attachment's data only via the `save … in <file>` AppleScript
 * verb — there's no clean Buffer pipe — so we route through a temp file and
 * read it back.
 */
export async function readAttachment(noteId: string, attachmentName: string): Promise<{ data: Buffer; mime?: string } | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mid-apple-notes-'));
  const tmpPath = path.join(tmpDir, sanitiseFilename(attachmentName));
  try {
    const escapedNoteId = noteId.replace(/"/g, '\\"');
    const escapedAttName = attachmentName.replace(/"/g, '\\"');
    const escapedPath = tmpPath.replace(/"/g, '\\"');
    const script = [
      'tell application "Notes"',
      `  set targetNote to first note whose id is "${escapedNoteId}"`,
      `  set targetAtt to first attachment of targetNote whose name is "${escapedAttName}"`,
      `  save targetAtt in POSIX file "${escapedPath}"`,
      'end tell',
    ].join('\n');
    await runOsascript(script, 30_000);
    const data = await fs.readFile(tmpPath);
    return { data, mime: guessMime(attachmentName) };
  } catch {
    return null;
  } finally {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function normaliseIsoDate(s: string): string {
  // AppleScript's `«class isot»` cast yields ISO 8601 in the local timezone
  // already; we just trim whitespace. If parsing fails, fall back to "now".
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function sanitiseFilename(input: string): string {
  return (input || 'attachment')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'attachment';
}

function guessMime(name: string): string | undefined {
  const ext = name.toLowerCase().split('.').pop();
  switch (ext) {
    case 'png':  return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif':  return 'image/gif';
    case 'heic': return 'image/heic';
    case 'webp': return 'image/webp';
    case 'pdf':  return 'application/pdf';
    case 'mp3':  return 'audio/mpeg';
    case 'm4a':  return 'audio/mp4';
    case 'mov':  return 'video/quicktime';
    case 'mp4':  return 'video/mp4';
    default:     return undefined;
  }
}
