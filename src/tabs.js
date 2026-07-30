import LZString from 'lz-string';
import { KEY_WORKSPACE, KEY_DRAFT, TAB_TITLE_LENGTH } from './constants.js';

// The workspace is the full set of open editing tabs plus which one is active.
// It lives in localStorage (LZ-compressed).
//
// A tab is an editing buffer:
//   { id, description, content, saveId, starred }
// `saveId` links the tab to the note record it autosaves into (null until the
// tab has content). Tab ids are local to the workspace and unrelated to record
// ids. There is no "dirty" state any more: everything open is already saved.

let tabs = [];
let activeId = null;
let idCounter = 0;

const newId = () => `${Date.now()}-${idCounter++}`;

function makeTab(seed = {}) {
  return {
    id: newId(),
    description: seed.description || '',
    content: seed.content || '',
    saveId: Number.isFinite(seed.saveId) ? seed.saveId : null,
    starred: seed.starred === true,
  };
}

// ---- Title ----
export function titleOf(tab) {
  if (!tab) return 'New note';
  if (tab.description.trim()) return tab.description.trim();
  const firstLine = tab.content.split('\n').find(l => l.trim() !== '');
  if (firstLine) {
    const t = firstLine.trim();
    return t.length > TAB_TITLE_LENGTH
      ? t.slice(0, TAB_TITLE_LENGTH) + '…'
      : t;
  }
  return 'New note';
}

// ---- Accessors ----
// `rawList` is insertion order (the storage truth); `list` is display order.
export const rawList = () => tabs;

// Starred tabs lead. Array#sort is stable, so open order survives within each
// group. Every render path goes through this, so ordering is defined once.
export const list = () =>
  [...tabs].sort((a, b) => (b.starred === true) - (a.starred === true));

export const active = () => tabs.find(t => t.id === activeId) || null;
export const activeTabId = () => activeId;

export function setActive(id) {
  if (tabs.some(t => t.id === id)) activeId = id;
  return active();
}

// Fold the live editor values into whichever tab is active.
export function updateActive(content, description) {
  const tab = active();
  if (!tab) return;
  tab.content = content;
  tab.description = description;
}

// Add a tab (empty, or seeded from a record) and make it active.
export function add(seed) {
  const tab = makeTab(seed);
  tabs.push(tab);
  activeId = tab.id;
  return tab;
}

// Close a tab. If it was active, focus the nearest survivor in *display* order
// (right, else left) — picking the neighbour out of the raw array would jump the
// focus somewhere visually distant whenever starring has reordered the bar.
// Never leave the workspace empty: fall back to a single fresh tab.
export function close(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return active();

  const display = list(); // snapshot before the splice
  const displayIdx = display.findIndex(t => t.id === id);
  const wasActive = id === activeId;

  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    add();
    return active();
  }
  if (wasActive) {
    const survives = t => tabs.includes(t);
    const next =
      display.slice(displayIdx + 1).find(survives) ||
      display
        .slice(0, displayIdx)
        .reverse()
        .find(survives);
    if (next) activeId = next.id;
  }
  return active();
}

// ---- Lookups used to avoid opening the same note twice ----
export const findByContent = content =>
  tabs.find(t => t.content === content) || null;

export const findBySaveId = id =>
  id == null ? null : tabs.find(t => t.saveId === id) || null;

export const openSaveIds = () =>
  new Set(tabs.map(t => t.saveId).filter(id => id != null));

// ---- Starring ----
export function setStarred(id, value) {
  const tab = tabs.find(t => t.id === id);
  if (tab) tab.starred = value === true;
  return tab || null;
}

// ---- Persistence ----
// Returns false when the write was refused (quota), so callers can surface it —
// content now lives in both localStorage and IndexedDB, and localStorage's
// smaller cap will be the one to run out first.
export function persist() {
  const payload = LZString.compress(JSON.stringify({ tabs, activeId }));
  try {
    localStorage.setItem(KEY_WORKSPACE, payload);
    return true;
  } catch {
    return false;
  }
}

// Restore the workspace, migrating a legacy single draft on first run. Always
// guarantees at least one active tab exists.
export function loadWorkspace() {
  const raw = localStorage.getItem(KEY_WORKSPACE);
  if (raw) {
    const json = LZString.decompress(raw);
    try {
      const data = JSON.parse(json);
      if (data && Array.isArray(data.tabs) && data.tabs.length) {
        // Whitelisting the fields is also the migration: payloads written before
        // autosave carry baseContent/baseDescription and no saveId, so the old
        // fields are dropped and the link starts empty (startup reconciliation
        // then adopts or re-links each tab).
        const seenSaveIds = new Set();
        tabs = data.tabs.map(t => {
          let saveId = Number.isFinite(t.saveId) ? t.saveId : null;
          // Two tabs must never own one record.
          if (saveId != null && seenSaveIds.has(saveId)) saveId = null;
          if (saveId != null) seenSaveIds.add(saveId);
          return {
            id: t.id || newId(),
            content: typeof t.content === 'string' ? t.content : '',
            description: typeof t.description === 'string' ? t.description : '',
            saveId,
            starred: t.starred === true,
          };
        });
        activeId = tabs.some(t => t.id === data.activeId)
          ? data.activeId
          : tabs[0].id;
        return active();
      }
    } catch {
      // Fall through to migration / fresh start.
    }
  }

  // Migrate the legacy single draft (autosave_draft) into one tab.
  const legacy = localStorage.getItem(KEY_DRAFT);
  if (legacy) {
    const json = LZString.decompress(legacy);
    try {
      const draft = JSON.parse(json);
      const text = typeof draft.text === 'string' ? draft.text : '';
      const description =
        typeof draft.description === 'string' ? draft.description : '';
      if (text || description) {
        tabs = [];
        add({ content: text, description });
        localStorage.removeItem(KEY_DRAFT);
        return active();
      }
    } catch {
      // ignore malformed legacy draft
    }
    localStorage.removeItem(KEY_DRAFT);
  }

  // Fresh start: one empty tab.
  tabs = [];
  return add();
}
