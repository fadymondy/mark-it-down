import * as os from 'os';
import * as path from 'path';

/**
 * Newline-delimited JSON protocol for the extension <-> MCP-server channel.
 * Both sides write one JSON object per line. The extension is the server;
 * the MCP process is the client. Requests get a unique `id` so the client
 * can correlate replies; responses carry the same `id`.
 */

export interface IpcRequest {
  id: number;
  method: 'get_active_markdown' | 'list_open_md' | 'ping';
  params?: Record<string, unknown>;
}

export interface IpcResponseOk {
  id: number;
  ok: true;
  result: unknown;
}

export interface IpcResponseErr {
  id: number;
  ok: false;
  error: string;
}

export type IpcResponse = IpcResponseOk | IpcResponseErr;

export interface ActiveMarkdown {
  uri: string;
  fsPath: string;
  content: string;
  isDirty: boolean;
  languageId: string;
}

export interface OpenMarkdownEntry {
  uri: string;
  fsPath: string;
  isDirty: boolean;
  isActive: boolean;
}

/**
 * Returns the OS-appropriate IPC endpoint path. macOS / Linux: a Unix socket
 * file at the given dir. Windows: a named pipe at \\.\pipe\<name>.
 *
 * Unix-socket paths must stay under ~104 chars on macOS / 108 on Linux.
 * We keep the filename short and rely on the caller for the dir.
 */
export function ipcEndpoint(globalStorageDir: string): string {
  if (os.platform() === 'win32') {
    // Named pipes on Windows are global; include a stable hash of the
    // storage dir so multiple installs don't collide.
    const hash = simpleHash(globalStorageDir).toString(16);
    return `\\\\.\\pipe\\mark-it-down-${hash}`;
  }
  return path.join(globalStorageDir, 'mid-mcp.sock');
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
