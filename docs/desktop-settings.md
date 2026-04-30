# Desktop Settings panel

A slide-in panel from the right side of the window lets the user adjust **theme, font family, body font size, and preview max-width**. Open it with the gear icon in the title bar or `Cmd/Ctrl+,`. Close with the × button or `Esc`.

## Settings

| Setting | Type | Values | Default |
| --- | --- | --- | --- |
| **Theme** | select | `auto` (follow OS) / `light` / `dark` / `sepia` | `auto` |
| **Font family** | select | `system` / `sans` (Inter-style) / `serif` (Georgia) / `mono` | `system` |
| **Body font size** | slider | 12–22 px | 15 px |
| **Preview max-width** | slider | 600–1400 px | 920 px |

Each control writes its change immediately — no Save button. State is persisted to `state.json` via `mid:patch-app-state`, so the next launch comes back with the same look.

## How values are applied

`applySettings()` writes inline custom properties to `:root`:

| Setting | CSS variable | Source |
| --- | --- | --- |
| Font family | `--mid-font-sans` | `FONT_STACKS[choice]` in `renderer.ts` |
| Font size | `--mid-font-size-base` | `<n>px` |
| Preview width | `--mid-preview-max-width` | consumed by `main.viewing > .mid-preview` |
| Theme | `<html class="dark|sepia">` | `applyResolvedTheme()` |

The `auto` theme listens to `nativeTheme.shouldUseDarkColors` (already wired in `apps/electron/main.ts`) and toggles `dark` when the OS flips. `light`, `dark`, and `sepia` ignore the OS.

## Sepia

A new `:root.sepia` block in `tokens.css` ships a warm-paper palette (warm fg `#433422`, paper bg `#f4ecd8`, amber accent `#a06b2a`). It's a third class alongside `dark` and is applied by `applyResolvedTheme()`.

## Reset to defaults

The "Reset to defaults" button writes the `DEFAULT_SETTINGS` block back to state and re-applies — useful after experimenting with extreme font sizes.

## Keyboard

- `Cmd/Ctrl + ,` — toggle the panel.
- `Esc` — close (only when the panel is open).

## Files

- `apps/electron/renderer/index.html` — gear button + `<aside id="settings-panel">` shell.
- `apps/electron/renderer/renderer.ts` — `wireSettingsPanel()`, `applySettings()`, `applyResolvedTheme()`, `FONT_STACKS`, `DEFAULT_SETTINGS`.
- `apps/electron/renderer/renderer.css` — `.mid-settings*` styles, slide-in animation.
- `packages/ui-tokens/src/tokens.css` — `:root.sepia` palette block.
- `apps/electron/main.ts` / `preload.ts` — `AppState` extended with `fontFamily`/`fontSize`/`theme`/`previewMaxWidth`.
