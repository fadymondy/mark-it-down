# Changelog

All notable changes to this extension will be documented in this file.

## [Unreleased]

### Added — Phase 0.7: Notes sidebar (#7)

- Activity-bar view container "Mark It Down" with a dedicated "Notes" tree view
- Notes are grouped by **Scope** (Workspace / Global) → **Category** → **Note**
- Workspace notes live in `context.storageUri`; global notes live in `context.globalStorageUri`. Tree falls back to global-only when no folder is open.
- Note content is a real `.md` file on disk, opened through the existing Mark It Down custom editor — no separate edit surface
- Commands: `markItDown.notes.create`, `.open`, `.rename`, `.move` (between categories), `.delete`, `.refresh`, `.revealStorage`
- Inline tree actions: rename + delete on hover; "+" on scope/category rows for quick-create in context
- View title bar: New Note · Refresh · Reveal Notes Folder
- Welcome view (empty state) with a one-click "New Note" prompt
- Configuration: `markItDown.notes.categories` (default: Daily / Reference / Snippet / Drafts), `.defaultCategory`, `.defaultScope`
- Saving a note (Cmd+S in the custom editor) bumps its `updatedAt` and re-sorts the tree most-recent-first

## [0.1.0] — 2026-04-29

### Added — Initial scaffold + Phase 0.1

- VSCode extension scaffold (TypeScript strict, esbuild for webview)
- Custom Text Editor provider (`markItDown.editor`) registered for `*.md`, `*.mdx`, `*.markdown`
- Read-only markdown rendering via marked + marked-highlight + highlight.js
- Mermaid live rendering for ` ```mermaid ` code blocks (theme-aware, light/dark)
- DOMPurify sanitization of rendered HTML
- Inline textarea editor (Phase 0.2 will replace with Monaco)
- Toggle command: View ↔ Edit
- Stub commands: Export PDF / DOCX / TXT (file-level + explorer context menu)
- VSCode theme bridge — uses `--vscode-*` CSS variables so the renderer matches the active theme
- External link handling — `https://` links open in OS browser
- Code-block per-block "Copy" action (hover-revealed)
- Configuration: `markItDown.theme`, `markItDown.startMode`, `markItDown.mermaid.enabled`
- `.github/` scaffolding: FUNDING, CONTRIBUTING, SECURITY, bug + feature issue templates
