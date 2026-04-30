# Desktop workspace — folder mode + file tree sidebar

The desktop app supports a **folder workspace** in addition to the single-file flow. Open a folder once and every `.md` / `.mdx` / `.markdown` file inside is browsable in the sidebar; the choice is persisted across launches so the workspace reopens automatically next time.

## Opening a folder

- **Menu**: File → Open Folder…
- **Shortcut**: `Cmd/Ctrl+Shift+O`
- **Toolbar**: 📁 Folder

Single-file open (`Cmd/Ctrl+O`) still works and is independent — it doesn't change the active folder.

## What the sidebar shows

- A recursive tree of markdown files. Folders that contain no markdown (anywhere in their subtree) are hidden so you don't drown in `node_modules` clones.
- Hidden folders (anything starting with `.`) are skipped, with one exception: `.github` is included for repo workspaces.
- Standard build / dependency directories are pruned: `node_modules`, `.git`, `.next`, `dist`, `out`, `.cache`.
- Files are sorted alphabetically; folders sort before files at every level.
- Click a folder row to expand / collapse; click a file row to load it into the main view.
- The **↻ Refresh** button in the sidebar header re-reads the folder tree (use it after creating/renaming files outside the app).

## Persistence

The last opened folder is written to `state.json` in the OS user-data dir:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/Mark It Down/state.json` |
| Windows | `%APPDATA%/Mark It Down/state.json` |
| Linux | `~/.config/Mark It Down/state.json` |

On launch, the renderer calls `mid:read-app-state` and re-lists the folder tree. If the folder no longer exists, the workspace silently falls back to single-file mode.

## IPC surface (preload)

| Channel | Signature | Notes |
| --- | --- | --- |
| `mid:open-folder-dialog` | `() → { folderPath, tree } \| null` | Shows OS folder picker, persists `lastFolder`, returns initial tree. |
| `mid:list-folder-md` | `(folderPath) → TreeEntry[]` | Re-list a folder without showing a dialog (used by Refresh and on relaunch). |
| `mid:read-app-state` | `() → AppState` | Returns `{ lastFolder? }`. |

`TreeEntry` shape: `{ name, path, kind: 'file' | 'dir', children?: TreeEntry[] }`.

## Verifying

1. `npm run dev:electron`, then File → Open Folder… → pick this repo.
2. Sidebar lists `docs/`, `README.md`, `CHANGELOG.md`, etc. Click `docs/ui-tokens.md` — preview loads.
3. Quit and relaunch. The sidebar reopens with the same folder selected.
