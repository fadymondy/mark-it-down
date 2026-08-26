/**
 * Warehouse API client for the Chrome extension.
 *
 * Settings live in chrome.storage.sync so they roam with the profile.
 * Every authenticated call carries the personal access token as a bearer
 * header — the same `togo_pat_…` tokens the web warehouse issues.
 */

export interface Settings {
  /** Warehouse base URL, no trailing slash (e.g. https://notes.example.com). */
  serverUrl: string;
  /** Personal access token (`togo_pat_…`). */
  token: string;
  /** Theme id from packages/core THEMES. */
  theme: string;
}

export const DEFAULT_THEME = 'github-dark';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(['serverUrl', 'token', 'theme']);
  return {
    serverUrl: ((stored.serverUrl as string | undefined) ?? '').replace(/\/+$/, ''),
    token: (stored.token as string | undefined) ?? '',
    theme: (stored.theme as string | undefined) ?? DEFAULT_THEME,
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

export function isConfigured(s: Settings): boolean {
  return s.serverUrl !== '' && s.token !== '';
}

/** Mirrors apps/web resources.NoteResponse. */
export interface Note {
  id: string;
  title: string;
  body: string;
  category: string | null;
  tags: string | null;
  user_id: string;
  share_slug: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface NoteInput {
  title: string;
  body: string;
  category?: string;
  tags?: string;
}

export interface UpdateFeed {
  version: string;
  tag: string;
  notes_url: string;
  asset?: { name: string; url: string; size: number };
}

async function api<T>(s: Settings, path: string, init: RequestInit = {}): Promise<T> {
  if (s.serverUrl === '') throw new Error('No server URL configured');
  const res = await fetch(`${s.serverUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${s.token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* body unreadable — status alone is enough */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

export function listNotes(s: Settings, limit = 10): Promise<Note[]> {
  return api<Note[]>(s, `/api/notes?limit=${limit}`);
}

export function createNote(s: Settings, input: NoteInput): Promise<Note> {
  return api<Note>(s, '/api/notes', { method: 'POST', body: JSON.stringify(input) });
}

export function getNote(s: Settings, id: string): Promise<Note> {
  return api<Note>(s, `/api/notes/${encodeURIComponent(id)}`);
}

/** GET /api/auth/me — whoever the token belongs to. Shape is server-defined. */
export function testConnection(s: Settings): Promise<Record<string, unknown>> {
  return api<Record<string, unknown>>(s, '/api/auth/me');
}

export function updatesFeed(s: Settings): Promise<UpdateFeed> {
  return api<UpdateFeed>(s, '/api/updates/chrome');
}

// ---------------------------------------------------------------------------
// Update check — shared by the options page and the background alarm.

export interface UpdateInfo {
  latestVersion: string;
  url: string;
}

const GITHUB_LATEST = 'https://api.github.com/repos/fadymondy/mark-it-down/releases/latest';

/**
 * Latest published version. Prefers the warehouse's own feed (respects the
 * user-configured server); falls back to the public GitHub releases API,
 * which serves `Access-Control-Allow-Origin: *` so no host permission is
 * needed. Returns null when both sources are unreachable.
 */
export async function fetchLatestRelease(s: Settings): Promise<UpdateInfo | null> {
  if (s.serverUrl !== '') {
    try {
      const feed = await updatesFeed(s);
      if (feed.version) {
        return { latestVersion: feed.version, url: feed.notes_url || feed.asset?.url || s.serverUrl };
      }
    } catch {
      /* server feed unavailable — fall through to GitHub */
    }
  }
  try {
    const res = await fetch(GITHUB_LATEST, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const rel = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!rel.tag_name) return null;
    return { latestVersion: rel.tag_name, url: rel.html_url ?? 'https://github.com/fadymondy/mark-it-down/releases' };
  } catch {
    return null;
  }
}
