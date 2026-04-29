# Publish to GitHub Pages

Status: shipped in Phase 0.10 · Issue: [#11](https://github.com/fadymondy/mark-it-down/issues/11) · Depends on: [#10 Notes warehouse](notes-warehouse.md)

Publish your global notes (or any markdown file) as a public static site hosted on GitHub Pages. Builds a self-contained HTML site with the same Mark It Down rendering pipeline (marked + highlight.js + mermaid + sortable tables) and pushes to the warehouse repo's publish branch (default `gh-pages`).

## At a glance

| | |
|---|---|
| **Where** | Command palette → `Mark It Down: Publish: …` (4 commands) |
| **Source** | All global notes (`Deploy Site`) or just the active markdown (`Deploy Current Page`) |
| **Target** | The warehouse repo (`markItDown.warehouse.repo`) on the `gh-pages` branch (configurable) under `markItDown.publish.path` (configurable) |
| **Engine** | marked → HTML, highlight.js for syntax tokens (server-side), mermaid loaded from a CDN at view time |
| **Theme** | Any of the 25 [bundled palettes](themes.md) baked into `assets/style.css` |
| **Output** | One HTML page per source file + `index.html` listing all pages + shared `assets/style.css` and `assets/site.js` |

## Commands

| Command | What it does |
|---|---|
| `markItDown.publish.deploy` | Publish all global notes as a full site rebuild. Wipes the publish branch's working tree, regenerates everything, commits + pushes. |
| `markItDown.publish.deployCurrent` | Publish only the markdown in the active editor as `<basename>.html` at the publish root. Useful for one-off shares. |
| `markItDown.publish.copyUrl` | Copy the public URL for the active markdown file to the clipboard. Doesn't trigger a build. |
| `markItDown.publish.openSite` | Open the deployed site in your default browser. |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `markItDown.publish.enabled` | `false` | Master switch. Must be `true` for any deploy to run. |
| `markItDown.publish.branch` | `"gh-pages"` | Branch on the warehouse repo to push to. Created as an orphan branch on first deploy if it doesn't exist remotely. |
| `markItDown.publish.path` | `""` (root) | Subdirectory under the publish branch root to write the site into. Useful if the same branch hosts multiple sites. |
| `markItDown.publish.includeGlob` | `"**/*.md"` | Glob filter for source files in `Deploy Site`. (v1 only filters by extension; full glob matching is a future addition.) |
| `markItDown.publish.theme` | `"github-light"` | Which of the 25 bundled palettes to bake into the published site's CSS. |

## Quick start

```jsonc
// settings.json
{
  "markItDown.warehouse.repo": "you/your-notes",
  "markItDown.publish.enabled": true,
  "markItDown.publish.branch": "gh-pages",
  "markItDown.publish.theme": "github-dark"
}
```

Then:

1. Make sure GitHub Pages is enabled for the warehouse repo (Settings → Pages → Source: deploy from branch → branch `gh-pages` → folder `/`).
2. Run `Mark It Down: Publish: Deploy Site` from the command palette.
3. Open the URL it prints — typically `https://<owner>.github.io/<repo>/` (plus your `path` subdir if configured).

## How it works

```
                                                     ┌───────────────────────┐
                                                     │ globalStorage/        │
                                                     │   warehouse/<owner>-- │
                                                     │     <repo>/           │
                                                     │     .git/             │
                                                     │     notes/...         │
                                                     └─────────┬─────────────┘
                                                               │ git worktree add
                                                               ▼
                                                     ┌───────────────────────┐
PublishManager.publishAll()  ─render─►               │ globalStorage/        │
PublishManager.publishCurrent() ─render─►            │   publish/<owner>--   │
                                                     │     <repo>/           │
  marked + markedHighlight  ─→ HTML body             │     index.html        │
  mermaid blocks left as <div class="mermaid">       │     <slug>-<id>.html  │
  build assets/style.css from chosen palette         │     assets/style.css  │
  client JS for sortable tables + mermaid CDN load   │     assets/site.js    │
                                                     └─────────┬─────────────┘
                                                               │ git add -A
                                                               │ git commit -m "publish: N pages — Mark It Down"
                                                               │ git push origin HEAD:gh-pages
                                                               ▼
                                                     ┌───────────────────────┐
                                                     │ origin/gh-pages       │
                                                     │   on github.com       │
                                                     │   served by           │
                                                     │   GitHub Pages        │
                                                     └───────────────────────┘
```

The publish flow uses **`git worktree`** to keep the orphan publish branch in a separate working directory under `globalStorage/publish/<repo-slug>/`. That way the warehouse working clone (used by F9 for sync) and the publish branch don't fight over the same checkout. The worktree is removed after each push so subsequent deploys start fresh.

## Output structure

For two notes, "Sprint 12 retro" and "Postgres tuning":

```
gh-pages/                       ← branch root (or .../<path>/ if configured)
├── index.html                  ← list of all pages
├── notes/
│   ├── sprint-12-retro-ka9zsb1tfnd2.html
│   └── postgres-tuning-8jqzv2axrmfn.html
└── assets/
    ├── style.css               ← chosen theme palette + base styles + highlight.js theme
    └── site.js                 ← sortable-table JS + mermaid lazy loader
```

Each HTML page is self-contained: relative links to the shared assets, no JS frameworks, no inline `<script>`. Mermaid is loaded from `https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js` only when a page actually contains a `.mermaid` element.

## Pages layout

Every published page has:

- **Header** — link back to `index.html` ("Mark It Down" home) + the page title
- **Sidebar nav** — the same list of all pages, with relative links so it works at any deploy depth
- **Body** — the rendered markdown
- **Footer (none)** — the layout is intentionally minimal so the content is the focus
- Responsive: under 720px wide, the sidebar collapses

## Sortable tables in the public site

Tables in published pages are sortable: click any column header to cycle asc → desc → none. The behavior matches the in-VSCode [DataTable feature](datatable.md) — same parsing logic (numeric strip + `localeCompare`). Implemented in `assets/site.js` with vanilla JS, no framework.

## Mermaid in the public site

Mermaid blocks are rendered client-side — `assets/site.js` lazy-loads mermaid from JSDelivr only when the page contains at least one `.mermaid` div. Theme follows the published-site theme's `kind` (light/dark) at load time.

## What's not in v1

Tracked as future-work seeds in the issue body and this docs page:

- **First-run wizard** — verify the warehouse repo is public, verify Pages is enabled, offer to flip both via `gh api`. v1 just deploys; if Pages isn't enabled, the URL won't resolve until you flip it manually.
- **Privacy guard for private repos** — v1 doesn't warn before publishing to a private repo. The site will be 404 until the repo is public; no leak risk, but a clearer message would be friendlier.
- **Per-folder `includeGlob` filtering** — v1 publishes all global notes regardless of `includeGlob`. Glob matching is wired in settings but not yet applied.
- **Per-page `slug` overrides** — files are named `<slug>-<id>.html` from the note title. Stable across renames (because of the `id` suffix) but ugly. A frontmatter `slug:` override is a future addition.
- **Embedded images** — markdown image references aren't rewritten to local paths or copied. They render via the original URL (which works for hosted images). Local relative-path images would need a copy pass.
- **Sitemap / RSS** — would be ~30 LOC to add.

## Edge cases

- **Warehouse not configured**: Publish commands surface an info toast pointing to settings. No deploy attempted.
- **Publish disabled** (`enabled: false`): `Deploy Site` and `Deploy Current` show a warning + "Open Settings" action. `Copy URL` and `Open Site` still work (they don't deploy).
- **First deploy** (no `gh-pages` branch yet): the publisher creates an orphan branch via `git worktree add -B`, wipes any inherited tree, writes the site, commits + pushes. Subsequent deploys reuse that branch.
- **Push fails** (e.g. credential issue, branch protection): error toast surfaces the git stderr; the worktree is cleaned up regardless.
- **No notes to publish**: `Deploy Site` shows "nothing to publish" and exits.
- **Active editor isn't markdown**: `Deploy Current Page` reads whatever the active editor's URI points at, treating it as markdown. Non-markdown content goes through marked anyway and renders as plain paragraphs; not great UX but not destructive.
- **Theme `auto`**: not valid for publish. Default `github-light` is used if you set `auto` here.

## Files of interest

- [src/publish/staticGenerator.ts](../src/publish/staticGenerator.ts) — `renderPage`, `renderIndex`, `buildSiteAssets` (CSS + client JS), embedded BASE_CSS / HLJS_LIGHT_CSS / HLJS_DARK_CSS / CLIENT_JS
- [src/publish/publishManager.ts](../src/publish/publishManager.ts) — `PublishManager` orchestrates the warehouse worktree, render, commit, push, cleanup
- [src/publish/publishConfig.ts](../src/publish/publishConfig.ts) — settings reader + theme lookup
- [src/publish/publishCommands.ts](../src/publish/publishCommands.ts) — 4 VSCode command registrations
- [src/extension.ts](../src/extension.ts) — wires PublishManager + commands on activation
- [package.json](../package.json) — 4 commands + 5 `markItDown.publish.*` settings
