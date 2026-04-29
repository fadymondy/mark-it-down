# Changelog

All notable changes to this extension will be documented in this file.

## [Unreleased]

### Added — Phase 0.10: Publish to GitHub Pages (#11)

- New `Mark It Down: Publish: Deploy Site` command publishes all global notes as a static site to the warehouse repo's `gh-pages` branch (configurable via `markItDown.publish.branch` and `.path`)
- `Mark It Down: Publish: Deploy Current Page` publishes only the active markdown for one-off shares
- `Mark It Down: Publish: Copy Public URL` copies the would-be URL for the active file (no build)
- `Mark It Down: Publish: Open Site in Browser` opens the deployed root
- Static generator (`src/publish/staticGenerator.ts`): marked + markedHighlight server-side render → HTML; mermaid blocks left for client-side render via JSDelivr CDN; sortable-table JS bundled into `assets/site.js`; theme palette baked into `assets/style.css` from any of the 25 [bundled palettes](docs/themes.md)
- Output structure: `index.html` (page list) + `notes/<slug>-<id>.html` per note + shared `assets/style.css` + `assets/site.js`
- Publish flow uses `git worktree add` against the warehouse working clone so the publish branch and the sync branch don't fight; orphan branch is created on first deploy if missing
- 5 new settings: `markItDown.publish.enabled / .branch / .path / .includeGlob / .theme`
- v1 limitations documented in [docs/publish.md](docs/publish.md): no first-run wizard for Pages enable, no private-repo warning, glob filtering not yet applied, no per-page slug override

### Added — Phase 0.9: MCP server for Claude Desktop / Code (#9)

- Standalone stdio MCP server bundled at `out/mcp/server.js` (esbuild → CJS Node18, ~1.1MB)
- 5 active tools: `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note` — operate on the global-scope notes from the Notes sidebar
- 2 tools registered as stubs (return a clear "requires extension IPC" error): `get_active_markdown`, `list_open_md` — defer to v1+ pending an IPC channel between the running extension and the spawned MCP server
- One-click install: `Mark It Down: Install MCP for Claude Desktop / Code` Quick-Picks Claude Desktop (per-OS path) or Claude Code (project-level `.mcp.json`) and writes the right `mcpServers["mark-it-down"]` entry. Uses the running Node binary (`process.execPath`) and the user's globalStorage notes dir.
- `Mark It Down: Show MCP Server Path (copy to clipboard)` for users wiring it into other MCP clients manually
- Extension writes `_mcp-index.json` snapshot to `globalStorage/notes/` on every NotesStore change so the cross-process MCP server stays in sync
- Limitation: workspace-scope notes are not exposed (per-VSCode-window, no addressable path); use the warehouse repo for cross-machine notes instead
- Restart Claude Desktop / Code after install to pick up the new server

### Added — Phase 0.6: File-level export pipeline TXT/DOCX/PDF (#6)

- The previously-stub commands `markItDown.exportPdf`, `exportDocx`, `exportTxt` are now real
- **TXT** export uses a hand-rolled marked-lexer walker; tables become aligned ASCII; lists keep `-` / `1.` markers; blockquotes use `>` prefix; code fenced with `---`
- **DOCX** export uses the [`docx`](https://www.npmjs.com/package/docx) npm package — real Word document with headings (visible in Word's outline pane), styled paragraphs (bold/italic/strike), indented lists, code blocks (Courier + grey shading), real `<table>`s with shaded header rows, blockquotes (italic + 720-twip indent), HRs
- **PDF** export uses [`pdfkit`](https://www.npmjs.com/package/pdfkit) — pure-Node, no chromium dependency, ~250KB. LETTER page, Helvetica/Courier mix, code blocks with grey background fill, ruled tables. Spec called for puppeteer-core but bundling chromium in a `.vsix` isn't viable; pdfkit is the pragmatic in-process alternative.
- All three share a `runFileExport` host helper: read source → parse → render → save dialog → write → toast with `Open` / `Reveal`
- Limitations documented in `docs/file-export.md`: code-block syntax color and mermaid rasterization are deferred (would require a hidden render pass through the webview)

### Added — Phase 0.8: Theme bridge with 25 bundled palettes (#8)

- 25 hand-curated theme palettes ship inline (15 dark + 10 light): GitHub Light/Dark, Dracula, Atom One Dark/Light, Monokai, Solarized Light/Dark, Tokyo Night (+Light), Ayu Light/Mirage/Dark, Gruvbox Light/Dark, Nord (+Light), Palenight, Material Dark/Light, Night Owl, Cobalt 2, Oceanic Next, Hyper Snazzy, Rosé Pine
- `markItDown.theme` setting enum extended from 6 to 26 values (`auto` + 25 themes); existing `auto` still bridges to VSCode's `--vscode-*` CSS variables
- New command `Mark It Down: Pick Theme` opens a Quick Pick over the 25 themes with kind hints; writes to workspace settings (or global if no folder open)
- Mid-session theme changes reload the webview HTML for every open Mark It Down editor — no VSCode restart needed (tradeoff: edit-mode cursor resets; live CSS-variable swap is a future-work seed)
- Mermaid theme follows each bundled palette's `kind` (light/dark) so flowcharts stay readable
- Spec referenced `@orchestra-mcp/theme`; we shipped the palettes inline so F7 doesn't block on a private package — see [docs/themes.md](docs/themes.md#why-not-orchestra-mcptheme)

### Added — Phase 0.5: Sortable tables + per-table export (#5)

- Markdown tables in View mode are now sortable — click any column header to cycle asc → desc → none (original markdown order)
- Mixed-type-aware comparison: numeric strings (with `$`, `,`, `%` strip), then `localeCompare` with numeric-aware sensitivity for everything else
- Per-table toolbar above each table with **CSV** / **TSV** / **Excel** export buttons
- CSV/TSV serialization is RFC-4180 compliant (quote on separator/quote/newline, escape embedded `"` by doubling). Exports respect the **current** sort order in the DOM.
- Excel export uses [SheetJS](https://www.npmjs.com/package/xlsx) (`aoa_to_sheet` → `XLSX.write({ type: 'base64' })`) — bundled webview grew 8.1MB → 8.7MB
- Save flow: `vscode.window.showSaveDialog` → write via host → info toast with `Open` / `Reveal` actions

### Added — Phase 0.4: Code-block image export (#4)

- Each code block in View mode has a new `PNG` action next to `Copy` that exports the block as a 2× pixel-ratio PNG via [html-to-image](https://www.npmjs.com/package/html-to-image)
- Captures syntax highlighting, the active VSCode editor background, font, padding, and border-radius — strips the hover toolbar so it doesn't appear in the image
- Save flow uses `vscode.window.showSaveDialog`, defaults to the markdown file's directory with a slugified filename like `typescript-snippet-3.png`, then offers `Open` / `Reveal` follow-up actions

### Added — Phase 0.3: Mermaid polish (#3)

- Mermaid diagrams in View mode now have hover controls: `+` / `−` zoom, `1×` reset, and `Copy` (posts the original mermaid source via the existing clipboard channel)
- Cmd/Ctrl + scroll over a diagram zooms in/out (clamped to 0.2×–6×); click-and-drag pans
- Theme sync: when VSCode's color theme changes mid-session, `initMermaid()` re-initializes mermaid with the matching theme and every existing diagram re-renders via `rerenderMermaidForTheme()` from its stashed source
- Error UX: failed renders show a structured card with title + parser message + collapsible source instead of a blank box
- Pointer-event drag with `setPointerCapture` keeps the drag attached even if the cursor leaves the diagram bounds

### Added — Phase 0.2: Real code editor in Edit mode (#2)

- The custom editor's Edit mode now uses [CodeMirror 6](https://codemirror.net) instead of a placeholder textarea — syntax highlighting, line numbers, multi-cursor, history (Cmd/Ctrl+Z), bracket matching, indent on input, line wrapping, default keymap (find/select-all/comment/etc.)
- Theme bridged to VSCode's active theme via `--vscode-*` CSS variables; dark themes additionally load `@codemirror/theme-one-dark` for syntax token colors
- Two-way bound to the document via `WorkspaceEdit` — undo stack and external edits both round-trip cleanly; `suppressEditorChange` flag prevents echo loops
- Mode toggle (View ↔ Edit) destroys + rebuilds the EditorView so memory is clean
- Deviation from the issue spec (Monaco): swapped to CodeMirror 6 to keep the strict CSP intact and avoid a 15MB Monaco bundle. See [docs/code-editor.md](docs/code-editor.md#why-codemirror-not-monaco) for the rationale and a path back to Monaco if desired.

### Added — Notes warehouse repo (#10)

- Configure any GitHub repo as a cloud-storage backend for your notes via `markItDown.warehouse.repo` (`owner/repo`); set the branch, subdir, transport (`gh` or `git`), and auto-push behavior independently
- Status-bar indicator on the right (`Notes synced` / `syncing…` / `behind` / `conflict` / `sync error` / `off`); click → opens the **Mark It Down: Warehouse** output channel
- Pull on activation (non-blocking); debounced auto-push on note save (default 5s, configurable 1–60s)
- Workspace notes go under `<subdir>/<workspace-slug>/`, global notes under `<subdir>/_personal/`. Same warehouse can host many workspaces side-by-side; same warehouse can serve multiple machines
- Per-scope `_index.json` mirrors the F6 NotesStore index — title / category / timestamps. Markdown content lives next to it as `<id>.md`
- First-push gate: confirmation modal listing repo, branch, subdir, workspace slug, file plan, and counts (added / updated / deleted) — must explicitly **Push** before any commit. Per-`(repo, workspaceId)` flag stored in `workspaceState`.
- Conflict detection: when both local and remote moved since the last sync, the local copy is kept and the conflict is logged + surfaced in the status bar. Never auto-merges.
- Secret-safety scanner: every `<id>.md` is scanned before push for GitHub PATs, AWS keys, OpenAI / Anthropic `sk-`, Slack `xox`, Google API keys, PEM private keys, and JWTs. Findings show a redacted preview + line number; user can Cancel or **Push anyway** for false positives.
- Commands: `markItDown.warehouse.syncNow`, `.pull`, `.openOnGitHub`, `.openLog` — surfaced in the Notes view title bar and command palette
- Transport `gh` runs `gh auth setup-git` once per repo so push uses your existing `gh auth` session — no extra credentials prompted. Transport `git` shells out to plain git with whatever credentials you already have
- Working clone lives at `${context.globalStorageUri}/warehouse/<owner>--<repo>/`; safe to delete (re-clones on next sync)
- Last-sync timestamps stored in `globalState[markItDown.warehouse.lastSyncedAt]` for conflict detection across sessions

### Added — Phase 0.7: Notes sidebar (#7)

- Activity-bar view container "Mark It Down" with a dedicated "Notes" tree view
- Notes are grouped by **Scope** (Workspace / Global) → **Category** → **Note**
- Workspace notes live in `context.storageUri`; global notes live in `context.globalStorageUri`. Tree falls back to global-only when no folder is open.
- Note content is a real `.md` file on disk, opened through the existing Mark It Down custom editor — no separate edit surface
- Commands: `markItDown.notes.create`, `.open`, `.rename`, `.move` (between categories), `.delete`, `.refresh`, `.revealStorage`
- Inline tree actions: rename + delete on hover; "+" on scope/category rows for quick-create in context
- View title bar: New Note · Refresh · Reveal Notes Folder
- Welcome view (empty state) with a one-click "New Note" prompt
- Configuration: `markItDown.notes.categories` (default: Daily / Reference / Snippet / Drafts), `.defaultCategory`, `.defaultScope`
- Saving a note (Cmd+S in the custom editor) bumps its `updatedAt` and re-sorts the tree most-recent-first

## [0.1.0] — 2026-04-29

### Added — Initial scaffold + Phase 0.1

- VSCode extension scaffold (TypeScript strict, esbuild for webview)
- Custom Text Editor provider (`markItDown.editor`) registered for `*.md`, `*.mdx`, `*.markdown`
- Read-only markdown rendering via marked + marked-highlight + highlight.js
- Mermaid live rendering for ` ```mermaid ` code blocks (theme-aware, light/dark)
- DOMPurify sanitization of rendered HTML
- Inline textarea editor (Phase 0.2 will replace with Monaco)
- Toggle command: View ↔ Edit
- Stub commands: Export PDF / DOCX / TXT (file-level + explorer context menu)
- VSCode theme bridge — uses `--vscode-*` CSS variables so the renderer matches the active theme
- External link handling — `https://` links open in OS browser
- Code-block per-block "Copy" action (hover-revealed)
- Configuration: `markItDown.theme`, `markItDown.startMode`, `markItDown.mermaid.enabled`
- `.github/` scaffolding: FUNDING, CONTRIBUTING, SECURITY, bug + feature issue templates
