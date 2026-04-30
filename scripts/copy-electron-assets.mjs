import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = 'out/electron/renderer';
mkdirSync(out, { recursive: true });

const copies = [
  ['apps/electron/renderer/index.html', join(out, 'index.html')],
  ['apps/electron/renderer/renderer.css', join(out, 'renderer.css')],
  ['packages/ui-tokens/src/tokens.css', join(out, 'tokens.css')],
  ['packages/ui-tokens/src/primitives.css', join(out, 'primitives.css')],
  ['packages/ui-tokens/src/icons.css', join(out, 'icons.css')],
  ['node_modules/katex/dist/katex.min.css', join(out, 'katex.css')],
];
for (const [src, dest] of copies) copyFileSync(src, dest);

// Copy KaTeX fonts (the stylesheet references them via relative URLs).
const fontsSrc = 'node_modules/katex/dist/fonts';
const fontsDest = join(out, 'fonts');
mkdirSync(fontsDest, { recursive: true });
for (const f of readdirSync(fontsSrc)) {
  copyFileSync(join(fontsSrc, f), join(fontsDest, f));
}
