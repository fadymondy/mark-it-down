import { describe, expect, it } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { ipcEndpoint } from '../../src/mcp/ipcProtocol';

describe('ipcEndpoint', () => {
  it('returns a unix-socket path joined to the storage dir on POSIX', () => {
    if (os.platform() === 'win32') return;
    const ep = ipcEndpoint('/tmp/mid-test');
    expect(ep).toBe(path.join('/tmp/mid-test', 'mid-mcp.sock'));
  });

  it('returns a named-pipe path on Windows', () => {
    if (os.platform() !== 'win32') return;
    const ep = ipcEndpoint('C:\\Users\\x\\AppData\\Roaming');
    expect(ep.startsWith('\\\\.\\pipe\\mark-it-down-')).toBe(true);
  });

  it('hashes the storage dir into the named-pipe name on Windows for uniqueness', () => {
    if (os.platform() !== 'win32') return;
    const a = ipcEndpoint('C:\\foo');
    const b = ipcEndpoint('C:\\bar');
    expect(a).not.toBe(b);
  });
});
