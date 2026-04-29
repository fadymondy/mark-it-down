import { describe, expect, it } from 'vitest';
import { findTheme, paletteToCss, THEMES, THEME_IDS } from '../../src/themes/themes';

describe('THEMES', () => {
  it('exports exactly 25 themes', () => {
    expect(THEMES.length).toBe(25);
  });

  it('THEME_IDS is in sync with THEMES', () => {
    expect(THEME_IDS).toEqual(THEMES.map(t => t.id));
  });

  it('every theme has a unique id', () => {
    const ids = new Set(THEMES.map(t => t.id));
    expect(ids.size).toBe(THEMES.length);
  });

  it('every palette has all 10 expected color tokens', () => {
    const required = [
      'bg', 'fg', 'fgMuted', 'border', 'link',
      'linkHover', 'codeBg', 'inlineCodeBg', 'tableStripe', 'accent',
    ];
    for (const theme of THEMES) {
      for (const key of required) {
        expect(theme.palette).toHaveProperty(key);
        expect((theme.palette as Record<string, string>)[key]).toMatch(/^(#[0-9a-fA-F]{3,8}|rgba?\(|var\(|transparent)/);
      }
    }
  });

  it('every kind is light or dark', () => {
    for (const theme of THEMES) {
      expect(['light', 'dark']).toContain(theme.kind);
    }
  });

  it('balances roughly between light and dark', () => {
    const light = THEMES.filter(t => t.kind === 'light').length;
    const dark = THEMES.filter(t => t.kind === 'dark').length;
    expect(light).toBeGreaterThanOrEqual(8);
    expect(dark).toBeGreaterThanOrEqual(12);
  });
});

describe('findTheme', () => {
  it('returns the matching theme', () => {
    const t = findTheme('dracula');
    expect(t).toBeDefined();
    expect(t?.kind).toBe('dark');
    expect(t?.label).toBe('Dracula');
  });

  it('returns undefined for unknown ids', () => {
    expect(findTheme('not-a-real-theme')).toBeUndefined();
  });
});

describe('paletteToCss', () => {
  it('emits all CSS variables', () => {
    const t = findTheme('github-light')!;
    const css = paletteToCss(t.palette);
    expect(css).toContain('--bg:');
    expect(css).toContain('--fg:');
    expect(css).toContain('--accent:');
    expect(css).toContain(t.palette.bg);
  });

  it('produces a single-line declaration block', () => {
    const t = findTheme('nord')!;
    expect(paletteToCss(t.palette)).not.toContain('\n');
  });
});
