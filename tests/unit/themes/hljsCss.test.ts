import { describe, expect, it } from 'vitest';
import { THEMES, findTheme } from '../../../packages/core/src/themes/themes';
import {
  deriveHljsTokens,
  hljsCssFor,
  hljsTokensFor,
} from '../../../packages/core/src/themes/hljsCss';

describe('deriveHljsTokens', () => {
  it('uses link for keyword + accent for built-ins', () => {
    const palette = findTheme('github-light')!.palette;
    const tokens = deriveHljsTokens(palette);
    expect(tokens.keyword).toBe(palette.link);
    expect(tokens.builtIn).toBe(palette.accent);
  });

  it('uses fgMuted for comments', () => {
    const tokens = deriveHljsTokens(findTheme('one-dark')!.palette);
    expect(tokens.comment).toBe(findTheme('one-dark')!.palette.fgMuted);
  });
});

describe('hljsTokensFor', () => {
  it('applies curated overrides for github-light', () => {
    const tokens = hljsTokensFor(findTheme('github-light')!);
    expect(tokens.keyword).toBe('#cf222e');
    expect(tokens.string).toBe('#0a3069');
    expect(tokens.comment).toBe('#6e7781');
  });

  it('applies curated overrides for dracula', () => {
    const tokens = hljsTokensFor(findTheme('dracula')!);
    expect(tokens.keyword).toBe('#ff79c6');
    expect(tokens.string).toBe('#f1fa8c');
  });

  it('falls back to derived palette for themes without curation', () => {
    const theme = findTheme('hyper-snazzy' as 'snazzy') ?? findTheme('snazzy')!;
    const derived = deriveHljsTokens(theme.palette);
    const tokens = hljsTokensFor(theme);
    expect(tokens.keyword).toBe(derived.keyword);
  });
});

describe('hljsCssFor', () => {
  it('emits CSS rules for every standard hljs token class', () => {
    const css = hljsCssFor(findTheme('github-dark')!);
    for (const cls of [
      '.hljs-keyword',
      '.hljs-built_in',
      '.hljs-string',
      '.hljs-number',
      '.hljs-comment',
      '.hljs-function',
      '.hljs-type',
      '.hljs-variable',
      '.hljs-operator',
      '.hljs-params',
      '.hljs-meta',
      '.hljs-regexp',
      '.hljs-title',
      '.hljs-tag',
      '.hljs-attr',
    ]) {
      expect(css).toContain(cls);
    }
  });

  it('uses the foreground colour as the .hljs base color', () => {
    const theme = findTheme('one-dark')!;
    const css = hljsCssFor(theme);
    expect(css).toContain(`.hljs { color: ${theme.palette.fg};`);
  });

  it('emits CSS for every bundled theme without throwing', () => {
    for (const theme of THEMES) {
      const css = hljsCssFor(theme);
      expect(css.length, theme.id).toBeGreaterThan(200);
    }
  });
});

describe('parity with the 25-theme bundle', () => {
  it('every theme resolves to a valid HljsTokens object', () => {
    for (const theme of THEMES) {
      const tokens = hljsTokensFor(theme);
      for (const key of Object.keys(tokens) as (keyof typeof tokens)[]) {
        expect(typeof tokens[key], `${theme.id}.${key}`).toBe('string');
        expect(tokens[key].length, `${theme.id}.${key} empty`).toBeGreaterThan(0);
      }
    }
  });
});
