import { describe, expect, it } from 'vitest';
import { PERSONAL_WORKSPACE_ID, repoSlug, repoUrl, repoWebUrl, scopeDir, slugify } from '../../src/warehouse/warehouseConfig';

describe('slugify', () => {
  it('lowercases', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('collapses non-alphanum runs into single dashes', () => {
    expect(slugify('foo  bar__baz')).toBe('foo-bar-baz');
  });

  it('strips leading + trailing dashes', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('caps at 48 chars', () => {
    const long = 'a'.repeat(120);
    expect(slugify(long).length).toBeLessThanOrEqual(48);
  });

  it('falls back to "workspace" on empty', () => {
    expect(slugify('')).toBe('workspace');
    expect(slugify('!!!')).toBe('workspace');
  });
});

describe('repoSlug / repoUrl / repoWebUrl', () => {
  const config = {
    enabled: true,
    repo: 'fadymondy/mark-it-down',
    branch: 'main',
    subdir: 'notes',
    transport: 'gh' as const,
    autoPush: true,
    autoPushDebounceMs: 5000,
    workspaceId: 'ws',
  };

  it('repoSlug replaces / with -- so it works as a directory name', () => {
    expect(repoSlug(config)).toBe('fadymondy--mark-it-down');
  });

  it('repoUrl returns the canonical https://github.com URL', () => {
    expect(repoUrl(config)).toBe('https://github.com/fadymondy/mark-it-down.git');
  });

  it('repoWebUrl returns the tree URL when no relative path is given', () => {
    expect(repoWebUrl(config)).toBe('https://github.com/fadymondy/mark-it-down/tree/main');
  });

  it('repoWebUrl returns a blob URL when given a relative path', () => {
    expect(repoWebUrl(config, 'notes/foo.md')).toBe(
      'https://github.com/fadymondy/mark-it-down/blob/main/notes/foo.md',
    );
  });

  it('encodes the branch and path segments correctly', () => {
    const c = { ...config, branch: 'feature/has slashes' };
    const out = repoWebUrl(c, 'a path/with spaces.md');
    expect(out).toContain('feature%2Fhas%20slashes');
    expect(out).toContain('a%20path/with%20spaces.md');
  });
});

describe('scopeDir', () => {
  const config = {
    enabled: true,
    repo: 'x/y',
    branch: 'main',
    subdir: 'notes',
    transport: 'gh' as const,
    autoPush: true,
    autoPushDebounceMs: 5000,
    workspaceId: 'my-workspace',
  };

  it('uses the workspaceId for workspace scope', () => {
    expect(scopeDir(config, 'workspace')).toBe('notes/my-workspace');
  });

  it('uses _personal sentinel for global scope', () => {
    expect(scopeDir(config, 'global')).toBe(`notes/${PERSONAL_WORKSPACE_ID}`);
    expect(PERSONAL_WORKSPACE_ID).toBe('_personal');
  });
});
