import * as path from 'path';
import * as vscode from 'vscode';
import { NoteMetadata, NoteScope, NotesStore } from '../notes/notesStore';
import { PERSONAL_WORKSPACE_ID, scopeDir, WarehouseConfig } from './warehouseConfig';
import { log } from './warehouseLog';
import { scanForSecrets, SecretFinding } from './secretScanner';
import { WarehouseClone, WarehouseTransport } from './warehouseTransport';
import { ConflictRegistry } from './conflictRegistry';
import { attachmentDirName } from '../../packages/core/src/attachments';

export interface SyncSummary {
  pulled: { added: number; updated: number; conflicts: number };
  pushed: { added: number; updated: number; deleted: number; commit?: string };
  warnings: string[];
}

export interface PushPlan {
  added: NoteMetadata[];
  updated: NoteMetadata[];
  deleted: WarehouseIndexEntry[];
  files: string[];
}

interface WarehouseIndexEntry {
  id: string;
  title: string;
  category: string;
  scope: NoteScope;
  createdAt: string;
  updatedAt: string;
  filename: string;
  /** Sorted list of attachment filenames (just basenames; no slashes). */
  attachments?: string[];
}

interface WarehouseIndex {
  scope: NoteScope;
  workspaceId: string;
  generatedAt: string;
  notes: WarehouseIndexEntry[];
}

const FIRST_PUSH_FLAG_KEY_PREFIX = 'markItDown.warehouse.firstPushDone:';

export class WarehouseSync {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: NotesStore,
    private readonly transport: WarehouseTransport,
    private readonly conflicts: ConflictRegistry,
  ) {}

  public async pull(
    config: WarehouseConfig,
    opts: { predicate?: (category: string) => boolean } = {},
  ): Promise<SyncSummary['pulled']> {
    const predicate = opts.predicate ?? (() => true);
    const clone = await this.transport.ensureClone(config);
    if (!clone.freshlyCloned) {
      await this.transport.pull(config, clone);
    }
    let added = 0;
    let updated = 0;
    let conflicts = 0;

    const scopes: NoteScope[] = this.store.hasWorkspaceStorage()
      ? ['workspace', 'global']
      : ['global'];

    for (const scope of scopes) {
      const remote = await this.readRemoteIndex(config, clone, scope);
      if (!remote) continue;
      const localById = new Map(this.store.listByScope(scope).map(n => [n.id, n]));
      for (const entry of remote.notes) {
        if (!predicate(entry.category)) continue;
        const local = localById.get(entry.id);
        if (!local) {
          const content = await this.readRemoteContent(config, clone, scope, entry.filename);
          if (content === undefined) continue;
          const attachments = await this.readRemoteAttachments(config, clone, scope, entry);
          await this.store.importNote(toMetadata(entry, scope), content, attachments);
          added++;
          continue;
        }
        const localTime = Date.parse(local.updatedAt);
        const remoteTime = Date.parse(entry.updatedAt);
        if (Number.isNaN(remoteTime) || remoteTime <= localTime) {
          continue;
        }
        const lastSync = this.lastSyncedAt(local.id);
        const localChangedSinceSync = !lastSync || localTime > lastSync;
        const remoteChangedSinceSync = !lastSync || remoteTime > lastSync;
        if (localChangedSinceSync && remoteChangedSinceSync && localTime !== remoteTime) {
          conflicts++;
          log('warn', `conflict on note ${local.id} (${local.title}); keeping local copy`);
          const remoteContent = await this.readRemoteContent(config, clone, scope, entry.filename);
          if (remoteContent !== undefined) {
            const localContent = await this.store.readContent(local).catch(() => '');
            this.conflicts.record({
              noteId: local.id,
              scope: local.scope,
              title: local.title,
              category: local.category,
              local,
              remote: { updatedAt: entry.updatedAt },
              localContent,
              remoteContent,
              detectedAt: new Date().toISOString(),
            });
          }
          continue;
        }
        const content = await this.readRemoteContent(config, clone, scope, entry.filename);
        if (content === undefined) continue;
        const attachments = await this.readRemoteAttachments(config, clone, scope, entry);
        await this.store.importNote(toMetadata(entry, scope), content, attachments);
        updated++;
      }
    }

    return { added, updated, conflicts };
  }

  public async planPush(
    config: WarehouseConfig,
    opts: { predicate?: (category: string) => boolean } = {},
  ): Promise<PushPlan> {
    const predicate = opts.predicate ?? (() => true);
    const clone = await this.transport.ensureClone(config);
    const plan: PushPlan = { added: [], updated: [], deleted: [], files: [] };
    const scopes: NoteScope[] = this.store.hasWorkspaceStorage()
      ? ['workspace', 'global']
      : ['global'];

    for (const scope of scopes) {
      const local = this.store.listByScope(scope).filter(n => predicate(n.category));
      const remote = (await this.readRemoteIndex(config, clone, scope))?.notes ?? [];
      const remoteById = new Map(remote.map(e => [e.id, e]));
      const localById = new Map(local.map(n => [n.id, n]));

      for (const note of local) {
        const r = remoteById.get(note.id);
        if (!r) {
          plan.added.push(note);
        } else if (Date.parse(note.updatedAt) > Date.parse(r.updatedAt)) {
          plan.updated.push(note);
        }
      }
      for (const r of remote) {
        // Note disappeared locally OR moved to a category that no longer
        // belongs to this route → mark for deletion in this repo.
        if (!localById.has(r.id) || !predicate(r.category)) {
          plan.deleted.push(r);
        }
      }
    }

    const fileSet = new Set<string>();
    for (const n of plan.added) {
      for (const f of await this.filesForNote(config, n)) fileSet.add(f);
    }
    for (const n of plan.updated) {
      for (const f of await this.filesForNote(config, n)) fileSet.add(f);
    }
    for (const e of plan.deleted) {
      fileSet.add(`${scopeDir(config, e.scope)}/${e.filename}`);
      for (const att of e.attachments ?? []) {
        fileSet.add(`${scopeDir(config, e.scope)}/${attachmentDirName(e.id)}/${att}`);
      }
    }
    for (const f of this.indexFiles(config)) fileSet.add(f);
    plan.files = [...fileSet];
    return plan;
  }

  public hasPushWork(plan: PushPlan): boolean {
    return plan.added.length + plan.updated.length + plan.deleted.length > 0;
  }

  public async push(
    config: WarehouseConfig,
    plan: PushPlan,
    opts: { allowSecrets?: boolean; predicate?: (category: string) => boolean } = {},
  ): Promise<SyncSummary['pushed']> {
    const predicate = opts.predicate ?? (() => true);
    const clone = await this.transport.ensureClone(config);

    if (!opts.allowSecrets) {
      const findings = await this.scanPlan(plan);
      if (findings.size > 0) {
        const message = formatSecretFindings(findings);
        throw new SecretsDetectedError(message, findings);
      }
    }

    const scopes: NoteScope[] = this.store.hasWorkspaceStorage()
      ? ['workspace', 'global']
      : ['global'];

    for (const scope of scopes) {
      await this.materializeScope(config, clone, scope, predicate);
    }
    for (const entry of plan.deleted) {
      const abs = path.join(clone.root, scopeDir(config, entry.scope), entry.filename);
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(abs));
      } catch {
        // already gone — fine
      }
      const attDir = path.join(clone.root, scopeDir(config, entry.scope), attachmentDirName(entry.id));
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(attDir), { recursive: true, useTrash: false });
      } catch {
        // didn't exist — fine
      }
    }

    const message = composeCommitMessage(plan, config);
    const result = await this.transport.commitAndPush(config, clone, plan.files, message);
    if (!result.committed) {
      return { added: 0, updated: 0, deleted: 0 };
    }
    this.recordSyncedTimestamps([...plan.added, ...plan.updated]);
    return {
      added: plan.added.length,
      updated: plan.updated.length,
      deleted: plan.deleted.length,
      commit: result.sha,
    };
  }

  public firstPushFlagKey(config: WarehouseConfig): string {
    return `${FIRST_PUSH_FLAG_KEY_PREFIX}${config.repo}/${config.workspaceId}`;
  }

  public hasConfirmedFirstPush(config: WarehouseConfig): boolean {
    return this.context.workspaceState.get<boolean>(this.firstPushFlagKey(config), false);
  }

  public async markFirstPushConfirmed(config: WarehouseConfig): Promise<void> {
    await this.context.workspaceState.update(this.firstPushFlagKey(config), true);
  }

  private async materializeScope(
    config: WarehouseConfig,
    clone: WarehouseClone,
    scope: NoteScope,
    predicate: (category: string) => boolean = () => true,
  ): Promise<void> {
    const dir = path.join(clone.root, scopeDir(config, scope));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    const notes = this.store.listByScope(scope).filter(n => predicate(n.category));
    const attachmentsByNote = new Map<string, string[]>();
    for (const note of notes) {
      const content = await this.store.readContent(note);
      const target = vscode.Uri.file(path.join(dir, note.filename));
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
      const attachments = await this.store.listAttachments(note);
      attachmentsByNote.set(note.id, attachments.map(a => a.filename));
      if (attachments.length > 0) {
        const subdir = path.join(dir, attachmentDirName(note.id));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(subdir));
        for (const att of attachments) {
          const bytes = await vscode.workspace.fs.readFile(this.store.attachmentUri(note, att.filename));
          await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(subdir, att.filename)), bytes);
        }
      }
    }
    const index: WarehouseIndex = {
      scope,
      workspaceId: scope === 'global' ? PERSONAL_WORKSPACE_ID : config.workspaceId,
      generatedAt: new Date().toISOString(),
      notes: notes.map(n => ({
        ...toIndexEntry(n),
        attachments: attachmentsByNote.get(n.id)?.length ? attachmentsByNote.get(n.id) : undefined,
      })),
    };
    const indexUri = vscode.Uri.file(path.join(dir, '_index.json'));
    await vscode.workspace.fs.writeFile(
      indexUri,
      new TextEncoder().encode(JSON.stringify(index, null, 2) + '\n'),
    );
  }

  private async filesForNote(config: WarehouseConfig, note: NoteMetadata): Promise<string[]> {
    const dir = scopeDir(config, note.scope);
    const out = [`${dir}/${note.filename}`, `${dir}/_index.json`];
    const attachments = await this.store.listAttachments(note);
    for (const att of attachments) {
      out.push(`${dir}/${attachmentDirName(note.id)}/${att.filename}`);
    }
    return out;
  }

  private indexFiles(config: WarehouseConfig): string[] {
    const out: string[] = [`${scopeDir(config, 'global')}/_index.json`];
    if (this.store.hasWorkspaceStorage()) {
      out.push(`${scopeDir(config, 'workspace')}/_index.json`);
    }
    return out;
  }

  private async readRemoteIndex(
    config: WarehouseConfig,
    clone: WarehouseClone,
    scope: NoteScope,
  ): Promise<WarehouseIndex | undefined> {
    const rel = `${scopeDir(config, scope)}/_index.json`;
    if (!(await this.transport.fileExists(clone, rel))) {
      return undefined;
    }
    const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(this.transport.absolute(clone, rel)));
    try {
      const parsed = JSON.parse(new TextDecoder().decode(buf)) as WarehouseIndex;
      if (!parsed || !Array.isArray(parsed.notes)) return undefined;
      return parsed;
    } catch (err) {
      log('warn', `failed to parse ${rel}; treating as empty`, err);
      return undefined;
    }
  }

  private async readRemoteContent(
    config: WarehouseConfig,
    clone: WarehouseClone,
    scope: NoteScope,
    filename: string,
  ): Promise<string | undefined> {
    const rel = `${scopeDir(config, scope)}/${filename}`;
    if (!(await this.transport.fileExists(clone, rel))) {
      log('warn', `index references missing file ${rel}`);
      return undefined;
    }
    const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(this.transport.absolute(clone, rel)));
    return new TextDecoder().decode(buf);
  }

  private async readRemoteAttachments(
    config: WarehouseConfig,
    clone: WarehouseClone,
    scope: NoteScope,
    entry: WarehouseIndexEntry,
  ): Promise<{ filename: string; bytes: Uint8Array }[]> {
    const list = entry.attachments ?? [];
    if (list.length === 0) return [];
    const dir = `${scopeDir(config, scope)}/${attachmentDirName(entry.id)}`;
    const out: { filename: string; bytes: Uint8Array }[] = [];
    for (const filename of list) {
      const rel = `${dir}/${filename}`;
      if (!(await this.transport.fileExists(clone, rel))) {
        log('warn', `attachment listed in index but missing on disk: ${rel}`);
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(this.transport.absolute(clone, rel)));
      out.push({ filename, bytes });
    }
    return out;
  }

  private async scanPlan(plan: PushPlan): Promise<Map<string, SecretFinding[]>> {
    const out = new Map<string, SecretFinding[]>();
    for (const note of [...plan.added, ...plan.updated]) {
      const content = await this.store.readContent(note);
      const findings = scanForSecrets(content);
      if (findings.length > 0) {
        out.set(`${note.title} (${note.scope}/${note.category})`, findings);
      }
    }
    return out;
  }

  private lastSyncedAt(noteId: string): number | undefined {
    const map = this.context.globalState.get<Record<string, number>>(LAST_SYNCED_KEY, {});
    const v = map[noteId];
    return typeof v === 'number' ? v : undefined;
  }

  private recordSyncedTimestamps(notes: NoteMetadata[]): void {
    const map = { ...(this.context.globalState.get<Record<string, number>>(LAST_SYNCED_KEY, {})) };
    for (const n of notes) {
      const t = Date.parse(n.updatedAt);
      if (!Number.isNaN(t)) {
        map[n.id] = t;
      }
    }
    void this.context.globalState.update(LAST_SYNCED_KEY, map);
  }
}

const LAST_SYNCED_KEY = 'markItDown.warehouse.lastSyncedAt';

export class SecretsDetectedError extends Error {
  constructor(message: string, public readonly findings: Map<string, SecretFinding[]>) {
    super(message);
    this.name = 'SecretsDetectedError';
  }
}

function toMetadata(entry: WarehouseIndexEntry, scope: NoteScope): NoteMetadata {
  return {
    id: entry.id,
    title: entry.title,
    category: entry.category,
    scope,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    filename: entry.filename,
  };
}

function toIndexEntry(note: NoteMetadata): WarehouseIndexEntry {
  return {
    id: note.id,
    title: note.title,
    category: note.category,
    scope: note.scope,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    filename: note.filename,
  };
}

function composeCommitMessage(plan: PushPlan, config: WarehouseConfig): string {
  const parts: string[] = [];
  if (plan.added.length) parts.push(`+${plan.added.length} new`);
  if (plan.updated.length) parts.push(`~${plan.updated.length} updated`);
  if (plan.deleted.length) parts.push(`-${plan.deleted.length} removed`);
  const subject = `notes(${config.workspaceId}): ${parts.join(', ') || 'sync'}`;
  const body = describePlan(plan).join('\n');
  return body.length > 0 ? `${subject}\n\n${body}\n` : `${subject}\n`;
}

function describePlan(plan: PushPlan): string[] {
  const lines: string[] = [];
  for (const n of plan.added) lines.push(`+ ${n.scope}/${n.category}/${n.title}`);
  for (const n of plan.updated) lines.push(`~ ${n.scope}/${n.category}/${n.title}`);
  for (const e of plan.deleted) lines.push(`- ${e.scope}/${e.category}/${e.title}`);
  return lines;
}

function formatSecretFindings(map: Map<string, SecretFinding[]>): string {
  const out: string[] = ['Secrets detected in notes about to be pushed:'];
  for (const [name, findings] of map) {
    out.push(`  ${name}:`);
    for (const f of findings) {
      out.push(`    line ${f.line} — ${f.description} (${f.preview})`);
    }
  }
  return out.join('\n');
}
