// Design document storage: IndexedDB access for the design editor's documents. Unlike mind maps
// (one IndexedDB row per map, see ui/js/db.js + ui/js/maps.js) this used to store a single design
// document; it now stores any number of named designs so they can be created/renamed/deleted from
// both the design editor (design.html) and the mind map's library sidebar (index.html).
// Loaded by both pages, before anything that needs it (model.js, design-embed.js, library-sidebar.js).

const DESIGN_DB_NAME = 'secondmap-design';
const DESIGN_DB_VERSION = 2;

function designUid() { return 'd' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }

function openDesignDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DESIGN_DB_NAME, DESIGN_DB_VERSION);
    r.onupgradeneeded = e => {
      const d = r.result;
      if (!d.objectStoreNames.contains('designs')) d.createObjectStore('designs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      // v1 only had a single 'kv' store with one entry (key 'doc'); migrated to a named design below.
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function designStore(db, name, mode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

async function getAllDesignDocs() {
  const db = await openDesignDB();
  return new Promise(resolve => {
    const req = designStore(db, 'designs').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function getDesignDoc(id) {
  const db = await openDesignDB();
  return new Promise(resolve => {
    const req = designStore(db, 'designs').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function saveDesignDoc(doc) {
  doc.updated = Date.now();
  const db = await openDesignDB();
  return new Promise(resolve => { designStore(db, 'designs', 'readwrite').put(doc).onsuccess = resolve; });
}

async function deleteDesignDoc(id) {
  const db = await openDesignDB();
  return new Promise(resolve => { designStore(db, 'designs', 'readwrite').delete(id).onsuccess = resolve; });
}

async function getCurrentDesignId() {
  const db = await openDesignDB();
  return new Promise(resolve => {
    const req = designStore(db, 'meta').get('currentDesignId');
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => resolve(null);
  });
}

async function setCurrentDesignId(id) {
  const db = await openDesignDB();
  return new Promise(resolve => { designStore(db, 'meta', 'readwrite').put({ key: 'currentDesignId', value: id }).onsuccess = resolve; });
}

// A fresh, empty design document (not yet persisted).
function newDesignDoc(name) {
  const pid = designUid();
  const now = Date.now();
  return {
    id: designUid(), name: name || 'Unbenannt', created: now, updated: now,
    version: 1,
    pages: [{ id: pid, name: 'Page 1', bg: '#2c2c2c', children: [] }],
    assets: [], views: { [pid]: { x: 200, y: 120, zoom: 1 } }, counters: {}, pageId: pid,
  };
}

async function createDesignDoc(name) {
  const doc = newDesignDoc(name);
  await saveDesignDoc(doc);
  return doc;
}

// One-off migration of the old single-document (v1 'kv' store, key 'doc') into a named design,
// plus a fallback "Design 1" when the library is empty. Safe to call every time the library is read.
async function ensureDesignLibrary() {
  let docs = await getAllDesignDocs();
  if (docs.length) return docs;
  let migrated = null;
  try {
    const db = await openDesignDB();
    if (db.objectStoreNames.contains('kv')) {
      migrated = await new Promise(resolve => {
        const req = designStore(db, 'kv').get('doc');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    }
  } catch (_) { /* no old store, nothing to migrate */ }
  const doc = migrated && Array.isArray(migrated.pages) && migrated.pages.length
    ? { ...newDesignDoc('Design 1'), ...migrated, id: designUid(), name: 'Design 1' }
    : newDesignDoc('Design 1');
  await saveDesignDoc(doc);
  return [doc];
}

async function renameDesignDoc(id, name) {
  const doc = await getDesignDoc(id);
  if (!doc) return;
  doc.name = name || doc.name;
  await saveDesignDoc(doc);
}

// All embeddable layers (top-level frames = "screens", and components anywhere) of one design doc.
function listEmbeddableLayers(doc) {
  const out = [];
  for (const p of doc.pages) {
    const walk = (list, top) => {
      for (const n of list) {
        if ((top && n.type === 'frame') || n.isComponent) out.push({ id: n.id, name: n.name, page: p.name, component: !!n.isComponent });
        if (n.children) walk(n.children, false);
      }
    };
    walk(p.children, true);
  }
  return out;
}
