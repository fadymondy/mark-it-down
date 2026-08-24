/**
 * Options page: server URL + PAT + theme, connection test against
 * /api/auth/me, and an About block with the release-feed update check.
 *
 * Host permissions are optional_host_permissions in the manifest; when the
 * user saves a server URL we request access to just that origin (the
 * permissions prompt needs the click's user gesture, so the request runs
 * first in the handler).
 */

import { compareSemver } from '../../../packages/core/src/semver';
import { getSettings, saveSettings, testConnection, fetchLatestRelease, Settings } from './lib/client';
import { applyTheme, populateThemeSelect } from './lib/theme';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function setStatus(id: string, text: string, kind: 'ok' | 'error' | 'muted'): void {
  const node = el<HTMLElement>(id);
  node.textContent = text;
  node.dataset.kind = kind;
}

function normalizeServerUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** Ask for host access to the server's origin. True when granted. */
async function ensureHostPermission(serverUrl: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(serverUrl).origin;
  } catch {
    return false;
  }
  const pattern = `${origin}/*`;
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

async function currentFormSettings(): Promise<Settings> {
  const saved = await getSettings();
  return {
    serverUrl: normalizeServerUrl(el<HTMLInputElement>('server-url').value),
    token: el<HTMLInputElement>('token').value.trim() || saved.token,
    theme: el<HTMLSelectElement>('theme').value,
  };
}

async function refreshAbout(settings: Settings): Promise<void> {
  const current = chrome.runtime.getManifest().version;
  el<HTMLSpanElement>('about-current').textContent = current;
  setStatus('about-latest', 'Checking…', 'muted');
  const latest = await fetchLatestRelease(settings);
  if (!latest) {
    setStatus('about-latest', 'Could not reach the release feed.', 'error');
    return;
  }
  await chrome.storage.local.set({ updateInfo: latest });
  const cleaned = latest.latestVersion.replace(/^v/, '');
  if (compareSemver(latest.latestVersion, current) > 0) {
    setStatus('about-latest', `Latest: ${cleaned} — update available.`, 'ok');
    const link = el<HTMLAnchorElement>('about-update-link');
    link.href = latest.url;
    link.hidden = false;
  } else {
    setStatus('about-latest', `Latest: ${cleaned} — you are up to date.`, 'muted');
    el<HTMLAnchorElement>('about-update-link').hidden = true;
  }
}

async function init(): Promise<void> {
  const settings = await getSettings();
  applyTheme(settings.theme);

  el<HTMLInputElement>('server-url').value = settings.serverUrl;
  if (settings.token !== '') {
    el<HTMLInputElement>('token').placeholder = 'Token saved — enter a new one to replace it';
  }
  const themeSelect = el<HTMLSelectElement>('theme');
  populateThemeSelect(themeSelect, settings.theme);
  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));

  el<HTMLButtonElement>('save').addEventListener('click', () => {
    // chrome.permissions.request must run inside the user gesture; do it
    // before any other awaits.
    const serverUrl = normalizeServerUrl(el<HTMLInputElement>('server-url').value);
    const permissionPrompt = serverUrl !== '' ? ensureHostPermission(serverUrl) : Promise.resolve(true);
    void (async () => {
      const granted = await permissionPrompt;
      const tokenField = el<HTMLInputElement>('token');
      const patch: Partial<Settings> = { serverUrl, theme: themeSelect.value };
      if (tokenField.value.trim() !== '') patch.token = tokenField.value.trim();
      await saveSettings(patch);
      tokenField.value = '';
      if (settings.token !== '' || patch.token) {
        tokenField.placeholder = 'Token saved — enter a new one to replace it';
      }
      if (serverUrl !== '' && !granted) {
        setStatus('save-status', 'Saved, but host access was declined — API calls will fail until granted.', 'error');
      } else {
        setStatus('save-status', 'Saved.', 'ok');
      }
    })();
  });

  el<HTMLButtonElement>('test').addEventListener('click', () => {
    void (async () => {
      setStatus('test-status', 'Testing…', 'muted');
      try {
        const form = await currentFormSettings();
        if (form.serverUrl === '') throw new Error('enter a server URL first');
        const me = await testConnection(form);
        const who =
          (me.email as string | undefined) ??
          (me.name as string | undefined) ??
          (me.id as string | undefined) ??
          'authenticated';
        setStatus('test-status', `Connected as ${who}.`, 'ok');
      } catch (err) {
        setStatus('test-status', `Failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    })();
  });

  await refreshAbout(settings);
}

void init();
