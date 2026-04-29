import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './editor/markdownEditorProvider';
import { NotesStore } from './notes/notesStore';
import { NotesTreeProvider } from './notes/notesTreeProvider';
import { registerNotesCommands } from './notes/notesCommands';
import { BacklinksIndex } from './notes/backlinksIndex';
import { BacklinksTreeProvider, buildNoteIndexProvider } from './notes/backlinksProvider';
import { buildAttachmentUploader } from './notes/notesAttachmentUploader';
import { WarehouseManager } from './warehouse/warehouseManager';
import { registerWarehouseCommands } from './warehouse/warehouseCommands';
import { disposeLogChannel } from './warehouse/warehouseLog';
import { THEMES } from './themes/themes';
import { markdownToTxt } from './exporters/exportTxt';
import { markdownToDocx } from './exporters/exportDocx';
import { markdownToPdf } from './exporters/exportPdf';
import {
  markdownToEpubBytes,
  notesForCategory,
  notesToEpubBytes,
} from './exporters/exportEpub';
import { registerMcpInstallCommands } from './mcp/installCommand';
import { McpIpcServer } from './mcp/ipcServer';
import { PublishManager } from './publish/publishManager';
import { registerPublishCommands } from './publish/publishCommands';
import { SlideshowManager } from './slideshow/slideshowManager';
import { registerSlideshowCommands } from './slideshow/slideshowCommands';
import { UpdateChecker } from './updates/updateChecker';
import { TelemetryClient } from './telemetry/telemetryClient';

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
  const backlinksIndex = new BacklinksIndex(notesStore);
  const backlinksTree = new BacklinksTreeProvider(notesStore, backlinksIndex);
  const noteIndexProviderHandle = buildNoteIndexProvider(notesStore, backlinksIndex);
  context.subscriptions.push(
    provider.attachNoteIndex(noteIndexProviderHandle.provider),
    new vscode.Disposable(() => noteIndexProviderHandle.dispose()),
    provider.attachAttachmentUploader(buildAttachmentUploader(notesStore)),
  );
  const warehouse = new WarehouseManager(context, notesStore);
  const publish = new PublishManager(context, notesStore);
  const slideshow = new SlideshowManager(context);
  const updates = new UpdateChecker(context);
  const telemetry = new TelemetryClient(context);
  context.subscriptions.push(
    notesStore,
    notesTree,
    backlinksIndex,
    backlinksTree,
    warehouse,
    slideshow,
    updates,
    vscode.window.registerTreeDataProvider('markItDown.notes', notesTree),
    vscode.window.registerTreeDataProvider('markItDown.backlinks', backlinksTree),
    ...registerNotesCommands(context, notesStore),
    ...registerWarehouseCommands(warehouse),
    ...registerMcpInstallCommands(context),
    ...registerPublishCommands(publish),
    ...registerSlideshowCommands(slideshow),
    vscode.commands.registerCommand('markItDown.updates.checkNow', () => updates.checkNow()),
    vscode.commands.registerCommand('markItDown.backlinks.refresh', () => {
      void backlinksIndex.rebuild();
    }),
    telemetry,
    vscode.commands.registerCommand('markItDown.telemetry.sendTestEvent', () => {
      telemetry.captureMessage('Mark It Down test event from command palette', 'info');
      vscode.window.showInformationMessage(
        'Mark It Down: test event queued. If telemetry is enabled and a DSN is configured, it will appear in your Sentry project within ~30s.',
      );
    }),
  );
  backlinksIndex.start();
  updates.start();
  void telemetry.start();
  warehouse.start();
  void notesStore.writeMcpIndexSnapshot();
  const ipcServer = new McpIpcServer(context);
  context.subscriptions.push(ipcServer);
  ipcServer.start().catch(err => {
    console.warn('[mid] MCP IPC listener failed to start:', (err as Error).message);
  });
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
    vscode.commands.registerCommand('markItDown.exportEpub', async (uri?: vscode.Uri) => {
      await runFileExport(uri, 'epub', async (md, title) =>
        markdownToEpubBytes(md, {
          title,
          author: epubAuthor(),
          publisher: epubPublisher(),
          cover: await resolveEpubCover(),
        }),
      );
    }),
    vscode.commands.registerCommand('markItDown.exportCategoryEpub', async () => {
      const allCategories = notesStore.categoriesInUse();
      if (allCategories.length === 0) {
        vscode.window.showInformationMessage('Mark It Down: no notes yet — create some first.');
        return;
      }
      const picked = await vscode.window.showQuickPick(allCategories, {
        placeHolder: 'Pick a category to bundle as ePub',
      });
      if (!picked) return;
      const chapters = notesForCategory(notesStore, undefined, picked);
      if (chapters.length === 0) {
        vscode.window.showInformationMessage(`Mark It Down: no notes under "${picked}".`);
        return;
      }
      const fileTitle = picked.replace(/[^A-Za-z0-9._-]+/g, '-');
      const defaultUri = vscode.Uri.joinPath(
        notesStore.hasWorkspaceStorage()
          ? vscode.workspace.workspaceFolders?.[0]?.uri ?? context.globalStorageUri
          : context.globalStorageUri,
        `${fileTitle}.epub`,
      );
      const save = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { ePub: ['epub'] },
        title: `Mark It Down: export "${picked}" as ePub`,
      });
      if (!save) return;
      try {
        const bytes = await notesToEpubBytes(notesStore, chapters, {
          title: picked,
          author: epubAuthor(),
          publisher: epubPublisher(),
          cover: await resolveEpubCover(),
        });
        await vscode.workspace.fs.writeFile(save, bytes);
        const choice = await vscode.window.showInformationMessage(
          `Mark It Down: bundled ${chapters.length} note(s) → ${save.fsPath.split('/').pop()}`,
          'Open',
          'Reveal',
        );
        if (choice === 'Open') await vscode.commands.executeCommand('vscode.open', save);
        else if (choice === 'Reveal') await vscode.commands.executeCommand('revealFileInOS', save);
      } catch (err) {
        vscode.window.showErrorMessage(`Mark It Down: ePub export failed — ${(err as Error).message}`);
      }
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

type ExportExt = 'pdf' | 'docx' | 'txt' | 'epub';

function epubAuthor(): string {
  return (vscode.workspace.getConfiguration('markItDown.epub').get<string>('author') ?? '').trim() || 'Mark It Down';
}

function epubPublisher(): string | undefined {
  const v = (vscode.workspace.getConfiguration('markItDown.epub').get<string>('publisher') ?? '').trim();
  return v.length > 0 ? v : undefined;
}

async function resolveEpubCover(): Promise<{ uri: vscode.Uri } | undefined> {
  const raw = (vscode.workspace.getConfiguration('markItDown.epub').get<string>('coverImage') ?? '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('/') || /^[A-Za-z]:[/\\]/.test(raw)) {
    return { uri: vscode.Uri.file(raw) };
  }
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!ws) return undefined;
  return { uri: vscode.Uri.joinPath(ws, raw) };
}

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
    const filterLabel =
      ext === 'pdf'
        ? 'PDF'
        : ext === 'docx'
          ? 'Word document'
          : ext === 'epub'
            ? 'ePub'
            : 'Plain text';
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
