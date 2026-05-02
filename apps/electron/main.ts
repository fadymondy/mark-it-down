import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, nativeImage, nativeTheme, shell, Tray } from 'electron';
import { autoUpdater } from 'electron-updater';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fork, ChildProcess, execFile } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import {
  openDB,
  closeDB,
  migrateLegacyState,
  getAllSettings,
  setSetting,
  listRecentFiles,
  pushRecentFile,
  listPinnedFolders,
  replacePinnedFolders,
  listWorkspaces,
  replaceWorkspaces,
  recordExport,
  listExportHistory,
} from './db';

const execFileP = promisify(execFile);

const isDev = process.env.MID_DEV === '1' || !app.isPackaged;
const updateState = {
  available: false,
  downloaded: false,
  version: app.getVersion(),
  notes: '',
};

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let mcpProcess: ChildProcess | null = null;
type MCPStatus = 'stopped' | 'running' | 'error';
let mcpStatus: MCPStatus = 'stopped';
let mcpLastError: string | null = null;

/**
 * Resolve a path relative to the repo root for both dev and packaged builds.
 *
 * Dev: returns `<cwd>/<segments>` — `process.cwd()` is the repo root.
 *
 * Packaged: `__dirname` is `<asar>/out/electron`, so `../../<segments>` lands at the
 * asar's repo-root mirror. If the asset lives under `asarUnpack` (e.g. the MCP
 * server we fork), the file is at `app.asar.unpacked/<segments>` instead — we
 * try that path first and fall back to the asar path. This single helper
 * replaces every `process.cwd()` lookup that broke in v0.2.0 (#270).
 */
function bundleAsset(...segments: string[]): string {
  if (isDev) return path.join(process.cwd(), ...segments);
  const asarPath = path.join(__dirname, '..', '..', ...segments);
  const unpacked = asarPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  try { require('fs').accessSync(unpacked); return unpacked; } catch { return asarPath; }
}

function resolveAppIcon(): string | undefined {
  // In dev: use a 512px PNG so the dock/taskbar shows brand art.
  // In packaged builds, electron-builder injects the platform icon.
  if (!isDev) return undefined;
  const candidates = [
    bundleAsset('build/icons/512.png'),
    path.join(__dirname, '../../build/icons/512.png'),
  ];
  for (const p of candidates) {
    try {
      require('fs').accessSync(p);
      return p;
    } catch {
      // try next
    }
  }
  return undefined;
}

async function createWindow(): Promise<void> {
  const iconPath = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1117' : '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = resolveAppIcon();
    if (dockIcon) {
      try { app.dock.setIcon(dockIcon); } catch { /* ignore dev convenience */ }
    }
  }
  // Open SQLite first; everything else may want to read settings.
  try {
    openDB(app.getPath('userData'));
    const result = await migrateLegacyState(app.getPath('userData'));
    if (result.error) console.warn('[mid] state.json migration warning:', result.error);
    else if (result.migrated) console.log('[mid] migrated legacy state.json into SQLite');
  } catch (err) {
    console.error('[mid] failed to open SQLite:', err);
  }
  await createWindow();
  Menu.setApplicationMenu(buildMenu());
  buildTray();
  startMCP();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
  setupAutoUpdate();
});

app.on('before-quit', () => { stopMCP(); closeDB(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('mid:read-file', async (_e, filePath: string) => {
  return fs.readFile(filePath, 'utf8');
});

ipcMain.handle('mid:write-file', async (_e, filePath: string, content: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('mid:open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'mdx', 'markdown'] },
      { name: 'Mermaid', extensions: ['mmd', 'mermaid'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  return { filePath, content: await fs.readFile(filePath, 'utf8') };
});

ipcMain.handle('mid:open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folderPath = result.filePaths[0];
  await writeAppState({ lastFolder: folderPath });
  return { folderPath, tree: await listMarkdownTree(folderPath) };
});

ipcMain.handle('mid:list-folder-md', async (_e, folderPath: string) => {
  return listMarkdownTree(folderPath);
});

ipcMain.handle('mid:read-app-state', async () => readAppState());

ipcMain.handle('mid:read-renderer-styles', async (): Promise<string> => {
  const dir = bundleAsset('out/electron/renderer');
  const files = ['tokens.css', 'icons.css', 'primitives.css', 'katex.css', 'renderer.css'];
  const parts: string[] = [];
  for (const f of files) {
    try { parts.push(await fs.readFile(path.join(dir, f), 'utf8')); } catch { /* skip */ }
  }
  return parts.join('\n\n');
});

interface NoteEntry {
  id: string;
  title: string;
  path: string;
  tags: string[];
  created: string;
  updated: string;
  warehouse?: string;
  pushedAt?: string;
}

interface Warehouse {
  id: string;
  name: string;
  repo: string;
  branch?: string;
  subdir?: string;
}

const NOTES_DIR = '.mid';
const NOTES_FILE = 'notes.json';

async function readNotes(workspace: string): Promise<NoteEntry[]> {
  try {
    const raw = await fs.readFile(path.join(workspace, NOTES_DIR, NOTES_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NoteEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeNotes(workspace: string, notes: NoteEntry[]): Promise<void> {
  const dir = path.join(workspace, NOTES_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, NOTES_FILE), JSON.stringify(notes, null, 2), 'utf8');
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-') || 'untitled';
}

ipcMain.handle('mid:notes-list', async (_e, workspace: string) => readNotes(workspace));

ipcMain.handle('mid:notes-create', async (_e, workspace: string, title: string) => {
  const notes = await readNotes(workspace);
  const baseSlug = slugify(title || 'untitled');
  const taken = new Set(notes.map(n => n.id));
  let id = baseSlug;
  let n = 1;
  while (taken.has(id)) id = `${baseSlug}-${++n}`;
  const now = new Date().toISOString();
  const relPath = `notes/${id}.md`;
  const fullPath = path.join(workspace, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `# ${title || 'Untitled'}\n\n`, 'utf8');
  const entry: NoteEntry = { id, title: title || 'Untitled', path: relPath, tags: [], created: now, updated: now };
  notes.push(entry);
  await writeNotes(workspace, notes);
  return { entry, fullPath };
});

ipcMain.handle('mid:notes-rename', async (_e, workspace: string, id: string, title: string) => {
  const notes = await readNotes(workspace);
  const note = notes.find(n => n.id === id);
  if (!note) return null;
  const oldTitle = note.title;
  note.title = title;
  note.updated = new Date().toISOString();
  await writeNotes(workspace, notes);
  // Rewrite [[wikilink]] references that point at the old title across other notes.
  if (oldTitle && oldTitle !== title) {
    for (const other of notes) {
      if (other.id === id) continue;
      try {
        const fullPath = path.join(workspace, other.path);
        let content = await fs.readFile(fullPath, 'utf8');
        const rx = new RegExp(`\\[\\[\\s*${escapeRegExp(oldTitle)}\\s*(?:\\|([^\\]]+))?\\]\\]`, 'g');
        if (rx.test(content)) {
          content = content.replace(rx, (_m, alias) => alias ? `[[${title}|${alias}]]` : `[[${title}]]`);
          await fs.writeFile(fullPath, content, 'utf8');
        }
      } catch { /* note file gone — fine */ }
    }
  }
  return note;
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

ipcMain.handle('mid:notes-delete', async (_e, workspace: string, id: string) => {
  const notes = await readNotes(workspace);
  const idx = notes.findIndex(n => n.id === id);
  if (idx === -1) return false;
  const note = notes[idx];
  notes.splice(idx, 1);
  await writeNotes(workspace, notes);
  try { await fs.unlink(path.join(workspace, note.path)); } catch { /* file gone — fine */ }
  return true;
});

ipcMain.handle('mid:notes-tag', async (_e, workspace: string, id: string, tags: string[]) => {
  const notes = await readNotes(workspace);
  const note = notes.find(n => n.id === id);
  if (!note) return null;
  note.tags = tags;
  note.updated = new Date().toISOString();
  await writeNotes(workspace, notes);
  return note;
});

ipcMain.handle('mid:warehouses-list', async (_e, workspace: string): Promise<Warehouse[]> => {
  try {
    const raw = await fs.readFile(path.join(workspace, NOTES_DIR, 'warehouse.json'), 'utf8');
    const parsed = JSON.parse(raw) as { warehouses?: Warehouse[] };
    return Array.isArray(parsed.warehouses) ? parsed.warehouses : [];
  } catch {
    return [];
  }
});

/**
 * Append (or upsert by id) a warehouse to `<workspace>/.mid/warehouse.json`.
 * Creates the file + directory if missing. The first warehouse persisted via
 * this handler doubles as the active warehouse for the workspace until the
 * user attaches notes to a different one — the onboarding flow (#236) relies
 * on that to drop the user straight into a working state.
 */
ipcMain.handle('mid:warehouses-add', async (_e, workspace: string, warehouse: Warehouse): Promise<{ ok: boolean; warehouses: Warehouse[]; error?: string }> => {
  try {
    const dir = path.join(workspace, NOTES_DIR);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'warehouse.json');
    let existing: Warehouse[] = [];
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as { warehouses?: Warehouse[] };
      if (Array.isArray(parsed.warehouses)) existing = parsed.warehouses;
    } catch { /* missing/malformed → start fresh */ }
    const next = existing.filter(w => w.id !== warehouse.id);
    next.push(warehouse);
    await fs.writeFile(file, JSON.stringify({ warehouses: next }, null, 2), 'utf8');
    return { ok: true, warehouses: next };
  } catch (err) {
    return { ok: false, warehouses: [], error: (err as Error).message };
  }
});

ipcMain.handle('mid:notes-attach-warehouse', async (_e, workspace: string, id: string, warehouseId: string | null) => {
  const notes = await readNotes(workspace);
  const note = notes.find(n => n.id === id);
  if (!note) return null;
  if (warehouseId) note.warehouse = warehouseId;
  else delete note.warehouse;
  note.updated = new Date().toISOString();
  await writeNotes(workspace, notes);
  return note;
});

ipcMain.handle('mid:notes-mark-pushed', async (_e, workspace: string, id: string) => {
  const notes = await readNotes(workspace);
  const note = notes.find(n => n.id === id);
  if (!note) return null;
  note.pushedAt = new Date().toISOString();
  await writeNotes(workspace, notes);
  return note;
});

async function runGit(workspace: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileP('git', args, { cwd: workspace });
}

ipcMain.handle('mid:gh-repo-list', async (): Promise<{ repos: { nameWithOwner: string; description: string; visibility: string }[]; ok: boolean; error?: string }> => {
  try {
    const { stdout } = await execFileP('gh', ['repo', 'list', '--limit', '200', '--json', 'nameWithOwner,description,visibility']);
    const repos = JSON.parse(stdout) as { nameWithOwner: string; description: string; visibility: string }[];
    return { repos, ok: true };
  } catch (err) {
    return { repos: [], ok: false, error: (err as { stderr?: string; message: string }).stderr ?? (err as Error).message };
  }
});

ipcMain.handle('mid:gh-repo-create', async (_e, slug: string, visibility: 'private' | 'public'): Promise<{ ok: boolean; url?: string; error?: string }> => {
  try {
    const { stdout } = await execFileP('gh', ['repo', 'create', slug, `--${visibility}`, '--confirm']);
    return { ok: true, url: stdout.trim() };
  } catch (err) {
    return { ok: false, error: (err as { stderr?: string; message: string }).stderr ?? (err as Error).message };
  }
});

ipcMain.handle('mid:file-history', async (_e, workspace: string, filePath: string): Promise<{ commits: { hash: string; date: string; author: string; message: string; diff: string }[]; ok: boolean; error?: string }> => {
  try {
    const rel = path.relative(workspace, filePath);
    const { stdout } = await execFileP('git', ['log', '--follow', '--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1e', '--date=iso-strict', '--', rel], { cwd: workspace });
    const entries = stdout.split('').filter(Boolean);
    const commits = await Promise.all(entries.slice(0, 50).map(async raw => {
      const [hash, author, date, message] = raw.replace(/^\n+/, '').split('');
      let diff = '';
      try {
        const r = await execFileP('git', ['show', '--no-color', '--pretty=', hash, '--', rel], { cwd: workspace });
        diff = r.stdout;
      } catch { /* ignore */ }
      return { hash, author, date, message, diff };
    }));
    return { commits, ok: true };
  } catch (err) {
    return { commits: [], ok: false, error: (err as { stderr?: string; message: string }).stderr ?? (err as Error).message };
  }
});

ipcMain.handle('mid:gh-auth-status', async () => {
  try {
    const { stdout } = await execFileP('gh', ['auth', 'status']);
    return { authenticated: true, output: stdout };
  } catch (err) {
    const message = (err as { stderr?: string; message: string }).stderr ?? (err as Error).message;
    return { authenticated: false, output: message };
  }
});

// GitHub OAuth device flow fallback when `gh` isn't installed.
// v1: requests device code, returns user_code + verification_uri to the renderer,
// then polls for the token. The OAuth client_id is a placeholder — registering a
// real GitHub OAuth app is a follow-up for production builds.
const MID_GH_CLIENT_ID = process.env.MID_GH_CLIENT_ID || 'Iv1.placeholder-client-id';
ipcMain.handle('mid:gh-device-flow-start', async (): Promise<{ ok: boolean; userCode?: string; verificationUri?: string; deviceCode?: string; interval?: number; error?: string }> => {
  try {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: MID_GH_CLIENT_ID, scope: 'repo read:user' }),
    });
    const data = await res.json() as { user_code?: string; verification_uri?: string; device_code?: string; interval?: number; error_description?: string };
    if (data.error_description) return { ok: false, error: data.error_description };
    return {
      ok: true,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      deviceCode: data.device_code,
      interval: data.interval ?? 5,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('mid:gh-device-flow-poll', async (_e, deviceCode: string): Promise<{ ok: boolean; token?: string; pending?: boolean; error?: string }> => {
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: MID_GH_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
    if (data.access_token) {
      // v1: persist alongside app state (a real app should use keytar). Documented as follow-up.
      await writeAppState({ ghToken: data.access_token } as Partial<AppState>);
      return { ok: true, token: data.access_token };
    }
    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      return { ok: true, pending: true };
    }
    return { ok: false, error: data.error_description ?? data.error ?? 'unknown' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('mid:repo-status', async (_e, workspace: string) => {
  try {
    const { stdout } = await runGit(workspace, ['status', '--porcelain=v2', '--branch']);
    let branch = '';
    let ahead = 0;
    let behind = 0;
    let dirty = 0;
    for (const line of stdout.split('\n')) {
      if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length);
      else if (line.startsWith('# branch.ab ')) {
        const parts = line.slice('# branch.ab '.length).split(' ');
        ahead = Math.abs(Number(parts[0] ?? 0));
        behind = Math.abs(Number(parts[1] ?? 0));
      } else if (line.trim()) dirty++;
    }
    let remote = '';
    try {
      const r = await runGit(workspace, ['config', '--get', 'remote.origin.url']);
      remote = r.stdout.trim();
    } catch { /* no remote — ok */ }
    return { initialized: true, branch, ahead, behind, dirty, remote };
  } catch {
    return { initialized: false, branch: '', ahead: 0, behind: 0, dirty: 0, remote: '' };
  }
});

ipcMain.handle('mid:repo-connect', async (_e, workspace: string, repoSlug: string) => {
  // 1. Ensure git initialized
  try {
    await runGit(workspace, ['rev-parse', '--git-dir']);
  } catch {
    await runGit(workspace, ['init', '-b', 'main']);
  }
  // 2. Build remote URL — prefer https with gh credentials.
  const url = `https://github.com/${repoSlug}.git`;
  // 3. Add or update origin
  try {
    await runGit(workspace, ['remote', 'set-url', 'origin', url]);
  } catch {
    await runGit(workspace, ['remote', 'add', 'origin', url]);
  }
  // 4. Initial commit if no HEAD yet
  try {
    await runGit(workspace, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    await runGit(workspace, ['add', '-A']);
    try {
      await runGit(workspace, ['commit', '-m', 'Initial commit from Mark It Down']);
    } catch { /* nothing staged — fine */ }
  }
  return { url };
});

ipcMain.handle('mid:repo-sync', async (_e, workspace: string, message: string) => {
  const result: { steps: string[]; ok: boolean; error?: string } = { steps: [], ok: true };
  try {
    const { stdout: status } = await runGit(workspace, ['status', '--porcelain']);
    if (status.trim()) {
      await runGit(workspace, ['add', '-A']);
      result.steps.push('staged changes');
      await runGit(workspace, ['commit', '-m', message || `notes: sync ${new Date().toISOString()}`]);
      result.steps.push('committed');
    } else {
      result.steps.push('clean');
    }
    try {
      await runGit(workspace, ['pull', '--rebase', '--autostash']);
      result.steps.push('pulled');
    } catch (err) {
      result.ok = false;
      result.error = (err as { stderr?: string }).stderr ?? (err as Error).message;
      return result;
    }
    try {
      await runGit(workspace, ['push']);
      result.steps.push('pushed');
    } catch (err) {
      result.ok = false;
      result.error = (err as { stderr?: string }).stderr ?? (err as Error).message;
    }
  } catch (err) {
    result.ok = false;
    result.error = (err as Error).message;
  }
  return result;
});

ipcMain.handle('mid:patch-app-state', async (_e, patch: Partial<AppState>) => {
  await writeAppState(patch);
});

ipcMain.handle('mid:record-export', async (_e, row: { id: string; sourcePath?: string; format: string; filePath: string }) => {
  try {
    recordExport({
      id: row.id,
      source_path: row.sourcePath ?? '',
      format: row.format,
      file_path: row.filePath,
      exported_at: Date.now(),
    });
  } catch (err) {
    console.warn('[mid] record-export failed:', (err as Error).message);
  }
});

ipcMain.handle('mid:list-export-history', async (_e, limit?: number) => {
  try { return listExportHistory(typeof limit === 'number' ? limit : 50); }
  catch { return []; }
});

ipcMain.handle('mid:save-as', async (_e, defaultName: string, content: string | ArrayBuffer, filters: Electron.FileFilter[]) => {
  const result = await dialog.showSaveDialog({ defaultPath: defaultName, filters });
  if (result.canceled || !result.filePath) return null;
  if (typeof content === 'string') {
    await fs.writeFile(result.filePath, content, 'utf8');
  } else {
    await fs.writeFile(result.filePath, Buffer.from(content));
  }
  return result.filePath;
});

ipcMain.handle('mid:export-pdf', async (_e, defaultName: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const data = await mainWindow.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    landscape: false,
  });
  await fs.writeFile(result.filePath, data);
  return result.filePath;
});

ipcMain.handle('mid:save-file-dialog', async (_e, defaultName: string, content: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'HTML', extensions: ['html'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Text', extensions: ['txt'] },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, content, 'utf8');
  return result.filePath;
});

ipcMain.handle('mid:get-app-info', async () => ({
  version: app.getVersion(),
  platform: process.platform,
  isDark: nativeTheme.shouldUseDarkColors,
  userData: app.getPath('userData'),
  documents: app.getPath('documents'),
}));

ipcMain.handle('mid:open-external', async (_e, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle('mid:update-status', async () => updateState);
ipcMain.handle('mid:update-check-now', async () => {
  if (isDev) return { skipped: true, reason: 'dev mode — skip update check' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});
ipcMain.handle('mid:update-quit-and-install', async () => {
  if (!updateState.downloaded) return false;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
});

nativeTheme.on('updated', () => {
  if (mainWindow) {
    mainWindow.webContents.send('mid:theme-changed', nativeTheme.shouldUseDarkColors);
  }
});

function setupAutoUpdate(): void {
  if (isDev) {
    console.log('[mid] auto-update skipped (dev mode)');
    return;
  }
  // electron-updater honors the `publish` block in package.json#build at build time
  // and falls back to GitHub via repository.url at runtime.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // user has to opt in via menu
  // Channel: stable | beta. Set via env so the Electron app respects whatever
  // the VSCode extension wrote (or the user can override with MID_CHANNEL).
  const channel = process.env.MID_CHANNEL === 'beta' ? 'beta' : 'latest';
  autoUpdater.channel = channel;
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.on('update-available', info => {
    updateState.available = true;
    updateState.version = info.version;
    updateState.notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : '';
    broadcastUpdateState();
    void dialog.showMessageBox({
      type: 'info',
      buttons: ['Later'],
      title: 'Mark It Down',
      message: `Update available: v${info.version}`,
      detail: 'Downloading in the background. We\'ll prompt you when it\'s ready to install.',
      noLink: true,
    });
  });
  autoUpdater.on('update-not-available', () => {
    updateState.available = false;
    broadcastUpdateState();
  });
  autoUpdater.on('update-downloaded', info => {
    updateState.downloaded = true;
    updateState.version = info.version;
    updateState.notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : '';
    broadcastUpdateState();
    void dialog
      .showMessageBox({
        type: 'info',
        buttons: ['Install on next launch', 'Restart and install now'],
        defaultId: 1,
        cancelId: 0,
        title: 'Mark It Down',
        message: `Update v${info.version} ready to install`,
        detail: 'Restart now to apply, or install automatically next time you launch.',
        noLink: true,
      })
      .then(result => {
        if (result.response === 1) {
          autoUpdater.quitAndInstall(true, true);
        } else {
          autoUpdater.autoInstallOnAppQuit = true;
        }
      });
  });
  autoUpdater.on('error', err => {
    console.warn('[mid] auto-update error:', err?.message ?? err);
  });
  // Kick off a check on launch (debounced to one per launch)
  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.warn('[mid] checkForUpdatesAndNotify failed:', err?.message ?? err);
  });
}

function broadcastUpdateState(): void {
  if (mainWindow) {
    mainWindow.webContents.send('mid:update-state', updateState);
  }
  // Reflect the change in the tray menu so "Check for Updates…" → "Downloading…"
  // → "Restart and install vX.Y.Z" all without the user re-opening the menu.
  rebuildTrayMenu();
}

interface AppState {
  lastFolder?: string;
  splitRatio?: number;
  fontFamily?: 'system' | 'sans' | 'serif' | 'mono';
  fontSize?: number;
  theme?: string;
  previewMaxWidth?: number;
  recentFiles?: string[];
  codeExportGradient?: string;
  pinnedFolders?: { path: string; name: string; icon: string; color: string; files?: string[] }[];
  workspaces?: { id: string; name: string; path: string }[];
  activeWorkspace?: string;
  ghToken?: string;
  /**
   * Workspace ids whose user has dismissed the warehouse onboarding modal
   * at least once. Tracked so the modal doesn't reappear on every launch
   * for users who deliberately skip — they can re-enter from the status-bar
   * repo button context menu. See #236.
   */
  warehouseOnboardingDismissed?: string[];
}

function resolveMCPServerScript(): string {
  // bundleAsset() handles dev (cwd) and packaged (asar.unpacked) both.
  const p = bundleAsset('out/mcp/server.js');
  try { require('fs').accessSync(p); return p; } catch { return ''; }
}

function resolveMCPNotesDir(): string {
  // Stable per-user notes dir. Created if absent so the MCP server has somewhere to read.
  const dir = path.join(app.getPath('userData'), 'notes');
  try { require('fs').mkdirSync(dir, { recursive: true }); } catch { /* fine */ }
  return dir;
}

function setMCPStatus(s: MCPStatus, err?: string): void {
  mcpStatus = s;
  mcpLastError = err ?? null;
  rebuildTrayMenu();
}

function startMCP(): void {
  // Defensive: clear stale process refs from a prior failed start.
  if (mcpProcess && (mcpProcess.killed || mcpProcess.exitCode !== null)) {
    mcpProcess = null;
  }
  if (mcpProcess) {
    setMCPStatus('running');
    return;
  }
  const script = resolveMCPServerScript();
  if (!script) {
    setMCPStatus('error', 'MCP server script not found');
    return;
  }
  const notesDir = resolveMCPNotesDir();
  let stderrTail = '';
  try {
    mcpProcess = fork(script, ['--notes-dir', notesDir], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, MID_TRAY_MANAGED: '1' },
    });
    setMCPStatus('running');
    mcpProcess.stderr?.on('data', chunk => {
      stderrTail = (stderrTail + chunk.toString()).slice(-500);
    });
    mcpProcess.on('error', e => {
      mcpProcess = null;
      setMCPStatus('error', e.message);
    });
    mcpProcess.on('exit', code => {
      mcpProcess = null;
      if (code !== 0 && mcpStatus !== 'stopped') {
        const detail = stderrTail.trim().split('\n').slice(-1)[0] || `code ${code}`;
        setMCPStatus('error', detail);
      } else {
        setMCPStatus('stopped');
      }
    });
  } catch (err) {
    mcpProcess = null;
    setMCPStatus('error', (err as Error).message);
  }
}

function stopMCP(): void {
  if (!mcpProcess) {
    if (mcpStatus !== 'stopped') setMCPStatus('stopped');
    return;
  }
  setMCPStatus('stopped');
  try { mcpProcess.kill(); } catch { /* ignore */ }
  mcpProcess = null;
}

function buildTray(): void {
  const iconPath = bundleAsset('media/brand/iconTemplate.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    // Fallback: use the colored 16-px PNG.
    icon = nativeImage.createFromPath(bundleAsset('build/icons/16.png'));
  }
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Mark It Down');
  rebuildTrayMenu();
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const statusLabel =
    mcpStatus === 'running' ? '● MCP server: running'
    : mcpStatus === 'error' ? `● MCP server: error${mcpLastError ? ` — ${mcpLastError}` : ''}`
    : '○ MCP server: stopped';
  const menu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: 'Start MCP', enabled: mcpStatus !== 'running', click: () => startMCP() },
    { label: 'Stop MCP', enabled: mcpStatus === 'running', click: () => stopMCP() },
    { type: 'separator' },
    { label: 'Install MCP for Claude Code…', click: () => void installMCPFor('claude') },
    { label: 'Install MCP for Cursor…', click: () => void installMCPFor('cursor') },
    { type: 'separator' },
    { label: 'Show window', click: () => mainWindow?.show() },
    { label: 'Hide window', click: () => mainWindow?.hide() },
    { type: 'separator' },
    {
      label: updateState.downloaded
        ? `Restart and install v${updateState.version}`
        : updateState.available
          ? `Downloading v${updateState.version}…`
          : 'Check for Updates…',
      enabled: !updateState.available || updateState.downloaded,
      click: () => {
        if (updateState.downloaded) {
          autoUpdater.quitAndInstall(true, true);
          return;
        }
        if (isDev) {
          void dialog.showMessageBox({ type: 'info', title: 'Mark It Down', message: 'Auto-update is disabled in dev mode.' });
          return;
        }
        autoUpdater.checkForUpdates().then(result => {
          if (!result?.updateInfo) {
            void dialog.showMessageBox({ type: 'info', title: 'Mark It Down', message: `You're on the latest version (v${app.getVersion()}).` });
          }
        }).catch(err => {
          const msg = err?.message ?? String(err);
          // `--dir` test builds and dev launches don't ship app-update.yml.
          // Distinguish those from real network / GitHub failures.
          if (msg.includes('app-update.yml')) {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Mark It Down',
              message: 'Auto-update is only available in published releases.',
              detail: 'You\'re running a local build. Download the signed release from GitHub to get over-the-air updates.',
            });
          } else {
            void dialog.showMessageBox({ type: 'error', title: 'Mark It Down', message: 'Update check failed', detail: msg });
          }
        });
      },
    },
    { type: 'separator' },
    { label: 'Quit Mark It Down', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

async function installMCPFor(target: 'claude' | 'cursor'): Promise<void> {
  const script = resolveMCPServerScript();
  if (!script) {
    await dialog.showMessageBox({ type: 'error', title: 'Mark It Down', message: 'MCP server script not found.' });
    return;
  }
  const home = os.homedir();
  const configPath = target === 'claude' ? path.join(home, '.claude.json') : path.join(home, '.cursor', 'mcp.json');
  let json: { mcpServers?: Record<string, { command: string; args: string[] }> } = {};
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    json = JSON.parse(raw);
  } catch {
    // file doesn't exist or invalid JSON — start fresh
  }
  const notesDir = resolveMCPNotesDir();
  // Always use `node`. Packaged builds ship Electron as `process.execPath`
  // — if Claude Code launched that, it would relaunch the desktop app
  // instead of running the MCP server. Users running an MCP-aware client
  // already have node on PATH (Claude Code itself ships node).
  const command = 'node';
  json.mcpServers = json.mcpServers ?? {};
  json.mcpServers['mark-it-down'] = {
    command,
    args: [script, '--notes-dir', notesDir],
  };
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(json, null, 2), 'utf8');
  const testCmd = `node ${script} --notes-dir ${notesDir}`;
  await dialog.showMessageBox({
    type: 'info',
    title: 'Mark It Down',
    message: `Installed for ${target === 'claude' ? 'Claude Code' : 'Cursor'}`,
    detail: `Wrote mcpServers["mark-it-down"] to ${configPath}.\n\nRestart ${target === 'claude' ? 'Claude Code' : 'Cursor'} to pick up the change.\n\nTest the server manually:\n\n  ${testCmd}\n\nIf you don't have node on PATH, install it via Homebrew (\`brew install node\`) or nvm.`,
    buttons: ['OK'],
  });
}

const MD_EXT = new Set(['.md', '.mdx', '.markdown']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'out', '.cache', '.DS_Store', '.parcel-cache', '.turbo', '.nuxt', '.svelte-kit', '.angular']);

interface TreeEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: TreeEntry[];
}

async function listMarkdownTree(folderPath: string): Promise<TreeEntry[]> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const out: TreeEntry[] = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      const children = await listMarkdownTree(full);
      if (children.length > 0) {
        out.push({ name: entry.name, path: full, kind: 'dir', children });
      }
    } else if (entry.isFile() && MD_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push({ name: entry.name, path: full, kind: 'file' });
    }
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Project the SQLite-backed settings + recent_files + pinned_folders +
 * workspaces tables back into the AppState shape the renderer expects.
 * `readAppState` and `writeAppState` are the only seam — everything else
 * keeps using AppState so the renderer doesn't need to change.
 */
async function readAppState(): Promise<AppState> {
  try {
    const settings = getAllSettings() as Partial<AppState>;
    const recentFiles = listRecentFiles(50);
    const pinnedFolders = listPinnedFolders().map(p => ({
      path: p.path, name: p.name, icon: p.icon, color: p.color,
      ...(p.files ? { files: p.files } : {}),
    }));
    const workspaces = listWorkspaces();
    return {
      ...settings,
      ...(recentFiles.length ? { recentFiles } : {}),
      ...(pinnedFolders.length ? { pinnedFolders } : {}),
      ...(workspaces.length ? { workspaces } : {}),
    } as AppState;
  } catch (err) {
    console.error('[mid] readAppState (sqlite) failed:', err);
    return {};
  }
}

async function writeAppState(patch: Partial<AppState>): Promise<void> {
  // Settings keys land in the settings table; arrays land in their own tables.
  const { recentFiles, pinnedFolders, workspaces, ...rest } = patch;
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    setSetting(k, v);
  }
  if (Array.isArray(recentFiles)) {
    // `pushRecentFile` upserts + trims. Push in reverse so the head of the
    // array ends up most-recent in the table.
    [...recentFiles].reverse().forEach(p => pushRecentFile(p));
  }
  if (Array.isArray(pinnedFolders)) {
    replacePinnedFolders(pinnedFolders.map((p, idx) => ({
      id: `pin-${idx}`,
      path: p.path,
      name: p.name,
      icon: p.icon,
      color: p.color,
      files: p.files,
      sort: idx,
    })));
  }
  if (Array.isArray(workspaces)) {
    replaceWorkspaces(workspaces);
  }
}

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Markdown…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('mid:menu-open'),
        },
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('mid:menu-open-folder'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('mid:menu-save'),
        },
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            { label: 'Markdown source…', click: () => mainWindow?.webContents.send('mid:menu-export', 'md') },
            { label: 'HTML…', click: () => mainWindow?.webContents.send('mid:menu-export', 'html') },
            { label: 'PDF…', click: () => mainWindow?.webContents.send('mid:menu-export', 'pdf') },
            { label: 'Word (.docx)…', click: () => mainWindow?.webContents.send('mid:menu-export', 'docx') },
            { label: 'Share to Google Docs…', click: () => mainWindow?.webContents.send('mid:menu-export', 'docx-gdocs') },
            { label: 'Image (PNG)…', click: () => mainWindow?.webContents.send('mid:menu-export', 'png') },
            { label: 'Plain text…', click: () => mainWindow?.webContents.send('mid:menu-export', 'txt') },
          ],
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Mark It Down on GitHub',
          click: () => shell.openExternal('https://github.com/fadymondy/mark-it-down'),
        },
        {
          label: 'Check for Updates…',
          click: async () => {
            if (isDev) {
              await dialog.showMessageBox({
                type: 'info',
                title: 'Mark It Down',
                message: 'Update checks are disabled in dev mode.',
                buttons: ['OK'],
              });
              return;
            }
            try {
              const result = await autoUpdater.checkForUpdates();
              if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
                await dialog.showMessageBox({
                  type: 'info',
                  title: 'Mark It Down',
                  message: `You're on the latest version (v${app.getVersion()}).`,
                  buttons: ['OK'],
                });
              }
            } catch (err) {
              await dialog.showMessageBox({
                type: 'error',
                title: 'Mark It Down',
                message: 'Update check failed',
                detail: (err as Error).message,
                buttons: ['OK'],
              });
            }
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
