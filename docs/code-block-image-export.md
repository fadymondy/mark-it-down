# Code-block Image Export

Status: shipped in Phase 0.4 · Issue: [#4](https://github.com/fadymondy/mark-it-down/issues/4)

Each rendered code block in View mode now ships an **PNG** action next to **Copy** that exports the block as a self-contained PNG image — preserving syntax highlighting, the active VSCode theme background, and the typography exactly as they appear on screen. Useful for slide decks, blog posts, social shares.

## At a glance

| | |
|---|---|
| **Where** | Hover any rendered code block in View mode → toolbar (top-right) → `PNG` button |
| **Engine** | [html-to-image](https://www.npmjs.com/package/html-to-image) — DOM → canvas → PNG, no server roundtrip |
| **Output** | PNG at 2× pixel ratio (Retina-friendly), background matches the active VSCode editor background, rounded corners preserved |
| **Save target** | VSCode `showSaveDialog` defaulting to the markdown file's directory with a slugified filename like `typescript-snippet-3.png` |
| **After save** | Information toast with `Open` (in default app) and `Reveal` (in OS file manager) actions |

## How it works

1. The code-block toolbar is augmented with a `PNG` button next to the existing `Copy`.
2. On click, the webview:
   - Hides the toolbar temporarily (so it doesn't appear in the captured image)
   - Reads `--vscode-editor-background` for an accurate background
   - Calls `toPng(pre, { pixelRatio: 2, backgroundColor, style: { boxShadow: 'none', borderRadius: '6px' } })`
   - Restores the toolbar
   - Posts `{ type: 'saveCodeImage', dataUrl, suggestedName }` to the extension host
3. The host:
   - Decodes the data URL into a `Buffer`
   - Suggests `<lang>-snippet-<n>.png` next to the markdown file
   - Opens `vscode.window.showSaveDialog`
   - Writes the buffer with `vscode.workspace.fs.writeFile`
   - Shows an info toast with `Open` / `Reveal` actions

If anything fails (DOM serialization error, CSP block on a remote font, etc.), the webview posts `{ type: 'showError', message }` and the host surfaces it via `showErrorMessage`. The toolbar is restored regardless via a `try/finally`.

## What's preserved

- Syntax highlighting (highlight.js classes + the active CSS rules)
- Background color (`--vscode-editor-background`)
- Font family (`--vscode-editor-font-family`)
- Border radius and 1px border from the existing `<pre>` styling
- Padding (so the code doesn't bleed against the image edge)

What's stripped:

- The hover toolbar (Copy / PNG buttons) — would clutter the export
- Box shadow (none in current styles, but explicitly disabled for the export)

## Edge cases & limitations

- **Very wide code lines**: the PNG renders the full width of the `<pre>` as it appears on screen. If the code overflows horizontally and the user scrolled right, the visible area is what's captured. To capture the entire block, scroll the `<pre>` to the start before clicking `PNG`.
- **Mermaid blocks**: the `attachCodeActions()` selector only matches `pre`, not `.mermaid` divs, so PNG export is intentionally limited to highlighted code. Mermaid diagrams have their own zoom/pan/copy controls (see [mermaid-polish.md](mermaid-polish.md)); a similar PNG export for mermaid is a future-work seed.
- **Remote fonts**: html-to-image inlines images by re-fetching them as data URIs. If a code block embeds a remote `<img>` (rare in syntax-highlighted code), the CSP's `img-src https:` lets that fetch succeed. If a font-face references a remote URL, `html-to-image` does not inline fonts — fallback fonts may be used in the rendered PNG. The webview uses VSCode's monospace font (`var(--vscode-editor-font-family)`), which is system-installed, so this is rarely a problem.
- **Save cancelled**: clicking `Cancel` in the save dialog is silent; no error toast.
- **Pixel ratio**: fixed at `2` for Retina output. A user setting (`markItDown.codeBlock.exportPixelRatio`) is a future addition; not in v0.4.

## Files of interest

- [src/webview/main.ts](../src/webview/main.ts) — `attachCodeActions` adds the PNG button; `exportCodeBlockAsPng` hides the toolbar, calls `toPng`, and posts the `saveCodeImage` message
- [src/editor/markdownEditorProvider.ts](../src/editor/markdownEditorProvider.ts) — host-side `saveCodeImage` and `showError` message handlers; `saveCodeImage` does the data-URL → buffer → save-dialog → write flow
- [package.json](../package.json) — `html-to-image` runtime dep
