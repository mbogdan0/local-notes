import { TAB_COLLAPSE_THRESHOLD } from './constants.js';
import { escapeHtml, timeAgo, formatFullDate } from './format.js';
import { previewOf, savedAt } from './saves.js';
import { titleOf } from './tabs.js';

// ---- Saved notes ----

// An inline SVG rather than the ★/☆ characters: those fall back to a symbol or
// emoji font when the UI font lacks them, which lands them off the baseline and
// at the wrong size. A path is identical everywhere and scales exactly.
const starIcon = (filled, size = 14) =>
  `<svg class="star-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${
    filled ? 'currentColor' : 'none'
  }" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/></svg>`;

// Swaps an existing star button's icon in place.
const setStarIcon = (btn, filled) => {
  const svg = btn.querySelector('.star-icon');
  if (svg) svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  btn.setAttribute('aria-pressed', filled ? 'true' : 'false');
};

// The title div is always emitted (hidden when there is no description) so that
// updating a card in place never has to create or destroy nodes.
function saveItemHtml(s) {
  return `
    <div class="saveTitle"${s.description ? '' : ' hidden'}>${escapeHtml(s.description)}</div>
    <div class="saveMeta">${escapeHtml(timeAgo(savedAt(s)))} · ${escapeHtml(formatFullDate(s.date))}</div>
    <div class="preview">${escapeHtml(previewOf(s.content))}</div>
    <div class="saveOpenBadge" hidden>Open in a tab</div>
    <div class="saveActions">
      <button data-id="${s.id}" data-action="star" class="star-btn" type="button" aria-pressed="${s.starred ? 'true' : 'false'}" aria-label="Star note">${starIcon(s.starred)}</button>
      <button data-id="${s.id}" data-action="open-draft" type="button">Open</button>
      <button data-id="${s.id}" data-action="open-markdown" type="button">Markdown</button>
      <button data-id="${s.id}" data-action="copy-text" type="button">Copy</button>
      <button data-id="${s.id}" data-action="del" class="danger">Delete</button>
    </div>`;
}

export function createSaveItem(s) {
  const li = document.createElement('li');
  li.className = 'saveItem' + (s.starred ? ' starred' : '');
  li.id = `save-item-${s.id}`;
  li.innerHTML = saveItemHtml(s);
  return li;
}

// Placeholder shown when the list is empty. Distinguishes "nothing saved yet"
// from "search matched nothing" and "nothing starred" so the hint stays useful.
function emptyStateHtml({ hasQuery = false, starredOnly = false } = {}) {
  const searchIcon = `
    <svg class="emptyState-icon" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7"></circle>
      <line x1="16.5" y1="16.5" x2="21" y2="21"></line>
    </svg>`;

  if (hasQuery) {
    return `
      <li class="emptyState">
        ${searchIcon}
        <div class="emptyState-title">No notes match your search</div>
        <div class="emptyState-hint">Try a different word, or clear the search box.</div>
      </li>`;
  }

  if (starredOnly) {
    return `
      <li class="emptyState">
        <div class="emptyState-icon">${starIcon(false, 40)}</div>
        <div class="emptyState-title">Nothing starred yet</div>
        <div class="emptyState-hint">Star a tab or a note to keep the important ones at the top.</div>
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
      <div class="emptyState-hint">Start typing above — every open tab saves itself here automatically.</div>
    </li>`;
}

// Replaces the whole list. `saves` must already be in display order — the caller
// sorts, because "starred first, then newest" cannot be expressed by prepending.
export function renderSaves(listEl, saves, options = {}) {
  listEl.innerHTML = '';
  if (saves.length === 0) {
    listEl.innerHTML = emptyStateHtml(options);
    return;
  }
  saves.forEach(s => listEl.append(createSaveItem(s)));
}

export function ensureEmptyState(listEl, options = {}) {
  if (listEl.querySelector('.saveItem')) return;
  listEl.innerHTML = emptyStateHtml(options);
}

// Surgical update. Touches only the title / meta / preview / star and the <li>
// class — never `.saveActions`, so a running "Undo (3s)" countdown on the Delete
// button (its text, its class, its timers) survives untouched.
export function updateSaveItem(listEl, save) {
  const li = listEl.querySelector(`#save-item-${save.id}`);
  if (!li) return false;

  li.classList.toggle('starred', save.starred === true);

  const title = li.querySelector('.saveTitle');
  if (title) {
    title.textContent = save.description || '';
    title.hidden = !save.description;
  }

  const meta = li.querySelector('.saveMeta');
  if (meta) {
    meta.textContent = `${timeAgo(savedAt(save))} · ${formatFullDate(save.date)}`;
  }

  const preview = li.querySelector('.preview');
  if (preview) preview.textContent = previewOf(save.content);

  const star = li.querySelector('.star-btn');
  if (star) setStarIcon(star, save.starred === true);

  return true;
}

// Insert a new card, or move an existing one, into its slot in `orderedIds`.
// One positioning routine serves both cases.
export function placeSaveItem(listEl, save, orderedIds) {
  const empty = listEl.querySelector('.emptyState');
  if (empty) empty.remove();

  const li = listEl.querySelector(`#save-item-${save.id}`) || createSaveItem(save);
  const at = orderedIds.indexOf(save.id);
  const after = at === -1 ? [] : orderedIds.slice(at + 1);
  const anchor = after
    .map(id => listEl.querySelector(`#save-item-${id}`))
    .find(el => el && el !== li);

  if (anchor) listEl.insertBefore(li, anchor);
  else listEl.append(li);
  return li;
}

export function removeSaveItem(listEl, id) {
  const li = listEl.querySelector(`#save-item-${id}`);
  if (!li) return false;
  li.remove();
  return true;
}

// Flags the cards whose note is currently open in a tab — without it the 1:1
// tab/note relationship is invisible.
export function markOpenSaveItems(listEl, openIds) {
  listEl.querySelectorAll('.saveItem').forEach(li => {
    const id = Number(li.id.replace('save-item-', ''));
    const isOpen = openIds.has(id);
    li.classList.toggle('is-open', isOpen);
    const badge = li.querySelector('.saveOpenBadge');
    if (badge) badge.hidden = !isOpen;
  });
}

// ---- Tab bar ----

// One tab chip: a star toggle, the title, and a trailing affordance that is an
// autosave-pending dot (when a write is queued and the chip isn't hovered) or a
// × close button.
function tabChipHtml(tab, activeId, pendingIds) {
  const title = titleOf(tab);
  const isActive = tab.id === activeId;
  const cls =
    'tab' +
    (isActive ? ' tab-active' : '') +
    (tab.starred ? ' starred' : '') +
    (pendingIds.has(tab.id) ? ' pending' : '');
  return `
    <div class="${cls}" data-tab-id="${tab.id}" role="tab" aria-selected="${isActive}" title="${escapeHtml(title)}">
      <button class="tab-star" data-tab-id="${tab.id}" data-action="star" type="button" aria-pressed="${tab.starred ? 'true' : 'false'}" aria-label="Star tab">${starIcon(tab.starred, 13)}</button>
      <span class="tab-title">${escapeHtml(title)}</span>
      <button class="tab-close" data-tab-id="${tab.id}" data-action="close" type="button" aria-label="Close tab">
        <span class="tab-dot"></span><span class="tab-x">×</span>
      </button>
    </div>`;
}

// Rebuilds the whole tab bar (cheap — few tabs). The chips and the persistent +
// live in an inner `.tab-rows` element, which is what gets clipped: the expand
// toggle has to sit outside it or collapsing would hide the very button that
// un-collapses the bar.
export function renderTabBar(barEl, tabs, activeId, options = {}) {
  const { pendingIds = new Set(), expanded = false } = options;
  const toggle =
    tabs.length > TAB_COLLAPSE_THRESHOLD
      ? `<button class="tab-bar-toggle" data-action="toggle-rows" type="button" aria-expanded="${expanded}">${
          expanded ? 'Show fewer' : `Show all (${tabs.length})`
        }</button>`
      : '';

  barEl.classList.toggle('is-expanded', expanded);
  barEl.innerHTML =
    `<div class="tab-rows">` +
    tabs.map(t => tabChipHtml(t, activeId, pendingIds)).join('') +
    `<button class="tab-add" data-action="new-tab" type="button" aria-label="New tab">+</button>` +
    `</div>` +
    toggle;
}

// Updates just the active chip's title + pending state without rebuilding the
// bar (so typing never disturbs focus). Starring is deliberately not handled
// here: it reorders the bar and needs a full render. Returns false if the chip
// wasn't found.
export function refreshActiveChip(barEl, tab, { pending = false } = {}) {
  if (!tab) return false;
  const chip = barEl.querySelector(`.tab[data-tab-id="${tab.id}"]`);
  if (!chip) return false;
  chip.classList.toggle('pending', pending);
  const title = titleOf(tab);
  chip.title = title;
  const titleEl = chip.querySelector('.tab-title');
  if (titleEl) titleEl.textContent = title;
  return true;
}
