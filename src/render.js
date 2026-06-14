import { escapeHtml, timeAgo, formatFullDate } from './format.js';
import { previewOf } from './saves.js';
import { isDirty, titleOf } from './tabs.js';

// Builds the inner HTML for a single save record. Saved notes open as editable
// copies so the current draft is never overwritten.
function saveItemHtml(s) {
  const title = s.description
    ? `<div class="saveTitle">${escapeHtml(s.description)}</div>`
    : '';
  return `
    ${title}
    <div class="saveMeta">${timeAgo(s.date)} · ${formatFullDate(s.date)}</div>
    <div class="preview">${escapeHtml(previewOf(s.content))}</div>
    <div class="saveActions">
      <button data-id="${s.id}" data-action="edit-copy" type="button">Edit copy</button>
      <button data-id="${s.id}" data-action="del" class="danger">Delete</button>
    </div>`;
}

export function createSaveItem(s) {
  const li = document.createElement('li');
  li.className = 'saveItem';
  li.id = `save-item-${s.id}`;
  li.innerHTML = saveItemHtml(s);
  return li;
}

// Placeholder shown when the list is empty. Distinguishes "nothing saved yet"
// from "search matched nothing" so the hint stays useful.
function emptyStateHtml(hasQuery) {
  if (hasQuery) {
    return `
      <li class="emptyState">
        <svg class="emptyState-icon" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"></circle>
          <line x1="16.5" y1="16.5" x2="21" y2="21"></line>
        </svg>
        <div class="emptyState-title">No notes match your search</div>
        <div class="emptyState-hint">Try a different word, or clear the search box.</div>
      </li>`;
  }
  return `
    <li class="emptyState">
      <svg class="emptyState-icon" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 3h9l3 3v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"></path>
        <line x1="8.5" y1="10" x2="15.5" y2="10"></line>
        <line x1="8.5" y1="14" x2="15.5" y2="14"></line>
        <line x1="8.5" y1="18" x2="12.5" y2="18"></line>
      </svg>
      <div class="emptyState-title">No saved notes yet</div>
      <div class="emptyState-hint">Type something above and hit <strong>Save note</strong> — it lives only in this browser.</div>
    </li>`;
}

// Replaces the whole list (used on initial load, search, import, delete-all).
export function renderSaves(listEl, saves, { hasQuery = false } = {}) {
  listEl.innerHTML = '';
  if (saves.length === 0) {
    listEl.innerHTML = emptyStateHtml(hasQuery);
    return;
  }
  // saves are oldest → newest; prepend so the newest ends up on top.
  saves.forEach(s => listEl.prepend(createSaveItem(s)));
}

export function prependSaveItem(listEl, s) {
  // Drop the empty-state placeholder if it's the only thing in the list,
  // otherwise it would linger above the first saved note.
  const empty = listEl.querySelector('.emptyState');
  if (empty) empty.remove();
  listEl.prepend(createSaveItem(s));
}

// ---- Tab bar ----

// One tab chip: title + a trailing affordance that is a dirty dot when unsaved
// (and not hovered) or a × close button. Active tab gets `tab-active`.
function tabChipHtml(tab, activeId) {
  const cls =
    'tab' +
    (tab.id === activeId ? ' tab-active' : '') +
    (isDirty(tab) ? ' dirty' : '');
  return `
    <div class="${cls}" data-tab-id="${tab.id}" title="${escapeHtml(titleOf(tab))}">
      <span class="tab-title">${escapeHtml(titleOf(tab))}</span>
      <button class="tab-close" data-tab-id="${tab.id}" data-action="close" type="button" aria-label="Close tab">
        <span class="tab-dot"></span><span class="tab-x">×</span>
      </button>
    </div>`;
}

// Rebuilds the whole tab bar (cheap — few tabs) and appends the persistent +.
export function renderTabBar(barEl, tabs, activeId) {
  barEl.innerHTML =
    tabs.map(t => tabChipHtml(t, activeId)).join('') +
    `<button class="tab-add" data-action="new-tab" type="button" aria-label="New tab">+</button>`;
}

// Updates just the active chip's title + dirty state without rebuilding the bar
// (so typing never disturbs focus). Returns false if the chip wasn't found.
export function refreshActiveChip(barEl, tab) {
  const chip = barEl.querySelector(`.tab[data-tab-id="${tab.id}"]`);
  if (!chip) return false;
  chip.classList.toggle('dirty', isDirty(tab));
  const title = titleOf(tab);
  chip.title = title;
  const titleEl = chip.querySelector('.tab-title');
  if (titleEl) titleEl.textContent = title;
  return true;
}
