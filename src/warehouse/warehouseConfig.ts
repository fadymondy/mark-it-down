import * as vscode from 'vscode';
import {
  buildRoutes,
} from '../../packages/core/src/warehouse-routing';
import type { RouteRule } from '../../packages/core/src/warehouse-routing';

export type WarehouseTransport = 'gh' | 'git';

export interface WarehouseConfig {
  enabled: boolean;
  repo: string;
  branch: string;
  subdir: string;
  transport: WarehouseTransport;
  autoPush: boolean;
  autoPushDebounceMs: number;
  workspaceId: string;
}

export interface RoutedWarehouseConfig extends WarehouseConfig {
  routeId: string;
  /** True when this is the catch-all default route (no rule matched). */
  isDefault: boolean;
  /** Predicate over a note's category — true when the note belongs to this route. */
  matches(category: string): boolean;
}

export interface WarehouseRoutes {
  primary: WarehouseConfig;
  routed: RoutedWarehouseConfig[];
  rejectedRules: { index: number; reason: string }[];
}

export const PERSONAL_WORKSPACE_ID = '_personal';

const DEFAULT_BRANCH = 'main';
const DEFAULT_SUBDIR = 'notes';
const DEFAULT_TRANSPORT: WarehouseTransport = 'gh';
const DEFAULT_DEBOUNCE_MS = 5000;

export function readConfig(): WarehouseConfig {
  const cfg = vscode.workspace.getConfiguration('markItDown.warehouse');
  const repo = (cfg.get<string>('repo') ?? '').trim();
  const branch = (cfg.get<string>('branch') ?? DEFAULT_BRANCH).trim() || DEFAULT_BRANCH;
  const subdir = normalizeSubdir(cfg.get<string>('subdir') ?? DEFAULT_SUBDIR);
  const transport = (cfg.get<WarehouseTransport>('transport') ?? DEFAULT_TRANSPORT) === 'git' ? 'git' : 'gh';
  const autoPush = cfg.get<boolean>('autoPush') ?? true;
  const debounce = clampInt(cfg.get<number>('autoPushDebounceMs') ?? DEFAULT_DEBOUNCE_MS, 1000, 60_000);
  const workspaceId = resolveWorkspaceId(cfg.get<string>('workspaceId'));
  return {
    enabled: repo.length > 0,
    repo,
    branch,
    subdir,
    transport,
    autoPush,
    autoPushDebounceMs: debounce,
    workspaceId,
  };
}

export function isAffected(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration('markItDown.warehouse');
}

export function readRoutes(): WarehouseRoutes {
  const primary = readConfig();
  const cfg = vscode.workspace.getConfiguration('markItDown.warehouse');
  const rawRules = cfg.get<RouteRule[]>('routes') ?? [];
  const resolution = buildRoutes(rawRules, {
    repo: primary.repo,
    branch: primary.branch,
    subdir: primary.subdir,
  });
  const routed: RoutedWarehouseConfig[] = resolution.routes.map(route => ({
    ...primary,
    repo: route.repo,
    branch: route.branch,
    subdir: route.subdir,
    enabled: route.repo.length > 0,
    routeId: route.routeId,
    isDefault: route.routeId === 'default',
    matches: (cat: string) => route.match(cat),
  }));
  return { primary, routed, rejectedRules: resolution.rejected };
}

export function routeForNoteCategory(
  routes: RoutedWarehouseConfig[],
  category: string,
): RoutedWarehouseConfig | undefined {
  return routes.find(r => r.matches(category));
}


export function repoSlug(config: WarehouseConfig): string {
  return config.repo.replace(/[^A-Za-z0-9._-]+/g, '--');
}

export function repoUrl(config: WarehouseConfig): string {
  return `https://github.com/${config.repo}.git`;
}

export function repoWebUrl(config: WarehouseConfig, relative?: string): string {
  const base = `https://github.com/${config.repo}/blob/${encodeURIComponent(config.branch)}`;
  if (!relative) {
    return `https://github.com/${config.repo}/tree/${encodeURIComponent(config.branch)}`;
  }
  return `${base}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

export function scopeDir(config: WarehouseConfig, scope: 'workspace' | 'global'): string {
  const slug = scope === 'global' ? PERSONAL_WORKSPACE_ID : config.workspaceId;
  return `${config.subdir}/${slug}`;
}

function normalizeSubdir(input: string): string {
  const trimmed = input.trim().replace(/^\/+|\/+$/g, '');
  return trimmed.length > 0 ? trimmed : DEFAULT_SUBDIR;
}

function resolveWorkspaceId(explicit: string | undefined): string {
  const value = explicit?.trim();
  if (value) {
    return slugify(value);
  }
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return slugify(folders[0].name);
  }
  if (vscode.workspace.name) {
    return slugify(vscode.workspace.name);
  }
  return PERSONAL_WORKSPACE_ID;
}

export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : 'workspace';
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
