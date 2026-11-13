// Design editor – document model, tree helpers, undo history and persistence.

const $ = id => document.getElementById(id);

const D = {
  doc: null,              // { version, pages, assets, views, counters }
  pageId: null,
  sel: [],                // selected node ids
  entered: new Set(),     // containers whose children are directly selectable on the canvas
  collapsed: new Set(),   // layer ids collapsed in the layers panel
  tool: 'move',
  hover: null,
  editing: null,          // id of the text node being edited
  dropTarget: null,       // frame highlighted while dragging
  marquee: null,
  hist: [],
  histIdx: -1,
  clipboard: null,
};

// id -> { node, parent (node | null), list (array holding the node), pageId }
let byId = new Map();

const FRAME_PRESETS = [
  ['iPhone 15 (393 × 852)', 393, 852],
  ['iPhone SE (375 × 667)', 375, 667],
  ['Android (360 × 800)', 360, 800],
  ['iPad (820 × 1180)', 820, 1180],
  ['Desktop (1440 × 1024)', 1440, 1024],
  ['Laptop (1280 × 800)', 1280, 800],
  ['Slide 16:9 (1920 × 1080)', 1920, 1080],
];

const ICON_PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  heart: 'M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z',
  star: 'M12 3l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.5 6.1 20.8l1.3-6.5L2.5 9.8 9.1 9z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  plus: 'M12 4v16M4 12h16',
  check: 'M4 12l5 5L20 6',
  close: 'M5 5l14 14M19 5L5 19',
  arrow: 'M4 12h16M14 6l6 6-6 6',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 11a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
};

const BUILTIN_ASSETS = Object.entries(ICON_PATHS).map(([name, d]) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#333333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  return { id: 'icon-' + name, name, kind: 'icon', w: 24, h: 24, dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) };
});

function uid() { return 'd' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }

function getAsset(id) {
  return D.doc.assets.find(a => a.id === id) || BUILTIN_ASSETS.find(a => a.id === id) || null;
}

function defaultDoc() {
  const pid = uid();
  return {
    version: 1,
    pages: [{ id: pid, name: 'Page 1', bg: '#2c2c2c', children: [] }],
    assets: [],
    views: { [pid]: { x: 200, y: 120, zoom: 1 } },
    counters: {},
    pageId: pid,
  };
}

// ─── tree helpers ────────────────────────────────────────────────
function curPage() { return D.doc.pages.find(p => p.id === D.pageId) || D.doc.pages[0]; }
function view() {
  const v = D.doc.views[D.pageId];
  return v || (D.doc.views[D.pageId] = { x: 200, y: 120, zoom: 1 });
}
function nodeOf(id) { const e = byId.get(id); return e ? e.node : null; }
function parentOf(id) { const e = byId.get(id); return e ? e.parent : null; }

function eachNode(list, fn) {
  for (const n of list) {
    fn(n);
    if (n.children) eachNode(n.children, fn);
  }
}

function eachNodeAllPages(fn) { for (const p of D.doc.pages) eachNode(p.children, fn); }

function chainOf(id) {
  const out = [];
  for (let n = nodeOf(id); n; n = parentOf(n.id)) out.unshift(n);
  return out;
}

function isInside(id, ancestorId) {
  for (let n = nodeOf(id); n; n = parentOf(n.id)) if (n.id === ancestorId) return true;
  return false;
}

function absPos(id) {
  let x = 0, y = 0;
  for (let n = nodeOf(id); n; n = parentOf(n.id)) { x += n.x; y += n.y; }
  return { x, y };
}

function absRect(id) {
  const n = nodeOf(id), p = absPos(id);
  return { x: p.x, y: p.y, w: n.w, h: n.h };
}

function siblingsOf(id) {
  const e = byId.get(id);
  return e ? e.list : null;
}

function listFor(parent) { return parent ? parent.children : curPage().children; }

function nextName(type) {
  const label = { frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', image: 'Image', group: 'Group', instance: 'Instance' }[type] || 'Layer';
  const c = D.doc.counters;
  c[type] = (c[type] || 0) + 1;
  return `${label} ${c[type]}`;
}

function newNode(type, props = {}) {
  const base = {
    id: uid(), type, name: nextName(type),
    x: 0, y: 0, w: 100, h: 100,
    opacity: 1, visible: true, locked: false,
    radius: 0, fill: '#d9d9d9', stroke: null, strokeWidth: 1, shadow: null, link: null,
  };
  if (type === 'frame') Object.assign(base, { fill: '#ffffff', clip: true, children: [] });
  if (type === 'group') Object.assign(base, { fill: null, children: [] });
  if (type === 'text') Object.assign(base, { fill: '#111111', text: 'Text', fontSize: 16, fontWeight: 400, font: 'sans', align: 'left', autoH: true, w: 120, h: 20 });
  if (type === 'image') Object.assign(base, { fill: null, fit: 'cover', assetId: null });
  if (type === 'instance') Object.assign(base, { fill: null, componentId: null, overrides: null });
  return Object.assign(base, props);
}

// Deep copy with fresh ids. `overrides` (instance overrides) are baked in; `keepComponent` keeps master flags.
function cloneNode(n, opts = {}) {
  const c = JSON.parse(JSON.stringify(n));
  const ov = opts.overrides || null;
  (function fix(x) {
    if (ov && ov[x.id]) Object.assign(x, ov[x.id]);
    x.id = uid();
    if (!opts.keepComponent) delete x.isComponent;
    if (x.children) x.children.forEach(fix);
  })(c);
  return c;
}

function scaleDescendants(n, sx, sy) {
  if (!n.children) return;
  for (const c of n.children) {
    c.x *= sx; c.y *= sy; c.w *= sx; c.h *= sy;
    scaleDescendants(c, sx, sy);
  }
}

// Groups always hug their children; empty groups disappear.
function normalizeGroups(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (!n.children) continue;
    normalizeGroups(n.children);
    if (n.type !== 'group') continue;
    if (!n.children.length) { list.splice(i, 1); continue; }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const c of n.children) {
      x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y);
      x2 = Math.max(x2, c.x + c.w); y2 = Math.max(y2, c.y + c.h);
    }
    if (x1 || y1 || n.w !== x2 - x1 || n.h !== y2 - y1) {
      n.x += x1; n.y += y1;
      for (const c of n.children) { c.x -= x1; c.y -= y1; }
      n.w = x2 - x1; n.h = y2 - y1;
    }
  }
}

function reindex() {
  for (const p of D.doc.pages) normalizeGroups(p.children);
  byId = new Map();
  const walk = (list, parent, pageId) => {
    for (const n of list) {
      byId.set(n.id, { node: n, parent, list, pageId });
      if (n.children) walk(n.children, n, pageId);
    }
  };
  for (const p of D.doc.pages) walk(p.children, null, p.id);
  D.sel = D.sel.filter(id => byId.has(id) && byId.get(id).pageId === D.pageId);
  if (D.editing && !byId.has(D.editing)) D.editing = null;
}

// ─── history ─────────────────────────────────────────────────────
function snapshot() { return JSON.stringify(D.doc.pages); }

function commit() {
  reindex();
  const s = snapshot();
  if (s !== D.hist[D.histIdx]) {
    D.hist.length = D.histIdx + 1;
    D.hist.push(s);
    if (D.hist.length > 150) D.hist.shift();
    D.histIdx = D.hist.length - 1;
  }
  schedulePersist();
}

function restoreHistory(idx) {
  D.histIdx = idx;
  D.doc.pages = JSON.parse(D.hist[idx]);
  if (!D.doc.pages.some(p => p.id === D.pageId)) D.pageId = D.doc.pages[0].id;
  reindex();
  schedulePersist();
}

function undo() { if (D.histIdx > 0) { restoreHistory(D.histIdx - 1); return true; } return false; }
function redo() { if (D.histIdx < D.hist.length - 1) { restoreHistory(D.histIdx + 1); return true; } return false; }

// ─── persistence (IndexedDB) ─────────────────────────────────────
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('secondmap-design', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function loadDoc() {
  try {
    const db = await openDb();
    return await new Promise(resolve => {
      const req = db.transaction('kv').objectStore('kv').get('doc');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) { console.error('Design load failed', e); return null; }
}

let persistTimer = null;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(saveDocNow, 400);
}

async function saveDocNow() {
  clearTimeout(persistTimer);
  try {
    D.doc.pageId = D.pageId;
    const db = await openDb();
    db.transaction('kv', 'readwrite').objectStore('kv').put(JSON.parse(JSON.stringify(D.doc)), 'doc');
  } catch (e) { console.error('Design save failed', e); }
}

window.addEventListener('pagehide', saveDocNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveDocNow(); });

function setDoc(doc) {
  D.doc = doc;
  D.doc.assets = D.doc.assets || [];
  D.doc.views = D.doc.views || {};
  D.doc.counters = D.doc.counters || {};
  D.pageId = doc.pages.some(p => p.id === doc.pageId) ? doc.pageId : doc.pages[0].id;
  D.sel = [];
  D.entered.clear();
  reindex();
  D.hist = [snapshot()];
  D.histIdx = 0;
}
