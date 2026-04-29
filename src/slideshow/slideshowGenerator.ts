import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }) as Parameters<typeof marked.use>[0],
);

export interface SlideshowFrontmatter {
  title?: string;
  theme?: string;
  transition?: string;
  speakerNotes?: boolean;
}

export interface SlideshowBuildInput {
  markdown: string;
  /** Title used in <title> if frontmatter doesn't provide one. */
  fallbackTitle: string;
}

export interface SlideshowOptions {
  /** Reveal.js theme — defaults to 'black'. */
  theme: string;
  /** none / fade / slide / convex / concave / zoom — defaults to 'slide'. */
  transition: string;
  /** Render speaker notes from `Notes:` blocks at the end of each slide body. */
  speakerNotes: boolean;
  /** When set, slideshow restores to this slide on load + posts position changes back to the host. */
  liveReload?: { initialIndex?: { h: number; v: number; f?: number } };
}

export const DEFAULT_OPTIONS: SlideshowOptions = {
  theme: 'black',
  transition: 'slide',
  speakerNotes: true,
};

export interface BuiltSlideshow {
  title: string;
  html: string;
  slideCount: number;
  options: SlideshowOptions;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;
const SLIDE_BREAK_RE = /\n\s*---\s*\n/;
const VERTICAL_BREAK_RE = /\n\s*--\s*\n/;
const NOTES_RE = /\n\s*Notes:\s*\n([\s\S]+)$/i;

export function buildSlideshow(input: SlideshowBuildInput, base: SlideshowOptions = DEFAULT_OPTIONS): BuiltSlideshow {
  const { frontmatter, body } = parseFrontmatter(input.markdown);
  const options: SlideshowOptions = {
    theme: frontmatter.theme ?? base.theme,
    transition: frontmatter.transition ?? base.transition,
    speakerNotes: frontmatter.speakerNotes ?? base.speakerNotes,
    liveReload: base.liveReload,
  };
  const title = frontmatter.title ?? input.fallbackTitle;

  const horizontals = body.split(SLIDE_BREAK_RE);
  const slides = horizontals.map(h => {
    const verticals = h.split(VERTICAL_BREAK_RE);
    return verticals.map(renderSlideMarkdown);
  });

  const sections = slides
    .map(group => {
      if (group.length === 1) return `<section>${group[0]}</section>`;
      return `<section>${group.map(s => `<section>${s}</section>`).join('')}</section>`;
    })
    .join('\n');

  const total = slides.flat().length;

  const html = template(title, options, sections);
  return { title, html, slideCount: total, options };
}

function renderSlideMarkdown(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  const notesMatch = trimmed.match(NOTES_RE);
  let main = trimmed;
  let notes = '';
  if (notesMatch) {
    main = trimmed.slice(0, notesMatch.index).trim();
    notes = notesMatch[1].trim();
  }
  // Pre-process mermaid blocks
  const mermaidBlocks: string[] = [];
  const withMermaid = main.replace(/```mermaid\s*\n([\s\S]*?)\n```/g, (_m, code) => {
    const i = mermaidBlocks.push(code) - 1;
    return `\n\n<div class="mermaid" data-mid-index="${i}"></div>\n\n`;
  });
  let body = marked.parse(withMermaid, { async: false }) as string;
  body = body.replace(/data-mid-index="(\d+)"><\/div>/g, (_m, i) => {
    return `>${escapeHtml(mermaidBlocks[Number(i)] ?? '')}</div>`;
  });
  if (notes) {
    body += `<aside class="notes">${escapeHtml(notes).replace(/\n/g, '<br/>')}</aside>`;
  }
  return body;
}

function parseFrontmatter(md: string): { frontmatter: SlideshowFrontmatter; body: string } {
  const match = md.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: md };
  const raw = match[1];
  const fm: SlideshowFrontmatter = {};
  for (const line of raw.split(/\n/)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value: string | boolean = m[2].trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    if (key === 'title' && typeof value === 'string') fm.title = value;
    else if (key === 'theme' && typeof value === 'string') fm.theme = value;
    else if (key === 'transition' && typeof value === 'string') fm.transition = value;
    else if (key === 'speakerNotes' && typeof value === 'boolean') fm.speakerNotes = value;
  }
  return { frontmatter: fm, body: md.slice(match[0].length) };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function template(title: string, opts: SlideshowOptions, sections: string): string {
  const themeUrl = `https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/${escapeAttr(opts.theme)}.css`;
  const revealCss = 'https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css';
  const revealJs = 'https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js';
  const notesPlugin = 'https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/notes/notes.js';
  const highlightCss = 'https://cdn.jsdelivr.net/npm/highlight.js@11/styles/atom-one-dark.min.css';
  const mermaidJs = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
  const liveReload = opts.liveReload;
  const initialIndex = liveReload?.initialIndex;
  const liveReloadScript = liveReload
    ? `
  (function(){
    var vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : undefined;
    if (!vscode) return;
    var initial = ${JSON.stringify(initialIndex ?? null)};
    if (initial) {
      Reveal.on('ready', function () {
        Reveal.slide(initial.h, initial.v || 0, initial.f || 0);
      });
    }
    Reveal.on('slidechanged', function () {
      var ix = Reveal.getIndices();
      vscode.postMessage({ type: 'slideshow.position', h: ix.h, v: ix.v, f: ix.f });
    });
    Reveal.on('fragmentshown', function () {
      var ix = Reveal.getIndices();
      vscode.postMessage({ type: 'slideshow.position', h: ix.h, v: ix.v, f: ix.f });
    });
    Reveal.on('fragmenthidden', function () {
      var ix = Reveal.getIndices();
      vscode.postMessage({ type: 'slideshow.position', h: ix.h, v: ix.v, f: ix.f });
    });
    vscode.postMessage({ type: 'slideshow.ready' });
  })();
`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${revealCss}" />
<link rel="stylesheet" href="${themeUrl}" id="theme" />
<link rel="stylesheet" href="${highlightCss}" />
<style>
  .reveal pre { box-shadow: none; }
  .reveal .mermaid { background: rgba(255,255,255,0.04); border-radius: 8px; padding: 12px; }
</style>
</head>
<body>
<div class="reveal"><div class="slides">${sections}</div></div>
<script src="${revealJs}"></script>
<script src="${notesPlugin}"></script>
<script src="${mermaidJs}"></script>
<script>
  Reveal.initialize({
    hash: ${liveReload ? 'false' : 'true'},
    transition: ${JSON.stringify(opts.transition)},
    plugins: [RevealNotes],
  });
  if (window.mermaid) {
    var isDark = ${JSON.stringify(isDarkTheme(opts.theme))};
    mermaid.initialize({ startOnLoad: true, theme: isDark ? 'dark' : 'default', securityLevel: 'strict' });
  }
${liveReloadScript}
</script>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '');
}

function isDarkTheme(name: string): boolean {
  return ['black', 'night', 'blood', 'moon', 'dracula', 'league'].includes(name);
}
