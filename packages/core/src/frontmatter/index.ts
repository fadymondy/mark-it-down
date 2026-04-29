/**
 * Tiny zero-dep YAML-frontmatter parser. Recognises a `---`-delimited
 * block at the very top of the document (optionally preceded by a UTF-8
 * BOM) and pulls out simple `key: value` pairs.
 *
 * Supported value forms:
 *   slug: my-page
 *   title: "My Page"
 *   draft: true
 *   tags: [a, b, "c d"]
 *
 * Anything more elaborate (nested objects, multi-line strings, anchors)
 * is intentionally not supported — pull a real YAML lib if that becomes a
 * requirement. For our publish pipeline, the slug field is all that
 * matters.
 */

export interface FrontmatterResult {
  /** Parsed key→value map. Missing block ⇒ empty object. */
  data: Record<string, string | number | boolean | string[]>;
  /** Document body with the frontmatter block removed (and its trailing newlines collapsed). */
  body: string;
  /** True when a `---`-delimited block was found and parsed. */
  found: boolean;
}

const FENCE = '---';

export function parseFrontmatter(source: string): FrontmatterResult {
  let src = source;
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);

  const head = src.split('\n', 1)[0];
  if (head.trim() !== FENCE) {
    return { data: {}, body: source, found: false };
  }

  // Find the closing fence.
  const lines = src.split('\n');
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) {
    return { data: {}, body: source, found: false };
  }

  const data: Record<string, string | number | boolean | string[]> = {};
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    if (line.trim().length === 0 || line.trim().startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    if (key.length === 0) continue;
    data[key] = parseScalar(rawValue);
  }
  const bodyLines = lines.slice(endIdx + 1);
  // Drop a single leading blank line if present so users can typeset
  // `---\n\n# Title` without picking up a stray newline.
  if (bodyLines.length > 0 && bodyLines[0].trim().length === 0) {
    bodyLines.shift();
  }
  return { data, body: bodyLines.join('\n'), found: true };
}

function parseScalar(raw: string): string | number | boolean | string[] {
  if (raw.length === 0) return '';
  // Inline list: [a, "b c", 'd']
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return parseInlineList(raw.slice(1, -1));
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return '';
  // Quoted strings keep their inner content verbatim
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
  return raw;
}

function parseInlineList(inner: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === quote) quote = null;
      else buf += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === ',') {
      const trimmed = buf.trim();
      if (trimmed.length > 0) out.push(trimmed);
      buf = '';
      continue;
    }
    buf += c;
  }
  const trimmed = buf.trim();
  if (trimmed.length > 0) out.push(trimmed);
  return out;
}

/**
 * Convenience: returns just the body with frontmatter stripped, for
 * pipelines that don't care about the parsed data.
 */
export function stripFrontmatter(source: string): string {
  return parseFrontmatter(source).body;
}

/**
 * Validate a slug value (lowercase letters/digits/dashes, ≤48 chars).
 * Returns the cleaned slug, or undefined if it's invalid.
 */
export function validateSlug(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 48) return undefined;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(trimmed)) return undefined;
  return trimmed;
}
