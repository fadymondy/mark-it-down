/**
 * Pure helpers for note attachment filenames + relative-link emission.
 *
 * Storage layout: each note `<id>.md` has a sibling directory
 * `<id>-attachments/` that holds the binary files. Markdown bodies refer
 * to attachments via relative links: `<id>-attachments/<filename>`.
 */

const ATTACHMENT_DIR_SUFFIX = '-attachments';
const SAFE_NAME = /[^A-Za-z0-9._-]+/g;
const MAX_NAME_LENGTH = 96;

export function attachmentDirName(noteId: string): string {
  return `${noteId}${ATTACHMENT_DIR_SUFFIX}`;
}

export function relativeAttachmentPath(noteId: string, filename: string): string {
  return `${attachmentDirName(noteId)}/${filename}`;
}

/**
 * Best-effort sanitisation: strip path separators, collapse unsafe runs to
 * dashes, trim the basename to MAX_NAME_LENGTH while preserving the extension.
 */
export function sanitizeAttachmentName(rawName: string): string {
  const base = rawName.split(/[/\\]+/).pop() ?? rawName;
  const cleaned = base.replace(SAFE_NAME, '-').replace(/^-+|-+$/g, '');
  if (cleaned.length === 0) return 'attachment';
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  if (dot < 0 || dot === 0) return cleaned.slice(0, MAX_NAME_LENGTH);
  const ext = cleaned.slice(dot);
  const stem = cleaned.slice(0, dot);
  const allowedStem = MAX_NAME_LENGTH - ext.length;
  return allowedStem > 0 ? stem.slice(0, allowedStem) + ext : cleaned.slice(0, MAX_NAME_LENGTH);
}

/**
 * Resolve a collision-free name given the set of existing filenames in the
 * attachment dir. Appends `-1`, `-2`, … to the basename until a free slot
 * is found.
 */
export function resolveCollision(name: string, existing: Iterable<string>): string {
  const existingSet = new Set(existing);
  if (!existingSet.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!existingSet.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.heic', '.heif',
]);

export function isImageAttachment(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

/**
 * Emit a markdown reference for an attachment. Images get `![]()`, other
 * file types get `[]()` so they render as plain links.
 */
export function attachmentMarkdown(noteId: string, filename: string, label?: string): string {
  const ref = relativeAttachmentPath(noteId, filename);
  const display = label ?? filename;
  return isImageAttachment(filename) ? `![${display}](${ref})` : `[${display}](${ref})`;
}
