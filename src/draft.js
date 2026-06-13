import LZString from 'lz-string';
import { KEY_DRAFT } from './constants.js';

// The in-progress draft (text + optional description) lives in localStorage,
// compressed via lz-string — preserving the original autosave behavior.

export function loadDraft() {
  const raw = localStorage.getItem(KEY_DRAFT);
  if (!raw) return null;
  const json = LZString.decompress(raw);
  if (!json) return null;
  try {
    const draft = JSON.parse(json);
    return {
      text: typeof draft.text === 'string' ? draft.text : '',
      description: typeof draft.description === 'string' ? draft.description : '',
    };
  } catch {
    return null;
  }
}

export function saveDraft(text, description) {
  const payload = LZString.compress(JSON.stringify({ text, description }));
  try {
    localStorage.setItem(KEY_DRAFT, payload);
  } catch {
    // Draft autosave is best-effort; a full quota should not break the app.
  }
}

export function clearDraft() {
  localStorage.removeItem(KEY_DRAFT);
}
