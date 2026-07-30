import { PREVIEW_LENGTH } from './constants.js';

// A save record: { id, date (ISO), updatedAt (ISO), description, content, starred }.
// `date` is the creation moment and never changes; `updatedAt` moves with every
// autosave write. `preview` is derived at render time from `content`, not stored.
//
// Records written before autosave existed have neither `updatedAt` nor `starred`
// — read them through `savedAt()` / `!!s.starred` and let the next write backfill.

let lastId = 0;

// Autosave makes two records in the same millisecond reachable, and a bare
// Date.now() would hand them the same key. Stay monotonic within the session.
export const newSaveId = () => (lastId = Math.max(Date.now(), lastId + 1));

export const savedAt = s => s.updatedAt || s.date;

// Library order: starred first, then most recently written.
export const orderSaves = saves =>
  [...saves].sort(
    (a, b) =>
      (b.starred === true) - (a.starred === true) ||
      new Date(savedAt(b)) - new Date(savedAt(a))
  );

export const previewOf = content => content.slice(0, PREVIEW_LENGTH);
