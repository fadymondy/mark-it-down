import { renderMarkdown as coreRenderMarkdown, applyMermaidPlaceholders } from '../../../packages/core/src/markdown/renderer';
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import yaml from 'js-yaml';
import { toPng } from 'html-to-image';
import * as XLSX from 'xlsx';
import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer, Table as DocxTable, TableRow as DocxTableRow, TableCell as DocxTableCell, WidthType, BorderStyle, ShadingType } from 'docx';
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

type CodeExportGradient = 'none' | 'sunset' | 'ocean' | 'lavender' | 'forest' | 'slate' | 'midnight';

const CODE_EXPORT_GRADIENTS: Record<CodeExportGradient, string | null> = {
  none: null,
  sunset: 'linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%)',
  ocean: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
  lavender: 'linear-gradient(135deg, #c471f5 0%, #fa71cd 100%)',
  forest: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
  slate: 'linear-gradient(135deg, #485563 0%, #29323c 100%)',
  midnight: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
};

interface AppState {
  lastFolder?: string;
  splitRatio?: number;
  fontFamily?: FontFamilyChoice;
  fontSize?: number;
  theme?: ThemeChoice;
  previewMaxWidth?: number;
  recentFiles?: string[];
  codeExportGradient?: CodeExportGradient;
  pinnedFolders?: PinnedFolder[];
  workspaces?: Workspace[];
  activeWorkspace?: string;
  outlineHidden?: boolean;
  /** Workspace ids that have dismissed the first-run warehouse onboarding (#236). */
  warehouseOnboardingDismissed?: string[];
}

interface PinnedFolder {
  path: string;
  name: string;
  icon: string;
  color: string;
  /** Files explicitly assigned to this cluster via drag-drop. Empty = show folder subtree as before. */
  files?: string[];
}

interface Workspace {
  id: string;
  name: string;
  path: string;
}

const DEFAULT_SETTINGS = {
  fontFamily: 'system' as FontFamilyChoice,
  fontSize: 17,
  theme: 'auto' as ThemeChoice,
  previewMaxWidth: 760,
  codeExportGradient: 'sunset' as CodeExportGradient,
};

const FONT_STACKS: Record<FontFamilyChoice, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Apple Garamond", Charter, serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

type ExportFormat = 'md' | 'html' | 'pdf' | 'png' | 'txt' | 'docx' | 'docx-gdocs';

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
  readRendererStyles(): Promise<string>;
  patchAppState(patch: Partial<AppState>): Promise<void>;
  notesList(workspace: string): Promise<NoteEntry[]>;
  notesCreate(workspace: string, title: string): Promise<{ entry: NoteEntry; fullPath: string }>;
  notesRename(workspace: string, id: string, title: string): Promise<NoteEntry | null>;
  notesDelete(workspace: string, id: string): Promise<boolean>;
  notesTag(workspace: string, id: string, tags: string[]): Promise<NoteEntry | null>;
  warehousesList(workspace: string): Promise<Warehouse[]>;
  warehousesAdd(workspace: string, warehouse: Warehouse): Promise<{ ok: boolean; warehouses: Warehouse[]; error?: string }>;
  notesAttachWarehouse(workspace: string, id: string, warehouseId: string | null): Promise<NoteEntry | null>;
  notesMarkPushed(workspace: string, id: string): Promise<NoteEntry | null>;
  ghAuthStatus(): Promise<{ authenticated: boolean; output: string }>;
  ghRepoList(): Promise<{ repos: { nameWithOwner: string; description: string; visibility: string }[]; ok: boolean; error?: string }>;
  ghRepoCreate(slug: string, visibility: 'private' | 'public'): Promise<{ ok: boolean; url?: string; error?: string }>;
  fileHistory(workspace: string, filePath: string): Promise<{ commits: { hash: string; date: string; author: string; message: string; diff: string }[]; ok: boolean; error?: string }>;
  ghDeviceFlowStart(): Promise<{ ok: boolean; userCode?: string; verificationUri?: string; deviceCode?: string; interval?: number; error?: string }>;
  ghDeviceFlowPoll(deviceCode: string): Promise<{ ok: boolean; token?: string; pending?: boolean; error?: string }>;
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
  onMenuExport(cb: (format: 'md' | 'html' | 'pdf' | 'png' | 'txt' | 'docx' | 'docx-gdocs') => void): () => void;
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
const activityFiles = document.getElementById('activity-files') as HTMLButtonElement;
const activityNotes = document.getElementById('activity-notes') as HTMLButtonElement;
const activitySettings = document.getElementById('activity-settings') as HTMLButtonElement;
const activityPinned = document.getElementById('activity-pinned') as HTMLDivElement;
const titlebarSearchBtn = document.getElementById('titlebar-search') as HTMLButtonElement;
const titlebarSearchIcon = document.querySelector('.mid-titlebar-search-icon') as HTMLSpanElement;
const sidebarFolderName = document.getElementById('sidebar-folder-name') as HTMLSpanElement;
const sidebarRefresh = document.getElementById('sidebar-refresh') as HTMLButtonElement;
const treeRoot = document.getElementById('tree-root') as HTMLDivElement;
// Inline Files/Notes tabs were removed in #187 — the activity bar drives the sidebar now.
const modeFilesBtn = document.getElementById('mode-files') as HTMLButtonElement | null;
const modeNotesBtn = document.getElementById('mode-notes') as HTMLButtonElement | null;
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
const statusOutline = document.getElementById('status-outline') as HTMLButtonElement;
const outlineRail = document.getElementById('outline-rail') as HTMLElement;
const outlineList = document.getElementById('outline-list') as HTMLElement;
const outlineCloseBtn = document.getElementById('outline-close') as HTMLButtonElement;

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
let pinnedFolders: PinnedFolder[] = [];
let workspaces: Workspace[] = [];
let outlineHidden = false;
let outlineObserver: IntersectionObserver | null = null;
const outlineLinkByHeadingId = new Map<string, HTMLElement>();
const settings = { ...DEFAULT_SETTINGS };
const expandedDirs = new Set<string>();
const treeCache = new Map<string, TreeEntry[]>();

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

type SpecKind = 'agent' | 'skill' | 'rule' | 'command';
const SPEC_PATH_PATTERNS: Array<{ kind: SpecKind; rx: RegExp; icon: IconName }> = [
  { kind: 'agent',   rx: /\/\.claude\/agents\//i,   icon: 'bookmark' },
  { kind: 'skill',   rx: /\/\.claude\/skills\//i,   icon: 'tag' },
  { kind: 'rule',    rx: /\/\.claude\/rules\//i,    icon: 'list-ul' },
  { kind: 'command', rx: /\/\.claude\/commands\//i, icon: 'cog' },
];

function detectSpecKind(path: string | null): { kind: SpecKind; icon: IconName } | null {
  if (!path) return null;
  for (const p of SPEC_PATH_PATTERNS) {
    if (p.rx.test(path)) return { kind: p.kind, icon: p.icon };
  }
  return null;
}

function renderSpecCardHTML(meta: Record<string, unknown>, kind: SpecKind, icon: IconName): string {
  const name = String(meta.name ?? meta.title ?? 'Untitled');
  const description = meta.description ? String(meta.description) : '';
  const accent = typeof meta.color === 'string' ? meta.color : '';
  const skipKeys = new Set(['name', 'title', 'description', 'color']);
  const chips = Object.entries(meta)
    .filter(([k]) => !skipKeys.has(k))
    .map(([k, v]) => {
      const valueText = Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
      return `<span class="mid-spec-chip"><span class="mid-spec-chip-key">${escapeHTML(k)}</span><span class="mid-spec-chip-val">${escapeHTML(valueText)}</span></span>`;
    })
    .join('');
  const accentStyle = accent ? ` style="--mid-spec-accent: ${escapeHTML(accent)}"` : '';
  return `<aside class="mid-spec-card mid-spec-card--${kind}"${accentStyle}>
    <div class="mid-spec-card-head">
      <span class="mid-spec-card-icon">${iconHTML(icon, 'mid-icon--lg')}</span>
      <div class="mid-spec-card-titles">
        <h1 class="mid-spec-card-name">${escapeHTML(name)}</h1>
        <div class="mid-spec-card-kind">${kind}</div>
      </div>
    </div>
    ${description ? `<p class="mid-spec-card-desc">${escapeHTML(description)}</p>` : ''}
    ${chips ? `<div class="mid-spec-card-chips">${chips}</div>` : ''}
  </aside>`;
}

interface FootnoteData {
  defs: Map<string, string>;
  refs: string[];
}

function preprocessFootnotes(md: string): { body: string; data: FootnoteData } {
  const data: FootnoteData = { defs: new Map(), refs: [] };
  // Strip definitions like `[^id]: text…` (multi-line until a blank line).
  const lines = md.split('\n');
  const remaining: string[] = [];
  let collecting: { id: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
    if (m) {
      if (collecting) data.defs.set(collecting.id, collecting.lines.join(' ').trim());
      collecting = { id: m[1], lines: [m[2]] };
      continue;
    }
    if (collecting && /^\s+\S/.test(line)) {
      collecting.lines.push(line.trim());
      continue;
    }
    if (collecting) {
      data.defs.set(collecting.id, collecting.lines.join(' ').trim());
      collecting = null;
    }
    remaining.push(line);
  }
  if (collecting) data.defs.set(collecting.id, collecting.lines.join(' ').trim());
  return { body: remaining.join('\n'), data };
}

function processFootnoteRefs(html: string, data: FootnoteData): string {
  // Replace inline [^id] with sup anchors (skip occurrences inside code blocks).
  return html.replace(/\[\^([^\]]+)\]/g, (match, id) => {
    if (!data.defs.has(id)) return match;
    if (!data.refs.includes(id)) data.refs.push(id);
    const num = data.refs.indexOf(id) + 1;
    return `<sup class="mid-fn-ref"><a href="#fn-${escapeHTML(id)}" id="fnref-${escapeHTML(id)}">${num}</a></sup>`;
  });
}

function renderFootnotesSection(data: FootnoteData): string {
  if (data.refs.length === 0) return '';
  const items = data.refs.map((id) => {
    const def = data.defs.get(id) ?? '';
    return `<li id="fn-${escapeHTML(id)}"><span>${def}</span> <a href="#fnref-${escapeHTML(id)}" class="mid-fn-back" aria-label="Back to text">↩</a></li>`;
  }).join('');
  return `<aside class="mid-footnotes" aria-label="Footnotes"><h2>Footnotes</h2><ol>${items}</ol></aside>`;
}

function processDefinitionLists(scope: HTMLElement): void {
  // Marked renders `Term\n: Definition` as a single <p> with the literal text.
  // Detect <p> elements where lines form Term/colon-Definition pairs and
  // convert into <dl>.
  const paragraphs = Array.from(scope.querySelectorAll<HTMLParagraphElement>('p'));
  for (const p of paragraphs) {
    const text = p.innerText;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    let valid = true;
    const pairs: { term: string; def: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const term = lines[i];
      const next = lines[i + 1];
      if (!next || !next.startsWith(':')) { valid = false; break; }
      pairs.push({ term, def: next.slice(1).trim() });
      i++;
    }
    if (!valid || pairs.length === 0) continue;
    const dl = document.createElement('dl');
    dl.className = 'mid-dl';
    for (const { term, def } of pairs) {
      const dt = document.createElement('dt'); dt.textContent = term;
      const dd = document.createElement('dd'); dd.textContent = def;
      dl.append(dt, dd);
    }
    p.replaceWith(dl);
  }
}

function renderMarkdown(md: string): string {
  const { meta, body } = extractFrontmatter(md);
  const { body: bodyNoFn, data: fnData } = preprocessFootnotes(body);
  const { html, mermaidBlocks } = coreRenderMarkdown(bodyNoFn);
  const html2 = processFootnoteRefs(html, fnData);
  const container = document.createElement('div');
  container.innerHTML = html2 + renderFootnotesSection(fnData);
  applyMermaidPlaceholders(container, mermaidBlocks);
  processDefinitionLists(container);
  const spec = detectSpecKind(currentPath);
  if (spec && meta) {
    return renderSpecCardHTML(meta, spec.kind, spec.icon) + container.innerHTML;
  }
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
    rebuildOutline(null);
    return;
  }
  if (isMermaidFile(currentPath)) {
    renderMermaidStandalone();
    rebuildOutline(null);
    return;
  }
  const preview = document.createElement('div');
  preview.className = 'mid-preview';
  populatePreview(preview);
  root.replaceChildren(preview);
  rebuildOutline(preview);
}

function renderMermaidStandalone(): void {
  // Standalone .mmd / .mermaid file: editor on left + live diagram on right.
  root.classList.remove('viewing');
  root.classList.add('splitting');
  const wrap = document.createElement('div');
  wrap.className = 'mid-split';
  wrap.style.gridTemplateColumns = `${splitRatio * 100}% 6px 1fr`;
  const editor = buildEditor();
  editor.classList.add('mid-split-editor');
  const handle = document.createElement('div');
  handle.className = 'mid-split-handle';
  handle.addEventListener('mousedown', e => beginSplitDrag(e, wrap));
  const preview = document.createElement('div');
  preview.className = 'mid-preview mid-split-preview mid-mermaid-standalone';

  const renderDiagram = (): void => {
    const code = currentText.trim();
    if (!code) { preview.innerHTML = '<div class="mid-mermaid-editor-empty">empty</div>'; return; }
    const id = `mermaid-standalone-${Date.now()}`;
    mermaid.render(id, code).then(({ svg }) => {
      preview.innerHTML = svg;
    }).catch(err => {
      preview.innerHTML = `<pre class="mid-mermaid-editor-error">${escapeHTML(String((err as Error)?.message ?? err))}</pre>`;
    });
  };
  renderDiagram();
  let timer: number | null = null;
  editor.addEventListener('input', () => {
    currentText = editor.value;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(renderDiagram, 120);
  });
  wrap.append(editor, handle, preview);
  root.replaceChildren(wrap);
}

let mermaidPopout: HTMLDivElement | null = null;
function maybeShowMermaidPopout(editor: HTMLTextAreaElement): void {
  // Cursor-aware mermaid popout — when caret is inside a ```mermaid fence,
  // render that block in a docked overlay.
  const value = editor.value;
  const caret = editor.selectionStart;
  const before = value.slice(0, caret);
  const fenceStart = before.lastIndexOf('```mermaid');
  if (fenceStart === -1) { hideMermaidPopout(); return; }
  const afterFence = before.slice(fenceStart);
  if (/```\s*$/m.test(afterFence.slice(10))) { hideMermaidPopout(); return; } // closed before caret
  const remainder = value.slice(fenceStart + 10);
  const closeIdx = remainder.indexOf('```');
  if (closeIdx === -1) { hideMermaidPopout(); return; } // unterminated
  const source = remainder.slice(0, closeIdx).replace(/^\n+/, '').trimEnd();
  if (!source) { hideMermaidPopout(); return; }

  if (!mermaidPopout) {
    mermaidPopout = document.createElement('div');
    mermaidPopout.className = 'mid-mermaid-popout';
    document.body.appendChild(mermaidPopout);
  }
  const id = `mermaid-popout-${Date.now()}`;
  mermaid.render(id, source).then(({ svg }) => {
    if (mermaidPopout) mermaidPopout.innerHTML = svg;
  }).catch(err => {
    if (mermaidPopout) mermaidPopout.innerHTML = `<pre class="mid-mermaid-editor-error">${escapeHTML(String((err as Error)?.message ?? err))}</pre>`;
  });
}

function hideMermaidPopout(): void {
  if (mermaidPopout) { mermaidPopout.remove(); mermaidPopout = null; }
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
      { icon: 'edit', label: 'Edit diagram…', action: () => openMermaidEditor(source) },
      { separator: true, label: '' },
      { icon: 'copy', label: 'Copy SVG', action: () => copyMermaidSVG(host) },
      { icon: 'download', label: 'Download SVG', action: () => downloadMermaidSVG(host, source) },
      { icon: 'image', label: 'Download PNG', action: () => void downloadMermaidPNG(host) },
      { separator: true, label: '' },
      { icon: 'refresh', label: 'Reset view', action: () => reset?.() },
    ], e.clientX, e.clientY);
  });
}

function openMermaidEditor(originalSource: string): void {
  const dlg = document.getElementById('mid-mermaid-editor') as HTMLDialogElement;
  const src = document.getElementById('mid-mermaid-editor-src') as HTMLTextAreaElement;
  const preview = document.getElementById('mid-mermaid-editor-preview') as HTMLDivElement;
  const closeBtn = document.getElementById('mid-mermaid-editor-close') as HTMLButtonElement;
  const cancelBtn = document.getElementById('mid-mermaid-editor-cancel') as HTMLButtonElement;
  const saveBtn = document.getElementById('mid-mermaid-editor-save') as HTMLButtonElement;

  src.value = originalSource;
  let timer: number | null = null;
  let renderToken = 0;

  const render = (): void => {
    const code = src.value.trim();
    if (!code) {
      preview.innerHTML = '<div class="mid-mermaid-editor-empty">empty</div>';
      return;
    }
    const id = `mermaid-edit-${++renderToken}`;
    const myToken = renderToken;
    mermaid.render(id, code).then(({ svg }) => {
      if (myToken !== renderToken) return;
      preview.innerHTML = svg;
    }).catch(err => {
      if (myToken !== renderToken) return;
      preview.innerHTML = `<pre class="mid-mermaid-editor-error">${escapeHTML(String((err as Error)?.message ?? err))}</pre>`;
    });
  };
  render();

  src.oninput = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(render, 120);
  };

  const close = (): void => {
    src.oninput = null;
    if (timer !== null) window.clearTimeout(timer);
    closeBtn.removeEventListener('click', cancel);
    cancelBtn.removeEventListener('click', cancel);
    saveBtn.removeEventListener('click', save);
    document.removeEventListener('keydown', onKey);
    if (dlg.open) dlg.close();
  };
  const cancel = (): void => close();
  const save = (): void => {
    const next = src.value;
    if (next === originalSource) { close(); return; }
    const before = '```mermaid\n' + originalSource + '\n```';
    const after = '```mermaid\n' + next + '\n```';
    const idx = currentText.indexOf(before);
    if (idx === -1) {
      flashStatus('Could not locate diagram source — editor closed without saving');
      close();
      return;
    }
    currentText = currentText.slice(0, idx) + after + currentText.slice(idx + before.length);
    if (currentMode === 'view') renderView();
    else if (currentMode === 'split') renderSplit();
    updateSaveIndicator(false);
    flashStatus('Diagram updated');
    close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  };

  closeBtn.addEventListener('click', cancel);
  cancelBtn.addEventListener('click', cancel);
  saveBtn.addEventListener('click', save);
  document.addEventListener('keydown', onKey);
  dlg.showModal();
  src.focus();
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
  a.download = uniqueExportName('diagram', 'svg');
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
  a.download = uniqueExportName('diagram', 'png');
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

    // Wrap each <pre> in a macOS-window chrome container — visible in the preview
    // and naturally captured by the PNG export.
    const chrome = document.createElement('div');
    chrome.className = 'mid-code-window';
    const header = document.createElement('div');
    header.className = 'mid-code-window-header';
    header.innerHTML = `
      <span class="mid-code-window-dots">
        <span class="mid-code-window-dot mid-code-window-dot--red"></span>
        <span class="mid-code-window-dot mid-code-window-dot--amber"></span>
        <span class="mid-code-window-dot mid-code-window-dot--green"></span>
      </span>
      <span class="mid-code-window-title"></span>
      <span class="mid-code-window-spacer"></span>
    `;
    const titleEl = header.querySelector('.mid-code-window-title') as HTMLSpanElement;
    titleEl.textContent = lang ? `snippet.${LANG_TO_EXT[lang] ?? lang}` : 'snippet.txt';

    pre.parentElement?.insertBefore(chrome, pre);
    chrome.appendChild(header);
    chrome.appendChild(pre);

    addLineNumbers(pre, code);

    const onMenu = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu([
        { icon: 'copy', label: 'Copy', kbd: '⌘C', action: () => void navigator.clipboard.writeText(code.innerText) },
        { icon: 'download', label: 'Download as file', action: () => downloadCode(code.innerText, lang) },
        { icon: 'image', label: 'Export as PNG', action: () => void exportCodeBlockAsPNG(chrome) },
        { separator: true, label: '' },
        { icon: 'list-ul', label: pre.classList.contains('with-lines') ? 'Hide line numbers' : 'Show line numbers', action: () => pre.classList.toggle('with-lines') },
      ], e.clientX, e.clientY);
    };
    chrome.addEventListener('contextmenu', onMenu);
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

async function exportCodeBlockAsPNG(target: HTMLElement): Promise<void> {
  const gradient = CODE_EXPORT_GRADIENTS[settings.codeExportGradient];
  const filename = uniqueExportName('code', 'png');
  if (!gradient) {
    const dataUrl = await toPng(target, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--mid-bg').trim() || '#0d1117',
    });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
    return;
  }
  // Wrap the chromed window in a gradient backdrop + padding so the export looks
  // like a Carbon-style screenshot. Position offscreen via translate (not opacity)
  // so the clone html-to-image takes is fully rendered — `opacity: 0` on the
  // wrapper makes the cloned root invisible too, producing a blank PNG (#237).
  const backdrop = document.createElement('div');
  backdrop.className = 'mid-code-export-bg';
  backdrop.style.background = gradient;
  const clone = target.cloneNode(true) as HTMLElement;
  backdrop.appendChild(clone);
  backdrop.style.position = 'fixed';
  backdrop.style.left = '0';
  backdrop.style.top = '0';
  backdrop.style.transform = 'translate(-200vw, 0)';
  backdrop.style.pointerEvents = 'none';
  document.body.appendChild(backdrop);
  try {
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    const dataUrl = await toPng(backdrop, {
      pixelRatio: 2,
      style: { transform: 'none' },
    });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  } finally {
    backdrop.remove();
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

/** Outline rail (#252) — extracts the heading tree from the active preview
 * and wires click-to-jump + scroll-spy via IntersectionObserver. The rail is
 * hidden in edit-only mode and during PDF print (CSS handles `is-printing`). */
function rebuildOutline(preview: HTMLElement | null): void {
  if (outlineObserver) {
    outlineObserver.disconnect();
    outlineObserver = null;
  }
  outlineLinkByHeadingId.clear();
  outlineList.replaceChildren();

  if (!preview || currentMode === 'edit' || outlineHidden) {
    return;
  }

  const headings = Array.from(
    preview.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')
  ).filter(h => (h.id ?? '').length > 0);

  if (headings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mid-outline-empty';
    empty.textContent = 'No headings in this document.';
    outlineList.appendChild(empty);
    return;
  }

  for (const h of headings) {
    const level = Number(h.tagName.slice(1));
    const link = document.createElement('a');
    link.className = 'mid-outline-item';
    link.href = `#${h.id}`;
    link.dataset.level = String(level);
    link.dataset.headingId = h.id;
    // Strip the trailing `#` anchor character that attachHeadingAnchors appends.
    const text = (h.textContent ?? '').replace(/#\s*$/, '').trim();
    link.textContent = text || h.id;
    link.title = text || h.id;
    link.addEventListener('click', e => {
      e.preventDefault();
      const target = preview.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveOutlineItem(h.id);
    });
    outlineList.appendChild(link);
    outlineLinkByHeadingId.set(h.id, link);
  }

  // Scroll-spy: highlight the heading nearest the top of the preview viewport.
  outlineObserver = new IntersectionObserver(entries => {
    // Pick the entry whose top is closest to (and above) the trigger band.
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length > 0) {
      const id = (visible[0].target as HTMLElement).id;
      if (id) setActiveOutlineItem(id);
    }
  }, {
    root: preview,
    // Trigger band roughly the top fifth of the preview.
    rootMargin: '0px 0px -75% 0px',
    threshold: 0,
  });
  for (const h of headings) outlineObserver.observe(h);
}

function setActiveOutlineItem(headingId: string): void {
  for (const [id, link] of outlineLinkByHeadingId) {
    link.classList.toggle('is-active', id === headingId);
  }
}

function applyOutlineVisibility(): void {
  outlineRail.hidden = outlineHidden || currentMode === 'edit';
  document.body.classList.toggle('has-outline', !outlineRail.hidden);
  statusOutline.dataset.active = outlineHidden ? 'false' : 'true';
  statusOutline.title = outlineHidden
    ? 'Show outline (Cmd/Ctrl+Shift+L)'
    : 'Hide outline (Cmd/Ctrl+Shift+L)';
}

function setOutlineHidden(hidden: boolean, persist = true): void {
  outlineHidden = hidden;
  applyOutlineVisibility();
  // Re-scan against the current preview so the rail content matches state.
  const preview = root.querySelector<HTMLElement>('.mid-preview');
  rebuildOutline(preview);
  if (persist) void window.mid.patchAppState({ outlineHidden: hidden });
}

function toggleOutline(): void {
  setOutlineHidden(!outlineHidden);
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

// (Old TableState/applyTableState removed in #210 in favor of the DataTable component below.)

type Density = 'comfy' | 'compact' | 'spacious';
interface DataTableState {
  filter: string;
  sortColumn: number | null;
  sortDir: 'asc' | 'desc' | null;
  page: number;
  pageSize: number;
  density: Density;
  hidden: Set<number>;
}

function attachTableTools(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    if (table.dataset.midTable === '1') return;
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;
    const headers = Array.from(thead.querySelectorAll<HTMLTableCellElement>('th'));
    const allRows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));
    if (headers.length === 0 || allRows.length === 0) return;
    table.dataset.midTable = '1';
    table.classList.add('mid-dt-table');

    // Card shell
    const card = document.createElement('div');
    card.className = 'mid-data-table';
    table.replaceWith(card);

    const state: DataTableState = {
      filter: '',
      sortColumn: null,
      sortDir: null,
      page: 0,
      pageSize: 20,
      density: 'comfy',
      hidden: new Set(),
    };
    card.dataset.density = state.density;

    // ===== Toolbar =====
    const toolbar = document.createElement('div');
    toolbar.className = 'mid-dt-toolbar';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'mid-dt-search-wrap';
    searchWrap.innerHTML = iconHTML('search', 'mid-icon--sm mid-icon--muted');
    const filterInput = document.createElement('input');
    filterInput.type = 'search';
    filterInput.className = 'mid-dt-search';
    filterInput.placeholder = 'Filter…';
    searchWrap.appendChild(filterInput);

    const counter = document.createElement('span');
    counter.className = 'mid-dt-counter';

    const spacer = document.createElement('div');
    spacer.className = 'mid-dt-spacer';

    const densityBtn = makeIconActionButton('list-ul', 'Density', e => openContextMenu([
      { icon: 'list-ul', label: 'Comfortable', action: () => { state.density = 'comfy'; card.dataset.density = 'comfy'; } },
      { icon: 'list-ul', label: 'Compact', action: () => { state.density = 'compact'; card.dataset.density = 'compact'; } },
      { icon: 'list-ul', label: 'Spacious', action: () => { state.density = 'spacious'; card.dataset.density = 'spacious'; } },
    ], (e.currentTarget as HTMLElement).getBoundingClientRect().left, (e.currentTarget as HTMLElement).getBoundingClientRect().bottom + 4));

    const columnsBtn = makeIconActionButton('columns', 'Columns', e => {
      const items: MenuItem[] = headers.map((th, idx) => ({
        icon: state.hidden.has(idx) ? 'x' : 'show',
        label: cleanText(th.textContent ?? `Column ${idx + 1}`),
        action: () => {
          if (state.hidden.has(idx)) state.hidden.delete(idx);
          else state.hidden.add(idx);
          render();
        },
      }));
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openContextMenu(items, rect.left, rect.bottom + 4);
    });

    const exportBtn = makeIconActionButton('download', 'Export', e => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openContextMenu([
        { icon: 'copy', label: 'Copy as Markdown', action: () => copyTableAsMarkdown(headers, getFiltered()) },
        { icon: 'image', label: 'Export as PNG', action: () => void exportTableAsPNG(card) },
        { icon: 'download', label: 'Download CSV', action: () => downloadTable(headers, getFiltered(), 'csv') },
        { icon: 'download', label: 'Download Excel (.xlsx)', action: () => downloadTable(headers, getFiltered(), 'xlsx') },
        { icon: 'github', label: 'Share to Google Sheets', action: () => void shareTableToSheets(headers, getFiltered()) },
        { icon: 'list-ul', label: 'Download JSON', action: () => downloadTable(headers, getFiltered(), 'json') },
      ], rect.left, rect.bottom + 4);
    });

    toolbar.append(searchWrap, counter, spacer, densityBtn, columnsBtn, exportBtn);

    // ===== Scroll area =====
    const scroll = document.createElement('div');
    scroll.className = 'mid-dt-scroll';
    scroll.appendChild(table);

    // ===== Footer =====
    const footer = document.createElement('div');
    footer.className = 'mid-dt-footer';
    const pageInfo = document.createElement('span');
    pageInfo.className = 'mid-dt-page-info';
    const pager = document.createElement('div');
    pager.className = 'mid-dt-pager';
    const prevBtn = document.createElement('button');
    prevBtn.className = 'mid-btn mid-btn--icon mid-btn--ghost';
    prevBtn.innerHTML = iconHTML('chevron-right', 'mid-icon--sm');
    prevBtn.style.transform = 'rotate(180deg)';
    prevBtn.title = 'Previous page';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'mid-btn mid-btn--icon mid-btn--ghost';
    nextBtn.innerHTML = iconHTML('chevron-right', 'mid-icon--sm');
    nextBtn.title = 'Next page';
    pager.append(prevBtn, nextBtn);
    footer.append(pageInfo, pager);

    card.append(toolbar, scroll, footer);

    // ===== Headers (sortable) =====
    headers.forEach((th, idx) => {
      th.classList.add('mid-dt-th');
      const labelText = th.innerHTML;
      th.innerHTML = `<span class="mid-dt-th-label">${labelText}</span>${iconHTML('chevron-right', 'mid-icon--sm mid-dt-sort')}`;
      th.addEventListener('click', () => {
        if (state.sortColumn !== idx) { state.sortColumn = idx; state.sortDir = 'asc'; }
        else if (state.sortDir === 'asc') { state.sortDir = 'desc'; }
        else { state.sortColumn = null; state.sortDir = null; }
        state.page = 0;
        render();
      });
    });

    let debounce: number | undefined;
    filterInput.addEventListener('input', () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        state.filter = filterInput.value.trim().toLowerCase();
        state.page = 0;
        render();
      }, 120);
    });
    prevBtn.addEventListener('click', () => { if (state.page > 0) { state.page--; render(); } });
    nextBtn.addEventListener('click', () => { state.page++; render(); });

    function getFiltered(): HTMLTableRowElement[] {
      const q = state.filter;
      let out = q ? allRows.filter(r => (r.textContent ?? '').toLowerCase().includes(q)) : allRows.slice();
      if (state.sortColumn !== null && state.sortDir !== null) {
        const col = state.sortColumn;
        const t = (r: HTMLTableRowElement): string => r.children[col]?.textContent?.trim() ?? '';
        const numeric = allRows.every(r => {
          const x = t(r);
          return x === '' || !Number.isNaN(Number(x.replace(/[$,%\s]/g, '')));
        });
        out.sort((a, b) => {
          const av = t(a), bv = t(b);
          const cmp = numeric
            ? (Number(av.replace(/[$,%\s]/g, '')) || 0) - (Number(bv.replace(/[$,%\s]/g, '')) || 0)
            : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
          return state.sortDir === 'asc' ? cmp : -cmp;
        });
      }
      return out;
    }

    function render(): void {
      // Sort indicator state on headers
      headers.forEach((th, idx) => {
        th.classList.remove('is-sort-asc', 'is-sort-desc', 'is-hidden');
        if (state.sortColumn === idx && state.sortDir === 'asc') th.classList.add('is-sort-asc');
        if (state.sortColumn === idx && state.sortDir === 'desc') th.classList.add('is-sort-desc');
        if (state.hidden.has(idx)) th.classList.add('is-hidden');
      });
      // Apply column visibility on cells
      allRows.forEach(r => {
        Array.from(r.children).forEach((c, idx) => {
          (c as HTMLElement).classList.toggle('is-hidden', state.hidden.has(idx));
        });
      });

      const filtered = getFiltered();
      const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
      if (state.page >= totalPages) state.page = totalPages - 1;
      const pageStart = state.page * state.pageSize;
      const pageRows = filtered.slice(pageStart, pageStart + state.pageSize);
      const pageRowsSet = new Set(pageRows);

      // Reorder + hide rows
      tbody!.replaceChildren(...pageRows);
      allRows.forEach(r => { r.hidden = !pageRowsSet.has(r); });

      // Counter
      counter.textContent = state.filter
        ? `${filtered.length} of ${allRows.length}`
        : `${allRows.length} ${allRows.length === 1 ? 'row' : 'rows'}`;

      // Footer
      const showFooter = filtered.length > state.pageSize;
      footer.hidden = !showFooter;
      pageInfo.textContent = showFooter ? `Page ${state.page + 1} of ${totalPages}` : '';
      prevBtn.disabled = state.page <= 0;
      nextBtn.disabled = state.page >= totalPages - 1;
    }
    render();

    card.addEventListener('contextmenu', e => {
      if ((e.target as HTMLElement).closest('input, button')) return;
      e.preventDefault();
      e.stopPropagation();
      openContextMenu([
        { icon: 'copy', label: 'Copy as Markdown', action: () => copyTableAsMarkdown(headers, getFiltered()) },
        { icon: 'image', label: 'Export as PNG', action: () => void exportTableAsPNG(card) },
        { icon: 'download', label: 'Download CSV', action: () => downloadTable(headers, getFiltered(), 'csv') },
        { icon: 'download', label: 'Download Excel (.xlsx)', action: () => downloadTable(headers, getFiltered(), 'xlsx') },
        { icon: 'github', label: 'Share to Google Sheets', action: () => void shareTableToSheets(headers, getFiltered()) },
        { icon: 'list-ul', label: 'Download JSON', action: () => downloadTable(headers, getFiltered(), 'json') },
        { separator: true, label: '' },
        { icon: state.sortColumn === null ? 'x' : 'refresh', label: state.sortColumn === null ? 'No sort active' : 'Reset sort', disabled: state.sortColumn === null, action: () => { state.sortColumn = null; state.sortDir = null; render(); } },
      ], e.clientX, e.clientY);
    });
  });
}

function makeIconActionButton(icon: IconName, title: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mid-dt-action';
  btn.title = title;
  btn.innerHTML = iconHTML(icon, 'mid-icon--sm');
  btn.addEventListener('click', onClick);
  return btn;
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

/**
 * Snapshot the live DataTable card into a PNG. Wraps the card in chromed export
 * window + (optional) gradient backdrop, off-screen, captures via html-to-image,
 * removes the temp DOM. Mirrors exportCodeBlockAsPNG visually (#260, #261).
 */
async function exportTableAsPNG(card: HTMLElement): Promise<void> {
  const filename = uniqueExportName('table', 'png');
  const gradient = CODE_EXPORT_GRADIENTS[settings.codeExportGradient];

  // Clone the card and inline styles needed for full-content render.
  const cardClone = card.cloneNode(true) as HTMLElement;

  const win = document.createElement('div');
  win.className = 'mid-export-window';
  win.innerHTML =
    '<div class="mid-export-window-header">' +
      '<div class="mid-export-window-dots">' +
        '<span class="mid-export-window-dot mid-export-window-dot--red"></span>' +
        '<span class="mid-export-window-dot mid-export-window-dot--amber"></span>' +
        '<span class="mid-export-window-dot mid-export-window-dot--green"></span>' +
      '</div>' +
      '<div class="mid-export-window-title">table</div>' +
      '<div class="mid-export-window-spacer"></div>' +
    '</div>';
  const body = document.createElement('div');
  body.className = 'mid-export-window-body';
  body.appendChild(cardClone);
  win.appendChild(body);

  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.transform = 'translate(-200vw, 0)';
  wrapper.style.pointerEvents = 'none';
  if (gradient) {
    wrapper.className = 'mid-code-export-bg';
    wrapper.style.background = gradient;
  } else {
    wrapper.style.padding = '32px';
    wrapper.style.background = getComputedStyle(document.documentElement).getPropertyValue('--mid-bg').trim() || '#0d1117';
  }
  wrapper.appendChild(win);
  document.body.appendChild(wrapper);
  try {
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    const dataUrl = await toPng(wrapper, {
      pixelRatio: 2,
      style: { transform: 'none' },
    });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  } finally {
    wrapper.remove();
  }
}

async function shareTableToSheets(headers: HTMLTableCellElement[], rows: HTMLTableRowElement[]): Promise<void> {
  const head = headers.map(h => h.textContent?.trim() ?? '');
  const aoa = [head, ...rows.map(r => rowToValues(r))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!cols'] = head.map(h => ({ wch: Math.max(h.length, 12) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const saved = await window.mid.saveAs(uniqueExportName('table', 'xlsx'), arr, [{ name: 'Excel', extensions: ['xlsx'] }]);
  if (saved) {
    await navigator.clipboard.writeText(saved).catch(() => undefined);
    await window.mid.openExternal('https://drive.google.com/drive/u/0/upload');
    flashStatus(`Saved ${saved.split('/').pop()}; drop into the open Drive tab`);
  }
}

function downloadTable(headers: HTMLTableCellElement[], rows: HTMLTableRowElement[], format: 'csv' | 'json' | 'xlsx'): void {
  const head = headers.map(h => h.textContent?.trim() ?? '');
  let blob: Blob;
  let filename: string;
  if (format === 'csv') {
    const escape = (v: string): string => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [head.map(escape).join(','), ...rows.map(r => rowToValues(r).map(escape).join(','))];
    blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    filename = uniqueExportName('table', 'csv');
  } else if (format === 'json') {
    const objs = rows.map(r => {
      const vals = rowToValues(r);
      return Object.fromEntries(head.map((h, i) => [h, vals[i] ?? '']));
    });
    blob = new Blob([JSON.stringify(objs, null, 2)], { type: 'application/json' });
    filename = uniqueExportName('table', 'json');
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
    filename = uniqueExportName('table', 'xlsx');
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
    rebuildOutline(null);
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
  rebuildOutline(preview);

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
    maybeShowMermaidPopout(ta);
  });
  const onCursor = (): void => {
    const before = ta.value.slice(0, ta.selectionStart);
    const lines = before.split('\n');
    updateCursor(lines.length, lines[lines.length - 1].length + 1);
    maybeShowMermaidPopout(ta);
  };
  ta.addEventListener('keyup', onCursor);
  ta.addEventListener('click', onCursor);
  ta.addEventListener('focus', onCursor);
  ta.addEventListener('blur', () => { hideCursor(); hideMermaidPopout(); });
  return ta;
}

function scheduleSplitRender(preview: HTMLElement): void {
  if (renderTimer !== null) window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    populatePreview(preview);
    rebuildOutline(preview);
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
  // Edit-only mode hides the rail; view/split modes show it (subject to user toggle).
  applyOutlineVisibility();
  if (mode === 'edit') rebuildOutline(null);
}

async function openFile(): Promise<void> {
  const result = await window.mid.openFileDialog();
  if (!result) return;
  loadFileContent(result.filePath, result.content);
}

function isMermaidFile(filePath: string | null): boolean {
  return !!filePath && /\.(mmd|mermaid)$/i.test(filePath);
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
  // First-run: if no warehouse is configured for this workspace and the
  // user hasn't dismissed the modal, drop into onboarding (#236).
  void maybeShowOnboarding();
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
    const useDeviceFlow = await midConfirm(
      'gh CLI not authenticated',
      `${auth.output.split('\n')[0]}\n\nClick OK to authenticate via GitHub device-flow in your browser, or Cancel to type a slug manually.`,
    );
    if (useDeviceFlow) {
      const ok = await runGhDeviceFlow();
      if (!ok) return;
    }
  }
  // Pull list of user's repos via gh CLI for picker; fall back to free-text on failure.
  const listResult = await window.mid.ghRepoList();
  const slug = await openRepoPicker(listResult.repos, listResult.ok);
  if (!slug) return;
  await window.mid.repoConnect(currentFolder, slug);
  flashStatus(`Connected to ${slug}`);
  await refreshRepoStatus();
}

function openRepoPicker(repos: { nameWithOwner: string; description: string; visibility: string }[], gotList: boolean): Promise<string | null> {
  return new Promise(resolve => {
    const dlg = document.getElementById('mid-spotlight') as HTMLDialogElement;
    const input = document.getElementById('mid-spotlight-input') as HTMLInputElement;
    const results = document.getElementById('mid-spotlight-results') as HTMLDivElement;
    const tabs = dlg.querySelectorAll<HTMLButtonElement>('.mid-spotlight-tab');
    tabs.forEach(t => { t.style.display = 'none'; });

    const render = (): void => {
      const q = input.value.trim().toLowerCase();
      results.replaceChildren();
      if (!gotList) {
        results.innerHTML = '<div class="mid-spotlight-empty">gh repo list failed — type owner/name manually and press Enter.</div>';
        return;
      }
      const matches = q ? repos.filter(r => r.nameWithOwner.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)) : repos;
      // Always offer "Create new repo…" at the top
      const createRow = document.createElement('button');
      createRow.className = 'mid-spotlight-row';
      createRow.innerHTML = `${iconHTML('plus', 'mid-icon--sm mid-icon--muted')}<span class="mid-spotlight-row-name">Create new repo…</span><span class="mid-spotlight-row-path">${q ? escapeHTML(q) : 'enter name'}</span>`;
      createRow.addEventListener('click', () => { void onCreateNew(q || ''); });
      results.appendChild(createRow);
      for (const r of matches.slice(0, 50)) {
        const row = document.createElement('button');
        row.className = 'mid-spotlight-row';
        row.innerHTML = `${iconHTML('github', 'mid-icon--sm mid-icon--muted')}<span class="mid-spotlight-row-name">${escapeHTML(r.nameWithOwner)}</span><span class="mid-spotlight-row-path">${escapeHTML(r.visibility?.toLowerCase() ?? '')}</span>`;
        if (r.description) row.title = r.description;
        row.addEventListener('click', () => { close(r.nameWithOwner); });
        results.appendChild(row);
      }
    };

    const onCreateNew = async (defaultSlug: string): Promise<void> => {
      close(null);
      const slug = await midPrompt('Create GitHub repo', 'owner/name (no spaces)', defaultSlug);
      if (!slug || !/^[^/]+\/[^/]+$/.test(slug)) return;
      const visConfirm = await midConfirm('Visibility', `Create ${slug} as PRIVATE? Cancel for public.`);
      const result = await window.mid.ghRepoCreate(slug, visConfirm ? 'private' : 'public');
      if (!result.ok) {
        await midConfirm('gh repo create failed', result.error ?? 'unknown');
        return;
      }
      if (currentFolder) {
        await window.mid.repoConnect(currentFolder, slug);
        flashStatus(`Created + connected ${slug}`);
        await refreshRepoStatus();
      }
    };

    let closed = false;
    function close(value: string | null): void {
      if (closed) return;
      closed = true;
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
      dlg.removeEventListener('click', onBackdrop);
      tabs.forEach(t => { t.style.display = ''; });
      if (dlg.open) dlg.close();
      resolve(value);
    }
    const onInput = (): void => render();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter') {
        const v = input.value.trim();
        if (v && /^[^/]+\/[^/]+$/.test(v)) close(v);
      }
    };
    const onBackdrop = (e: MouseEvent): void => { if (e.target === dlg) close(null); };

    input.value = '';
    input.placeholder = gotList ? 'Search your repos or type owner/name…' : 'Type owner/name…';
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    dlg.addEventListener('click', onBackdrop);
    dlg.showModal();
    render();
    input.focus();
  });
}

async function runGhDeviceFlow(): Promise<boolean> {
  const start = await window.mid.ghDeviceFlowStart();
  if (!start.ok || !start.userCode || !start.verificationUri || !start.deviceCode) {
    await midConfirm('Device flow failed to start', start.error ?? 'Unknown error');
    return false;
  }
  await navigator.clipboard.writeText(start.userCode).catch(() => undefined);
  await window.mid.openExternal(start.verificationUri);
  flashStatus(`Code ${start.userCode} copied — paste it in the browser`);
  // Poll until token or timeout (5 minutes max).
  const maxAttempts = Math.ceil((5 * 60) / (start.interval ?? 5));
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, (start.interval ?? 5) * 1000));
    const result = await window.mid.ghDeviceFlowPoll(start.deviceCode);
    if (result.ok && result.token) { flashStatus('GitHub authenticated'); return true; }
    if (!result.ok) { await midConfirm('Auth failed', result.error ?? 'Unknown'); return false; }
  }
  await midConfirm('Auth timed out', 'No token received within 5 minutes.');
  return false;
}


/* ── Warehouse onboarding wizard (#236) ───────────────────────────────
 * First-launch flow that walks the user from a bare workspace to a
 * working notes warehouse without leaving the app:
 *   step 1 (gh):   detect the gh CLI; if absent, link to the install docs.
 *   step 2 (auth): if not signed in, offer Terminal command + device flow.
 *   step 3 (repo): pick an existing repo or create one named <ws>-notes.
 *
 * Trigger: after a folder has been opened, if no warehouse is registered
 * for the active workspace AND the user hasn't dismissed the modal for
 * that workspace before. Dismissals live in
 * `AppState.warehouseOnboardingDismissed: string[]` keyed by workspace id.
 *
 * Re-trigger: status-bar repo button context menu has a "Set up warehouse…"
 * entry that calls `openWarehouseOnboarding(true)` (force = true ignores
 * the dismissed list).
 */

type OnboardingStep = 'gh' | 'auth' | 'repo';

interface OnboardingState {
  step: OnboardingStep;
  ghInstalled: boolean;
  ghAuthed: boolean;
  ghStatusOutput: string;
  repos: { nameWithOwner: string; description: string; visibility: string }[];
  reposLoaded: boolean;
  selectedRepo: string;
  customSlug: string;
  busy: boolean;
  error: string;
}

let onboardingActive = false;

function workspaceSlugFromPath(folderPath: string): string {
  const base = folderPath.split('/').filter(Boolean).pop() ?? 'notes';
  const slug = base.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug || 'notes';
}

function defaultRepoNameForWorkspace(folderPath: string): string {
  return `${workspaceSlugFromPath(folderPath)}-notes`;
}

function workspaceIdForCurrent(): string | null {
  if (!currentFolder) return null;
  const ws = workspaces.find(w => w.path === currentFolder);
  return ws ? ws.id : currentFolder;
}

function isGhMissing(output: string): boolean {
  const o = output.toLowerCase();
  return o.includes('enoent') || o.includes('command not found') || o.includes('spawn gh') || o.includes('not found');
}

async function shouldAutoShowOnboarding(): Promise<boolean> {
  if (!currentFolder) return false;
  const wsId = workspaceIdForCurrent();
  if (!wsId) return false;
  try {
    const existing = await window.mid.warehousesList(currentFolder);
    if (existing.length > 0) return false;
  } catch { /* surface as 'no warehouse' */ }
  const state = await window.mid.readAppState();
  const dismissed = Array.isArray(state.warehouseOnboardingDismissed) ? state.warehouseOnboardingDismissed : [];
  if (dismissed.includes(wsId)) return false;
  return true;
}

async function maybeShowOnboarding(): Promise<void> {
  if (onboardingActive) return;
  if (await shouldAutoShowOnboarding()) {
    void openWarehouseOnboarding();
  }
}

async function dismissOnboardingForCurrentWorkspace(): Promise<void> {
  const wsId = workspaceIdForCurrent();
  if (!wsId) return;
  const state = await window.mid.readAppState();
  const prev = Array.isArray(state.warehouseOnboardingDismissed) ? state.warehouseOnboardingDismissed : [];
  if (prev.includes(wsId)) return;
  await window.mid.patchAppState({ warehouseOnboardingDismissed: [...prev, wsId] });
}

async function openWarehouseOnboarding(force = false): Promise<void> {
  if (!currentFolder) {
    flashStatus('Open a folder before configuring a warehouse');
    return;
  }
  if (onboardingActive) return;
  onboardingActive = true;
  if (force) {
    const state = await window.mid.readAppState();
    const prev = Array.isArray(state.warehouseOnboardingDismissed) ? state.warehouseOnboardingDismissed : [];
    const wsId = workspaceIdForCurrent();
    if (wsId && prev.includes(wsId)) {
      await window.mid.patchAppState({ warehouseOnboardingDismissed: prev.filter(id => id !== wsId) });
    }
  }
  const dlg = document.getElementById('mid-warehouse-onboarding') as HTMLDialogElement;
  const body = document.getElementById('mid-onboarding-body') as HTMLDivElement;
  const stepsEl = document.getElementById('mid-onboarding-steps') as HTMLOListElement;
  const skipBtn = document.getElementById('mid-onboarding-skip') as HTMLButtonElement;
  const closeBtn = document.getElementById('mid-onboarding-close') as HTMLButtonElement;
  const backBtn = document.getElementById('mid-onboarding-back') as HTMLButtonElement;
  const nextBtn = document.getElementById('mid-onboarding-next') as HTMLButtonElement;

  const state: OnboardingState = {
    step: 'gh',
    ghInstalled: false,
    ghAuthed: false,
    ghStatusOutput: '',
    repos: [],
    reposLoaded: false,
    selectedRepo: '',
    customSlug: defaultRepoNameForWorkspace(currentFolder),
    busy: false,
    error: '',
  };

  const refreshStepsHeader = (): void => {
    const order: OnboardingStep[] = ['gh', 'auth', 'repo'];
    const activeIdx = order.indexOf(state.step);
    Array.from(stepsEl.children).forEach((li, idx) => {
      li.classList.remove('is-active', 'is-done');
      if (idx === activeIdx) li.classList.add('is-active');
      else if (idx < activeIdx) li.classList.add('is-done');
    });
  };

  const closeOnboarding = (markDismissed: boolean): void => {
    if (markDismissed) void dismissOnboardingForCurrentWorkspace();
    skipBtn.removeEventListener('click', onSkip);
    closeBtn.removeEventListener('click', onSkip);
    backBtn.removeEventListener('click', onBack);
    nextBtn.removeEventListener('click', onNext);
    dlg.removeEventListener('cancel', onCancel);
    if (dlg.open) dlg.close();
    onboardingActive = false;
  };

  const onSkip = (): void => closeOnboarding(true);
  const onCancel = (e: Event): void => { e.preventDefault(); closeOnboarding(true); };

  const renderError = (): string => state.error
    ? `<div class="mid-onboarding-error">${escapeHTML(state.error)}</div>`
    : '';

  const renderGhStep = async (): Promise<void> => {
    state.busy = true;
    body.innerHTML = `<p>${iconHTML('refresh', 'mid-icon--sm')} Detecting <code>gh</code> CLI…</p>`;
    nextBtn.hidden = true;
    backBtn.hidden = true;
    const status = await window.mid.ghAuthStatus();
    state.ghStatusOutput = status.output;
    state.ghInstalled = status.authenticated || !isGhMissing(status.output);
    state.ghAuthed = status.authenticated;
    state.busy = false;
    if (state.ghInstalled && state.ghAuthed) {
      state.step = 'repo';
      refreshStepsHeader();
      void renderRepoStep();
      return;
    }
    if (state.ghInstalled && !state.ghAuthed) {
      state.step = 'auth';
      refreshStepsHeader();
      renderAuthStep();
      return;
    }
    body.innerHTML = `
      <p>The <code>gh</code> CLI isn't installed yet. It's the easiest way to connect Mark It Down to GitHub for your notes warehouse.</p>
      <div class="mid-onboarding-card">
        <div class="mid-onboarding-card-title">${iconHTML('download', 'mid-icon--sm')} Install GitHub CLI</div>
        <p class="mid-onboarding-card-hint">The official page lists Homebrew, winget, apt, dnf and more.</p>
        <div class="mid-onboarding-actions">
          <button class="mid-btn mid-btn--primary" data-onboarding-action="open-install">${iconHTML('github', 'mid-icon--sm')} Open install page</button>
          <button class="mid-btn" data-onboarding-action="recheck">${iconHTML('refresh', 'mid-icon--sm')} Continue once installed</button>
        </div>
      </div>
      <p class="mid-onboarding-card-hint">Prefer not to install it? You can sign in via the GitHub OAuth device flow on the next step.</p>
      <div class="mid-onboarding-actions">
        <button class="mid-btn" data-onboarding-action="device-fallback">Use device flow instead</button>
      </div>
      ${renderError()}
    `;
    nextBtn.hidden = true;
    backBtn.hidden = true;
    body.querySelector<HTMLButtonElement>('[data-onboarding-action="open-install"]')?.addEventListener('click', () => {
      void window.mid.openExternal('https://cli.github.com/');
    });
    body.querySelector<HTMLButtonElement>('[data-onboarding-action="recheck"]')?.addEventListener('click', () => {
      state.error = '';
      void renderGhStep();
    });
    body.querySelector<HTMLButtonElement>('[data-onboarding-action="device-fallback"]')?.addEventListener('click', () => {
      state.step = 'auth';
      refreshStepsHeader();
      renderAuthStep(/* deviceOnly */ true);
    });
  };

  const renderAuthStep = (deviceOnly = false): void => {
    backBtn.hidden = false;
    nextBtn.hidden = true;
    body.innerHTML = `
      <p>Sign in to GitHub so Mark It Down can list and create repos for your notes warehouse.</p>
      ${deviceOnly ? '' : `
      <div class="mid-onboarding-card">
        <div class="mid-onboarding-card-title">${iconHTML('github', 'mid-icon--sm')} Use the Terminal</div>
        <p class="mid-onboarding-card-hint">Run this in any terminal, follow the browser prompt, then come back and click <em>Re-check</em>.</p>
        <div class="mid-onboarding-cmd"><code>gh auth login</code><button class="mid-btn mid-btn--icon" data-onboarding-action="copy-cmd" title="Copy">${iconHTML('copy', 'mid-icon--sm')}</button></div>
        <div class="mid-onboarding-actions">
          <button class="mid-btn" data-onboarding-action="recheck-auth">${iconHTML('refresh', 'mid-icon--sm')} Re-check</button>
        </div>
      </div>
      `}
      <div class="mid-onboarding-card">
        <div class="mid-onboarding-card-title">${iconHTML('github', 'mid-icon--sm')} Use device flow</div>
        <p class="mid-onboarding-card-hint">Get a one-time code, open <code>github.com/login/device</code>, and authorize Mark It Down — no terminal needed.</p>
        <div class="mid-onboarding-actions">
          <button class="mid-btn mid-btn--primary" data-onboarding-action="device-flow">Start device flow</button>
        </div>
      </div>
      ${renderError()}
    `;
    body.querySelector<HTMLButtonElement>('[data-onboarding-action="copy-cmd"]')?.addEventListener('click', () => {
      void navigator.clipboard.writeText('gh auth login').then(() => flashStatus('Copied: gh auth login'));
    });
    body.querySelector<HTMLButtonElement>('[data-onboarding-action="recheck-auth"]')?.addEventListener('click', () => {
      state.error = '';
      void renderGhStep();
    });
    body.querySelector<HTMLButtonElement>('[data-onboarding-action="device-flow"]')?.addEventListener('click', async () => {
      state.error = '';
      const ok = await runGhDeviceFlow();
      if (ok) {
        state.ghAuthed = true;
        state.step = 'repo';
        refreshStepsHeader();
        void renderRepoStep();
      } else {
        state.error = 'Device flow did not complete. Retry, or sign in via gh auth login.';
        renderAuthStep(deviceOnly);
      }
    });
  };

  const renderRepoStep = async (): Promise<void> => {
    backBtn.hidden = false;
    nextBtn.hidden = false;
    nextBtn.textContent = 'Use this repo';
    nextBtn.disabled = !state.selectedRepo;
    if (!state.reposLoaded) {
      body.innerHTML = `<p>${iconHTML('refresh', 'mid-icon--sm')} Loading your repos…</p>`;
      const result = await window.mid.ghRepoList();
      state.repos = result.repos;
      state.reposLoaded = true;
      if (!result.ok) state.error = result.error ?? 'gh repo list failed';
    }
    const defaultSlug = defaultRepoNameForWorkspace(currentFolder ?? '');
    body.innerHTML = `
      <p>Pick an existing GitHub repo to host your notes, or create a new private one. The first chosen repo becomes the active warehouse for this workspace.</p>
      <div class="mid-onboarding-card">
        <div class="mid-onboarding-card-title">${iconHTML('plus', 'mid-icon--sm')} Create a new private repo</div>
        <p class="mid-onboarding-card-hint">The default name is derived from the workspace folder. Edit before submitting if you'd like a different slug.</p>
        <input id="mid-onboarding-create-slug" class="mid-onboarding-input" type="text" value="${escapeHTML(state.customSlug || defaultSlug)}" spellcheck="false" />
        <div class="mid-onboarding-actions">
          <button class="mid-btn mid-btn--primary" data-onboarding-action="create-repo">${iconHTML('github', 'mid-icon--sm')} Create &amp; use</button>
        </div>
      </div>
      <div class="mid-onboarding-card">
        <div class="mid-onboarding-card-title">${iconHTML('github', 'mid-icon--sm')} Or pick an existing repo</div>
        <input id="mid-onboarding-repo-filter" class="mid-onboarding-input" type="text" placeholder="Filter…" />
        <div class="mid-onboarding-list" id="mid-onboarding-repo-list"></div>
        <div class="mid-onboarding-status">${state.repos.length} repo${state.repos.length === 1 ? '' : 's'} loaded</div>
      </div>
      ${renderError()}
    `;
    const slugInput = body.querySelector<HTMLInputElement>('#mid-onboarding-create-slug');
    slugInput?.addEventListener('input', () => { state.customSlug = slugInput.value; });
    const filterInput = body.querySelector<HTMLInputElement>('#mid-onboarding-repo-filter');
    const listEl = body.querySelector<HTMLDivElement>('#mid-onboarding-repo-list');
    const renderList = (): void => {
      if (!listEl) return;
      const q = (filterInput?.value ?? '').trim().toLowerCase();
      const matches = q
        ? state.repos.filter(r => r.nameWithOwner.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q))
        : state.repos;
      listEl.replaceChildren();
      if (matches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'mid-onboarding-status';
        empty.textContent = state.repos.length === 0 ? 'No repos found via gh repo list.' : 'No matches.';
        listEl.appendChild(empty);
        return;
      }
      for (const r of matches.slice(0, 100)) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'mid-onboarding-list-row';
        if (state.selectedRepo === r.nameWithOwner) row.classList.add('is-active');
        row.innerHTML = `<span class="mid-onboarding-list-row-name">${escapeHTML(r.nameWithOwner)}</span><span class="mid-onboarding-list-row-meta">${escapeHTML(r.visibility?.toLowerCase() ?? '')}</span>`;
        if (r.description) row.title = r.description;
        row.addEventListener('click', () => {
          state.selectedRepo = r.nameWithOwner;
          nextBtn.disabled = false;
          renderList();
        });
        listEl.appendChild(row);
      }
    };
    filterInput?.addEventListener('input', renderList);
    renderList();
    body.querySelector<HTMLButtonElement>('[data-onboarding-action="create-repo"]')?.addEventListener('click', async () => {
      const slugRaw = (slugInput?.value ?? '').trim();
      if (!slugRaw) { state.error = 'Repo name is required'; void renderRepoStep(); return; }
      const result = await window.mid.ghRepoCreate(slugRaw, 'private');
      if (!result.ok) {
        state.error = `gh repo create failed: ${result.error ?? 'unknown'}`;
        void renderRepoStep();
        return;
      }
      const url = (result.url ?? '').trim();
      const m = /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(url);
      const finalSlug = m ? m[1] : slugRaw;
      await persistAndConnect(finalSlug);
    });
    nextBtn.onclick = (): void => {
      if (state.selectedRepo) void persistAndConnect(state.selectedRepo);
    };
  };

  const persistAndConnect = async (slug: string): Promise<void> => {
    if (!currentFolder) return;
    state.busy = true;
    nextBtn.disabled = true;
    backBtn.disabled = true;
    const id = workspaceSlugFromPath(currentFolder);
    const name = slug.split('/').pop() ?? slug;
    const addResult = await window.mid.warehousesAdd(currentFolder, { id, name, repo: slug });
    if (!addResult.ok) {
      state.error = `Could not save warehouse: ${addResult.error ?? 'unknown'}`;
      state.busy = false;
      nextBtn.disabled = false;
      backBtn.disabled = false;
      void renderRepoStep();
      return;
    }
    try {
      await window.mid.repoConnect(currentFolder, slug);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[mid] repoConnect failed during onboarding:', err);
    }
    flashStatus(`Warehouse ready: ${slug}`);
    warehouses = await window.mid.warehousesList(currentFolder);
    void refreshRepoStatus();
    closeOnboarding(/* markDismissed */ false);
  };

  const onBack = (): void => {
    if (state.step === 'auth') { state.step = 'gh'; refreshStepsHeader(); void renderGhStep(); }
    else if (state.step === 'repo') {
      state.step = state.ghAuthed ? 'gh' : 'auth';
      refreshStepsHeader();
      if (state.step === 'gh') void renderGhStep();
      else renderAuthStep();
    }
  };

  const onNext = (): void => {
    if (state.step === 'repo' && state.selectedRepo) void persistAndConnect(state.selectedRepo);
  };

  skipBtn.addEventListener('click', onSkip);
  closeBtn.addEventListener('click', onSkip);
  backBtn.addEventListener('click', onBack);
  nextBtn.addEventListener('click', onNext);
  dlg.addEventListener('cancel', onCancel);

  refreshStepsHeader();
  if (!dlg.open) dlg.showModal();
  void renderGhStep();
}

// Conflict banner for git pull --rebase failures
let conflictBanner: HTMLDivElement | null = null;
function showConflictBanner(message: string): void {
  hideConflictBanner();
  const banner = document.createElement('div');
  banner.className = 'mid-conflict-banner';
  banner.innerHTML = `
    <span class="mid-conflict-icon">${iconHTML('x', 'mid-icon--sm')}</span>
    <div class="mid-conflict-text">
      <div class="mid-conflict-title">Merge conflict during pull-rebase</div>
      <div class="mid-conflict-msg">${escapeHTML(message)}</div>
    </div>
    <button class="mid-btn mid-btn--secondary" data-conflict="abort">Abort rebase</button>
    <button class="mid-btn mid-btn--secondary" data-conflict="keep-mine">Keep mine</button>
    <button class="mid-btn mid-btn--secondary" data-conflict="keep-theirs">Keep theirs</button>
    <button class="mid-btn mid-btn--ghost mid-btn--icon" data-conflict="dismiss" title="Dismiss">${iconHTML('x', 'mid-icon--sm')}</button>
  `;
  banner.addEventListener('click', e => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-conflict]')?.dataset.conflict;
    if (!action) return;
    void handleConflictAction(action as 'abort' | 'keep-mine' | 'keep-theirs' | 'dismiss');
  });
  document.body.appendChild(banner);
  conflictBanner = banner;
}
function hideConflictBanner(): void {
  if (conflictBanner) { conflictBanner.remove(); conflictBanner = null; }
}
async function handleConflictAction(action: 'abort' | 'keep-mine' | 'keep-theirs' | 'dismiss'): Promise<void> {
  if (action === 'dismiss') { hideConflictBanner(); return; }
  flashStatus(`Conflict action: ${action} — run from terminal: git rebase --${action === 'abort' ? 'abort' : 'continue'}`);
  hideConflictBanner();
}

async function showFileHistory(filePath: string): Promise<void> {
  if (!currentFolder) return;
  const result = await window.mid.fileHistory(currentFolder, filePath);
  if (!result.ok || result.commits.length === 0) {
    flashStatus(result.error ? `History failed: ${result.error.split('\n')[0]}` : 'No history');
    return;
  }
  // Render history into the spotlight modal repurposed as a viewer.
  const dlg = document.getElementById('mid-spotlight') as HTMLDialogElement;
  const input = document.getElementById('mid-spotlight-input') as HTMLInputElement;
  const results = document.getElementById('mid-spotlight-results') as HTMLDivElement;
  const tabs = dlg.querySelectorAll<HTMLButtonElement>('.mid-spotlight-tab');
  tabs.forEach(t => { t.style.display = 'none'; });
  input.value = '';
  input.placeholder = `History — ${filePath.split('/').pop()}`;
  results.replaceChildren();
  for (const c of result.commits) {
    const row = document.createElement('div');
    row.className = 'mid-fh-row';
    const head = document.createElement('div');
    head.className = 'mid-fh-head';
    head.innerHTML = `<span class="mid-fh-msg">${escapeHTML(c.message)}</span><span class="mid-fh-meta">${escapeHTML(c.author)} · ${new Date(c.date).toLocaleDateString()} · <span class="mid-fh-hash">${escapeHTML(c.hash.slice(0, 7))}</span></span>`;
    const diff = document.createElement('pre');
    diff.className = 'mid-fh-diff';
    diff.textContent = c.diff;
    row.append(head, diff);
    results.appendChild(row);
  }
  const close = (): void => {
    tabs.forEach(t => { t.style.display = ''; });
    if (dlg.open) dlg.close();
    document.removeEventListener('keydown', onKey);
    dlg.removeEventListener('click', onBackdrop);
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  const onBackdrop = (e: MouseEvent): void => { if (e.target === dlg) close(); };
  document.addEventListener('keydown', onKey);
  dlg.addEventListener('click', onBackdrop);
  dlg.showModal();
}

async function syncRepo(): Promise<void> {
  if (!currentFolder) return;
  repoSyncBtn.disabled = true;
  const message = (await midPrompt('Sync repo', 'Commit message (blank = auto)', '')) ?? '';
  const result = await window.mid.repoSync(currentFolder, message);
  repoSyncBtn.disabled = false;
  if (result.ok) {
    flashStatus(`Synced — ${result.steps.join(', ')}`);
    hideConflictBanner();
  } else {
    flashStatus(`Sync failed: ${result.error?.split('\n')[0] ?? 'unknown'}`);
    if (result.error && /conflict|merge/i.test(result.error)) {
      showConflictBanner(result.error.split('\n')[0]);
    }
  }
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
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      const isPinned = pinnedFolders.some(p => p.path === entry.path);
      openContextMenu([
        { icon: 'folder-open', label: 'Reveal in Finder', action: () => void window.mid.openExternal(`file://${entry.path}`) },
        { separator: true, label: '' },
        isPinned
          ? { icon: 'trash', label: 'Unpin from sidebar', action: () => unpinFolder(entry.path) }
          : { icon: 'bookmark', label: 'Pin to sidebar…', action: () => void pinFolder(entry.path, entry.name) },
      ], e.clientX, e.clientY);
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
    item.draggable = true;
    item.addEventListener('dragstart', ev => {
      ev.dataTransfer?.setData('application/x-mid-file', entry.path);
      ev.dataTransfer?.setData('text/plain', entry.path);
    });
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      const isMd = /\.(md|mdx|markdown)$/i.test(entry.name);
      const baseItems: MenuItem[] = [
        { icon: 'show', label: 'Open', action: () => void selectTreeFile(entry.path) },
        { icon: 'folder-open', label: 'Reveal in Finder', action: () => void window.mid.openExternal(`file://${entry.path.replace(/\/[^/]+$/, '')}`) },
        { icon: 'refresh', label: 'View history…', action: () => void showFileHistory(entry.path) },
      ];
      if (!isMd) {
        openContextMenu(baseItems, e.clientX, e.clientY);
        return;
      }
      openContextMenu([
        ...baseItems,
        { separator: true, label: '' },
        { icon: 'github', label: 'Push to GitHub now', action: () => void pushFilePath(entry.path, entry.name) },
        { separator: true, label: '' },
        { icon: 'markdown', label: 'Export Markdown', action: () => void exportFile(entry.path, 'md') },
        { icon: 'html5', label: 'Export HTML', action: () => void exportFile(entry.path, 'html') },
        { icon: 'download', label: 'Export PDF', action: () => void exportFile(entry.path, 'pdf') },
        { icon: 'download', label: 'Export Word (.docx)', action: () => void exportFile(entry.path, 'docx') },
        { icon: 'image', label: 'Export PNG', action: () => void exportFile(entry.path, 'png') },
        { icon: 'list-ul', label: 'Export plain text', action: () => void exportFile(entry.path, 'txt') },
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
  invalidateTreeCache(currentFolder);
  const tree = await window.mid.listFolderMd(currentFolder);
  treeCache.set(currentFolder, tree);
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

function shortExportId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function uniqueExportName(base: string, ext: string): string {
  const safe = base.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_.]/g, '_') || 'export';
  return `${safe}--${shortExportId()}.${ext}`;
}

function defaultExportName(ext: string): string {
  const base = currentPath ? currentPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'document' : 'document';
  return uniqueExportName(base, ext);
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
      const html = await buildStandaloneHTML();
      await window.mid.saveAs(defaultExportName('html'), html, [{ name: 'HTML', extensions: ['html'] }]);
      flashStatus('Exported HTML');
      break;
    }
    case 'pdf': {
      document.body.classList.add('is-printing');
      try {
        await new Promise(resolve => setTimeout(resolve, 50));
        const result = await window.mid.exportPDF(defaultExportName('pdf'));
        flashStatus(result ? 'Exported PDF' : 'PDF cancelled');
      } finally {
        document.body.classList.remove('is-printing');
      }
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
      const saved = await window.mid.saveAs(defaultExportName('docx'), buffer, [{ name: 'Word', extensions: ['docx'] }]);
      flashStatus(saved ? 'Exported DOCX' : 'Cancelled');
      break;
    }
    case 'docx-gdocs': {
      const preview = root.querySelector<HTMLElement>('.mid-preview');
      if (!preview) { flashStatus('No preview to export'); return; }
      const buffer = await buildDocxFromPreview(preview);
      const saved = await window.mid.saveAs(defaultExportName('docx'), buffer, [{ name: 'Word', extensions: ['docx'] }]);
      if (saved) {
        await navigator.clipboard.writeText(saved).catch(() => undefined);
        await window.mid.openExternal('https://drive.google.com/drive/u/0/upload');
        flashStatus(`Saved ${saved.split('/').pop()}; drop into the open Drive tab`);
      }
      break;
    }
  }
}

async function buildDocxFromPreview(preview: HTMLElement): Promise<ArrayBuffer> {
  // Work on a clone so we can strip in-app affordances (heading anchors,
  // copy buttons, mermaid SVGs we can't faithfully render in Word, etc.)
  // without affecting the live preview.
  const clone = preview.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.mid-anchor, .mid-code-toolbar, .mid-copy-btn, .mid-mermaid-toolbar').forEach(el => el.remove());

  const children: (Paragraph | DocxTable)[] = [];
  for (const node of Array.from(clone.children)) {
    children.push(...domNodeToDocx(node as HTMLElement));
  }
  const doc = new Document({
    numbering: {
      config: [{
        reference: 'mid-ol',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
      }],
    },
    sections: [{ children }],
  });
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

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function domNodeToDocx(el: HTMLElement): (Paragraph | DocxTable)[] {
  const tag = el.tagName;
  if (HEADING_MAP[tag]) {
    return [new Paragraph({
      heading: HEADING_MAP[tag],
      children: [new TextRun(cleanText(el.textContent ?? ''))],
      spacing: { before: 240, after: 120 },
    })];
  }
  if (tag === 'P') {
    return [new Paragraph({
      children: [new TextRun(cleanText(el.textContent ?? ''))],
      spacing: { after: 120 },
    })];
  }
  if (tag === 'BLOCKQUOTE') {
    return [new Paragraph({
      children: [new TextRun({ text: cleanText(el.textContent ?? ''), italics: true })],
      indent: { left: 720 },
      spacing: { after: 120 },
    })];
  }
  if (tag === 'PRE') {
    const lines = (el.textContent ?? '').replace(/\n+$/, '').split('\n');
    return lines.map(line => new Paragraph({
      children: [new TextRun({ text: line, font: 'Courier New', size: 20 })],
      spacing: { after: 0 },
      indent: { left: 360 },
    }));
  }
  if (tag === 'UL' || tag === 'OL') {
    const items = Array.from(el.querySelectorAll(':scope > li'));
    return items.map(li => new Paragraph({
      children: [new TextRun(cleanText(li.textContent ?? ''))],
      bullet: tag === 'UL' ? { level: 0 } : undefined,
      numbering: tag === 'OL' ? { reference: 'mid-ol', level: 0 } : undefined,
      spacing: { after: 60 },
    }));
  }
  if (el.classList.contains('mid-spec-card')) {
    return specCardToDocx(el);
  }
  if (el.classList.contains('mid-frontmatter')) {
    return frontmatterToDocx(el);
  }
  if (tag === 'TABLE' || el.classList.contains('mid-table')) {
    const tbl = el.querySelector('table') ?? (tag === 'TABLE' ? el : null);
    if (!tbl) return [];
    const trs = Array.from(tbl.querySelectorAll('tr'));
    const colCount = Math.max(...trs.map(tr => tr.querySelectorAll('th, td').length));
    if (colCount === 0) return [];
    const colWidth = Math.floor(100 / colCount);
    const border = { style: BorderStyle.SINGLE, size: 4, color: 'D4D4D8' }; // 0.5pt zinc-300
    const headerShading = { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F4F5' }; // zinc-100
    const rows = trs.map(tr => {
      const cellEls = Array.from(tr.querySelectorAll('th, td'));
      const cells = cellEls.map(cell => {
        const isHeader = cell.tagName === 'TH';
        return new DocxTableCell({
          width: { size: colWidth, type: WidthType.PERCENTAGE },
          shading: isHeader ? headerShading : undefined,
          borders: {
            top: border, bottom: border, left: border, right: border,
          },
          children: [new Paragraph({
            children: [new TextRun({ text: (cell.textContent ?? '').replace(/\s+/g, ' ').trim(), bold: isHeader })],
          })],
        });
      });
      return new DocxTableRow({ children: cells });
    });
    return [new DocxTable({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: Array.from({ length: colCount }, () => Math.floor(9000 / colCount)),
    })];
  }
  if (tag === 'HR') {
    return [new Paragraph({ children: [new TextRun('───')], alignment: AlignmentType.CENTER })];
  }
  const text = cleanText(el.textContent ?? '');
  if (text) return [new Paragraph({ children: [new TextRun(text)] })];
  return [];
}

function specCardToDocx(el: HTMLElement): Paragraph[] {
  const result: Paragraph[] = [];
  const name = cleanText(el.querySelector('.mid-spec-card-name')?.textContent ?? '');
  const kind = cleanText(el.querySelector('.mid-spec-card-kind')?.textContent ?? '');
  const desc = cleanText(el.querySelector('.mid-spec-card-desc')?.textContent ?? '');
  if (name) {
    result.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: name, bold: true })],
      spacing: { before: 0, after: 60 },
    }));
  }
  if (kind) {
    result.push(new Paragraph({
      children: [new TextRun({ text: kind.toUpperCase(), bold: true, size: 18, color: '6B7280' })],
      spacing: { after: 120 },
    }));
  }
  if (desc) {
    result.push(new Paragraph({
      children: [new TextRun({ text: desc, italics: true })],
      spacing: { after: 120 },
    }));
  }
  el.querySelectorAll<HTMLElement>('.mid-spec-chip').forEach(chip => {
    const k = cleanText(chip.querySelector('.mid-spec-chip-key')?.textContent ?? '');
    const v = cleanText(chip.querySelector('.mid-spec-chip-val')?.textContent ?? '');
    if (k || v) {
      result.push(new Paragraph({
        children: [
          new TextRun({ text: `${k}: `, bold: true, font: 'Courier New', size: 20 }),
          new TextRun({ text: v, font: 'Courier New', size: 20 }),
        ],
        spacing: { after: 40 },
      }));
    }
  });
  result.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 120 } }));
  return result;
}

function frontmatterToDocx(el: HTMLElement): Paragraph[] {
  const result: Paragraph[] = [];
  el.querySelectorAll<HTMLElement>('.mid-fm-row').forEach(row => {
    const k = cleanText(row.querySelector('.mid-fm-key')?.textContent ?? '');
    const v = cleanText(row.querySelector('.mid-fm-val')?.textContent ?? '');
    if (k || v) {
      result.push(new Paragraph({
        children: [
          new TextRun({ text: `${k}: `, bold: true }),
          new TextRun({ text: v }),
        ],
        spacing: { after: 40 },
      }));
    }
  });
  if (result.length > 0) {
    result.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 120 } }));
  }
  return result;
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

async function buildStandaloneHTML(): Promise<string> {
  const preview = root.querySelector<HTMLElement>('.mid-preview');
  const body = preview ? preview.outerHTML : '<p>(empty)</p>';
  const title = currentPath ? currentPath.split('/').pop() ?? 'Untitled' : 'Untitled';
  // Inline the renderer CSS via main-process IPC — `cssRules` access fails
  // on cross-origin sheets in Electron and yields an empty stylesheet.
  const styles = await window.mid.readRendererStyles();
  return `<!DOCTYPE html>
<html lang="en" class="${document.documentElement.className}">
<head>
<meta charset="UTF-8" />
<title>${escapeHTML(title)}</title>
<style>${styles}
body { display: block; padding: 32px; }
.mid-titlebar, .mid-sidebar, .mid-statusbar, .mid-mode-toggle, .mid-shell > aside { display: none !important; }
.mid-shell { display: block !important; }
main.viewing { padding: 0 !important; max-width: 760px !important; margin: 0 auto !important; }</style>
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
modeFilesBtn?.addEventListener('click', () => setSidebarMode('files'));
modeNotesBtn?.addEventListener('click', () => setSidebarMode('notes'));

// Activity bar — VSCode-style icon tray.
type ActivityTarget = 'files' | 'notes' | `pinned:${string}`;
let activeActivity: ActivityTarget = 'files';
let pinnedFilterPath: string | null = null;

function selectActivity(target: ActivityTarget): void {
  if (target === activeActivity && !sidebar.hidden) {
    sidebar.hidden = true;
    document.body.classList.remove('has-sidebar');
    return;
  }
  activeActivity = target;
  if (currentFolder) {
    sidebar.hidden = false;
    document.body.classList.add('has-sidebar');
  }
  activityFiles.classList.toggle('is-active', target === 'files');
  activityNotes.classList.toggle('is-active', target === 'notes');
  activityPinned.querySelectorAll<HTMLButtonElement>('.mid-activity-btn').forEach(btn => {
    btn.classList.toggle('is-active', `pinned:${btn.dataset.path}` === target);
  });
  if (target === 'files') {
    pinnedFilterPath = null;
    setSidebarMode('files');
    if (currentFolder) void refreshFolder();
  } else if (target === 'notes') {
    pinnedFilterPath = null;
    setSidebarMode('notes');
  } else if (target.startsWith('pinned:')) {
    const path = target.slice('pinned:'.length);
    pinnedFilterPath = path;
    setSidebarMode('files');
    void loadPinnedTree(path);
  }
}

async function loadFolderTree(folderPath: string): Promise<TreeEntry[]> {
  if (treeCache.has(folderPath)) return treeCache.get(folderPath)!;
  const tree = await window.mid.listFolderMd(folderPath);
  treeCache.set(folderPath, tree);
  return tree;
}

function invalidateTreeCache(folderPath?: string): void {
  if (folderPath) treeCache.delete(folderPath);
  else treeCache.clear();
}

async function loadPinnedTree(folderPath: string): Promise<void> {
  try {
    const pin = pinnedFolders.find(p => p.path === folderPath);
    const name = pin?.name ?? folderPath.split('/').pop() ?? folderPath;
    sidebarFolderName.textContent = name;
    sidebarFolderName.title = folderPath;
    if (pin && pin.files && pin.files.length > 0) {
      // Cluster mode — render a flat list of registered files.
      treeRoot.replaceChildren();
      for (const filePath of pin.files) {
        const item = document.createElement('div');
        item.className = 'mid-tree-item';
        if (currentPath === filePath) item.classList.add('is-active');
        const fileMatch = iconForFile(filePath.split('/').pop() ?? '', 'file');
        const span = document.createElement('span');
        span.innerHTML = iconHTML(fileMatch.icon, 'mid-icon--muted mid-tree-icon');
        const svg = span.firstElementChild as HTMLElement | null;
        if (svg && fileMatch.color) svg.style.color = fileMatch.color;
        item.appendChild(span.firstElementChild!);
        item.appendChild(document.createTextNode(` ${filePath.split('/').pop() ?? filePath}`));
        item.addEventListener('click', () => void selectTreeFile(filePath));
        item.addEventListener('contextmenu', e => {
          e.preventDefault();
          openContextMenu([
            { icon: 'show', label: 'Open', action: () => void selectTreeFile(filePath) },
            { icon: 'trash', label: 'Remove from cluster', action: () => {
              pin.files = (pin.files ?? []).filter(f => f !== filePath);
              void window.mid.patchAppState({ pinnedFolders });
              void loadPinnedTree(folderPath);
            } },
          ], e.clientX, e.clientY);
        });
        treeRoot.appendChild(item);
      }
      return;
    }
    const tree = await loadFolderTree(folderPath);
    treeRoot.replaceChildren(...renderTree(tree));
    if (tree.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mid-tree-empty';
      empty.textContent = 'No markdown files in this folder.';
      treeRoot.appendChild(empty);
    }
  } catch {
    flashStatus('Pinned folder is gone — unpinning');
    pinnedFolders = pinnedFolders.filter(p => p.path !== folderPath);
    void window.mid.patchAppState({ pinnedFolders });
    renderActivityPinned();
    selectActivity('files');
  }
}

function renderActivityPinned(): void {
  activityPinned.replaceChildren();
  pinnedFolders.forEach((pin, idx) => {
    const btn = document.createElement('button');
    btn.className = 'mid-activity-btn mid-activity-btn--pinned';
    btn.title = `${pin.name} (${pin.path})`;
    btn.dataset.path = pin.path;
    btn.dataset.index = String(idx);
    btn.draggable = true;
    btn.style.color = pin.color;
    btn.innerHTML = iconHTML((pin.icon as IconName) ?? 'folder');
    btn.addEventListener('click', () => selectActivity(`pinned:${pin.path}`));
    btn.addEventListener('contextmenu', e => {
      e.preventDefault();
      openContextMenu([
        { icon: 'edit', label: 'Rename pin…', action: () => void renamePin(pin) },
        { icon: 'cog', label: 'Change icon / color…', action: () => void editPinAppearance(pin) },
        { separator: true, label: '' },
        { icon: 'trash', label: 'Unpin', action: () => unpinFolder(pin.path) },
      ], e.clientX, e.clientY);
    });
    btn.addEventListener('dragstart', e => {
      e.dataTransfer?.setData('application/x-mid-pin', String(idx));
      e.dataTransfer?.setData('text/plain', String(idx));
      btn.classList.add('is-dragging');
    });
    btn.addEventListener('dragend', () => btn.classList.remove('is-dragging'));
    btn.addEventListener('dragover', e => { e.preventDefault(); btn.classList.add('is-drop-target'); });
    btn.addEventListener('dragleave', () => btn.classList.remove('is-drop-target'));
    btn.addEventListener('drop', e => {
      e.preventDefault();
      btn.classList.remove('is-drop-target');
      const dt = e.dataTransfer;
      if (!dt) return;
      // File drop → register in cluster
      const filePath = dt.getData('application/x-mid-file');
      if (filePath) {
        const target = pinnedFolders[idx];
        target.files = Array.from(new Set([...(target.files ?? []), filePath]));
        void window.mid.patchAppState({ pinnedFolders });
        flashStatus(`Added ${filePath.split('/').pop()} to "${target.name}"`);
        if (activeActivity === `pinned:${target.path}`) void loadPinnedTree(target.path);
        return;
      }
      // Pin reorder
      const fromIdx = Number(dt.getData('application/x-mid-pin') ?? dt.getData('text/plain') ?? '');
      const toIdx = Number(btn.dataset.index ?? '');
      if (Number.isNaN(fromIdx) || Number.isNaN(toIdx) || fromIdx === toIdx) return;
      const next = pinnedFolders.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      pinnedFolders = next;
      void window.mid.patchAppState({ pinnedFolders });
      renderActivityPinned();
    });
    activityPinned.appendChild(btn);
  });
}

async function pinFolder(folderPath: string, defaultName: string): Promise<void> {
  if (pinnedFolders.find(p => p.path === folderPath)) {
    flashStatus('Already pinned');
    return;
  }
  const result = await openPinEditor({
    name: defaultName,
    icon: 'folder',
    color: '#2563eb',
    titleLabel: 'Pin folder',
  });
  if (!result) return;
  pinnedFolders = [...pinnedFolders, {
    path: folderPath,
    name: result.name,
    icon: result.icon,
    color: result.color,
  }];
  await window.mid.patchAppState({ pinnedFolders });
  renderActivityPinned();
  flashStatus(`Pinned "${result.name}"`);
}

const PIN_ICON_CHOICES: IconName[] = [
  'folder', 'folder-open', 'file', 'bookmark', 'tag',
  'list-ul', 'image', 'github', 'link', 'cog',
  'search', 'markdown', 'typescript', 'javascript', 'python',
];
const PIN_COLOR_CHOICES = [
  '#2563eb', '#16a34a', '#dc2626', '#ca8a04',
  '#9333ea', '#0891b2', '#db2777', '#475569',
  '#f97316', '#0d9488', '#7c3aed', '#71717a',
];

interface PinEditorInput { name: string; icon: string; color: string; titleLabel?: string }
interface PinEditorResult { name: string; icon: string; color: string }

function openPinEditor(initial: PinEditorInput): Promise<PinEditorResult | null> {
  return new Promise(resolve => {
    const dlg = document.getElementById('mid-pin-editor') as HTMLDialogElement;
    const titleEl = dlg.querySelector('.mid-pin-title') as HTMLHeadingElement;
    const nameEl = document.getElementById('mid-pin-name') as HTMLInputElement;
    const iconsEl = document.getElementById('mid-pin-icons') as HTMLDivElement;
    const colorsEl = document.getElementById('mid-pin-colors') as HTMLDivElement;
    const cancelBtn = document.getElementById('mid-pin-cancel') as HTMLButtonElement;
    const form = dlg.querySelector('form') as HTMLFormElement;

    titleEl.textContent = initial.titleLabel ?? 'Pin folder';
    nameEl.value = initial.name;
    let chosenIcon = initial.icon;
    let chosenColor = initial.color;

    iconsEl.replaceChildren();
    for (const ic of PIN_ICON_CHOICES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mid-pin-icon-btn' + (ic === chosenIcon ? ' is-active' : '');
      btn.dataset.icon = ic;
      btn.innerHTML = iconHTML(ic);
      btn.addEventListener('click', () => {
        chosenIcon = ic;
        iconsEl.querySelectorAll('.mid-pin-icon-btn').forEach(b => b.classList.toggle('is-active', (b as HTMLElement).dataset.icon === ic));
      });
      iconsEl.appendChild(btn);
    }

    colorsEl.replaceChildren();
    for (const col of PIN_COLOR_CHOICES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mid-pin-color-btn' + (col === chosenColor ? ' is-active' : '');
      btn.style.background = col;
      btn.dataset.color = col;
      btn.title = col;
      btn.addEventListener('click', () => {
        chosenColor = col;
        colorsEl.querySelectorAll('.mid-pin-color-btn').forEach(b => b.classList.toggle('is-active', (b as HTMLElement).dataset.color === col));
      });
      colorsEl.appendChild(btn);
    }

    let canceled = true;
    const cleanup = (): void => {
      form.removeEventListener('submit', onSubmit);
      cancelBtn.removeEventListener('click', onCancel);
      dlg.removeEventListener('click', onBackdrop);
      dlg.removeEventListener('close', onClose);
    };
    const onSubmit = (e: Event): void => {
      e.preventDefault();
      canceled = false;
      cleanup();
      dlg.close();
      resolve({ name: nameEl.value.trim() || initial.name, icon: chosenIcon, color: chosenColor });
    };
    const onCancel = (): void => { cleanup(); dlg.close(); resolve(null); };
    const onBackdrop = (e: MouseEvent): void => { if (e.target === dlg) onCancel(); };
    const onClose = (): void => { if (canceled) { cleanup(); resolve(null); } };

    form.addEventListener('submit', onSubmit);
    cancelBtn.addEventListener('click', onCancel);
    dlg.addEventListener('click', onBackdrop);
    dlg.addEventListener('close', onClose);

    dlg.showModal();
    nameEl.focus();
    nameEl.select();
  });
}

function unpinFolder(folderPath: string): void {
  pinnedFolders = pinnedFolders.filter(p => p.path !== folderPath);
  void window.mid.patchAppState({ pinnedFolders });
  renderActivityPinned();
  if (activeActivity === `pinned:${folderPath}`) selectActivity('files');
}

async function renamePin(pin: PinnedFolder): Promise<void> {
  const result = await openPinEditor({ name: pin.name, icon: pin.icon, color: pin.color, titleLabel: 'Rename pin' });
  if (!result) return;
  pin.name = result.name;
  pin.icon = result.icon;
  pin.color = result.color;
  await window.mid.patchAppState({ pinnedFolders });
  renderActivityPinned();
}

async function editPinAppearance(pin: PinnedFolder): Promise<void> {
  const result = await openPinEditor({ name: pin.name, icon: pin.icon, color: pin.color, titleLabel: 'Pin appearance' });
  if (!result) return;
  pin.name = result.name;
  pin.icon = result.icon;
  pin.color = result.color;
  await window.mid.patchAppState({ pinnedFolders });
  renderActivityPinned();
}

activityFiles.addEventListener('click', () => selectActivity('files'));
activityNotes.addEventListener('click', () => selectActivity('notes'));
activitySettings.addEventListener('click', () => document.getElementById('settings-btn')?.dispatchEvent(new MouseEvent('click')));
titlebarSearchBtn.addEventListener('click', () => openSpotlight());

const workspaceSwitcherBtn = document.getElementById('workspace-switcher') as HTMLButtonElement | null;
workspaceSwitcherBtn?.addEventListener('click', e => {
  e.preventDefault();
  e.stopPropagation();
  const items: MenuItem[] = workspaces.map(ws => ({
    icon: 'folder',
    label: `${ws.name}${ws.path === currentFolder ? '  (active)' : ''}`,
    action: () => void switchWorkspace(ws),
  }));
  if (items.length > 0) items.push({ separator: true, label: '' });
  items.push({ icon: 'plus', label: 'Add workspace…', action: () => void addWorkspace() });
  if (currentFolder) {
    items.push({ icon: 'trash', label: 'Remove current from list', action: () => removeWorkspace(currentFolder!) });
  }
  const rect = workspaceSwitcherBtn.getBoundingClientRect();
  openContextMenu(items, rect.left, rect.bottom + 4);
});

async function addWorkspace(): Promise<void> {
  const result = await window.mid.openFolderDialog();
  if (!result) return;
  const id = `ws-${Date.now()}`;
  const name = result.folderPath.split('/').pop() ?? result.folderPath;
  workspaces = [...workspaces.filter(w => w.path !== result.folderPath), { id, name, path: result.folderPath }];
  await window.mid.patchAppState({ workspaces, activeWorkspace: id });
  treeCache.set(result.folderPath, result.tree);
  applyFolder(result.folderPath, result.tree);
}

async function switchWorkspace(ws: Workspace): Promise<void> {
  if (ws.path === currentFolder) return;
  await window.mid.patchAppState({ activeWorkspace: ws.id });
  const tree = await loadFolderTree(ws.path);
  applyFolder(ws.path, tree);
}

function removeWorkspace(folderPath: string): void {
  workspaces = workspaces.filter(w => w.path !== folderPath);
  void window.mid.patchAppState({ workspaces });
  flashStatus('Workspace removed from list');
}
// Hydrate the search-icon span (title-bar uses a custom layout, not data-icon hydration)
if (titlebarSearchIcon) titlebarSearchIcon.innerHTML = iconHTML('search', 'mid-icon--sm mid-icon--muted');

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey) {
    e.preventDefault();
    openSpotlight();
  }
});

// ===== Spotlight =====
function openSpotlight(): void {
  const dlg = document.getElementById('mid-spotlight') as HTMLDialogElement;
  const input = document.getElementById('mid-spotlight-input') as HTMLInputElement;
  const results = document.getElementById('mid-spotlight-results') as HTMLDivElement;
  const tabs = dlg.querySelectorAll<HTMLButtonElement>('.mid-spotlight-tab');
  let scope: 'workspace' | 'file' = 'workspace';
  let workspaceFiles: { path: string; name: string }[] = [];
  let renderTimer: number | null = null;

  const collectWorkspaceFiles = async (): Promise<void> => {
    if (!currentFolder) return;
    const tree = await window.mid.listFolderMd(currentFolder);
    workspaceFiles = [];
    const walk = (entries: TreeEntry[]): void => {
      for (const e of entries) {
        if (e.kind === 'file') workspaceFiles.push({ path: e.path, name: e.name });
        else if (e.children) walk(e.children);
      }
    };
    walk(tree);
  };

  const renderResults = (): void => {
    const q = input.value.trim().toLowerCase();
    results.replaceChildren();
    if (scope === 'workspace') {
      const matches = q
        ? workspaceFiles.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
        : workspaceFiles;
      for (const m of matches.slice(0, 50)) {
        const row = document.createElement('button');
        row.className = 'mid-spotlight-row';
        row.innerHTML = `${iconHTML('file', 'mid-icon--sm mid-icon--muted')}<span class="mid-spotlight-row-name">${escapeHTML(m.name)}</span><span class="mid-spotlight-row-path">${escapeHTML(m.path.replace(currentFolder ?? '', '').replace(/^\//, ''))}</span>`;
        row.addEventListener('click', () => {
          close();
          void openRecent(m.path);
        });
        results.appendChild(row);
      }
      if (matches.length === 0) results.innerHTML = '<div class="mid-spotlight-empty">No files match.</div>';
    } else {
      // current file: heading + content matches
      if (!currentText) { results.innerHTML = '<div class="mid-spotlight-empty">No active document.</div>'; return; }
      if (!q) { results.innerHTML = '<div class="mid-spotlight-empty">Type to search the active document.</div>'; return; }
      const lines = currentText.split('\n');
      const hits: { line: number; text: string; isHeading: boolean }[] = [];
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        if (text.toLowerCase().includes(q)) {
          hits.push({ line: i + 1, text: text.trim(), isHeading: /^#+\s/.test(text) });
          if (hits.length >= 100) break;
        }
      }
      for (const h of hits) {
        const row = document.createElement('button');
        row.className = 'mid-spotlight-row';
        row.innerHTML = `${iconHTML(h.isHeading ? 'list-ul' : 'file', 'mid-icon--sm mid-icon--muted')}<span class="mid-spotlight-row-name">${escapeHTML(h.text.slice(0, 80))}</span><span class="mid-spotlight-row-path">L${h.line}</span>`;
        row.addEventListener('click', () => {
          close();
          // No live scroll-to-line; flash status indicates target.
          flashStatus(`Match at line ${h.line}`);
        });
        results.appendChild(row);
      }
      if (hits.length === 0) results.innerHTML = '<div class="mid-spotlight-empty">No matches in this file.</div>';
    }
  };

  const onInput = (): void => {
    if (renderTimer !== null) window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderResults, 80);
  };
  const setScope = (s: 'workspace' | 'file'): void => {
    scope = s;
    tabs.forEach(t => t.classList.toggle('is-active', t.dataset.spotlightScope === s));
    renderResults();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  const onBackdrop = (e: MouseEvent): void => {
    if (e.target === dlg) close();
  };
  const close = (): void => {
    input.removeEventListener('input', onInput);
    document.removeEventListener('keydown', onKey);
    dlg.removeEventListener('click', onBackdrop);
    tabs.forEach(t => t.removeEventListener('click', onTab));
    if (dlg.open) dlg.close();
  };
  const onTab = (e: Event): void => setScope((e.currentTarget as HTMLButtonElement).dataset.spotlightScope as 'workspace' | 'file');

  input.value = '';
  input.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  dlg.addEventListener('click', onBackdrop);
  tabs.forEach(t => t.addEventListener('click', onTab));
  dlg.showModal();
  void collectWorkspaceFiles().then(renderResults);
  input.focus();
}
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
  const setupItem = { icon: 'github', label: 'Set up warehouse…', action: () => void openWarehouseOnboarding(true) };
  openContextMenu(connected ? [
    { icon: 'refresh', label: 'Sync (commit + pull + push)', action: () => void syncRepo() },
    { separator: true, label: '' },
    { icon: 'github', label: 'Connect to a different repo…', action: () => void promptConnectRepo() },
    setupItem,
  ] : [
    { icon: 'github', label: 'Connect repo…', action: () => void promptConnectRepo() },
    setupItem,
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
  modeFilesBtn?.classList.toggle('is-active', mode === 'files');
  modeNotesBtn?.classList.toggle('is-active', mode === 'notes');
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
  const dateSpan = document.createElement('span');
  dateSpan.textContent = new Date(note.updated).toLocaleDateString();
  meta.appendChild(dateSpan);
  if (note.warehouse) {
    const wh = warehouses.find(w => w.id === note.warehouse);
    const chip = document.createElement('span');
    chip.className = 'mid-note-tag mid-note-warehouse';
    chip.textContent = `↗ ${wh?.name ?? note.warehouse}`;
    meta.appendChild(chip);
  }
  const tagsContainer = document.createElement('div');
  tagsContainer.className = 'mid-note-tags';
  const renderTags = (): void => {
    tagsContainer.replaceChildren();
    for (const t of note.tags) {
      const chip = document.createElement('span');
      chip.className = 'mid-note-tag mid-note-tag-editable';
      chip.textContent = `#${t}`;
      const x = document.createElement('button');
      x.className = 'mid-note-tag-x';
      x.title = `Remove tag ${t}`;
      x.textContent = '×';
      x.addEventListener('click', async e => {
        e.stopPropagation();
        if (!currentFolder) return;
        const next = note.tags.filter(tag => tag !== t);
        const updated = await window.mid.notesTag(currentFolder, note.id, next);
        if (updated) Object.assign(note, updated);
        renderTags();
      });
      chip.appendChild(x);
      tagsContainer.appendChild(chip);
    }
    const addBtn = document.createElement('button');
    addBtn.className = 'mid-note-tag-add';
    addBtn.title = 'Add tag';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!currentFolder) return;
      const tag = await midPrompt('Add tag', 'Tag name (no spaces)', '');
      if (!tag) return;
      const cleaned = tag.trim().replace(/^#/, '').replace(/\s+/g, '-');
      if (!cleaned || note.tags.includes(cleaned)) return;
      const updated = await window.mid.notesTag(currentFolder, note.id, [...note.tags, cleaned]);
      if (updated) Object.assign(note, updated);
      renderTags();
    });
    tagsContainer.appendChild(addBtn);
  };
  renderTags();
  meta.appendChild(tagsContainer);
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

async function pushFilePath(filePath: string, name: string): Promise<void> {
  if (!currentFolder) return;
  const status = await window.mid.repoStatus(currentFolder);
  if (!status.initialized || !status.remote) {
    flashStatus('No GitHub repo connected — use the status bar');
    return;
  }
  const result = await window.mid.repoSync(currentFolder, `notes: ${name}`);
  if (result.ok) flashStatus(`Pushed "${name}"`);
  else flashStatus(`Push failed: ${result.error?.split('\n')[0] ?? 'unknown'}`);
  await refreshRepoStatus();
}

async function exportFile(filePath: string, format: ExportFormat): Promise<void> {
  const content = await window.mid.readFile(filePath);
  const baseName = (filePath.split('/').pop() ?? 'document').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_') || 'document';
  if (format === 'md' || format === 'txt') {
    const text = format === 'md' ? content : markdownToPlainText(content);
    const ext = format;
    const filterName = format === 'md' ? 'Markdown' : 'Plain text';
    await window.mid.saveAs(uniqueExportName(baseName, ext), text, [{ name: filterName, extensions: [ext] }]);
    flashStatus(`Exported ${format.toUpperCase()}`);
    return;
  }
  // Preview-dependent — temporarily swap currentText, render, capture, restore.
  const savedText = currentText;
  const savedPath = currentPath;
  const savedTitle = filenameEl.textContent ?? 'Untitled';
  const savedMode = currentMode;
  try {
    currentText = content;
    currentPath = filePath;
    filenameEl.textContent = filePath.split('/').pop() ?? 'Untitled';
    setMode('view');
    await new Promise(resolve => setTimeout(resolve, 120));
    await exportAs(format);
  } finally {
    currentText = savedText;
    currentPath = savedPath;
    filenameEl.textContent = savedTitle;
    setMode(savedMode);
  }
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
    await window.mid.saveAs(uniqueExportName(baseName, ext), text, [{ name: filterName, extensions: [ext] }]);
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
    // Click on the backdrop (outside the form) cancels.
    const onBackdropClick = (e: MouseEvent): void => {
      if (e.target === dlg) onCancel();
    };
    dlg.addEventListener('click', onBackdropClick);

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
    { icon: 'github', label: 'Share to Google Docs', action: () => void exportAs('docx-gdocs') },
    { icon: 'image', label: 'Export PNG', action: () => void exportAs('png') },
    { icon: 'list-ul', label: 'Export plain text', action: () => void exportAs('txt') },
  ], e.clientX, e.clientY);
});

hydrateIconButtons(document);
wireSettingsPanel();

// Outline rail (#252) — toggle wiring + keyboard shortcut.
statusOutline.addEventListener('click', () => toggleOutline());
outlineCloseBtn.addEventListener('click', () => setOutlineHidden(true));
window.addEventListener('keydown', e => {
  if (e.key === 'L' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    toggleOutline();
  }
});

/* ── Settings page (full-screen) ──────────────────────────────
 *
 * Replaces the right-sidebar drawer with a dedicated full-screen view —
 * left rail with categories, right pane with section cards built from
 * the row pattern (label + description + control).
 *
 * Visual patterns ported from the reference packages (rebuilt against
 * our existing --mid-* tokens — no external CSS vars):
 *   /Users/fadymondy/Sites/orchestra-agents/apps/components/settings
 *   /Users/fadymondy/Sites/orchestra-agents/apps/components/theme
 *
 * Persisted setting keys are unchanged: theme, fontFamily, fontSize,
 * previewMaxWidth, codeExportGradient. #232 / #234 are pure UI relocations.
 */
type SettingsCategoryId =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'notes'
  | 'github'
  | 'export'
  | 'advanced';

interface SettingsCategoryDef {
  id: SettingsCategoryId;
  label: string;
  icon: IconName;
}

const SETTINGS_CATEGORIES: SettingsCategoryDef[] = [
  { id: 'general',    label: 'General',    icon: 'cog' },
  { id: 'appearance', label: 'Appearance', icon: 'image' },
  { id: 'editor',     label: 'Editor',     icon: 'edit' },
  { id: 'notes',      label: 'Notes',      icon: 'bookmark' },
  { id: 'github',     label: 'GitHub',     icon: 'github' },
  { id: 'export',     label: 'Export',     icon: 'download' },
  { id: 'advanced',   label: 'Advanced',   icon: 'list-ul' },
];

const THEME_KIND_ORDER: Array<'light' | 'dark'> = ['light', 'dark'];

function resolveModeFromTheme(t: ThemeChoice): 'light' | 'dark' | 'system' {
  if (t === 'light') return 'light';
  if (t === 'dark') return 'dark';
  if (t === 'auto') return 'system';
  if (typeof t === 'string' && t.startsWith('theme:')) {
    const id = t.slice('theme:'.length);
    const def = THEMES.find(x => x.id === id);
    if (def) return def.kind === 'dark' ? 'dark' : 'light';
  }
  return 'system';
}

function modeChoiceToTheme(mode: 'light' | 'dark' | 'system'): ThemeChoice {
  return mode === 'system' ? 'auto' : mode;
}

function wireSettingsPanel(): void {
  const page = document.getElementById('settings-page') as HTMLElement;
  const openBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  const backBtn = document.getElementById('settings-back') as HTMLButtonElement;
  const navList = document.getElementById('settings-nav-list') as HTMLElement;
  const main = document.getElementById('settings-main') as HTMLElement;
  const crumbActive = document.getElementById('settings-crumb-active') as HTMLSpanElement;

  if (THEMES.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[mid] THEMES import returned empty — theme grid will be empty');
  }

  let activeCategory: SettingsCategoryId = 'general';
  /** Captured when the page opens so Back can restore the previously-open document. */
  let priorScrollTop = 0;

  const persist = (patch: Partial<typeof settings>): void => {
    Object.assign(settings, patch);
    applySettings();
    void window.mid.patchAppState(patch);
  };

  const renderNav = (): void => {
    navList.replaceChildren();
    for (const cat of SETTINGS_CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mid-settings-nav__item' + (cat.id === activeCategory ? ' is-active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(cat.id === activeCategory));
      btn.dataset.cat = cat.id;
      btn.innerHTML = `<span class="mid-settings-nav__icon">${iconHTML(cat.icon)}</span><span>${cat.label}</span>`;
      btn.addEventListener('click', () => selectCategory(cat.id));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const idx = SETTINGS_CATEGORIES.findIndex(c => c.id === activeCategory);
          const next = e.key === 'ArrowDown'
            ? (idx + 1) % SETTINGS_CATEGORIES.length
            : (idx - 1 + SETTINGS_CATEGORIES.length) % SETTINGS_CATEGORIES.length;
          selectCategory(SETTINGS_CATEGORIES[next].id);
          (navList.querySelector(`[data-cat="${SETTINGS_CATEGORIES[next].id}"]`) as HTMLButtonElement | null)?.focus();
        }
      });
      navList.appendChild(btn);
    }
  };

  const selectCategory = (id: SettingsCategoryId): void => {
    activeCategory = id;
    const cat = SETTINGS_CATEGORIES.find(c => c.id === id);
    crumbActive.textContent = cat?.label ?? '';
    navList.querySelectorAll<HTMLButtonElement>('.mid-settings-nav__item').forEach(b => {
      const on = b.dataset.cat === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    renderMain();
    main.scrollTop = 0;
  };

  const renderMain = (): void => {
    main.replaceChildren();
    switch (activeCategory) {
      case 'general':    renderGeneralSection(main, persist, () => { renderMain(); }); break;
      case 'appearance': renderAppearanceSection(main, persist); break;
      case 'editor':     renderEditorSection(main); break;
      case 'notes':      renderNotesSection(main); break;
      case 'github':     renderGitHubSection(main); break;
      case 'export':     renderExportSection(main, persist); break;
      case 'advanced':   renderAdvancedSection(main); break;
    }
    hydrateIconButtons(main);
  };

  const open = (): void => {
    if (!page.hidden) return;
    priorScrollTop = root.scrollTop;
    page.hidden = false;
    document.body.classList.add('settings-open');
    renderNav();
    renderMain();
    requestAnimationFrame(() => main.focus());
  };
  const close = (): void => {
    if (page.hidden) return;
    page.hidden = true;
    document.body.classList.remove('settings-open');
    requestAnimationFrame(() => { root.scrollTop = priorScrollTop; });
  };

  openBtn.addEventListener('click', () => (page.hidden ? open() : close()));
  backBtn.addEventListener('click', close);

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      page.hidden ? open() : close();
    } else if (e.key === 'Escape' && !page.hidden) {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) {
        ae.blur();
      }
      close();
    }
  });
}

/* ── Section building blocks ────────────────────────────────── */

function makeGroup(title: string, description?: string): { card: HTMLElement; body: HTMLElement } {
  const card = document.createElement('section');
  card.className = 'mid-settings-group';
  const header = document.createElement('header');
  header.className = 'mid-settings-group__header';
  const titleEl = document.createElement('h3');
  titleEl.className = 'mid-settings-group__title';
  titleEl.textContent = title;
  header.appendChild(titleEl);
  if (description) {
    const desc = document.createElement('p');
    desc.className = 'mid-settings-group__description';
    desc.textContent = description;
    header.appendChild(desc);
  }
  const body = document.createElement('div');
  body.className = 'mid-settings-group__body';
  card.append(header, body);
  return { card, body };
}

interface RowOpts {
  label: string;
  description?: string;
  /** When true, control sits on the same row as the label (toggle-style); default false (stacked). */
  inline?: boolean;
}

function makeRow(opts: RowOpts, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mid-setting-row' + (opts.inline ? ' mid-setting-row--inline' : '');
  const text = document.createElement('div');
  text.className = 'mid-setting-row__text';
  const label = document.createElement('div');
  label.className = 'mid-setting-row__label';
  label.textContent = opts.label;
  text.appendChild(label);
  if (opts.description) {
    const desc = document.createElement('p');
    desc.className = 'mid-setting-row__description';
    desc.textContent = opts.description;
    text.appendChild(desc);
  }
  const controlWrap = document.createElement('div');
  controlWrap.className = 'mid-setting-row__control';
  controlWrap.appendChild(control);
  row.append(text, controlWrap);
  return row;
}

/* ── General ──────────────────────────────────────────────── */
function renderGeneralSection(
  main: HTMLElement,
  _persist: (p: Partial<typeof settings>) => void,
  rerender: () => void,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'mid-settings-form';
  const intro = makeGroup('General', 'Common workspace preferences. Reset to defaults if anything feels off.');
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'mid-btn';
  resetBtn.textContent = 'Reset to defaults';
  resetBtn.addEventListener('click', () => {
    Object.assign(settings, DEFAULT_SETTINGS);
    applySettings();
    void window.mid.patchAppState({ ...DEFAULT_SETTINGS });
    rerender();
  });
  intro.body.appendChild(makeRow(
    { label: 'Reset all settings', description: 'Restore defaults for theme, fonts, preview width, and code-export gradient.', inline: true },
    resetBtn,
  ));
  wrap.appendChild(intro.card);
  main.appendChild(wrap);
}

/* ── Appearance: theme picker + typography ─────────────────── */
function renderAppearanceSection(main: HTMLElement, persist: (p: Partial<typeof settings>) => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'mid-settings-form';

  // Group 1 — Mode toggle (light / dark / system)
  const modeGroup = makeGroup('Mode', 'Switch between light, dark, or follow the operating system.');
  const modePills = document.createElement('div');
  modePills.className = 'mid-mode-pills';
  const currentMode = resolveModeFromTheme(settings.theme);
  for (const m of ['light', 'dark', 'system'] as const) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'mid-mode-pill' + (currentMode === m ? ' is-active' : '');
    pill.dataset.mode = m;
    pill.innerHTML = `<span class="mid-mode-pill__icon">${iconHTML(m === 'light' ? 'show' : m === 'dark' ? 'image' : 'cog')}</span><span>${m === 'system' ? 'System' : m === 'light' ? 'Light' : 'Dark'}</span>`;
    pill.addEventListener('click', () => {
      persist({ theme: modeChoiceToTheme(m) });
      modePills.querySelectorAll<HTMLButtonElement>('.mid-mode-pill').forEach(p => p.classList.toggle('is-active', p.dataset.mode === m));
      // Switching mode releases any named-theme selection.
      wrap.querySelectorAll<HTMLButtonElement>('.mid-theme-card').forEach(c => {
        c.classList.remove('is-active');
        c.setAttribute('aria-pressed', 'false');
        const tt = THEMES.find(x => x.id === c.dataset.themeId);
        if (tt) c.style.borderColor = tt.palette.border;
      });
    });
    modePills.appendChild(pill);
  }
  modeGroup.body.appendChild(modePills);
  wrap.appendChild(modeGroup.card);

  // Group 2 — Color theme grid (all named themes)
  const themeGroup = makeGroup('Color theme', `Pick from ${THEMES.length} curated themes. Selecting one applies it instantly.`);
  for (const kind of THEME_KIND_ORDER) {
    const themesInKind = THEMES.filter(t => t.kind === kind);
    if (themesInKind.length === 0) continue;
    const groupLabel = document.createElement('h4');
    groupLabel.className = 'mid-theme-grid__group-label';
    groupLabel.textContent = `${kind === 'light' ? 'Light' : 'Dark'} themes`;
    themeGroup.body.appendChild(groupLabel);
    const grid = document.createElement('div');
    grid.className = 'mid-theme-grid';
    for (const theme of themesInKind) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mid-theme-card';
      const isActive = settings.theme === `theme:${theme.id}`;
      if (isActive) card.classList.add('is-active');
      card.dataset.themeId = theme.id;
      card.setAttribute('aria-pressed', String(isActive));
      card.title = theme.label;
      card.style.background = theme.palette.bg;
      card.style.color = theme.palette.fg;
      card.style.borderColor = isActive ? 'var(--mid-accent)' : theme.palette.border;
      const preview = document.createElement('div');
      preview.className = 'mid-theme-card__preview';
      preview.innerHTML = `
        <span class="mid-theme-card__bar" style="background:${theme.palette.fgMuted}; width:48%"></span>
        <span class="mid-theme-card__bar" style="background:${theme.palette.accent}; width:24%"></span>
        <span class="mid-theme-card__bar" style="background:${theme.palette.codeBg}; width:64%"></span>
        <span class="mid-theme-card__bar" style="background:${theme.palette.fgMuted}; width:32%"></span>
      `;
      const meta = document.createElement('div');
      meta.className = 'mid-theme-card__meta';
      const name = document.createElement('span');
      name.className = 'mid-theme-card__name';
      name.textContent = theme.label;
      meta.appendChild(name);
      const tag = document.createElement('span');
      tag.className = 'mid-theme-card__tag';
      tag.style.background = theme.palette.accent;
      tag.style.color = theme.palette.bg;
      tag.textContent = theme.kind === 'light' ? 'Light' : 'Dark';
      meta.appendChild(tag);
      card.append(preview, meta);
      card.addEventListener('click', () => {
        persist({ theme: `theme:${theme.id}` });
        themeGroup.body.querySelectorAll<HTMLButtonElement>('.mid-theme-card').forEach(c => {
          const on = c.dataset.themeId === theme.id;
          c.classList.toggle('is-active', on);
          c.setAttribute('aria-pressed', String(on));
          const t2 = THEMES.find(tt => tt.id === c.dataset.themeId);
          if (t2) c.style.borderColor = on ? 'var(--mid-accent)' : t2.palette.border;
        });
        const newMode = resolveModeFromTheme(`theme:${theme.id}` as ThemeChoice);
        modePills.querySelectorAll<HTMLButtonElement>('.mid-mode-pill').forEach(p => p.classList.toggle('is-active', p.dataset.mode === newMode));
      });
      grid.appendChild(card);
    }
    themeGroup.body.appendChild(grid);
  }
  wrap.appendChild(themeGroup.card);

  // Group 3 — Typography
  const typoGroup = makeGroup('Typography', 'Reading font and size for the preview pane.');
  const fontSel = document.createElement('select');
  fontSel.className = 'mid-settings-control';
  for (const [v, l] of [
    ['system', 'System'],
    ['sans', 'Sans-serif (Inter-style)'],
    ['serif', 'Serif (Georgia)'],
    ['mono', 'Monospace'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = l;
    fontSel.appendChild(opt);
  }
  fontSel.value = settings.fontFamily;
  fontSel.addEventListener('change', () => persist({ fontFamily: fontSel.value as FontFamilyChoice }));
  typoGroup.body.appendChild(makeRow(
    { label: 'Font family', description: 'Used for body text in the preview.' },
    fontSel,
  ));
  const sizeBox = document.createElement('div');
  sizeBox.className = 'mid-range-row';
  const sizeRange = document.createElement('input');
  sizeRange.type = 'range';
  sizeRange.min = '12';
  sizeRange.max = '22';
  sizeRange.step = '1';
  sizeRange.value = String(settings.fontSize);
  sizeRange.className = 'mid-settings-control';
  const sizeOut = document.createElement('span');
  sizeOut.className = 'mid-range-row__value';
  sizeOut.textContent = `${settings.fontSize}px`;
  sizeRange.addEventListener('input', () => {
    const n = Number(sizeRange.value);
    sizeOut.textContent = `${n}px`;
    persist({ fontSize: n });
  });
  sizeBox.append(sizeRange, sizeOut);
  typoGroup.body.appendChild(makeRow(
    { label: 'Body font size', description: 'Larger sizes are easier on the eyes for long-form reading.' },
    sizeBox,
  ));
  const widthBox = document.createElement('div');
  widthBox.className = 'mid-range-row';
  const widthRange = document.createElement('input');
  widthRange.type = 'range';
  widthRange.min = '600';
  widthRange.max = '1400';
  widthRange.step = '20';
  widthRange.value = String(settings.previewMaxWidth);
  widthRange.className = 'mid-settings-control';
  const widthOut = document.createElement('span');
  widthOut.className = 'mid-range-row__value';
  widthOut.textContent = `${settings.previewMaxWidth}px`;
  widthRange.addEventListener('input', () => {
    const n = Number(widthRange.value);
    widthOut.textContent = `${n}px`;
    persist({ previewMaxWidth: n });
  });
  widthBox.append(widthRange, widthOut);
  typoGroup.body.appendChild(makeRow(
    { label: 'Preview max-width', description: 'Cap the column width of the rendered markdown.' },
    widthBox,
  ));
  wrap.appendChild(typoGroup.card);

  main.appendChild(wrap);
}

/* ── Editor ─────────────────────────────────────────────── */
function renderEditorSection(main: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'mid-settings-form';
  const grp = makeGroup('Editor', 'Editing behavior in the split and edit panes.');
  const note = document.createElement('p');
  note.className = 'mid-settings-empty';
  note.textContent = 'Editor preferences will land here as they ship. The current build uses sensible defaults: autosave on file open, soft wrap, and system tab width.';
  grp.body.appendChild(note);
  wrap.appendChild(grp.card);
  main.appendChild(wrap);
}

/* ── Notes ─────────────────────────────────────────────── */
function renderNotesSection(main: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'mid-settings-form';
  const grp = makeGroup('Notes', 'Workspace-scoped notes and tag behavior.');
  const note = document.createElement('p');
  note.className = 'mid-settings-empty';
  note.textContent = 'Notes are managed inline from the activity bar. Defaults for auto-tag, default folder, and push behavior will surface here as they ship.';
  grp.body.appendChild(note);
  wrap.appendChild(grp.card);
  main.appendChild(wrap);
}

/* ── GitHub ────────────────────────────────────────────── */
function renderGitHubSection(main: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'mid-settings-form';
  const grp = makeGroup('GitHub', 'Connection status for the gh CLI integration.');
  const status = document.createElement('p');
  status.className = 'mid-settings-empty';
  status.textContent = 'Checking gh authentication…';
  grp.body.appendChild(status);
  wrap.appendChild(grp.card);
  main.appendChild(wrap);
  void window.mid.ghAuthStatus().then((r) => {
    status.textContent = r.authenticated
      ? 'Signed in via gh CLI. Repo connection and sync are managed from the status bar.'
      : 'Not signed in. Use the status bar repo button to start a device-flow login.';
  }).catch(() => {
    status.textContent = 'gh CLI not detected. Install GitHub CLI to enable repo sync.';
  });
}

/* ── Export ────────────────────────────────────────────── */
function renderExportSection(main: HTMLElement, persist: (p: Partial<typeof settings>) => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'mid-settings-form';
  const grp = makeGroup('Export', 'Defaults for the PNG / PDF export pipeline.');
  const codeBgSel = document.createElement('select');
  codeBgSel.className = 'mid-settings-control';
  for (const [v, l] of [
    ['none', 'None'],
    ['sunset', 'Sunset'],
    ['ocean', 'Ocean'],
    ['lavender', 'Lavender'],
    ['forest', 'Forest'],
    ['slate', 'Slate'],
    ['midnight', 'Midnight'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = l;
    codeBgSel.appendChild(opt);
  }
  codeBgSel.value = settings.codeExportGradient;
  codeBgSel.addEventListener('change', () => persist({ codeExportGradient: codeBgSel.value as CodeExportGradient }));
  grp.body.appendChild(makeRow(
    { label: 'Code export background', description: 'Backdrop gradient used when exporting a code block as PNG.' },
    codeBgSel,
  ));
  wrap.appendChild(grp.card);
  main.appendChild(wrap);
}

/* ── Advanced ─────────────────────────────────────────── */
function renderAdvancedSection(main: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'mid-settings-form';
  const grp = makeGroup('Advanced', 'Diagnostics for power users.');
  const info = document.createElement('div');
  info.className = 'mid-kv-block';
  info.textContent = 'Loading app info…';
  grp.body.appendChild(info);
  wrap.appendChild(grp.card);
  main.appendChild(wrap);
  void window.mid.getAppInfo().then(i => {
    info.innerHTML = `
      <div class="mid-kv-row"><span>Version</span><code>${escapeHTML(i.version)}</code></div>
      <div class="mid-kv-row"><span>Platform</span><code>${escapeHTML(i.platform)}</code></div>
      <div class="mid-kv-row"><span>User data</span><code>${escapeHTML(i.userData)}</code></div>
      <div class="mid-kv-row"><span>Documents</span><code>${escapeHTML(i.documents)}</code></div>
    `;
  }).catch(() => { info.textContent = 'Unable to read app info.'; });
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
  if (state.codeExportGradient && state.codeExportGradient in CODE_EXPORT_GRADIENTS) {
    settings.codeExportGradient = state.codeExportGradient as CodeExportGradient;
  }
  if (Array.isArray(state.pinnedFolders)) {
    pinnedFolders = state.pinnedFolders;
    renderActivityPinned();
  }
  if (Array.isArray(state.workspaces)) {
    workspaces = state.workspaces;
  }
  if (typeof state.outlineHidden === 'boolean') {
    outlineHidden = state.outlineHidden;
  }
  applyOutlineVisibility();
  // Auto-register the lastFolder as a workspace if it's not in the list yet.
  if (state.lastFolder && !workspaces.find(w => w.path === state.lastFolder)) {
    const name = state.lastFolder.split('/').pop() ?? state.lastFolder;
    workspaces = [...workspaces, { id: `ws-${Date.now()}`, name, path: state.lastFolder }];
    void window.mid.patchAppState({ workspaces });
  }
  applySettings();
  // Fade out the launch loader once initial state is hydrated.
  document.getElementById('mid-loader')?.classList.add('is-fading');
  setTimeout(() => document.getElementById('mid-loader')?.remove(), 500);
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
