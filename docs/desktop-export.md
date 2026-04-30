# Universal document export

The desktop app can export the current document to five formats from **File → Export → …**:

| Menu item | Output | Implementation |
| --- | --- | --- |
| Markdown source… | `.md` | Writes the editor buffer verbatim. |
| HTML… | `.html` | Standalone file: `<head>` inlines all active stylesheets (tokens, primitives, icons, katex, renderer); `<body>` clones the current `.mid-preview`. The export is self-contained — opens in any browser without external assets. |
| PDF… | `.pdf` | Main process calls `BrowserWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true })` against the live window. |
| Image (PNG)… | `.png` | Renderer rasterizes the `.mid-preview` div via `html-to-image` at 2× pixel ratio, with the active `--mid-bg` for background. |
| Plain text… | `.txt` | Strip-markdown pass: removes frontmatter, fence chrome, emphasis markers, link syntax, heading/quote/list markers; keeps the prose. |

## File naming

Each export prompts a save dialog. The default filename is the current document's basename + the target extension (e.g. `notes.md` → `notes.pdf`). Untitled buffers default to `document.<ext>`.

## DOCX (deferred)

The issue body listed DOCX too. Producing a faithful DOCX from arbitrary markdown requires walking the AST and emitting `docx`-package paragraphs/runs/tables/images, which is a substantial standalone feature. Tracked as a follow-up: open a sub-issue when the demand is clear, install `docx`, and wire `mid:export-docx` similarly.

## IPC surface

| Channel | From → To | Purpose |
| --- | --- | --- |
| `mid:save-as` | renderer → main | Generic save dialog + write. Accepts `string` (text) or `ArrayBuffer` (binary). |
| `mid:export-pdf` | renderer → main | Save dialog → `webContents.printToPDF()` → write. |
| `mid:menu-export` | main → renderer | Menu click ("Markdown source…", "HTML…", etc.) routes through with the format string. |

## Files

- `apps/electron/main.ts` — `mid:save-as`, `mid:export-pdf`, "Export" submenu wiring.
- `apps/electron/preload.ts` — `saveAs`, `exportPDF`, `onMenuExport`.
- `apps/electron/renderer/renderer.ts` — `exportAs`, `markdownToPlainText`, `buildStandaloneHTML`, `defaultExportName`, `dataUrlToArrayBuffer`.

## Verifying

Open any markdown file (e.g. `docs/desktop-workspace.md`):

- File → Export → Markdown source… → identical to the editor buffer.
- Export → HTML — open the saved file in a browser; the rendered page matches the in-app preview, including syntax highlighting and KaTeX.
- Export → PDF — A4, multi-page if the document is long; backgrounds preserved.
- Export → Image — single tall PNG of the entire preview; theme-aware.
- Export → Plain text — markdown markers stripped; prose intact.
