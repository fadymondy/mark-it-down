# Desktop auto-update (Electron, GitHub Releases)

The Electron app keeps itself current by polling GitHub Releases on launch and applying updates automatically when the user opts in.

## How it works

1. **You tag a new version** (e.g. `git tag v0.4.0 && git push origin v0.4.0`).
2. **`.github/workflows/release.yml`** runs on tag push. The `electron` matrix job runs on macos-latest / windows-latest / ubuntu-latest, each calling `npx electron-builder --publish always`.
3. **electron-builder uploads** the per-OS installer + a manifest file to the GitHub Release for that tag:
   - macOS: `Mark It Down-X.Y.Z-arm64.dmg`, `…-x64.dmg`, `…-arm64-mac.zip`, `…-x64-mac.zip`, `latest-mac.yml`, `…blockmap`
   - Windows: `Mark It Down Setup X.Y.Z.exe`, `latest.yml`
   - Linux: `Mark It Down-X.Y.Z.AppImage`, `mark-it-down_X.Y.Z_amd64.deb`, `latest-linux.yml`
4. **Running clients** (`apps/electron/main.ts → setupAutoUpdate()`) fire `autoUpdater.checkForUpdatesAndNotify()` on launch. electron-updater fetches `latest-mac.yml` / `latest.yml` / `latest-linux.yml`, compares the version, downloads the matching artifact in the background.
5. **The user is prompted twice**:
   - When the new version is detected → an info dialog ("Downloading in the background…").
   - When the download finishes → a choice dialog: *Install on next launch* or *Restart and install now*.

## What ships in the bundle

The `publish` block in `package.json#build` is wired to GitHub:

```json
"publish": [{
  "provider": "github",
  "owner": "fadymondy",
  "repo": "mark-it-down",
  "releaseType": "release"
}]
```

`electron-updater` reads the same block at runtime to know where to look. No separate URL or feed config.

## Channels

`process.env.MID_CHANNEL` (or the matching VSCode setting) drives the channel:

| `MID_CHANNEL` | Behavior |
|---|---|
| unset / `latest` | Stable channel — only non-prerelease tags are offered |
| `beta` | Pre-release tags (e.g. `v0.4.0-rc.1`) are also offered |

The release workflow's `release-notes` step automatically marks any tag with a hyphen (`v0.4.0-rc.1`) as a GitHub pre-release, so the stable channel skips it.

## What doesn't auto-update

- **Dev builds** (`MID_DEV=1` or non-packaged) skip the entire flow — `setupAutoUpdate()` returns early with a console log.
- **Unsigned macOS builds** can install fresh but can't apply updates — Apple Gatekeeper rejects the differential update on unsigned apps. See [docs/desktop-mac-signing.md](desktop-mac-signing.md) to wire signing.

## Failure modes

| Symptom in console | Cause | Fix |
|---|---|---|
| `checkForUpdatesAndNotify failed: Cannot find latest-mac.yml` | The release was published before the manifest was uploaded, OR the OS didn't run `electron-builder` for this tag | Re-run the failed CI job |
| `code signature verification failed` on macOS update | Update was signed with a different identity than the running app | Don't rotate Developer ID mid-version. If you must, ship a fresh DMG and have users reinstall |
| Auto-update dialog never appears | `setupAutoUpdate()` early-returns in dev (intentional). In packaged builds, check the GitHub Release exists and isn't marked prerelease | Confirm the release page shows the assets |

## Manual check

In the running app: **Help → Check for Updates** triggers `autoUpdater.checkForUpdates()` directly without waiting for the launch poll.

## Where to look in the code

- `apps/electron/main.ts` — `setupAutoUpdate()` (event wiring), `broadcastUpdateState()` (sync to renderer for the status bar), the `Help → Check for Updates` menu item.
- `package.json#build.publish` — the GitHub provider config.
- `.github/workflows/release.yml` — the CI pipeline that builds + uploads.
- `docs/auto-update.md` — covers the full picture across both surfaces (extension + desktop) including channel detection.
- `docs/releasing.md` — runbook for cutting a release.
