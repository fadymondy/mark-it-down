import * as vscode from 'vscode';
import { BacklinksIndex } from './backlinksIndex';
import { NotesStore } from './notesStore';
import type { NoteIndexProvider } from '../editor/markdownEditorProvider';

interface BacklinkNode {
  kind: 'header' | 'entry' | 'empty';
  label?: string;
  description?: string;
  noteId?: string;
  raw?: string;
}

/**
 * Sidebar tree that shows, for the currently-active note, every other
 * note that links to it via `[[wiki-link]]`.
 */
export class BacklinksTreeProvider
  implements vscode.TreeDataProvider<BacklinkNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<BacklinkNode | undefined>();
  public readonly onDidChangeTreeData = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];
  private activeNoteId: string | undefined;
  private activeNoteTitle: string | undefined;

  constructor(
    private readonly store: NotesStore,
    private readonly index: BacklinksIndex,
  ) {
    this.subs.push(index.onDidChange(() => this.refresh()));
    this.subs.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.recomputeActive()),
    );
    this.recomputeActive();
  }

  public refresh(): void {
    this.emitter.fire(undefined);
  }

  public getTreeItem(node: BacklinkNode): vscode.TreeItem {
    if (node.kind === 'header') {
      const item = new vscode.TreeItem(node.label ?? '', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('link');
      item.description = node.description;
      item.contextValue = 'markItDown.backlinks.header';
      return item;
    }
    if (node.kind === 'empty') {
      const item = new vscode.TreeItem(node.label ?? '', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      item.contextValue = 'markItDown.backlinks.empty';
      return item;
    }
    const item = new vscode.TreeItem(node.label ?? '', vscode.TreeItemCollapsibleState.None);
    item.description = node.description;
    item.iconPath = new vscode.ThemeIcon('note');
    item.tooltip = `${node.label}\n${node.raw ?? ''}`;
    item.contextValue = 'markItDown.backlinks.entry';
    if (node.noteId) {
      item.command = {
        command: 'markItDown.notes.open',
        title: 'Open',
        arguments: [node.noteId],
      };
    }
    return item;
  }

  public getChildren(node?: BacklinkNode): BacklinkNode[] {
    if (node) return [];
    if (!this.activeNoteId) {
      return [
        {
          kind: 'empty',
          label: 'Open a note to see what links to it.',
        },
      ];
    }
    const entries = this.index.for(this.activeNoteId);
    const header: BacklinkNode = {
      kind: 'header',
      label: this.activeNoteTitle ?? 'Active note',
      description: `${entries.length} backlink${entries.length === 1 ? '' : 's'}`,
    };
    if (entries.length === 0) {
      return [
        header,
        {
          kind: 'empty',
          label: 'No notes link to this one yet.',
        },
      ];
    }
    return [
      header,
      ...entries.map<BacklinkNode>(entry => ({
        kind: 'entry',
        label: entry.source.title,
        description: entry.raw,
        noteId: entry.source.id,
        raw: entry.raw,
      })),
    ];
  }

  private recomputeActive(): void {
    const editor = vscode.window.activeTextEditor;
    const uri = editor?.document.uri;
    const note = uri ? this.store.getByUri(uri) : undefined;
    const next = note?.id;
    if (next === this.activeNoteId) return;
    this.activeNoteId = next;
    this.activeNoteTitle = note?.title;
    this.refresh();
  }

  public dispose(): void {
    this.subs.forEach(s => s.dispose());
    this.emitter.dispose();
  }
}

/**
 * Build a NoteIndexProvider implementation that the markdown editor uses to
 * (a) ship the current title list to the webview, (b) react to wiki-link
 * clicks by opening / disambiguating / creating notes.
 */
export function buildNoteIndexProvider(
  store: NotesStore,
  index: BacklinksIndex,
): {
  provider: NoteIndexProvider;
  dispose: () => void;
} {
  const emitter = new vscode.EventEmitter<void>();
  const sub = store.onDidChange(() => emitter.fire());
  const indexSub = index.onDidChange(() => emitter.fire());

  return {
    provider: {
      onDidChange: emitter.event,
      list: () => store.listAll().map(n => ({ id: n.id, title: n.title })),
      open: async (id: string) => {
        await vscode.commands.executeCommand('markItDown.notes.open', id);
      },
      pickAmbiguous: async (ids: string[]) => {
        const items = ids
          .map(id => store.getById(id))
          .filter((n): n is NonNullable<typeof n> => Boolean(n))
          .map(n => ({
            label: n.title,
            description: `${n.scope} · ${n.category}`,
            id: n.id,
          }));
        if (items.length === 0) return undefined;
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Multiple notes share this title — pick one`,
        });
        return picked?.id;
      },
      createFromTitle: async (title: string) => {
        const choice = await vscode.window.showInformationMessage(
          `No note titled "${title}" exists. Create it?`,
          { modal: false },
          'Create',
        );
        if (choice !== 'Create') return undefined;
        const created = await vscode.commands.executeCommand<{ id: string } | undefined>(
          'markItDown.notes.createWithTitle',
          title,
        );
        return created?.id;
      },
    },
    dispose: () => {
      sub.dispose();
      indexSub.dispose();
      emitter.dispose();
    },
  };
}

