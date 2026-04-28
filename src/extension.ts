import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './editor/markdownEditorProvider';
import { NotesStore } from './notes/notesStore';
import { NotesTreeProvider } from './notes/notesTreeProvider';
import { registerNotesCommands } from './notes/notesCommands';

export function activate(context: vscode.ExtensionContext) {
  const provider = new MarkdownEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      MarkdownEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
  );

  const notesStore = new NotesStore(context);
  const notesTree = new NotesTreeProvider(notesStore);
  context.subscriptions.push(
    notesStore,
    notesTree,
    vscode.window.registerTreeDataProvider('markItDown.notes', notesTree),
    ...registerNotesCommands(context, notesStore),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markItDown.toggleMode', () => {
      provider.toggleActiveMode();
    }),
    vscode.commands.registerCommand('markItDown.openWithDefaultEditor', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) {
        vscode.commands.executeCommand('vscode.openWith', target, 'default');
      }
    }),
    vscode.commands.registerCommand('markItDown.exportPdf', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) return;
      vscode.window.showInformationMessage('PDF export — coming in v0.6');
    }),
    vscode.commands.registerCommand('markItDown.exportDocx', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) return;
      vscode.window.showInformationMessage('DOCX export — coming in v0.6');
    }),
    vscode.commands.registerCommand('markItDown.exportTxt', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) return;
      vscode.window.showInformationMessage('TXT export — coming in v0.6');
    }),
  );
}

export function deactivate() {
  // no-op
}
