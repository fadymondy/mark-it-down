# Themes (25 bundled palettes + auto)

Status: shipped in Phase 0.8 · Issue: [#8](https://github.com/fadymondy/mark-it-down/issues/8)

The Mark It Down renderer now ships **25 hand-curated theme palettes** in addition to the original `auto` mode. Switching themes restyles markdown rendering, mermaid (in dark/light mode bucketing), and code highlight backgrounds — without restarting VSCode.

## At a glance

| | |
|---|---|
| **Where** | `markItDown.theme` setting · `Mark It Down: Pick Theme` command (Quick Pick) |
| **Default** | `auto` — the renderer uses VSCode's `--vscode-*` CSS variables, so it follows whatever theme you have active |
| **Custom themes** | 25 palettes covering popular VSCode/editor themes — see [the bundled set](#bundled-themes) below |
| **Apply mid-session** | Open custom editors re-render automatically when the setting changes |
| **Mermaid** | Mermaid theme follows the bundled palette's `kind` (light or dark) |

## Bundled themes

| ID | Label | Kind |
|---|---|---|
| `auto` | Auto (follows VSCode) | inherit |
| `github-light` | GitHub Light | light |
| `github-dark` | GitHub Dark | dark |
| `dracula` | Dracula | dark |
| `one-dark` | Atom One Dark | dark |
| `one-light` | Atom One Light | light |
| `monokai` | Monokai | dark |
| `solarized-light` | Solarized Light | light |
| `solarized-dark` | Solarized Dark | dark |
| `tokyo-night` | Tokyo Night | dark |
| `tokyo-night-light` | Tokyo Night Light | light |
| `ayu-light` | Ayu Light | light |
| `ayu-mirage` | Ayu Mirage | dark |
| `ayu-dark` | Ayu Dark | dark |
| `gruvbox-light` | Gruvbox Light | light |
| `gruvbox-dark` | Gruvbox Dark | dark |
| `nord` | Nord | dark |
| `nord-light` | Nord Light | light |
| `palenight` | Palenight | dark |
| `material-dark` | Material Dark | dark |
| `material-light` | Material Light | light |
| `night-owl` | Night Owl | dark |
| `cobalt2` | Cobalt 2 | dark |
| `oceanic-next` | Oceanic Next | dark |
| `snazzy` | Hyper Snazzy | dark |
| `rose-pine` | Rosé Pine | dark |

That's 25 palettes (15 dark, 10 light) + `auto`.

## How it works

Each theme is a TypeScript object in `src/themes/themes.ts` with a 10-token palette:

```ts
interface ThemePalette {
  bg: string;        // page background
  fg: string;        // body text
  fgMuted: string;   // captions, descriptions, table-stripe text
  border: string;    // table borders, hr, code-block border
  link: string;      // <a>
  linkHover: string; // <a:hover>
  codeBg: string;    // <pre> background
  inlineCodeBg: string;  // inline `code` background
  tableStripe: string;   // alternating row background
  accent: string;    // blockquote bar, mode-toggle button
}
```

When the user picks a non-`auto` theme, `webviewBuilder.ts` emits an extra `<style>` block:

```css
:root[data-theme="dracula"] {
  --bg: #282a36;
  --fg: #f8f8f2;
  --fg-muted: #6272a4;
  --border: #44475a;
  --link: #8be9fd;
  --link-hover: #bd93f9;
  --code-bg: #21222c;
  --inline-code-bg: #44475a;
  --table-stripe: #2f3243;
  --accent: #bd93f9;
  color-scheme: dark;
}
```

The existing CSS rules already use `var(--bg)` etc., so the override propagates automatically — no per-element rewrites needed.

For `auto`, no override is emitted; the existing `var(--vscode-*)` fallbacks remain in effect.

## How to switch themes

Two paths:

1. **Quick Pick** — `Cmd+Shift+P` → "Mark It Down: Pick Theme" → choose. The setting updates in the workspace (or globally if no folder is open).
2. **Settings UI** — `Cmd+,` → search "Mark It Down: Theme" → pick from the dropdown.
3. **`settings.json`** —

   ```json
   {
     "markItDown.theme": "tokyo-night"
   }
   ```

When the setting changes, every open Mark It Down custom editor reloads its webview HTML with the new theme. No VSCode restart needed. **Tradeoff**: re-loading the HTML resets in-progress edit-mode cursor position and scroll. For now this is the simplest correct behavior; finer-grained CSS variable swapping (without HTML reload) is a future-work seed.

## Mermaid theme integration

Mermaid runs entirely inside the webview, with its own theme system (`default` / `dark`). The Mark It Down theme bridge maps each bundled theme's `kind` (`light` / `dark`) to one of those mermaid themes, so a flowchart in `dracula` mode renders dark-themed nodes against the dracula background.

When `auto` is selected, mermaid follows the VSCode color theme directly via the `themeKind` value the host sends in every `update` message.

## Edge cases

- **Custom theme not found**: typo in `markItDown.theme` (e.g. `"draccula"`)? `webviewBuilder.ts` checks via `findTheme()`; if undefined, no override is emitted and the renderer falls back to `auto`. The data-theme attribute still records what the user typed for diagnostic purposes.
- **Theme switch resets cursor**: changing the theme reloads the webview HTML, which destroys the CodeMirror EditorView. Cursor and selection in Edit mode are reset to position 0. Future work: live-swap CSS variables without rebuilding the HTML.
- **High-contrast themes**: not yet bundled — VSCode's high-contrast modes are followed in `auto`. Adding `hc-light` / `hc-dark` palettes is a future addition.
- **Mermaid in light themes**: mermaid's `default` theme looks fine on most light backgrounds; if a specific light bundled theme has poor contrast with mermaid edges, it's tracked as polish (not a blocker).
- **Theme syntax-highlighting tokens**: as of #51, every theme also gets a per-token highlight.js palette. See the section below for how it's wired.

## Per-token highlight.js palette (#51)

Every bundled theme gets a coherent code-highlight palette tuned against
its chrome — keywords, strings, comments, types, fn names, regex, etc.
all match the surrounding theme rather than sitting on top of a generic
`atom-one-dark` base.

### How it's derived

- Default mapping from `packages/core/src/themes/hljsCss.ts`:
  `keyword → palette.link`, `built-in → palette.accent`,
  `comment → palette.fgMuted`, `fn → palette.link`,
  `string → palette.linkHover`, `variable → palette.fg`, etc.
- Curated overrides per theme — github-light/dark, dracula, one-dark/light,
  monokai, solarized-light/dark, tokyo-night, nord, gruvbox-light/dark,
  rose-pine, cobalt2 — use the well-known community palettes for those
  ecosystems instead of the derived defaults.
- All 25 themes resolve to a fully-populated `HljsTokens` object via
  `hljsTokensFor(theme)`; `hljsCssFor(theme)` emits the matching CSS.

### Where it lands

- **Webview**: `webviewBuilder.ts` emits the per-theme block right after
  the existing chrome `:root[data-theme=…]` override. Marked still
  produces `<span class="hljs-keyword">` etc.; our CSS overrides paint
  them.
- **Published site**: `buildSiteAssets(palette, kindIsDark, theme)`
  appends the same per-theme rules after the bundled hljs base
  stylesheet, so deployed sites match local rendering.

### Tradeoffs

- 25 themes ship hand-tuned for the marquee ones + algorithmic for the
  rest. The algorithmic mapping is correct but conservative — PRs to
  curate Ayu, Material, Night Owl, Oceanic Next, Snazzy, Palenight,
  Tokyo Night Light, Nord Light against their canonical token palettes
  are welcome.
- The bundled hljs stylesheet (`atom-one-dark` for dark-kind, `github`
  for light-kind) still loads as a base; our per-theme rules override
  it. This costs ~2KB extra CSS but keeps the load path simple.

## Why not `@orchestra-mcp/theme`?

The original spec mentioned bridging to `@orchestra-mcp/theme` for the 25-theme set. That package is a private aspirational reference that may or may not exist publicly; rather than block on it, F7 ships the 25 palettes directly inside this extension. If `@orchestra-mcp/theme` does become published, swapping in its tokens is a one-file change to `src/themes/themes.ts` — the rest of the bridge stays the same.

## Files of interest

- [src/themes/themes.ts](../src/themes/themes.ts) — 25 `ThemeDefinition` entries + `findTheme` + `paletteToCss`
- [src/editor/webviewBuilder.ts](../src/editor/webviewBuilder.ts) — emits the per-theme `:root[data-theme=…]` override block
- [src/editor/markdownEditorProvider.ts](../src/editor/markdownEditorProvider.ts) — `resolveTheme` returns the user's preference verbatim; `onDidChangeConfiguration` reloads the webview HTML on theme change
- [src/extension.ts](../src/extension.ts) — `markItDown.pickTheme` command (Quick Pick over `THEMES`)
- [package.json](../package.json) — `markItDown.theme` setting enum (25 values + `auto`); `markItDown.pickTheme` command registration
