# Standalone Electron App

Status: shipped (first-cut) in Phase 0.12 · Issue: [#13](https://github.com/fadymondy/mark-it-down/issues/13) · Depends on: [#2 Code editor](code-editor.md), [#7 Notes sidebar](notes-sidebar.md), [#8 Theme bridge](themes.md)

A working **first-cut** Electron app that ships the Mark It Down rendering pipeline as a standalone desktop application — no VSCode required. Cross-platform packaging via `electron-builder` (mac / win / linux). The full architectural extract (a shared `packages/core/` consumed by both VSCode wrapper and Electron wrapper) is **deferred and documented** in this page; what ships in v0.12 is a parallel renderer + native shell + dev/dist scripts, with a clear path forward.

## At a glance

| | |
|---|---|
| **Where** | `apps/electron/` — main process + preload + renderer; built into `out/electron/` |
| **Stack** | Electron 38+ · TypeScript · esbuild for the renderer · electron-builder for distribution |
| **Renderer** | Reuses marked + marked-highlight + highlight.js + mermaid + DOMPurify (same versions as the VSCode webview) |
| **Native menus** | macOS app menu, File (Open / Save), Edit, View, Help |
| **Dev** | `npm run dev:electron` — builds and launches with DevTools |
| **Distribute** | `npm run dist:electron` — builds installers for mac (DMG arm64+x64), win (NSIS), linux (AppImage + deb) |
| **What's deferred** | Full `packages/core/` extract; F6 notes sidebar; F9 warehouse; F10 publish; F11 slideshow; F8 MCP install (none of the higher-level features are wired into the Electron wrapper yet) |

## What works in v0.12

- Open a `.md` file via **Cmd/Ctrl+O** or the title-bar button → renderer pulls content via the preload IPC bridge → the document renders with the same marked + highlight.js + mermaid + DOMPurify pipeline as the VSCode webview
- Toggle between **View** and **Edit** modes (Edit is a textarea — CodeMirror integration is a follow-up; the v0.2 CodeMirror approach works in browser context, the wiring is straightforward but not in this commit)
- Save with **Cmd/Ctrl+S** (or `Save As` if no path is set)
- System theme bridge: `nativeTheme` light/dark drives the renderer's `--vscode-*`-equivalent CSS variables (the renderer ships its own GitHub-style palette, switched via a `.dark` class on `<html>`)
- External links open in the OS default browser (via `shell.openExternal`)
- Mermaid diagrams render with theme-matched mermaid theme (auto-switches when the system theme changes)

## How it's wired

```
apps/electron/
├── main.ts              ← Main process: BrowserWindow, IPC handlers, native menus, theme listener
├── preload.ts           ← contextBridge: exposes window.mid for the renderer (sandboxed)
├── tsconfig.json        ← Compiles main + preload to out/electron/
└── renderer/
    ├── index.html       ← The Mark It Down shell (titlebar + main viewport)
    ├── renderer.ts      ← marked + mermaid + DOMPurify rendering, mode toggle, IPC calls
    └── renderer.css     ← Standalone palette (no --vscode-* fallbacks)

out/electron/
├── main.js              ← from `tsc apps/electron/tsconfig.json`
├── preload.js           ← same
└── renderer/
    ├── index.html       ← copied verbatim
    ├── renderer.js      ← from esbuild (bundles marked/mermaid/etc.)
    └── renderer.css     ← copied verbatim
```

The renderer runs sandboxed (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`); preload-bridged IPC is the only host capability available. CSP is `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:;` — strict, no remote scripts.

## Commands & menus

| Menu / Shortcut | Action |
|---|---|
| File → Open Markdown… (Cmd/Ctrl+O) | Open file dialog → load into the renderer |
| File → Save (Cmd/Ctrl+S) | Save current path or open Save As dialog |
| View → Reload / Force Reload / Toggle DevTools / Zoom | Standard Electron `view` menu |
| Help → Mark It Down on GitHub | Opens the repo in the browser |

## Building & distributing

### Local development

```bash
npm run dev:electron
```

This:
1. Runs `npm run compile` (extension + webview + mcp — guarantees the source compiles)
2. Runs `npm run compile:electron` (tsc main+preload, esbuild renderer, copy HTML/CSS)
3. Launches Electron with `MID_DEV=1` (opens DevTools detached)

### Building installers

```bash
npm run dist:electron
```

Runs the same compile chain then `electron-builder --mac --win --linux`. Output lands in `dist/electron/`.

| Platform | Target | Notes |
|---|---|---|
| macOS | DMG (universal: arm64 + x64) | Notarization not configured — add `MID_NOTARIZE=1` env + Apple Developer creds for a future ship-ready build |
| Windows | NSIS installer (x64) | Code signing not configured — sideload-only until certs are wired up |
| Linux | AppImage (x64) + deb (x64) | No additional config needed |

The `build` block in `package.json` controls layout. `extraMetadata.main = "out/electron/main.js"` overrides the VSCode entrypoint at packaging time so the same `package.json` works for both wrappers.

## What's deferred (and why)

The issue spec calls for a **full architectural fan-in**: extract a shared `packages/core/` that both the VSCode extension and the Electron app consume, with no VSCode API leakage into core. That's a multi-day refactor that touches every existing module:

- `NotesStore` would need an abstract `MetadataStore` interface (impl: VSCode workspaceState/globalState; impl: Electron `electron-store`)
- `WarehouseManager` would need to factor the VSCode `Uri.fsPath` / `vscode.workspace.fs` calls behind a `FileSystem` interface
- `MarkdownEditorProvider` would split into a "registers a custom editor" wrapper (VSCode-only) and a `MarkdownDocument` core
- The webview rendering pipeline (CodeMirror, marked, mermaid, theme bridge, sortable tables, exports) would move to `packages/core/renderer/` and both wrappers would mount it
- The MCP server (already separate) would import from `packages/core/notes-fs/` instead of redefining `NotesAdapter`
- npm/pnpm workspaces wired up; CI matrix updated; release workflow split per target

Doing that refactor safely requires careful migration of the existing test surfaces (which don't exist yet — see the recurring "no automated test suite" note). Rushing it in a single session would create more debt than value.

**What v0.12 ships instead**: a parallel Electron renderer that *imports the same npm packages* and reuses the same patterns. The Electron renderer's `renderer.ts` is intentionally a slimmed-down clone of `src/webview/main.ts` minus the VSCode-specific bits; updates to the shared rendering logic need to be applied in both places until the extraction is done. The duplication is small (~200 LOC) and well-marked.

A separate issue should track the `packages/core/` extraction — see [F12-followup: extract packages/core](https://github.com/fadymondy/mark-it-down/issues) (open one when you're ready to budget the time).

## Known limitations of the v0.12 ship

- **No CodeMirror in Edit mode yet** — Electron renderer uses a plain textarea (matches the original Phase 0.1 VSCode editor). Wiring CodeMirror is a 30-LOC change once the renderer module is shared.
- **No notes sidebar / warehouse / publish / slideshow / MCP-install** — only the core view/edit experience is wired. The existing modules depend on `vscode.*` APIs and need the abstraction work above before they can run in Electron.
- **No file watching for external edits** — the renderer doesn't notice when the open file changes on disk under it. Standard Node `fs.watch` integration is straightforward and a future PR.
- **No tabs / multi-window** — single-document at a time. Cmd/Ctrl+O replaces the current document.
- **No code signing or notarization** — the build commands produce installers, but they're sideload-only on macOS/Windows until certs are wired up. Linux AppImage and deb work out of the box.
- **No CI matrix** — `npm run dist:electron` works locally; a GitHub Actions matrix building on macOS/Windows/Linux runners is a next step.

## Edge cases & behavior notes

- **Sandboxed renderer + preload only**: every host capability the renderer uses goes through `window.mid.*` (defined in `preload.ts`). Adding a new capability = adding both an `ipcMain.handle()` in `main.ts` and an `ipcRenderer.invoke` wrapper in `preload.ts`. Don't reach for `nodeIntegration: true` — it's deliberately off.
- **CSP**: matches the strict CSP we use in the VSCode webview. If you need to load remote content (e.g. mermaid CDN like in the slideshow), do it in a separate window with its own CSP, not the main renderer.
- **macOS title bar**: uses `hiddenInset` so the traffic lights overlay the custom titlebar. On Windows/Linux the standard system frame is used — the custom titlebar still works because it's CSS-styled.
- **External links**: any `<a href="https://...">` click is intercepted in the renderer and forwarded to `shell.openExternal` via IPC. Internal anchor links (`#section`) work normally.

## Files of interest

- [apps/electron/main.ts](../apps/electron/main.ts) — main process: window creation, native menus, IPC handlers (read-file / write-file / open-dialog / save-dialog / get-app-info / open-external)
- [apps/electron/preload.ts](../apps/electron/preload.ts) — contextBridge exposing `window.mid` (typed)
- [apps/electron/renderer/index.html](../apps/electron/renderer/index.html) — shell HTML (titlebar + viewport)
- [apps/electron/renderer/renderer.ts](../apps/electron/renderer/renderer.ts) — render pipeline (marked + highlight + mermaid + DOMPurify), mode toggle, file open/save flow
- [apps/electron/renderer/renderer.css](../apps/electron/renderer/renderer.css) — standalone palette (no `--vscode-*` fallbacks; light/dark via `<html class="dark">`)
- [apps/electron/tsconfig.json](../apps/electron/tsconfig.json) — main+preload TS config; renderer is built by esbuild
- [package.json](../package.json) — `compile:electron`, `dev:electron`, `dist:electron` scripts; `build` block for electron-builder
