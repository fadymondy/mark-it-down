# Mark It Down — Chrome extension

Quick markdown note capture into your Mark It Down warehouse, plus a
standalone themeable markdown viewer. Manifest V3, no frameworks, no
telemetry, no remote code — everything is bundled at build time with
esbuild, reusing the shared `packages/core` renderer and theme system via
relative imports (same convention as the Electron renderer).

## Features

- **Popup** — capture the current page (title, selection, category) as a
  note via `POST /api/notes`, and jump to your 10 most recent notes.
- **Viewer** — `viewer.html?url=<file.md>` or `viewer.html?note=<id>`
  renders markdown with the shared marked + highlight.js + DOMPurify
  pipeline and all 25 bundled themes. A context-menu entry ("Open in Mark
  It Down viewer") appears on links ending in `.md` / `.markdown`.
- **Options** — server URL, personal access token (`togo_pat_…`), theme,
  connection test against `/api/auth/me`, and an update check against
  `/api/updates/chrome` (GitHub releases as fallback).
- **Background** — daily update check that badges the toolbar icon when a
  newer release is published.

Host permissions are optional: the manifest declares
`optional_host_permissions` and the options page requests access to just
your server's origin when you save it. The viewer offers a one-click grant
when a markdown URL's origin is not yet allowed.

## Build

```sh
cd apps/chrome-extension
npm install
npm run typecheck   # tsc --noEmit over src/ + the imported core modules
npm run build       # bundles to dist/ and stamps manifest version
npm run smoke       # renders sample markdown through the bundled core renderer
npm run zip         # dist-zip/mark-it-down-chrome-v<version>.zip
```

The runtime libraries (marked, highlight.js, dompurify, marked-highlight)
are devDependencies only — they are compiled into the bundles, so `dist/`
is fully self-contained.

## Load unpacked

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode**
3. **Load unpacked** → select `apps/chrome-extension/dist`
4. Open the extension options, set your warehouse URL + access token,
   allow the host permission prompt, and hit **Test connection**.

## Release

`npm run zip` produces `dist-zip/mark-it-down-chrome-v<version>.zip` (the
version comes from `package.json` and is stamped into the manifest at
build time). Upload it to the GitHub release; the web app's
`/api/updates/chrome` feed picks it up automatically.
