import { describe, expect, it } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { exampleAnchor, generateSessionId, sanitizeDeep, sanitizePaths } from '../../src/telemetry/sanitize';

describe('sanitizePaths', () => {
  it('replaces a known workspace path with <workspace>', () => {
    const home = os.homedir();
    const ws = path.join(home, 'work', 'project');
    const anchors = exampleAnchor(home);
    const out = sanitizePaths(`Error in ${ws}/src/foo.ts at line 12`, anchors);
    expect(out).toBe('Error in <workspace>/src/foo.ts at line 12');
  });

  it('strips the home dir when no workspace is set', () => {
    const home = os.homedir();
    const anchors = exampleAnchor(home);
    const out = sanitizePaths(`config: ${home}/.config/mark-it-down`, anchors);
    expect(out).toBe('config: ~/.config/mark-it-down');
  });

  it('prefers the longer (more specific) anchor first', () => {
    const home = os.homedir();
    const anchors = exampleAnchor(home);
    const ws = path.join(home, 'work', 'project');
    // The string contains both — workspace wins because it's longer than home
    const out = sanitizePaths(`${ws}/src/foo.ts`, anchors);
    expect(out).toBe('<workspace>/src/foo.ts');
    expect(out).not.toContain(home);
  });

  it('passes strings without any anchor through unchanged', () => {
    const home = os.homedir();
    const anchors = exampleAnchor(home);
    const out = sanitizePaths('no paths here, just text', anchors);
    expect(out).toBe('no paths here, just text');
  });
});

describe('sanitizeDeep', () => {
  it('walks nested structures and rewrites strings', () => {
    const home = os.homedir();
    const anchors = exampleAnchor(home);
    const event = {
      message: `crash at ${home}/foo`,
      stacktrace: { frames: [{ filename: `${home}/work/project/src/x.ts`, function: 'doIt' }] },
      tags: { environment: 'production' },
    };
    const out = sanitizeDeep(event, anchors) as typeof event;
    expect(out.message).toBe('crash at ~/foo');
    expect(out.stacktrace.frames[0].filename).toBe('<workspace>/src/x.ts');
    expect(out.tags.environment).toBe('production');
  });

  it('truncates strings beyond maxStringLen', () => {
    const home = os.homedir();
    const anchors = exampleAnchor(home);
    const longString = 'x'.repeat(200);
    const out = sanitizeDeep({ note: longString }, anchors, 50) as { note: string };
    expect(out.note.length).toBeLessThanOrEqual(51); // 50 + ellipsis
    expect(out.note.endsWith('…')).toBe(true);
  });

  it('handles null + undefined + numbers + booleans', () => {
    const anchors = exampleAnchor(os.homedir());
    expect(sanitizeDeep(null, anchors)).toBe(null);
    expect(sanitizeDeep(undefined, anchors)).toBe(undefined);
    expect(sanitizeDeep(42, anchors)).toBe(42);
    expect(sanitizeDeep(true, anchors)).toBe(true);
  });
});

describe('generateSessionId', () => {
  it('returns a 16-char hex string', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces different ids on consecutive calls', () => {
    const ids = new Set([0, 1, 2, 3, 4].map(() => generateSessionId()));
    expect(ids.size).toBe(5);
  });
});
