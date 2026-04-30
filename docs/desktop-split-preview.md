# Desktop split-pane live preview

The desktop app has three render modes — **View**, **Split**, and **Edit**. Split is the default once a file is open: a textarea on the left, live preview on the right, separated by a draggable handle.

## Modes

| Toolbar | Behavior |
| --- | --- |
| 📖 View | Read-only rendered preview, max-width centered. |
| ⫶ Split (default) | Editor + preview side by side. Edits update preview after a 50 ms idle debounce. |
| ✏️ Edit | Full-width editor only. |

Loading a file from the sidebar or `Cmd+O` flips the active mode to Split (unless you're already in Edit, in which case it stays).

## Resize handle

A 6 px column between the editor and preview is `cursor: col-resize`. Drag to change the split between **15%** and **85%**. Release to persist — the chosen `splitRatio` is written to `state.json` so the next launch reopens at the same proportion.

## Synchronized scroll

Best-effort scroll sync: when the editor scrolls, the preview scrolls to the same percentage of its scrollable height. Heading-aware sync is intentionally out of scope for v1 — the percentage approach handles long files well enough.

## Debounced rendering

Each `input` event schedules a 50 ms timer. Subsequent inputs reset it. When the timer fires, the preview is fully repopulated (markdown → HTML → highlight.js → mermaid → copy buttons → heading anchors → image lightbox). 50 ms keeps typing feeling instant while skipping multi-render storms during fast input.

## State persistence

| Field | Type | Default |
| --- | --- | --- |
| `splitRatio` | number (0.15–0.85) | 0.5 |

Stored alongside `lastFolder` in `state.json`. Patched via the new `mid:patch-app-state` IPC.

## Files

- `apps/electron/main.ts` — `mid:patch-app-state`, `splitRatio` in `AppState`.
- `apps/electron/preload.ts` — `patchAppState` bridge.
- `apps/electron/renderer/renderer.ts` — `Mode` union, `renderSplit`, `beginSplitDrag`, `scheduleSplitRender`, `populatePreview`.
- `apps/electron/renderer/renderer.css` — `.mid-split`, `.mid-split-editor`, `.mid-split-handle`, `.mid-split-preview`.

## Verifying

1. `npm run dev:electron` → open a folder → open a markdown file → app lands in Split mode.
2. Type in the left editor — preview updates after a brief pause.
3. Drag the handle — proportions change. Quit and relaunch — handle is back where you left it.
4. Click View — preview takes the full width. Click Edit — editor takes the full width. Click Split — back to side-by-side.
