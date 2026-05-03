import { contextBridge, ipcRenderer } from 'electron';

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  isDark: boolean;
  userData: string;
  documents: string;
}

export interface TreeEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: TreeEntry[];
}

export interface AppState {
  lastFolder?: string;
  splitRatio?: number;
  fontFamily?: 'system' | 'sans' | 'serif' | 'mono';
  fontSize?: number;
  theme?: string;
  previewMaxWidth?: number;
  recentFiles?: string[];
  codeExportGradient?: string;
  pinnedFolders?: { path: string; name: string; icon: string; color: string }[];
  workspaces?: { id: string; name: string; path: string }[];
  activeWorkspace?: string;
  warehouseOnboardingDismissed?: string[];
}

export interface NoteEntry {
  id: string;
  title: string;
  path: string;
  tags: string[];
  created: string;
  updated: string;
  warehouse?: string;
  pushedAt?: string;
  /** Note type id from the registry (#255). Defaults to `'note'`. */
  type?: string;
}

export interface Warehouse {
  id: string;
  name: string;
  repo: string;
  branch?: string;
  subdir?: string;
}

contextBridge.exposeInMainWorld('mid', {
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('mid:read-file', path),
  writeFile: (path: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('mid:write-file', path, content),
  openFileDialog: (): Promise<{ filePath: string; content: string } | null> =>
    ipcRenderer.invoke('mid:open-file-dialog'),
  openFolderDialog: (): Promise<{ folderPath: string; tree: TreeEntry[] } | null> =>
    ipcRenderer.invoke('mid:open-folder-dialog'),
  listFolderMd: (folderPath: string): Promise<TreeEntry[]> =>
    ipcRenderer.invoke('mid:list-folder-md', folderPath),
  readAppState: (): Promise<AppState> => ipcRenderer.invoke('mid:read-app-state'),
  readRendererStyles: (): Promise<string> => ipcRenderer.invoke('mid:read-renderer-styles'),
  patchAppState: (patch: Partial<AppState>): Promise<void> =>
    ipcRenderer.invoke('mid:patch-app-state', patch),
  recordExport: (row: { id: string; sourcePath?: string; format: string; filePath: string }): Promise<void> =>
    ipcRenderer.invoke('mid:record-export', row),
  // Tab persistence (#287) — renderer owns layout, main is a dumb store.
  // The window scope (window_id) is derived from the IPC sender on the main
  // side (#308), so renderers don't pass it explicitly — keeps the wire
  // format identical to the v0.2.5 single-window contract.
  tabsList: (): Promise<{ window_id: number; strip_id: number; idx: number; path: string; active: number }[]> =>
    ipcRenderer.invoke('mid:tabs-list'),
  tabsReplace: (rows: { window_id?: number; strip_id: number; idx: number; path: string; active: number }[]): Promise<boolean> =>
    ipcRenderer.invoke('mid:tabs-replace', rows),
  // #308 — Detach a tab into its own BrowserWindow. The new window opens with
  // the file pre-loaded as its only tab; the origin renderer is responsible
  // for closing the source tab from its own strip.
  tabsDetach: (payload: { path: string; bounds?: { x?: number; y?: number } }): Promise<{ ok: boolean; windowId?: number; error?: string }> =>
    ipcRenderer.invoke('mid:tabs-detach', payload),
  /** #308 — current window's persistence slot id. 0 for the main window,
   * 1+ for detached windows. The renderer uses this purely for diagnostics
   * (e.g. document title suffix); persistence is scoped automatically. */
  getWindowId: (): Promise<number> => ipcRenderer.invoke('mid:get-window-id'),
  listExportHistory: (limit?: number): Promise<{ id: string; source_path: string; format: string; file_path: string; exported_at: number }[]> =>
    ipcRenderer.invoke('mid:list-export-history', limit),
  notesList: (workspace: string): Promise<NoteEntry[]> =>
    ipcRenderer.invoke('mid:notes-list', workspace),
  notesCreate: (workspace: string, title: string, type?: string): Promise<{ entry: NoteEntry; fullPath: string }> =>
    ipcRenderer.invoke('mid:notes-create', workspace, title, type),
  notesRename: (workspace: string, id: string, title: string): Promise<NoteEntry | null> =>
    ipcRenderer.invoke('mid:notes-rename', workspace, id, title),
  notesDelete: (workspace: string, id: string): Promise<boolean> =>
    ipcRenderer.invoke('mid:notes-delete', workspace, id),
  notesTag: (workspace: string, id: string, tags: string[]): Promise<NoteEntry | null> =>
    ipcRenderer.invoke('mid:notes-tag', workspace, id, tags),
  notesSetType: (workspace: string, id: string, type: string): Promise<NoteEntry | null> =>
    ipcRenderer.invoke('mid:notes-set-type', workspace, id, type),
  // #297 — note-type registry CRUD. The shape mirrors `NoteType` from
  // `apps/electron/notes/note-types.ts`; we don't import the type here to keep
  // preload free of cross-module deps.
  noteTypesList: (): Promise<{ id: string; label: string; icon: string; color: string; viewKind?: string; description?: string; builtin?: boolean }[]> =>
    ipcRenderer.invoke('mid:note-types-list'),
  noteTypesUpsert: (type: { id: string; label: string; icon: string; color: string; viewKind?: string; description?: string }): Promise<{ ok: boolean; types: { id: string; label: string; icon: string; color: string; viewKind?: string; description?: string; builtin?: boolean }[]; error?: string }> =>
    ipcRenderer.invoke('mid:note-types-upsert', type),
  noteTypesDelete: (id: string): Promise<{ ok: boolean; types: { id: string; label: string; icon: string; color: string; viewKind?: string; description?: string; builtin?: boolean }[]; error?: string }> =>
    ipcRenderer.invoke('mid:note-types-delete', id),
  noteTypesReorder: (orderedIds: string[]): Promise<{ id: string; label: string; icon: string; color: string; viewKind?: string; description?: string; builtin?: boolean }[]> =>
    ipcRenderer.invoke('mid:note-types-reorder', orderedIds),
  warehousesList: (workspace: string): Promise<Warehouse[]> =>
    ipcRenderer.invoke('mid:warehouses-list', workspace),
  warehousesAdd: (workspace: string, warehouse: Warehouse): Promise<{ ok: boolean; warehouses: Warehouse[]; error?: string }> =>
    ipcRenderer.invoke('mid:warehouses-add', workspace, warehouse),
  notesAttachWarehouse: (workspace: string, id: string, warehouseId: string | null): Promise<NoteEntry | null> =>
    ipcRenderer.invoke('mid:notes-attach-warehouse', workspace, id, warehouseId),
  notesMarkPushed: (workspace: string, id: string): Promise<NoteEntry | null> =>
    ipcRenderer.invoke('mid:notes-mark-pushed', workspace, id),
  ghAuthStatus: (): Promise<{ authenticated: boolean; output: string }> =>
    ipcRenderer.invoke('mid:gh-auth-status'),
  ghRepoList: (): Promise<{ repos: { nameWithOwner: string; description: string; visibility: string }[]; ok: boolean; error?: string }> =>
    ipcRenderer.invoke('mid:gh-repo-list'),
  ghRepoCreate: (slug: string, visibility: 'private' | 'public'): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('mid:gh-repo-create', slug, visibility),
  ghDeviceFlowStart: (): Promise<{ ok: boolean; userCode?: string; verificationUri?: string; deviceCode?: string; interval?: number; error?: string }> =>
    ipcRenderer.invoke('mid:gh-device-flow-start'),
  ghDeviceFlowPoll: (deviceCode: string): Promise<{ ok: boolean; token?: string; pending?: boolean; error?: string }> =>
    ipcRenderer.invoke('mid:gh-device-flow-poll', deviceCode),
  fileHistory: (workspace: string, filePath: string): Promise<{ commits: { hash: string; date: string; author: string; message: string; diff: string }[]; ok: boolean; error?: string }> =>
    ipcRenderer.invoke('mid:file-history', workspace, filePath),
  repoStatus: (workspace: string): Promise<{ initialized: boolean; branch: string; ahead: number; behind: number; dirty: number; remote: string }> =>
    ipcRenderer.invoke('mid:repo-status', workspace),
  repoConnect: (workspace: string, repoSlug: string): Promise<{ url: string }> =>
    ipcRenderer.invoke('mid:repo-connect', workspace, repoSlug),
  repoSync: (workspace: string, message: string): Promise<{ steps: string[]; ok: boolean; error?: string }> =>
    ipcRenderer.invoke('mid:repo-sync', workspace, message),
  saveAs: (defaultName: string, content: string | ArrayBuffer, filters: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('mid:save-as', defaultName, content, filters),
  exportPDF: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('mid:export-pdf', defaultName),
  saveFileDialog: (defaultName: string, content: string): Promise<string | null> =>
    ipcRenderer.invoke('mid:save-file-dialog', defaultName, content),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('mid:get-app-info'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('mid:open-external', url),
  onThemeChanged: (cb: (isDark: boolean) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, isDark: boolean) => cb(isDark);
    ipcRenderer.on('mid:theme-changed', handler);
    return () => ipcRenderer.removeListener('mid:theme-changed', handler);
  },
  onMenuOpen: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on('mid:menu-open', handler);
    return () => ipcRenderer.removeListener('mid:menu-open', handler);
  },
  onMenuOpenFolder: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on('mid:menu-open-folder', handler);
    return () => ipcRenderer.removeListener('mid:menu-open-folder', handler);
  },
  onMenuSave: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on('mid:menu-save', handler);
    return () => ipcRenderer.removeListener('mid:menu-save', handler);
  },
  onMenuExport: (cb: (format: 'md' | 'html' | 'pdf' | 'png' | 'txt' | 'docx' | 'docx-gdocs') => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, fmt: 'md' | 'html' | 'pdf' | 'png' | 'txt' | 'docx' | 'docx-gdocs') => cb(fmt);
    ipcRenderer.on('mid:menu-export', handler);
    return () => ipcRenderer.removeListener('mid:menu-export', handler);
  },
  // ── Importer plugin system (#246) ──────────────────────────────────────────
  importersList: (): Promise<{ id: string; name: string; icon: string; supportedFormats?: string[]; description?: string }[]> =>
    ipcRenderer.invoke('mid:importers-list'),
  importersRun: (importerId: string, input: string, workspaceFolder: string): Promise<{ ok: boolean; runId?: string; error?: string }> =>
    ipcRenderer.invoke('mid:importers-run', importerId, input, workspaceFolder),
  onImportersProgress: (cb: (e: { runId: string; current: number; note: { title: string; path: string } }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { runId: string; current: number; note: { title: string; path: string } }) => cb(payload);
    ipcRenderer.on('mid:importers-progress', handler);
    return () => ipcRenderer.removeListener('mid:importers-progress', handler);
  },
  onImportersDone: (cb: (e: { runId: string; count: number }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { runId: string; count: number }) => cb(payload);
    ipcRenderer.on('mid:importers-done', handler);
    return () => ipcRenderer.removeListener('mid:importers-done', handler);
  },
  onImportersError: (cb: (e: { runId: string; error: string }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { runId: string; error: string }) => cb(payload);
    ipcRenderer.on('mid:importers-error', handler);
    return () => ipcRenderer.removeListener('mid:importers-error', handler);
  },
  onImportersLog: (cb: (e: { runId: string; msg: string }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { runId: string; msg: string }) => cb(payload);
    ipcRenderer.on('mid:importers-log', handler);
    return () => ipcRenderer.removeListener('mid:importers-log', handler);
  },
  onMenuImport: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on('mid:menu-import', handler);
    return () => ipcRenderer.removeListener('mid:menu-import', handler);
  },
});
