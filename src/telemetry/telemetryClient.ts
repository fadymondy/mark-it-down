import * as Sentry from '@sentry/node';
import * as vscode from 'vscode';
import { generateSessionId, sanitizeDeep, StaticPathAnchors } from './sanitize';

const TELEMETRY_CONSENT_KEY = 'markItDown.telemetry.consentShown';
const SESSION_ID = generateSessionId();
let initialized = false;
let pathAnchors: StaticPathAnchors | undefined;

export class TelemetryClient implements vscode.Disposable {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public async start(): Promise<void> {
    await this.maybePromptConsent();
    this.tryInit();
    // Re-init if the user flips the setting at runtime.
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('markItDown.telemetry')) {
          this.tryInit();
        }
      }),
    );
  }

  public captureException(err: unknown, tags?: Record<string, string>): void {
    if (!initialized) return;
    Sentry.captureException(err, scope => {
      if (tags) {
        for (const [k, v] of Object.entries(tags)) scope.setTag(k, v);
      }
      scope.setTag('mid.session', SESSION_ID);
      return scope;
    });
  }

  public captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
    if (!initialized) return;
    Sentry.captureMessage(message, level);
  }

  public async dispose(): Promise<void> {
    if (initialized) {
      await Sentry.close(2000);
      initialized = false;
    }
  }

  private tryInit(): void {
    const cfg = vscode.workspace.getConfiguration('markItDown.telemetry');
    const enabled = cfg.get<boolean>('enabled') ?? false;
    const dsn = (cfg.get<string>('dsn') ?? '').trim();
    if (initialized) {
      // Re-init is handled by closing + reopening when the setting changes.
      void Sentry.close(1000).then(() => {
        initialized = false;
        if (enabled && dsn) this.tryInit();
      });
      return;
    }
    if (!enabled || !dsn) return;
    pathAnchors = new StaticPathAnchors(
      vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [],
      this.context.extensionUri.fsPath,
    );
    Sentry.init({
      dsn,
      release: this.context.extension?.packageJSON?.version,
      environment: 'production',
      sampleRate: 1.0,
      tracesSampleRate: 0,
      beforeSend(event) {
        if (!pathAnchors) return event;
        return sanitizeDeep(event, pathAnchors) as Sentry.ErrorEvent;
      },
      beforeBreadcrumb(crumb) {
        if (!pathAnchors) return crumb;
        return sanitizeDeep(crumb, pathAnchors) as Sentry.Breadcrumb;
      },
      initialScope: {
        tags: { 'mid.session': SESSION_ID, 'mid.surface': 'vscode' },
      },
    });
    initialized = true;
  }

  private async maybePromptConsent(): Promise<void> {
    const shown = this.context.globalState.get<boolean>(TELEMETRY_CONSENT_KEY, false);
    if (shown) return;
    await this.context.globalState.update(TELEMETRY_CONSENT_KEY, true);
    const choice = await vscode.window.showInformationMessage(
      'Mark It Down: help improve the extension by sending anonymized error reports? Default is off.',
      'Enable',
      'Keep off',
      'Learn more',
    );
    if (choice === 'Enable') {
      await vscode.workspace
        .getConfiguration('markItDown.telemetry')
        .update('enabled', true, vscode.ConfigurationTarget.Global);
    } else if (choice === 'Learn more') {
      await vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/fadymondy/mark-it-down/blob/main/docs/telemetry.md'),
      );
    }
  }
}
