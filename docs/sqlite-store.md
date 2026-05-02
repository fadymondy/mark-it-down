# SQLite settings & app-state store

Mark It Down's main process keeps all persistent app state in a SQLite database at `<userData>/mid.sqlite`. Settings, recent files, pinned folders, workspaces, warehouse links, and an exports audit log all flow through this single file. The renderer never sees the DB — it talks to the existing `mid:read-app-state` / `mid:patch-app-state` IPCs, which are now backed by the database.

## Why SQLite (vs. JSON file)

The previous store was a single `<userData>/state.json` blob. That worked while the surface was small but had three problems:

1. **No concurrency story.** Multiple writes from different IPC handlers (notes, settings, repo sync) would race each other on the JSON file.
2. **Listing/filtering required loading everything.** Recent-files and pinned-folders queries forced a full read+parse on every call.
3. **No history.** We can now record every export to `export_history` so the unique-id story from #238 is queryable ("what did I export last week?").

SQLite gives us atomic writes, indexed lookups, transactions for the migration step, and zero extra runtime dependencies on macOS / Windows / Linux. WAL journaling means the DB file stays usable even if the process crashes mid-write.

## Schema

```sql
-- key/value JSON blobs for arbitrary settings
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL          -- JSON-stringified
);

-- ordered MRU list of opened files
CREATE TABLE recent_files (
  path      TEXT PRIMARY KEY,
  opened_at INTEGER NOT NULL   -- ms epoch
);
CREATE INDEX idx_recent_files_opened ON recent_files(opened_at DESC);

-- pinned folders shown in the activity bar
CREATE TABLE pinned_folders (
  id         TEXT PRIMARY KEY,
  path       TEXT NOT NULL,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL,
  color      TEXT NOT NULL,
  files_json TEXT,             -- nullable JSON array of paths
  sort       INTEGER NOT NULL DEFAULT 0
);

-- saved workspaces shown in the workspace switcher
CREATE TABLE workspaces (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL
);

-- GitHub warehouses linked to a workspace
CREATE TABLE warehouses (
  id        TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  repo      TEXT NOT NULL,
  branch    TEXT,
  subdir    TEXT
);

-- audit log of every export the renderer issues (#238)
CREATE TABLE export_history (
  id          TEXT PRIMARY KEY,   -- the same short id from uniqueExportName()
  source_path TEXT,
  format      TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  exported_at INTEGER NOT NULL
);
CREATE INDEX idx_export_history_exported ON export_history(exported_at DESC);
```

Settings rows store JSON blobs so individual keys can evolve their shape (object → array, scalar → object) without further DB migrations. Trade-off: you can't query *inside* a setting from SQL — but settings are read in bulk by `getAllSettings()` and parsed in JS, so it's not a real loss.

## Lifecycle

```
app.whenReady()
  └─ openDB(userDataDir)              // creates mid.sqlite if missing
  └─ migrateLegacyState(userDataDir)  // one-shot import from state.json (idempotent)

app.before-quit
  └─ closeDB()                        // flush WAL, close handle
```

`openDB` is called exactly once at startup and the handle is cached as a module singleton. `getDB()` returns the cached handle and throws if called before `openDB`.

## Migration from `state.json`

`migrateLegacyState(userDataDir)` is the bridge for users upgrading from the JSON-state build:

1. If `<userData>/state.json` does not exist → no-op, returns `{ migrated: false }`.
2. If it exists but is malformed → log a warning, leave the file in place, return `{ migrated: false, error }`.
3. Otherwise, in a single transaction:
   - Settings keys (`lastFolder`, `splitRatio`, `fontFamily`, `fontSize`, `theme`, `previewMaxWidth`, `codeExportGradient`, `activeWorkspace`, `ghToken`) → `settings` table.
   - `recentFiles` array → `recent_files` (timestamps reverse-deduced from array order so head = most recent).
   - `pinnedFolders` array → `pinned_folders` with stable `pin-legacy-<idx>` ids.
   - `workspaces` array → `workspaces`.
   - A `migrationVersion = 1` setting marker is written.
4. `state.json` is renamed to `state.json.migrated` (kept, not deleted, so a panicked rollback can still see the original blob).

The rename is what makes the migration idempotent: the next launch's `readFile` short-circuits before doing any work. Re-running `migrateLegacyState` is safe even if the rename fails — the transaction uses `INSERT … ON CONFLICT DO UPDATE` for settings.

## API surface

Everything lives in `apps/electron/db.ts`:

| Group       | Functions |
|-------------|-----------|
| Lifecycle   | `openDB(userDataDir)`, `closeDB()`, `getDB()`, `getDBPath()`, `migrateLegacyState(userDataDir)` |
| Settings    | `getSetting<T>(key)`, `setSetting(key, value)`, `getAllSettings()` |
| Recent files | `listRecentFiles(limit?)`, `pushRecentFile(path)`, `clearRecentFiles()` |
| Pinned folders | `listPinnedFolders()`, `replacePinnedFolders(rows)` |
| Workspaces | `listWorkspaces()`, `replaceWorkspaces(rows)` |
| Warehouses | `listWarehouses(workspace?)`, `upsertWarehouse(row)`, `deleteWarehouse(id)` |
| Export history | `recordExport(row)`, `listExportHistory(limit?)` |

`apps/electron/main.ts` keeps its existing `readAppState()` / `writeAppState(patch)` helpers as the only seam — they project the DB into the AppState shape the renderer expects, and the renderer never had to change.

## New IPCs (#238 follow-up)

- `mid:record-export` — `{ id, sourcePath?, format, filePath }` → inserts into `export_history`.
- `mid:list-export-history` — `(limit?: number)` → returns the last N exports for "Recent exports" UI surfaces.

These are exposed on `window.mid` as `recordExport(...)` and `listExportHistory(limit)`.
