import { describe, expect, it } from 'vitest';
import {
  buildBacklinks,
  resolveWikiLink,
  normalizeTitle,
} from '../../../packages/core/src/wikilinks/resolver';

describe('resolveWikiLink', () => {
  const notes = [
    { id: 'a', title: 'Notes on Postgres' },
    { id: 'b', title: 'Notes on Postgres' }, // duplicate title → ambiguous
    { id: 'c', title: 'Schema Design' },
  ];

  it('returns ok for a unique title (case-insensitive)', () => {
    expect(resolveWikiLink('schema design', notes)).toEqual({
      status: 'ok',
      match: { id: 'c', title: 'Schema Design' },
    });
  });

  it('returns ambiguous when multiple notes share the title', () => {
    const r = resolveWikiLink('Notes on Postgres', notes);
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') {
      expect(r.matches.map(m => m.id).sort()).toEqual(['a', 'b']);
    }
  });

  it('returns broken when no note matches', () => {
    expect(resolveWikiLink('does not exist', notes)).toEqual({ status: 'broken' });
  });

  it('normalizes inner whitespace', () => {
    expect(normalizeTitle('  Foo   Bar  ')).toBe('foo bar');
  });
});

describe('buildBacklinks', () => {
  it('records source notes that link to a target', () => {
    const corpus = [
      { id: 'a', title: 'Postgres', body: 'see [[Schema Design]] for layout' },
      { id: 'b', title: 'Schema Design', body: 'related: [[Postgres]] (long)' },
      { id: 'c', title: 'Other', body: 'no links here' },
    ];
    const map = buildBacklinks(corpus);
    expect(map.get('b')?.map(e => e.source.id)).toEqual(['a']);
    expect(map.get('a')?.map(e => e.source.id)).toEqual(['b']);
    expect(map.get('c')).toBeUndefined();
  });

  it('skips self-links', () => {
    const corpus = [{ id: 'x', title: 'Self', body: 'I link to [[Self]]' }];
    expect(buildBacklinks(corpus).get('x')).toBeUndefined();
  });

  it('records backlinks for both candidates of an ambiguous link', () => {
    const corpus = [
      { id: 'a', title: 'Foo', body: 'sibling' },
      { id: 'b', title: 'Foo', body: 'sibling' },
      { id: 'c', title: 'Hub', body: 'go to [[Foo]]' },
    ];
    const map = buildBacklinks(corpus);
    expect(map.get('a')?.map(e => e.source.id)).toEqual(['c']);
    expect(map.get('b')?.map(e => e.source.id)).toEqual(['c']);
  });

  it('captures alias as display + raw verbatim', () => {
    const corpus = [
      { id: 'a', title: 'Source', body: 'jump to [[Target|the target page]]' },
      { id: 't', title: 'Target', body: '' },
    ];
    const entry = buildBacklinks(corpus).get('t')?.[0];
    expect(entry?.display).toBe('the target page');
    expect(entry?.raw).toBe('[[Target|the target page]]');
  });
});
