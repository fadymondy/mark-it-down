import { renderMarkdown as coreRenderMarkdown, applyMermaidPlaceholders } from '../../../packages/core/src/markdown/renderer';
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import yaml from 'js-yaml';
import { toPng } from 'html-to-image';
import * as XLSX from 'xlsx';
import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer, Table as DocxTable, TableRow as DocxTableRow, TableCell as DocxTableCell, WidthType } from 'docx';
import { iconHTML, IconName } from '../../../packages/ui-tokens/src/icons';
import { iconForFile } from '../../../packages/ui-tokens/src/file-icons';
import { THEMES, ThemeDefinition } from '../../../packages/core/src/themes/themes';

interface TreeEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: TreeEntry[];
}

type FontFamilyChoice = 'system' | 'sans' | 'serif' | 'mono';
/** A theme is either one of the built-in modes or a named theme id prefixed with `theme:`. */
type ThemeChoice = 'auto' | 'light' | 'dark' | 'sepia' | `theme:${string}`;

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
  fontSize: 17,
  theme: 'auto' as ThemeChoice,
  previewMaxWidth: 760,
};

const FONT_STACKS: Record<FontFamilyChoice, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Apple Garamond", Charter, serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

type ExportFormat = 'md' | 'html' | 'pdf' | 'png' | 'txt' | 'docx';

interface NoteEntry {
  id: string;
  title: string;
  path: string;
  tags: string[];
  created: string;
  updated: string;
  warehouse?: string;
  pushedAt?: string;
}

interface Warehouse {
  id: string;
  name: string;
  repo: string;
  branch?: string;
  subdir?: string;
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
  warehousesList(workspace: string): Promise<Warehouse[]>;
  notesAttachWarehouse(workspace: string, id: string, warehouseId: string | null): Promise<NoteEntry | null>;
  notesMarkPushed(workspace: string, id: string): Promise<NoteEntry | null>;
  ghAuthStatus(): Promise<{ authenticated: boolean; output: string }>;
  repoStatus(workspace: string): Promise<{ initialized: boolean; branch: string; ahead: number; behind: number; dirty: number; remote: string }>;
  repoConnect(workspace: string, repoSlug: string): Promise<{ url: string }>;
  repoSync(workspace: string, message: string): Promise<{ steps: string[]; ok: boolean; error?: string }>;
  saveAs(defaultName: string, content: string | ArrayBuffer, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  exportPDF(defaultName: string): Promise<string | null>;
  saveFileDialog(defaultName: string, content: string): Promise<string | null>;
  getAppInfo(): Promise<{ version: string; platform: string; isDark: boolean; userData: string; documents: string }>;
  openExternal(url: string): Promise<void>;
  onThemeChanged(cb: (isDark: boolean) => void): () => void;
  onMenuOpen(cb: () => void): () => void;
  onMenuOpenFolder(cb: () => void): () => void;
  onMenuSave(cb: () => void): () => void;
  onMenuExport(cb: (format: 'md' | 'html' | 'pdf' | 'png' | 'txt' | 'docx') => void): () => void;
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
const statusRepoBtn = document.getElementById('status-repo') as HTMLButtonElement;
const statusRepoText = document.getElementById('status-repo-text') as HTMLSpanElement;
const statusRepoIcon = document.getElementById('status-repo-icon') as HTMLSpanElement;
const statusWords = document.getElementById('status-words') as HTMLSpanElement;
const statusCursor = document.getElementById('status-cursor') as HTMLSpanElement;
const statusSave = document.getElementById('status-save') as HTMLSpanElement;

let currentText = '';
let currentPath: string | null = null;
let currentMode: Mode = 'view';
let mermaidThemeKind = 0;
let currentFolder: string | null = null;
let splitRatio = 0.5;
let renderTimer: number | null = null;
let osIsDark = false;
let sidebarMode: 'files' | 'notes' = 'files';
let notes: NoteEntry[] = [];
let notesFilterText = '';
let recentFiles: string[] = [];
let warehouses: Warehouse[] = [];
const settings = { ...DEFAULT_SETTINGS };
const expandedDirs = new Set<string>();

function applyTheme(isDark: boolean): void {
  osIsDark = isDark;
  applyResolvedTheme();
}

const NAMED_THEME_PROPS: Array<keyof ThemeDefinition['palette']> = [
  'bg', 'fg', 'fgMuted', 'border', 'link', 'linkHover', 'codeBg', 'inlineCodeBg', 'tableStripe', 'accent',
];

function clearNamedThemeProps(root: HTMLElement): void {
  root.style.removeProperty('--mid-bg');
  root.style.removeProperty('--mid-fg');
  root.style.removeProperty('--mid-fg-muted');
  root.style.removeProperty('--mid-border');
  root.style.removeProperty('--mid-link');
  root.style.removeProperty('--mid-link-hover');
  root.style.removeProperty('--mid-code-bg');
  root.style.removeProperty('--mid-inline-code-bg');
  root.style.removeProperty('--mid-table-stripe');
  root.style.removeProperty('--mid-accent');
  root.style.removeProperty('--mid-surface');
  root.style.removeProperty('--mid-surface-hover');
}

function applyNamedTheme(theme: ThemeDefinition): void {
  const root = document.documentElement;
  root.classList.remove('dark', 'sepia');
  if (theme.kind === 'dark') root.classList.add('dark');
  const p = theme.palette;
  root.style.setProperty('--mid-bg', p.bg);
  root.style.setProperty('--mid-fg', p.fg);
  root.style.setProperty('--mid-fg-muted', p.fgMuted);
  root.style.setProperty('--mid-border', p.border);
  root.style.setProperty('--mid-link', p.link);
  root.style.setProperty('--mid-link-hover', p.linkHover);
  root.style.setProperty('--mid-code-bg', p.codeBg);
  root.style.setProperty('--mid-inline-code-bg', p.inlineCodeBg);
  root.style.setProperty('--mid-table-stripe', p.tableStripe);
  root.style.setProperty('--mid-accent', p.accent);
  // Derive a surface from codeBg for sidebars / status / chips so the theme feels coherent.
  root.style.setProperty('--mid-surface', p.codeBg);
  initMermaid(theme.kind === 'dark' ? 2 : 1);
}

function applyResolvedTheme(): void {
  const root = document.documentElement;
  if (settings.theme.startsWith('theme:')) {
    const id = settings.theme.slice('theme:'.length);
    const theme = THEMES.find(t => t.id === id);
    if (theme) {
      applyNamedTheme(theme);
      return;
    }
  }
  clearNamedThemeProps(root);
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
  root.style.setProperty('--mid-font-size-reading', `${settings.fontSize}px`);
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

function welcomeHeroHTML(recent: string[]): string {
  const recentHTML = recent.length === 0 ? '' : `
    <div class="mid-welcome-recent">
      <div class="mid-welcome-recent-title">Recent</div>
      ${recent.slice(0, 5).map(p => {
        const name = p.split('/').pop() ?? p;
        return `<button class="mid-welcome-recent-item" data-recent-path="${escapeHTML(p)}">
          ${iconHTML('file', 'mid-icon--sm mid-icon--muted')}
          <span class="mid-welcome-recent-name">${escapeHTML(name)}</span>
          <span class="mid-welcome-recent-path">${escapeHTML(p.replace(/\/[^/]+$/, ''))}</span>
        </button>`;
      }).join('')}
    </div>`;
  return `
    <div class="mid-welcome">
      <div class="mid-welcome-glyph">${midBrandGlyphSVG()}</div>
      <h1 class="mid-welcome-title">Mark It Down</h1>
      <p class="mid-welcome-tagline">A calm markdown studio — read first, edit second.</p>
      <div class="mid-welcome-actions">
        <button class="mid-welcome-action" data-welcome-action="open-folder">
          ${iconHTML('folder-open')}
          <span class="mid-welcome-action-label">Open Folder</span>
          <span class="mid-welcome-action-kbd">⌘⇧O</span>
        </button>
        <button class="mid-welcome-action" data-welcome-action="open-file">
          ${iconHTML('file')}
          <span class="mid-welcome-action-label">Open File</span>
          <span class="mid-welcome-action-kbd">⌘O</span>
        </button>
        <button class="mid-welcome-action" data-welcome-action="new-note" ${currentFolder ? '' : 'disabled'}>
          ${iconHTML('plus')}
          <span class="mid-welcome-action-label">New Note</span>
          <span class="mid-welcome-action-kbd">⌘N</span>
        </button>
        <button class="mid-welcome-action" data-welcome-action="sample">
          ${iconHTML('image')}
          <span class="mid-welcome-action-label">Try the sample</span>
          <span class="mid-welcome-action-kbd"></span>
        </button>
      </div>
      ${recentHTML}
    </div>`;
}

function midBrandGlyphSVG(): string {
  return `<svg viewBox="0 0 1024 1024" aria-hidden="true">
    <defs>
      <linearGradient id="mid-hero-page" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1d2333"/><stop offset="1" stop-color="#3b3a7a"/>
      </linearGradient>
      <linearGradient id="mid-hero-hash" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff5d8"/><stop offset="1" stop-color="#f7c97b"/>
      </linearGradient>
    </defs>
    <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#mid-hero-page)"/>
    <g fill="url(#mid-hero-hash)">
      <g transform="translate(512 512) skewX(-8) translate(-512 -512)">
        <rect x="350" y="232" width="92" height="560" rx="46"/>
        <rect x="582" y="232" width="92" height="560" rx="46"/>
      </g>
      <rect x="232" y="402" width="560" height="92" rx="46"/>
      <rect x="232" y="566" width="560" height="92" rx="46"/>
    </g>
  </svg>`;
}

function emptyStateHTML(): string {
  return welcomeHeroHTML(recentFiles);
}

function attachWelcomeHandlers(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('[data-welcome-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.welcomeAction;
      if (action === 'open-folder') void openFolder();
      else if (action === 'open-file') void openFile();
      else if (action === 'new-note') void promptCreateNote();
      else if (action === 'sample') void openSample();
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-recent-path]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.recentPath;
      if (p) void openRecent(p);
    });
  });
}

async function openSample(): Promise<void> {
  const candidates = [
    'media/welcome-sample.md',
    '../../../media/welcome-sample.md',
  ];
  for (const rel of candidates) {
    try {
      const text = await window.mid.readFile(rel);
      currentText = text;
      currentPath = null;
      filenameEl.textContent = 'Welcome sample';
      setMode('view');
      updateWordCount();
      return;
    } catch {
      // try next
    }
  }
  flashStatus('Sample not found');
}

async function openRecent(p: string): Promise<void> {
  try {
    const content = await window.mid.readFile(p);
    loadFileContent(p, content);
    pushRecent(p);
  } catch {
    flashStatus('File no longer exists');
    recentFiles = recentFiles.filter(f => f !== p);
    void window.mid.patchAppState({ recentFiles });
    if (currentMode === 'view') renderView();
  }
}

function pushRecent(p: string): void {
  recentFiles = [p, ...recentFiles.filter(f => f !== p)].slice(0, 10);
  void window.mid.patchAppState({ recentFiles });
}

function renderView(): void {
  root.classList.remove('editing', 'splitting');
  root.classList.add('viewing');
  if (!currentText) {
    root.innerHTML = emptyStateHTML();
    attachWelcomeHandlers(root);
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
        makeMermaidInteractive(el);
        attachMermaidToolbar(el, code);
      })
      .catch(err => {
        el.innerHTML = `<pre style="color: #d04444">Mermaid error: ${String((err as Error)?.message ?? err)}</pre>`;
      });
  });
}

function makeMermaidInteractive(host: HTMLDivElement): void {
  const svg = host.querySelector('svg') as SVGSVGElement | null;
  if (!svg) return;
  const viewport = document.createElement('div');
  viewport.className = 'mid-mermaid-viewport';
  svg.parentElement?.insertBefore(viewport, svg);
  viewport.appendChild(svg);

  const state = { scale: 1, tx: 0, ty: 0 };
  const apply = (): void => {
    svg.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  };
  svg.style.transformOrigin = '0 0';
  svg.style.cursor = 'grab';
  apply();

  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const next = Math.max(0.25, Math.min(4, state.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    // Zoom around cursor: keep the point under the cursor stable.
    state.tx = ox - (ox - state.tx) * (next / state.scale);
    state.ty = oy - (oy - state.ty) * (next / state.scale);
    state.scale = next;
    apply();
  }, { passive: false });

  let dragging = false;
  let dragStartX = 0, dragStartY = 0, dragOriginTx = 0, dragOriginTy = 0;
  viewport.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragOriginTx = state.tx; dragOriginTy = state.ty;
    svg.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    state.tx = dragOriginTx + (e.clientX - dragStartX);
    state.ty = dragOriginTy + (e.clientY - dragStartY);
    apply();
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    svg.style.cursor = 'grab';
  });

  viewport.addEventListener('dblclick', () => {
    state.scale = 1; state.tx = 0; state.ty = 0;
    apply();
  });

  // Expose reset for the right-click menu.
  (host as HTMLDivElement & { _midResetMermaid?: () => void })._midResetMermaid = () => {
    state.scale = 1; state.tx = 0; state.ty = 0;
    apply();
  };
}

function attachMermaidToolbar(host: HTMLDivElement, source: string): void {
  host.style.position = 'relative';
  host.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    const reset = (host as HTMLDivElement & { _midResetMermaid?: () => void })._midResetMermaid;
    openContextMenu([
      { icon: 'copy', label: 'Copy SVG', action: () => copyMermaidSVG(host) },
      { icon: 'download', label: 'Download SVG', action: () => downloadMermaidSVG(host, source) },
      { icon: 'image', label: 'Download PNG', action: () => void downloadMermaidPNG(host) },
      { separator: true, label: '' },
      { icon: 'refresh', label: 'Reset view', action: () => reset?.() },
    ], e.clientX, e.clientY);
  });
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

    addLineNumbers(pre, code);

    pre.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu([
        { icon: 'copy', label: 'Copy', kbd: '⌘C', action: () => void navigator.clipboard.writeText(code.innerText) },
        { icon: 'download', label: 'Download as file', action: () => downloadCode(code.innerText, lang) },
        { icon: 'image', label: 'Export as PNG', action: () => void exportCodeBlockAsPNG(pre) },
        { separator: true, label: '' },
        { icon: 'list-ul', label: pre.classList.contains('with-lines') ? 'Hide line numbers' : 'Show line numbers', action: () => pre.classList.toggle('with-lines') },
      ], e.clientX, e.clientY);
    });
  });
}

interface MenuItem {
  icon?: IconName;
  label: string;
  kbd?: string;
  action?: () => void | Promise<void>;
  separator?: boolean;
  disabled?: boolean;
}

function openContextMenu(items: MenuItem[], x: number, y: number): void {
  document.querySelectorAll('.mid-context-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'mid-context-menu';
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'mid-context-sep';
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement('button');
    row.className = 'mid-context-item';
    row.type = 'button';
    if (item.disabled) row.disabled = true;
    const iconHtml = item.icon ? iconHTML(item.icon, 'mid-icon--sm mid-icon--muted') : '<span class="mid-icon mid-icon--sm"></span>';
    const kbdHtml = item.kbd ? `<span class="mid-context-kbd">${item.kbd}</span>` : '';
    row.innerHTML = `${iconHtml}<span class="mid-context-label">${escapeHTML(item.label)}</span>${kbdHtml}`;
    row.addEventListener('click', () => {
      void item.action?.();
      close();
    });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top = `${Math.min(y, maxY)}px`;

  const close = (): void => {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onOutside = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
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
  // Build a Carbon-style frame off-screen with macOS traffic lights + filename label.
  const frame = document.createElement('div');
  frame.className = 'mid-code-export-frame';
  frame.style.cssText = 'position: fixed; left: -10000px; top: 0;';

  const chrome = document.createElement('div');
  chrome.className = 'mid-code-export-chrome';
  chrome.innerHTML = `
    <span class="mid-code-export-dot" style="background: #ff5f57"></span>
    <span class="mid-code-export-dot" style="background: #febc2e"></span>
    <span class="mid-code-export-dot" style="background: #28c840"></span>
    <span class="mid-code-export-title"></span>
  `;
  const lang = pre.querySelector<HTMLElement>('.mid-code-lang')?.textContent ?? '';
  const titleEl = chrome.querySelector('.mid-code-export-title') as HTMLSpanElement;
  titleEl.textContent = lang ? `snippet.${LANG_TO_EXT[lang] ?? 'txt'}` : 'snippet.txt';

  const cloneHost = document.createElement('div');
  cloneHost.className = 'mid-code-export-body';
  const preClone = pre.cloneNode(true) as HTMLElement;
  preClone.querySelector('.mid-code-lang')?.remove();
  cloneHost.appendChild(preClone);

  frame.append(chrome, cloneHost);
  document.body.appendChild(frame);

  try {
    const dataUrl = await toPng(frame, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--mid-bg').trim() || '#0d1117',
    });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'code.png';
    a.click();
  } finally {
    frame.remove();
  }
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

    // Compact filter chip — only shown for tables with > 5 rows so small tables stay clean.
    const showChip = rows.length > 5;
    const chip = document.createElement('div');
    chip.className = 'mid-table-chip';
    const filterInput = document.createElement('input');
    filterInput.type = 'search';
    filterInput.className = 'mid-table-filter';
    filterInput.placeholder = 'Filter…';
    const counter = document.createElement('span');
    counter.className = 'mid-table-counter';
    chip.append(filterInput, counter);
    if (!showChip) chip.hidden = true;

    wrapper.append(chip, table);

    const state: TableState = { sortColumn: null, sortDir: null, filter: '' };
    const getVisible = (): HTMLTableRowElement[] => rows.filter(r => !r.hidden);
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

    wrapper.addEventListener('contextmenu', e => {
      if ((e.target as HTMLElement).closest('input, button')) return;
      e.preventDefault();
      e.stopPropagation();
      openContextMenu([
        { icon: 'copy', label: 'Copy as Markdown', action: () => copyTableAsMarkdown(headers, getVisible()) },
        { icon: 'download', label: 'Download CSV', action: () => downloadTable(headers, getVisible(), 'csv') },
        { icon: 'download', label: 'Download Excel (.xlsx)', action: () => downloadTable(headers, getVisible(), 'xlsx') },
        { icon: 'list-ul', label: 'Download JSON', action: () => downloadTable(headers, getVisible(), 'json') },
        { separator: true, label: '' },
        { icon: state.sortColumn === null ? 'x' : 'refresh', label: state.sortColumn === null ? 'No sort active' : 'Reset sort', disabled: state.sortColumn === null, action: () => { state.sortColumn = null; state.sortDir = null; apply(); } },
      ], e.clientX, e.clientY);
    });
  });
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

function downloadTable(headers: HTMLTableCellElement[], rows: HTMLTableRowElement[], format: 'csv' | 'json' | 'xlsx'): void {
  const head = headers.map(h => h.textContent?.trim() ?? '');
  let blob: Blob;
  let filename: string;
  if (format === 'csv') {
    const escape = (v: string): string => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [head.map(escape).join(','), ...rows.map(r => rowToValues(r).map(escape).join(','))];
    blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    filename = 'table.csv';
  } else if (format === 'json') {
    const objs = rows.map(r => {
      const vals = rowToValues(r);
      return Object.fromEntries(head.map((h, i) => [h, vals[i] ?? '']));
    });
    blob = new Blob([JSON.stringify(objs, null, 2)], { type: 'application/json' });
    filename = 'table.json';
  } else {
    // xlsx — single sheet, header row + data, frozen first row
    const aoa = [head, ...rows.map(r => rowToValues(r))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    ws['!cols'] = head.map(h => ({ wch: Math.max(h.length, 12) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    filename = 'table.xlsx';
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
    updateWordCount();
    updateSaveIndicator(false);
  });
  const onCursor = (): void => {
    const before = ta.value.slice(0, ta.selectionStart);
    const lines = before.split('\n');
    updateCursor(lines.length, lines[lines.length - 1].length + 1);
  };
  ta.addEventListener('keyup', onCursor);
  ta.addEventListener('click', onCursor);
  ta.addEventListener('focus', onCursor);
  ta.addEventListener('blur', hideCursor);
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
  if (mode === 'view') hideCursor();
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
  setMode(currentMode);
  updateWordCount();
  updateSaveIndicator(true);
  pushRecent(filePath);
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
  void refreshRepoStatus();
}

async function refreshRepoStatus(): Promise<void> {
  if (!currentFolder) return;
  const s = await window.mid.repoStatus(currentFolder);
  statusRepoIcon.innerHTML = iconHTML('github', 'mid-icon--sm');
  if (!s.initialized || !s.remote) {
    statusRepoText.textContent = s.initialized ? 'No remote' : 'No repo';
    statusRepoBtn.dataset.connected = 'false';
    statusRepoBtn.title = 'Click to connect a GitHub repo';
    return;
  }
  const slug = parseSlugFromUrl(s.remote);
  const branch = s.branch || 'detached';
  const counters: string[] = [];
  if (s.ahead) counters.push(`↑${s.ahead}`);
  if (s.behind) counters.push(`↓${s.behind}`);
  if (s.dirty) counters.push(`±${s.dirty}`);
  const counterText = counters.length ? ` ${counters.join(' ')}` : '';
  statusRepoText.textContent = `${slug} · ${branch}${counterText}`;
  statusRepoBtn.dataset.connected = 'true';
  statusRepoBtn.title = `${s.remote} — click to sync, right-click for actions`;
}

function updateWordCount(): void {
  const words = currentText.trim() ? currentText.trim().split(/\s+/).length : 0;
  statusWords.textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
}

function updateSaveIndicator(saved: boolean): void {
  statusSave.classList.toggle('is-dirty', !saved);
  statusSave.title = saved ? 'Saved' : 'Unsaved changes';
}

function updateCursor(line: number, col: number): void {
  statusCursor.hidden = false;
  statusCursor.textContent = `L${line}:C${col}`;
}

function hideCursor(): void { statusCursor.hidden = true; }

function parseSlugFromUrl(url: string): string {
  const m = /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(url);
  return m ? m[1] : url;
}

async function promptConnectRepo(): Promise<void> {
  if (!currentFolder) return;
  const auth = await window.mid.ghAuthStatus();
  if (!auth.authenticated) {
    const proceed = await midConfirm(
      'gh CLI not authenticated',
      `${auth.output.split('\n')[0]}\n\nRun "gh auth login" in a terminal first, then retry. Continue anyway?`,
    );
    if (!proceed) return;
  }
  const slug = await midPrompt('Connect GitHub repo', 'owner/name', '');
  if (!slug || !/^[^/]+\/[^/]+$/.test(slug)) return;
  await window.mid.repoConnect(currentFolder, slug);
  flashStatus(`Connected to ${slug}`);
  await refreshRepoStatus();
}

async function syncRepo(): Promise<void> {
  if (!currentFolder) return;
  repoSyncBtn.disabled = true;
  const message = (await midPrompt('Sync repo', 'Commit message (blank = auto)', '')) ?? '';
  const result = await window.mid.repoSync(currentFolder, message);
  repoSyncBtn.disabled = false;
  if (result.ok) flashStatus(`Synced — ${result.steps.join(', ')}`);
  else flashStatus(`Sync failed: ${result.error?.split('\n')[0] ?? 'unknown'}`);
  await refreshRepoStatus();
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
    const folderMatch = iconForFile(entry.name, 'dir');
    const folderIcon = isOpen && folderMatch.icon === 'folder' ? 'folder-open' : folderMatch.icon;
    item.insertAdjacentHTML('beforeend', `<span class="mid-tree-chevron${isOpen ? ' is-open' : ''}">${iconHTML('chevron-right', 'mid-icon--sm')}</span>`);
    const folderIconHtml = iconHTML(folderIcon, 'mid-icon--muted mid-tree-icon');
    if (folderMatch.color) {
      const span = document.createElement('span');
      span.innerHTML = folderIconHtml;
      const svg = span.firstElementChild as HTMLElement | null;
      if (svg) svg.style.color = folderMatch.color;
      item.appendChild(span.firstElementChild!);
    } else {
      item.insertAdjacentHTML('beforeend', folderIconHtml);
    }
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
    const fileMatch = iconForFile(entry.name, 'file');
    const fileIconHtml = iconHTML(fileMatch.icon, 'mid-icon--muted mid-tree-icon');
    if (fileMatch.color) {
      const span = document.createElement('span');
      span.innerHTML = fileIconHtml;
      const svg = span.firstElementChild as HTMLElement | null;
      if (svg) svg.style.color = fileMatch.color;
      item.appendChild(span.firstElementChild!);
    } else {
      item.insertAdjacentHTML('beforeend', fileIconHtml);
    }
    item.appendChild(document.createTextNode(` ${entry.name}`));
    if (currentPath === entry.path) item.classList.add('is-active');
    item.addEventListener('click', () => void selectTreeFile(entry.path));
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu([
        { icon: 'show', label: 'Open', action: () => void selectTreeFile(entry.path) },
        { icon: 'folder-open', label: 'Reveal in Finder', action: () => void window.mid.openExternal(`file://${entry.path.replace(/\/[^/]+$/, '')}`) },
      ], e.clientX, e.clientY);
    });
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
    updateSaveIndicator(true);
    return;
  }
  const saved = await window.mid.saveFileDialog('untitled.md', currentText);
  if (saved) {
    currentPath = saved;
    filenameEl.textContent = saved.split('/').pop() ?? 'Untitled';
    flashStatus(`Saved ${saved.split('/').pop()}`);
    updateSaveIndicator(true);
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
    case 'docx': {
      const preview = root.querySelector<HTMLElement>('.mid-preview');
      if (!preview) { flashStatus('No preview to export'); return; }
      const buffer = await buildDocxFromPreview(preview);
      await window.mid.saveAs(defaultExportName('docx'), buffer, [{ name: 'Word', extensions: ['docx'] }]);
      flashStatus('Exported DOCX');
      break;
    }
  }
}

async function buildDocxFromPreview(preview: HTMLElement): Promise<ArrayBuffer> {
  const children: (Paragraph | DocxTable)[] = [];
  for (const node of Array.from(preview.children)) {
    children.push(...domNodeToDocx(node as HTMLElement));
  }
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  return blob.arrayBuffer();
}

const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
};

function domNodeToDocx(el: HTMLElement): (Paragraph | DocxTable)[] {
  const tag = el.tagName;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (HEADING_MAP[tag]) {
    return [new Paragraph({ heading: HEADING_MAP[tag], children: [new TextRun(text)] })];
  }
  if (tag === 'P') {
    return [new Paragraph({ children: [new TextRun(text)] })];
  }
  if (tag === 'BLOCKQUOTE') {
    return [new Paragraph({ children: [new TextRun({ text, italics: true })], indent: { left: 720 } })];
  }
  if (tag === 'PRE') {
    const lines = (el.textContent ?? '').split('\n');
    return lines.map(line => new Paragraph({
      children: [new TextRun({ text: line, font: 'Courier New', size: 20 })],
      spacing: { after: 0 },
    }));
  }
  if (tag === 'UL' || tag === 'OL') {
    const items = Array.from(el.querySelectorAll(':scope > li'));
    return items.map(li => new Paragraph({
      children: [new TextRun((li.textContent ?? '').replace(/\s+/g, ' ').trim())],
      bullet: tag === 'UL' ? { level: 0 } : undefined,
      numbering: tag === 'OL' ? { reference: 'mid-ol', level: 0 } : undefined,
    }));
  }
  if (tag === 'TABLE' || el.classList.contains('mid-table')) {
    const tbl = el.querySelector('table') ?? (tag === 'TABLE' ? el : null);
    if (!tbl) return [];
    const rows = Array.from(tbl.querySelectorAll('tr')).map(tr => {
      const cells = Array.from(tr.querySelectorAll('th, td')).map(cell =>
        new DocxTableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: (cell.textContent ?? '').trim(), bold: cell.tagName === 'TH' })],
          })],
        }),
      );
      return new DocxTableRow({ children: cells });
    });
    return [new DocxTable({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })];
  }
  if (tag === 'HR') {
    return [new Paragraph({ children: [new TextRun('───')], alignment: AlignmentType.CENTER })];
  }
  if (text) return [new Paragraph({ children: [new TextRun(text)] })];
  return [];
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
statusRepoBtn.addEventListener('click', () => {
  if (statusRepoBtn.dataset.connected === 'true') void syncRepo();
  else void promptConnectRepo();
});
statusRepoBtn.addEventListener('contextmenu', e => {
  if (!currentFolder) return;
  e.preventDefault();
  const connected = statusRepoBtn.dataset.connected === 'true';
  openContextMenu(connected ? [
    { icon: 'refresh', label: 'Sync (commit + pull + push)', action: () => void syncRepo() },
    { separator: true, label: '' },
    { icon: 'github', label: 'Connect to a different repo…', action: () => void promptConnectRepo() },
  ] : [
    { icon: 'github', label: 'Connect repo…', action: () => void promptConnectRepo() },
  ], e.clientX, e.clientY);
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
  warehouses = await window.mid.warehousesList(currentFolder);
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
  if (note.warehouse) {
    const wh = warehouses.find(w => w.id === note.warehouse);
    const chip = document.createElement('span');
    chip.className = 'mid-note-tag mid-note-warehouse';
    chip.textContent = `↗ ${wh?.name ?? note.warehouse}`;
    meta.appendChild(chip);
  }
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
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    const warehouseLabel = note.warehouse
      ? `Warehouse: ${(warehouses.find(w => w.id === note.warehouse)?.name) ?? note.warehouse}`
      : 'Connect to warehouse…';
    openContextMenu([
      { icon: 'show', label: 'Open', action: () => void openNote(note) },
      { icon: 'edit', label: 'Rename…', action: () => void renameNote(note) },
      { separator: true, label: '' },
      { icon: 'github', label: 'Push to GitHub now', action: () => void pushNote(note) },
      { icon: 'link', label: warehouseLabel, action: () => void promptAttachWarehouse(note) },
      { separator: true, label: '' },
      { icon: 'markdown', label: 'Export Markdown', action: () => void exportNote(note, 'md') },
      { icon: 'html5', label: 'Export HTML', action: () => void exportNote(note, 'html') },
      { icon: 'download', label: 'Export PDF', action: () => void exportNote(note, 'pdf') },
      { icon: 'download', label: 'Export Word (.docx)', action: () => void exportNote(note, 'docx') },
      { icon: 'image', label: 'Export PNG', action: () => void exportNote(note, 'png') },
      { icon: 'list-ul', label: 'Export plain text', action: () => void exportNote(note, 'txt') },
      { separator: true, label: '' },
      { icon: 'trash', label: 'Delete', action: () => void deleteNote(note) },
    ], e.clientX, e.clientY);
  });
  return row;
}

async function pushNote(note: NoteEntry): Promise<void> {
  if (!currentFolder) return;
  const status = await window.mid.repoStatus(currentFolder);
  if (!status.initialized || !status.remote) {
    flashStatus('No GitHub repo connected — use the status bar');
    return;
  }
  const result = await window.mid.repoSync(currentFolder, `notes: ${note.title}`);
  if (result.ok) {
    await window.mid.notesMarkPushed(currentFolder, note.id);
    const updated = notes.find(n => n.id === note.id);
    if (updated) updated.pushedAt = new Date().toISOString();
    flashStatus(`Pushed "${note.title}"`);
  } else {
    flashStatus(`Push failed: ${result.error?.split('\n')[0] ?? 'unknown'}`);
  }
  await refreshRepoStatus();
}

async function promptAttachWarehouse(note: NoteEntry): Promise<void> {
  if (!currentFolder) return;
  if (warehouses.length === 0) {
    const ok = await midConfirm(
      'No warehouses configured',
      'Add warehouses by editing <workspace>/.mid/warehouse.json with shape:\n\n{ "warehouses": [{ "id": "personal", "name": "Personal", "repo": "owner/repo" }] }\n\nReload notes after editing.',
    );
    if (!ok) return;
    warehouses = await window.mid.warehousesList(currentFolder);
    if (warehouses.length === 0) return;
  }
  const choices = warehouses.map(w => `${w.id} — ${w.name} (${w.repo})`).join('\n');
  const pick = await midPrompt('Attach to warehouse', `Available:\n${choices}\n\nEnter id (blank to detach):`, note.warehouse ?? '');
  if (pick === null) return;
  const picked = pick.trim();
  if (picked === '') {
    await window.mid.notesAttachWarehouse(currentFolder, note.id, null);
    delete note.warehouse;
  } else {
    if (!warehouses.find(w => w.id === picked)) {
      flashStatus(`Unknown warehouse: ${picked}`);
      return;
    }
    await window.mid.notesAttachWarehouse(currentFolder, note.id, picked);
    note.warehouse = picked;
  }
  renderNotes();
}

async function exportNote(note: NoteEntry, format: ExportFormat): Promise<void> {
  if (!currentFolder) { flashStatus('Open a folder first'); return; }
  const fullPath = `${currentFolder}/${note.path}`;
  const content = await window.mid.readFile(fullPath);
  const baseName = (note.title || note.id).replace(/[^a-zA-Z0-9-_]/g, '_');

  // Text-only exports: write directly without disturbing the live preview.
  if (format === 'md' || format === 'txt') {
    const text = format === 'md' ? content : markdownToPlainText(content);
    const ext = format;
    const filterName = format === 'md' ? 'Markdown' : 'Plain text';
    await window.mid.saveAs(`${baseName}.${ext}`, text, [{ name: filterName, extensions: [ext] }]);
    flashStatus(`Exported ${format.toUpperCase()}`);
    return;
  }

  // Preview-dependent exports — swap currentText, force a re-render, capture, restore.
  const savedText = currentText;
  const savedPath = currentPath;
  const savedTitle = filenameEl.textContent ?? 'Untitled';
  const savedMode = currentMode;
  try {
    currentText = content;
    currentPath = fullPath;
    filenameEl.textContent = note.title;
    setMode('view');
    // Wait one tick + small delay so mermaid / hljs / katex finish rendering.
    await new Promise(resolve => setTimeout(resolve, 120));
    await exportAs(format);
  } finally {
    currentText = savedText;
    currentPath = savedPath;
    filenameEl.textContent = savedTitle;
    setMode(savedMode);
  }
}

async function renameNote(note: NoteEntry): Promise<void> {
  if (!currentFolder) return;
  const next = await midPrompt('Rename note', 'Title', note.title);
  if (next === null || next.trim() === '' || next === note.title) return;
  const updated = await window.mid.notesRename(currentFolder, note.id, next.trim());
  if (!updated) return;
  Object.assign(note, updated);
  renderNotes();
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
  const title = await midPrompt('New note', 'Title', '');
  if (!title) return;
  const { entry, fullPath } = await window.mid.notesCreate(currentFolder, title);
  notes.push(entry);
  renderNotes();
  const content = await window.mid.readFile(fullPath);
  loadFileContent(fullPath, content);
}

async function deleteNote(note: NoteEntry): Promise<void> {
  if (!currentFolder) return;
  const ok = await midConfirm('Delete note?', `"${note.title}" — the file will be removed too.`);
  if (!ok) return;
  await window.mid.notesDelete(currentFolder, note.id);
  notes = notes.filter(n => n.id !== note.id);
  renderNotes();
}

interface DialogResult { canceled: boolean; value: string; }
function openDialog(opts: { title: string; message?: string; label?: string; defaultValue?: string }): Promise<DialogResult> {
  return new Promise(resolve => {
    const dlg = document.getElementById('mid-dialog') as HTMLDialogElement;
    const titleEl = document.getElementById('mid-dialog-title') as HTMLHeadingElement;
    const messageEl = document.getElementById('mid-dialog-message') as HTMLParagraphElement;
    const labelEl = document.getElementById('mid-dialog-label') as HTMLLabelElement;
    const labelTextEl = document.getElementById('mid-dialog-label-text') as HTMLSpanElement;
    const inputEl = document.getElementById('mid-dialog-input') as HTMLInputElement;
    const cancelBtn = document.getElementById('mid-dialog-cancel') as HTMLButtonElement;
    const form = dlg.querySelector('form') as HTMLFormElement;

    titleEl.textContent = opts.title;
    if (opts.message) {
      messageEl.textContent = opts.message;
      messageEl.hidden = false;
    } else {
      messageEl.hidden = true;
    }
    if (opts.label !== undefined) {
      labelEl.hidden = false;
      labelTextEl.textContent = opts.label;
      inputEl.value = opts.defaultValue ?? '';
    } else {
      labelEl.hidden = true;
    }

    let canceled = true;
    const onSubmit = (e: Event): void => {
      e.preventDefault();
      canceled = false;
      cleanup();
      dlg.close();
      resolve({ canceled: false, value: inputEl.value });
    };
    const onCancel = (): void => {
      cleanup();
      dlg.close();
      resolve({ canceled: true, value: '' });
    };
    const onClose = (): void => {
      if (canceled) {
        cleanup();
        resolve({ canceled: true, value: '' });
      }
    };
    function cleanup(): void {
      form.removeEventListener('submit', onSubmit);
      cancelBtn.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
    }
    form.addEventListener('submit', onSubmit);
    cancelBtn.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);

    dlg.showModal();
    if (opts.label !== undefined) inputEl.focus();
  });
}

async function midPrompt(title: string, label: string, defaultValue = ''): Promise<string | null> {
  const result = await openDialog({ title, label, defaultValue });
  return result.canceled ? null : result.value;
}

async function midConfirm(title: string, message: string): Promise<boolean> {
  const result = await openDialog({ title, message });
  return !result.canceled;
}

window.mid.onThemeChanged(applyTheme);
window.mid.onMenuOpen(() => void openFile());
window.mid.onMenuOpenFolder(() => void openFolder());
window.mid.onMenuSave(() => void saveFile());
window.mid.onMenuExport(fmt => void exportAs(fmt));

document.addEventListener('contextmenu', e => {
  const el = e.target as HTMLElement;
  if (el.closest('pre, .mid-table, .mermaid, .mid-tree-item, .mid-note-row, input, textarea, button, select')) return;
  if (!el.closest('.mid-preview, main')) return;
  e.preventDefault();
  openContextMenu([
    { icon: 'copy', label: 'Copy text', action: () => void navigator.clipboard.writeText(currentText) },
    { separator: true, label: '' },
    { icon: 'markdown', label: 'Export Markdown', action: () => void exportAs('md') },
    { icon: 'html5', label: 'Export HTML', action: () => void exportAs('html') },
    { icon: 'download', label: 'Export PDF', action: () => void exportAs('pdf') },
    { icon: 'download', label: 'Export Word (.docx)', action: () => void exportAs('docx') },
    { icon: 'image', label: 'Export PNG', action: () => void exportAs('png') },
    { icon: 'list-ul', label: 'Export plain text', action: () => void exportAs('txt') },
  ], e.clientX, e.clientY);
});

hydrateIconButtons(document);
wireSettingsPanel();

function populateThemeOptions(sel: HTMLSelectElement): void {
  // Modes group
  const modes = document.createElement('optgroup');
  modes.label = 'Modes';
  for (const [v, l] of [['auto', 'Auto (follow OS)'], ['light', 'Light'], ['dark', 'Dark'], ['sepia', 'Sepia']]) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = l;
    modes.appendChild(opt);
  }
  sel.append(modes);
  // Light + dark themes from the core themes module
  for (const kind of ['light', 'dark'] as const) {
    const group = document.createElement('optgroup');
    group.label = `${kind === 'light' ? 'Light' : 'Dark'} themes`;
    for (const t of THEMES.filter(t => t.kind === kind)) {
      const opt = document.createElement('option');
      opt.value = `theme:${t.id}`;
      opt.textContent = t.label;
      group.appendChild(opt);
    }
    sel.append(group);
  }
}

function wireSettingsPanel(): void {
  const panel = document.getElementById('settings-panel') as HTMLElement;
  const openBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  const closeBtn = document.getElementById('settings-close') as HTMLButtonElement;
  const themeSel = document.getElementById('setting-theme') as HTMLSelectElement;
  if (THEMES.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[mid] THEMES import returned empty — theme picker will only show modes');
  }
  const fontSel = document.getElementById('setting-font') as HTMLSelectElement;
  const sizeRange = document.getElementById('setting-font-size') as HTMLInputElement;
  const sizeVal = document.getElementById('setting-font-size-value') as HTMLSpanElement;
  const widthRange = document.getElementById('setting-preview-width') as HTMLInputElement;
  const widthVal = document.getElementById('setting-preview-width-value') as HTMLSpanElement;
  const resetBtn = document.getElementById('settings-reset') as HTMLButtonElement;

  const syncFromSettings = (): void => {
    // Repopulate theme options every time the panel opens so we recover
    // from any earlier load failure (and so a future hot reload of THEMES
    // would surface immediately).
    if (themeSel.options.length < 4 + THEMES.length) {
      themeSel.replaceChildren();
      try {
        populateThemeOptions(themeSel);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[mid] populateThemeOptions failed', err);
      }
    }
    themeSel.value = settings.theme;
    fontSel.value = settings.fontFamily;
    sizeRange.value = String(settings.fontSize);
    sizeVal.textContent = `${settings.fontSize}px`;
    widthRange.value = String(settings.previewMaxWidth);
    widthVal.textContent = `${settings.previewMaxWidth}px`;
  };
  // First-time populate so the picker is correct even before the panel opens.
  syncFromSettings();

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
  if (Array.isArray(state.recentFiles)) recentFiles = state.recentFiles.slice(0, 10);
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
