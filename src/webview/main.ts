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
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

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
let editorView: EditorView | null = null;
let lastThemeKind = 1;
let suppressEditorChange = false;

let mermaidThemeKind = 0;

function initMermaid(themeKind: number) {
  // 1=Light, 2=Dark, 3=HighContrastDark, 4=HighContrastLight
  if (mermaidThemeKind === themeKind && mermaidInitialized) return;
  const isDark = themeKind === 2 || themeKind === 3;
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'strict',
    fontFamily: 'inherit',
  });
  mermaidInitialized = true;
  mermaidThemeKind = themeKind;
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
  if (!mermaidInitialized) initMermaid(lastThemeKind || 1);
  targets.forEach((el, i) => {
    const id = `mermaid-${Date.now()}-${i}`;
    const code = (el.dataset.mermaidSource ?? el.textContent ?? '').trim();
    el.dataset.mermaidSource = code;
    el.removeAttribute('data-processed');
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        renderMermaidSuccess(el, svg, code);
      })
      .catch(err => {
        renderMermaidError(el, err, code);
      });
  });
}

function renderMermaidSuccess(host: HTMLDivElement, svg: string, source: string): void {
  host.innerHTML = '';
  host.classList.remove('mermaid-error');
  host.classList.add('mermaid-rendered');

  const stage = document.createElement('div');
  stage.className = 'mermaid-stage';

  const transform = { scale: 1, x: 0, y: 0 };
  const apply = () => {
    stage.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  };

  stage.innerHTML = svg;
  host.appendChild(stage);

  const controls = document.createElement('div');
  controls.className = 'mermaid-controls';
  controls.innerHTML = `
    <button data-action="zoom-out" title="Zoom out">−</button>
    <button data-action="reset" title="Reset (1×)">1×</button>
    <button data-action="zoom-in" title="Zoom in">+</button>
    <button data-action="copy" title="Copy source">Copy</button>
  `;
  host.appendChild(controls);

  controls.addEventListener('click', evt => {
    const action = (evt.target as HTMLElement).dataset.action;
    if (!action) return;
    if (action === 'zoom-in') transform.scale = Math.min(transform.scale * 1.25, 6);
    else if (action === 'zoom-out') transform.scale = Math.max(transform.scale / 1.25, 0.2);
    else if (action === 'reset') {
      transform.scale = 1;
      transform.x = 0;
      transform.y = 0;
    } else if (action === 'copy') {
      vscode.postMessage({ type: 'copy', text: source });
      return;
    }
    apply();
  });

  host.addEventListener('wheel', evt => {
    if (!evt.ctrlKey && !evt.metaKey) return;
    evt.preventDefault();
    const factor = evt.deltaY < 0 ? 1.1 : 1 / 1.1;
    transform.scale = Math.min(6, Math.max(0.2, transform.scale * factor));
    apply();
  }, { passive: false });

  let dragging: { startX: number; startY: number; baseX: number; baseY: number } | null = null;
  stage.addEventListener('pointerdown', evt => {
    if (evt.button !== 0) return;
    dragging = {
      startX: evt.clientX,
      startY: evt.clientY,
      baseX: transform.x,
      baseY: transform.y,
    };
    stage.setPointerCapture(evt.pointerId);
    stage.classList.add('mermaid-grabbing');
  });
  stage.addEventListener('pointermove', evt => {
    if (!dragging) return;
    transform.x = dragging.baseX + (evt.clientX - dragging.startX);
    transform.y = dragging.baseY + (evt.clientY - dragging.startY);
    apply();
  });
  const endDrag = (evt: PointerEvent) => {
    if (!dragging) return;
    dragging = null;
    stage.classList.remove('mermaid-grabbing');
    stage.releasePointerCapture(evt.pointerId);
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
}

function renderMermaidError(host: HTMLDivElement, err: unknown, source: string): void {
  host.innerHTML = '';
  host.classList.remove('mermaid-rendered');
  host.classList.add('mermaid-error');
  const message = (err instanceof Error ? err.message : String(err)).split('\n')[0];

  const wrap = document.createElement('div');
  wrap.className = 'mermaid-error-body';
  wrap.innerHTML = `
    <div class="mermaid-error-title">Mermaid render failed</div>
    <div class="mermaid-error-message"></div>
    <details><summary>Diagram source</summary><pre></pre></details>
  `;
  (wrap.querySelector('.mermaid-error-message') as HTMLElement).textContent = message;
  (wrap.querySelector('pre') as HTMLPreElement).textContent = source;
  host.appendChild(wrap);
}

function rerenderMermaidForTheme(): void {
  const targets = root.querySelectorAll<HTMLDivElement>('.mermaid[data-mermaid-source]');
  targets.forEach(el => {
    el.classList.remove('mermaid-rendered', 'mermaid-error');
    el.innerHTML = '';
  });
  renderMermaidDiagrams();
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

function buildEditorState(text: string, themeKind: number): EditorState {
  const isDark = themeKind === 2 || themeKind === 3;
  const updateListener = EditorView.updateListener.of(update => {
    if (suppressEditorChange) return;
    if (update.docChanged) {
      vscode.postMessage({ type: 'edit', text: update.state.doc.toString() });
    }
  });
  const extensions = [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    history(),
    indentOnInput(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({ base: markdownLanguage, codeLanguages: [] }),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    updateListener,
    EditorView.theme({
      '&': {
        height: '100%',
        fontSize: 'var(--vscode-editor-font-size, 13px)',
        backgroundColor: 'var(--vscode-editor-background, transparent)',
        color: 'var(--vscode-editor-foreground)',
      },
      '.cm-content': {
        fontFamily: 'var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
        caretColor: 'var(--vscode-editorCursor-foreground)',
        padding: '14px 0',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--vscode-editorGutter-background, transparent)',
        color: 'var(--vscode-editorLineNumber-foreground)',
        border: 'none',
      },
      '.cm-activeLine': { backgroundColor: 'rgba(127,127,127,0.06)' },
      '.cm-activeLineGutter': { backgroundColor: 'rgba(127,127,127,0.10)' },
      '.cm-cursor': { borderLeftColor: 'var(--vscode-editorCursor-foreground)' },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--vscode-editor-selectionBackground) !important',
      },
      '.cm-scroller': { overflow: 'auto' },
    }, { dark: isDark }),
  ];
  if (isDark) {
    extensions.unshift(oneDark);
  }
  return EditorState.create({ doc: text, extensions });
}

function renderEdit() {
  root.classList.remove('viewing');
  root.classList.add('editing');
  const host = document.createElement('div');
  host.className = 'editor';
  root.replaceChildren(host);
  if (editorView) {
    editorView.destroy();
    editorView = null;
  }
  editorView = new EditorView({ state: buildEditorState(currentText, lastThemeKind), parent: host });
  editorView.focus();
}

function syncEditorContent(): void {
  if (!editorView) return;
  const liveText = editorView.state.doc.toString();
  if (liveText === currentText) return;
  suppressEditorChange = true;
  try {
    editorView.dispatch({
      changes: { from: 0, to: liveText.length, insert: currentText },
    });
  } finally {
    suppressEditorChange = false;
  }
}

function syncEditorTheme(themeKind: number): void {
  if (!editorView) return;
  if (themeKind === lastThemeKind) return;
  const text = editorView.state.doc.toString();
  editorView.setState(buildEditorState(text, themeKind));
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
  const themeChanged = msg.themeKind !== lastThemeKind;
  lastThemeKind = msg.themeKind;
  initMermaid(msg.themeKind);
  currentText = msg.text;
  if (msg.mode !== currentMode) {
    setMode(msg.mode, false);
  } else if (currentMode === 'view') {
    if (themeChanged) {
      renderView();
    } else {
      renderView();
    }
  } else {
    if (themeChanged) {
      syncEditorTheme(msg.themeKind);
    } else {
      syncEditorContent();
    }
  }
  if (currentMode === 'view' && themeChanged) {
    rerenderMermaidForTheme();
  }
});

// Tell the host we're ready
vscode.postMessage({ type: 'ready' });

// Set filename hint from URL (the URI fragment includes the path)
fname.textContent = (location.hash || '').replace(/^#/, '') || 'markdown';
