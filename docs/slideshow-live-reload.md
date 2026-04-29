# Slideshow Live Reload

The slideshow preview (`Mark It Down: Slideshow: Preview Local`) used to
be a one-shot render — edit the source markdown, re-run the command to
see updates. It now hot-reloads on every keystroke and on file save,
preserving the slide position you're currently looking at.

## Behaviour

* **First render** opens a webview panel beside the editor.
* **On document change** (debounced 120ms), the panel rebuilds with the
  fresh markdown.
* **On explicit save**, the rebuild is immediate (no debounce).
* The webview reports its current slide position via postMessage on
  every `slidechanged` / `fragmentshown` / `fragmenthidden` event; the
  host caches it.
* On rebuild, the cached `{h, v, f}` is baked into the new HTML; the
  bridge script's `Reveal.on('ready', …)` calls `Reveal.slide(h, v, f)`
  so you stay on the slide you were looking at.
* Re-running the preview command on a document that already has a panel
  just reveals + rebuilds the existing one, no duplicate opens.

## Disabling URL hash routing

Reveal's normal URL-hash routing (`#/2/1`) doesn't survive panel
re-renders inside a VSCode webview, and would conflict with our
position-restore script. So in live mode the bridge sets
`Reveal.initialize({ hash: false })`. Outside live mode (publish path,
embed) the URL hash still works.

## Configuration

No new settings — live reload is on by default for all preview panels.
Existing slideshow settings (`markItDown.slideshow.theme`,
`.transition`, `.includeSpeakerNotes`) and YAML frontmatter overrides
all still apply.

## Implementation

| File | Role |
| --- | --- |
| `src/slideshow/slideshowGenerator.ts` | New `liveReload?: { initialIndex? }` option. When set, injects a small bridge script: `acquireVsCodeApi`, `Reveal.on('ready' / 'slidechanged' / 'fragmentshown' / 'fragmenthidden')`, posts `slideshow.position` + `slideshow.ready` to the host. Disables Reveal's hash routing. |
| `src/slideshow/slideshowManager.ts` | `previewLocal` now manages a `Map<docUri, PreviewSession>` — first-time creates a panel + wires `onDidChangeTextDocument` (debounced) + `onDidSaveTextDocument` (immediate); subsequent calls reveal + rebuild the existing one. `handleWebviewMessage` caches the latest position. `dispose()` cleans every session. |
| `src/extension.ts` | Adds `slideshow` to `context.subscriptions` so panel watchers + timers tear down on extension deactivate. |

## Performance

The 120ms debounce was picked to feel instant on typing without thrashing
the rebuild on every keystroke. Reveal initialization is fast (<50ms
locally) since the assets ship from JSDelivr CDN with browser caching;
the slow path is the first cold load only.

## Limitations

- Panel-to-panel: changes to a markdown file only refresh **the panel
  whose document URI matches it**. Two panels previewing different files
  don't cross-talk; that's intentional.
- Mermaid diagrams re-render from scratch on every rebuild — no
  incremental update. For dense slides this can flicker; a future
  optimisation would diff the slide HTML and only swap changed sections.
- Theme + transition changes via settings still require closing + re-opening
  the panel — they're injected as `<link>` and Reveal config at
  initialise-time.

## Testing

```bash
npx vitest run tests/unit/slideshow
```

5 tests cover the bridge: bridge absent when liveReload is omitted,
present when set; hash routing toggle; initial-index baking; missing
initial-index falls back to `null`.
