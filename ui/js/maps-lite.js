// Standalone, read/write access to the mind map IndexedDB ('mindgraph') for pages that don't load
// the full ui/js/db.js + ui/js/maps.js (i.e. design.html). Used by the library sidebar's "Mind maps"
// tab so mindmaps can be listed/created/renamed/deleted from the design editor too. Keep the schema
// (store names, keyPaths, indexes) in sync with ui/js/db.js.

function openMindDBLite() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mindgraph', 6);
    req.onupgradeneeded = e => {
      const d = req.result;
      if (!d.objectStoreNames.contains('nodes')) d.createObjectStore('nodes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('edges')) d.createObjectStore('edges', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('maps')) d.createObjectStore('maps', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('groups')) d.createObjectStore('groups', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });
      const tx = e.target.transaction;
      const nodesStore = tx.objectStore('nodes'), edgesStore = tx.objectStore('edges'), groupsStore = tx.objectStore('groups');
      if (!nodesStore.indexNames.contains('mapId')) nodesStore.createIndex('mapId', 'mapId', { unique: false });
      if (!edgesStore.indexNames.contains('mapId')) edgesStore.createIndex('mapId', 'mapId', { unique: false });
      if (!groupsStore.indexNames.contains('mapId')) groupsStore.createIndex('mapId', 'mapId', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function listMapsLite() {
  const db = await openMindDBLite();
  const maps = await new Promise(res => { const r = db.transaction('maps').objectStore('maps').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
  const nodes = await new Promise(res => { const r = db.transaction('nodes').objectStore('nodes').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
  const counts = new Map();
  for (const n of nodes) counts.set(n.mapId, (counts.get(n.mapId) || 0) + 1);
  return maps.map(m => ({ ...m, nodeCount: counts.get(m.id) || 0 }));
}

async function createMapLite(name) {
  const db = await openMindDBLite();
  const map = { id: designUid(), name: name || 'Unbenannt', created: Date.now(), updated: Date.now() };
  await new Promise(res => { db.transaction('maps', 'readwrite').objectStore('maps').put(map).onsuccess = res; });
  return map;
}

async function renameMapLite(id, name) {
  const db = await openMindDBLite();
  const store = db.transaction('maps', 'readwrite').objectStore('maps');
  const map = await new Promise(res => { const r = store.get(id); r.onsuccess = () => res(r.result); });
  if (!map) return;
  map.name = name || map.name;
  map.updated = Date.now();
  await new Promise(res => { store.put(map).onsuccess = res; });
}

async function deleteMapLite(id) {
  const db = await openMindDBLite();
  const byMap = (storeName) => new Promise(res => {
    const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
    const req = store.index('mapId').getAllKeys(id);
    req.onsuccess = () => { for (const k of req.result) store.delete(k); res(); };
    req.onerror = () => res();
  });
  await Promise.all([byMap('nodes'), byMap('edges'), byMap('groups')]);
  await new Promise(res => { db.transaction('maps', 'readwrite').objectStore('maps').delete(id).onsuccess = res; });
}
