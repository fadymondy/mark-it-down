import * as vscode from 'vscode';
import { NotesStore, NoteMetadata } from './notesStore';
import { buildBacklinks, BacklinkEntry, BacklinksMap, NoteWithBody } from '../../packages/core/src/wikilinks/resolver';

/**
 * Builds and refreshes the wiki-link backlinks map for the entire notes
 * corpus. Refreshes on store changes and on file save (debounced).
 *
 * Reading every note body for every refresh is fine at the scale this
 * extension targets (a few thousand notes max). If that becomes hot, swap
 * for an incremental per-note index keyed by file content hash.
 */
export class BacklinksIndex implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.emitter.event;

  private map: BacklinksMap = new Map();
  private subs: vscode.Disposable[] = [];
  private rebuildPending = false;
  private debounceHandle: NodeJS.Timeout | undefined;

  constructor(private readonly store: NotesStore) {
    this.subs.push(store.onDidChange(() => this.scheduleRebuild()));
  }

  public start(): void {
    void this.rebuild();
  }

  public for(noteId: string): BacklinkEntry[] {
    return this.map.get(noteId) ?? [];
  }

  public async rebuild(): Promise<void> {
    const all = this.store.listAll();
    const corpus: NoteWithBody[] = [];
    for (const meta of all) {
      try {
        const body = await this.store.readContent(meta);
        corpus.push({ id: meta.id, title: meta.title, body });
      } catch {
        // file missing — skip
      }
    }
    this.map = buildBacklinks(corpus);
    this.emitter.fire();
  }

  private scheduleRebuild(): void {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.rebuildPending = true;
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = undefined;
      this.rebuildPending = false;
      void this.rebuild();
    }, 300);
  }

  public hasPendingRebuild(): boolean {
    return this.rebuildPending;
  }

  public titleIndex(): { id: string; title: string }[] {
    return this.store.listAll().map((n: NoteMetadata) => ({ id: n.id, title: n.title }));
  }

  public dispose(): void {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.subs.forEach(s => s.dispose());
    this.emitter.dispose();
  }
}
