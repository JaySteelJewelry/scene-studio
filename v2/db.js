// Storage. Projects, start images, clips and movies live in the SAME IndexedDB the first
// version uses ("scene-studio", version 1, unchanged), so everything made there shows up here
// and the original app keeps working. v2-only things (cast, music) live in "scene-studio-v2".
function opener(name, version, stores) {
  let p = null;
  return () => {
    if (p) return p;
    p = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = () => { const d = req.result; for (const s of stores) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Storage is busy in another tab. Close other Scene Studio tabs and reload.'));
    });
    return p;
  };
}
const SHARED = { name: 'scene-studio', version: 1, stores: ['stories', 'images', 'clips', 'finals'] };
const OWN = { name: 'scene-studio-v2', version: 1, stores: ['cast', 'media', 'meta'] };
const openShared = opener(SHARED.name, SHARED.version, SHARED.stores);
const openOwn = opener(OWN.name, OWN.version, OWN.stores);
const which = (store) => (OWN.stores.includes(store) ? openOwn : openShared);

function tx(store, mode, fn) {
  return which(store)().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage write was refused (the device may be out of space).'));
  }));
}
export const db = {
  get: (store, id) => tx(store, 'readonly', s => s.get(id)),
  all: (store) => tx(store, 'readonly', s => s.getAll()),
  put: (store, val) => tx(store, 'readwrite', s => s.put(val)),
  del: (store, id) => tx(store, 'readwrite', s => s.delete(id)),
};
export async function storageEstimate() {
  try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (e) {}
  return null;
}
export async function persistStorage() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return false;
}
