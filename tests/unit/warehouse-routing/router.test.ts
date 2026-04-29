import { describe, expect, it } from 'vitest';
import {
  buildRoutes,
  routeForCategory,
} from '../../../packages/core/src/warehouse-routing';

const FALLBACK = { repo: 'me/personal', branch: 'main', subdir: 'notes' };

describe('buildRoutes', () => {
  it('returns just the default route when no rules', () => {
    const r = buildRoutes([], FALLBACK);
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].routeId).toBe('default');
    expect(r.routes[0].repo).toBe('me/personal');
  });

  it('returns no routes when fallback repo is empty + no rules', () => {
    const r = buildRoutes([], { ...FALLBACK, repo: '' });
    expect(r.routes).toHaveLength(0);
  });

  it('rejects rules with empty categoryPrefix or repo', () => {
    const r = buildRoutes(
      [
        { categoryPrefix: '', repo: 'a/b' },
        { categoryPrefix: 'Foo', repo: '' },
      ],
      FALLBACK,
    );
    expect(r.rejected.map(x => x.index)).toEqual([0, 1]);
    expect(r.routes.map(x => x.routeId)).toEqual(['default']);
  });

  it('rejects rules with malformed repo', () => {
    const r = buildRoutes([{ categoryPrefix: 'Foo', repo: 'just-a-name' }], FALLBACK);
    expect(r.rejected[0].reason).toMatch(/owner\/repo/);
  });

  it('rejects duplicate categoryPrefix', () => {
    const r = buildRoutes(
      [
        { categoryPrefix: 'Foo', repo: 'a/b' },
        { categoryPrefix: 'Foo', repo: 'c/d' },
      ],
      FALLBACK,
    );
    expect(r.rejected[0].reason).toMatch(/duplicate/);
  });

  it('inherits fallback branch / subdir when rule omits them', () => {
    const r = buildRoutes([{ categoryPrefix: 'Work', repo: 'acme/team' }], FALLBACK);
    const work = r.routes.find(x => x.routeId.startsWith('rule:'));
    expect(work?.branch).toBe('main');
    expect(work?.subdir).toBe('notes');
  });

  it('honours rule branch + subdir overrides', () => {
    const r = buildRoutes(
      [{ categoryPrefix: 'Work', repo: 'acme/team', branch: 'develop', subdir: 'docs' }],
      FALLBACK,
    );
    const work = r.routes.find(x => x.routeId.startsWith('rule:'));
    expect(work?.branch).toBe('develop');
    expect(work?.subdir).toBe('docs');
  });

  it('routes notes via categoryPrefix match', () => {
    const r = buildRoutes(
      [
        { categoryPrefix: 'Personal', repo: 'me/private' },
        { categoryPrefix: 'Work', repo: 'acme/team' },
      ],
      FALLBACK,
    );
    expect(routeForCategory(r.routes, 'Personal/Finance')?.repo).toBe('me/private');
    expect(routeForCategory(r.routes, 'Work/Outage')?.repo).toBe('acme/team');
    expect(routeForCategory(r.routes, 'Drafts')?.repo).toBe('me/personal');
  });

  it('default route excludes notes claimed by any rule', () => {
    const r = buildRoutes(
      [{ categoryPrefix: 'Personal', repo: 'me/private' }],
      FALLBACK,
    );
    const def = r.routes.find(x => x.routeId === 'default');
    expect(def?.match('Personal/X')).toBe(false);
    expect(def?.match('OtherCategory')).toBe(true);
  });

  it('does not bleed siblings into a prefix match', () => {
    const r = buildRoutes(
      [{ categoryPrefix: 'Reference', repo: 'me/refs' }],
      FALLBACK,
    );
    expect(routeForCategory(r.routes, 'References/Foo')?.repo).toBe('me/personal');
    expect(routeForCategory(r.routes, 'Reference/Postgres')?.repo).toBe('me/refs');
  });
});
