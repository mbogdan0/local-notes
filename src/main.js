import './styles/index.css';

import { UNDO_SECONDS, AUTOSAVE_INTERVAL } from './constants.js';
import { getAllSaves, deleteSave, clearAllSaves } from './db.js';
import { loadDraft, saveDraft, clearDraft } from './draft.js';
import { makeSave, isDuplicate } from './saves.js';
import { renderSaves, prependSaveItem } from './render.js';
import { filterSaves } from './search.js';
import { loadSettings, applySetting } from './settings.js';
import { addSave } from './db.js';
import { exportSaves, importSaves } from './exportImport.js';

document.addEventListener('DOMContentLoaded', () => {
  const descInput = document.getElementById('descInput');
  const textArea = document.getElementById('mainText');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const searchInput = document.getElementById('searchInput');
  const savesList = document.getElementById('savesList');
  const viewControls = document.getElementById('viewControls');

  const menu = document.getElementById('menu');
  const menuBtn = document.getElementById('menuBtn');
  const menuList = document.getElementById('menuList');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const deleteAllBtn = document.getElementById('deleteAllBtn');
  const fileInput = document.getElementById('fileInput');

  let lastLoaded = '';
  let savesCache = [];
  const pendingDeletions = {};
  let pendingClearState = null;

  const updateSaveDisabled = () => {
    saveBtn.disabled = textArea.value.trim() === '';
  };

  const resize = () => {
    const scrollPos = window.scrollY;
    textArea.style.height = 'auto';
    textArea.style.height = textArea.scrollHeight + 'px';
    window.scrollTo(window.scrollX, scrollPos);
  };

  const renderFiltered = () => {
    renderSaves(savesList, filterSaves(savesCache, searchInput.value));
  };

  const matchesSearch = save =>
    filterSaves([save], searchInput.value).length > 0;

  // ---- Settings ----
  loadSettings();
  viewControls.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.width) applySetting('width', btn.dataset.width);
    else if (btn.dataset.font) applySetting('font', btn.dataset.font);
  });

  // ---- Draft restore ----
  const draft = loadDraft();
  if (draft) {
    textArea.value = draft.text;
    descInput.value = draft.description;
    lastLoaded = draft.text;
    resize();
  }
  updateSaveDisabled();

  // ---- Autosave draft ----
  const autosave = () => {
    if (pendingClearState && textArea.value === '') return;
    saveDraft(textArea.value, descInput.value);
  };
  setInterval(autosave, AUTOSAVE_INTERVAL);

  textArea.addEventListener('input', () => {
    resize();
    updateSaveDisabled();
  });

  // ---- Save ----
  saveBtn.addEventListener('click', async () => {
    const content = textArea.value.trim();
    if (!content) return;
    if (isDuplicate(savesCache, content)) {
      alert('A note with the same content already exists.');
      return;
    }
    const save = makeSave(content, descInput.value.trim());
    await addSave(save);
    savesCache.push(save);
    if (matchesSearch(save)) prependSaveItem(savesList, save);

    textArea.value = '';
    descInput.value = '';
    resize();
    saveBtn.disabled = true;
    lastLoaded = '';
    clearDraft();
    textArea.focus();
  });

  // ---- Clear (with undo) ----
  clearBtn.addEventListener('click', () => {
    if (pendingClearState) {
      clearTimeout(pendingClearState.timeoutId);
      clearInterval(pendingClearState.intervalId);
      textArea.value = pendingClearState.originalText;
      descInput.value = pendingClearState.originalDesc;
      autosave();
      resize();
      clearBtn.textContent = 'Clear';
      clearBtn.classList.remove('pending-clear');
      updateSaveDisabled();
      pendingClearState = null;
      textArea.focus();
      return;
    }
    const originalText = textArea.value;
    if (originalText === '') return;
    const originalDesc = descInput.value;
    textArea.value = '';
    descInput.value = '';
    lastLoaded = '';
    resize();
    saveBtn.disabled = true;
    autosave();

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

  // ---- Menu (Export / Import / Delete all) ----
  const closeMenu = () => {
    menuList.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  };
  menuBtn.addEventListener('click', () => {
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

  // ---- Saves list (Switch / Delete) ----
  savesList.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === 'load') {
      const save = savesCache.find(s => s.id === id);
      if (!save) return;
      if (textArea.value && textArea.value !== lastLoaded) {
        if (!confirm('Unsaved text will be lost. Continue?')) return;
      }
      textArea.value = save.content;
      descInput.value = save.description || '';
      lastLoaded = save.content;
      resize();
      autosave();
      updateSaveDisabled();
      const original = btn.textContent;
      btn.textContent = 'Loaded ✓';
      setTimeout(() => {
        btn.textContent = original;
      }, 1000);
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
