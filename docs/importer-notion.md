# Notion importer

> Status: shipped in #249. Builds on the importer plugin contract from #246.

This importer ingests a Notion **"Export → Markdown & CSV"** dump and produces
clean, GFM-flavoured markdown notes inside the user's workspace at
`Imported/notion/`. It strips Notion's id-hash filename suffix, normalises
Notion-specific markdown (callouts, toggles), and turns each database CSV into
a single navigable index page that links to the per-row pages.

## How to use

1. In Notion, open any workspace / page → **⋯ → Export → Markdown & CSV**
   (default options are fine).
2. **Unzip** the resulting `.zip` into a folder — this importer reads the
   unzipped tree, not the zip itself.
3. In Mark It Down, click **Import from…** → **Notion**, and pick the folder.
4. Watch the chooser progress bar. Notes appear under
   `<workspace>/Imported/notion/` and the file tree refreshes when done.

If you accidentally pick a `.zip`, the importer will log a one-line message
asking you to unzip first; nothing is written to disk.

## What gets converted

### Filenames

Every Notion page lives in a file named `<title> <32-hex-id>.md`. The importer
strips the trailing hex and uses the bare title as the on-disk filename. The
id is preserved on the note as `notion-id` in frontmatter so a re-import can
correlate notes if the export is regenerated.

When two pages would slug to the same filename after stripping, the second one
is suffixed `-2`, the third `-3`, and so on.

### Markdown normalisation

| Notion construct | Becomes |
|---|---|
| `<aside>…</aside>` callout | Plain GFM blockquote (each line prefixed `> `). The leading emoji is preserved as text on the first line. |
| Toggle heading (`### ▾ Some title` + indented body) | `<details><summary>Some title</summary>…body…</details>` — renders in every GFM viewer. |
| Code fence with language (` ```typescript `) | Preserved verbatim. |
| 3+ blank lines | Collapsed to a single blank line. |
| `[label](Page%20<hash>.md)` cross-page link | `[label](<sanitised-title>.md)`, pointing at the actual on-disk filename the host writes. |
| `![alt](Page%20<hash>/image.png)` asset reference | `![alt](attachments/<page-slug>/image.png)` — matches the host's default attachment layout. |

Inline images, PDFs and other binary references inside a page's
`<title> <hash>/` asset folder are attached to the owning note. The host
writes them to `Imported/notion/attachments/<page-slug>/`. Files larger than
50MB are still imported but logged as warnings.

### Frontmatter

Every imported note gets:

```yaml
---
created: <ISO 8601, from file mtime/ctime>
updated: <ISO 8601>
source: notion
notion-id: <32-char hex if present>
relativePath: <hash-stripped path inside the export>
---
```

The host adds the `created` / `updated` keys; the importer contributes
`source`, `notion-id`, and `relativePath` via `note.meta`.

### Databases

Notion exports each database as a `<dbname> <hash>.csv` paired with a sibling
`<dbname> <hash>/` folder of one row per page. The importer:

- Yields each row's page as a normal markdown note (same rules as above).
- Yields **one extra index note** named `<dbname>` whose body is a GFM table
  with the CSV's columns. The first column (the row title) is rendered as a
  link to the corresponding row page when one exists, or as plain text when
  the row has no associated page.

A typical result:

```markdown
# Tasks

_Database imported from Notion — 12 rows._

| Name | Status | Due |
| --- | --- | --- |
| [Plan v0.10](Plan%20v0.10.md) | Done | 2026-04-01 |
| [Ship importers](Ship%20importers.md) | In progress | 2026-05-15 |
…
```

### What's NOT touched

- Any standard GFM construct (headings, lists, tables, links, images,
  emphasis, code fences without a Notion-specific marker).
- Frontmatter that already exists in a Notion-exported file (rare — Notion
  doesn't normally write any).
- Files outside the export tree.

## Implementation notes

The importer is split into three small modules under
`apps/electron/importers/notion/`:

- `index.ts` — orchestrates discovery, owns the `Importer` default export,
  yields one `ImportedNote` per page (and one extra per database CSV).
- `normalize.ts` — pure markdown transforms: hash-strip, callout collapse,
  toggle → `<details>`, link / asset path rewrites.
- `db.ts` — zero-dependency RFC 4180 CSV parser plus the GFM table builder
  used for `<dbname>` index notes.

No code outside that folder was changed. The plugin loader (`loader.ts`)
discovers the new directory automatically — see `docs/importers.md`.

### Edge cases handled

- **Slug collisions** after hash-stripping → numeric suffixes (`-2`, `-3`, …).
- **Orphan database rows** (CSV row with no matching child page) → still
  rendered in the index table, but as plain text instead of a link.
- **Pages with no asset folder** → simply no attachments (no error).
- **Notion percent-encoded link targets** → decoded before path resolution
  and re-encoded for the rewritten markdown so spaces survive.
- **Anchors and external URLs** (`#section`, `https://…`, `mailto:…`) →
  passed through untouched.
- **`▾`, `▸`, `▼`, `►` toggle markers** at any heading level (1–6) → all
  recognised.

### Edge cases NOT handled (yet)

- **Zip input.** The acceptance line "user picks an unzipped Notion export
  folder (or zip)" is satisfied for folders; zips surface a friendly "please
  unzip first" log line instead of attempting in-process extraction. Adding
  real zip support is a one-line dep change against
  `apps/electron/importers/notion/index.ts` if a future issue wants it.
- **Synced blocks** — Notion's export already inlines them, so we trust the
  source.

## Testing locally

```bash
npm run compile:electron
npm run dev:electron
```

In a separate terminal, point the chooser at any unzipped Notion export.
Sample fixture used during development:

```text
/tmp/mid-notion-fixture/
├── Export 1234567890abcdef1234567890abcdef/
│   ├── My Page abcdef…0.md
│   ├── My Page abcdef…0/
│   │   └── picture.png
│   └── Other 999999…aa.md
├── Tasks deadbeef…ef.csv
└── Tasks deadbeef…ef/
    ├── Task A 1111…1.md
    └── Task B 2222…2.md
```

Importing it produces, under `Imported/notion/`:

```text
My Page.md          ← callout → blockquote, toggle → <details>, image → attachments/My Page/picture.png
Other.md
Task A.md
Task B.md
Tasks.md            ← database index with [Task A](Task%20A.md) and [Task B](Task%20B.md)
attachments/
└── My Page/
    └── picture.png
```
