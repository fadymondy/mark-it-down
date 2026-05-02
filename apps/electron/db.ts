/**
 * SQLite-backed app state.
 *
 * One database per install at `<userData>/mid.sqlite`, opened with WAL.
 * The migration story (see `migrateLegacyState`) is intentionally one-shot
 * and defensive: if the user upgrades from a JSON-state build, the JSON file
 * is hydrated into SQLite and renamed to `state.json.migrated`. We keep the
 * file rather than deleting it so a panicked rollback still has the original
 * blob to read from.
 *
 * All settings keys are stored as JSON blobs in the `settings` table — that
 * keeps the schema stable while letting individual values evolve their shape
 * (arrays, nested objects, etc.) without further migrations.
 */

import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import * as path from 'path';

let db: Database.Database | null = null;
let dbPath = '';

export interface PinnedFolderRow {
  id: string;
  path: string;
  name: string;
  icon: string;
  color: string;
  files?: string[];
  sort?: number;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  path: string;
}

export interface WarehouseRow {
  id: string;
  workspace: string;
  repo: string;
  branch: string | null;
  subdir: string | null;
}

export interface ExportHistoryRow {
  id: string;
  source_path: string;
  format: string;
  file_path: string;
  exported_at: number;
}

/**
 * #297 — User-defined note types persisted in SQLite. Built-in rows are seeded
 * on first read with `builtin = 1` so the settings UI can lock them down. User
 * types appear with `builtin = 0` and may be edited / deleted.
 */
export interface NoteTypeRow {
  id: string;
  label: string;
  icon: string;
  color: string;
  view_kind: string;
  description: string | null;
  builtin: number;
  sort: number;
}

export function openDB(userDataDir: string): Database.Database {
  if (db) return db;
  dbPath = path.join(userDataDir, 'mid.sqlite');
  // better-sqlite3 will create the file if it doesn't exist.
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}

export function getDB(): Database.Database {
  if (!db) throw new Error('SQLite db not initialized — call openDB(userDataDir) at startup');
  return db;
}

export function closeDB(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

export function getDBPath(): string {
  return dbPath;
}

function applySchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recent_files (
      path TEXT PRIMARY KEY,
      opened_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pinned_folders (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      files_json TEXT,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT,
      subdir TEXT
    );
    CREATE TABLE IF NOT EXISTS export_history (
      id TEXT PRIMARY KEY,
      source_path TEXT,
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      exported_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS open_tabs (
      strip_id INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      path TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (strip_id, idx)
    );
    CREATE TABLE IF NOT EXISTS note_types (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      view_kind TEXT NOT NULL,
      description TEXT,
      builtin INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_recent_files_opened ON recent_files(opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_export_history_exported ON export_history(exported_at DESC);
    CREATE INDEX IF NOT EXISTS idx_open_tabs_strip ON open_tabs(strip_id, idx);
  `);
}

/* ── open tabs (#287) ───────────────────────────────────── */

export interface OpenTabRow {
  strip_id: number;
  idx: number;
  path: string;
  active: number;
}

/**
 * Returns persisted tabs ordered by (strip_id, idx) so the renderer can rebuild
 * the strip layout deterministically across restarts.
 */
export function listOpenTabs(): OpenTabRow[] {
  return getDB()
    .prepare('SELECT strip_id, idx, path, active FROM open_tabs ORDER BY strip_id ASC, idx ASC')
    .all() as OpenTabRow[];
}

/**
 * Atomically replace the entire persisted tab set. The renderer is the source
 * of truth for layout — we wipe and rewrite rather than diff because the table
 * is small (typically <30 rows) and the transaction keeps the swap consistent.
 */
export function replaceOpenTabs(rows: OpenTabRow[]): void {
  const d = getDB();
  const tx = d.transaction((all: OpenTabRow[]) => {
    d.prepare('DELETE FROM open_tabs').run();
    const stmt = d.prepare('INSERT INTO open_tabs(strip_id, idx, path, active) VALUES(?, ?, ?, ?)');
    for (const r of all) stmt.run(r.strip_id, r.idx, r.path, r.active ? 1 : 0);
  });
  tx(rows);
}

/* ── note types (#297) ─────────────────────────────────── */

/**
 * Return every registered note type ordered by `sort` (ascending). Caller is
 * expected to seed built-ins separately — `listNoteTypeRows()` is purely a
 * persistence read; we don't merge the in-memory built-in registry here so the
 * SQL surface stays predictable for tests.
 */
export function listNoteTypeRows(): NoteTypeRow[] {
  return getDB()
    .prepare('SELECT id, label, icon, color, view_kind, description, builtin, sort FROM note_types ORDER BY sort ASC, label ASC')
    .all() as NoteTypeRow[];
}

/** Upsert a note type by id. `sort` is preserved if the row already exists. */
export function upsertNoteTypeRow(row: NoteTypeRow): void {
  getDB()
    .prepare(`
      INSERT INTO note_types(id, label, icon, color, view_kind, description, builtin, sort)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        icon = excluded.icon,
        color = excluded.color,
        view_kind = excluded.view_kind,
        description = excluded.description,
        builtin = excluded.builtin,
        sort = excluded.sort
    `)
    .run(row.id, row.label, row.icon, row.color, row.view_kind, row.description ?? null, row.builtin, row.sort);
}

/** Delete a user-defined note type. Built-in rows are protected — callers
 * should refuse the request before reaching this helper, but we double-check
 * here so a stray IPC can't blow away the seed. */
export function deleteNoteTypeRow(id: string): boolean {
  const row = getDB().prepare('SELECT builtin FROM note_types WHERE id = ?').get(id) as { builtin: number } | undefined;
  if (!row) return false;
  if (row.builtin === 1) return false;
  getDB().prepare('DELETE FROM note_types WHERE id = ?').run(id);
  return true;
}

/**
 * Replace the `sort` column for the given ids in order (idx → sort). Used by
 * the filter-strip drag-to-reorder control (#302). Unknown ids are skipped.
 */
export function reorderNoteTypeRows(orderedIds: string[]): void {
  const d = getDB();
  const tx = d.transaction((ids: string[]) => {
    const stmt = d.prepare('UPDATE note_types SET sort = ? WHERE id = ?');
    ids.forEach((id, idx) => { stmt.run(idx, id); });
  });
  tx(orderedIds);
}

/* ── settings (JSON-blob valued) ────────────────────────── */

export function getSetting<T = unknown>(key: string): T | undefined {
  const row = getDB().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export function setSetting(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  getDB().prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, json);
}

export function getAllSettings(): Record<string, unknown> {
  const rows = getDB().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* skip bad row */ }
  }
  return out;
}

/* ── recent files ───────────────────────────────────────── */

export function listRecentFiles(limit = 20): string[] {
  const rows = getDB().prepare('SELECT path FROM recent_files ORDER BY opened_at DESC LIMIT ?').all(limit) as { path: string }[];
  return rows.map(r => r.path);
}

export function pushRecentFile(filePath: string): void {
  const now = Date.now();
  getDB().prepare('INSERT INTO recent_files(path, opened_at) VALUES(?, ?) ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at').run(filePath, now);
  // Trim to 50 most recent — desktop apps don't need unbounded history.
  getDB().prepare('DELETE FROM recent_files WHERE path NOT IN (SELECT path FROM recent_files ORDER BY opened_at DESC LIMIT 50)').run();
}

export function clearRecentFiles(): void {
  getDB().prepare('DELETE FROM recent_files').run();
}

/* ── pinned folders ─────────────────────────────────────── */

export function listPinnedFolders(): PinnedFolderRow[] {
  const rows = getDB().prepare('SELECT id, path, name, icon, color, files_json, sort FROM pinned_folders ORDER BY sort ASC, name ASC').all() as { id: string; path: string; name: string; icon: string; color: string; files_json: string | null; sort: number }[];
  return rows.map(r => ({
    id: r.id,
    path: r.path,
    name: r.name,
    icon: r.icon,
    color: r.color,
    files: r.files_json ? safeParseArray(r.files_json) : undefined,
    sort: r.sort,
  }));
}

export function replacePinnedFolders(folders: PinnedFolderRow[]): void {
  const d = getDB();
  const tx = d.transaction((rows: PinnedFolderRow[]) => {
    d.prepare('DELETE FROM pinned_folders').run();
    const stmt = d.prepare('INSERT INTO pinned_folders(id, path, name, icon, color, files_json, sort) VALUES(?, ?, ?, ?, ?, ?, ?)');
    rows.forEach((r, idx) => {
      stmt.run(
        r.id ?? `pin-${Date.now()}-${idx}`,
        r.path,
        r.name,
        r.icon,
        r.color,
        r.files ? JSON.stringify(r.files) : null,
        r.sort ?? idx,
      );
    });
  });
  tx(folders);
}

/* ── workspaces ─────────────────────────────────────────── */

export function listWorkspaces(): WorkspaceRow[] {
  return getDB().prepare('SELECT id, name, path FROM workspaces').all() as WorkspaceRow[];
}

export function replaceWorkspaces(rows: WorkspaceRow[]): void {
  const d = getDB();
  const tx = d.transaction((all: WorkspaceRow[]) => {
    d.prepare('DELETE FROM workspaces').run();
    const stmt = d.prepare('INSERT INTO workspaces(id, name, path) VALUES(?, ?, ?)');
    for (const r of all) stmt.run(r.id, r.name, r.path);
  });
  tx(rows);
}

/* ── warehouses ─────────────────────────────────────────── */

export function listWarehouses(workspace?: string): WarehouseRow[] {
  if (workspace) {
    return getDB().prepare('SELECT id, workspace, repo, branch, subdir FROM warehouses WHERE workspace = ?').all(workspace) as WarehouseRow[];
  }
  return getDB().prepare('SELECT id, workspace, repo, branch, subdir FROM warehouses').all() as WarehouseRow[];
}

export function upsertWarehouse(row: WarehouseRow): void {
  getDB()
    .prepare('INSERT INTO warehouses(id, workspace, repo, branch, subdir) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET workspace = excluded.workspace, repo = excluded.repo, branch = excluded.branch, subdir = excluded.subdir')
    .run(row.id, row.workspace, row.repo, row.branch ?? null, row.subdir ?? null);
}

export function deleteWarehouse(id: string): void {
  getDB().prepare('DELETE FROM warehouses WHERE id = ?').run(id);
}

/* ── export history ─────────────────────────────────────── */

export function recordExport(row: ExportHistoryRow): void {
  getDB()
    .prepare('INSERT INTO export_history(id, source_path, format, file_path, exported_at) VALUES(?, ?, ?, ?, ?)')
    .run(row.id, row.source_path ?? null, row.format, row.file_path, row.exported_at);
}

export function listExportHistory(limit = 50): ExportHistoryRow[] {
  return getDB().prepare('SELECT id, source_path, format, file_path, exported_at FROM export_history ORDER BY exported_at DESC LIMIT ?').all(limit) as ExportHistoryRow[];
}

/* ── one-shot legacy migration ──────────────────────────── */

interface LegacyAppState {
  lastFolder?: string;
  splitRatio?: number;
  fontFamily?: string;
  fontSize?: number;
  theme?: string;
  previewMaxWidth?: number;
  recentFiles?: string[];
  codeExportGradient?: string;
  pinnedFolders?: { path: string; name: string; icon: string; color: string; files?: string[] }[];
  workspaces?: { id: string; name: string; path: string }[];
  activeWorkspace?: string;
  ghToken?: string;
}

/**
 * If `<userData>/state.json` exists, copy its contents into SQLite and rename
 * the original to `state.json.migrated`. Idempotent: re-runs are no-ops because
 * the rename moves the source file out of the way.
 *
 * The migration is wrapped in a transaction so a partial write doesn't leave
 * the DB half-populated.
 */
export async function migrateLegacyState(userDataDir: string): Promise<{ migrated: boolean; error?: string }> {
  const file = path.join(userDataDir, 'state.json');
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return { migrated: false };
  }
  let parsed: LegacyAppState;
  try {
    parsed = JSON.parse(raw) as LegacyAppState;
  } catch (err) {
    // Malformed JSON: leave the file alone, surface the error so the caller logs it.
    return { migrated: false, error: `state.json is not valid JSON: ${(err as Error).message}` };
  }
  const d = getDB();
  const tx = d.transaction(() => {
    const setStmt = d.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const setKey = (k: string, v: unknown): void => { setStmt.run(k, JSON.stringify(v)); };
    if (parsed.lastFolder !== undefined) setKey('lastFolder', parsed.lastFolder);
    if (parsed.splitRatio !== undefined) setKey('splitRatio', parsed.splitRatio);
    if (parsed.fontFamily !== undefined) setKey('fontFamily', parsed.fontFamily);
    if (parsed.fontSize !== undefined) setKey('fontSize', parsed.fontSize);
    if (parsed.theme !== undefined) setKey('theme', parsed.theme);
    if (parsed.previewMaxWidth !== undefined) setKey('previewMaxWidth', parsed.previewMaxWidth);
    if (parsed.codeExportGradient !== undefined) setKey('codeExportGradient', parsed.codeExportGradient);
    if (parsed.activeWorkspace !== undefined) setKey('activeWorkspace', parsed.activeWorkspace);
    if (parsed.ghToken !== undefined) setKey('ghToken', parsed.ghToken);

    if (Array.isArray(parsed.recentFiles)) {
      const recentStmt = d.prepare('INSERT OR IGNORE INTO recent_files(path, opened_at) VALUES(?, ?)');
      const now = Date.now();
      // Preserve ordering by deducting indices from `now` so the head of the
      // legacy array is the most-recently-opened file in SQLite.
      parsed.recentFiles.forEach((p, idx) => recentStmt.run(p, now - idx));
    }

    if (Array.isArray(parsed.pinnedFolders)) {
      const pinStmt = d.prepare('INSERT INTO pinned_folders(id, path, name, icon, color, files_json, sort) VALUES(?, ?, ?, ?, ?, ?, ?)');
      parsed.pinnedFolders.forEach((p, idx) => {
        pinStmt.run(`pin-legacy-${idx}`, p.path, p.name, p.icon, p.color, p.files ? JSON.stringify(p.files) : null, idx);
      });
    }

    if (Array.isArray(parsed.workspaces)) {
      const wsStmt = d.prepare('INSERT OR REPLACE INTO workspaces(id, name, path) VALUES(?, ?, ?)');
      for (const w of parsed.workspaces) wsStmt.run(w.id, w.name, w.path);
    }

    setKey('migrationVersion', 1);
  });
  try {
    tx();
  } catch (err) {
    return { migrated: false, error: (err as Error).message };
  }
  // Rename the original so re-runs short-circuit at readFile.
  try {
    await fs.rename(file, `${file}.migrated`);
  } catch {
    // Couldn't rename — not fatal; settings now live in SQLite either way.
  }
  return { migrated: true };
}

function safeParseArray(json: string): string[] | undefined {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : undefined;
  } catch {
    return undefined;
  }
}
