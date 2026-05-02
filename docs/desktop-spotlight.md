# Desktop Spotlight (Cmd/Ctrl+K)

The desktop app ships a Spotlight-style command palette that opens with `Cmd+K` (or `Ctrl+K` on Linux/Windows) and lets you jump to any file in the workspace or any line in the active document. The visual design is a port of `@orchestra-mcp/search` (the `SearchSpotlight` component at `orchestra-agents/apps/components/search`); the search behaviour is identical to what shipped in earlier builds.

## Opening + closing

| Action | Result |
| --- | --- |
| `Cmd+K` / `Ctrl+K` | Opens the picker centered over the editor. |
| Click the title-bar search button | Same as `Cmd+K`. |
| `Esc` | Closes the picker. |
| Click the dimmed backdrop | Closes the picker (preserves the contract added in #242). |

The picker is a native `<dialog id="mid-spotlight">` opened with `dlg.showModal()`. The same dialog element is also re-used by:

- `runRepoPicker()` — gh CLI repo browser when connecting a GitHub remote (#228).
- `showFileHistory()` — file history viewer (#219).

Both reuse paths hide the scope tabs and the keyboard-hint footer, run their own renderer, and restore the tab/footer visibility on close. New code that wants to piggy-back on the dialog should follow the same pattern: hide the unwanted controls on open, restore them on close.

## Layout

```
┌────────────────────────────────────────────────┐
│ [ Workspace ]  [ Current file ]                │  ← scope tabs
├────────────────────────────────────────────────┤
│ Type to search…                                │  ← single input
├────────────────────────────────────────────────┤
│ RECENT                                         │  ← group heading
│   <icon> README.md                  README.md  │
│ FILES                                          │
│   <icon> note.md                  notes/n.md   │  ← matched chars highlighted
├────────────────────────────────────────────────┤
│ ↑↓ navigate · Enter open · Tab switch · Esc    │  ← keyboard hint footer
└────────────────────────────────────────────────┘
```

Result rows are grouped under section headings:

| Scope | Sections | Source |
| --- | --- | --- |
| Workspace | `Recent` (only when query is empty), `Files` | `recentFiles` from `appState`, `window.mid.listFolderMd(currentFolder)` |
| Current file | `Headings`, `Lines` | `currentText` parsed line-by-line; `^#+\s` lines route to `Headings` |

Each row renders a left icon (`file` for files, `list-ul` for headings, `search` for line matches), the highlighted name in the middle, and the secondary metadata (relative path, line number) on the right.

### Fuzzy-match preview

The substring of the query that matched inside the row name is wrapped in `<span class="mid-spotlight-match">…</span>` and rendered bold/colored. The match is computed with `String.prototype.indexOf` against the lowercased name (case-insensitive substring match — matching the old behaviour, just visualised). Recent rows do not highlight because the query is empty in that state.

## Keyboard contract

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move selection. Wraps from last → first and vice-versa. |
| `Enter` | Activate the highlighted row (open file, flash line position). |
| `Tab` | Toggle scope between `Workspace` and `Current file`. |
| `Esc` | Close picker. |
| Mouse hover | Updates selection so `Enter` activates the hovered row. |

The footer is a static `#mid-spotlight-footer` element rendered once in `index.html`. Skills that re-use the dialog (history viewer, repo picker) hide it the same way they hide tabs.

## Empty states

| Scope | Query | Message |
| --- | --- | --- |
| Workspace | empty + no recents | "Type to search workspace files." |
| Workspace | non-empty + no hits | "No files match." |
| Current file | no active doc | "No active document." |
| Current file | empty query | "Type to search the active document." |
| Current file | non-empty + no hits | "No matches in this file." |

## Activation behaviour (unchanged from earlier builds)

- File rows call `openRecent(path)` — same code path the recents row in the welcome page uses; preserves the existing `.md`-only filtering.
- Heading + line rows call `flashStatus("Match at line N")`. Live scroll-to-line is a follow-up (tracked separately) — this port intentionally does not change it.

## Event-listener hygiene

`openSpotlight()` registers four listeners (`input.input`, `document.keydown`, `dialog.click`, `tabs.click`) and clears all of them in `close()`. The function is guarded by a `closed` flag so backdrop-click + `Esc` racing each other can't double-tear-down. Repeated `Cmd+K` open → close cycles do not leak listeners.

## Reference + provenance

Ported from: `/Users/fadymondy/Sites/orchestra-agents/apps/components/search` (`SearchSpotlight` component). The grouped-section pattern, the fuzzy-match `<span>`, and the kbd-hint footer follow the reference; the implementation is plain DOM (no React) so it slots into the Electron renderer without changing the build.
