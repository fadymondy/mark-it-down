/**
 * Importer plugin contract — see docs/importers.md.
 *
 * The runtime under apps/electron/importers/loader.ts discovers every folder in
 * apps/electron/importers/<id>/index.ts (dev) or <resources>/importers/<id>/index.js
 * (packaged) whose default export satisfies {@link Importer}. No core code touches
 * an importer directly — the loader, the IPC layer in main.ts, and the chooser
 * modal in renderer.ts are fully data-driven.
 *
 * Concrete importers (Apple Notes, Google Keep, Notion, generic markdown) live in
 * separate issues (#247–#250). This file is the spine.
 */

/**
 * Static, serialisable description of an importer. The renderer only ever sees
 * this shape — runtime functions stay in the main process.
 */
export interface ImporterMetadata {
  /** Stable kebab-case identifier, unique across all importers. */
  id: string;
  /** Display name shown in the chooser modal. */
  name: string;
  /** boxicons name (e.g. "bx-import") — already shipped via icons.css. */
  icon: string;
  /** Optional human-readable list of accepted source kinds, e.g. ["folder", "zip"]. */
  supportedFormats?: string[];
  /** Short blurb shown under the name in the chooser. */
  description?: string;
}

/**
 * One imported note as produced by an importer's async iterator. The host adds
 * frontmatter (id, created, updated, tags) when persisting — importers should
 * leave `body` as plain markdown.
 */
export interface ImportedNote {
  title: string;
  /** Markdown body. No frontmatter — host adds it. */
  body: string;
  tags?: string[];
  /** ISO 8601. */
  createdAt?: string;
  /** ISO 8601. */
  updatedAt?: string;
  attachments?: ImportedAttachment[];
  /** Extra frontmatter fields the importer wants persisted verbatim. */
  meta?: Record<string, unknown>;
}

export interface ImportedAttachment {
  /** Filename relative to the note's attachments folder, e.g. "image.png". */
  name: string;
  data: Buffer;
  /** Optional MIME type — host can sniff if absent. */
  mime?: string;
}

/** Runtime context handed to {@link Importer.import}. */
export interface ImportContext {
  /** Absolute path to the workspace root the user is importing into. */
  workspaceFolder: string;
  /**
   * Per-importer log sink — the loader pipes this into the main-process logger
   * so importer output shows up alongside other diagnostics.
   */
  log: (msg: string) => void;
  /** Optional cancellation handle wired to the renderer. */
  signal?: AbortSignal;
}

/**
 * Fully-fleshed importer plugin. The default export of every
 * apps/electron/importers/<id>/index.ts must satisfy this interface.
 */
export interface Importer extends ImporterMetadata {
  /**
   * Cheap probe: given a folder/file path, return true if this importer thinks
   * it can handle it. Optional — used by the chooser to highlight likely
   * matches when the user picks a path before picking an importer.
   */
  detect?(input: string): Promise<boolean>;
  /**
   * The actual import. Yields notes one at a time so the renderer can show
   * incremental progress without buffering everything in memory.
   */
  import(input: string, ctx: ImportContext): AsyncIterable<ImportedNote>;
}

/**
 * Type guard: validate that an unknown module default export is a usable
 * {@link Importer}. The loader uses this before registering anything.
 */
export function isImporter(value: unknown): value is Importer {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.icon === 'string' &&
    typeof v.import === 'function'
  );
}
