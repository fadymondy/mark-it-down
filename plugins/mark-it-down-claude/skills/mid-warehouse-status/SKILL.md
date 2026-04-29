---
name: mid:warehouse-status
description: Show the current Mark It Down warehouse sync state — what's in the local store, what's on the remote, and what's pending. Use when the user says "is my warehouse in sync", "what's pending", "check warehouse".
---

# /mid:warehouse-status

Report the Mark It Down warehouse sync state to the user.

## When to invoke

- User says "is my warehouse in sync", "what's pending", "show warehouse status"
- User reports a sync issue ("my notes aren't on github")
- User wants a sanity check before publishing

## What you'll do

This skill aggregates info from the MCP server (note count + most recent updatedAt) and asks the user to share what their VSCode status bar says (since the MCP server can't see in-flight sync state).

1. **Call `list_notes`** to get the count + most recent timestamps. Don't dump the list — summarize:
   ```
   Warehouse summary (from MCP)
     Notes: 47 across 4 categories
     Most recent: "Sprint 12 retro" — Apr 28 14:32
     Categories: Daily (12), Reference (18), Snippet (9), Drafts (8)
   ```
2. **Ask the user to glance at the status bar** in VSCode (right side, "Notes synced" / "syncing" / "behind" / "conflict" / "error" / "off"). Tell them:
   - **Notes synced (cloud icon)** → all good
   - **Notes behind (cloud-down icon)** → run `Mark It Down: Warehouse: Pull` or `Sync Now`
   - **Notes conflict (warning icon)** → some notes diverged; local copies kept; resolve via the warehouse's GitHub UI then `Pull`
   - **Notes sync error (error icon)** → click the status bar to open the log channel; share the last error with you for triage
3. **Offer follow-ups.**
   - "Want to publish anything? `/mid:publish`"
   - "Want a quick digest of recent notes? `/mid:list-notes` with category filter"
   - "Want to review the last 5 changes?" (use `list_notes` sorted by updatedAt desc)

## Example

User: "Check my warehouse."

You:
1. Call `list_notes()`, get 47 notes, group + summarize.
2. Ask about status-bar state.
3. Offer next-steps.

## Failure modes

- **MCP server not configured** → list_notes errors. Tell the user to install the bundled MCP server (this plugin handles it via `.mcp.json`) and restart Claude.
- **MCP server can see notes but extension can't** → most likely the extension hasn't refreshed; tell them to click the Notes view's `Refresh` button.
