import { renderMarkdown as coreRenderMarkdown, applyMermaidPlaceholders } from '../../../packages/core/src/markdown/renderer';
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/common';
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

interface Mid {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<boolean>;
  openFileDialog(): Promise<{ filePath: string; content: string } | null>;
  openFolderDialog(): Promise<{ folderPath: string; tree: TreeEntry[] } | null>;
  listFolderMd(folderPath: string): Promise<TreeEntry[]>;
  readAppState(): Promise<AppState>;
  patchAppState(patch: Partial<AppState>): Promise<void>;
  saveFileDialog(defaultName: string, content: string): Promise<string | null>;
  getAppInfo(): Promise<{ version: string; platform: string; isDark: boolean; userData: string; documents: string }>;
  openExternal(url: string): Promise<void>;
  onThemeChanged(cb: (isDark: boolean) => void): () => void;
  onMenuOpen(cb: () => void): () => void;
  onMenuOpenFolder(cb: () => void): () => void;
  onMenuSave(cb: () => void): () => void;
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

let currentText = '';
let currentPath: string | null = null;
let currentMode: Mode = 'split';
let mermaidThemeKind = 0;
let currentFolder: string | null = null;
let splitRatio = 0.5;
let renderTimer: number | null = null;
let osIsDark = false;
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

function renderMarkdown(md: string): string {
  const { html, mermaidBlocks } = coreRenderMarkdown(md);
  const container = document.createElement('div');
  container.innerHTML = html;
  applyMermaidPlaceholders(container, mermaidBlocks);
  return container.innerHTML;
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
  attachCodeCopyButtons(preview);
  attachHeadingAnchors(preview);
  attachImageLightbox(preview);
  preview.querySelectorAll<HTMLDivElement>('.mermaid').forEach((el, i) => {
    const id = `mermaid-${Date.now()}-${i}`;
    const code = (el.textContent ?? '').trim();
    el.removeAttribute('data-processed');
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        el.innerHTML = svg;
      })
      .catch(err => {
        el.innerHTML = `<pre style="color: #d04444">Mermaid error: ${String((err as Error)?.message ?? err)}</pre>`;
      });
  });
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

function attachCodeCopyButtons(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLPreElement>('pre').forEach(pre => {
    if (pre.querySelector('.mid-copy-btn')) return;
    if (pre.classList.contains('mermaid')) return;
    pre.classList.add('has-copy');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mid-copy-btn';
    btn.title = 'Copy';
    btn.innerHTML = `${iconHTML('copy', 'mid-icon--sm')}<span class="mid-copy-btn-label">Copy</span>`;
    const setLabel = (text: string): void => {
      const label = btn.querySelector('.mid-copy-btn-label');
      if (label) label.textContent = text;
    };
    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.innerText ?? pre.innerText;
      try {
        await navigator.clipboard.writeText(code);
        setLabel('Copied');
        setTimeout(() => setLabel('Copy'), 1200);
      } catch {
        setLabel('Failed');
        setTimeout(() => setLabel('Copy'), 1200);
      }
    });
    pre.appendChild(btn);
  });
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

window.mid.onThemeChanged(applyTheme);
window.mid.onMenuOpen(() => void openFile());
window.mid.onMenuOpenFolder(() => void openFolder());
window.mid.onMenuSave(() => void saveFile());

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
