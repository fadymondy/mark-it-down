# Changelog

All notable changes to this extension will be documented in this file.

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
