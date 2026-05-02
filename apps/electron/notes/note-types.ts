/**
 * Note type registry (#255 — Typed notes).
 *
 * Each note carries a `type` field whose value matches one of the ids below.
 * The registry is intentionally a plain TS module rather than a JSON file or
 * setting so:
 *   - both main and renderer can `import` it without IPC,
 *   - bundlers can tree-shake unused metadata,
 *   - adding a new built-in type is a single PR (just append to BUILT_IN_TYPES).
 *
 * `viewKind` is the indirection point that drives the renderer's editor swap.
 * `'markdown'` (or omitted) keeps the default markdown editor; any other value
 * is matched in the renderer's `renderTypedView()` switch (see
 * `renderer.ts → openNote`). When you add a new viewKind, register the matching
 * renderer branch in the same PR so the type doesn't fall back silently.
 */

export interface NoteType {
  /** Stable id persisted into `notes.json`. Must be slug-safe. */
  id: string;
  /** Human label for menus/chips (English; localizable later). */
  label: string;
  /** Boxicons name from `packages/ui-tokens/src/icons.ts`. */
  icon: string;
  /** Tint colour for the type chip (CSS hex). */
  color: string;
  /** Optional custom view id; default is `'markdown'`. */
  viewKind?: 'markdown' | 'secret' | string;
  /** Short descriptor shown in the type chooser modal. */
  description?: string;
}

/**
 * Built-in types. Order is stable — the filter strip and type-chooser modal
 * render in this order. `'note'` MUST stay first; it's the default for legacy
 * notes that were created before #255 landed.
 */
export const BUILT_IN_TYPES: readonly NoteType[] = [
  {
    id: 'note',
    label: 'Note',
    icon: 'bookmark',
    color: '#6e7681',
    description: 'Plain markdown — the default.',
  },
  {
    id: 'secret',
    label: 'Secret',
    icon: 'lock',
    color: '#bf8700',
    viewKind: 'secret',
    description: 'Key/value secrets editor with reveal + copy.',
  },
  {
    id: 'task-list',
    label: 'Task list',
    icon: 'check-square',
    color: '#1a7f37',
    description: 'Checklist of todos (uses markdown for now).',
  },
  {
    id: 'meeting',
    label: 'Meeting',
    icon: 'calendar',
    color: '#0969da',
    description: 'Date + attendees frontmatter (uses markdown for now).',
  },
  {
    id: 'reference',
    label: 'Reference',
    icon: 'book',
    color: '#8250df',
    description: 'Long-lived reference doc.',
  },
  {
    id: 'snippet',
    label: 'Snippet',
    icon: 'code',
    color: '#cf222e',
    description: 'Code or shell snippet.',
  },
] as const;

/** Default type id assigned when a note doesn't specify one. */
export const DEFAULT_TYPE_ID = 'note';

const BY_ID = new Map<string, NoteType>(BUILT_IN_TYPES.map(t => [t.id, t]));

/** Look up a type by id, falling back to the default `note` type so the UI
 * never crashes on an unknown id (e.g. when a user hand-edits notes.json). */
export function getNoteType(id: string | undefined): NoteType {
  if (!id) return BY_ID.get(DEFAULT_TYPE_ID)!;
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_TYPE_ID)!;
}

/** Returns the registered ids in display order. */
export function listNoteTypeIds(): string[] {
  return BUILT_IN_TYPES.map(t => t.id);
}

/** All registered types in display order. */
export function listNoteTypes(): readonly NoteType[] {
  return BUILT_IN_TYPES;
}
