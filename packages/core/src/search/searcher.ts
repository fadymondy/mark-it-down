/**
 * Tiny zero-dep fuzzy + token-based searcher used by the Notes sidebar
 * and the MCP search_notes tool. The published-site search uses Lunr
 * separately because it needs a pre-built index.
 *
 * Algorithm:
 *   1. Tokenize the query into lowercased words
 *   2. For each note, score = sum of per-token contribution:
 *      - exact title match → +10
 *      - title contains token → +5
 *      - category contains token → +3
 *      - body contains token → +1 (per occurrence, capped at 5)
 *   3. Drop notes with score 0
 *   4. Sort by descending score; tie-break by recency (updatedAt desc)
 *   5. Snippet: first body line containing any matched token, padded ±40 chars
 */

export interface SearchableNote {
  id: string;
  title: string;
  category: string;
  scope: 'workspace' | 'global';
  updatedAt: string;
  body: string;
}

export interface SearchHit {
  id: string;
  title: string;
  category: string;
  scope: 'workspace' | 'global';
  updatedAt: string;
  score: number;
  snippet: string;
}

const SNIPPET_PAD = 40;
const SNIPPET_MAX = 160;

export function searchNotes(
  notes: SearchableNote[],
  rawQuery: string,
  limit = 25,
): SearchHit[] {
  const tokens = tokenize(rawQuery);
  if (tokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const note of notes) {
    const titleLower = note.title.toLowerCase();
    const categoryLower = note.category.toLowerCase();
    const bodyLower = note.body.toLowerCase();
    let score = 0;

    for (const tok of tokens) {
      if (titleLower === tok) score += 10;
      else if (titleLower.includes(tok)) score += 5;
      if (categoryLower.includes(tok)) score += 3;
      if (bodyLower.includes(tok)) {
        const occurrences = countOccurrences(bodyLower, tok);
        score += Math.min(occurrences, 5);
      }
    }

    if (score === 0) continue;

    hits.push({
      id: note.id,
      title: note.title,
      category: note.category,
      scope: note.scope,
      updatedAt: note.updatedAt,
      score,
      snippet: buildSnippet(note.body, tokens),
    });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return hits.slice(0, limit);
}

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,;]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) >= 0) {
    count++;
    pos += needle.length;
  }
  return count;
}

function buildSnippet(body: string, tokens: string[]): string {
  if (body.length === 0) return '';
  const bodyLower = body.toLowerCase();
  let bestPos = -1;
  for (const tok of tokens) {
    const idx = bodyLower.indexOf(tok);
    if (idx >= 0 && (bestPos < 0 || idx < bestPos)) bestPos = idx;
  }
  if (bestPos < 0) {
    return body.slice(0, SNIPPET_MAX).replace(/\s+/g, ' ').trim();
  }
  const start = Math.max(0, bestPos - SNIPPET_PAD);
  const end = Math.min(body.length, bestPos + SNIPPET_MAX - SNIPPET_PAD);
  let snippet = body.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < body.length) snippet = snippet + '…';
  return snippet;
}
