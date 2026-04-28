import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { repoSlug, repoUrl, WarehouseConfig } from './warehouseConfig';
import { log } from './warehouseLog';

export interface WarehouseClone {
  /** Absolute path to the working clone on disk. */
  root: string;
  /** True when the working clone was just created in this call. */
  freshlyCloned: boolean;
}

export interface RemoteStatus {
  ahead: number;
  behind: number;
  hasDiverged: boolean;
  workingTreeClean: boolean;
}

export class WarehouseTransport {
  private setupGitOnceFor: string | undefined;

  constructor(private readonly extensionStorage: vscode.Uri) {}

  public cloneRoot(config: WarehouseConfig): string {
    return path.join(this.extensionStorage.fsPath, 'warehouse', repoSlug(config));
  }

  public async ensureClone(config: WarehouseConfig): Promise<WarehouseClone> {
    await this.maybeSetupGitForGh(config);
    const root = this.cloneRoot(config);
    const exists = await pathExists(root);
    if (exists) {
      const isRepo = await pathExists(path.join(root, '.git'));
      if (isRepo) {
        return { root, freshlyCloned: false };
      }
      throw new Error(`Warehouse cache directory exists but is not a git repo: ${root}`);
    }
    await ensureDir(path.dirname(root));
    log('info', `cloning ${config.repo}@${config.branch} into ${root}`);
    await runGit(
      ['clone', '--branch', config.branch, '--single-branch', repoUrl(config), root],
      undefined,
    );
    return { root, freshlyCloned: true };
  }

  public async pull(config: WarehouseConfig, clone: WarehouseClone): Promise<void> {
    await this.maybeSetupGitForGh(config);
    log('info', `pulling ${config.repo}@${config.branch}`);
    await runGit(['fetch', '--prune', 'origin', config.branch], clone.root);
    await runGit(['reset', '--hard', `origin/${config.branch}`], clone.root);
  }

  public async commitAndPush(
    config: WarehouseConfig,
    clone: WarehouseClone,
    files: string[],
    message: string,
  ): Promise<{ committed: boolean; sha?: string }> {
    if (files.length === 0) {
      return { committed: false };
    }
    await this.maybeSetupGitForGh(config);
    await runGit(['add', '--', ...files], clone.root);
    const status = await runGit(['status', '--porcelain'], clone.root, { capture: true });
    if (status.trim().length === 0) {
      return { committed: false };
    }
    await runGit(['commit', '-m', message], clone.root, {
      env: { GIT_AUTHOR_NAME: 'Mark It Down', GIT_AUTHOR_EMAIL: 'noreply@markitdown.dev' },
    });
    const sha = (await runGit(['rev-parse', 'HEAD'], clone.root, { capture: true })).trim();
    log('info', `pushing commit ${sha.slice(0, 7)} to origin/${config.branch}`);
    await runGit(['push', 'origin', `HEAD:${config.branch}`], clone.root);
    return { committed: true, sha };
  }

  public async status(config: WarehouseConfig, clone: WarehouseClone): Promise<RemoteStatus> {
    await runGit(['fetch', '--prune', 'origin', config.branch], clone.root);
    const counts = (
      await runGit(['rev-list', '--left-right', '--count', `origin/${config.branch}...HEAD`], clone.root, {
        capture: true,
      })
    ).trim();
    const [behindStr, aheadStr] = counts.split(/\s+/);
    const behind = Number.parseInt(behindStr ?? '0', 10) || 0;
    const ahead = Number.parseInt(aheadStr ?? '0', 10) || 0;
    const tree = (await runGit(['status', '--porcelain'], clone.root, { capture: true })).trim();
    return {
      ahead,
      behind,
      hasDiverged: ahead > 0 && behind > 0,
      workingTreeClean: tree.length === 0,
    };
  }

  public async fileExists(clone: WarehouseClone, relative: string): Promise<boolean> {
    return pathExists(path.join(clone.root, relative));
  }

  public absolute(clone: WarehouseClone, relative: string): string {
    return path.join(clone.root, relative);
  }

  private async maybeSetupGitForGh(config: WarehouseConfig): Promise<void> {
    if (config.transport !== 'gh') return;
    if (this.setupGitOnceFor === config.repo) return;
    try {
      await runProcess('gh', ['auth', 'status'], undefined, { capture: true });
    } catch {
      throw new Error(
        'Warehouse transport "gh" requires the GitHub CLI. Install gh and run `gh auth login`, or switch markItDown.warehouse.transport to "git".',
      );
    }
    try {
      await runProcess('gh', ['auth', 'setup-git'], undefined, { capture: true });
      this.setupGitOnceFor = config.repo;
      log('info', `gh auth setup-git applied for transport=gh`);
    } catch (err) {
      log('warn', 'gh auth setup-git failed; falling back to user git credentials', err);
    }
  }
}

interface RunOpts {
  capture?: boolean;
  env?: NodeJS.ProcessEnv;
}

function runGit(args: string[], cwd: string | undefined, opts: RunOpts = {}): Promise<string> {
  return runProcess('git', args, cwd, opts);
}

function runProcess(
  cmd: string,
  args: string[],
  cwd: string | undefined,
  opts: RunOpts = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => {
      stdout += d.toString();
    });
    child.stderr.on('data', d => {
      stderr += d.toString();
    });
    child.on('error', err => reject(err));
    child.on('close', code => {
      if (code === 0) {
        resolve(opts.capture ? stdout : stderr || stdout);
      } else {
        const detail = (stderr || stdout || '').trim();
        reject(new Error(`${cmd} ${args.join(' ')} exited ${code}${detail ? `: ${detail}` : ''}`));
      }
    });
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(p));
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p: string): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(p));
  } catch {
    // already exists
  }
}
