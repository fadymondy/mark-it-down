# Notes Warehouse

Status: shipped in Phase 0.7+ · Issue: [#10](https://github.com/fadymondy/mark-it-down/issues/10) · Depends on: [#7 Notes sidebar](notes-sidebar.md)

A "notes warehouse" is a GitHub repo you nominate as the cloud-storage backend for everything in your [Notes sidebar](notes-sidebar.md). Mark It Down keeps a local working clone in extension storage, pulls on activation, pushes (debounced) when you save a note, and you can ship the same notes to multiple machines and multiple workspaces by pointing each install at the same warehouse repo.

## At a glance

| | |
|---|---|
| **Where** | Status bar (right side, "Notes synced" / "syncing" / etc.) · Notes view title bar · command palette under "Mark It Down: Warehouse" |
| **What** | A GitHub repo you own (or have write access to). Defaults assume a `notes/` subdirectory but it's configurable. |
| **How** | A local working clone under `${context.globalStorageUri}/warehouse/<owner>--<repo>/`. Sync goes through the `git` CLI; with `transport: "gh"` we run `gh auth setup-git` once so credentials come from your existing `gh auth login`. |
| **When** | Pull on extension activation (non-blocking). Push debounced after each note save (default 5s). Manual `Sync Now` / `Pull` commands any time. |
| **Who sees what** | Workspace notes go under `<subdir>/<workspace-slug>/`. Global notes go under `<subdir>/_personal/`. The same warehouse can host many workspaces side-by-side. |

## Quick start

```jsonc
// settings.json
{
  "markItDown.warehouse.repo": "you/your-notes",
  "markItDown.warehouse.branch": "main",
  "markItDown.warehouse.subdir": "notes",
  "markItDown.warehouse.transport": "gh",
  "markItDown.warehouse.autoPush": true
}
```

That's the minimum. On the next save:

1. The status bar flips from "Notes warehouse: off" → "Notes synced".
2. After ~5s of save inactivity, Mark It Down builds a push plan and shows a confirmation modal — **only on the first push from a workspace**. Review the listed files, click **Push** to commit + push.
3. Subsequent saves auto-push silently in the background.

## Repo layout

For warehouse `you/your-notes`, branch `main`, subdir `notes`, with one workspace named `acme-app` and some global notes:

```
your-notes/                           ← your warehouse repo (GitHub)
└── notes/                            ← markItDown.warehouse.subdir
    ├── _personal/                    ← all global notes
    │   ├── _index.json               ← workspaceState/globalState mirror for this scope
    │   ├── 8jqzv2axrmfn.md
    │   └── …
    └── acme-app/                     ← workspace slug (markItDown.warehouse.workspaceId or derived)
        ├── _index.json
        ├── ka9zsb1tfnd2.md
        └── …
```

Add another workspace to the same warehouse and a sibling folder appears (`notes/another-workspace/_index.json`). Multiple machines pointing at the same warehouse converge on the same per-scope folders.

### `_index.json`

Mirrors the F6 NotesStore index for the scope. One per scope per workspace. Carries metadata; the markdown files carry content:

```json
{
  "scope": "workspace",
  "workspaceId": "acme-app",
  "generatedAt": "2026-04-29T12:34:56.789Z",
  "notes": [
    {
      "id": "ka9zsb1tfnd2",
      "title": "Sprint 12 retro",
      "category": "Daily",
      "scope": "workspace",
      "createdAt": "2026-04-22T09:01:00.000Z",
      "updatedAt": "2026-04-22T17:42:11.000Z",
      "filename": "ka9zsb1tfnd2.md"
    }
  ]
}
```

The index is the source of truth on pull. If a remote `_index.json` references a missing `<id>.md`, that note is skipped with a warning in the log.

## Commands

| Command | Default surface |
|---|---|
| `markItDown.warehouse.syncNow` | View title bar (cloud icon) · command palette · status-bar click |
| `markItDown.warehouse.pull` | View title overflow · command palette |
| `markItDown.warehouse.openOnGitHub` | View title overflow · command palette |
| `markItDown.warehouse.openLog` | Status-bar click · command palette |

`Sync Now` is the most-used flow: pull → reconcile → build push plan → confirm (first time only) → push.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `markItDown.warehouse.repo` | `""` | `owner/repo`. Empty = warehouse disabled. Setting this is the on-switch. |
| `markItDown.warehouse.branch` | `"main"` | Branch to clone, pull from, and push to. |
| `markItDown.warehouse.subdir` | `"notes"` | Subdirectory inside the warehouse repo. Useful when the repo is shared with other content. |
| `markItDown.warehouse.transport` | `"gh"` | `"gh"` runs `gh auth setup-git` once and lets git use the gh credential helper — no extra prompts. `"git"` shells out to plain git with whatever credentials you already have configured (SSH keys, credential helper). |
| `markItDown.warehouse.autoPush` | `true` | Push automatically after a debounce window when notes change. Set to `false` if you want fully manual sync via `Sync Now`. |
| `markItDown.warehouse.autoPushDebounceMs` | `5000` | How long to wait after a save before pushing. Saves within this window batch into one push. Clamped to 1000–60000. |
| `markItDown.warehouse.workspaceId` | `""` | Override the workspace folder name used as the per-workspace subfolder. Useful when two workspaces have the same folder name on different machines. Empty = derive from `vscode.workspace.workspaceFolders[0].name`. |

## Workflows

### First push (the dry-run gate)

Before the **first** push from a given workspace + warehouse pair, you get a modal:

```
Mark It Down: confirm the first push to the notes warehouse.

Repo:      you/your-notes@main
Subdir:    notes/
Workspace: acme-app

Will create: 7 note(s)
Will update: 0 note(s)
Will delete: 0 note(s)

Files staged:
  notes/acme-app/_index.json
  notes/acme-app/ka9zsb1tfnd2.md
  …

[Push] [Cancel]
```

Click `Push` to send. The confirmation flag is stored in `workspaceState` under `markItDown.warehouse.firstPushDone:<repo>/<workspaceId>` so subsequent pushes don't re-prompt. Click `Cancel` to bail — nothing is committed locally or remotely.

This gate exists so you can sanity-check what's going where before any commit lands. Don't disable it unless you're sure (it can't be disabled today; the marker key is per-`(repo, workspaceId)` pair).

### Auto-push on save

The Notes sidebar emits a change event whenever a note is created / renamed / moved / deleted, and `onDidSaveTextDocument` fires when the markdown content is saved. The warehouse listens to both, debounces by `autoPushDebounceMs` (default 5s), and pushes at the end of the window.

If a sync is already in flight when the timer fires, the auto-push is rescheduled to fire 5s later — there's never more than one push running at a time.

### Manual `Sync Now`

`Sync Now` does the full round-trip: pull, reconcile remote → local with conflict checks, build the push plan, gate on first-push if needed, push. Use this:

- After editing notes on another machine — pull picks up their updates.
- When the status bar shows "Notes behind" or "Notes conflict".
- After fixing a sync error — once you've addressed whatever was failing.

### Pull-only

`Pull` is the read half of `Sync Now`. Useful when you just want to bring local up to date without pushing your in-flight edits.

## Conflict policy

Conflicts are detected, reported, **never auto-merged**.

A conflict is when both:

- Your local note's `updatedAt` is newer than the last successful sync, AND
- The remote note's `updatedAt` is newer than the last successful sync, AND
- The two timestamps don't match.

When detected:

1. The local copy is kept — the remote version does **not** clobber it.
2. The status bar flips to "Notes conflict" with a tooltip count.
3. A warning is logged to the **Mark It Down: Warehouse** output channel naming the conflicting note.
4. On the next push, your local version wins (and the remote version is overwritten).

To rescue the remote version, open the warehouse on GitHub (`Warehouse: Open on GitHub`), navigate to the conflicting `<id>.md`, manually merge the content into your local note, then save. The next push captures your reconciliation.

A more interactive conflict UI (side-by-side, accept-remote / accept-local / merge) is on the roadmap but not in this release.

## Secret-safety guard

Before any push, every `<id>.md` content is scanned for token patterns:

- GitHub PATs / app / OAuth / fine-grained tokens (`gh[psuor]_`, `github_pat_`)
- AWS access key IDs (`AKIA…`) and AWS-shaped secret keys
- OpenAI / Anthropic-style `sk-…` keys, including `sk-ant-…`
- Slack `xox[baprs]-…` tokens
- Google API keys (`AIza…`)
- PEM private-key blocks (`-----BEGIN … PRIVATE KEY-----`)
- JSON Web Tokens (`eyJ…`)

If any pattern matches, the push is **blocked** and a modal lists each finding with a redacted preview (`ghp_abcd…XY`) and the line number. You can:

- **Cancel** — no push happens. Edit the note to remove the secret, then save again. The next debounce will re-scan.
- **Push anyway** — bypasses the scan for this push only. Use sparingly; the modal is intentionally loud.

The scanner is conservative — false positives can happen (e.g. a base64 string the same length as an AWS secret). The redacted preview should make it obvious whether a finding is a real token or noise. The warehouse code never logs the full token, only the preview.

## Status-bar states

| Icon | Text | Meaning |
|---|---|---|
| `$(circle-slash)` | Notes warehouse: off | `markItDown.warehouse.repo` is empty — sync disabled. |
| `$(cloud)` | Notes synced | Last operation completed cleanly. |
| `$(sync~spin)` | Notes syncing… | Pull or push in flight. |
| `$(cloud-download)` | Notes behind | Remote has changes you don't have locally. Click → Pull. |
| `$(warning)` | Notes conflict | Diverged on at least one note. Local kept; resolve manually. |
| `$(error)` | Notes sync error | Last operation failed. Click → open the log. |

Click the status bar item to open the **Mark It Down: Warehouse** output channel.

## Storage on disk

Local working clone:

```
${context.globalStorageUri}/warehouse/<owner>--<repo>/
├── .git/
└── <subdir>/
    ├── _personal/
    │   ├── _index.json
    │   └── <id>.md
    └── <workspace-slug>/
        ├── _index.json
        └── <id>.md
```

This clone is shared across all VSCode windows on the machine — the warehouse subsystem is single-process per VSCode session per repo. It's safe to delete the directory; the next sync re-clones from origin.

State that travels with the warehouse:

- `globalState[markItDown.warehouse.lastSyncedAt]` — `Map<noteId, epochMs>` of the last successful sync timestamp per note. Used for conflict detection.
- `workspaceState[markItDown.warehouse.firstPushDone:<repo>/<workspaceId>]` — boolean, set when you confirm the first-push modal.

## Edge cases & behavior notes

- **Empty `repo` setting**: warehouse is disabled. No pull, no push, no status-bar clutter beyond the "off" indicator.
- **`gh` not installed but `transport: "gh"`**: the first sync errors with a clear "install gh and run `gh auth login`" message. Switch to `transport: "git"` if you can't install gh.
- **`gh auth setup-git` fails**: we fall back to plain git credentials (warning logged); your push will succeed if you have a working credential helper.
- **No workspace open**: only global notes (`_personal/`) sync; no workspace folder is created on the warehouse. The status bar still shows correctly.
- **Branch doesn't exist on remote**: `git clone --branch <branch>` fails with a clear error; create the branch (or push an initial commit on `main`) and try again.
- **Concurrent VSCode windows on the same machine**: each runs an independent `WarehouseManager` against the **same** working clone. The serialization is per-window, not cross-window — two pushes from two windows can race. Conservative behavior: don't push from two windows simultaneously. The roadmap includes a working-clone lock file for v1+.
- **Large notes (>5MB) or many files**: works, but the push commit lists them all. The commit message starts with a one-line summary plus a body listing each affected note.
- **Disabling auto-push (`autoPush: false`)**: only manual `Sync Now` / `Pull` push. The status bar still shows current state.
- **Renaming a note**: only the index changes; the `<id>.md` filename is stable. The warehouse picks up the new title on the next push (in the `_index.json` diff).
- **Deleting a note**: the local `<id>.md` is unlinked, the index entry is removed, and the next push deletes the file from the warehouse + writes the updated index.

## Future-work seeds

These were called out in the issue as out-of-scope and would land as separate issues:

- Side-by-side conflict UI with accept-remote / accept-local / merge actions
- Multi-warehouse routing (per-category or per-tag → different warehouses)
- Encryption-at-rest for secrets in notes (so the warehouse repo can be public without leaking)
- Cross-window working-clone lock file
- Shallow / partial sync (`subdir/` glob filters)

## Files of interest

- [src/warehouse/warehouseConfig.ts](../src/warehouse/warehouseConfig.ts) — settings reader, workspace-slug derivation
- [src/warehouse/warehouseTransport.ts](../src/warehouse/warehouseTransport.ts) — git CLI shell-out, `gh auth setup-git` integration
- [src/warehouse/warehouseSync.ts](../src/warehouse/warehouseSync.ts) — pull/push orchestration, index reconciliation, conflict detection
- [src/warehouse/secretScanner.ts](../src/warehouse/secretScanner.ts) — pre-push token regex set
- [src/warehouse/warehouseStatusBar.ts](../src/warehouse/warehouseStatusBar.ts) — 6-state status bar item
- [src/warehouse/warehouseLog.ts](../src/warehouse/warehouseLog.ts) — output channel
- [src/warehouse/warehouseManager.ts](../src/warehouse/warehouseManager.ts) — facade wired into `extension.ts`; coordinates pull, debounced push, dry-run gate, secret-detect modal
- [src/warehouse/warehouseCommands.ts](../src/warehouse/warehouseCommands.ts) — VSCode command registration
- [src/extension.ts](../src/extension.ts) — wiring on activation
- [package.json](../package.json) — `commands`, `menus.view/title`, `configuration.markItDown.warehouse.*`
