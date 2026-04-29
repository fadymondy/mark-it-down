# Per-Page Slug Overrides

Default published-page URLs are `notes/<slug-from-title>-<id>.html` —
guaranteed unique but ugly. A note can override that with a YAML
frontmatter `slug:` field, dropping the id suffix entirely.

## Author the override

Add a frontmatter block at the very top of the note body:

```markdown
---
slug: my-better-url
---

# My Better Title

…
```

Result: the note publishes to `notes/my-better-url.html` instead of
`notes/my-better-title-abc123def456.html`.

## Validation rules

The slug must match `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$` and be ≤48
characters. Anything else (uppercase, whitespace, slashes, leading or
trailing dashes, over-length) is rejected silently and the note falls
back to the title-derived slug + id suffix.

This keeps the URL filesystem-safe and prevents `slug: ../../etc/passwd`
shenanigans.

## Collision handling

Two notes resolving to the same slug would overwrite each other on the
publish branch. The publisher detects this and:

1. Logs a warning to the warehouse log: `slug collision: notes A and B both publish to notes/x.html`.
2. Keeps the first claimant at the clean URL.
3. Falls back to the id-suffixed URL (`notes/<slug>-<id>.html`) for the
   loser, so neither note disappears.
4. Surfaces a one-shot `showWarningMessage` so you notice and rename one
   of them.

The first-come-first-served order matches the iteration order over the
notes index, which is unstable across runs — don't rely on which note
"wins"; rename one of the conflicting slugs as soon as you see the
warning.

## Frontmatter parser

The bundled parser lives in `packages/core/src/frontmatter/index.ts` and
recognises:

* simple `key: value` pairs (string, number, boolean)
* quoted strings (`"hello"`, `'world'`)
* inline lists (`tags: [a, "b c", d]`)
* `null` / `~` (treated as empty string)
* `# comment` lines and blank lines (skipped)
* a single leading blank line after the closing fence is consumed so
  bodies start where you'd expect

Anything richer than that — nested objects, multi-line strings, anchors —
is intentionally out of scope; pull a real YAML lib if you need it.

## Other frontmatter fields

Only `slug` is acted on today. The parser leaves the rest of the parsed
data on `FrontmatterResult.data`, so future features (custom
`description`, `og:image`, `published_at`, etc.) can plumb through
without touching the parser again.

## Implementation map

| File | Role |
| --- | --- |
| `packages/core/src/frontmatter/index.ts` | Parser + `validateSlug` + `stripFrontmatter` |
| `src/publish/publishManager.ts` | `collectAll` parses each note, picks slug, detects collisions, warns; `publishCurrent` strips frontmatter for arbitrary markdown files too |

## Testing

```bash
npx vitest run tests/unit/frontmatter
```

15 tests cover parser branches (no-fence, fenced + stripped, scalar
types, lists, comments, missing closing fence, BOM tolerance, leading
blank line) and slug validation (lowercase-dash, digits, rejected
patterns, length cap, non-string input).
