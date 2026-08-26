/**
 * Zip dist/ into dist-zip/mark-it-down-chrome-v<version>.zip — the artifact
 * uploaded to GitHub releases (and read back by /api/updates/chrome).
 */

import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const dist = path.join(root, 'dist');

try {
  await access(path.join(dist, 'manifest.json'));
} catch {
  console.error('dist/ is missing — run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const outDir = path.join(root, 'dist-zip');
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `mark-it-down-chrome-v${pkg.version}.zip`);

await new Promise((resolve, reject) => {
  const output = createWriteStream(outFile);
  const archive = archiver('zip', { zlib: { level: 9 } });
  output.on('close', resolve);
  archive.on('error', reject);
  archive.pipe(output);
  archive.directory(dist, false);
  void archive.finalize();
});

console.log(`wrote ${outFile}`);
