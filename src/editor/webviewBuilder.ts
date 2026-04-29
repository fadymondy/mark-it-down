import * as vscode from 'vscode';
import { findTheme, paletteToCss } from '../themes/themes';

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function nonce(): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  return s;
}

export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  theme: string,
): string {
  const n = nonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.js'),
  );

  // Custom theme overrides — only emitted when a non-auto theme is selected.
  const themeDef = theme === 'auto' ? undefined : findTheme(theme);
  const themeOverride = themeDef
    ? `:root[data-theme="${theme}"] { ${paletteToCss(themeDef.palette)} color-scheme: ${themeDef.kind}; }`
    : '';

  return /* html */ `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" data-theme-kind="${themeDef?.kind ?? 'auto'}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    img-src ${webview.cspSource} https: data:;
    style-src ${webview.cspSource} 'unsafe-inline';
    font-src ${webview.cspSource};
    script-src 'nonce-${n}';
  " />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mark It Down</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --fg-muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --link: var(--vscode-textLink-foreground);
      --link-hover: var(--vscode-textLink-activeForeground);
      --code-bg: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.08));
      --inline-code-bg: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12));
      --table-stripe: rgba(127,127,127,0.06);
      --accent: var(--vscode-textLink-foreground);
    }
    ${themeOverride}
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
      font-size: 14px;
      line-height: 1.65;
      color: var(--fg);
      background: var(--bg);
      overflow-x: hidden;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(6px);
    }
    .toolbar button {
      padding: 4px 10px;
      font-size: 12px;
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 4px;
      cursor: pointer;
    }
    .toolbar button:hover { background: rgba(127,127,127,0.08); }
    .toolbar button.active {
      background: var(--accent);
      color: var(--vscode-button-foreground, #fff);
      border-color: var(--accent);
    }
    .toolbar .title {
      font-size: 12px;
      color: var(--fg-muted);
      margin-left: auto;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
      padding: 32px 48px 96px;
    }
    main.editing {
      max-width: none;
      padding: 0;
    }
    /* Render styles ----------------------------------------------------- */
    main.viewing h1, main.viewing h2 { border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
    main.viewing h1 { font-size: 2em; margin-top: 0.6em; }
    main.viewing h2 { font-size: 1.5em; margin-top: 1.4em; }
    main.viewing h3 { font-size: 1.25em; margin-top: 1.2em; }
    main.viewing p { margin: 0.8em 0; }
    main.viewing a { color: var(--link); text-decoration: none; }
    main.viewing a:hover { text-decoration: underline; color: var(--link-hover); }
    main.viewing code { background: var(--inline-code-bg); padding: 2px 6px; border-radius: 4px; font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 0.92em; }
    main.viewing pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px 16px;
      overflow-x: auto;
      position: relative;
      margin: 1em 0;
    }
    main.viewing pre code { background: transparent; padding: 0; font-size: 0.88em; line-height: 1.55; }
    .code-actions {
      position: absolute;
      top: 6px;
      right: 6px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    main.viewing pre:hover .code-actions { opacity: 1; }
    .code-actions button {
      font-size: 11px;
      padding: 2px 8px;
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 3px;
      cursor: pointer;
    }
    main.viewing blockquote {
      border-left: 3px solid var(--accent);
      padding: 4px 14px;
      margin: 1em 0;
      color: var(--fg-muted);
      background: var(--code-bg);
      border-radius: 0 6px 6px 0;
    }
    main.viewing .mid-table-wrap {
      margin: 1em 0;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--bg);
    }
    main.viewing .mid-table-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: var(--code-bg);
      border-bottom: 1px solid var(--border);
      font-size: 0.85em;
    }
    main.viewing .mid-table-label { color: var(--fg-muted); }
    main.viewing .mid-table-actions { display: flex; gap: 4px; }
    main.viewing .mid-table-actions button {
      font-size: 11px;
      padding: 2px 8px;
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 3px;
      cursor: pointer;
    }
    main.viewing .mid-table-actions button:hover { background: rgba(127,127,127,0.10); }
    main.viewing table {
      border-collapse: collapse;
      width: 100%;
      margin: 0;
      font-size: 0.95em;
    }
    main.viewing th, main.viewing td { padding: 8px 12px; border: 1px solid var(--border); text-align: left; }
    main.viewing th { background: var(--code-bg); font-weight: 600; }
    main.viewing tr:nth-child(even) td { background: var(--table-stripe); }
    main.viewing th.mid-sortable { cursor: pointer; user-select: none; }
    main.viewing th.mid-sortable:hover { background: rgba(127,127,127,0.12); }
    main.viewing th.mid-sortable:focus { outline: 2px solid var(--accent); outline-offset: -2px; }
    .toolbar button:focus-visible, .mid-table-actions button:focus-visible, .mid-controls button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    main.viewing .mid-sort-indicator { font-size: 0.75em; opacity: 0.6; margin-left: 4px; }
    main.viewing th[data-sort="asc"] .mid-sort-indicator,
    main.viewing th[data-sort="desc"] .mid-sort-indicator { opacity: 1; }
    main.viewing img { max-width: 100%; border-radius: 4px; }
    main.viewing hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
    main.viewing ul, main.viewing ol { padding-left: 1.4em; }
    main.viewing li { margin: 0.3em 0; }
    main.viewing input[type="checkbox"] { margin-right: 6px; }
    main.viewing .mermaid {
      position: relative;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px;
      margin: 1em 0;
      text-align: center;
      overflow: hidden;
      min-height: 60px;
    }
    main.viewing .mermaid-stage {
      cursor: grab;
      transform-origin: 0 0;
      transition: transform 0.06s linear;
      display: inline-block;
      will-change: transform;
    }
    main.viewing .mermaid-stage.mermaid-grabbing { cursor: grabbing; transition: none; }
    main.viewing .mermaid-stage svg { max-width: none; }
    main.viewing .mermaid-controls {
      position: absolute;
      top: 6px;
      right: 6px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 2;
    }
    main.viewing .mermaid:hover .mermaid-controls { opacity: 1; }
    main.viewing .mermaid-controls button {
      font-size: 11px;
      padding: 2px 8px;
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 3px;
      cursor: pointer;
      min-width: 24px;
    }
    main.viewing .mermaid-controls button:hover { background: rgba(127,127,127,0.10); }
    main.viewing .mermaid-error {
      text-align: left;
      cursor: default;
    }
    main.viewing .mermaid-error-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: var(--vscode-errorForeground, #d04444);
      font-size: 0.92em;
    }
    main.viewing .mermaid-error-title { font-weight: 600; }
    main.viewing .mermaid-error-message { font-family: var(--vscode-editor-font-family, monospace); }
    main.viewing .mermaid-error details { color: var(--fg-muted); }
    main.viewing .mermaid-error details summary { cursor: pointer; user-select: none; }
    main.viewing .mermaid-error details pre {
      background: rgba(127,127,127,0.10);
      padding: 8px 10px;
      border-radius: 4px;
      overflow-x: auto;
      margin-top: 6px;
      font-size: 0.92em;
    }
    /* Editor mode (Phase 0.2 will replace this with Monaco) -------------- */
    .editor {
      width: 100%;
      height: calc(100vh - 38px);
      box-sizing: border-box;
      padding: 16px 24px;
      font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
      font-size: var(--vscode-editor-font-size, 14px);
      line-height: 1.55;
      background: var(--bg);
      color: var(--fg);
      border: 0;
      outline: none;
      resize: none;
      tab-size: 2;
      white-space: pre;
    }
    .placeholder {
      color: var(--fg-muted);
      padding: 32px 48px;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="toolbar" role="toolbar" aria-label="Mark It Down view mode">
    <button id="mode-view" class="active" title="View mode" aria-label="Switch to View mode" aria-pressed="true">📖 View</button>
    <button id="mode-edit" title="Edit mode" aria-label="Switch to Edit mode" aria-pressed="false">✏️ Edit</button>
    <span class="title" id="filename">—</span>
  </div>
  <main id="root" class="viewing">
    <p class="placeholder">Loading…</p>
  </main>
  <script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
}
