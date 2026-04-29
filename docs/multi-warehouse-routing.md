# Multi-Warehouse Routing

Send personal notes to one repo, team notes to another. The warehouse
sync engine partitions notes by category prefix and ships each route to
its own GitHub repo independently.

## Configure

Default warehouse stays in `markItDown.warehouse.repo` — that's the
"catch-all" route. Routing rules live in
`markItDown.warehouse.routes` as an array of objects:

```jsonc
"markItDown.warehouse.repo": "fadymondy/personal-notes",
"markItDown.warehouse.routes": [
  {
    "categoryPrefix": "Work",
    "repo": "acme/team-notes",
    "branch": "main"
  },
  {
    "categoryPrefix": "Engineering/Outages",
    "repo": "acme/outage-postmortems",
    "subdir": "writeups"
  }
]
```

With this config:

| Note category | Goes to |
| --- | --- |
| `Work/Q1 Roadmap` | acme/team-notes |
| `Engineering/Outages/2026-01-12` | acme/outage-postmortems |
| `Personal/Finance` | fadymondy/personal-notes (default) |
| `Drafts` | fadymondy/personal-notes (default) |

## Matching rules

* Match is **segment-aware** via the same helper used for nested
  categories — `Reference` matches `Reference` and `Reference/Postgres`
  but **not** `References/Foo`.
* Among routes, **longer prefixes win** (so `Engineering/Outages` claims
  notes ahead of a more general `Engineering` rule).
* Notes that match no rule fall through to the default repo. If you
  haven't set `markItDown.warehouse.repo`, those notes have no home and
  won't sync — there's no implicit local-only fallback.
* Empty / malformed rules are logged to the warehouse channel and
  ignored: missing `repo`, missing `categoryPrefix`, repo not in
  `owner/repo` form, or a duplicate `categoryPrefix`.

## What happens during sync

For each route (default + each rule), the manager runs an independent
clone + pull + plan + push cycle. That means:

* Each route gets its own `_index.json` listing only the notes that
  belong to it.
* Conflict resolution still applies per-route — the existing conflict
  panel surfaces conflicts from any repo into one list keyed by note id.
* The `firstPushFlagKey` is per-repo, so each new warehouse gets its own
  one-time confirmation dialog before the first push.
* Status bar shows `2 warehouses` (or similar) when more than one route
  is operating; click to open the conflicts panel as before.

### Moving a note between routes

Re-categorising a note (`Work/Plan` → `Personal/Plan`) is handled
gracefully:

1. The new route's planPush sees the note as `added` → uploads it to its
   new repo.
2. The old route's planPush sees the note as **predicate-mismatched** in
   its remote index → marks it as `deleted` → removes it from its old
   repo.

The two pushes happen in sequence; for a brief window the note exists in
both repos. Pull on either side reconciles to the new home.

## Auto-push + manual sync

`markItDown.warehouse.autoPush` (debounce ms) applies to every route. A
single note save in `Work/X` triggers a debounced push to that route only;
the others sit idle.

`Mark It Down: Warehouse Sync Now` walks every route in declared order
(longest-prefix-first per `buildRoutes`).

## Status bar

* No routes enabled → "Notes warehouse off"
* One route → `<repo>@<branch>`
* Multiple routes → `<N> warehouses`
* Conflict on any route → `N note(s) diverged. Click to resolve.`

## Implementation map

| File | Role |
| --- | --- |
| `packages/core/src/warehouse-routing/index.ts` | Pure rule parser + `buildRoutes` + `routeForCategory` |
| `src/warehouse/warehouseConfig.ts` | `readRoutes()` returns the resolved route configs |
| `src/warehouse/warehouseSync.ts` | `pull` / `planPush` / `push` accept an optional `predicate` so each call only handles its route's subset |
| `src/warehouse/warehouseManager.ts` | Iterates routes per sync action; aggregates summaries |

## Limitations

- A note must belong to exactly one route — there's no fan-out (mirror
  the same note to two repos).
- Workspace-id remains shared across routes; if you need per-route
  workspace ids, override per route via a `workspaceId` field — that's a
  natural follow-up but not in this first cut.
- Rule changes that orphan a note (delete the rule for `Work/`) leave
  the note in the old repo — the next sync of the default route picks
  it up locally and pushes it to the default repo, but the old repo
  will still hold it. Manually delete the file (or wait for the next
  re-route to delete it via predicate-mismatch).

## Testing

```bash
npx vitest run tests/unit/warehouse-routing
```

10 tests cover route parsing (no-rules default-only, no-default
empty-set, every rejection branch, branch/subdir inheritance vs
override) and routing semantics (prefix match, default exclusion,
sibling non-bleed).
