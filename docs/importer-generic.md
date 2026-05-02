# Generic markdown importer

> Status: shipped in #250 on top of the importer plugin contract from #246.

The **generic** importer is the catch-all for plain markdown directories that
already look like notes — Bear exports, Obsidian vaults, plain folders of
`.md`, dumps from a static-site generator, or anything else that boils down to
"a tree of text files I want in my workspace".

It picks up automatically once shipped — the loader scans
`apps/electron/importers/<id>/` at startup and the entry shows up in the
importer chooser modal and the **File → Import from…** menu.

## What it does

When the user picks a folder, the importer:

1. Walks the folder recursively, skipping hidden entries (`.git`,
   `.obsidian`, `.DS_Store`, etc.) and `node_modules`.
2. Yields one `ImportedNote` per file with extension `.md`, `.markdown`, or
   `.txt`.
3. Preserves the source-folder relative layout via
   `meta.relativePath`. The host writes the imported tree out faithfully —
   folders stay folders, deep paths stay deep.
4. Preserves frontmatter exactly as it appeared in the source file (no rewrite,
   no normalisation). The host wraps its own bookkeeping fields (`created`,
   `updated`, `tags`, plus the `meta` keys) around whatever was already there.
5. Rewrites Obsidian-style wikilinks to relative markdown links **only when the
   target file is part of the imported set**:
   - `[[Page]]` → `[Page](Page.md)`
   - `[[Page|alias]]` → `[alias](Page.md)`
   - `[[Page]]` with no matching file → left intact (no broken-link
     fabrication).
   - `![[image.png]]` embeds → left intact (this importer does not yet pull
     attachments through; that is a follow-up).
6. Derives a title from the first H1 heading (after any frontmatter block);
   falls back to the filename without extension.
7. Records `createdAt` / `updatedAt` from the file's `birthtime` / `mtime`.

## Wikilink resolution

Wikilink targets are matched **case-insensitively by basename** (the filename
without extension), against the set of files this run is importing. Two files
in different folders with the same basename trigger a log line and resolve to
the first one discovered — keep names unique per vault if that matters to you.

The rewritten link uses a POSIX-relative path computed from the source file's
location, so a wikilink in `notes/inbox/today.md` pointing at
`notes/refs/Page.md` becomes `[Page](../refs/Page.md)` and survives the host
preserving folder layout.

## What it does **not** do

- It does not flatten anything — collisions are preserved as nested files.
- It does not pull image / asset attachments. Embed-style wikilinks
  (`![[…]]`) are left intact.
- It does not modify frontmatter. If you want a `source: generic` key, set
  it in the source file before importing.
- It does not look at `.textbundle` packages specially — they walk like any
  other directory.

## Source

- `apps/electron/importers/generic/index.ts` — the importer module, including
  the exported `rewriteWikilinks` helper.

## Acceptance checklist (#250)

- [x] User picks a folder.
- [x] All `.md`, `.markdown`, `.txt` files imported preserving relative paths.
- [x] Wikilinks `[[Page]]` rewritten to `[Page](Page.md)` when the target
  exists in the imported set.
- [x] Frontmatter preserved verbatim.
- [x] Docs at `docs/importer-generic.md` (this file).
