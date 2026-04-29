import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';

interface Mid {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<boolean>;
  openFileDialog(): Promise<{ filePath: string; content: string } | null>;
  saveFileDialog(defaultName: string, content: string): Promise<string | null>;
  getAppInfo(): Promise<{ version: string; platform: string; isDark: boolean; userData: string; documents: string }>;
  openExternal(url: string): Promise<void>;
  onThemeChanged(cb: (isDark: boolean) => void): () => void;
  onMenuOpen(cb: () => void): () => void;
  onMenuSave(cb: () => void): () => void;
}
declare const window: Window & { mid: Mid };

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }) as Parameters<typeof marked.use>[0],
);
marked.setOptions({ gfm: true });

const root = document.getElementById('root') as HTMLElement;
const filenameEl = document.getElementById('filename') as HTMLSpanElement;
const btnView = document.getElementById('mode-view') as HTMLButtonElement;
const btnEdit = document.getElementById('mode-edit') as HTMLButtonElement;
const btnOpen = document.getElementById('open-btn') as HTMLButtonElement;
const btnSave = document.getElementById('save-btn') as HTMLButtonElement;

let currentText = '';
let currentPath: string | null = null;
let currentMode: 'view' | 'edit' = 'view';
let mermaidThemeKind = 0;

function applyTheme(isDark: boolean): void {
  document.documentElement.classList.toggle('dark', isDark);
  initMermaid(isDark ? 2 : 1);
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
  const mermaidBlocks: string[] = [];
  const withMermaid = md.replace(/```mermaid\s*\n([\s\S]*?)\n```/g, (_m, code) => {
    const i = mermaidBlocks.push(code) - 1;
    return `<div class="mermaid" data-mermaid-index="${i}"></div>`;
  });
  const html = marked.parse(withMermaid, { async: false }) as string;
  const safe = DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-mermaid-index'],
  });
  const container = document.createElement('div');
  container.innerHTML = safe;
  container.querySelectorAll<HTMLDivElement>('.mermaid[data-mermaid-index]').forEach(el => {
    const idx = Number(el.dataset.mermaidIndex);
    if (!Number.isNaN(idx) && mermaidBlocks[idx]) {
      el.textContent = mermaidBlocks[idx];
      delete el.dataset.mermaidIndex;
    }
  });
  return container.innerHTML;
}

function renderView(): void {
  root.classList.remove('editing');
  root.classList.add('viewing');
  if (!currentText) {
    root.innerHTML = `<div class="empty-state"><h1>Mark It Down</h1><p>Open a markdown file with <kbd>Cmd/Ctrl+O</kbd> to begin.</p></div>`;
    return;
  }
  root.innerHTML = renderMarkdown(currentText);
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    if (href.startsWith('http://') || href.startsWith('https://')) {
      a.addEventListener('click', e => {
        e.preventDefault();
        void window.mid.openExternal(href);
      });
    }
  });
  root.querySelectorAll<HTMLDivElement>('.mermaid').forEach((el, i) => {
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

function renderEdit(): void {
  root.classList.remove('viewing');
  root.classList.add('editing');
  const ta = document.createElement('textarea');
  ta.value = currentText;
  ta.spellcheck = false;
  ta.addEventListener('input', () => {
    currentText = ta.value;
  });
  root.replaceChildren(ta);
  ta.focus();
}

function setMode(mode: 'view' | 'edit'): void {
  currentMode = mode;
  btnView.classList.toggle('active', mode === 'view');
  btnEdit.classList.toggle('active', mode === 'edit');
  if (mode === 'view') renderView();
  else renderEdit();
}

async function openFile(): Promise<void> {
  const result = await window.mid.openFileDialog();
  if (!result) return;
  currentText = result.content;
  currentPath = result.filePath;
  filenameEl.textContent = currentPath.split('/').pop() ?? 'Untitled';
  setMode('view');
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
btnEdit.addEventListener('click', () => setMode('edit'));
btnOpen.addEventListener('click', () => void openFile());
btnSave.addEventListener('click', () => void saveFile());

window.mid.onThemeChanged(applyTheme);
window.mid.onMenuOpen(() => void openFile());
window.mid.onMenuSave(() => void saveFile());

void window.mid.getAppInfo().then(info => applyTheme(info.isDark));
