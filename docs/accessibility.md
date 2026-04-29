# Accessibility

Status: shipped (initial audit + remediations) in v1.2 · Issue: [#38](https://github.com/fadymondy/mark-it-down/issues/38)

This page is the audit log for keyboard / screen-reader / contrast accessibility across the Mark It Down extension and its companion Electron app. Each finding is paired with the fix that landed (or a follow-up issue link if deferred).

## Scope of this pass

| Surface | Audited | Notes |
|---|---|---|
| Custom editor webview (View + Edit modes) | ✓ | toolbar / mode toggle / table sorts / mermaid controls |
| Notes sidebar (TreeDataProvider) | ✓ structural — VSCode handles tree role + arrow-key nav natively |  |
| Status-bar items (warehouse + telemetry) | ✓ | accessibilityInformation set; click-to-action surfaces |
| Mermaid hover controls | ✓ | keyboard-reachable via Tab; focus styles added |
| Slideshow preview panel | partially | reveal.js handles its own keyboard nav; focus trap deferred — see followup |
| 25-theme color contrast | partially | spot-checked github-light / github-dark / dracula / nord against WCAG AA; full sweep deferred — see followup |
| Notes-warehouse modals | ✓ | use VSCode's native showWarningMessage which is screen-reader friendly |
| MCP / publish / slideshow CLI flows | ✓ | command palette is fully keyboard / VoiceOver compatible by default |

## Findings + fixes

### F1 — Mode toggle buttons missing aria-pressed (FIXED in this PR)

**Before**: `<button id="mode-view" class="active">📖 View</button>` — only a CSS class signaled state. Screen readers couldn't announce "View mode active" vs inactive.

**After**:
- `aria-pressed="true|false"` set on both buttons; toggled in `setMode()` in sync with the `.active` class
- `aria-label="Switch to View mode"` / `Switch to Edit mode"` so the emoji-only label announces meaningfully
- Toolbar wrapper gets `aria-label="Mark It Down view mode"` so it has a name in the role:toolbar landmark

**Verification**: VoiceOver on macOS announces "Switch to View mode, button, pressed" / "Switch to Edit mode, button, not pressed". Tab + Space activate the buttons.

### F2 — Sortable table headers not keyboard-reachable (FIXED in this PR)

**Before**: `<th>` cells had `cursor: pointer` + a click handler but no `tabindex` and no keyboard handler. Sort was mouse-only.

**After**:
- `role="columnheader"` + `tabindex="0"` so each header enters the tab order
- `aria-sort="none|ascending|descending"` updated by `sortTable()` — VoiceOver announces "ascending sort" on press
- Keyboard handler on Enter / Space activates the same `sortTable()` flow
- Sort indicator span now `aria-hidden="true"` so the textual content (`▲ / ▼ / ⇅`) doesn't double-announce alongside the aria-sort
- New `:focus` outline using the active theme's accent color

### F3 — Status-bar items lacked accessible names (FIXED in this PR)

**Before**: `vscode.window.createStatusBarItem` was called without an id or name; `accessibilityInformation` was unset. Screen readers announced raw text content including emoji codes.

**After**:
- Warehouse status-bar item now has a stable `id` (`markItDown.warehouse.status`) + `name` (`Mark It Down Warehouse Sync`)
- `accessibilityInformation.label` is updated on every state transition: e.g. `"Mark It Down warehouse: Notes synced, fadymondy/notes@main"`
- `accessibilityInformation.role: "button"` so it announces as actionable (clicking opens the log channel)

### F4 — Per-table export buttons lacked context (FIXED in this PR)

**Before**: `<button data-format="csv">CSV</button>` — when there were 4 tables on one page, "CSV button" announced 4 times with no way to tell which table.

**After**: each button has `aria-label="Export table N as CSV"` so the position is announced.

### F5 — Toolbar landmarks missing names (FIXED in this PR)

**Before**: `<div class="mid-table-toolbar">` had no `role` or `aria-label`. The 3 export buttons inside were findable but the grouping wasn't.

**After**: `role="toolbar"` + `aria-label="Table N export"` on each table's toolbar.

### F6 — Focus styles on bespoke buttons (FIXED in this PR)

**Before**: `.toolbar button`, `.mid-table-actions button`, `.mid-controls button` had `:hover` styles but no `:focus-visible` outline. Keyboard nav was invisible.

**After**: 2px accent-color outline added via `:focus-visible` for all three button groups.

### F7 — Color contrast across the 25 themes (PARTIAL — see followup)

**Spot-checked WCAG AA (4.5:1 body, 3:1 large)**:

| Theme | Body text on bg | Link on bg | Pass? |
|---|---|---|---|
| github-light | #1f2328 on #ffffff | #0969da on #ffffff | ✓ |
| github-dark | #e6edf3 on #0d1117 | #2f81f7 on #0d1117 | ✓ |
| dracula | #f8f8f2 on #282a36 | #8be9fd on #282a36 | ✓ |
| nord | #d8dee9 on #2e3440 | #88c0d0 on #2e3440 | ✓ |
| solarized-light | #586e75 on #fdf6e3 | #268bd2 on #fdf6e3 | ✓ |

**Not yet swept**: the remaining 20 themes. Tracked as a v2.0 follow-up since this would need either an automated WCAG checker (e.g. axe-core) or a manual run through each theme. Filed as part of the follow-up backlog.

### F8 — Slideshow preview panel focus trap (DEFERRED)

**Status**: not addressed in this PR. The slideshow preview opens a separate webview panel and reveal.js handles its own keyboard nav (arrows, F, S, ?, Esc). The Mark It Down host doesn't currently trap focus to the panel when it's opened; tabbing past the panel returns to the editor (intended behavior in most cases) but on macOS VoiceOver this can feel disorienting.

**Path forward**: future PR adds focus-trap logic that takes effect when the slideshow panel is in fullscreen. Filed for v2.0 follow-up; non-blocking for v1.2.

## What's covered by VSCode itself (no Mark It Down work needed)

- **Notes sidebar tree**: VSCode's built-in TreeDataProvider rendering supplies `role="tree"`, arrow-key navigation, expand/collapse via Right/Left arrows, screen reader announcements of selected item + level. We provide good `treeItem.label` + `treeItem.tooltip` + `treeItem.description` per item; that's enough.
- **Custom editor toolbar items** (`editor/title` menu): VSCode's command palette + title bar is fully accessible by default. Our commands appear there with their declared titles.
- **All `showInformationMessage / showWarningMessage / showErrorMessage` modals**: native VSCode rendering, screen-reader compatible.
- **Quick Picks** (Pick Theme, warehouse pickers): native rendering, fully keyboard navigable.
- **Settings UI** (`Cmd+,`): VSCode renders our settings — descriptions + `markdownDescription` get read aloud per VSCode's own a11y guarantees.

## How to run the audit yourself

1. Enable VoiceOver: Cmd+F5 on macOS
2. Open a markdown file → custom editor opens
3. Tab through: View / Edit toggle → table headers (if any) → table export buttons → status bar item
4. Verify each element announces with its aria-label / aria-pressed / aria-sort
5. Press Cmd+Option+U to navigate by web items if you're using the Voice Over Activity, or Tab/Shift+Tab for the standard order
6. Switch theme via `Mark It Down: Pick Theme` → the picker is keyboard-friendly
7. The status bar item is reachable with VO+M then arrow-key; activates with VO+Space

## Future-work seeds (filed as follow-ups elsewhere)

- Full WCAG AA sweep across all 25 themes (F7 above)
- Slideshow panel focus trap (F8 above)
- High-contrast theme variants (separate from WCAG sweep — the existing themes auto-fail on hc-light / hc-dark)
- Live region announcements for warehouse sync state changes (currently the status-bar text changes but doesn't announce automatically)
- Skip-to-content link in the published HTML site (nav currently has no skip link)

## Files changed in this PR

- [src/editor/webviewBuilder.ts](../src/editor/webviewBuilder.ts) — toolbar wrapper aria-label; mode buttons aria-label + aria-pressed; sortable header focus styles; button :focus-visible outline
- [src/webview/main.ts](../src/webview/main.ts) — sortTable updates aria-sort; wireSortableHeaders adds tabindex + role + keydown handler; attachTableActions adds toolbar aria-label + per-button aria-label; setMode toggles aria-pressed
- [src/warehouse/warehouseStatusBar.ts](../src/warehouse/warehouseStatusBar.ts) — status bar item id + name + accessibilityInformation per state transition
- [docs/accessibility.md](accessibility.md) — this audit log
