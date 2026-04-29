import { promises as fs } from 'fs';
import * as path from 'path';

export interface MdNote {
  id: string;
  title: string;
  category: string;
  scope: 'global';
  createdAt: string;
  updatedAt: string;
  filename: string;
}

export interface MdIndex {
  generatedAt: string;
  notes: MdNote[];
}

const INDEX_FILENAME = '_mcp-index.json';

export class NotesAdapter {
  constructor(private readonly notesDir: string) {}

  async listNotes(filter: { category?: string } = {}): Promise<MdNote[]> {
    const idx = await this.readIndex();
    const cat = filter.category?.trim();
    return cat ? idx.notes.filter(n => n.category === cat) : idx.notes;
  }

  async getNote(id: string): Promise<{ meta: MdNote; content: string } | undefined> {
    const idx = await this.readIndex();
    const meta = idx.notes.find(n => n.id === id);
    if (!meta) return undefined;
    const content = await fs.readFile(this.notePath(meta.filename), 'utf8');
    return { meta, content };
  }

  async createNote(input: { title: string; category: string; content?: string }): Promise<MdNote> {
    const now = new Date().toISOString();
    const id = randomId();
    const meta: MdNote = {
      id,
      title: input.title.trim() || 'Untitled note',
      category: input.category.trim() || 'Drafts',
      scope: 'global',
      createdAt: now,
      updatedAt: now,
      filename: `${id}.md`,
    };
    await this.ensureDir();
    await fs.writeFile(
      this.notePath(meta.filename),
      input.content ?? `# ${meta.title}\n\n`,
      'utf8',
    );
    const idx = await this.readIndex();
    idx.notes.push(meta);
    idx.generatedAt = now;
    await this.writeIndex(idx);
    return meta;
  }

  async updateNote(
    id: string,
    patch: { title?: string; category?: string; content?: string },
  ): Promise<MdNote> {
    const idx = await this.readIndex();
    const i = idx.notes.findIndex(n => n.id === id);
    if (i < 0) throw new Error(`note ${id} not found`);
    const next: MdNote = { ...idx.notes[i] };
    if (patch.title !== undefined) next.title = patch.title.trim() || next.title;
    if (patch.category !== undefined) next.category = patch.category.trim() || next.category;
    next.updatedAt = new Date().toISOString();
    if (patch.content !== undefined) {
      await fs.writeFile(this.notePath(next.filename), patch.content, 'utf8');
    }
    idx.notes[i] = next;
    idx.generatedAt = next.updatedAt;
    await this.writeIndex(idx);
    return next;
  }

  async deleteNote(id: string): Promise<MdNote | undefined> {
    const idx = await this.readIndex();
    const i = idx.notes.findIndex(n => n.id === id);
    if (i < 0) return undefined;
    const meta = idx.notes[i];
    idx.notes.splice(i, 1);
    idx.generatedAt = new Date().toISOString();
    await this.writeIndex(idx);
    try {
      await fs.unlink(this.notePath(meta.filename));
    } catch {
      // already gone
    }
    return meta;
  }

  private notePath(filename: string): string {
    return path.join(this.notesDir, filename);
  }

  private indexPath(): string {
    return path.join(this.notesDir, INDEX_FILENAME);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.notesDir, { recursive: true });
  }

  private async readIndex(): Promise<MdIndex> {
    try {
      const buf = await fs.readFile(this.indexPath(), 'utf8');
      const parsed = JSON.parse(buf) as MdIndex;
      if (!parsed || !Array.isArray(parsed.notes)) throw new Error('bad index');
      return parsed;
    } catch {
      return { generatedAt: new Date().toISOString(), notes: [] };
    }
  }

  private async writeIndex(idx: MdIndex): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.indexPath(), JSON.stringify(idx, null, 2) + '\n', 'utf8');
  }
}

function randomId(): string {
  const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}
