import { getAllSaves, addSave } from './db.js';
import { newSaveId, savedAt } from './saves.js';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function exportFilename() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `local-notes-export-${pad(d.getDate())}${MONTHS[d.getMonth()]}${d.getFullYear()}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

// Downloads all saves as a JSON file: { version, exportedAt, notes: [...] }.
export async function exportSaves() {
  const saves = await getAllSaves();
  if (!saves.length) {
    alert('Nothing to export.');
    return;
  }
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: saves.map(s => ({
      id: s.id,
      date: s.date,
      updatedAt: savedAt(s),
      description: s.description || '',
      content: s.content,
      starred: s.starred === true,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = exportFilename();
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function isValidNote(n) {
  return n && typeof n.content === 'string' && n.content.length > 0;
}

// Reads a JSON export file, skips duplicates/invalid entries, returns counts.
export async function importSaves(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid file: not valid JSON.');
  }
  const notes = Array.isArray(parsed) ? parsed : parsed && parsed.notes;
  if (!Array.isArray(notes)) {
    throw new Error('Invalid file: no notes found.');
  }

  const existing = await getAllSaves();
  const existingContent = new Set(existing.map(s => s.content));
  const seen = new Set(existing.map(s => s.id));

  let imported = 0;
  let skipped = 0;

  for (const n of notes) {
    if (!isValidNote(n) || existingContent.has(n.content)) {
      skipped++;
      continue;
    }
    // Ensure a unique id and a valid date. A colliding id is reassigned, so an
    // open tab keeps pointing at its own record rather than the imported one.
    let id = Number(n.id);
    if (!Number.isFinite(id) || seen.has(id)) id = newSaveId();
    const toIso = v =>
      v && !isNaN(new Date(v)) ? new Date(v).toISOString() : null;
    const date = toIso(n.date) || new Date().toISOString();

    const save = {
      id,
      date,
      updatedAt: toIso(n.updatedAt) || date,
      description: typeof n.description === 'string' ? n.description : '',
      content: n.content,
      starred: n.starred === true,
    };
    await addSave(save);
    existingContent.add(save.content);
    seen.add(id);
    imported++;
  }

  return { imported, skipped };
}
