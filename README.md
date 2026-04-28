# Mark It Down

A beautiful markdown viewer + editor for VSCode — rich rendering, live mermaid, sortable tables, code-block exports, notes sidebar, and an MCP server for AI agents.

## Status

**v0.1.0 — Phase 0.1**: extension scaffold + working read-only viewer (with optional inline editor textarea). The 9 features below are the v1 roadmap.

## Roadmap (v1.0)

| Feature | Status | Phase |
|---------|--------|-------|
| Markdown viewer (rich rendering) | ✅ shipped | 0.1 |
| File starts in viewer; toggle to editor | ✅ shipped (basic textarea editor) | 0.1 / 0.2 |
| Context-menu export → DOC, DOCX, PDF, TXT | 🚧 stubs registered | 0.6 |
| Mermaid live preview (GitHub-style) | ✅ shipped | 0.3 (in 0.1) |
| Code blocks with copy / export image | 🚧 copy shipped, export image pending | 0.4 |
| Tables → DataTable with sort + Excel/CSV export | ⬜ planned | 0.5 |
| Notes sidebar with multi-type categories | ✅ shipped | 0.7 |
| Multi-theme via `@orchestra-mcp/theme` (25 themes) | ⬜ planned | 0.8 |
| MCP server for Claude Desktop / Code | ⬜ planned | 0.9 |

## Install (dev)

This extension is in pre-release. To run locally:

```bash
git clone https://github.com/fadymondy/mark-it-down.git
cd mark-it-down
npm install
npm run compile
```

Then in VSCode: open the folder and press **F5** ("Run Extension"). A new VSCode window opens with the extension loaded. Open any `.md` file and Mark It Down takes over.

## Architecture

```
┌─── VSCode ──────────────────────────────────────────────────┐
│                                                              │
│  ┌── Custom Editor (.md files) ───────────────────────────┐ │
│  │  Webview (CSP-locked, iframe-isolated)                 │ │
│  │  • marked + marked-highlight + highlight.js (render)   │ │
│  │  • mermaid (live diagrams)                             │ │
│  │  • DOMPurify (sanitize)                                │ │
│  │  ↕ postMessage protocol ↕                              │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ↕                                 │
│  Extension host (TypeScript)                                 │
│  • CustomTextEditorProvider for *.md / *.mdx / *.markdown    │
│  • file I/O via WorkspaceEdit (preserves cursor / undo)      │
│  • theme bridge (VSCode active theme → renderer theme)       │
│  • commands: toggleMode, exportPdf/Docx/Txt (stubs)          │
└──────────────────────────────────────────────────────────────┘
```

## Roadmap detail

- **v0.2** — Replace the textarea editor with Monaco (matching `@orchestra-mcp/editor`'s MarkdownEditor)
- **v0.3** — Polish mermaid (zoom, pan, error UX, light/dark sync)
- **v0.4** — Per-code-block "export as image" via html-to-image
- **v0.5** — Tables become a sortable DataTable; per-table export Excel/CSV/TSV
- **v0.6** — File-level export pipeline: PDF (chromium-pdf), DOCX (`docx` npm), TXT
- **v0.7** — Notes sidebar (TreeDataProvider) with workspace + global storage — [docs/notes-sidebar.md](docs/notes-sidebar.md)
- **v0.8** — Theme bridge to the 25-theme orchestra-mcp set
- **v0.9** — MCP server (stdio): `list_notes`, `get_note`, `create/update/delete_note`, `get_active_markdown`, `list_open_md`. Bundled in the `.vsix`. One-click "Install MCP for Claude Desktop / Code".

## Configuration

Settings (Cmd+, → "Mark It Down"):

| Setting | Default | Values |
|---------|---------|--------|
| `markItDown.theme` | `auto` | `auto / light / dark / github / dracula / one-dark` |
| `markItDown.startMode` | `view` | `view / edit` |
| `markItDown.mermaid.enabled` | `true` | boolean |
| `markItDown.notes.categories` | `["Daily","Reference","Snippet","Drafts"]` | list of strings |
| `markItDown.notes.defaultCategory` | `"Drafts"` | string |
| `markItDown.notes.defaultScope` | `"workspace"` | `workspace / global` |

## Documentation

Per-feature pages live in [docs/](docs/). Currently shipped:

- [Notes sidebar](docs/notes-sidebar.md) — workspace + global notes with categories, opened through the Mark It Down editor

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md). All commits use the contributor's git config — no AI co-author trailers.

## License

MIT — see [LICENSE](LICENSE)

## Author

[Fady Mondy](https://github.com/fadymondy)
