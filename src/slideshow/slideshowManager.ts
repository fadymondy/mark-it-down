import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { readConfig as readWarehouseConfig, repoSlug, repoUrl, WarehouseConfig } from '../warehouse/warehouseConfig';
import { readPublishConfig } from '../publish/publishConfig';
import { buildSlideshow, DEFAULT_OPTIONS, SlideshowOptions } from './slideshowGenerator';

interface PreviewSession {
  panel: vscode.WebviewPanel;
  documentUri: vscode.Uri;
  index: { h: number; v: number; f?: number };
  rebuildTimer?: NodeJS.Timeout;
  subs: vscode.Disposable[];
}

const REBUILD_DEBOUNCE_MS = 120;

export class SlideshowManager implements vscode.Disposable {
  private readonly sessions = new Map<string, PreviewSession>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async previewLocal(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Mark It Down: open a markdown file to preview as slideshow.');
      return;
    }
    const documentUri = editor.document.uri;
    const key = documentUri.toString();
    const existing = this.sessions.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      this.rebuild(existing, editor.document.getText());
      return;
    }
    const initialIndex = { h: 0, v: 0, f: 0 };
    const panel = vscode.window.createWebviewPanel(
      'markItDown.slideshow',
      `Slideshow — ${this.titleFor(documentUri)}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const session: PreviewSession = {
      panel,
      documentUri,
      index: initialIndex,
      subs: [],
    };
    session.subs.push(
      panel.webview.onDidReceiveMessage(msg => this.handleWebviewMessage(session, msg)),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.uri.toString() === key) {
          this.scheduleRebuild(session, e.document.getText());
        }
      }),
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (doc.uri.toString() === key) {
          // Skip the debounce on explicit save — rebuild immediately.
          this.rebuild(session, doc.getText());
        }
      }),
    );
    panel.onDidDispose(() => this.disposeSession(key));
    this.sessions.set(key, session);
    this.rebuild(session, editor.document.getText(), { firstPaint: true });
  }

  private scheduleRebuild(session: PreviewSession, text: string): void {
    if (session.rebuildTimer) clearTimeout(session.rebuildTimer);
    session.rebuildTimer = setTimeout(() => {
      session.rebuildTimer = undefined;
      this.rebuild(session, text);
    }, REBUILD_DEBOUNCE_MS);
  }

  private rebuild(session: PreviewSession, markdown: string, opts: { firstPaint?: boolean } = {}): void {
    if (session.panel.visible === false && !opts.firstPaint) {
      // Still rebuild — when the user reveals the panel, the freshest content greets them.
    }
    const built = buildSlideshow(
      { markdown, fallbackTitle: this.titleFor(session.documentUri) },
      {
        ...this.optionsFromSettings(),
        liveReload: { initialIndex: session.index },
      },
    );
    session.panel.title = `Slideshow — ${built.title}`;
    session.panel.webview.html = built.html.replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' https: 'unsafe-inline'; script-src 'self' https: 'unsafe-inline' 'unsafe-eval'; img-src 'self' https: data:; font-src 'self' https: data:; connect-src https:;">`,
    );
    if (opts.firstPaint) {
      vscode.window.setStatusBarMessage(
        `Mark It Down: live-preview ${built.slideCount} slide(s) — theme=${built.options.theme}`,
        4000,
      );
    }
  }

  private handleWebviewMessage(session: PreviewSession, msg: { type?: unknown; h?: unknown; v?: unknown; f?: unknown }): void {
    if (msg?.type === 'slideshow.position') {
      const h = typeof msg.h === 'number' ? msg.h : 0;
      const v = typeof msg.v === 'number' ? msg.v : 0;
      const f = typeof msg.f === 'number' ? msg.f : 0;
      session.index = { h, v, f };
    }
  }

  private disposeSession(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    if (session.rebuildTimer) clearTimeout(session.rebuildTimer);
    session.subs.forEach(s => s.dispose());
    this.sessions.delete(key);
  }

  public dispose(): void {
    for (const key of [...this.sessions.keys()]) this.disposeSession(key);
  }

  public async publish(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Mark It Down: open a markdown file to publish as slideshow.');
      return;
    }
    const wh = readWarehouseConfig();
    const pub = readPublishConfig();
    if (!wh.enabled) {
      this.warnNoWarehouse();
      return;
    }
    if (!pub.enabled) {
      vscode.window.showWarningMessage(
        'Mark It Down: enable markItDown.publish.enabled to publish — slideshow publish reuses the same pipeline.',
      );
      return;
    }
    const built = buildSlideshow(
      { markdown: editor.document.getText(), fallbackTitle: this.titleFor(editor.document.uri) },
      this.optionsFromSettings(),
    );
    const baseName = (editor.document.uri.path.split('/').pop() ?? 'slides').replace(/\.[^.]+$/, '');
    const relPath = `slides/${slugify(baseName)}.html`;

    try {
      const sha = await this.pushHtml(wh, pub.branch, pub.subPath, relPath, built.html);
      const url = this.publicUrl(wh, pub.branch, pub.subPath, relPath);
      const action = await vscode.window.showInformationMessage(
        `Mark It Down: slideshow published${sha ? ` (${sha.slice(0, 7)})` : ''} → ${url}`,
        'Open',
        'Copy URL',
      );
      if (action === 'Open') {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      } else if (action === 'Copy URL') {
        await vscode.env.clipboard.writeText(url);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Mark It Down slideshow publish: ${(err as Error).message}`);
    }
  }

  public async copyShareUrl(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Mark It Down: open a markdown file to copy a slideshow URL.');
      return;
    }
    const wh = readWarehouseConfig();
    const pub = readPublishConfig();
    if (!wh.enabled) {
      this.warnNoWarehouse();
      return;
    }
    const baseName = (editor.document.uri.path.split('/').pop() ?? 'slides').replace(/\.[^.]+$/, '');
    const url = this.publicUrl(wh, pub.branch, pub.subPath, `slides/${slugify(baseName)}.html`);
    await vscode.env.clipboard.writeText(url);
    vscode.window.setStatusBarMessage(`Mark It Down: copied ${url}`, 3000);
  }

  public async exportPdf(): Promise<void> {
    const url = await vscode.window.showInformationMessage(
      'Mark It Down: PDF export of slideshow is deferred to a future release. ' +
        'For now, publish the slideshow and use your browser\'s reveal.js PDF print mode (append `?print-pdf`).',
      'Show docs',
    );
    if (url === 'Show docs') {
      await vscode.env.openExternal(vscode.Uri.parse('https://revealjs.com/pdf-export/'));
    }
  }

  private optionsFromSettings(): SlideshowOptions {
    const cfg = vscode.workspace.getConfiguration('markItDown.slideshow');
    return {
      theme: cfg.get<string>('theme') ?? DEFAULT_OPTIONS.theme,
      transition: cfg.get<string>('transition') ?? DEFAULT_OPTIONS.transition,
      speakerNotes: cfg.get<boolean>('includeSpeakerNotes') ?? DEFAULT_OPTIONS.speakerNotes,
    };
  }

  private titleFor(uri: vscode.Uri): string {
    return (uri.path.split('/').pop() ?? 'slides').replace(/\.[^.]+$/, '');
  }

  private warnNoWarehouse(): void {
    void vscode.window
      .showInformationMessage(
        'Mark It Down: configure markItDown.warehouse.repo first — slideshow publish reuses the warehouse repo.',
        'Open Settings',
      )
      .then(c => {
        if (c === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'markItDown.warehouse.repo');
        }
      });
  }

  private async pushHtml(
    wh: WarehouseConfig,
    branch: string,
    subPath: string,
    relativePath: string,
    html: string,
  ): Promise<string | undefined> {
    const cloneRoot = path.join(this.context.globalStorageUri.fsPath, 'warehouse', repoSlug(wh));
    const worktreeRoot = path.join(this.context.globalStorageUri.fsPath, 'slideshow', repoSlug(wh));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(worktreeRoot)));
    if (!(await pathExists(cloneRoot))) {
      await runGit(['clone', repoUrl(wh), cloneRoot], undefined);
    } else {
      await runGit(['fetch', '--prune', 'origin'], cloneRoot);
    }
    const branchExists = await branchExistsRemote(cloneRoot, branch);
    try {
      await runGit(['worktree', 'remove', '--force', worktreeRoot], cloneRoot);
    } catch { /* not present */ }
    if (branchExists) {
      await runGit(['worktree', 'add', worktreeRoot, branch], cloneRoot);
    } else {
      await runGit(['worktree', 'add', '-B', branch, worktreeRoot, '--detach'], cloneRoot);
      try {
        await runGit(['rm', '-rf', '.'], worktreeRoot);
      } catch { /* empty */ }
    }
    const subRoot = subPath ? path.join(worktreeRoot, subPath) : worktreeRoot;
    const target = path.join(subRoot, relativePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(target), new TextEncoder().encode(html));

    await runGit(['add', '-A'], worktreeRoot);
    const status = await runGit(['status', '--porcelain'], worktreeRoot, { capture: true });
    let sha: string | undefined;
    if (status.trim().length > 0) {
      await runGit(['commit', '-m', `slideshow: ${relativePath} — Mark It Down`], worktreeRoot, {
        env: { GIT_AUTHOR_NAME: 'Mark It Down', GIT_AUTHOR_EMAIL: 'noreply@markitdown.dev' },
      });
      sha = (await runGit(['rev-parse', 'HEAD'], worktreeRoot, { capture: true })).trim();
      await runGit(['push', 'origin', `HEAD:${branch}`], worktreeRoot);
    }
    try {
      await runGit(['worktree', 'remove', '--force', worktreeRoot], cloneRoot);
    } catch { /* ignore */ }
    return sha;
  }

  private publicUrl(wh: WarehouseConfig, _branch: string, subPath: string, relativePath: string): string {
    const [owner, repo] = wh.repo.split('/');
    const base = `https://${owner}.github.io/${repo}`;
    const sub = subPath ? `/${subPath}` : '';
    return `${base}${sub}/${relativePath}`;
  }
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'slides'
  );
}

interface RunOpts {
  capture?: boolean;
  env?: NodeJS.ProcessEnv;
}

function runGit(args: string[], cwd: string | undefined, opts: RunOpts = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString()));
    child.stderr.on('data', d => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(opts.capture ? stdout : stderr || stdout);
      else reject(new Error(`git ${args.join(' ')} exited ${code}: ${(stderr || stdout).trim()}`));
    });
  });
}

async function branchExistsRemote(cwd: string, branch: string): Promise<boolean> {
  try {
    const out = await runGit(['ls-remote', '--heads', 'origin', branch], cwd, { capture: true });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(p));
    return true;
  } catch {
    return false;
  }
}
