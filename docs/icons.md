# Icons — Boxicons SVG system

The desktop renderer uses inline SVG icons from [Boxicons](https://boxicons.com) (MIT). Emoji glyphs (📁 📂 💾 ✏️ etc.) have been removed from the chrome — they rendered inconsistently across OSes and felt unprofessional.

## Why inline SVG, not the icon font?

- The full `boxicons.css` font is ~200 KB; we use ~20 icons.
- Inline SVG inherits `currentColor`, so a button's hover/active state recolors the icon for free — no extra style hooks.
- Single network request elimination: icons ship in the renderer bundle, not as a separate asset.

## Adding a new icon

1. Find the icon at https://boxicons.com (regular set preferred for consistency).
2. Copy the `<path>`/`<circle>` markup from `node_modules/boxicons/svg/regular/bx-<name>.svg` (or `logos/bxl-<name>.svg`).
3. Add an entry to `packages/ui-tokens/src/icons.ts`:

   ```ts
   newicon: {
     viewBox: '0 0 24 24',
     body: '<path d="..."/>',
   },
   ```

4. Use it from anywhere in the renderer:

   ```ts
   import { iconHTML } from '../../../packages/ui-tokens/src/icons';
   button.innerHTML = iconHTML('newicon');
   ```

   For declarative HTML buttons in `index.html`, use the data attributes — `hydrateIconButtons()` will swap them on load:

   ```html
   <button class="mid-btn" data-icon="newicon" data-label="Do it"></button>
   ```

## Sizing & color

- Default: 16×16, `fill: currentColor` (so it inherits whatever the surrounding text color is).
- Modifiers: `mid-icon--sm` (14px), `mid-icon--lg` (20px), `mid-icon--xl` (24px), `mid-icon--muted` (uses `--mid-fg-muted`).

## Where they're wired

- Toolbar buttons (`index.html`) — declarative via `data-icon`.
- File-tree rows (`renderer.ts#renderTreeEntry`) — folder/folder-open/file + chevron.
- Code-block copy button (`renderer.ts#attachCodeCopyButtons`).

## Current set

`folder`, `folder-open`, `file`, `save`, `show`, `edit`, `columns`, `refresh`, `copy`, `download`, `cog`, `search`, `plus`, `trash`, `x`, `chevron-right`, `github`, `link`, `tag`, `list-ul`, `bookmark`, `image`.

## Source attribution

Boxicons is MIT-licensed (https://github.com/atisawd/boxicons/blob/master/LICENSE). The icons are reproduced under that license.
