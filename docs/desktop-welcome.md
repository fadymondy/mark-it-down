# Welcome / empty-state hero

A first-launch surface that earns its space — brand glyph, tagline, four primary actions, and a Recent list — instead of a single "Open a folder" hint.

## Layout

```
┌──────────────────────────────────────┐
│              [#]                     │  ← inline brand SVG (84 px)
│         Mark It Down                 │  ← title
│  A calm markdown studio — read       │  ← tagline
│  first, edit second.                 │
│                                      │
│  [📁 Open Folder  ⌘⇧O]               │  ← 2×2 quick-action grid
│  [📄 Open File    ⌘O ]               │
│  [➕ New Note      ⌘N ]               │
│  [🖼 Try the sample    ]              │
│                                      │
│  RECENT                              │  ← only when state has any
│  📄 docs/desktop-context-menus.md    │
│  📄 README.md                        │
└──────────────────────────────────────┘
```

## Quick actions

| Action | Behavior |
| --- | --- |
| Open Folder | `Cmd/Ctrl+Shift+O` — same flow as the sidebar's folder picker |
| Open File | `Cmd/Ctrl+O` — single file |
| New Note | `Cmd/Ctrl+N` — disabled when no folder is open (with a muted look) |
| Try the sample | Loads `media/welcome-sample.md` — a tour doc that exercises frontmatter, alerts, math, code, tables, mermaid, and task lists in one file |

The buttons are square cards with icon + label + keyboard hint, arranged in a 2×2 grid for visual rhythm.

## Recent files

`AppState.recentFiles` is a most-recently-used list of absolute paths capped at 10. Pushed into on every `loadFileContent` (file open, sidebar tree click, recent-list click). The hero renders the top 5 with filename + folder path (mono).

If a recent file is missing on click, it's silently pruned from the list and the hero re-renders.

## Implementation

- `welcomeHeroHTML(recent)` builds the markup string; `attachWelcomeHandlers(container)` wires the action + recent-file click events. Both are called from `renderView()` whenever `currentText` is empty.
- `midBrandGlyphSVG()` inlines a smaller copy of the `#`-on-page brand glyph from `media/brand/icon.svg`, keyed off the same gradient so it matches the dock icon.
- `pushRecent(path)` is the single write-side that persists via `mid:patch-app-state`.
- `openSample()` reads the sample file and shows it in View mode without setting `currentPath`, so the user is never tempted to overwrite the tour with `Cmd+S`.

## Files

- `apps/electron/renderer/index.html` — empty `<main>` (was hardcoded empty-state markup).
- `apps/electron/renderer/renderer.ts` — `welcomeHeroHTML`, `midBrandGlyphSVG`, `attachWelcomeHandlers`, `openSample`, `openRecent`, `pushRecent`. `recentFiles` state + `AppState` field.
- `apps/electron/renderer/renderer.css` — `.mid-welcome*` styles.
- `apps/electron/main.ts` / `preload.ts` — `recentFiles` in `AppState`.
- `media/welcome-sample.md` — the tour doc.

## Verifying

1. Fresh launch (or close all files) → hero shows.
2. Click **Try the sample** → tour doc renders. Frontmatter panel + alert + math + code + table + mermaid + checkboxes all visible.
3. Click **Open File** → pick a markdown → loads in View. Quit + relaunch → hero now shows that file under "Recent".
4. With a folder open, **New Note** is enabled; without a folder, it's muted.
5. Click a recent entry → loads instantly; if you delete the file outside the app first, clicking it shows "File no longer exists" and prunes the entry.
