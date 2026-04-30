# Desktop status bar

A 24 px strip at the bottom of the window with the always-on document state. Single source of truth for things that the title bar shouldn't have to carry.

## Cells

| Cell | Content | Interaction |
| --- | --- | --- |
| **Repo** (left) | GitHub icon + `<owner/name> · <branch> ↑↓±` (or "No repo" / "No remote") | Click → connect or sync; right-click → context menu |
| **Cursor** (right cluster) | `L<n>:C<n>` while focus is in the editor | Read-only |
| **Words** | Live word count of the current buffer | Read-only |
| **Save state** | `●` green = clean, amber = unsaved | Hover for tooltip |

The mode toggle (View / Split / Edit) **stays in the title bar** as the segmented pill from #115 — keeping it close to the filename made it the more reachable affordance, and a status bar duplicate would create two truths.

## Behavior

- **Word count** updates on every editor `input` event (split + edit modes).
- **Cursor** appears only while a textarea has focus; hidden on view mode and on blur.
- **Save state** flips to `is-dirty` (amber) on first edit; back to clean on save.
- **Repo** click is contextual:
  - When unconnected → opens the connect modal.
  - When connected → triggers sync (commit + pull-rebase + push).
- **Repo** right-click reveals the full menu: Sync / Connect to a different repo.

## Why a status bar at the bottom

Modern markdown apps split running state into two zones: a tight title bar at the top (file + mode) and an unobtrusive status bar at the bottom (instrumentation). It keeps the chrome out of the reading column and gives the user a single place to glance at "what's happening?" — including dirty state, which used to live nowhere visible.

## Files

- `apps/electron/renderer/index.html` — `<footer class="mid-statusbar">` shell. Sidebar repo bar removed.
- `apps/electron/renderer/renderer.ts` — `refreshRepoStatus` (rewritten for the new DOM), `updateWordCount`, `updateSaveIndicator`, `updateCursor`, `hideCursor`. Wired into `loadFileContent`, `saveFile`, `setMode`, and the textarea input/keyup/click/focus/blur events.
- `apps/electron/renderer/renderer.css` — `.mid-statusbar`, `.mid-status-cell*`, `.mid-status-dot`, `.mid-status-spacer`. Body grid changed from 2 rows → 3 rows.

## Verifying

1. Launch — status bar shows "No repo · 0 words · ● (saved)".
2. Open a folder of a connected repo — repo cell shows `<owner/name> · main`.
3. Open a file → words count updates; save dot stays green.
4. Switch to Edit / Split mode — cursor cell appears, tracks line/column as you type.
5. Edit a character — save dot flips amber.
6. `Cmd+S` — save dot flips back to green; word count re-flashes if changed.
7. Click the repo cell when connected — runs sync; status updates with new ahead/behind/dirty.
8. Right-click the repo cell — menu offers Sync / Connect to a different repo.
