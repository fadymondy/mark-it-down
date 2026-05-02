# Task-list custom view (#295)

Follow-up to the typed-notes MVP (#255 / #294). Notes whose `type` is `task-list` now open in a dedicated checklist editor instead of the plain markdown editor.

## What it looks like

When the active note's type is `task-list`, the right pane swaps the markdown editor for a checklist editor:

- Header chip identifies the view (green check-square icon).
- One row per task, each with:
  - drag handle,
  - native checkbox (checked = `[x]`),
  - free-text input for the task body,
  - delete button.
- "Add row" button at the bottom appends a fresh empty row.

## Persistence

The view writes the file back to disk on every mutation via the same `mid:write-file` IPC the markdown editor uses, so existing GitHub push / file-history flows keep working unchanged.

The body is plain markdown — one task per line:

```markdown
- [ ] Pull latest main
- [x] Run npm test
- [ ] Open the PR
```

Frontmatter, if present, is preserved verbatim — only the body is owned by the view.

## Editing UX

- **Enter** in a task input creates a new row below it and focuses it.
- **Backspace** in an empty row deletes that row and focuses the row above.
- **Drag a row** by its `⋮⋮` handle to reorder. The drop target highlights with the accent border.
- **Toggle the checkbox** to mark done — the text greys out + strikes through.

## Code surface

| File | What changed |
| ---- | ------------ |
| `apps/electron/notes/note-types.ts` | `task-list` entry now declares `viewKind: 'task-list'`. |
| `apps/electron/renderer/renderer.ts` | New `renderTaskListEditor()` + `parseTaskMarkdown()`; `openNote()` dispatches when `viewKind === 'task-list'`. |
| `apps/electron/renderer/renderer.css` | New `.mid-task-*` styles under the typed-view block. |
| `apps/electron/main.ts` | `notes-create` seeds `task-list` notes with an empty body so the editor has somewhere to start. |

## Switching back to markdown

Right-click the note row → **Change type…** → pick anything other than Task list. The next click opens the file in the markdown editor; tasks remain as `- [ ]` lines so nothing is lost.

## Out of scope

- Nested checklists (sub-tasks). The parser is line-oriented and ignores indentation; sub-tasks would need a separate viewKind.
- Due dates / per-task metadata. Tasks are pure markdown to keep the file diff-friendly; richer scheduling lives in the meeting view (#296) instead.
