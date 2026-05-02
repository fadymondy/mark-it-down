# Pinned folders v2 — file clusters via drag-drop

Issue: [#189](https://github.com/fadymondy/mark-it-down/issues/189) — follow-up to [#187](https://github.com/fadymondy/mark-it-down/issues/187) (which introduced pinned folders as activity-bar clusters) and PR #227 (the v1 drag groundwork).

## What v2 adds

v1 (#227) wired up the plumbing — `PinnedFolder.files: string[]`, the
`application/x-mid-file` mime carried by file-tree drags, and a drop handler on
each pinned activity icon. But the user-visible behavior was incomplete:

1. The drop highlight was identical for "drop file here" and "reorder pin", so
   users couldn't tell which gesture they were making.
2. When a pin had assigned files, the sidebar showed *only* those files and
   hid the folder subtree — there was no way to see both at once or drag
   another file in from the same folder while in cluster view.
3. The right-click menu on a clustered file said "Remove from cluster" instead
   of the spec-mandated "Remove from pin".

v2 closes those gaps. No schema migration: the `files_json` column on
`pinned_folders` (added in v1) already stores the array. Persistence still
flows through `mid:patch-app-state` → `replacePinnedFolders` in
[`apps/electron/db.ts`](../apps/electron/db.ts).

## How it works

### Drag a file from the tree onto a pinned activity icon

1. The file-tree row is the drag source. Each file `<div class="mid-tree-item">`
   sets `dataTransfer.setData('application/x-mid-file', entry.path)` in its
   `dragstart` handler ([`renderer.ts` `renderTreeEntry`](../apps/electron/renderer/renderer.ts)).
2. The pinned activity-bar buttons are drop targets. On `dragenter`/`dragover`
   the handler peeks at `dataTransfer.types` (because `getData()` returns `""`
   during drag-over for security reasons) and toggles one of two CSS classes:
   - `.is-file-drop-target` — dashed accent ring + 18% accent tint, set when
     the drag carries `application/x-mid-file`.
   - `.is-drop-target` — solid accent fill (the v1 behavior), set when the
     drag carries `application/x-mid-pin` (pin reorder).
   The handler also flips `dataTransfer.dropEffect` to `'link'` for files and
   `'move'` for reorder so the system cursor matches the gesture.
3. On `drop`, if `application/x-mid-file` is present we append the path to
   `pin.files` (deduped via `Set`), persist with
   `window.mid.patchAppState({ pinnedFolders })`, flash a toast, and
   re-render the cluster sidebar if it's currently open. If the file was
   already in the cluster the toast says so and the array is left alone.
4. If only `application/x-mid-pin` is present we fall through to the v1
   reorder path.

### Hybrid sidebar display

`loadPinnedTree(folderPath)` now renders **two sections** when a pin has
assigned files:

```
┌─ Pinned files (3) ────────┐
│  notes.md                 │  ← cluster section, files can live anywhere
│  /elsewhere/scratch.md    │
│  draft.md                 │
├─ Folder contents ─────────┤
│  ▶ src/                   │  ← regular folder subtree, unchanged from v1
│    foo.md                 │
│    bar.md                 │
└───────────────────────────┘
```

If `pin.files` is empty the section header disappears and the sidebar reverts
to the v1 folder-only listing. If both the cluster and the folder subtree are
empty we still show the "No markdown files in this folder." empty state from
v1.

Cluster file rows reuse the standard `.mid-tree-item` look with one extra
class (`.mid-tree-item--cluster`) that hides the leading chevron so file names
align with chevron-padded folder rows below.

### Right-click on a cluster file row

Three actions, in order:

- **Open** — same as a click.
- **Reveal in Finder** — opens the parent directory.
- **Remove from pin** — strips the file path from `pin.files`, persists, and
  re-renders. The pin itself is untouched.

## Where the code lives

| Concern | File | Notes |
| --- | --- | --- |
| Drag source on file rows | `apps/electron/renderer/renderer.ts` `renderTreeEntry` | `application/x-mid-file` (unchanged from v1) |
| Drop target on activity-bar pins | `apps/electron/renderer/renderer.ts` `renderActivityPinned` | `dragenter`/`dragover`/`dragleave`/`drop` |
| Cluster sidebar render | `apps/electron/renderer/renderer.ts` `loadPinnedTree` + `renderClusterFileRow` |  |
| Drop-target visuals | `apps/electron/renderer/renderer.css` `.mid-activity-btn.is-drop-target` / `.is-file-drop-target` |  |
| Cluster section visuals | `apps/electron/renderer/renderer.css` `.mid-tree-section` / `.mid-tree-section-header` / `.mid-tree-item--cluster` |  |
| Persistence | `apps/electron/db.ts` `replacePinnedFolders` (writes `files_json`); `apps/electron/main.ts` `writeAppState` / `readAppState` | unchanged from v1 |

## Manual smoke test

1. Open a workspace folder with a few `.md` files.
2. Right-click a folder in the tree and pick **Pin to sidebar…**, accept
   defaults. The pin appears in the activity bar.
3. Drag a `.md` file from the file tree over the new pin icon. The icon
   should show a **dashed accent ring** (file-drop), not the solid fill.
4. Drop. A toast confirms the assignment.
5. Click the pin in the activity bar. The sidebar should show a
   **Pinned files (1)** section above a **Folder contents** section.
6. Drag a different pin's icon over another pin. The hovered pin should show
   the **solid accent fill** (reorder), not the dashed ring.
7. Right-click a clustered file row → **Remove from pin**. Section count
   updates. If it was the last file, the section disappears.
8. Quit the app, reopen, click the pin — the assigned files are still there
   (persisted in `mid.sqlite` `pinned_folders.files_json`).
