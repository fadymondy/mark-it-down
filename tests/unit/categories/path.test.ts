import { describe, expect, it } from 'vitest';
import {
  categoryHasPrefix,
  childCategoriesAt,
  joinCategoryPath,
  parseCategoryPath,
  rootCategories,
} from '../../../packages/core/src/categories';

describe('parseCategoryPath', () => {
  it('splits on slashes and trims', () => {
    expect(parseCategoryPath('Reference/Postgres/Indexing')).toEqual(['Reference', 'Postgres', 'Indexing']);
  });

  it('drops empty + whitespace-only segments', () => {
    expect(parseCategoryPath('Reference//Postgres/  ')).toEqual(['Reference', 'Postgres']);
  });

  it('handles a flat category', () => {
    expect(parseCategoryPath('Drafts')).toEqual(['Drafts']);
  });
});

describe('joinCategoryPath', () => {
  it('joins segments with slash', () => {
    expect(joinCategoryPath(['Reference', 'Postgres'])).toBe('Reference/Postgres');
  });

  it('drops empty segments', () => {
    expect(joinCategoryPath(['Reference', '', 'Postgres'])).toBe('Reference/Postgres');
  });
});

describe('categoryHasPrefix', () => {
  it('matches exact', () => {
    expect(categoryHasPrefix('Reference/Postgres', 'Reference/Postgres')).toBe(true);
  });

  it('matches strict descendants', () => {
    expect(categoryHasPrefix('Reference/Postgres/Indexing', 'Reference')).toBe(true);
    expect(categoryHasPrefix('Reference/Postgres/Indexing', 'Reference/Postgres')).toBe(true);
  });

  it('does not match siblings', () => {
    expect(categoryHasPrefix('References/Foo', 'Reference')).toBe(false);
  });

  it('empty prefix matches everything', () => {
    expect(categoryHasPrefix('Anything', '')).toBe(true);
  });
});

describe('rootCategories', () => {
  it('returns distinct first segments', () => {
    const all = ['Reference/Postgres', 'Reference/Networking', 'Drafts', 'Daily/2026-04'];
    expect(rootCategories(all).map(n => n.path)).toEqual(['Daily', 'Drafts', 'Reference']);
  });
});

describe('childCategoriesAt', () => {
  const all = [
    'Reference',
    'Reference/Postgres',
    'Reference/Postgres/Indexing',
    'Reference/Networking',
    'Drafts',
  ];

  it('returns immediate children of a parent', () => {
    expect(childCategoriesAt(all, 'Reference').map(n => n.path)).toEqual([
      'Reference/Networking',
      'Reference/Postgres',
    ]);
  });

  it('returns immediate children at root when parent is empty', () => {
    expect(childCategoriesAt(all, '').map(n => n.path)).toEqual(['Drafts', 'Reference']);
  });

  it('does not double-count grandchildren', () => {
    const result = childCategoriesAt(all, 'Reference/Postgres');
    expect(result.map(n => n.path)).toEqual(['Reference/Postgres/Indexing']);
  });

  it('skips the parent path itself even if listed', () => {
    expect(childCategoriesAt(all, 'Reference').map(n => n.path)).not.toContain('Reference');
  });
});
