import * as https from 'https';
import * as vscode from 'vscode';

const REPO_OWNER = 'fadymondy';
const REPO_NAME = 'mark-it-down';
const RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
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

  private async runCheck(opts: { trigger: 'launch' | 'interval' | 'manual' }): Promise<void> {
    const installed = this.installedVersion();
    let release: UpdateInfo | undefined;
    try {
      release = await fetchLatestRelease();
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

function fetchLatestRelease(): Promise<UpdateInfo | undefined> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      RELEASE_API,
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
            // No releases published yet — silently no-op.
            resolve(undefined);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            const json = JSON.parse(body) as {
              tag_name?: string;
              name?: string;
              html_url?: string;
              body?: string;
              published_at?: string;
              draft?: boolean;
              prerelease?: boolean;
            };
            if (!json || json.draft || json.prerelease || !json.tag_name) {
              resolve(undefined);
              return;
            }
            const version = json.tag_name.replace(/^v/, '');
            resolve({
              version,
              htmlUrl: json.html_url ?? `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${json.tag_name}`,
              bodyMarkdown: json.body ?? '',
              publishedAt: json.published_at ?? '',
            });
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

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function parseSemver(v: string): [number, number, number] {
  const cleaned = v.replace(/^v/, '').split('-')[0];
  const parts = cleaned.split('.').map(p => Number.parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}
