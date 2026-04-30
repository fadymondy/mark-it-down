# Markdown features (desktop)

The desktop renderer extends the core marked-based renderer (`packages/core/src/markdown`) with three GitHub-flavored features that aren't in plain GFM:

## 1. YAML frontmatter

A leading `---\n…\n---` block is parsed as YAML and rendered as a styled meta panel **above** the body. The keys are presented as a two-column grid; arrays are joined with commas; objects are JSON-stringified.

````markdown
---
title: Project notes
date: 2026-04-30
tags: [planning, mvp]
status: draft
---

# Body content
````

If the frontmatter is malformed YAML, the original text is preserved verbatim and the meta block is skipped.

## 2. GitHub-style alerts

A blockquote whose first paragraph begins with `[!TYPE]` becomes a colored alert. Five types are supported, mirroring github.com:

| Marker | Color |
| --- | --- |
| `[!NOTE]` | blue |
| `[!TIP]` | green |
| `[!IMPORTANT]` | purple |
| `[!WARNING]` | amber |
| `[!CAUTION]` | red |

The marker is stripped from the rendered text and a labeled icon header is prepended.

```markdown
> [!WARNING]
> Don't run this in production.
```

Each alert gets `.mid-alert` and `.mid-alert--<type>` classes for styling.

## 3. KaTeX math

Inline math: `$ E = mc^2 $`. Display math: `$$ \\int_a^b f(x)\\,dx $$`.

Math is processed **after** the markdown render via a TreeWalker that scans text nodes (skipping nodes inside `<code>`, `<pre>`, `<script>`, `<style>`). Each `$$…$$` is replaced with KaTeX display-mode HTML; each `$…$` with inline-mode HTML. Errors render as a red `<code class="mid-math-error">` with the parser message in the title attribute.

KaTeX's stylesheet ships next to the renderer (`out/electron/renderer/katex.css`); its fonts are copied to `out/electron/renderer/fonts/` so `font-src 'self'` in the CSP is enough.

## Out of scope (follow-up)

- **Footnotes** (`[^1]` markers + `[^1]: definition` blocks) — needs a marked extension; tracked separately.
- **Definition lists** (`Term\\n: Definition`) — same; rare in practice and best handled at parse time.

## Files

- `apps/electron/renderer/renderer.ts` — `extractFrontmatter`, `renderFrontmatterHTML`, `attachAlerts`, `attachMath`, `renderKatex`.
- `apps/electron/renderer/renderer.css` — `.mid-frontmatter*`, `.mid-alert*`, `.katex-display`, `.mid-math-error`.
- `scripts/copy-electron-assets.mjs` — copies `katex.min.css` + KaTeX fonts into the renderer out dir.
- `apps/electron/renderer/index.html` — links `katex.css`.

## Verifying

Open a markdown file with all three features:

````markdown
---
title: Smoke test
date: 2026-04-30
tags: [test, demo]
---

# Headline

> [!NOTE]
> Frontmatter parses, alerts colorize, math renders.

Inline: $a^2 + b^2 = c^2$.

Display:

$$ \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2} $$

> [!WARNING]
> Production check before merging.
````

You should see: a meta panel (title/date/tags), a blue NOTE box, KaTeX-rendered Pythagoras inline + Gauss integral display, and an amber WARNING box.
