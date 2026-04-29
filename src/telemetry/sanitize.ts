import * as os from 'os';
import * as path from 'path';

/**
 * Strip absolute paths from any string we're about to send. Replaces:
 *   the user's home dir → ~
 *   any open workspace folder → <workspace>
 *   the extension's globalStorage / cwd → <extension>
 *
 * Surfaces in stack traces, error messages, and breadcrumbs.
 */
export function sanitizePaths(value: string, anchors: PathAnchors): string {
  let out = value;
  for (const anchor of anchors.list()) {
    if (!anchor.path) continue;
    out = out.split(anchor.path).join(anchor.label);
  }
  return out;
}

export interface PathAnchors {
  list(): { path: string; label: string }[];
}

export class StaticPathAnchors implements PathAnchors {
  private readonly anchors: { path: string; label: string }[];

  constructor(workspaceFolders: string[], extensionDir?: string) {
    const home = os.homedir();
    this.anchors = [
      ...workspaceFolders.map(p => ({ path: p, label: '<workspace>' })),
      ...(extensionDir ? [{ path: extensionDir, label: '<extension>' }] : []),
      { path: home, label: '~' },
      { path: os.tmpdir(), label: '<tmp>' },
    ];
  }

  list(): { path: string; label: string }[] {
    // Longest paths first so a workspace inside the home dir gets its own
    // label before the home-dir fallback strips the same prefix.
    return [...this.anchors].sort((a, b) => b.path.length - a.path.length);
  }
}

/**
 * Recursively sanitize an arbitrary structure (event, breadcrumb).
 * Truncates strings beyond `maxStringLen` to keep payloads bounded.
 */
export function sanitizeDeep(value: unknown, anchors: PathAnchors, maxStringLen = 4096): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    const cleaned = sanitizePaths(value, anchors);
    return cleaned.length > maxStringLen ? cleaned.slice(0, maxStringLen) + '…' : cleaned;
  }
  if (Array.isArray(value)) {
    return value.map(v => sanitizeDeep(v, anchors, maxStringLen));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeDeep(v, anchors, maxStringLen);
    }
    return out;
  }
  return value;
}

/**
 * Random session id used to group events from the same VSCode launch
 * without persisting anything user-identifying.
 */
export function generateSessionId(): string {
  // 64 bits of entropy is plenty for grouping; printed as a 16-char hex.
  const buf = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && (crypto as { getRandomValues?: (a: Uint8Array) => void }).getRandomValues) {
    (crypto as { getRandomValues: (a: Uint8Array) => void }).getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

/** Helper used by tests to round-trip a single absolute-looking path. */
export function exampleAnchor(homeDir: string): PathAnchors {
  return {
    list: () => [
      { path: path.join(homeDir, 'work', 'project'), label: '<workspace>' },
      { path: homeDir, label: '~' },
    ],
  };
}
