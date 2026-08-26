# Chrome extension (MV3)

Issue: [#328](https://github.com/fadymondy/mark-it-down/issues/328) · Source: `apps/chrome-extension/`

The Chrome extension brings the warehouse to the browser:

- **Quick capture** — the toolbar popup saves a note (title prefilled from the
  page, body from the selection) straight into your cloud warehouse, and lists
  your most recent notes.
- **Markdown viewer** — a standalone viewer page renders any `.md` URL (or a
  warehouse note) with the shared `packages/core` renderer and all 25 themes;
  a context-menu item opens `.md` links in it. Mermaid blocks render as plain
  code in v1 to keep the bundle small.
- **Options** — server URL + personal access token (minted at **Profile →
  Access tokens** on the web app), theme choice, connection test, and an update
  check against `/api/updates/chrome` (GitHub Releases fallback).
- **Auto-update** — the Chrome Web Store updates installed copies automatically;
  side-loaded copies get a toolbar badge when a newer release exists (checked
  daily via `chrome.alarms`).

## Build

```bash
cd apps/chrome-extension
npm install
npm run build       # bundles to dist/
npm run zip         # dist-zip/mark-it-down-chrome-v<version>.zip
```

Load `dist/` unpacked via `chrome://extensions` → *Developer mode* → *Load
unpacked*. The release workflow attaches the zip to every GitHub Release, which
is how the `/api/updates/chrome` feed resolves its download link.

## Auth model

The extension talks to the web app with a bearer personal access token — the
same `togo_pat_…` tokens the MCP connector uses. No cookies, no OAuth dance,
no `gh` CLI dependency (which a browser extension couldn't shell out to anyway).
Host permission for your server origin is requested at runtime when you save
the server URL in Options.
