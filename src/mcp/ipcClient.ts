import * as net from 'net';
import { ActiveMarkdown, IpcRequest, IpcResponse, OpenMarkdownEntry } from './ipcProtocol';

const REQUEST_TIMEOUT_MS = 3_000;

/**
 * Connects to the extension-side IPC server lazily, one connection per
 * request. Cheap enough at MCP's call volume; sidesteps the need for
 * connection-pool / reconnect logic.
 */
export class IpcClient {
  constructor(private readonly endpoint: string) {}

  async getActiveMarkdown(): Promise<ActiveMarkdown | null> {
    const result = await this.send({ method: 'get_active_markdown' });
    return result as ActiveMarkdown | null;
  }

  async listOpenMarkdown(): Promise<OpenMarkdownEntry[]> {
    const result = await this.send({ method: 'list_open_md' });
    return result as OpenMarkdownEntry[];
  }

  async ping(): Promise<{ pong: boolean; version: string }> {
    const result = await this.send({ method: 'ping' });
    return result as { pong: boolean; version: string };
  }

  private send(payload: { method: IpcRequest['method']; params?: Record<string, unknown> }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.endpoint);
      const id = Math.floor(Math.random() * 2 ** 31);
      let buffer = '';
      const timeout = setTimeout(() => {
        socket.destroy(new Error(`IPC request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      socket.setEncoding('utf8');
      socket.on('connect', () => {
        const req: IpcRequest = { id, method: payload.method, params: payload.params };
        socket.write(JSON.stringify(req) + '\n');
      });
      socket.on('data', chunk => {
        buffer += chunk;
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx < 0) return;
        const line = buffer.slice(0, newlineIdx).trim();
        clearTimeout(timeout);
        try {
          const response = JSON.parse(line) as IpcResponse;
          socket.end();
          if (response.ok) {
            resolve(response.result);
          } else {
            reject(new Error(response.error));
          }
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      });
      socket.on('error', err => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}
