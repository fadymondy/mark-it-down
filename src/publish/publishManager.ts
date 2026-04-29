import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { NotesStore } from '../notes/notesStore';
import { readConfig as readWarehouseConfig, repoSlug, repoUrl, WarehouseConfig } from '../warehouse/warehouseConfig';
import { log } from '../warehouse/warehouseLog';
import { findTheme } from '../themes/themes';
import { PublishConfig, readPublishConfig } from './publishConfig';
import { buildSiteAssets, PageInput, renderIndex, renderPage } from './staticGenerator';
import { attachmentDirName } from '../../packages/core/src/attachments';
import { parseFrontmatter, validateSlug } from '../../packages/core/src/frontmatter';
import lunr from 'lunr';

interface AttachmentToCopy {
  srcUri: vscode.Uri;
  destPathFromRoot: string;
}

export interface PublishResult {
  pages: number;
  branch: string;
  pushedSha?: string;
  url: string;
}

export class PublishManager {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly notesStore: NotesStore,
  ) {}

  public async publishAll(): Promise<PublishResult | undefined> {
    const wh = readWarehouseConfig();
    const pub = readPublishConfig();
    if (!this.requireWarehouse(wh)) return undefined;
    if (!pub.enabled) {
      const ok = await vscode.window.showWarningMessage(
        'Mark It Down: publishing is disabled. Enable markItDown.publish.enabled to publish.',
        'Open Settings',
      );
      if (ok === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'markItDown.publish');
      }
      return undefined;
    }
    const { pages, attachments } = await this.collectAll(wh, pub);
    if (pages.length === 0) {
      vscode.window.showInformationMessage('Mark It Down: nothing to publish.');
      return undefined;
    }
    return this.runBuildAndPush(wh, pub, pages, attachments);
  }

  public async publishCurrent(): Promise<PublishResult | undefined> {
    const wh = readWarehouseConfig();
    const pub = readPublishConfig();
    if (!this.requireWarehouse(wh)) return undefined;
    if (!pub.enabled) {
      vscode.window.showWarningMessage('Mark It Down: publishing is disabled.');
      return undefined;
    }
    const editor = vscode.window.activeTextEditor;
    const uri = editor?.document.uri ?? vscode.window.activeNotebookEditor?.notebook.uri;
    if (!uri) {
      vscode.window.showErrorMessage('Mark It Down: no active markdown to publish.');
      return undefined;
    }
    const buf = await vscode.workspace.fs.readFile(uri);
    const raw = new TextDecoder().decode(buf);
    const fm = parseFrontmatter(raw);
    const overrideSlug = fm.found ? validateSlug(fm.data.slug) : undefined;
    const baseName = (uri.path.split('/').pop() ?? 'page').replace(/\.[^.]+$/, '');
    const slug = overrideSlug ?? baseName;
    const page: PageInput = {
      title: baseName,
      pathFromRoot: `${slug}.html`,
      markdown: fm.body,
    };
    return this.runBuildAndPush(wh, pub, [page], []);
  }

  public async copyShareUrl(uri?: vscode.Uri): Promise<void> {
    const wh = readWarehouseConfig();
    const pub = readPublishConfig();
    if (!this.requireWarehouse(wh)) return;
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      vscode.window.showErrorMessage('Mark It Down: no active file to copy a URL for.');
      return;
    }
    const baseName = (target.path.split('/').pop() ?? 'page').replace(/\.[^.]+$/, '');
    const url = this.pageUrl(wh, pub, `${baseName}.html`);
    await vscode.env.clipboard.writeText(url);
    vscode.window.setStatusBarMessage(`Mark It Down: copied ${url}`, 3000);
  }

  public async openSite(): Promise<void> {
    const wh = readWarehouseConfig();
    if (!this.requireWarehouse(wh)) return;
    const pub = readPublishConfig();
    const url = this.siteUrl(wh, pub);
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  private requireWarehouse(wh: WarehouseConfig): boolean {
    if (wh.enabled) return true;
    void vscode.window.showInformationMessage(
      'Mark It Down: configure markItDown.warehouse.repo first — publishing reuses the warehouse repo as the deploy target.',
      'Open Settings',
    ).then(c => {
      if (c === 'Open Settings') vscode.commands.executeCommand('workbench.action.openSettings', 'markItDown.warehouse.repo');
    });
    return false;
  }

  private async collectAll(
    wh: WarehouseConfig,
    _pub: PublishConfig,
  ): Promise<{ pages: PageInput[]; attachments: AttachmentToCopy[] }> {
    void wh;
    // For v1 we publish all global notes. Workspace notes per workspace are out of scope here.
    const notes = this.notesStore.listByScope('global');
    const pages: PageInput[] = [];
    const attachments: AttachmentToCopy[] = [];
    const slugByPath = new Map<string, string>();
    for (const note of notes) {
      const raw = await this.notesStore.readContent(note);
      const fm = parseFrontmatter(raw);
      const overrideSlug = fm.found ? validateSlug(fm.data.slug) : undefined;
      const fallbackSlug = slugify(note.title);
      const slug = overrideSlug ?? fallbackSlug;
      const pathFromRoot = overrideSlug
        ? `notes/${slug}.html`
        : `notes/${slug}-${note.id}.html`;
      const existing = slugByPath.get(pathFromRoot);
      if (existing && existing !== note.id) {
        log(
          'warn',
          `slug collision: notes ${existing} and ${note.id} both publish to ${pathFromRoot}; appending id to disambiguate.`,
        );
        const safePath = `notes/${slug}-${note.id}.html`;
        pages.push({
          title: note.title,
          pathFromRoot: safePath,
          markdown: fm.body,
        });
        slugByPath.set(safePath, note.id);
        void vscode.window.showWarningMessage(
          `Mark It Down: slug "${slug}" is used by another note — falling back to id-suffixed URL for "${note.title}".`,
        );
      } else {
        pages.push({
          title: note.title,
          pathFromRoot,
          markdown: fm.body,
        });
        slugByPath.set(pathFromRoot, note.id);
      }
      const noteAttachments = await this.notesStore.listAttachments(note);
      for (const att of noteAttachments) {
        attachments.push({
          srcUri: this.notesStore.attachmentUri(note, att.filename),
          destPathFromRoot: `notes/${attachmentDirName(note.id)}/${att.filename}`,
        });
      }
    }
    return { pages, attachments };
  }

  private async runBuildAndPush(
    wh: WarehouseConfig,
    pub: PublishConfig,
    pages: PageInput[],
    attachments: AttachmentToCopy[],
  ): Promise<PublishResult> {
    const cloneRoot = path.join(this.context.globalStorageUri.fsPath, 'warehouse', repoSlug(wh));
    const worktreeRoot = path.join(this.context.globalStorageUri.fsPath, 'publish', repoSlug(wh));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(worktreeRoot)));

    // Ensure warehouse working clone exists (we leverage the warehouse transport contract)
    if (!(await pathExists(cloneRoot))) {
      await runGit(['clone', repoUrl(wh), cloneRoot], undefined);
    } else {
      await runGit(['fetch', '--prune', 'origin'], cloneRoot);
    }

    // Ensure the publish branch exists locally — create from an empty tree if not
    const branchExists = await branchExistsRemote(cloneRoot, pub.branch);
    if (!branchExists) {
      // Create an orphan branch with an initial empty commit
      await runGit(['worktree', 'add', '-B', pub.branch, worktreeRoot, '--detach'], cloneRoot).catch(() => undefined);
      // Fall back: simple checkout + reset
      try {
        await runGit(['rm', '-rf', '.'], worktreeRoot);
      } catch { /* empty */ }
    } else {
      // Add a worktree pointing to that branch
      try {
        await runGit(['worktree', 'remove', '--force', worktreeRoot], cloneRoot);
      } catch { /* not present */ }
      await runGit(['worktree', 'add', worktreeRoot, pub.branch], cloneRoot);
    }

    // Wipe existing site files (keep .git artifacts)
    let entries: [string, vscode.FileType][] = [];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(worktreeRoot));
    } catch { /* ignore */ }
    for (const [name] of entries) {
      if (name === '.git') continue;
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(path.join(worktreeRoot, name)), { recursive: true, useTrash: false });
      } catch { /* ignore */ }
    }

    // Render
    const indexPages = pages.map(p => ({ title: p.title, pathFromRoot: p.pathFromRoot }));
    const subRoot = pub.subPath ? path.join(worktreeRoot, pub.subPath) : worktreeRoot;
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(subRoot));
    const themeDef = pub.theme ?? findTheme('github-light')!;
    const assets = buildSiteAssets(themeDef.palette, themeDef.kind === 'dark');

    // Write each page
    for (const page of pages) {
      const rendered = renderPage(page, indexPages);
      const out = path.join(subRoot, rendered.pathFromRoot);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(out)));
      await vscode.workspace.fs.writeFile(vscode.Uri.file(out), new TextEncoder().encode(rendered.html));
    }

    // Copy note attachments next to their owning notes
    for (const att of attachments) {
      const dest = path.join(subRoot, att.destPathFromRoot);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(dest)));
      try {
        const bytes = await vscode.workspace.fs.readFile(att.srcUri);
        await vscode.workspace.fs.writeFile(vscode.Uri.file(dest), bytes);
      } catch (err) {
        log('warn', `failed to copy attachment ${att.destPathFromRoot}: ${(err as Error).message}`);
      }
    }

    // index.html (overrides any same-named page from the page set; that's fine)
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(path.join(subRoot, 'index.html')),
      new TextEncoder().encode(renderIndex(indexPages)),
    );

    // Shared assets
    const assetsDir = path.join(subRoot, 'assets');
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(assetsDir));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(path.join(assetsDir, 'style.css')),
      new TextEncoder().encode(assets.pageCss),
    );

    // Lunr search index — built from page title + plain-text body
    const docs = pages.map(p => ({
      id: p.pathFromRoot,
      title: p.title,
      body: stripMarkdown(p.markdown),
    }));
    const index = lunr(function () {
      this.ref('id');
      this.field('title', { boost: 5 });
      this.field('body');
      docs.forEach(d => this.add(d));
    });
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(path.join(assetsDir, 'search-index.json')),
      new TextEncoder().encode(
        JSON.stringify({
          index: index.toJSON(),
          docs: docs.map(d => ({ id: d.id, title: d.title, snippet: d.body.slice(0, 200) })),
        }),
      ),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(path.join(assetsDir, 'site.js')),
      new TextEncoder().encode(assets.clientJs),
    );

    // Commit + push
    await runGit(['add', '-A'], worktreeRoot);
    const status = await runGit(['status', '--porcelain'], worktreeRoot, { capture: true });
    let pushedSha: string | undefined;
    if (status.trim().length > 0) {
      const message = `publish: ${pages.length} page(s) — Mark It Down`;
      await runGit(['commit', '-m', message], worktreeRoot, {
        env: { GIT_AUTHOR_NAME: 'Mark It Down', GIT_AUTHOR_EMAIL: 'noreply@markitdown.dev' },
      });
      pushedSha = (await runGit(['rev-parse', 'HEAD'], worktreeRoot, { capture: true })).trim();
      await runGit(['push', 'origin', `HEAD:${pub.branch}`], worktreeRoot);
    }

    // Cleanup the worktree (keep the branch)
    try {
      await runGit(['worktree', 'remove', '--force', worktreeRoot], cloneRoot);
    } catch { /* ignore */ }

    log('info', `published ${pages.length} pages to ${wh.repo}@${pub.branch}` + (pushedSha ? ` (${pushedSha.slice(0, 7)})` : ' (no changes)'));

    const url = this.siteUrl(wh, pub);
    vscode.window.showInformationMessage(`Mark It Down: published ${pages.length} page(s) → ${url}`);

    return { pages: pages.length, branch: pub.branch, pushedSha, url };
  }

  private siteUrl(wh: WarehouseConfig, pub: PublishConfig): string {
    const [owner, repo] = wh.repo.split('/');
    const base = `https://${owner}.github.io/${repo}`;
    return pub.subPath ? `${base}/${pub.subPath}/` : `${base}/`;
  }

  private pageUrl(wh: WarehouseConfig, pub: PublishConfig, relative: string): string {
    return `${this.siteUrl(wh, pub).replace(/\/?$/, '/')}${relative}`;
  }
}

function stripMarkdown(md: string): string {
  // Cheap text extractor — strip code fences, mermaid blocks, html tags,
  // and link / heading / emphasis markers so the search index is on prose.
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'page'
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
