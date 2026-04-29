---
name: mid:list-notes
description: List Mark It Down notes from the warehouse. Use when the user says "what notes do I have", "show my notes about X", "list my Drafts", or asks for a summary of recent activity.
---

# /mid:list-notes

List notes from the bundled Mark It Down MCP server.

## When to invoke

- User says "list my notes", "what notes do I have on X", "show my Drafts", "show recent notes"
- User asks for an overview of a particular category
- A previous skill needs the note list to pick a target (defer to /mid:open instead if they want to read one)

## What you'll do

1. **Decide if filtering by category.** If the user named one ("show my Drafts"), pass it. Otherwise list all.
2. **Call the MCP tool** `list_notes` with `{ category?: string }`. Returns an array of metadata objects.
3. **Summarize** for the user — most-recent-first, grouped by category if they're listing all. Show: title, category, updatedAt (relative if today, date otherwise).
4. **Don't dump JSON.** Format as a readable list.

## Example

User: "What notes do I have in Reference?"

You:
1. Call `list_notes({ category: 'Reference' })`.
2. Format:
   ```
   Reference (5):
   • Postgres tuning: pooler + index hint cuts p99 by 200ms — Apr 22
   • API pagination conventions — Apr 19
   • Sentry alert tuning runbook — Apr 14
   • TLS cert rotation checklist — Apr 7
   • OpenTelemetry span naming — Mar 30
   ```

## Tips

- If the warehouse has hundreds of notes, show the top 20 and offer to `list_notes` with another filter.
- For "recent notes across all categories," sort by `updatedAt` descending and cap at 10.
