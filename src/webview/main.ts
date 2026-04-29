// Mark It Down — webview runtime.
// Bundled by esbuild → out/webview/main.js
//
// Dependencies (bundled):
//   marked         — Markdown → HTML
//   marked-highlight — code block highlight integration
//   highlight.js   — language detection + tokenization
//   mermaid        — live diagram rendering
//   dompurify      — sanitize HTML before injecting

import { renderMarkdown as coreRenderMarkdown, applyMermaidPlaceholders } from '../../packages/core/src/markdown/renderer';
import mermaid from 'mermaid';
import { toPng } from 'html-to-image';
import * as XLSX from 'xlsx';
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

interface NoteIndexEntry {
  id: string;
  title: string;
}

interface UpdateMessage {
  type: 'update';
  text: string;
  mode: Mode;
  themeKind: number;
  notes?: NoteIndexEntry[];
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
let noteIndex: NoteIndexEntry[] = [];

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

function renderMarkdown(md: string): string {
  const { html, mermaidBlocks } = coreRenderMarkdown(md, { notes: noteIndex });
  const container = document.createElement('div');
  container.innerHTML = html;
  applyMermaidPlaceholders(container, mermaidBlocks);
  return container.innerHTML;
}

function attachWikilinkHandlers() {
  root.querySelectorAll<HTMLElement>('.mid-wikilink').forEach(el => {
    if (el.dataset.midWikilinkBound === '1') return;
    el.dataset.midWikilinkBound = '1';
    el.addEventListener('click', evt => {
      evt.preventDefault();
      const id = el.getAttribute('data-wikilink-id') ?? undefined;
      const ids = el.getAttribute('data-wikilink-ids') ?? undefined;
      const target = el.getAttribute('data-wikilink-target') ?? undefined;
      vscode.postMessage({ type: 'openWikilink', id, ids, target });
    });
  });
}

function attachCodeActions() {
  root.querySelectorAll<HTMLPreElement>('main.viewing pre').forEach((pre, idx) => {
    if (pre.querySelector('.code-actions')) return;
    const wrap = document.createElement('div');
    wrap.className = 'code-actions';
    const code = pre.querySelector('code')?.textContent ?? '';
    const lang =
      pre
        .querySelector('code')
        ?.className.match(/language-(\S+)/)?.[1] ?? 'code';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy code to clipboard';
    copyBtn.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: code }));
    wrap.appendChild(copyBtn);

    const imgBtn = document.createElement('button');
    imgBtn.textContent = 'PNG';
    imgBtn.title = 'Export this code block as PNG';
    imgBtn.addEventListener('click', () =>
      exportCodeBlockAsPng(pre, `${lang}-snippet-${idx + 1}`).catch(err => {
        vscode.postMessage({
          type: 'showError',
          message: `Mark It Down: failed to export code block — ${
            (err as Error)?.message ?? String(err)
          }`,
        });
      }),
    );
    wrap.appendChild(imgBtn);
    pre.appendChild(wrap);
  });
}

function attachTableActions(): void {
  const tables = root.querySelectorAll<HTMLTableElement>('main.viewing table');
  tables.forEach((table, idx) => {
    if (table.dataset.midEnhanced === '1') return;
    const wrapper = document.createElement('div');
    wrapper.className = 'mid-table-wrap';
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
    table.classList.add('mid-datatable');
    table.dataset.midEnhanced = '1';

    const toolbar = document.createElement('div');
    toolbar.className = 'mid-table-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', `Table ${idx + 1} export`);
    toolbar.innerHTML = `
      <span class="mid-table-label">Table ${idx + 1}</span>
      <div class="mid-table-actions">
        <button data-format="csv" aria-label="Export table ${idx + 1} as CSV">CSV</button>
        <button data-format="tsv" aria-label="Export table ${idx + 1} as TSV">TSV</button>
        <button data-format="xlsx" aria-label="Export table ${idx + 1} as Excel">Excel</button>
      </div>
    `;
    wrapper.insertBefore(toolbar, table);

    toolbar.addEventListener('click', evt => {
      const fmt = (evt.target as HTMLElement).dataset.format as 'csv' | 'tsv' | 'xlsx' | undefined;
      if (!fmt) return;
      try {
        exportTable(table, fmt, `table-${idx + 1}`);
      } catch (err) {
        vscode.postMessage({
          type: 'showError',
          message: `Mark It Down: failed to export table — ${(err as Error)?.message ?? String(err)}`,
        });
      }
    });

    wireSortableHeaders(table);
  });
}

function wireSortableHeaders(table: HTMLTableElement): void {
  const headRow = table.tHead?.rows[0];
  if (!headRow) return;
  Array.from(headRow.cells).forEach((th, colIndex) => {
    th.classList.add('mid-sortable');
    th.dataset.sort = 'none';
    th.setAttribute('role', 'columnheader');
    th.setAttribute('tabindex', '0');
    th.setAttribute('aria-sort', 'none');
    const indicator = document.createElement('span');
    indicator.className = 'mid-sort-indicator';
    indicator.textContent = ' ⇅';
    indicator.setAttribute('aria-hidden', 'true');
    th.appendChild(indicator);
    th.addEventListener('click', () => sortTable(table, colIndex, th));
    th.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        sortTable(table, colIndex, th);
      }
    });
  });
}

function sortTable(table: HTMLTableElement, colIndex: number, th: HTMLTableCellElement): void {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const rows = Array.from(tbody.rows);
  const current = th.dataset.sort ?? 'none';
  const next = current === 'none' ? 'asc' : current === 'asc' ? 'desc' : 'none';

  // Reset indicators on all headers
  table.tHead?.querySelectorAll<HTMLTableCellElement>('th').forEach(other => {
    if (other === th) return;
    other.dataset.sort = 'none';
    other.setAttribute('aria-sort', 'none');
    const ind = other.querySelector('.mid-sort-indicator');
    if (ind) ind.textContent = ' ⇅';
  });
  th.dataset.sort = next;
  th.setAttribute('aria-sort', next === 'asc' ? 'ascending' : next === 'desc' ? 'descending' : 'none');
  const ind = th.querySelector('.mid-sort-indicator');
  if (ind) {
    ind.textContent = next === 'asc' ? ' ▲' : next === 'desc' ? ' ▼' : ' ⇅';
  }

  if (next === 'none') {
    const original = rows
      .slice()
      .sort((a, b) => Number(a.dataset.midOriginal ?? 0) - Number(b.dataset.midOriginal ?? 0));
    original.forEach(r => tbody.appendChild(r));
    return;
  }
  if (rows[0] && rows[0].dataset.midOriginal === undefined) {
    rows.forEach((r, i) => (r.dataset.midOriginal = String(i)));
  }
  const factor = next === 'asc' ? 1 : -1;
  rows.sort((a, b) => factor * compareCells(a.cells[colIndex], b.cells[colIndex]));
  rows.forEach(r => tbody.appendChild(r));
}

function compareCells(a: HTMLTableCellElement | undefined, b: HTMLTableCellElement | undefined): number {
  const av = (a?.textContent ?? '').trim();
  const bv = (b?.textContent ?? '').trim();
  const an = parseFinite(av);
  const bn = parseFinite(bv);
  if (an !== null && bn !== null) return an - bn;
  return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
}

function parseFinite(s: string): number | null {
  if (s.length === 0) return null;
  const cleaned = s.replace(/[, ]/g, '').replace(/^\$/, '').replace(/%$/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function tableToMatrix(table: HTMLTableElement): string[][] {
  const out: string[][] = [];
  const head = table.tHead?.rows[0];
  if (head) {
    out.push(
      Array.from(head.cells).map(c => c.cloneNode(true) as HTMLElement)
        .map(c => {
          c.querySelector('.mid-sort-indicator')?.remove();
          return (c.textContent ?? '').trim();
        }),
    );
  }
  Array.from(table.tBodies[0]?.rows ?? []).forEach(row => {
    out.push(Array.from(row.cells).map(c => (c.textContent ?? '').trim()));
  });
  return out;
}

function exportTable(table: HTMLTableElement, format: 'csv' | 'tsv' | 'xlsx', baseName: string): void {
  const matrix = tableToMatrix(table);
  if (format === 'csv' || format === 'tsv') {
    const sep = format === 'csv' ? ',' : '\t';
    const text = matrix
      .map(row => row.map(cell => csvEscape(cell, sep)).join(sep))
      .join('\n');
    vscode.postMessage({
      type: 'saveTable',
      format,
      content: text,
      suggestedName: `${baseName}.${format}`,
    });
    return;
  }
  // xlsx
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  vscode.postMessage({
    type: 'saveTable',
    format: 'xlsx',
    contentBase64: buf,
    suggestedName: `${baseName}.xlsx`,
  });
}

function csvEscape(value: string, sep: string): string {
  if (value.includes(sep) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function exportCodeBlockAsPng(pre: HTMLPreElement, suggestedName: string): Promise<void> {
  const actions = pre.querySelector<HTMLDivElement>('.code-actions');
  const previousActionsDisplay = actions?.style.display ?? '';
  if (actions) actions.style.display = 'none';
  try {
    const styles = getComputedStyle(document.body);
    const bg = styles.getPropertyValue('--vscode-editor-background').trim() || '#ffffff';
    const dataUrl = await toPng(pre, {
      backgroundColor: bg,
      pixelRatio: 2,
      cacheBust: true,
      style: { boxShadow: 'none', borderRadius: '6px' },
    });
    vscode.postMessage({
      type: 'saveCodeImage',
      dataUrl,
      suggestedName,
    });
  } finally {
    if (actions) actions.style.display = previousActionsDisplay;
  }
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
  attachTableActions();
  attachWikilinkHandlers();
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
  btnView.setAttribute('aria-pressed', mode === 'view' ? 'true' : 'false');
  btnEdit.setAttribute('aria-pressed', mode === 'edit' ? 'true' : 'false');
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
  if (Array.isArray(msg.notes)) noteIndex = msg.notes;
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
