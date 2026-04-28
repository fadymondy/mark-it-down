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
        case 'saveCodeImage':
          if (typeof msg.dataUrl === 'string') {
            await this.saveCodeImage(document, msg.dataUrl, String(msg.suggestedName ?? 'code-block'));
          }
          return;
        case 'showError':
          if (typeof msg.message === 'string') {
            vscode.window.showErrorMessage(msg.message);
          }
          return;
      }
    });
  }

  private async saveCodeImage(
    document: vscode.TextDocument,
    dataUrl: string,
    suggestedName: string,
  ): Promise<void> {
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
    if (!match) {
      vscode.window.showErrorMessage('Mark It Down: malformed image data — export aborted.');
      return;
    }
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const baseName = suggestedName.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 64) || 'code-block';
    const documentDir = vscode.Uri.joinPath(document.uri, '..');
    const defaultUri = vscode.Uri.joinPath(documentDir, `${baseName}.${ext}`);
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { Image: [ext] },
      title: 'Mark It Down: save code-block image',
    });
    if (!target) {
      return;
    }
    await vscode.workspace.fs.writeFile(target, buffer);
    const choice = await vscode.window.showInformationMessage(
      `Mark It Down: saved ${target.fsPath.split('/').pop()}`,
      'Open',
      'Reveal',
    );
    if (choice === 'Open') {
      await vscode.commands.executeCommand('vscode.open', target);
    } else if (choice === 'Reveal') {
      await vscode.commands.executeCommand('revealFileInOS', target);
    }
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
