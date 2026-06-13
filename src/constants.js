// Storage keys (localStorage) for the in-progress draft and view settings.
export const KEY_DRAFT = 'autosave_draft';
export const KEY_WIDTH = 'notes_maxWidth';
export const KEY_FONT = 'notes_fontFamily';

// IndexedDB location for saved notes.
export const DB_NAME = 'local-notes';
export const DB_VERSION = 1;
export const STORE_SAVES = 'saves';

// Defaults match the original stylesheet.
export const DEFAULT_WIDTH = '1050px';
export const DEFAULT_FONT = "'JetBrains Mono', monospace";

// How many characters of content to show in a save preview.
export const PREVIEW_LENGTH = 200;

// Seconds for the undo countdown on Clear / per-record Delete.
export const UNDO_SECONDS = 5;

// Draft is flushed to localStorage on this interval (ms), as in the original.
export const AUTOSAVE_INTERVAL = 200;
