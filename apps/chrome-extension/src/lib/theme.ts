/**
 * Theme plumbing shared by the popup, options, and viewer pages.
 * Applies a packages/core theme palette to :root as CSS custom properties
 * and (for the viewer) injects the matching highlight.js token colours.
 */

import {
  THEMES,
  ThemeDefinition,
  findTheme,
  paletteToCss,
  hljsCssFor,
} from '../../../../packages/core/src/themes';
import { DEFAULT_THEME } from './client';

export { THEMES };

export function resolveTheme(id: string): ThemeDefinition {
  return findTheme(id) ?? findTheme(DEFAULT_THEME) ?? THEMES[0];
}

/** Write the palette variables onto :root and tag the colour scheme. */
export function applyTheme(id: string): ThemeDefinition {
  const theme = resolveTheme(id);
  document.documentElement.setAttribute('style', paletteToCss(theme.palette));
  document.documentElement.setAttribute('data-theme-kind', theme.kind);
  return theme;
}

/** Inject (or replace) the per-theme highlight.js CSS. */
export function applyHljsCss(theme: ThemeDefinition): void {
  let style = document.getElementById('mid-hljs-css');
  if (!style) {
    style = document.createElement('style');
    style.id = 'mid-hljs-css';
    document.head.appendChild(style);
  }
  style.textContent = hljsCssFor(theme);
}

/** Fill a <select> with all 25 themes, grouped light/dark, and preselect one. */
export function populateThemeSelect(select: HTMLSelectElement, selectedId: string): void {
  select.textContent = '';
  for (const kind of ['dark', 'light'] as const) {
    const group = document.createElement('optgroup');
    group.label = kind === 'dark' ? 'Dark' : 'Light';
    for (const theme of THEMES.filter(t => t.kind === kind)) {
      const opt = document.createElement('option');
      opt.value = theme.id;
      opt.textContent = theme.label;
      opt.selected = theme.id === selectedId;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
}
