import * as vscode from 'vscode';
import { buildEpub, EpubChapter, EpubInput } from '../../packages/core/src/epub';
import { stripFrontmatter } from '../../packages/core/src/frontmatter';
import { NotesStore, NoteScope } from '../notes/notesStore';

export interface BuildEpubOptions {
  title: string;
  author: string;
  publisher?: string;
  cover?: { uri: vscode.Uri };
}

/** Export a single markdown source as a one-chapter ePub. */
export async function markdownToEpubBytes(
  markdown: string,
  options: BuildEpubOptions,
): Promise<Buffer> {
  const cover = await loadCover(options.cover?.uri);
  const input: EpubInput = {
    title: options.title,
    author: options.author,
    publisher: options.publisher,
    cover,
    chapters: [{ title: options.title, markdown: stripFrontmatter(markdown) }],
  };
  return buildEpub(input);
}

/** Export a multi-chapter ePub from a list of notes (ordered by updatedAt asc). */
export async function notesToEpubBytes(
  store: NotesStore,
  notes: { title: string; bodyPromise: Promise<string> }[],
  options: BuildEpubOptions,
): Promise<Buffer> {
  void store;
  const chapters: EpubChapter[] = [];
  for (const n of notes) {
    const body = await n.bodyPromise;
    chapters.push({ title: n.title, markdown: stripFrontmatter(body) });
  }
  const cover = await loadCover(options.cover?.uri);
  const input: EpubInput = {
    title: options.title,
    author: options.author,
    publisher: options.publisher,
    cover,
    chapters,
  };
  return buildEpub(input);
}

export function notesForCategory(
  store: NotesStore,
  scope: NoteScope | undefined,
  category: string,
): { title: string; bodyPromise: Promise<string> }[] {
  const list = scope ? store.listByScope(scope) : store.listAll();
  return list
    .filter(n => n.category === category || n.category.startsWith(category + '/'))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map(n => ({ title: n.title, bodyPromise: store.readContent(n) }));
}

async function loadCover(
  uri: vscode.Uri | undefined,
): Promise<EpubInput['cover'] | undefined> {
  if (!uri) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
  const lower = uri.path.toLowerCase();
  const mimeType = lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return { bytes: Buffer.from(bytes), mimeType };
}
