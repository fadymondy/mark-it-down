import * as vscode from 'vscode';

export type NoteScope = 'workspace' | 'global';

export interface NoteMetadata {
  id: string;
  title: string;
  category: string;
  scope: NoteScope;
  createdAt: string;
  updatedAt: string;
  filename: string;
}

const INDEX_KEY = 'markItDown.notes.index';
const NOTES_SUBDIR = 'notes';

export interface CreateNoteInput {
  title: string;
  category: string;
  scope: NoteScope;
  initialContent?: string;
}

export class NotesStore {
  private readonly emitter = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public hasWorkspaceStorage(): boolean {
    return this.context.storageUri !== undefined;
  }

  public listAll(): NoteMetadata[] {
    return [...this.read('workspace'), ...this.read('global')];
  }

  public listByScope(scope: NoteScope): NoteMetadata[] {
    return this.read(scope);
  }

  public getById(id: string): NoteMetadata | undefined {
    return this.listAll().find(n => n.id === id);
  }

  public getByUri(uri: vscode.Uri): NoteMetadata | undefined {
    const target = uri.toString();
    return this.listAll().find(n => this.uriFor(n).toString() === target);
  }

  public uriFor(note: NoteMetadata): vscode.Uri {
    const root = this.storageRoot(note.scope);
    return vscode.Uri.joinPath(root, NOTES_SUBDIR, note.filename);
  }

  public async create(input: CreateNoteInput): Promise<NoteMetadata> {
    if (input.scope === 'workspace' && !this.hasWorkspaceStorage()) {
      throw new Error('Workspace notes require an open workspace folder.');
    }
    const now = new Date().toISOString();
    const id = randomId();
    const note: NoteMetadata = {
      id,
      title: input.title.trim() || 'Untitled note',
      category: input.category,
      scope: input.scope,
      createdAt: now,
      updatedAt: now,
      filename: `${id}.md`,
    };
    const uri = this.uriFor(note);
    const body = input.initialContent ?? defaultBody(note.title);
    await ensureDir(uri);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(body));

    const index = this.read(note.scope);
    index.push(note);
    await this.write(note.scope, index);
    return note;
  }

  public async rename(id: string, title: string): Promise<NoteMetadata> {
    return this.update(id, n => ({ ...n, title: title.trim() || n.title }));
  }

  public async setCategory(id: string, category: string): Promise<NoteMetadata> {
    return this.update(id, n => ({ ...n, category }));
  }

  public async touch(uri: vscode.Uri): Promise<void> {
    const note = this.getByUri(uri);
    if (!note) {
      return;
    }
    await this.update(note.id, n => ({ ...n }), { silent: false });
  }

  public async delete(id: string): Promise<NoteMetadata | undefined> {
    const note = this.getById(id);
    if (!note) {
      return undefined;
    }
    const index = this.read(note.scope).filter(n => n.id !== id);
    await this.write(note.scope, index);
    try {
      await vscode.workspace.fs.delete(this.uriFor(note));
    } catch {
      // file already gone — index update is what matters
    }
    return note;
  }

  public categoriesInUse(scope?: NoteScope): string[] {
    const source = scope ? this.read(scope) : this.listAll();
    return [...new Set(source.map(n => n.category))].sort((a, b) => a.localeCompare(b));
  }

  public dispatchRefresh(): void {
    this.emitter.fire();
  }

  public dispose(): void {
    this.emitter.dispose();
  }

  private async update(
    id: string,
    mutator: (n: NoteMetadata) => NoteMetadata,
    opts: { silent?: boolean } = {},
  ): Promise<NoteMetadata> {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Note ${id} not found.`);
    }
    const next: NoteMetadata = {
      ...mutator(existing),
      updatedAt: new Date().toISOString(),
    };
    const index = this.read(existing.scope).map(n => (n.id === id ? next : n));
    await this.write(existing.scope, index, opts);
    return next;
  }

  private read(scope: NoteScope): NoteMetadata[] {
    const store = scope === 'workspace' ? this.context.workspaceState : this.context.globalState;
    return [...(store.get<NoteMetadata[]>(INDEX_KEY) ?? [])];
  }

  private async write(
    scope: NoteScope,
    notes: NoteMetadata[],
    opts: { silent?: boolean } = {},
  ): Promise<void> {
    const store = scope === 'workspace' ? this.context.workspaceState : this.context.globalState;
    await store.update(INDEX_KEY, notes);
    if (!opts.silent) {
      this.emitter.fire();
    }
  }

  private storageRoot(scope: NoteScope): vscode.Uri {
    if (scope === 'workspace') {
      const root = this.context.storageUri;
      if (!root) {
        throw new Error('Workspace storage unavailable. Open a folder to use workspace notes.');
      }
      return root;
    }
    return this.context.globalStorageUri;
  }
}

function randomId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

function defaultBody(title: string): string {
  return `# ${title}\n\n`;
}

async function ensureDir(fileUri: vscode.Uri): Promise<void> {
  const dir = vscode.Uri.joinPath(fileUri, '..');
  try {
    await vscode.workspace.fs.createDirectory(dir);
  } catch {
    // already exists
  }
}
