import { renderMarkdown as coreRenderMarkdown, applyMermaidPlaceholders } from '../../../packages/core/src/markdown/renderer';
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import yaml from 'js-yaml';
import { toPng } from 'html-to-image';
import { iconHTML, IconName } from '../../../packages/ui-tokens/src/icons';

interface TreeEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: TreeEntry[];
}

type FontFamilyChoice = 'system' | 'sans' | 'serif' | 'mono';
type ThemeChoice = 'auto' | 'light' | 'dark' | 'sepia';

interface AppState {
  lastFolder?: string;
  splitRatio?: number;
  fontFamily?: FontFamilyChoice;
  fontSize?: number;
  theme?: ThemeChoice;
  previewMaxWidth?: number;
}

const DEFAULT_SETTINGS = {
  fontFamily: 'system' as FontFamilyChoice,
  fontSize: 15,
  theme: 'auto' as ThemeChoice,
  previewMaxWidth: 920,
};

const FONT_STACKS: Record<FontFamilyChoice, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Apple Garamond", Charter, serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

type ExportFormat = 'md' | 'html' | 'pdf' | 'png' | 'txt';

interface NoteEntry {
  id: string;
  title: string;
  path: string;
  tags: string[];
  created: string;
  updated: string;
}

interface Mid {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<boolean>;
  openFileDialog(): Promise<{ filePath: string; content: string } | null>;
  openFolderDialog(): Promise<{ folderPath: string; tree: TreeEntry[] } | null>;
  listFolderMd(folderPath: string): Promise<TreeEntry[]>;
  readAppState(): Promise<AppState>;
  patchAppState(patch: Partial<AppState>): Promise<void>;
  notesList(workspace: string): Promise<NoteEntry[]>;
  notesCreate(workspace: string, title: string): Promise<{ entry: NoteEntry; fullPath: string }>;
  notesRename(workspace: string, id: string, title: string): Promise<NoteEntry | null>;
  notesDelete(workspace: string, id: string): Promise<boolean>;
  notesTag(workspace: string, id: string, tags: string[]): Promise<NoteEntry | null>;
  saveAs(defaultName: string, content: string | ArrayBuffer, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  exportPDF(defaultName: string): Promise<string | null>;
  saveFileDialog(defaultName: string, content: string): Promise<string | null>;
  getAppInfo(): Promise<{ version: string; platform: string; isDark: boolean; userData: string; documents: string }>;
  openExternal(url: string): Promise<void>;
  onThemeChanged(cb: (isDark: boolean) => void): () => void;
  onMenuOpen(cb: () => void): () => void;
  onMenuOpenFolder(cb: () => void): () => void;
  onMenuSave(cb: () => void): () => void;
  onMenuExport(cb: (format: ExportFormat) => void): () => void;
}
declare const window: Window & { mid: Mid };

type Mode = 'view' | 'edit' | 'split';

const root = document.getElementById('root') as HTMLElement;
const filenameEl = document.getElementById('filename') as HTMLSpanElement;
const btnView = document.getElementById('mode-view') as HTMLButtonElement;
const btnSplit = document.getElementById('mode-split') as HTMLButtonElement;
const btnEdit = document.getElementById('mode-edit') as HTMLButtonElement;
const btnOpen = document.getElementById('open-btn') as HTMLButtonElement;
const btnOpenFolder = document.getElementById('open-folder-btn') as HTMLButtonElement;
const btnSave = document.getElementById('save-btn') as HTMLButtonElement;
const sidebar = document.getElementById('sidebar') as HTMLElement;
const sidebarFolderName = document.getElementById('sidebar-folder-name') as HTMLSpanElement;
const sidebarRefresh = document.getElementById('sidebar-refresh') as HTMLButtonElement;
const treeRoot = document.getElementById('tree-root') as HTMLDivElement;
const modeFilesBtn = document.getElementById('mode-files') as HTMLButtonElement;
const modeNotesBtn = document.getElementById('mode-notes') as HTMLButtonElement;
const sidebarFilesHeader = document.getElementById('sidebar-files-header') as HTMLElement;
const sidebarNotesHeader = document.getElementById('sidebar-notes-header') as HTMLElement;
const notesListEl = document.getElementById('notes-list') as HTMLDivElement;
const notesFilter = document.getElementById('notes-filter') as HTMLInputElement;
const notesNewBtn = document.getElementById('notes-new') as HTMLButtonElement;

let currentText = '';
let currentPath: string | null = null;
let currentMode: Mode = 'split';
let mermaidThemeKind = 0;
let currentFolder: string | null = null;
let splitRatio = 0.5;
let renderTimer: number | null = null;
let osIsDark = false;
let sidebarMode: 'files' | 'notes' = 'files';
let notes: NoteEntry[] = [];
let notesFilterText = '';
const settings = { ...DEFAULT_SETTINGS };
const expandedDirs = new Set<string>();

function applyTheme(isDark: boolean): void {
  osIsDark = isDark;
  applyResolvedTheme();
}

function applyResolvedTheme(): void {
  const root = document.documentElement;
  root.classList.remove('dark', 'sepia');
  let resolvedDark = false;
  if (settings.theme === 'dark') {
    root.classList.add('dark');
    resolvedDark = true;
  } else if (settings.theme === 'sepia') {
    root.classList.add('sepia');
  } else if (settings.theme === 'auto' && osIsDark) {
    root.classList.add('dark');
    resolvedDark = true;
  }
  initMermaid(resolvedDark ? 2 : 1);
}

function applySettings(): void {
  const root = document.documentElement;
  root.style.setProperty('--mid-font-sans', FONT_STACKS[settings.fontFamily]);
  root.style.setProperty('--mid-font-size-base', `${settings.fontSize}px`);
  root.style.setProperty('--mid-preview-max-width', `${settings.previewMaxWidth}px`);
  applyResolvedTheme();
}

function initMermaid(themeKind: number): void {
  if (mermaidThemeKind === themeKind) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: themeKind === 2 ? 'dark' : 'default',
    securityLevel: 'strict',
    fontFamily: 'inherit',
  });
  mermaidThemeKind = themeKind;
}

function extractFrontmatter(md: string): { meta?: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]+?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { body: md };
  try {
    const parsed = yaml.load(m[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { meta: parsed as Record<string, unknown>, body: md.slice(m[0].length) };
    }
  } catch {
    // Invalid YAML — render raw.
  }
  return { body: md };
}

function renderFrontmatterHTML(meta: Record<string, unknown>): string {
  const rows = Object.entries(meta)
    .map(([k, v]) => {
      const valueText = Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
      return `<div class="mid-fm-row"><span class="mid-fm-key">${escapeHTML(k)}</span><span class="mid-fm-val">${escapeHTML(valueText)}</span></div>`;
    })
    .join('');
  return `<aside class="mid-frontmatter" aria-label="Frontmatter">${rows}</aside>`;
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(md: string): string {
  const { meta, body } = extractFrontmatter(md);
  const { html, mermaidBlocks } = coreRenderMarkdown(body);
  const container = document.createElement('div');
  container.innerHTML = html;
  applyMermaidPlaceholders(container, mermaidBlocks);
  const fmHTML = meta ? renderFrontmatterHTML(meta) : '';
  return fmHTML + container.innerHTML;
}

function emptyStateHTML(): string {
  return `<div class="empty-state"><h1>Mark It Down</h1><p>Open a folder with <kbd class="mid-kbd">Cmd/Ctrl+Shift+O</kbd> to browse, or open a single file with <kbd class="mid-kbd">Cmd/Ctrl+O</kbd>.</p></div>`;
}

function renderView(): void {
  root.classList.remove('editing', 'splitting');
  root.classList.add('viewing');
  if (!currentText) {
    root.innerHTML = emptyStateHTML();
    return;
  }
  const preview = document.createElement('div');
  preview.className = 'mid-preview';
  populatePreview(preview);
  root.replaceChildren(preview);
}

function populatePreview(preview: HTMLElement): void {
  preview.innerHTML = renderMarkdown(currentText);
  preview.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    if (href.startsWith('http://') || href.startsWith('https://')) {
      a.addEventListener('click', e => {
        e.preventDefault();
        void window.mid.openExternal(href);
      });
    }
  });
  applySyntaxHighlighting(preview);
  attachCodeBlockToolbar(preview);
  attachHeadingAnchors(preview);
  attachImageLightbox(preview);
  attachAlerts(preview);
  attachMath(preview);
  attachTableTools(preview);
  preview.querySelectorAll<HTMLDivElement>('.mermaid').forEach((el, i) => {
    const id = `mermaid-${Date.now()}-${i}`;
    const code = (el.textContent ?? '').trim();
    el.removeAttribute('data-processed');
    el.dataset.mermaidSource = code;
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        el.innerHTML = svg;
        attachMermaidToolbar(el, code);
      })
      .catch(err => {
        el.innerHTML = `<pre style="color: #d04444">Mermaid error: ${String((err as Error)?.message ?? err)}</pre>`;
      });
  });
}

function attachMermaidToolbar(host: HTMLDivElement, source: string): void {
  const toolbar = document.createElement('div');
  toolbar.className = 'mid-mermaid-toolbar';
  toolbar.append(
    makeIconButton('copy', 'Copy SVG', () => copyMermaidSVG(host)),
    makeIconButton('download', 'Download SVG', () => downloadMermaidSVG(host, source)),
    makeIconButton('image', 'Download PNG', () => void downloadMermaidPNG(host)),
  );
  host.style.position = 'relative';
  host.appendChild(toolbar);
}

function copyMermaidSVG(host: HTMLDivElement): void {
  const svg = host.querySelector('svg');
  if (!svg) return;
  void navigator.clipboard.writeText(serializeSVG(svg));
}

function downloadMermaidSVG(host: HTMLDivElement, _source: string): void {
  const svg = host.querySelector('svg');
  if (!svg) return;
  const blob = new Blob([serializeSVG(svg)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'diagram.svg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadMermaidPNG(host: HTMLDivElement): Promise<void> {
  const svg = host.querySelector('svg');
  if (!svg) return;
  const dataUrl = await toPng(host, {
    pixelRatio: 2,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--mid-bg').trim() || '#ffffff',
    filter: node => !((node as HTMLElement).classList?.contains('mid-mermaid-toolbar')),
  });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'diagram.png';
  a.click();
}

function serializeSVG(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

function applySyntaxHighlighting(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLElement>('pre > code').forEach(block => {
    if (block.classList.contains('mermaid')) return;
    try {
      hljs.highlightElement(block);
    } catch {
      // unsupported language — leave plain
    }
  });
}

const LANG_TO_EXT: Record<string, string> = {
  typescript: 'ts', ts: 'ts',
  javascript: 'js', js: 'js',
  jsx: 'jsx', tsx: 'tsx',
  python: 'py', py: 'py',
  ruby: 'rb', rb: 'rb',
  shell: 'sh', sh: 'sh', bash: 'sh', zsh: 'sh',
  json: 'json', yaml: 'yml', yml: 'yml',
  markdown: 'md', md: 'md',
  html: 'html', xml: 'xml', css: 'css', scss: 'scss',
  go: 'go', rust: 'rs', rs: 'rs',
  java: 'java', kotlin: 'kt', swift: 'swift',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', cs: 'cs',
  sql: 'sql',
  php: 'php',
  diff: 'diff',
  dockerfile: 'Dockerfile',
  makefile: 'mk',
};

function detectCodeLanguage(code: HTMLElement): string | undefined {
  for (const cls of code.classList) {
    if (cls.startsWith('language-')) {
      const lang = cls.slice('language-'.length).toLowerCase();
      if (lang && lang !== 'plaintext') return lang;
    }
  }
  return undefined;
}

function attachCodeBlockToolbar(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLPreElement>('pre').forEach(pre => {
    if (pre.dataset.midToolbar === '1') return;
    if (pre.classList.contains('mermaid')) return;
    const code = pre.querySelector<HTMLElement>('code');
    if (!code) return;
    pre.dataset.midToolbar = '1';
    pre.classList.add('mid-pre');

    const lang = detectCodeLanguage(code);
    if (lang) {
      const badge = document.createElement('span');
      badge.className = 'mid-code-lang';
      badge.textContent = lang;
      pre.appendChild(badge);
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'mid-code-toolbar';
    toolbar.append(
      makeIconButton('list-ul', 'Toggle line numbers', () => pre.classList.toggle('with-lines')),
      makeIconButton('copy', 'Copy', async (btn) => {
        await navigator.clipboard.writeText(code.innerText).then(
          () => flashButton(btn, 'copy', 'Copied'),
          () => flashButton(btn, 'x', 'Failed'),
        );
      }),
      makeIconButton('download', 'Download', () => downloadCode(code.innerText, lang)),
      makeIconButton('image', 'Export PNG', () => void exportCodeBlockAsPNG(pre)),
    );
    pre.appendChild(toolbar);

    addLineNumbers(pre, code);
  });
}

function makeIconButton(icon: IconName, title: string, onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mid-code-tool-btn';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = iconHTML(icon, 'mid-icon--sm');
  btn.addEventListener('click', () => onClick(btn));
  return btn;
}

function flashButton(btn: HTMLButtonElement, finalIcon: IconName, label: string): void {
  const original = btn.innerHTML;
  btn.innerHTML = `${iconHTML(finalIcon, 'mid-icon--sm')}<span class="mid-code-tool-flash">${label}</span>`;
  setTimeout(() => { btn.innerHTML = original; }, 1200);
}

function downloadCode(text: string, lang?: string): void {
  const ext = (lang && LANG_TO_EXT[lang]) ?? 'txt';
  const isExtensionlessName = ext === 'Dockerfile' || ext === 'mk';
  const filename = isExtensionlessName ? ext : `snippet.${ext}`;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportCodeBlockAsPNG(pre: HTMLPreElement): Promise<void> {
  const dataUrl = await toPng(pre, {
    pixelRatio: 2,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--mid-code-bg').trim() || '#0d1117',
  });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'code.png';
  a.click();
}

function addLineNumbers(pre: HTMLPreElement, code: HTMLElement): void {
  const lines = (code.textContent ?? '').replace(/\n$/, '').split('\n').length;
  const gutter = document.createElement('span');
  gutter.className = 'mid-code-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  gutter.textContent = Array.from({ length: lines }, (_, i) => String(i + 1)).join('\n');
  pre.insertBefore(gutter, code);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function attachHeadingAnchors(scope: HTMLElement): void {
  const seen = new Map<string, number>();
  scope.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6').forEach(h => {
    const baseSlug = slugify(h.textContent ?? '');
    if (!baseSlug) return;
    const count = seen.get(baseSlug) ?? 0;
    seen.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
    h.id = slug;
    const anchor = document.createElement('a');
    anchor.className = 'mid-anchor';
    anchor.href = `#${slug}`;
    anchor.setAttribute('aria-label', `Anchor link to ${slug}`);
    anchor.textContent = '#';
    anchor.addEventListener('click', e => {
      e.preventDefault();
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    h.appendChild(anchor);
  });
}

const ALERT_ICONS: Record<string, IconName> = {
  note: 'list-ul',
  tip: 'bookmark',
  important: 'link',
  warning: 'tag',
  caution: 'x',
};

function attachAlerts(scope: HTMLElement): void {
  scope.querySelectorAll('blockquote').forEach(bq => {
    const firstP = bq.querySelector('p');
    if (!firstP) return;
    const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(firstP.textContent ?? '');
    if (!m) return;
    const type = m[1].toLowerCase();
    bq.classList.add('mid-alert', `mid-alert--${type}`);
    firstP.innerHTML = firstP.innerHTML.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/, '');
    const header = document.createElement('div');
    header.className = 'mid-alert-header';
    header.innerHTML = `${iconHTML(ALERT_ICONS[type] ?? 'list-ul', 'mid-icon--sm')}<span>${m[1].charAt(0)}${m[1].slice(1).toLowerCase()}</span>`;
    bq.insertBefore(header, bq.firstChild);
    if (firstP.textContent?.trim() === '') firstP.remove();
  });
}

function attachMath(scope: HTMLElement): void {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Text) {
      if (!node.textContent || !/\$/.test(node.textContent)) return NodeFilter.FILTER_REJECT;
      let p = node.parentElement;
      while (p) {
        const tag = p.tagName;
        if (tag === 'CODE' || tag === 'PRE' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const targets: Text[] = [];
  let n: Node | null = walker.nextNode();
  while (n) {
    targets.push(n as Text);
    n = walker.nextNode();
  }
  for (const text of targets) {
    const original = text.textContent ?? '';
    const replaced = original
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => renderKatex(expr.trim(), true))
      .replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_, expr) => renderKatex(expr.trim(), false));
    if (replaced === original) continue;
    const wrap = document.createElement('span');
    wrap.innerHTML = replaced;
    text.replaceWith(...Array.from(wrap.childNodes));
  }
}

function renderKatex(expr: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expr, { displayMode, throwOnError: false, output: 'html' });
  } catch (err) {
    return `<code class="mid-math-error" title="${escapeHTML(String((err as Error).message))}">${escapeHTML(expr)}</code>`;
  }
}

interface TableState {
  sortColumn: number | null;
  sortDir: 'asc' | 'desc' | null;
  filter: string;
}

function attachTableTools(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    if (table.dataset.midTable === '1') return;
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;
    const headers = Array.from(thead.querySelectorAll<HTMLTableCellElement>('th'));
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));
    if (headers.length === 0 || rows.length === 0) return;
    table.dataset.midTable = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'mid-table';
    table.replaceWith(wrapper);

    const toolbar = document.createElement('div');
    toolbar.className = 'mid-table-toolbar';

    const filterInput = document.createElement('input');
    filterInput.type = 'search';
    filterInput.className = 'mid-table-filter';
    filterInput.placeholder = 'Filter rows…';

    const counter = document.createElement('span');
    counter.className = 'mid-table-counter';

    const exportGroup = document.createElement('div');
    exportGroup.className = 'mid-table-exports';
    exportGroup.append(
      makeIconButton('copy', 'Copy as Markdown', () => copyTableAsMarkdown(headers, getVisibleRows(rows))),
      makeIconButton('download', 'Download CSV', () => downloadTable(headers, getVisibleRows(rows), 'csv')),
      makeIconButton('list-ul', 'Download JSON', () => downloadTable(headers, getVisibleRows(rows), 'json')),
    );

    toolbar.append(filterInput, counter, exportGroup);
    wrapper.append(toolbar, table);

    const state: TableState = { sortColumn: null, sortDir: null, filter: '' };

    const apply = (): void => applyTableState(headers, rows, state, counter);
    apply();

    headers.forEach((th, idx) => {
      th.classList.add('mid-table-sortable');
      th.addEventListener('click', () => {
        if (state.sortColumn !== idx) { state.sortColumn = idx; state.sortDir = 'asc'; }
        else if (state.sortDir === 'asc') { state.sortDir = 'desc'; }
        else { state.sortColumn = null; state.sortDir = null; }
        apply();
      });
    });

    let debounce: number | undefined;
    filterInput.addEventListener('input', () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        state.filter = filterInput.value.trim().toLowerCase();
        apply();
      }, 120);
    });
  });

  function getVisibleRows(rows: HTMLTableRowElement[]): HTMLTableRowElement[] {
    return rows.filter(r => !r.hidden);
  }
}

function applyTableState(
  headers: HTMLTableCellElement[],
  rows: HTMLTableRowElement[],
  state: TableState,
  counter: HTMLSpanElement,
): void {
  headers.forEach((th, idx) => {
    th.classList.remove('is-sort-asc', 'is-sort-desc');
    if (state.sortColumn === idx && state.sortDir === 'asc') th.classList.add('is-sort-asc');
    if (state.sortColumn === idx && state.sortDir === 'desc') th.classList.add('is-sort-desc');
  });

  const tbody = rows[0]?.parentElement;
  if (!tbody) return;

  const sorted = [...rows];
  if (state.sortColumn !== null && state.sortDir !== null) {
    const col = state.sortColumn;
    const cellText = (r: HTMLTableRowElement): string => r.children[col]?.textContent?.trim() ?? '';
    const allNumeric = rows.every(r => {
      const t = cellText(r);
      return t === '' || !Number.isNaN(Number(t.replace(/[$,%\s]/g, '')));
    });
    sorted.sort((a, b) => {
      const av = cellText(a);
      const bv = cellText(b);
      let cmp: number;
      if (allNumeric) {
        cmp = (Number(av.replace(/[$,%\s]/g, '')) || 0) - (Number(bv.replace(/[$,%\s]/g, '')) || 0);
      } else {
        cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      }
      return state.sortDir === 'asc' ? cmp : -cmp;
    });
  }

  for (const r of sorted) tbody.appendChild(r);

  let visible = 0;
  rows.forEach(r => {
    if (!state.filter) {
      r.hidden = false;
      visible++;
      return;
    }
    const haystack = (r.textContent ?? '').toLowerCase();
    const match = haystack.includes(state.filter);
    r.hidden = !match;
    if (match) visible++;
  });

  counter.textContent = state.filter ? `${visible} of ${rows.length} rows` : `${rows.length} rows`;
}

function rowToValues(row: HTMLTableRowElement): string[] {
  return Array.from(row.children).map(c => c.textContent?.trim() ?? '');
}

function copyTableAsMarkdown(headers: HTMLTableCellElement[], rows: HTMLTableRowElement[]): void {
  const head = headers.map(h => h.textContent?.trim() ?? '');
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map(r => `| ${rowToValues(r).join(' | ')} |`),
  ];
  void navigator.clipboard.writeText(lines.join('\n'));
}

function downloadTable(headers: HTMLTableCellElement[], rows: HTMLTableRowElement[], format: 'csv' | 'json'): void {
  const head = headers.map(h => h.textContent?.trim() ?? '');
  let blob: Blob;
  let filename: string;
  if (format === 'csv') {
    const escape = (v: string): string => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [head.map(escape).join(','), ...rows.map(r => rowToValues(r).map(escape).join(','))];
    blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    filename = 'table.csv';
  } else {
    const objs = rows.map(r => {
      const vals = rowToValues(r);
      return Object.fromEntries(head.map((h, i) => [h, vals[i] ?? '']));
    });
    blob = new Blob([JSON.stringify(objs, null, 2)], { type: 'application/json' });
    filename = 'table.json';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function attachImageLightbox(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLImageElement>('img').forEach(img => {
    img.classList.add('mid-zoomable');
    img.addEventListener('click', () => openLightbox(img.src, img.alt));
  });
}

function openLightbox(src: string, alt: string): void {
  const existing = document.getElementById('mid-lightbox');
  existing?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'mid-lightbox';
  overlay.className = 'mid-lightbox';
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  overlay.appendChild(img);
  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

function renderEdit(): void {
  root.classList.remove('viewing', 'splitting');
  root.classList.add('editing');
  const ta = buildEditor();
  root.replaceChildren(ta);
  ta.focus();
}

function renderSplit(): void {
  root.classList.remove('viewing', 'editing');
  root.classList.add('splitting');
  if (!currentText && !currentPath) {
    root.innerHTML = emptyStateHTML();
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'mid-split';
  wrap.style.gridTemplateColumns = `${splitRatio * 100}% 6px 1fr`;

  const editor = buildEditor();
  editor.classList.add('mid-split-editor');

  const handle = document.createElement('div');
  handle.className = 'mid-split-handle';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.addEventListener('mousedown', e => beginSplitDrag(e, wrap));

  const preview = document.createElement('div');
  preview.className = 'mid-preview mid-split-preview';
  populatePreview(preview);

  editor.addEventListener('input', () => {
    currentText = editor.value;
    scheduleSplitRender(preview);
  });

  editor.addEventListener('scroll', () => {
    const ratio = editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
    preview.scrollTop = ratio * Math.max(0, preview.scrollHeight - preview.clientHeight);
  });

  wrap.append(editor, handle, preview);
  root.replaceChildren(wrap);
}

function buildEditor(): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.value = currentText;
  ta.spellcheck = false;
  ta.addEventListener('input', () => {
    currentText = ta.value;
  });
  return ta;
}

function scheduleSplitRender(preview: HTMLElement): void {
  if (renderTimer !== null) window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    populatePreview(preview);
    renderTimer = null;
  }, 50);
}

function beginSplitDrag(start: MouseEvent, wrap: HTMLElement): void {
  start.preventDefault();
  const wrapRect = wrap.getBoundingClientRect();
  const onMove = (e: MouseEvent): void => {
    const ratio = (e.clientX - wrapRect.left) / wrapRect.width;
    splitRatio = Math.max(0.15, Math.min(0.85, ratio));
    wrap.style.gridTemplateColumns = `${splitRatio * 100}% 6px 1fr`;
  };
  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    void window.mid.patchAppState({ splitRatio });
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function setMode(mode: Mode): void {
  currentMode = mode;
  btnView.classList.toggle('is-active', mode === 'view');
  btnSplit.classList.toggle('is-active', mode === 'split');
  btnEdit.classList.toggle('is-active', mode === 'edit');
  if (mode === 'view') renderView();
  else if (mode === 'edit') renderEdit();
  else renderSplit();
}

async function openFile(): Promise<void> {
  const result = await window.mid.openFileDialog();
  if (!result) return;
  loadFileContent(result.filePath, result.content);
}

function loadFileContent(filePath: string, content: string): void {
  currentText = content;
  currentPath = filePath;
  filenameEl.textContent = filePath.split('/').pop() ?? 'Untitled';
  highlightActiveTreeItem();
  setMode(currentMode === 'view' && content.length > 0 ? 'split' : currentMode);
}

async function selectTreeFile(filePath: string): Promise<void> {
  const content = await window.mid.readFile(filePath);
  loadFileContent(filePath, content);
}

async function openFolder(): Promise<void> {
  const result = await window.mid.openFolderDialog();
  if (!result) return;
  applyFolder(result.folderPath, result.tree);
}

function applyFolder(folderPath: string, tree: TreeEntry[]): void {
  currentFolder = folderPath;
  document.body.classList.add('has-sidebar');
  sidebar.hidden = false;
  sidebarFolderName.textContent = folderPath.split('/').pop() ?? folderPath;
  sidebarFolderName.title = folderPath;
  treeRoot.replaceChildren(...renderTree(tree));
  if (tree.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mid-tree-empty';
    empty.textContent = 'No markdown files in this folder.';
    treeRoot.appendChild(empty);
  }
}

function renderTree(entries: TreeEntry[]): HTMLElement[] {
  return entries.map(entry => renderTreeEntry(entry));
}

function renderTreeEntry(entry: TreeEntry): HTMLElement {
  const wrapper = document.createElement('div');
  const item = document.createElement('div');
  item.className = 'mid-tree-item';
  item.dataset.path = entry.path;
  item.dataset.kind = entry.kind;

  if (entry.kind === 'dir') {
    const isOpen = expandedDirs.has(entry.path);
    item.insertAdjacentHTML('beforeend', `<span class="mid-tree-chevron${isOpen ? ' is-open' : ''}">${iconHTML('chevron-right', 'mid-icon--sm')}</span>`);
    item.insertAdjacentHTML('beforeend', iconHTML(isOpen ? 'folder-open' : 'folder', 'mid-icon--muted'));
    item.appendChild(document.createTextNode(` ${entry.name}`));
    item.addEventListener('click', () => {
      if (expandedDirs.has(entry.path)) expandedDirs.delete(entry.path);
      else expandedDirs.add(entry.path);
      const fresh = renderTreeEntry(entry);
      wrapper.replaceWith(fresh);
    });
    wrapper.appendChild(item);
    if (isOpen && entry.children) {
      const children = document.createElement('div');
      children.className = 'mid-tree-children';
      children.append(...renderTree(entry.children));
      wrapper.appendChild(children);
    }
  } else {
    item.insertAdjacentHTML('beforeend', '<span class="mid-tree-chevron"></span>');
    item.insertAdjacentHTML('beforeend', iconHTML('file', 'mid-icon--muted'));
    item.appendChild(document.createTextNode(` ${entry.name}`));
    if (currentPath === entry.path) item.classList.add('is-active');
    item.addEventListener('click', () => void selectTreeFile(entry.path));
    wrapper.appendChild(item);
  }
  return wrapper;
}

function highlightActiveTreeItem(): void {
  treeRoot.querySelectorAll<HTMLElement>('.mid-tree-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.path === currentPath && el.dataset.kind === 'file');
  });
}

async function refreshFolder(): Promise<void> {
  if (!currentFolder) return;
  const tree = await window.mid.listFolderMd(currentFolder);
  treeRoot.replaceChildren(...renderTree(tree));
}

async function saveFile(): Promise<void> {
  if (currentPath) {
    await window.mid.writeFile(currentPath, currentText);
    flashStatus(`Saved ${currentPath.split('/').pop()}`);
    return;
  }
  const saved = await window.mid.saveFileDialog('untitled.md', currentText);
  if (saved) {
    currentPath = saved;
    filenameEl.textContent = saved.split('/').pop() ?? 'Untitled';
    flashStatus(`Saved ${saved.split('/').pop()}`);
  }
}

function defaultExportName(ext: string): string {
  const base = currentPath ? currentPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'document' : 'document';
  return `${base}.${ext}`;
}

async function exportAs(format: ExportFormat): Promise<void> {
  if (!currentText && format !== 'pdf' && format !== 'png') {
    flashStatus('Nothing to export');
    return;
  }
  switch (format) {
    case 'md':
      await window.mid.saveAs(defaultExportName('md'), currentText, [{ name: 'Markdown', extensions: ['md'] }]);
      flashStatus('Exported Markdown');
      break;
    case 'txt':
      await window.mid.saveAs(defaultExportName('txt'), markdownToPlainText(currentText), [{ name: 'Plain text', extensions: ['txt'] }]);
      flashStatus('Exported text');
      break;
    case 'html': {
      const html = buildStandaloneHTML();
      await window.mid.saveAs(defaultExportName('html'), html, [{ name: 'HTML', extensions: ['html'] }]);
      flashStatus('Exported HTML');
      break;
    }
    case 'pdf': {
      const result = await window.mid.exportPDF(defaultExportName('pdf'));
      flashStatus(result ? 'Exported PDF' : 'PDF cancelled');
      break;
    }
    case 'png': {
      const preview = root.querySelector<HTMLElement>('.mid-preview');
      if (!preview) { flashStatus('No preview to capture'); return; }
      const dataUrl = await toPng(preview, {
        pixelRatio: 2,
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--mid-bg').trim() || '#ffffff',
      });
      const buffer = dataUrlToArrayBuffer(dataUrl);
      await window.mid.saveAs(defaultExportName('png'), buffer, [{ name: 'PNG', extensions: ['png'] }]);
      flashStatus('Exported PNG');
      break;
    }
  }
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

function markdownToPlainText(md: string): string {
  return md
    .replace(/^---\r?\n[\s\S]+?\r?\n---\r?\n?/, '')   // strip frontmatter
    .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?|```/g, ''))  // unwrap code fences
    .replace(/`([^`]+)`/g, '$1')                       // inline code
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')          // images → alt text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')           // links → text
    .replace(/^[#>\s-]+/gm, '')                         // heading / quote / list markers
    .replace(/[*_~]+/g, '')                              // emphasis markers
    .replace(/\n{3,}/g, '\n\n');                         // collapse extra blank lines
}

function buildStandaloneHTML(): string {
  const preview = root.querySelector<HTMLElement>('.mid-preview');
  const body = preview ? preview.outerHTML : '<p>(empty)</p>';
  const title = currentPath ? currentPath.split('/').pop() ?? 'Untitled' : 'Untitled';
  // Inline the active stylesheets so the export is self-contained.
  const styles = Array.from(document.styleSheets)
    .map(sheet => {
      try {
        return Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
      } catch {
        return '';
      }
    })
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHTML(title)}</title>
<style>${styles}</style>
</head>
<body class="${document.body.className}">
<main class="viewing">${body}</main>
</body>
</html>`;
}

function flashStatus(message: string): void {
  const original = filenameEl.textContent;
  filenameEl.textContent = message;
  setTimeout(() => {
    filenameEl.textContent = original;
  }, 1800);
}

btnView.addEventListener('click', () => setMode('view'));
btnSplit.addEventListener('click', () => setMode('split'));
btnEdit.addEventListener('click', () => setMode('edit'));
btnOpen.addEventListener('click', () => void openFile());
btnOpenFolder.addEventListener('click', () => void openFolder());
btnSave.addEventListener('click', () => void saveFile());
sidebarRefresh.addEventListener('click', () => void refreshFolder());
modeFilesBtn.addEventListener('click', () => setSidebarMode('files'));
modeNotesBtn.addEventListener('click', () => setSidebarMode('notes'));
notesNewBtn.addEventListener('click', () => void promptCreateNote());
notesFilter.addEventListener('input', () => {
  notesFilterText = notesFilter.value.trim().toLowerCase();
  renderNotes();
});

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n' && !e.shiftKey && !e.altKey) {
    if (currentFolder) {
      e.preventDefault();
      setSidebarMode('notes');
      void promptCreateNote();
    }
  }
});

function setSidebarMode(mode: 'files' | 'notes'): void {
  sidebarMode = mode;
  modeFilesBtn.classList.toggle('is-active', mode === 'files');
  modeNotesBtn.classList.toggle('is-active', mode === 'notes');
  sidebarFilesHeader.hidden = mode !== 'files';
  sidebarNotesHeader.hidden = mode !== 'notes';
  treeRoot.hidden = mode !== 'files';
  notesListEl.hidden = mode !== 'notes';
  if (mode === 'notes') void loadNotes();
}

async function loadNotes(): Promise<void> {
  if (!currentFolder) {
    notesListEl.innerHTML = '<div class="mid-tree-empty">Open a folder first.</div>';
    return;
  }
  notes = await window.mid.notesList(currentFolder);
  renderNotes();
}

function renderNotes(): void {
  if (!currentFolder) return;
  const filtered = notesFilterText
    ? notes.filter(n => n.title.toLowerCase().includes(notesFilterText) || n.tags.some(t => t.toLowerCase().includes(notesFilterText)))
    : notes;
  if (filtered.length === 0) {
    notesListEl.innerHTML = `<div class="mid-tree-empty">${notes.length === 0 ? 'No notes yet. Create one with + or Cmd/Ctrl+N.' : 'No matches.'}</div>`;
    return;
  }
  const sorted = [...filtered].sort((a, b) => b.updated.localeCompare(a.updated));
  notesListEl.replaceChildren(...sorted.map(renderNoteRow));
}

function renderNoteRow(note: NoteEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mid-note-row';
  row.dataset.id = note.id;
  if (currentPath && currentPath.endsWith('/' + note.path)) row.classList.add('is-active');
  const title = document.createElement('div');
  title.className = 'mid-note-title';
  title.textContent = note.title;
  const meta = document.createElement('div');
  meta.className = 'mid-note-meta';
  const updated = new Date(note.updated).toLocaleDateString();
  meta.textContent = updated;
  if (note.tags.length > 0) {
    const tags = document.createElement('div');
    tags.className = 'mid-note-tags';
    for (const t of note.tags) {
      const chip = document.createElement('span');
      chip.className = 'mid-note-tag';
      chip.textContent = `#${t}`;
      tags.appendChild(chip);
    }
    meta.appendChild(tags);
  }
  const del = document.createElement('button');
  del.className = 'mid-note-delete';
  del.title = 'Delete note';
  del.innerHTML = iconHTML('trash', 'mid-icon--sm');
  del.addEventListener('click', e => {
    e.stopPropagation();
    void deleteNote(note);
  });
  row.append(title, meta, del);
  row.addEventListener('click', () => void openNote(note));
  return row;
}

async function openNote(note: NoteEntry): Promise<void> {
  if (!currentFolder) return;
  const fullPath = `${currentFolder}/${note.path}`;
  const content = await window.mid.readFile(fullPath);
  loadFileContent(fullPath, content);
  renderNotes();
}

async function promptCreateNote(): Promise<void> {
  if (!currentFolder) {
    flashStatus('Open a folder first');
    return;
  }
  const title = window.prompt('New note title:');
  if (!title) return;
  const { entry, fullPath } = await window.mid.notesCreate(currentFolder, title);
  notes.push(entry);
  renderNotes();
  const content = await window.mid.readFile(fullPath);
  loadFileContent(fullPath, content);
}

async function deleteNote(note: NoteEntry): Promise<void> {
  if (!currentFolder) return;
  if (!window.confirm(`Delete "${note.title}"? The file will be removed too.`)) return;
  await window.mid.notesDelete(currentFolder, note.id);
  notes = notes.filter(n => n.id !== note.id);
  renderNotes();
}

window.mid.onThemeChanged(applyTheme);
window.mid.onMenuOpen(() => void openFile());
window.mid.onMenuOpenFolder(() => void openFolder());
window.mid.onMenuSave(() => void saveFile());
window.mid.onMenuExport(fmt => void exportAs(fmt));

hydrateIconButtons(document);
wireSettingsPanel();

function wireSettingsPanel(): void {
  const panel = document.getElementById('settings-panel') as HTMLElement;
  const openBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  const closeBtn = document.getElementById('settings-close') as HTMLButtonElement;
  const themeSel = document.getElementById('setting-theme') as HTMLSelectElement;
  const fontSel = document.getElementById('setting-font') as HTMLSelectElement;
  const sizeRange = document.getElementById('setting-font-size') as HTMLInputElement;
  const sizeVal = document.getElementById('setting-font-size-value') as HTMLSpanElement;
  const widthRange = document.getElementById('setting-preview-width') as HTMLInputElement;
  const widthVal = document.getElementById('setting-preview-width-value') as HTMLSpanElement;
  const resetBtn = document.getElementById('settings-reset') as HTMLButtonElement;

  const syncFromSettings = (): void => {
    themeSel.value = settings.theme;
    fontSel.value = settings.fontFamily;
    sizeRange.value = String(settings.fontSize);
    sizeVal.textContent = `${settings.fontSize}px`;
    widthRange.value = String(settings.previewMaxWidth);
    widthVal.textContent = `${settings.previewMaxWidth}px`;
  };

  const persist = (patch: Partial<typeof settings>): void => {
    Object.assign(settings, patch);
    applySettings();
    void window.mid.patchAppState(patch);
  };

  const open = (): void => {
    syncFromSettings();
    panel.hidden = false;
    document.body.classList.add('settings-open');
  };
  const close = (): void => {
    panel.hidden = true;
    document.body.classList.remove('settings-open');
  };

  openBtn.addEventListener('click', () => (panel.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);

  themeSel.addEventListener('change', () => persist({ theme: themeSel.value as ThemeChoice }));
  fontSel.addEventListener('change', () => persist({ fontFamily: fontSel.value as FontFamilyChoice }));
  sizeRange.addEventListener('input', () => {
    const n = Number(sizeRange.value);
    sizeVal.textContent = `${n}px`;
    persist({ fontSize: n });
  });
  widthRange.addEventListener('input', () => {
    const n = Number(widthRange.value);
    widthVal.textContent = `${n}px`;
    persist({ previewMaxWidth: n });
  });
  resetBtn.addEventListener('click', () => {
    Object.assign(settings, DEFAULT_SETTINGS);
    applySettings();
    syncFromSettings();
    void window.mid.patchAppState({ ...DEFAULT_SETTINGS });
  });

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      panel.hidden ? open() : close();
    } else if (e.key === 'Escape' && !panel.hidden) {
      close();
    }
  });
}

function hydrateIconButtons(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => {
    const name = el.dataset.icon as IconName | undefined;
    const label = el.dataset.label;
    if (!name) return;
    const labelHTML = label ? `<span class="mid-btn-label">${label}</span>` : '';
    el.innerHTML = `${iconHTML(name)}${labelHTML}`;
  });
}

void window.mid.getAppInfo().then(info => {
  document.body.classList.toggle('is-mac', info.platform === 'darwin');
  applyTheme(info.isDark);
});

void window.mid.readAppState().then(async state => {
  if (typeof state.splitRatio === 'number' && state.splitRatio > 0 && state.splitRatio < 1) {
    splitRatio = state.splitRatio;
  }
  if (state.fontFamily) settings.fontFamily = state.fontFamily;
  if (typeof state.fontSize === 'number' && state.fontSize >= 12 && state.fontSize <= 22) {
    settings.fontSize = state.fontSize;
  }
  if (state.theme) settings.theme = state.theme;
  if (typeof state.previewMaxWidth === 'number' && state.previewMaxWidth >= 600 && state.previewMaxWidth <= 1400) {
    settings.previewMaxWidth = state.previewMaxWidth;
  }
  applySettings();
  if (state.lastFolder) {
    try {
      const tree = await window.mid.listFolderMd(state.lastFolder);
      applyFolder(state.lastFolder, tree);
    } catch {
      // folder gone — silently ignore
    }
  }
  setMode(currentMode);
});
