# Apple Notes importer

> Status: shipped in #247. Built on the importer plugin contract from #246
> (see `docs/importers.md`). Lives at `apps/electron/importers/apple-notes/`.

The Apple Notes importer pulls every note out of the macOS Notes.app and
writes them into your workspace as plain markdown files, preserving folder
hierarchy, attachments, and timestamps.

## Behaviour

| Concern | Behaviour |
|---|---|
| Platform | `process.platform === 'darwin'` only. On every other platform `import` yields nothing and the chooser logs a single line. |
| Source | Live read of Notes.app via `osascript`. There is no offline file to point at — the importer ignores the input path on the dry-run pass and writes via `ctx.workspaceFolder` on the write pass. |
| Folder hierarchy | Every Apple Notes folder maps to a markdown subfolder under `Imported/apple-notes/<folder-name>/`. The default folder ("Notes") is preserved as-is. |
| Attachments | Saved next to each note under `Imported/apple-notes/<folder>/assets/<note-slug>/<n>.<ext>` and referenced from the markdown body via relative paths. |
| Tags | `#hashtags` already inside the note body are surfaced into frontmatter `tags:`. Every note also gets `imported` and `apple-notes` tags. |
| Locked notes | Skipped. The importer logs each one and reports a count in the final summary. |
| Empty notes | Skipped silently (with one summary count). |
| Dry-run | First run yields a single preview note. Confirm with the JSON-input dance below to write. |

## Frontmatter shape

Every imported note ends up with:

```yaml
---
title: <note title — quoted if it contains YAML-special characters>
created: <ISO 8601>
updated: <ISO 8601>
tags: [imported, apple-notes, …hashtags]
source: apple-notes
---
```

The host-written copy at `Imported/apple-notes/<title>.md` (the file the
plugin contract creates from the yielded `ImportedNote`) carries the same
fields plus `apple-notes-folder` and `apple-notes-id` under `meta`. The
hierarchy-preserving canonical file at
`Imported/apple-notes/<folder>/<slug>.md` carries the frontmatter shape
shown above verbatim.

## Two-pass flow (dry-run preview → write)

The plugin contract from #246 takes a single `input: string` parameter and
no first-class dry-run flag. To stay inside the contract this importer
treats `input` as a JSON config when it starts with `{`:

| `input` value | Effect |
|---|---|
| anything that is not JSON (default from the chooser) | **Dry-run.** Enumerates Notes.app, yields a single synthetic preview note listing every note that would be written, grouped by folder. No attachments are saved. |
| `{"confirm": true}` | **Write.** Re-enumerates, saves attachments to disk, and yields one `ImportedNote` per real note. |

In the renderer chooser flow:

1. Pick **Apple Notes** from the importer chooser.
2. The renderer passes the workspace folder as `input` (default), so the
   first run is always a dry-run. A note titled "Apple Notes — Import
   preview" appears under `Imported/apple-notes/`.
3. Read the preview, then re-run with the **Confirm** option (the renderer
   sends `{"confirm": true}` as `input`) to write the real notes.

The dry-run note also contains a built-in checklist block telling you to
re-run with confirm — so even a user who's never seen this doc can find
their way through it.

## Inline images

Apple Notes stores image references inside the note's HTML body as private
URLs (`x-coredata://…` or `applewebdata:…`) that aren't reachable from
outside the app. The importer:

1. Drops those broken references during the HTML→Markdown unwrap.
2. Saves each attachment via the AppleScript `save` verb to
   `Imported/apple-notes/<folder>/assets/<note-slug>/<n>.<ext>`.
3. Appends each saved image to the bottom of the note body as
   `![](assets/<note-slug>/<n>.<ext>)`.

This loses the original inline placement (Apple doesn't expose anchors) but
keeps every image attached to its source note. Non-image attachments
(PDF, audio, video) follow the same path with their original extension.

## AppleScript permission

On the first run the OS will prompt:

> "Mark It Down" wants to control "Notes". Allowing control will provide
> access to documents and data in "Notes", and to perform actions within
> that app.

Click **OK**. If you click **Don't Allow** the importer fails with:

> AppleScript permission denied for Notes. Open System Settings → Privacy
> & Security → Automation, find the running Mark It Down application (or
> your terminal in dev), and enable Notes.

Re-toggling the permission requires re-launching the app — that's a macOS
restriction, not ours.

## File layout

```
apps/electron/importers/apple-notes/
├── index.ts          ← Importer contract export + dispatcher
├── applescript.ts    ← osascript runner + Notes.app enumeration
└── html-to-md.ts     ← minimal HTML → Markdown unwrap + #hashtag puller
```

Every other surface stays untouched — the loader from #246 picks the
folder up automatically because it ships an `index.ts`.

## Testing locally

```bash
npm run compile:electron
npm run dev:electron
```

Then:

1. Open Notes.app and create a folder "MID Test" with one note that has a
   title, a body with `#testing` somewhere in it, and a pasted image.
2. In Mark It Down, click **Import from…** in the activity bar and pick
   **Apple Notes**.
3. Confirm the preview note lists `MID Test` and your test note.
4. Re-run with confirm — the test note shows up at
   `Imported/apple-notes/MID Test/<slug>.md`, the image is at
   `Imported/apple-notes/MID Test/assets/<slug>/1.png`, and the body's
   frontmatter has `tags: [imported, apple-notes, testing]`.

## Edge cases

| Case | Behaviour |
|---|---|
| Locked note | Skipped, logged. |
| Empty note (no body, no attachments) | Skipped silently. |
| Note in multiple folders | Apple Notes only stores one container — we follow that. |
| Attachment Notes.app can't read (rare, e.g. recovered cache rows) | Logged, skipped, surrounding note still imports. |
| Non-image attachment (PDF, audio, video) | Saved to `assets/<slug>/<n>.<ext>` with its original extension; appended to the body as a plain link. |
| Very large library (5000+ notes) | The osascript script writes one record at a time so we don't blow Apple's text-item-delimiter limits. The dry-run preview truncates each folder's listing at 50 entries with a "and N more" trailer. |

## Future work (out of scope for #247)

- `.exporter` archive fallback for non-macOS users.
- Anchored image placement (would require parsing the WebKit DOM Apple
  ships in the body — possible, but not worth the brittleness for v1).
- Surfacing attachment captions ("Drawn on iPad", "Scanned…") as alt-text.
- Per-folder include/exclude filters in the chooser.
