import * as vscode from 'vscode';
import {
  configuredCategories,
  defaultCategory,
  defaultScope,
  NoteTreeNode,
} from './notesTreeProvider';
import { NoteMetadata, NoteScope, NotesStore } from './notesStore';
import { MarkdownEditorProvider } from '../editor/markdownEditorProvider';
import { searchNotes, SearchableNote } from '../../packages/core/src/search';

export function registerNotesCommands(
  context: vscode.ExtensionContext,
  store: NotesStore,
): vscode.Disposable[] {
  const subs: vscode.Disposable[] = [];

  subs.push(
    vscode.commands.registerCommand('markItDown.notes.create', async (node?: NoteTreeNode) => {
      const scope = await pickScope(store, node?.scope);
      if (!scope) return;
      const category = await pickCategory(store, scope, node?.category);
      if (!category) return;
      const title = await vscode.window.showInputBox({
        prompt: 'Note title',
        placeHolder: 'My new note',
        validateInput: v => (v.trim().length > 0 ? undefined : 'Title cannot be empty.'),
      });
      if (!title) return;
      try {
        const note = await store.create({ title, category, scope });
        await openNote(store, note);
      } catch (err) {
        vscode.window.showErrorMessage(`Mark It Down: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('markItDown.notes.open', async (target?: string | NoteTreeNode) => {
      const note = await resolveNote(store, target);
      if (!note) return;
      await openNote(store, note);
    }),

    vscode.commands.registerCommand('markItDown.notes.rename', async (target?: NoteTreeNode | string) => {
      const note = await resolveNote(store, target);
      if (!note) return;
      const next = await vscode.window.showInputBox({
        prompt: 'Rename note',
        value: note.title,
        validateInput: v => (v.trim().length > 0 ? undefined : 'Title cannot be empty.'),
      });
      if (!next || next.trim() === note.title) return;
      await store.rename(note.id, next);
    }),

    vscode.commands.registerCommand('markItDown.notes.move', async (target?: NoteTreeNode | string) => {
      const note = await resolveNote(store, target);
      if (!note) return;
      const category = await pickCategory(store, note.scope);
      if (!category || category === note.category) return;
      await store.setCategory(note.id, category);
    }),

    vscode.commands.registerCommand('markItDown.notes.delete', async (target?: NoteTreeNode | string) => {
      const note = await resolveNote(store, target);
      if (!note) return;
      const choice = await vscode.window.showWarningMessage(
        `Delete "${note.title}"? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (choice !== 'Delete') return;
      await store.delete(note.id);
    }),

    vscode.commands.registerCommand('markItDown.notes.refresh', () => {
      store.dispatchRefresh();
    }),

    vscode.commands.registerCommand('markItDown.notes.search', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search notes (title + category + body, fuzzy)',
        placeHolder: 'e.g. "postgres tuning"',
      });
      if (!query) return;
      const all = store.listAll();
      const searchable: SearchableNote[] = await Promise.all(
        all.map(async note => ({
          id: note.id,
          title: note.title,
          category: note.category,
          scope: note.scope,
          updatedAt: note.updatedAt,
          body: await store.readContent(note).catch(() => ''),
        })),
      );
      const hits = searchNotes(searchable, query, 25);
      if (hits.length === 0) {
        vscode.window.showInformationMessage(`Mark It Down: no notes match "${query}".`);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        hits.map(h => ({
          label: h.title,
          description: `${h.scope}/${h.category} · score ${h.score}`,
          detail: h.snippet,
          id: h.id,
        })),
        { placeHolder: `${hits.length} matching note(s)` },
      );
      if (picked) {
        await vscode.commands.executeCommand('markItDown.notes.open', picked.id);
      }
    }),

    vscode.commands.registerCommand('markItDown.notes.revealStorage', async (node?: NoteTreeNode) => {
      const scope: NoteScope = node?.scope ?? defaultScope(store);
      try {
        const root = scope === 'workspace' ? context.storageUri : context.globalStorageUri;
        if (!root) {
          vscode.window.showWarningMessage('Workspace storage unavailable. Open a folder first.');
          return;
        }
        const notesDir = vscode.Uri.joinPath(root, 'notes');
        await vscode.workspace.fs.createDirectory(notesDir);
        await vscode.commands.executeCommand('revealFileInOS', notesDir);
      } catch (err) {
        vscode.window.showErrorMessage(`Mark It Down: ${(err as Error).message}`);
      }
    }),
  );

  subs.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (store.getByUri(doc.uri)) {
        void store.touch(doc.uri);
      }
    }),
  );

  return subs;
}

async function pickScope(
  store: NotesStore,
  preset?: NoteScope,
): Promise<NoteScope | undefined> {
  if (preset) {
    if (preset === 'workspace' && !store.hasWorkspaceStorage()) {
      vscode.window.showWarningMessage('No open workspace — using global notes instead.');
      return 'global';
    }
    return preset;
  }
  if (!store.hasWorkspaceStorage()) {
    return 'global';
  }
  const fallback = defaultScope(store);
  const items: (vscode.QuickPickItem & { value: NoteScope })[] = [
    {
      value: 'workspace',
      label: 'Workspace',
      description: 'Visible only in this VSCode workspace',
      picked: fallback === 'workspace',
    },
    {
      value: 'global',
      label: 'Global',
      description: 'Available across every workspace',
      picked: fallback === 'global',
    },
  ];
  const chosen = await vscode.window.showQuickPick(items, { placeHolder: 'Note scope' });
  return chosen?.value;
}

async function pickCategory(
  store: NotesStore,
  scope: NoteScope,
  preset?: string,
): Promise<string | undefined> {
  if (preset) return preset;
  const configured = configuredCategories();
  const used = store.categoriesInUse(scope);
  const all = [...new Set([...configured, ...used])];
  const fallback = defaultCategory();
  const items: vscode.QuickPickItem[] = all.map(c => ({
    label: c,
    picked: c === fallback,
    description: configured.includes(c) ? undefined : '(unlisted)',
  }));
  items.push({ label: '$(add) New category…', description: '', alwaysShow: true });

  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Category',
  });
  if (!choice) return undefined;
  if (choice.label.includes('New category')) {
    const name = await vscode.window.showInputBox({
      prompt: 'New category name',
      validateInput: v => (v.trim().length > 0 ? undefined : 'Cannot be empty.'),
    });
    return name?.trim();
  }
  return choice.label;
}

async function resolveNote(
  store: NotesStore,
  target: NoteTreeNode | string | undefined,
): Promise<NoteMetadata | undefined> {
  if (typeof target === 'string') {
    return store.getById(target);
  }
  if (target?.kind === 'note' && target.note) {
    return target.note;
  }
  const all = store.listAll();
  if (all.length === 0) {
    vscode.window.showInformationMessage('Mark It Down: no notes yet — create one first.');
    return undefined;
  }
  const items: (vscode.QuickPickItem & { id: string })[] = all
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(n => ({
      id: n.id,
      label: n.title,
      description: `${n.scope} · ${n.category}`,
      detail: `updated ${n.updatedAt}`,
    }));
  const chosen = await vscode.window.showQuickPick(items, { placeHolder: 'Select a note' });
  return chosen ? store.getById(chosen.id) : undefined;
}

async function openNote(store: NotesStore, note: NoteMetadata): Promise<void> {
  const uri = store.uriFor(note);
  await vscode.commands.executeCommand('vscode.openWith', uri, MarkdownEditorProvider.viewType);
}
