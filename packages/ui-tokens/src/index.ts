/**
 * Programmatic access to design-token values for JS consumers.
 * The CSS files (`tokens.css`, `primitives.css`) are the runtime source of
 * truth — this map mirrors the values for cases where JS needs them
 * (e.g., initializing a third-party renderer like Mermaid that takes a
 * color in JS, not CSS).
 */

export const tokens = {
  color: {
    light: {
      bg: '#ffffff',
      surface: '#f6f8fa',
      fg: '#1f2328',
      fgMuted: '#656d76',
      border: '#d0d7de',
      accent: '#0969da',
      link: '#0969da',
      codeBg: '#f6f8fa',
    },
    dark: {
      bg: '#0d1117',
      surface: '#161b22',
      fg: '#e6edf3',
      fgMuted: '#7d8590',
      border: '#30363d',
      accent: '#2f81f7',
      link: '#2f81f7',
      codeBg: '#161b22',
    },
  },
  font: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
  layout: {
    titlebarHeight: 38,
    sidebarWidth: 240,
  },
  motion: {
    fast: 120,
    base: 200,
    slow: 320,
  },
} as const;

export type ColorScheme = keyof typeof tokens.color;
