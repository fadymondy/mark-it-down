/**
 * Minimal HTML → Markdown unwrap for Apple Notes bodies.
 *
 * Apple Notes returns note bodies as HTML (they ship a styled WebKit document
 * under the hood). We don't pull a full converter library here — the format
 * Notes emits is narrow:
 *   - <div>/<p> blocks for paragraphs
 *   - <h1>..<h3> headings
 *   - <ul>/<ol>/<li> lists
 *   - <b>/<strong>, <i>/<em>, <u>, <s>/<strike>
 *   - <a href="…">…</a>
 *   - <br> for hard breaks
 *   - <img src="…"> for inline attachments (we replace src in index.ts)
 *   - <pre>/<code> for monospace blocks
 *
 * Anything we don't recognise is stripped, with the inner text preserved.
 * The output is intentionally plain — the host re-renders it the same way it
 * renders any other markdown file in the workspace.
 */

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z#0-9]+;/gi, m => ENTITY_MAP[m] ?? m);
}

/** Strip HTML tags but keep their text content, with light markdown markers. */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';

  let s = html;

  // Drop everything <head>…</head> or <style>…</style> wholesale.
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<head[\s\S]*?<\/head>/gi, '');

  // Headings.
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, inner: string) => `\n# ${stripInline(inner)}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, inner: string) => `\n## ${stripInline(inner)}\n\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, inner: string) => `\n### ${stripInline(inner)}\n\n`);
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, inner: string) => `\n#### ${stripInline(inner)}\n\n`);

  // Lists — flatten one level. Apple Notes nests but the markdown renderer
  // handles indentation; we keep the markers and let the renderer reflow.
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner: string) => `\n${convertListItems(inner, '-')}\n`);
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => `\n${convertListItems(inner, '1.')}\n`);

  // Paragraphs and divs become hard breaks.
  s = s.replace(/<\/(p|div)>/gi, '\n\n');
  s = s.replace(/<(p|div)[^>]*>/gi, '');

  // Line breaks.
  s = s.replace(/<br\s*\/?>/gi, '  \n');

  // Inline anchors — preserve href.
  s = s.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
    const text = stripInline(inner) || href;
    return `[${text}](${href})`;
  });

  // Pre/code.
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => `\n\`\`\`\n${decodeEntities(inner.replace(/<[^>]+>/g, ''))}\n\`\`\`\n`);
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, inner: string) => `\`${decodeEntities(inner.replace(/<[^>]+>/g, ''))}\``);

  // Bold / italic / strike.
  s = s.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, inner: string) => `**${stripInline(inner)}**`);
  s = s.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, inner: string) => `*${stripInline(inner)}*`);
  s = s.replace(/<(s|strike|del)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, inner: string) => `~~${stripInline(inner)}~~`);

  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, '');

  s = decodeEntities(s);

  // Collapse 3+ blank lines.
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

function stripInline(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function convertListItems(inner: string, marker: string): string {
  const items: string[] = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const text = stripInline(m[1]);
    if (text) items.push(`${marker} ${text}`);
  }
  return items.join('\n');
}

/**
 * Pull `#hashtags` out of a plain-text/markdown body. Returns the tag list
 * (without leading `#`) — does not mutate the body. Apple Notes folds tags
 * into normal note text with a `#` prefix; we surface them as frontmatter.
 */
export function extractHashtags(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const re = /(?:^|\s)#([a-z0-9][a-z0-9_-]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[1].toLowerCase());
  }
  return Array.from(out);
}
