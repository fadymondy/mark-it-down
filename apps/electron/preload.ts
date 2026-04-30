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
  theme?: 'auto' | 'light' | 'dark' | 'sepia';
  previewMaxWidth?: number;
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
});
