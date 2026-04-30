# System tray + MCP server

The desktop app installs a system-tray (macOS menu-bar / Windows / Linux tray) entry with the brand `#` template image. The tray is a real surface for the bundled **Model Context Protocol (MCP) server** — start / stop, see status, and one-click install for AI clients.

## Tray menu

| Row | Behavior |
| --- | --- |
| `● MCP server: running` / `○ MCP server: stopped` / `● MCP server: error — <msg>` | Disabled status row at the top. Color dot reflects state. |
| Start MCP | Forks `out/mcp/server.js` as a child process with `MID_TRAY_MANAGED=1`. Disabled while running. |
| Stop MCP | Kills the child process. Disabled while stopped. |
| Install MCP for Claude Code… | Writes the `mark-it-down` server entry into `~/.claude.json#mcpServers`. |
| Install MCP for Cursor… | Writes the same entry into `~/.cursor/mcp.json#mcpServers`. |
| Show window / Hide window | Toggles `mainWindow` visibility. |
| Quit Mark It Down | `app.quit()`. |

## Lifecycle

`startMCP()` runs automatically once the app is ready (so the tray reflects "running" the moment the user opens it). `stopMCP()` runs on `before-quit` to keep the process tree clean. Crashes or non-zero exits flip the status to `error` and surface the message in the tray label.

## Install — what it actually writes

For both clients the format is the standard MCP-server stanza. Example written into `~/.claude.json`:

```json
{
  "mcpServers": {
    "mark-it-down": {
      "command": "node",
      "args": ["/Users/you/Sites/mark-it-down/out/mcp/server.js"]
    }
  }
}
```

The script path resolves at install time via `resolveMCPServerScript()` so the recorded path is absolute and survives the working directory. Restart the AI client (Claude Code / Cursor) for the new server to be picked up.

If `~/.claude.json` already has other `mcpServers`, the install is **non-destructive** — it merges the new entry and rewrites the file with two-space indentation.

## Tray icon

`media/brand/iconTemplate.png` (and the `@2x` / `@3x` densities) generated in #80 by `scripts/build-icons.mjs`. On macOS the icon is marked as a template image (`setTemplateImage(true)`), so the OS recolors it to match the active menu bar (white in dark mode, black in light, blue-tinted when the menu is open).

If the template PNGs aren't found (e.g. fresh checkout without `npm run build:icons`), the tray falls back to the colored 16-px brand asset.

## Files

- `apps/electron/main.ts` — `buildTray`, `rebuildTrayMenu`, `startMCP`, `stopMCP`, `installMCPFor`, `resolveMCPServerScript`, `setMCPStatus`. Tray + MCP wired in `app.whenReady()` and `app.on('before-quit', …)`.

## Verifying

1. `npm run dev:electron` — tray icon shows in menu bar / tray.
2. Open the menu — status row shows `● MCP server: running` immediately.
3. Click **Stop MCP** — status flips to `○ stopped`; **Start MCP** is enabled.
4. Click **Install MCP for Claude Code…** — confirmation dialog cites the path written; open the file and confirm `mcpServers.mark-it-down` is there with absolute `args` path.
5. Quit the app — `out/mcp/server.js` process is gone (`pgrep -f mcp/server.js` should return empty).
