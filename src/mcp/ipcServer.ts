import * as net from 'net';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { ActiveMarkdown, IpcRequest, IpcResponse, ipcEndpoint, OpenMarkdownEntry } from './ipcProtocol';

const MARKDOWN_LANGS = new Set(['markdown', 'mdx']);

export class McpIpcServer implements vscode.Disposable {
  private server: net.Server | undefined;
  private readonly endpoint: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.endpoint = ipcEndpoint(context.globalStorageUri.fsPath);
  }

  public async start(): Promise<void> {
    if (os.platform() !== 'win32') {
      // Stale socket file from a crashed previous instance? clean up first.
      try {
        await fs.unlink(this.endpoint);
      } catch {
        // not present — fine
      }
      try {
        await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
      } catch {
        // ignore
      }
    }
    this.server = net.createServer(socket => this.handleConnection(socket));
    this.server.on('error', err => {
      console.warn('[mid-ipc] listener error:', err.message);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.endpoint, () => resolve());
      this.server!.once('error', reject);
    });
  }

  public dispose(): void {
    this.server?.close();
    if (os.platform() !== 'win32') {
      void fs.unlink(this.endpoint).catch(() => undefined);
    }
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line.length === 0) continue;
        try {
          const request = JSON.parse(line) as IpcRequest;
          void this.handleRequest(request).then(response => {
            socket.write(JSON.stringify(response) + '\n');
          });
        } catch {
          socket.write(
            JSON.stringify({ id: -1, ok: false, error: 'malformed JSON' } satisfies IpcResponse) + '\n',
          );
        }
      }
    });
    socket.on('error', () => {
      // Client disconnected mid-request; nothing to do.
    });
  }

  private async handleRequest(req: IpcRequest): Promise<IpcResponse> {
    try {
      switch (req.method) {
        case 'ping':
          return { id: req.id, ok: true, result: { pong: true, version: this.extensionVersion() } };
        case 'get_active_markdown':
          return { id: req.id, ok: true, result: this.activeMarkdown() };
        case 'list_open_md':
          return { id: req.id, ok: true, result: this.listOpenMarkdown() };
        default:
          return { id: req.id, ok: false, error: `unknown method: ${(req as { method: string }).method}` };
      }
    } catch (err) {
      return { id: req.id, ok: false, error: (err as Error).message };
    }
  }

  private activeMarkdown(): ActiveMarkdown | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    const doc = editor.document;
    if (!MARKDOWN_LANGS.has(doc.languageId)) return null;
    return {
      uri: doc.uri.toString(),
      fsPath: doc.uri.fsPath,
      content: doc.getText(),
      isDirty: doc.isDirty,
      languageId: doc.languageId,
    };
  }

  private listOpenMarkdown(): OpenMarkdownEntry[] {
    const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
    return vscode.workspace.textDocuments
      .filter(d => MARKDOWN_LANGS.has(d.languageId))
      .map(d => ({
        uri: d.uri.toString(),
        fsPath: d.uri.fsPath,
        isDirty: d.isDirty,
        isActive: d.uri.toString() === activeUri,
      }));
  }

  private extensionVersion(): string {
    return this.context.extension?.packageJSON?.version ?? '0.0.0';
  }
}
