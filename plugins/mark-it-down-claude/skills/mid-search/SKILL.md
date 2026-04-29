---
name: mid:search
description: Fuzzy search across all Mark It Down notes — title + category + body. Use when the user asks "what notes do I have about X", "find my notes mentioning Y", or names a topic without a specific note title.
---

# /mid:search

Run a fuzzy search across the Mark It Down notes warehouse via the bundled MCP server's `search_notes` tool.

## When to invoke

- User asks "what did I write about X" or "find my notes mentioning Y"
- User names a topic / keyword without a specific note title
- User wants a snippet preview before opening a note

## What you'll do

1. **Call the MCP tool** `search_notes` with `{ query: string, limit?: number }`. Default limit 25.
2. **Format the response** as a readable hit list, ranked by score:
   ```
   3 hits for "postgres":

   1. Postgres tuning: pooler + index hint cuts p99 by 200ms (Reference · score 11)
      …connection pooler plus an index hint cut p99 by 200ms. Also bumped work_mem…

   2. Sprint 12 retro (Daily · score 1)
      …postgres migration scheduled for next Monday…
   ```
3. **Offer follow-ups** — "Open hit 1?" routes to `/mid:open`. The `id` field on each hit is what `get_note` accepts.

## Tips

- For "show me everything" requests, prefer `/mid:list-notes` (cheaper; no body load).
- For "find anything about X" requests, this is the right tool — it indexes title + category + body.
- The scoring weights title matches highest (10/exact, 5/partial), category next (3), then body (1 per occurrence, capped at 5).
- For very short queries (1-2 chars), search is noisy — ask the user to refine if hit count is large and scores are uniformly low.

## Failure modes

- **MCP server not configured** → tell user to install via the Mark It Down extension or the Claude plugin's bundled `bin/server.js`.
- **No hits** → not a failure; tell the user "no notes match \"<query>\"" and suggest `/mid:list-notes` to browse instead.
