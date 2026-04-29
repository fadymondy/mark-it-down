import * as vscode from 'vscode';
import { ConflictRecord, ConflictRegistry } from './conflictRegistry';
import { NotesStore } from '../notes/notesStore';
import { log } from './warehouseLog';

const VIEW_TYPE = 'markItDown.warehouse.conflicts';

export class ConflictPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly registry: ConflictRegistry,
    private readonly store: NotesStore,
  ) {
    this.subs.push(
      registry.onDidChange(() => {
        if (this.panel) this.refresh();
      }),
    );
  }

  public reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.refresh();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Mark It Down — Warehouse Conflicts',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
    this.refresh();
  }

  public dispose(): void {
    this.panel?.dispose();
    this.subs.forEach(s => s.dispose());
  }

  private refresh(): void {
    if (!this.panel) return;
    const records = this.registry.list();
    this.panel.webview.html = this.renderHtml(records);
    this.panel.title =
      records.length > 0
        ? `Mark It Down — Conflicts (${records.length})`
        : 'Mark It Down — Conflicts';
  }

  private async handleMessage(msg: { type?: string; id?: string; choice?: string }): Promise<void> {
    if (!msg?.type || !msg.id) return;
    const record = this.registry.get(msg.id);
    if (!record) return;
    try {
      switch (msg.type) {
        case 'keepLocal':
          this.registry.resolve(msg.id);
          log('info', `conflict ${record.noteId} resolved by keeping local copy`);
          vscode.window.setStatusBarMessage(
            `Mark It Down: kept local copy of "${record.title}"`,
            3000,
          );
          break;
        case 'keepRemote':
          await this.store.importNote(
            { ...record.local, updatedAt: record.remote.updatedAt },
            record.remoteContent,
          );
          this.registry.resolve(msg.id);
          log('info', `conflict ${record.noteId} resolved by accepting remote copy`);
          vscode.window.setStatusBarMessage(
            `Mark It Down: replaced "${record.title}" with remote copy`,
            3000,
          );
          break;
        case 'skip':
          this.registry.resolve(msg.id);
          log('info', `conflict ${record.noteId} skipped (will re-surface on next sync if still diverged)`);
          break;
        default:
          return;
      }
      this.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Mark It Down: conflict resolution failed — ${(err as Error).message}`);
    }
  }

  private renderHtml(records: ConflictRecord[]): string {
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src ${this.panel!.webview.cspSource} 'unsafe-inline';`;
    const body =
      records.length === 0
        ? `<p class="empty">No conflicts. Run a Sync Now to populate.</p>`
        : records.map(record => this.renderConflict(record)).join('\n');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Mark It Down — Warehouse Conflicts</title>
<style>
  body {
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 20px;
    line-height: 1.55;
  }
  header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
  header h1 { margin: 0; font-size: 1.25em; }
  .count { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .conflict {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    margin-bottom: 18px;
    overflow: hidden;
  }
  .conflict-head {
    padding: 10px 14px;
    background: var(--vscode-textBlockQuote-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .conflict-head strong { font-weight: 600; }
  .conflict-head .meta { color: var(--vscode-descriptionForeground); font-size: 0.88em; }
  .panes { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--vscode-panel-border); }
  .pane { background: var(--vscode-editor-background); padding: 12px 14px; }
  .pane h2 { font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); margin: 0 0 8px; }
  .pane h2 .ts { float: right; font-weight: normal; text-transform: none; letter-spacing: 0; }
  .pane pre {
    background: var(--vscode-textBlockQuote-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 10px;
    overflow: auto;
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
    font-size: 0.88em;
    line-height: 1.45;
    margin: 0;
    max-height: 320px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .actions {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-textBlockQuote-background);
  }
  .actions button {
    padding: 6px 14px;
    font-size: 12px;
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    cursor: pointer;
  }
  .actions button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
  }
  .actions button:hover { filter: brightness(1.1); }
  .actions button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  @media (max-width: 720px) { .panes { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Warehouse conflicts</h1>
  <span class="count">${records.length} note${records.length === 1 ? '' : 's'} diverged</span>
</header>
${body}
<script>
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      vscode.postMessage({ type: btn.dataset.action, id: btn.dataset.id });
    });
  });
</script>
</body>
</html>`;
  }

  private renderConflict(record: ConflictRecord): string {
    const localTs = formatTs(record.local.updatedAt);
    const remoteTs = formatTs(record.remote.updatedAt);
    return `
<div class="conflict">
  <div class="conflict-head">
    <div>
      <strong>${escapeHtml(record.title)}</strong>
      <span class="meta">${escapeHtml(record.scope)} · ${escapeHtml(record.category)}</span>
    </div>
    <span class="meta">id: ${escapeHtml(record.noteId)}</span>
  </div>
  <div class="panes">
    <div class="pane">
      <h2>Local <span class="ts">${escapeHtml(localTs)}</span></h2>
      <pre>${escapeHtml(record.localContent)}</pre>
    </div>
    <div class="pane">
      <h2>Remote <span class="ts">${escapeHtml(remoteTs)}</span></h2>
      <pre>${escapeHtml(record.remoteContent)}</pre>
    </div>
  </div>
  <div class="actions">
    <button class="primary" data-action="keepLocal" data-id="${escapeHtml(record.noteId)}">Keep local</button>
    <button data-action="keepRemote" data-id="${escapeHtml(record.noteId)}">Replace with remote</button>
    <button data-action="skip" data-id="${escapeHtml(record.noteId)}">Skip</button>
  </div>
</div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function registerConflictPanelCommand(panel: ConflictPanel): vscode.Disposable {
  return vscode.commands.registerCommand('markItDown.warehouse.openConflicts', () => panel.reveal());
}
