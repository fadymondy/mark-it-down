import * as vscode from 'vscode';
import { NoteMetadata, NoteScope } from '../notes/notesStore';

export interface ConflictRecord {
  noteId: string;
  scope: NoteScope;
  title: string;
  category: string;
  /** Local-side metadata at the moment the conflict was detected. */
  local: NoteMetadata;
  /** Remote-side metadata snapshot. */
  remote: { updatedAt: string };
  /** Pre-fetched remote content so the panel doesn't have to re-clone. */
  remoteContent: string;
  /** Local content snapshot. */
  localContent: string;
  detectedAt: string;
}

export class ConflictRegistry implements vscode.Disposable {
  private readonly conflicts = new Map<string, ConflictRecord>();
  private readonly emitter = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.emitter.event;

  public list(): ConflictRecord[] {
    return [...this.conflicts.values()].sort((a, b) =>
      a.detectedAt.localeCompare(b.detectedAt),
    );
  }

  public count(): number {
    return this.conflicts.size;
  }

  public get(id: string): ConflictRecord | undefined {
    return this.conflicts.get(id);
  }

  public record(record: ConflictRecord): void {
    this.conflicts.set(record.noteId, record);
    this.emitter.fire();
  }

  public resolve(id: string): ConflictRecord | undefined {
    const r = this.conflicts.get(id);
    if (!r) return undefined;
    this.conflicts.delete(id);
    this.emitter.fire();
    return r;
  }

  public clear(): void {
    if (this.conflicts.size === 0) return;
    this.conflicts.clear();
    this.emitter.fire();
  }

  public dispose(): void {
    this.emitter.dispose();
  }
}
