import { describe, expect, it } from 'vitest';
import { compareSemver, parseSemver } from '../../src/updates/updateChecker';

describe('parseSemver', () => {
  it('parses major.minor.patch', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
  });

  it('strips leading v', () => {
    expect(parseSemver('v1.2.3')).toEqual([1, 2, 3]);
  });

  it('drops pre-release suffixes', () => {
    expect(parseSemver('1.2.3-rc.1')).toEqual([1, 2, 3]);
    expect(parseSemver('v0.1.0-beta.2')).toEqual([0, 1, 0]);
  });

  it('zero-pads short versions', () => {
    expect(parseSemver('1')).toEqual([1, 0, 0]);
    expect(parseSemver('1.2')).toEqual([1, 2, 0]);
  });

  it('falls back to zero for malformed parts', () => {
    expect(parseSemver('1.foo.3')).toEqual([1, 0, 3]);
    expect(parseSemver('')).toEqual([0, 0, 0]);
  });
});

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
  });

  it('returns negative when a < b', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareSemver('1.9.9', '2.0.0')).toBeLessThan(0);
    expect(compareSemver('0.1.0', '1.0.0')).toBeLessThan(0);
  });

  it('returns positive when a > b', () => {
    expect(compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('treats pre-release tags as equal to the stable version', () => {
    // updateChecker drops the suffix; that's the documented behavior.
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBe(0);
  });

  it('handles common update-prompt scenarios', () => {
    // installed 0.1.0, release 0.1.1 → user should be notified
    expect(compareSemver('0.1.1', '0.1.0')).toBeGreaterThan(0);
    // installed 0.2.0, release 0.1.5 → should NOT notify
    expect(compareSemver('0.1.5', '0.2.0')).toBeLessThan(0);
  });
});
