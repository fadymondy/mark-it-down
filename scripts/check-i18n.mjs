#!/usr/bin/env node
/**
 * Verifies that every `package.nls.<lang>.json` and `l10n/bundle.l10n.<lang>.json`
 * file has the same keys as the English source.
 *
 * Exits 0 when everything's parity, 1 with a per-file report otherwise.
 *
 * Wired into CI via .github/workflows/ci.yml so missing translations
 * don't slip through.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const errors = [];

function loadKeys(file) {
  const raw = readFileSync(file, 'utf8');
  return Object.keys(JSON.parse(raw)).sort();
}

function compare(label, baseFile, otherFile) {
  const base = new Set(loadKeys(baseFile));
  const other = new Set(loadKeys(otherFile));
  const missing = [...base].filter(k => !other.has(k));
  const extra = [...other].filter(k => !base.has(k));
  if (missing.length || extra.length) {
    errors.push({ label, baseFile, otherFile, missing, extra });
  }
}

// Compare package.nls.<lang>.json against package.nls.json
const baseNls = join(root, 'package.nls.json');
const nlsFiles = readdirSync(root).filter(
  f => f.startsWith('package.nls.') && f.endsWith('.json') && f !== 'package.nls.json',
);
for (const f of nlsFiles) {
  compare(f, baseNls, join(root, f));
}

// Compare l10n/bundle.l10n.<lang>.json against l10n/bundle.l10n.json
const l10nDir = join(root, 'l10n');
const baseBundle = join(l10nDir, 'bundle.l10n.json');
const bundleFiles = readdirSync(l10nDir).filter(
  f => f.startsWith('bundle.l10n.') && f.endsWith('.json') && f !== 'bundle.l10n.json',
);
for (const f of bundleFiles) {
  compare(`l10n/${f}`, baseBundle, join(l10nDir, f));
}

if (errors.length === 0) {
  console.log(`i18n parity OK — checked ${nlsFiles.length + bundleFiles.length} locale file(s).`);
  process.exit(0);
}

for (const e of errors) {
  console.error(`✗ ${e.label}`);
  if (e.missing.length) console.error(`  missing keys (${e.missing.length}): ${e.missing.join(', ')}`);
  if (e.extra.length) console.error(`  extra keys (${e.extra.length}): ${e.extra.join(', ')}`);
}
process.exit(1);
