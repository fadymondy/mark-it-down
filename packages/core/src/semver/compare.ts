/**
 * Tiny semver comparison sufficient for "is the released version newer than
 * what we have installed". Handles `vX.Y.Z` prefix, drops pre-release tags,
 * zero-pads short versions, and falls back to 0 for malformed parts.
 */

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function parseSemver(v: string): [number, number, number] {
  const cleaned = v.replace(/^v/, '').split('-')[0];
  const parts = cleaned.split('.').map(p => Number.parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}
