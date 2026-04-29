# File-level Export Pipeline (TXT, DOCX, PDF)

Status: shipped in Phase 0.6 · Issue: [#6](https://github.com/fadymondy/mark-it-down/issues/6)

The previously-stub commands `markItDown.exportPdf`, `exportDocx`, `exportTxt` are now real. Right-click a `.md` file in the explorer, or invoke from the editor title bar / command palette, and Mark It Down generates the corresponding artifact server-side and offers a save dialog.

## At a glance

| Format | Engine | Output |
|---|---|---|
| **TXT** | Hand-rolled stripper using `marked.lexer` | Plain text, no markdown markers; tables become aligned ASCII; lists use `-` / `1.` prefixes; headings use `#` markers; code blocks fenced with `---` |
| **DOCX** | [`docx`](https://www.npmjs.com/package/docx) npm | Real Word document with headings, paragraphs, lists (with indent), bold/italic/strike runs, links (blue + underline), inline code (Courier), code blocks (light grey shading + Courier), real `<table>`s, blockquotes (italic + indent), HR centered |
| **PDF** | [`pdfkit`](https://www.npmjs.com/package/pdfkit) | LETTER page, Helvetica/Courier mix, headings sized H1=22pt → H6=11pt, code blocks with grey background fill, tables with header row + column ruling, HRs as horizontal lines |

All three exports share the same flow:

1. User invokes the command (explorer context menu, editor title bar, command palette)
2. Host reads the source `.md` file from disk
3. Host parses to tokens via `marked.lexer` (in `src/exporters/markdownTokens.ts`)
4. Host runs the format-specific renderer (TXT/DOCX/PDF)
5. Host opens `vscode.window.showSaveDialog` with the `.<ext>` extension and the markdown filename's basename
6. Host writes the buffer + offers `Open` / `Reveal` actions in an info toast

If anything throws, the host surfaces a clear error message — no silent failures.

## Why these libraries

- **TXT** doesn't need a library — `marked.lexer` gives us tokens, we walk and emit text. Hand-rolled is ~80 LOC and zero dep.
- **DOCX**: the `docx` package is the de-facto standard for emitting `.docx` from Node. Outputs are openable in Word, Pages, LibreOffice. ~600KB.
- **PDF**: the issue spec called for headless chromium (`puppeteer-core`). Bundling chromium in a `.vsix` is not viable — chromium itself is ~150MB and `puppeteer-core` requires the user to install Chrome separately. **PDFKit** is a pure-Node PDF generator that ships in ~250KB, runs in-process, and produces valid PDFs without any browser dependency. Tradeoff: PDFKit doesn't render arbitrary HTML, so we walk markdown tokens and emit PDF primitives directly. Mermaid diagrams, syntax-highlighted code, and complex tables look simpler in PDFKit output than they do in the webview rendering. For pixel-perfect "PDF that looks exactly like the View" output, a future iteration could shell out to a headless chromium if the user has one installed; for now, the in-process PDFKit path is the default and works offline.

## Per-format detail

### TXT export (`markItDown.exportTxt`)

Walks marked tokens and emits plain text with these conventions:

| Markdown | TXT output |
|---|---|
| `# Heading` | `# Heading` (markers preserved for readability) |
| `_em_` / `**strong**` | text content only (markers stripped) |
| `[link](https://example.com)` | `link (https://example.com)` |
| `` `code` `` | text content only |
| `![alt](img.png)` | `alt` |
| Lists | `- item` or `1. item` with 2-space indent for nesting |
| Blockquotes | `> ` prefix, recursive |
| Code blocks | fenced with `--- lang ---` … `---` |
| Tables | aligned ASCII with `|`, header underline, padded columns |
| HR | `---` |
| HTML blocks | preserved verbatim (the user added them on purpose) |

Output is UTF-8, terminated by a single `\n` at EOF. Multiple consecutive blank lines collapse to at most two.

### DOCX export (`markItDown.exportDocx`)

Uses `docx` builders to emit a Word document. Every block-level token maps to either a `Paragraph` or a `Table`:

- **Headings** → `Paragraph({ heading: HEADING_LEVEL_X })` so Word's outline pane and TOC pick them up
- **Paragraphs** → `Paragraph({ children: TextRun[] })` with inline styling (bold/italic/strike/underline/color)
- **Lists** → indented paragraphs with `•` or `1.` prefix; nested lists indent further by 360 twips per level
- **Code blocks** → paragraph with grey shading + `Courier New` font at 10pt
- **Inline code** → `TextRun` with `Courier New`
- **Links** → blue (`#0066CC`) + single underline (note: `docx` v9 doesn't expose hyperlink targets through this builder — runs are visually styled but not clickable. A future fix is to use `ExternalHyperlink`)
- **Images** → `[image: alt]` placeholder text in italic grey (binary embedding is a future addition; markdown image references remote URLs we shouldn't fetch synchronously during export)
- **Tables** → `Table({ rows: TableRow[] })` with shaded header row, full page width
- **Blockquotes** → italic grey paragraphs indented 720 twips
- **HR** → centered "— — —" glyph row

Output is a valid `.docx` zip. Word, Pages, Google Docs, LibreOffice all open it.

### PDF export (`markItDown.exportPdf`)

Uses PDFKit to draw directly to PDF primitives. LETTER page, 56pt margins, Helvetica/Courier font mix.

Per-block:

- **Headings** → Helvetica-Bold at sizes [22, 18, 15, 13, 12, 11] for H1–H6
- **Paragraphs** → Helvetica 11pt, 4pt line gap
- **Lists** → bullet/number prefix + indent; nested lists indent further
- **Code blocks** → Courier 10pt over a light grey (`#F5F5F5`) background fill (drawn after text, then text re-rendered on top — PDFKit doesn't have a native "boxed" text primitive)
- **Tables** → header row in bold, then a thin grey horizontal rule, then body rows; equal column widths fit to page
- **HR** → thin horizontal line
- **Blockquotes** → italic with `#666` color

Output is a single PDF buffer with `info` metadata set: title = source basename, producer = "Mark It Down".

## What's not in v0.6

The issue spec mentioned "preserve mermaid diagrams (rasterize them to images), code highlighting, and tables." Of those:

- **Tables**: ✓ all three formats (DOCX as real table, PDF as ruled table, TXT as ASCII)
- **Code highlighting**: ✗ in DOCX/PDF — token text only, no syntax color. The webview's html-to-image path (used by the per-block PNG export, F3) could be reused to embed colored code blocks; not in v0.6.
- **Mermaid rasterization**: ✗ — exports treat mermaid as a regular code block (text). Rendering mermaid → PNG → embed requires running mermaid in a headless browser, which is what we explicitly avoided. Future-work seed: spawn a hidden webview, render mermaid blocks via the existing webview pipeline, capture as PNG via `html-to-image`, and embed in the DOCX/PDF.
- **File-level exports from the editor title bar**: the title bar already has `Mark It Down: Toggle View / Edit`; file-level export commands are **not** added there in v0.6 — they live in the explorer context menu (already wired) and the command palette. Adding to the title bar is a 5-line change for a future cleanup.

## Edge cases & limitations

- **Empty markdown**: produces an empty TXT, a 1-paragraph DOCX, and a blank PDF page. No error.
- **Malformed markdown**: `marked.lexer` is forgiving; whatever it outputs gets walked. Tags it doesn't recognize fall through to the default branch and either render their `text` or silently skip.
- **Very large files**: TXT is fine to MBs. DOCX and PDF are O(N) over tokens; >10MB markdown files may take a few seconds to render. Streaming outputs are a future optimization.
- **Save cancelled**: silent — no error toast.
- **Filename clashes**: `showSaveDialog` handles overwrite confirmation.
- **Cross-platform paths**: VSCode's `Uri.joinPath` handles separators; tested on macOS, structurally fine on Windows/Linux.

## Files of interest

- [src/exporters/markdownTokens.ts](../src/exporters/markdownTokens.ts) — shared `tokenize` + `inlineToText`
- [src/exporters/exportTxt.ts](../src/exporters/exportTxt.ts) — `markdownToTxt` + per-block `renderBlock`
- [src/exporters/exportDocx.ts](../src/exporters/exportDocx.ts) — `markdownToDocx` + `inlineToRuns` + heading/list/table/blockquote builders
- [src/exporters/exportPdf.ts](../src/exporters/exportPdf.ts) — `markdownToPdf` + PDFKit-based `renderBlock`
- [src/extension.ts](../src/extension.ts) — `runFileExport` shared host helper; three command registrations
- [package.json](../package.json) — `docx` + `pdfkit` runtime deps
