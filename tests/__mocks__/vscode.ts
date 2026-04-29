// Minimal vscode API stub used by vitest when src/ imports vscode.
// Extend as needed when more of the API gets touched by tests.

export const workspace = {
  getConfiguration: () => ({
    get: <T>(_key: string, fallback?: T): T | undefined => fallback,
  }),
  workspaceFolders: undefined,
  name: undefined,
};

export const window = {
  showInformationMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  setStatusBarMessage: () => ({ dispose: () => undefined }),
  activeTextEditor: undefined,
};

export class EventEmitter<T> {
  public event = (_listener: (e: T) => unknown): { dispose: () => void } => ({
    dispose: () => undefined,
  });
  public fire(_value?: T): void { /* no-op */ }
  public dispose(): void { /* no-op */ }
}

export class Uri {
  static joinPath = (..._parts: unknown[]): Uri => new Uri();
  static file = (_path: string): Uri => new Uri();
  static parse = (_input: string): Uri => new Uri();
  toString(): string { return ''; }
  fsPath = '';
  path = '';
}

export const env = {
  clipboard: { writeText: () => Promise.resolve() },
  openExternal: () => Promise.resolve(true),
};

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
  executeCommand: () => Promise.resolve(),
};

export const ConfigurationTarget = { Workspace: 2, Global: 1 };
export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 };
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const StatusBarAlignment = { Left: 1, Right: 2 };

export class ThemeIcon {
  constructor(public id: string) {}
}

export class TreeItem {
  constructor(public label: string, public collapsibleState?: number) {}
}

export class Disposable {
  static from(...disposables: { dispose(): void }[]): Disposable {
    return new Disposable(() => disposables.forEach(d => d.dispose()));
  }
  constructor(private cb: () => void) {}
  dispose(): void { this.cb(); }
}

export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };
