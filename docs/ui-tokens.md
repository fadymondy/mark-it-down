# ui-tokens — shared design system

`packages/ui-tokens` is the single source of truth for color, spacing, typography, radius, shadow, and motion across the project. The Electron renderer, the VS Code webview, and the published-site stylesheet all consume it instead of redefining their own values.

## What's in the package

| File | Purpose |
| --- | --- |
| `src/tokens.css` | All CSS custom properties (`--mid-*`), light theme on `:root`, dark on `:root.dark`. |
| `src/primitives.css` | Small reset + reusable components (`.mid-btn`, `.mid-list-row`, `.mid-surface`, `.mid-kbd`). Imports tokens implicitly via the cascade — load `tokens.css` first. |
| `src/index.ts` | Programmatic mirror of the values for JS consumers (e.g., Mermaid theme init that takes a JS color). |

## Token namespace

All custom properties are prefixed `--mid-*` to avoid collisions with libraries (Highlight.js, Mermaid) and host environments (VS Code, GitHub Pages).

Categories: `color` (light + dark), `space-*` (4px base, 0..12), `radius-*` (xs..xl + pill), `font-sans/mono`, `font-size-*`, `line-*`, `weight-*`, `shadow-*`, `motion-*`, `ease-*`, `titlebar-h`, `sidebar-w`, `z-*`.

## Wiring a consumer

The Electron renderer wires it like this:

```html
<link rel="stylesheet" href="tokens.css" />
<link rel="stylesheet" href="primitives.css" />
<link rel="stylesheet" href="renderer.css" />
```

Order matters: tokens first (defines variables), primitives next (uses variables), renderer last (consumer-specific layout + overrides).

Build glue in `scripts/copy-electron-assets.mjs` copies the four files into `out/electron/renderer/` so Electron's same-origin CSP can load them.

## Adding a token

1. Add the property to both light and dark blocks in `tokens.css`.
2. If JS needs the value too, mirror it in `src/index.ts`.
3. Use it as `var(--mid-foo)` from any consumer stylesheet.

Don't introduce one-off colors in consumer stylesheets — extend the token set instead, so a future theme switch only edits one file.

## Dark mode

Toggle by adding the `dark` class on `<html>`. The Electron renderer does this from `nativeTheme.shouldUseDarkColors` in `apps/electron/renderer/renderer.ts`.
