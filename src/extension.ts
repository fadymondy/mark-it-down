import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './editor/markdownEditorProvider';
import { NotesStore } from './notes/notesStore';
import { NotesTreeProvider } from './notes/notesTreeProvider';
import { registerNotesCommands } from './notes/notesCommands';
import { WarehouseManager } from './warehouse/warehouseManager';
import { registerWarehouseCommands } from './warehouse/warehouseCommands';
import { disposeLogChannel } from './warehouse/warehouseLog';
import { THEMES } from './themes/themes';
import { markdownToTxt } from './exporters/exportTxt';
import { markdownToDocx } from './exporters/exportDocx';
import { markdownToPdf } from './exporters/exportPdf';
import { registerMcpInstallCommands } from './mcp/installCommand';
import { PublishManager } from './publish/publishManager';
import { registerPublishCommands } from './publish/publishCommands';
import { SlideshowManager } from './slideshow/slideshowManager';
import { registerSlideshowCommands } from './slideshow/slideshowCommands';
import { UpdateChecker } from './updates/updateChecker';

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
  const publish = new PublishManager(context, notesStore);
  const slideshow = new SlideshowManager(context);
  const updates = new UpdateChecker(context);
  context.subscriptions.push(
    notesStore,
    notesTree,
    warehouse,
    updates,
    vscode.window.registerTreeDataProvider('markItDown.notes', notesTree),
    ...registerNotesCommands(context, notesStore),
    ...registerWarehouseCommands(warehouse),
    ...registerMcpInstallCommands(context),
    ...registerPublishCommands(publish),
    ...registerSlideshowCommands(slideshow),
    vscode.commands.registerCommand('markItDown.updates.checkNow', () => updates.checkNow()),
  );
  updates.start();
  warehouse.start();
  void notesStore.writeMcpIndexSnapshot();
  context.subscriptions.push(
    notesStore.onDidChange(() => {
      void notesStore.writeMcpIndexSnapshot();
    }),
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
      await runFileExport(uri, 'pdf', async (md, title) => markdownToPdf(md, title));
    }),
    vscode.commands.registerCommand('markItDown.exportDocx', async (uri?: vscode.Uri) => {
      await runFileExport(uri, 'docx', async md => markdownToDocx(md));
    }),
    vscode.commands.registerCommand('markItDown.exportTxt', async (uri?: vscode.Uri) => {
      await runFileExport(uri, 'txt', async md => Buffer.from(markdownToTxt(md), 'utf8'));
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

type ExportExt = 'pdf' | 'docx' | 'txt';

async function runFileExport(
  uri: vscode.Uri | undefined,
  ext: ExportExt,
  build: (markdown: string, title: string) => Promise<Buffer>,
): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showErrorMessage('Mark It Down: no markdown file selected.');
    return;
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(target);
    const markdown = new TextDecoder().decode(bytes);
    const baseName = target.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'document';
    const dir = vscode.Uri.joinPath(target, '..');
    const defaultUri = vscode.Uri.joinPath(dir, `${baseName}.${ext}`);
    const filterLabel = ext === 'pdf' ? 'PDF' : ext === 'docx' ? 'Word document' : 'Plain text';
    const save = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { [filterLabel]: [ext] },
      title: `Mark It Down: export to ${ext.toUpperCase()}`,
    });
    if (!save) return;
    const buffer = await build(markdown, baseName);
    await vscode.workspace.fs.writeFile(save, buffer);
    const choice = await vscode.window.showInformationMessage(
      `Mark It Down: exported ${save.fsPath.split('/').pop()}`,
      'Open',
      'Reveal',
    );
    if (choice === 'Open') {
      await vscode.commands.executeCommand('vscode.open', save);
    } else if (choice === 'Reveal') {
      await vscode.commands.executeCommand('revealFileInOS', save);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Mark It Down: export failed — ${(err as Error).message}`);
  }
}
