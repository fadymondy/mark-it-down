# Mark It Down — Claude Code plugin

Bundles the Mark It Down MCP server, 6 skills, and 3 agents into a single Claude Code plugin. Gives Claude users a one-shot install for the full Mark It Down toolkit — notes warehouse access, slideshow design, public publishing, and curation — without manual MCP wiring.

## What's in the bundle

```
mark-it-down-claude/
├── .claude-plugin/plugin.json       ← plugin manifest
├── .mcp.json                        ← bundled MCP server entry
├── bin/server.js                    ← copied from the extension's out/mcp/server.js at build time
├── skills/                          ← 6 user-invocable skills
│   ├── mid-new-note/SKILL.md
│   ├── mid-list-notes/SKILL.md
│   ├── mid-open/SKILL.md
│   ├── mid-slideshow/SKILL.md
│   ├── mid-publish/SKILL.md
│   └── mid-warehouse-status/SKILL.md
└── agents/                          ← 3 specialist sub-agents
    ├── notes-curator.md
    ├── slideshow-designer.md
    └── note-summarizer.md
```

## Install

### One-shot via the Claude Code marketplace (when published)

```
/plugin marketplace add fadymondy/mark-it-down
/plugin install mark-it-down@mark-it-down
```

### Local dev install

From the Mark It Down repo:

```bash
npm run build:claude-plugin   # copies out/mcp/server.js into plugins/mark-it-down-claude/bin/
claude --plugin-dir ./plugins/mark-it-down-claude
```

After install, set `MID_NOTES_DIR` to your VSCode globalStorage notes dir (the path the Mark It Down extension uses):

| OS | Default path |
|---|---|
| macOS | `~/Library/Application Support/Code/User/globalStorage/fadymondy.mark-it-down/notes` |
| Linux | `~/.config/Code/User/globalStorage/fadymondy.mark-it-down/notes` |
| Windows | `%APPDATA%/Code/User/globalStorage/fadymondy.mark-it-down/notes` |

If you're not running the VSCode extension and want a standalone notes dir, set `MID_NOTES_DIR=~/.mark-it-down/notes`. The bundled server creates the directory on first write.

## Skills

| Skill | When to use |
|---|---|
| `/mid:new-note` | "Save this", "make a note about X" |
| `/mid:list-notes` | "What notes do I have", "list my Drafts" |
| `/mid:open` | "Open the postgres tuning note", "what did I write about Y" |
| `/mid:slideshow` | "Make slides from this", "turn X into a deck" |
| `/mid:publish` | "Publish this note", "share publicly" |
| `/mid:warehouse-status` | "Check warehouse", "is my warehouse in sync" |

## Agents

Specialist sub-agents you can delegate to:

| Agent | Role |
|---|---|
| `notes-curator` | Audits + organizes the warehouse (dedupe, recategorize, generate Index notes) |
| `slideshow-designer` | Restructures long-form markdown into talk-ready slide decks |
| `note-summarizer` | Single-note / category / theme digests for sharing or standups |

## How it composes with the VSCode extension

This plugin **wraps** the same MCP server the VSCode extension installs. Both can run at the same time — they read/write the same on-disk store (`<notes-dir>/_mcp-index.json` + per-note `<id>.md` files). The plugin gives Claude the ability to read/mutate notes without VSCode being open; the extension gives you the rich editor + sidebar + publish UI.

If you only want the Claude side, configure `MID_NOTES_DIR` to a fresh path (e.g. `~/.mark-it-down/notes`) and the plugin runs standalone.

## Versioning

Plugin version is independent of the VSCode extension version. The bundled `bin/server.js` is whatever was last copied via `npm run build:claude-plugin` — re-run that script after extension changes to ship a fresh server build.

## License

MIT — see the parent repo's [LICENSE](../../LICENSE).
