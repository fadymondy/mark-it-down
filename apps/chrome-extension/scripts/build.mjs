/**
 * Build the extension into dist/:
 *   1. clean dist/
 *   2. esbuild-bundle the four entry points (popup, options, viewer, background)
 *   3. copy html + css from src/
 *   4. stamp manifest.json's version from package.json
 *   5. copy brand icons from the repo's build/icons/
 *
 * Cross-platform (node:fs only) so it behaves the same on Windows and CI.
 */

import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url))); // apps/chrome-extension
const repoRoot = path.resolve(root, '..', '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'icons'), { recursive: true });

// 1. Bundle TypeScript entry points.
await build({
  entryPoints: [
    path.join(src, 'popup.ts'),
    path.join(src, 'options.ts'),
    path.join(src, 'viewer.ts'),
    path.join(src, 'background.ts'),
  ],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  outdir: dist,
  logLevel: 'info',
  // packages/core sits above this app; its bare imports (marked, dompurify,
  // highlight.js, …) must resolve from the extension's own node_modules.
  nodePaths: [path.join(root, 'node_modules')],
});

// 2. Static pages + styles.
for (const name of [
  'popup.html', 'popup.css',
  'options.html', 'options.css',
  'viewer.html', 'viewer.css',
]) {
  await copyFile(path.join(src, name), path.join(dist, name));
}

// 3. Manifest with the version stamped from package.json.
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
await writeFile(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// 4. Brand icons from the repo-level rasterized set.
for (const size of [16, 32, 48, 128]) {
  await copyFile(
    path.join(repoRoot, 'build', 'icons', `${size}.png`),
    path.join(dist, 'icons', `icon${size}.png`),
  );
}

console.log(`built dist/ for mark-it-down-chrome v${pkg.version}`);
