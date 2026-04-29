# Claude Code Plugin (mark-it-down-claude)

Status: shipped in Phase 0.13 · Issue: [#14](https://github.com/fadymondy/mark-it-down/issues/14) · Depends on: [#7 Notes sidebar](notes-sidebar.md), [#9 MCP server](mcp-server.md), [#10 Notes warehouse](notes-warehouse.md), [#11 Publish](publish.md), [#12 Slideshow](slideshow.md)

The Mark It Down Claude Code plugin packages the bundled MCP server, 6 user-invocable skills, and 3 specialist sub-agents into a single installable unit. One install gives Claude Desktop / Claude Code users the full Mark It Down toolkit — note CRUD, slideshow design, public publish, warehouse curation — without any manual MCP wiring.

## At a glance

| | |
|---|---|
| **Where it lives** | `plugins/mark-it-down-claude/` in this repo (intended to be moved to a dedicated repo `fadymondy/mark-it-down-claude` for marketplace distribution) |
| **What ships** | `.claude-plugin/plugin.json` manifest, `.mcp.json` server entry, `bin/server.js` (built copy), 6 skills, 3 agents, README |
| **Bundle target** | `npm run build:claude-plugin` copies `out/mcp/server.js` → `plugins/mark-it-down-claude/bin/server.js` so the plugin is self-contained |
| **Install** | Local: `claude --plugin-dir ./plugins/mark-it-down-claude`. Marketplace (when published): `/plugin install mark-it-down@mark-it-down` |

## What's in the bundle

```
plugins/mark-it-down-claude/
├── .claude-plugin/plugin.json       ← name, version, author, license
├── .mcp.json                        ← mcpServers["mark-it-down"] entry pointing at bin/server.js
├── bin/server.js                    ← copied from out/mcp/server.js by build:claude-plugin
├── README.md                        ← user-facing install + usage docs
├── skills/
│   ├── mid-new-note/SKILL.md
│   ├── mid-list-notes/SKILL.md
│   ├── mid-open/SKILL.md
│   ├── mid-slideshow/SKILL.md
│   ├── mid-publish/SKILL.md
│   └── mid-warehouse-status/SKILL.md
└── agents/
    ├── notes-curator.md
    ├── slideshow-designer.md
    └── note-summarizer.md
```

## The 6 skills

User-invocable via the standard `/skill-name` syntax in Claude Desktop / Code.

| Skill | When to use | Tool calls |
|---|---|---|
| `/mid:new-note` | "Save this", "make a note about X" | `create_note` |
| `/mid:list-notes` | "What notes do I have", "list my Drafts" | `list_notes` |
| `/mid:open` | "Open the X note", "what did I write about Y" | `list_notes` (resolve) → `get_note` |
| `/mid:slideshow` | "Make slides from this", "turn X into a deck" | `get_note` (if from a note); produces slide-ready markdown for the F11 publish pipeline |
| `/mid:publish` | "Publish this note", "share publicly" | `get_note`; tells the user the exact F10 publish command to run |
| `/mid:warehouse-status` | "Check warehouse", "is my warehouse in sync" | `list_notes` (count + recency) + asks user about VSCode status bar |

Skills 4 and 5 (slideshow, publish) intentionally **do not** push directly — the publish pipeline lives in the VSCode extension. The skills produce the input + tell the user the right command.

## The 3 agents

Specialist sub-agents the user (or another skill) can delegate to.

### `notes-curator`

Audits + organizes the warehouse — dedupes, recategorizes, generates Index notes. Conservative: proposes batches, never deletes without confirmation, doesn't edit note bodies. Operates exclusively through the MCP `list_notes` / `get_note` / `update_note` / `create_note` / `delete_note` tools.

### `slideshow-designer`

Restructures long-form markdown into talk-ready decks. Adds frontmatter (theme, transition), inserts slide breaks, splits dense paragraphs, adds speaker notes via `Notes:` blocks. Outputs slide-ready markdown for the F11 reveal.js generator. Designer, not transcriber — never invents content; if the source is thin, asks the user.

### `note-summarizer`

Single-note / category / theme digests. Faithful to source (no invention), useful before exhaustive (top 3–5 bullets), format-aware (standup digest vs blog intro vs retrospective). Pure-read — doesn't write back to the warehouse.

## How install works

The plugin's `.mcp.json` entry tells Claude Desktop / Code how to launch the bundled MCP server:

```jsonc
{
  "mcpServers": {
    "mark-it-down": {
      "command": "node",
      "args": [
        "${CLAUDE_PLUGIN_ROOT}/bin/server.js",
        "--notes-dir",
        "${MID_NOTES_DIR}"
      ],
      "env": {
        "MID_NOTES_DIR": "${HOME}/.mark-it-down/notes"
      }
    }
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` is replaced by Claude with the plugin's install dir. `${MID_NOTES_DIR}` defaults to `~/.mark-it-down/notes` (standalone use); users running the VSCode extension should override it to the extension's globalStorage path so both Claude and VSCode see the same notes:

| OS | VSCode extension's notes dir |
|---|---|
| macOS | `~/Library/Application Support/Code/User/globalStorage/fadymondy.mark-it-down/notes` |
| Linux | `~/.config/Code/User/globalStorage/fadymondy.mark-it-down/notes` |
| Windows | `%APPDATA%/Code/User/globalStorage/fadymondy.mark-it-down/notes` |

Restart Claude Desktop / Code after install (MCP configs are read at startup).

## Build & ship

```bash
npm run build:claude-plugin
```

Re-runs the MCP server bundle (`compile:mcp`) and copies `out/mcp/server.js` into `plugins/mark-it-down-claude/bin/server.js`. Run this whenever the MCP server source changes so the plugin ships a fresh build.

For marketplace distribution, the plugin directory is intended to live in its own repo (`fadymondy/mark-it-down-claude`). The build script is non-destructive — it just refreshes `bin/server.js`. To produce a release, sync the directory to the dedicated repo, tag it (`v0.1.0`), and use the standard `/plugin marketplace add` flow.

## How it composes with the VSCode extension

Both run against the **same** on-disk store (`<notes-dir>/_mcp-index.json` + per-note `<id>.md` files). The VSCode extension owns the canonical state (writes the snapshot on every NotesStore change); the Claude plugin reads from + mutates the same files via the MCP server.

Standalone-only use is supported: just leave `MID_NOTES_DIR` at the default `~/.mark-it-down/notes` and the plugin operates without VSCode.

## Limitations

- **Workspace-scope notes are invisible** to the plugin. They live per-VSCode-window and aren't addressable from outside. Use the warehouse repo (F9) to surface workspace notes across machines/clients.
- **`get_active_markdown` and `list_open_md` are stubs** in the underlying MCP server — they require a live IPC channel between the running VSCode extension and the spawned MCP server, which is on the v1+ roadmap. The skills don't try to use them.
- **The plugin lives in this repo for now.** Marketplace distribution requires moving it to its own repo (`fadymondy/mark-it-down-claude`) — `npm run build:claude-plugin` produces a fully self-contained directory you can sync over.
- **Plugin version is independent** of the VSCode extension version. Re-run `build:claude-plugin` after extension changes to ship a fresh server build.

## Files of interest

- [plugins/mark-it-down-claude/](../plugins/mark-it-down-claude/) — the entire plugin
- [plugins/mark-it-down-claude/.claude-plugin/plugin.json](../plugins/mark-it-down-claude/.claude-plugin/plugin.json) — manifest
- [plugins/mark-it-down-claude/.mcp.json](../plugins/mark-it-down-claude/.mcp.json) — server entry
- [plugins/mark-it-down-claude/skills/](../plugins/mark-it-down-claude/skills/) — 6 SKILL.md files
- [plugins/mark-it-down-claude/agents/](../plugins/mark-it-down-claude/agents/) — 3 agent definitions
- [plugins/mark-it-down-claude/README.md](../plugins/mark-it-down-claude/README.md) — user-facing install + usage docs
- [package.json](../package.json) — `build:claude-plugin` script
