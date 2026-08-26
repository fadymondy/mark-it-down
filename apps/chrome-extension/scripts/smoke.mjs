/**
 * Smoke test: bundle packages/core renderMarkdown exactly as the viewer
 * does, run it under a jsdom window (DOMPurify needs a DOM), and assert
 * the HTML output looks sane. No test framework needed.
 */

import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const outFile = path.join(root, 'dist-smoke', 'render.cjs');

await build({
  stdin: {
    contents: "module.exports = require('../../packages/core/src/markdown/renderer');",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: outFile,
  logLevel: 'silent',
  nodePaths: [path.join(root, 'node_modules')],
});

// DOMPurify binds to the global window at require time.
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const require = createRequire(import.meta.url);
const { renderMarkdown } = require(outFile);

const sample = [
  '# Smoke heading',
  '',
  'Some *emphasis* and a [link](https://example.com).',
  '',
  '```js',
  'const answer = 42;',
  '```',
  '',
  '```mermaid',
  'graph TD; A-->B;',
  '```',
].join('\n');

const result = renderMarkdown(sample, { extractMermaid: false });

const checks = [
  ['h1 rendered', result.html.includes('Smoke heading') && result.html.includes('<h1')],
  ['emphasis rendered', result.html.includes('<em>emphasis</em>')],
  ['link rendered', result.html.includes('href="https://example.com"')],
  ['hljs highlighting applied', result.html.includes('hljs')],
  ['mermaid left as fenced code', result.html.includes('language-mermaid') && result.mermaidBlocks.length === 0],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed = true;
}

await rm(path.join(root, 'dist-smoke'), { recursive: true, force: true });

if (failed) {
  console.error('smoke test failed');
  process.exit(1);
}
console.log('smoke test passed');
