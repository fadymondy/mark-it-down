# Releasing Mark It Down

The release runbook for shipping a new version. One tag push triggers parallel builds for the Electron app (mac/win/linux) and the VSCode extension (`.vsix` + Marketplace), plus pulls the release notes verbatim from CHANGELOG.md.

## When to release

- A meaningful set of features or fixes has landed on `main` since the last tag
- All in-flight feature branches are merged or explicitly excluded from this version
- CHANGELOG.md has a complete `## [Unreleased]` section ready to be promoted

## Pre-flight checklist

- [ ] All v0.X feature branches are merged to `main`
- [ ] Local `main` is up to date with `origin/main` and clean (`git status` clean)
- [ ] `npm run compile && npm run compile:electron` is green
- [ ] You're on macOS (the release workflow's mac runner does the actual signing — but a local sanity launch is good)
- [ ] If shipping the VSCode extension to the Marketplace, confirm `VSCE_PAT` secret is set on the repo. If shipping signed macOS Electron builds, confirm `MAC_CERTS` / `APPLE_*` secrets are set.

## Steps

### 1. Decide the version number

Use [SemVer](https://semver.org). For Mark It Down's pre-1.0 cycle:

- **Patch** (`0.1.0` → `0.1.1`) — bug fixes, doc-only changes, minor UX polish
- **Minor** (`0.1.x` → `0.2.0`) — new features, additive settings, additive commands
- **Major** (`0.x` → `1.0.0`) — when v1.0 is fully ready, breaking changes

### 2. Update `package.json` version

```bash
npm version <patch|minor|major> --no-git-tag-version
```

This bumps `package.json#version` without committing or tagging — we'll do that manually after the CHANGELOG update.

### 3. Promote `[Unreleased]` in CHANGELOG.md

Open `CHANGELOG.md`. Replace `## [Unreleased]` with `## [X.Y.Z] — YYYY-MM-DD`. Re-add a fresh `## [Unreleased]` block at the top so the next round of work has somewhere to live.

```markdown
# Changelog

## [Unreleased]

## [0.2.0] — 2026-05-15

### Added — Phase 0.14: Auto-update for both surfaces (#28)
…
```

The release-notes job in CI extracts the `## [X.Y.Z]` section by exact match and uses it as the GitHub Release body — make sure the section header is well-formed.

### 4. Commit

```bash
git checkout -b chore/release-vX.Y.Z
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"
git push -u origin chore/release-vX.Y.Z
gh pr create --title "chore(release): vX.Y.Z" --body "Release prep for vX.Y.Z. CHANGELOG promoted; version bumped."
```

Open the PR, wait for CI, merge to `main`. The release tag is **not** created on the PR branch — it goes on `main` after merge.

### 5. Tag and push

After the release-prep PR merges:

```bash
git checkout main
git pull origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

The tag push fires `.github/workflows/release.yml`. From here CI does the work.

### 6. CI does its thing

Three parallel jobs:

| Job | Where | What |
|---|---|---|
| `electron` | matrix: macos-latest / windows-latest / ubuntu-latest | `npm ci` → `npm run compile && npm run compile:electron` → `npx electron-builder --publish always`. Each runner builds + uploads its installers + the `latest-*.yml` metadata file to the new GitHub release. |
| `vscode` | ubuntu-latest | `npm ci` → `npm run compile` → `npx vsce package --no-dependencies` → `gh release upload` the `.vsix`. If `VSCE_PAT` secret is set: also `npx vsce publish --packagePath *.vsix` to the Marketplace. |
| `release-notes` | ubuntu-latest, depends on the two above | Extracts the matching `## [X.Y.Z]` section from CHANGELOG.md → `gh release edit --notes "$NOTES"`. |

Watch in the Actions tab of the repo. All three should go green.

### 7. Verify the release

After CI completes:

- [ ] [GitHub Releases](https://github.com/fadymondy/mark-it-down/releases/latest) page shows v0.X.Y with all expected assets
- [ ] The release body matches the `## [0.X.Y]` section from CHANGELOG.md
- [ ] All three `latest-*.yml` files are attached (mac, win, linux) — these are what `electron-updater` reads
- [ ] The `.vsix` is attached and the file size looks reasonable
- [ ] If Marketplace publish ran: the [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=fadymondy.mark-it-down) shows the new version

### 8. Smoke-test the update on at least one client

- **VSCode**: download the previous `.vsix` from a prior release, install it, then in that VSCode window open the command palette → `Mark It Down: Check for Updates`. You should get the "v0.X.Y is available" notification.
- **Electron app on macOS**: install the previous `.dmg` from a prior release, launch it. Within seconds it should auto-check, see the new release, and offer to download.

If either smoke test fails, open an issue immediately and consider yanking the release.

### 9. Announce

Drop a note wherever the user community lives — the README's "Status" section, a Discussion, a tweet, etc. Link the GitHub release.

## Rollback

If a released version is broken:

1. **Mark the GitHub release as Pre-release** in the release UI — the in-extension poller and `electron-updater` will both stop offering it.
2. Bump the version (e.g. `0.2.0` → `0.2.1`), fix the bug on a hotfix branch, repeat the release flow. Don't rewrite or delete the bad tag — semver says versions are immutable.
3. Note the broken version in the CHANGELOG of the new release: "Fixes a regression in v0.2.0 that caused X."

## Setting up macOS code signing

Required for Electron auto-update to work on macOS. Without these, the release workflow still produces a `.dmg` that installs fine on first download, but `electron-updater` can't apply updates to it (Apple Gatekeeper rejects the differential update on unsigned apps). Linux + Windows updates work without any of this.

You'll need:

- An **Apple Developer Program** membership ($99/year)
- A Mac with Xcode installed (to export the cert; the actual signing happens on the GitHub macOS runner)
- ~30 minutes for the first-time setup

### 1. Create a Developer ID Application certificate

In Xcode:

1. **Settings → Accounts** → sign in with your Apple ID
2. Pick your team → **Manage Certificates…**
3. Click `+` → **Developer ID Application** (NOT "Apple Development" — that one is for development builds only)
4. The cert appears in your Mac's Keychain Access under **My Certificates**

### 2. Export the cert as a `.p12`

In Keychain Access:

1. Find the new "Developer ID Application: Your Name (TEAMID)" entry under **My Certificates**
2. Right-click → **Export** → save as `mark-it-down-signing.p12` somewhere temporary
3. **Set a strong password** when prompted — this becomes `MAC_CERTS_PASSWORD`

### 3. Base64-encode the `.p12`

```bash
base64 -i mark-it-down-signing.p12 | pbcopy
```

The encoded blob is now in your clipboard — that's `MAC_CERTS`.

### 4. Generate an app-specific password for notarization

At [appleid.apple.com](https://appleid.apple.com):

1. **Sign-In and Security** → **App-Specific Passwords**
2. Generate one for "Mark It Down releases"
3. Copy the value — that's `APPLE_APP_SPECIFIC_PASSWORD`

### 5. Find your Apple Team ID

In the Xcode Accounts pane (or at [developer.apple.com](https://developer.apple.com/account)), grab the 10-character `TEAMID` (e.g. `ABCD123456`). That's `APPLE_TEAM_ID`.

### 6. Add all 5 secrets to the repo

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Value |
|---|---|
| `MAC_CERTS` | The base64 blob from step 3 |
| `MAC_CERTS_PASSWORD` | The .p12 password from step 2 |
| `APPLE_ID` | The Apple ID email you signed in with |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from step 4 |
| `APPLE_TEAM_ID` | The 10-char team id from step 5 |

### 7. Verify on the next release

Cut a `v0.X.Y` tag. The `release.yml` `electron` job's macOS runner picks up the secrets via the env block, signs the DMG, and notarizes it. Smoke-test:

1. Download the new DMG from the release
2. Open it on a fresh Mac (or one that's never had Mark It Down installed)
3. The first-launch dialog should say "Mark It Down is from an identified developer" — NOT "from an unidentified developer"
4. From a previous version, the auto-updater should successfully prompt + install the new one

### Cert rotation

Developer ID Application certs are valid for ~5 years. Repeat steps 1–3 + 6 (`MAC_CERTS` + `MAC_CERTS_PASSWORD`) before the cert expires. The Apple ID + team ID don't change.

### When you're not ready yet

Leave the secrets unset. The workflow's env block still references them, but electron-builder gracefully degrades — the build still succeeds, just produces an unsigned DMG. The release won't crash.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `electron-builder` fails on macOS with "ELECTRON_BUILDER_YML_PATH" | electron-builder can't find config | The config lives in `package.json#build` — should auto-detect; check working dir |
| `electron-builder` succeeds but uploads nothing | `--publish always` not passed OR `GH_TOKEN` env not set | The workflow sets both; verify |
| `vsce publish` fails with auth | `VSCE_PAT` secret missing or expired | Refresh the PAT at https://dev.azure.com/<your-org>/_usersSettings/tokens; update the repo secret |
| macOS DMG installs but won't auto-update | Unsigned / unnotarized build | Wire `CSC_LINK` + Apple credentials into the workflow env block |
| Release-notes job posts "See CHANGELOG.md for details" | The `## [X.Y.Z]` section header didn't match what awk expected | Check exact format: `## [0.2.0] — 2026-05-15` (em dash + space + date) |

## Files of interest

- [.github/workflows/release.yml](../.github/workflows/release.yml) — the release pipeline
- [package.json#build.publish](../package.json) — electron-updater provider config
- [docs/auto-update.md](auto-update.md) — what users see on the receiving end
- [CHANGELOG.md](../CHANGELOG.md) — source of release notes
