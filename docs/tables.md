# Data-table viewer

Every markdown table that survives rendering is wrapped in a `.mid-table` shell that gives the user the basic data-grid affordances expected of a "real" reader: sort, filter, and export.

## Toolbar

| Control | Behavior |
| --- | --- |
| Filter input | Free-text filter over the entire row. Debounced ~120 ms. Filters are case-insensitive and substring-based. |
| Counter chip | "N rows" when no filter is active; "M of N rows" while filtering. |
| Copy as Markdown | Copies the visible (post-filter) rows back as a GFM table to the clipboard. |
| Download CSV | Saves visible rows as `table.csv` with proper quoting (`,`, `"`, newline). |
| Download JSON | Saves visible rows as an array of objects (`{ headerName: value }`) to `table.json`. |

## Sorting

Every `<th>` is clickable. The sort cycle is **asc → desc → unsorted** (3-state). The active column shows a colored arrow (asc = up, desc = down).

The renderer auto-detects whether a column is numeric: if every non-empty cell in the column parses as a number after stripping `$,%` and whitespace, the column is sorted numerically. Otherwise it falls back to `localeCompare(undefined, { numeric: true, sensitivity: 'base' })`, which gives a sensible alpha order with embedded number handling (`row 2` < `row 10`).

## Persistence

None — sort + filter state lives in DOM only. Re-rendering (any edit in split mode) starts fresh. This is intentional: tables in markdown are content, not configuration.

## Files

- `apps/electron/renderer/renderer.ts` — `attachTableTools`, `applyTableState`, `copyTableAsMarkdown`, `downloadTable`, `rowToValues`, `TableState`.
- `apps/electron/renderer/renderer.css` — `.mid-table*`, `.mid-table-sortable`, sort indicator pseudo-element.

## Verifying

Open a markdown file containing a table, e.g.:

```markdown
| Name  | Age | City     |
| ----- | --- | -------- |
| Alice | 30  | Cairo    |
| Bob   | 25  | Berlin   |
| Carla | 41  | Bordeaux |
```

You should see:

- Toolbar above with filter input, "3 rows", and three export icons.
- Type "ber" in the filter — only Bob remains; counter says "1 of 3 rows".
- Click the **Age** header — sorts ascending (numeric); click again — descending; click a third time — unsorted (markdown order).
- Download CSV — opens a file with quoted rows matching the visible filter.
