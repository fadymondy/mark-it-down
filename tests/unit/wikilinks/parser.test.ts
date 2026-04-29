import { describe, expect, it } from 'vitest';
import { parseWikiLinks } from '../../../packages/core/src/wikilinks/parser';

describe('parseWikiLinks', () => {
  it('returns empty array when source has no wiki-links', () => {
    expect(parseWikiLinks('plain text with [a normal link](http://x)')).toEqual([]);
  });

  it('parses a simple [[note]] reference', () => {
    const refs = parseWikiLinks('see [[Foo]] for more');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ raw: '[[Foo]]', target: 'Foo' });
    expect(refs[0].alias).toBeUndefined();
    expect(refs[0].anchor).toBeUndefined();
  });

  it('parses alias and anchor', () => {
    const refs = parseWikiLinks('[[Foo#intro|Read intro]]');
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe('Foo');
    expect(refs[0].anchor).toBe('intro');
    expect(refs[0].alias).toBe('Read intro');
  });

  it('returns char positions matching the original source', () => {
    const src = 'hello [[Foo]] world';
    const [r] = parseWikiLinks(src);
    expect(src.slice(r.start, r.end)).toBe('[[Foo]]');
  });

  it('skips wiki-links inside fenced code blocks', () => {
    const src = '```\n[[Foo]]\n```\n[[Bar]]';
    const refs = parseWikiLinks(src);
    expect(refs.map(r => r.target)).toEqual(['Bar']);
  });

  it('skips wiki-links inside inline code spans', () => {
    const src = 'use `[[Foo]]` to make a wiki-link, e.g. [[Bar]]';
    const refs = parseWikiLinks(src);
    expect(refs.map(r => r.target)).toEqual(['Bar']);
  });

  it('handles multiple wiki-links on the same line', () => {
    const refs = parseWikiLinks('[[A]] and [[B]] and [[C|alias]]');
    expect(refs.map(r => r.target)).toEqual(['A', 'B', 'C']);
    expect(refs[2].alias).toBe('alias');
  });

  it('ignores empty wiki-links', () => {
    expect(parseWikiLinks('[[ ]]')).toEqual([]);
  });

  it('does not span newlines inside a single wiki-link', () => {
    expect(parseWikiLinks('[[Foo\nBar]]')).toEqual([]);
  });
});
