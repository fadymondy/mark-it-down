# Wiki-links + Backlinks

Mark It Down treats `[[note title]]` inside any markdown body as a navigable
internal reference. The Notes sidebar gains a companion **Backlinks** view
that lists every note linking to whatever you currently have open.

## Syntax

| Form | Meaning |
| --- | --- |
| `[[Schema Design]]` | Link to a note titled "Schema Design" |
| `[[Schema Design#fk]]` | Link to a note + heading anchor |
| `[[Schema Design\|see schema]]` | Link with a display alias |

Matching is case-insensitive and collapses inner whitespace, so
`[[schema   design]]` resolves the same as `[[Schema Design]]`.

## Rendering

The webview pre-processes the markdown source before marked runs. Each
wiki-link becomes a small inline anchor:

* **Resolved** — solid underline, accent colour. Click jumps to the note.
* **Ambiguous** — warning colour. Multiple notes share the title; clicking
  opens a Quick Pick.
* **Broken** — red dotted underline. Clicking offers to create a new note
  using the bracketed text as the title.

Wiki-links inside fenced code blocks, indented code, or inline backticks are
left as plain text — same as how Obsidian and many other tools handle them.

## Backlinks panel

Open any note via the Notes sidebar; the **Backlinks** view (just below
**Notes** in the activity bar container) refreshes to show every other note
whose body contains a wiki-link to the active note. Each row shows the
linking note's title plus the verbatim wiki-link as it appeared in the
source — handy when scanning for outdated aliases.

The backlinks index lives in process and rebuilds:

* immediately on note create / rename / delete (via `NotesStore.onDidChange`),
* with a 300 ms debounce after a save that mutates a body,
* on demand via the **Refresh Backlinks** action in the panel header.

For a few thousand notes this is well under a frame; once the corpus passes
the ~10k mark, swap `BacklinksIndex.rebuild()` for an incremental per-note
hash cache.

## Self-links

Self-links (a note linking to itself) parse normally but are deliberately
omitted from the backlinks map — otherwise every note with a TOC heading
would show itself as a backlink and add nothing.

## Implementation map

| File | Role |
| --- | --- |
| `packages/core/src/wikilinks/parser.ts` | Pure parser, masks code regions to keep offsets stable |
| `packages/core/src/wikilinks/resolver.ts` | Resolution + corpus-wide backlink builder |
| `packages/core/src/wikilinks/renderer.ts` | Source rewrite into anchor HTML |
| `packages/core/src/markdown/renderer.ts` | Wires the rewrite into the existing marked → DOMPurify pipeline (opt-in via `notes` option) |
| `src/notes/backlinksIndex.ts` | Refreshable in-memory map keyed by note id |
| `src/notes/backlinksProvider.ts` | TreeDataProvider + `NoteIndexProvider` adapter for the editor |
| `src/editor/markdownEditorProvider.ts` | Ships the note title list to the webview, handles `openWikilink` clicks |
| `src/webview/main.ts` | Binds click handlers to `.mid-wikilink` elements |
| `src/editor/webviewBuilder.ts` | Wiki-link styles |

## Testing

```bash
npx vitest run tests/unit/wikilinks
```

17 unit tests cover the parser (code-fence skipping, alias/anchor parsing,
multiple links per line) and the resolver (case-folding, ambiguity,
self-link suppression, alias preservation in backlinks).

## Future work

* Render `[[wiki-links]]` in the published static site by reusing the same
  `rewriteWikiLinks` helper inside `publishManager.ts` (currently the
  published HTML strips them as plain bracketed text).
* MCP tool `get_backlinks(id)` so external agents can traverse the graph
  without reading every note body themselves.
