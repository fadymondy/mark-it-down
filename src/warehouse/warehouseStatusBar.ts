import * as vscode from 'vscode';

export type SyncState = 'disabled' | 'idle' | 'syncing' | 'behind' | 'conflict' | 'error';

interface StateRender {
  icon: string;
  text: string;
  tooltip: string;
  background?: vscode.ThemeColor;
}

const RENDERS: Record<SyncState, StateRender> = {
  disabled: {
    icon: '$(circle-slash)',
    text: 'Notes warehouse: off',
    tooltip: 'Set markItDown.warehouse.repo to enable cloud sync.',
  },
  idle: {
    icon: '$(cloud)',
    text: 'Notes synced',
    tooltip: 'Notes warehouse is in sync with the remote.',
  },
  syncing: {
    icon: '$(sync~spin)',
    text: 'Notes syncing…',
    tooltip: 'Pulling from / pushing to the warehouse.',
  },
  behind: {
    icon: '$(cloud-download)',
    text: 'Notes behind',
    tooltip: 'The warehouse has changes you don\'t have locally. Click to pull.',
  },
  conflict: {
    icon: '$(warning)',
    text: 'Notes conflict',
    tooltip: 'Local and remote both changed since last sync. Click to resolve.',
    background: new vscode.ThemeColor('statusBarItem.warningBackground'),
  },
  error: {
    icon: '$(error)',
    text: 'Notes sync error',
    tooltip: 'Last warehouse operation failed. Click to view the log.',
    background: new vscode.ThemeColor('statusBarItem.errorBackground'),
  },
};

export class WarehouseStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private currentState: SyncState = 'disabled';

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.item.command = 'markItDown.warehouse.openLog';
    this.set('disabled');
    this.item.show();
  }

  public set(state: SyncState, detail?: string): void {
    this.currentState = state;
    const render = RENDERS[state];
    this.item.text = `${render.icon} ${render.text}`;
    this.item.tooltip = detail ? `${render.tooltip}\n${detail}` : render.tooltip;
    this.item.backgroundColor = render.background;
  }

  public state(): SyncState {
    return this.currentState;
  }

  public dispose(): void {
    this.item.dispose();
  }
}
