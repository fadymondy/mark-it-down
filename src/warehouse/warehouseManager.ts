import * as vscode from 'vscode';
import { NotesStore } from '../notes/notesStore';
import {
  isAffected,
  readConfig,
  readRoutes,
  repoWebUrl,
  RoutedWarehouseConfig,
  WarehouseConfig,
  WarehouseRoutes,
} from './warehouseConfig';
import { log } from './warehouseLog';
import { WarehouseStatusBar } from './warehouseStatusBar';
import { PushPlan, SecretsDetectedError, SyncSummary, WarehouseSync } from './warehouseSync';
import { WarehouseTransport } from './warehouseTransport';
import { ConflictRegistry } from './conflictRegistry';
import { ConflictPanel } from './conflictPanel';

export class WarehouseManager implements vscode.Disposable {
  private readonly transport: WarehouseTransport;
  private readonly sync: WarehouseSync;
  private readonly statusBar: WarehouseStatusBar;
  public readonly conflicts: ConflictRegistry;
  public readonly conflictPanel: ConflictPanel;
  private readonly subs: vscode.Disposable[] = [];
  private autoPushTimer: NodeJS.Timeout | undefined;
  private currentConfig: WarehouseConfig;
  private currentRoutes: WarehouseRoutes;
  private busy = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: NotesStore,
  ) {
    this.transport = new WarehouseTransport(context.globalStorageUri);
    this.conflicts = new ConflictRegistry();
    this.sync = new WarehouseSync(context, store, this.transport, this.conflicts);
    this.statusBar = new WarehouseStatusBar();
    this.conflictPanel = new ConflictPanel(context, this.conflicts, store);
    this.currentConfig = readConfig();
    this.currentRoutes = readRoutes();
    this.warnRejectedRules();

    this.subs.push(
      this.conflicts,
      this.conflictPanel,
      vscode.workspace.onDidChangeConfiguration(e => {
        if (isAffected(e)) {
          this.currentConfig = readConfig();
          this.currentRoutes = readRoutes();
          this.warnRejectedRules();
          this.refreshStatusBar();
        }
      }),
      this.store.onDidChange(() => this.maybeSchedulePush()),
      this.conflicts.onDidChange(() => this.refreshStatusBar()),
    );
    this.refreshStatusBar();
  }

  private warnRejectedRules(): void {
    for (const r of this.currentRoutes.rejectedRules) {
      log('warn', `route rule [${r.index}] ignored: ${r.reason}`);
    }
  }

  private routesToOperate(): RoutedWarehouseConfig[] {
    return this.currentRoutes.routed.filter(r => r.enabled);
  }

  public start(): void {
    if (this.routesToOperate().length > 0) {
      void this.pull({ silent: true }).catch(err => log('error', 'startup pull failed', err));
    }
  }

  public async syncNow(): Promise<void> {
    if (!this.requireConfigured()) return;
    await this.guard(async () => {
      const aggregate = emptySummary();
      for (const route of this.routesToOperate()) {
        this.statusBar.set('syncing', `Pulling ${route.repo}…`);
        const pulled = await this.sync.pull(route, { predicate: c => route.matches(c) });
        this.statusBar.set('syncing', `Plan push ${route.repo}…`);
        const plan = await this.sync.planPush(route, { predicate: c => route.matches(c) });
        const pushed = await this.runPush(plan, route);
        accumulateSummary(aggregate, { pulled, pushed, warnings: [] });
      }
      this.report(aggregate);
    });
  }

  public async pullCommand(): Promise<void> {
    if (!this.requireConfigured()) return;
    await this.guard(async () => {
      const aggregate = emptySummary();
      for (const route of this.routesToOperate()) {
        this.statusBar.set('syncing', `Pulling ${route.repo}…`);
        const pulled = await this.sync.pull(route, { predicate: c => route.matches(c) });
        accumulateSummary(aggregate, { pulled, pushed: { added: 0, updated: 0, deleted: 0 }, warnings: [] });
      }
      this.report(aggregate);
    });
  }

  public async openOnGitHub(): Promise<void> {
    if (!this.requireConfigured()) return;
    const operating = this.routesToOperate();
    let target = operating[0];
    if (operating.length > 1) {
      const picked = await vscode.window.showQuickPick(
        operating.map(r => ({
          label: r.repo,
          description: r.isDefault ? 'default route' : `route: ${r.routeId}`,
          value: r,
        })),
        { placeHolder: 'Open which warehouse on GitHub?' },
      );
      if (!picked) return;
      target = picked.value;
    }
    await vscode.env.openExternal(vscode.Uri.parse(repoWebUrl(target)));
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
      const aggregate = emptySummary();
      for (const route of this.routesToOperate()) {
        this.statusBar.set('syncing', `Pulling ${route.repo}…`);
        const pulled = await this.sync.pull(route, { predicate: c => route.matches(c) });
        accumulateSummary(aggregate, { pulled, pushed: { added: 0, updated: 0, deleted: 0 }, warnings: [] });
      }
      if (!opts.silent) {
        this.report(aggregate);
      } else if (aggregate.pulled.added + aggregate.pulled.updated > 0) {
        log('info', `startup pull imported ${aggregate.pulled.added} new + ${aggregate.pulled.updated} updated notes across ${this.routesToOperate().length} route(s)`);
      }
    });
  }

  private maybeSchedulePush(): void {
    if (this.routesToOperate().length === 0 || !this.currentConfig.autoPush) return;
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
      for (const route of this.routesToOperate()) {
        this.statusBar.set('syncing', `Auto-push ${route.repo}…`);
        const plan = await this.sync.planPush(route, { predicate: c => route.matches(c) });
        if (!this.sync.hasPushWork(plan)) continue;
        await this.runPush(plan, route);
      }
    });
  }

  private async runPush(
    plan: PushPlan,
    route: RoutedWarehouseConfig,
  ): Promise<SyncSummary['pushed']> {
    if (!this.sync.hasPushWork(plan)) {
      return { added: 0, updated: 0, deleted: 0 };
    }
    if (!this.sync.hasConfirmedFirstPush(route)) {
      const ok = await confirmFirstPush(plan, route);
      if (!ok) {
        log('info', `first push to ${route.repo} cancelled by user`);
        return { added: 0, updated: 0, deleted: 0 };
      }
      await this.sync.markFirstPushConfirmed(route);
    }
    try {
      const result = await this.sync.push(route, plan, { predicate: c => route.matches(c) });
      return result;
    } catch (err) {
      if (err instanceof SecretsDetectedError) {
        const choice = await vscode.window.showWarningMessage(
          `Mark It Down: secrets detected in notes about to push to ${route.repo}. Review the log and decide.`,
          { modal: true, detail: err.message },
          'Push anyway',
          'Cancel',
        );
        if (choice === 'Push anyway') {
          return await this.sync.push(route, plan, {
            allowSecrets: true,
            predicate: c => route.matches(c),
          });
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
    if (this.routesToOperate().length > 0) return true;
    void vscode.window
      .showInformationMessage(
        'Notes warehouse is not configured. Set markItDown.warehouse.repo or define routes in markItDown.warehouse.routes to enable cloud sync.',
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
    const operating = this.routesToOperate();
    if (operating.length === 0) {
      this.statusBar.set('disabled');
      return;
    }
    if (this.conflicts.count() > 0) {
      this.statusBar.set('conflict', `${this.conflicts.count()} note(s) diverged. Click to resolve.`);
      return;
    }
    if (operating.length === 1) {
      const r = operating[0];
      this.statusBar.set('idle', `${r.repo}@${r.branch}`);
    } else {
      this.statusBar.set('idle', `${operating.length} warehouses`);
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

function emptySummary(): SyncSummary {
  return {
    pulled: { added: 0, updated: 0, conflicts: 0 },
    pushed: { added: 0, updated: 0, deleted: 0 },
    warnings: [],
  };
}

function accumulateSummary(into: SyncSummary, next: SyncSummary): void {
  into.pulled.added += next.pulled.added;
  into.pulled.updated += next.pulled.updated;
  into.pulled.conflicts += next.pulled.conflicts;
  into.pushed.added += next.pushed.added;
  into.pushed.updated += next.pushed.updated;
  into.pushed.deleted += next.pushed.deleted;
  if (next.pushed.commit && !into.pushed.commit) into.pushed.commit = next.pushed.commit;
  into.warnings.push(...next.warnings);
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
