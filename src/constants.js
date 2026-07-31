// Storage keys (localStorage) for the open workspace and view settings.
export const KEY_DRAFT = 'autosave_draft';
export const KEY_WORKSPACE = 'workspace_tabs';
export const KEY_WIDTH = 'notes_maxWidth';
export const KEY_FONT = 'notes_fontFamily';
export const KEY_SCALE = 'notes_fontScale';

// IndexedDB location for saved notes.
export const DB_NAME = 'local-notes';
export const DB_VERSION = 1;
export const STORE_SAVES = 'saves';

// Defaults match the original stylesheet.
export const DEFAULT_WIDTH = '1050px';
export const DEFAULT_FONT = "'JetBrains Mono', monospace";
// Multiplies the root font size, so every rem-based size scales with it.
export const DEFAULT_SCALE = '1';

// How many characters of content to show in a save preview.
export const PREVIEW_LENGTH = 200;

// Seconds for the undo countdown on Clear / per-record Delete.
export const UNDO_SECONDS = 5;

// The open workspace is flushed to localStorage on this interval (ms).
export const WORKSPACE_PERSIST_INTERVAL = 200;

// Autosave into the notes library (IndexedDB).
export const AUTOSAVE_DEBOUNCE = 1200; // ms of keystroke silence before a write
export const AUTOSAVE_MAX_WAIT = 8000; // force a write during continuous typing
export const AUTOSAVE_ERROR_BACKOFF = 15000; // pause writes after a storage failure
export const STATUS_TICK_INTERVAL = 10000; // refresh the "Saved · Ns ago" label
export const ADOPTION_NOTICE_MS = 4000; // how long the first-run adoption notice shows

// Tab count above which the bar offers its expand toggle. How many rows stay
// visible when collapsed is a purely visual knob and lives in CSS (--tab-rows).
export const TAB_COLLAPSE_THRESHOLD = 12;

// Characters of the first content line used as a tab title.
export const TAB_TITLE_LENGTH = 24;

// Word counting allocates proportionally to the text, and this is a pastebin —
// above this size the stats line shows characters only.
export const WORD_COUNT_LIMIT = 200000;
