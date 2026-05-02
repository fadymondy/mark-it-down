# Mark It Down — Mac App Store distribution

This guide explains how to ship Mark It Down's Electron desktop app to the **Mac App Store (MAS)** in addition to the existing Developer ID-signed `.dmg` channel. MAS is **opt-in**: regular tagged releases continue to ship only `.dmg` / `.zip` / Windows / Linux artifacts unless the MAS workflow is explicitly enabled.

> Before you start: this requires a paid **Apple Developer Program** membership ($99/year) **and** a separate enrollment for the **Mac App Store** distribution path. If you only have Developer ID signing set up (per [docs/desktop-mac-signing.md](desktop-mac-signing.md)), you'll need to add the App Store distribution profile + cert below.

## Why a separate target?

The existing notarized `.dmg` is for direct download via GitHub Releases and uses the `Developer ID Application` certificate with the entitlements at [`build/entitlements.mac.plist`](../build/entitlements.mac.plist). That bundle relies on JIT, unsigned executable memory, and library validation overrides — all of which are **rejected by App Store Review**.

The MAS target is therefore a **sibling** with its own cert + entitlements + bundle:

| Aspect | DMG / Developer ID | Mac App Store |
|---|---|---|
| Signing identity | `Developer ID Application` | `3rd Party Mac Developer Application` (binary) + `3rd Party Mac Developer Installer` (.pkg) |
| Sandbox | Off | **On** (mandatory) |
| Entitlements | [`build/entitlements.mac.plist`](../build/entitlements.mac.plist) | [`build/entitlements.mas.plist`](../build/entitlements.mas.plist) + [`build/entitlements.mas.inherit.plist`](../build/entitlements.mas.inherit.plist) |
| Provisioning profile | None | `build/embedded.provisionprofile` (Mac App Store distribution) |
| Output artifact | `.dmg` + `.zip` | `.pkg` |
| Distribution surface | GitHub Releases | App Store Connect → Mac App Store |
| Auto-update | `electron-updater` polls GitHub | Mac App Store handles it |
| Workflow file | [`.github/workflows/release.yml`](../.github/workflows/release.yml) | [`.github/workflows/release-mas.yml`](../.github/workflows/release-mas.yml) |

Both targets share the same source tree, the same `package.json#version`, and the same icon. They diverge only at electron-builder config time.

## One-time setup

### 1. Enroll in the App Store distribution path

In the [Apple Developer portal](https://developer.apple.com/account):

1. Confirm your team is enrolled in the Apple Developer Program (paid).
2. Under **Certificates, Identifiers & Profiles**:
   - Create a **Mac App ID** with bundle identifier `io.markitdown.app` (must match `package.json#build.appId`). Enable any capabilities you actually use; for Mark It Down nothing extra beyond default sandbox-friendly capabilities is needed.
   - Generate the two MAS certificates:
     - **Mac App Distribution** (signs the `.app` binary)
     - **Mac Installer Distribution** (signs the wrapping `.pkg`)
   - Generate a **Mac App Store** distribution provisioning profile bound to the `io.markitdown.app` App ID. Download it as `markitdown_mas.provisionprofile`.

### 2. Export both certs into a single `.p12`

In **Keychain Access** on a Mac with the certs imported:

1. Select both `3rd Party Mac Developer Application: ...` and `3rd Party Mac Developer Installer: ...` items in **My Certificates** (cmd-click).
2. Right-click → **Export 2 items…** → save as `markitdown-mas-signing.p12`.
3. Set a strong password — that becomes the `MAS_CERTS_PASSWORD` secret.
4. Base64-encode for CI:

   ```bash
   base64 -i markitdown-mas-signing.p12 | pbcopy
   ```

   The clipboard contents are `MAS_CERTS`.

### 3. Base64 the provisioning profile

```bash
base64 -i markitdown_mas.provisionprofile | pbcopy
```

The clipboard contents are `MAS_PROVISIONING_PROFILE`.

### 4. Create the App Store Connect record

1. Go to [App Store Connect](https://appstoreconnect.apple.com) → **My Apps → +**.
2. **Platform**: macOS. **Bundle ID**: pick the App ID you registered. **SKU**: anything unique (e.g. `mark-it-down-macos`).
3. Fill in the metadata (description, screenshots, support URL, privacy policy URL). The privacy policy URL is required because Mark It Down talks to the network (auto-update poller, gh CLI device-flow, MCP).

Even before binaries are uploaded, the App Store Connect record needs to exist for the upload step to land somewhere.

### 5. Add CI secrets + variables

Repo → **Settings → Secrets and variables → Actions**.

| Secret | Source |
|---|---|
| `MAS_CERTS` | base64 of step 2 |
| `MAS_CERTS_PASSWORD` | the .p12 password from step 2 |
| `MAS_PROVISIONING_PROFILE` | base64 of step 3 |
| `APPLE_ID` | the Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from [appleid.apple.com](https://appleid.apple.com) |
| `APPLE_TEAM_ID` | 10-char team ID |

> The last three secrets are **the same values** the regular Developer ID release workflow uses — share them; don't duplicate.

Then under **Variables → Actions**:

| Variable | Value | Effect |
|---|---|---|
| `MAS_ENABLED` | `1` | Enables the MAS workflow on every `v*.*.*` tag push |
| `MAS_AUTO_SUBMIT` | `1` (optional) | Also runs `xcrun altool --upload-app` after the build |

If `MAS_ENABLED` is unset, the MAS workflow's `mas` job is skipped — tagged releases continue to ship only the existing `.dmg` channel. That's the default and recommended state until your App Store Connect listing is fully reviewed and ready.

## Local pkg build (smoke test before the first submission)

```bash
npm ci
npm run compile && npm run compile:electron

# Drop the provisioning profile in the build dir so electron-builder embeds it.
cp ~/Downloads/markitdown_mas.provisionprofile build/embedded.provisionprofile

# CSC_LINK can be either a path to the .p12 or a base64 blob; here we use the file.
CSC_LINK=~/Downloads/markitdown-mas-signing.p12 \
CSC_KEY_PASSWORD='<the p12 password>' \
APPLE_TEAM_ID='ABCD123456' \
npx electron-builder --mac mas --publish never
```

The output lands in `dist/electron/` as `Mark It Down-<version>.pkg`. Smoke-test:

```bash
# Validate signing
codesign -dv --verbose=4 "dist/electron/mas/Mark It Down.app"

# Inspect entitlements actually applied
codesign -d --entitlements - "dist/electron/mas/Mark It Down.app"
```

Then upload the `.pkg` manually for the first submission so you can verify everything end-to-end before automating:

```bash
xcrun altool --upload-app --type osx \
  --file "dist/electron/Mark It Down-0.X.Y-mas.pkg" \
  --username "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --asc-provider "$APPLE_TEAM_ID"
```

`altool` is deprecated in favour of `notarytool` for notarization, but for App Store Connect uploads it's still the simplest one-shot. The Apple-recommended modern path is **Transporter.app** (GUI) or `iTMSTransporter` (CLI shim). Pick whichever fits your workflow — they all hit the same endpoint.

After the upload finishes, the binary appears in App Store Connect → your app → TestFlight or Mac App Store tab. From there you submit it for review through the App Store Connect UI.

## CI flow

Once `MAS_ENABLED=1` is set and all secrets are in place, every `v*.*.*` tag push runs **two independent workflows**:

1. **`Release`** ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) — the existing matrix that produces the `.dmg`, `.zip`, `.exe`, AppImage, `.deb`, `.vsix`, and the GitHub Release record.
2. **`Release (Mac App Store)`** ([`.github/workflows/release-mas.yml`](../.github/workflows/release-mas.yml)) — runs **only on macOS**, builds the sandboxed `.pkg`, uploads it as a workflow artifact, and (when `MAS_AUTO_SUBMIT=1`) pushes it to App Store Connect.

The two workflows do not share state. A failure in the MAS workflow does not affect the public DMG release.

The `.pkg` is intentionally **not attached to the GitHub Release**: MAS-signed pkgs only validate against the App Store and are unhelpful to GitHub-Release downloaders, who would just see a non-functional installer.

You can also run the MAS workflow manually via **Actions → Release (Mac App Store) → Run workflow → mas_enabled=true** for a tag that's already shipped, e.g. when you've fixed an MAS-only review-rejection issue without needing a new tag.

## Submitting for review

After CI uploads the binary (or you do it manually):

1. App Store Connect → **My Apps → Mark It Down → macOS → Prepare for Submission**.
2. Pick the build that just arrived from your upload step.
3. Fill in **What to Test** / **Notes for Review** if any reviewer-facing info is needed (e.g. demo account credentials — Mark It Down doesn't need any).
4. Click **Submit for Review**. Apple typically responds within 24–48h. First-time submissions tend to get extra scrutiny on:
   - Privacy disclosures (the fact that you ping `api.github.com` for release polling, and `gh` for device-flow auth).
   - Sandbox compliance — make sure you've actually run a sandboxed build locally and confirmed the file open / save flows still work.

## Updates

Mac App Store distribution opts you out of `electron-updater`. The auto-update plumbing in `electron-updater` is incompatible with sandboxed apps — Apple disallows the differential-update mechanism it relies on.

Users on the App Store version receive updates through the standard **App Store → Updates** flow, exactly like any other Mac App Store app. The `electron-updater` polling code does still run inside the bundle (because the same source tree builds both targets), but it harmlessly fails to apply updates and the App Store updater takes over. If you want to fully suppress the in-app update banner for MAS builds, gate it on `process.mas` (set by Electron when running from the App Store) and skip the update check.

## Maintenance

- **Cert rotation.** Both MAS certs are valid for ~5 years. When either approaches expiry, regenerate them in Apple Developer, repeat steps 2 + 5 (`MAS_CERTS` + `MAS_CERTS_PASSWORD`).
- **Profile rotation.** The provisioning profile is valid for 1 year; refresh in Apple Developer and update `MAS_PROVISIONING_PROFILE` annually.
- **Reverting to DMG-only.** Set the repo variable `MAS_ENABLED` to anything other than `1` (or delete it). The MAS workflow will skip its job on the next tag and the regular Developer ID release continues uninterrupted.

## Files of interest

- [`build/entitlements.mas.plist`](../build/entitlements.mas.plist) — sandboxed parent-process entitlements (no JIT, no library-validation override).
- [`build/entitlements.mas.inherit.plist`](../build/entitlements.mas.inherit.plist) — child-process inherit-only entitlements.
- [`package.json#build.mas`](../package.json) — MAS-only electron-builder block (sibling to `build.mac`, which keeps targeting DMG / ZIP for Developer ID releases).
- [`.github/workflows/release-mas.yml`](../.github/workflows/release-mas.yml) — the opt-in MAS workflow.
- [`docs/desktop-mac-signing.md`](desktop-mac-signing.md) — sister guide for the Developer ID / DMG signing path.
- [`docs/releasing.md`](releasing.md) — overall release runbook.
