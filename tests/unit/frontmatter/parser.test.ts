import { describe, expect, it } from 'vitest';
import {
  parseFrontmatter,
  stripFrontmatter,
  validateSlug,
} from '../../../packages/core/src/frontmatter';

describe('parseFrontmatter', () => {
  it('returns no data when there is no fence', () => {
    const r = parseFrontmatter('# Just a heading\nbody');
    expect(r.found).toBe(false);
    expect(r.data).toEqual({});
    expect(r.body).toBe('# Just a heading\nbody');
  });

  it('parses a fenced block + strips it from the body', () => {
    const r = parseFrontmatter('---\nslug: my-page\ntitle: "Hello"\n---\n\n# Body');
    expect(r.found).toBe(true);
    expect(r.data).toEqual({ slug: 'my-page', title: 'Hello' });
    expect(r.body).toBe('# Body');
  });

  it('supports booleans, numbers, lists', () => {
    const r = parseFrontmatter(`---
draft: true
priority: 3
score: 1.5
tags: [one, "two three", four]
---
body`);
    expect(r.data).toEqual({
      draft: true,
      priority: 3,
      score: 1.5,
      tags: ['one', 'two three', 'four'],
    });
  });

  it('skips comments + blank lines inside the block', () => {
    const r = parseFrontmatter('---\n# comment\nslug: a\n\nfoo: bar\n---\n');
    expect(r.data).toEqual({ slug: 'a', foo: 'bar' });
  });

  it('handles a missing closing fence by treating the whole thing as body', () => {
    const r = parseFrontmatter('---\nslug: nope\nstill no fence here\n# Body');
    expect(r.found).toBe(false);
    expect(r.data).toEqual({});
  });

  it('tolerates a UTF-8 BOM', () => {
    const r = parseFrontmatter('﻿---\nslug: x\n---\nbody');
    expect(r.found).toBe(true);
    expect(r.data.slug).toBe('x');
  });

  it('drops a single leading blank line after the closing fence', () => {
    const r = parseFrontmatter('---\nslug: a\n---\n\n\n# Body');
    expect(r.body).toBe('\n# Body');
  });
});

describe('stripFrontmatter', () => {
  it('returns the body without the fenced block', () => {
    expect(stripFrontmatter('---\nslug: a\n---\nbody')).toBe('body');
  });

  it('passes through bodies without frontmatter', () => {
    expect(stripFrontmatter('hello world')).toBe('hello world');
  });
});

describe('validateSlug', () => {
  it('accepts a simple lowercase-dash slug', () => {
    expect(validateSlug('my-better-url')).toBe('my-better-url');
  });

  it('accepts digits', () => {
    expect(validateSlug('post-2026-01')).toBe('post-2026-01');
  });

  it('rejects uppercase, whitespace, and special chars', () => {
    expect(validateSlug('My Slug')).toBeUndefined();
    expect(validateSlug('slug!')).toBeUndefined();
    expect(validateSlug('with/slash')).toBeUndefined();
  });

  it('rejects leading + trailing dashes', () => {
    expect(validateSlug('-leading')).toBeUndefined();
    expect(validateSlug('trailing-')).toBeUndefined();
  });

  it('rejects empty + over-length', () => {
    expect(validateSlug('')).toBeUndefined();
    expect(validateSlug('a'.repeat(50))).toBeUndefined();
  });

  it('rejects non-strings', () => {
    expect(validateSlug(42)).toBeUndefined();
    expect(validateSlug(undefined)).toBeUndefined();
  });
});
