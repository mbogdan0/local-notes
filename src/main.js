import './styles/index.css';

import { UNDO_SECONDS, AUTOSAVE_INTERVAL } from './constants.js';
import { getAllSaves, deleteSave, clearAllSaves, addSave } from './db.js';
import { makeSave, isDuplicate } from './saves.js';
import {
  renderSaves,
  prependSaveItem,
  renderTabBar,
  refreshActiveChip,
} from './render.js';
import { filterSaves } from './search.js';
import { loadSettings, applySetting } from './settings.js';
import { exportSaves, importSaves } from './exportImport.js';
import {
  loadWorkspace,
  persist,
  list as tabList,
  active,
  activeTabId,
  setActive,
  updateActive,
  add as addTab,
  close as closeTab,
  markSaved,
  resetToSingle,
  isDirty,
  findByContent,
} from './tabs.js';

document.addEventListener('DOMContentLoaded', () => {
  const descInput = document.getElementById('descInput');
  const textArea = document.getElementById('mainText');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const saveCloseAllBtn = document.getElementById('saveCloseAllBtn');
  const searchInput = document.getElementById('searchInput');
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
  let closePopoverEl = null;

  // ---- Editor <-> active tab sync ----
  const renderBar = () => renderTabBar(tabBar, tabList(), activeTabId());

  const updateSaveDisabled = () => {
    const t = active();
    saveBtn.disabled = !t || t.content.trim() === '' || !isDirty(t);
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
    updateSaveDisabled();
  };

  // Fold the live editor values back into the active tab.
  const syncEditorToActive = () => updateActive(textArea.value, descInput.value);

  // Called on every keystroke: keep the active tab + its chip in sync.
  const onEdit = () => {
    syncEditorToActive();
    refreshActiveChip(tabBar, active());
    updateSaveDisabled();
    persist();
  };

  const renderFiltered = () => {
    renderSaves(savesList, filterSaves(savesCache, searchInput.value), {
      hasQuery: searchInput.value.trim() !== '',
    });
  };

  const matchesSearch = save =>
    filterSaves([save], searchInput.value).length > 0;

  // Save a tab's content as a new record. Returns 'ok' | 'empty' | 'duplicate'.
  const saveTab = async tab => {
    if (!tab) return 'empty';
    const content = tab.content.trim();
    if (!content) return 'empty';
    if (isDuplicate(savesCache, content)) return 'duplicate';
    const save = makeSave(content, tab.description.trim());
    await addSave(save);
    savesCache.push(save);
    if (matchesSearch(save)) prependSaveItem(savesList, save);
    markSaved(tab.id);
    return 'ok';
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

  // ---- Autosave workspace ----
  setInterval(() => {
    syncEditorToActive();
    persist();
  }, AUTOSAVE_INTERVAL);

  textArea.addEventListener('input', () => {
    resize();
    onEdit();
  });
  descInput.addEventListener('input', onEdit);

  // ---- Tab bar (switch / new / close) ----
  const doClose = id => {
    const wasActive = id === activeTabId();
    closeTab(id);
    renderBar();
    if (wasActive) loadActiveIntoEditor();
    persist();
  };

  const dismissClosePopover = () => {
    if (closePopoverEl) {
      closePopoverEl.remove();
      closePopoverEl = null;
    }
  };

  // Inline "unsaved changes" confirmation anchored under a dirty tab.
  const showClosePopover = (tab, chipEl) => {
    dismissClosePopover();
    const pop = document.createElement('div');
    pop.className = 'tab-popover';
    pop.innerHTML = `
      <div class="tab-popover-msg">Unsaved changes</div>
      <div class="tab-popover-actions">
        <button data-pop="save" type="button">Save &amp; close</button>
        <button data-pop="discard" type="button">Discard</button>
        <button data-pop="cancel" type="button">Cancel</button>
      </div>`;
    document.body.appendChild(pop);

    const r = chipEl.getBoundingClientRect();
    pop.style.top = `${window.scrollY + r.bottom + 4}px`;
    let left = window.scrollX + r.left;
    const maxLeft =
      window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    pop.style.left = `${left}px`;

    pop.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      const action = b.dataset.pop;
      if (action === 'cancel') {
        dismissClosePopover();
        return;
      }
      if (action === 'save') await saveTab(tab);
      dismissClosePopover();
      doClose(tab.id);
    });
    closePopoverEl = pop;
  };

  tabBar.addEventListener('click', e => {
    // Always capture the latest editor state into the active tab first.
    syncEditorToActive();

    const addBtn = e.target.closest('.tab-add');
    if (addBtn) {
      addTab();
      renderBar();
      loadActiveIntoEditor();
      persist();
      textArea.focus();
      return;
    }

    const closeBtn = e.target.closest('.tab-close');
    if (closeBtn) {
      const id = closeBtn.dataset.tabId;
      const tab = tabList().find(t => t.id === id);
      if (!tab) return;
      if (isDirty(tab)) {
        showClosePopover(tab, closeBtn.closest('.tab'));
      } else {
        doClose(id);
      }
      return;
    }

    const chip = e.target.closest('.tab');
    if (chip) {
      const id = chip.dataset.tabId;
      if (id === activeTabId()) return;
      setActive(id);
      renderBar();
      loadActiveIntoEditor();
      persist();
      textArea.focus();
    }
  });

  // ---- Save (active tab) ----
  saveBtn.addEventListener('click', async () => {
    syncEditorToActive();
    const tab = active();
    const res = await saveTab(tab);
    if (res === 'duplicate') {
      alert('A note with the same content already exists.');
      return;
    }
    if (res === 'empty') return;
    renderBar();
    updateSaveDisabled();
    persist();
    textArea.focus();
  });

  // ---- Save & close all ----
  saveCloseAllBtn.addEventListener('click', async () => {
    closeMenu();
    syncEditorToActive();
    for (const tab of tabList().slice()) {
      if (isDirty(tab)) await saveTab(tab);
    }
    resetToSingle();
    renderBar();
    loadActiveIntoEditor();
    renderFiltered();
    persist();
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
    if (originalText === '') return;
    const originalDesc = descInput.value;
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
    const timeoutId = setTimeout(() => {
      clearBtn.textContent = 'Clear';
      clearBtn.classList.remove('pending-clear');
      pendingClearState = null;
    }, UNDO_SECONDS * 1000);
    pendingClearState = { timeoutId, intervalId, originalText, originalDesc };
  });

  // ---- Search ----
  searchInput.addEventListener('input', renderFiltered);

  // ---- Menus (More + per-card Open) ----
  const closeMenu = () => {
    menuList.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  };
  const closeCardMenus = except => {
    document.querySelectorAll('.openMenu').forEach(m => {
      if (m === except) return;
      const lst = m.querySelector('.menu-list');
      if (lst) lst.hidden = true;
      const caret = m.querySelector('.splitBtn-caret');
      if (caret) caret.setAttribute('aria-expanded', 'false');
    });
  };

  menuBtn.addEventListener('click', () => {
    const open = menuList.hidden;
    menuList.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', e => {
    if (!menu.contains(e.target)) closeMenu();
    const card = e.target.closest('.openMenu');
    closeCardMenus(card);
    if (
      closePopoverEl &&
      !closePopoverEl.contains(e.target) &&
      !e.target.closest('.tab-close')
    ) {
      dismissClosePopover();
    }
  });

  deleteAllBtn.addEventListener('click', async () => {
    closeMenu();
    if (!savesCache.length) {
      alert('No saved notes.');
      return;
    }
    if (prompt('Type "delete" to remove all saved notes:') === 'delete') {
      await clearAllSaves();
      savesCache = [];
      renderFiltered();
      textArea.focus();
    }
  });

  exportBtn.addEventListener('click', () => {
    closeMenu();
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

  // ---- Saves list (Open in new/current tab, menu, Delete) ----
  savesList.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === 'open-menu') {
      const m = btn.closest('.openMenu');
      const lst = m.querySelector('.menu-list');
      const willOpen = lst.hidden;
      closeCardMenus(m);
      lst.hidden = !willOpen;
      btn.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    if (action === 'open-new' || action === 'open-current') {
      const save = savesCache.find(s => s.id === id);
      if (!save) return;
      closeCardMenus(null);
      syncEditorToActive();

      if (action === 'open-new') {
        const existing = findByContent(save.content);
        if (existing) setActive(existing.id);
        else addTab({ description: save.description || '', content: save.content });
      } else {
        const act = active();
        if (isDirty(act)) {
          if (!confirm('Unsaved changes in this tab will be lost. Continue?')) return;
        }
        act.content = save.content;
        act.description = save.description || '';
        act.baseContent = save.content;
        act.baseDescription = save.description || '';
      }

      renderBar();
      loadActiveIntoEditor();
      persist();
      textArea.focus();
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
        await deleteSave(id);
        savesCache = savesCache.filter(s => s.id !== id);
        const item = document.getElementById(`save-item-${id}`);
        if (item) item.remove();
        delete pendingDeletions[id];
      }, UNDO_SECONDS * 1000);
      pendingDeletions[id] = { timeoutId, intervalId };
    }
  });

  // ---- Initial load of saved notes ----
  getAllSaves().then(saves => {
    savesCache = saves;
    renderFiltered();
  });
});
