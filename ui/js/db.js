// IndexedDB access: open the database, save/load/delete records.

// ─── DB ─────────────────────────────────────────────────────────
let db;
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('mindgraph', 6);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('nodes')) d.createObjectStore('nodes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('edges')) d.createObjectStore('edges', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta'))  d.createObjectStore('meta',  { keyPath: 'key' });
      if (!d.objectStoreNames.contains('maps'))  d.createObjectStore('maps',  { keyPath: 'id' });
      if (!d.objectStoreNames.contains('groups')) d.createObjectStore('groups', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });

      const tx = e.target.transaction;
      const nodesStore = tx.objectStore('nodes');
      const edgesStore = tx.objectStore('edges');
      const groupsStore = tx.objectStore('groups');
      if (!nodesStore.indexNames.contains('mapId')) nodesStore.createIndex('mapId', 'mapId', { unique: false });
      if (!edgesStore.indexNames.contains('mapId')) edgesStore.createIndex('mapId', 'mapId', { unique: false });
      if (!groupsStore.indexNames.contains('mapId')) groupsStore.createIndex('mapId', 'mapId', { unique: false });
    };
    req.onsuccess = e => { db = e.target.result; res(); };
    req.onerror = () => rej(req.error);
  });
}

function dbStore(storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

async function saveNode(node) {
  node.mapId = currentMapId;
  return new Promise(res => { dbStore('nodes', 'readwrite').put(node).onsuccess = res; });
}
async function deleteNode(id) {
  return new Promise(res => { dbStore('nodes', 'readwrite').delete(id).onsuccess = res; });
}
async function saveEdge(edge) {
  edge.mapId = currentMapId;
  return new Promise(res => { dbStore('edges', 'readwrite').put(edge).onsuccess = res; });
}
async function deleteEdge(id) {
  return new Promise(res => { dbStore('edges', 'readwrite').delete(id).onsuccess = res; });
}
async function saveGroupToDB(group) {
  group.mapId = currentMapId;
  return new Promise(res => { dbStore('groups', 'readwrite').put(group).onsuccess = res; });
}
async function deleteGroupFromDB(id) {
  return new Promise(res => { dbStore('groups', 'readwrite').delete(id).onsuccess = res; });
}

async function loadAll() {
  const byMapId = (storeName) => new Promise((res) => {
    const store = dbStore(storeName);
    try {
      if (store.indexNames.contains('mapId')) {
        const req = store.index('mapId').getAll(currentMapId);
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      } else {
        const req = store.getAll();
        req.onsuccess = () => res((req.result || []).filter(x => x.mapId === currentMapId));
        req.onerror = () => res([]);
      }
    } catch (_) {
      const req = store.getAll();
      req.onsuccess = () => res((req.result || []).filter(x => x.mapId === currentMapId));
      req.onerror = () => res([]);
    }
  });

  const [allNodes, allEdges, allGroups] = await Promise.all([
    byMapId('nodes'),
    byMapId('edges'),
    byMapId('groups'),
  ]);
  return {
    nodes: allNodes,
    edges: allEdges,
    groups: allGroups,
  };
}

async function saveMeta(transform) {
  return new Promise(res => { dbStore('meta', 'readwrite').put({ key: 'transform_' + currentMapId, value: transform }).onsuccess = res; });
}
async function loadMeta() {
  return new Promise(res => { const req = dbStore('meta').get('transform_' + currentMapId); req.onsuccess = () => res(req.result?.value || null); });
}
