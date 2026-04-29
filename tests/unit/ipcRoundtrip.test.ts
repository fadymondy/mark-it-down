import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { IpcClient } from '../../src/mcp/ipcClient';
import { IpcRequest, IpcResponse } from '../../src/mcp/ipcProtocol';

// Spin up a minimal server that mimics McpIpcServer's wire protocol.
// We don't import McpIpcServer directly because it pulls in vscode (mocked
// elsewhere) but its handler reaches into vscode.window.activeTextEditor
// which the mock leaves undefined — so the round-trip would always come
// back null. Testing the protocol itself is cleaner.

describe('IpcClient ↔ server round-trip', () => {
  let endpoint: string;
  let server: net.Server;

  beforeAll(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mid-ipc-test-'));
    endpoint = os.platform() === 'win32'
      ? `\\\\.\\pipe\\mid-ipc-test-${Date.now()}`
      : path.join(dir, 'mid-mcp.sock');
    server = net.createServer(socket => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => {
        buffer += chunk;
        let i: number;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (!line) continue;
          const req = JSON.parse(line) as IpcRequest;
          let resp: IpcResponse;
          if (req.method === 'ping') {
            resp = { id: req.id, ok: true, result: { pong: true, version: '0.0.0-test' } };
          } else if (req.method === 'get_active_markdown') {
            resp = { id: req.id, ok: true, result: null };
          } else if (req.method === 'list_open_md') {
            resp = { id: req.id, ok: true, result: [] };
          } else {
            resp = { id: req.id, ok: false, error: 'unknown method' };
          }
          socket.write(JSON.stringify(resp) + '\n');
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint, resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (os.platform() !== 'win32') {
      await fs.unlink(endpoint).catch(() => undefined);
    }
  });

  it('ping returns pong with the server version', async () => {
    const client = new IpcClient(endpoint);
    const result = await client.ping();
    expect(result.pong).toBe(true);
    expect(result.version).toBe('0.0.0-test');
  });

  it('get_active_markdown returns null when no active editor', async () => {
    const client = new IpcClient(endpoint);
    const result = await client.getActiveMarkdown();
    expect(result).toBeNull();
  });

  it('list_open_md returns an empty array when no open documents', async () => {
    const client = new IpcClient(endpoint);
    const result = await client.listOpenMarkdown();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});
