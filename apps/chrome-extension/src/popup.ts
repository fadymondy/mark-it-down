/**
 * Popup: quick note capture into the warehouse + the 10 most recent notes.
 * Title prefills from the active tab, body from the current selection
 * (activeTab + scripting — granted by the act of opening the popup).
 */

import { getSettings, isConfigured, listNotes, createNote, Settings, Note } from './lib/client';
import { applyTheme } from './lib/theme';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Selection text from the active tab; empty when the page is not scriptable. */
async function selectionFrom(tab: chrome.tabs.Tab | undefined): Promise<string> {
  if (!tab?.id) return '';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() ?? '',
    });
    return results[0]?.result ?? '';
  } catch {
    return ''; // chrome:// pages, the Web Store, etc.
  }
}

function showStatus(text: string, kind: 'ok' | 'error'): void {
  const status = el<HTMLParagraphElement>('status');
  status.textContent = text;
  status.dataset.kind = kind;
}

function renderRecent(notes: Note[], serverUrl: string): void {
  const list = el<HTMLUListElement>('recent-list');
  list.textContent = '';
  if (notes.length === 0) {
    const li = document.createElement('li');
    li.className = 'recent-empty';
    li.textContent = 'No notes yet — capture your first one above.';
    list.appendChild(li);
    return;
  }
  for (const note of notes.slice(0, 10)) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'recent-item';
    const title = document.createElement('span');
    title.className = 'recent-title';
    title.textContent = note.title || '(untitled)';
    const date = document.createElement('span');
    date.className = 'recent-date';
    date.textContent = new Date(note.updated_at).toLocaleDateString();
    link.append(title, date);
    link.addEventListener('click', ev => {
      ev.preventDefault();
      void chrome.tabs.create({ url: `${serverUrl}/notes` });
    });
    li.appendChild(link);
    list.appendChild(li);
  }
}

async function refreshRecent(settings: Settings): Promise<void> {
  try {
    renderRecent(await listNotes(settings, 10), settings.serverUrl);
  } catch (err) {
    const list = el<HTMLUListElement>('recent-list');
    list.textContent = '';
    const li = document.createElement('li');
    li.className = 'recent-empty';
    li.textContent = `Could not load notes: ${err instanceof Error ? err.message : String(err)}`;
    list.appendChild(li);
  }
}

async function init(): Promise<void> {
  const settings = await getSettings();
  applyTheme(settings.theme);

  el<HTMLAnchorElement>('open-settings').addEventListener('click', ev => {
    ev.preventDefault();
    void chrome.runtime.openOptionsPage();
  });

  if (!isConfigured(settings)) {
    el<HTMLDivElement>('setup').hidden = false;
    el<HTMLDivElement>('capture').hidden = true;
    el<HTMLDivElement>('recent').hidden = true;
    el<HTMLAnchorElement>('setup-link').addEventListener('click', ev => {
      ev.preventDefault();
      void chrome.runtime.openOptionsPage();
    });
    return;
  }

  const warehouse = el<HTMLAnchorElement>('open-warehouse');
  warehouse.hidden = false;
  warehouse.addEventListener('click', ev => {
    ev.preventDefault();
    void chrome.tabs.create({ url: settings.serverUrl });
  });

  const titleInput = el<HTMLInputElement>('note-title');
  const bodyInput = el<HTMLTextAreaElement>('note-body');
  const categoryInput = el<HTMLInputElement>('note-category');

  const tab = await activeTab();
  if (tab?.title) titleInput.value = tab.title;
  const selection = await selectionFrom(tab);
  if (selection) {
    bodyInput.value = tab?.url ? `${selection}\n\n— [source](${tab.url})` : selection;
  } else if (tab?.url && !tab.url.startsWith('chrome')) {
    bodyInput.value = `[${tab.title ?? tab.url}](${tab.url})\n\n`;
  }

  el<HTMLButtonElement>('save').addEventListener('click', () => {
    void (async () => {
      const title = titleInput.value.trim();
      if (title === '') {
        showStatus('A title is required.', 'error');
        return;
      }
      const button = el<HTMLButtonElement>('save');
      button.disabled = true;
      showStatus('Saving…', 'ok');
      try {
        const category = categoryInput.value.trim();
        await createNote(settings, {
          title,
          body: bodyInput.value,
          ...(category !== '' ? { category } : {}),
        });
        showStatus('Saved to warehouse.', 'ok');
        bodyInput.value = '';
        await refreshRecent(settings);
      } catch (err) {
        showStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        button.disabled = false;
      }
    })();
  });

  await refreshRecent(settings);
}

void init();
