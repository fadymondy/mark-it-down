# macOS code signing & notarization

The macOS Electron build is signed with an Apple Developer ID and notarized via Apple's notary service so it installs without "unidentified developer" warnings and so `electron-updater` can apply over-the-air updates. All credentials live in GitHub Actions repository secrets — never committed.

## TL;DR

1. Apple Developer membership ($99/year).
2. Export a `Developer ID Application` cert as a `.p12`.
3. Generate an app-specific password at appleid.apple.com.
4. Drop 5 secrets into the repo's Actions secrets.
5. Push a `v*` tag → release workflow signs + notarizes automatically.

## Required GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions** → *New repository secret*:

| Secret name | What it is |
|---|---|
| `MAC_CERTS` | Base64 of the `.p12` exported from Keychain Access (Developer ID Application cert + private key). The release workflow exposes it as `CSC_LINK` to electron-builder. |
| `MAC_CERTS_PASSWORD` | Password you set when exporting the `.p12`. Exposed as `CSC_KEY_PASSWORD`. |
| `APPLE_ID` | Apple ID email used for the developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from [appleid.apple.com → Sign-In and Security](https://appleid.apple.com). |
| `APPLE_TEAM_ID` | 10-char team id (visible in Xcode → Settings → Accounts, or [developer.apple.com/account](https://developer.apple.com/account)). |

When all five are set, the release workflow's `electron` matrix job exports them to env on the macOS runner before `npx electron-builder --publish always` runs. electron-builder picks them up automatically — no further config in `package.json`.

## What the build config does

`package.json#build.mac`:

```json
"hardenedRuntime": true,
"gatekeeperAssess": false,
"entitlements": "build/entitlements.mac.plist",
"entitlementsInherit": "build/entitlements.mac.plist"
```

- **`hardenedRuntime`** is required for notarization. Without it, the notary service rejects the upload.
- **`gatekeeperAssess: false`** skips an `spctl assess` step that sometimes reports false positives during the post-sign verify pass on the runner.
- **Entitlements** point at [`build/entitlements.mac.plist`](../build/entitlements.mac.plist), which lists the minimum capabilities the hardened-runtime app needs:
  - `com.apple.security.cs.allow-jit` — Electron's V8.
  - `com.apple.security.cs.allow-unsigned-executable-memory` + `…allow-unsafe-dyld-environment-variables` — Electron's libffmpeg + native loaders.
  - `com.apple.security.cs.disable-library-validation` — `better-sqlite3`'s unsigned native `.node` binary.
  - `com.apple.security.network.client` — outbound network for auto-update / GitHub / MCP.
  - `com.apple.security.files.user-selected.read-write` — the file picker.

Don't add entitlements you don't need — every extra capability widens the attack surface and makes future App Store review harder.

## First-time setup

The full step-by-step (export the cert, generate the app password, find your team id, drop the secrets in) lives in [docs/releasing.md → "Setting up macOS code signing"](releasing.md#setting-up-macos-code-signing). That section was written when the auto-update plumbing was first added and is the canonical runbook.

## Verifying

After the next tagged release:

1. Download the new `.dmg` from the GitHub Release page.
2. Open it on a Mac that's never had Mark It Down installed.
3. First-launch dialog should say *"Mark It Down is from an identified developer"* (NOT *"unidentified developer"*).
4. Run `codesign --display --verbose=4 /Applications/Mark\ It\ Down.app` — output should show your team id and `Authority=Developer ID Application: …`.
5. Run `spctl --assess --verbose --type install /Applications/Mark\ It\ Down.app` — should print `accepted source=Notarized Developer ID`.

## Skipping signing (when secrets are absent)

The workflow's env block names every secret unconditionally. If a secret is missing, GitHub Actions sets the env var to an empty string. electron-builder's behavior in that case:

- No `CSC_LINK` → skip signing entirely. Build succeeds, produces an unsigned DMG that installs on first download but cannot be auto-updated by `electron-updater`.
- `CSC_LINK` set but no `APPLE_ID` → sign but skip notarization. Installs without the Gatekeeper warning only on the same Mac that built it.
- All five set → sign + notarize. Distributable, auto-updatable.

## Cert rotation

Developer ID Application certs are valid for ~5 years. Before expiry: re-export the cert, base64 it, replace `MAC_CERTS` and `MAC_CERTS_PASSWORD` in repo secrets. Apple ID + team id don't change.

## Files of interest

- [`build/entitlements.mac.plist`](../build/entitlements.mac.plist) — the hardened-runtime allow-list.
- [`package.json#build.mac`](../package.json) — signing config.
- [`.github/workflows/release.yml`](../.github/workflows/release.yml) — env block that maps secrets into electron-builder.
- [`docs/releasing.md`](releasing.md) — full runbook including macOS signing setup.
- [`docs/desktop-auto-update.md`](desktop-auto-update.md) — how the running app receives updates.
