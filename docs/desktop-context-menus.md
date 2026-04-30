# Right-click context menus

Hover-only toolbars on code blocks, tables, and mermaid diagrams have been replaced with native-style right-click context menus. The chrome is quieter, the actions are still discoverable (right-click is the universal "what can I do here?" gesture), and there's room to grow the menus without crowding the visible UI.

## Where they're wired

| Surface | Menu items |
| --- | --- |
| **Code block** (`<pre>`) | Copy · Download as file · Export as PNG · — · Show / Hide line numbers |
| **Table** (`.mid-table`) | Copy as Markdown · Download CSV · Download JSON · — · Reset sort (when active) |
| **Mermaid** (`.mermaid`) | Copy SVG · Download SVG · Download PNG |
| **File-tree row** (`.mid-tree-item`, files only) | Open · Reveal in Finder |
| **Note row** (`.mid-note-row`) | Open · Rename… · — · Delete |
| **Document body** (`.mid-preview`) | Copy text · — · Export Markdown / HTML / PDF / PNG / Plain text |

Right-click on any nested element bubbles to the closest matching surface — e.g. right-click on a table cell opens the table menu, right-click on a code-block keyword opens the code menu. The body menu only fires when no other surface claimed the event.

## What's still visible

- **Code blocks** keep the language pill (top-left) — visual cue, not an action.
- **Tables > 5 rows** keep a small filter+counter chip in the top-right (the filter is functional and not duplicated by the right-click menu).
- **Sortable headers** still cycle on click (asc → desc → unsorted).

Smaller tables (≤ 5 rows) hide the chip entirely so prose flows uninterrupted.

## Implementation

`openContextMenu(items, x, y)` builds an absolutely-positioned `.mid-context-menu` overlay with a one-frame fade-in animation, auto-clamps to viewport edges, closes on outside-click or Esc, and routes each item to its `action`. Items are typed `{ icon?, label, kbd?, action?, separator?, disabled? }`.

No main-process roundtrip — the menu is purely renderer-side, so it inherits the active theme tokens and animates with the rest of the chrome.

## Files

- `apps/electron/renderer/renderer.ts` — `openContextMenu`, `MenuItem`, `attachCodeBlockToolbar`/`attachTableTools`/`attachMermaidToolbar` rewritten to register `contextmenu` listeners; `renameNote` added; document-level body fallback handler.
- `apps/electron/renderer/renderer.css` — `.mid-context-menu`, `.mid-context-item`, `.mid-context-sep`, `.mid-context-kbd` styles. `.mid-table-chip` replaces the old full-width `.mid-table-toolbar`.

## Verifying

1. Right-click a code block → menu appears with Copy / Download / Export PNG / line-numbers toggle.
2. Right-click a table → menu offers Copy as MD / CSV / JSON. Click the column header to sort, then right-click → Reset sort is enabled.
3. Right-click a mermaid diagram → SVG / SVG download / PNG download.
4. Right-click a file in the sidebar tree → Open / Reveal in Finder.
5. Right-click a note row → Open / Rename / Delete.
6. Right-click empty space in the preview → Copy text + 5 export formats.
7. Esc closes the menu without firing any action.
