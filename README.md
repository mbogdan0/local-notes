# Local Notes 📝

A pastebin that never paste-*bins* anything anywhere. It just sits in your browser, holds your text, and minds its own business.

**Live:** <https://mbogdan0.github.io/local-notes/>

## Why this exists 🤔

I like writing in a big textarea. Not in a "rich text editor" with a floating toolbar that follows me around like it wants to sell me something. Not in an app that needs an account, a workspace, a team, and a credit card to remember three lines of a shell command. Just — a box. A large, calm, off-white box I can dump thoughts into.

So I made one. For myself. Then it grew tabs, autosave, search, and import/export, because apparently I cannot leave a box alone.

It's yours now too. Enjoy. 🎉

## What it does ✨

- **One big textarea** that grows as you type — the whole point.
- **Tabs** 🗂️ — keep several notes open at once. They wrap onto multiple rows instead of scrolling sideways, so nothing hides off the edge.
- **Everything saves itself** ⚡ — every open tab is continuously written into your notes library. There is no "did I save this?" moment, because there is nothing to decide: closing a tab keeps the note. The workspace also gets flushed to `localStorage` every 200ms, so a refresh (or a crash, no judgement) won't eat your text either.
- **Stars** ⭐ — mark the tabs that matter. Starred tabs sort to the front, survive **Close all tabs**, and can be filtered in the library. This is the answer to "I have 30 tabs open and no idea which ones I care about."
- **Search** 🔍 — find that thing you wrote three weeks ago by a word you half-remember.
- **Undo on Clear / Delete** ↩️ — a 5-second "wait, no" window, because we all misclick. Letting Clear's window lapse on an empty tab is also the deliberate way to throw a note away.
- **Empty state** 🫙 — a friendly nudge when there's nothing here yet, instead of a sad blank void.
- **Export / Import** 📦 — your notes as JSON, to back up or move between browsers.
- **Width & font toggles** — narrow/wide, sans/mono. Small comforts.

## What it deliberately does *not* do 🚫

- No server. No backend. No API. No "cloud".
- No accounts, no login, no "sign in with".
- No tracking, no analytics, no telemetry, no cookies-consent-banner theatre.
- No syncing. If you want the same notes on another machine, that's what Export is for.

Everything is stored **locally in your browser**. Nothing leaves your device. That's not a premium feature — it's the entire architecture. The privacy policy is "there is no server, so there's nowhere for your data to go." 🔒

## Technical details 🛠️

A small, dependency-light, vanilla-JS single-page app. No framework, on purpose.

### Stack

- **Vanilla JavaScript** (ES modules) — no React, no Vue, no virtual DOM. Just functions and the actual DOM.
- **[Vite](https://vitejs.dev/)** for dev server and build.
- **[`vite-plugin-singlefile`](https://github.com/richstokes/vite-plugin-singlefile)** — the production build inlines all CSS and JS into one self-contained `dist/index.html`. Double-click it, no server needed.
- **[`lz-string`](https://github.com/pieroxy/lz-string)** — the only runtime dependency, used to LZ-compress the workspace before it goes into `localStorage`.

### Storage model

Two layers, on purpose:

- **Workspace (`localStorage`, LZ-compressed)** — the live set of open tabs and which one is active. A tab is `{ id, description, content, saveId, starred }`, where `saveId` links it to the note record it autosaves into. Flushed every 200ms.
- **Saved notes (`IndexedDB`)** — the durable records (`{ id, date, updatedAt, description, content, starred }`), stored as plain text so the content stays searchable. `date` is the creation moment and never moves; `updatedAt` tracks the last write. Ordered starred-first, then most recently written.

A tab and its record are 1:1. That's the whole design: because a tab always owns exactly one record, there's no "dirty" state to track, no save button that doubles as a close button, and no duplicate-content check standing between you and two tabs that happen to hold the same text. A debounced writer folds each tab into its record, serialised through a single promise chain so concurrent writes can't interleave, and reconciled on startup in case an unload beat the debounce.

`src/db.js` is a thin promise-based wrapper over IndexedDB; nothing fancy, just `getAll` / `put` / `delete` / `clear`.

### Project layout

```
index.html          # markup + SEO meta + a visually-hidden semantic header
src/
  main.js           # wiring: editor ⇆ tabs, autosave engine, event handlers
  tabs.js           # workspace model (open tabs, active tab, record links, stars)
  db.js             # IndexedDB wrapper for saved notes
  saves.js          # save records: ids / ordering / preview
  render.js         # DOM builders for save cards, tab chips, empty state
  search.js         # client-side filtering of saved notes
  settings.js       # width / font preferences (localStorage)
  exportImport.js   # JSON export & import (with duplicate skipping)
  format.js         # date formatting, HTML escaping
  constants.js      # storage keys, defaults, magic numbers
  styles/           # plain CSS, split by concern, composed via index.css
```

## Running it 🏃

```bash
npm install     # one dependency, plus Vite
npm run dev     # http://localhost:5173
npm run build   # → dist/index.html (single self-contained file)
npm run preview # serve the production build locally
```

The build output is a single HTML file. You can email it to yourself, drop it on a USB stick, or open it straight from disk — it'll work offline because there was never anything online to begin with.

## Author

Made by [Bohdan Melnichenko](https://mbogdan0.github.io/).

## License

Do whatever you like with it. It's a text box. ✌️
