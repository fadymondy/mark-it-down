// Mark It Down — webview runtime.
// Bundled by esbuild → out/webview/main.js
//
// Dependencies (bundled):
//   marked         — Markdown → HTML
//   marked-highlight — code block highlight integration
//   highlight.js   — language detection + tokenization
//   mermaid        — live diagram rendering
//   dompurify      — sanitize HTML before injecting

import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';

interface VSCodeApi {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
}

declare function acquireVsCodeApi(): VSCodeApi;
const vscode = acquireVsCodeApi();

type Mode = 'view' | 'edit';

interface UpdateMessage {
  type: 'update';
  text: string;
  mode: Mode;
  themeKind: number;
}

const root = document.getElementById('root') as HTMLElement;
const btnView = document.getElementById('mode-view') as HTMLButtonElement;
const btnEdit = document.getElementById('mode-edit') as HTMLButtonElement;
const fname = document.getElementById('filename') as HTMLSpanElement;

let currentText = '';
let currentMode: Mode = 'view';
let mermaidInitialized = false;

function initMermaid(themeKind: number) {
  // 1=Light, 2=Dark, 3=HighContrastDark, 4=HighContrastLight
  const isDark = themeKind === 2 || themeKind === 3;
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'strict',
    fontFamily: 'inherit',
  });
  mermaidInitialized = true;
}

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
);
marked.setOptions({ gfm: true, breaks: false });

function renderMarkdown(md: string): string {
  // Pre-process mermaid blocks: replace ```mermaid <code> ``` with a placeholder div
  const mermaidBlocks: string[] = [];
  const withMermaidPlaceholders = md.replace(
    /```mermaid\s*\n([\s\S]*?)\n```/g,
    (_, code) => {
      const idx = mermaidBlocks.push(code) - 1;
      return `<div class="mermaid" data-mermaid-index="${idx}"></div>`;
    },
  );

  const rawHtml = marked.parse(withMermaidPlaceholders, { async: false }) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['mermaid'],
    ADD_ATTR: ['data-mermaid-index', 'class', 'target'],
  });

  // Re-inject the original mermaid source into the placeholders (post-sanitize)
  const container = document.createElement('div');
  container.innerHTML = safeHtml;
  container.querySelectorAll<HTMLDivElement>('.mermaid[data-mermaid-index]').forEach(el => {
    const idx = Number(el.dataset.mermaidIndex);
    if (!isNaN(idx) && mermaidBlocks[idx]) {
      el.textContent = mermaidBlocks[idx];
      delete el.dataset.mermaidIndex;
    }
  });
  return container.innerHTML;
}

function attachCodeActions() {
  root.querySelectorAll<HTMLPreElement>('main.viewing pre').forEach(pre => {
    if (pre.querySelector('.code-actions')) return;
    const wrap = document.createElement('div');
    wrap.className = 'code-actions';
    const code = pre.querySelector('code')?.textContent ?? '';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: code }));
    wrap.appendChild(copyBtn);
    pre.appendChild(wrap);
  });
}

function renderMermaidDiagrams() {
  const targets = root.querySelectorAll<HTMLDivElement>('.mermaid');
  if (targets.length === 0) return;
  if (!mermaidInitialized) initMermaid(1);
  targets.forEach((el, i) => {
    const id = `mermaid-${Date.now()}-${i}`;
    const code = el.textContent ?? '';
    el.removeAttribute('data-processed');
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        el.innerHTML = svg;
      })
      .catch(err => {
        el.innerHTML = `<pre style="color: var(--vscode-errorForeground)">Mermaid error: ${String(
          (err as Error)?.message ?? err,
        )}</pre>`;
      });
  });
}

function renderView() {
  root.classList.remove('editing');
  root.classList.add('viewing');
  root.innerHTML = renderMarkdown(currentText);
  attachCodeActions();
  renderMermaidDiagrams();

  // Intercept link clicks → open in OS browser
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    if (href.startsWith('http://') || href.startsWith('https://')) {
      a.addEventListener('click', e => {
        e.preventDefault();
        vscode.postMessage({ type: 'openExternal', url: href });
      });
    }
  });
}

function renderEdit() {
  root.classList.remove('viewing');
  root.classList.add('editing');
  const ta = document.createElement('textarea');
  ta.className = 'editor';
  ta.value = currentText;
  ta.spellcheck = false;
  ta.addEventListener('input', () => {
    vscode.postMessage({ type: 'edit', text: ta.value });
  });
  root.replaceChildren(ta);
  ta.focus();
}

function setMode(mode: Mode, push = true) {
  currentMode = mode;
  btnView.classList.toggle('active', mode === 'view');
  btnEdit.classList.toggle('active', mode === 'edit');
  if (push) vscode.postMessage({ type: 'setMode', mode });
  if (mode === 'view') renderView();
  else renderEdit();
}

btnView.addEventListener('click', () => setMode('view'));
btnEdit.addEventListener('click', () => setMode('edit'));

window.addEventListener('message', evt => {
  const msg = evt.data as UpdateMessage;
  if (msg?.type !== 'update') return;
  initMermaid(msg.themeKind);
  currentText = msg.text;
  // Re-render whichever mode is active
  if (msg.mode !== currentMode) {
    setMode(msg.mode, false);
  } else if (currentMode === 'view') {
    renderView();
  } else {
    // In edit mode the textarea already shows the user's typing — only refresh
    // if the document text drifted (e.g. external save/format)
    const ta = root.querySelector('textarea') as HTMLTextAreaElement | null;
    if (ta && ta.value !== currentText) {
      const wasFocused = document.activeElement === ta;
      const sel = wasFocused ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
      ta.value = currentText;
      if (sel && wasFocused) {
        ta.setSelectionRange(sel.start, sel.end);
      }
    }
  }
});

// Tell the host we're ready
vscode.postMessage({ type: 'ready' });

// Set filename hint from URL (the URI fragment includes the path)
fname.textContent = (location.hash || '').replace(/^#/, '') || 'markdown';
