import * as vscode from 'vscode';
import { NoteMetadata, NoteScope, NotesStore } from './notesStore';

type NodeKind = 'scope' | 'category' | 'note' | 'empty';

export interface NoteTreeNode {
  kind: NodeKind;
  scope?: NoteScope;
  category?: string;
  note?: NoteMetadata;
  emptyMessage?: string;
}

export class NotesTreeProvider implements vscode.TreeDataProvider<NoteTreeNode> {
  private readonly emitter = new vscode.EventEmitter<NoteTreeNode | undefined>();
  public readonly onDidChangeTreeData = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly store: NotesStore) {
    this.subs.push(store.onDidChange(() => this.refresh()));
    this.subs.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('markItDown.notes')) {
          this.refresh();
        }
      }),
    );
  }

  public refresh(): void {
    this.emitter.fire(undefined);
  }

  public getTreeItem(node: NoteTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'scope':
        return scopeItem(node.scope!);
      case 'category':
        return categoryItem(node.scope!, node.category!);
      case 'note':
        return noteItem(node.note!, this.store);
      case 'empty':
        return emptyItem(node.emptyMessage ?? 'No notes yet.');
    }
  }

  public getChildren(node?: NoteTreeNode): NoteTreeNode[] {
    if (!node) {
      const roots: NoteTreeNode[] = [];
      if (this.store.hasWorkspaceStorage()) {
        roots.push({ kind: 'scope', scope: 'workspace' });
      }
      roots.push({ kind: 'scope', scope: 'global' });
      return roots;
    }
    if (node.kind === 'scope') {
      return this.childrenForScope(node.scope!);
    }
    if (node.kind === 'category') {
      return this.notesIn(node.scope!, node.category!).map(note => ({ kind: 'note', note }));
    }
    return [];
  }

  public dispose(): void {
    this.emitter.dispose();
    this.subs.forEach(s => s.dispose());
  }

  private childrenForScope(scope: NoteScope): NoteTreeNode[] {
    const notes = this.store.listByScope(scope);
    const configured = configuredCategories();
    const used = this.store.categoriesInUse(scope);
    const all = [...new Set([...configured, ...used])];
    if (all.length === 0) {
      return [{ kind: 'empty', scope, emptyMessage: 'No categories configured.' }];
    }
    const nodes = all
      .filter(cat => configured.includes(cat) || notes.some(n => n.category === cat))
      .map<NoteTreeNode>(category => ({ kind: 'category', scope, category }));
    if (nodes.length === 0) {
      return [{ kind: 'empty', scope, emptyMessage: 'No categories configured.' }];
    }
    return nodes;
  }

  private notesIn(scope: NoteScope, category: string): NoteMetadata[] {
    return this.store
      .listByScope(scope)
      .filter(n => n.category === category)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export function configuredCategories(): string[] {
  const cfg = vscode.workspace.getConfiguration('markItDown.notes');
  const list = cfg.get<string[]>('categories') ?? [];
  const trimmed = list.map(c => c.trim()).filter(Boolean);
  return trimmed.length > 0 ? trimmed : ['Daily', 'Reference', 'Snippet', 'Drafts'];
}

export function defaultCategory(): string {
  const cfg = vscode.workspace.getConfiguration('markItDown.notes');
  const value = cfg.get<string>('defaultCategory')?.trim();
  return value || configuredCategories()[0];
}

export function defaultScope(store: NotesStore): NoteScope {
  const cfg = vscode.workspace.getConfiguration('markItDown.notes');
  const preference = cfg.get<NoteScope>('defaultScope') ?? 'workspace';
  return preference === 'workspace' && store.hasWorkspaceStorage() ? 'workspace' : 'global';
}

function scopeItem(scope: NoteScope): vscode.TreeItem {
  const label = scope === 'workspace' ? 'Workspace' : 'Global';
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
  item.contextValue = `markItDown.notes.scope.${scope}`;
  item.iconPath = new vscode.ThemeIcon(scope === 'workspace' ? 'root-folder' : 'globe');
  item.tooltip =
    scope === 'workspace'
      ? 'Notes scoped to this workspace (workspace-storage).'
      : 'Notes available across all VSCode windows (global-storage).';
  return item;
}

function categoryItem(scope: NoteScope, category: string): vscode.TreeItem {
  const item = new vscode.TreeItem(category, vscode.TreeItemCollapsibleState.Collapsed);
  item.contextValue = `markItDown.notes.category.${scope}`;
  item.iconPath = new vscode.ThemeIcon('folder');
  item.id = `${scope}::${category}`;
  return item;
}

function noteItem(note: NoteMetadata, store: NotesStore): vscode.TreeItem {
  const item = new vscode.TreeItem(note.title || 'Untitled note', vscode.TreeItemCollapsibleState.None);
  item.description = formatTimestamp(note.updatedAt);
  item.tooltip = `${note.title}\n${note.category} · ${note.scope}\nupdated ${note.updatedAt}`;
  item.contextValue = `markItDown.notes.note.${note.scope}`;
  item.iconPath = new vscode.ThemeIcon('note');
  item.resourceUri = store.uriFor(note);
  item.id = note.id;
  item.command = {
    command: 'markItDown.notes.open',
    title: 'Open Note',
    arguments: [note.id],
  };
  return item;
}

function emptyItem(message: string): vscode.TreeItem {
  const item = new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon('info');
  item.contextValue = 'markItDown.notes.empty';
  return item;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
