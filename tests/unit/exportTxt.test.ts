import { describe, expect, it } from 'vitest';
import { markdownToTxt } from '../../src/exporters/exportTxt';

describe('markdownToTxt', () => {
  it('preserves heading markers', () => {
    const out = markdownToTxt('# H1\n\n## H2\n\nbody');
    expect(out).toContain('# H1');
    expect(out).toContain('## H2');
    expect(out).toContain('body');
  });

  it('strips bold/italic markers from inline text', () => {
    const out = markdownToTxt('this is *italic* and **bold**');
    expect(out).toContain('this is italic and bold');
    expect(out).not.toContain('**');
    expect(out).not.toMatch(/\*[a-z]/);
  });

  it('renders links as text + url in parens', () => {
    const out = markdownToTxt('see [the docs](https://example.com)');
    expect(out).toContain('see the docs (https://example.com)');
  });

  it('renders unordered lists with - prefix', () => {
    const out = markdownToTxt('- one\n- two\n- three');
    expect(out).toContain('- one');
    expect(out).toContain('- two');
    expect(out).toContain('- three');
  });

  it('renders ordered lists with numeric prefix', () => {
    const out = markdownToTxt('1. first\n2. second');
    expect(out).toContain('1. first');
    expect(out).toContain('2. second');
  });

  it('fences code blocks with --- and preserves language hint', () => {
    const out = markdownToTxt('```ts\nconst x = 1;\n```');
    expect(out).toMatch(/--- ts ---/);
    expect(out).toContain('const x = 1;');
  });

  it('renders blockquotes with > prefix', () => {
    const out = markdownToTxt('> a quote');
    expect(out).toContain('> a quote');
  });

  it('renders tables as aligned ASCII with header underline', () => {
    const out = markdownToTxt('| A | B |\n|---|---|\n| 1 | 2 |\n');
    expect(out).toContain('| A');
    expect(out).toContain('| B');
    expect(out).toContain('| 1');
    expect(out).toMatch(/\|---/);
  });

  it('renders hr as ---', () => {
    const out = markdownToTxt('para\n\n---\n\nmore');
    expect(out).toContain('---');
  });

  it('produces an empty (single newline) output for empty input', () => {
    expect(markdownToTxt('')).toBe('\n');
  });

  it('collapses multiple blank lines to at most two', () => {
    const out = markdownToTxt('a\n\n\n\n\nb');
    expect(out).not.toMatch(/\n{3,}/);
  });

  it('terminates output with exactly one trailing newline', () => {
    const out = markdownToTxt('hello');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});
