import { describe, expect, it } from 'vitest';
import { buildEpub } from '../../../packages/core/src/epub/builder';
import { inflateRawSync } from 'zlib';

interface ZipEntry { name: string; method: number; data: Buffer; }

function readZipEntries(zip: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= zip.length) {
    const sig = zip.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const uncompressedSize = zip.readUInt32LE(offset + 22);
    const nameLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : inflateRawSync(compressed);
    expect(data.length).toBe(uncompressedSize);
    entries.push({ name, method, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

describe('buildEpub', () => {
  const sample = buildEpub({
    title: 'Sample',
    author: 'Test Author',
    chapters: [
      { title: 'Intro', markdown: '# Intro\n\nHello.' },
      { title: 'Body', markdown: '## Section\n\nBody content.' },
    ],
  });
  const entries = readZipEntries(sample);
  const byName = new Map(entries.map(e => [e.name, e]));

  it('starts with a stored mimetype entry', () => {
    expect(entries[0].name).toBe('mimetype');
    expect(entries[0].method).toBe(0);
    expect(entries[0].data.toString('ascii')).toBe('application/epub+zip');
  });

  it('contains all required structural files', () => {
    expect(byName.has('META-INF/container.xml')).toBe(true);
    expect(byName.has('OEBPS/content.opf')).toBe(true);
    expect(byName.has('OEBPS/nav.xhtml')).toBe(true);
    expect(byName.has('OEBPS/toc.ncx')).toBe(true);
    expect(byName.has('OEBPS/styles.css')).toBe(true);
  });

  it('emits one chapter file per chapter', () => {
    expect(byName.has('OEBPS/chapters/ch-0001.xhtml')).toBe(true);
    expect(byName.has('OEBPS/chapters/ch-0002.xhtml')).toBe(true);
  });

  it('chapter HTML contains the chapter title as h1 + rendered markdown', () => {
    const ch1 = byName.get('OEBPS/chapters/ch-0001.xhtml')!.data.toString('utf8');
    expect(ch1).toContain('<h1>Intro</h1>');
    expect(ch1).toContain('<p>Hello.</p>');
  });

  it('content.opf includes manifest entries for all chapters + nav', () => {
    const opf = byName.get('OEBPS/content.opf')!.data.toString('utf8');
    expect(opf).toContain('href="chapters/ch-0001.xhtml"');
    expect(opf).toContain('href="chapters/ch-0002.xhtml"');
    expect(opf).toContain('properties="nav"');
    expect(opf).toContain('<dc:title>Sample</dc:title>');
    expect(opf).toContain('<dc:creator>Test Author</dc:creator>');
  });

  it('embeds a cover image when provided', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const epub = buildEpub({
      title: 'WithCover',
      author: 'A',
      chapters: [{ title: 'C', markdown: 'body' }],
      cover: { bytes: png, mimeType: 'image/png' },
    });
    const e = readZipEntries(epub);
    const names = e.map(x => x.name);
    expect(names).toContain('OEBPS/cover.png');
    const opf = e.find(x => x.name === 'OEBPS/content.opf')!.data.toString('utf8');
    expect(opf).toContain('properties="cover-image"');
  });

  it('escapes XML-unsafe characters in chapter titles', () => {
    const epub = buildEpub({
      title: 'Esc',
      author: 'A',
      chapters: [{ title: 'a & b <c>', markdown: 'x' }],
    });
    const e = readZipEntries(epub);
    const ch = e.find(x => x.name === 'OEBPS/chapters/ch-0001.xhtml')!.data.toString('utf8');
    expect(ch).toContain('a &amp; b &lt;c&gt;');
  });
});
