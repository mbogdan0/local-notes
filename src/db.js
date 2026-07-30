import { DB_NAME, DB_VERSION, STORE_SAVES } from './constants.js';

// Thin promise-based wrapper around IndexedDB. Records are stored as plain
// text ({ id, date, description, content }) so the content is searchable.

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SAVES)) {
        db.createObjectStore(STORE_SAVES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Without this, a future version bump would hang forever whenever the app
      // is open in a second browser tab: the old connection blocks the upgrade
      // and `openDb()`'s promise never settles.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, run) {
  return openDb().then(
    db =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_SAVES, mode);
        const store = transaction.objectStore(STORE_SAVES);
        const result = run(store);
        transaction.oncomplete = () => resolve(result.value);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

// Returns all saves sorted oldest → newest (callers prepend, so newest ends up on top).
export function getAllSaves() {
  return tx('readonly', store => {
    const out = { value: [] };
    const req = store.getAll();
    req.onsuccess = () => {
      out.value = req.result
        .slice()
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    };
    return out;
  });
}

export function addSave(save) {
  return tx('readwrite', store => {
    store.put(save);
    return { value: save };
  });
}

export function deleteSave(id) {
  return tx('readwrite', store => {
    store.delete(id);
    return { value: id };
  });
}

// Bulk delete in a single transaction — one per record would be both slow and
// non-atomic, leaving a half-deleted library behind if one of them failed.
export function deleteSaves(ids) {
  return tx('readwrite', store => {
    ids.forEach(id => store.delete(id));
    return { value: ids.length };
  });
}

export function clearAllSaves() {
  return tx('readwrite', store => {
    store.clear();
    return { value: undefined };
  });
}
