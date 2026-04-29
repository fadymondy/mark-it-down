import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import { paletteToCss, ThemePalette } from '../themes/themes';
import { hljsCssFor } from '../../packages/core/src/themes/hljsCss';
import { ThemeDefinition } from '../../packages/core/src/themes/themes';

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }) as Parameters<typeof marked.use>[0],
);
marked.setOptions({ gfm: true, breaks: false });
const renderer = marked;

export interface PageInput {
  title: string;
  /** Relative URL (no leading slash, e.g. `notes/foo.html`) so links resolve under any deploy path. */
  pathFromRoot: string;
  markdown: string;
}

export interface SiteAssets {
  /** Full CSS for one page. */
  pageCss: string;
  /** Self-contained client JS for mermaid + sortable tables (no external deps at view time). */
  clientJs: string;
}

export interface RenderedPage {
  pathFromRoot: string;
  title: string;
  html: string;
}

export function buildSiteAssets(
  palette: ThemePalette,
  kindIsDark: boolean,
  theme?: ThemeDefinition,
): SiteAssets {
  const hljsTheme = kindIsDark ? HLJS_DARK_CSS : HLJS_LIGHT_CSS;
  const hljsOverrides = theme ? hljsCssFor(theme) : '';
  const pageCss = `
:root { ${paletteToCss(palette)} color-scheme: ${kindIsDark ? 'dark' : 'light'}; }
${BASE_CSS}
${hljsTheme}
${hljsOverrides}
`;
  return { pageCss, clientJs: CLIENT_JS };
}

export function renderPage(input: PageInput, indexPages: { title: string; pathFromRoot: string }[]): RenderedPage {
  // Pre-process mermaid blocks: marked treats them as code blocks → swap to <div class="mermaid">.
  const mermaidBlocks: string[] = [];
  const withMermaid = input.markdown.replace(/```mermaid\s*\n([\s\S]*?)\n```/g, (_m, code) => {
    const i = mermaidBlocks.push(code) - 1;
    return `\n\n<div class="mermaid" data-mid-index="${i}"></div>\n\n`;
  });
  let body = renderer.parse(withMermaid, { async: false }) as string;
  body = body.replace(/data-mid-index="(\d+)"><\/div>/g, (_m, i) => {
    const code = mermaidBlocks[Number(i)] ?? '';
    return `>${escapeHtml(code)}</div>`;
  });

  const navItems = indexPages
    .map(p => `<li><a href="${rel(input.pathFromRoot, p.pathFromRoot)}">${escapeHtml(p.title)}</a></li>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(input.title)}</title>
<link rel="stylesheet" href="${rel(input.pathFromRoot, 'assets/style.css')}" />
</head>
<body data-assets-base="${rel(input.pathFromRoot, 'assets/')}">
<header class="mid-header">
  <a class="mid-home" href="${rel(input.pathFromRoot, 'index.html')}">Mark It Down</a>
  <span class="mid-doc-title">${escapeHtml(input.title)}</span>
  <input type="search" id="mid-search" placeholder="Search…" aria-label="Search notes" />
</header>
<aside class="mid-nav">
  <h2>Pages</h2>
  <ul>${navItems}</ul>
  <div id="mid-search-results" hidden></div>
</aside>
<main class="mid-body">${body}</main>
<script src="https://cdn.jsdelivr.net/npm/lunr@2/lunr.min.js"></script>
<script src="${rel(input.pathFromRoot, 'assets/site.js')}"></script>
</body>
</html>`;
  return { pathFromRoot: input.pathFromRoot, title: input.title, html };
}

export function renderIndex(pages: { title: string; pathFromRoot: string }[]): string {
  const items = pages
    .map(p => `<li><a href="${escapeAttr(p.pathFromRoot)}">${escapeHtml(p.title)}</a></li>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Mark It Down — Index</title>
<link rel="stylesheet" href="assets/style.css" />
</head>
<body>
<header class="mid-header">
  <a class="mid-home" href="index.html">Mark It Down</a>
  <input type="search" id="mid-search" placeholder="Search…" aria-label="Search notes" />
</header>
<main class="mid-body">
  <h1>Pages</h1>
  <ul class="mid-index">${items}</ul>
  <div id="mid-search-results" hidden></div>
</main>
<script src="https://cdn.jsdelivr.net/npm/lunr@2/lunr.min.js"></script>
<script src="assets/site.js"></script>
</body>
</html>`;
}

function rel(from: string, to: string): string {
  const fromParts = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  let i = 0;
  while (i < fromParts.length && i < toParts.length - 1 && fromParts[i] === toParts[i]) i++;
  const up = fromParts.length - i;
  return [...Array(up).fill('..'), ...toParts.slice(i)].join('/') || '.';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.65;
  color: var(--fg);
  background: var(--bg);
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  grid-template-rows: 56px 1fr;
  grid-template-areas: "header header" "nav main";
  min-height: 100vh;
}
.mid-header {
  grid-area: header;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 20px;
  background: var(--code-bg);
  border-bottom: 1px solid var(--border);
}
.mid-home { color: var(--accent); font-weight: 600; text-decoration: none; }
.mid-doc-title { color: var(--fg-muted); font-size: 0.92em; }
#mid-search {
  margin-left: auto;
  padding: 5px 10px;
  font-size: 0.92em;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 4px;
  min-width: 180px;
}
#mid-search:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#mid-search-results {
  margin-top: 12px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.mid-search-hit { margin: 8px 0; }
.mid-search-hit a { color: var(--link); text-decoration: none; }
.mid-search-hit a:hover { text-decoration: underline; }
.mid-search-snippet { color: var(--fg-muted); font-size: 0.88em; line-height: 1.4; }
.mid-nav {
  grid-area: nav;
  background: var(--code-bg);
  border-right: 1px solid var(--border);
  padding: 14px;
  overflow-y: auto;
}
.mid-nav h2 { font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); margin: 0 0 8px; }
.mid-nav ul { list-style: none; padding: 0; margin: 0; }
.mid-nav li { margin: 4px 0; }
.mid-nav a { color: var(--fg); text-decoration: none; font-size: 0.92em; }
.mid-nav a:hover { color: var(--link); }
.mid-body { grid-area: main; padding: 32px 48px 96px; max-width: 920px; }
.mid-body h1, .mid-body h2 { border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
.mid-body h1 { font-size: 2em; margin-top: 0.6em; }
.mid-body h2 { font-size: 1.5em; margin-top: 1.4em; }
.mid-body h3 { font-size: 1.25em; }
.mid-body p { margin: 0.8em 0; }
.mid-body a { color: var(--link); }
.mid-body code { background: var(--inline-code-bg); padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
.mid-body pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px; overflow-x: auto; margin: 1em 0; }
.mid-body pre code { background: transparent; padding: 0; font-size: 0.88em; line-height: 1.55; }
.mid-body blockquote { border-left: 3px solid var(--accent); padding: 4px 14px; margin: 1em 0; color: var(--fg-muted); background: var(--code-bg); border-radius: 0 6px 6px 0; }
.mid-body table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.95em; }
.mid-body th, .mid-body td { padding: 8px 12px; border: 1px solid var(--border); text-align: left; }
.mid-body th { background: var(--code-bg); font-weight: 600; cursor: pointer; user-select: none; }
.mid-body th:hover { background: rgba(127,127,127,0.12); }
.mid-body tr:nth-child(even) td { background: var(--table-stripe); }
.mid-body img { max-width: 100%; border-radius: 4px; }
.mid-body hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
.mid-body ul.mid-index { list-style: none; padding: 0; }
.mid-index li { margin: 6px 0; }
.mid-body .mermaid { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 14px; margin: 1em 0; text-align: center; overflow-x: auto; }
@media (max-width: 720px) {
  body { grid-template-columns: 1fr; grid-template-areas: "header" "main"; }
  .mid-nav { display: none; }
  .mid-body { padding: 16px; }
}
`;

const HLJS_LIGHT_CSS = `
.hljs{color:#383a42;background:transparent}
.hljs-comment,.hljs-quote{color:#a0a1a7;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-name,.hljs-section{color:#a626a4}
.hljs-string,.hljs-attr,.hljs-symbol,.hljs-bullet{color:#50a14f}
.hljs-number,.hljs-literal,.hljs-built_in,.hljs-type{color:#986801}
.hljs-title,.hljs-class .hljs-title{color:#4078f2}
.hljs-variable,.hljs-template-variable{color:#e45649}
.hljs-tag,.hljs-meta{color:#0184bb}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:bold}
`;

const HLJS_DARK_CSS = `
.hljs{color:#abb2bf;background:transparent}
.hljs-comment,.hljs-quote{color:#5c6370;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-name,.hljs-section{color:#c678dd}
.hljs-string,.hljs-attr,.hljs-symbol,.hljs-bullet{color:#98c379}
.hljs-number,.hljs-literal,.hljs-built_in,.hljs-type{color:#d19a66}
.hljs-title,.hljs-class .hljs-title{color:#61afef}
.hljs-variable,.hljs-template-variable{color:#e06c75}
.hljs-tag,.hljs-meta{color:#56b6c2}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:bold}
`;

const CLIENT_JS = `
(function(){
  // Sortable tables — click any th to cycle asc/desc/none
  document.querySelectorAll('main.mid-body table').forEach(function(table){
    var head = table.tHead && table.tHead.rows[0];
    if (!head) return;
    Array.prototype.forEach.call(head.cells, function(th, col){
      th.addEventListener('click', function(){
        var tbody = table.tBodies[0]; if (!tbody) return;
        var rows = Array.prototype.slice.call(tbody.rows);
        if (!rows.length || rows[0].dataset.midOriginal === undefined) {
          rows.forEach(function(r,i){ r.dataset.midOriginal = String(i); });
        }
        var current = th.dataset.sort || 'none';
        var next = current === 'none' ? 'asc' : current === 'asc' ? 'desc' : 'none';
        Array.prototype.forEach.call(head.cells, function(other){ other.dataset.sort = 'none'; });
        th.dataset.sort = next;
        if (next === 'none') {
          rows.sort(function(a,b){ return Number(a.dataset.midOriginal) - Number(b.dataset.midOriginal); });
        } else {
          var factor = next === 'asc' ? 1 : -1;
          rows.sort(function(a,b){
            var av = (a.cells[col]?.textContent || '').trim();
            var bv = (b.cells[col]?.textContent || '').trim();
            var an = parseFloat(av.replace(/[\\$,%]/g,'')); var bn = parseFloat(bv.replace(/[\\$,%]/g,''));
            if (!isNaN(an) && !isNaN(bn)) return factor * (an - bn);
            return factor * av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
          });
        }
        rows.forEach(function(r){ tbody.appendChild(r); });
      });
    });
  });
  // Mermaid via CDN — only loaded when there's at least one diagram
  if (document.querySelector('.mermaid')) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    s.onload = function(){
      var isDark = matchMedia('(prefers-color-scheme: dark)').matches;
      var bgIsDark = getComputedStyle(document.body).getPropertyValue('color-scheme').indexOf('dark') >= 0;
      window.mermaid.initialize({ startOnLoad: true, theme: bgIsDark || isDark ? 'dark' : 'default', securityLevel: 'strict' });
    };
    document.head.appendChild(s);
  }
  // Search — lazy-load the index on first input, then run lunr queries.
  var searchInput = document.getElementById('mid-search');
  var searchResults = document.getElementById('mid-search-results');
  if (searchInput && searchResults) {
    var indexPromise = null;
    function loadIndex() {
      if (indexPromise) return indexPromise;
      var assetsBase = document.body.getAttribute('data-assets-base') || 'assets/';
      indexPromise = fetch(assetsBase + 'search-index.json').then(function(r){ return r.json(); }).then(function(data){
        return { idx: window.lunr.Index.load(data.index), docs: data.docs };
      }).catch(function(err){
        console.warn('search index load failed:', err);
        return null;
      });
      return indexPromise;
    }
    var debounce;
    searchInput.addEventListener('input', function(){
      clearTimeout(debounce);
      var q = searchInput.value.trim();
      if (!q) {
        searchResults.hidden = true;
        searchResults.innerHTML = '';
        return;
      }
      debounce = setTimeout(function(){
        loadIndex().then(function(bundle){
          if (!bundle) return;
          var hits;
          try { hits = bundle.idx.search(q); } catch (_e) { hits = []; }
          var byId = {};
          bundle.docs.forEach(function(d){ byId[d.id] = d; });
          searchResults.hidden = hits.length === 0;
          searchResults.innerHTML = hits.slice(0, 12).map(function(h){
            var d = byId[h.ref] || { id: h.ref, title: h.ref, snippet: '' };
            return '<div class="mid-search-hit"><a href="' + d.id + '"><strong>' + escapeHtml(d.title) + '</strong></a><div class="mid-search-snippet">' + escapeHtml(d.snippet) + '</div></div>';
          }).join('');
        });
      }, 200);
    });
    function escapeHtml(s){ return s.replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  }
})();
`;
