# Google Keep importer

> Status: shipped in #248 on top of the importer plugin contract from #246.

The **google-keep** importer ingests a [Google Takeout](https://takeout.google.com/)
export of Google Keep — the JSON-per-note export bundled with attachments.

It picks up automatically once shipped — the loader scans
`apps/electron/importers/<id>/` at startup and the entry shows up in the
importer chooser modal and the **File → Import from…** menu.

## Getting your data

1. Open <https://takeout.google.com/>.
2. Deselect everything, then re-select **Keep**.
3. Export and download the resulting `.zip` archive.
4. **Unzip the archive.** This importer reads from a folder, not a zip — the
   Electron app intentionally avoids a zip dependency.

The unzipped layout looks like:

```
Takeout/
└── Keep/
    ├── 1700000000000.json
    ├── 1700000000001.json
    ├── image-abc.jpg
    ├── audio-def.3gpp
    └── Labels.txt
```

## What you can pick

The importer accepts any of these as the source folder:

- The Takeout root that contains a `Takeout/Keep/` subdirectory.
- The `Takeout/` directory directly (so it sees `Keep/` as a child).
- The `Keep/` directory itself (already-extracted notes).

`detect()` probes for whichever shape is present — you don't need to think
about which level to pick.

## What it does

For every `.json` file under the resolved Keep folder:

1. Parses the file as a Keep note (skipping non-note JSON like `Labels.txt`
   metadata).
2. Skips notes with `isTrashed: true` unless
   `MID_IMPORTER_INCLUDE_TRASHED=1` is set in the environment when launching
   the app.
3. Maps Keep fields to markdown / frontmatter:

   | Keep field                 | Imported as                              |
   |----------------------------|------------------------------------------|
   | `title`                    | note title (filename); falls back to     |
   |                            | first 32 chars of body, then to          |
   |                            | `Untitled <createdAt>`                   |
   | `textContent`              | markdown body                            |
   | `listContent[]`            | `- [ ]` / `- [x]` task list (replaces    |
   |                            | the body when present)                   |
   | `labels[].name`            | frontmatter `tags:`                      |
   | `isPinned`                 | frontmatter `pinned:`                    |
   | `color` (e.g. `RED`)       | frontmatter `color:` (lower-cased;       |
   |                            | hex preserved verbatim; `DEFAULT` → null)|
   | `isArchived`               | frontmatter `archived: true` if set      |
   | `isTrashed`                | frontmatter `trashed: true` if included  |
   | `createdTimestampUsec`     | frontmatter `created:` (ISO 8601)        |
   | `userEditedTimestampUsec`  | frontmatter `updated:` (ISO 8601)        |
   | `attachments[]`            | yielded as `ImportedAttachment`s; the    |
   |                            | host writes them under                   |
   |                            | `Imported/google-keep/attachments/<slug>/` |
   | always                     | frontmatter `source: google-keep`        |

4. References attachments inline at the bottom of the body. Image-mimetype
   attachments use `![name](href)`; everything else uses `[name](href)`. The
   `href` matches where the host actually writes the file, so the markdown
   renders correctly once persisted.

## Frontmatter shape

```yaml
title: Recipe ideas
created: 2024-08-13T09:42:00.000Z
updated: 2025-01-04T18:11:00.000Z
tags: [Cooking, Inbox]
pinned: true
color: yellow
source: google-keep
```

`archived` and `trashed` only appear when the source note had them set.

## Trashed notes

By default the importer skips trashed notes — Keep keeps deleted notes
around for 7 days, and most users do not want to re-ingest them. If you do,
launch the app with `MID_IMPORTER_INCLUDE_TRASHED=1` in the environment:

```bash
MID_IMPORTER_INCLUDE_TRASHED=1 npm run dev:electron
```

## Edge cases

- Notes with no title and no `textContent` use the first list item or fall
  back to `Untitled <createdAt>`.
- Duplicate slugs across notes (two notes with the same title after
  slugifying) are disambiguated with `-2`, `-3`, ... suffixes for the
  attachment folder reference.
- Attachments declared in `attachments[]` but missing from disk are logged
  and skipped — the note still imports.
- Zip input (`.zip` path) is rejected with a clear message asking the user
  to unzip first; this keeps the desktop app dependency-free.

## Source

- `apps/electron/importers/google-keep/index.ts` — the importer module.

## Acceptance checklist (#248)

- [x] User picks an unzipped Takeout folder (root, `Takeout/`, or `Keep/`).
- [x] Each `.json` becomes a `.md` with frontmatter + body.
- [x] Checklists rendered as task lists.
- [x] Attachments yielded as `ImportedAttachment`s (host persists under
  `Imported/google-keep/attachments/<note>/`) and referenced inline.
- [x] Trashed notes skipped by default; `MID_IMPORTER_INCLUDE_TRASHED=1`
  opts in.
- [x] Docs at `docs/importer-google-keep.md` (this file).
