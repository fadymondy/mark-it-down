# Desktop settings page

The Mark It Down desktop app exposes preferences through a dedicated full-screen
settings view (Issue #232). The view replaces the right-sidebar drawer that had
been in place since v0.1 and adopts the visual patterns from
`/Users/fadymondy/Sites/orchestra-agents/apps/components/settings` and
`/Users/fadymondy/Sites/orchestra-agents/apps/components/theme`, rebuilt against
our existing `--mid-*` tokens.

## At a glance

```
┌─────────────────────────────────────────────────────────────────┐
│ ←  Settings / Appearance                                        │  topbar
├──────────────┬──────────────────────────────────────────────────┤
│  Settings    │                                                  │
│  Customize…  │   ┌────── Mode ──────────────────────────────┐   │
│              │   │ Light · Dark · System                    │   │
│  ▸ General   │   └──────────────────────────────────────────┘   │
│  ● Appearance│   ┌────── Color theme ───────────────────────┐   │
│  ▸ Editor    │   │ Light themes  Dark themes (25 cards)     │   │
│  ▸ Notes     │   └──────────────────────────────────────────┘   │
│  ▸ GitHub    │   ┌────── Typography ────────────────────────┐   │
│  ▸ Export    │   │ Font family · size · max-width           │   │
│  ▸ Advanced  │   └──────────────────────────────────────────┘   │
└──────────────┴──────────────────────────────────────────────────┘
```

## Opening and closing

- **Open**: click the cog button in the titlebar, click the gear in the
  activity bar, or press `Cmd/Ctrl + ,`.
- **Close**: click the back arrow, press `Esc`, or press `Cmd/Ctrl + ,` again.

When the page opens, the renderer captures `root.scrollTop` so closing the
page restores the previously-open document at the same scroll position.

## Categories

The left rail lists seven categories. Arrow keys navigate between them; `Tab`
cycles controls inside the active section in DOM order.

| Category    | Contents                                                                |
|-------------|-------------------------------------------------------------------------|
| General     | Reset all settings (theme · fonts · preview width · code-export gradient) |
| Appearance  | Mode toggle (light/dark/system) · 25-theme grid · typography             |
| Editor      | Reserved (placeholder until per-editor settings ship)                    |
| Notes       | Reserved (placeholder until per-workspace note defaults ship)            |
| GitHub      | Live `gh` CLI status (signed in / not signed in / not detected)          |
| Export      | Code-export gradient backdrop (`none`, `sunset`, `ocean`, …)             |
| Advanced    | App version, platform, user-data path, documents path                    |

## Persisted setting keys

The page is purely a UI relocation — no schema changes from the prior drawer.
Every key is read and written through the existing IPCs:

- `mid:read-app-state` — read at boot in `apps/electron/renderer/renderer.ts`
- `mid:patch-app-state` — written on every change

Persisted keys preserved across the migration:

| Key                  | Type                                                                   |
|----------------------|------------------------------------------------------------------------|
| `theme`              | `'auto' \| 'light' \| 'dark' \| 'sepia' \| theme:<id>`                  |
| `fontFamily`         | `'system' \| 'sans' \| 'serif' \| 'mono'`                              |
| `fontSize`           | `12..22` (number)                                                      |
| `previewMaxWidth`    | `600..1400` (number)                                                   |
| `codeExportGradient` | `'none' \| 'sunset' \| 'ocean' \| 'lavender' \| 'forest' \| 'slate' \| 'midnight'` |

## Mode toggle (Issue #233)

The Appearance section's Mode group exposes three pills — Light, Dark, System.

- Light / Dark: write `theme: 'light'` or `theme: 'dark'` to `app_state`.
- System: writes `theme: 'auto'` and follows `nativeTheme`'s `is-dark` event,
  which `apps/electron/main.ts` forwards to the renderer at boot and on
  OS-appearance change.
- Switching mode releases any named theme — every `mid-theme-card` resets its
  border and `aria-pressed` state.

## Theme picker grid (Issue #233)

The Appearance section's Color theme group renders one card per theme defined
in `packages/core/src/themes/themes.ts` (25 themes total). Cards are grouped
by `kind` (Light themes / Dark themes) and ordered as they appear in the
`THEMES` array.

Each card:

- Uses the theme's own `bg`, `fg`, and `border` for its visible surface, so
  the card itself previews the theme.
- Renders four bars in `--theme.fgMuted`, `--theme.accent`, `--theme.codeBg`
  to evoke a code mockup (matches the reference's preview pattern).
- Tags the kind in the corner (`Light` / `Dark`) using
  `--theme.accent` on `--theme.bg`.
- On click, writes `theme: 'theme:<id>'`. Active state uses
  `border-color: var(--mid-accent)` and `box-shadow: 0 0 0 2px var(--mid-accent)`.

The transition is smooth because the renderer updates only the active borders
and the mode-pill state — it never re-renders the entire grid on selection.

## Row pattern (Issue #234)

Every settings group uses the row pattern from
`/Users/fadymondy/Sites/orchestra-agents/apps/components/settings/src/SettingsForm/SettingField.tsx`:

```
┌─ section card (mid-settings-group) ─────────┐
│ Title (h3)                                  │
│ Description                                 │
├─────────────────────────────────────────────┤
│ ┌─ row ─────────────────────────────────┐   │
│ │ Label                                 │   │
│ │ Description (helper text)             │   │
│ │ ┌─ control ────────────────────────┐  │   │
│ │ │ select / range / button / pills  │  │   │
│ │ └──────────────────────────────────┘  │   │
│ └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

The helper `makeGroup(title, description?)` builds the card; `makeRow({ label,
description?, inline? }, control)` builds the row. `inline: true` switches the
row to a single-line layout (label/desc on the left, control on the right) for
toggle-style controls (used today by **General → Reset all settings**).

## Accessibility

- The page is a `<section aria-label="Settings">` rather than a `<dialog>`
  because it owns the entire window once open.
- The left rail uses `role="tablist"` with `aria-orientation="vertical"`.
- Each rail item is `role="tab"` with `aria-selected` reflecting the active
  category. `ArrowDown` / `ArrowUp` move focus across items.
- `Tab` cycles controls inside the active section in DOM order.
- Focus on `Esc` first blurs any active form control before closing the page,
  so the underlying document doesn't receive a stray Escape.

## Responsive

Below 720 px, the body switches to a stacked layout: the rail collapses into
a horizontal tab strip pinned to the top of the body, scrolling horizontally
when there isn't room. The rail header (title + subtitle) hides at this size
to maximize the strip width.

## Files

- `apps/electron/renderer/index.html` — `#settings-page` shell + topbar +
  rail / main split
- `apps/electron/renderer/renderer.ts` — `wireSettingsPanel()`, all
  `render*Section()` helpers, `makeGroup`, `makeRow`,
  `resolveModeFromTheme`, `modeChoiceToTheme`, the theme grid, and the
  Cmd/Ctrl+, + Esc handlers
- `apps/electron/renderer/renderer.css` — `.mid-settings-page`,
  `.mid-settings-nav`, `.mid-settings-group`, `.mid-setting-row`,
  `.mid-mode-pills`, `.mid-theme-grid`, `.mid-theme-card`, `.mid-kv-row`
- `packages/core/src/themes/themes.ts` — the 25-theme palette consumed by
  the picker

## Reference

The design patterns were ported from:

- `/Users/fadymondy/Sites/orchestra-agents/apps/components/settings`
- `/Users/fadymondy/Sites/orchestra-agents/apps/components/theme`

The reference packages are not pulled as a dependency — patterns were
ported into native renderer code so we can evolve them independently without
a vendor sync.
