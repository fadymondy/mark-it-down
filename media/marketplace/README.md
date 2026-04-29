# Marketplace screenshots

The VSCode Marketplace listing pulls images from this directory. Each one should be:

- **Format**: PNG (preferred) or JPEG
- **Width**: 1280px (Marketplace renders at 1200px max; allow some headroom)
- **Theme**: dark or light, but be consistent within a single capture set
- **Filename**: numeric prefix for ordering (`01-editor.png`, `02-notes-sidebar.png`, …)

Capture these for the v1.0 listing:

| File | What to show |
|---|---|
| `01-editor.png` | Mark It Down rendering a real markdown file with a heading + table + code block + mermaid diagram |
| `02-notes-sidebar.png` | The Notes activity-bar view expanded with both Workspace + Global scopes and a couple of categories populated |
| `03-pick-theme.png` | The `Mark It Down: Pick Theme` Quick Pick mid-selection, surfacing 3-5 of the bundled themes |
| `04-warehouse-sync.png` | The status bar's "Notes synced" indicator + a brief view of the warehouse repo's notes/ directory on GitHub |
| `05-slideshow.png` | A slideshow preview panel beside an editor showing the source markdown |
| `06-publish.png` | The published GitHub Pages site rendering one of the user's notes |

After capture, reference them in `package.json#galleryBanner` style won't work — Marketplace pulls the images from the README rendered at install time. Add inline references in the project README's "Screenshots" section that use the `media/marketplace/<file>.png` path; the `vsce` packaging step bundles them.

## Recording the captures

1. Open VSCode with the dev-host extension loaded (F5)
2. Set the theme to `github-dark` for the dark captures (or `github-light` for the light captures)
3. Open a generous markdown file (the `docs/` folder has lots of options)
4. Use macOS `Cmd+Shift+5` to capture the editor area; trim chrome with Preview if needed
5. Save to this folder with the right filename

## Recommended size budget

Total of 6 PNGs at 1280×800 ≈ 1.5MB; well under the Marketplace's 2MB per-image limit. Keep individual files under 500KB each — Marketplace warns above that.
