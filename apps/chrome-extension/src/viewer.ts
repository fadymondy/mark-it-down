/**
 * Standalone markdown viewer page.
 *
 *   viewer.html?url=https://example.com/readme.md  — fetch and render a file
 *   viewer.html?note=<id>                          — render a warehouse note
 *
 * Rendering goes through packages/core renderMarkdown (marked + hljs +
 * DOMPurify). Mermaid blocks stay as plain fenced code in v1
 * (extractMermaid: false) to keep the bundle small.
 */

import { renderMarkdown } from '../../../packages/core/src/markdown';
import { getSettings, saveSettings, getNote, isConfigured } from './lib/client';
import { applyTheme, applyHljsCss, populateThemeSelect } from './lib/theme';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function showMessage(html: string): void {
  const content = el<HTMLElement>('content');
  content.textContent = '';
  const box = document.createElement('div');
  box.className = 'viewer-message';
  box.innerHTML = html; // static, extension-authored markup only
  content.appendChild(box);
}

function render(markdown: string, title: string): void {
  document.title = `${title} — Mark It Down`;
  el<HTMLSpanElement>('doc-title').textContent = title;
  const result = renderMarkdown(markdown, { extractMermaid: false });
  el<HTMLElement>('content').innerHTML = result.html;
}

/** Offer a one-click optional-host-permission grant for a blocked origin. */
function offerPermission(url: string, retry: () => void): void {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    showMessage('<p>Invalid URL.</p>');
    return;
  }
  showMessage(
    `<p>Could not fetch <code></code> — the extension may need permission for <strong></strong>.</p>`,
  );
  const message = document.querySelector('.viewer-message');
  if (!message) return;
  message.querySelector('code')!.textContent = url;
  message.querySelector('strong')!.textContent = origin;
  const button = document.createElement('button');
  button.textContent = `Allow access to ${origin}`;
  button.addEventListener('click', () => {
    void chrome.permissions.request({ origins: [`${origin}/*`] }).then(granted => {
      if (granted) retry();
    });
  });
  message.appendChild(button);
}

async function loadFromUrl(url: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      showMessage('<p></p>');
      const p = document.querySelector('.viewer-message p');
      if (p) p.textContent = `Fetch failed: ${res.status} ${res.statusText}`;
      return;
    }
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'document');
    render(await res.text(), name);
  } catch {
    offerPermission(url, () => void loadFromUrl(url));
  }
}

async function loadFromNote(id: string): Promise<void> {
  const settings = await getSettings();
  if (!isConfigured(settings)) {
    showMessage('<p>No warehouse configured. Set the server URL and token in the extension options.</p>');
    return;
  }
  try {
    const note = await getNote(settings, id);
    render(note.body, note.title || '(untitled)');
  } catch (err) {
    showMessage(`<p>Could not load note.</p>`);
    const p = document.createElement('p');
    p.textContent = err instanceof Error ? err.message : String(err);
    document.querySelector('.viewer-message')?.appendChild(p);
  }
}

async function init(): Promise<void> {
  const settings = await getSettings();
  const theme = applyTheme(settings.theme);
  applyHljsCss(theme);

  const select = el<HTMLSelectElement>('theme');
  populateThemeSelect(select, theme.id);
  select.addEventListener('change', () => {
    const next = applyTheme(select.value);
    applyHljsCss(next);
    void saveSettings({ theme: next.id });
  });

  const params = new URLSearchParams(location.search);
  const url = params.get('url');
  const note = params.get('note');
  if (url) {
    await loadFromUrl(url);
  } else if (note) {
    await loadFromNote(note);
  } else {
    showMessage(
      '<p>Nothing to show. Open this page as <code>viewer.html?url=…</code> for a markdown file, or <code>viewer.html?note=…</code> for a warehouse note.</p>',
    );
  }
}

void init();
