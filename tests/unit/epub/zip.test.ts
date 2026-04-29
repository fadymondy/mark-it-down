import { describe, expect, it } from 'vitest';
import { buildZip, crc32 } from '../../../packages/core/src/epub/zip';
import { inflateRawSync } from 'zlib';

describe('crc32', () => {
  it('matches the known value for ASCII "123456789"', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('handles empty input', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('buildZip', () => {
  it('writes a single stored entry with the right magic bytes', () => {
    const zip = buildZip([{ name: 'mimetype', data: Buffer.from('hello'), method: 0 }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    // Stored entries: compressed size === uncompressed size
    expect(zip.readUInt32LE(18)).toBe(zip.readUInt32LE(22));
  });

  it('round-trips a deflated entry', () => {
    const payload = Buffer.from('hello world hello world hello world');
    const zip = buildZip([{ name: 'a.txt', data: payload }]);
    // Local header is 30 bytes + name + compressed payload
    const compressedSize = zip.readUInt32LE(18);
    const nameLen = zip.readUInt16LE(26);
    const compressed = zip.subarray(30 + nameLen, 30 + nameLen + compressedSize);
    const back = inflateRawSync(compressed);
    expect(back.toString('utf8')).toBe(payload.toString('utf8'));
  });

  it('places mimetype as the first entry when given first', () => {
    const zip = buildZip([
      { name: 'mimetype', data: Buffer.from('application/epub+zip'), method: 0 },
      { name: 'b.txt', data: Buffer.from('after') },
    ]);
    // Local file header for the first entry should be at offset 0 with the mimetype name
    const nameLen = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLen).toString('utf8')).toBe('mimetype');
  });

  it('writes a valid end-of-central-directory record', () => {
    const zip = buildZip([{ name: 'a', data: Buffer.from('x') }]);
    const eocdSig = 0x06054b50;
    const idx = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(idx).toBeGreaterThan(0);
    expect(zip.readUInt32LE(idx)).toBe(eocdSig);
    expect(zip.readUInt16LE(idx + 10)).toBe(1); // total entries
  });
});
