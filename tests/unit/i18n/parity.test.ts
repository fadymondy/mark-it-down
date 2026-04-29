import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

function loadKeys(file: string): string[] {
  return Object.keys(JSON.parse(readFileSync(file, 'utf8'))).sort();
}

describe('i18n parity', () => {
  const baseNls = join(ROOT, 'package.nls.json');
  const baseBundle = join(ROOT, 'l10n', 'bundle.l10n.json');

  const nlsFiles = readdirSync(ROOT)
    .filter(f => f.startsWith('package.nls.') && f.endsWith('.json') && f !== 'package.nls.json')
    .sort();

  const bundleFiles = readdirSync(join(ROOT, 'l10n'))
    .filter(f => f.startsWith('bundle.l10n.') && f.endsWith('.json') && f !== 'bundle.l10n.json')
    .sort();

  it('finds at least 4 locales beyond English for package.nls', () => {
    expect(nlsFiles.length).toBeGreaterThanOrEqual(4);
  });

  it('finds at least 4 locales beyond English for l10n bundle', () => {
    expect(bundleFiles.length).toBeGreaterThanOrEqual(4);
  });

  for (const f of nlsFiles) {
    it(`${f} has the same keys as the English base`, () => {
      const baseKeys = loadKeys(baseNls);
      const otherKeys = loadKeys(join(ROOT, f));
      expect(otherKeys).toEqual(baseKeys);
    });
  }

  for (const f of bundleFiles) {
    it(`l10n/${f} has the same keys as the English base`, () => {
      const baseKeys = loadKeys(baseBundle);
      const otherKeys = loadKeys(join(ROOT, 'l10n', f));
      expect(otherKeys).toEqual(baseKeys);
    });
  }

  it('every value is a non-empty string', () => {
    for (const file of [
      baseNls,
      baseBundle,
      ...nlsFiles.map(f => join(ROOT, f)),
      ...bundleFiles.map(f => join(ROOT, 'l10n', f)),
    ]) {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(data)) {
        expect(typeof v, `${file} key=${k}`).toBe('string');
        expect((v as string).length, `${file} key=${k} empty`).toBeGreaterThan(0);
      }
    }
  });
});
