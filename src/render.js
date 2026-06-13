import { escapeHtml, timeAgo, formatFullDate } from './format.js';
import { previewOf } from './saves.js';

// Builds the inner HTML for a single save record.
function saveItemHtml(s) {
  const title = s.description
    ? `<div class="saveTitle">${escapeHtml(s.description)}</div>`
    : '';
  return `
    ${title}
    <div class="saveMeta">${timeAgo(s.date)} · ${formatFullDate(s.date)}</div>
    <div class="preview">${escapeHtml(previewOf(s.content))}</div>
    <div class="saveActions">
      <button data-id="${s.id}" data-action="load">Switch</button>
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

// Replaces the whole list (used on initial load, search, import, delete-all).
export function renderSaves(listEl, saves) {
  listEl.innerHTML = '';
  // saves are oldest → newest; prepend so the newest ends up on top.
  saves.forEach(s => listEl.prepend(createSaveItem(s)));
}

export function prependSaveItem(listEl, s) {
  listEl.prepend(createSaveItem(s));
}
