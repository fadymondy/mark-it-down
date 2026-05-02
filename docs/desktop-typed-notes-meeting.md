# Meeting custom view (#296)

Follow-up to the typed-notes MVP (#255 / #294). Notes whose `type` is `meeting` now open in a structured form on top of the markdown file instead of the plain markdown editor.

## What it looks like

When the active note's type is `meeting`, the right pane shows a structured grid:

- Header chip identifies the view (blue calendar icon).
- **Date** — native `<input type="date">`.
- **Location** — text input.
- **Attendees** — chip editor; type a name + Enter (or comma) to add. Backspace in an empty input removes the last chip.
- **Agenda** — multi-line markdown textarea.
- **Notes** — multi-line markdown textarea.
- **Decisions** — chip editor (same shape as Attendees).

## Persistence

The view writes one round-trip per mutation. Date / location / chip changes persist on `change` / `blur`; markdown areas debounce at 300ms while typing, then flush on blur.

The file shape stays a usable markdown artifact:

```markdown
---
date: 2026-05-15
attendees:
  - Fady
  - Nada
location: Cairo office
decisions:
  - Ship the PR by EOW
  - Defer plugin marketplace to v0.3
---

## Agenda

- Review tab manager work
- Greenlight typed-notes follow-ups

## Notes

Discussed scope & risk. Tab manager is on a separate branch; we won't merge into typed-notes until #287 lands.
```

Structured metadata lives in the YAML frontmatter so external tooling (gh CLI search, `grep`, custom MCP queries) can filter on `date`, `attendees`, etc. Free-form content lives in the body under `## Agenda` and `## Notes` headings, which the splitter looks for on every load — if the headings are missing (e.g. an externally-edited file), the entire body is treated as Notes so nothing is dropped.

## Code surface

| File | What changed |
| ---- | ------------ |
| `apps/electron/notes/note-types.ts` | `meeting` entry now declares `viewKind: 'meeting'`. |
| `apps/electron/renderer/renderer.ts` | New `renderMeetingEditor()`, `splitAgendaNotes()`, and `buildChipEditor()`; `openNote()` dispatches when `viewKind === 'meeting'`. |
| `apps/electron/renderer/renderer.css` | New `.mid-meeting-*` and `.mid-chip*` styles. |
| `apps/electron/main.ts` | `notes-create` seeds new `meeting` notes with frontmatter (`date`, `attendees`, `location`, `decisions`) plus stub `## Agenda` / `## Notes` sections. |

## Switching back to markdown

Right-click the note row → **Change type…** → pick anything other than Meeting. The full file (frontmatter + body) opens unchanged in the markdown editor.

## Out of scope

- Recurring meetings — single-occurrence only.
- Calendar integration (sync to system Calendar.app / Google Calendar). The frontmatter is intentionally simple so a downstream importer can do that work without us baking it in.
- Per-attendee role chips. Attendees are flat strings; if you need richer attendee metadata, hand-edit the frontmatter.
