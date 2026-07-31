import './styles/index.css';

import {
  UNDO_SECONDS,
  WORKSPACE_PERSIST_INTERVAL,
  AUTOSAVE_DEBOUNCE,
  AUTOSAVE_MAX_WAIT,
  AUTOSAVE_ERROR_BACKOFF,
  STATUS_TICK_INTERVAL,
  ADOPTION_NOTICE_MS,
  WORD_COUNT_LIMIT,
} from './constants.js';
import {
  getAllSaves,
  deleteSave,
  deleteSaves,
  clearAllSaves,
  addSave,
} from './db.js';
import { newSaveId, orderSaves } from './saves.js';
import {
  renderSaves,
  renderTabBar,
  refreshActiveChip,
  updateSaveItem,
  placeSaveItem,
  removeSaveItem,
  ensureEmptyState,
  markOpenSaveItems,
} from './render.js';
import { filterSaves } from './search.js';
import { escapeHtml } from './format.js';
import { renderMarkdown } from './markdown.js';
import { loadSettings, applySetting, SETTING_TYPES } from './settings.js';
import { exportSaves, importSaves } from './exportImport.js';
import {
  loadWorkspace,
  persist,
  rawList,
  list as tabList,
  active,
  activeTabId,
  setActive,
  updateActive,
  add as addTab,
  close as closeTab,
  findByContent,
  findBySaveId,
  setStarred,
  setView,
  viewOf,
  openSaveIds,
} from './tabs.js';

document.addEventListener('DOMContentLoaded', () => {
  const descInput = document.getElementById('descInput');
  const textArea = document.getElementById('mainText');
  const doneBtn = document.getElementById('doneBtn');
  const clearBtn = document.getElementById('clearBtn');
  const autosaveStatus = document.getElementById('autosaveStatus');
  const autosaveLabel = autosaveStatus.querySelector('.autosave-label');
  const autosaveAgo = autosaveStatus.querySelector('.autosave-ago');
  const docStats = document.getElementById('docStats');
  const editorModes = document.getElementById('editorModes');
  const markdownView = document.getElementById('markdownView');
  const closeAllBtn = document.getElementById('closeAllBtn');
  const closeUnstarredBtn = document.getElementById('closeUnstarredBtn');
  const searchInput = document.getElementById('searchInput');
  const starFilterBtn = document.getElementById('starFilterBtn');
  const savesList = document.getElementById('savesList');
  const viewControls = document.getElementById('viewControls');
  const tabBar = document.getElementById('tabBar');

  const menu = document.getElementById('menu');
  const menuBtn = document.getElementById('menuBtn');
  const menuList = document.getElementById('menuList');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const deleteUnstarredBtn = document.getElementById('deleteUnstarredBtn');
  const deleteAllBtn = document.getElementById('deleteAllBtn');
  const fileInput = document.getElementById('fileInput');

  let savesCache = [];
  const pendingDeletions = {};
  let pendingClearState = null;
  let starredOnly = false;
  let barExpanded = false;

  // ---- Autosave state ----
  // One armed timer pair per tab, and a single promise chain so two writes can
  // never interleave no matter how fast the user switches tabs.
  const pendingWrites = new Map(); // tabId -> { timer, maxTimer }
  let writeChain = Promise.resolve();
  let autosaveErrorUntil = 0;
  let lastSavedAt = null;
  let autosaveState = 'idle'; // 'idle' | 'saving' | 'saved' | 'error'
  let workspaceFull = false;
  let statusNotice = null;
  let statusNoticeTimeout = null;

  // ---- Status indicator ----
  const agoLabel = ts => {
    const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  const renderStatus = () => {
    let state = autosaveState;
    let label = '';
    let ago = '';

    if (statusNotice) {
      state = 'saved';
      label = statusNotice;
    } else if (workspaceFull) {
      state = 'error';
      label = 'Storage full — open tabs may not be remembered';
    } else if (state === 'saving') {
      label = 'Saving…';
    } else if (state === 'error') {
      label = 'Could not save — retrying';
    } else if (state === 'saved' && lastSavedAt) {
      label = 'Saved';
      ago = ` · ${agoLabel(lastSavedAt)}`;
    }

    autosaveStatus.className = `autosave-status is-${state}`;
    autosaveLabel.textContent = label;
    autosaveAgo.textContent = ago;
  };

  const setAutosaveState = state => {
    autosaveState = state;
    renderStatus();
  };

  // Return the indicator to rest. Needed because a scheduled write can end up
  // doing nothing (an emptied tab), which would otherwise strand it on "Saving…"
  // forever. Stays put while any other tab still has a write queued.
  const settleStatus = () => {
    if (pendingWrites.size > 0) return;
    setAutosaveState(lastSavedAt ? 'saved' : 'idle');
  };

  // A one-off message that briefly takes over the indicator.
  const flashStatus = message => {
    clearTimeout(statusNoticeTimeout);
    statusNotice = message;
    renderStatus();
    statusNoticeTimeout = setTimeout(() => {
      statusNotice = null;
      renderStatus();
    }, ADOPTION_NOTICE_MS);
  };

  // Content now lives in both localStorage and IndexedDB, and localStorage's
  // smaller cap runs out first — so a refused write has to be visible.
  const persistWorkspace = () => {
    const ok = persist();
    if (workspaceFull !== !ok) {
      workspaceFull = !ok;
      renderStatus();
    }
    return ok;
  };

  // ---- Derived views ----
  const emptyOpts = () => ({
    hasQuery: searchInput.value.trim() !== '',
    starredOnly,
  });

  const visibleSaves = () =>
    orderSaves(filterSaves(savesCache, searchInput.value, { starredOnly }));

  const renderFiltered = () => {
    renderSaves(savesList, visibleSaves(), emptyOpts());
    markOpenSaveItems(savesList, openSaveIds());
  };

  const isPending = id => pendingWrites.has(id);
  const refreshChip = tab =>
    refreshActiveChip(tabBar, tab, { pending: tab && isPending(tab.id) });

  // The collapsed max-height can hide the active chip, leaving no sense of
  // place. Measured with rects, not offsetTop, which is relative to the offset
  // parent rather than to the clipped element — and synchronously, because
  // getBoundingClientRect already forces layout and a rAF would simply never
  // run while the page is in a background tab.
  const activeChipIsClipped = () => {
    const rows = tabBar.querySelector('.tab-rows');
    const chip = tabBar.querySelector('.tab-active');
    if (!rows || !chip) return false;
    return (
      chip.getBoundingClientRect().bottom >
      rows.getBoundingClientRect().bottom + 1
    );
  };

  // `autoExpand: false` is for the collapse button itself — re-expanding right
  // after the user asked for fewer rows would just fight them.
  const renderBar = ({ autoExpand = true } = {}) => {
    renderTabBar(tabBar, tabList(), activeTabId(), {
      pendingIds: new Set(pendingWrites.keys()),
      expanded: barExpanded,
    });
    updateActions();
    if (autoExpand && !barExpanded && activeChipIsClipped()) {
      barExpanded = true;
      renderTabBar(tabBar, tabList(), activeTabId(), {
        pendingIds: new Set(pendingWrites.keys()),
        expanded: true,
      });
    }
    // Every path that changes the set of open tabs goes through here, so
    // syncing the "open in a tab" badges from one place keeps them honest.
    markOpenSaveItems(savesList, openSaveIds());
  };

  const tabHasText = tab =>
    Boolean(tab && (tab.content.trim() || tab.description.trim()));

  // Nothing to sweep when the workspace is already just one blank tab.
  const workspaceIsBlank = () => {
    const tabs = rawList();
    return tabs.length === 1 && !tabHasText(tabs[0]);
  };

  const updateActions = () => {
    const tabs = rawList();
    // "Done" files the current tab away; pointless when the only tab is blank.
    doneBtn.disabled = tabs.length <= 1 && !tabHasText(active());
    closeAllBtn.disabled = workspaceIsBlank();
  };

  const unstarredSaves = () => savesCache.filter(s => !s.starred);

  // Menu-only state. Kept out of updateActions because that runs on every
  // keystroke and this walks the whole library; the menu is opened deliberately.
  const updateMenuActions = () => {
    const notes = unstarredSaves().length;
    deleteUnstarredBtn.disabled = notes === 0;
    deleteUnstarredBtn.textContent = notes
      ? `Delete unstarred (${notes})`
      : 'Delete unstarred';
    deleteAllBtn.disabled = savesCache.length === 0;

    const tabs = rawList().filter(t => !t.starred).length;
    closeUnstarredBtn.disabled = tabs === 0 || workspaceIsBlank();
    closeUnstarredBtn.textContent = tabs
      ? `Close unstarred (${tabs})`
      : 'Close unstarred';
  };

  const updateDocStats = () => {
    const text = textArea.value;
    const chars = text.length;
    if (!chars) {
      docStats.textContent = '';
      return;
    }
    const n = v => v.toLocaleString('en-US');
    // Splitting allocates proportionally to the text, and this is a pastebin.
    if (chars > WORD_COUNT_LIMIT) {
      docStats.textContent = `${n(chars)} chars`;
      return;
    }
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    docStats.textContent = `${n(words)} words · ${n(chars)} chars`;
  };

  const resize = () => {
    const scrollPos = window.scrollY;
    textArea.style.height = 'auto';
    textArea.style.height = textArea.scrollHeight + 'px';
    window.scrollTo(window.scrollX, scrollPos);
  };

  // Show either the textarea or the rendered reading panel, per the active
  // tab's own mode. The panel is read-only; content only ever changes in Edit.
  // Always renders. There used to be a "skip if the source is unchanged" cache
  // here, but it marked a source as rendered before the render actually ran, so
  // one failure left the panel blank and every later open of that note was
  // skipped as already-current. Callers avoid the redundant work instead, by
  // only re-rendering when the content really changed.
  const renderReadingPanel = source => {
    let html = '';
    try {
      html = renderMarkdown(source);
    } catch {
      markdownView.innerHTML =
        '<p class="markdown-empty">This note could not be rendered as Markdown. Switch to Edit to read it as plain text.</p>';
      return;
    }

    if (html.trim()) {
      markdownView.innerHTML = html;
      return;
    }

    if (source.trim() === '') {
      markdownView.innerHTML =
        '<p class="markdown-empty">Nothing to read yet — switch to Edit and start typing.</p>';
      return;
    }

    // The note plainly has text, yet Markdown produced nothing from it: a note
    // made only of link reference definitions ("[a]: /url") is all metadata and
    // renders to an empty document. Claiming there is nothing here would be a
    // flat lie, so show the text itself.
    markdownView.innerHTML =
      '<p class="markdown-empty">Markdown renders nothing from this note — it is all reference syntax. Showing it as plain text:</p>' +
      `<pre><code>${escapeHtml(source)}</code></pre>`;
  };

  const applyViewMode = () => {
    const tab = active();
    const mode = viewOf(tab);
    const reading = mode === 'markdown';

    textArea.hidden = reading;
    markdownView.hidden = !reading;

    if (reading) {
      renderReadingPanel(tab ? tab.content : '');
    } else {
      // scrollHeight reads 0 while the textarea is hidden, so its height has to
      // be re-measured on the way back rather than trusted from before.
      resize();
    }

    editorModes.querySelectorAll('button').forEach(btn => {
      const on = btn.dataset.view === mode;
      btn.classList.toggle('active-setting', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  };

  // Load the active tab's buffer into the editor fields.
  const loadActiveIntoEditor = () => {
    const t = active();
    descInput.value = t ? t.description : '';
    textArea.value = t ? t.content : '';
    applyViewMode();
    updateDocStats();
    updateActions();
  };

  // preventScroll because the browser would otherwise jump the tall textarea
  // into view abruptly — scrollToNoteStart owns that movement instead.
  const focusEditor = () => {
    if (!textArea.hidden) textArea.focus({ preventScroll: true });
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Switching to a note while scrolled down through the library would leave its
  // first lines above the fold. Bring the top of the page back into view.
  const scrollToNoteStart = () => {
    if (window.scrollY === 0) return; // already there; don't fight the user
    window.scrollTo({
      top: 0,
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
    });
  };

  // Fold the live editor values back into the active tab.
  const syncEditorToActive = () => updateActive(textArea.value, descInput.value);

  // ---- Autosave engine ----

  // Fold a tab into its note record. Idempotent, and safe if the tab vanished
  // while the timer was armed.
  async function writeTab(tabId) {
    cancelAutosave(tabId);
    const tab = rawList().find(t => t.id === tabId);
    if (!tab) return; // closed while the timer was armed
    if (tab.content.trim() === '') {
      // An empty tab never creates a record — and never destroys the one it
      // already has, so select-all-delete-then-retype can't lose the note.
      settleStatus();
      refreshChip(tab);
      return;
    }
    if (Date.now() < autosaveErrorUntil) {
      // Re-arm rather than drop the edit: otherwise the indicator would claim
      // it is retrying while in fact nothing ever retried.
      retryAfterBackoff(tabId);
      return;
    }

    // Claim the id synchronously, before any await: a concurrent call must see
    // a non-null saveId or it would mint a second record for the same tab.
    const isNew = tab.saveId == null;
    if (isNew) tab.saveId = newSaveId();
    const id = tab.saveId;

    const existing = savesCache.find(s => s.id === id);
    const now = new Date().toISOString();
    const record = {
      id,
      date: existing ? existing.date : now, // created-at is immutable
      updatedAt: now,
      description: tab.description,
      content: tab.content, // verbatim — never trim live text
      starred: tab.starred === true,
    };

    try {
      await addSave(record);
    } catch {
      if (isNew) tab.saveId = null; // roll the claim back
      autosaveErrorUntil = Date.now() + AUTOSAVE_ERROR_BACKOFF;
      setAutosaveState('error');
      retryAfterBackoff(tabId); // or "retrying" would be a lie
      return;
    }

    if (existing) Object.assign(existing, record);
    else savesCache.push(record);

    lastSavedAt = Date.now();
    setAutosaveState('saved');
    syncRecordIntoList(record);
    persistWorkspace();
    refreshChip(tab);
  }

  // Every IndexedDB write goes through this one chain, so writes can never
  // interleave and a later one can't land before an earlier one.
  const queueWrite = task => {
    writeChain = writeChain.then(task).catch(() => {});
    return writeChain;
  };

  const enqueue = tabId => queueWrite(() => writeTab(tabId));

  // Wait out the remaining backoff, then try this tab again.
  function retryAfterBackoff(tabId) {
    const entry = pendingWrites.get(tabId) || {};
    clearTimeout(entry.timer);
    const wait = Math.max(250, autosaveErrorUntil - Date.now() + 50);
    entry.timer = setTimeout(() => enqueue(tabId), wait);
    pendingWrites.set(tabId, entry);
  }

  function scheduleAutosave(tabId) {
    if (!tabId) return;
    const entry = pendingWrites.get(tabId) || {};
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => enqueue(tabId), AUTOSAVE_DEBOUNCE);
    // Without a ceiling, a long uninterrupted typing run would never be written.
    if (!entry.maxTimer) {
      entry.maxTimer = setTimeout(() => enqueue(tabId), AUTOSAVE_MAX_WAIT);
    }
    pendingWrites.set(tabId, entry);
    setAutosaveState('saving');
  }

  function cancelAutosave(tabId) {
    const entry = pendingWrites.get(tabId);
    if (!entry) return;
    clearTimeout(entry.timer);
    clearTimeout(entry.maxTimer);
    pendingWrites.delete(tabId);
  }

  // Flush means "fire an armed timer early" — never "write unconditionally".
  // That distinction is what stops Delete-all from instantly repopulating the
  // library out of the still-open tabs.
  const flushTab = tabId => {
    if (!pendingWrites.has(tabId)) return Promise.resolve();
    // Disarm synchronously so the timer can't fire a duplicate write behind
    // the one we are about to queue.
    cancelAutosave(tabId);
    return enqueue(tabId);
  };
  const flushAll = () =>
    Promise.all([...pendingWrites.keys()].map(id => flushTab(id)));

  // A record that just changed may newly match — or stop matching — the search.
  function syncRecordIntoList(record, { reposition = false } = {}) {
    const inList = Boolean(savesList.querySelector(`#save-item-${record.id}`));
    const matches =
      filterSaves([record], searchInput.value, { starredOnly }).length > 0;

    if (matches && inList) {
      updateSaveItem(savesList, record);
      // Only on demand: cards must not shuffle underneath the reader while an
      // autosave lands, but starring genuinely changes where the card belongs.
      if (reposition) {
        placeSaveItem(
          savesList,
          record,
          visibleSaves().map(s => s.id)
        );
      }
    } else if (matches && !inList) {
      placeSaveItem(
        savesList,
        record,
        visibleSaves().map(s => s.id)
      );
    } else if (!matches && inList) {
      if (pendingDeletions[record.id]) return; // don't yank a live countdown
      removeSaveItem(savesList, record.id);
      ensureEmptyState(savesList, emptyOpts());
    }
    markOpenSaveItems(savesList, openSaveIds());
  }

  // Called on every keystroke.
  const onEdit = () => {
    const before = active() ? active().content : null;
    syncEditorToActive();
    const tab = active();
    scheduleAutosave(activeTabId());
    refreshChip(tab);
    updateDocStats();
    updateActions();
    // The textarea is hidden in reading mode, but Clear and its Undo still
    // change the content from underneath it. Only when it actually moved,
    // though: the description stays editable in reading mode and its keystrokes
    // reach here too, and they must not re-parse the whole note.
    if (!markdownView.hidden && (!tab || tab.content !== before)) {
      applyViewMode();
    }
    persistWorkspace();
  };

  // ---- Starring ----
  // One applier for both surfaces: the chip and the saved card.
  async function applyStar(tabId, saveId, value) {
    if (tabId) setStarred(tabId, value);

    const record = saveId != null ? savesCache.find(s => s.id === saveId) : null;
    if (record) {
      record.starred = value;
      // Must share the autosave chain. A queued tab write mutates this same
      // cached object, so an unsynchronised put here could land after it and
      // write the pre-edit text back over the newer one.
      await queueWrite(async () => {
        const fresh = savesCache.find(s => s.id === saveId);
        if (!fresh) return;
        try {
          await addSave(fresh);
        } catch {
          setAutosaveState('error');
        }
      });
    }

    renderBar(); // starring reorders the bar
    persistWorkspace();

    // Goes through the same path as an autosave so the search filter is
    // honoured: starring from a chip must not inject a card that the current
    // query excludes, and un-starring under "Starred only" must remove it.
    if (record) syncRecordIntoList(record, { reposition: true });
  }

  const copyText = async text => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // Fall back below for browsers that block the async Clipboard API.
    }

    const focusedEl = document.activeElement;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const copied = document.execCommand('copy');
    textarea.remove();
    if (focusedEl && typeof focusedEl.focus === 'function') {
      focusedEl.focus({ preventScroll: true });
    }
    if (!copied) throw new Error('Copy command failed.');
  };

  // Open a saved note in a tab, in the requested view. Re-uses the tab that
  // already holds it rather than opening a second copy.
  const openSave = (save, view) => {
    syncEditorToActive();

    const existing = findBySaveId(save.id) || findByContent(save.content);
    let tab;
    if (existing) {
      // Matched by content rather than by link: adopt the record so editing
      // updates it instead of spawning a near-duplicate alongside it. Only ever
      // fill an empty link — never steal one from another record.
      if (existing.saveId == null) {
        existing.saveId = save.id;
        if (save.starred) existing.starred = true;
      }
      setActive(existing.id);
      tab = existing;
    } else {
      tab = addTab({
        description: save.description || '',
        content: save.content,
        saveId: save.id,
        starred: save.starred === true,
      });
    }

    setView(tab.id, view);
    renderBar();
    loadActiveIntoEditor();
    persistWorkspace();
    focusEditor();
    // Opened from the library, so the reader is far down the page.
    scrollToNoteStart();
  };

  // Drop a record and unlink whatever tab pointed at it.
  const forgetRecord = async id => {
    await deleteSave(id);
    savesCache = savesCache.filter(s => s.id !== id);
    removeSaveItem(savesList, id);
    ensureEmptyState(savesList, emptyOpts());

    const tab = findBySaveId(id);
    if (tab) {
      // Cancel first: an armed timer would put the record straight back.
      cancelAutosave(tab.id);
      tab.saveId = null;
      // Never yank the tab the caret is sitting in — it just goes unlinked and
      // the next keystroke starts a fresh record.
      if (tab.id !== activeTabId()) closeTab(tab.id);
      renderBar();
      persistWorkspace();
    }
  };

  // ---- Settings ----
  loadSettings();
  viewControls.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const type = SETTING_TYPES.find(name => btn.dataset[name] !== undefined);
    if (!type) return;
    applySetting(type, btn.dataset[type]);
    // Width, font family and font size all change how the text wraps, so the
    // textarea's measured height is now stale. Without this it keeps the old
    // one and, because it is overflow:hidden, silently clips the note's tail.
    if (!textArea.hidden) resize();
    // The same reflow can push the active chip into a clipped row of the bar.
    renderBar();
  });

  // ---- Workspace restore ----
  loadWorkspace();
  renderBar();
  loadActiveIntoEditor();
  // Focus without letting the tall textarea scroll itself into view on load
  // (the old `autofocus` attribute made the page jump down past the banner).
  textArea.focus({ preventScroll: true });

  setInterval(() => {
    syncEditorToActive();
    persistWorkspace();
  }, WORKSPACE_PERSIST_INTERVAL);

  setInterval(renderStatus, STATUS_TICK_INTERVAL);

  textArea.addEventListener('input', () => {
    resize();
    onEdit();
  });
  descInput.addEventListener('input', onEdit);
  textArea.addEventListener('blur', () => flushTab(activeTabId()));
  descInput.addEventListener('blur', () => flushTab(activeTabId()));

  // ---- View mode (per note) ----
  const switchView = view => {
    const tab = active();
    if (!tab || viewOf(tab) === view) return;
    // Capture whatever is in the textarea before it goes away, or switching to
    // the reading panel would render the previous keystroke's text.
    syncEditorToActive();
    setView(tab.id, view);
    applyViewMode();
    persistWorkspace();
    if (view === 'edit') focusEditor();
  };

  editorModes.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (btn) switchView(btn.dataset.view);
  });

  // A write can't be awaited during unload; the 200ms localStorage flush plus
  // startup reconciliation is what actually closes that gap.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    syncEditorToActive();
    persistWorkspace();
    flushAll();
  });
  window.addEventListener('pagehide', () => {
    syncEditorToActive();
    persistWorkspace();
    flushAll();
  });

  // ---- Tab bar ----
  const doClose = async id => {
    await flushTab(id);
    cancelAutosave(id);
    const wasActive = id === activeTabId();
    closeTab(id);
    renderBar();
    if (wasActive) {
      loadActiveIntoEditor();
      scrollToNoteStart(); // a different note is in the editor now
    }
    persistWorkspace();
  };

  tabBar.addEventListener('click', e => {
    // Always capture the latest editor state into the active tab first.
    syncEditorToActive();

    if (e.target.closest('.tab-add')) {
      addTab();
      renderBar();
      loadActiveIntoEditor();
      persistWorkspace();
      focusEditor();
      scrollToNoteStart();
      return;
    }

    if (e.target.closest('.tab-bar-toggle')) {
      barExpanded = !barExpanded;
      renderBar({ autoExpand: false });
      return;
    }

    const closeBtn = e.target.closest('.tab-close');
    if (closeBtn) {
      // Nothing is unsaved any more, so closing needs no confirmation.
      doClose(closeBtn.dataset.tabId);
      return;
    }

    // Must precede the chip fallback, or starring would also switch tabs.
    const starBtn = e.target.closest('.tab-star');
    if (starBtn) {
      const tab = rawList().find(t => t.id === starBtn.dataset.tabId);
      if (tab) applyStar(tab.id, tab.saveId, !tab.starred);
      return;
    }

    const chip = e.target.closest('.tab');
    if (chip) {
      const id = chip.dataset.tabId;
      if (id === activeTabId()) return;
      flushTab(activeTabId());
      setActive(id);
      renderBar();
      loadActiveIntoEditor();
      persistWorkspace();
      focusEditor();
      scrollToNoteStart();
    }
  });

  // Middle-click closes a tab. The mousedown guard suppresses Windows autoscroll.
  tabBar.addEventListener('mousedown', e => {
    if (e.button === 1 && e.target.closest('.tab')) e.preventDefault();
  });
  tabBar.addEventListener('auxclick', e => {
    if (e.button !== 1) return;
    const chip = e.target.closest('.tab');
    if (!chip) return;
    e.preventDefault();
    syncEditorToActive();
    doClose(chip.dataset.tabId);
  });

  // ---- Done (file the active tab away) ----
  doneBtn.addEventListener('click', async () => {
    syncEditorToActive();
    await doClose(activeTabId());
    focusEditor();
  });

  // ---- Bulk close ----
  // Closing a tab loses nothing: its note is already in the library, and the
  // star lives on the record too, so a closed starred note reopens starred.
  const closeTabsExcept = async keep => {
    syncEditorToActive();
    await flushAll();

    for (const tab of rawList().slice()) {
      if (keep(tab)) continue;
      cancelAutosave(tab.id);
      closeTab(tab.id);
    }

    barExpanded = false;
    renderBar();
    loadActiveIntoEditor();
    persistWorkspace();
    focusEditor();
    scrollToNoteStart();
  };

  // Means all of them. A button labelled "Close all tabs" that quietly spared
  // some was just a lie, and it went disabled afterwards so a second click did
  // nothing at all.
  closeAllBtn.addEventListener('click', () => closeTabsExcept(() => false));

  closeUnstarredBtn.addEventListener('click', () => {
    closeMenu();
    closeTabsExcept(tab => tab.starred);
  });

  // ---- Clear (with undo), operates on the active tab ----
  clearBtn.addEventListener('click', () => {
    if (pendingClearState) {
      clearTimeout(pendingClearState.timeoutId);
      clearInterval(pendingClearState.intervalId);
      textArea.value = pendingClearState.originalText;
      descInput.value = pendingClearState.originalDesc;
      resize();
      clearBtn.textContent = 'Clear';
      clearBtn.classList.remove('pending-clear');
      pendingClearState = null;
      onEdit();
      focusEditor();
      return;
    }
    const originalText = textArea.value;
    const originalDesc = descInput.value;
    if (originalText === '' && originalDesc === '') return;
    const clearedTabId = activeTabId();
    textArea.value = '';
    descInput.value = '';
    resize();
    onEdit();

    let countdown = UNDO_SECONDS;
    clearBtn.classList.add('pending-clear');
    clearBtn.textContent = `Undo (${countdown}s)`;
    const intervalId = setInterval(() => {
      countdown--;
      clearBtn.textContent = `Undo (${countdown}s)`;
      if (countdown <= 0) clearInterval(intervalId);
    }, 1000);
    const timeoutId = setTimeout(async () => {
      clearBtn.textContent = 'Clear';
      clearBtn.classList.remove('pending-clear');
      pendingClearState = null;

      // Clear is the deliberate "throw this away" gesture, and it already has
      // an undo window — so letting it run out is what deletes the record.
      const tab = rawList().find(t => t.id === clearedTabId);
      if (tab && tab.content.trim() === '' && tab.saveId != null) {
        await forgetRecord(tab.saveId);
      }
    }, UNDO_SECONDS * 1000);
    pendingClearState = { timeoutId, intervalId, originalText, originalDesc };
  });

  // ---- Search ----
  searchInput.addEventListener('input', renderFiltered);

  starFilterBtn.addEventListener('click', () => {
    starredOnly = !starredOnly;
    starFilterBtn.setAttribute('aria-pressed', String(starredOnly));
    starFilterBtn.classList.toggle('is-active', starredOnly);
    renderFiltered();
  });

  // ---- Menu ----
  const closeMenu = () => {
    menuList.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  };

  menuBtn.addEventListener('click', () => {
    updateActions();
    updateMenuActions();
    const open = menuList.hidden;
    menuList.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', e => {
    if (!menu.contains(e.target)) closeMenu();
  });

  deleteUnstarredBtn.addEventListener('click', async () => {
    closeMenu();
    const doomed = unstarredSaves();
    if (!doomed.length) {
      alert('Every saved note is starred.');
      return;
    }

    const kept = savesCache.length - doomed.length;
    const plural = n => (n === 1 ? '' : 's');
    const confirmed = confirm(
      `Delete ${doomed.length} unstarred note${plural(doomed.length)}?\n\n` +
        (kept
          ? `${kept} starred note${plural(kept)} will be kept.\n\n`
          : 'Nothing is starred, so this empties the library.\n\n') +
        'This cannot be undone.'
    );
    if (!confirmed) return;

    const ids = new Set(doomed.map(s => s.id));
    // Tabs holding a doomed note, captured before the links are cut.
    const orphaned = rawList().filter(t => t.saveId != null && ids.has(t.saveId));

    // Disarm and unlink synchronously: an armed timer, or a keystroke landing
    // during the await below, would write the record straight back.
    for (const tab of orphaned) {
      cancelAutosave(tab.id);
      tab.saveId = null;
    }
    // Drop any per-card undo countdown for a note that is about to go anyway.
    for (const id of ids) {
      const pending = pendingDeletions[id];
      if (!pending) continue;
      clearTimeout(pending.timeoutId);
      clearInterval(pending.intervalId);
      delete pendingDeletions[id];
    }

    // Through the autosave chain, so a write already in flight completes first
    // and cannot land after the delete and resurrect its record.
    let failed = false;
    await queueWrite(async () => {
      try {
        await deleteSaves([...ids]);
      } catch {
        failed = true;
      }
    });

    if (failed) {
      // queueWrite swallows rejections, so without this the UI would claim the
      // notes were deleted while they sat on disk and reappeared on reload.
      // The cut tab links are not restored here, but startup reconciliation
      // re-matches an unlinked tab to its record by content.
      savesCache = await getAllSaves();
      renderFiltered();
      renderBar();
      persistWorkspace();
      alert('Could not delete the notes — storage refused the change.');
      return;
    }

    savesCache = savesCache.filter(s => !ids.has(s.id));

    // Close the tabs whose note just went. Leaving one open would re-create its
    // text as a brand-new record on the next keystroke — the opposite of what
    // was asked. The active tab is spared, as everywhere else: it stays open,
    // unlinked, so the caret is never yanked out from under the user.
    const activeId = activeTabId();
    for (const tab of orphaned) {
      if (tab.id !== activeId) closeTab(tab.id);
    }

    renderFiltered();
    renderBar();
    persistWorkspace();
    focusEditor();
  });

  deleteAllBtn.addEventListener('click', async () => {
    closeMenu();
    if (!savesCache.length) {
      alert('No saved notes.');
      return;
    }
    if (prompt('Type "delete" to remove all saved notes:') !== 'delete') return;

    await clearAllSaves();
    savesCache = [];
    // Disarm everything and unlink, or the open tabs would write themselves
    // straight back into the library.
    for (const tab of rawList()) {
      cancelAutosave(tab.id);
      tab.saveId = null;
    }
    persistWorkspace();
    renderFiltered();
    renderBar();
    focusEditor();
  });

  exportBtn.addEventListener('click', async () => {
    closeMenu();
    await flushAll();
    exportSaves();
  });

  importBtn.addEventListener('click', () => {
    closeMenu();
    fileInput.click();
  });

  fileInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { imported, skipped } = await importSaves(file);
      savesCache = await getAllSaves();
      renderFiltered();
      alert(
        `Import finished.\n\nNew notes added: ${imported}\nDuplicates skipped: ${skipped}`
      );
    } catch (err) {
      alert(err.message || 'Import failed.');
    }
  });

  // ---- Saves list (Star / Open / Copy / Delete) ----
  savesList.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === 'star') {
      const save = savesCache.find(s => s.id === id);
      if (!save) return;
      const tab = findBySaveId(id);
      await applyStar(tab ? tab.id : null, id, !save.starred);
      return;
    }

    if (action === 'open-draft' || action === 'open-markdown') {
      const save = savesCache.find(s => s.id === id);
      if (!save) return;
      openSave(save, action === 'open-markdown' ? 'markdown' : 'edit');
      return;
    }

    if (action === 'copy-text') {
      const save = savesCache.find(s => s.id === id);
      if (!save) return;

      try {
        await copyText(save.content);
        btn.textContent = 'Copied';
        setTimeout(() => {
          if (btn.isConnected) btn.textContent = 'Copy';
        }, 1200);
      } catch {
        alert('Could not copy note text.');
      }
      return;
    }

    if (action === 'del') {
      if (pendingDeletions[id]) {
        clearTimeout(pendingDeletions[id].timeoutId);
        clearInterval(pendingDeletions[id].intervalId);
        delete pendingDeletions[id];
        btn.textContent = 'Delete';
        btn.classList.remove('pending-delete');
        return;
      }
      let countdown = UNDO_SECONDS;
      btn.classList.add('pending-delete');
      btn.textContent = `Undo (${countdown}s)`;
      const intervalId = setInterval(() => {
        countdown--;
        btn.textContent = `Undo (${countdown}s)`;
        if (countdown <= 0) clearInterval(intervalId);
      }, 1000);
      const timeoutId = setTimeout(async () => {
        delete pendingDeletions[id];
        await forgetRecord(id);
      }, UNDO_SECONDS * 1000);
      pendingDeletions[id] = { timeoutId, intervalId };
    }
  });

  // ---- Initial load of saved notes ----
  // Link every open tab to a record: re-use a matching one where possible,
  // adopt the rest, and re-write anything an unload raced past.
  const adoptAndReconcile = () => {
    let adopted = 0;

    for (const tab of rawList()) {
      if (tab.content.trim() === '') continue;

      if (tab.saveId == null) {
        // Records written before autosave went through a .trim() on save, so
        // compare trimmed or an old manual save would be adopted twice.
        const taken = openSaveIds();
        const match = savesCache.find(
          s => !taken.has(s.id) && s.content.trim() === tab.content.trim()
        );
        if (match) {
          tab.saveId = match.id;
          if (match.starred) tab.starred = true;
          continue;
        }
        adopted++;
        scheduleAutosave(tab.id);
        continue;
      }

      const record = savesCache.find(s => s.id === tab.saveId);
      if (!record) {
        tab.saveId = null; // deleted in another window
        scheduleAutosave(tab.id);
        continue;
      }
      if (
        record.content !== tab.content ||
        record.description !== tab.description
      ) {
        scheduleAutosave(tab.id); // an unload beat the debounce
      }
      if (record.starred) tab.starred = true;
    }

    persistWorkspace();
    renderBar();
    markOpenSaveItems(savesList, openSaveIds());

    // On the first run after upgrading, every open tab silently shows up in the
    // library. That's intended, but unannounced it reads as a bug.
    if (adopted > 0) {
      flashStatus(
        `${adopted} open tab${adopted > 1 ? 's' : ''} added to your notes`
      );
    }
  };

  getAllSaves().then(saves => {
    savesCache = saves;
    renderFiltered();
    adoptAndReconcile();
  });
});
