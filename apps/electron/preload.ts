import { contextBridge, ipcRenderer } from 'electron';

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  isDark: boolean;
  userData: string;
  documents: string;
}

contextBridge.exposeInMainWorld('mid', {
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('mid:read-file', path),
  writeFile: (path: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('mid:write-file', path, content),
  openFileDialog: (): Promise<{ filePath: string; content: string } | null> =>
    ipcRenderer.invoke('mid:open-file-dialog'),
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
  onMenuSave: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on('mid:menu-save', handler);
    return () => ipcRenderer.removeListener('mid:menu-save', handler);
  },
});
