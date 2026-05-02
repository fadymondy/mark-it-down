# Desktop outline rail (TOC)

A right-side fast-access menu that lists every heading in the active markdown file so the reader can jump straight to a section. It mirrors the role of the file-tree on the left: the sidebar is "where can I read?", the outline is "where in this doc?". Shipped in #252.

## Behavior at a glance

| Mode | Outline rail |
| --- | --- |
| **View** | Visible (default), full heading tree of the current preview |
| **Split** | Visible (default), live-updates as the user edits |
| **Edit-only** | Hidden — there is no preview to navigate |
| **PDF / image export** (`body.is-printing`) | Hidden — never lands in the exported artifact |

The user can also toggle the rail on/off via the **status-bar Outline button** or the **Cmd/Ctrl + Shift + L** shortcut. The toggle state persists across launches.

## Anatomy

```
┌────────────────────────────── window ──────────────────────────────┐
│ titlebar (open / save / search / mode / settings)                  │
├──────┬──────────────┬──────────────────────────────┬───────────────┤
│ Act. │              │                              │               │
│ bar  │   Sidebar    │   .mid-preview / .mid-split  │ Outline rail  │
│      │              │                              │  (~220 px)    │
│      │              │                              │               │
├──────┴──────────────┴──────────────────────────────┴───────────────┤
│ statusbar:  repo · words · [Outline ⌘⇧L] · save dot                 │
└────────────────────────────────────────────────────────────────────┘
```

The outline rail is built from the headings (`h1` … `h6`) that the markdown renderer emits into the `.mid-preview` container. Each heading already carries a slug-based `id` from the existing `attachHeadingAnchors()` decorator (e.g. `## Foo bar` → `id="foo-bar"`), so the outline simply links into that anchor space — no second source of truth.

## Building the tree

`rebuildOutline(preview)` is invoked from every code path that re-paints the preview:

- `renderView()` — view mode
- `renderSplit()` — split mode initial paint
- `scheduleSplitRender()` — debounced re-paints while the user types
- `setMode()` — mode change

The function:

1. Disconnects the previous `IntersectionObserver` and clears the link cache.
2. Reads `preview.querySelectorAll('h1, h2, h3, h4, h5, h6')`.
3. For each heading, creates an `<a class="mid-outline-item" data-level="N">` whose `textContent` is the heading text (with the trailing `#` anchor character stripped) and whose click handler smooth-scrolls the preview to that heading.
4. Wires an `IntersectionObserver` rooted on the preview with `rootMargin: '0px 0px -75% 0px'` so the "active" highlight triggers when a heading enters the top fifth of the visible region — the common scroll-spy pattern that avoids twitching at section boundaries.

If the document has zero headings the rail falls back to a quiet empty-state line: *"No headings in this document."*

## Toggle + persistence

- **Status-bar button** (`#status-outline`) — clicking flips `outlineHidden`.
- **Header X button** (inside the rail) — also flips `outlineHidden` to `true`.
- **Keyboard** — `Cmd/Ctrl + Shift + L` toggles from anywhere in the app.
- The current state is written to app state via `mid:patch-app-state` under the key `outlineHidden: boolean` and restored on the next launch by the existing `readAppState()` startup flow.

The status-bar button reflects state via `data-active="true|false"` so the icon dims when the rail is hidden — matching the dim-when-inactive treatment of the repo cell.

## Indentation by heading level

The rail uses `data-level` on each `.mid-outline-item` plus a stair-stepped `padding-left` ladder that shares the existing `--mid-space-3 … --mid-space-6` token scale. `h1` items sit flush at the top level and ship in heavier weight; `h6` items sit ~32 px in. There is no actual nested DOM (flat list with indent), which keeps keyboard navigation linear and prevents long sub-trees from ballooning the rail's vertical footprint.

## Why a separate rail (not a popover)

A popover would have hidden the outline behind a click on every section change, which defeats the "fast access" promise. A docked rail is always-on and gives ambient awareness — you can see where you are *and* where you could jump *while* you read. The 220 px width is tuned for a 13" laptop: slim enough that a 760 px-max preview still has breathing room next to a 280 px-wide sidebar.

## Print rule

`body.is-printing .mid-outline { display: none !important; }` plus the existing `body.is-printing .mid-shell { grid-template-columns: 1fr }` reset means the rail never appears in PDF, PNG, or DOCX exports. The `is-printing` class is set briefly around `window.mid.exportPDF()` in `exportAs('pdf')` and removed in the `finally` block — same mechanism as the rest of the chrome.

## Files

- `apps/electron/renderer/index.html` — `<aside id="outline-rail" class="mid-outline">` after `<main id="root">`, plus the `#status-outline` button in the footer.
- `apps/electron/renderer/renderer.ts` — `AppState.outlineHidden`, the `outline*` module-level state, `rebuildOutline()`, `setActiveOutlineItem()`, `applyOutlineVisibility()`, `setOutlineHidden()`, `toggleOutline()`. Hooked into `renderView`, `renderSplit`, `scheduleSplitRender`, `setMode`, and the app-state hydration block.
- `apps/electron/renderer/renderer.css` — `--mid-outline-w`, `body.has-outline .mid-shell` grid, `.mid-outline*`, `.mid-outline-item[data-level=N]` indents, `body.is-printing .mid-outline`.

## Verifying

1. Open any markdown doc with several headings — the rail appears on the right and lists every `h1`–`h6`, indented by level.
2. Click any outline item — the preview smooth-scrolls to that section.
3. Scroll the preview manually — the active item highlights as the top heading changes.
4. Switch to **Edit-only** mode — the rail disappears (no preview to navigate).
5. Switch back to **View** or **Split** — the rail returns.
6. Press **Cmd/Ctrl + Shift + L** (or click the **Outline** status-bar cell) — the rail toggles. Restart the app — the toggle state persists.
7. Open a doc with no headings — empty-state copy appears in the rail.
8. **Export → PDF** — the rail is absent from the exported file. Same for PNG and DOCX exports built from the preview.

## Related

- #115 — title-bar mode toggle (View / Split / Edit) that drives the visibility logic.
- #228 — heading-anchors decorator that supplies the `id` slugs the rail targets.
- The print-mode rules added in earlier PDF-export work (`body.is-printing` chrome hide) — the outline rail simply joins that list.
