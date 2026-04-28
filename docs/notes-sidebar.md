# Notes Sidebar

Status: shipped in Phase 0.7 · Issue: [#7](https://github.com/fadymondy/mark-it-down/issues/7)

The Notes sidebar is a dedicated VSCode activity-bar surface for capturing, organizing, and editing personal notes — without leaving the editor and without polluting the workspace file tree. Notes are real markdown files, opened through the same Mark It Down custom editor used for any `.md` file in the workspace, so everything you can do in the viewer (live mermaid, code-block copy, tables) works on notes too.

## At a glance

| | |
|---|---|
| **Where** | Activity bar (left rail) → "Mark It Down" icon → Notes view |
| **Storage backend** | VSCode `workspaceState` + `globalState` (metadata) and `storageUri` / `globalStorageUri` (markdown content) |
| **Editor surface** | The existing Mark It Down custom editor — no second editor, no extra parser |
| **Two scopes** | **Workspace** (visible only in this folder) and **Global** (everywhere) |
| **Categories** | User-configurable; defaults to `Daily / Reference / Snippet / Drafts` |
| **Per-machine?** | Workspace notes are folder-scoped. Global notes are user-scoped (per VSCode profile). Cross-machine sync arrives in F9 (warehouse repo) |

## Tree shape

```
Mark It Down (activity bar)
└── Notes (view)
    ├── 📁 Workspace            ← only when a folder is open
    │   ├── 📂 Daily
    │   │   ├── 📝 Sprint 12 notes      14:32
    │   │   └── 📝 Standup recap        Apr 24
    │   ├── 📂 Reference
    │   ├── 📂 Snippet
    │   └── 📂 Drafts
    └── 📁 Global
        ├── 📂 Daily
        ├── 📂 Reference
        │   └── 📝 Postgres tuning       Apr 20
        ├── 📂 Snippet
        └── 📂 Drafts
```

- Notes inside a category are sorted **most-recent-first** by `updatedAt`.
- A category appears in the tree if it is either **listed in `markItDown.notes.categories`** or **has at least one note in it**. So if you remove a category from settings but still have notes filed under it, the tree continues to surface them (under the original name) so nothing is hidden.

## Two storage scopes

### Workspace

- Metadata key: `markItDown.notes.index` in `context.workspaceState`
- Content files: `${context.storageUri}/notes/<id>.md`
- Visible only in the VSCode workspace where the notes were created.
- Use this for project-bound notes: sprint logs, code-review checklists, design-doc drafts that live with the codebase but aren't part of the codebase.
- **Unavailable when no folder is open** — VSCode does not provide `storageUri` for a folder-less window. The tree quietly drops the Workspace root in that case.

### Global

- Metadata key: `markItDown.notes.index` in `context.globalState`
- Content files: `${context.globalStorageUri}/notes/<id>.md`
- Visible across every VSCode workspace on the same machine, scoped to the active VSCode profile.
- Use this for personal stuff: daily journal, recipes, reference snippets that follow you between projects.

If you're unsure which scope to pick, the new-note flow's Quick Pick previews both with a description.

## Commands

All commands are prefixed `Mark It Down:` in the command palette.

| Command ID | Title | Where it shows |
|---|---|---|
| `markItDown.notes.create` | New Note | View title bar (`+`) · scope/category context menus (inline `+`) · command palette |
| `markItDown.notes.open` | Open Note | Command palette (Quick Pick of all notes) · invoked when clicking a tree leaf |
| `markItDown.notes.rename` | Rename Note | Note context menu (inline pencil) |
| `markItDown.notes.move` | Move to Category… | Note context menu |
| `markItDown.notes.delete` | Delete Note | Note context menu (inline trash) |
| `markItDown.notes.refresh` | Refresh | View title bar (`↻`) |
| `markItDown.notes.revealStorage` | Reveal Notes Folder | View title bar overflow menu |

The destructive context-menu commands (`rename`, `move`, `delete`) are **hidden from the command palette** so you cannot fire them without a target — see `package.json#contributes.menus.commandPalette`.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `markItDown.notes.categories` | `["Daily", "Reference", "Snippet", "Drafts"]` | List of categories shown in the tree and offered when creating/moving a note. Empty entries are ignored. Categories used by existing notes still appear even if removed from this list. |
| `markItDown.notes.defaultCategory` | `"Drafts"` | Pre-selected entry in the category Quick Pick when creating a note. If the value isn't in `categories`, the first listed category wins. |
| `markItDown.notes.defaultScope` | `"workspace"` | `"workspace"` or `"global"`. Pre-selects the scope on new-note Quick Pick. Falls back to `"global"` automatically when no folder is open. |

Edit via `Cmd+,` → search "Mark It Down: Notes" or directly in `settings.json`:

```json
{
  "markItDown.notes.categories": ["Inbox", "TODO", "Reference", "Archive"],
  "markItDown.notes.defaultCategory": "Inbox",
  "markItDown.notes.defaultScope": "global"
}
```

## Workflows

### Creating a note

1. Open the Notes sidebar.
2. Click `+` in the view title bar (or right-click a scope/category row → New Note).
3. **Scope** — Workspace or Global. Skipped if you launched from a scope/category row that already pinned one.
4. **Category** — pick from the configured list, or `+ New category…` to type one inline.
5. **Title** — required, free text.
6. The note opens immediately in the Mark It Down custom editor with a `# Title` heading pre-populated. Save (`Cmd+S`) any time; the tree updates with a fresh `updatedAt`.

### Renaming a note

Right-click a note → **Rename Note**. The new title is reflected in the tree. The underlying file's `<id>.md` filename is **not** changed — the note's stable identifier is its random `id`, and the title is purely metadata. This avoids breaking external references (used later by F8 MCP and F9 warehouse).

### Moving a note between categories

Right-click a note → **Move to Category…**. Pick the destination from the category Quick Pick (same picker as create — supports `+ New category…`). The file stays put on disk; only the metadata `category` field changes.

### Deleting a note

Right-click a note → **Delete Note** → confirm in the modal. The metadata entry is removed and the file is unlinked from `<storage>/notes/<id>.md`. **There is no soft-delete or trash** in v0.7 — once confirmed, the note is gone.

### Inspecting on disk

Right-click empty space in the Notes view → **Reveal Notes Folder** (or run from the title-bar overflow). VSCode opens the Notes folder in your OS file manager. Useful for backups, manual edits, or wiring third-party tools.

## How the data is stored

**Metadata** (per scope) lives in VSCode's key/value state under `markItDown.notes.index`. Each entry is:

```ts
interface NoteMetadata {
  id: string;            // 12-char random alpha-num
  title: string;
  category: string;
  scope: 'workspace' | 'global';
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601
  filename: string;      // "<id>.md"
}
```

**Content** is a plain markdown file at `<storageRoot>/notes/<id>.md` where `<storageRoot>` is `context.storageUri` (workspace) or `context.globalStorageUri` (global). The file is created with `# <title>\n\n` as a starter; everything after that is normal markdown.

Why split metadata and content?

- **Renames are cheap** — just edit a string in the index, no file move.
- **Sorting and grouping** are O(N) over a small index, no per-file reads needed when the tree refreshes.
- **The custom editor stays unchanged** — it operates on a real `vscode.Uri`, exactly like any other `.md` in the workspace. No virtual-FS plumbing.
- **Future features (F8 MCP server, F9 warehouse, F13 Claude plugin)** can read the same `<id>.md` files and the same index without duplicating storage.

## Edge cases & behavior notes

- **No folder open** — Workspace storage is unavailable (VSCode quirk). The tree drops the Workspace root automatically; the new-note Quick Pick auto-selects Global with a status message.
- **Empty configured categories list** — falls back to the four defaults so you never see an empty tree.
- **Category not in settings but used by a note** — still rendered. Editing settings to remove a category does not orphan its notes.
- **Save bumps timestamp** — saving a note in the custom editor (`Cmd+S`) calls `NotesStore.touch(uri)`, which refreshes `updatedAt` and re-fires the tree-change emitter. The note jumps to the top of its category.
- **Content-only edits** outside the custom editor (e.g. opening the file directly with the default editor and saving) **do** update `updatedAt` — the save listener watches every `vscode.workspace.onDidSaveTextDocument`, not just custom-editor saves.
- **Crash safety** — both metadata and content are written through `vscode.workspace.fs` and the VSCode state APIs, which are atomic at the call boundary. There is no in-memory write-behind.
- **Concurrent windows** — two VSCode windows pointing at the same Global storage *will* race on metadata writes. The last writer wins. Multi-window safety is deferred to F9 (warehouse), where a real conflict policy lives.

## What it unblocks

| Feature | How it builds on F6 |
|---|---|
| [F8 — MCP server](https://github.com/fadymondy/mark-it-down/issues/9) | Exposes `list_notes / get_note / create_note / update_note / delete_note` over stdio. Reads the same `NotesStore` and the same `<id>.md` files. |
| [F9 — Notes warehouse repo](https://github.com/fadymondy/mark-it-down/issues/10) | Pushes the contents of `<storageRoot>/notes/` to a configured GitHub repo. Pull merges back into the same files. |
| [F13 — Claude Code plugin](https://github.com/fadymondy/mark-it-down/issues/14) | Bundles skills (`/mid:new-note`, `/mid:list-notes`, `/mid:open`) that wrap the same store via the F8 MCP server. |

## Files of interest

- [src/notes/notesStore.ts](../src/notes/notesStore.ts) — metadata index + file I/O
- [src/notes/notesTreeProvider.ts](../src/notes/notesTreeProvider.ts) — `TreeDataProvider` implementation
- [src/notes/notesCommands.ts](../src/notes/notesCommands.ts) — command registration + Quick Pick / Input Box flows
- [src/extension.ts](../src/extension.ts) — wiring on activation
- [media/notes-sidebar.svg](../media/notes-sidebar.svg) — 16x16 `currentColor` icon for the activity bar
- [package.json](../package.json) — `viewsContainers`, `views`, `viewsWelcome`, `commands`, `menus`, `configuration` contributions
