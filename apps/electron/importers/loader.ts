import { promises as fs } from 'fs';
import * as path from 'path';
import { Importer, ImporterMetadata, isImporter } from './types';

/**
 * Importer registry — populated once at app startup by {@link loadImporters}.
 * Subsequent calls return the cached map; callers that want a fresh scan can
 * pass `force: true`.
 */
const registry = new Map<string, Importer>();
let loaded = false;

export interface LoadOptions {
  /**
   * Absolute path to the directory containing per-importer subfolders. In dev
   * this is `apps/electron/importers/`; in packaged builds main.ts resolves it
   * via the asset helper to `<resources>/out/electron/importers/`.
   */
  importerRootDir: string;
  /** Re-scan even if already loaded. */
  force?: boolean;
  /** Optional logger — falls back to console. */
  log?: (msg: string) => void;
}

/**
 * Scan `importerRootDir` for subfolders containing `index.js` (packaged/dev
 * compiled) or `index.ts` (dev fallback when ts-node is in use). Each module's
 * default export — or its named `importer` export — is validated and registered.
 * The current `types.ts` and `loader.ts` files in the parent directory are
 * skipped because they're not importer plugins.
 */
export async function loadImporters(opts: LoadOptions): Promise<Importer[]> {
  const log = opts.log ?? ((msg: string) => console.log(msg));
  if (loaded && !opts.force) return Array.from(registry.values());
  registry.clear();

  let entries: string[];
  try {
    entries = await fs.readdir(opts.importerRootDir);
  } catch (err) {
    log(`[importers] no importer dir at ${opts.importerRootDir}: ${(err as Error).message}`);
    loaded = true;
    return [];
  }

  for (const entry of entries) {
    const full = path.join(opts.importerRootDir, entry);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    // Try .js first (packaged + dev compiled output), then .ts (dev source).
    const candidates = [path.join(full, 'index.js'), path.join(full, 'index.ts')];
    let modulePath: string | null = null;
    for (const c of candidates) {
      try {
        await fs.access(c);
        modulePath = c;
        break;
      } catch {
        // try next
      }
    }
    if (!modulePath) {
      log(`[importers] skip ${entry} — no index.js or index.ts`);
      continue;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(modulePath);
      const candidate = mod?.default ?? mod?.importer ?? mod;
      if (!isImporter(candidate)) {
        log(`[importers] skip ${entry} — default export does not satisfy Importer`);
        continue;
      }
      if (registry.has(candidate.id)) {
        log(`[importers] skip ${entry} — duplicate id "${candidate.id}"`);
        continue;
      }
      registry.set(candidate.id, candidate);
    } catch (err) {
      log(`[importers] failed to load ${entry}: ${(err as Error).message}`);
    }
  }

  loaded = true;
  const ids = Array.from(registry.keys()).sort();
  log(`[importers] registered: ${ids.length === 0 ? '(none)' : ids.join(', ')}`);
  return Array.from(registry.values());
}

/** Return all loaded importers. Empty until {@link loadImporters} resolves. */
export function listImporters(): Importer[] {
  return Array.from(registry.values());
}

/** Strip runtime functions so the metadata is safe to send across IPC. */
export function listImporterMetadata(): ImporterMetadata[] {
  return listImporters().map(({ id, name, icon, supportedFormats, description }) => ({
    id,
    name,
    icon,
    supportedFormats,
    description,
  }));
}

/** Look up a registered importer by id. */
export function getImporter(id: string): Importer | undefined {
  return registry.get(id);
}
