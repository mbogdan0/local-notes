# Local Notes 📝

A pastebin that never paste-*bins* anything anywhere. It just sits in your browser, holds your text, and minds its own business.

**Live:** <https://mbogdan0.github.io/local-notes/>

## Why this exists 🤔

I like writing in a big textarea. Not in a "rich text editor" with a floating toolbar that follows me around like it wants to sell me something. Not in an app that needs an account, a workspace, a team, and a credit card to remember three lines of a shell command. Just — a box. A large, calm, off-white box I can dump thoughts into.

So I made one. For myself. Then it grew tabs, autosave, search, and import/export, because apparently I cannot leave a box alone.

It's yours now too. Enjoy. 🎉

## What it does ✨

- **One big textarea** that grows as you type — the whole point.
- **Tabs** 🗂️ — keep several notes open at once, each with its own little "you have unsaved changes" dot that quietly judges you.
- **Autosave** ⚡ — your in-progress workspace is flushed to `localStorage` every 200ms, so a refresh (or a crash, no judgement) won't eat your text.
- **Save notes** 💾 — promote a tab to a saved record, stored in IndexedDB and searchable.
- **Search** 🔍 — find that thing you wrote three weeks ago by a word you half-remember.
- **Undo on Clear / Delete** ↩️ — a 5-second "wait, no" window, because we all misclick.
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

- **Workspace (`localStorage`, LZ-compressed)** — the live set of open tabs and which one is active. This is the *ephemeral* editing state, autosaved every 200ms. A tab tracks a `base*` snapshot of its last-saved content so it can tell when it's "dirty".
- **Saved notes (`IndexedDB`)** — the durable records (`{ id, date, description, content }`), stored as plain text so the content stays searchable. Sorted oldest → newest and prepended into the list so the newest sits on top.

`src/db.js` is a thin promise-based wrapper over IndexedDB; nothing fancy, just `getAll` / `put` / `delete` / `clear`.

### Project layout

```
index.html          # markup + SEO meta + a visually-hidden semantic header
src/
  main.js           # wiring: editor ⇆ tabs, event handlers, app lifecycle
  tabs.js           # workspace model (open tabs, active tab, dirty tracking)
  db.js             # IndexedDB wrapper for saved notes
  saves.js          # save records: make / dedupe / preview
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
