import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const out = 'out/electron/renderer';
mkdirSync(out, { recursive: true });

const copies = [
  ['apps/electron/renderer/index.html', join(out, 'index.html')],
  ['apps/electron/renderer/renderer.css', join(out, 'renderer.css')],
  ['packages/ui-tokens/src/tokens.css', join(out, 'tokens.css')],
  ['packages/ui-tokens/src/primitives.css', join(out, 'primitives.css')],
];
for (const [src, dest] of copies) copyFileSync(src, dest);
