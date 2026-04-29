# MCP Server (stdio) for Claude Desktop / Code

Status: shipped in Phase 0.9 · Issue: [#9](https://github.com/fadymondy/mark-it-down/issues/9)

A standalone stdio MCP server bundled inside the `.vsix` exposes your global Mark It Down notes to Claude Desktop and Claude Code. Install with one click; the server reads from the same on-disk store the [Notes sidebar](notes-sidebar.md) writes to.

## At a glance

| | |
|---|---|
| **Server binary** | `out/mcp/server.js` (bundled by esbuild from `src/mcp/server.ts`, ~1.1MB CJS, Node 18+) |
| **Transport** | stdio (`@modelcontextprotocol/sdk`'s `StdioServerTransport`) |
| **CLI args** | `--notes-dir <path>` — required; the directory containing `_mcp-index.json` and the `<id>.md` files |
| **Install** | `Mark It Down: Install MCP for Claude Desktop / Code` command |
| **Scope** | Global notes only (workspace notes are per-VSCode-window and not addressable from outside) |
| **Tools** | `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note` |
| **Deferred to v1+** | `get_active_markdown`, `list_open_md` (registered as stubs that return a clear "requires extension IPC" error) |

## How it works

```
┌────────────────────────────┐         ┌─────────────────────────────────┐
│ Claude Desktop / Code      │ stdin/  │ out/mcp/server.js               │
│ — McpClient                │ stdout  │ — McpServer + StdioTransport    │
│ — sees Mark It Down tools  │◄──────► │ — reads NotesAdapter            │
└────────────────────────────┘         │   on the on-disk store          │
                                       └─────────────────────────────────┘
                                                          │ reads
                                                          ▼
                                       ┌─────────────────────────────────┐
                                       │ globalStorage/notes/            │
                                       │   _mcp-index.json (snapshot)    │
                                       │   <id>.md (one per note)        │
                                       └─────────────────────────────────┘
                                                          ▲ writes
                                                          │ on every
                                                          │ NotesStore change
                                       ┌─────────────────────────────────┐
                                       │ VSCode extension (Notes sidebar)│
                                       │ — NotesStore                    │
                                       │ — writeMcpIndexSnapshot()       │
                                       └─────────────────────────────────┘
```

The extension owns the canonical state (workspaceState/globalState index + `<id>.md` files). On every change to the global-scope notes, it writes a `_mcp-index.json` snapshot under `globalStorage/notes/` that the MCP server reads.

The MCP server runs as a separate Node process spawned by Claude Desktop/Code per the standard MCP launch model. It does not require VSCode to be running — but mutations made via MCP tools while the extension is also running will only be visible in the Notes sidebar after a tree refresh (the extension watches the index file via the standard NotesStore change events; cross-process change detection is on the roadmap).

## Install

Run `Mark It Down: Install MCP for Claude Desktop / Code` from the command palette. You'll get a Quick Pick:

| Target | Where the config lands |
|---|---|
| **Claude Desktop** | macOS `~/Library/Application Support/Claude/claude_desktop_config.json` · Windows `%APPDATA%/Claude/...` · Linux `~/.config/Claude/...` |
| **Claude Code (project-level)** | `<workspace>/.mcp.json` (or `~/.mcp.json` if no folder is open) |

Pick one, and the install command:

1. Reads (or creates) the target JSON config
2. Adds an `mcpServers["mark-it-down"]` entry pointing at the bundled server with the right `--notes-dir` for your VSCode global storage
3. Offers `Reveal Config` to inspect the result

The entry looks like:

```jsonc
{
  "mcpServers": {
    "mark-it-down": {
      "command": "/path/to/node",
      "args": [
        "/path/to/extension/out/mcp/server.js",
        "--notes-dir",
        "/Users/you/Library/Application Support/Code/User/globalStorage/fadymondy.mark-it-down/notes"
      ]
    }
  }
}
```

After installing, **restart** Claude Desktop or Claude Code so it picks up the new server. From the next session, you'll have the Mark It Down tools available.

There's a companion command `Mark It Down: Show MCP Server Path (copy to clipboard)` that just copies the absolute path to the bundled `server.js` for users who want to wire it into other MCP clients manually.

## Tools

All tools take JSON inputs and return text content blocks. The server is registered as `mark-it-down` v0.9.0.

### `list_notes(category?)`

List global notes. Optionally filter by category.

```json
{ "category": "Reference" }
```

Returns a JSON array of note metadata: `{ id, title, category, scope, createdAt, updatedAt, filename }`.

### `get_note(id)`

Read one note by id. Returns metadata + full markdown content as two text blocks.

```json
{ "id": "ka9zsb1tfnd2" }
```

### `create_note(title, category, content?)`

Create a new global note. `content` defaults to `# <title>\n\n`.

```json
{ "title": "API design notes", "category": "Reference" }
```

Returns the created note's metadata.

### `update_note(id, ...patch)`

Patch any of `title`, `category`, `content`. Bumps `updatedAt`.

```json
{ "id": "ka9zsb1tfnd2", "content": "# Updated body\n..." }
```

### `delete_note(id)`

Permanently delete a note. No soft-delete.

### `get_active_markdown` ✓ (v0.9.1)

Returns the markdown currently open in the active VSCode editor. Requires `--ipc-sock` to be set when the MCP server launches (the install command sets it automatically). Returns `null` when no markdown editor is active. Returns an `isError` result if the IPC channel can't be reached (extension not running, stale socket).

Response shape:

```jsonc
{
  "uri": "file:///path/to/note.md",
  "fsPath": "/path/to/note.md",
  "content": "# the full markdown body",
  "isDirty": false,
  "languageId": "markdown"
}
```

### `list_open_md` ✓ (v0.9.1)

Lists every open `.md` / `.mdx` document in the running VSCode. Same IPC requirements as above. Returns an empty array when no markdown is open.

Response shape:

```jsonc
[
  { "uri": "file:///path/to/a.md", "fsPath": "/path/to/a.md", "isDirty": false, "isActive": true  },
  { "uri": "file:///path/to/b.md", "fsPath": "/path/to/b.md", "isDirty": true,  "isActive": false }
]
```

### How the IPC channel works (v0.9.1+)

On extension activation, `McpIpcServer` listens on a Unix-domain socket (POSIX) or named pipe (Windows). Endpoint:

| OS | Endpoint |
|---|---|
| macOS / Linux | `${globalStorageUri}/mid-mcp.sock` |
| Windows | `\\.\pipe\mark-it-down-<hash-of-globalStorage>` |

The MCP server spawns with `--ipc-sock <endpoint>` (passed automatically by the `Install MCP for Claude Desktop / Code` command). When `get_active_markdown` or `list_open_md` is called, it connects, sends a newline-delimited JSON request, awaits the matching `id` response, then closes the socket. One connection per call — cheap at MCP's volume, no pool / reconnect logic needed.

If the extension isn't running (or `--ipc-sock` was omitted), both tools return a clear error explaining the requirement.

## What lives where

| Path | Purpose | Owner |
|---|---|---|
| `out/mcp/server.js` | Bundled MCP server entry | extension build |
| `src/mcp/server.ts` | MCP server source (registers tools, wires StdioTransport) | source |
| `src/mcp/notesAdapter.ts` | File-system notes I/O (read index + content, mutate both) | source |
| `src/mcp/installCommand.ts` | VSCode commands that write the MCP entry to client configs | source |
| `globalStorage/.../notes/_mcp-index.json` | Snapshot of global note metadata, written by the extension | extension runtime |
| `globalStorage/.../notes/<id>.md` | Each note's markdown content | extension + MCP both write |

## Edge cases & limitations

- **MCP server can't see workspace-scope notes.** Workspace notes live in `<workspaceStorage>/notes/` per workspace; the MCP server has no way to enumerate VSCode workspaces. Workspace notes are exposed through the [warehouse repo](notes-warehouse.md) instead.
- **Concurrent writes.** If the MCP server creates/updates a note while the extension is mid-save on a different note, they race on the index file. The extension's `writeMcpIndexSnapshot()` and the MCP server's `writeIndex` both rewrite the whole file; last writer wins. Real cross-process locking is a future addition.
- **Stale index after MCP-side mutations.** When the MCP server creates/updates/deletes notes, the extension does NOT automatically refresh its sidebar — its in-memory index stays current with `workspaceState`/`globalState`, not the on-disk `_mcp-index.json`. After running MCP-side mutations, click the Notes sidebar `Refresh` button to re-read from disk. Auto-watching the index file from inside the extension is a follow-up.
- **`get_active_markdown` / `list_open_md`** are stubs that return a clear error. Don't bind workflows to them in v0.9.
- **`--notes-dir` must exist.** First time: install via the command (which uses the absolute global-storage path) OR create the directory manually.
- **Restart required.** Claude Desktop / Code only re-reads MCP configs at startup. After install, restart the client.

## Files of interest

- [src/mcp/server.ts](../src/mcp/server.ts) — server entry, McpServer + 7 tool registrations
- [src/mcp/notesAdapter.ts](../src/mcp/notesAdapter.ts) — pure-Node fs adapter (`listNotes`, `getNote`, `createNote`, `updateNote`, `deleteNote`)
- [src/mcp/installCommand.ts](../src/mcp/installCommand.ts) — `markItDown.mcp.install` (Quick Pick + JSON-merge into client config), `markItDown.mcp.revealServer`
- [src/notes/notesStore.ts](../src/notes/notesStore.ts) — `writeMcpIndexSnapshot()` writes the snapshot the MCP server reads
- [src/extension.ts](../src/extension.ts) — wires the install commands and the snapshot-on-change listener
- [package.json](../package.json) — `compile:mcp` build step (esbuild → CJS Node18); `markItDown.mcp.install` + `markItDown.mcp.revealServer` command registrations
