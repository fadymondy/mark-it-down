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
 *
 * #297 — User-defined custom types now persist into a `note_types` SQLite table
 * via main-process IPC (`mid:note-types-list`). The renderer hydrates the
 * registry at startup; until that resolves the built-ins serve as a safe
 * default so first-paint doesn't depend on the IPC round-trip.
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
  viewKind?: 'markdown' | 'secret' | 'task-list' | 'meeting' | string;
  /** Short descriptor shown in the type chooser modal. */
  description?: string;
  /** True when the type is shipped with the app (#297). User types are false. */
  builtin?: boolean;
}

/**
 * Built-in types. Order is stable — the filter strip and type-chooser modal
 * render in this order. `'note'` MUST stay first; it's the default for legacy
 * notes that were created before #255 landed.
 *
 * #295 / #296 — `task-list` and `meeting` now point at dedicated viewKinds
 * with custom editors (checklist + structured meeting form respectively).
 */
export const BUILT_IN_TYPES: readonly NoteType[] = [
  {
    id: 'note',
    label: 'Note',
    icon: 'bookmark',
    color: '#6e7681',
    description: 'Plain markdown — the default.',
    builtin: true,
  },
  {
    id: 'secret',
    label: 'Secret',
    icon: 'lock',
    color: '#bf8700',
    viewKind: 'secret',
    description: 'Key/value secrets editor with reveal + copy.',
    builtin: true,
  },
  {
    id: 'task-list',
    label: 'Task list',
    icon: 'check-square',
    color: '#1a7f37',
    viewKind: 'task-list',
    description: 'Checklist of todos persisted as `- [ ]` markdown.',
    builtin: true,
  },
  {
    id: 'meeting',
    label: 'Meeting',
    icon: 'calendar',
    color: '#0969da',
    viewKind: 'meeting',
    description: 'Structured meeting form with attendees + decisions.',
    builtin: true,
  },
  {
    id: 'reference',
    label: 'Reference',
    icon: 'book',
    color: '#8250df',
    description: 'Long-lived reference doc.',
    builtin: true,
  },
  {
    id: 'snippet',
    label: 'Snippet',
    icon: 'code',
    color: '#cf222e',
    description: 'Code or shell snippet.',
    builtin: true,
  },
] as const;

/** Default type id assigned when a note doesn't specify one. */
export const DEFAULT_TYPE_ID = 'note';

/**
 * Mutable runtime registry. Starts as the built-ins and is overwritten by
 * `setRegistry()` once main → renderer hydration completes. We keep a separate
 * `BY_ID` map for O(1) lookups and rebuild it on every `setRegistry` call.
 */
let RUNTIME_TYPES: NoteType[] = BUILT_IN_TYPES.map(t => ({ ...t }));
let BY_ID: Map<string, NoteType> = new Map(RUNTIME_TYPES.map(t => [t.id, t]));

/**
 * Replace the live registry with `next`. The renderer calls this after
 * fetching the merged built-in + user list from main; main can also use it on
 * its own side after seeding the SQLite table so `getNoteType` lookups during
 * note creation honour user-defined types too.
 *
 * Order is preserved verbatim — callers decide the strip / chooser sort.
 */
export function setRegistry(next: readonly NoteType[]): void {
  // Always normalize the `note` default to position 0 so `DEFAULT_TYPE_ID`
  // stays the visual default. If callers omit `note`, prepend the built-in.
  const seen = new Set<string>();
  const ordered: NoteType[] = [];
  const noteEntry = next.find(t => t.id === DEFAULT_TYPE_ID) ?? BUILT_IN_TYPES[0];
  ordered.push({ ...noteEntry });
  seen.add(DEFAULT_TYPE_ID);
  for (const t of next) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    ordered.push({ ...t });
  }
  RUNTIME_TYPES = ordered;
  BY_ID = new Map(RUNTIME_TYPES.map(t => [t.id, t]));
}

/** Look up a type by id, falling back to the default `note` type so the UI
 * never crashes on an unknown id (e.g. when a user hand-edits notes.json). */
export function getNoteType(id: string | undefined): NoteType {
  if (!id) return BY_ID.get(DEFAULT_TYPE_ID)!;
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_TYPE_ID)!;
}

/** Returns the registered ids in display order. */
export function listNoteTypeIds(): string[] {
  return RUNTIME_TYPES.map(t => t.id);
}

/** All registered types in display order. */
export function listNoteTypes(): readonly NoteType[] {
  return RUNTIME_TYPES;
}

/** True when the id is shipped with the app (immutable in settings UI). */
export function isBuiltinTypeId(id: string): boolean {
  return BUILT_IN_TYPES.some(t => t.id === id);
}
