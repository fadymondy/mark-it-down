# Changelog

All notable changes to this extension will be documented in this file.

## [Unreleased]

### Added — v2.0: Slideshow live reload (#50)

- `Mark It Down: Slideshow: Preview Local` no longer needs to be re-run on each edit — the preview panel hot-reloads on every keystroke (debounced 120 ms) and on explicit save (no debounce); slide position is preserved across rebuilds
- New `liveReload?: { initialIndex? }` option on `slideshowGenerator` injects a small bridge script: `acquireVsCodeApi`, `Reveal.on('slidechanged' / 'fragmentshown' / 'fragmenthidden')` posts `slideshow.position` back to host; `Reveal.on('ready')` calls `Reveal.slide(h, v, f)` with the baked-in initial index
- `SlideshowManager` now tracks open preview panels in a `Map<docUri, PreviewSession>`; first call creates the panel + wires document/save listeners, subsequent calls reveal + rebuild the existing one (no duplicate panels per file)
- Reveal's URL hash routing is disabled in live mode (it would conflict with the position-restore script); still honoured outside live mode (publish path, embed)
- 5 new unit tests covering bridge presence/absence, hash toggle, initial-index baking, missing-index fallback to null

### Added — v2.0: Internationalization (#49)

- Manifest strings (command titles, view names, settings descriptions, the activity-bar container, the welcome message) externalised into `package.nls.json` (English source) + `package.nls.<lang>.json` per locale; runtime strings (status bar labels, empty-state hints, exporter notifications) externalised into `l10n/bundle.l10n.json` + `l10n/bundle.l10n.<lang>.json`
- 4 locales beyond English shipped: **es** (Spanish), **fr** (French), **de** (German), **ar** (Arabic — RTL handled natively by VSCode)
- Thin `src/i18n/t.ts` wrapper around `vscode.l10n.t()` for stable call sites
- New `scripts/check-i18n.mjs` parity checker — verifies every locale file has exactly the same keys as the English source; wired into `.github/workflows/ci.yml` so missing/stale translations fail the build
- New `npm run check-i18n` script for local use
- `package.json` `l10n` field points at `./l10n` so VSCode resolves the runtime bundle automatically
- 11 new unit tests in `tests/unit/i18n/parity.test.ts`: at-least-4 locales beyond English (per family), per-file exact-key parity, every value is a non-empty string

### Added — v2.0: ePub export (#48)

- Two new commands: `Mark It Down: Export to ePub` (single-file, one chapter per book) and `Mark It Down: Export Category as ePub` (multi-chapter book bundling every note under a category path, sorted oldest-first by `updatedAt`)
- Bundled minimal EPUB 3.0 generator in `packages/core/src/epub/` — zero new runtime deps, just Node's `zlib`. Ships a 110-line ZIP writer (stored + deflate, precomputed CRC32 table, valid EOCD) plus a templated builder (container.xml, content.opf, nav.xhtml, toc.ncx, styles.css, chapter XHTML)
- XHTML hardening for marked output: self-closes `<br>`, `<hr>`, `<img>` so EPUB-strict readers parse cleanly
- Frontmatter is stripped before each chapter renders (reuses the parser from #46)
- New settings: `markItDown.epub.author`, `markItDown.epub.publisher`, `markItDown.epub.coverImage` (absolute or workspace-relative path to a PNG/JPEG cover; missing → silently dropped)
- Category bundler reuses the nested-categories prefix-match (`Reference` collects `Reference` + `Reference/Postgres` + `Reference/Networking/CIDR` + …)
- Explorer-context menu and command-palette entries; `markItDown.exportEpub` keyed off `.md`/`.markdown`/`.mdx`
- 13 new unit tests across the zip writer (CRC32 known value, empty-input, single stored entry, deflate round-trip, mimetype-first ordering, EOCD record) and the builder (mimetype first, all required structural files, one chapter file per chapter, chapter content, content.opf manifest entries + metadata, optional cover image embedding, XML escaping in titles)

### Added — v2.0: Multi-warehouse routing (#47)

- New `markItDown.warehouse.routes` setting accepts an array of `{categoryPrefix, repo, branch?, subdir?}` rules; notes whose category matches a prefix sync to that route's repo, everything else falls through to the default `markItDown.warehouse.repo`
- Pure router lives in `packages/core/src/warehouse-routing/`: builds resolved routes from rules, validates inputs (rejects empty / malformed / duplicate-prefix rules with reasons logged), inherits branch + subdir from the default config, sorts routes by descending prefix specificity so deeper rules win, exposes a per-route predicate
- `WarehouseSync.pull` / `planPush` / `push` accept an optional `predicate` so each call only handles its route's notes; `planPush` flags remote notes whose category no longer matches the route as deletes (so re-categorising a note from one route to another is handled gracefully — added on the new repo, deleted from the old)
- `WarehouseManager` iterates every enabled route per `syncNow` / `pullCommand` / `runAutoPush`, with separate first-push confirmation per repo (`firstPushFlagKey` already keys on repo so each new warehouse gets its own one-time dialog)
- Status bar collapses to `<repo>@<branch>` for a single route, `N warehouses` for multiple
- `Open on GitHub` shows a Quick Pick when more than one route is enabled
- 10 new unit tests covering route parsing (no-rules, no-default, every rejection branch, branch/subdir inheritance + override) and routing semantics (prefix match, default exclusion, sibling non-bleed)

### Added — v2.0: Per-page slug overrides via frontmatter (#46)

- Notes can declare a `slug:` in a YAML frontmatter block at the top of the body — published page goes to `notes/<slug>.html` instead of the default `notes/<slug-from-title>-<id>.html`
- New `packages/core/src/frontmatter/index.ts` — tiny zero-dep parser for `---`-fenced blocks, supports scalars (string / number / boolean), inline lists, quoted strings, comment lines, BOM, missing-fence safety
- `validateSlug` rules: `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$` and ≤48 chars; anything else (uppercase, whitespace, slashes, leading/trailing dash, over-length) silently falls back to the title-derived id-suffixed URL
- Slug collision detection in `PublishManager.collectAll`: first claimant keeps the clean URL, conflicting note(s) fall back to id-suffixed URL, warehouse log gets a `slug collision` entry, and a one-shot `showWarningMessage` surfaces it
- `publishCurrent` (the per-file path) also strips frontmatter + honours slug override for arbitrary markdown files
- 15 new unit tests across the parser (no-fence, fenced + stripped, scalar types, lists, comments, missing closing fence, BOM tolerance, leading blank line) and `validateSlug` (lowercase-dash, digits, rejected patterns, length cap, non-string input)

### Added — v2.0: Nested category hierarchies (#45)

- Category names accept `/` as a hierarchy separator — `Reference/Postgres`, `Reference/Postgres/Indexing`, `Daily/2026-04` all coexist as plain category strings (no schema migration)
- Notes sidebar renders categories as a true tree: each scope shows root segments, expanding a category shows its child segments first then notes that live at the exact path; tooltip surfaces the full path on hover
- New `packages/core/src/categories/` package: pure helpers `parseCategoryPath`, `joinCategoryPath`, `categoryHasPrefix`, `rootCategories`, `childCategoriesAt` — segment-aware so siblings don't bleed together (`References/Foo` does not match prefix `Reference`)
- MCP `list_notes` accepts `categoryPrefix` (matches the path itself or anything underneath it); existing `category` filter still does exact match. Trailing slashes on the prefix are stripped before comparison.
- Tree provider uses the new helpers — flat categories render unchanged (a one-segment path is just a leaf folder)
- 14 new unit tests covering parse / join / prefix matching (exact, descendant, sibling rejection, empty wildcard) / root collection / child collection at root + at depth + grandchild de-dup + parent-skip

### Added — v2.0: Note attachments (#44)

- Each note can carry binary attachments stored at `<storage>/notes/<id>-attachments/<filename>`; the dir is created lazily on first attachment and removed when the note is deleted
- Drag-drop one or many files onto the editor (view or edit mode) — webview reads each via FileReader, base64-encodes, posts `attachUpload` to the host, store sanitises + de-duplicates the filename, then a relative markdown reference (`![]()` for images, `[]()` otherwise) is appended at the end of the note
- New `packages/core/src/attachments/` package: pure helpers for filename sanitisation (path-traversal safe, alphanumeric+dot+dash+underscore only, 96-char cap that preserves extension), collision resolution (`a.png` → `a-1.png`, `a-2.png`, …), image-extension detection, markdown-reference emission
- `NotesStore` extensions: `attachmentsDirUri`, `attachmentUri`, `listAttachments`, `addAttachment`, `deleteAttachment`; `importNote` now accepts an optional `attachments` payload so warehouse pull can materialise binaries
- Warehouse sync: `materializeScope` copies each note's attachment dir verbatim, indexes filenames as `attachments?: string[]` in `_index.json`, and deletes the dir on note removal; pull side calls `readRemoteAttachments` and threads them through `importNote`
- Publish: `collectAll` returns `{ pages, attachments }`; `runBuildAndPush` copies each attachment to `notes/<id>-attachments/<filename>` next to its rendered page so relative links resolve naturally on GitHub Pages
- 19 new unit tests across the pure helpers (sanitisation incl. path traversal, length cap with extension preservation, collision resolution with + without extension, image detection across 7 cases, markdown emission for image / non-image / aliased)

### Added — v2.0: Wiki-links + backlinks (#43)

- Markdown gets `[[note title]]`, `[[note title|alias]]`, and `[[note title#anchor]]` syntax — resolved against the live notes corpus
- New `packages/core/src/wikilinks/` package: pure parser (skips fenced + inline code), case-insensitive resolver with ambiguous + broken statuses, source rewriter that injects sanitised anchor HTML before marked runs
- Webview renders wiki-links with three visual states — solid accent (resolved), warning colour (ambiguous → Quick Pick on click), red dotted (broken → "Create note?" prompt)
- New **Backlinks** sidebar view next to **Notes** — for the active note, lists every other note linking to it, with verbatim wiki-link snippet in the description
- `BacklinksIndex` rebuilds on store changes (debounced 300 ms) + on demand via `Mark It Down: Refresh Backlinks`
- New hidden command `markItDown.notes.createWithTitle` — invoked by broken-link clicks, jumps the user through scope + category pickers prefilled with the bracketed title
- 17 new unit tests across parser (code-region masking, alias/anchor split, multi-link lines) and resolver (case-folding, ambiguity, self-link suppression, alias preservation in backlinks)

### Added — v2.0: Tags (#42)

- New optional `tags?: string[]` field on `NoteMetadata` — multi-tag-per-note, orthogonal to `category`
- Tags are normalized: lowercase, alphanumeric + dashes, deduped + sorted (e.g. `Postgres Tuning, design` → `["design", "postgres-tuning"]`)
- `NotesStore.setTags(id, tags[])` + `tagsInUse(scope?)` helpers
- 2 new commands:
  - `Mark It Down: Edit Tags` — context menu on a note + command palette; opens an InputBox prefilled with current tags
  - `Mark It Down: Filter by Tag` — Quick Pick over all tags in use → Quick Pick of matching notes → opens the chosen one
- Notes tree renders up to 3 tag badges in the description (`#design #postgres-tuning · 14:32`); full tag list in the tooltip
- MCP `list_notes` accepts an optional `tag` filter (case-insensitive); `create_note` + `update_note` accept a `tags: string[]` patch
- `MdNote` interface (MCP-side) gains the same `tags?` field

### Added — v1.2 polish: search across notes (#41)

- New `packages/core/src/search/searcher.ts` — pure-function fuzzy search (no deps), shared by sidebar + MCP. Per-token scoring: exact title (+10), partial title (+5), category (+3), body occurrences (+1, capped at 5). Tie-breaks by recency.
- **Sidebar search**: `Mark It Down: Search Notes` command — input box → fuzzy match → Quick Pick → Enter opens the chosen note. Wired into the Notes view title bar.
- **MCP `search_notes` tool**: `{ query, limit? }` → ranked hits with `id`, `title`, `category`, `scope`, `updatedAt`, `score`, `snippet`.
- **Claude plugin**: new `/mid:search` skill (7 skills total in the bundle now).
- **Published-site search**: each site ships `assets/search-index.json` (Lunr 2 + a doc map with title + 200-char snippet). Header search input lazy-loads the index on first keystroke; debounces 200ms; up to 12 hits.
- 11 new unit tests covering the searcher (tokenize, title/body/category scoring, exact vs partial title boost, multi-token sum, limit, recency tie-break, no-match, snippet length cap)

### Added — v1.2 polish: pre-release / beta channel (#40)

- New `markItDown.updates.channel` setting (`"stable"` default, `"beta"` opt-in)
- VSCode poller: stable channel hits `/repos/.../releases/latest` (GitHub auto-skips pre-releases); beta channel hits `/repos/.../releases?per_page=20` and picks the newest non-draft including pre-releases
- Electron `autoUpdater.channel` / `allowPrerelease` driven by the `MID_CHANNEL=beta` env var (mirror of the VSCode setting)
- Release workflow now matches both `v*.*.*` (stable) and `v*.*.*-*` (pre-release: `-rc.1` / `-beta.2` / etc.) tag patterns
- Workflow's release-notes job auto-flips the GitHub release's `prerelease` flag based on whether the tag has a hyphen — stable tags get `prerelease: false`, pre-release tags get `prerelease: true`
- New "Pre-release / beta channel" section in `docs/auto-update.md` walking through how the two channels diverge

### Added — v1.2 polish: side-by-side conflict-resolution UI for warehouse (#39)

- New `ConflictRegistry` collects diverged notes during sync (was previously just a log warning)
- New `ConflictPanel` webview shows local vs remote side-by-side per note with `Keep local` / `Replace with remote` / `Skip` actions; live-refreshes as the registry changes
- Status bar's `conflict` state now opens the panel on click (other states still open the log channel)
- New command: `Mark It Down: Warehouse: Resolve Conflicts`
- `Replace with remote` calls `NotesStore.importNote` with the remote content + remote `updatedAt`
- Strict CSP scoped to the panel webview; per-button `aria-label`s; dark/light theme follows VSCode `--vscode-*` variables
- F9 (#10) docs future-work seed for "side-by-side conflict UI" — resolved

### Added — v1.2 polish: accessibility audit + remediations (#38)

- Mode toggle buttons (View / Edit): `aria-pressed` toggled in sync with `.active` class; `aria-label` overrides emoji-only labels; toolbar wrapper gains `aria-label="Mark It Down view mode"`
- Sortable table headers: `role="columnheader"` + `tabindex="0"` + `aria-sort` updated on sort + Enter/Space keyboard handler + visible `:focus` outline (sort was previously mouse-only)
- Sort indicator span marked `aria-hidden` so screen readers don't double-announce
- Per-table export buttons get `aria-label="Export table N as CSV/TSV/Excel"` so position is announced when there are multiple tables on a page
- Per-table toolbar gets `role="toolbar"` + `aria-label`
- `:focus-visible` outline added for `.toolbar`, `.mid-table-actions`, and `.mid-controls` button groups (was invisible during keyboard nav)
- Warehouse status-bar item: stable `id` + descriptive `name` + `accessibilityInformation.{label, role}` updated on every state transition — screen readers now announce e.g. "Mark It Down warehouse: Notes synced, fadymondy/notes@main"
- New `docs/accessibility.md` — full audit log with per-finding fix or follow-up link, scope-of-pass table, what's already covered by VSCode itself, and how to run the audit yourself
- Deferred (with explicit follow-ups in `docs/accessibility.md`): full WCAG AA sweep across all 25 themes, slideshow panel focus trap, high-contrast variants, live-region announcements for sync state changes, skip-to-content in published HTML

### Added — v1.2 polish: opt-in telemetry via Sentry (#37)

- New `src/telemetry/` module: `TelemetryClient` + `sanitize` helpers
- **Default off.** First activation surfaces a one-time consent toast (`Enable / Keep off / Learn more`) — choice persists in `globalState[markItDown.telemetry.consentShown]`
- 2 settings: `markItDown.telemetry.enabled` (default `false`) + `markItDown.telemetry.dsn` (default empty — official build ships without a DSN; events stay local until the user points it at their own Sentry project)
- 1 command: `Mark It Down: Telemetry: Send Test Event` for verification
- PII filter at source: workspace paths → `<workspace>`, home dir → `~`, extension dir → `<extension>`, system temp → `<tmp>`. Strings truncated at 4096 chars. Applied to error events AND breadcrumbs via Sentry `beforeSend` / `beforeBreadcrumb`.
- Random per-launch session id (16-char hex, not persisted) tagged on every event
- `release` tag from `package.json#version`; `tracesSampleRate: 0` (no perf traces collected)
- 9 unit tests covering the sanitizer (path replacement, longest-anchor-first, deep walk, length truncation, session-id format + uniqueness)
- Full reference docs at `docs/telemetry.md` — consent flow, what's sent, what's NEVER sent, verification recipe

### Added — v1.2 polish: packages/core/ extraction — first cut (#36)

- New `packages/core/src/` directory holds the `vscode`-API-free shared modules:
  - `themes/` — the 25 palette definitions + helpers (moved from `src/themes/`)
  - `markdown/tokens.ts` — `tokenize` + `inlineToText` (moved from `src/exporters/markdownTokens.ts`)
  - `markdown/renderer.ts` — **new** consolidated `renderMarkdown` + `applyMermaidPlaceholders` that both `src/webview/main.ts` (VSCode webview) and `apps/electron/renderer/renderer.ts` (Electron renderer) now use
  - `secrets/scanner.ts` — token regex set (moved from `src/warehouse/secretScanner.ts`)
  - `semver/compare.ts` — `compareSemver` + `parseSemver` (moved from `src/updates/updateChecker.ts`)
- All previous import sites stay working via thin re-export shims in the original locations (no churn at call sites; tests still green at 71/71)
- `tsconfig.json` widened to include both `src/` and `packages/core/src/` under a project-root `rootDir`; `package.json#main` updated to `./out/src/extension.js` to match the new output layout (`out/src/...` + `out/packages/core/src/...`)
- Documented what's deferred in `packages/core/README.md`: notes/warehouse/publish/slideshow/MCP-install all touch `vscode.*` and need interface abstractions before they can land; Electron's IPC bridge currently re-implements small subsets that core could absorb in a future ship
- Webview + Electron renderer now share one `renderMarkdown` implementation — the ~30 LOC mermaid-placeholder duplication that #13 (Electron first-cut) called out is gone

### Added — v1.1 hardening: MCP IPC channel for active-editor introspection (#35)

- The 2 stub tools from F8 (`get_active_markdown` and `list_open_md`) now actually work
- New cross-platform IPC channel: Unix-domain socket on macOS/Linux at `${globalStorageUri}/mid-mcp.sock`, named pipe on Windows at `\\.\pipe\mark-it-down-<hash>` (the hash makes multiple installs collision-safe)
- `src/mcp/ipcProtocol.ts` — newline-delimited JSON request/response types + `ipcEndpoint(dir)` helper
- `src/mcp/ipcServer.ts` — `McpIpcServer` listener wired into extension activation; cleans up stale sockets on POSIX startup; per-connection request handler covers `ping` / `get_active_markdown` / `list_open_md`
- `src/mcp/ipcClient.ts` — connects + sends + closes per request (no pool needed at MCP volume); 3s timeout
- `src/mcp/server.ts` — `--ipc-sock <path>` CLI arg; both tools route through `IpcClient` and gracefully degrade with a clear error when the channel is unreachable
- `src/mcp/installCommand.ts` — auto-passes `--ipc-sock` per-install so users don't have to know the path
- 4 new unit tests + 3 round-trip integration tests covering the protocol with a stand-in server (71 tests total, all passing)
- `docs/mcp-server.md` updated to remove the deferred caveat for both tools, document the IPC architecture, and show the response shape for each

### Added — v1.1 hardening: VSCode Marketplace publisher setup runbook (#34)

- `package.json` extended with marketplace-friendly metadata: `bugs.url`, `categories` adds "Notebooks", `keywords` adds preview/publish/slideshow/github-pages, `galleryBanner` (`#0d1117` dark), `qna: marketplace`
- `media/marketplace/` placeholder directory with a README documenting the 6 screenshots needed for the listing (filename convention, size budget, capture instructions)
- `docs/releasing.md` gains a 7-step "Setting up the VSCode Marketplace publisher" section: publisher creation at marketplace.visualstudio.com → Azure DevOps PAT → repo secret → first manual `vsce publish` → Open VSX mirror recommendation → screenshot guidance → token rotation cadence
- The release workflow's `vsce publish` step is already conditional on `VSCE_PAT` being set (from F14 #28) — gracefully no-ops until the user adds the secret
- **User action required** to actually go live: create the publisher account + add `VSCE_PAT` secret + first manual publish per the runbook

### Added — v1.1 hardening: macOS code signing + notarization wired (#33)

- `.github/workflows/release.yml` env block now references `MAC_CERTS`, `MAC_CERTS_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` secrets — populated only on macOS runners that have them, electron-builder gracefully falls back to unsigned builds when absent
- `docs/releasing.md` gains a complete "Setting up macOS code signing" section walking through cert creation in Xcode → `.p12` export → base64 → app-specific password → team ID → repo secrets, plus a verification + cert-rotation note
- `docs/auto-update.md` Code Signing section updated to point at the new releasing.md flow
- **User action required after merge** to actually enable signing: add the 5 GitHub repo secrets per the runbook. Until then, releases still ship unsigned macOS DMGs (functional but no auto-update on Mac).

### Added — v1.1 hardening: VSCode integration tests via @vscode/test-electron (#32)

- New `tests/integration/` with the runner (`runTest.ts`), Mocha test-suite loader (`suite/index.ts`), and 5 happy-path tests covering: extension presence, activation without errors, every contributed command registered after activation, custom-editor `openWith` for a `.md` file resolves cleanly, configuration namespaces (`theme`, `startMode`, `mermaid.enabled`, `notes.categories`) all readable.
- `tsconfig.integration.json` outputs to `out/integration/`; `npm run compile:integration` + `npm run test:integration` scripts wired
- New CI job (`integration`) runs after the lint-and-build matrix, on ubuntu only, downloads VSCode via `@vscode/test-electron`, invokes the suite under `xvfb-run`
- Adds `.vscode-test-user-data/` + `coverage/` to `.gitignore`

### Added — v1.1 hardening: vitest harness + 65 initial unit tests (#31)

- New `vitest.config.ts` with a `vscode` module alias pointing at `tests/__mocks__/vscode.ts` so src/ files that import vscode don't break the test runner
- 65 unit tests across 6 files covering the pure-function modules: `markdownTokens` (tokenize + inlineToText), `secretScanner` (9 token patterns + redaction), `warehouseConfig` (slugify, repoSlug, repoUrl, repoWebUrl, scopeDir), `themes` (25 palettes + findTheme + paletteToCss), `compareSemver` + `parseSemver` (exported from `updateChecker`), `markdownToTxt` (heading / inline / list / code / table / blockquote / hr handling)
- Scripts: `npm test`, `npm run test:watch`, `npm run test:coverage`
- CI workflow now runs unit tests + uploads a v8 coverage report as an artifact (no threshold enforced yet — first baseline)
- Exported `compareSemver` + `parseSemver` from `src/updates/updateChecker.ts` for testability (no behavior change)

### Added — v1.1 hardening: ESLint flat config + PR-time CI (#30)

- New `eslint.config.mjs` (flat config, ESLint 10) covering `src/`, `apps/electron/`, with separate Node + browser global sets per file group
- `npm run lint` and `npm run lint:fix` scripts wired and pass on `main` HEAD (0 errors, 3 minor warnings)
- New `.github/workflows/ci.yml` — runs `npm ci && npm run lint && npm run compile && npm run compile:electron && npm run build:claude-plugin` on every PR + push to main, on a `[ubuntu-latest, macos-latest]` matrix
- Cancels superseded runs via `concurrency.cancel-in-progress: true`
- 3 case-block scope errors fixed in the export pipeline (`exportTxt.ts`, `exportDocx.ts` x2)

### Added — Phase 0.14: Auto-update for both surfaces (#28)

- **VSCode extension**: in-extension `UpdateChecker` polls `GET /repos/fadymondy/mark-it-down/releases/latest` once per launch + every 6h; surfaces a notification with `Open Release` / `View Changes` / `Later` actions when a newer version is published. Doesn't re-notify for the same version. Never auto-installs (security smell).
- **VSCode extension — What's New**: on first launch after an update, a one-time toast surfaces with a `View What's New` action that opens the GitHub release page. First-ever install is silent.
- **Manual check**: `Mark It Down: Check for Updates` from the command palette.
- **Setting**: `markItDown.updates.checkOnLaunch` (default `true`).
- **Electron app**: `electron-updater` wired with `provider: github`. App checks on launch, downloads in background, prompts the user to install on next quit OR restart now. `autoInstallOnAppQuit` defaults to `false` — explicit user opt-in for silent installs.
- **Help → Check for Updates…** menu item in the Electron app.
- **package.json#build.publish** block configures the GitHub provider for electron-updater.
- **`.github/workflows/release.yml`**: tag-push pipeline (`v*.*.*`) builds Electron installers (mac/win/linux matrix) + `.vsix` (vsce package) + auto-publishes to Marketplace if `VSCE_PAT` is set; release body is extracted verbatim from the matching CHANGELOG `## [X.Y.Z]` section.
- **Docs**: `docs/auto-update.md` (what users see) + `docs/releasing.md` (full release runbook with rollback recipe + common failures table).
- **macOS auto-update caveat**: requires signed + notarized DMG. Wire `CSC_LINK` + Apple credentials into the release workflow's env block when ready; until then unsigned macOS builds install fine but can't apply updates.

### Added — Phase 0.13: Claude Code plugin (mark-it-down-claude) (#14)

- New `plugins/mark-it-down-claude/` packages the bundled MCP server, 6 user-invocable skills, and 3 specialist sub-agents into a single Claude Code plugin
- Skills: `/mid:new-note`, `/mid:list-notes`, `/mid:open`, `/mid:slideshow`, `/mid:publish`, `/mid:warehouse-status`
- Agents: `notes-curator` (audit + organize warehouse), `slideshow-designer` (restructure markdown into talk-ready decks), `note-summarizer` (single-note / category / theme digests)
- `.mcp.json` ships the bundled server entry — `${CLAUDE_PLUGIN_ROOT}/bin/server.js --notes-dir ${MID_NOTES_DIR}` — defaults `MID_NOTES_DIR` to `~/.mark-it-down/notes` for standalone use; users with the VSCode extension override to point at the extension's globalStorage notes dir so both clients see the same store
- New `npm run build:claude-plugin` script: re-runs `compile:mcp` and copies `out/mcp/server.js` → `plugins/mark-it-down-claude/bin/server.js`
- README in the plugin dir covers install (local + marketplace), per-OS notes-dir defaults, skill/agent reference
- Plugin version is independent of the VSCode extension (manifest at `0.1.0`); for marketplace distribution, the plugin directory is intended to be synced to its own repo `fadymondy/mark-it-down-claude`

### Added — Phase 0.12: Standalone Electron app — first cut (#13)

- New `apps/electron/` ships a working standalone desktop app: main process + sandboxed renderer + preload IPC bridge + native menus
- Renderer reuses marked + marked-highlight + highlight.js + mermaid + DOMPurify (same versions as the VSCode webview); standalone palette with system light/dark switch via `nativeTheme`
- File menu: Open Markdown… (Cmd/Ctrl+O), Save (Cmd/Ctrl+S); standard Edit, View, Help menus; macOS app menu when running on macOS
- External links open in the OS default browser via `shell.openExternal`
- New npm scripts: `compile:electron` (tsc main+preload + esbuild renderer + copy HTML/CSS), `dev:electron` (compile + launch with DevTools), `dist:electron` (electron-builder for mac DMG + win NSIS + linux AppImage/deb)
- electron-builder config under `package.json#build` with `extraMetadata.main` override so the same package.json works for both VSCode and Electron
- **Deferred and documented in [docs/electron-app.md#whats-deferred-and-why](docs/electron-app.md#whats-deferred-and-why)**: full `packages/core/` extraction, CodeMirror in Edit mode, notes sidebar, warehouse, publish, slideshow, MCP install command on the Electron side, file watching, multi-tab/window, code signing/notarization, CI matrix. v0.12 is a parallel renderer with ~200 LOC of intentional duplication; the extraction is its own multi-day refactor tracked separately.

### Added — Phase 0.11: Slideshow export (#12)

- Convert any markdown into a [reveal.js](https://revealjs.com) slideshow — `---` for horizontal slide breaks, `--` for vertical sub-slides, optional YAML frontmatter for `theme` / `transition` / `title` / `speakerNotes`
- `Mark It Down: Slideshow: Preview Local` opens a webview panel beside the editor with reveal.js + mermaid + highlight.js loaded from JSDelivr at view time (CSP relaxed scoped to that panel only)
- `Mark It Down: Slideshow: Publish` reuses the F10 publish pipeline — pushes a single self-contained HTML to `<publish-branch>/<publish-path>/slides/<basename>.html`, surfaces an info toast with Open / Copy URL actions
- `Mark It Down: Slideshow: Copy Share URL` and `Slideshow: Export to PDF` (the PDF command currently surfaces a defer-notice pointing at reveal's built-in `?print-pdf` browser print mode)
- 3 new settings: `markItDown.slideshow.theme` (12 reveal themes), `.transition` (6 styles), `.includeSpeakerNotes`
- `Notes:` block at the end of any slide body becomes reveal speaker notes (`<aside class="notes">`)
- Mermaid + code highlighting work in slides via the same render pipeline as the rest of Mark It Down

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
