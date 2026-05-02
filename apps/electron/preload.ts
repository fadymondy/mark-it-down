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
  listExportHistory: (limit?: number): Promise<{ id: string; source_path: string; format: string; file_path: string; exported_at: number }[]> =>
    ipcRenderer.invoke('mid:list-export-history', limit),
  notesList: (workspace: string): Promise<NoteEntry[]> =>
    ipcRenderer.invoke('mid:notes-list', workspace),
  notesCreate: (workspace: string, title: string): Promise<{ entry: NoteEntry; fullPath: string }> =>
    ipcRenderer.invoke('mid:notes-create', workspace, title),
  notesRename: (workspace: string, id: string, title: string): Promise<NoteEntry | null> =>
    ipcRenderer.invoke('mid:notes-rename', workspace, id, title),
  notesDelete: (workspace: string, id: string): Promise<boolean> =>
    ipcRenderer.invoke('mid:notes-delete', workspace, id),
  notesTag: (workspace: string, id: string, tags: string[]): Promise<NoteEntry | null> =>
    ipcRenderer.invoke('mid:notes-tag', workspace, id, tags),
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
});
