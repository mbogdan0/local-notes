import { PREVIEW_LENGTH } from './constants.js';

// A save record: { id, date (ISO), description, content }.
// `preview` is derived at render time from `content`, not stored.

export function makeSave(content, description) {
  return {
    id: Date.now(),
    date: new Date().toISOString(),
    description: description || '',
    content,
  };
}

export const isDuplicate = (saves, content) =>
  saves.some(s => s.content === content);

export const previewOf = content => content.slice(0, PREVIEW_LENGTH);
