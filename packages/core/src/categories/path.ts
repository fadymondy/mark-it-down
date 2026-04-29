/**
 * Category names support `/` as a hierarchy separator.
 * `Reference/Postgres` lives under the `Reference` parent in the tree;
 * `Reference/Postgres/Indexing` is a deeper child of that.
 *
 * The category string itself remains the canonical id — these helpers are
 * pure-function projections used by the tree, MCP filters, and tests.
 */

const SEPARATOR = '/';

export interface CategoryNode {
  /** Last path segment, e.g. `Postgres`. */
  name: string;
  /** Full path from the root, e.g. `Reference/Postgres`. */
  path: string;
}

/** Split a category path into its segments, trimming + dropping empties. */
export function parseCategoryPath(category: string): string[] {
  return category
    .split(SEPARATOR)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/** Join trusted segments back into a category path. */
export function joinCategoryPath(segments: string[]): string {
  return segments
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .join(SEPARATOR);
}

/** True if `child` is the exact same path or sits underneath `prefix`. */
export function categoryHasPrefix(child: string, prefix: string): boolean {
  const childSegs = parseCategoryPath(child);
  const prefixSegs = parseCategoryPath(prefix);
  if (prefixSegs.length === 0) return true;
  if (prefixSegs.length > childSegs.length) return false;
  for (let i = 0; i < prefixSegs.length; i++) {
    if (childSegs[i] !== prefixSegs[i]) return false;
  }
  return true;
}

/**
 * Given the set of all category strings under a scope and an optional
 * parent path, return the immediate children: distinct next-segments
 * keyed by their full path.
 *
 * Example: categories `Reference`, `Reference/Postgres`, `Reference/Networking`,
 * with parent `Reference` → returns `[{name:'Postgres', path:'Reference/Postgres'},
 * {name:'Networking', path:'Reference/Networking'}]`.
 */
export function childCategoriesAt(allCategories: string[], parent: string): CategoryNode[] {
  const parentSegs = parseCategoryPath(parent);
  const seen = new Map<string, CategoryNode>();
  for (const cat of allCategories) {
    const segs = parseCategoryPath(cat);
    if (segs.length <= parentSegs.length) continue;
    let matchesParent = true;
    for (let i = 0; i < parentSegs.length; i++) {
      if (segs[i] !== parentSegs[i]) {
        matchesParent = false;
        break;
      }
    }
    if (!matchesParent) continue;
    const childPath = joinCategoryPath(segs.slice(0, parentSegs.length + 1));
    if (!seen.has(childPath)) {
      seen.set(childPath, { name: segs[parentSegs.length], path: childPath });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Top-level (root) categories: distinct first segments from the corpus.
 */
export function rootCategories(allCategories: string[]): CategoryNode[] {
  return childCategoriesAt(allCategories, '');
}

/**
 * True if a category value is rendered as a "leaf" — the user has notes
 * directly at this path (rather than only inside its children).
 */
export function hasNotesAtPath(allCategories: string[], path: string): boolean {
  return allCategories.includes(path);
}
