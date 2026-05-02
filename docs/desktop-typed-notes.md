# Typed notes

Notes in the desktop app carry a **type** drawn from a registry. The type drives:

1. The **icon + color chip** rendered in the notes list row.
2. The **filter strip** above the notes sidebar (one icon per registered type, click to filter, click again to clear).
3. The **editor view** opened when the user clicks the row — markdown by default, or a custom view registered for that type (e.g. the secret key/value editor).

This document covers the registry contract, the view kind plug-in points, and the steps to add a new type.

## The registry

`apps/electron/notes/note-types.ts` is the single source of truth. Each entry is a `NoteType`:

```ts
export interface NoteType {
  id: string;             // stable, persisted into notes.json
  label: string;          // human label for menus + chips
  icon: string;           // Boxicons name from packages/ui-tokens/src/icons.ts
  color: string;          // CSS hex; tints the chip + filter strip outline
  viewKind?: 'markdown' | 'secret' | string;
  description?: string;   // shown in the type chooser modal
}
```

Order in `BUILT_IN_TYPES` is stable — the filter strip and chooser modal render in declaration order. The first entry, `'note'`, is the default for legacy entries created before this feature shipped.

| id          | icon          | color   | viewKind   | purpose                                   |
| ----------- | ------------- | ------- | ---------- | ----------------------------------------- |
| `note`      | `bookmark`    | grey    | (markdown) | Plain markdown — the default              |
| `secret`    | `lock`        | amber   | `secret`   | Key/value secrets editor                  |
| `task-list` | `check-square`| green   | (markdown) | Checklist (markdown view in MVP)          |
| `meeting`   | `calendar`    | blue    | (markdown) | Date/attendees frontmatter (markdown)     |
| `reference` | `book`        | purple  | (markdown) | Long-lived reference doc                  |
| `snippet`   | `code`        | red     | (markdown) | Code or shell snippet                     |

## Storage shape

Each entry in `<workspace>/.mid/notes.json` gains a `type: string` field:

```json
{
  "id": "github-token",
  "title": "GitHub token",
  "path": "notes/github-token.md",
  "tags": [],
  "created": "2026-05-02T12:34:56.000Z",
  "updated": "2026-05-02T12:34:56.000Z",
  "type": "secret"
}
```

**Migration.** When `mid:notes-list` reads the file and finds entries lacking `type`, each is set to `'note'` (the default) and the file is rewritten in-place. The migration is idempotent and best-effort — if the workspace is read-only, the in-memory default still serves the renderer correctly until the next successful write.

## IPC surface

| Channel               | Signature                                                          | Notes                                                                           |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `mid:notes-create`    | `(workspace, title, type?) → { entry, fullPath }`                  | `type` defaults to `'note'`. Secret-typed notes get an empty `secrets:` block.  |
| `mid:notes-set-type`  | `(workspace, id, type) → NoteEntry \| null`                        | Unknown ids fall back to the default rather than rejecting.                     |
| `mid:notes-list`      | `(workspace) → NoteEntry[]`                                        | Triggers the legacy migration on first read.                                    |

The existing `mid:notes-tag`, `mid:notes-rename`, etc. handlers are unchanged.

## View kinds

`viewKind` is the indirection point that drives the renderer's editor swap. Defaults to `'markdown'` (i.e. the existing markdown editor / split / view modes). Anything else dispatches in `renderer.ts → openNote` to a custom renderer that owns the `#root` element.

Currently registered view kinds:

- **`markdown`** (default) — `renderView` / `renderEdit` / `renderSplit` from the existing flow.
- **`secret`** — `renderSecretEditor`. A key/value list backed by YAML frontmatter (`secrets: { key: value }`). Each row exposes a reveal toggle, copy-to-clipboard, and delete.

When a typed view is active:

- The mode segmented control (View / Split / Edit) is decoupled — typed views own the root and ignore mode toggles.
- `loadFileContent` (called when the user opens a file via the file tree, recents, etc.) clears the typed-view flag so the markdown editor comes back.
- `setMode` early-exits while a typed view is active to avoid clobbering the custom DOM.

## How to add a new type

1. **Append a NoteType entry** to `BUILT_IN_TYPES` in `apps/electron/notes/note-types.ts`. Pick an `icon` from `packages/ui-tokens/src/icons.ts` (or add a new one to the icon registry first) and a `color`. Leave `viewKind` unset to inherit the markdown editor.

2. **Decide on a view kind.** If the type is fine with markdown, you're done — the chip, filter, chooser, and right-click "Change type" all light up automatically.

3. **For a custom view**, set `viewKind: 'your-id'` and:
   a. Add a `renderXxxEditor(note, fullPath, content)` function in `renderer.ts` that mounts your DOM into `#root` and persists changes via `window.mid.writeFile(fullPath, ...)`.
   b. Wire the dispatch in `openNote()` — add a branch matching your `viewKind` that calls your renderer and sets `typedViewActive = true`.
   c. Add CSS under the "typed-view" comment block in `apps/electron/renderer/renderer.css`. Use `#root.typed-view` as a wrapping selector if you need root-level overrides.

4. **For type-specific seed content** (e.g. an empty frontmatter block), extend `notes-create` in `apps/electron/main.ts` — the `getNoteType(type)` lookup is already there; branch on `resolved.viewKind` to pick the seed string.

5. **Add docs.** Update the table above with the new type's row and view kind.

That's the whole contract. The registry is intentionally kept as a TS module rather than a JSON file or setting so:

- both main and renderer can `import` it without IPC,
- bundlers can tree-shake unused metadata,
- adding a new built-in type is a single PR (just append to `BUILT_IN_TYPES`).

User-defined custom types in settings are intentionally **out of scope** for the MVP cut — see the follow-up issue noted in the original feature ticket.

## Out of scope (MVP cut)

The following pieces from the original spec are deferred to follow-ups:

- `task-list` custom view — currently renders as plain markdown.
- `meeting` custom view — currently renders as plain markdown.
- User-defined custom types in settings.
