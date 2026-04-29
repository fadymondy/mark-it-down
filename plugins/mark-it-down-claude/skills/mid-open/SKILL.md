---
name: mid:open
description: Read a Mark It Down note's full content. Use when the user says "show me the X note", "what did I write about Y", "open the postgres tuning note", or refers to a note by id or title.
---

# /mid:open

Read a single note from the bundled Mark It Down MCP server and display its content.

## When to invoke

- User asks "what did I write about X"
- User refers to a specific note by title, partial title, or id
- A previous skill listed notes and the user wants to dive into one

## What you'll do

1. **Resolve the note id.**
   - If the user gave an id (12-char alphanumeric), use it directly.
   - If they gave a title or partial title, call `list_notes` first, find the best match (exact match → contains → fuzzy on title), and use its id.
   - If multiple notes match, ask the user to disambiguate by listing the candidates with their categories and timestamps.
2. **Call the MCP tool** `get_note` with `{ id }`. Returns metadata + full markdown content.
3. **Display** the content as-is (markdown). Lead with a one-line header showing title, category, and last-updated date.
4. **Offer follow-ups** if natural: edit (call `update_note`), delete (call `delete_note`), publish via `/mid:publish`, convert to slideshow via `/mid:slideshow`.

## Example

User: "Open my postgres tuning note."

You:
1. Call `list_notes()` (no filter).
2. Find note with title containing "postgres tuning" → id `ka9zsb1tfnd2`.
3. Call `get_note({ id: 'ka9zsb1tfnd2' })`.
4. Display:
   ```
   📝 Postgres tuning: pooler + index hint cuts p99 by 200ms (Reference · updated Apr 22)

   <full markdown content>
   ```

## Tips

- Don't truncate — show the full content. Notes are usually short.
- If the user asks "what did I write about X" without a specific note, prefer `/mid:list-notes` first to surface candidates, then offer to open the most relevant one.
