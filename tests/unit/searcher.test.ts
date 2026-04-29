import { describe, expect, it } from 'vitest';
import { searchNotes, SearchableNote, tokenize } from '../../packages/core/src/search/searcher';

const sample: SearchableNote[] = [
  {
    id: 'n1',
    title: 'Postgres tuning',
    category: 'Reference',
    scope: 'global',
    updatedAt: '2026-04-22T17:42:00.000Z',
    body: 'Connection pooler plus an index hint cut p99 by 200ms. Also bumped work_mem.',
  },
  {
    id: 'n2',
    title: 'Sprint 12 retro',
    category: 'Daily',
    scope: 'workspace',
    updatedAt: '2026-04-26T15:00:00.000Z',
    body: 'Highlights: shipped F12 first cut. Next sprint priorities include packages/core extraction.',
  },
  {
    id: 'n3',
    title: 'OpenAPI conventions',
    category: 'Reference',
    scope: 'global',
    updatedAt: '2026-04-15T10:00:00.000Z',
    body: 'Standardize cursor-based pagination. Use ETags for conditional GETs.',
  },
];

describe('tokenize', () => {
  it('splits on whitespace + commas + semicolons + lowercases', () => {
    expect(tokenize('Hello, World; postgres TUNING')).toEqual(['hello', 'world', 'postgres', 'tuning']);
  });
  it('returns [] for empty/whitespace input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('searchNotes', () => {
  it('returns [] for empty query', () => {
    expect(searchNotes(sample, '')).toEqual([]);
  });

  it('finds title matches', () => {
    const hits = searchNotes(sample, 'postgres');
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe('n1');
    expect(hits[0].score).toBeGreaterThanOrEqual(5);
  });

  it('boosts exact title match higher than partial', () => {
    const hits = searchNotes(
      [
        { id: 'a', title: 'tuning', category: 'X', scope: 'global', updatedAt: '2026-01-01T00:00:00Z', body: '' },
        { id: 'b', title: 'Postgres tuning', category: 'X', scope: 'global', updatedAt: '2026-01-01T00:00:00Z', body: '' },
      ],
      'tuning',
    );
    expect(hits[0].id).toBe('a'); // exact match wins
  });

  it('finds body matches with snippet that surrounds the match', () => {
    const hits = searchNotes(sample, 'pooler');
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe('n1');
    expect(hits[0].snippet.toLowerCase()).toContain('pooler');
  });

  it('multi-token query sums per-token scores', () => {
    const hits = searchNotes(sample, 'postgres pooler');
    expect(hits.length).toBe(1);
    // postgres in title (5) + pooler in body (1) = 6
    expect(hits[0].score).toBeGreaterThanOrEqual(6);
  });

  it('respects the limit', () => {
    const hits = searchNotes(sample, 'reference daily', 1);
    expect(hits.length).toBe(1);
  });

  it('tie-breaks by recency when scores match', () => {
    const same = sample.filter(n => n.category === 'Reference');
    const hits = searchNotes(same, 'reference');
    // n1 (Apr 22) > n3 (Apr 15)
    expect(hits[0].id).toBe('n1');
  });

  it('skips notes with score 0', () => {
    const hits = searchNotes(sample, 'kubernetes');
    expect(hits).toEqual([]);
  });

  it('truncates body fallback snippet for notes that match only in title', () => {
    const note: SearchableNote = {
      id: 'x',
      title: 'foo',
      category: 'X',
      scope: 'global',
      updatedAt: '2026-01-01T00:00:00Z',
      body: 'bar '.repeat(100),
    };
    const hits = searchNotes([note], 'foo');
    expect(hits[0].snippet.length).toBeLessThanOrEqual(165);
  });
});
