# Desktop titlebar

A minimal, icon-only strip. Three quick actions on the left, a centered filename, a segmented render-mode toggle + settings on the right. No labels — every glyph carries a tooltip with its keyboard shortcut.

```
[📁] [📄] [💾]              <filename>              [👁 ⫶ ✏️]   [⚙]
```

## macOS traffic-light inset

The Electron window uses `titleBarStyle: 'hiddenInset'` on macOS so the standard close/minimize/maximize controls render over a custom toolbar. Without explicit padding, our left-aligned toolbar buttons collide with the traffic lights.

## Behavior

- **macOS** (`platform === 'darwin'`): the renderer adds `is-mac` to `<body>`, which adds `padding-left: 80px` to `.mid-titlebar`. 80px clears all three traffic-light controls plus a small gutter.
- **Windows / Linux**: no inset is applied — the toolbar starts at the window edge.

## How it's wired

`apps/electron/renderer/renderer.ts` reads `platform` from the `getAppInfo()` IPC response and toggles the body class on first paint. `apps/electron/renderer/renderer.css` reserves the inset only when that class is present, so no platform-specific styles run for non-mac users.

## Layout

| Region | Content |
| --- | --- |
| Left | `Folder` / `Open` / `Save` — ghost icon-only buttons. Tooltip carries the action + shortcut. |
| Center | Active filename (`mid-titlebar-center`), elided to fit. Foreground color is the body fg, not muted, so it's the visual focus. |
| Right | `.mid-mode-toggle` — segmented pill with three icons (View / Split / Edit). Active segment gets a raised surface + small shadow. Followed by the gear icon for Settings. |

The toolbar is drag-region by default, so any non-button area drags the window. Each interactive element opts out via `-webkit-app-region: no-drag`.

## Verifying

- Toolbar buttons are icon-only with tooltips on hover.
- Mode toggle is one connected pill, not three separate buttons. Active segment looks "lifted".
- Filename in the center reads as the visual anchor.
- macOS: `npm run dev:electron` — Open / Save sit ~80px from the left edge to clear the traffic lights.
- Windows / Linux: buttons sit flush at the 12px padding.
