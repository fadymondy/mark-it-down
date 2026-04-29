# Nested Category Hierarchies

Category names support `/` as a hierarchy separator. `Reference/Postgres`,
`Reference/Postgres/Indexing`, and `Daily/2026-04` all coexist; the Notes
sidebar renders them as nested folders, the MCP `list_notes` tool gains a
`categoryPrefix` filter, and the warehouse / publish pipelines need no
changes — categories are still plain strings on disk.

## Authoring

Nothing about how a note is created changes. The "New Note" command opens
a Quick Pick of known categories — type a fresh value with slashes
(`Engineering/Outage Postmortems`) and that becomes the new path. Existing
notes pick up nesting automatically the next time the tree refreshes.

The configured-categories setting (`markItDown.notes.categories`) accepts
slash paths too, so you can pre-seed an empty workspace with a tree:

```jsonc
"markItDown.notes.categories": [
  "Daily",
  "Reference",
  "Reference/Postgres",
  "Reference/Networking",
  "Drafts"
]
```

## Sidebar tree

Each scope (Workspace / Global) lists its **root** categories — distinct
first segments across the configured + in-use sets. Expanding a category
shows:

1. Its child categories first (alphabetical), then
2. Notes that live at that exact path (most recent first).

So `Reference` could expand to `Networking`, `Postgres`, then any notes
whose category is exactly `Reference`. `Reference/Postgres` would expand
to `Indexing` (a deeper child) plus its own notes.

The displayed label is the last segment only; hover the row for the full
path tooltip.

## MCP filter

`list_notes` accepts:

| Field | Behaviour |
| --- | --- |
| `category` | exact match (unchanged) |
| `categoryPrefix` | matches the path itself or anything underneath it (`Reference` matches `Reference`, `Reference/Postgres`, `Reference/Postgres/Indexing`) |
| `tag` | tag filter (unchanged) |

The filter is greedy on the prefix only — siblings like `References/Foo`
do not match `Reference` because the comparison uses path segments, not
raw `startsWith`. Trailing slashes in the prefix are tolerated and stripped
before matching.

## Implementation map

| File | Role |
| --- | --- |
| `packages/core/src/categories/path.ts` | Pure helpers (parse, join, hasPrefix, rootCategories, childCategoriesAt) |
| `src/notes/notesTreeProvider.ts` | Tree builds nested segments via `childCategoriesAt` |
| `src/mcp/notesAdapter.ts` | `listNotes({ categoryPrefix })` uses path-segment match |
| `src/mcp/server.ts` | `list_notes` input schema gains `categoryPrefix` |

## Backwards compatibility

Existing flat categories ("Drafts", "Daily") render exactly as before —
they're just one-segment paths. `category` filters in MCP still work.
The warehouse `_index.json` is untouched (categories are always plain
strings). No migration needed.

## Limitations

- The Notes sidebar doesn't yet support **dragging a note** between
  categories. Use the existing `Move to Category…` action.
- Renaming a parent (e.g. `Reference` → `Refs`) doesn't bulk-rename the
  children — you'd have to re-categorise each note. Bulk-rename is a
  natural follow-up.
- `pickCategory` shows raw paths in a flat Quick Pick. A two-step picker
  (root → child) is a future polish; the flat list is fine while category
  counts are small.

## Testing

```bash
npx vitest run tests/unit/categories
```

14 tests cover the pure helpers (parse, join, hasPrefix exact + descendant
+ sibling rejection + empty-prefix wildcard, root collection, child
collection at root + at depth + grandchild de-dup + parent-skip).
