# ePub Export

EPub joins the F5 export pipeline (PDF / DOCX / TXT). Two flavours:

* **Single-file**: `Mark It Down: Export to ePub` — turns the active
  markdown file into a one-chapter `.epub`.
* **Bundle a category**: `Mark It Down: Export Category as ePub` — pick a
  category (or any nested path) and bundle every note underneath as
  ordered chapters, sorted by `updatedAt` ascending. Useful for journals,
  reference manuals, and any "book-like" collection.

## Output

A valid EPUB 3.0 archive with this layout:

```
mimetype                                   (stored, first entry)
META-INF/container.xml
OEBPS/content.opf                          (package metadata)
OEBPS/nav.xhtml                            (epub3 nav doc)
OEBPS/toc.ncx                              (epub2 fallback TOC)
OEBPS/styles.css
OEBPS/cover.<png|jpg>                      (optional)
OEBPS/chapters/ch-NNNN.xhtml               (one per chapter)
```

Apple Books, Calibre, and Readium open the output directly. EPUBCheck
passes the structural rules — there's no JS or scripted content, so the
strict EPUB 3.2 ruleset is fine.

Frontmatter (the `---` block from the slug-overrides feature) is stripped
before each chapter renders, so it doesn't appear in the book body.

## Settings

| Setting | Purpose |
| --- | --- |
| `markItDown.epub.author` | Baked into `<dc:creator>`. Empty → "Mark It Down". |
| `markItDown.epub.publisher` | Baked into `<dc:publisher>`. Empty → "Mark It Down". |
| `markItDown.epub.coverImage` | Path (absolute or workspace-relative) to a PNG or JPEG used as the cover. Empty → no cover. |

## Implementation

EPub is just a ZIP with rules. We bundle our own minimal generator
instead of pulling a third-party dep:

| File | Role |
| --- | --- |
| `packages/core/src/epub/zip.ts` | ~110-line ZIP writer (stored + deflate via Node's `zlib`); precomputed CRC32 table; emits valid local headers + central directory + EOCD |
| `packages/core/src/epub/builder.ts` | EPUB 3 templates (container.xml, content.opf, nav.xhtml, toc.ncx) + chapter HTML via `marked` + XHTML hardening (self-close `<br>`, `<hr>`, `<img>`) |
| `src/exporters/exportEpub.ts` | Bridge — reads cover bytes through `vscode.workspace.fs`, strips frontmatter, calls `buildEpub` |
| `src/extension.ts` | Two commands (`exportEpub`, `exportCategoryEpub`) + cover-path resolver |

The category bundler reuses the nested-categories prefix-match: a path
like `Reference` collects every note whose category equals `Reference`
or starts with `Reference/`. So `Reference` bundles
`Reference/Postgres` + `Reference/Networking/CIDR` + the bare-`Reference`
notes into one ePub, in oldest-first order.

## Limitations

- No image embedding from notes — `[note attachments](note-attachments.md)` images
  are referenced by relative URL in the chapter HTML; they won't render
  inside the ePub. Embedding attachments is a natural follow-up (the
  zip writer + manifest emission already supports arbitrary files).
- No paginated TOC depth limit — every chapter is a top-level entry.
  Sub-headings inside a chapter are NOT pulled into the nav doc.
- No EPUB 2 fallback for ancient readers — we ship the `toc.ncx` for
  compatibility but the rest of the package is EPUB 3.
- Cover image is not validated; if you point at a missing or
  non-image file the cover is silently dropped.

## Testing

```bash
npx vitest run tests/unit/epub
```

13 tests cover the zip writer (CRC32 known value + empty-input edge
case, single stored entry, deflate round-trip, mimetype-first ordering,
EOCD record structure) and the EPUB builder (mimetype first, all
required structural files, one chapter file per chapter, chapter HTML
contains title + rendered markdown, content.opf manifest entries +
metadata, optional cover image embedding, XML escaping in titles).
