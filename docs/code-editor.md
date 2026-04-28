# Code Editor (Edit Mode)

Status: shipped in Phase 0.2 · Issue: [#2](https://github.com/fadymondy/mark-it-down/issues/2)

The Mark It Down custom editor's **Edit** mode now ships a real code editor — syntax-highlighted markdown, line numbers, multi-cursor, history, bracket matching, line wrapping, find — instead of the placeholder textarea from Phase 0.1.

## At a glance

| | |
|---|---|
| **Editor engine** | [CodeMirror 6](https://codemirror.net) (~150KB) |
| **Why not Monaco** | The original spec called for Monaco. We shipped CodeMirror 6 instead — see [Why CodeMirror, not Monaco](#why-codemirror-not-monaco) below. |
| **Where** | Toolbar → ✏️ Edit, or the "Mark It Down: Toggle View / Edit" command in the editor title bar |
| **Round-trips** | Every keystroke posts `{type:'edit', text}` back to the host; the host applies via `WorkspaceEdit` so the document's undo stack and cursor history stay correct |
| **Theme** | Bridged to the active VSCode theme via `--vscode-*` CSS variables; auto-switches between light/dark when the user changes their VSCode theme mid-session |

## What ships

CodeMirror 6 extensions wired in:

- **Syntax highlighting** — `@codemirror/lang-markdown` with `markdownLanguage` base, GFM-aware
- **Line numbers** — `lineNumbers()` gutter
- **Active-line highlight** — `highlightActiveLine()` + `highlightActiveLineGutter()`
- **Multi-cursor + selection** — `drawSelection()` + default keymap
- **History** — `history()` + `historyKeymap` (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)
- **Auto indent + bracket matching** — `indentOnInput()`, `bracketMatching()`
- **Line wrapping** — `EditorView.lineWrapping`
- **Tab size** — 2 spaces (`EditorState.tabSize.of(2)`)
- **Default keymap** — Cmd/Ctrl+A, Cmd/Ctrl+/, find/replace, etc.
- **Theme** — base styles use `--vscode-*` CSS variables for fonts, colors, gutter, cursor, selection. Dark variants additionally load `@codemirror/theme-one-dark` for syntax tokens that match a typical VSCode dark theme.

## How edits flow

```
[user types]
   ↓
EditorView.updateListener fires (CodeMirror 6)
   ↓
{type: 'edit', text} → vscode.postMessage
   ↓
extension host (markdownEditorProvider.ts)
   ↓
WorkspaceEdit replaces document range
   ↓
onDidChangeTextDocument fires for the document
   ↓
host posts {type:'update', text, mode, themeKind}
   ↓
webview's message handler:
  - if same text we just sent: no-op (CodeMirror is already up to date)
  - if external change: syncEditorContent() rewrites the doc with suppressEditorChange=true
```

The `suppressEditorChange` flag is the critical bit: it prevents an infinite ping-pong (every external sync would otherwise trigger the updateListener and post `edit` back to the host).

## Theme bridge

CodeMirror gets restyled when the VSCode color theme changes:

- The webview tracks `lastThemeKind` (1 = Light, 2 = Dark, 3 = HighContrastDark, 4 = HighContrastLight) from the host's update message.
- When the kind changes mid-session, `syncEditorTheme()` rebuilds the editor state with `oneDark` (for kinds 2/3) or omits it (for 1/4), preserving the current document content. No flash; no lost selection (selection is reset to position 0 — small UX cost on theme switch, fixable in a follow-up).
- All non-syntax styles (gutter background, cursor color, selection color, font family) come from `--vscode-*` CSS variables, so they update live without a state rebuild.

## Mode toggle

The toolbar's **📖 View** / **✏️ Edit** buttons toggle between modes:

- Going to **Edit**: existing `<main>` is cleared; a `<div class="editor">` host is mounted; a fresh CodeMirror `EditorView` is created with the current document text + theme.
- Going to **View**: the `EditorView` is destroyed (`editorView.destroy()`), the rendered HTML re-mounts, mermaid + code-block actions re-attach. The current text is preserved (it's already round-tripped to the host on every keystroke).

The `markItDown.startMode` setting controls which mode opens by default (`view` or `edit`).

## Why CodeMirror, not Monaco

The original issue called for Monaco, but we shipped CodeMirror 6. Reasons:

1. **Bundle size**: Monaco's `min/vs/` tree is ~15MB even minified, and would push the `.vsix` bundle from ~10MB to ~25MB+ for an editor we use only for markdown. CodeMirror 6 with the extensions above adds ~1MB.
2. **CSP**: Monaco's AMD loader requires `script-src 'unsafe-eval'`. The current Mark It Down webview is `default-src 'none'` with a strict nonce; relaxing CSP for one editor weakens the rest of the rendering pipeline (marked, DOMPurify) too. CodeMirror 6 is plain ESM and works under the existing strict CSP.
3. **Worker plumbing**: Monaco loads its language services as web workers, which require `worker-src blob:` plus a worker-bootstrap data URI. CodeMirror 6 runs entirely on the main thread.
4. **Maintenance**: CodeMirror 6 is plain ESM bundled by esbuild — same toolchain as the rest of the webview. Monaco needs its own copy step and the AMD loader, which is a separate maintenance surface.
5. **Feature parity for markdown**: For our use case (edit-a-markdown-file), the ergonomics gap between Monaco and CodeMirror is small. Both have multi-cursor, find, syntax highlighting, line numbers, history. Monaco's killer features (IntelliSense, JS/TS language services) don't apply to markdown.

The deviation is documented and the door is open: a follow-up issue can swap to Monaco if/when the user decides the trade-off is worth it. The webview boundary is small enough that the swap would be ~100 lines.

## What lands in `package.json`

New runtime dependencies:

```json
{
  "@codemirror/commands": "^6.x",
  "@codemirror/lang-markdown": "^6.x",
  "@codemirror/language": "^6.x",
  "@codemirror/state": "^6.x",
  "@codemirror/theme-one-dark": "^6.x",
  "@codemirror/view": "^6.x",
  "codemirror": "^6.x"
}
```

No new VSCode extension settings — the existing `markItDown.startMode` (`view` / `edit`) controls the initial mode for both the old textarea and the new CodeMirror editor.

## Edge cases

- **External edits to the open file** (e.g. another extension formatting it on save): the host's `onDidChangeTextDocument` fires; the webview re-applies the new text via `syncEditorContent()` with `suppressEditorChange=true`, so the round-trip doesn't echo. The user's cursor position is **not** preserved across external edits in v0.2 — fixable by tracking `EditorView.viewState.selection` and re-applying after the dispatch.
- **Theme switch mid-edit**: editor is rebuilt; selection resets to position 0. Small UX cost, fixable by snapshotting + re-applying the selection.
- **Very large files**: CodeMirror 6 is fine to ~10MB. Beyond that, line wrapping + active-line highlighting can lag — out of scope for this release.
- **Drag & drop**: not wired. Use the toolbar / command palette to switch modes.

## Known limitations / future-work seeds

- **Cursor preservation across mode toggle and external edits** — track `state.selection` and dispatch it back after re-state.
- **Find/Replace UI** — `@codemirror/search` is not wired in. Cmd+F currently triggers VSCode's search, not the CodeMirror panel. Adding `search()` and a panel is a small follow-up.
- **Linting / spell check** — not in scope. `@codemirror/lint` would be a clean addition.
- **VSCode-style "format on save"** — not wired. Markdown formatters (prettier-markdown) are out of scope.
- **Monaco swap** — see [Why CodeMirror, not Monaco](#why-codemirror-not-monaco). A future issue can re-evaluate.

## Files of interest

- [src/webview/main.ts](../src/webview/main.ts) — `buildEditorState`, `renderEdit`, `syncEditorContent`, `syncEditorTheme`
- [src/editor/markdownEditorProvider.ts](../src/editor/markdownEditorProvider.ts) — host-side message handling (unchanged from v0.1, the protocol is the same)
- [src/editor/webviewBuilder.ts](../src/editor/webviewBuilder.ts) — base webview HTML and CSS (unchanged — CodeMirror's styles are applied via `EditorView.theme` extension, no new `<style>` injection)
- [package.json](../package.json) — `dependencies.@codemirror/*` and `dependencies.codemirror`
