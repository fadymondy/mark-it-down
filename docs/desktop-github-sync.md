# GitHub repo connection

A workspace folder can be connected to a GitHub repository so notes commit + push from inside the app. v1 uses the local `gh` CLI for auth and `git` for the actual sync — no embedded device-flow OAuth or keychain storage yet (tracked as a follow-up).

## Sidebar repo bar

A status row at the bottom of the sidebar:

| State | Display |
| --- | --- |
| No git in workspace | `No repo connected` + GitHub icon to connect |
| Git initialized, no remote | `No remote` + connect icon |
| Connected | `<owner/name> · <branch> ↑N ↓N ±N` + sync icon |

`↑N` = ahead of upstream, `↓N` = behind, `±N` = uncommitted dirty paths.

## Connect

Click the GitHub icon → free-text prompt for `owner/name`. The flow:

1. Calls `mid:gh-auth-status` (`gh auth status`) — if `gh` isn't logged in, surfaces a confirm with the message and a tip to run `gh auth login`.
2. `git init -b main` if the workspace has no `.git`.
3. Adds `https://github.com/<owner>/<name>.git` as `origin` (set-url if present, add otherwise).
4. If no `HEAD` yet, makes an initial `git add -A && git commit -m "Initial commit from Mark It Down"` (skipped if the index is empty).

The remote URL uses HTTPS — credentials are pulled from `gh`'s credential helper at push time. If the user has SSH set up they can swap the URL manually with `git remote set-url`; the app doesn't currently rewrite SSH↔HTTPS.

## Sync

Click the refresh icon → optional commit-message prompt. The flow:

1. `git status --porcelain` — if dirty, `git add -A` + `git commit -m "<msg or auto>"`.
2. `git pull --rebase --autostash` — fast-forward / rebase any upstream changes.
3. `git push` — publish.

Each step is reported as a chip in the title-bar status flash (`Synced — staged changes, committed, pulled, pushed`). On failure, the first error line is surfaced to the user; partial state stays — sync is recoverable from the terminal.

## IPC surface

| Channel | Returns |
| --- | --- |
| `mid:gh-auth-status` | `{ authenticated, output }` from `gh auth status`. |
| `mid:repo-status` | `{ initialized, branch, ahead, behind, dirty, remote }` parsed from `git status --porcelain=v2 --branch`. |
| `mid:repo-connect(workspace, slug)` | Initializes git, sets origin, writes initial commit. |
| `mid:repo-sync(workspace, message)` | Add → commit → pull → push, with per-step result. |

## Out of scope (follow-up)

- **Device-flow OAuth + keytar fallback** — when `gh` isn't installed, run the GitHub OAuth device flow inside the app and store the token in the OS keychain via `keytar`. Requires registering an OAuth app and a keytar dependency; deferred.
- **Conflict UI** — `pull --rebase` may produce conflicts; the app currently surfaces the error string and leaves the user in a half-rebase state to resolve in their editor / terminal. A proper conflict resolver UI is a separate feature.
- **Auto-commit-on-save toggle** — the issue body proposed it; v1 chose explicit Sync to keep behavior predictable.
- **Repo picker autocomplete from `gh repo list`** — v1 uses a free-text prompt. A picker that lists the user's repos is a UX win; defer.

## Files

- `apps/electron/main.ts` — `runGit`, `mid:gh-auth-status`, `mid:repo-status`, `mid:repo-connect`, `mid:repo-sync`. Uses Node's `execFile` (promisified) — no extra dependencies.
- `apps/electron/preload.ts` — bridges (`ghAuthStatus`, `repoStatus`, `repoConnect`, `repoSync`).
- `apps/electron/renderer/index.html` — `<footer class="mid-repo-bar">` in the sidebar.
- `apps/electron/renderer/renderer.ts` — `refreshRepoStatus`, `parseSlugFromUrl`, `promptConnectRepo`, `syncRepo`.
- `apps/electron/renderer/renderer.css` — `.mid-repo-bar`, `.mid-repo-status`.

## Verifying

1. `gh auth status` — confirm you're logged in (else `gh auth login`).
2. `npm run dev:electron`, open this repo as a folder.
3. Sidebar footer reads `fadymondy/mark-it-down · main ↑0 ↓0`.
4. Edit a markdown file in the editor, save → footer flips to `±1`.
5. Click the sync icon → leave the message blank → rapid status chips → footer back to `±0`.
6. Connect a fresh empty folder via the GitHub icon → `owner/new-repo-name`. Repo bar updates with the new slug and branch.
