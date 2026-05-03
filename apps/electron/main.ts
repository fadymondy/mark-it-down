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
  listOpenTabs,
  listOpenTabWindowIds,
  replaceOpenTabs,
  clearOpenTabsForWindow,
  type OpenTabRow,
  listNoteTypeRows,
  upsertNoteTypeRow,
  deleteNoteTypeRow,
  reorderNoteTypeRows,
} from './db';
import { DEFAULT_TYPE_ID, getNoteType, BUILT_IN_TYPES, isBuiltinTypeId, setRegistry, type NoteType } from './notes/note-types';

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
 * #308 — multi-window registry. Every BrowserWindow this process owns has a
 * stable, monotonically-allocated `windowSlotId` we use as the SQLite scope
 * for `open_tabs`. The main window always claims slot 0 (its strip predates
 * the multi-window era and existing rows live under window_id = 0). Detached
 * windows allocate the smallest free slot ≥ 1, so closing + re-detaching
 * reuses ids and the table stays compact.
 *
 * We key by `webContents.id` because that's what arrives on the IPC event
 * sender — translating it to the slot id keeps the wire format clean (the
 * renderer never has to know its slot, it just calls tabsList/Replace).
 */
const windowSlotByWebContentsId = new Map<number, number>();
const windowsBySlotId = new Map<number, BrowserWindow>();

function nextFreeSlotId(): number {
  let candidate = 1;
  while (windowsBySlotId.has(candidate)) candidate += 1;
  return candidate;
}

function trackWindow(win: BrowserWindow, slotId: number): void {
  windowSlotByWebContentsId.set(win.webContents.id, slotId);
  windowsBySlotId.set(slotId, win);
  win.on('closed', () => {
    windowSlotByWebContentsId.delete(win.webContents.id);
    windowsBySlotId.delete(slotId);
    // Detached windows release their persisted strip on close. Re-opening
    // the app should not re-spawn the detached window with stale rows; the
    // user is closing the window, so the intent is "drop these tabs".
    if (slotId !== 0) {
      try { clearOpenTabsForWindow(slotId); } catch { /* ignore */ }
    }
  });
}

function slotIdForSender(sender: Electron.WebContents): number {
  return windowSlotByWebContentsId.get(sender.id) ?? 0;
}

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

/**
 * Build the renderer index path once — both the main window and any detached
 * windows reuse it. Centralised because the path is identical and we want a
 * single source of truth.
 */
function rendererIndexPath(): string {
  return path.join(__dirname, 'renderer', 'index.html');
}

interface CreateWindowOptions {
  /** #308 — when set, the new window opens with this single file pre-loaded
   * as its only tab. Passed via the file URL hash so the sandboxed renderer
   * can read it from `window.location` without an extra IPC round-trip. */
  detachedPath?: string;
  /** #308 — explicit slot id for re-spawning a detached window with its
   * persisted strip on app launch. When omitted we treat this as the main
   * window (slot 0) or allocate a fresh slot for an interactive detach. */
  slotId?: number;
  /** Optional bounds for detached windows so they pop near the cursor. */
  bounds?: { x?: number; y?: number; width?: number; height?: number };
}

async function createWindow(opts: CreateWindowOptions = {}): Promise<BrowserWindow> {
  const iconPath = resolveAppIcon();
  const isDetached = opts.detachedPath != null || (opts.slotId != null && opts.slotId !== 0);
  const win = new BrowserWindow({
    width: opts.bounds?.width ?? (isDetached ? 720 : 1280),
    height: opts.bounds?.height ?? (isDetached ? 600 : 820),
    x: opts.bounds?.x,
    y: opts.bounds?.y,
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

  // The first window we create is the "main" one. Subsequent windows are
  // detached. We register the slot mapping *before* loadFile so the renderer's
  // first IPC (tabsList) sees the correct scope.
  let slotId: number;
  if (opts.slotId != null) {
    slotId = opts.slotId;
  } else if (!mainWindow) {
    slotId = 0;
    mainWindow = win;
  } else {
    slotId = nextFreeSlotId();
  }
  trackWindow(win, slotId);

  // Pass the detached path via URL hash. Hash survives loadFile, isn't part of
  // the file:// path so CSP stays happy, and the renderer reads it from
  // `window.location.hash` on boot.
  const hashParts: string[] = [];
  if (opts.detachedPath) hashParts.push(`detachedPath=${encodeURIComponent(opts.detachedPath)}`);
  const loadOpts = hashParts.length ? { hash: hashParts.join('&') } : undefined;
  await win.loadFile(rendererIndexPath(), loadOpts);

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
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
    // #297 — seed the note-types table and prime the in-memory registry so
    // `notes-create` calls before the renderer's first IPC see user types too.
    try { refreshNoteTypeRegistry(); } catch (err) { console.warn('[mid] note-types seed failed:', err); }
  } catch (err) {
    console.error('[mid] failed to open SQLite:', err);
  }
  await createWindow();
  Menu.setApplicationMenu(buildMenu());
  buildTray();
  startMCP();
  void initImporters();
  // #308 — re-spawn any persisted detached windows. Each non-zero window slot
  // means the user had a detached window open last session; we open one
  // BrowserWindow per slot so the strip rehydrates the same as before.
  try {
    for (const slot of listOpenTabWindowIds()) {
      if (slot === 0) continue;
      void createWindow({ slotId: slot });
    }
  } catch (err) {
    console.warn('[mid] detached-window re-spawn failed:', err);
  }
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
  /** Note type id from the registry (#255). Legacy entries are migrated to
   * `DEFAULT_TYPE_ID` on first read. */
  type?: string;
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
    if (!Array.isArray(parsed)) return [];
    // #255 — migrate legacy entries that pre-date the `type` field. We mutate
    // the in-memory array but defer the disk write to the next mutation; the
    // default is harmless to read so a flush isn't urgent and avoids an extra
    // write on every list call.
    let migrated = false;
    for (const n of parsed as NoteEntry[]) {
      if (!n.type) { n.type = DEFAULT_TYPE_ID; migrated = true; }
    }
    if (migrated) {
      // Best-effort persist so the migration becomes durable on first read.
      // If this fails (e.g. read-only mount), the in-memory default still
      // serves the renderer correctly until the next successful write.
      try { await writeNotes(workspace, parsed as NoteEntry[]); } catch { /* ignore */ }
    }
    return parsed as NoteEntry[];
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

ipcMain.handle('mid:notes-create', async (_e, workspace: string, title: string, type?: string) => {
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
  // Resolve the type (falls back to DEFAULT_TYPE_ID for unknown ids) and seed
  // the file with type-appropriate scaffolding. Secret notes get an empty
  // `secrets:` frontmatter block so the renderer's secret editor has a stable
  // place to read/write to from the very first save.
  const resolved = getNoteType(type);
  // Per-viewKind seed scaffolding so the typed editor has somewhere to read /
  // write the moment the file opens. New view kinds plug in here.
  let seed: string;
  switch (resolved.viewKind) {
    case 'secret':
      seed = `---\nsecrets: {}\n---\n\n# ${title || 'Untitled'}\n\n`;
      break;
    case 'meeting':
      // #296 — frontmatter holds structured meta; body holds free-form notes.
      seed = `---\ndate: ${new Date().toISOString().slice(0, 10)}\nattendees: []\nlocation: ''\ndecisions: []\n---\n\n# ${title || 'Untitled'}\n\n## Agenda\n\n## Notes\n\n`;
      break;
    case 'task-list':
      // #295 — empty list; the editor's "Add row" appends `- [ ] ...` lines.
      seed = `# ${title || 'Untitled'}\n\n`;
      break;
    default:
      seed = `# ${title || 'Untitled'}\n\n`;
  }
  await fs.writeFile(fullPath, seed, 'utf8');
  const entry: NoteEntry = { id, title: title || 'Untitled', path: relPath, tags: [], created: now, updated: now, type: resolved.id };
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

// #255 — change a note's type. Unknown ids fall back to the default rather
// than rejecting the call, so a user hand-editing the file or a stale UI can
// never end up with the row stuck on a type that no longer exists.
ipcMain.handle('mid:notes-set-type', async (_e, workspace: string, id: string, type: string) => {
  const notes = await readNotes(workspace);
  const note = notes.find(n => n.id === id);
  if (!note) return null;
  note.type = getNoteType(type).id;
  note.updated = new Date().toISOString();
  await writeNotes(workspace, notes);
  return note;
});

/* ── note types registry (#297) ─────────────────────────── */

/**
 * Seed the SQLite `note_types` table with the built-in registry on first read.
 * Idempotent — re-runs only insert rows that don't already exist (so user-edits
 * to a built-in stay intact across restarts; the only fields we never
 * overwrite are the user-touched ones because `INSERT OR IGNORE` is a no-op
 * when the id collides). Built-in `sort` is recomputed each time so the
 * shipped order survives a fresh install but a user reorder via #302 is
 * preserved (we set `sort = idx` only on first insertion).
 */
function seedBuiltInNoteTypes(): void {
  const existing = new Set(listNoteTypeRows().map(r => r.id));
  let nextSort = listNoteTypeRows().reduce((max, r) => Math.max(max, r.sort), -1) + 1;
  for (let i = 0; i < BUILT_IN_TYPES.length; i++) {
    const t = BUILT_IN_TYPES[i];
    if (existing.has(t.id)) continue;
    upsertNoteTypeRow({
      id: t.id,
      label: t.label,
      icon: t.icon,
      color: t.color,
      view_kind: t.viewKind ?? 'markdown',
      description: t.description ?? null,
      builtin: 1,
      // Built-ins keep their declaration order on a fresh install. If user
      // types were added before re-seeding (unlikely; we seed at startup),
      // append after the user rows so we don't clobber their sort.
      sort: nextSort++,
    });
  }
}

/**
 * Compose the runtime registry from SQLite and push it into the in-memory
 * registry both main and renderer rely on. Renderer pulls via IPC and calls
 * `setRegistry()` on its side too — main keeps a copy so `notes-create` and
 * `notes-set-type` see user-defined types without an extra round-trip.
 */
function refreshNoteTypeRegistry(): NoteType[] {
  seedBuiltInNoteTypes();
  const rows = listNoteTypeRows();
  const composed: NoteType[] = rows.map(r => ({
    id: r.id,
    label: r.label,
    icon: r.icon,
    color: r.color,
    viewKind: r.view_kind,
    description: r.description ?? undefined,
    builtin: r.builtin === 1,
  }));
  setRegistry(composed);
  return composed;
}

ipcMain.handle('mid:note-types-list', async (): Promise<NoteType[]> => refreshNoteTypeRegistry());

ipcMain.handle('mid:note-types-upsert', async (_e, type: NoteType): Promise<{ ok: boolean; types: NoteType[]; error?: string }> => {
  // Validate id: slug-safe, non-empty, no collision with built-in unless the
  // caller is editing the built-in row itself (allowed for label/color tweaks).
  const id = String(type.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!id) return { ok: false, types: refreshNoteTypeRegistry(), error: 'Type id is required.' };
  if (id === DEFAULT_TYPE_ID && !isBuiltinTypeId(type.id ?? '')) {
    return { ok: false, types: refreshNoteTypeRegistry(), error: `"${id}" is reserved.` };
  }
  const existing = listNoteTypeRows().find(r => r.id === id);
  // Refuse to mutate a built-in's id / view_kind from this handler — built-ins
  // own their dispatch contract. Label / icon / color / description are fair
  // game so users can re-style them.
  if (existing?.builtin === 1) {
    upsertNoteTypeRow({
      id: existing.id,
      label: type.label || existing.label,
      icon: type.icon || existing.icon,
      color: type.color || existing.color,
      view_kind: existing.view_kind, // immutable for built-ins
      description: type.description ?? existing.description,
      builtin: 1,
      sort: existing.sort,
    });
    return { ok: true, types: refreshNoteTypeRegistry() };
  }
  const sort = existing?.sort ?? (listNoteTypeRows().reduce((max, r) => Math.max(max, r.sort), -1) + 1);
  upsertNoteTypeRow({
    id,
    label: type.label || id,
    icon: type.icon || 'bookmark',
    color: type.color || '#6e7681',
    view_kind: type.viewKind || 'markdown',
    description: type.description ?? null,
    builtin: 0,
    sort,
  });
  return { ok: true, types: refreshNoteTypeRegistry() };
});

ipcMain.handle('mid:note-types-delete', async (_e, id: string): Promise<{ ok: boolean; types: NoteType[]; error?: string }> => {
  if (isBuiltinTypeId(id)) {
    return { ok: false, types: refreshNoteTypeRegistry(), error: 'Built-in types cannot be deleted.' };
  }
  const ok = deleteNoteTypeRow(id);
  return { ok, types: refreshNoteTypeRegistry(), error: ok ? undefined : 'Type not found.' };
});

ipcMain.handle('mid:note-types-reorder', async (_e, orderedIds: string[]): Promise<NoteType[]> => {
  reorderNoteTypeRows(orderedIds);
  return refreshNoteTypeRegistry();
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
// GitHub OAuth device-flow client_id. Defaults to the official `gh` CLI's
// public client_id (documented + intended for reuse by trusted OSS clients);
// can be overridden via MID_GH_CLIENT_ID for a private brand-specific app.
const MID_GH_CLIENT_ID = process.env.MID_GH_CLIENT_ID || '178c6fc778ccc68e1d6a';
ipcMain.handle('mid:gh-device-flow-start', async (): Promise<{ ok: boolean; userCode?: string; verificationUri?: string; deviceCode?: string; interval?: number; error?: string }> => {
  try {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: MID_GH_CLIENT_ID, scope: 'repo read:user' }),
    });
    const text = await res.text();
    let data: { user_code?: string; verification_uri?: string; device_code?: string; interval?: number; error?: string; error_description?: string } = {};
    try { data = JSON.parse(text); } catch { /* GH may return text/html on hard failures */ }
    if (!res.ok) {
      return {
        ok: false,
        error: data.error_description || data.error || `GitHub returned ${res.status} ${res.statusText}: ${text.slice(0, 160)}`,
      };
    }
    if (data.error_description || data.error) {
      return { ok: false, error: data.error_description || data.error };
    }
    if (!data.user_code || !data.device_code) {
      return { ok: false, error: 'GitHub response missing user_code / device_code' };
    }
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
  // #314 — local-folder warehouses use the `local:<path>` prefix. Skip every
  // git remote step and just confirm the target folder exists; the workspace
  // doesn't need to be a git repo at all for local-only sync.
  if (repoSlug.startsWith('local:')) {
    const targetPath = repoSlug.slice('local:'.length);
    try { await fs.mkdir(targetPath, { recursive: true }); } catch { /* fine */ }
    return { url: `file://${targetPath}` };
  }
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

/**
 * Open-tabs persistence (#287, #308). The renderer owns the in-memory model
 * and snapshots its strip on every meaningful mutation. We wipe-and-replace
 * the rows for that window only — atomicity comes from the SQLite transaction.
 *
 * The window-id scope is derived from the IPC sender's webContents, *not*
 * trusted from the renderer payload. That keeps a misbehaving renderer from
 * trampling another window's persisted rows.
 */
ipcMain.handle('mid:tabs-list', async (e) => {
  const slot = slotIdForSender(e.sender);
  try { return listOpenTabs(slot); }
  catch { return []; }
});

ipcMain.handle('mid:tabs-replace', async (e, rows: OpenTabRow[]) => {
  if (!Array.isArray(rows)) return false;
  const slot = slotIdForSender(e.sender);
  try { replaceOpenTabs(slot, rows); return true; }
  catch (err) { console.warn('[mid] tabs-replace failed:', (err as Error).message); return false; }
});

/**
 * #308 — Detach a tab into its own BrowserWindow.
 *
 * The renderer calls this when the user drags a tab outside the window's
 * bounds. We spawn a fresh BrowserWindow with the path passed via URL hash;
 * the new renderer reads the hash on boot and seeds its strip with that one
 * file. The origin renderer is responsible for closing the source tab — we
 * don't reach across into its strip from main because the renderer already
 * owns the open-tabs model and any side-channel mutation would race with its
 * persist debounce.
 */
ipcMain.handle('mid:tabs-detach', async (_e, payload: { path: string; bounds?: { x?: number; y?: number } }) => {
  if (!payload || typeof payload.path !== 'string' || !payload.path) {
    return { ok: false, error: 'detach payload missing path' };
  }
  try {
    const win = await createWindow({
      detachedPath: payload.path,
      bounds: { width: 900, height: 700, x: payload.bounds?.x, y: payload.bounds?.y },
    });
    return { ok: true, windowId: win.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

/**
 * #308 — Tell the renderer which window slot it belongs to. The renderer
 * uses this to namespace any per-window UI state (e.g. document title) — it
 * does NOT need to pass the slot back to tabs-list/replace because main
 * derives the scope from the IPC sender directly.
 */
ipcMain.handle('mid:get-window-id', async (e) => slotIdForSender(e.sender));

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
  // #308 — broadcast theme to every window (main + detached) so a system
  // mode flip propagates to all open editors.
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('mid:theme-changed', nativeTheme.shouldUseDarkColors);
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
  // #308 — every window listens for update-state; broadcast so detached
  // windows can also surface the update banner.
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('mid:update-state', updateState);
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
    console.error('[mid] MCP start failed: script not found');
    return;
  }
  const notesDir = resolveMCPNotesDir();
  let stderrTail = '';
  console.log('[mid] starting MCP server', { script, notesDir });
  try {
    // In packaged Electron, fork() re-launches the Electron binary (process.execPath
    // is Electron, not Node). ELECTRON_RUN_AS_NODE=1 makes the child boot as plain
    // Node so the MCP server actually runs instead of spawning a second app.
    mcpProcess = fork(script, ['--notes-dir', notesDir], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        MID_TRAY_MANAGED: '1',
        ELECTRON_RUN_AS_NODE: '1',
      },
    });
    // Provisionally start. Re-evaluate after 500ms so an early crash flips
    // the tray to 'error' instead of staying stuck on 'running' (#316).
    setMCPStatus('running');
    setTimeout(() => {
      if (mcpProcess && !mcpProcess.killed && mcpProcess.exitCode === null) {
        // Still alive — refresh the menu so the running label is correct
        // even if the renderer wasn't ready when the first paint happened.
        rebuildTrayMenu();
        console.log('[mid] MCP server alive', { pid: mcpProcess.pid });
      }
    }, 500);
    mcpProcess.stderr?.on('data', chunk => {
      stderrTail = (stderrTail + chunk.toString()).slice(-500);
      // Surface the MCP child's stderr in the main-process console so a real
      // failure mode is visible during development / packaged testing (#316).
      console.warn('[mid][mcp]', chunk.toString().trim());
    });
    mcpProcess.on('error', e => {
      mcpProcess = null;
      setMCPStatus('error', e.message);
      console.error('[mid] MCP fork error:', e.message);
    });
    mcpProcess.on('exit', code => {
      mcpProcess = null;
      if (code !== 0 && mcpStatus !== 'stopped') {
        const detail = stderrTail.trim().split('\n').slice(-1)[0] || `code ${code}`;
        setMCPStatus('error', detail);
        console.error('[mid] MCP exited with non-zero code:', code, detail);
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
          label: 'Import from…',
          click: () => mainWindow?.webContents.send('mid:menu-import'),
        },
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

// ─────────────────────────────────────────────────────────────────────────────
// Importer plugin system (#246)
//
// The contract, loader, and per-importer modules live under
// apps/electron/importers/. This block hosts only the IPC surface and one-shot
// init — adding a new importer requires zero changes here.
// ─────────────────────────────────────────────────────────────────────────────
import { loadImporters, listImporterMetadata, getImporter } from './importers/loader';
import type { ImportContext, ImportedNote } from './importers/types';

/**
 * Resolve the importer root for both dev (TS source) and packaged builds
 * (compiled JS under out/electron/importers, copied into the asar via the
 * build files glob). Dev uses the live source dir so iterating on an importer
 * doesn't require recompilation of the loader itself.
 */
function importerRootDir(): string {
  if (isDev) return path.join(process.cwd(), 'apps/electron/importers');
  // In packaged builds main.js is at <asar>/out/electron/main.js;
  // sibling importers/ ships compiled.
  return path.join(__dirname, 'importers');
}

async function initImporters(): Promise<void> {
  try {
    await loadImporters({
      importerRootDir: importerRootDir(),
      log: (msg) => console.log(msg),
    });
  } catch (err) {
    console.error('[importers] init failed:', err);
  }
}

ipcMain.handle('mid:importers-list', async () => listImporterMetadata());

ipcMain.handle(
  'mid:importers-run',
  async (e, importerId: string, input: string, workspaceFolder: string): Promise<{ ok: boolean; runId?: string; error?: string }> => {
    const importer = getImporter(importerId);
    if (!importer) return { ok: false, error: `Unknown importer "${importerId}"` };
    if (!workspaceFolder) return { ok: false, error: 'No workspace folder selected' };

    const runId = `${importerId}-${Date.now()}`;
    const targetDir = path.join(workspaceFolder, 'Imported', importer.id);
    const sender = e.sender;

    const ctx: ImportContext = {
      workspaceFolder,
      log: (msg: string) => sender.send('mid:importers-log', { runId, msg }),
    };

    // Fire-and-forget: stream notes back to the renderer as they arrive. The
    // renderer surfaces progress via mid:importers-progress and a final done
    // event. Any thrown error is reported on the same channel.
    void (async () => {
      try {
        await fs.mkdir(targetDir, { recursive: true });
        let count = 0;
        for await (const note of importer.import(input, ctx)) {
          count += 1;
          const filename = sanitiseFilename(note.title) + '.md';
          const filePath = path.join(targetDir, filename);
          await fs.mkdir(targetDir, { recursive: true });
          await fs.writeFile(filePath, formatNoteAsMarkdown(note), 'utf8');
          if (note.attachments && note.attachments.length) {
            const attachDir = path.join(targetDir, 'attachments', sanitiseFilename(note.title));
            await fs.mkdir(attachDir, { recursive: true });
            for (const att of note.attachments) {
              await fs.writeFile(path.join(attachDir, att.name), att.data);
            }
          }
          sender.send('mid:importers-progress', { runId, current: count, note: { title: note.title, path: filePath } });
        }
        sender.send('mid:importers-done', { runId, count });
      } catch (err) {
        sender.send('mid:importers-error', { runId, error: (err as Error).message });
      }
    })();

    return { ok: true, runId };
  },
);

function sanitiseFilename(input: string): string {
  return (input || 'untitled').replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled';
}

function formatNoteAsMarkdown(note: ImportedNote): string {
  const fm: string[] = ['---'];
  if (note.createdAt) fm.push(`created: ${note.createdAt}`);
  if (note.updatedAt) fm.push(`updated: ${note.updatedAt}`);
  if (note.tags && note.tags.length) fm.push(`tags: [${note.tags.map(t => JSON.stringify(t)).join(', ')}]`);
  if (note.meta) {
    for (const [k, v] of Object.entries(note.meta)) fm.push(`${k}: ${JSON.stringify(v)}`);
  }
  fm.push('---', '');
  return fm.join('\n') + note.body + (note.body.endsWith('\n') ? '' : '\n');
}
