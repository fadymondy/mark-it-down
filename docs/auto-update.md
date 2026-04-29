# Auto-Update

Status: shipped in Phase 0.14 · Issue: [#28](https://github.com/fadymondy/mark-it-down/issues/28)

Both shipping surfaces — the VSCode extension and the standalone Electron app — now stay current via GitHub Releases. One source of truth, no extra hosting.

## At a glance

| Surface | Channel | What runs |
|---|---|---|
| **VSCode extension (Marketplace)** | `vscode.marketplace` | VSCode's native auto-update — silent, on by default |
| **VSCode extension (.vsix)** | `GET /repos/fadymondy/mark-it-down/releases/latest` | In-extension poller checks once per launch + every 6h; surfaces a notification with `Open Release` / `View Changes` actions |
| **Electron app** | `electron-updater` (GitHub provider) | App checks on launch, downloads in background, prompts user to install on next quit (or restart now) |

## VSCode side

Two paths users can be on:

### Marketplace install

The extension is published to the VSCode Marketplace as `fadymondy.mark-it-down`. VSCode polls the Marketplace and pulls updates automatically — nothing extension-side to do. Whatever VSCode's update settings say is what happens.

### Self-installed `.vsix`

For users who downloaded the `.vsix` from a GitHub Release (or sideloaded from a build), there's no Marketplace channel. The extension polls GitHub itself:

```
on activate
  → if markItDown.updates.checkOnLaunch (default true)
    → fetch GET https://api.github.com/repos/fadymondy/mark-it-down/releases/latest
    → if release.tag_name > package.json#version
      → notification: "v0.X.Y is available — Open Release / View Changes / Later"
    → schedule re-check every 6h while VSCode runs
```

Behavior notes:

- **Never auto-installs.** Pulling executable code from a remote without a user gesture is a security smell. The notification is the action.
- **Doesn't re-notify** for the same version unless the user clicks `Later` then quits + relaunches. Tracked via `globalState[markItDown.updates.lastSeenVersion]`.
- **`View Changes`** opens an untitled markdown buffer with the release body so the user can read offline / save / share.
- **Manual check**: `Mark It Down: Check for Updates` from the command palette runs the same check on demand and surfaces "you're on the latest" if there's nothing new (the auto-poll stays silent in that case).
- **What's New on first launch after update**: when the installed version differs from `globalState[markItDown.updates.installedVersion]`, the extension shows a one-time "Mark It Down updated to v0.X.Y" toast with a `View What's New` action that opens the GitHub release page. First-ever install is silent (no `last` value to compare against).

Settings:

| Setting | Default | What it does |
|---|---|---|
| `markItDown.updates.checkOnLaunch` | `true` | Poll GitHub on launch + every 6h. Set to `false` to disable; `Check for Updates` command still works manually. |

## Electron side

Wired via `electron-updater` (the official update channel for `electron-builder`). The `package.json#build.publish` block:

```jsonc
{
  "publish": [
    {
      "provider": "github",
      "owner": "fadymondy",
      "repo": "mark-it-down",
      "releaseType": "release"
    }
  ]
}
```

`electron-builder` writes a `latest-mac.yml` / `latest.yml` / `latest-linux.yml` next to each installer at release time, and `electron-updater` fetches whichever matches the running platform.

### Lifecycle in the Electron app

```
app launches
  → if production build (NOT MID_DEV)
    → autoUpdater.checkForUpdatesAndNotify()
      → on 'update-available':   download begins; dialog: "Update available v0.X.Y — downloading"
      → on 'update-downloaded':  dialog: "Update v0.X.Y ready — Install on next launch | Restart and install now"
      → on 'error':              warn to stderr; no user dialog (stays out of the way)
```

User chooses on the post-download dialog:

- **Restart and install now** — `quitAndInstall(true, true)` runs the installer immediately
- **Install on next launch** — `autoInstallOnAppQuit = true` is set, the install runs the next time the user quits

Settings (defaults):

- `autoDownload = true` — downloads happen in the background, no consent dialog before the bytes start
- `autoInstallOnAppQuit = false` — explicit user opt-in required for silent installs (this is the conservative choice)

A `Help → Check for Updates…` menu item lets users force a check and surfaces "You're on the latest" if nothing's available.

### Code signing

For macOS auto-updates to work, the DMG **must be signed AND notarized**. An unsigned DMG installs fine on first download, but `electron-updater` refuses to apply updates to it (Apple's Gatekeeper rejects the differential update). Wire credentials into `.github/workflows/release.yml` via these env vars:

```yaml
env:
  CSC_LINK: ${{ secrets.MAC_CERTS }}
  CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTS_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

Without those, builds still succeed and Linux/Windows updates work fine. macOS users on unsigned builds will see "you're on the latest" indefinitely from `electron-updater`'s perspective.

## Release flow (shared)

A push of a tag matching `v*.*.*` triggers `.github/workflows/release.yml`:

```
v0.2.0 git push --tags
   ↓
electron job (mac/win/linux matrix) → electron-builder --publish always
   - builds installers + latest-*.yml metadata
   - uploads to the GitHub release for that tag
vscode job (single ubuntu) → vsce package
   - builds .vsix, attaches to the release
   - if VSCE_PAT secret is set: vsce publish to the Marketplace
release-notes job
   - extracts the matching ## [X.Y.Z] section from CHANGELOG.md
   - sets it as the release body
```

So one tag push produces:

- `Mark.It.Down-0.2.0-arm64.dmg`, `Mark.It.Down-0.2.0-x64.dmg` (macOS)
- `Mark.It.Down.Setup.0.2.0.exe` (Windows)
- `Mark.It.Down-0.2.0.AppImage`, `mark-it-down_0.2.0_amd64.deb` (Linux)
- `latest-mac.yml`, `latest.yml`, `latest-linux.yml` (electron-updater metadata)
- `mark-it-down-0.2.0.vsix` (the VSCode extension)
- A release body sourced verbatim from `CHANGELOG.md`'s `## [0.2.0]` section

See [docs/releasing.md](releasing.md) for the manual checklist that wraps a release.

## Edge cases

- **Pre-release tags** (e.g. `v0.3.0-rc.1`) — the GitHub `releases/latest` endpoint skips releases marked `prerelease: true`, so the in-extension poller won't notify on them. `electron-updater` honors the same default. To roll a pre-release channel, mark the GitHub release as "Pre-release"; users opted in via `autoUpdater.channel = 'beta'` (not wired in v0.14) would receive it.
- **Network failures** — both checkers swallow errors silently. The user only sees a failure when they manually invoked `Check for Updates`.
- **Rate limiting** — unauthenticated GitHub API calls cap at 60/hour per IP. The 6-hour poll interval keeps us well under that even with multiple VSCode windows open.
- **Same version, different build** — semver comparison is exact (`0.1.0 == 0.1.0` → no notification). If you re-tag the same version, users won't be re-pinged — bump the patch number.
- **Extension installed to extra-mode VSCode forks** (Cursor, Code-OSS, etc.) — they don't all hit the Marketplace, so the in-extension poller is the active path there too.

## Files of interest

- [src/updates/updateChecker.ts](../src/updates/updateChecker.ts) — VSCode-side `UpdateChecker` (poll + notify + What's New)
- [src/extension.ts](../src/extension.ts) — wires `UpdateChecker` + `markItDown.updates.checkNow` command on activation
- [apps/electron/main.ts](../apps/electron/main.ts) — `setupAutoUpdate` wiring `electron-updater` event handlers + `Check for Updates…` menu item
- [.github/workflows/release.yml](../.github/workflows/release.yml) — tag-push release pipeline (matrix electron build + vsce package + release notes from CHANGELOG)
- [docs/releasing.md](releasing.md) — release runbook
- [package.json](../package.json) — `build.publish` block (electron-updater) + `markItDown.updates.checkOnLaunch` setting + `markItDown.updates.checkNow` command
