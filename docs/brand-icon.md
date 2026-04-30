# Brand icon — markdown `#` glyph

The Mark It Down app icon is a stylized markdown heading-syntax glyph (`#`) embossed on a rounded-square page. The glyph signals "markdown" explicitly (heading syntax), the page silhouette signals "document app", and the warm cream-on-navy palette gives a friendly, app-store-friendly feel that holds up at every size from 16 px to 1024 px.

## Files

| Path | Purpose |
| --- | --- |
| `media/brand/icon.svg` | Primary 1024×1024 source — color, gradient, soft shadow under the glyph for emboss. Slight `-8°` italic skew on the verticals for editorial flair. |
| `media/brand/icon-mono.svg` | Monochrome silhouette for macOS template images and overlays — pure-black fill, no gradients. macOS recolors based on context. |
| `build/icons/<n>.png` | Color rasters at 16/32/48/64/128/256/512/1024 + the electron-builder Linux convention `512x512.png`. |
| `media/brand/icon.icns` | macOS app icon, 10-pair iconset (16×16 → 512×512 @1x and @2x) packed via `iconutil`. |
| `media/brand/icon.ico` | Windows app icon, 6 sizes (16, 32, 48, 64, 128, 256) packed via ImageMagick. |
| `media/brand/iconTemplate{,@2x,@3x}.png` | macOS template image set (1×, 2×, 3×) for menu bar / dock badge use. |
| `media/icon.png` | 512 px copy of the color icon, referenced by `package.json#icon` for the VSCode marketplace listing. |

## Regenerating

Both source SVGs are the source of truth. To regenerate every output:

```bash
npm run build:icons
```

This runs `scripts/build-icons.mjs`, which requires:

- `@resvg/resvg-js` (npm) — Rust SVG renderer with full gradient/filter/transform support. Cross-platform; auto-installed via `npm install`.
- `magick` (ImageMagick) on `PATH` — only used to pack the multi-size `.ico` for Windows.
- `iconutil` — Apple-supplied, only present on macOS. The `.icns` step is macOS-only.

> **Why resvg, not magick, for the SVGs?** `magick` falls back to its internal MSVG renderer when `librsvg` isn't installed. That fallback drops gradients and filters, producing a grayscale silhouette (see PR for #88). `@resvg/resvg-js` does the rasterization in-process with full SVG fidelity.

The script overwrites `build/icons/` and the platform icon files in `media/brand/` deterministically; the SVGs are the only diffable source. Commit the regenerated binaries — they are small (~250 KB total) and prevent CI from needing the same toolchain.

## Wiring

`package.json#build`:

```json
{
  "mac":   { "icon": "media/brand/icon.icns" },
  "win":   { "icon": "media/brand/icon.ico" },
  "linux": { "icon": "build/icons" }
}
```

For dev (`npm run dev:electron`), `apps/electron/main.ts` resolves `build/icons/512.png` and passes it to `BrowserWindow({ icon })` plus `app.dock.setIcon()` on macOS so the dev dock/taskbar already shows the brand art.

In packaged builds, `electron-builder` ignores the runtime `BrowserWindow.icon` on macOS (the .app bundle's icon takes over) — that's why the `.icns` is mandatory for the packaged dist.

## Design notes

- The page silhouette is a 200 px-radius rounded square inside a 1024-square viewBox, giving ~22% corner radius — between Apple's "squircle" (~25%) and a softer rectangle. Reads as a document at small sizes, as an app icon at large sizes.
- The `#` glyph is built from four rectangles with 46 px end-radii so each bar terminates with a half-circle. The two vertical bars are `skewX(-8°)` to suggest forward motion / italic markdown.
- The cream→amber gradient on the glyph and the navy→indigo gradient on the page give just enough depth to feel native at any size without going skeuomorphic.
