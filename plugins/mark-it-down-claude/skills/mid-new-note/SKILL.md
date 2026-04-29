---
name: mid:new-note
description: Create a new Mark It Down note in a chosen category. Use when the user says "save this as a note", "create a note", "make a note about X", or asks to capture an idea / decision / snippet for later.
---

# /mid:new-note

Create a new global note via the bundled Mark It Down MCP server.

## When to invoke

- User says "save this as a note", "make a note", "capture this", "remember this"
- User asks to file a decision, design idea, snippet, or daily entry
- The current conversation produced something the user wants to keep around

## What you'll do

1. **Decide the category.** Default to `Drafts` if the user didn't say. Other common categories: `Daily`, `Reference`, `Snippet`. Ask the user only if their intent is genuinely ambiguous.
2. **Pick a clear title.** Pull from the user's own words. ≤60 chars, sentence case, no trailing punctuation.
3. **Compose the content.** Default body shape:

   ```markdown
   # <Title>

   <one-paragraph context: what triggered this, when, why it matters>

   <body — the actual content, formatted as proper markdown>

   <optional links / references / next-steps>
   ```

4. **Call the MCP tool** `create_note` with `{ title, category, content }`.
5. **Confirm to the user** with the returned note id and a one-line summary.

## Example

User: "Save the postgres tuning we just figured out — connection pooler + index hint together saved 200ms p99."

You:
1. Category: `Reference` (it's a reusable finding, not a daily entry).
2. Title: "Postgres tuning: pooler + index hint cuts p99 by 200ms"
3. Content: a short context paragraph + the actual finding + the relevant SQL.
4. Call `create_note`.
5. Confirm: "Saved as Reference/Postgres tuning: pooler + index hint cuts p99 by 200ms (id: ka9zsb1tfnd2)."

## Failure modes

- **MCP server not configured** → tell the user to install the Mark It Down VSCode extension and run `Mark It Down: Install MCP for Claude Desktop / Code`, OR install this plugin's bundled server (`bin/server.js`) by configuring `MID_NOTES_DIR`.
- **Note dir doesn't exist yet** → the bundled server creates it on first write; no action needed.
