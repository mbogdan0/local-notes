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
import { getAllSaves, deleteSave, clearAllSaves, addSave } from './db.js';
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
import { loadSettings, applySetting } from './settings.js';
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
  const closeAllBtn = document.getElementById('closeAllBtn');
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

  const updateActions = () => {
    const tabs = rawList();
    // "Done" files the current tab away; pointless when the only tab is blank.
    doneBtn.disabled = tabs.length <= 1 && !tabHasText(active());
    const closable = tabs.filter(t => !t.starred);
    closeAllBtn.disabled =
      closable.length === 0 || (tabs.length === 1 && !tabHasText(tabs[0]));
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

  // Load the active tab's buffer into the editor fields.
  const loadActiveIntoEditor = () => {
    const t = active();
    descInput.value = t ? t.description : '';
    textArea.value = t ? t.content : '';
    resize();
    updateDocStats();
    updateActions();
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
      refreshChip(tab);
      return;
    }
    if (Date.now() < autosaveErrorUntil) return;

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

  const enqueue = tabId => {
    writeChain = writeChain.then(() => writeTab(tabId)).catch(() => {});
    return writeChain;
  };

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
  const flushTab = tabId =>
    pendingWrites.has(tabId) ? enqueue(tabId) : Promise.resolve();
  const flushAll = () =>
    Promise.all([...pendingWrites.keys()].map(id => flushTab(id)));

  // A record that just changed may newly match — or stop matching — the search.
  function syncRecordIntoList(record) {
    const inList = Boolean(savesList.querySelector(`#save-item-${record.id}`));
    const matches =
      filterSaves([record], searchInput.value, { starredOnly }).length > 0;

    if (matches && inList) {
      // Deliberately not repositioned: cards must not shuffle while typing.
      updateSaveItem(savesList, record);
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
    syncEditorToActive();
    scheduleAutosave(activeTabId());
    refreshChip(active());
    updateDocStats();
    updateActions();
    persistWorkspace();
  };

  // ---- Starring ----
  // One applier for both surfaces: the chip and the saved card.
  async function applyStar(tabId, saveId, value) {
    if (tabId) setStarred(tabId, value);

    const record = saveId != null ? savesCache.find(s => s.id === saveId) : null;
    if (record) {
      record.starred = value;
      try {
        await addSave(record);
      } catch {
        setAutosaveState('error');
      }
    }

    renderBar(); // starring reorders the bar
    persistWorkspace();

    if (!record) return;
    if (starredOnly) {
      renderFiltered(); // un-starring under the filter removes the card
    } else {
      updateSaveItem(savesList, record);
      placeSaveItem(
        savesList,
        record,
        visibleSaves().map(s => s.id)
      );
      markOpenSaveItems(savesList, openSaveIds());
    }
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
    if (btn.dataset.width) applySetting('width', btn.dataset.width);
    else if (btn.dataset.font) applySetting('font', btn.dataset.font);
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
    if (wasActive) loadActiveIntoEditor();
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
      textArea.focus();
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
      textArea.focus();
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
    textArea.focus();
  });

  // ---- Close all tabs (starred ones stay) ----
  closeAllBtn.addEventListener('click', async () => {
    closeMenu();
    syncEditorToActive();
    await flushAll();

    for (const tab of rawList().slice()) {
      if (tab.starred) continue;
      cancelAutosave(tab.id);
      closeTab(tab.id);
    }

    barExpanded = false;
    renderBar();
    loadActiveIntoEditor();
    persistWorkspace();
    textArea.focus();
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
      textArea.focus();
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
    const open = menuList.hidden;
    menuList.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', e => {
    if (!menu.contains(e.target)) closeMenu();
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
    textArea.focus();
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

    if (action === 'open-draft') {
      const save = savesCache.find(s => s.id === id);
      if (!save) return;
      syncEditorToActive();

      const existing = findBySaveId(save.id) || findByContent(save.content);
      if (existing) setActive(existing.id);
      else
        addTab({
          description: save.description || '',
          content: save.content,
          saveId: save.id,
          starred: save.starred === true,
        });

      renderBar();
      loadActiveIntoEditor();
      persistWorkspace();
      textArea.focus();
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
