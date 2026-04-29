import * as vscode from 'vscode';
import { NotesStore } from './notesStore';
import type { AttachmentUploader } from '../editor/markdownEditorProvider';

/**
 * Bridges the editor's `attachUpload` IPC into NotesStore. Looks up the
 * note backing the document URI and writes the bytes into its sibling
 * attachments dir.
 */
export function buildAttachmentUploader(store: NotesStore): AttachmentUploader {
  return {
    async save(documentUri: vscode.Uri, rawName: string, bytes: Uint8Array) {
      const note = store.getByUri(documentUri);
      if (!note) return undefined;
      const result = await store.addAttachment(note, rawName, bytes);
      return { noteId: note.id, filename: result.filename };
    },
  };
}
