import * as vscode from 'vscode';
import { findTheme, ThemeDefinition, THEMES } from '../themes/themes';

export interface PublishConfig {
  enabled: boolean;
  branch: string;
  subPath: string;
  includeGlob: string;
  themeId: string;
  theme?: ThemeDefinition;
}

export function readPublishConfig(): PublishConfig {
  const cfg = vscode.workspace.getConfiguration('markItDown.publish');
  const enabled = cfg.get<boolean>('enabled') ?? false;
  const branch = (cfg.get<string>('branch') ?? 'gh-pages').trim() || 'gh-pages';
  const subPath = ((cfg.get<string>('path') ?? '/').replace(/^\/+|\/+$/g, '')) || '';
  const includeGlob = (cfg.get<string>('includeGlob') ?? '**/*.md').trim() || '**/*.md';
  const themeId = (cfg.get<string>('theme') ?? 'github-light').trim() || 'github-light';
  return { enabled, branch, subPath, includeGlob, themeId, theme: findTheme(themeId) };
}

export function publishAffected(e: vscode.ConfigurationChangeEvent): boolean {
  return e.affectsConfiguration('markItDown.publish');
}

export function listAvailableThemes(): { id: string; label: string }[] {
  return THEMES.map(t => ({ id: t.id, label: t.label }));
}
