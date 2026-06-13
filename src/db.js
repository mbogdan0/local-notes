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
    req.onsuccess = () => resolve(req.result);
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

export function clearAllSaves() {
  return tx('readwrite', store => {
    store.clear();
    return { value: undefined };
  });
}
