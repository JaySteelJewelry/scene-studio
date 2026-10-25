// Tiny IndexedDB wrapper. Everything lives only in this browser.
const DB_NAME = 'scene-studio';
const VERSION = 1;
const STORES = ['stories', 'images', 'clips', 'finals'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB aborted'));
  }));
}

const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  put: (store, value) => tx(store, 'readwrite', s => wrap(s.put(value))),
  get: (store, id) => tx(store, 'readonly', s => wrap(s.get(id))),
  all: (store) => tx(store, 'readonly', s => wrap(s.getAll())),
  del: (store, id) => tx(store, 'readwrite', s => wrap(s.delete(id))),
};

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch (e) {}
  return null;
}
