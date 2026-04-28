# Sortable Tables + Per-Table Export

Status: shipped in Phase 0.5 · Issue: [#5](https://github.com/fadymondy/mark-it-down/issues/5)

Markdown tables in View mode are now sortable (click any column header) and ship a per-table export toolbar with **CSV**, **TSV**, and **Excel (.xlsx)** outputs. No new framework dep — sort + serialization are hand-rolled; xlsx uses [SheetJS](https://www.npmjs.com/package/xlsx) for the binary workbook format.

## At a glance

| | |
|---|---|
| **Where** | Any markdown table in View mode |
| **Sort** | Click a column header → asc → desc → none (original order) |
| **Numeric vs string** | Both columns are detected per-cell; mixed columns fall back to localeCompare with numeric-aware sensitivity |
| **Export formats** | CSV, TSV, Excel (.xlsx) — buttons in a toolbar above each table |
| **Save** | `vscode.window.showSaveDialog` defaulting to the markdown file's directory; info toast with `Open` / `Reveal` follow-ups |

## What ships

### Sortable headers

Every `<th>` gets a click handler that cycles its data-sort attribute through `none → asc → desc → none`. The first sort stamps `data-mid-original` on each row so the "none" state can restore the original markdown order.

Comparison strategy:

```
parseFinite(value)  →  strips commas, $, %; tries Number()
both numeric?       →  numeric subtract
otherwise           →  localeCompare with { numeric: true, sensitivity: 'base' }
```

This handles "$1,200" vs "$300" correctly, sorts "2025-04-29" alphabetically (which is also chronologically correct for ISO dates), and falls back gracefully on free-form text.

Indicator glyphs in the header:

- ` ⇅` — unsorted (default)
- ` ▲` — ascending
- ` ▼` — descending

Only one column can be active at a time — clicking a new header resets the previous indicator.

### Per-table toolbar

Above each table, a mini-toolbar:

```
Table 3                              [CSV] [TSV] [Excel]
```

The label numbers each table on the page (1-indexed) for use as the default save filename. Buttons are scoped per table — clicking `CSV` on Table 3 only exports Table 3's rows.

### CSV / TSV serialization

Hand-rolled in the webview:

- Cells containing the separator, double-quote, or newline are quoted; embedded `"` is doubled per RFC 4180
- Header row is included
- Line terminator is `\n` (Excel + LibreOffice + sheets all accept this)
- UTF-8 encoded by the host on write

### Excel (.xlsx)

Uses [SheetJS](https://www.npmjs.com/package/xlsx) (`xlsx` package) — the standard JS spreadsheet library. The xlsx format is a zip of XML files; hand-rolling it would be a substantial undertaking and a maintenance liability. SheetJS adds ~600KB to the webview bundle (8.1MB → 8.7MB) which is the trade-off. If bundle size becomes a concern in v1+, we can lazy-load the xlsx module on first export.

### Sort state and export interaction

Exports use the **current row order** in the DOM. So if you sort by "Cost (desc)" then export to CSV, the CSV reflects that order. To export the original markdown order, click the column header until it cycles back to `none` (or simply don't sort first).

## Edge cases & limitations

- **Tables without `<tbody>`**: marked emits `<tbody>` for every markdown table, so this is rare. The sort handler defends with `if (!tbody) return;` and exports skip such tables silently.
- **Cells with embedded HTML**: `cell.textContent` strips tags for both sort and export. Bold/italic content sorts and exports as the unstyled text.
- **Multiple `<thead>` rows**: only the first row is wired for sorting. Multi-header tables are uncommon in markdown anyway.
- **Tables inside blockquotes / lists**: detected by `main.viewing table` selector, so the toolbar attaches consistently regardless of nesting.
- **Mermaid diagrams that contain tables**: the `attachTableActions()` runs after `renderView()` and matches DOM tables under `main.viewing`. Mermaid SVG tables are inside `<svg>` and not matched — so they're not sortable, which is the intended behavior.
- **Very large tables** (>1k rows): sort + export still work but a single click may block the main thread for a noticeable beat. Out of scope for v0.5; tracked as a future-work seed for chunked sort if reports come in.
- **Per-cell formulas (xlsx)**: cells are written as plain values via `XLSX.utils.aoa_to_sheet`. No formula reconstruction — markdown can't express formulas anyway.

## Files of interest

- [src/webview/main.ts](../src/webview/main.ts) — `attachTableActions`, `wireSortableHeaders`, `sortTable`, `compareCells`, `parseFinite`, `tableToMatrix`, `exportTable`, `csvEscape`
- [src/editor/markdownEditorProvider.ts](../src/editor/markdownEditorProvider.ts) — `saveTable` host-side handler (data URL / base64 / utf-8 → buffer → save dialog → write → toast)
- [src/editor/webviewBuilder.ts](../src/editor/webviewBuilder.ts) — `.mid-table-wrap`, `.mid-table-toolbar`, `.mid-table-actions`, `.mid-sortable`, `.mid-sort-indicator` styles
- [package.json](../package.json) — `xlsx` runtime dep
