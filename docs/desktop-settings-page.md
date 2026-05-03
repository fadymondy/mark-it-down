# Desktop settings page

The Mark It Down desktop app exposes preferences through a dedicated full-screen
settings view. The original layout shipped in #232/#234; the controls were
wired through to real persisted settings in #315. Theme picker landed in #233;
typed-notes registry + filter strip wiring landed in #297/#302.

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

## Persistence model

Every setting in this page round-trips through three APIs:

- `mid:read-app-state` — read at boot in `apps/electron/renderer/renderer.ts`.
- `mid:patch-app-state` — written on every change. The handler in
  `apps/electron/main.ts` accepts arbitrary JSON-blob keys and writes them
  through `setSetting()` in `apps/electron/db.ts`. Because the SQLite
  `app_state` table is a key/JSON store, adding new keys never requires a
  migration.
- The renderer's `applySettings()` mirrors the in-memory `settings` object
  into CSS variables, body classes, and DOM attributes so toggling a control
  takes effect immediately — no restart.

Defaults live in `DEFAULT_SETTINGS` at the top of `renderer.ts`. The
**Reset all settings** button in **Advanced** writes that object verbatim
back to disk and re-runs `applySettings()` so the live UI matches.

## General

| Control | Key | Type | Default | Effect |
|---|---|---|---|---|
| Default mode on launch | `defaultMode` | `'view' \| 'split' \| 'edit'` | `'view'` | Picks the initial editor layout when opening a fresh window. |
| Open last folder on launch | `reopenLastFolder` | `boolean` | `true` | When off, the app cold-starts to the welcome screen even if SQLite remembers a folder. |
| Confirm before closing dirty tabs | `confirmDirtyClose` | `boolean` | `true` | Prompts before closing a tab with unsaved changes (the prompt is `window.confirm`). |

## Appearance

| Control | Key | Type | Default | Effect |
|---|---|---|---|---|
| Mode pills | `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Light/Dark/System mode. `auto` follows `nativeTheme`. |
| Color theme grid | `theme` | `theme:<id>` | (not set) | Picks one of the 25 named themes from `packages/core/src/themes/themes.ts`. |
| Font family | `fontFamily` | `'system' \| 'sans' \| 'serif' \| 'mono'` | `'system'` | Swaps the `--mid-font-sans` CSS variable used by the preview. |
| Body font size | `fontSize` | `12..22` (number) | `17` | Sets the `--mid-font-size-reading` CSS variable. |
| Preview max-width | `previewMaxWidth` | `600..1400` (number) | `760` | Caps `.mid-preview` column width. |

## Editor

| Control | Key | Type | Default | Effect |
|---|---|---|---|---|
| Word wrap | `editorWordWrap` | `boolean` | `true` | Soft-wraps long lines. Off → `wrap="off"` + horizontal scrollbar; the body class `editor-nowrap` is also flipped for any future CSS hooks. Live-applied to the mounted textarea. |
| Show line numbers in code blocks | `codeLineNumbers` | `boolean` | `true` | Gates `addLineNumbers()` in the preview pipeline. Toggle re-renders the active document so the gutter appears/disappears immediately. |
| Auto-save | `autoSaveMode` | `'off' \| 'blur' \| 'interval'` | `'off'` | Off → manual `Cmd/Ctrl+S` only. Blur → save the active tab when the editor loses focus. Interval → `setInterval(autoSaveActiveTab, 5000)`. Untitled buffers are skipped to avoid surprise Save-As dialogs. |

## Notes

| Control | Key | Type | Default | Effect |
|---|---|---|---|---|
| Default note type | `defaultNoteType` | type id | `'note'` | Used when the create-note chooser is dismissed via "Just a note". Falls back to `DEFAULT_TYPE_ID` if the saved id no longer exists in the registry. |
| Show type filter strip | `noteTypeStripHidden` | `boolean` | `false` | Master toggle for the horizontal type chips above the notes sidebar. |
| Per-type strip visibility | `noteTypeStripExclude` | `string[]` | `[]` | Type ids to omit from the strip even when it's visible. |
| Strip ordering (drag) | `noteTypeOrder` | `string[]` | `[]` | Explicit ordering; ids missing from this list append in registry order. |
| Note types registry | n/a | `note_types` SQLite table | (built-ins) | Built-in types are locked; user-defined types can be edited / deleted via `mid:note-types-upsert` / `mid:note-types-delete`. |

## GitHub

| Control | Key | Type | Effect |
|---|---|---|---|
| Active warehouse readout | n/a | read from `<workspace>/.mid/warehouse.json` | Displays the current workspace's first warehouse (name / repo / branch / subdir). |
| Change warehouse… | n/a | trigger | Calls `openWarehouseOnboarding(true)` to re-enter the onboarding flow with `force=true` (clears the dismissed list). |
| gh CLI status | n/a | derived from `mid:gh-auth-status` | Live read of `gh auth status` so the user knows whether sync will work. |
| Reset GitHub token | `ghToken` | `string` (cleared to `''`) | Wipes the device-flow OAuth token so the next push triggers a fresh login. Confirms via `midConfirm` first. |

## Export

| Control | Key | Type | Default | Effect |
|---|---|---|---|---|
| Code export background | `codeExportGradient` | `'none' \| 'sunset' \| 'ocean' \| 'lavender' \| 'forest' \| 'slate' \| 'midnight'` | `'sunset'` | Backdrop gradient for the code-block PNG export. |
| Add unique id suffix | `exportUniqueId` | `boolean` | `true` | Appends an 8-char id to every exported filename (e.g. `notes--ab12cd34.md`). Off reuses the source basename verbatim. |
| Default export folder | `defaultExportFolder` | `string` (path) | `''` | When set, prepended to the default name passed to `dialog.showSaveDialog` so exports open at that folder. Empty = OS default. |

## Advanced

| Control | Effect |
|---|---|
| Diagnostics readout | App version, platform, `app.getPath('userData')`, `app.getPath('documents')`. |
| Open user data folder | `shell.openPath(userData)` — reveals the SQLite/notes/settings directory in Finder/Explorer. |
| Re-open warehouse onboarding | `openWarehouseOnboarding(true)` — restarts the first-run flow even when a warehouse already exists. |
| Reset all settings | Wipes every preference back to `DEFAULT_SETTINGS`, re-applies, and re-renders the section. Notes, warehouses, and tabs are preserved. |

## Persisted setting keys (full)

| Key                  | Type                                                                              | Section    |
|----------------------|------------------------------------------------------------------------------------|------------|
| `theme`              | `'auto' \| 'light' \| 'dark' \| 'sepia' \| theme:<id>`                            | Appearance |
| `fontFamily`         | `'system' \| 'sans' \| 'serif' \| 'mono'`                                         | Appearance |
| `fontSize`           | `12..22` (number)                                                                  | Appearance |
| `previewMaxWidth`    | `600..1400` (number)                                                               | Appearance |
| `defaultMode`        | `'view' \| 'split' \| 'edit'`                                                     | General    |
| `reopenLastFolder`   | `boolean`                                                                          | General    |
| `confirmDirtyClose`  | `boolean`                                                                          | General    |
| `editorWordWrap`     | `boolean`                                                                          | Editor     |
| `codeLineNumbers`    | `boolean`                                                                          | Editor     |
| `autoSaveMode`       | `'off' \| 'blur' \| 'interval'`                                                   | Editor     |
| `defaultNoteType`    | type id (`string`)                                                                 | Notes      |
| `noteTypeStripHidden`| `boolean`                                                                          | Notes      |
| `noteTypeStripExclude`| `string[]`                                                                        | Notes      |
| `noteTypeOrder`      | `string[]`                                                                         | Notes      |
| `ghToken`            | `string` (OAuth token; cleared via Reset)                                          | GitHub     |
| `codeExportGradient` | `'none' \| 'sunset' \| 'ocean' \| 'lavender' \| 'forest' \| 'slate' \| 'midnight'`| Export     |
| `exportUniqueId`     | `boolean`                                                                          | Export     |
| `defaultExportFolder`| `string` (path)                                                                    | Export     |

Other persisted keys touched implicitly by the page (not exposed as a control,
but reset by **Advanced → Reset all settings**): `splitRatio`, `lastFolder`,
`recentFiles`, `pinnedFolders`, `workspaces`, `activeWorkspace`,
`outlineHidden`, `warehouseOnboardingDismissed`, `tabSplitActive`,
`tabSplitRatio`, `tabActiveStripId`.

## Row pattern

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
toggle-style controls.

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
when there isn't room.

## Files

- `apps/electron/renderer/index.html` — `#settings-page` shell.
- `apps/electron/renderer/renderer.ts` — `wireSettingsPanel()`, all
  `render*Section()` helpers, `makeGroup`, `makeRow`, `applySettings()`,
  `autoSaveActiveTab()`, `setupAutoSaveInterval()`, `defaultExportName()`.
- `apps/electron/renderer/renderer.css` — `.mid-settings-page`,
  `.mid-settings-nav`, `.mid-settings-group`, `.mid-setting-row`,
  `.mid-mode-pills`, `.mid-theme-grid`, `.mid-theme-card`, `.mid-kv-row`.
- `apps/electron/preload.ts` — `AppState` interface, IPC bridge surface
  (`openUserDataFolder`, `pickFolder`).
- `apps/electron/main.ts` — `mid:patch-app-state` (generic JSON-blob writer),
  `mid:open-user-data-folder`, `mid:pick-folder`.
- `apps/electron/db.ts` — SQLite `app_state` key/JSON store backing every
  setting key in this page.
- `packages/core/src/themes/themes.ts` — the 25-theme palette.

## Reference

The design patterns were ported from:

- `/Users/fadymondy/Sites/orchestra-agents/apps/components/settings`
- `/Users/fadymondy/Sites/orchestra-agents/apps/components/theme`

The reference packages are not pulled as a dependency — patterns were
ported into native renderer code so we can evolve them independently without
a vendor sync.
