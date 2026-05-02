# Desktop · First-run warehouse onboarding

Status: shipped in v0.3.x · Issue: [#236](https://github.com/fadymondy/mark-it-down/issues/236) · Depends on: [#220 GitHub OAuth device-flow](https://github.com/fadymondy/mark-it-down/issues/220), [#228 gh CLI repo picker / create](https://github.com/fadymondy/mark-it-down/issues/228)

The first time you open a workspace folder in Mark It Down's desktop app, a guided modal walks you from a bare workspace to a working **notes warehouse** — a GitHub repo that hosts the markdown files behind your sidebar Notes — without ever leaving the app.

## At a glance

| | |
|---|---|
| **Where** | A modal dialog (`#mid-warehouse-onboarding`) that auto-opens after `applyFolder()` fires |
| **When** | First time a folder is opened that has **no** entry in `<workspace>/.mid/warehouse.json` AND has not been added to `AppState.warehouseOnboardingDismissed` |
| **What** | Three-step wizard: detect `gh` CLI → sign in (Terminal *or* device flow) → pick or create a repo |
| **Re-trigger** | Right-click the status-bar repo button → **Set up warehouse…** |
| **Skip** | The Skip button (and the close `x` and the Esc key) all dismiss the modal and remember your choice for that workspace |

## The flow

```
folder opened
     │
     ▼
warehouse.json has entries? ─── yes ──► (skip onboarding entirely)
     │ no
     ▼
workspace id in warehouseOnboardingDismissed? ─── yes ──► (skip — user can re-trigger)
     │ no
     ▼
┌──────────────────────────────────────────┐
│ Step 1 · GitHub CLI                       │
│   run mid:gh-auth-status                  │
│     ENOENT/"command not found" → install  │
│     present, not authed         → step 2  │
│     present + authed            → step 3  │
└──────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────┐
│ Step 2 · Sign in                          │
│   • copy `gh auth login` + Re-check       │
│   • or trigger runGhDeviceFlow()          │
└──────────────────────────────────────────┘
                │ (token acquired)
                ▼
┌──────────────────────────────────────────┐
│ Step 3 · Pick a repo                      │
│   • create new private repo               │
│       default name = <workspace>-notes    │
│   • or pick from gh repo list (filter)    │
└──────────────────────────────────────────┘
                │
                ▼
mid:warehouses-add → write <workspace>/.mid/warehouse.json
mid:repo-connect    → wire the local git remote (best-effort)
                │
                ▼
modal closes, status bar lights up
```

## Step 1 — Detect the `gh` CLI

The wizard runs the existing [`mid:gh-auth-status`](../apps/electron/main.ts) IPC, which shells out to `gh auth status`. The renderer (`isGhMissing()`) reads the captured output:

- `ENOENT`, `command not found`, `spawn gh`, or `not found` → the **gh missing** branch.
- Any other failure → the **not authed** branch (Step 2).
- Success → straight to Step 3.

The gh-missing branch shows install instructions and two buttons:

1. **Open install page** uses `mid:open-external` to open <https://cli.github.com/>. Homebrew, winget, apt, dnf and standalone installers are all listed there — Mark It Down doesn't try to install anything itself.
2. **Continue once installed** re-runs `gh auth status` and re-routes based on the new state. No app restart required.

There's also a tertiary **Use device flow instead** button that jumps straight to Step 2 with the device-flow option only — handy on locked-down systems where installing `gh` isn't possible.

## Step 2 — Sign in

Two paths are offered side-by-side:

### Terminal command

```sh
gh auth login
```

The command is shown in a copy-friendly chip (one-click clipboard). The user runs it in their terminal, finishes the browser dance, and clicks **Re-check** in the modal. We re-run `mid:gh-auth-status` and route forward.

### Device flow

The **Start device flow** button calls `runGhDeviceFlow()` — the same helper that powers `promptConnectRepo()`. That helper:

1. Calls `mid:gh-device-flow-start` (POST to `https://github.com/login/device/code`).
2. Copies the `user_code` to the clipboard.
3. Opens `https://github.com/login/device` via `mid:open-external`.
4. Polls `mid:gh-device-flow-poll` until a token comes back or 5 minutes elapse.

The token is persisted to `AppState.ghToken` by the device-flow handlers in main.ts; the onboarding wizard treats a successful device-flow as "now authenticated" and routes to Step 3.

## Step 3 — Pick a repo

The repo step calls `mid:gh-repo-list` (which runs `gh repo list --limit 200 --json …`) and presents:

- **Create a new private repo** card. The default name is derived from the workspace folder via `defaultRepoNameForWorkspace()`:
  - lowercase
  - whitespace + `_` → `-`
  - strip non-`[a-z0-9-]`
  - collapse repeated `-`
  - suffix with `-notes`
  
  e.g. `~/Sites/Mark It Down` becomes `mark-it-down-notes`. The user can edit it before submitting.

- **Existing repo** card with a search input and a list (capped at 100 visible matches at a time, but matched against the full set). Selecting a row enables the **Use this repo** primary action.

Whichever path is chosen, the wizard:

1. Calls `mid:warehouses-add` (new in #236) to upsert a record into `<workspace>/.mid/warehouse.json`.
2. Calls `mid:repo-connect` to wire the local git remote (best-effort — failure is logged, not fatal).
3. Refreshes the in-memory `warehouses[]` array so the Notes sidebar can immediately attach notes to the new warehouse.
4. Closes the modal and leaves the status-bar repo button reflecting the new connection.

The first warehouse persisted via `mid:warehouses-add` is *de facto* the active warehouse for the workspace until the user attaches notes elsewhere — the existing notes-sidebar code uses the first entry by default.

## Trigger conditions

Auto-show on folder open requires **all** of:

1. `currentFolder` is set (an actual folder path, not the welcome screen).
2. `mid:warehouses-list` returns an empty array for that folder.
3. The active workspace id is **not** present in `AppState.warehouseOnboardingDismissed`.

The workspace id is resolved from `workspaces[]` (the auto-registered list maintained by the workspace switcher). If the folder hasn't been registered yet, the path itself is used as a stable fallback so re-opens don't re-prompt.

## Skip + re-entry

- **Skip button**, the modal `x`, **Esc**, or clicking the dialog backdrop all dismiss the wizard and add the current workspace id to `AppState.warehouseOnboardingDismissed`. The setting is persisted via `mid:patch-app-state`, which writes through to SQLite (`settings` table, key `warehouseOnboardingDismissed`).
- **Re-trigger** lives in the status-bar repo button context menu (right-click). Both the connected and disconnected variants of that menu now include a **Set up warehouse…** entry that calls `openWarehouseOnboarding(true)`. The `force = true` argument removes the workspace id from the dismissed list, so future automatic re-opens will once again prompt — until the user dismisses again.

## Persistence

| Where | Key | Shape |
|---|---|---|
| `<workspace>/.mid/warehouse.json` | `warehouses` | `{ warehouses: [{ id, name, repo, branch?, subdir? }] }` — read by `mid:warehouses-list`, written by `mid:warehouses-add` |
| SQLite `settings` (per install) | `warehouseOnboardingDismissed` | `string[]` of workspace ids that have skipped the modal |

The dismiss list is per-install (machine-local), not synced across machines, so opening the same folder on a fresh machine re-prompts on first launch. That's by design: warehouses are a per-machine choice (transport, credentials, paths to local clones) so the onboarding decision is too.

## File map

| File | What it adds |
|---|---|
| `apps/electron/main.ts` | `mid:warehouses-add` IPC handler; `AppState.warehouseOnboardingDismissed` |
| `apps/electron/preload.ts` | `warehousesAdd(...)` bridge; `AppState.warehouseOnboardingDismissed` |
| `apps/electron/renderer/index.html` | `<dialog id="mid-warehouse-onboarding">` markup |
| `apps/electron/renderer/renderer.ts` | `openWarehouseOnboarding()`, `maybeShowOnboarding()`, `dismissOnboardingForCurrentWorkspace()`; `applyFolder()` hook; status-bar context-menu re-trigger |
| `apps/electron/renderer/renderer.css` | `.mid-onboarding*` styles |

## Manual test plan

1. **Fresh install + first folder.** Wipe `~/Library/Application Support/mark-it-down/mid.sqlite` (macOS) or the equivalent on your platform. Delete any `<workspace>/.mid/warehouse.json` for the folder you'll open. Launch the app, open the folder. The modal should appear automatically.
2. **gh-not-installed branch.** Temporarily move `gh` out of `PATH` (`mv $(which gh) /tmp/gh.bak`), wipe SQLite + warehouse.json again, and re-launch. The modal should land on Step 1 with the install instructions and the **Open install page** + **Use device flow instead** buttons. Restore `gh` afterwards.
3. **gh-not-authed branch.** Run `gh auth logout`, re-launch. The modal should jump straight to Step 2 with both the Terminal command and device-flow paths visible.
4. **Pick existing repo.** Sign in, complete Step 3 by selecting one of your existing repos. Confirm `<workspace>/.mid/warehouse.json` now has a single entry whose `repo` matches your selection, and that the status-bar repo button reflects the connection.
5. **Create new repo.** Wipe and re-launch. Sign in, complete Step 3 by submitting the **Create & use** form (don't change the default name). Confirm a new private GitHub repo exists at `<your-user>/<workspace>-notes`, that `warehouse.json` has an entry pointing at it, and that the local clone is wired up.
6. **Skip + remember.** Wipe and re-launch. Click **Skip**. Re-launch the app — the modal should NOT reappear for that workspace. The same is true for clicking the modal's `x`, hitting Esc, or clicking the backdrop.
7. **Re-trigger from status bar.** Right-click the status-bar repo button. The context menu should include **Set up warehouse…**. Click it; the modal should re-open and behave exactly like the auto-open path.

## Manual invocation

If you ever need to force the modal open from devtools:

```js
window.openWarehouseOnboarding?.(true);
```

(`force = true` ignores the dismissed list.) The function is a top-level binding in the renderer module, not exposed on `window` — but if you're debugging you can hot-eval it via the renderer's devtools.

## Future work

- **Settings page entry.** Today the only re-entry surface is the status-bar repo button context menu. Once the new Settings shell stabilizes, mirror the entry under Settings → GitHub for discoverability.
- **Per-workspace branch + subdir.** The wizard only persists `id`, `name`, and `repo`. The schema supports `branch` and `subdir`; a follow-up could add an "Advanced" disclosure to set those.
- **Org / fork support.** `gh repo create` defaults to your user. A future iteration could let you pick the org from `gh org list` and pre-fill the slug accordingly.
