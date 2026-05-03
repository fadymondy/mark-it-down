# Desktop tabs

VSCode-style multi-file tab manager for the Electron app (#287, #308, #309).

## What ships in v0.2.5 (MVP, #287)

- Tab strip above the editor when at least one file is open
- Click any file in the tree → opens in the active strip
- Clicking a file that is already open focuses its existing tab (no duplicate)
- Per-tab close button + middle-click + `Cmd/Ctrl+W`
- `Cmd/Ctrl+Shift+T` reopens the most-recently-closed tab (LIFO depth 20)
- `Cmd/Ctrl+Alt+ArrowLeft` / `ArrowRight` cycles tabs, with wrap-around
- `Cmd/Ctrl+PageUp` / `PageDown` is the trackpad-friendly alias
- Drag a tab inside the strip to reorder
- Right-click a tab for **Close**, **Close others**, **Close all**, **Reveal in Finder**
- The unsaved-changes bullet (`•`) appears next to the filename label
- Tabs persist across restart via the SQLite `open_tabs` table — including which
  tab was active

## Window detach (#308)

- **Drag a tab outside the window's bounds** → main spawns a fresh
  `BrowserWindow` with that one file pre-loaded as its only tab.
- The origin window's tab is closed automatically (without pushing onto the
  recently-closed stack — the file moved, it didn't close).
- Each window has its own `open_tabs` slot in SQLite, so detached windows
  persist independently. On next launch the app re-spawns one BrowserWindow
  per persisted slot and each one rehydrates its own strip.
- A dashed accent border lights up around the content area while the
  cursor sits outside the window — visual cue that releasing here will
  pop a new window.
- Closing a detached window drops only that window's persisted rows (the
  main window's slot is never cleared by close, so a normal quit + relaunch
  rebuilds the main strip).
- macOS still skips `app.quit()` when the last window closes — closing the
  detached window doesn't take the origin down.

## Split-screen (#309)

- **Drag a tab onto the left or right ~80px of the editor pane** to split the
  editor into two columns. A vertical highlight bar (the drop indicator)
  follows the cursor while the drag is in flight so the drop target is obvious.
- Each column has its own independent tab strip + active tab + active editor
  pointer. The active column hosts the live editor (`#root`); the inactive
  column shows a static markdown preview of its own active tab so both files
  are visible at a glance.
- Click anywhere inside a column (or on one of its tabs) to make it the active
  column — the live editor swaps over and any new tree-opens land there.
- Drag a tab between columns (drop on the other strip) to rehome it.
- Drag the divider between columns to resize. The ratio is clamped to
  `[0.15, 0.85]` and persisted as `tabSplitRatio` in app state so it survives
  a restart.
- Closing the last tab in a column collapses the split back to a single
  column — surviving tabs are rehomed into strip 0 and the second column DOM
  is torn down.
- Both columns persist across restart with their own tab list + active tab via
  the existing `(strip_id, idx, path, active)` schema. The persisted
  `tabActiveStripId` setting remembers which column was last live.

## Out of scope (deferred follow-ups)

- **Re-attach** — drag a tab from a detached window back into the main
  window's strip to merge it back. Electron doesn't ship cross-window drag
  out of the box, so this would need a custom `screen.getCursorScreenPoint()`
  poll on `dragend` to find the destination window.
- **Three-or-more columns** — the schema is `strip_id` (any int) but the
  renderer is hard-coded for 0 | 1. Adding a third column is straightforward
  but ergonomically debatable on a laptop screen, so it's parked.
- **Dual live editors** — only the active column has a live `<textarea>`. The
  inactive column is a read-only preview to avoid duplicating the renderer's
  ~70 references to `currentText`/`currentPath` and the singletons (mermaid
  context, outline observer, etc.). Promotion via click is fast enough that
  the UX feels equivalent.

## Layout model

```
┌──────────────────────────── Window ────────────────────────────┐
│  Titlebar                                                      │
├────────┬────────────┬─────────────────────────────────────────┤
│        │            │  ┌─ Tab strip (.mid-tabstrip) ────────┐ │
│ Activ. │  Sidebar   │  │ [README.md ×] [notes.md ×]         │ │
│  bar   │            │  └────────────────────────────────────┘ │
│        │            │  ┌─ Editor area (#root) ──────────────┐ │
│        │            │  │   markdown view / edit / split     │ │
│        │            │  │                                    │ │
│        │            │  └────────────────────────────────────┘ │
└────────┴────────────┴─────────────────────────────────────────┘
```

The tabstrip lives inside a new `.mid-editor-area` flex column wrapper that
holds the strip on top and `<main id="root">` underneath. The strip is
`hidden` whenever the tab array is empty so the welcome state stays calm.

## In-memory model

```ts
interface FileTab {
  stripId: number;        // 0 left, 1 right.
  path: string;           // absolute file path on disk
  text: string;           // current buffer (may differ from disk if dirty)
  dirty: boolean;         // unsaved changes since last load/save
  scrollTop: number;      // last known scroller position; restored on focus
}

const tabs: FileTab[];                    // all tabs, both strips
let activeTabIndex: number;               // global idx into tabs[] of the active-strip's focused tab
let inactiveActiveTabIndex: number;       // global idx of the OTHER strip's focused tab, -1 when split off
let activeStripId: 0 | 1;                 // which strip is "live"
let splitActive: boolean;                 // true when the editor area is two columns
let tabSplitRatio: number;                // 0.15-0.85 — left column's grid share
```

The renderer keeps a single flat `tabs[]` array with `stripId` as the bucket
key rather than two nested arrays. That keeps cross-strip moves cheap (just
flip `stripId`) and keeps the persist layer's `(strip_id, idx)` rows simple.
Within each strip, "idx" is recomputed at persist time as a strip-local
ordinal — the global order in `tabs[]` doesn't influence the wire format.

When `splitActive` is `false`, only `activeTabIndex` is meaningful.
`activeStripId` is always 0 in single-column mode.

When `splitActive` is `true`:

- The active strip's tabs render into `#tabstrip` (inside `#editor-area`).
- The inactive strip's tabs render into `#tabstrip-2` (inside the sibling
  column under `.mid-split-root`).
- The DOM identity of `#editor-area` always tracks the live editor —
  `swapActiveColumn` flips `activeStripId` and the per-strip pointers but does
  NOT move DOM nodes; both `renderTabstrip()` and `renderInactiveColumn()`
  re-paint the tabs into their respective strip elements with their swapped
  roles.

### Mirror state

The renderer historically read `currentText` and `currentPath` as globals.
Rather than sweep ~70 references across `renderer.ts`, the tab manager mirrors
the active tab's `text`/`path` into those globals on every focus/close/swap:

- `syncMirrorFromActiveTab()` — pulls active tab → globals
- `syncActiveTabFromMirror()` — pushes globals → active tab (called before swaps
  so unsaved edits survive a focus change)

Existing render code (`renderView`, `renderEdit`, `renderSplit`,
`saveFile`, exports, spotlight, etc.) keeps reading/writing `currentText` and
`currentPath` unchanged.

## Persistence (SQLite)

```sql
CREATE TABLE open_tabs (
  window_id INTEGER NOT NULL DEFAULT 0,  -- #308 — main = 0, detached = 1+
  strip_id  INTEGER NOT NULL,            -- 0 left column, 1 right column (#309)
  idx       INTEGER NOT NULL,            -- ordering inside the strip
  path      TEXT    NOT NULL,
  active    INTEGER NOT NULL DEFAULT 0,  -- 1 for the focused tab in its strip
  PRIMARY KEY (window_id, strip_id, idx)
);
CREATE INDEX idx_open_tabs_window ON open_tabs(window_id, strip_id, idx);
```

The renderer is the source of truth: every meaningful mutation
(open/close/move/cycle/split/swap) calls `schedulePersistTabs()`, which
debounces a 200ms snapshot and writes the entire set via `mid:tabs-replace`.
We wipe-and-replace *for that window only* because the row count is small
(typically <30 per window) and the transaction keeps the swap atomic.

The `window_id` scope is derived from the IPC sender on the main side, not
trusted from the renderer payload. That keeps a misbehaving renderer from
trampling another window's persisted rows.

The main window always claims slot 0 (its rows pre-date the multi-window era
and the column was added with a `DEFAULT 0` migration so existing installs
just work). Detached windows allocate the smallest free slot ≥ 1; closing
one releases its rows so the slot can be reused.

The `active` column is set per strip — both the active and inactive strips
remember which of their tabs is focused, so a column swap or restart restores
each side's last selection independently.

On startup the renderer calls `mid:tabs-list`, reads each file from disk, and
silently drops any path that no longer exists. If the loaded rows include
both `strip_id = 0` and `strip_id = 1` entries, `hydrateTabs` automatically
re-enables split mode and re-creates the column-2 DOM. The next persist tick
collapses the table back to the live set, so a deleted file naturally cleans
itself up.

### Companion settings (split-screen)

The split layout's view-state is stored alongside the tab table as JSON-blob
settings:

| Key                  | Type       | Notes                                       |
|----------------------|------------|---------------------------------------------|
| `tabSplitActive`     | `boolean`  | True when split mode is on (advisory; the table is the real source)|
| `tabSplitRatio`      | `number`   | Left column's grid share, clamped 0.15-0.85 |
| `tabActiveStripId`   | `0 \| 1`   | Which column was last "live" before the close|

These are best-effort: if the settings disagree with the `open_tabs` rows
(e.g. `tabSplitActive=true` but only strip 0 has rows), the rows win.

## IPC contract

| Channel              | Direction              | Payload / Result |
|----------------------|------------------------|------------------|
| `mid:tabs-list`      | renderer → main        | `() → OpenTabRow[]` (scoped to sender's window) |
| `mid:tabs-replace`   | renderer → main        | `(rows: OpenTabRow[]) → boolean` (replaces sender's window's rows only) |
| `mid:tabs-detach`    | renderer → main        | `({ path, bounds? }) → { ok, windowId?, error? }` (#308) |
| `mid:get-window-id`  | renderer → main        | `() → number` (sender's persistence slot id; #308) |

```ts
interface OpenTabRow {
  window_id: number;    // present on read; ignored on write (main derives from sender)
  strip_id: number;
  idx: number;
  path: string;
  active: number;       // 0 | 1
}
```

The main process is intentionally dumb — it owns the SQLite write, nothing
else. All ordering, dirty tracking, and active-tab arithmetic happens in the
renderer. The one exception is `mid:tabs-detach`: spawning a `BrowserWindow`
needs the main process, so the renderer asks main to do it.

## Window detach (#308)

### Renderer flow

A document-level `dragend` listener (added at the bottom of `renderer.ts` so it
doesn't conflict with the per-tab handlers in `renderTabstrip()`) watches every
drag started on a `.mid-tab`. The dragstart capture stashes the source tab's
`{ idx, path }` into module-scope state; the dragend handler:

1. Checks `pointIsOutsideWindow(clientX, clientY)` — true when the cursor sits
   outside `[0, innerWidth) x [0, innerHeight)` with a 4px slack, *or* when both
   coords are zero (browsers report `0/0` when the drop lands on the OS desktop).
2. Refuses to detach the only open tab (would just duplicate the source).
3. Calls `window.mid.tabsDetach({ path, bounds })`. The bounds carry
   `screenX/screenY` minus a small offset so the new window pops near the cursor.
4. On success, runs `closeTabForDetach(idx)` — the same close path as the
   normal close button but without pushing onto `recentlyClosedPaths` (the file
   moved windows; `Cmd+Shift+T` should not bring it back to the source).

While the cursor is outside the bounds, `.mid-detach-edge.is-active` paints a
dashed accent border over the entire content area as the drop affordance.

### Main-process flow

```ts
ipcMain.handle('mid:tabs-detach', async (_e, payload: { path: string; bounds? }) => {
  const win = await createWindow({
    detachedPath: payload.path,
    bounds: { width: 900, height: 700, x: payload.bounds?.x, y: payload.bounds?.y },
  });
  return { ok: true, windowId: win.id };
});
```

`createWindow()` was generalised: it takes an optional `detachedPath` and an
optional explicit `slotId`. When `detachedPath` is set, the path is encoded
into the file URL hash (`#detachedPath=...`) — hash survives `loadFile`, isn't
part of the file:// path so CSP stays untouched, and the renderer reads it
from `window.location.hash` on boot. The first window claims slot 0 (main);
subsequent windows allocate the smallest free slot ≥ 1.

### New-window seeding

Right after `hydrateTabs()` finishes, the renderer calls
`maybeSeedFromDetachHash()` which:

1. Reads `window.location.hash` for `detachedPath`.
2. Clears the hash with `history.replaceState` so a renderer reload doesn't
   re-seed a duplicate tab on top of the now-persisted strip.
3. Bails if the persisted strip already hydrated rows (re-spawned detached
   windows on app launch take that path; the saved layout wins).
4. Otherwise reads the file and calls `loadFileContent(path, content)` — which
   pushes through `openTab` and `schedulePersistTabs` so the new slot is
   populated on disk within the next 200ms tick.

### Multi-window lifecycle

- **Launch**: main spawns the main window (slot 0), then walks
  `listOpenTabWindowIds()` and re-spawns one BrowserWindow per non-zero slot.
  Each re-spawn skips the `detachedPath` argument so the renderer hydrates
  from SQLite directly.
- **Theme + update broadcasts**: previously sent only to `mainWindow`; now
  iterate `BrowserWindow.getAllWindows()` so detached windows stay in sync.
- **Close**: closing a detached window calls `clearOpenTabsForWindow(slotId)`
  so its rows are dropped (the user explicitly closed the window; we don't
  haunt them with stale rows on next launch). Closing the main window does
  NOT clear slot 0 — its rows survive a quit + relaunch as before.
- **macOS quit semantics**: unchanged — `app.on('window-all-closed')` still
  short-circuits on darwin.

### Stretch: re-attach (not implemented)

Dragging a tab from a detached window back into the main window's strip would
need a cross-window drag protocol. Electron doesn't expose one out of the box;
the rough plan is to poll `screen.getCursorScreenPoint()` on `dragend` and
match it against `BrowserWindow.getBounds()` to find the destination, then
emit a custom IPC `mid:tabs-attach` to that window's renderer. Filed for a
later iteration when the demand is real.

## Split-screen mechanics (#309)

### Drag detection

A document-level `dragover` listener inspects the cursor position whenever
data of MIME type `application/x-mid-tab` is being dragged. If the cursor sits
within `SPLIT_EDGE_THRESHOLD_PX` (80) of any editor column's left or right
edge, a fixed-positioned `<div class="mid-split-drop-indicator">` is shown
along that edge. The strip's per-tab `dragover` handler calls
`stopPropagation` to silence the global listener while hovering over a tab
(otherwise both an intra-strip reorder indicator and the edge indicator would
fight to render).

### Drop routing

The same listener handles `drop`. The code path forks on `splitActive`:

- **Single-column mode**: any edge drop calls `enableSplit(globalFromIdx)`,
  which (a) builds the second column DOM via `enableSplitDOM()`, (b) reassigns
  the dragged tab's `stripId` to `1`, and (c) flips `inactiveActiveTabIndex`
  to point at the moved tab. The source strip's `activeTabIndex` snaps back
  to `lastIndexInStrip(activeStripId)` so the live editor still has a focused
  tab.
- **Split mode**: edge drop calls `moveTabToStrip(globalFromIdx, _, targetStripId)`
  where the target strip is derived from which physical column was hovered
  (`#editor-area` always hosts the active strip; the sibling column hosts the
  inactive strip). If the move empties the source strip, `collapseSplitAfterClose`
  rehomes everything back into strip 0 and tears down the second column.

### Layout DOM

```
.mid-split-root           (display: grid; grid-template-columns: <ratio>% 6px 1fr)
├─ #editor-area           (the live column — moved here from <body>'s layout grid)
│   ├─ #tabstrip           ← active strip's tabs
│   └─ <main id="root">    ← live <textarea> / preview / mermaid view
├─ .mid-split-divider     (col-resize cursor; drag updates tabSplitRatio)
└─ .mid-editor-column     (the read-only column)
    ├─ #tabstrip-2         ← inactive strip's tabs
    └─ #root-2             ← static markdown preview (.mid-inactive-preview)
```

`#editor-area` is *moved* (not cloned) into the wrapper. `enableSplitDOM`
stashes its original parent + nextSibling so `disableSplitDOM` can put it
back. That keeps every existing `getElementById('root')` /
`getElementById('tabstrip')` reference happy with zero churn.

### Promotion (clicking inside an inactive column)

A document-level `click` listener checks `target.closest('.mid-editor-column')`.
If the closest column is NOT `#editor-area` (i.e. the user clicked the
inactive sibling), it calls `swapActiveColumn()`. Tab buttons handle their own
swap inside their per-tab click listener so the swap+focus combo lands as a
single render. The divider and tab-close buttons short-circuit the listener
to avoid spurious swaps.

### Edge cases handled

- Closing the last tab in either column collapses the split.
- Dropping the only tab of a strip onto its own edge is a no-op
  (`enableSplit` early-returns when `sourceStripCount <= 1`).
- The recently-closed stack is global — `Cmd+Shift+T` after closing a
  strip-1 tab resurrects it into the currently active strip, which is the
  intended VSCode parity (re-attach behaviour is a future enhancement).
- Persistence captures both strips simultaneously; resyncing on hydrate
  refuses to enable split if only one strip has rows (graceful downgrade).
