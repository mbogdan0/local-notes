import LZString from 'lz-string';
import { KEY_WORKSPACE, KEY_DRAFT } from './constants.js';

// The workspace is the full set of open editing tabs plus which one is active.
// It lives in localStorage (LZ-compressed), generalizing the old single draft.
//
// A tab is an editing buffer:
//   { id, description, content, baseDescription, baseContent }
// `base*` is the last-saved snapshot — a tab is "dirty" when its live content has
// drifted from it. Tab ids are local to the workspace and unrelated to save records.

let tabs = [];
let activeId = null;
let idCounter = 0;

const newId = () => `${Date.now()}-${idCounter++}`;

function makeTab(seed = {}) {
  const description = seed.description || '';
  const content = seed.content || '';
  return {
    id: newId(),
    description,
    content,
    // A seeded tab (opened from a record) starts clean; an empty tab also clean.
    baseDescription: description,
    baseContent: content,
  };
}

// ---- Dirty / title helpers ----
export function isDirty(tab) {
  if (!tab) return false;
  if (tab.content.trim() === '') return false;
  return tab.content !== tab.baseContent || tab.description !== tab.baseDescription;
}

export function titleOf(tab) {
  if (!tab) return 'New note';
  if (tab.description.trim()) return tab.description.trim();
  const firstLine = tab.content.split('\n').find(l => l.trim() !== '');
  if (firstLine) {
    const t = firstLine.trim();
    return t.length > 24 ? t.slice(0, 24) + '…' : t;
  }
  return 'New note';
}

// ---- Accessors ----
export const list = () => tabs;
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

// Mark a tab as saved — its current content becomes the clean baseline.
export function markSaved(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  tab.baseContent = tab.content;
  tab.baseDescription = tab.description;
}

// Close a tab. If it was active, focus a neighbour (right, else left). Never leave
// the workspace empty — fall back to a single fresh tab.
export function close(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return active();
  const wasActive = id === activeId;
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    add();
  } else if (wasActive) {
    const next = tabs[idx] || tabs[idx - 1];
    activeId = next.id;
  }
  return active();
}

// Replace every tab with a single fresh empty one (used by "Save & close all").
export function resetToSingle() {
  tabs = [];
  idCounter = 0;
  return add();
}

// Find a tab whose live content matches a saved record's content (to avoid
// opening the same note twice).
export const findByContent = content => tabs.find(t => t.content === content) || null;

// ---- Persistence ----
export function persist() {
  const payload = LZString.compress(JSON.stringify({ tabs, activeId }));
  try {
    localStorage.setItem(KEY_WORKSPACE, payload);
  } catch {
    // Best-effort: a full quota must not break editing.
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
        tabs = data.tabs.map(t => ({
          id: t.id || newId(),
          content: typeof t.content === 'string' ? t.content : '',
          description: typeof t.description === 'string' ? t.description : '',
          baseContent: typeof t.baseContent === 'string' ? t.baseContent : '',
          baseDescription:
            typeof t.baseDescription === 'string' ? t.baseDescription : '',
        }));
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
        const tab = add({ content: text, description });
        // The migrated draft was unsaved work — keep it dirty.
        tab.baseContent = '';
        tab.baseDescription = '';
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
