# Desktop tabs

VSCode-style multi-file tab manager for the Electron app (#287).

## What ships in v0.2.5 (MVP)

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

## Out of scope (deferred follow-ups)

- **Window detach** — drag a tab outside the window to spawn a new
  `BrowserWindow`. The IPC contract is sketched below; the wiring needs
  main-process work that wasn't worth bundling into the MVP.
- **Split-screen** — drop a tab onto the right edge of the strip to create a
  second column. The model already carries `stripId` so this is a renderer-only
  change once the drop-target UI lands.

Both follow-ups are filed as separate issues so the MVP ships green.

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
  stripId: number;        // 0 in the MVP. Future split: 0 left, 1 right.
  path: string;           // absolute file path on disk
  text: string;           // current buffer (may differ from disk if dirty)
  dirty: boolean;         // unsaved changes since last load/save
  scrollTop: number;      // last known scroller position; restored on focus
}

const tabs: FileTab[];
let activeTabIndex: number;
```

Strip 0 is the only strip in the MVP. The single strip persists into rows of
`open_tabs` keyed by `(strip_id, idx)`, so multi-strip is a renderer-only
expansion that doesn't break the wire format.

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
  strip_id INTEGER NOT NULL,   -- 0 in MVP; reserved for split (1, 2, …)
  idx      INTEGER NOT NULL,   -- ordering inside the strip
  path     TEXT    NOT NULL,
  active   INTEGER NOT NULL DEFAULT 0,  -- 1 for the focused tab in its strip
  PRIMARY KEY (strip_id, idx)
);
CREATE INDEX idx_open_tabs_strip ON open_tabs(strip_id, idx);
```

The renderer is the source of truth: every meaningful mutation
(open/close/move/cycle) calls `schedulePersistTabs()`, which debounces a 200ms
snapshot and writes the entire set via `mid:tabs-replace`. We wipe-and-replace
because the row count is small (typically <30) and the transaction keeps the
swap atomic.

On startup the renderer calls `mid:tabs-list`, reads each file from disk, and
silently drops any path that no longer exists. The next persist tick collapses
the table back to the live set, so a deleted file naturally cleans itself up.

## IPC contract

| Channel              | Direction              | Payload / Result |
|----------------------|------------------------|------------------|
| `mid:tabs-list`      | renderer → main        | `() → OpenTabRow[]` |
| `mid:tabs-replace`   | renderer → main        | `(rows: OpenTabRow[]) → boolean` |

```ts
interface OpenTabRow {
  strip_id: number;
  idx: number;
  path: string;
  active: number;       // 0 | 1
}
```

The main process is intentionally dumb — it owns the SQLite write, nothing
else. All ordering, dirty tracking, and active-tab arithmetic happens in the
renderer.

## Future: window detach (deferred)

When a tab is dragged outside the window bounds, the renderer should:

1. Detect the drag-end at a point outside `window.innerWidth/Height`
2. `await window.mid.tabsDetach({ path, scrollTop })`
3. Locally `closeTabAt(idx)` (without pushing onto the recently-closed stack)

The proposed main-side handler:

```ts
ipcMain.handle('mid:tabs-detach', async (_e, payload: { path: string; scrollTop: number }) => {
  const w = new BrowserWindow({
    width: 720, height: 600,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await w.loadFile(rendererIndexPath, { query: { detachedPath: payload.path } });
  // The renderer in the new window inspects `window.location.search` on boot
  // and opens that single file as its only tab.
  return { ok: true, windowId: w.id };
});
```

The detached window is a regular renderer instance with `tabs = [thatOne]`,
so the existing strip + view/edit/split code "just works." A future enhancement
re-attaches a tab if the user drags it back into the main window's strip — but
that requires a cross-window drag protocol which Electron doesn't ship out of
the box (we'd hand-roll it via `screen.getCursorScreenPoint()` polling on
`dragend`).

## Future: split-screen (deferred)

When a tab is dropped onto the right edge of the existing strip, the renderer
should:

1. Allocate `stripId = 1`
2. Move the dropped tab into strip 1 (re-index, mark active)
3. Re-render `.mid-editor-area` as a horizontal `display: flex; row` of two
   columns, each with its own strip + `#root`-equivalent

The CSS already accommodates a column-flex container. The bigger lift is
splitting the renderer code into a `TabStrip` class so two instances can
coexist and the active-strip routing can drive `currentText`/`currentPath`
correctly. The wire format (`(strip_id, idx, path, active)`) is unchanged.
