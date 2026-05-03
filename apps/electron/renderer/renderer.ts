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
import { listNoteTypes, getNoteType, DEFAULT_TYPE_ID, setRegistry as setNoteTypesRegistry, isBuiltinTypeId, type NoteType } from '../notes/note-types';

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
  /** #302 — hide the type-filter strip in the notes sidebar entirely. */
  noteTypeStripHidden?: boolean;
  /** #302 — type ids excluded from the strip even when it's visible. */
  noteTypeStripExclude?: string[];
  /** #302 — per-user ordering of strip entries; ids missing from this list
   * append in registry order. */
  noteTypeOrder?: string[];
  /** #309 — split-screen tab manager state. `tabSplitActive` is true when the
   * editor area is showing two columns; `tabSplitRatio` is the left column's
   * share (0.15-0.85); `tabActiveStripId` (0|1) is the column the user was
   * last focused on so a restart restores their active editor correctly. */
  tabSplitActive?: boolean;
  tabSplitRatio?: number;
  tabActiveStripId?: 0 | 1;
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
  /** Note type id from the registry (#255). Falls back to `'note'`. */
  type?: string;
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
  notesCreate(workspace: string, title: string, type?: string): Promise<{ entry: NoteEntry; fullPath: string }>;
  notesRename(workspace: string, id: string, title: string): Promise<NoteEntry | null>;
  notesDelete(workspace: string, id: string): Promise<boolean>;
  notesTag(workspace: string, id: string, tags: string[]): Promise<NoteEntry | null>;
  notesSetType(workspace: string, id: string, type: string): Promise<NoteEntry | null>;
  // #297 — note-type registry CRUD.
  noteTypesList(): Promise<NoteType[]>;
  noteTypesUpsert(type: Partial<NoteType> & { id: string }): Promise<{ ok: boolean; types: NoteType[]; error?: string }>;
  noteTypesDelete(id: string): Promise<{ ok: boolean; types: NoteType[]; error?: string }>;
  noteTypesReorder(orderedIds: string[]): Promise<NoteType[]>;
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
  // Tab persistence (#287, #308). Wire format adds `window_id` so detached
  // windows can persist independently; the renderer never sets it (main
  // derives the scope from the IPC sender) but it surfaces in `tabsList`
  // results for diagnostics.
  tabsList(): Promise<{ window_id: number; strip_id: number; idx: number; path: string; active: number }[]>;
  tabsReplace(rows: { window_id?: number; strip_id: number; idx: number; path: string; active: number }[]): Promise<boolean>;
  // #308 — request main to spawn a new BrowserWindow with `path` as its only
  // tab. Returns the new window's id (Electron BrowserWindow.id, not our
  // persistence slot — the renderer doesn't need to know the slot).
  tabsDetach(payload: { path: string; bounds?: { x?: number; y?: number } }): Promise<{ ok: boolean; windowId?: number; error?: string }>;
  /** #308 — current window's persistence slot id (0 for main, 1+ for detached). */
  getWindowId(): Promise<number>;
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
const notesTypesEl = document.getElementById('notes-types') as HTMLDivElement;
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
const tabstripEl = document.getElementById('tabstrip') as HTMLDivElement;

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
/** Currently active type filter (null = show all). #255 — type filter strip. */
let notesTypeFilter: string | null = null;
/** True when the active editor is rendering a typed custom view (e.g. secret).
 * Used by `setMode` to bypass the markdown editor swap. */
let typedViewActive = false;
/** #302 — strip preference state, hydrated from AppState on startup and
 * mutated by the Settings → Notes → Filter strip controls. */
let noteTypeStripHidden = false;
let noteTypeStripExclude: string[] = [];
let noteTypeOrder: string[] = [];
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

// ─── Tab manager (#287) ────────────────────────────────────────────────────────
// VSCode-style multi-file editor strip. Each tab carries its own text/path/dirty/
// scroll state; the active tab's text + path are mirrored into the legacy
// `currentText`/`currentPath` globals so the rest of the renderer (markdown
// rendering, save, export, spotlight, etc.) keeps working without a sweep.
//
// Strip 0 is the only strip in the MVP. The model carries `stripId` so a future
// split-screen patch can introduce strip 1 without changing the wire format
// (the SQLite `open_tabs` table is already (strip_id, idx) keyed).
//
// Persistence: every state mutation calls `scheduleTabsPersist`, which debounces
// a snapshot write into the `open_tabs` table via the IPC bridge.
interface FileTab {
  stripId: number;
  path: string;
  text: string;
  dirty: boolean;
  /** Last known scrollTop of the editor textarea (or preview, in view mode).
   * Restored on tab focus so reading position survives swaps. */
  scrollTop: number;
}

const tabs: FileTab[] = [];
let activeTabIndex = -1;
/** #309 — split-screen mode. `activeStripId` is the strip the user is focused on
 * (0 left, 1 right). `splitActive` is true when both strips have at least one
 * tab and the editor area is rendering as two columns. The inactive strip's
 * own active-tab pointer survives column swaps via `inactiveActiveTabIndex`.
 * See split-screen module at the bottom of this file for the full mechanics. */
let activeStripId: 0 | 1 = 0;
let splitActive = false;
let inactiveActiveTabIndex = -1;
/** #309 — left-column ratio of the editor area (0.15-0.85). Persisted as
 * `tabSplitRatio` in app state so it survives a restart. */
let tabSplitRatio = 0.5;
/** #309 — last-focused strip read from app state during startup. `hydrateTabs`
 * uses this to restore which column is "live" after a relaunch; -1 means
 * unset (falls back to whichever strip has rows). */
let appStateTabActiveStripId: 0 | 1 | -1 = -1;
/** LIFO of recently-closed tab paths for Cmd+Shift+T. Capped at 20 entries. */
const recentlyClosedPaths: string[] = [];
let tabsPersistTimer: number | null = null;
/** True while the renderer is rehydrating tabs at startup — suppresses persist
 * thrash and lets us assemble the strip from disk without a flicker. */
let tabsHydrating = false;

function findTabIndex(filePath: string): number {
  // #309 — search within the active strip only. If the same path is open in the
  // other strip, we still let the user open another instance in the active
  // strip (that's intentional — split-screen viewing the same file is valid).
  return tabs.findIndex(t => t.path === filePath && t.stripId === activeStripId);
}

function activeTab(): FileTab | null {
  return activeTabIndex >= 0 && activeTabIndex < tabs.length ? tabs[activeTabIndex] : null;
}

/** Sync the editor area's mirror state from the active tab into the legacy
 * `currentText` / `currentPath` globals + filename label. */
function syncMirrorFromActiveTab(): void {
  const t = activeTab();
  if (t) {
    currentText = t.text;
    currentPath = t.path;
    filenameEl.textContent = t.path.split('/').pop() ?? 'Untitled';
  } else {
    currentText = '';
    currentPath = null;
    filenameEl.textContent = 'Untitled';
  }
}

/** Push the current legacy `currentText` back onto the active tab. Call this
 * before swapping tabs so unsaved edits survive the swap. */
function syncActiveTabFromMirror(): void {
  const t = activeTab();
  if (!t) return;
  if (t.text !== currentText) {
    t.text = currentText;
    if (!t.dirty) {
      t.dirty = true;
      renderTabstrip();
    }
  }
}

/** Open a new tab or focus an existing one for `filePath`.
 * Returns the active tab. */
function openTab(filePath: string, content: string): FileTab {
  // Save scroll + edits on the outgoing tab before we swap.
  syncActiveTabFromMirror();
  captureScrollPosition();

  const existing = findTabIndex(filePath);
  if (existing !== -1) {
    activeTabIndex = existing;
    const t = tabs[existing];
    // Only refresh content from disk on a focus if the user hasn't dirtied it.
    if (!t.dirty) t.text = content;
    return t;
  }
  // #309 — new tabs land in the currently active strip, not unconditionally
  // strip 0. When split is inactive `activeStripId` is always 0.
  const tab: FileTab = { stripId: activeStripId, path: filePath, text: content, dirty: false, scrollTop: 0 };
  tabs.push(tab);
  activeTabIndex = tabs.length - 1;
  return tab;
}

/** Close the tab at `idx`. Adjusts `activeTabIndex` and pushes the path onto
 * the recently-closed stack so Cmd+Shift+T can resurrect it.
 * #309 — strip-aware: if the closed tab is in the inactive strip, the active
 * strip's editor stays put. Empty-strip detection collapses the split. */
function closeTabAt(idx: number): void {
  if (idx < 0 || idx >= tabs.length) return;
  const closed = tabs[idx];
  recentlyClosedPaths.push(closed.path);
  if (recentlyClosedPaths.length > 20) recentlyClosedPaths.shift();
  const wasActiveStrip = closed.stripId === activeStripId;
  tabs.splice(idx, 1);
  // Adjust both per-strip active pointers across the splice.
  if (idx < activeTabIndex) activeTabIndex--;
  else if (idx === activeTabIndex) {
    // Active tab closed — keep visual position by holding `activeTabIndex`,
    // but it may now point past the end or to a tab in the OTHER strip. We
    // resolve below by snapping to the nearest tab in the active strip.
  }
  if (idx < inactiveActiveTabIndex) inactiveActiveTabIndex--;
  else if (idx === inactiveActiveTabIndex) {
    inactiveActiveTabIndex = -1; // resolved below
  }
  // Check whether either strip emptied out.
  const activeStripEmpty = !tabs.some(t => t.stripId === activeStripId);
  const inactiveStripId = activeStripId === 0 ? 1 : 0;
  const inactiveStripEmpty = !tabs.some(t => t.stripId === inactiveStripId);

  if (splitActive && (activeStripEmpty || inactiveStripEmpty)) {
    // Collapse the split: rehome any surviving tabs into strip 0 and clear the
    // second column. The remaining active-tab pointer survives the rehome.
    collapseSplitAfterClose(wasActiveStrip);
    // collapseSplitAfterClose handles the re-render and persist.
    return;
  }

  if (tabs.length === 0) {
    activeTabIndex = -1;
    inactiveActiveTabIndex = -1;
    syncMirrorFromActiveTab();
    if (currentMode === 'view') renderView();
    else if (currentMode === 'edit') renderEdit();
    else renderSplit();
    renderTabstrip();
    schedulePersistTabs();
    return;
  }

  // Re-resolve active pointers within their strip if they fell off the end.
  if (wasActiveStrip) {
    if (activeTabIndex >= tabs.length || tabs[activeTabIndex]?.stripId !== activeStripId) {
      activeTabIndex = lastIndexInStrip(activeStripId);
    }
  }
  if (!wasActiveStrip) {
    if (inactiveActiveTabIndex < 0 || tabs[inactiveActiveTabIndex]?.stripId !== inactiveStripId) {
      inactiveActiveTabIndex = lastIndexInStrip(inactiveStripId);
    }
  }
  syncMirrorFromActiveTab();
  // Re-render the editor area against the new active tab.
  if (currentMode === 'view') renderView();
  else if (currentMode === 'edit') renderEdit();
  else renderSplit();
  highlightActiveTreeItem();
  updateWordCount();
  updateSaveIndicator(true);
  restoreScrollPosition();
  renderTabstrip();
  if (splitActive) renderInactiveColumn();
  schedulePersistTabs();
}

/** #309 — return the highest global index of any tab in `stripId`, or -1 if
 * the strip is empty. Used to snap the active pointer back into bounds after a
 * close shrinks its strip. */
function lastIndexInStrip(stripId: number): number {
  for (let i = tabs.length - 1; i >= 0; i--) if (tabs[i].stripId === stripId) return i;
  return -1;
}

/** Cycle to next/previous tab. `delta` is +1 or -1. Wraps around.
 * #309 — cycling stays within the active strip; the inactive strip is unchanged. */
function cycleTab(delta: number): void {
  if (tabs.length === 0) return;
  const stripIndices = tabs.map((t, i) => ({ t, i })).filter(x => x.t.stripId === activeStripId).map(x => x.i);
  if (stripIndices.length === 0) return;
  const localPos = stripIndices.indexOf(activeTabIndex);
  if (localPos === -1) {
    focusTabAt(stripIndices[0]);
    return;
  }
  syncActiveTabFromMirror();
  captureScrollPosition();
  const nextLocal = ((localPos + delta) % stripIndices.length + stripIndices.length) % stripIndices.length;
  focusTabAt(stripIndices[nextLocal]);
}

function focusTabAt(idx: number): void {
  if (idx < 0 || idx >= tabs.length) return;
  if (idx === activeTabIndex) return;
  syncActiveTabFromMirror();
  captureScrollPosition();
  activeTabIndex = idx;
  syncMirrorFromActiveTab();
  if (currentMode === 'view') renderView();
  else if (currentMode === 'edit') renderEdit();
  else renderSplit();
  highlightActiveTreeItem();
  updateWordCount();
  updateSaveIndicator(!activeTab()?.dirty);
  restoreScrollPosition();
  renderTabstrip();
  schedulePersistTabs();
}

/** Reopen the most-recently-closed tab. */
async function reopenLastClosedTab(): Promise<void> {
  while (recentlyClosedPaths.length > 0) {
    const p = recentlyClosedPaths.pop()!;
    if (findTabIndex(p) !== -1) continue; // already open — try next
    try {
      const content = await window.mid.readFile(p);
      loadFileContent(p, content);
      return;
    } catch {
      // file gone — fall through to try the next entry
      continue;
    }
  }
  flashStatus('Nothing to reopen');
}

/** Capture the editor or preview scroll position into the active tab. */
function captureScrollPosition(): void {
  const t = activeTab();
  if (!t) return;
  const scroller =
    root.querySelector<HTMLElement>('textarea') ??
    root.querySelector<HTMLElement>('.mid-preview') ??
    root;
  if (scroller) t.scrollTop = scroller.scrollTop || 0;
}

/** Restore the active tab's scroll position into whichever scroller is live. */
function restoreScrollPosition(): void {
  const t = activeTab();
  if (!t) return;
  // Defer one frame so the freshly-rendered DOM has its layout. Without this
  // the assignment lands before the scroller has measurable height.
  requestAnimationFrame(() => {
    const scroller =
      root.querySelector<HTMLElement>('textarea') ??
      root.querySelector<HTMLElement>('.mid-preview') ??
      root;
    if (scroller) scroller.scrollTop = t.scrollTop;
  });
}

/** Move the tab at `from` to position `to` (insert-before semantics).
 * #309 — `to` is the global insertion index. Both pointers (`activeTabIndex`
 * and `inactiveActiveTabIndex`) are tracked through the splice. */
function moveTab(from: number, to: number): void {
  if (from === to || from < 0 || from >= tabs.length) return;
  const [moved] = tabs.splice(from, 1);
  // After removing `from`, the target index shifts left by one if `to` was
  // after `from`; clamp into bounds.
  const insertAt = Math.max(0, Math.min(tabs.length, to > from ? to - 1 : to));
  tabs.splice(insertAt, 0, moved);
  // Track both per-strip active tabs through the move so focus survives a drag.
  activeTabIndex = remapIndexAfterMove(activeTabIndex, from, insertAt);
  inactiveActiveTabIndex = remapIndexAfterMove(inactiveActiveTabIndex, from, insertAt);
  renderTabstrip();
  if (splitActive) renderInactiveColumn();
  schedulePersistTabs();
}

/** #309 — given the original index of a tracked pointer, return where it lands
 * after splicing `from` out and inserting it at `insertAt`. */
function remapIndexAfterMove(ptr: number, from: number, insertAt: number): number {
  if (ptr < 0) return ptr;
  if (ptr === from) return insertAt;
  // Step 1: account for the splice-out.
  let p = ptr;
  if (from < p) p--;
  // Step 2: account for the splice-in.
  if (insertAt <= p) p++;
  return p;
}

function renderTabstrip(): void {
  // #309 — render the primary strip into the existing #tabstrip element. The
  // secondary strip (when split is active) is rendered by `renderInactiveColumn`
  // which calls `renderTabstripInto` with the column-1 strip element.
  renderTabstripInto(tabstripEl, activeStripId, true);
}

/** #309 — render the tabs whose `stripId === stripId` into `target`. When
 * `isActiveStrip` is false, the rendered tabs do NOT swap the live editor on
 * click; instead, the click first promotes the strip to active (see
 * `swapActiveColumn`) and then focuses the clicked tab. */
function renderTabstripInto(target: HTMLDivElement | null, stripId: number, isActiveStrip: boolean): void {
  if (!target) return;
  // Build a list of (tab, globalIdx) pairs for this strip only.
  const stripList: { tab: FileTab; idx: number }[] = [];
  tabs.forEach((tab, idx) => { if (tab.stripId === stripId) stripList.push({ tab, idx }); });
  if (stripList.length === 0) {
    target.hidden = true;
    target.replaceChildren();
    return;
  }
  target.hidden = false;
  const activeIdxForStrip = isActiveStrip ? activeTabIndex : inactiveActiveTabIndex;
  const frag = document.createDocumentFragment();
  stripList.forEach(({ tab, idx }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mid-tab' + (idx === activeIdxForStrip ? ' is-active' : '');
    btn.dataset.tabIndex = String(idx);
    btn.dataset.tabPath = tab.path;
    btn.dataset.tabStrip = String(stripId);
    btn.draggable = true;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(idx === activeIdxForStrip));
    btn.title = tab.path;

    const fileMatch = iconForFile(tab.path.split('/').pop() ?? '', 'file');
    const iconWrap = document.createElement('span');
    iconWrap.className = 'mid-tab__icon';
    iconWrap.innerHTML = iconHTML(fileMatch.icon, 'mid-icon--sm');
    if (fileMatch.color) {
      const svg = iconWrap.firstElementChild as HTMLElement | null;
      if (svg) svg.style.color = fileMatch.color;
    }

    const label = document.createElement('span');
    label.className = 'mid-tab__label' + (tab.dirty ? ' is-dirty' : '');
    label.textContent = tab.path.split('/').pop() ?? tab.path;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mid-tab__close';
    closeBtn.title = 'Close (Cmd/Ctrl+W)';
    closeBtn.setAttribute('aria-label', `Close ${tab.path.split('/').pop() ?? tab.path}`);
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeTabAt(idx);
    });

    btn.addEventListener('click', () => {
      // #309 — clicking a tab in the inactive column promotes that column to
      // active first, so the live editor swaps to it before focusing the tab.
      if (!isActiveStrip) swapActiveColumn();
      focusTabAt(idx);
    });
    // Middle-click closes the tab — VSCode parity.
    btn.addEventListener('mousedown', e => {
      if (e.button === 1) {
        e.preventDefault();
        if (!isActiveStrip) swapActiveColumn();
        closeTabAt(idx);
      }
    });
    btn.addEventListener('contextmenu', e => {
      e.preventDefault();
      openContextMenu([
        { icon: 'x', label: 'Close', action: () => { if (!isActiveStrip) swapActiveColumn(); closeTabAt(idx); } },
        { icon: 'x', label: 'Close others', action: () => closeOtherTabsInStrip(idx, stripId) },
        { icon: 'x', label: 'Close all', action: () => closeAllTabsInStrip(stripId) },
        { separator: true, label: '' },
        { icon: 'folder-open', label: 'Reveal in Finder', action: () => void window.mid.openExternal(`file://${tab.path.replace(/\/[^/]+$/, '')}`) },
      ], e.clientX, e.clientY);
    });

    // Drag-to-reorder within the strip. We use HTML5 DnD; the dragover handler
    // computes whether the cursor sits in the left or right half of the target
    // tab to draw the appropriate insertion-line indicator.
    btn.addEventListener('dragstart', ev => {
      ev.dataTransfer?.setData('application/x-mid-tab', String(idx));
      ev.dataTransfer!.effectAllowed = 'move';
      btn.classList.add('is-dragging');
    });
    btn.addEventListener('dragend', () => {
      btn.classList.remove('is-dragging');
      target.querySelectorAll('.mid-tab').forEach(el => {
        el.classList.remove('is-drop-before', 'is-drop-after');
      });
    });
    btn.addEventListener('dragover', ev => {
      if (!ev.dataTransfer?.types.includes('application/x-mid-tab')) return;
      ev.preventDefault();
      // #309 — stop propagation so the document-level edge dragover doesn't
      // also paint a drop indicator while the user is hovering over a tab.
      ev.stopPropagation();
      if (splitDropIndicatorEl) splitDropIndicatorEl.hidden = true;
      ev.dataTransfer.dropEffect = 'move';
      const rect = btn.getBoundingClientRect();
      const before = ev.clientX < rect.left + rect.width / 2;
      target.querySelectorAll('.mid-tab').forEach(el => {
        el.classList.remove('is-drop-before', 'is-drop-after');
      });
      btn.classList.add(before ? 'is-drop-before' : 'is-drop-after');
    });
    btn.addEventListener('dragleave', () => {
      btn.classList.remove('is-drop-before', 'is-drop-after');
    });
    btn.addEventListener('drop', ev => {
      const raw = ev.dataTransfer?.getData('application/x-mid-tab');
      if (raw == null || raw === '') return;
      ev.preventDefault();
      // #309 — stop propagation so the document-level edge-drop handler
      // doesn't ALSO fire and try to split off the same tab.
      ev.stopPropagation();
      const from = parseInt(raw, 10);
      if (Number.isNaN(from)) return;
      const rect = btn.getBoundingClientRect();
      const before = ev.clientX < rect.left + rect.width / 2;
      const to = before ? idx : idx + 1;
      // #309 — drop into a different strip rehomes the dragged tab.
      const dragged = tabs[from];
      if (dragged && dragged.stripId !== stripId) {
        moveTabToStrip(from, to, stripId);
      } else {
        moveTab(from, to);
      }
    });

    btn.append(iconWrap, label, closeBtn);
    frag.appendChild(btn);
  });
  target.replaceChildren(frag);
  // Scroll the active tab into view (e.g. after Cmd+Alt+Right cycles past the
  // visible window).
  const activeEl = target.querySelector<HTMLElement>('.mid-tab.is-active');
  activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

/** #309 — context-menu helpers scoped to a single strip. The active strip is
 * promoted before the close so `closeTabAt`'s active-pointer logic stays
 * consistent. */
function closeOtherTabsInStrip(keepIdx: number, stripId: number): void {
  if (stripId !== activeStripId && splitActive) swapActiveColumn();
  if (keepIdx < 0 || keepIdx >= tabs.length) return;
  const keepPath = tabs[keepIdx].path;
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (tabs[i].stripId === stripId && tabs[i].path !== keepPath) closeTabAt(i);
  }
}

function closeAllTabsInStrip(stripId: number): void {
  if (stripId !== activeStripId && splitActive) swapActiveColumn();
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (tabs[i].stripId === stripId) closeTabAt(i);
  }
}

function schedulePersistTabs(): void {
  if (tabsHydrating) return;
  if (tabsPersistTimer !== null) window.clearTimeout(tabsPersistTimer);
  tabsPersistTimer = window.setTimeout(() => {
    tabsPersistTimer = null;
    // #309 — compute per-strip idx so the SQLite row's (strip_id, idx) primary
    // key stays unique. The global tab order in `tabs[]` doesn't matter at the
    // wire level — only ordering within a strip does.
    const perStripCounter: Record<number, number> = {};
    const rows = tabs.map((t, globalIdx) => {
      const stripIdx = perStripCounter[t.stripId] ?? 0;
      perStripCounter[t.stripId] = stripIdx + 1;
      // The "active" flag must be set per-strip — both the active and inactive
      // strips remember which of their tabs is focused.
      const isStripActive =
        (t.stripId === activeStripId && globalIdx === activeTabIndex) ||
        (t.stripId !== activeStripId && globalIdx === inactiveActiveTabIndex);
      return {
        strip_id: t.stripId,
        idx: stripIdx,
        path: t.path,
        active: isStripActive ? 1 : 0,
      };
    });
    void window.mid.tabsReplace(rows).catch(() => undefined);
    // Persist split-screen layout settings alongside the tab table.
    void window.mid.patchAppState({
      tabSplitActive: splitActive,
      tabSplitRatio,
      tabActiveStripId: activeStripId,
    } as Partial<AppState>).catch(() => undefined);
  }, 200);
}

/** Restore tabs from SQLite at startup. Best-effort: a missing file is dropped
 * silently so a restart doesn't crash the renderer.
 * #309 — also restores the active per-strip pointer for both columns and
 * promotes the second strip into split mode if it has at least one row. */
async function hydrateTabs(): Promise<void> {
  let rows: { strip_id: number; idx: number; path: string; active: number }[];
  try { rows = await window.mid.tabsList(); }
  catch { return; }
  if (!rows || rows.length === 0) return;
  tabsHydrating = true;
  // Track which global index in `tabs[]` is the active row for each strip so
  // we can rehydrate `activeTabIndex` AND `inactiveActiveTabIndex` correctly.
  const pendingActiveByStrip: Record<number, number> = {};
  const stripsSeen = new Set<number>();
  for (const r of rows) {
    try {
      const content = await window.mid.readFile(r.path);
      const tab: FileTab = { stripId: r.strip_id, path: r.path, text: content, dirty: false, scrollTop: 0 };
      tabs.push(tab);
      stripsSeen.add(r.strip_id);
      if (r.active) pendingActiveByStrip[r.strip_id] = tabs.length - 1;
    } catch {
      // file gone — skip it; the next persist will drop it from the table.
      continue;
    }
  }
  tabsHydrating = false;
  if (tabs.length === 0) return;
  // Determine each strip's active idx; fall back to the first tab in that strip.
  const firstInStrip = (s: number): number => tabs.findIndex(t => t.stripId === s);
  // The user's last-focused strip becomes `activeStripId`; if it's gone (the
  // strip emptied since persist), fall back to whichever strip has rows.
  const desiredActiveStrip = (typeof appStateTabActiveStripId === 'number' && stripsSeen.has(appStateTabActiveStripId))
    ? appStateTabActiveStripId
    : (stripsSeen.has(0) ? 0 : 1);
  activeStripId = desiredActiveStrip as 0 | 1;
  activeTabIndex = pendingActiveByStrip[activeStripId] ?? firstInStrip(activeStripId);
  if (activeTabIndex < 0) activeTabIndex = 0;
  // Inactive strip pointer: only meaningful if a second strip exists.
  const otherStrip = activeStripId === 0 ? 1 : 0;
  if (stripsSeen.has(otherStrip)) {
    inactiveActiveTabIndex = pendingActiveByStrip[otherStrip] ?? firstInStrip(otherStrip);
    splitActive = true;
  } else {
    inactiveActiveTabIndex = -1;
    splitActive = false;
  }
  syncMirrorFromActiveTab();
  highlightActiveTreeItem();
  updateWordCount();
  updateSaveIndicator(true);
  // #309 — if split mode rehydrated, ensure the column DOM exists before
  // rendering either strip. `enableSplitDOM` is idempotent.
  if (splitActive) enableSplitDOM();
  renderTabstrip();
  if (splitActive) renderInactiveColumn();
  // Re-render the editor area against the active tab.
  if (currentMode === 'view') renderView();
  else if (currentMode === 'edit') renderEdit();
  else renderSplit();
  // Persist a clean snapshot (drops missing files from the table).
  schedulePersistTabs();
}

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
        <button class="mid-welcome-action" data-welcome-action="connect-warehouse" ${currentFolder ? '' : 'disabled'}>
          ${iconHTML('github')}
          <span class="mid-welcome-action-label">Connect GitHub warehouse</span>
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
      else if (action === 'connect-warehouse') void openWarehouseOnboarding(true);
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

/**
 * #255 — secret note custom view.
 *
 * Renders a key/value editor where:
 *   - the value column is `type=password` by default + a "reveal" toggle,
 *   - each row has a copy button (clipboard.writeText) and a delete button,
 *   - "Add row" appends a new row,
 *   - secrets persist to YAML frontmatter (`secrets: { key: value }`) so the
 *     underlying `.md` file stays diff-friendly and human-readable. The body
 *     of the markdown is preserved verbatim — the secret editor only owns the
 *     frontmatter `secrets` key.
 *
 * Persistence is debounced: every mutation triggers a re-write of the file
 * via the same `mid:write-file` IPC the rest of the app uses, so notes
 * remain in sync with disk and the existing GitHub push flow Just Works.
 */
function renderSecretEditor(_note: NoteEntry, fullPath: string, content: string): void {
  root.classList.remove('viewing', 'editing', 'splitting');
  root.classList.add('typed-view');

  // Parse current secrets out of the frontmatter; tolerate missing/malformed.
  const fm = extractFrontmatter(content);
  const meta = (fm.meta ?? {}) as Record<string, unknown>;
  const secrets: Record<string, string> = {};
  if (meta.secrets && typeof meta.secrets === 'object' && !Array.isArray(meta.secrets)) {
    for (const [k, v] of Object.entries(meta.secrets as Record<string, unknown>)) {
      secrets[k] = String(v ?? '');
    }
  }
  const body = fm.body;

  const wrap = document.createElement('div');
  wrap.className = 'mid-secret-editor';

  const header = document.createElement('div');
  header.className = 'mid-secret-header';
  header.innerHTML = `
    <span class="mid-secret-header-icon">${iconHTML('lock', 'mid-icon--sm')}</span>
    <span class="mid-secret-header-title">Secret</span>
    <span class="mid-secret-header-hint">Stored as YAML frontmatter in this note's .md file</span>
  `;
  wrap.appendChild(header);

  const list = document.createElement('div');
  list.className = 'mid-secret-list';
  wrap.appendChild(list);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'mid-btn mid-secret-add';
  addBtn.innerHTML = `${iconHTML('plus', 'mid-icon--sm')}<span>Add row</span>`;
  addBtn.addEventListener('click', () => {
    appendRow('', '', true);
    persist();
  });
  wrap.appendChild(addBtn);

  // ── helpers ──────────────────────────────────────────────────────────────
  function persist(): void {
    const collected: Record<string, string> = {};
    for (const row of Array.from(list.children) as HTMLElement[]) {
      const k = (row.querySelector('.mid-secret-key') as HTMLInputElement | null)?.value.trim() ?? '';
      const v = (row.querySelector('.mid-secret-value') as HTMLInputElement | null)?.value ?? '';
      if (!k) continue; // skip empty keys to avoid YAML clutter
      collected[k] = v;
    }
    const nextMeta: Record<string, unknown> = { ...meta, secrets: collected };
    const yamlText = yaml.dump(nextMeta).trimEnd();
    const nextContent = `---\n${yamlText}\n---\n\n${body.replace(/^\n+/, '')}`;
    currentText = nextContent;
    void window.mid.writeFile(fullPath, nextContent).then(() => updateSaveIndicator(true));
  }

  function appendRow(initialKey: string, initialValue: string, focusKey: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mid-secret-row';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'mid-secret-key mid-settings-control';
    keyInput.placeholder = 'name (e.g. AWS_ACCESS_KEY)';
    keyInput.value = initialKey;
    keyInput.spellcheck = false;
    keyInput.autocomplete = 'off';

    const valueInput = document.createElement('input');
    valueInput.type = 'password';
    valueInput.className = 'mid-secret-value mid-settings-control';
    valueInput.placeholder = 'value';
    valueInput.value = initialValue;
    valueInput.spellcheck = false;
    valueInput.autocomplete = 'off';

    const revealBtn = document.createElement('button');
    revealBtn.type = 'button';
    revealBtn.className = 'mid-btn mid-btn--icon mid-btn--ghost';
    revealBtn.title = 'Show value';
    revealBtn.innerHTML = iconHTML('show', 'mid-icon--sm');
    revealBtn.addEventListener('click', () => {
      const isPwd = valueInput.type === 'password';
      valueInput.type = isPwd ? 'text' : 'password';
      revealBtn.title = isPwd ? 'Hide value' : 'Show value';
    });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'mid-btn mid-btn--icon mid-btn--ghost';
    copyBtn.title = 'Copy value';
    copyBtn.innerHTML = iconHTML('copy', 'mid-icon--sm');
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(valueInput.value).then(() => flashStatus('Copied'));
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'mid-btn mid-btn--icon mid-btn--ghost';
    delBtn.title = 'Delete row';
    delBtn.innerHTML = iconHTML('trash', 'mid-icon--sm');
    delBtn.addEventListener('click', () => {
      row.remove();
      persist();
    });

    keyInput.addEventListener('input', persist);
    valueInput.addEventListener('input', persist);
    keyInput.addEventListener('blur', persist);
    valueInput.addEventListener('blur', persist);

    row.append(keyInput, valueInput, revealBtn, copyBtn, delBtn);
    list.appendChild(row);
    if (focusKey) keyInput.focus();
    return row;
  }

  // Seed with existing entries; if none, leave the list empty (the user clicks
  // "Add row" to start) — avoids dropping a phantom empty row into a freshly
  // typed note.
  for (const [k, v] of Object.entries(secrets)) appendRow(k, v, false);

  root.replaceChildren(wrap);
  rebuildOutline(null);
}

/**
 * #295 — Task-list custom view.
 *
 * Renders a checklist editor over the same `.md` file. Each row is a `- [ ]`
 * or `- [x]` line; we parse the body on entry, render one editable row per
 * line, and persist back to markdown on every mutation so the underlying file
 * stays human-readable + diff-friendly + GitHub-renderable.
 *
 * Drag-to-reorder uses the HTML5 DnD API on the row element. We swap by
 * mutating the in-memory array and re-rendering rather than juggling DOM
 * positions directly — keeps state and view in sync and makes persist trivial.
 *
 * Frontmatter (if any) is preserved verbatim — the editor only owns the body.
 */
function renderTaskListEditor(_note: NoteEntry, fullPath: string, content: string): void {
  root.classList.remove('viewing', 'editing', 'splitting');
  root.classList.add('typed-view');

  const fm = extractFrontmatter(content);
  const body = fm.body;

  interface TaskItem { text: string; done: boolean; }
  const items: TaskItem[] = parseTaskMarkdown(body);

  const wrap = document.createElement('div');
  wrap.className = 'mid-task-editor';

  const header = document.createElement('div');
  header.className = 'mid-task-header';
  header.innerHTML = `
    <span class="mid-task-header-icon">${iconHTML('check-square', 'mid-icon--sm')}</span>
    <span class="mid-task-header-title">Task list</span>
    <span class="mid-task-header-hint">Each row is a <code>- [ ]</code> / <code>- [x]</code> line in the .md body.</span>
  `;
  wrap.appendChild(header);

  const list = document.createElement('div');
  list.className = 'mid-task-list';
  wrap.appendChild(list);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'mid-btn mid-task-add';
  addBtn.innerHTML = `${iconHTML('plus', 'mid-icon--sm')}<span>Add row</span>`;
  addBtn.addEventListener('click', () => {
    items.push({ text: '', done: false });
    rerender();
    persist();
    // Focus the new row's text input after the re-render.
    const rows = list.querySelectorAll<HTMLInputElement>('.mid-task-text');
    rows[rows.length - 1]?.focus();
  });
  wrap.appendChild(addBtn);

  function persist(): void {
    const taskBody = items
      .filter(i => i.text.trim() !== '' || items.length === 1)
      .map(i => `- [${i.done ? 'x' : ' '}] ${i.text}`)
      .join('\n');
    let next: string;
    if (fm.meta) {
      const yamlText = yaml.dump(fm.meta).trimEnd();
      next = `---\n${yamlText}\n---\n\n${taskBody}\n`;
    } else {
      next = `${taskBody}\n`;
    }
    currentText = next;
    void window.mid.writeFile(fullPath, next).then(() => updateSaveIndicator(true));
  }

  function rerender(): void {
    list.replaceChildren();
    items.forEach((item, idx) => list.appendChild(buildRow(item, idx)));
  }

  // Track drag-source index via a closure-shared variable rather than the
  // DataTransfer object, which is read-only outside the dragstart handler in
  // some Chromium configurations.
  let dragFromIdx: number | null = null;

  function buildRow(item: TaskItem, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mid-task-row';
    row.draggable = true;
    row.dataset.idx = String(idx);

    const handle = document.createElement('span');
    handle.className = 'mid-task-handle';
    handle.title = 'Drag to reorder';
    handle.textContent = '⋮⋮';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'mid-task-check';
    checkbox.checked = item.done;
    checkbox.addEventListener('change', () => {
      item.done = checkbox.checked;
      row.classList.toggle('is-done', item.done);
      persist();
    });

    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'mid-task-text mid-settings-control';
    text.value = item.text;
    text.placeholder = 'Task…';
    text.addEventListener('input', () => { item.text = text.value; });
    text.addEventListener('blur', persist);
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        items.splice(idx + 1, 0, { text: '', done: false });
        rerender();
        persist();
        const rows = list.querySelectorAll<HTMLInputElement>('.mid-task-text');
        rows[idx + 1]?.focus();
      } else if (e.key === 'Backspace' && text.value === '' && items.length > 1) {
        e.preventDefault();
        items.splice(idx, 1);
        rerender();
        persist();
        const rows = list.querySelectorAll<HTMLInputElement>('.mid-task-text');
        rows[Math.max(0, idx - 1)]?.focus();
      }
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mid-btn mid-btn--icon mid-btn--ghost';
    del.title = 'Delete row';
    del.innerHTML = iconHTML('trash', 'mid-icon--sm');
    del.addEventListener('click', () => {
      items.splice(idx, 1);
      rerender();
      persist();
    });

    if (item.done) row.classList.add('is-done');
    row.append(handle, checkbox, text, del);

    row.addEventListener('dragstart', e => {
      dragFromIdx = idx;
      row.classList.add('is-dragging');
      // Required for Firefox to actually fire dragover.
      try { e.dataTransfer?.setData('text/plain', String(idx)); } catch { /* ignore */ }
    });
    row.addEventListener('dragend', () => {
      dragFromIdx = null;
      row.classList.remove('is-dragging');
      list.querySelectorAll('.mid-task-row').forEach(r => r.classList.remove('is-drop-target'));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      row.classList.add('is-drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('is-drop-target');
      if (dragFromIdx === null || dragFromIdx === idx) return;
      const [moved] = items.splice(dragFromIdx, 1);
      items.splice(idx, 0, moved);
      dragFromIdx = null;
      rerender();
      persist();
    });

    return row;
  }

  rerender();
  root.replaceChildren(wrap);
  rebuildOutline(null);
}

interface TaskItemParse { text: string; done: boolean; }
/**
 * Pull `- [ ]` and `- [x]` lines out of a markdown body. Non-task lines are
 * dropped — the task-list view owns the file body once active. If a user
 * mixes prose with tasks, switching back to the markdown editor (via the
 * Change Type menu) is the explicit escape hatch.
 */
function parseTaskMarkdown(body: string): TaskItemParse[] {
  const out: TaskItemParse[] = [];
  const rx = /^\s*[-*+]\s*\[(?<state>[ xX])\]\s?(?<text>.*)$/;
  for (const line of body.split(/\r?\n/)) {
    const m = rx.exec(line);
    if (!m || !m.groups) continue;
    out.push({ done: m.groups.state.toLowerCase() === 'x', text: m.groups.text });
  }
  return out;
}

/**
 * #296 — Meeting custom view.
 *
 * Structured meeting form on top of the markdown file:
 *   - Frontmatter (`date`, `attendees`, `location`, `decisions`) holds the
 *     metadata so external tools can grep / filter on it.
 *   - Body holds two free-form markdown areas: Agenda and Notes, separated by
 *     `## Agenda` / `## Notes` headings so the file stays a usable artifact
 *     even when opened in another editor.
 *
 * Persistence is debounced via `setTimeout` for the markdown areas (300ms)
 * since they fire `input` on every keystroke; chip / date / location fields
 * persist on `change` / blur.
 */
function renderMeetingEditor(_note: NoteEntry, fullPath: string, content: string): void {
  root.classList.remove('viewing', 'editing', 'splitting');
  root.classList.add('typed-view');

  const fm = extractFrontmatter(content);
  const meta = (fm.meta ?? {}) as Record<string, unknown>;
  const date = typeof meta.date === 'string' ? meta.date : (meta.date instanceof Date ? meta.date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const attendees: string[] = Array.isArray(meta.attendees) ? (meta.attendees as unknown[]).map(String) : [];
  const location = typeof meta.location === 'string' ? meta.location : '';
  const decisions: string[] = Array.isArray(meta.decisions) ? (meta.decisions as unknown[]).map(String) : [];

  const { agenda, notes } = splitAgendaNotes(fm.body);

  const wrap = document.createElement('div');
  wrap.className = 'mid-meeting-editor';

  const header = document.createElement('div');
  header.className = 'mid-meeting-header';
  header.innerHTML = `
    <span class="mid-meeting-header-icon">${iconHTML('calendar', 'mid-icon--sm')}</span>
    <span class="mid-meeting-header-title">Meeting</span>
    <span class="mid-meeting-header-hint">Metadata persists as YAML frontmatter; agenda + notes live in the body.</span>
  `;
  wrap.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'mid-meeting-grid';
  wrap.appendChild(grid);

  // Date
  const dateLabel = document.createElement('label');
  dateLabel.className = 'mid-meeting-field';
  dateLabel.innerHTML = '<span class="mid-meeting-field-label">Date</span>';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'mid-settings-control';
  dateInput.value = date;
  dateInput.addEventListener('change', persist);
  dateLabel.appendChild(dateInput);
  grid.appendChild(dateLabel);

  // Location
  const locLabel = document.createElement('label');
  locLabel.className = 'mid-meeting-field';
  locLabel.innerHTML = '<span class="mid-meeting-field-label">Location</span>';
  const locInput = document.createElement('input');
  locInput.type = 'text';
  locInput.className = 'mid-settings-control';
  locInput.placeholder = 'Zoom / Office / …';
  locInput.value = location;
  locInput.addEventListener('blur', persist);
  locLabel.appendChild(locInput);
  grid.appendChild(locLabel);

  // Attendees (chips)
  const attLabel = document.createElement('div');
  attLabel.className = 'mid-meeting-field mid-meeting-field--full';
  attLabel.innerHTML = '<span class="mid-meeting-field-label">Attendees</span>';
  const attChips = buildChipEditor(attendees, persist, 'Add attendee…');
  attLabel.appendChild(attChips.el);
  grid.appendChild(attLabel);

  // Agenda (markdown textarea)
  const agendaLabel = document.createElement('div');
  agendaLabel.className = 'mid-meeting-field mid-meeting-field--full';
  agendaLabel.innerHTML = '<span class="mid-meeting-field-label">Agenda</span>';
  const agendaTa = document.createElement('textarea');
  agendaTa.className = 'mid-meeting-textarea mid-settings-control';
  agendaTa.placeholder = '- Topic 1\n- Topic 2';
  agendaTa.value = agenda;
  agendaTa.rows = 5;
  agendaTa.addEventListener('input', schedulePersist);
  agendaTa.addEventListener('blur', persist);
  agendaLabel.appendChild(agendaTa);
  grid.appendChild(agendaLabel);

  // Notes (markdown textarea)
  const notesLabel = document.createElement('div');
  notesLabel.className = 'mid-meeting-field mid-meeting-field--full';
  notesLabel.innerHTML = '<span class="mid-meeting-field-label">Notes</span>';
  const notesTa = document.createElement('textarea');
  notesTa.className = 'mid-meeting-textarea mid-settings-control';
  notesTa.placeholder = 'Free-form meeting notes (markdown).';
  notesTa.value = notes;
  notesTa.rows = 8;
  notesTa.addEventListener('input', schedulePersist);
  notesTa.addEventListener('blur', persist);
  notesLabel.appendChild(notesTa);
  grid.appendChild(notesLabel);

  // Decisions (chips)
  const decLabel = document.createElement('div');
  decLabel.className = 'mid-meeting-field mid-meeting-field--full';
  decLabel.innerHTML = '<span class="mid-meeting-field-label">Decisions</span>';
  const decChips = buildChipEditor(decisions, persist, 'Add decision…');
  decLabel.appendChild(decChips.el);
  grid.appendChild(decLabel);

  let persistTimer: number | null = null;
  function schedulePersist(): void {
    if (persistTimer !== null) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => { persist(); persistTimer = null; }, 300);
  }

  function persist(): void {
    if (persistTimer !== null) { window.clearTimeout(persistTimer); persistTimer = null; }
    const nextMeta: Record<string, unknown> = {
      ...meta,
      date: dateInput.value,
      attendees: attChips.values(),
      location: locInput.value,
      decisions: decChips.values(),
    };
    const yamlText = yaml.dump(nextMeta).trimEnd();
    const body = `## Agenda\n\n${agendaTa.value.trim()}\n\n## Notes\n\n${notesTa.value.trim()}\n`;
    const next = `---\n${yamlText}\n---\n\n${body}`;
    currentText = next;
    void window.mid.writeFile(fullPath, next).then(() => updateSaveIndicator(true));
  }

  root.replaceChildren(wrap);
  rebuildOutline(null);
}

/**
 * Split a meeting body into the `## Agenda` and `## Notes` sections. If the
 * file has no headings (e.g. a freshly created note imported from elsewhere),
 * the entire body becomes the Notes section so we don't lose content.
 */
function splitAgendaNotes(body: string): { agenda: string; notes: string } {
  const agendaRx = /^##\s*Agenda\s*$/im;
  const notesRx = /^##\s*Notes\s*$/im;
  const agendaMatch = agendaRx.exec(body);
  const notesMatch = notesRx.exec(body);
  if (!agendaMatch && !notesMatch) {
    return { agenda: '', notes: body.replace(/^#\s+.+\n+/, '').trim() };
  }
  let agenda = '';
  let notes = '';
  if (agendaMatch && notesMatch) {
    if (agendaMatch.index < notesMatch.index) {
      agenda = body.slice(agendaMatch.index + agendaMatch[0].length, notesMatch.index).trim();
      notes = body.slice(notesMatch.index + notesMatch[0].length).trim();
    } else {
      notes = body.slice(notesMatch.index + notesMatch[0].length, agendaMatch.index).trim();
      agenda = body.slice(agendaMatch.index + agendaMatch[0].length).trim();
    }
  } else if (agendaMatch) {
    agenda = body.slice(agendaMatch.index + agendaMatch[0].length).trim();
  } else if (notesMatch) {
    notes = body.slice(notesMatch.index + notesMatch[0].length).trim();
  }
  return { agenda, notes };
}

interface ChipEditor { el: HTMLElement; values(): string[]; }
/**
 * Generic chip editor used by the meeting view for attendees / decisions.
 * Returns the wrapper element and a `values()` accessor for persistence.
 */
function buildChipEditor(initial: string[], onChange: () => void, placeholder: string): ChipEditor {
  const list = initial.slice();
  const wrap = document.createElement('div');
  wrap.className = 'mid-chip-editor';

  const chipsBox = document.createElement('div');
  chipsBox.className = 'mid-chip-editor-chips';
  wrap.appendChild(chipsBox);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'mid-chip-editor-input mid-settings-control';
  input.placeholder = placeholder;
  wrap.appendChild(input);

  function commit(value: string): void {
    const v = value.trim();
    if (!v) return;
    list.push(v);
    input.value = '';
    rerender();
    onChange();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(input.value);
    } else if (e.key === 'Backspace' && input.value === '' && list.length > 0) {
      list.pop();
      rerender();
      onChange();
    }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) commit(input.value); });

  function rerender(): void {
    chipsBox.replaceChildren();
    list.forEach((value, idx) => {
      const chip = document.createElement('span');
      chip.className = 'mid-chip';
      const text = document.createElement('span');
      text.textContent = value;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mid-chip-remove';
      remove.title = 'Remove';
      remove.innerHTML = iconHTML('x', 'mid-icon--sm');
      remove.addEventListener('click', () => {
        list.splice(idx, 1);
        rerender();
        onChange();
      });
      chip.append(text, remove);
      chipsBox.appendChild(chip);
    });
  }
  rerender();

  return { el: wrap, values: () => list.slice() };
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
    // #287 — mark the active tab dirty + flash the strip so the unsaved dot
    // appears immediately as the user types.
    const t = activeTab();
    if (t && (t.text !== ta.value || !t.dirty)) {
      t.text = ta.value;
      if (!t.dirty) { t.dirty = true; renderTabstrip(); }
    }
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
  // #255 — typed views own the root element; the markdown view/edit/split
  // toggles don't apply. We still update the segmented-control affordance so
  // the UI doesn't look stuck, but we leave the typed editor in place.
  if (typedViewActive) {
    if (mode === 'view') hideCursor();
    rebuildOutline(null);
    return;
  }
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
  // #255 — opening any non-typed file flips out of a typed view; without this
  // the markdown editor would never come back after the user clicked away
  // from a secret note via the file tree.
  typedViewActive = false;
  // #287 — route the open through the tab manager. `openTab` either focuses an
  // existing tab (preserving its dirty edits) or appends a new one and makes
  // it active. We then mirror the active-tab state into the legacy globals so
  // the rest of the renderer keeps reading/writing through `currentText` and
  // `currentPath` unchanged.
  openTab(filePath, content);
  syncMirrorFromActiveTab();
  highlightActiveTreeItem();
  setMode(currentMode);
  updateWordCount();
  updateSaveIndicator(!activeTab()?.dirty);
  restoreScrollPosition();
  renderTabstrip();
  schedulePersistTabs();
  pushRecent(filePath);
}

async function selectTreeFile(filePath: string): Promise<void> {
  const content = await window.mid.readFile(filePath);
  loadFileContent(filePath, content);
}

async function openFolder(): Promise<void> {
  const result = await window.mid.openFolderDialog();
  if (!result) return;
  // The dialog returns the tree pre-fetched, so no extra loader needed here.
  // Cache it so a subsequent switchWorkspace to the same folder is instant.
  treeCache.set(result.folderPath, result.tree);
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
      createRow.innerHTML = `${iconHTML('plus', 'mid-icon--sm mid-icon--muted')}<span class="mid-spotlight-row-body"><span class="mid-spotlight-row-name">Create new repo…</span><span class="mid-spotlight-row-desc">${q ? escapeHTML(q) : 'enter name'}</span></span>`;
      createRow.addEventListener('click', () => { void onCreateNew(q || ''); });
      results.appendChild(createRow);
      for (const r of matches.slice(0, 50)) {
        const row = document.createElement('button');
        row.className = 'mid-spotlight-row';
        row.innerHTML = `${iconHTML('github', 'mid-icon--sm mid-icon--muted')}<span class="mid-spotlight-row-body"><span class="mid-spotlight-row-name">${escapeHTML(r.nameWithOwner)}</span><span class="mid-spotlight-row-desc">${escapeHTML(r.visibility?.toLowerCase() ?? '')}</span></span>`;
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
  if (!currentFolder) {
    console.debug('[mid] onboarding skip: no current folder');
    return false;
  }
  const wsId = workspaceIdForCurrent();
  if (!wsId) {
    console.debug('[mid] onboarding skip: no workspace id');
    return false;
  }
  try {
    const existing = await window.mid.warehousesList(currentFolder);
    if (existing.length > 0) {
      console.debug('[mid] onboarding skip: warehouse already configured', existing);
      return false;
    }
  } catch (err) { console.debug('[mid] warehousesList error (treating as none):', err); }
  const state = await window.mid.readAppState();
  const dismissed = Array.isArray(state.warehouseOnboardingDismissed) ? state.warehouseOnboardingDismissed : [];
  if (dismissed.includes(wsId)) {
    console.debug('[mid] onboarding skip: workspace previously dismissed', wsId);
    return false;
  }
  console.debug('[mid] onboarding will show for workspace', wsId);
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

async function openWarehouseOnboarding(force = false, blocking = false): Promise<void> {
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
  // #314 — when launched as blocking middleware (no warehouse yet), the user
  // cannot dismiss with Skip / X / Esc / backdrop. The flow only ends when
  // a warehouse is persisted (github or local).
  skipBtn.hidden = blocking;
  closeBtn.hidden = blocking;

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

  const onSkip = (): void => { if (!blocking) closeOnboarding(true); };
  const onCancel = (e: Event): void => {
    e.preventDefault();
    // Esc / backdrop is honored as Skip ONLY when not blocking.
    if (!blocking) closeOnboarding(true);
  };

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
      <div class="mid-onboarding-card">
        <div class="mid-onboarding-card-title">${iconHTML('folder', 'mid-icon--sm')} Or use a local folder</div>
        <p class="mid-onboarding-card-hint">No GitHub. Notes sync to a folder you pick — works for users who only want local backup or use a different sync mechanism (iCloud / Dropbox / Syncthing).</p>
        <div class="mid-onboarding-actions">
          <button class="mid-btn" data-onboarding-action="pick-local">${iconHTML('folder', 'mid-icon--sm')} Pick a folder…</button>
        </div>
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
    body.querySelector<HTMLButtonElement>('[data-onboarding-action="pick-local"]')?.addEventListener('click', async () => {
      // #314 — local-folder warehouse. Persisted with `repo: 'local:<path>'`
      // so the rest of the system can detect non-GitHub warehouses by prefix
      // and skip remote-only operations (push / pull / device-flow).
      const picked = await window.mid.openFolderDialog();
      if (!picked) return;
      await persistAndConnect(`local:${picked.folderPath}`);
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

  // Intro page — shown first so users understand what a "warehouse" is before
  // any technical UI. Hides the 3-step rail and replaces the footer with a
  // single "Set up warehouse" CTA. Clicking it transitions into the gh-CLI step.
  const renderIntroStep = (): void => {
    stepsEl.hidden = true;
    backBtn.hidden = true;
    nextBtn.hidden = false;
    nextBtn.disabled = false;
    nextBtn.textContent = 'Set up warehouse';
    body.innerHTML = `
      <div class="mid-onboarding-intro">
        <div class="mid-onboarding-intro-glyph">${iconHTML('github', 'mid-icon--lg')}</div>
        <h2>Set up your notes warehouse</h2>
        <p>A warehouse is a private GitHub repo where Mark It Down syncs your notes. You'll always own the data, version history, and can read it from anywhere — terminal, web, mobile.</p>
        <ul class="mid-onboarding-intro-checks">
          <li>${iconHTML('check', 'mid-icon--sm')} Private repo by default</li>
          <li>${iconHTML('check', 'mid-icon--sm')} You can pick an existing repo or create a new one</li>
          <li>${iconHTML('check', 'mid-icon--sm')} Skip for now and connect later from the status bar</li>
        </ul>
      </div>
    `;
    nextBtn.onclick = (): void => {
      stepsEl.hidden = false;
      nextBtn.textContent = 'Next';
      nextBtn.onclick = null;
      state.step = 'gh';
      refreshStepsHeader();
      void renderGhStep();
    };
  };

  skipBtn.addEventListener('click', onSkip);
  closeBtn.addEventListener('click', onSkip);
  backBtn.addEventListener('click', onBack);
  nextBtn.addEventListener('click', onNext);
  dlg.addEventListener('cancel', onCancel);

  refreshStepsHeader();
  if (!dlg.open) dlg.showModal();
  renderIntroStep();
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
    // #287 — clear the active tab's dirty bit + refresh the strip so the dot
    // disappears immediately on save.
    const t = activeTab();
    if (t) { t.text = currentText; t.dirty = false; renderTabstrip(); }
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
  // Delayed-show loader: only flash the spinner if indexing takes >150ms,
  // so cached / instant returns don't visually blip.
  const showAt = window.setTimeout(() => showTreeIndexing(folderPath), 150);
  try {
    const tree = await window.mid.listFolderMd(folderPath);
    treeCache.set(folderPath, tree);
    return tree;
  } finally {
    window.clearTimeout(showAt);
    hideTreeIndexing();
  }
}

function showTreeIndexing(folderPath: string): void {
  if (!treeRoot) return;
  const name = folderPath.split('/').pop() ?? folderPath;
  treeRoot.replaceChildren();
  const overlay = document.createElement('div');
  overlay.className = 'mid-tree-indexing';
  overlay.id = 'mid-tree-indexing';
  overlay.innerHTML = `<div class="mid-tree-indexing-spinner"></div><div class="mid-tree-indexing-label">Indexing ${escapeHTML(name)}…</div>`;
  treeRoot.appendChild(overlay);
}

function hideTreeIndexing(): void {
  document.getElementById('mid-tree-indexing')?.remove();
}

function invalidateTreeCache(folderPath?: string): void {
  if (folderPath) treeCache.delete(folderPath);
  else treeCache.clear();
}

function renderClusterFileRow(pin: PinnedFolder, filePath: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'mid-tree-item mid-tree-item--cluster';
  if (currentPath === filePath) item.classList.add('is-active');
  // Match the chevron-padded layout of regular tree rows so file names align.
  item.insertAdjacentHTML('beforeend', '<span class="mid-tree-chevron"></span>');
  const fileMatch = iconForFile(filePath.split('/').pop() ?? '', 'file');
  const iconSpan = document.createElement('span');
  iconSpan.innerHTML = iconHTML(fileMatch.icon, 'mid-icon--muted mid-tree-icon');
  const svg = iconSpan.firstElementChild as HTMLElement | null;
  if (svg && fileMatch.color) svg.style.color = fileMatch.color;
  item.appendChild(iconSpan.firstElementChild!);
  item.appendChild(document.createTextNode(` ${filePath.split('/').pop() ?? filePath}`));
  item.title = filePath;
  item.addEventListener('click', () => void selectTreeFile(filePath));
  item.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu([
      { icon: 'show', label: 'Open', action: () => void selectTreeFile(filePath) },
      { icon: 'folder-open', label: 'Reveal in Finder', action: () => void window.mid.openExternal(`file://${filePath.replace(/\/[^/]+$/, '')}`) },
      { separator: true, label: '' },
      { icon: 'trash', label: 'Remove from pin', action: () => {
        pin.files = (pin.files ?? []).filter(f => f !== filePath);
        void window.mid.patchAppState({ pinnedFolders });
        if (activeActivity === `pinned:${pin.path}`) void loadPinnedTree(pin.path);
      } },
    ], e.clientX, e.clientY);
  });
  return item;
}

async function loadPinnedTree(folderPath: string): Promise<void> {
  try {
    const pin = pinnedFolders.find(p => p.path === folderPath);
    const name = pin?.name ?? folderPath.split('/').pop() ?? folderPath;
    sidebarFolderName.textContent = name;
    sidebarFolderName.title = folderPath;
    treeRoot.replaceChildren();

    // v2 (#189): hybrid display — assigned cluster files render in their own
    // section above the folder tree. Files can live anywhere on disk; the
    // folder tree below keeps the directory listing intact.
    if (pin && pin.files && pin.files.length > 0) {
      const section = document.createElement('div');
      section.className = 'mid-tree-section mid-tree-section--cluster';
      const header = document.createElement('div');
      header.className = 'mid-tree-section-header';
      header.textContent = `Pinned files (${pin.files.length})`;
      section.appendChild(header);
      for (const filePath of pin.files) {
        section.appendChild(renderClusterFileRow(pin, filePath));
      }
      treeRoot.appendChild(section);
    }

    // Folder subtree below — same listing as before so users can browse and
    // drag additional files into the cluster from this view too.
    const tree = await loadFolderTree(folderPath);
    if (tree.length > 0) {
      const folderSection = document.createElement('div');
      folderSection.className = 'mid-tree-section mid-tree-section--folder';
      if (pin && pin.files && pin.files.length > 0) {
        const header = document.createElement('div');
        header.className = 'mid-tree-section-header';
        header.textContent = 'Folder contents';
        folderSection.appendChild(header);
      }
      folderSection.append(...renderTree(tree));
      treeRoot.appendChild(folderSection);
    } else if (!pin || !pin.files || pin.files.length === 0) {
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
    btn.addEventListener('dragend', () => btn.classList.remove('is-dragging', 'is-drop-target', 'is-file-drop-target'));
    // v2 (#189): differentiate file-assignment drop vs pin-reorder drop visually.
    // dataTransfer.getData() returns "" during dragover for security; dataTransfer.types
    // is the spec-blessed way to peek at what the drag carries.
    const dragOver = (e: DragEvent): void => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const types = Array.from(dt.types ?? []);
      const isFile = types.includes('application/x-mid-file');
      const isPin = types.includes('application/x-mid-pin');
      if (!isFile && !isPin) return;
      e.preventDefault();
      btn.classList.toggle('is-file-drop-target', isFile);
      btn.classList.toggle('is-drop-target', !isFile && isPin);
      if (dt.dropEffect !== undefined) dt.dropEffect = isFile ? 'link' : 'move';
    };
    btn.addEventListener('dragenter', dragOver);
    btn.addEventListener('dragover', dragOver);
    btn.addEventListener('dragleave', () => btn.classList.remove('is-drop-target', 'is-file-drop-target'));
    btn.addEventListener('drop', e => {
      e.preventDefault();
      btn.classList.remove('is-drop-target', 'is-file-drop-target');
      const dt = e.dataTransfer;
      if (!dt) return;
      // File drop → register in cluster
      const filePath = dt.getData('application/x-mid-file');
      if (filePath) {
        const target = pinnedFolders[idx];
        const before = (target.files ?? []).length;
        target.files = Array.from(new Set([...(target.files ?? []), filePath]));
        if (target.files.length === before) {
          flashStatus(`${filePath.split('/').pop()} already in "${target.name}"`);
          return;
        }
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
type SpotlightItemKind = 'file' | 'heading' | 'line';
interface SpotlightItem {
  kind: SpotlightItemKind;
  /** Group label rendered as a section heading. */
  group: string;
  /** Display name (matched chars get highlighted). */
  name: string;
  /** Secondary text rendered on the right (path / line number / etc). */
  meta: string;
  /** The match span [start, end) inside `name`. -1/-1 = no highlight. */
  matchStart: number;
  matchEnd: number;
  /** Action triggered on Enter / click. */
  activate: () => void;
}

function spotlightFuzzyMatchSpan(haystack: string, needle: string): { start: number; end: number } {
  if (!needle) return { start: -1, end: -1 };
  const i = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return { start: -1, end: -1 };
  return { start: i, end: i + needle.length };
}

function spotlightHighlightedName(name: string, start: number, end: number): string {
  if (start < 0 || end <= start) return escapeHTML(name);
  const before = escapeHTML(name.slice(0, start));
  const hit = escapeHTML(name.slice(start, end));
  const after = escapeHTML(name.slice(end));
  return `${before}<span class="mid-spotlight-match">${hit}</span>${after}`;
}

function openSpotlight(): void {
  const dlg = document.getElementById('mid-spotlight') as HTMLDialogElement;
  const input = document.getElementById('mid-spotlight-input') as HTMLInputElement;
  const results = document.getElementById('mid-spotlight-results') as HTMLDivElement;
  const footer = document.getElementById('mid-spotlight-footer') as HTMLDivElement | null;
  const tabs = dlg.querySelectorAll<HTMLButtonElement>('.mid-spotlight-tab');
  const inputIcon = document.getElementById('mid-spotlight-input-icon') as HTMLSpanElement | null;
  // Reset tabs + footer + placeholder (history viewer / repo picker mutate these).
  tabs.forEach(t => { t.style.display = ''; });
  if (footer) footer.style.display = '';
  if (inputIcon && !inputIcon.firstChild) {
    inputIcon.innerHTML = iconHTML('search', 'mid-icon--sm mid-icon--muted');
  }
  input.placeholder = 'Type to search…';

  let scope: 'workspace' | 'file' = 'workspace';
  let workspaceFiles: { path: string; name: string }[] = [];
  let activeIndex = 0;
  let flat: SpotlightItem[] = [];
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

  const buildItems = (): SpotlightItem[] => {
    const q = input.value.trim();
    const ql = q.toLowerCase();
    const items: SpotlightItem[] = [];

    if (scope === 'workspace') {
      // Recent items only when query is empty.
      if (!q) {
        const recents = recentFiles
          .filter(p => !currentFolder || p.startsWith(currentFolder))
          .slice(0, 5);
        for (const p of recents) {
          const name = p.split('/').pop() ?? p;
          const rel = currentFolder ? p.replace(currentFolder, '').replace(/^\//, '') : p;
          items.push({
            kind: 'file',
            group: 'Recent',
            name,
            meta: rel,
            matchStart: -1,
            matchEnd: -1,
            activate: () => { close(); void openRecent(p); },
          });
        }
      }

      const matches = q
        ? workspaceFiles.filter(f => f.name.toLowerCase().includes(ql) || f.path.toLowerCase().includes(ql))
        : workspaceFiles;
      for (const m of matches.slice(0, 50)) {
        const span = spotlightFuzzyMatchSpan(m.name, q);
        const rel = currentFolder ? m.path.replace(currentFolder, '').replace(/^\//, '') : m.path;
        items.push({
          kind: 'file',
          group: 'Files',
          name: m.name,
          meta: rel,
          matchStart: span.start,
          matchEnd: span.end,
          activate: () => { close(); void openRecent(m.path); },
        });
      }
    } else {
      if (!currentText) return items;
      if (!q) return items;
      const lines = currentText.split('\n');
      const headings: SpotlightItem[] = [];
      const lineHits: SpotlightItem[] = [];
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        if (!text.toLowerCase().includes(ql)) continue;
        const trimmed = text.trim();
        const display = trimmed.slice(0, 100);
        const span = spotlightFuzzyMatchSpan(display, q);
        const isHeading = /^#+\s/.test(text);
        const lineNum = i + 1;
        const item: SpotlightItem = {
          kind: isHeading ? 'heading' : 'line',
          group: isHeading ? 'Headings' : 'Lines',
          name: display,
          meta: `L${lineNum}`,
          matchStart: span.start,
          matchEnd: span.end,
          activate: () => { close(); flashStatus(`Match at line ${lineNum}`); },
        };
        if (isHeading) headings.push(item);
        else lineHits.push(item);
        if (headings.length + lineHits.length >= 100) break;
      }
      items.push(...headings, ...lineHits);
    }
    return items;
  };

  const renderResults = (): void => {
    flat = buildItems();
    if (activeIndex >= flat.length) activeIndex = Math.max(0, flat.length - 1);
    results.replaceChildren();

    if (flat.length === 0) {
      const q = input.value.trim();
      const empty = document.createElement('div');
      empty.className = 'mid-spotlight-empty';
      if (scope === 'workspace') {
        empty.textContent = q ? 'No files match.' : 'Type to search workspace files.';
      } else if (!currentText) {
        empty.textContent = 'No active document.';
      } else if (!q) {
        empty.textContent = 'Type to search the active document.';
      } else {
        empty.textContent = 'No matches in this file.';
      }
      results.appendChild(empty);
      return;
    }

    let lastGroup = '';
    let section: HTMLDivElement | null = null;
    flat.forEach((item, idx) => {
      if (item.group !== lastGroup) {
        section = document.createElement('div');
        section.className = 'mid-spotlight-section';
        const label = document.createElement('div');
        label.className = 'mid-spotlight-section-label';
        label.textContent = item.group;
        section.appendChild(label);
        results.appendChild(section);
        lastGroup = item.group;
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mid-spotlight-row' + (idx === activeIndex ? ' is-active' : '');
      const iconKey = item.kind === 'heading' ? 'list-ul' : item.kind === 'line' ? 'search' : 'file';
      const descHTML = item.meta
        ? `<span class="mid-spotlight-row-desc">${escapeHTML(item.meta)}</span>`
        : '';
      row.innerHTML =
        `${iconHTML(iconKey, 'mid-icon--sm mid-icon--muted')}` +
        `<span class="mid-spotlight-row-body">` +
          `<span class="mid-spotlight-row-name">${spotlightHighlightedName(item.name, item.matchStart, item.matchEnd)}</span>` +
          descHTML +
        `</span>`;
      row.addEventListener('click', () => item.activate());
      row.addEventListener('mouseenter', () => {
        activeIndex = idx;
        results.querySelectorAll('.mid-spotlight-row.is-active').forEach(el => el.classList.remove('is-active'));
        row.classList.add('is-active');
      });
      section!.appendChild(row);
    });
  };

  const scrollActiveIntoView = (): void => {
    const el = results.querySelector<HTMLElement>('.mid-spotlight-row.is-active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  };

  const setActive = (next: number): void => {
    if (flat.length === 0) return;
    const max = flat.length;
    activeIndex = ((next % max) + max) % max; // wrap-around
    results.querySelectorAll('.mid-spotlight-row').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeIndex);
    });
    scrollActiveIntoView();
  };

  const onInput = (): void => {
    if (renderTimer !== null) window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      activeIndex = 0;
      renderResults();
    }, 80);
  };
  const setScope = (s: 'workspace' | 'file'): void => {
    scope = s;
    tabs.forEach(t => t.classList.toggle('is-active', t.dataset.spotlightScope === s));
    activeIndex = 0;
    renderResults();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!dlg.open) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      setScope(scope === 'workspace' ? 'file' : 'workspace');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) item.activate();
      return;
    }
  };
  const onBackdrop = (e: MouseEvent): void => {
    if (e.target === dlg) close();
  };
  const onTab = (e: Event): void => setScope((e.currentTarget as HTMLButtonElement).dataset.spotlightScope as 'workspace' | 'file');
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (renderTimer !== null) { window.clearTimeout(renderTimer); renderTimer = null; }
    input.removeEventListener('input', onInput);
    document.removeEventListener('keydown', onKey);
    dlg.removeEventListener('click', onBackdrop);
    tabs.forEach(t => t.removeEventListener('click', onTab));
    if (dlg.open) dlg.close();
  };

  input.value = '';
  input.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  dlg.addEventListener('click', onBackdrop);
  tabs.forEach(t => t.addEventListener('click', onTab));
  // Workspace tab visually default-active even after a previous reuse mutated state.
  tabs.forEach(t => t.classList.toggle('is-active', t.dataset.spotlightScope === 'workspace'));
  dlg.showModal();
  renderResults();
  void collectWorkspaceFiles().then(() => { if (!closed) renderResults(); });
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

// Tab manager keyboard shortcuts (#287). We intentionally listen at document
// level so the bindings fire from inside the textarea editor too. Cmd+Shift+T
// pulls the most-recently-closed tab back; Cmd+W closes the active tab; the
// Cmd+Alt+Arrow pair cycles, matching VSCode's "Next/Previous Editor in Group".
document.addEventListener('keydown', e => {
  const isMod = e.metaKey || e.ctrlKey;
  if (!isMod) return;
  // Cmd/Ctrl+W — close active tab. (Electron's accelerator system also closes
  // the window with the same chord; the tab close runs first via this DOM
  // listener and we preventDefault to swallow the menu accelerator.)
  if (e.key.toLowerCase() === 'w' && !e.shiftKey && !e.altKey) {
    if (tabs.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      closeTabAt(activeTabIndex);
    }
    return;
  }
  // Cmd/Ctrl+Shift+T — reopen the most-recently-closed tab.
  if (e.key.toLowerCase() === 't' && e.shiftKey && !e.altKey) {
    e.preventDefault();
    void reopenLastClosedTab();
    return;
  }
  // Cmd/Ctrl+Alt+ArrowRight / ArrowLeft — cycle tabs.
  if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    if (tabs.length > 1) {
      e.preventDefault();
      cycleTab(e.key === 'ArrowRight' ? 1 : -1);
    }
    return;
  }
  // Cmd/Ctrl+Tab style — also support Cmd+PageDown / PageUp for trackpad users.
  if (e.key === 'PageDown' || e.key === 'PageUp') {
    if (tabs.length > 1) {
      e.preventDefault();
      cycleTab(e.key === 'PageDown' ? 1 : -1);
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
  // #302 — strip is gated by both the sidebar mode AND the per-user master
  // toggle. Either being false hides the strip.
  notesTypesEl.hidden = mode !== 'notes' || noteTypeStripHidden;
  if (mode === 'notes') {
    renderNoteTypesStrip();
    void loadNotes();
  }
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
  let filtered = notes;
  // #255 — type filter is the cheapest cut; apply first.
  if (notesTypeFilter) {
    filtered = filtered.filter(n => (n.type ?? DEFAULT_TYPE_ID) === notesTypeFilter);
  }
  if (notesFilterText) {
    filtered = filtered.filter(n =>
      n.title.toLowerCase().includes(notesFilterText) ||
      n.tags.some(t => t.toLowerCase().includes(notesFilterText)),
    );
  }
  if (filtered.length === 0) {
    const emptyMsg = notes.length === 0
      ? 'No notes yet. Create one with + or Cmd/Ctrl+N.'
      : notesTypeFilter
        ? `No ${getNoteType(notesTypeFilter).label.toLowerCase()} notes.`
        : 'No matches.';
    notesListEl.innerHTML = `<div class="mid-tree-empty">${escapeHTML(emptyMsg)}</div>`;
    return;
  }
  const sorted = [...filtered].sort((a, b) => b.updated.localeCompare(a.updated));
  notesListEl.replaceChildren(...sorted.map(renderNoteRow));
}

/**
 * #255 — render the horizontal type-filter strip at the top of the notes
 * sidebar. One button per registered type; clicking toggles the filter, and
 * clicking the active type clears the filter.
 *
 * #302 — the strip now honours three persisted prefs:
 *   - `noteTypeStripHidden` — master toggle, gated by `setSidebarMode`.
 *   - `noteTypeStripExclude` — type ids to omit even when the strip is on.
 *   - `noteTypeOrder` — explicit ordering; types not listed append in the
 *     registry's declaration order so newly added types stay discoverable.
 */
function renderNoteTypesStrip(): void {
  // Re-evaluate the master toggle in case it changed without a mode flip.
  notesTypesEl.hidden = sidebarMode !== 'notes' || noteTypeStripHidden;
  if (notesTypesEl.hidden) return;
  const buttons: HTMLElement[] = [];
  for (const t of orderedStripTypes()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mid-notes-type-chip';
    btn.title = t.label;
    btn.setAttribute('aria-label', `Filter: ${t.label}`);
    btn.setAttribute('role', 'tab');
    btn.dataset.typeId = t.id;
    if (notesTypeFilter === t.id) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      btn.style.color = t.color;
      btn.style.borderColor = t.color;
    }
    btn.innerHTML = iconHTML(t.icon as IconName, 'mid-icon--sm');
    btn.addEventListener('click', () => {
      notesTypeFilter = notesTypeFilter === t.id ? null : t.id;
      renderNoteTypesStrip();
      renderNotes();
    });
    buttons.push(btn);
  }
  notesTypesEl.replaceChildren(...buttons);
}

/**
 * Apply `noteTypeOrder` + `noteTypeStripExclude` to the registry to produce
 * the ordered, filtered list the strip should display. Centralised so the
 * settings drag-reorder UI and the strip render share one source of truth.
 */
function orderedStripTypes(): NoteType[] {
  const all = listNoteTypes();
  const byId = new Map(all.map(t => [t.id, t] as const));
  const out: NoteType[] = [];
  const seen = new Set<string>();
  for (const id of noteTypeOrder) {
    const t = byId.get(id);
    if (!t || seen.has(id)) continue;
    seen.add(id);
    if (noteTypeStripExclude.includes(id)) continue;
    out.push(t);
  }
  for (const t of all) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (noteTypeStripExclude.includes(t.id)) continue;
    out.push(t);
  }
  return out;
}

function renderNoteRow(note: NoteEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mid-note-row';
  row.dataset.id = note.id;
  if (currentPath && currentPath.endsWith('/' + note.path)) row.classList.add('is-active');

  // #255 — leading type chip (icon + tinted background) replaces the inline
  // string-tag chips. The chip is also clickable shortcut to filter by type.
  const noteType = getNoteType(note.type);
  const typeChip = document.createElement('button');
  typeChip.type = 'button';
  typeChip.className = 'mid-note-type-chip';
  typeChip.title = `Type: ${noteType.label} — click to filter`;
  typeChip.style.color = noteType.color;
  typeChip.style.background = `${noteType.color}20`; // 20 = ~12% alpha hex
  typeChip.style.borderColor = `${noteType.color}40`;
  typeChip.innerHTML = iconHTML(noteType.icon as IconName, 'mid-icon--sm');
  typeChip.addEventListener('click', e => {
    e.stopPropagation();
    notesTypeFilter = notesTypeFilter === noteType.id ? null : noteType.id;
    renderNoteTypesStrip();
    renderNotes();
  });

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
  // Tags now live as a compact text suffix in the meta line — the noisy
  // editable chip stack is gone; tags can still be edited via context menu.
  if (note.tags.length > 0) {
    const tagsLine = document.createElement('span');
    tagsLine.className = 'mid-note-tag-line';
    tagsLine.textContent = note.tags.map(t => `#${t}`).join(' ');
    meta.appendChild(tagsLine);
  }
  const del = document.createElement('button');
  del.className = 'mid-note-delete';
  del.title = 'Delete note';
  del.innerHTML = iconHTML('trash', 'mid-icon--sm');
  del.addEventListener('click', e => {
    e.stopPropagation();
    void deleteNote(note);
  });
  row.append(typeChip, title, meta, del);
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
      { icon: noteType.icon as IconName, label: `Change type… (${noteType.label})`, action: () => openTypeChooserMenu(note, e.clientX, e.clientY) },
      { icon: 'tag', label: 'Edit tags…', action: () => void editNoteTags(note) },
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

/**
 * #255 — secondary context menu listing every registered type. We render it
 * with `openContextMenu` so styling/keyboard-dismiss are reused. Each entry's
 * label includes the type label and the menu colorises the active type.
 */
function openTypeChooserMenu(note: NoteEntry, x: number, y: number): void {
  const items = listNoteTypes().map(t => ({
    icon: t.icon as IconName,
    label: t.label + (note.type === t.id ? '  ✓' : ''),
    action: () => void changeNoteType(note, t),
  }));
  openContextMenu(items, x, y);
}

async function changeNoteType(note: NoteEntry, type: NoteType): Promise<void> {
  if (!currentFolder) return;
  if ((note.type ?? DEFAULT_TYPE_ID) === type.id) return;
  // Switching INTO secret needs an empty `secrets:` block in the file so the
  // secret editor has somewhere to read/write. We only seed if the user
  // doesn't already have one in their existing file.
  if (type.viewKind === 'secret') {
    try {
      const fullPath = `${currentFolder}/${note.path}`;
      const content = await window.mid.readFile(fullPath);
      if (!/^---[\s\S]*?secrets\s*:/m.test(content)) {
        const seeded = `---\nsecrets: {}\n---\n\n${content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')}`;
        await window.mid.writeFile(fullPath, seeded);
      }
    } catch { /* file gone — let setType fail loudly via a refresh */ }
  }
  const updated = await window.mid.notesSetType(currentFolder, note.id, type.id);
  if (!updated) return;
  Object.assign(note, updated);
  renderNotes();
  // If the user is currently viewing this note, re-open so the right view
  // (markdown vs typed) takes effect immediately.
  if (currentPath && currentPath.endsWith('/' + note.path)) {
    await openNote(note);
  }
  flashStatus(`Type → ${type.label}`);
}

async function editNoteTags(note: NoteEntry): Promise<void> {
  if (!currentFolder) return;
  const current = note.tags.join(', ');
  const next = await midPrompt('Edit tags', 'Comma-separated tags (e.g. mvp, planning)', current);
  if (next === null) return;
  const cleaned = next.split(',').map(t => t.trim().replace(/^#/, '').replace(/\s+/g, '-')).filter(Boolean);
  const updated = await window.mid.notesTag(currentFolder, note.id, cleaned);
  if (updated) Object.assign(note, updated);
  renderNotes();
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
  const noteType = getNoteType(note.type);
  // #255 — typed custom views. Markdown is the default; named viewKinds
  // dispatch to a dedicated renderer that owns the root element. New view
  // kinds (#295 task-list, #296 meeting) plug in here.
  const customRenderer: ((n: NoteEntry, p: string, c: string) => void) | null =
    noteType.viewKind === 'secret' ? renderSecretEditor
      : noteType.viewKind === 'task-list' ? renderTaskListEditor
      : noteType.viewKind === 'meeting' ? renderMeetingEditor
      : null;
  if (customRenderer) {
    typedViewActive = true;
    currentText = content;
    currentPath = fullPath;
    filenameEl.textContent = note.title;
    highlightActiveTreeItem();
    customRenderer(note, fullPath, content);
    updateSaveIndicator(true);
    pushRecent(fullPath);
    renderNotes();
    return;
  }
  typedViewActive = false;
  loadFileContent(fullPath, content);
  renderNotes();
}

async function promptCreateNote(): Promise<void> {
  if (!currentFolder) {
    flashStatus('Open a folder first');
    return;
  }
  // #255 — first ask for the type via the chooser modal. Cancelling the
  // modal defaults to the plain `note` type so users who don't care about
  // typing don't get an extra prompt; cancelling the title prompt aborts.
  const chosen = await openNoteTypeChooserModal();
  if (chosen === undefined) return; // user dismissed via Esc — abort entirely
  const type = chosen ?? getNoteType(DEFAULT_TYPE_ID);
  const title = await midPrompt(`New ${type.label.toLowerCase()}`, 'Title', '');
  if (!title) return;
  const { entry, fullPath } = await window.mid.notesCreate(currentFolder, title, type.id);
  notes.push(entry);
  renderNotes();
  const content = await window.mid.readFile(fullPath);
  loadFileContent(fullPath, content);
}

/**
 * #255 — modal type chooser. Returns:
 *   - the chosen NoteType if the user picked one,
 *   - `null` if the user clicked "Just a note" (default),
 *   - `undefined` if the user dismissed the modal entirely (Esc / backdrop).
 *
 * We build the modal imperatively rather than wiring a `<dialog>` in HTML
 * because the type list is data-driven and we want it to stay in sync with
 * `listNoteTypes()` without a second source of truth.
 */
function openNoteTypeChooserModal(): Promise<NoteType | null | undefined> {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'mid-type-chooser-backdrop';
    const modal = document.createElement('div');
    modal.className = 'mid-type-chooser';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Choose note type');

    const header = document.createElement('div');
    header.className = 'mid-type-chooser-header';
    header.textContent = 'New note — pick a type';
    modal.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'mid-type-chooser-grid';
    for (const t of listNoteTypes()) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'mid-type-chooser-tile';
      tile.style.setProperty('--type-color', t.color);
      tile.innerHTML = `
        <span class="mid-type-chooser-icon">${iconHTML(t.icon as IconName, 'mid-icon--lg')}</span>
        <span class="mid-type-chooser-label">${escapeHTML(t.label)}</span>
        <span class="mid-type-chooser-desc">${escapeHTML(t.description ?? '')}</span>
      `;
      tile.addEventListener('click', () => { close(t); });
      grid.appendChild(tile);
    }
    modal.appendChild(grid);

    const footer = document.createElement('div');
    footer.className = 'mid-type-chooser-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'mid-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => close(undefined));
    footer.appendChild(cancelBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); close(undefined); }
    };
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(undefined); });
    document.addEventListener('keydown', onKey);

    function close(value: NoteType | null | undefined): void {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    }
  });
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
/**
 * #297 + #302 — Notes settings panel.
 *
 * Two groups live here:
 *   1. **Note types** — list of every registered type (built-ins read-only,
 *      user-defined editable + deletable). "Add type…" opens a modal that
 *      writes a new row into the SQLite `note_types` table via the IPC bridge
 *      added in main.ts.
 *   2. **Filter strip** — master toggle, per-type "Show in strip" checkbox,
 *      drag-to-reorder. Persisted via three AppState keys read by
 *      `renderNoteTypesStrip()`.
 */
function renderNotesSection(main: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'mid-settings-form';

  // ─── Group 1: Note types ──────────────────────────────────────────────────
  const typesGroup = makeGroup('Note types', 'Built-in types are locked; user types can be edited or deleted. New types appear in the create-note chooser, filter strip, and the per-row Change Type menu.');
  const typesList = document.createElement('div');
  typesList.className = 'mid-note-types-list';
  typesGroup.body.appendChild(typesList);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'mid-btn mid-btn--primary';
  addBtn.innerHTML = `${iconHTML('plus', 'mid-icon--sm')}<span>Add type…</span>`;
  addBtn.addEventListener('click', async () => {
    const created = await openNoteTypeEditor(null);
    if (!created) return;
    await refreshNoteTypesUI();
  });
  typesGroup.body.appendChild(addBtn);
  wrap.appendChild(typesGroup.card);

  // ─── Group 2: Filter strip ────────────────────────────────────────────────
  const stripGroup = makeGroup('Filter strip', 'Controls the horizontal type chips above the notes sidebar.');
  // Master toggle.
  const masterToggle = document.createElement('input');
  masterToggle.type = 'checkbox';
  masterToggle.className = 'mid-settings-control mid-settings-checkbox';
  masterToggle.checked = !noteTypeStripHidden;
  masterToggle.addEventListener('change', () => {
    noteTypeStripHidden = !masterToggle.checked;
    void window.mid.patchAppState({ noteTypeStripHidden });
    renderNoteTypesStrip();
    perTypeBox.style.opacity = noteTypeStripHidden ? '0.5' : '1';
    perTypeBox.style.pointerEvents = noteTypeStripHidden ? 'none' : 'auto';
  });
  stripGroup.body.appendChild(makeRow(
    { label: 'Show type filter strip in notes sidebar', description: 'Master switch. Off hides the strip even when individual types are visible.', inline: true },
    masterToggle,
  ));

  // Per-type visibility + drag-reorder list.
  const perTypeBox = document.createElement('div');
  perTypeBox.className = 'mid-strip-prefs';
  perTypeBox.style.opacity = noteTypeStripHidden ? '0.5' : '1';
  perTypeBox.style.pointerEvents = noteTypeStripHidden ? 'none' : 'auto';
  stripGroup.body.appendChild(perTypeBox);
  wrap.appendChild(stripGroup.card);

  main.appendChild(wrap);

  // ─── Renderers + helpers ──────────────────────────────────────────────────
  function renderTypesList(): void {
    typesList.replaceChildren();
    for (const t of listNoteTypes()) {
      const row = document.createElement('div');
      row.className = 'mid-note-type-row';
      row.innerHTML = `
        <span class="mid-note-type-row-icon" style="color:${t.color}">${iconHTML(t.icon as IconName, 'mid-icon--md')}</span>
        <span class="mid-note-type-row-text">
          <span class="mid-note-type-row-label">${escapeHTML(t.label)}</span>
          <span class="mid-note-type-row-meta">id <code>${escapeHTML(t.id)}</code> · view <code>${escapeHTML(t.viewKind ?? 'markdown')}</code>${t.builtin ? ' · <em>built-in</em>' : ''}</span>
        </span>
      `;
      const actions = document.createElement('span');
      actions.className = 'mid-note-type-row-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'mid-btn mid-btn--icon mid-btn--ghost';
      edit.title = isBuiltinTypeId(t.id) ? 'Edit label / icon / color (view kind is locked for built-ins)' : 'Edit type';
      edit.innerHTML = iconHTML('edit', 'mid-icon--sm');
      edit.addEventListener('click', async () => {
        const updated = await openNoteTypeEditor(t);
        if (!updated) return;
        await refreshNoteTypesUI();
      });
      actions.appendChild(edit);
      if (!isBuiltinTypeId(t.id)) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'mid-btn mid-btn--icon mid-btn--ghost';
        del.title = 'Delete user type';
        del.innerHTML = iconHTML('trash', 'mid-icon--sm');
        del.addEventListener('click', async () => {
          const ok = await midConfirm('Delete type?', `"${t.label}" — existing notes keep their type id but will fall back to the default note view.`);
          if (!ok) return;
          const result = await window.mid.noteTypesDelete(t.id);
          if (!result.ok) {
            flashStatus(result.error ?? 'Delete failed');
            return;
          }
          setNoteTypesRegistry(result.types);
          await refreshNoteTypesUI();
        });
        actions.appendChild(del);
      }
      row.appendChild(actions);
      typesList.appendChild(row);
    }
  }

  function renderStripPrefs(): void {
    perTypeBox.replaceChildren();
    const all = listNoteTypes();
    // Build the ordered list using current `noteTypeOrder`, appending unseen.
    const byId = new Map(all.map(t => [t.id, t] as const));
    const ordered: NoteType[] = [];
    const seen = new Set<string>();
    for (const id of noteTypeOrder) {
      const t = byId.get(id);
      if (t && !seen.has(id)) { ordered.push(t); seen.add(id); }
    }
    for (const t of all) { if (!seen.has(t.id)) { ordered.push(t); seen.add(t.id); } }

    let dragFromIdx: number | null = null;
    ordered.forEach((t, idx) => {
      const row = document.createElement('div');
      row.className = 'mid-strip-pref-row';
      row.draggable = true;
      row.dataset.idx = String(idx);

      const handle = document.createElement('span');
      handle.className = 'mid-strip-pref-handle';
      handle.title = 'Drag to reorder';
      handle.textContent = '⋮⋮';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'mid-strip-pref-icon';
      iconSpan.style.color = t.color;
      iconSpan.innerHTML = iconHTML(t.icon as IconName, 'mid-icon--sm');

      const label = document.createElement('span');
      label.className = 'mid-strip-pref-label';
      label.textContent = t.label;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'mid-settings-control mid-settings-checkbox';
      checkbox.checked = !noteTypeStripExclude.includes(t.id);
      checkbox.title = 'Show in strip';
      checkbox.addEventListener('change', () => {
        const set = new Set(noteTypeStripExclude);
        if (checkbox.checked) set.delete(t.id); else set.add(t.id);
        noteTypeStripExclude = Array.from(set);
        void window.mid.patchAppState({ noteTypeStripExclude });
        renderNoteTypesStrip();
      });

      row.append(handle, iconSpan, label, checkbox);

      row.addEventListener('dragstart', e => {
        dragFromIdx = idx;
        row.classList.add('is-dragging');
        try { e.dataTransfer?.setData('text/plain', String(idx)); } catch { /* ignore */ }
      });
      row.addEventListener('dragend', () => {
        dragFromIdx = null;
        row.classList.remove('is-dragging');
        perTypeBox.querySelectorAll('.mid-strip-pref-row').forEach(r => r.classList.remove('is-drop-target'));
      });
      row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('is-drop-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.classList.remove('is-drop-target');
        if (dragFromIdx === null || dragFromIdx === idx) return;
        const [moved] = ordered.splice(dragFromIdx, 1);
        ordered.splice(idx, 0, moved);
        noteTypeOrder = ordered.map(t => t.id);
        void window.mid.patchAppState({ noteTypeOrder });
        renderStripPrefs();
        renderNoteTypesStrip();
      });

      perTypeBox.appendChild(row);
    });
  }

  async function refreshNoteTypesUI(): Promise<void> {
    // Refresh from main so we don't drift from the SQLite truth source.
    try {
      const fresh = await window.mid.noteTypesList();
      if (Array.isArray(fresh)) setNoteTypesRegistry(fresh);
    } catch { /* keep existing */ }
    renderTypesList();
    renderStripPrefs();
    renderNoteTypesStrip();
  }

  void refreshNoteTypesUI();
}

/**
 * #297 — Note type editor modal. Pass `null` to create a new type, or an
 * existing `NoteType` to edit. Built-in entries lock the id + view-kind
 * fields; everything else is editable.
 */
function openNoteTypeEditor(initial: NoteType | null): Promise<NoteType | null> {
  return new Promise(resolve => {
    const isEdit = !!initial;
    const isBuiltin = !!initial && isBuiltinTypeId(initial.id);

    const backdrop = document.createElement('div');
    backdrop.className = 'mid-type-chooser-backdrop';
    const modal = document.createElement('div');
    modal.className = 'mid-type-chooser';
    modal.style.maxWidth = '560px';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', isEdit ? 'Edit note type' : 'Add note type');

    const header = document.createElement('div');
    header.className = 'mid-type-chooser-header';
    header.textContent = isEdit ? `Edit type — ${initial!.label}` : 'Add note type';
    modal.appendChild(header);

    // Form scaffold.
    const form = document.createElement('div');
    form.className = 'mid-note-type-form';
    modal.appendChild(form);

    const idInput = labelledInput('Id', 'slug-id (lowercase, hyphens)', initial?.id ?? '', isEdit);
    form.appendChild(idInput.row);
    const labelInput = labelledInput('Label', 'Human-readable name', initial?.label ?? '');
    form.appendChild(labelInput.row);
    const descInput = labelledInput('Description', 'Optional — shown in the type chooser.', initial?.description ?? '');
    form.appendChild(descInput.row);

    // Icon picker (reuses PIN_ICON_CHOICES + the built-in note-type icons).
    let chosenIcon = initial?.icon ?? 'bookmark';
    const iconRow = document.createElement('div');
    iconRow.className = 'mid-note-type-form-row';
    iconRow.innerHTML = '<span class="mid-note-type-form-label">Icon</span>';
    const iconGrid = document.createElement('div');
    iconGrid.className = 'mid-pin-icons';
    const iconChoices: IconName[] = [
      'bookmark', 'lock', 'check-square', 'calendar', 'book', 'code',
      'tag', 'list-ul', 'github', 'image', 'link', 'folder',
      'file', 'cog', 'search', 'markdown', 'typescript', 'python',
    ];
    for (const ic of iconChoices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mid-pin-icon-btn' + (ic === chosenIcon ? ' is-active' : '');
      btn.dataset.icon = ic;
      btn.innerHTML = iconHTML(ic);
      btn.addEventListener('click', () => {
        chosenIcon = ic;
        iconGrid.querySelectorAll('.mid-pin-icon-btn').forEach(b => b.classList.toggle('is-active', (b as HTMLElement).dataset.icon === ic));
      });
      iconGrid.appendChild(btn);
    }
    iconRow.appendChild(iconGrid);
    form.appendChild(iconRow);

    // Color picker.
    let chosenColor = initial?.color ?? '#6e7681';
    const colorRow = document.createElement('div');
    colorRow.className = 'mid-note-type-form-row';
    colorRow.innerHTML = '<span class="mid-note-type-form-label">Color</span>';
    const colorGrid = document.createElement('div');
    colorGrid.className = 'mid-pin-colors';
    const colorChoices = [
      '#6e7681', '#bf8700', '#1a7f37', '#0969da', '#8250df', '#cf222e',
      '#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#9333ea', '#db2777',
    ];
    for (const col of colorChoices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mid-pin-color-btn' + (col === chosenColor ? ' is-active' : '');
      btn.style.background = col;
      btn.dataset.color = col;
      btn.title = col;
      btn.addEventListener('click', () => {
        chosenColor = col;
        colorGrid.querySelectorAll('.mid-pin-color-btn').forEach(b => b.classList.toggle('is-active', (b as HTMLElement).dataset.color === col));
      });
      colorGrid.appendChild(btn);
    }
    colorRow.appendChild(colorGrid);
    form.appendChild(colorRow);

    // View kind dropdown — locked for built-ins (their renderer dispatch is
    // wired in code; changing it would silently break the editor).
    const viewRow = document.createElement('div');
    viewRow.className = 'mid-note-type-form-row';
    viewRow.innerHTML = '<span class="mid-note-type-form-label">View kind</span>';
    const viewSelect = document.createElement('select');
    viewSelect.className = 'mid-settings-control';
    for (const [v, l] of [
      ['markdown', 'Markdown editor (default)'],
      ['task-list', 'Task list (checklist)'],
      ['secret', 'Secret (key/value)'],
      ['meeting', 'Meeting (structured form)'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = l;
      viewSelect.appendChild(opt);
    }
    viewSelect.value = initial?.viewKind ?? 'markdown';
    if (isBuiltin) viewSelect.disabled = true;
    viewRow.appendChild(viewSelect);
    form.appendChild(viewRow);

    // Footer.
    const footer = document.createElement('div');
    footer.className = 'mid-type-chooser-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'mid-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => close(null));
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'mid-btn mid-btn--primary';
    saveBtn.textContent = isEdit ? 'Save' : 'Create';
    saveBtn.addEventListener('click', async () => {
      const id = idInput.input.value.trim();
      const label = labelInput.input.value.trim();
      if (!id) { flashStatus('Id is required'); return; }
      if (!label) { flashStatus('Label is required'); return; }
      const payload: NoteType = {
        id,
        label,
        icon: chosenIcon,
        color: chosenColor,
        viewKind: viewSelect.value,
        description: descInput.input.value.trim() || undefined,
      };
      const result = await window.mid.noteTypesUpsert(payload);
      if (!result.ok) {
        flashStatus(result.error ?? 'Failed to save type');
        return;
      }
      setNoteTypesRegistry(result.types);
      const saved = result.types.find(t => t.id === id) ?? payload;
      close(saved);
    });
    footer.append(cancelBtn, saveBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    };
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(null); });
    document.addEventListener('keydown', onKey);

    // Focus the first editable field.
    setTimeout(() => (isEdit ? labelInput.input : idInput.input).focus(), 50);

    function close(value: NoteType | null): void {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    }
  });
}

interface LabelledInput { row: HTMLElement; input: HTMLInputElement; }
function labelledInput(label: string, placeholder: string, initial: string, readOnly = false): LabelledInput {
  const row = document.createElement('div');
  row.className = 'mid-note-type-form-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'mid-note-type-form-label';
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'mid-settings-control';
  input.placeholder = placeholder;
  input.value = initial;
  if (readOnly) { input.readOnly = true; input.style.opacity = '0.6'; }
  row.append(labelEl, input);
  return { row, input };
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
  // #302 — strip preferences. Default: visible, no excludes, no custom order.
  if (typeof state.noteTypeStripHidden === 'boolean') noteTypeStripHidden = state.noteTypeStripHidden;
  if (Array.isArray(state.noteTypeStripExclude)) noteTypeStripExclude = state.noteTypeStripExclude.slice();
  if (Array.isArray(state.noteTypeOrder)) noteTypeOrder = state.noteTypeOrder.slice();
  // #309 — split-screen tab manager. The split is rebuilt in `hydrateTabs`
  // based on the persisted `open_tabs` rows (a non-empty strip 1 means the
  // user had a split going); we just stash the ratio + last-active strip here.
  if (typeof state.tabSplitRatio === 'number' && state.tabSplitRatio >= 0.15 && state.tabSplitRatio <= 0.85) {
    tabSplitRatio = state.tabSplitRatio;
  }
  if (state.tabActiveStripId === 0 || state.tabActiveStripId === 1) {
    appStateTabActiveStripId = state.tabActiveStripId;
  }
  // #297 — hydrate the registry from SQLite before any note view tries to
  // dispatch on viewKind. Failures fall back to the built-ins shipped in the
  // bundle; the renderer never blocks on this round-trip.
  try {
    const types = await window.mid.noteTypesList();
    if (Array.isArray(types) && types.length > 0) setNoteTypesRegistry(types);
  } catch (err) { console.debug('[mid] noteTypesList failed:', err); }
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
  // #287 — restore the open-tabs strip from SQLite. Done after the folder
  // applies so the tree's active-row highlight has a chance to attach.
  await hydrateTabs();
  // #308 — if this window was launched with a `detachedPath` URL hash and no
  // persisted tabs hydrated, seed the strip with that single file so the new
  // detached window opens directly to its source tab. Defined at the bottom
  // of the file so the bottom block (tab-detach module) owns its lifecycle.
  await maybeSeedFromDetachHash();
  // #303 — if the launched workspace has no warehouse, force-open the
  // onboarding modal regardless of the dismissed list. The dismissed list
  // only suppresses *during* a session (re-triggers from the welcome CTA,
  // status-bar context menu, etc.); on each launch we ask again.
  if (currentFolder) {
    try {
      const existing = await window.mid.warehousesList(currentFolder);
      if (existing.length === 0) {
        // #314 — blocking onboarding: app cannot proceed without a warehouse
        // (github repo OR local folder). User can change later from settings.
        await openWarehouseOnboarding(true, /* blocking */ true);
      }
    } catch (err) { console.debug('[mid] launch onboarding gate error:', err); }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Importer plugin chooser (#246)
//
// Self-contained block — kept at the bottom of renderer.ts to minimise merge
// conflicts with the settings stack and spotlight agents. The chooser modal is
// built lazily on first use; the only static surface is the activity-bar
// "Import from…" button injected next to Settings.
// ─────────────────────────────────────────────────────────────────────────────
interface ImporterMetaRow {
  id: string;
  name: string;
  icon: string;
  supportedFormats?: string[];
  description?: string;
}

interface ImportersBridge {
  importersList(): Promise<ImporterMetaRow[]>;
  importersRun(importerId: string, input: string, workspaceFolder: string): Promise<{ ok: boolean; runId?: string; error?: string }>;
  onImportersProgress(cb: (e: { runId: string; current: number; note: { title: string; path: string } }) => void): () => void;
  onImportersDone(cb: (e: { runId: string; count: number }) => void): () => void;
  onImportersError(cb: (e: { runId: string; error: string }) => void): () => void;
  onImportersLog(cb: (e: { runId: string; msg: string }) => void): () => void;
}

const importersBridge = (window.mid as unknown as ImportersBridge);

function buildImportersButton(): void {
  // Inject an "Import from…" button into the activity bar overflow position.
  // We add it just before the spacer so it lives next to the pinned-folder
  // group and doesn't disturb existing layout.
  const bar = document.getElementById('activity-bar');
  if (!bar || document.getElementById('activity-import')) return;
  const btn = document.createElement('button');
  btn.id = 'activity-import';
  btn.className = 'mid-activity-btn';
  btn.title = 'Import from…';
  btn.setAttribute('data-icon', 'import');
  btn.addEventListener('click', () => void openImportersChooser());
  const spacer = bar.querySelector('.mid-activity-spacer');
  if (spacer) bar.insertBefore(btn, spacer);
  else bar.appendChild(btn);
}

async function openImportersChooser(): Promise<void> {
  const importers = await importersBridge.importersList();
  const dlg = ensureImportersDialog();
  const list = dlg.querySelector('.mid-importers-list') as HTMLDivElement;
  list.replaceChildren();
  if (importers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mid-importers-empty';
    empty.textContent = 'No importers registered. Drop a folder under apps/electron/importers/<id>/ and restart.';
    list.appendChild(empty);
  } else {
    for (const meta of importers) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mid-importers-row';
      row.innerHTML = `
        <span class="mid-icon mid-icon--md" data-icon="${meta.icon || 'import'}"></span>
        <span class="mid-importers-row-text">
          <span class="mid-importers-row-name"></span>
          <span class="mid-importers-row-desc"></span>
        </span>
      `;
      (row.querySelector('.mid-importers-row-name') as HTMLSpanElement).textContent = meta.name;
      (row.querySelector('.mid-importers-row-desc') as HTMLSpanElement).textContent = meta.description || (meta.supportedFormats || []).join(', ');
      row.addEventListener('click', () => {
        if (dlg.open) dlg.close();
        void runImporter(meta);
      });
      list.appendChild(row);
    }
  }
  if (!dlg.open) dlg.showModal();
}

function ensureImportersDialog(): HTMLDialogElement {
  let dlg = document.getElementById('mid-importers-dialog') as HTMLDialogElement | null;
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'mid-importers-dialog';
  dlg.className = 'mid-importers-dialog';
  dlg.innerHTML = `
    <form method="dialog" class="mid-importers-form">
      <header class="mid-importers-header">
        <h2>Import from…</h2>
        <button type="submit" value="cancel" class="mid-btn mid-btn--icon mid-btn--ghost" aria-label="Close" data-icon="x"></button>
      </header>
      <div class="mid-importers-list"></div>
      <div class="mid-importers-progress" hidden>
        <div class="mid-importers-progress-text">Starting…</div>
        <ul class="mid-importers-progress-log"></ul>
      </div>
    </form>
  `;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  return dlg;
}

async function runImporter(meta: ImporterMetaRow): Promise<void> {
  if (!currentFolder) {
    const folder = await window.mid.openFolderDialog();
    if (!folder) return;
    applyFolder(folder.folderPath, folder.tree);
  }
  if (!currentFolder) return;

  // Importer source: re-use the open-folder dialog as the universal picker for
  // now. Real importers will pick zip/file/live in their own flows; for the
  // sample (which ignores input) we just default to the workspace folder.
  let input = currentFolder;
  if ((meta.supportedFormats || []).some(fmt => fmt === 'folder' || fmt === 'zip' || fmt === 'file') && meta.id !== 'sample') {
    const picked = await window.mid.openFolderDialog();
    if (!picked) return;
    input = picked.folderPath;
  }

  const dlg = ensureImportersDialog();
  const list = dlg.querySelector('.mid-importers-list') as HTMLDivElement;
  const progress = dlg.querySelector('.mid-importers-progress') as HTMLDivElement;
  const progressText = dlg.querySelector('.mid-importers-progress-text') as HTMLDivElement;
  const log = dlg.querySelector('.mid-importers-progress-log') as HTMLUListElement;
  list.hidden = true;
  progress.hidden = false;
  log.replaceChildren();
  progressText.textContent = `Running "${meta.name}"…`;
  if (!dlg.open) dlg.showModal();

  const offProgress = importersBridge.onImportersProgress(({ runId, current, note }) => {
    if (runId !== expectedRunId) return;
    progressText.textContent = `Imported ${current} note${current === 1 ? '' : 's'}…`;
    const li = document.createElement('li');
    li.textContent = `• ${note.title}`;
    li.title = note.path;
    log.appendChild(li);
  });
  const offDone = importersBridge.onImportersDone(({ runId, count }) => {
    if (runId !== expectedRunId) return;
    progressText.textContent = `Done — imported ${count} note${count === 1 ? '' : 's'} into Imported/${meta.id}/`;
    cleanup();
    if (currentFolder) void window.mid.listFolderMd(currentFolder).then(tree => applyFolder(currentFolder!, tree));
  });
  const offError = importersBridge.onImportersError(({ runId, error }) => {
    if (runId !== expectedRunId) return;
    progressText.textContent = `Failed: ${error}`;
    cleanup();
  });
  const offLog = importersBridge.onImportersLog(({ runId, msg }) => {
    if (runId !== expectedRunId) return;
    const li = document.createElement('li');
    li.className = 'mid-importers-progress-log-line';
    li.textContent = msg;
    log.appendChild(li);
  });

  let expectedRunId = '';
  const cleanup = (): void => {
    offProgress();
    offDone();
    offError();
    offLog();
  };

  const result = await importersBridge.importersRun(meta.id, input, currentFolder);
  if (!result.ok || !result.runId) {
    progressText.textContent = `Failed to start: ${result.error ?? 'unknown error'}`;
    cleanup();
    return;
  }
  expectedRunId = result.runId;
}

buildImportersButton();

interface ImportersMenuBridge {
  onMenuImport(cb: () => void): () => void;
}
((window.mid as unknown as ImportersMenuBridge)).onMenuImport(() => void openImportersChooser());

// ─────────────────────────────────────────────────────────────────────────────
// Tab manager: window detach (#308)
//
// When a tab is dragged outside the window's bounds and dropped onto the OS
// desktop (or another monitor), we ask main to spawn a fresh BrowserWindow
// with that one file pre-loaded, then close the source tab in this window.
// Each window owns its own SQLite slot for `open_tabs` (window-scoped by the
// IPC sender, see main.ts), so the detached window persists independently
// and a relaunch re-spawns it with its strip intact.
//
// All wiring lives at the bottom of renderer.ts so #309's split-screen patch
// (concurrent track) doesn't conflict with the existing tab-manager block at
// the top of the file. Detection uses a document-level `dragend` listener
// rather than touching the per-tab handlers in renderTabstrip().
// ─────────────────────────────────────────────────────────────────────────────

interface DetachBridge {
  tabsDetach(payload: { path: string; bounds?: { x?: number; y?: number } }): Promise<{ ok: boolean; windowId?: number; error?: string }>;
  getWindowId(): Promise<number>;
}

const detachBridge = window.mid as unknown as DetachBridge;

/** During a tab drag, we capture the dragged tab's index + path so the
 * dragend handler at the document level knows which row to detach if the
 * drop lands outside the window. The per-tab dragstart handler in
 * renderTabstrip() already sets the dataTransfer payload; we mirror it here
 * because dataTransfer.getData() is empty during dragend in many browsers. */
let detachPendingIdx: number | null = null;
let detachPendingPath: string | null = null;

/** Edge indicator that flashes along the active border to show the user that
 * dropping outside will spawn a new window. The element is created lazily on
 * first drag and reused thereafter; it lives in <body> so it overlays
 * everything including the tabstrip. */
let detachEdgeIndicator: HTMLDivElement | null = null;

function ensureDetachEdgeIndicator(): HTMLDivElement {
  if (detachEdgeIndicator) return detachEdgeIndicator;
  const el = document.createElement('div');
  el.className = 'mid-detach-edge';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  detachEdgeIndicator = el;
  return el;
}

function showDetachEdge(visible: boolean): void {
  const el = ensureDetachEdgeIndicator();
  el.classList.toggle('is-active', visible);
}

function pointIsOutsideWindow(clientX: number, clientY: number): boolean {
  // The renderer window's content area is `[0, innerWidth) x [0, innerHeight)`.
  // Some browsers report `0/0` for `dragend` when the drop happens on the OS
  // desktop or another window — treat that as outside. Otherwise check the
  // bounds with a small slack so a near-miss (browser rounding) still counts.
  if (clientX === 0 && clientY === 0) return true;
  const slack = 4;
  return (
    clientX < -slack ||
    clientY < -slack ||
    clientX > window.innerWidth + slack ||
    clientY > window.innerHeight + slack
  );
}

/** Like `closeTabAt` but for the detach flow: don't push onto the
 * recently-closed stack (the tab moved, it didn't close), and don't trigger
 * the welcome state if it was the last tab — the operating system already
 * shows the new window so the user doesn't need a fresh welcome screen. */
function closeTabForDetach(idx: number): void {
  if (idx < 0 || idx >= tabs.length) return;
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    activeTabIndex = -1;
    syncMirrorFromActiveTab();
    if (currentMode === 'view') renderView();
    else if (currentMode === 'edit') renderEdit();
    else renderSplit();
    renderTabstrip();
    schedulePersistTabs();
    return;
  }
  if (idx < activeTabIndex) {
    activeTabIndex--;
  } else if (idx === activeTabIndex) {
    if (activeTabIndex >= tabs.length) activeTabIndex = tabs.length - 1;
  }
  // #309 — also reconcile the inactive-strip pointer when the detach close
  // happens to remove a tab earlier in the array than the inactive pointer.
  if (idx < inactiveActiveTabIndex) inactiveActiveTabIndex--;
  else if (idx === inactiveActiveTabIndex) inactiveActiveTabIndex = -1;
  syncMirrorFromActiveTab();
  if (currentMode === 'view') renderView();
  else if (currentMode === 'edit') renderEdit();
  else renderSplit();
  highlightActiveTreeItem();
  updateWordCount();
  updateSaveIndicator(true);
  restoreScrollPosition();
  renderTabstrip();
  if (splitActive) renderInactiveColumn();
  schedulePersistTabs();
}

document.addEventListener('dragstart', (ev) => {
  // Only react if the drag started on a tab. We read dataset rather than
  // the dataTransfer payload because the per-tab handler already populated
  // both — and dataset is observable here without depending on the order
  // event handlers run.
  const target = ev.target as HTMLElement | null;
  const tabEl = target?.closest?.('.mid-tab') as HTMLElement | null;
  if (!tabEl) {
    detachPendingIdx = null;
    detachPendingPath = null;
    return;
  }
  const idx = parseInt(tabEl.dataset.tabIndex ?? '', 10);
  if (Number.isNaN(idx)) return;
  detachPendingIdx = idx;
  detachPendingPath = tabEl.dataset.tabPath ?? null;
}, true);

document.addEventListener('dragover', (ev) => {
  if (detachPendingIdx == null) return;
  // Only flash the edge once the cursor is near or past the window border —
  // inside-strip reorders shouldn't show the detach affordance.
  showDetachEdge(pointIsOutsideWindow(ev.clientX, ev.clientY));
});

document.addEventListener('dragend', async (ev) => {
  // Always clear the indicator: a drop inside the strip ended the drag.
  showDetachEdge(false);
  const idx = detachPendingIdx;
  const path = detachPendingPath;
  detachPendingIdx = null;
  detachPendingPath = null;
  if (idx == null || !path) return;
  if (!pointIsOutsideWindow(ev.clientX, ev.clientY)) return;
  // Re-find the index by path because the strip may have re-rendered
  // mid-drag (e.g. another async event) and shifted indices.
  const liveIdx = findTabIndex(path);
  if (liveIdx === -1) return;
  // Detaching a sole-tab IS allowed — the origin window simply ends up with
  // an empty strip (welcome state). The new window owns that file. The user
  // can close either side independently.
  // The ScreenX/ScreenY positions hint at where the user dropped, so the new
  // window can pop near the cursor. We pass them as bounds for the new
  // BrowserWindow — main clamps to the screen.
  const bounds: { x?: number; y?: number } = {};
  if (typeof ev.screenX === 'number' && ev.screenX > 0) bounds.x = Math.round(ev.screenX - 360);
  if (typeof ev.screenY === 'number' && ev.screenY > 0) bounds.y = Math.round(ev.screenY - 80);
  try {
    const result = await detachBridge.tabsDetach({ path, bounds });
    if (!result.ok) {
      flashStatus(`Detach failed: ${result.error ?? 'unknown'}`);
      return;
    }
    // Close the source tab without pushing onto recently-closed (the file
    // didn't close — it moved windows).
    closeTabForDetach(liveIdx);
  } catch (err) {
    flashStatus(`Detach failed: ${(err as Error).message}`);
  }
});

/** Boot-time hash check for windows spawned by `mid:tabs-detach`. The new
 * window's URL hash carries `detachedPath=<encoded>`. If we find one *and*
 * the persisted strip for this slot is empty, seed the strip with that one
 * file. (Re-spawned detached windows skip this branch because their strip
 * hydrates from SQLite first.)
 *
 * Hash is consumed (cleared) after seeding so a refresh doesn't re-add a
 * duplicate tab on top of the now-persisted strip. */
async function maybeSeedFromDetachHash(): Promise<void> {
  const raw = window.location.hash;
  if (!raw) return;
  const params = new URLSearchParams(raw.startsWith('#') ? raw.slice(1) : raw);
  const detachedPath = params.get('detachedPath');
  if (!detachedPath) return;
  // Clear the hash so a renderer reload doesn't re-seed the same tab on top
  // of the persisted strip. We use replaceState to avoid a navigation event.
  try { history.replaceState(null, '', window.location.pathname); } catch { /* fine */ }
  // If the strip already hydrated rows from SQLite (e.g. a re-spawned
  // detached window picking up its persisted strip), respect that: the
  // detachedPath was a one-shot from the original spawn and shouldn't fight
  // the user's saved layout.
  if (tabs.length > 0) return;
  try {
    const content = await window.mid.readFile(detachedPath);
    loadFileContent(detachedPath, content);
  } catch (err) {
    console.warn('[mid] detached-path seed failed:', err);
    flashStatus(`Could not open ${detachedPath.split('/').pop() ?? detachedPath}`);
  }
}

// Surface the persistence slot id in the document title for diagnostics. The
// main window keeps "Mark It Down" while detached windows append a small
// suffix so the user can tell them apart in window managers.
void detachBridge.getWindowId().then((slot) => {
  if (slot && slot > 0) {
    document.title = `Mark It Down — Window ${slot}`;
  }
}).catch(() => undefined);

// ─────────────────────────────────────────────────────────────────────────────
// Tab split-screen (#309)
//
// Activates a second editor column when the user drags a tab onto the left or
// right edge (~80px) of the existing tab strip / editor area. The implementation
// is layered on top of the MVP tab manager (#287) without rewriting it:
//
//   • Strip 0 keeps using the original `#tabstrip` + `#root` DOM nodes — the
//     "live" editor where `currentText` and `currentPath` mirror the focused
//     tab and the existing render code (renderView/renderEdit/renderSplit) runs.
//
//   • Strip 1 gets a sibling tabstrip + a static markdown preview pane. It is
//     intentionally read-only: clicking inside it (or on one of its tabs) calls
//     `swapActiveColumn`, which physically moves the live `#root` into the
//     other column slot and re-renders both sides with their swapped roles.
//
// This keeps the ~70 references to `currentText`/`currentPath` happy without a
// sweep, while still satisfying the AC: each column has its own strip + active
// tab + editor view, the divider drag resizes both columns, closing the last
// tab in a column collapses back to single-column, and both columns persist
// across restart via the existing `(strip_id, idx, path, active)` schema.
//
// All new DOM lives at the bottom of the editor-area wrapper to minimise
// merge conflicts with the parallel detach agent on feat/308-tab-detach.
// ─────────────────────────────────────────────────────────────────────────────

/** Wrapper that holds the two columns when split is active. Built lazily by
 * `enableSplitDOM` and re-used afterwards. */
let splitWrapEl: HTMLDivElement | null = null;
/** The strip-1 tabstrip element. Created on first split activation. */
let inactiveTabstripEl: HTMLDivElement | null = null;
/** The strip-1 editor area (markdown preview of its active tab). */
let inactiveRootEl: HTMLDivElement | null = null;
/** The drop indicator (left or right edge) shown during a tab drag. */
let splitDropIndicatorEl: HTMLDivElement | null = null;
/** The original parent (`<div id="layout">` direct child) of `#editor-area`,
 * used so a split-collapse can re-parent `#editor-area` back to its home. */
let editorAreaOriginalParent: HTMLElement | null = null;
let editorAreaOriginalNextSibling: ChildNode | null = null;

/** #309 — promotion threshold: how many pixels from the editor-area edge a tab
 * drag has to land in to trigger a split. */
const SPLIT_EDGE_THRESHOLD_PX = 80;

/** Get the existing `.mid-editor-area` element — the column 0 wrapper. */
function getEditorAreaEl(): HTMLElement {
  return document.getElementById('editor-area') as HTMLElement;
}

/** Build (or reuse) the split-mode DOM scaffold. Idempotent: calling on an
 * already-split layout is a no-op. The scaffold:
 *
 *   <div class="mid-split-root">
 *     <div class="mid-editor-column" id="editor-area">…strip 0 + #root…</div>
 *     <div class="mid-split-divider" />
 *     <div class="mid-editor-column">
 *       <div class="mid-tabstrip" id="tabstrip-2" />
 *       <div class="mid-inactive-root" id="root-2" />
 *     </div>
 *   </div>
 *
 * `#editor-area` is moved (not cloned) into the wrapper so all existing CSS
 * selectors that target it keep working.
 */
function enableSplitDOM(): void {
  if (splitWrapEl) return;
  const editorArea = getEditorAreaEl();
  if (!editorArea) return;
  // Stash where `#editor-area` originally lived so collapse can put it back.
  editorAreaOriginalParent = editorArea.parentElement;
  editorAreaOriginalNextSibling = editorArea.nextSibling;
  if (!editorAreaOriginalParent) return;

  const wrap = document.createElement('div');
  wrap.className = 'mid-split-root';
  wrap.style.gridTemplateColumns = `${tabSplitRatio * 100}% 6px 1fr`;
  splitWrapEl = wrap;

  // Mark column 0 (the original area) as a column for the flex parent.
  editorArea.classList.add('mid-editor-column', 'is-active');

  const divider = document.createElement('div');
  divider.className = 'mid-split-divider';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.title = 'Drag to resize';
  divider.addEventListener('mousedown', beginTabSplitDrag);

  const col2 = document.createElement('div');
  col2.className = 'mid-editor-column';

  const strip2 = document.createElement('div');
  strip2.id = 'tabstrip-2';
  strip2.className = 'mid-tabstrip';
  strip2.setAttribute('role', 'tablist');
  strip2.setAttribute('aria-label', 'Open files (split)');
  inactiveTabstripEl = strip2;

  const root2 = document.createElement('div');
  root2.id = 'root-2';
  root2.className = 'mid-inactive-root';
  inactiveRootEl = root2;

  // Click promotion is wired via the global document listener installed by
  // `setupSplitEdgeDropDetection`, so re-enabling split after a collapse does
  // not stack duplicate listeners.

  col2.append(strip2, root2);
  // Insert the wrapper where `#editor-area` was, then move the area inside.
  editorAreaOriginalParent.insertBefore(wrap, editorArea);
  wrap.append(editorArea, divider, col2);

  // Drop indicator (vertical highlight bar) is global — laid over whichever
  // column the cursor is hovering near the edge of.
  if (!splitDropIndicatorEl) {
    const ind = document.createElement('div');
    ind.className = 'mid-split-drop-indicator';
    ind.hidden = true;
    document.body.appendChild(ind);
    splitDropIndicatorEl = ind;
  }
}

/** Collapse the split DOM back into a single column. Moves `#editor-area`
 * back to its original parent and removes the wrapper + column 2. */
function disableSplitDOM(): void {
  if (!splitWrapEl) return;
  const editorArea = getEditorAreaEl();
  if (editorArea && editorAreaOriginalParent) {
    editorArea.classList.remove('mid-editor-column', 'is-active');
    editorAreaOriginalParent.insertBefore(editorArea, editorAreaOriginalNextSibling);
  }
  splitWrapEl.remove();
  splitWrapEl = null;
  inactiveTabstripEl = null;
  inactiveRootEl = null;
}

function getInactiveStripId(): 0 | 1 {
  return activeStripId === 0 ? 1 : 0;
}

/** Render the inactive column's tabstrip + a markdown preview of its active
 * tab. Called whenever the inactive strip's tabs change or its active pointer
 * moves. */
function renderInactiveColumn(): void {
  if (!splitActive) return;
  if (!inactiveTabstripEl || !inactiveRootEl) return;
  const stripId = getInactiveStripId();
  renderTabstripInto(inactiveTabstripEl, stripId, false);
  // Preview = the markdown of whatever tab is active in the inactive strip.
  const tab = inactiveActiveTabIndex >= 0 && inactiveActiveTabIndex < tabs.length
    ? tabs[inactiveActiveTabIndex]
    : null;
  inactiveRootEl.replaceChildren();
  if (!tab) {
    const empty = document.createElement('div');
    empty.className = 'mid-inactive-empty';
    empty.textContent = 'No file';
    inactiveRootEl.appendChild(empty);
    return;
  }
  const preview = document.createElement('div');
  preview.className = 'mid-preview mid-inactive-preview';
  // Render the inactive tab's markdown via a localised version of
  // populatePreview that doesn't touch `currentText`/the outline.
  preview.innerHTML = renderMarkdown(tab.text);
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
  inactiveRootEl.appendChild(preview);
}

/** Swap which column is the live editor. The current active tab's mirror gets
 * pushed back into its `FileTab`, the per-strip pointers swap, the new active
 * tab's mirror is pulled, and both columns re-render. */
function swapActiveColumn(): void {
  if (!splitActive) return;
  syncActiveTabFromMirror();
  captureScrollPosition();
  // Swap the per-strip active pointers AND flip activeStripId. The DOM nodes
  // themselves don't move — `editor-area` always hosts whichever strip is
  // currently active. The renderTabstrip() / renderInactiveColumn() pair below
  // re-paints both columns with their swapped roles.
  const tmp = activeTabIndex;
  activeTabIndex = inactiveActiveTabIndex;
  inactiveActiveTabIndex = tmp;
  activeStripId = getInactiveStripId();
  syncMirrorFromActiveTab();
  if (currentMode === 'view') renderView();
  else if (currentMode === 'edit') renderEdit();
  else renderSplit();
  highlightActiveTreeItem();
  updateWordCount();
  updateSaveIndicator(!activeTab()?.dirty);
  restoreScrollPosition();
  renderTabstrip();
  renderInactiveColumn();
  schedulePersistTabs();
}

/** Activate split mode by moving the tab at `globalFromIdx` into a new strip 1.
 * If split was already active, the tab simply joins the inactive strip at the
 * tail. Either way, the moved tab becomes that strip's active tab. */
function enableSplit(globalFromIdx: number): void {
  if (globalFromIdx < 0 || globalFromIdx >= tabs.length) return;
  const moving = tabs[globalFromIdx];
  if (!moving) return;
  // Don't allow split if it would empty the source strip and the moving tab
  // is already in the target strip's role — i.e. only one tab total.
  const sourceStrip = moving.stripId;
  const sourceStripCount = tabs.filter(t => t.stripId === sourceStrip).length;
  if (sourceStripCount <= 1 && !splitActive) return; // nothing to split off

  const targetStrip: 0 | 1 = sourceStrip === 0 ? 1 : 0;
  // Capture the live editor's mirror before reshuffling pointers.
  syncActiveTabFromMirror();
  captureScrollPosition();

  if (!splitActive) {
    splitActive = true;
    enableSplitDOM();
  }
  // Re-stamp the moving tab's stripId.
  moving.stripId = targetStrip;
  // The moved tab becomes the target strip's active tab.
  // Adjust pointers depending on whether the source strip is currently active.
  if (sourceStrip === activeStripId) {
    // The moved tab WAS the active strip's tab. The target is the OTHER strip.
    // After the move, the active strip lost it — pick a sibling to focus.
    if (globalFromIdx === activeTabIndex) {
      activeTabIndex = lastIndexInStrip(activeStripId);
    } else if (globalFromIdx < activeTabIndex) {
      // No splice happened (just stripId changed) — but `activeTabIndex`
      // pointer still refers to the same global slot. The fact that
      // tabs[activeTabIndex] is in active strip is preserved.
    }
    inactiveActiveTabIndex = globalFromIdx;
  } else {
    // The moving tab is leaving the inactive strip (rare path: drag from
    // inactive strip to its own edge). The source strip becomes active strip
    // counterpart. We promote.
    inactiveActiveTabIndex = lastIndexInStrip(sourceStrip);
    activeTabIndex = globalFromIdx;
    // The user just dropped a tab onto the source strip's edge — we keep their
    // focus on what they just moved, which means activeStripId flips.
    activeStripId = targetStrip;
  }
  syncMirrorFromActiveTab();
  if (currentMode === 'view') renderView();
  else if (currentMode === 'edit') renderEdit();
  else renderSplit();
  renderTabstrip();
  renderInactiveColumn();
  highlightActiveTreeItem();
  updateWordCount();
  updateSaveIndicator(!activeTab()?.dirty);
  restoreScrollPosition();
  schedulePersistTabs();
}

/** Move the tab at `globalFromIdx` into `targetStripId` at insertion position
 * `to` (insert-before semantics within the target strip). Handles cross-strip
 * drops from the strip's drop handler. */
function moveTabToStrip(globalFromIdx: number, _to: number, targetStripId: number): void {
  if (globalFromIdx < 0 || globalFromIdx >= tabs.length) return;
  const moving = tabs[globalFromIdx];
  if (!moving || moving.stripId === targetStripId) return;
  const sourceStrip = moving.stripId;
  const sourceWasActive = sourceStrip === activeStripId;
  // Just relabel the strip; persistence will renumber the per-strip idx.
  moving.stripId = targetStripId;
  // Snap the source strip's active pointer back into a tab that still belongs
  // to it.
  const sourcePtr = sourceWasActive ? 'active' : 'inactive';
  if (sourcePtr === 'active') {
    if (globalFromIdx === activeTabIndex) {
      activeTabIndex = lastIndexInStrip(sourceStrip);
    }
    if (globalFromIdx === inactiveActiveTabIndex || tabs[inactiveActiveTabIndex]?.stripId === targetStripId) {
      inactiveActiveTabIndex = globalFromIdx;
    }
  } else {
    if (globalFromIdx === inactiveActiveTabIndex) {
      inactiveActiveTabIndex = lastIndexInStrip(sourceStrip);
    }
    if (tabs[activeTabIndex]?.stripId !== activeStripId) {
      activeTabIndex = lastIndexInStrip(activeStripId);
    }
  }
  // If the source strip just emptied, collapse the split.
  const sourceEmpty = !tabs.some(t => t.stripId === sourceStrip);
  if (sourceEmpty) {
    collapseSplitAfterClose(sourceWasActive);
    return;
  }
  syncMirrorFromActiveTab();
  if (currentMode === 'view') renderView();
  else if (currentMode === 'edit') renderEdit();
  else renderSplit();
  renderTabstrip();
  if (splitActive) renderInactiveColumn();
  schedulePersistTabs();
}

/** Collapse the split back to a single column after the closing splice in
 * `closeTabAt` left one of the strips empty. Any surviving tabs are rehomed
 * into strip 0; strip 1 (and its DOM) is torn down. */
function collapseSplitAfterClose(closedActiveStrip: boolean): void {
  // Rehome every remaining tab into strip 0.
  for (const t of tabs) t.stripId = 0;
  // The active pointer must point into strip 0. Pick whichever per-strip
  // pointer was "the survivor" — if the closed tab was in the active strip,
  // the inactive pointer survives and becomes the new active.
  if (closedActiveStrip) {
    activeTabIndex = inactiveActiveTabIndex >= 0 ? inactiveActiveTabIndex : 0;
  }
  // Clamp into bounds.
  if (activeTabIndex >= tabs.length) activeTabIndex = tabs.length - 1;
  if (activeTabIndex < 0 && tabs.length > 0) activeTabIndex = 0;
  inactiveActiveTabIndex = -1;
  activeStripId = 0;
  splitActive = false;
  disableSplitDOM();
  syncMirrorFromActiveTab();
  if (tabs.length === 0) {
    activeTabIndex = -1;
  }
  if (currentMode === 'view') renderView();
  else if (currentMode === 'edit') renderEdit();
  else renderSplit();
  renderTabstrip();
  highlightActiveTreeItem();
  updateWordCount();
  updateSaveIndicator(true);
  restoreScrollPosition();
  schedulePersistTabs();
}

/** Drag the divider to resize. `tabSplitRatio` is the left column's share. */
function beginTabSplitDrag(start: MouseEvent): void {
  if (!splitWrapEl) return;
  start.preventDefault();
  const wrap = splitWrapEl;
  const wrapRect = wrap.getBoundingClientRect();
  const onMove = (e: MouseEvent): void => {
    const ratio = (e.clientX - wrapRect.left) / wrapRect.width;
    tabSplitRatio = Math.max(0.15, Math.min(0.85, ratio));
    wrap.style.gridTemplateColumns = `${tabSplitRatio * 100}% 6px 1fr`;
  };
  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    void window.mid.patchAppState({ tabSplitRatio } as Partial<AppState>);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/** Wire global drag listeners to detect when a tab drag enters the editor
 * area's left or right edge. We can't bind on the strip alone because the
 * user's intent is the EDITOR area's edges (per AC and the issue spec). */
function setupSplitEdgeDropDetection(): void {
  const editorArea = getEditorAreaEl();
  if (!editorArea) return;

  /** Returns the {column, side} the cursor is near, or null. */
  const detectEdgeZone = (clientX: number, clientY: number): { col: HTMLElement; side: 'left' | 'right' } | null => {
    // Figure out which column (if any) the pointer is over. When split is
    // inactive there is only `editorArea`; when active there are two columns.
    const candidates: HTMLElement[] = splitActive && splitWrapEl
      ? Array.from(splitWrapEl.querySelectorAll<HTMLElement>('.mid-editor-column'))
      : [editorArea];
    for (const col of candidates) {
      const r = col.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right) continue;
      if (clientY < r.top || clientY > r.bottom) continue;
      const fromLeft = clientX - r.left;
      const fromRight = r.right - clientX;
      if (fromLeft <= SPLIT_EDGE_THRESHOLD_PX) return { col, side: 'left' };
      if (fromRight <= SPLIT_EDGE_THRESHOLD_PX) return { col, side: 'right' };
      return null;
    }
    return null;
  };

  /** Show the drop indicator over the edge of `col` on `side`. */
  const showIndicator = (col: HTMLElement, side: 'left' | 'right'): void => {
    if (!splitDropIndicatorEl) return;
    const r = col.getBoundingClientRect();
    splitDropIndicatorEl.hidden = false;
    splitDropIndicatorEl.style.top = `${r.top}px`;
    splitDropIndicatorEl.style.height = `${r.height}px`;
    splitDropIndicatorEl.style.width = '4px';
    splitDropIndicatorEl.style.left = side === 'left' ? `${r.left}px` : `${r.right - 4}px`;
  };

  const hideIndicator = (): void => {
    if (splitDropIndicatorEl) splitDropIndicatorEl.hidden = true;
  };

  // We listen on `document` because the dragover events must bubble out of the
  // strip's row of tab buttons (they `preventDefault` for their own intra-strip
  // reorder DnD). The strip itself is a narrow horizontal sliver — the user
  // expects the EDITOR AREA's left/right margin to be the drop zone.
  document.addEventListener('dragover', ev => {
    if (!ev.dataTransfer?.types.includes('application/x-mid-tab')) return;
    const zone = detectEdgeZone(ev.clientX, ev.clientY);
    if (!zone) { hideIndicator(); return; }
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    showIndicator(zone.col, zone.side);
  });
  document.addEventListener('drop', ev => {
    const raw = ev.dataTransfer?.getData('application/x-mid-tab');
    if (raw == null || raw === '') return;
    const zone = detectEdgeZone(ev.clientX, ev.clientY);
    hideIndicator();
    if (!zone) return;
    const fromIdx = parseInt(raw, 10);
    if (Number.isNaN(fromIdx)) return;
    ev.preventDefault();
    // Determine which strip the drop maps to. Single-column case: split off.
    if (!splitActive) {
      enableSplit(fromIdx);
      return;
    }
    // Already split: figure out which strip the targeted column is.
    const col = zone.col;
    const isCol2 = col !== getEditorAreaEl();
    // When split is on, column 0 (the original `editor-area`) hosts whichever
    // strip is currently `activeStripId`; column 2 hosts the other. So the
    // strip id of the drop target is:
    const targetStripId: 0 | 1 = isCol2 ? getInactiveStripId() : activeStripId;
    const moving = tabs[fromIdx];
    if (!moving) return;
    if (moving.stripId === targetStripId) return; // same-strip drop = noop
    moveTabToStrip(fromIdx, 0, targetStripId);
  });
  document.addEventListener('dragend', hideIndicator);

  // Click promotion: clicking inside the inactive column (anywhere outside
  // tab buttons / divider) makes it the active column. The active column
  // ALWAYS lives in `#editor-area` — `swapActiveColumn` flips which strip's
  // tabs render there. So a click in column-2 (the sibling) means "promote
  // me". Tab buttons handle their own promotion via their click listener.
  document.addEventListener('click', ev => {
    if (!splitActive || !splitWrapEl) return;
    const target = ev.target as HTMLElement;
    if (target.closest('.mid-tab')) return;
    if (target.closest('.mid-tab__close')) return;
    if (target.closest('.mid-split-divider')) return;
    const col = target.closest('.mid-editor-column') as HTMLElement | null;
    if (!col) return;
    if (col.id === 'editor-area') return; // already the active column
    swapActiveColumn();
  });
}

setupSplitEdgeDropDetection();
