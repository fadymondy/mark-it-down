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
}

export interface NoteEntry {
  id: string;
  title: string;
  path: string;
  tags: string[];
  created: string;
  updated: string;
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
  patchAppState: (patch: Partial<AppState>): Promise<void> =>
    ipcRenderer.invoke('mid:patch-app-state', patch),
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
  ghAuthStatus: (): Promise<{ authenticated: boolean; output: string }> =>
    ipcRenderer.invoke('mid:gh-auth-status'),
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
  onMenuExport: (cb: (format: 'md' | 'html' | 'pdf' | 'png' | 'txt' | 'docx') => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, fmt: 'md' | 'html' | 'pdf' | 'png' | 'txt' | 'docx') => cb(fmt);
    ipcRenderer.on('mid:menu-export', handler);
    return () => ipcRenderer.removeListener('mid:menu-export', handler);
  },
});
