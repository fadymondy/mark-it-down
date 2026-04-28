import * as vscode from 'vscode';
import { NotesStore } from '../notes/notesStore';
import { isAffected, readConfig, repoWebUrl, WarehouseConfig } from './warehouseConfig';
import { log } from './warehouseLog';
import { WarehouseStatusBar } from './warehouseStatusBar';
import { PushPlan, SecretsDetectedError, SyncSummary, WarehouseSync } from './warehouseSync';
import { WarehouseTransport } from './warehouseTransport';

export class WarehouseManager implements vscode.Disposable {
  private readonly transport: WarehouseTransport;
  private readonly sync: WarehouseSync;
  private readonly statusBar: WarehouseStatusBar;
  private readonly subs: vscode.Disposable[] = [];
  private autoPushTimer: NodeJS.Timeout | undefined;
  private currentConfig: WarehouseConfig;
  private busy = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: NotesStore,
  ) {
    this.transport = new WarehouseTransport(context.globalStorageUri);
    this.sync = new WarehouseSync(context, store, this.transport);
    this.statusBar = new WarehouseStatusBar();
    this.currentConfig = readConfig();

    this.subs.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (isAffected(e)) {
          this.currentConfig = readConfig();
          this.refreshStatusBar();
        }
      }),
      this.store.onDidChange(() => this.maybeSchedulePush()),
    );
    this.refreshStatusBar();
  }

  public start(): void {
    if (this.currentConfig.enabled) {
      void this.pull({ silent: true }).catch(err => log('error', 'startup pull failed', err));
    }
  }

  public async syncNow(): Promise<void> {
    if (!this.requireConfigured()) return;
    await this.guard(async () => {
      this.statusBar.set('syncing', 'Pulling…');
      const pulled = await this.sync.pull(this.currentConfig);
      this.statusBar.set('syncing', 'Building push plan…');
      const plan = await this.sync.planPush(this.currentConfig);
      const pushed = await this.runPush(plan);
      this.report({ pulled, pushed, warnings: [] });
    });
  }

  public async pullCommand(): Promise<void> {
    if (!this.requireConfigured()) return;
    await this.guard(async () => {
      this.statusBar.set('syncing', 'Pulling…');
      const pulled = await this.sync.pull(this.currentConfig);
      this.report({ pulled, pushed: { added: 0, updated: 0, deleted: 0 }, warnings: [] });
    });
  }

  public async openOnGitHub(): Promise<void> {
    if (!this.requireConfigured()) return;
    await vscode.env.openExternal(vscode.Uri.parse(repoWebUrl(this.currentConfig)));
  }

  public openLog(): void {
    log('info', 'log channel opened by user');
    vscode.commands.executeCommand('workbench.action.output.show.markItDown.warehouse').then(undefined, () => {
      // ignore — the output channel command varies by VSCode version; channel itself shows on errors anyway
    });
  }

  public dispose(): void {
    if (this.autoPushTimer) clearTimeout(this.autoPushTimer);
    this.statusBar.dispose();
    this.subs.forEach(s => s.dispose());
  }

  private async pull(opts: { silent: boolean }): Promise<void> {
    await this.guard(async () => {
      this.statusBar.set('syncing', 'Pulling…');
      const pulled = await this.sync.pull(this.currentConfig);
      if (!opts.silent) {
        this.report({ pulled, pushed: { added: 0, updated: 0, deleted: 0 }, warnings: [] });
      } else if (pulled.added + pulled.updated > 0) {
        log('info', `startup pull imported ${pulled.added} new + ${pulled.updated} updated notes`);
      }
    });
  }

  private maybeSchedulePush(): void {
    if (!this.currentConfig.enabled || !this.currentConfig.autoPush) return;
    if (this.autoPushTimer) clearTimeout(this.autoPushTimer);
    this.autoPushTimer = setTimeout(() => {
      this.autoPushTimer = undefined;
      this.runAutoPush().catch(err => log('error', 'auto-push failed', err));
    }, this.currentConfig.autoPushDebounceMs);
  }

  private async runAutoPush(): Promise<void> {
    if (this.busy) {
      this.maybeSchedulePush();
      return;
    }
    await this.guard(async () => {
      this.statusBar.set('syncing', 'Auto-push…');
      const plan = await this.sync.planPush(this.currentConfig);
      if (!this.sync.hasPushWork(plan)) {
        return;
      }
      await this.runPush(plan);
    });
  }

  private async runPush(plan: PushPlan): Promise<SyncSummary['pushed']> {
    if (!this.sync.hasPushWork(plan)) {
      return { added: 0, updated: 0, deleted: 0 };
    }
    if (!this.sync.hasConfirmedFirstPush(this.currentConfig)) {
      const ok = await confirmFirstPush(plan, this.currentConfig);
      if (!ok) {
        log('info', 'first push cancelled by user');
        return { added: 0, updated: 0, deleted: 0 };
      }
      await this.sync.markFirstPushConfirmed(this.currentConfig);
    }
    try {
      const result = await this.sync.push(this.currentConfig, plan);
      return result;
    } catch (err) {
      if (err instanceof SecretsDetectedError) {
        const choice = await vscode.window.showWarningMessage(
          'Mark It Down: secrets detected in notes about to push. Review the log and decide.',
          { modal: true, detail: err.message },
          'Push anyway',
          'Cancel',
        );
        if (choice === 'Push anyway') {
          return await this.sync.push(this.currentConfig, plan, { allowSecrets: true });
        }
        return { added: 0, updated: 0, deleted: 0 };
      }
      throw err;
    }
  }

  private async guard(fn: () => Promise<void>): Promise<void> {
    if (this.busy) {
      log('warn', 'sync already in progress; ignoring concurrent request');
      return;
    }
    this.busy = true;
    try {
      await fn();
      this.statusBar.set('idle');
    } catch (err) {
      log('error', err);
      this.statusBar.set('error', (err as Error).message);
      vscode.window.showErrorMessage(`Mark It Down warehouse: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private requireConfigured(): boolean {
    if (this.currentConfig.enabled) return true;
    void vscode.window
      .showInformationMessage(
        'Notes warehouse is not configured. Set markItDown.warehouse.repo (e.g. "you/your-notes") to enable cloud sync.',
        'Open Settings',
      )
      .then(choice => {
        if (choice === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'markItDown.warehouse');
        }
      });
    return false;
  }

  private refreshStatusBar(): void {
    if (!this.currentConfig.enabled) {
      this.statusBar.set('disabled');
    } else {
      this.statusBar.set('idle', `${this.currentConfig.repo}@${this.currentConfig.branch}`);
    }
  }

  private report(summary: SyncSummary): void {
    const { pulled, pushed } = summary;
    const parts: string[] = [];
    if (pulled.added + pulled.updated > 0) {
      parts.push(`pulled +${pulled.added} ~${pulled.updated}`);
    }
    if (pulled.conflicts > 0) {
      parts.push(`${pulled.conflicts} conflict(s) (kept local)`);
    }
    if (pushed.added + pushed.updated + pushed.deleted > 0) {
      parts.push(`pushed +${pushed.added} ~${pushed.updated} -${pushed.deleted}`);
      if (pushed.commit) parts.push(`(${pushed.commit.slice(0, 7)})`);
    }
    if (parts.length === 0) {
      parts.push('already in sync');
    }
    log('info', 'sync complete:', parts.join(' '));
    vscode.window.setStatusBarMessage(`Mark It Down warehouse: ${parts.join(' · ')}`, 4000);
    if (pulled.conflicts > 0) {
      this.statusBar.set('conflict', `${pulled.conflicts} note(s) diverged. Local copies kept.`);
    }
  }
}

async function confirmFirstPush(plan: PushPlan, config: WarehouseConfig): Promise<boolean> {
  const detail = [
    `Repo:      ${config.repo}@${config.branch}`,
    `Subdir:    ${config.subdir}/`,
    `Workspace: ${config.workspaceId}`,
    '',
    `Will create: ${plan.added.length} note(s)`,
    `Will update: ${plan.updated.length} note(s)`,
    `Will delete: ${plan.deleted.length} note(s)`,
    '',
    'Files staged:',
    ...plan.files.slice(0, 12).map(f => `  ${f}`),
    plan.files.length > 12 ? `  …and ${plan.files.length - 12} more` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const choice = await vscode.window.showWarningMessage(
    'Mark It Down: confirm the first push to the notes warehouse.',
    { modal: true, detail },
    'Push',
    'Cancel',
  );
  return choice === 'Push';
}
