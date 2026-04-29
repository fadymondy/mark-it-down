import { describe, expect, it } from 'vitest';
import { inlineToText, tokenize } from '../../src/exporters/markdownTokens';
import type { Tokens } from 'marked';

describe('tokenize', () => {
  it('returns an empty array for empty input', () => {
    expect(tokenize('').length).toBe(0);
  });

  it('parses a heading + paragraph', () => {
    const tokens = tokenize('# Hello\n\nWorld');
    const types = tokens.map(t => (t as { type: string }).type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
  });

  it('preserves code-block language', () => {
    const tokens = tokenize('```ts\nconst x = 1;\n```\n');
    const code = tokens.find(t => (t as { type: string }).type === 'code') as Tokens.Code | undefined;
    expect(code?.lang).toBe('ts');
    expect(code?.text).toBe('const x = 1;');
  });

  it('parses tables with header + body rows', () => {
    const tokens = tokenize('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n');
    const table = tokens.find(t => (t as { type: string }).type === 'table') as Tokens.Table | undefined;
    expect(table?.header.length).toBe(2);
    expect(table?.rows.length).toBe(2);
  });
});

describe('inlineToText', () => {
  it('returns empty string for undefined', () => {
    expect(inlineToText(undefined)).toBe('');
  });

  it('flattens emphasis without losing the text content', () => {
    const tokens = tokenize('one *two* three').flatMap(t => (t as Tokens.Paragraph).tokens ?? []);
    expect(inlineToText(tokens)).toBe('one two three');
  });

  it('renders a link as text + url in parens', () => {
    const tokens = tokenize('see [here](https://example.com)').flatMap(
      t => (t as Tokens.Paragraph).tokens ?? [],
    );
    expect(inlineToText(tokens)).toBe('see here (https://example.com)');
  });

  it('passes through codespan text exactly as marked emits it (HTML-escaped)', () => {
    // marked HTML-escapes < and > inside codespan so the rendered HTML is safe.
    // inlineToText is used by host-side exporters, so the escaping is preserved here too.
    const tokens = tokenize('the `<div>` element').flatMap(
      t => (t as Tokens.Paragraph).tokens ?? [],
    );
    expect(inlineToText(tokens)).toBe('the &lt;div&gt; element');
  });

  it('falls back to text for unknown token types', () => {
    expect(inlineToText([{ type: 'mystery', text: 'foo' } as unknown as Tokens.Token])).toBe(
      'foo',
    );
  });
});
