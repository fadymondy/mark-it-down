import * as https from 'https';
import * as vscode from 'vscode';
import { compareSemver } from '../../packages/core/src/semver';

const REPO_OWNER = 'fadymondy';
const REPO_NAME = 'mark-it-down';
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const ALL_RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=20`;
const STATE_KEYS = {
  lastCheckedAt: 'markItDown.updates.lastCheckedAt',
  lastSeenVersion: 'markItDown.updates.lastSeenVersion',
  installedVersion: 'markItDown.updates.installedVersion',
};
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface UpdateInfo {
  version: string;
  htmlUrl: string;
  bodyMarkdown: string;
  publishedAt: string;
}

export class UpdateChecker {
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public start(): void {
    void this.maybeShowWhatsNew();
    if (!this.checkOnLaunchEnabled()) return;
    void this.runCheck({ trigger: 'launch' });
    this.timer = setInterval(() => {
      void this.runCheck({ trigger: 'interval' });
    }, DEFAULT_INTERVAL_MS);
  }

  public dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }

  public async checkNow(): Promise<void> {
    await this.runCheck({ trigger: 'manual' });
  }

  private checkOnLaunchEnabled(): boolean {
    return vscode.workspace.getConfiguration('markItDown.updates').get<boolean>('checkOnLaunch') ?? true;
  }

  private channel(): 'stable' | 'beta' {
    const v = vscode.workspace.getConfiguration('markItDown.updates').get<string>('channel') ?? 'stable';
    return v === 'beta' ? 'beta' : 'stable';
  }

  private async runCheck(opts: { trigger: 'launch' | 'interval' | 'manual' }): Promise<void> {
    const installed = this.installedVersion();
    let release: UpdateInfo | undefined;
    try {
      release = await fetchLatestRelease(this.channel());
    } catch (err) {
      if (opts.trigger === 'manual') {
        vscode.window.showErrorMessage(`Mark It Down: update check failed — ${(err as Error).message}`);
      }
      return;
    }
    await this.context.globalState.update(STATE_KEYS.lastCheckedAt, Date.now());
    if (!release) return;

    if (compareSemver(release.version, installed) <= 0) {
      if (opts.trigger === 'manual') {
        vscode.window.showInformationMessage(`Mark It Down: you're on the latest version (v${installed}).`);
      }
      return;
    }
    const lastSeen = this.context.globalState.get<string>(STATE_KEYS.lastSeenVersion) ?? '';
    if (opts.trigger !== 'manual' && lastSeen === release.version) {
      // Already notified the user about this version; don't re-notify silently.
      return;
    }
    await this.context.globalState.update(STATE_KEYS.lastSeenVersion, release.version);
    const action = await vscode.window.showInformationMessage(
      `Mark It Down: v${release.version} is available (you're on v${installed}).`,
      'Open Release',
      'View Changes',
      'Later',
    );
    if (action === 'Open Release') {
      await vscode.env.openExternal(vscode.Uri.parse(release.htmlUrl));
    } else if (action === 'View Changes') {
      await this.openReleaseNotes(release);
    }
  }

  private async openReleaseNotes(release: UpdateInfo): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: `# Mark It Down v${release.version}\n\nReleased ${release.publishedAt}\n\n${release.bodyMarkdown}\n\n---\n\n[Open release on GitHub](${release.htmlUrl})\n`,
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  private installedVersion(): string {
    return this.context.extension?.packageJSON?.version ?? '0.0.0';
  }

  private async maybeShowWhatsNew(): Promise<void> {
    const current = this.installedVersion();
    const last = this.context.globalState.get<string>(STATE_KEYS.installedVersion);
    if (last === current) return;
    await this.context.globalState.update(STATE_KEYS.installedVersion, current);
    if (!last) return; // first install — no "what's new" toast
    const action = await vscode.window.showInformationMessage(
      `Mark It Down updated to v${current}.`,
      'View What\'s New',
      'Dismiss',
    );
    if (action === 'View What\'s New') {
      const url = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${current}`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }
}

interface RawRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
}

function fetchLatestRelease(channel: 'stable' | 'beta'): Promise<UpdateInfo | undefined> {
  // For stable users we can use the cheap /releases/latest endpoint that
  // already filters out drafts + pre-releases. For beta users we have to
  // fetch the full list and pick the newest non-draft (pre-release OR stable).
  if (channel === 'stable') {
    return fetchSingle(LATEST_RELEASE_API, raw => {
      if (raw.draft || raw.prerelease) return undefined;
      return toUpdateInfo(raw);
    });
  }
  return fetchList(ALL_RELEASES_API, list => {
    const candidate = list.find(r => !r.draft);
    return candidate ? toUpdateInfo(candidate) : undefined;
  });
}

function toUpdateInfo(raw: RawRelease): UpdateInfo | undefined {
  if (!raw.tag_name) return undefined;
  const version = raw.tag_name.replace(/^v/, '');
  return {
    version,
    htmlUrl: raw.html_url ?? `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${raw.tag_name}`,
    bodyMarkdown: raw.body ?? '',
    publishedAt: raw.published_at ?? '',
  };
}

function fetchSingle(url: string, pick: (raw: RawRelease) => UpdateInfo | undefined): Promise<UpdateInfo | undefined> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'mark-it-down-vscode-extension',
          Accept: 'application/vnd.github+json',
        },
        timeout: 10_000,
      },
      res => {
        let body = '';
        res.on('data', chunk => (body += chunk.toString()));
        res.on('end', () => {
          if (res.statusCode === 404) {
            resolve(undefined);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            const json = JSON.parse(body) as RawRelease;
            resolve(json ? pick(json) : undefined);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.end();
  });
}

function fetchList(url: string, pick: (list: RawRelease[]) => UpdateInfo | undefined): Promise<UpdateInfo | undefined> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'mark-it-down-vscode-extension',
          Accept: 'application/vnd.github+json',
        },
        timeout: 10_000,
      },
      res => {
        let body = '';
        res.on('data', chunk => (body += chunk.toString()));
        res.on('end', () => {
          if (res.statusCode === 404) {
            resolve(undefined);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            const json = JSON.parse(body) as RawRelease[];
            resolve(Array.isArray(json) ? pick(json) : undefined);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.end();
  });
}

// Re-export from packages/core so existing tests (tests/unit/semver.test.ts)
// keep passing without import-path churn.
export { compareSemver, parseSemver } from '../../packages/core/src/semver';
