# Notes management

The desktop sidebar has two modes: **Files** (the filesystem tree from #77) and **Notes** (a curated registry of markdown notes you've created through the app). The mode toggle sits at the top of the sidebar.

## Notes registry

When the user creates a note from the app, an entry is recorded in `<workspaceFolder>/.mid/notes.json`:

```json
[
  {
    "id": "project-kickoff",
    "title": "Project kickoff",
    "path": "notes/project-kickoff.md",
    "tags": ["planning", "mvp"],
    "created": "2026-04-30T01:23:45.000Z",
    "updated": "2026-04-30T01:23:45.000Z"
  }
]
```

The registry lives **inside the workspace** so it travels with the project on disk, syncs along with the markdown files, and stays decoupled from the host machine's user-data dir.

## Capabilities (v1)

| Action | How |
| --- | --- |
| **Create** | `+` button or `Cmd/Ctrl+N` while a folder is open. Prompts for a title, slugifies it (`Project Kickoff` → `project-kickoff`), writes `notes/<slug>.md` with a `# Title` heading, registers the entry, opens it for editing. |
| **Open** | Click a row → loads the file into the active mode (Split / View / Edit). |
| **Delete** | Trash icon (revealed on hover) → confirm → registry entry removed and file `unlink`ed. |
| **Filter** | Free-text input filters the list against title + tags, case-insensitive substring. |
| **Sort** | Most recently updated first (auto). |

The list shows `title` + `updated` date + tag chips per row.

## IPC surface

| Channel | Signature |
| --- | --- |
| `mid:notes-list` | `(workspace) → NoteEntry[]` |
| `mid:notes-create` | `(workspace, title) → { entry, fullPath }` |
| `mid:notes-rename` | `(workspace, id, title) → NoteEntry \| null` |
| `mid:notes-delete` | `(workspace, id) → boolean` |
| `mid:notes-tag` | `(workspace, id, tags) → NoteEntry \| null` |

Slug collisions are auto-suffixed (`note-2`, `note-3`, …). Missing registry file is treated as empty list (first-time write creates `.mid/`).

## Out of scope (follow-up)

- **Tag editor UI** — the IPC + persistence are wired, but the renderer doesn't yet expose a way to edit tags interactively. Add when there's UX for it (e.g. inline chip editor on the active note).
- **Full-text content search** — current filter only checks title + tags. Wiring `packages/core/src/search/searcher.ts` would let it span note bodies.
- **Wikilink-aware rename** — renaming a note via the Notes panel doesn't currently rewrite `[[wikilink]]` references in other notes. The resolver in `packages/core/src/wikilinks/resolver.ts` could do this; tracked separately.

## Files

- `apps/electron/main.ts` — registry CRUD (`readNotes`, `writeNotes`, `slugify`, IPC handlers).
- `apps/electron/preload.ts` — bridges (`notesList` / `notesCreate` / `notesRename` / `notesDelete` / `notesTag`).
- `apps/electron/renderer/index.html` — Files/Notes toggle, notes header, notes list container.
- `apps/electron/renderer/renderer.ts` — `setSidebarMode`, `loadNotes`, `renderNotes`, `renderNoteRow`, `openNote`, `promptCreateNote`, `deleteNote`, `Cmd/Ctrl+N` accelerator.
- `apps/electron/renderer/renderer.css` — `.mid-sidebar-mode*`, `.mid-notes-list`, `.mid-note-row`, `.mid-note-tag`, `.mid-note-delete`.

## Verifying

1. `npm run dev:electron`, open this repo as a folder.
2. Click the **Notes** tab in the sidebar — empty state ("No notes yet…").
3. `Cmd+N` → enter "Test note" → a `notes/test-note.md` is created with a `# Test note` heading.
4. Type some content. Type "test" in the filter — the row stays. Type "xyz" — no matches.
5. Hover the row, click the trash icon → confirm → file is deleted from disk and registry.
6. Quit and relaunch — the registry persists if it had any rows when you closed.
