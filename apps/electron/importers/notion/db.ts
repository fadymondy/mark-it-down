/**
 * Notion database CSV → markdown index page.
 *
 * Notion's export pairs every database with a sibling folder of the same
 * (hash-stripped) name. The CSV holds the database's column values; the
 * folder holds one `.md` per row. We turn the CSV into a single
 * `<dbname>` markdown note whose body is a GFM table — the first column
 * (the row title) is rendered as a link to the corresponding row page.
 *
 * The CSV parser is intentionally tiny — no dependencies. It supports:
 *
 * - Comma separators (`,`).
 * - Quoted fields with `""` escaping.
 * - Embedded newlines inside quoted fields.
 * - Trailing CRLF.
 *
 * That covers Notion's export, which always uses RFC 4180 quoting.
 */

import { stripNotionHash } from './normalize';

export interface NotionDbRow {
  /** Original cell values, in column order. */
  cells: string[];
}

export interface NotionDbTable {
  /** Header row — column names. */
  headers: string[];
  /** Data rows. */
  rows: NotionDbRow[];
}

/**
 * Parse a CSV string into header + rows. Returns `null` if the input is
 * empty so callers can short-circuit.
 */
export function parseCsv(input: string): NotionDbTable | null {
  if (!input || !input.trim()) return null;

  const fields: string[][] = [[]];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  const src = input.replace(/^﻿/, ''); // strip BOM

  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      fields[fields.length - 1].push(cur);
      cur = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      // CRLF or lone CR
      if (src[i + 1] === '\n') i += 1;
      fields[fields.length - 1].push(cur);
      cur = '';
      fields.push([]);
      i += 1;
      continue;
    }
    if (c === '\n') {
      fields[fields.length - 1].push(cur);
      cur = '';
      fields.push([]);
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  fields[fields.length - 1].push(cur);

  // Drop a trailing empty record (file ended with newline).
  while (fields.length > 0) {
    const last = fields[fields.length - 1];
    if (last.length === 1 && last[0] === '') {
      fields.pop();
      continue;
    }
    break;
  }
  if (fields.length === 0) return null;

  const [headers, ...rest] = fields;
  return {
    headers: headers.map(s => s.trim()),
    rows: rest.map(cells => ({ cells })),
  };
}

export interface BuildIndexOptions {
  /** Database display name (already hash-stripped). */
  dbName: string;
  /**
   * Map of row-title → sanitised page slug for any matching page in the
   * sibling folder. Lookups are case-insensitive on the raw title.
   * Rows with no match render as plain text in the title column.
   */
  rowPageSlugs: Map<string, string>;
}

/**
 * Render a parsed database into a GFM table. The first column is treated
 * as the row title and linked to the matching page where possible.
 */
export function buildIndexMarkdown(table: NotionDbTable, opts: BuildIndexOptions): string {
  const headers = table.headers.length ? table.headers : ['Title'];
  const headerLine = `| ${headers.map(escapeCell).join(' | ')} |`;
  const dividerLine = `| ${headers.map(() => '---').join(' | ')} |`;

  const rowLines = table.rows.map(row => {
    const cells = padRow(row.cells, headers.length);
    const titleRaw = (cells[0] ?? '').trim();
    const slug = titleRaw ? opts.rowPageSlugs.get(titleRaw.toLowerCase()) : undefined;
    const titleCell = slug
      ? `[${escapeCell(titleRaw)}](${encodeForLink(slug + '.md')})`
      : escapeCell(titleRaw);
    const rest = cells.slice(1).map(escapeCell);
    return `| ${[titleCell, ...rest].join(' | ')} |`;
  });

  return [
    `# ${opts.dbName}`,
    '',
    `_Database imported from Notion — ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}._`,
    '',
    headerLine,
    dividerLine,
    ...rowLines,
    '',
  ].join('\n');
}

function padRow(cells: string[], width: number): string[] {
  if (cells.length >= width) return cells;
  return [...cells, ...new Array(width - cells.length).fill('')];
}

/** Escape pipes and newlines so a value renders inside a single GFM cell. */
function escapeCell(value: string): string {
  return (value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function encodeForLink(p: string): string {
  return p.replace(/ /g, '%20');
}

/**
 * Convenience: given the basename of a CSV (e.g. `Tasks 1234…abcd.csv`),
 * return the database display name with the hash stripped.
 */
export function dbNameFromCsv(filename: string): string {
  const base = filename.replace(/\.csv$/i, '');
  return stripNotionHash(base).name;
}

export const __test = { padRow, escapeCell };
