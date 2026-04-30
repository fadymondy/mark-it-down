# Desktop markdown rendering

Polished GitHub-flavored rendering for the desktop view. Built on top of the core renderer in `packages/core/src/markdown` with desktop-only post-processors.

## What's enabled

| Feature | How |
| --- | --- |
| **Syntax highlighting** | `highlight.js/lib/common` (~30 languages, tree-shaken). After `renderMarkdown`, walks every `pre > code` and runs `hljs.highlightElement`. Mermaid blocks are skipped. |
| **Copy buttons** | A `Copy` button is appended to every `<pre>` (top-right, fades in on hover). Uses the Clipboard API; falls back to `Failed` if denied. |
| **Heading anchors** | Each heading gets a slug `id`; a `#` link appears next to the heading on hover and scrolls to it. Duplicate slugs in the same doc get `-1`, `-2` suffixes. |
| **Image lightbox** | All `<img>` get a `cursor: zoom-in` and click into a fixed overlay (Esc or click-anywhere closes). |
| **GitHub typography** | h1–h6 sized like `github.com/.../README`; tighter line-height on headings; task-list checkboxes flush-left. |

## Theme integration

The hljs token colors are embedded directly in `renderer.css`, keyed off `:root` and `:root.dark`. They mirror GitHub's dark/light palettes loosely — close enough that the effect feels native without pulling a 30 KB hljs theme stylesheet into the bundle.

A future pass can wire the per-theme `hljsCss.ts` map (already used by the published-site themes) to let users pick their code palette in the desktop too.

## Files

- `apps/electron/renderer/renderer.ts` — `applySyntaxHighlighting`, `attachCodeCopyButtons`, `attachHeadingAnchors`, `attachImageLightbox`, `openLightbox`.
- `apps/electron/renderer/renderer.css` — copy-button overlay, anchor link, lightbox overlay, hljs token colors, GH-style headings + task lists.

## Verifying

Open any markdown file with code blocks (e.g., `docs/desktop-workspace.md`):

- Code blocks have colored tokens and a Copy button on hover.
- Hover a heading → `#` appears; click it → scrolls + URL hash updates.
- Click an image → lightbox; Esc to close.
- Toggle macOS dark mode → both the markdown chrome and the hljs palette flip together.
