import * as vscode from 'vscode';
import { buildWebviewHtml } from './webviewBuilder';

type Mode = 'view' | 'edit';

interface PanelState {
  mode: Mode;
  document: vscode.TextDocument;
}

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'markItDown.editor';

  private readonly panels = new Map<string, { panel: vscode.WebviewPanel; state: PanelState }>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('markItDown');
    const startMode = (config.get<Mode>('startMode') ?? 'view') satisfies Mode;
    const themePreference = config.get<string>('theme') ?? 'auto';

    const state: PanelState = { mode: startMode, document };
    this.panels.set(document.uri.toString(), { panel: webviewPanel, state });

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };

    webviewPanel.webview.html = buildWebviewHtml(
      webviewPanel.webview,
      this.context.extensionUri,
      this.resolveTheme(themePreference),
    );

    const sendUpdate = () => {
      webviewPanel.webview.postMessage({
        type: 'update',
        text: document.getText(),
        mode: state.mode,
        themeKind: vscode.window.activeColorTheme.kind,
      });
    };

    const docSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        sendUpdate();
      }
    });

    const themeSub = vscode.window.onDidChangeActiveColorTheme(() => sendUpdate());

    webviewPanel.onDidDispose(() => {
      docSub.dispose();
      themeSub.dispose();
      this.panels.delete(document.uri.toString());
    });

    webviewPanel.webview.onDidReceiveMessage(async msg => {
      switch (msg?.type) {
        case 'ready':
          sendUpdate();
          return;
        case 'edit': {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            String(msg.text ?? ''),
          );
          await vscode.workspace.applyEdit(edit);
          return;
        }
        case 'setMode': {
          if (msg.mode === 'view' || msg.mode === 'edit') {
            state.mode = msg.mode;
            sendUpdate();
          }
          return;
        }
        case 'openExternal':
          if (typeof msg.url === 'string') {
            vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
          return;
        case 'copy':
          if (typeof msg.text === 'string') {
            await vscode.env.clipboard.writeText(msg.text);
            vscode.window.setStatusBarMessage('Mark It Down: copied', 1500);
          }
          return;
      }
    });
  }

  public toggleActiveMode(): void {
    const active = vscode.window.activeTextEditor?.document.uri.toString();
    const target = active && this.panels.has(active)
      ? this.panels.get(active)
      : [...this.panels.values()].find(p => p.panel.active);
    if (!target) {
      return;
    }
    const next: Mode = target.state.mode === 'view' ? 'edit' : 'view';
    target.state.mode = next;
    target.panel.webview.postMessage({
      type: 'update',
      text: target.state.document.getText(),
      mode: next,
      themeKind: vscode.window.activeColorTheme.kind,
    });
  }

  private resolveTheme(preference: string): string {
    if (preference !== 'auto') {
      return preference;
    }
    return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
      ? 'dark'
      : 'light';
  }
}
