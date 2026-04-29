import * as vscode from 'vscode';
import { buildWebviewHtml } from './webviewBuilder';

type Mode = 'view' | 'edit';

interface PanelState {
  mode: Mode;
  document: vscode.TextDocument;
}

export interface NoteIndexEntry {
  id: string;
  title: string;
}

export interface NoteIndexProvider {
  list(): NoteIndexEntry[];
  /** Fires when the list changes. */
  onDidChange: vscode.Event<void>;
  /** Open a note by id (after a wiki-link click). */
  open(id: string): Promise<void>;
  /**
   * Pick one of several note ids when a wiki-link is ambiguous.
   * Resolves to the chosen id or undefined if cancelled.
   */
  pickAmbiguous(ids: string[]): Promise<string | undefined>;
  /**
   * Create a new note from a broken wiki-link click. Resolves to the new id
   * or undefined if cancelled.
   */
  createFromTitle(title: string): Promise<string | undefined>;
}

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'markItDown.editor';

  private readonly panels = new Map<string, { panel: vscode.WebviewPanel; state: PanelState }>();
  private noteIndexProvider?: NoteIndexProvider;
  private noteIndexSub?: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public attachNoteIndex(provider: NoteIndexProvider): vscode.Disposable {
    this.noteIndexProvider = provider;
    this.noteIndexSub?.dispose();
    this.noteIndexSub = provider.onDidChange(() => {
      for (const { panel, state } of this.panels.values()) {
        panel.webview.postMessage({
          type: 'update',
          text: state.document.getText(),
          mode: state.mode,
          themeKind: vscode.window.activeColorTheme.kind,
          notes: this.noteIndexProvider?.list() ?? [],
        });
      }
    });
    return new vscode.Disposable(() => {
      this.noteIndexSub?.dispose();
      this.noteIndexSub = undefined;
      this.noteIndexProvider = undefined;
    });
  }

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
        notes: this.noteIndexProvider?.list() ?? [],
      });
    };

    const docSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        sendUpdate();
      }
    });

    const themeSub = vscode.window.onDidChangeActiveColorTheme(() => sendUpdate());

    const cfgSub = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('markItDown.theme')) {
        const next = vscode.workspace.getConfiguration('markItDown').get<string>('theme') ?? 'auto';
        webviewPanel.webview.html = buildWebviewHtml(
          webviewPanel.webview,
          this.context.extensionUri,
          this.resolveTheme(next),
        );
      }
    });

    webviewPanel.onDidDispose(() => {
      docSub.dispose();
      themeSub.dispose();
      cfgSub.dispose();
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
        case 'saveTable':
          await this.saveTable(document, msg);
          return;
        case 'showError':
          if (typeof msg.message === 'string') {
            vscode.window.showErrorMessage(msg.message);
          }
          return;
        case 'openWikilink':
          await this.handleWikilinkClick(msg);
          return;
      }
    });
  }

  private async handleWikilinkClick(msg: {
    id?: unknown;
    ids?: unknown;
    target?: unknown;
  }): Promise<void> {
    const provider = this.noteIndexProvider;
    if (!provider) return;
    if (typeof msg.id === 'string' && msg.id.length > 0) {
      await provider.open(msg.id);
      return;
    }
    if (typeof msg.ids === 'string' && msg.ids.length > 0) {
      const ids = msg.ids.split(',').filter(Boolean);
      const picked = await provider.pickAmbiguous(ids);
      if (picked) await provider.open(picked);
      return;
    }
    if (typeof msg.target === 'string' && msg.target.length > 0) {
      const created = await provider.createFromTitle(msg.target);
      if (created) await provider.open(created);
    }
  }

  private async saveTable(
    document: vscode.TextDocument,
    msg: { format?: unknown; content?: unknown; contentBase64?: unknown; suggestedName?: unknown },
  ): Promise<void> {
    const format = msg.format === 'csv' || msg.format === 'tsv' || msg.format === 'xlsx' ? msg.format : null;
    if (!format) return;
    const baseName = String(msg.suggestedName ?? `table.${format}`).replace(/[^A-Za-z0-9._-]+/g, '-');
    const documentDir = vscode.Uri.joinPath(document.uri, '..');
    const defaultUri = vscode.Uri.joinPath(documentDir, baseName);
    const filterLabel = format === 'xlsx' ? 'Excel workbook' : format.toUpperCase();
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { [filterLabel]: [format] },
      title: `Mark It Down: save table as ${format.toUpperCase()}`,
    });
    if (!target) return;
    let buffer: Uint8Array;
    if (format === 'xlsx') {
      if (typeof msg.contentBase64 !== 'string') {
        vscode.window.showErrorMessage('Mark It Down: malformed xlsx payload — export aborted.');
        return;
      }
      buffer = Buffer.from(msg.contentBase64, 'base64');
    } else {
      const content = typeof msg.content === 'string' ? msg.content : '';
      buffer = Buffer.from(content, 'utf8');
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
      notes: this.noteIndexProvider?.list() ?? [],
    });
  }

  private resolveTheme(preference: string): string {
    // 'auto' returns 'auto' so the webview uses --vscode-* CSS variables.
    // Any other id is matched against the bundled theme set; if not found,
    // fall back to 'auto' so a typo in settings doesn't break rendering.
    if (preference === 'auto') return 'auto';
    return preference;
  }
}
