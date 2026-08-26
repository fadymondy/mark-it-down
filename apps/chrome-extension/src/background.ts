/**
 * MV3 service worker: context-menu entry for .md links and a daily
 * update check that badges the action icon when a newer release exists.
 */

import { compareSemver } from '../../../packages/core/src/semver';
import { getSettings, fetchLatestRelease, UpdateInfo } from './lib/client';

const MENU_ID = 'mid-open-viewer';
const ALARM_NAME = 'mid-update-check';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Open in Mark It Down viewer',
    contexts: ['link'],
    targetUrlPatterns: ['*://*/*.md', '*://*/*.markdown'],
  });
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 60 * 24 });
});

chrome.runtime.onStartup.addListener(() => {
  void runUpdateCheck();
});

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === MENU_ID && info.linkUrl) {
    void chrome.tabs.create({
      url: chrome.runtime.getURL(`viewer.html?url=${encodeURIComponent(info.linkUrl)}`),
    });
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) void runUpdateCheck();
});

async function runUpdateCheck(): Promise<void> {
  const settings = await getSettings();
  const latest = await fetchLatestRelease(settings);
  if (!latest) return;

  const info: UpdateInfo = latest;
  await chrome.storage.local.set({ updateInfo: info });

  const current = chrome.runtime.getManifest().version;
  if (compareSemver(latest.latestVersion, current) > 0) {
    await chrome.action.setBadgeText({ text: '↑' });
    await chrome.action.setBadgeBackgroundColor({ color: '#f7c97b' });
    await chrome.action.setTitle({ title: `Mark It Down — update ${latest.latestVersion} available` });
  } else {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'Mark It Down' });
  }
}
