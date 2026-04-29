import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './editor/markdownEditorProvider';
import { NotesStore } from './notes/notesStore';
import { NotesTreeProvider } from './notes/notesTreeProvider';
import { registerNotesCommands } from './notes/notesCommands';
import { WarehouseManager } from './warehouse/warehouseManager';
import { registerWarehouseCommands } from './warehouse/warehouseCommands';
import { disposeLogChannel } from './warehouse/warehouseLog';
import { THEMES } from './themes/themes';

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
  const warehouse = new WarehouseManager(context, notesStore);
  context.subscriptions.push(
    notesStore,
    notesTree,
    warehouse,
    vscode.window.registerTreeDataProvider('markItDown.notes', notesTree),
    ...registerNotesCommands(context, notesStore),
    ...registerWarehouseCommands(warehouse),
  );
  warehouse.start();

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
    vscode.commands.registerCommand('markItDown.pickTheme', async () => {
      const cfg = vscode.workspace.getConfiguration('markItDown');
      const current = cfg.get<string>('theme') ?? 'auto';
      const items: (vscode.QuickPickItem & { value: string })[] = [
        { value: 'auto', label: 'Auto', description: 'Follow VSCode active theme', picked: current === 'auto' },
        ...THEMES.map(t => ({
          value: t.id,
          label: t.label,
          description: t.kind,
          picked: current === t.id,
        })),
      ];
      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: 'Pick a Mark It Down theme',
      });
      if (!choice) return;
      const target = vscode.workspace.workspaceFolders
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      await cfg.update('theme', choice.value, target);
      vscode.window.setStatusBarMessage(`Mark It Down theme: ${choice.label}`, 2500);
    }),
  );
}

export function deactivate() {
  disposeLogChannel();
}
