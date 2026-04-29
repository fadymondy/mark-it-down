import { describe, expect, it } from 'vitest';
import {
  attachmentDirName,
  attachmentMarkdown,
  isImageAttachment,
  relativeAttachmentPath,
  resolveCollision,
  sanitizeAttachmentName,
} from '../../../packages/core/src/attachments';

describe('attachmentDirName', () => {
  it('appends -attachments to the note id', () => {
    expect(attachmentDirName('abc123')).toBe('abc123-attachments');
  });
});

describe('relativeAttachmentPath', () => {
  it('joins the dir + filename with a slash', () => {
    expect(relativeAttachmentPath('abc', 'photo.png')).toBe('abc-attachments/photo.png');
  });
});

describe('sanitizeAttachmentName', () => {
  it('strips unsafe characters and runs of whitespace', () => {
    expect(sanitizeAttachmentName('My Photo (1).png')).toBe('My-Photo-1-.png');
  });

  it('strips path traversal segments', () => {
    expect(sanitizeAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeAttachmentName('C:\\Windows\\System32\\foo.dll')).toBe('foo.dll');
  });

  it('falls back to "attachment" for empty input', () => {
    expect(sanitizeAttachmentName('')).toBe('attachment');
    expect(sanitizeAttachmentName('!!!')).toBe('attachment');
  });

  it('caps stem length while preserving extension', () => {
    const long = 'a'.repeat(120) + '.png';
    const out = sanitizeAttachmentName(long);
    expect(out.endsWith('.png')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(96);
  });
});

describe('resolveCollision', () => {
  it('returns the original name when no collision', () => {
    expect(resolveCollision('a.png', [])).toBe('a.png');
  });

  it('appends -1, -2, … on collision', () => {
    expect(resolveCollision('a.png', ['a.png'])).toBe('a-1.png');
    expect(resolveCollision('a.png', ['a.png', 'a-1.png'])).toBe('a-2.png');
    expect(resolveCollision('a.png', ['a.png', 'a-1.png', 'a-2.png'])).toBe('a-3.png');
  });

  it('handles names without extensions', () => {
    expect(resolveCollision('LICENSE', ['LICENSE'])).toBe('LICENSE-1');
  });
});

describe('isImageAttachment', () => {
  it.each([
    ['photo.png', true],
    ['photo.PNG', true],
    ['photo.jpeg', true],
    ['vector.svg', true],
    ['notes.pdf', false],
    ['archive.zip', false],
    ['no-extension', false],
  ])('detects %s as image=%s', (name, expected) => {
    expect(isImageAttachment(name)).toBe(expected);
  });
});

describe('attachmentMarkdown', () => {
  it('emits ![]() for images', () => {
    expect(attachmentMarkdown('abc', 'photo.png')).toBe('![photo.png](abc-attachments/photo.png)');
  });

  it('emits []() for non-images', () => {
    expect(attachmentMarkdown('abc', 'spec.pdf')).toBe('[spec.pdf](abc-attachments/spec.pdf)');
  });

  it('respects custom label', () => {
    expect(attachmentMarkdown('abc', 'spec.pdf', 'See spec')).toBe('[See spec](abc-attachments/spec.pdf)');
  });
});
