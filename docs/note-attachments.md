# Note Attachments

Each note can hold binary attachments (images, PDFs, ZIP, anything). They
live alongside the markdown file and travel with the warehouse + the
published static site.

## Storage layout

```
<storage-root>/notes/
  <note-id>.md
  <note-id>-attachments/
    diagram.png
    spec.pdf
    archive.zip
```

The directory is created lazily on the first attachment, removed when the
note is deleted, and replicated verbatim to the warehouse repo so other
machines pick it up on `Warehouse: Pull`.

## Drag-and-drop

Drop one or many files onto the editor (view or edit mode); each file is
read as base64, sent to the extension via `attachUpload`, written into the
attachments dir with a sanitised + collision-resolved filename, and then a
markdown reference is appended at the end of the note:

* image-like file → `![filename](id-attachments/filename)`
* anything else → `[filename](id-attachments/filename)`

Move the inserted line wherever you'd like. Multiple drops in quick
succession all stack at the bottom in arrival order.

### Filename hygiene

* Path separators (`/`, `\`) and any character outside `[A-Za-z0-9._-]` are
  collapsed to `-`.
* Leading/trailing dashes are stripped.
* Maximum length is **96 characters**, preserving the extension.
* On collision, `-1`, `-2`, … are appended to the basename until a free
  slot is found. After 10k attempts (essentially never), a timestamp suffix
  is used as a last resort.

## Warehouse sync

`materializeScope` copies each attachment into `<scope>/<id>-attachments/`
on the warehouse clone, lists the filenames in `_index.json` under
`attachments?: string[]`, and deletes the dir whenever a note disappears
from the local index. Pull mirrors this — `readRemoteAttachments` walks the
listed names and `importNote` writes them next to the new local note.

This means the **commit churn includes binary diffs**. For huge attachments
this is fine but suboptimal — Git LFS support is a future-work item.

## Published site

`PublishManager.collectAll` walks `listAttachments(note)` and queues each
file into a parallel `attachments[]` plan. After page rendering, each
attachment is copied verbatim into `notes/<id>-attachments/<filename>` so
the relative links inside the markdown body resolve naturally.

The build wipes the publish branch's working copy before each run, so
removed attachments stop being served on the next deploy.

## Limitations (intentionally out of scope for the first cut)

- No size cap — multi-GB drops will still try to fit in memory because the
  webview encodes via FileReader. If you need that, add a streaming
  workaround.
- No re-link rewriting on note rename. The folder is keyed by **id**, not
  title, so renames don't break links. But if you manually rename a file
  in the attachments dir on disk, the markdown body won't follow.
- No drag-drop **out** of the note (e.g. reusing an attachment in another
  note). Copy the markdown reference yourself if needed.
- No Git LFS — every push still goes through the standard transport.

## Implementation map

| File | Role |
| --- | --- |
| `packages/core/src/attachments/index.ts` | Pure helpers (sanitise, collision, image detection, markdown emission) |
| `src/notes/notesStore.ts` | `addAttachment`, `listAttachments`, `deleteAttachment`, `attachmentUri`, `importNote(meta, content, attachments?)` |
| `src/notes/notesAttachmentUploader.ts` | Bridges the editor IPC into the store |
| `src/editor/markdownEditorProvider.ts` | `attachAttachmentUploader`, handles `attachUpload` messages |
| `src/webview/main.ts` | `bindDragDropAttachments` — captures files, base64-encodes, posts to host |
| `src/warehouse/warehouseSync.ts` | Copies attachment dirs both ways, indexes them in `_index.json` |
| `src/publish/publishManager.ts` | Copies attachments into the static site |

## Testing

```bash
npx vitest run tests/unit/attachments
```

19 tests cover the pure helpers (filename sanitisation, path traversal,
length cap, collision resolution, image detection, markdown emission).
