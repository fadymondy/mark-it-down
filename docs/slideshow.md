# Slideshow Export

Status: shipped in Phase 0.11 · Issue: [#12](https://github.com/fadymondy/mark-it-down/issues/12) · Depends on: [#11 Publish to GitHub Pages](publish.md)

Convert any markdown file into a [reveal.js](https://revealjs.com) slideshow — preview locally inside a VSCode webview, or publish to the warehouse repo's pages branch and share a public URL. Slide breaks come from the standard `---` markdown HR (which doubles as reveal.js's slide separator); vertical slides use `--`.

## At a glance

| | |
|---|---|
| **Engine** | reveal.js v5 (loaded from JSDelivr at view time — no bundle bloat) |
| **Slide breaks** | `---` (horizontal), `--` (vertical / nested) |
| **Frontmatter** | YAML-style at top of file: `theme`, `transition`, `title`, `speakerNotes` |
| **Local preview** | `Mark It Down: Slideshow: Preview Local` opens a webview panel beside the editor |
| **Publish** | `Mark It Down: Slideshow: Publish` reuses the F10 publish pipeline; pushes a single HTML to `<publish-branch>/<publish-path>/slides/<basename>.html` |
| **Speaker notes** | `Notes:` line in a slide body — everything after becomes `<aside class="notes">` |

## Authoring

A minimal slide deck:

````markdown
---
title: My talk
theme: night
transition: fade
---

# Welcome

A subtitle line

---

## Section heading

- bullet one
- bullet two

--

## A vertical sub-slide

This appears below the previous one when navigating with arrow-down.

---

## Code

```ts
console.log('hello');
```

Notes:
This is a speaker note. It only shows in the speaker view (press `s` in reveal.js).
````

That's a 4-slide deck (one is a vertical sub-slide).

## Local preview

`Mark It Down: Slideshow: Preview Local` opens a webview panel beside the editor and renders the deck. Standard reveal.js controls apply — arrow keys, `f` for fullscreen, `s` for speaker view, `o` for the overview grid, `?` for the help cheatsheet.

The preview panel uses a permissive CSP (loads reveal.js, mermaid, highlight.js CSS from JSDelivr at view time). The CSP relaxation is **scoped to the slideshow panel only** — the main custom editor's CSP stays strict.

The preview is a one-shot render — edit the markdown and re-run the command to see updates. Live reload on save is a future-work seed.

## Publish

`Mark It Down: Slideshow: Publish`:

1. Renders the active markdown with the configured theme/transition.
2. Reuses the F10 publish pipeline's git-worktree-against-warehouse approach.
3. Pushes the rendered HTML to `<publish-branch>/<publish-path>/slides/<basename>.html` (defaults: `gh-pages`, root, slugified file basename).
4. Surfaces an info toast with `Open` and `Copy URL` actions.

Requires both `markItDown.warehouse.repo` and `markItDown.publish.enabled` to be set — slideshow publish is a layered feature on top of F9 + F10.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `markItDown.slideshow.theme` | `"black"` | Reveal.js theme. Built-ins: `black, white, league, beige, night, serif, simple, solarized, moon, dracula, sky, blood`. Frontmatter `theme:` overrides per-deck. |
| `markItDown.slideshow.transition` | `"slide"` | `none / fade / slide / convex / concave / zoom`. Frontmatter `transition:` overrides per-deck. |
| `markItDown.slideshow.includeSpeakerNotes` | `true` | Render lines after `Notes:` as reveal speaker notes. |

## Frontmatter reference

A YAML-ish block at the very top of the markdown file (between two `---` lines) sets per-deck options. Recognized keys:

| Key | Type | Default |
|---|---|---|
| `title` | string | filename basename |
| `theme` | string | settings value (`black`) |
| `transition` | string | settings value (`slide`) |
| `speakerNotes` | boolean | settings value (`true`) |

Unknown keys are ignored.

## Speaker notes

Anywhere in a slide body, a line starting with `Notes:` flips everything after it into the slide's speaker notes. They show in reveal's speaker view (`s` key) — never in the main slide.

```markdown
## Slide title

The visible body.

Notes:
- Mention the customer story
- Don't forget to pause for the demo
```

## Mermaid + code highlighting in slides

- **Mermaid**: any ` ```mermaid ` block becomes a `<div class="mermaid">` in the rendered slide; mermaid loads from CDN at view time and renders with the matching theme (dark for dark reveal themes, default otherwise).
- **Code blocks**: highlight.js's `atom-one-dark` theme is loaded from CDN. The reveal.js highlight plugin can be added later for per-line stepping.

## PDF export

The `Slideshow: Export to PDF` command currently surfaces an info message pointing at reveal.js's built-in PDF print mode — append `?print-pdf` to the published URL and use the browser's "Save as PDF" Print dialog. Bundling a headless chromium for in-process PDF generation is out of scope (would push the .vsix size past 150MB). Tracked as future work.

## Edge cases

- **No `---` separators**: the whole file becomes one slide. Useful for single-slide quick previews.
- **Frontmatter without closing `---`**: not detected; the leading `---` becomes a slide break and the would-be frontmatter renders as the first slide. Make sure the closing `---` is on its own line followed by `\n`.
- **Markdown HR vs slide break ambiguity**: any `---` on its own line between two blank lines becomes a slide break. Inline HRs (e.g. inside a list) are not affected.
- **Publish without warehouse / publish disabled**: surfaces a clear message with an Open Settings action.
- **Cross-deck shared assets**: each slideshow ships with its own CDN references; nothing is shared between published slideshows. This means each one is fully self-contained.
- **CSP**: the local preview uses a permissive CSP scoped to the slideshow panel. The main custom editor's strict CSP is unchanged.

## Files of interest

- [src/slideshow/slideshowGenerator.ts](../src/slideshow/slideshowGenerator.ts) — `buildSlideshow` parses frontmatter, splits slides, renders each via marked, wraps in reveal.js HTML; `template()` emits the full HTML page with reveal.js + mermaid + highlight.js loaded from JSDelivr
- [src/slideshow/slideshowManager.ts](../src/slideshow/slideshowManager.ts) — `previewLocal` (webview panel), `publish` (warehouse worktree + write + commit + push), `copyShareUrl`, `exportPdf` (defer notice)
- [src/slideshow/slideshowCommands.ts](../src/slideshow/slideshowCommands.ts) — 4 VSCode command registrations
- [src/extension.ts](../src/extension.ts) — wires SlideshowManager + commands on activation
- [package.json](../package.json) — 4 commands + 3 `markItDown.slideshow.*` settings
