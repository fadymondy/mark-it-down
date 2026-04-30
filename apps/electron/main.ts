import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, nativeTheme, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { promises as fs } from 'fs';
import * as path from 'path';

const isDev = process.env.MID_DEV === '1' || !app.isPackaged;
const updateState = {
  available: false,
  downloaded: false,
  version: app.getVersion(),
  notes: '',
};

let mainWindow: BrowserWindow | null = null;

function resolveAppIcon(): string | undefined {
  // In dev: use a 512px PNG so the dock/taskbar shows brand art.
  // In packaged builds, electron-builder injects the platform icon.
  if (!isDev) return undefined;
  const candidates = [
    path.join(process.cwd(), 'build/icons/512.png'),
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
  await createWindow();
  Menu.setApplicationMenu(buildMenu());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
  setupAutoUpdate();
});

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
    filters: [{ name: 'Markdown', extensions: ['md', 'mdx', 'markdown'] }],
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

ipcMain.handle('mid:patch-app-state', async (_e, patch: Partial<AppState>) => {
  await writeAppState(patch);
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
}

interface AppState {
  lastFolder?: string;
  splitRatio?: number;
  fontFamily?: 'system' | 'sans' | 'serif' | 'mono';
  fontSize?: number;
  theme?: 'auto' | 'light' | 'dark' | 'sepia';
  previewMaxWidth?: number;
}

const MD_EXT = new Set(['.md', '.mdx', '.markdown']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'out', '.cache', '.DS_Store']);

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
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
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

async function readAppState(): Promise<AppState> {
  const file = path.join(app.getPath('userData'), 'state.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as AppState;
  } catch {
    return {};
  }
}

async function writeAppState(patch: Partial<AppState>): Promise<void> {
  const file = path.join(app.getPath('userData'), 'state.json');
  const current = await readAppState();
  const next = { ...current, ...patch };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
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
