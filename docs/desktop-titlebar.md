# Desktop titlebar — macOS traffic-light inset

The Electron window uses `titleBarStyle: 'hiddenInset'` on macOS so the standard close/minimize/maximize controls render over a custom toolbar. Without explicit padding, our left-aligned toolbar buttons collide with the traffic lights.

## Behavior

- **macOS** (`platform === 'darwin'`): the renderer adds `is-mac` to `<body>`, which adds `padding-left: 80px` to `.mid-titlebar`. 80px clears all three traffic-light controls plus a small gutter.
- **Windows / Linux**: no inset is applied — the toolbar starts at the window edge.

## How it's wired

`apps/electron/renderer/renderer.ts` reads `platform` from the `getAppInfo()` IPC response and toggles the body class on first paint. `apps/electron/renderer/renderer.css` reserves the inset only when that class is present, so no platform-specific styles run for non-mac users.

## Verifying

Run `npm run dev:electron` on macOS and confirm the Open / Save buttons sit ~80px from the left edge. On Windows or Linux, confirm the buttons sit flush at the left padding (12px).
