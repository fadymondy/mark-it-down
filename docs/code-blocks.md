# Code-block toolbar

Each rendered `<pre>` (excluding mermaid blocks) gets:

- A **language badge** in the top-left, lowercase, derived from `language-<n>` on the inner `<code>`. Hidden when no language is declared.
- A floating **toolbar** in the top-right that fades in on hover with four actions:

| Icon | Action |
| --- | --- |
| `list-ul` | Toggle line numbers (per-block, no persistence) |
| `copy` | Copy to clipboard — flashes "Copied" on success |
| `download` | Download as `snippet.<ext>` based on detected language |
| `image` | Export the rendered block as a PNG (2× pixel ratio) |

## Language → file extension

The map in `LANG_TO_EXT` (renderer.ts) covers the common set: `ts`, `js`, `jsx`/`tsx`, `py`, `rb`, `sh` (sh/bash/zsh), `json`, `yml`, `md`, `html`, `xml`, `css`, `scss`, `go`, `rs`, `java`, `kt`, `swift`, `c`, `cpp`, `cs`, `sql`, `php`, `diff`. Unknown languages fall back to `.txt`. `dockerfile` and `makefile` use their canonical filename instead of an extension.

## Line numbers

Off by default — clicking the **Lines** icon adds `.with-lines` to the `<pre>`, which switches it from a single column to a 2-column grid (gutter + code) and shows a `<span class="mid-code-gutter">` filled with line numbers. State is per-block and resets on each render.

## PNG export

Uses `html-to-image` (`toPng`) at `pixelRatio: 2`. The background colour is read from the live `--mid-code-bg` custom property so the exported image matches the current theme. Triggers a download of `code.png`.

## Files

- `apps/electron/renderer/renderer.ts` — `attachCodeBlockToolbar`, `LANG_TO_EXT`, `detectCodeLanguage`, `downloadCode`, `exportCodeBlockAsPNG`, `addLineNumbers`, helpers `makeIconButton` / `flashButton`.
- `apps/electron/renderer/renderer.css` — `.mid-pre`, `.mid-code-toolbar`, `.mid-code-tool-btn`, `.mid-code-lang`, `.mid-code-gutter`, `.mid-pre.with-lines`.

## Verifying

Open any markdown file with code fences. Hover a block:

- Toolbar fades in top-right.
- Click `list-ul` — line-numbered gutter appears.
- Click `copy` — clipboard fills; button flashes "Copied".
- Click `download` — file dialog or auto-download with `snippet.<ext>`.
- Click `image` — `code.png` saves with the same theme palette.
