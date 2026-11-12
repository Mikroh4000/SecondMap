// ─── CONSTANTS ──────────────────────────────────────────────────
const NODE_COLORS = [
  '#c8f064', '#64b4f0', '#f06464', '#f0c864', '#a064f0',
  '#64f0c8', '#f064c8', '#8a8780', '#e8e6e0'
];

const NODE_TEMPLATES = {
  idea:     { label: 'Idee',       icon: '💡', color: '#f0c864' },
  task:     { label: 'Aufgabe',    icon: '☑️',  color: '#64b4f0' },
  question: { label: 'Frage',      icon: '❓', color: '#f06464' },
  procon:   { label: 'Pro/Contra', icon: '⚖️',  color: '#64f0c8' },
  note:     { label: 'Notiz',      icon: '📝', color: '#8a8780' },
  formula:  { label: 'Formel',     icon: '🧮', color: '#a064f0' },
  hardware: { label: 'Hardware',   icon: '🔧', color: '#f09050' },
  concept:  { label: 'Konzept',    icon: '🧠', color: '#50b0d0' },
  config:   { label: 'Config',     icon: '⚙️',  color: '#b0b060' },
  code:     { label: 'Code',       icon: '💻', color: '#60c080' }
};

const PRIORITIES = {
  high:   { label: 'Hoch',    color: '#f06464' },
  medium: { label: 'Mittel',  color: '#f0c864' },
  low:    { label: 'Niedrig', color: '#64f0c8' }
};

// ─── STATE ──────────────────────────────────────────────────────
let state = {
  nodes: [],
  edges: [],
  groups: [],
  transform: { x: 0, y: 0, scale: 1 },
  mode: 'normal',
  connectSource: null,
  selectedNodes: new Set(),
  dragging: null,
  dragOffset: { x: 0, y: 0 },
  dragStartPositions: null,
  panning: false,
  panStart: { x: 0, y: 0 },
  panOrigin: { x: 0, y: 0 },
  selectionRect: null,
  resizing: null,
  clipboard: null,
  highlightedEdges: null,
};

let currentMapId = null;
const mapNavStack = [];

const $ = id => document.getElementById(id);
const edgesGroup = $('edges-group');
const nodesLayer = $('nodes-layer');
const tempEdge = $('temp-edge');
const canvasWrap = $('canvas-wrap');
const minimap = $('minimap');
const mmCtx = minimap.getContext('2d');
const modeIndicator = $('mode-indicator');
minimap.width = 140; minimap.height = 90;

// ─── PERFORMANCE HELPERS ─────────────────────────────────────────
// Cached id -> element lookup (avoids a selector scan per call).
const nodeEls = new Map();
function getNodeEl(id) {
  let el = nodeEls.get(id);
  if (el && el.isConnected) return el;
  el = nodesLayer.querySelector(`[data-id="${id}"]`);
  if (el) nodeEls.set(id, el); else nodeEls.delete(id);
  return el;
}

// Node sizes are tracked by a ResizeObserver so edges/groups/minimap never have to force a layout.
const nodeSizes = new Map();
const nodeResizeObserver = new ResizeObserver(entries => {
  let changed = false;
  for (const entry of entries) {
    const w = entry.borderBoxSize?.[0]?.inlineSize ?? entry.target.offsetWidth;
    const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight;
    if (!w || !h) continue;
    const prev = nodeSizes.get(entry.target.dataset.id);
    if (!prev || prev.w !== w || prev.h !== h) {
      nodeSizes.set(entry.target.dataset.id, { w, h });
      changed = true;
    }
  }
  if (changed) { renderEdges(); renderGroups(); }
});

function getNodeSize(n) {
  let sz = nodeSizes.get(n.id);
  if (sz) return sz;
  const el = getNodeEl(n.id);
  if (el && el.offsetWidth) {
    sz = { w: el.offsetWidth, h: el.offsetHeight };
    nodeSizes.set(n.id, sz);
    return sz;
  }
  return { w: n.width || 220, h: 80 };
}

function buildNodeMap() {
  const m = new Map();
  for (const n of state.nodes) m.set(n.id, n);
  return m;
}

// One O(n) pass instead of walking the parent chain with Array.find for every query.
function computeHiddenSet(nodeMap) {
  const hidden = new Set();
  for (const n of nodeMap.values()) {
    let cur = n, guard = nodeMap.size;
    while (cur.parentId && guard-- > 0) {
      const parent = nodeMap.get(cur.parentId);
      if (!parent) break;
      if (parent.collapsed) { hidden.add(n.id); break; }
      cur = parent;
    }
  }
  return hidden;
}

// Coalesces high-frequency input (mousemove) into one update per animation frame.
const frame = { queued: false, transform: false, drag: null, overlays: false };
function scheduleFrame() {
  if (frame.queued) return;
  frame.queued = true;
  requestAnimationFrame(flushFrame);
}
function flushFrame() {
  if (!frame.queued) return;
  frame.queued = false;
  if (frame.drag) {
    const { x, y } = frame.drag; frame.drag = null;
    moveDraggedNodes(x, y);
  }
  if (frame.transform) { frame.transform = false; applyTransform(); }
  if (frame.overlays) { frame.overlays = false; renderEdges(); renderGroups(); }
}
function scheduleOverlays() { frame.overlays = true; scheduleFrame(); }

function tauriInvoke(cmd, args = {}) {
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke !== 'function') return null;
    return invoke(cmd, args);
  } catch (_) {
    return null;
  }
}

// ─── UNDO / REDO ────────────────────────────────────────────────
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

function pushUndo(action) {
  undoStack.push(action);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const u = $('btn-undo'), r = $('btn-redo');
  if (u) u.classList.toggle('disabled', undoStack.length === 0);
  if (r) r.classList.toggle('disabled', redoStack.length === 0);
}

async function undo() {
  if (undoStack.length === 0) return;
  const action = undoStack.pop();
  redoStack.push(action);
  await applyUndoRedo(action, true);
  updateUndoRedoButtons();
  showToast('Rückgängig');
}

async function redo() {
  if (redoStack.length === 0) return;
  const action = redoStack.pop();
  undoStack.push(action);
  await applyUndoRedo(action, false);
  updateUndoRedoButtons();
  showToast('Wiederherstellt');
}

async function applyUndoRedo(action, isUndo) {
  switch (action.type) {
    case 'add-nodes': {
      if (isUndo) {
        for (const e of action.edges) { state.edges = state.edges.filter(x => x.id !== e.id); await deleteEdge(e.id); }
        for (const n of action.nodes) { state.nodes = state.nodes.filter(x => x.id !== n.id); removeNodeEl(n.id); await deleteNode(n.id); }
      } else {
        for (const n of action.nodes) { const c = {...n}; state.nodes.push(c); await saveNode(c); renderNode(c); }
        for (const e of action.edges) { const c = {...e}; state.edges.push(c); await saveEdge(c); }
      }
      break;
    }
    case 'delete-nodes': {
      if (isUndo) {
        for (const n of action.nodes) { const c = {...n}; state.nodes.push(c); await saveNode(c); renderNode(c); }
        for (const e of action.edges) { const c = {...e}; state.edges.push(c); await saveEdge(c); }
        if (action.orphanedChildren) {
          for (const oc of action.orphanedChildren) {
            const child = state.nodes.find(x => x.id === oc.id);
            if (child) { child.parentId = oc.oldParentId; await saveNode(child); renderNode(child); }
          }
        }
      } else {
        if (action.orphanedChildren) {
          for (const oc of action.orphanedChildren) {
            const child = state.nodes.find(x => x.id === oc.id);
            if (child) { child.parentId = null; await saveNode(child); renderNode(child); }
          }
        }
        for (const e of action.edges) { state.edges = state.edges.filter(x => x.id !== e.id); await deleteEdge(e.id); }
        for (const n of action.nodes) { state.nodes = state.nodes.filter(x => x.id !== n.id); removeNodeEl(n.id); await deleteNode(n.id); }
      }
      break;
    }
    case 'move-nodes': {
      for (const m of action.moves) {
        const n = state.nodes.find(x => x.id === m.id);
        if (n) { n.x = isUndo ? m.oldX : m.newX; n.y = isUndo ? m.oldY : m.newY; await saveNode(n); renderNode(n); }
      }
      break;
    }
    case 'edit-node': {
      const n = state.nodes.find(x => x.id === action.id);
      if (n) {
        Object.assign(n, isUndo ? action.oldData : action.newData);
        await saveNode(n);
        removeNodeEl(n.id);
        renderNode(n);
      }
      break;
    }
    case 'add-edge': {
      if (isUndo) { state.edges = state.edges.filter(x => x.id !== action.edge.id); await deleteEdge(action.edge.id); }
      else { const c = {...action.edge}; state.edges.push(c); await saveEdge(c); }
      break;
    }
    case 'delete-edge': {
      if (isUndo) { const c = {...action.edge}; state.edges.push(c); await saveEdge(c); }
      else { state.edges = state.edges.filter(x => x.id !== action.edge.id); await deleteEdge(action.edge.id); }
      break;
    }
    case 'edit-edge': {
      const e = state.edges.find(x => x.id === action.id);
      if (e) {
        Object.assign(e, isUndo ? action.oldData : action.newData);
        await saveEdge(e);
      }
      break;
    }
    case 'resize-node': {
      const n = state.nodes.find(x => x.id === action.id);
      if (n) {
        n.width = isUndo ? action.oldWidth : action.newWidth;
        n.height = isUndo ? (action.oldHeight || null) : (action.newHeight || null);
        await saveNode(n);
        const el = getNodeEl(n.id);
        if (el) {
          el.style.width = (n.width || 220) + 'px';
          el.style.height = n.height ? n.height + 'px' : '';
        }
      }
      break;
    }
    case 'add-group': {
      if (isUndo) { state.groups = state.groups.filter(g => g.id !== action.group.id); await deleteGroupFromDB(action.group.id); }
      else { state.groups.push({...action.group}); await saveGroupToDB({...action.group}); }
      renderGroups();
      break;
    }
    case 'delete-group': {
      if (isUndo) { state.groups.push({...action.group}); await saveGroupToDB({...action.group}); }
      else { state.groups = state.groups.filter(g => g.id !== action.group.id); await deleteGroupFromDB(action.group.id); }
      renderGroups();
      break;
    }
    case 'clear': {
      if (isUndo) {
        for (const n of action.nodes) { const c={...n}; state.nodes.push(c); await saveNode(c); renderNode(c); }
        for (const e of action.edges) { const c={...e}; state.edges.push(c); await saveEdge(c); }
        for (const g of action.groups) { const c={...g}; state.groups.push(c); await saveGroupToDB(c); }
      } else {
        for (const n of [...state.nodes]) { await deleteNode(n.id); removeNodeEl(n.id); }
        for (const e of [...state.edges]) await deleteEdge(e.id);
        for (const g of [...state.groups]) await deleteGroupFromDB(g.id);
        state.nodes = []; state.edges = []; state.groups = [];
        nodesLayer.innerHTML = '';
      }
      renderGroups();
      break;
    }
  }
  refreshCollapsedState();
  await updateMapTimestamp();
}

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

// ─── MAP MANAGEMENT ──────────────────────────────────────────────
async function getAllMaps() {
  return new Promise(res => { const r = dbStore('maps').getAll(); r.onsuccess = () => res(r.result); });
}
async function saveMap(map) {
  return new Promise(res => { dbStore('maps', 'readwrite').put(map).onsuccess = res; });
}
async function deleteMapFromDB(id) {
  return new Promise(res => { dbStore('maps', 'readwrite').delete(id).onsuccess = res; });
}
async function saveCurrentMapId(id) {
  return new Promise(res => { dbStore('meta', 'readwrite').put({ key: 'currentMapId', value: id }).onsuccess = res; });
}
async function loadCurrentMapId() {
  return new Promise(res => { const req = dbStore('meta').get('currentMapId'); req.onsuccess = () => res(req.result?.value || null); });
}

async function createNewMap(name) {
  const map = { id: uid(), name: name || 'Unbenannt', created: Date.now(), updated: Date.now() };
  await saveMap(map);
  return map;
}

async function switchToMap(mapId) {
  if (currentMapId) await saveMeta(state.transform);
  currentMapId = mapId;
  await saveCurrentMapId(mapId);

  nodesLayer.innerHTML = '';
  edgesGroup.innerHTML = '';
  state.nodes = []; state.edges = []; state.groups = [];
  state.selectedNodes.clear();
  state.connectSource = null;
  state.dragging = null;
  state.resizing = null;
  state.transform = { x: 0, y: 0, scale: 1 };
  undoStack.length = 0; redoStack.length = 0;
  updateUndoRedoButtons();

  const { nodes, edges, groups } = await loadAll();
  state.nodes = nodes;
  state.groups = groups;

  // Remove dangling edges to avoid render failures on large/old datasets.
  const nodeIds = new Set(state.nodes.map(n => n.id));
  const validEdges = [];
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) validEdges.push(e);
  }
  if (validEdges.length !== edges.length) {
    for (const e of edges) {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) await deleteEdge(e.id);
    }
  }
  state.edges = validEdges;

  const meta = await loadMeta();
  if (meta) state.transform = meta;
  applyTransform();

  state.nodes.forEach(n => renderNode(n));
  refreshCollapsedState();

  const maps = await getAllMaps();
  const map = maps.find(m => m.id === mapId);
  $('current-map-name').textContent = map ? map.name : '';
  renderSidebar();
  renderBreadcrumbs();

  if (state.nodes.length > 0 && !meta) fitView();
  drawMinimap();
}

async function deleteMapById(mapId) {
  const maps = await getAllMaps();
  if (maps.length <= 1) { showToast('Letzte Mindmap kann nicht gelöscht werden'); return; }
  if (!confirm('Mindmap und alle Blöcke löschen?')) return;
  const allNodes = await new Promise(res => { const r = dbStore('nodes').getAll(); r.onsuccess = () => res(r.result); });
  const allEdges = await new Promise(res => { const r = dbStore('edges').getAll(); r.onsuccess = () => res(r.result); });
  for (const n of allNodes.filter(n => n.mapId === mapId)) await deleteNode(n.id);
  for (const e of allEdges.filter(e => e.mapId === mapId)) await deleteEdge(e.id);
  try {
    const allGroups = await new Promise(res => { const r = dbStore('groups').getAll(); r.onsuccess = () => res(r.result); });
    for (const g of allGroups.filter(g => g.mapId === mapId)) await deleteGroupFromDB(g.id);
  } catch(e) {}
  await deleteMapFromDB(mapId);
  const remaining = maps.filter(m => m.id !== mapId);
  await switchToMap(remaining[0].id);
  showToast('Mindmap gelöscht');
}

async function renameMap(mapId) {
  const maps = await getAllMaps();
  const map = maps.find(m => m.id === mapId);
  if (!map) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="width:400px">
      <div class="modal-header">
        <div class="modal-title">Mindmap umbenennen</div>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="rename-input" value="${escHtml(map.name)}" placeholder="Name..." autocomplete="off"/>
        </div>
      </div>
      <div class="modal-footer">
        <button class="tb-btn" onclick="this.closest('.modal-backdrop').remove()">Abbrechen</button>
        <button class="tb-btn accent" id="rename-save">Speichern</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  const input = backdrop.querySelector('#rename-input');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') backdrop.querySelector('#rename-save').click(); e.stopPropagation(); });
  backdrop.querySelector('#rename-save').addEventListener('click', async () => {
    const name = input.value.trim() || 'Unbenannt';
    map.name = name; map.updated = Date.now();
    await saveMap(map);
    if (mapId === currentMapId) $('current-map-name').textContent = name;
    renderSidebar(); backdrop.remove();
    showToast('Umbenannt', 'success');
  });
  document.body.appendChild(backdrop);
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

// ─── FOLDER MANAGEMENT ───────────────────────────────────────────
async function getAllFolders() {
  return new Promise(res => { const r = dbStore('folders').getAll(); r.onsuccess = () => res(r.result || []); });
}

async function saveFolder(folder) {
  return new Promise(res => { dbStore('folders', 'readwrite').put(folder).onsuccess = res; });
}

async function deleteFolderFromDB(id) {
  return new Promise(res => { dbStore('folders', 'readwrite').delete(id).onsuccess = res; });
}

async function createNewFolder(name, parentFolderId = null) {
  const folders = await getAllFolders();
  const parent = parentFolderId ? folders.find(f => f.id === parentFolderId) : null;
  let fsPath = null;
  const createdPath = await tauriInvoke('create_folder_on_disk', {
    name: name || 'Neuer Ordner',
    parentPath: parent?.fsPath || null,
  });
  if (createdPath && typeof createdPath === 'string') fsPath = createdPath;

  const folder = {
    id: uid(),
    name: name || 'Neuer Ordner',
    created: Date.now(),
    parentId: parentFolderId,
    color: '#666',
    fsPath,
    expanded: true,
  };
  await saveFolder(folder);
  return folder;
}

async function rebaseChildFolderPaths(parentFolderId, oldParentPath, newParentPath) {
  if (!oldParentPath || !newParentPath) return;
  const folders = await getAllFolders();
  for (const child of folders.filter(f => f.parentId === parentFolderId)) {
    if (child.fsPath && child.fsPath.startsWith(oldParentPath)) {
      child.fsPath = newParentPath + child.fsPath.slice(oldParentPath.length);
      await saveFolder(child);
    }
    await rebaseChildFolderPaths(child.id, oldParentPath, newParentPath);
  }
}

async function renameFolder(folderId) {
  const folders = await getAllFolders();
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="width:400px">
      <div class="modal-header">
        <div class="modal-title">Ordner umbenennen</div>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="rename-input" value="${escHtml(folder.name)}" placeholder="Name..." autocomplete="off"/>
        </div>
      </div>
      <div class="modal-footer">
        <button class="tb-btn" onclick="this.closest('.modal-backdrop').remove()">Abbrechen</button>
        <button class="tb-btn accent" id="rename-save">Speichern</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  const input = backdrop.querySelector('#rename-input');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') backdrop.querySelector('#rename-save').click(); e.stopPropagation(); });
  backdrop.querySelector('#rename-save').addEventListener('click', async () => {
    const name = input.value.trim() || 'Neuer Ordner';
    const oldPath = folder.fsPath || null;
    const parent = folder.parentId ? folders.find(f => f.id === folder.parentId) : null;
    const renamedPath = oldPath
      ? await tauriInvoke('rename_folder_on_disk', { path: oldPath, newName: name })
      : await tauriInvoke('create_folder_on_disk', { name, parentPath: parent?.fsPath || null });
    folder.name = name;
    if (renamedPath && typeof renamedPath === 'string') {
      folder.fsPath = renamedPath;
      await rebaseChildFolderPaths(folder.id, oldPath, renamedPath);
    }
    await saveFolder(folder);
    renderSidebar();
    backdrop.remove();
    showToast('Ordner umbenannt', 'success');
  });
  document.body.appendChild(backdrop);
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

async function deleteFolderById(folderId) {
  const folders = await getAllFolders();
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  if (!confirm(`Ordner "${folder.name}" löschen? (Mindmaps bleiben erhalten)`)) return;

  // Unassign maps from this folder
  const maps = await getAllMaps();
  for (const map of maps.filter(m => m.folderId === folderId)) {
    map.folderId = null;
    await saveMap(map);
  }

  // Delete subfolders
  const subfolders = folders.filter(f => f.parentId === folderId);
  for (const subfolder of subfolders) {
    await deleteFolderById(subfolder.id);
  }

  if (folder.fsPath) {
    await tauriInvoke('delete_folder_on_disk', { path: folder.fsPath });
  }

  await deleteFolderFromDB(folderId);
  renderSidebar();
  showToast('Ordner gelöscht', 'success');
}

window.renameFolder = renameFolder;
window.deleteFolderById = deleteFolderById;

// ─── SIDEBAR UI ──────────────────────────────────────────────────
function toggleSidebar(open) {
  const sidebar = $('sidebar'), overlay = $('sidebar-overlay');
  const isOpen = sidebar.classList.contains('open');
  const shouldOpen = open !== undefined ? open : !isOpen;
  sidebar.classList.toggle('open', shouldOpen);
  overlay.classList.toggle('open', shouldOpen);
  if (shouldOpen) renderSidebar();
}

async function renderSidebar() {
  const maps = await getAllMaps();
  const folders = await getAllFolders();
  maps.sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  const allNodes = await new Promise(res => { const r = dbStore('nodes').getAll(); r.onsuccess = () => res(r.result || []); });
  const nodeCounts = new Map();
  for (const n of allNodes) nodeCounts.set(n.mapId, (nodeCounts.get(n.mapId) || 0) + 1);
  
  const list = $('sidebar-list');
  list.innerHTML = '';

  // Build folder tree
  const rootFolders = folders.filter(f => !f.parentId);

  // Render root folder maps
  const rootMaps = maps.filter(m => !m.folderId);
  
  // Helper to render folder and its contents
  async function renderFolder(folder, level = 0) {
    const subFolders = folders.filter(f => f.parentId === folder.id);
    const folderMaps = maps.filter(m => m.folderId === folder.id);
    
    const folderEl = document.createElement('div');
    folderEl.className = 'sidebar-folder' + (folder.expanded ? '' : ' collapsed');
    folderEl.dataset.folderId = folder.id;
    folderEl.style.paddingLeft = (level * 16) + 'px';
    
    const header = document.createElement('div');
    header.className = 'sidebar-folder-header';
    header.innerHTML = `
      <span class="folder-toggle">${folder.expanded ? '▼' : '▶'}</span>
      <svg class="folder-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M2 2h5l1 2h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
      </svg>
      <span class="folder-name">${escHtml(folder.name)}</span>
      <div class="folder-actions">
        <button class="folder-action-btn" title="Ordner hinzufügen">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>
        </button>
        <button class="folder-action-btn rename-btn" title="Umbenennen">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3L11 2z"/></svg>
        </button>
        <button class="folder-action-btn del" title="Löschen">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
        </button>
      </div>
    `;
    
    header.querySelector('.folder-toggle').addEventListener('click', async e => {
      e.stopPropagation();
      folder.expanded = !folder.expanded;
      await saveFolder(folder);
      renderSidebar();
    });

    header.querySelector('.folder-action-btn:nth-of-type(1)').addEventListener('click', async e => {
      e.stopPropagation();
      const newFolder = await createNewFolder('Neuer Ordner', folder.id);
      folder.expanded = true;
      await saveFolder(folder);
      renderSidebar();
    });

    header.querySelector('.rename-btn').addEventListener('click', e => {
      e.stopPropagation();
      renameFolder(folder.id);
    });

    header.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      deleteFolderById(folder.id);
    });

    // Tauri WebView works reliably with text/plain data transfer
    header.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      header.classList.add('drag-over');
    });
    header.addEventListener('dragleave', () => header.classList.remove('drag-over'));
    header.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      header.classList.remove('drag-over');
      const mapId = e.dataTransfer.getData('application/x-secondmap-mapid') || e.dataTransfer.getData('text/plain');
      if (!mapId) return;
      const map = maps.find(m => m.id === mapId);
      if (!map) return;
      if (map.folderId === folder.id) return;
      map.folderId = folder.id;
      folder.expanded = true;
      await saveMap(map);
      await saveFolder(folder);
      await renderSidebar();
    });

    folderEl.appendChild(header);

    if (folder.expanded) {
      // Render subfolder maps
      for (const map of folderMaps) {
        const item = await createMapElement(map);
        item.style.paddingLeft = ((level + 1) * 16) + 'px';
        item.classList.add('sidebar-item-in-folder');
        folderEl.appendChild(item);
      }

      // Render subfolders
      for (const subFolder of subFolders) {
        const subEl = await renderFolder(subFolder, level + 1);
        folderEl.appendChild(subEl);
      }
    }

    return folderEl;
  }

  // Helper to create map element
  async function createMapElement(map) {
    const isActive = map.id === currentMapId;
    const count = nodeCounts.get(map.id) || 0;
    const date = new Date(map.updated || map.created);
    const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (isActive ? ' active' : '');
    item.draggable = true;
    item.innerHTML = `
      <div class="sidebar-item-info">
        <div class="sidebar-item-name">${escHtml(map.name)}</div>
        <div class="sidebar-item-meta">${count} Blöcke · ${dateStr}</div>
      </div>
      <div class="sidebar-item-actions">
        <button class="sidebar-action-btn rename-btn" title="Umbenennen">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3L11 2z"/></svg>
        </button>
        <button class="sidebar-action-btn del" title="Löschen">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
        </button>
      </div>
    `;
    item.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-secondmap-mapid', map.id);
      e.dataTransfer.setData('text/plain', map.id);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.querySelector('.sidebar-item-info').addEventListener('click', async () => {
      if (map.id !== currentMapId) { await switchToMap(map.id); toggleSidebar(false); }
    });
    item.querySelector('.rename-btn').addEventListener('click', e => { e.stopPropagation(); renameMap(map.id); });
    item.querySelector('.del').addEventListener('click', e => { e.stopPropagation(); deleteMapById(map.id); });
    
    return item;
  }

  // Render root folders
  for (const folder of rootFolders) {
    list.appendChild(await renderFolder(folder));
  }

  // Render root maps
  for (const map of rootMaps) {
    list.appendChild(await createMapElement(map));
  }

  $('sidebar-footer').textContent = `${maps.length} Mindmap${maps.length !== 1 ? 's' : ''} · Lokal gespeichert`;
}

$('btn-sidebar').addEventListener('click', () => toggleSidebar());
$('sidebar-close-btn').addEventListener('click', () => toggleSidebar(false));
$('sidebar-overlay').addEventListener('click', () => toggleSidebar(false));
$('sidebar-new-btn').addEventListener('click', async e => {
  e.stopPropagation();
  const menu = document.createElement('div');
  menu.className = 'sidebar-new-menu';
  menu.innerHTML = `
    <button class="sidebar-new-item" id="new-map-btn">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/><line x1="5" y1="6" x2="11" y2="6"/><line x1="5" y1="10" x2="9" y2="10"/></svg>
      Neue Mindmap
    </button>
    <button class="sidebar-new-item" id="new-folder-btn">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2h5l1 2h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/></svg>
      Neuer Ordner
    </button>
  `;
  $('sidebar').appendChild(menu);
  
  menu.querySelector('#new-map-btn').addEventListener('click', async () => {
    const map = await createNewMap('Neue Mindmap');
    await switchToMap(map.id);
    toggleSidebar(false);
    showToast('Neue Mindmap erstellt', 'success');
    renameMap(map.id);
    menu.remove();
  });

  menu.querySelector('#new-folder-btn').addEventListener('click', async () => {
    const folder = await createNewFolder('Neuer Ordner');
    renderSidebar();
    renameFolder(folder.id);
    menu.remove();
  });

  document.addEventListener('click', function removeMenu(e) {
    if (!menu.contains(e.target) && e.target !== $('sidebar-new-btn')) {
      menu.remove();
      document.removeEventListener('click', removeMenu);
    }
  });
});

// ─── UUID ────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ─── MARKDOWN RENDERER ───────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '<span style="color:var(--border2);font-style:italic">Kein Inhalt</span>';

  const placeholders = [];
  let phIdx = 0;

  // Extract fenced code blocks ```lang\ncode\n```
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const key = `__MDPH${phIdx++}__`;
    let highlighted;
    if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code.trimEnd(), { language: lang }).value;
    } else if (typeof hljs !== 'undefined' && code.trim()) {
      highlighted = hljs.highlightAuto(code.trimEnd()).value;
    } else {
      highlighted = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    const langLabel = lang ? `<span class="code-lang-label">${lang}</span>` : '';
    placeholders.push(`<div class="code-block">${langLabel}<pre><code>${highlighted}</code></pre></div>`);
    return key;
  });

  // Extract mermaid blocks ```mermaid\n...\n```
  text = text.replace(/```mermaid\n([\s\S]*?)```/g, (_, diagram) => {
    const key = `__MDPH${phIdx++}__`;
    const id = 'mermaid-' + Date.now() + '-' + phIdx;
    placeholders.push(`<div class="mermaid-block" data-mermaid="${btoa(unescape(encodeURIComponent(diagram.trim())))}" id="${id}"></div>`);
    return key;
  });

  // Extract display LaTeX $$...$$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => {
    const key = `__MDPH${phIdx++}__`;
    if (typeof katex !== 'undefined') {
      try { placeholders.push(`<div class="latex-block">${katex.renderToString(formula.trim(), { displayMode: true, throwOnError: false })}</div>`); }
      catch(e) { placeholders.push(`<div class="latex-block latex-error">${formula.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>`); }
    } else { placeholders.push(`<div class="latex-block">$$${formula}$$</div>`); }
    return key;
  });

  // Extract inline LaTeX $...$
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, formula) => {
    const key = `__MDPH${phIdx++}__`;
    if (typeof katex !== 'undefined') {
      try { placeholders.push(katex.renderToString(formula.trim(), { displayMode: false, throwOnError: false })); }
      catch(e) { placeholders.push(`<span class="latex-error">${formula.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span>`); }
    } else { placeholders.push(`$${formula}$`); }
    return key;
  });

  // Extract tables (before HTML escaping)
  text = text.replace(/((?:^|\n)\|.+\|[ \t]*\n\|[\s\-:|]+\|[ \t]*\n(?:\|.+\|[ \t]*\n?)+)/g, (tableBlock) => {
    const key = `__MDPH${phIdx++}__`;
    const rows = tableBlock.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) { placeholders.push(tableBlock); return key; }
    const parseRow = r => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const headers = parseRow(rows[0]);
    const aligns = parseRow(rows[1]).map(c => {
      if (/^:-+:$/.test(c)) return 'center';
      if (/^-+:$/.test(c)) return 'right';
      return 'left';
    });
    let tableHtml = '<table class="md-table"><thead><tr>';
    headers.forEach((h, i) => { tableHtml += `<th style="text-align:${aligns[i] || 'left'}">${h.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</th>`; });
    tableHtml += '</tr></thead><tbody>';
    for (let r = 2; r < rows.length; r++) {
      const cells = parseRow(rows[r]);
      tableHtml += '<tr>';
      cells.forEach((c, i) => { tableHtml += `<td style="text-align:${aligns[i] || 'left'}">${c.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</td>`; });
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table>';
    placeholders.push(tableHtml);
    return key;
  });

  // Standard markdown
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g, (_, alt, src) => `<img class="md-img" src="${src}" alt="${alt.replace(/"/g,'&quot;')}" loading="lazy" onclick="event.stopPropagation();window.open('${src}','_blank','noopener')"/>`)
    .replace(/!\[([^\]]*)\]\((data:[^\)]+)\)/g, (_, alt, src) => `<img class="md-img" src="${src}" alt="${alt.replace(/"/g,'&quot;')}" loading="lazy"/>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (_, l, u) => `<a href="${u}" data-url="${u}" onclick="openLink(event)">${l}</a>`)
    .replace(/\[([^\]]+)\]\((file:\/\/[^\)]+)\)/g, (_, l, u) => `<a href="${u}" data-url="${u}" onclick="openLink(event)">${l}</a>`)
    .replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" data-url="${u}" onclick="openLink(event)">${u}</a>`);

  // Process line-based markdown (headings, lists, blockquotes, hr, checkboxes)
  html = html.split('\n').map(line => {
    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) return `<h${hMatch[1].length} class="md-heading">${hMatch[2]}</h${hMatch[1].length}>`;
    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) return '<hr class="md-hr">';
    // Blockquote
    const bqMatch = line.match(/^&gt;\s?(.*)$/);
    if (bqMatch) return `<div class="md-blockquote">${bqMatch[1]}</div>`;
    // Checkbox list items
    const cbChecked = line.match(/^[\-\*]\s+\[x\]\s+(.+)$/i);
    if (cbChecked) return `<div class="md-li md-checkbox checked">☑ ${cbChecked[1]}</div>`;
    const cbUnchecked = line.match(/^[\-\*]\s+\[ \]\s+(.+)$/);
    if (cbUnchecked) return `<div class="md-li md-checkbox">☐ ${cbUnchecked[1]}</div>`;
    // Unordered list item
    const ulMatch = line.match(/^[\-\*]\s+(.+)$/);
    if (ulMatch) return `<div class="md-li">• ${ulMatch[1]}</div>`;
    // Ordered list item
    const olMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) return `<div class="md-li">${olMatch[1]}. ${olMatch[2]}</div>`;
    return line;
  }).join('<br>')
  // Collapse consecutive <br> between block elements
  .replace(/(<\/h[1-6]>|<hr class="md-hr">|<\/div>)<br>(<h[1-6]|<hr|<div class="md-)/g, '$1$2')
  .replace(/<br>(<h[1-6])/g, '$1')
  .replace(/(<\/h[1-6]>)<br>/g, '$1');

  // Restore placeholders
  for (let i = 0; i < placeholders.length; i++) {
    html = html.replace(`__MDPH${i}__`, placeholders[i]);
  }

  return html;
}

// Render mermaid diagrams after DOM insertion
function renderMermaidBlocks(root = document) {
  if (typeof mermaid === 'undefined') return;
  root.querySelectorAll('.mermaid-block[data-mermaid]').forEach(async el => {
    const code = decodeURIComponent(escape(atob(el.dataset.mermaid)));
    el.removeAttribute('data-mermaid');
    try {
      const { svg } = await mermaid.render(el.id + '-svg', code);
      el.innerHTML = svg;
    } catch(e) {
      el.innerHTML = `<pre class="mermaid-error">${code.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`;
    }
  });
}

function openLink(e) { e.preventDefault(); e.stopPropagation(); const u = e.currentTarget.dataset.url; if (u) window.open(u, '_blank', 'noopener'); }
window.openLink = openLink;

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── TRANSFORM ───────────────────────────────────────────────────
const GRAPH_ENTER_SCALE = 0.4;
const GRAPH_EXIT_SCALE = 0.46;
let graphMode = false;
let interactTimer = null;

// Zoomed far out the map turns into an Obsidian-style graph: dots, thin straight lines, faint labels.
// Node contents are display:none there, so heights are frozen first to keep edge anchors stable.
function updateGraphMode() {
  const s = state.transform.scale;
  const now = graphMode ? s < GRAPH_EXIT_SCALE : s < GRAPH_ENTER_SCALE;
  if (now !== graphMode) {
    graphMode = now;
    if (now) {
      const els = [...nodesLayer.children];
      const heights = els.map(el => el.style.display === 'none' ? 0 : el.offsetHeight);
      els.forEach((el, i) => { if (heights[i]) el.style.setProperty('--fh', heights[i] + 'px'); });
    } else {
      for (const el of nodesLayer.children) el.style.removeProperty('--fh');
      canvasWrap.style.removeProperty('--inv-scale');
      canvasWrap.style.removeProperty('--label-opacity');
    }
    canvasWrap.classList.toggle('graph-mode', now);
    renderEdges();
  }
  // Custom properties are inherited, so they are only touched while the graph view needs them.
  if (graphMode) {
    canvasWrap.style.setProperty('--inv-scale', (1 / s).toString());
    canvasWrap.style.setProperty('--label-opacity', Math.max(0, Math.min(1, (s - 0.14) / 0.18)).toFixed(2));
  }
}

function updateGraphDotSizes() {
  const degree = new Map();
  for (const e of state.edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  for (const el of nodesLayer.children) {
    const size = (Math.min(22, 8 + Math.sqrt(degree.get(el.dataset.id) || 0) * 3.5)).toFixed(1) + 'px';
    if (el.style.getPropertyValue('--dot-size') !== size) el.style.setProperty('--dot-size', size);
  }
}

function applyTransform() {
  canvasWrap.classList.add('interacting');
  clearTimeout(interactTimer);
  interactTimer = setTimeout(() => canvasWrap.classList.remove('interacting'), 180);
  updateGraphMode();
  const t = `translate(${state.transform.x}px, ${state.transform.y}px) scale(${state.transform.scale})`;
  nodesLayer.style.transform = t; nodesLayer.style.transformOrigin = '0 0';
  const el = $('edges-layer');
  el.style.transform = t; el.style.transformOrigin = '0 0';
  const gl = $('groups-layer');
  if (gl) { gl.style.transform = t; gl.style.transformOrigin = '0 0'; }
}
function worldToScreen(wx, wy) { return { x: wx * state.transform.scale + state.transform.x, y: wy * state.transform.scale + state.transform.y }; }
function screenToWorld(sx, sy) { return { x: (sx - state.transform.x) / state.transform.scale, y: (sy - state.transform.y) / state.transform.scale }; }

// ─── NODE DOM ────────────────────────────────────────────────────
function createNodeEl(node) {
  const el = document.createElement('div');
  el.className = 'node';
  el.dataset.id = node.id;
  el._content = node.content;
  nodeEls.set(node.id, el);
  nodeSizes.delete(node.id);
  nodeResizeObserver.observe(el);
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';
  el.style.width = (node.width || 220) + 'px';
  if (node.height) el.style.height = node.height + 'px';

  const tpl = node.template && NODE_TEMPLATES[node.template];
  const pri = node.priority && PRIORITIES[node.priority];
  const tplIcon = tpl ? `<span class="node-tpl-icon" title="${tpl.label}">${tpl.icon}</span>` : '';
  const priBadge = pri ? `<span class="node-priority-badge" style="background:${pri.color}" title="${pri.label}"></span>` : '';
  const subMapIcon = node.subMapId ? `<span class="node-submap-icon" title="Sub-Map öffnen (Doppelklick)" onclick="openSubMap('${node.id}')">🗂️</span>` : '';
  const favStar = `<span class="node-fav-star ${node.favorite ? 'active' : ''}" title="Favorit" onclick="event.stopPropagation();toggleFavorite('${node.id}')">★</span>`;
  const tagsHtml = (node.tags && node.tags.length > 0) ? `<div class="node-tags">${node.tags.map(t => `<span class="node-tag">${escHtml(t)}</span>`).join('')}</div>` : '';
  const attachHtml = (node.attachments && node.attachments.length > 0) ? `<div class="node-attach-bar">📎 ${node.attachments.length} Datei${node.attachments.length !== 1 ? 'en' : ''}</div>` : '';

  el.innerHTML = `
    <div class="node-header">
      ${favStar}${tplIcon}${priBadge}
      <div class="node-color-dot" style="background:${node.color || NODE_COLORS[0]}" title="Farbe ändern" onclick="cycleColor(event,'${node.id}')"></div>
      <input class="node-title" value="${escHtml(node.title || '')}" placeholder="Titel..." data-id="${node.id}" spellcheck="false"/>
      <div class="node-actions">
        ${subMapIcon}
        <button class="node-action-btn" title="Kind hinzufügen" onclick="addChildNode('${node.id}')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v6m0 0l-4 4m4-4l4 4"/></svg>
        </button>
        <button class="node-action-btn" title="Bearbeiten" onclick="openEdit('${node.id}')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3L11 2z"/></svg>
        </button>
        <button class="node-action-btn del" title="Löschen" onclick="deleteNodeById('${node.id}')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
        </button>
      </div>
    </div>
    <div class="node-body" id="body-${node.id}">${renderMarkdown(node.content)}</div>
    ${tagsHtml}
    ${attachHtml}
    <div class="node-connect-handle" title="Verbinden" data-id="${node.id}"></div>
    <div class="node-resize-handle" data-id="${node.id}"></div>
    <div class="node-graph-dot"><span class="node-graph-label">${escHtml(node.title || '')}</span></div>
  `;
  el.style.setProperty('--node-color', node.color || NODE_COLORS[0]);

  const titleInput = el.querySelector('.node-title');
  titleInput.addEventListener('change', async () => {
    const n = state.nodes.find(n => n.id === node.id);
    if (n) { n.title = titleInput.value; await saveNode(n); updateMapTimestamp(); }
  });
  titleInput.addEventListener('input', () => {
    el.querySelector('.node-graph-label').textContent = titleInput.value;
  });
  titleInput.addEventListener('mousedown', e => e.stopPropagation());
  titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') titleInput.blur(); e.stopPropagation(); });

  el.addEventListener('mousedown', e => onNodeMouseDown(e, node.id));
  el.addEventListener('click', e => onNodeClick(e, node.id));
  el.addEventListener('dblclick', e => onNodeDblClick(e, node.id));

  el.querySelector('.node-connect-handle').addEventListener('mousedown', e => onHandleMouseDown(e, node.id));
  el.querySelector('.node-resize-handle').addEventListener('mousedown', e => onResizeMouseDown(e, node.id));

  return el;
}

function renderNode(node) {
  let el = getNodeEl(node.id);
  if (!el) { el = createNodeEl(node); nodesLayer.appendChild(el); renderMermaidBlocks(el); }
  else {
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.style.width = (node.width || 220) + 'px';
    el.style.height = node.height ? node.height + 'px' : '';
    const dot = el.querySelector('.node-color-dot');
    if (dot) dot.style.background = node.color || NODE_COLORS[0];
    el.style.setProperty('--node-color', node.color || NODE_COLORS[0]);
    const graphLabel = el.querySelector('.node-graph-label');
    if (graphLabel) graphLabel.textContent = node.title || '';
    const body = $('body-' + node.id);
    if (body && el._content !== node.content) {
      body.innerHTML = renderMarkdown(node.content);
      el._content = node.content;
      renderMermaidBlocks(body);
    }
    const titleInput = el.querySelector('.node-title');
    if (titleInput && document.activeElement !== titleInput) titleInput.value = node.title || '';
    // Update favorite star
    const star = el.querySelector('.node-fav-star');
    if (star) star.classList.toggle('active', !!node.favorite);
    // Update tags
    let tagsEl = el.querySelector('.node-tags');
    if (node.tags && node.tags.length > 0) {
      const tagsHtml = node.tags.map(t => `<span class="node-tag">${escHtml(t)}</span>`).join('');
      if (tagsEl) { tagsEl.innerHTML = tagsHtml; }
      else {
        tagsEl = document.createElement('div');
        tagsEl.className = 'node-tags';
        tagsEl.innerHTML = tagsHtml;
        const bodyEl = el.querySelector('.node-body');
        if (bodyEl) bodyEl.after(tagsEl);
      }
    } else if (tagsEl) { tagsEl.remove(); }
    // Update attachments bar
    let attachBar = el.querySelector('.node-attach-bar');
    if (node.attachments && node.attachments.length > 0) {
      const text = `📎 ${node.attachments.length} Datei${node.attachments.length !== 1 ? 'en' : ''}`;
      if (attachBar) { attachBar.textContent = text; }
      else {
        attachBar = document.createElement('div');
        attachBar.className = 'node-attach-bar';
        attachBar.textContent = text;
        const ins = el.querySelector('.node-collapse-bar') || el.querySelector('.node-connect-handle');
        if (ins) el.insertBefore(attachBar, ins);
      }
    } else if (attachBar) { attachBar.remove(); }
  }
  updateNodeSelection(node.id);
  updateCollapseBar(node.id);
  if (isNodeHidden(node.id)) el.style.display = 'none';
}

function updateNodeSelection(id) {
  const el = getNodeEl(id);
  if (!el) return;
  el.classList.toggle('selected', state.selectedNodes.has(id));
  el.classList.toggle('connect-source', state.connectSource === id);
}

function removeNodeEl(id) {
  const el = getNodeEl(id);
  if (el) { nodeResizeObserver.unobserve(el); el.remove(); }
  nodeEls.delete(id);
  nodeSizes.delete(id);
}

async function updateMapTimestamp() {
  const maps = await getAllMaps();
  const map = maps.find(m => m.id === currentMapId);
  if (map) { map.updated = Date.now(); await saveMap(map); }
}

// ─── GROUPS ──────────────────────────────────────────────────────
const groupRecs = new Map();
function renderGroups() {
  const gl = $('groups-layer');
  if (!gl) return;
  const membersByGroup = new Map();
  for (const n of state.nodes) {
    if (!n.groupId) continue;
    let list = membersByGroup.get(n.groupId);
    if (!list) membersByGroup.set(n.groupId, list = []);
    list.push(n);
  }
  const seen = new Set();
  for (const group of state.groups) {
    const members = membersByGroup.get(group.id);
    if (!members) continue;
    seen.add(group.id);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of members) {
      const sz = getNodeSize(n);
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.width || 220)); maxY = Math.max(maxY, n.y + sz.h);
    }
    const pad = 20;
    const sig = (group.name || '') + '|' + (group.color || '');
    let rec = groupRecs.get(group.id);
    if (!rec || rec.sig !== sig || !rec.el.isConnected) {
      if (rec) rec.el.remove();
      const gEl = document.createElement('div');
      gEl.className = 'group-box';
      gEl.dataset.groupId = group.id;
      gEl.style.borderColor = group.color || '#555';
      gEl.style.background = (group.color || '#555') + '12';
      gEl.innerHTML = `<div class="group-label" style="color:${group.color || '#999'}">${escHtml(group.name || 'Gruppe')}
        <button class="group-del-btn" onclick="deleteGroupById('${group.id}')" title="Gruppe auflösen">×</button>
      </div>`;
      gEl.querySelector('.group-label').addEventListener('dblclick', () => renameGroup(group.id));
      gl.appendChild(gEl);
      rec = { el: gEl, sig, geo: '' };
      groupRecs.set(group.id, rec);
    }
    const left = minX - pad, top = minY - pad - 24;
    const width = maxX - minX + pad * 2, height = maxY - minY + pad * 2 + 24;
    const geo = left + ',' + top + ',' + width + ',' + height;
    if (rec.geo !== geo) {
      rec.geo = geo;
      rec.el.style.left = left + 'px'; rec.el.style.top = top + 'px';
      rec.el.style.width = width + 'px'; rec.el.style.height = height + 'px';
    }
  }
  for (const [id, rec] of groupRecs) {
    if (!seen.has(id)) { rec.el.remove(); groupRecs.delete(id); }
  }
}

async function createGroup(name, nodeIds) {
  const group = { id: uid(), mapId: currentMapId, name: name || 'Gruppe', color: '#c8f064' };
  state.groups.push(group);
  await saveGroupToDB(group);
  for (const nid of nodeIds) {
    const n = state.nodes.find(x => x.id === nid);
    if (n) { n.groupId = group.id; await saveNode(n); }
  }
  pushUndo({ type: 'add-group', group: {...group}, nodeIds: [...nodeIds] });
  await updateMapTimestamp();
  renderGroups();
  showToast('Gruppe erstellt', 'success');
  return group;
}

async function deleteGroupById(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  const members = state.nodes.filter(n => n.groupId === groupId);
  for (const n of members) { n.groupId = null; await saveNode(n); }
  state.groups = state.groups.filter(g => g.id !== groupId);
  await deleteGroupFromDB(groupId);
  pushUndo({ type: 'delete-group', group: {...group} });
  await updateMapTimestamp();
  renderGroups();
  showToast('Gruppe aufgelöst');
}
window.deleteGroupById = deleteGroupById;

function renameGroup(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  const name = prompt('Gruppenname:', group.name);
  if (name === null) return;
  group.name = name || 'Gruppe';
  saveGroupToDB(group);
  renderGroups();
}

// ─── CHILD NODES & COLLAPSING ────────────────────────────────────
function getChildren(nodeId) {
  return state.nodes.filter(n => n.parentId === nodeId);
}

function getDescendants(nodeId) {
  const result = [];
  const stack = [nodeId];
  while (stack.length) {
    const pid = stack.pop();
    for (const n of state.nodes) {
      if (n.parentId === pid) { result.push(n); stack.push(n.id); }
    }
  }
  return result;
}

function isNodeHidden(nodeId) {
  let cur = state.nodes.find(n => n.id === nodeId);
  while (cur && cur.parentId) {
    const parent = state.nodes.find(n => n.id === cur.parentId);
    if (!parent) break;
    if (parent.collapsed) return true;
    cur = parent;
  }
  return false;
}

function refreshCollapsedState() {
  for (const n of state.nodes) {
    const el = getNodeEl(n.id);
    if (!el) continue;
    el.style.display = isNodeHidden(n.id) ? 'none' : '';
  }
  for (const n of state.nodes) updateCollapseBar(n.id);
  renderEdges();
  renderGroups();
}

function updateCollapseBar(nodeId) {
  const el = getNodeEl(nodeId);
  if (!el) return;
  const children = getChildren(nodeId);
  let bar = el.querySelector('.node-collapse-bar');
  if (children.length === 0) {
    if (bar) bar.remove();
    return;
  }
  const n = state.nodes.find(x => x.id === nodeId);
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'node-collapse-bar';
    bar.addEventListener('click', e => { e.stopPropagation(); toggleCollapse(nodeId); });
    bar.addEventListener('mousedown', e => e.stopPropagation());
    const resizeHandle = el.querySelector('.node-resize-handle');
    el.insertBefore(bar, resizeHandle);
  }
  const icon = n.collapsed ? '▶' : '▼';
  const descCount = getDescendants(nodeId).length;
  bar.textContent = `${icon} ${descCount} Kind${descCount !== 1 ? 'er' : ''}`;
}

async function toggleCollapse(nodeId) {
  const n = state.nodes.find(x => x.id === nodeId);
  if (!n) return;
  n.collapsed = !n.collapsed;
  await saveNode(n);
  refreshCollapsedState();
  showToast(n.collapsed ? 'Kinder eingeklappt' : 'Kinder ausgeklappt');
}

async function addChildNode(parentId) {
  const parent = state.nodes.find(n => n.id === parentId);
  if (!parent) return;
  const children = getChildren(parentId);
  const el = getNodeEl(parentId);
  const parentH = el ? el.offsetHeight : 80;
  const childX = parent.x + 40 + children.length * 20;
  const childY = parent.y + parentH + 40 + children.length * 30;
  if (parent.collapsed) {
    parent.collapsed = false;
    await saveNode(parent);
    refreshCollapsedState();
  }
  const child = await addNode(childX, childY, { title: 'Kind-Block', parentId, skipEdit: false });
  await createEdge(parentId, child.id);
  updateCollapseBar(parentId);
}
window.addChildNode = addChildNode;

// ─── BREADCRUMBS (Sub-Maps) ─────────────────────────────────────
function renderBreadcrumbs() {
  const bc = $('breadcrumbs');
  if (!bc) return;
  if (mapNavStack.length === 0) { bc.style.display = 'none'; return; }
  bc.style.display = 'flex';
  bc.innerHTML = '';
  for (let i = 0; i < mapNavStack.length; i++) {
    const entry = mapNavStack[i];
    const btn = document.createElement('button');
    btn.className = 'breadcrumb-item';
    btn.textContent = entry.name;
    btn.addEventListener('click', async () => {
      mapNavStack.splice(i);
      await switchToMap(entry.mapId);
    });
    bc.appendChild(btn);
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '›';
    bc.appendChild(sep);
  }
  const cur = document.createElement('span');
  cur.className = 'breadcrumb-current';
  cur.textContent = $('current-map-name').textContent;
  bc.appendChild(cur);
}

async function openSubMap(nodeId) {
  const n = state.nodes.find(x => x.id === nodeId);
  if (!n || !n.subMapId) return;
  const maps = await getAllMaps();
  if (!maps.find(m => m.id === n.subMapId)) { showToast('Sub-Map nicht gefunden'); return; }
  const curMap = maps.find(m => m.id === currentMapId);
  mapNavStack.push({ mapId: currentMapId, name: curMap ? curMap.name : 'Map' });
  await switchToMap(n.subMapId);
}
window.openSubMap = openSubMap;

async function createSubMapForNode(nodeId) {
  const n = state.nodes.find(x => x.id === nodeId);
  if (!n) return;
  const subMap = await createNewMap(n.title + ' (Sub)');
  n.subMapId = subMap.id;
  await saveNode(n);
  removeNodeEl(n.id);
  renderNode(n);
  showToast('Sub-Map erstellt', 'success');
}

// ─── EDGES SVG ───────────────────────────────────────────────────
function getNodeCenter(id) {
  const n = state.nodes.find(n => n.id === id);
  if (!n) return null;
  const sz = getNodeSize(n);
  return { x: n.x + sz.w / 2, y: n.y + sz.h / 2 };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const edgeRecs = new Map();

function buildEdgeRecord(edge, graphMode, isHighlighted) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.dataset.edgeId = edge.id;

  const baseWidth = 1 + (edge.weight || 1) * 0.5;
  const strokeColor = isHighlighted ? '#c8f064' : (edge.color || '#444');
  const strokeWidth = isHighlighted ? baseWidth + 1.5 : baseWidth;

  let dashArray = '';
  if (edge.style === 'dashed') dashArray = '8 4';
  else if (edge.style === 'dotted') dashArray = '2 4';

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('stroke', strokeColor);
  path.setAttribute('stroke-width', strokeWidth.toString());
  path.setAttribute('fill', 'none');
  path.classList.add('edge-line');
  path.setAttribute('marker-end', isHighlighted ? 'url(#arrow-hover)' : 'url(#arrow)');
  if (dashArray) path.setAttribute('stroke-dasharray', dashArray);
  if (edge.bidirectional) path.setAttribute('marker-start', isHighlighted ? 'url(#arrow-start-hover)' : 'url(#arrow-start)');
  if (isHighlighted) g.classList.add('edge-path-highlighted');
  path.style.cursor = 'pointer';

  path.addEventListener('mouseenter', () => {
    path.setAttribute('stroke', '#c8f064');
    path.setAttribute('marker-end', 'url(#arrow-hover)');
    if (edge.bidirectional) path.setAttribute('marker-start', 'url(#arrow-start-hover)');
  });
  path.addEventListener('mouseleave', () => {
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('marker-end', isHighlighted ? 'url(#arrow-hover)' : 'url(#arrow)');
    if (edge.bidirectional) path.setAttribute('marker-start', isHighlighted ? 'url(#arrow-start-hover)' : 'url(#arrow-start)');
  });

  const openEd = () => openEdgeEdit(edge.id);
  path.addEventListener('click', openEd);

  const hitPath = document.createElementNS(SVG_NS, 'path');
  hitPath.setAttribute('stroke', 'transparent');
  hitPath.setAttribute('stroke-width', '12');
  hitPath.setAttribute('fill', 'none');
  hitPath.classList.add('edge-hit');
  hitPath.style.cursor = 'pointer';
  hitPath.addEventListener('click', openEd);

  g.appendChild(path);
  g.appendChild(hitPath);

  const rec = { g, path, hit: hitPath, d: '', bg: null, text: null, labelKey: '' };

  // Labels are hidden in graph mode, so they are not even created there.
  const label = graphMode ? '' : (edge.label ?? '').toString().trim();
  if (label) {
    const textLen = Math.max(24, label.length * 7 + 16);
    const bgRect = document.createElementNS(SVG_NS, 'rect');
    bgRect.setAttribute('width', textLen.toString());
    bgRect.setAttribute('height', '20');
    bgRect.setAttribute('rx', '4');
    bgRect.setAttribute('fill', '#1a1a1a');
    bgRect.setAttribute('stroke', '#2e2e2e');
    bgRect.setAttribute('stroke-width', '1');
    bgRect.style.pointerEvents = 'auto';
    bgRect.style.cursor = 'pointer';
    bgRect.addEventListener('click', openEd);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-family', 'IBM Plex Mono, monospace');
    text.setAttribute('font-size', '11');
    text.setAttribute('fill', '#8a8780');
    text.style.pointerEvents = 'auto';
    text.style.cursor = 'pointer';
    text.textContent = label;
    text.addEventListener('click', openEd);

    g.appendChild(bgRect);
    g.appendChild(text);
    rec.bg = bgRect; rec.text = text; rec.textLen = textLen;
  }
  return rec;
}

// Reconciles the SVG against state: existing edges only get their geometry updated,
// DOM is (re)built only for edges whose appearance changed.
function renderEdges() {
  const nodeMap = buildNodeMap();
  const hidden = computeHiddenSet(nodeMap);
  const seen = new Set();
  let structural = false;

  for (const edge of state.edges) {
    try {
      const sn = nodeMap.get(edge.source), tn = nodeMap.get(edge.target);
      if (!sn || !tn || hidden.has(sn.id) || hidden.has(tn.id)) continue;
      seen.add(edge.id);

      const isHighlighted = !!(state.highlightedEdges && state.highlightedEdges.has(edge.id));
      const sig = [edge.source, edge.target, edge.color, edge.style, edge.weight, edge.bidirectional,
        edge.label, isHighlighted, graphMode].join('|');
      let rec = edgeRecs.get(edge.id);
      if (!rec || rec.sig !== sig || !rec.g.isConnected) {
        if (rec) rec.g.remove();
        rec = buildEdgeRecord(edge, graphMode, isHighlighted);
        rec.sig = sig;
        edgeRecs.set(edge.id, rec);
        edgesGroup.appendChild(rec.g);
        structural = true;
      }

      const ssz = getNodeSize(sn), tsz = getNodeSize(tn);
      const sx = sn.x + ssz.w / 2, sy = sn.y + ssz.h / 2;
      const tx = tn.x + tsz.w / 2, ty = tn.y + tsz.h / 2;
      const cx1 = sx + (tx - sx) * 0.3, cy1 = sy;
      const cx2 = sx + (tx - sx) * 0.7, cy2 = ty;
      const d = graphMode
        ? `M${sx},${sy} L${tx},${ty}`
        : `M${sx},${sy} C${cx1},${cy1} ${cx2},${cy2} ${tx},${ty}`;
      if (rec.d !== d) {
        rec.d = d;
        rec.path.setAttribute('d', d);
        rec.hit.setAttribute('d', d);
        if (rec.bg) {
          const mx = 0.125 * sx + 0.375 * cx1 + 0.375 * cx2 + 0.125 * tx;
          const my = 0.125 * sy + 0.375 * cy1 + 0.375 * cy2 + 0.125 * ty;
          rec.bg.setAttribute('x', (mx - rec.textLen / 2).toString());
          rec.bg.setAttribute('y', (my - 10).toString());
          rec.text.setAttribute('x', mx.toString());
          rec.text.setAttribute('y', my.toString());
        }
      }
    } catch (err) {
      // Skip malformed edge entries without breaking full render.
      console.warn('Edge render skipped', edge?.id, err);
    }
  }

  for (const [id, rec] of edgeRecs) {
    if (!seen.has(id)) { rec.g.remove(); edgeRecs.delete(id); structural = true; }
  }
  if (structural) updateGraphDotSizes();
  drawMinimap();
}

// ─── INTERACTIONS ────────────────────────────────────────────────
function onNodeMouseDown(e, id) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'A'
    || e.target.closest('.node-connect-handle') || e.target.closest('.node-resize-handle')
    || e.target.closest('.node-submap-icon')) return;
  e.preventDefault(); e.stopPropagation();

  if (state.mode === 'connect') { onNodeClick(e, id); return; }

  // Multi-select with Ctrl
  if (e.ctrlKey || e.metaKey) {
    selectNode(id, true);
  } else if (!state.selectedNodes.has(id)) {
    selectNode(id, false);
  }

  // Start drag for selected nodes
  const n = state.nodes.find(n => n.id === id);
  if (!n) return;
  const wp = screenToWorld(e.clientX, e.clientY);
  state.dragging = id;
  state.dragOffset = { x: wp.x - n.x, y: wp.y - n.y };
  // Save start positions for undo (include descendants)
  const dragSet = new Set(state.selectedNodes);
  for (const sid of state.selectedNodes) {
    for (const desc of getDescendants(sid)) dragSet.add(desc.id);
  }
  state.dragStartPositions = {};
  state.dragSet = dragSet;
  state.dragPrimary = n;
  state.dragItems = [];
  for (const sid of dragSet) {
    const sn = state.nodes.find(x => x.id === sid);
    if (sn) {
      state.dragStartPositions[sid] = { x: sn.x, y: sn.y };
      const sel = getNodeEl(sid);
      if (sel) { sel._dragX = sn.x; sel._dragY = sn.y; sel.style.willChange = 'transform'; }
      state.dragItems.push({ n: sn, el: sel });
    }
  }
  for (const sid of state.selectedNodes) {
    const el = getNodeEl(sid);
    if (el) el.classList.add('dragging');
  }
}

function onNodeClick(e, id) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
  if (state.mode === 'connect') {
    e.stopPropagation();
    if (!state.connectSource) {
      state.connectSource = id;
      updateNodeSelection(id);
      modeIndicator.textContent = 'Ziel wählen...';
    } else if (state.connectSource !== id) {
      createEdge(state.connectSource, id);
      const prevSrc = state.connectSource;
      state.connectSource = null;
      updateNodeSelection(prevSrc);
      setMode('normal');
    }
  }
}

function onNodeDblClick(e, id) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
  const n = state.nodes.find(x => x.id === id);
  if (n && n.subMapId) { openSubMap(id); }
}

function onHandleMouseDown(e, id) {
  e.preventDefault(); e.stopPropagation();
  state.connectSource = id;
  updateNodeSelection(id);
  setMode('connect');
  modeIndicator.textContent = 'Ziel wählen...';
}

function onResizeMouseDown(e, id) {
  e.preventDefault(); e.stopPropagation();
  const n = state.nodes.find(x => x.id === id);
  if (!n) return;
  const el = getNodeEl(id);
  const currentHeight = el ? el.offsetHeight : (n.height || 0);
  state.resizing = { id, startWidth: n.width || 220, startX: e.clientX, startHeight: currentHeight, startY: e.clientY };
}

canvasWrap.addEventListener('mousedown', e => {
  if (e.target === canvasWrap || e.target.id === 'edges-layer' || e.target.id === 'edges-group'
    || e.target.tagName === 'svg' || e.target.id === 'groups-layer' || e.target.closest('.group-box')) {
    if (state.mode === 'connect') {
      setMode('normal');
      if (state.connectSource) { updateNodeSelection(state.connectSource); state.connectSource = null; }
      return;
    }
    // Shift+drag = selection rectangle
    if (e.shiftKey) {
      state.selectionRect = { startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY };
      const rect = $('selection-rect');
      if (rect) { rect.style.display = 'block'; }
      return;
    }
    selectNode(null);
    state.panning = true;
    state.panStart = { x: e.clientX, y: e.clientY };
    state.panOrigin = { x: state.transform.x, y: state.transform.y };
    canvasWrap.style.cursor = 'grabbing';
  }
});

function moveDraggedNodes(clientX, clientY) {
  if (!state.dragging || !state.dragItems) return;
  const primary = state.dragPrimary;
  if (!primary) return;
  const wp = screenToWorld(clientX, clientY);
  const dx = (wp.x - state.dragOffset.x) - primary.x;
  const dy = (wp.y - state.dragOffset.y) - primary.y;
  // Nodes move via transform (compositor only); left/top are committed on drop.
  for (const { n, el } of state.dragItems) {
    n.x += dx; n.y += dy;
    if (el) el.style.transform = `translate(${n.x - el._dragX}px, ${n.y - el._dragY}px)`;
  }
  renderEdges();
  renderGroups();
}

document.addEventListener('mousemove', e => {
  // Selection rectangle
  if (state.selectionRect) {
    state.selectionRect.endX = e.clientX;
    state.selectionRect.endY = e.clientY;
    const rect = $('selection-rect');
    if (rect) {
      const r = canvasWrap.getBoundingClientRect();
      const x1 = Math.min(state.selectionRect.startX, state.selectionRect.endX) - r.left;
      const y1 = Math.min(state.selectionRect.startY, state.selectionRect.endY) - r.top;
      const w = Math.abs(state.selectionRect.endX - state.selectionRect.startX);
      const h = Math.abs(state.selectionRect.endY - state.selectionRect.startY);
      rect.style.left = x1 + 'px'; rect.style.top = y1 + 'px';
      rect.style.width = w + 'px'; rect.style.height = h + 'px';
    }
    return;
  }

  // Resize
  if (state.resizing) {
    const dx = (e.clientX - state.resizing.startX) / state.transform.scale;
    const dy = (e.clientY - state.resizing.startY) / state.transform.scale;
    const n = state.nodes.find(x => x.id === state.resizing.id);
    if (n) {
      n.width = Math.max(150, Math.min(800, state.resizing.startWidth + dx));
      const newHeight = state.resizing.startHeight + dy;
      n.height = newHeight > 80 ? Math.round(newHeight) : null;
      const el = getNodeEl(n.id);
      if (el) {
        el.style.width = n.width + 'px';
        el.style.height = n.height ? n.height + 'px' : '';
      }
      scheduleOverlays();
    }
    return;
  }

  // Drag nodes (multi-select aware); applied once per animation frame
  if (state.dragging) {
    frame.drag = { x: e.clientX, y: e.clientY };
    scheduleFrame();
  } else if (state.panning) {
    state.transform.x = state.panOrigin.x + (e.clientX - state.panStart.x);
    state.transform.y = state.panOrigin.y + (e.clientY - state.panStart.y);
    frame.transform = true;
    scheduleFrame();
  }

  if (state.mode === 'connect' && state.connectSource) {
    const src = getNodeCenter(state.connectSource);
    if (src) {
      const wp = screenToWorld(e.clientX, e.clientY);
      tempEdge.setAttribute('x1', src.x); tempEdge.setAttribute('y1', src.y);
      tempEdge.setAttribute('x2', wp.x); tempEdge.setAttribute('y2', wp.y);
      tempEdge.setAttribute('display', 'block');
    }
  } else {
    tempEdge.setAttribute('display', 'none');
  }
});

document.addEventListener('mouseup', async e => {
  flushFrame();
  // End selection rectangle
  if (state.selectionRect) {
    const r = canvasWrap.getBoundingClientRect();
    const x1 = Math.min(state.selectionRect.startX, state.selectionRect.endX);
    const y1 = Math.min(state.selectionRect.startY, state.selectionRect.endY);
    const x2 = Math.max(state.selectionRect.startX, state.selectionRect.endX);
    const y2 = Math.max(state.selectionRect.startY, state.selectionRect.endY);
    // Select nodes within rectangle
    if (!e.ctrlKey && !e.metaKey) state.selectedNodes.clear();
    for (const n of state.nodes) {
      const el = getNodeEl(n.id);
      const w = el ? el.offsetWidth : (n.width || 220);
      const h = el ? el.offsetHeight : 80;
      const ns = worldToScreen(n.x, n.y);
      const ne = worldToScreen(n.x + w, n.y + h);
      if (ns.x < x2 && ne.x > x1 && ns.y < y2 && ne.y > y1) {
        state.selectedNodes.add(n.id);
      }
    }
    for (const n of state.nodes) updateNodeSelection(n.id);
    state.selectionRect = null;
    const rect = $('selection-rect');
    if (rect) rect.style.display = 'none';
    if (state.selectedNodes.size > 0) showToast(`${state.selectedNodes.size} Blöcke ausgewählt`);
    return;
  }

  // End resize
  if (state.resizing) {
    const n = state.nodes.find(x => x.id === state.resizing.id);
    if (n) {
      const newWidth = n.width || 220;
      const oldHeight = state.resizing.startHeight > 0 ? state.resizing.startHeight : null;
      const newHeight = n.height || null;
      if (newWidth !== state.resizing.startWidth || newHeight !== oldHeight) {
        pushUndo({ type: 'resize-node', id: n.id, oldWidth: state.resizing.startWidth, newWidth, oldHeight, newHeight });
      }
      await saveNode(n);
      await updateMapTimestamp();
    }
    state.resizing = null;
    renderEdges();
    return;
  }

  // End drag
  if (state.dragging) {
    if (state.dragItems) {
      for (const { n, el } of state.dragItems) {
        if (!el) continue;
        el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
        el.style.transform = ''; el.style.willChange = '';
      }
    }
    // Create undo for moved nodes
    if (state.dragStartPositions) {
      const moves = [];
      for (const [sid, start] of Object.entries(state.dragStartPositions)) {
        const n = state.nodes.find(x => x.id === sid);
        if (n && (n.x !== start.x || n.y !== start.y)) {
          moves.push({ id: sid, oldX: start.x, oldY: start.y, newX: n.x, newY: n.y });
          await saveNode(n);
        }
      }
      if (moves.length > 0) pushUndo({ type: 'move-nodes', moves });
      state.dragStartPositions = null;
    }
    for (const sid of state.selectedNodes) {
      const el = getNodeEl(sid);
      if (el) el.classList.remove('dragging');
    }
    state.dragging = null;
    state.dragSet = null;
    state.dragItems = null;
    state.dragPrimary = null;
    await updateMapTimestamp();
    await saveMeta(state.transform);
  }
  if (state.panning) {
    state.panning = false;
    canvasWrap.style.cursor = 'default';
    await saveMeta(state.transform);
  }
});

canvasWrap.addEventListener('wheel', e => {
  e.preventDefault();
  const target = e.target.closest('.node-body');
  if (target) { target.scrollTop += e.deltaY; return; }
  const delta = e.deltaY > 0 ? 0.95 : 1.05;
  smoothZoom(delta, e.clientX, e.clientY);
}, { passive: false });

function smoothZoom(delta, clientX, clientY) {
  const rect = canvasWrap.getBoundingClientRect();
  const mx = clientX - rect.left, my = clientY - rect.top;
  const newScale = Math.max(0.1, Math.min(4, state.transform.scale * delta));
  const actualDelta = newScale / state.transform.scale;
  const targetX = mx - (mx - state.transform.x) * actualDelta;
  const targetY = my - (my - state.transform.y) * actualDelta;
  const startX = state.transform.x, startY = state.transform.y, startScale = state.transform.scale;
  const duration = 120, startTime = performance.now();
  function step(now) {
    const t = Math.min((now - startTime) / duration, 1), ease = t * (2 - t);
    state.transform.x = startX + (targetX - startX) * ease;
    state.transform.y = startY + (targetY - startY) * ease;
    state.transform.scale = startScale + (newScale - startScale) * ease;
    applyTransform();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── OPERATIONS ──────────────────────────────────────────────────
function selectNode(id, addToSelection = false) {
  if (addToSelection) {
    if (id) {
      if (state.selectedNodes.has(id)) state.selectedNodes.delete(id);
      else state.selectedNodes.add(id);
    }
  } else {
    state.selectedNodes.clear();
    if (id) state.selectedNodes.add(id);
  }
  for (const n of state.nodes) updateNodeSelection(n.id);
}

function getSelectedNode() {
  return state.selectedNodes.size > 0 ? state.selectedNodes.values().next().value : null;
}

function setMode(mode) {
  state.mode = mode;
  const btn = $('btn-connect-mode');
  modeIndicator.textContent = mode;
  modeIndicator.className = mode === 'connect' ? 'connect-mode' : '';
  btn.classList.toggle('accent', mode === 'connect');
  if (mode !== 'connect') tempEdge.setAttribute('display', 'none');
}

async function addNode(x, y, opts = {}) {
  const tpl = opts.template && NODE_TEMPLATES[opts.template];
  const node = {
    id: uid(),
    mapId: currentMapId,
    title: opts.title || (tpl ? tpl.label : 'Neuer Block'),
    content: opts.content || '',
    x: x ?? 80 + Math.random() * 400,
    y: y ?? 80 + Math.random() * 300,
    width: opts.width || 220,
    color: opts.color || (tpl ? tpl.color : NODE_COLORS[state.nodes.length % NODE_COLORS.length]),
    template: opts.template || null,
    priority: opts.priority || null,
    subMapId: opts.subMapId || null,
    groupId: opts.groupId || null,
    parentId: opts.parentId || null,
    collapsed: false,
    tags: opts.tags || [],
    favorite: opts.favorite || false,
    attachments: opts.attachments || [],
    created: Date.now()
  };
  state.nodes.push(node);
  await saveNode(node);
  await updateMapTimestamp();
  renderNode(node);
  renderEdges();
  if (!opts.skipUndo) pushUndo({ type: 'add-nodes', nodes: [{...node}], edges: [] });
  if (!opts.skipEdit) openEdit(node.id);
  return node;
}

async function deleteSelectedNodes() {
  const ids = [...state.selectedNodes];
  if (ids.length === 0) return;
  const msg = ids.length === 1 ? 'Block und alle Verbindungen löschen?' : `${ids.length} Blöcke und deren Verbindungen löschen?`;
  if (!confirm(msg)) return;

  const deletedNodes = [];
  const deletedEdges = [];
  for (const id of ids) {
    const n = state.nodes.find(x => x.id === id);
    if (n) deletedNodes.push({...n});
    const connected = state.edges.filter(e => e.source === id || e.target === id);
    for (const e of connected) {
      if (!deletedEdges.find(x => x.id === e.id)) deletedEdges.push({...e});
    }
  }

  for (const e of deletedEdges) {
    state.edges = state.edges.filter(x => x.id !== e.id);
    await deleteEdge(e.id);
  }

  // Orphan children of deleted nodes
  const orphanedChildren = [];
  for (const id of ids) {
    for (const child of getChildren(id)) {
      if (!ids.includes(child.id)) {
        orphanedChildren.push({ id: child.id, oldParentId: child.parentId });
        child.parentId = null;
        await saveNode(child);
      }
    }
  }

  for (const id of ids) {
    state.nodes = state.nodes.filter(x => x.id !== id);
    removeNodeEl(id);
    await deleteNode(id);
  }

  pushUndo({ type: 'delete-nodes', nodes: deletedNodes, edges: deletedEdges, orphanedChildren });
  state.selectedNodes.clear();
  await updateMapTimestamp();
  renderEdges();
  renderGroups();
}

async function deleteNodeById(id) {
  if (state.selectedNodes.has(id) && state.selectedNodes.size > 1) {
    await deleteSelectedNodes();
    return;
  }
  if (!confirm('Block und alle Verbindungen löschen?')) return;
  const n = state.nodes.find(x => x.id === id);
  const deletedNode = n ? {...n} : null;
  const deletedEdges = state.edges.filter(e => e.source === id || e.target === id).map(e => ({...e}));

  // Orphan children
  const orphanedChildren = [];
  for (const child of getChildren(id)) {
    orphanedChildren.push({ id: child.id, oldParentId: child.parentId });
    child.parentId = null;
    await saveNode(child);
    renderNode(child);
  }

  for (const e of deletedEdges) {
    state.edges = state.edges.filter(x => x.id !== e.id);
    await deleteEdge(e.id);
  }
  state.nodes = state.nodes.filter(x => x.id !== id);
  removeNodeEl(id);
  await deleteNode(id);
  if (deletedNode) pushUndo({ type: 'delete-nodes', nodes: [deletedNode], edges: deletedEdges, orphanedChildren });
  state.selectedNodes.delete(id);
  await updateMapTimestamp();
  renderEdges();
  renderGroups();
}
window.deleteNodeById = deleteNodeById;

async function createEdge(sourceId, targetId) {
  const exists = state.edges.find(e => e.source === sourceId && e.target === targetId);
  if (exists) { showToast('Verbindung existiert bereits'); return; }
  const edge = { id: uid(), mapId: currentMapId, source: sourceId, target: targetId, label: '', color: '#555', style: 'solid', weight: 1, bidirectional: false };
  state.edges.push(edge);
  await saveEdge(edge);
  pushUndo({ type: 'add-edge', edge: {...edge} });
  await updateMapTimestamp();
  renderEdges();
  showToast('Verbindung erstellt', 'success');
}

async function deleteEdgeById(id) {
  const edge = state.edges.find(e => e.id === id);
  if (edge) pushUndo({ type: 'delete-edge', edge: {...edge} });
  state.edges = state.edges.filter(e => e.id !== id);
  await deleteEdge(id);
  await updateMapTimestamp();
  renderEdges();
}

const EDGE_COLORS = ['#555', '#c8f064', '#64b4f0', '#f06464', '#f0c864', '#a064f0', '#64f0c8', '#f064c8', '#8a8780'];

function openEdgeEdit(edgeId) {
  const edge = state.edges.find(e => e.id === edgeId);
  if (!edge) return;

  const oldData = { label: edge.label, color: edge.color, style: edge.style || 'solid', weight: edge.weight || 1, bidirectional: !!edge.bidirectional };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="width:420px">
      <div class="modal-header">
        <div class="modal-title">Verbindung bearbeiten</div>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Beschriftung</label>
          <input class="form-input" id="edge-edit-label" value="${escHtml(edge.label || '')}" placeholder="Label..."/>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label class="form-label">Stil</label>
            <select class="form-input" id="edge-edit-style">
              <option value="solid" ${(edge.style || 'solid') === 'solid' ? 'selected' : ''}>Durchgezogen</option>
              <option value="dashed" ${edge.style === 'dashed' ? 'selected' : ''}>Gestrichelt</option>
              <option value="dotted" ${edge.style === 'dotted' ? 'selected' : ''}>Gepunktet</option>
            </select>
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label" id="edge-weight-label">Stärke (${edge.weight || 1}/5)</label>
            <input type="range" class="form-range" id="edge-edit-weight" min="1" max="5" value="${edge.weight || 1}"/>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Farbe</label>
          <div class="color-picker-row" id="edge-color-row"></div>
        </div>
        <div class="form-group">
          <label class="form-label" style="margin-bottom:8px">Richtung</label>
          <label class="edge-toggle-label">
            <input type="checkbox" id="edge-edit-bidir" ${edge.bidirectional ? 'checked' : ''}/>
            <span>Bidirektional (Pfeile in beide Richtungen)</span>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="tb-btn danger" id="edge-edit-delete">Löschen</button>
        <div style="flex:1"></div>
        <button class="tb-btn" onclick="this.closest('.modal-backdrop').remove()">Abbrechen</button>
        <button class="tb-btn accent" id="edge-edit-save">Speichern</button>
      </div>
    </div>
  `;

  const colorRow = backdrop.querySelector('#edge-color-row');
  EDGE_COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'color-option' + ((edge.color || '#555') === c ? ' selected' : '');
    dot.style.background = c;
    dot.addEventListener('click', () => {
      colorRow.querySelectorAll('.color-option').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
    });
    colorRow.appendChild(dot);
  });

  const weightInput = backdrop.querySelector('#edge-edit-weight');
  const weightLabel = backdrop.querySelector('#edge-weight-label');
  weightInput.addEventListener('input', () => {
    weightLabel.textContent = `Stärke (${weightInput.value}/5)`;
  });

  backdrop.querySelector('#edge-edit-delete').addEventListener('click', () => {
    backdrop.remove();
    deleteEdgeById(edge.id);
    showToast('Verbindung gelöscht');
  });

  backdrop.querySelector('#edge-edit-save').addEventListener('click', async () => {
    const newData = {
      label: backdrop.querySelector('#edge-edit-label').value,
      style: backdrop.querySelector('#edge-edit-style').value || 'solid',
      weight: parseInt(weightInput.value) || 1,
      bidirectional: backdrop.querySelector('#edge-edit-bidir').checked,
      color: edge.color
    };
    const sel = colorRow.querySelector('.color-option.selected');
    if (sel) newData.color = rgb2hex(sel.style.background) || sel.style.background;

    Object.assign(edge, newData);
    await saveEdge(edge);
    pushUndo({ type: 'edit-edge', id: edge.id, oldData, newData: {...newData} });
    await updateMapTimestamp();
    renderEdges();
    backdrop.remove();
    showToast('Verbindung aktualisiert', 'success');
  });

  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  setTimeout(() => backdrop.querySelector('#edge-edit-label').focus(), 50);
}

function cycleColor(e, id) {
  e.stopPropagation();
  // Apply to all selected if this node is selected
  const targets = state.selectedNodes.has(id) && state.selectedNodes.size > 1 ? [...state.selectedNodes] : [id];
  for (const tid of targets) {
    const n = state.nodes.find(n => n.id === tid);
    if (!n) continue;
    const idx = NODE_COLORS.indexOf(n.color);
    n.color = NODE_COLORS[(idx + 1) % NODE_COLORS.length];
    saveNode(n);
    renderNode(n);
  }
}
window.cycleColor = cycleColor;

// ─── COPY / PASTE ────────────────────────────────────────────────
function copySelected() {
  if (state.selectedNodes.size === 0) return;
  const ids = [...state.selectedNodes];
  const nodes = ids.map(id => state.nodes.find(n => n.id === id)).filter(Boolean).map(n => ({...n}));
  const edges = state.edges.filter(e => ids.includes(e.source) && ids.includes(e.target)).map(e => ({...e}));
  state.clipboard = { nodes, edges };
  showToast(`${nodes.length} Block${nodes.length > 1 ? 'e' : ''} kopiert`, 'success');
}

async function pasteClipboard() {
  if (!state.clipboard || state.clipboard.nodes.length === 0) return;
  const idMap = {};
  const offset = 40;
  const newNodes = [];
  const newEdges = [];

  for (const orig of state.clipboard.nodes) {
    const newId = uid();
    idMap[orig.id] = newId;
    const n = {
      ...orig,
      id: newId,
      mapId: currentMapId,
      x: orig.x + offset,
      y: orig.y + offset,
      groupId: null,
      parentId: null,
      collapsed: false,
      tags: orig.tags || [],
      favorite: false,
      attachments: [],
      created: Date.now()
    };
    state.nodes.push(n);
    await saveNode(n);
    renderNode(n);
    newNodes.push({...n});
  }
  for (const orig of state.clipboard.edges) {
    const newId = uid();
    const e = { ...orig, id: newId, mapId: currentMapId, source: idMap[orig.source], target: idMap[orig.target] };
    if (e.source && e.target) {
      state.edges.push(e);
      await saveEdge(e);
      newEdges.push({...e});
    }
  }

  pushUndo({ type: 'add-nodes', nodes: newNodes, edges: newEdges });
  // Select pasted nodes
  state.selectedNodes.clear();
  for (const n of newNodes) state.selectedNodes.add(n.id);
  for (const n of state.nodes) updateNodeSelection(n.id);

  await updateMapTimestamp();
  renderEdges();
  showToast(`${newNodes.length} Block${newNodes.length > 1 ? 'e' : ''} eingefügt`, 'success');
}

// ─── URL IMPORT ──────────────────────────────────────────────────
async function fetchUrlContent(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text();
    if (contentType.includes('text/html')) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      doc.querySelectorAll('script, style, nav, footer, header, aside, iframe, noscript, svg').forEach(el => el.remove());
      const main = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('.content') || doc.body;
      const title = doc.querySelector('title')?.textContent?.trim() || '';
      let extracted = '';
      const walk = (node) => {
        if (node.nodeType === 3) extracted += node.textContent;
        else if (node.nodeType === 1) {
          const tag = node.tagName.toLowerCase();
          if (['p','div','br','h1','h2','h3','h4','h5','h6','li','tr'].includes(tag)) extracted += '\n';
          if (['h1','h2','h3','h4','h5','h6'].includes(tag)) extracted += '**';
          for (const child of node.childNodes) walk(child);
          if (['h1','h2','h3','h4','h5','h6'].includes(tag)) extracted += '**';
          if (['p','div','h1','h2','h3','h4','h5','h6','li'].includes(tag)) extracted += '\n';
        }
      };
      walk(main);
      extracted = extracted.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
      if (extracted.length > 2000) extracted = extracted.substring(0, 2000) + '\n\n... (gekürzt)';
      return { title, content: extracted, source: url };
    } else {
      let content = text.trim();
      if (content.length > 2000) content = content.substring(0, 2000) + '\n\n... (gekürzt)';
      return { title: url.split('/').pop() || 'Import', content, source: url };
    }
  } catch (err) { throw new Error(`Konnte URL nicht laden: ${err.message}`); }
}

function openUrlImportDialog() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="width:480px">
      <div class="modal-header">
        <div class="modal-title">Block aus URL erstellen</div>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">URL eingeben</label>
          <input class="form-input" id="url-input" placeholder="https://example.com/article" autocomplete="off"/>
        </div>
        <div id="url-status" style="font-size:12px;font-family:var(--font-mono);color:var(--text2);min-height:20px"></div>
        <div style="font-size:11px;color:var(--text2);font-family:var(--font-mono);padding:8px;background:var(--bg);border-radius:6px;line-height:1.8;margin-top:12px">
          Hinweis: Funktioniert nur mit URLs, die CORS erlauben.<br>
          Der Text wird automatisch extrahiert (max. 2000 Zeichen).
        </div>
      </div>
      <div class="modal-footer">
        <button class="tb-btn" onclick="this.closest('.modal-backdrop').remove()">Abbrechen</button>
        <button class="tb-btn accent" id="url-fetch-btn">Laden & Block erstellen</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  const urlInput = backdrop.querySelector('#url-input');
  const statusEl = backdrop.querySelector('#url-status');
  const fetchBtn = backdrop.querySelector('#url-fetch-btn');
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchBtn.click(); });
  fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { statusEl.textContent = 'Bitte eine URL eingeben.'; statusEl.style.color = 'var(--danger)'; return; }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      statusEl.textContent = 'URL muss mit http:// oder https:// beginnen.'; statusEl.style.color = 'var(--danger)'; return;
    }
    statusEl.textContent = 'Lade Inhalt...'; statusEl.style.color = 'var(--accent)';
    fetchBtn.disabled = true; fetchBtn.textContent = 'Laden...';
    try {
      const result = await fetchUrlContent(url);
      backdrop.remove();
      const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
      const wp = screenToWorld(cx, cy);
      await addNode(wp.x - 110 + (Math.random()-0.5)*150, wp.y - 40 + (Math.random()-0.5)*100, {
        title: result.title || 'URL Import',
        content: `Quelle: [${url}](${url})\n\n${result.content}`,
        skipEdit: true
      });
      showToast('Block aus URL erstellt', 'success');
    } catch (err) {
      statusEl.textContent = err.message; statusEl.style.color = 'var(--danger)';
      fetchBtn.disabled = false; fetchBtn.textContent = 'Laden & Block erstellen';
    }
  });
  document.body.appendChild(backdrop);
  setTimeout(() => urlInput.focus(), 50);
}
if ($('btn-import-url')) $('btn-import-url').addEventListener('click', openUrlImportDialog);

// ─── EDIT MODAL ──────────────────────────────────────────────────
function openEdit(id) {
  const n = state.nodes.find(n => n.id === id);
  if (!n) return;
  selectNode(id);

  const oldData = { title: n.title, content: n.content, color: n.color, template: n.template, priority: n.priority, width: n.width, subMapId: n.subMapId, tags: [...(n.tags||[])], favorite: n.favorite, attachments: [...(n.attachments||[])] };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title">Block bearbeiten</div>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Titel</label>
          <input class="form-input" id="edit-title" value="${escHtml(n.title || '')}" placeholder="Titel..."/>
        </div>
        <div class="form-group">
          <label class="form-label">Inhalt (Markdown, Links erlaubt)</label>
          <textarea class="form-textarea" id="edit-content" placeholder="Inhalt...">${escHtml(n.content || '')}</textarea>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <button class="tb-btn" id="edit-insert-image-btn" style="font-size:12px">🖼 Bild einfügen</button>
            <span class="form-hint">PNG/JPG als Inline-Bild (max. 2 MB)</span>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label class="form-label">Template</label>
            <select class="form-input" id="edit-template">
              <option value="">Keins</option>
              ${Object.entries(NODE_TEMPLATES).map(([k,v]) => `<option value="${k}" ${n.template===k?'selected':''}>${v.icon} ${v.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">Priorität</label>
            <select class="form-input" id="edit-priority">
              <option value="">Keine</option>
              ${Object.entries(PRIORITIES).map(([k,v]) => `<option value="${k}" ${n.priority===k?'selected':''}>${v.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Farbe</label>
          <div class="color-picker-row" id="color-picker-row"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Tags</label>
          <div id="edit-tags" class="tag-chips"></div>
          <input class="form-input" id="edit-tag-input" placeholder="Tag eingeben + Enter" style="margin-top:6px"/>
        </div>
        <div class="form-group">
          <label class="form-label">Dateianhänge</label>
          <div id="edit-attachments" class="attach-list"></div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <button class="tb-btn" id="edit-attach-btn" style="font-size:12px">📎 Datei anhängen</button>
            <span class="form-hint">Max. 5 MB pro Datei</span>
          </div>
        </div>
        <div class="form-group">
          <label class="edge-toggle-label">
            <input type="checkbox" id="edit-favorite" ${n.favorite ? 'checked' : ''}/>
            <span>★ Als Favorit markieren</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-label">Sub-Map</label>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="form-hint" id="submap-info" style="flex:1">${n.subMapId ? 'Verknüpft (Doppelklick zum Öffnen)' : 'Keine Sub-Map'}</span>
            <button class="tb-btn" id="edit-create-submap" style="font-size:12px">${n.subMapId ? 'Sub-Map öffnen' : 'Sub-Map erstellen'}</button>
          </div>
        </div>
        ${n.parentId ? `<div class="form-group" id="edit-parent-wrap">
          <label class="form-label">Eltern-Block</label>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="form-hint" id="edit-parent-info" style="flex:1"></span>
            <button class="tb-btn" id="edit-detach-parent" style="font-size:12px">Ablösen</button>
          </div>
        </div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="tb-btn" onclick="this.closest('.modal-backdrop').remove()">Abbrechen</button>
        <button class="tb-btn accent" id="edit-save">Speichern</button>
      </div>
    </div>
  `;

  const colorRow = backdrop.querySelector('#color-picker-row');
  NODE_COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'color-option' + (n.color === c ? ' selected' : '');
    dot.style.background = c;
    dot.addEventListener('click', () => {
      colorRow.querySelectorAll('.color-option').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
    });
    colorRow.appendChild(dot);
  });

  // Template change auto-sets color
  const tplSelect = backdrop.querySelector('#edit-template');
  tplSelect.addEventListener('change', () => {
    const tpl = NODE_TEMPLATES[tplSelect.value];
    if (tpl) {
      colorRow.querySelectorAll('.color-option').forEach(d => {
        d.classList.toggle('selected', d.style.background === tpl.color || rgb2hex(d.style.background) === tpl.color);
      });
    }
  });

  // Tags
  const tagsContainer = backdrop.querySelector('#edit-tags');
  const tagInput = backdrop.querySelector('#edit-tag-input');
  let editTags = [...(n.tags || [])];
  function renderEditTags() {
    tagsContainer.innerHTML = editTags.map((t, i) =>
      `<span class="tag-chip">${escHtml(t)}<button class="tag-remove" data-idx="${i}">×</button></span>`
    ).join('');
    tagsContainer.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', () => { editTags.splice(parseInt(btn.dataset.idx), 1); renderEditTags(); });
    });
  }
  renderEditTags();
  tagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const tag = tagInput.value.trim();
      if (tag && !editTags.includes(tag)) { editTags.push(tag); renderEditTags(); }
      tagInput.value = '';
    }
    e.stopPropagation();
  });

  // Insert inline image into content
  backdrop.querySelector('#edit-insert-image-btn').addEventListener('click', () => {
    const imgInput = document.createElement('input');
    imgInput.type = 'file';
    imgInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
    imgInput.onchange = async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { showToast('Bild zu groß (max. 2 MB)'); return; }
      const data = await fileToBase64(file);
      const markdown = `![${file.name}](${data})`;
      const ta = backdrop.querySelector('#edit-content');
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = ta.value.substring(0, start);
      const after = ta.value.substring(end);
      ta.value = before + (before && !before.endsWith('\n') ? '\n' : '') + markdown + (after && !after.startsWith('\n') ? '\n' : '') + after;
      ta.selectionStart = ta.selectionEnd = start + markdown.length;
      ta.focus();
    };
    imgInput.click();
  });

  // Attachments
  const attachList = backdrop.querySelector('#edit-attachments');
  let editAttachments = [...(n.attachments || [])];
  function renderEditAttachments() {
    attachList.innerHTML = editAttachments.map((a, i) =>
      `<div class="attach-item">
        <span class="attach-name">${escHtml(a.name)}</span>
        <span class="attach-size">${formatFileSize(a.size)}</span>
        <button class="attach-dl" data-idx="${i}" title="Herunterladen">⬇</button>
        <button class="attach-rm" data-idx="${i}" title="Entfernen">×</button>
      </div>`
    ).join('');
    attachList.querySelectorAll('.attach-dl').forEach(btn => {
      btn.addEventListener('click', () => downloadAttachment(editAttachments[parseInt(btn.dataset.idx)]));
    });
    attachList.querySelectorAll('.attach-rm').forEach(btn => {
      btn.addEventListener('click', () => { editAttachments.splice(parseInt(btn.dataset.idx), 1); renderEditAttachments(); });
    });
  }
  renderEditAttachments();
  backdrop.querySelector('#edit-attach-btn').addEventListener('click', () => {
    const fileInput = $('file-attach');
    fileInput.onchange = async (ev) => {
      for (const file of ev.target.files) {
        if (file.size > 5 * 1024 * 1024) { showToast(`${file.name} ist zu groß (max. 5 MB)`); continue; }
        const data = await fileToBase64(file);
        editAttachments.push({ name: file.name, type: file.type, size: file.size, data });
        renderEditAttachments();
      }
      fileInput.value = '';
    };
    fileInput.click();
  });

  // Sub-map button
  backdrop.querySelector('#edit-create-submap').addEventListener('click', async () => {
    if (n.subMapId) {
      backdrop.remove();
      openSubMap(id);
    } else {
      await createSubMapForNode(id);
      backdrop.querySelector('#submap-info').textContent = 'Verknüpft (Doppelklick zum Öffnen)';
      backdrop.querySelector('#edit-create-submap').textContent = 'Sub-Map öffnen';
    }
  });

  // Parent detach button
  if (n.parentId) {
    const parentNode = state.nodes.find(x => x.id === n.parentId);
    backdrop.querySelector('#edit-parent-info').textContent = parentNode ? `Kind von \u201e${parentNode.title}\u201c` : 'Eltern nicht gefunden';
    backdrop.querySelector('#edit-detach-parent').addEventListener('click', async () => {
      const oldParentId = n.parentId;
      n.parentId = null;
      await saveNode(n);
      pushUndo({ type: 'edit-node', id: n.id, oldData: { parentId: oldParentId }, newData: { parentId: null } });
      const pw = backdrop.querySelector('#edit-parent-wrap');
      if (pw) pw.style.display = 'none';
      removeNodeEl(n.id);
      renderNode(n);
      refreshCollapsedState();
      showToast('Vom Eltern-Block abgelöst');
    });
  }

  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  backdrop.querySelector('#edit-save').addEventListener('click', async () => {
    const newData = {
      title: backdrop.querySelector('#edit-title').value,
      content: backdrop.querySelector('#edit-content').value,
      template: tplSelect.value || null,
      priority: backdrop.querySelector('#edit-priority').value || null,
      color: n.color,
      width: n.width,
      subMapId: n.subMapId,
      tags: editTags,
      favorite: backdrop.querySelector('#edit-favorite').checked,
      attachments: editAttachments
    };
    const sel = colorRow.querySelector('.color-option.selected');
    if (sel) newData.color = rgb2hex(sel.style.background) || sel.style.background;

    Object.assign(n, newData);
    await saveNode(n);
    pushUndo({ type: 'edit-node', id: n.id, oldData, newData: {...newData} });
    await updateMapTimestamp();
    removeNodeEl(n.id);
    renderNode(n);
    renderEdges();
    backdrop.remove();
    showToast('Gespeichert', 'success');
  });

  document.body.appendChild(backdrop);
  setTimeout(() => backdrop.querySelector('#edit-title').focus(), 50);
}
window.openEdit = openEdit;

function rgb2hex(rgb) {
  if (!rgb || rgb.startsWith('#')) return rgb;
  const m = rgb.match(/(\d+)/g);
  if (!m || m.length < 3) return rgb;
  return '#' + m.slice(0,3).map(x => parseInt(x).toString(16).padStart(2,'0')).join('');
}

// ─── TEMPLATE QUICK-CREATE ───────────────────────────────────────
function openTemplateMenu() {
  const existing = document.querySelector('.template-dropdown');
  if (existing) { existing.remove(); return; }

  const btn = $('btn-template');
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'template-dropdown';
  dd.style.top = rect.bottom + 4 + 'px';
  dd.style.left = rect.left + 'px';

  for (const [key, tpl] of Object.entries(NODE_TEMPLATES)) {
    const item = document.createElement('button');
    item.className = 'template-dropdown-item';
    item.innerHTML = `<span>${tpl.icon}</span> ${tpl.label}`;
    item.addEventListener('click', async () => {
      dd.remove();
      const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
      const wp = screenToWorld(cx, cy);
      await addNode(wp.x - 110 + (Math.random()-0.5)*150, wp.y - 40 + (Math.random()-0.5)*100, { template: key });
    });
    dd.appendChild(item);
  }

  // Separator + URL Import
  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--border2);margin:4px 0;';
  dd.appendChild(sep);
  const urlItem = document.createElement('button');
  urlItem.className = 'template-dropdown-item';
  urlItem.innerHTML = '<span>🌐</span> URL Import';
  urlItem.addEventListener('click', () => { dd.remove(); openUrlImportDialog(); });
  dd.appendChild(urlItem);

  document.body.appendChild(dd);
  const close = (e) => { if (!dd.contains(e.target) && e.target !== btn) { dd.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

// ─── FIT VIEW ────────────────────────────────────────────────────
function fitView() {
  const visibleNodes = state.nodes.filter(n => !isNodeHidden(n.id));
  if (visibleNodes.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of visibleNodes) {
    const el = getNodeEl(n.id);
    const w = el ? el.offsetWidth : (n.width || 220);
    const h = el ? el.offsetHeight : 80;
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  }
  const pad = 80;
  const cw = canvasWrap.offsetWidth, ch = canvasWrap.offsetHeight;
  const scale = Math.min((cw - pad*2) / (maxX - minX), (ch - pad*2) / (maxY - minY), 2);
  state.transform.scale = Math.max(0.1, scale);
  state.transform.x = (cw - (maxX - minX) * scale) / 2 - minX * scale;
  state.transform.y = (ch - (maxY - minY) * scale) / 2 - minY * scale;
  applyTransform(); drawMinimap();
}

// ─── MINIMAP ─────────────────────────────────────────────────────
let minimapQueued = false;
function drawMinimap() {
  if (minimapQueued) return;
  minimapQueued = true;
  requestAnimationFrame(() => { minimapQueued = false; paintMinimap(); });
}

function paintMinimap() {
  const W = 140, H = 90;
  mmCtx.clearRect(0, 0, W, H);
  if (state.nodes.length === 0) return;
  const nodeMap = buildNodeMap();
  const hidden = computeHiddenSet(nodeMap);
  const visibleNodes = state.nodes.filter(n => !hidden.has(n.id));
  if (visibleNodes.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of visibleNodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + (n.width||220)); maxY = Math.max(maxY, n.y + 80);
  }
  const pad = 10;
  const scaleX = (W - pad*2) / Math.max(maxX - minX, 1);
  const scaleY = (H - pad*2) / Math.max(maxY - minY, 1);
  const sc = Math.min(scaleX, scaleY);
  for (const edge of state.edges) {
    const s = nodeMap.get(edge.source);
    const t = nodeMap.get(edge.target);
    if (!s || !t) continue;
    if (hidden.has(edge.source) || hidden.has(edge.target)) continue;
    const isHL = state.highlightedEdges && state.highlightedEdges.has(edge.id);
    mmCtx.beginPath();
    if (edge.style === 'dashed') mmCtx.setLineDash([4, 2]);
    else if (edge.style === 'dotted') mmCtx.setLineDash([1, 2]);
    else mmCtx.setLineDash([]);
    mmCtx.moveTo(pad + (s.x + (s.width||220)/2 - minX) * sc, pad + (s.y + 40 - minY) * sc);
    mmCtx.lineTo(pad + (t.x + (t.width||220)/2 - minX) * sc, pad + (t.y + 40 - minY) * sc);
    mmCtx.strokeStyle = isHL ? '#c8f064' : '#444';
    mmCtx.lineWidth = Math.max(1, (edge.weight || 1) * 0.5 + 0.5);
    mmCtx.stroke();
    mmCtx.setLineDash([]);
  }
  for (const n of visibleNodes) {
    const x = pad + (n.x - minX) * sc, y = pad + (n.y - minY) * sc;
    const w = Math.max(8, (n.width||220) * sc), h = Math.max(4, 80 * sc);
    mmCtx.fillStyle = n.color || '#444'; mmCtx.globalAlpha = 0.6;
    mmCtx.beginPath(); mmCtx.roundRect(x, y, w, h, 2); mmCtx.fill();
    mmCtx.globalAlpha = 1;
  }
}

// ─── IMPORT / EXPORT ─────────────────────────────────────────────

async function saveFileWithDialog(content, defaultName, filterName, extensions) {
  if (window.__TAURI__) {
    try {
      const path = await window.__TAURI__.dialog.save({
        defaultPath: defaultName,
        filters: [{ name: filterName, extensions }]
      });
      if (!path) return false;
      await window.__TAURI__.fs.writeTextFile(path, content);
      return true;
    } catch(e) { console.error('Save dialog error:', e); }
  }
  // Fallback for browser / dev mode
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  return true;
}

$('btn-export-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('export-menu');
  menu.classList.toggle('open');
});
document.addEventListener('click', () => { $('export-menu').classList.remove('open'); });
$('btn-export-json').addEventListener('click', async () => {
  const data = JSON.stringify({ nodes: state.nodes, edges: state.edges, groups: state.groups }, null, 2);
  const mapName = $('current-map-name').textContent || 'mindgraph';
  const saved = await saveFileWithDialog(data, `${mapName}.json`, 'JSON', ['json']);
  if (saved) showToast('Exportiert', 'success');
});

$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (!data.nodes || !data.edges) throw new Error('Ungültiges Format');
    if (!confirm(`${data.nodes.length} Blöcke und ${data.edges.length} Verbindungen importieren?`)) return;

    // Remap all IDs to fresh UIDs so that importing the same JSON file into
    // multiple maps never overwrites records that belong to another map.
    const idMap = {};
    const remappedNodes = data.nodes.map(n => {
      const newId = uid();
      idMap[n.id] = newId;
      return { ...n, id: newId, mapId: currentMapId };
    });
    // Fix intra-map references after all IDs are mapped
    for (const n of remappedNodes) {
      if (n.parentId) n.parentId = idMap[n.parentId] || n.parentId;
    }
    const remappedEdges = data.edges.map(ed => ({
      ...ed,
      id: uid(),
      mapId: currentMapId,
      source: idMap[ed.source] || ed.source,
      target: idMap[ed.target] || ed.target,
    }));

    for (const n of remappedNodes) { state.nodes.push(n); await saveNode(n); }
    for (const ed of remappedEdges) { state.edges.push(ed); await saveEdge(ed); }

    if (data.groups) {
      for (const g of data.groups) {
        const remappedGroup = {
          ...g,
          id: uid(),
          mapId: currentMapId,
          nodeIds: (g.nodeIds || []).map(nid => idMap[nid] || nid),
        };
        state.groups.push(remappedGroup);
        await saveGroupToDB(remappedGroup);
      }
    }
    await updateMapTimestamp();
    state.nodes.forEach(n => renderNode(n));
    renderEdges(); renderGroups(); fitView();
    showToast(`${data.nodes.length} Blöcke importiert`, 'success');
  } catch(err) { showToast('Fehler beim Import: ' + err.message); }
  e.target.value = '';
});

// ─── CODE FILE IMPORT ────────────────────────────────────────────
$('btn-import-code').addEventListener('click', () => $('file-import-code').click());
$('file-import-code').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const ext = file.name.split('.').pop().toLowerCase();
  const langMap = {
    c:'c', h:'c', cpp:'cpp', hpp:'cpp', rs:'rust', py:'python', js:'javascript',
    ts:'typescript', java:'java', asm:'x86asm', s:'x86asm', sh:'bash', bat:'batch',
    ps1:'powershell', go:'go', zig:'zig', v:'verilog', sv:'verilog', vhdl:'vhdl',
    rb:'ruby', lua:'lua', toml:'toml', yaml:'yaml', yml:'yaml', xml:'xml',
    txt:'plaintext', md:'markdown', csv:'csv'
  };
  const lang = langMap[ext] || '';
  const content = '```' + lang + '\n' + text + '\n```';
  const cx = (canvasWrap.clientWidth / 2 - state.transform.x) / state.transform.scale;
  const cy = (canvasWrap.clientHeight / 2 - state.transform.y) / state.transform.scale;
  await addNode(cx, cy, {
    title: file.name,
    content,
    template: 'code',
    width: Math.min(600, Math.max(300, text.split('\n').reduce((m, l) => Math.max(m, l.length), 0) * 7 + 40)),
    tags: [lang || ext]
  });
  fitView();
  showToast(`"${file.name}" importiert`, 'success');
  e.target.value = '';
});

// ─── CONFIG FILE IMPORT (Kconfig / defconfig / ini / env) ────────
$('btn-import-config').addEventListener('click', () => $('file-import-config').click());
$('file-import-config').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split('\n');

  // Parse config into sections/entries
  const sections = {};
  let currentSection = '__root__';
  sections[currentSection] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue;
    // INI-style section headers
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) { currentSection = secMatch[1]; sections[currentSection] = sections[currentSection] || []; continue; }
    // Key=value or key: value
    const kvMatch = line.match(/^([A-Za-z0-9_.\-\/]+)\s*[=:]\s*(.*)$/);
    if (kvMatch) { sections[currentSection].push({ key: kvMatch[1], value: kvMatch[2].replace(/^["']|["']$/g, '') }); continue; }
    // CONFIG_XXX=y / CONFIG_XXX is not set (Kconfig)
    const kcMatch = line.match(/^(CONFIG_\w+)=(.+)$/);
    if (kcMatch) { sections[currentSection].push({ key: kcMatch[1], value: kcMatch[2] }); continue; }
    // Fallback: add as-is
    sections[currentSection].push({ key: line, value: '' });
  }

  const cx = (canvasWrap.clientWidth / 2 - state.transform.x) / state.transform.scale;
  const cy = (canvasWrap.clientHeight / 2 - state.transform.y) / state.transform.scale;

  // Create root node
  const rootId = uid();
  await addNode(cx, cy, {
    title: file.name,
    content: `Config-Datei mit ${lines.length} Zeilen\n\n` +
      Object.keys(sections).filter(s => s !== '__root__').map(s => `- **[${s}]** (${sections[s].length})`).join('\n'),
    template: 'config',
    tags: ['config', file.name.split('.').pop()],
    skipEdit: true
  });
  const rootNode = state.nodes[state.nodes.length - 1];

  // Create child nodes for each section
  const sectionNames = Object.keys(sections);
  let offsetY = 0;
  for (const secName of sectionNames) {
    const entries = sections[secName];
    if (entries.length === 0) continue;

    // Build table content
    let content = `| Key | Value |\n| --- | --- |\n`;
    for (const entry of entries) {
      content += `| \`${entry.key}\` | \`${entry.value || '—'}\` |\n`;
    }

    offsetY += 200;
    await addNode(cx + 300, cy + offsetY - 100, {
      title: secName === '__root__' ? 'Einstellungen' : secName,
      content,
      template: 'config',
      parentId: rootNode.id,
      width: 400,
      tags: ['config-section'],
      skipEdit: true
    });
    const childNode = state.nodes[state.nodes.length - 1];
    await createEdge(rootNode.id, childNode.id);
  }

  fitView();
  showToast(`Config "${file.name}" importiert: ${sectionNames.length} Sektionen`, 'success');
  e.target.value = '';
});

$('btn-clear').addEventListener('click', async () => {
  if (!confirm('Alle Blöcke und Verbindungen löschen?')) return;
  pushUndo({ type: 'clear', nodes: state.nodes.map(n => ({...n})), edges: state.edges.map(e => ({...e})), groups: state.groups.map(g => ({...g})) });
  for (const n of [...state.nodes]) await deleteNode(n.id);
  for (const e of [...state.edges]) await deleteEdge(e.id);
  for (const g of [...state.groups]) await deleteGroupFromDB(g.id);
  state.nodes = []; state.edges = []; state.groups = [];
  nodesLayer.innerHTML = '';
  await updateMapTimestamp();
  renderEdges(); renderGroups();
  showToast('Geleert');
});

let lastMousePos = null;
canvasWrap.addEventListener('mousemove', e => { lastMousePos = { x: e.clientX, y: e.clientY }; });

// ─── PATH HIGHLIGHTING ──────────────────────────────────────────
function findShortestPath(startId, endId) {
  const adj = {};
  for (const n of state.nodes) adj[n.id] = [];
  for (const e of state.edges) {
    if (!adj[e.source]) adj[e.source] = [];
    if (!adj[e.target]) adj[e.target] = [];
    adj[e.source].push({ node: e.target, edge: e.id });
    adj[e.target].push({ node: e.source, edge: e.id });
  }
  const queue = [{ node: startId, path: [], edges: [] }];
  const visited = new Set([startId]);
  while (queue.length > 0) {
    const { node, path, edges } = queue.shift();
    if (node === endId) return { nodes: [...path, node], edges };
    for (const neighbor of (adj[node] || [])) {
      if (!visited.has(neighbor.node)) {
        visited.add(neighbor.node);
        queue.push({ node: neighbor.node, path: [...path, node], edges: [...edges, neighbor.edge] });
      }
    }
  }
  return null;
}

function highlightPath() {
  const ids = [...state.selectedNodes];
  if (ids.length !== 2) {
    showToast('Wähle genau 2 Blöcke für Pfad-Highlighting');
    return;
  }
  const result = findShortestPath(ids[0], ids[1]);
  if (!result) {
    showToast('Kein Pfad gefunden');
    state.highlightedEdges = null;
    renderEdges();
    return;
  }
  state.highlightedEdges = new Set(result.edges);
  renderEdges();
  showToast(`Kürzester Pfad: ${result.nodes.length} Blöcke, ${result.edges.length} Verbindungen`, 'success');
}

// ─── HELPERS (Attachments) ────────────────────────────────────────
function fileToBase64(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function downloadAttachment(attachment) {
  const a = document.createElement('a');
  a.href = attachment.data;
  a.download = attachment.name;
  a.click();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── FAVORITES ───────────────────────────────────────────────────
async function toggleFavorite(nodeId) {
  const n = state.nodes.find(x => x.id === nodeId);
  if (!n) return;
  const oldFav = !!n.favorite;
  n.favorite = !oldFav;
  await saveNode(n);
  pushUndo({ type: 'edit-node', id: n.id, oldData: { favorite: oldFav }, newData: { favorite: n.favorite } });
  renderNode(n);
  showToast(n.favorite ? 'Als Favorit markiert' : 'Favorit entfernt');
}
window.toggleFavorite = toggleFavorite;

function openFavoritesPanel() {
  const favNodes = state.nodes.filter(n => n.favorite);
  if (favNodes.length === 0) { showToast('Keine Favoriten vorhanden'); return; }

  const existing = document.querySelector('.favorites-dropdown');
  if (existing) { existing.remove(); return; }

  const btn = $('btn-favorites');
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'favorites-dropdown';
  dd.style.top = rect.bottom + 4 + 'px';
  dd.style.left = Math.max(8, rect.left - 100) + 'px';

  dd.innerHTML = `<div class="fav-dd-title">★ Favoriten (${favNodes.length})</div>` +
    favNodes.map(n => `<div class="fav-dd-item" data-id="${n.id}">
      <span class="fav-dd-color" style="background:${n.color || '#444'}"></span>
      <span class="fav-dd-name">${escHtml(n.title || 'Ohne Titel')}</span>
    </div>`).join('');

  dd.querySelectorAll('.fav-dd-item').forEach(item => {
    item.addEventListener('click', () => {
      const nodeId = item.dataset.id;
      const n = state.nodes.find(x => x.id === nodeId);
      if (n) {
        selectNode(nodeId);
        const el = getNodeEl(nodeId);
        const w = el ? el.offsetWidth : (n.width || 220);
        const h = el ? el.offsetHeight : 80;
        const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
        state.transform.x = cx - (n.x + w / 2) * state.transform.scale;
        state.transform.y = cy - (n.y + h / 2) * state.transform.scale;
        applyTransform(); drawMinimap();
      }
      dd.remove();
    });
  });

  document.body.appendChild(dd);
  const close = (e) => { if (!dd.contains(e.target) && e.target !== btn) { dd.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

// ─── SEARCH & FILTER ─────────────────────────────────────────────
function openSearchPanel() {
  const panel = $('search-panel');
  panel.classList.add('open');
  const input = $('search-input');
  input.value = '';
  input.focus();

  // Populate color filter
  const colorFilter = $('filter-color');
  if (colorFilter.options.length <= 1) {
    NODE_COLORS.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      opt.style.background = c;
      colorFilter.appendChild(opt);
    });
  }
  $('filter-tag').value = '';
  $('filter-fav').checked = false;
  $('filter-global').checked = false;
  $('search-results').innerHTML = '<div class="search-hint">Suchbegriff eingeben oder Filter setzen...</div>';
}

function closeSearchPanel() {
  $('search-panel').classList.remove('open');
  state.nodes.forEach(n => {
    const el = getNodeEl(n.id);
    if (el) el.classList.remove('search-match');
  });
}

async function performSearch() {
  const query = $('search-input').value.trim().toLowerCase();
  const colorFilter = $('filter-color').value;
  const tagFilter = $('filter-tag').value.trim().toLowerCase();
  const favOnly = $('filter-fav').checked;
  const globalSearch = $('filter-global').checked;

  let searchNodes;
  let mapNames = {};

  if (globalSearch) {
    const allNodes = await new Promise(res => { const r = dbStore('nodes').getAll(); r.onsuccess = () => res(r.result); });
    searchNodes = allNodes;
  } else {
    searchNodes = state.nodes;
  }

  const maps = await getAllMaps();
  maps.forEach(m => { mapNames[m.id] = m.name; });

  const results = searchNodes.filter(n => {
    if (query && !n.title.toLowerCase().includes(query) && !(n.content || '').toLowerCase().includes(query)
        && !(n.tags || []).some(t => t.toLowerCase().includes(query))) return false;
    if (colorFilter && n.color !== colorFilter) return false;
    if (tagFilter && !(n.tags || []).some(t => t.toLowerCase().includes(tagFilter))) return false;
    if (favOnly && !n.favorite) return false;
    return true;
  });

  const resultsEl = $('search-results');
  if (!query && !colorFilter && !tagFilter && !favOnly) {
    resultsEl.innerHTML = '<div class="search-hint">Suchbegriff eingeben oder Filter setzen...</div>';
    return;
  }

  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="search-hint">Keine Ergebnisse</div>';
    return;
  }

  resultsEl.innerHTML = `<div class="search-count">${results.length} Ergebnis${results.length !== 1 ? 'se' : ''}</div>` +
    results.slice(0, 50).map(n => {
      const mapLabel = globalSearch && n.mapId !== currentMapId ? `<span class="search-result-map">${escHtml(mapNames[n.mapId] || '?')}</span>` : '';
      const tags = (n.tags || []).map(t => `<span class="search-result-tag">${escHtml(t)}</span>`).join('');
      const fav = n.favorite ? ' ★' : '';
      return `<div class="search-result-item" data-id="${n.id}" data-map="${n.mapId}">
        <div class="search-result-color" style="background:${n.color || '#444'}"></div>
        <div class="search-result-info">
          <div class="search-result-title">${escHtml(n.title || 'Ohne Titel')}${fav}</div>
          ${tags}${mapLabel}
        </div>
      </div>`;
    }).join('');

  resultsEl.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', async () => {
      const nodeId = item.dataset.id;
      const mapId = item.dataset.map;
      if (mapId !== currentMapId) await switchToMap(mapId);
      closeSearchPanel();
      const n = state.nodes.find(x => x.id === nodeId);
      if (n) {
        selectNode(nodeId);
        const el = getNodeEl(nodeId);
        const w = el ? el.offsetWidth : (n.width || 220);
        const h = el ? el.offsetHeight : 80;
        const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
        state.transform.x = cx - (n.x + w / 2) * state.transform.scale;
        state.transform.y = cy - (n.y + h / 2) * state.transform.scale;
        applyTransform(); drawMinimap();
      }
    });
  });

  // Highlight matching nodes on current map
  state.nodes.forEach(n => {
    const el = getNodeEl(n.id);
    if (el) el.classList.toggle('search-match', results.some(r => r.id === n.id));
  });
}

// ─── PDF EXPORT ──────────────────────────────────────────────────
function exportPDF() {
  const visibleNodes = state.nodes.filter(n => !isNodeHidden(n.id));
  const mapName = $('current-map-name').textContent;

  const printStyle = `
    <style>
      body { font-family: 'Segoe UI', sans-serif; padding: 40px; max-width: 800px; margin: auto; color: #222; }
      h1 { font-size: 24px; border-bottom: 2px solid #c8f064; padding-bottom: 8px; margin-bottom: 24px; }
      .pdf-node { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; page-break-inside: avoid; }
      .pdf-node-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .pdf-node-color { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
      .pdf-node-title { font-size: 16px; font-weight: 600; }
      .pdf-node-fav { color: #f0c864; }
      .pdf-node-body { font-size: 13px; line-height: 1.6; color: #555; white-space: pre-wrap; }
      .pdf-node-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
      .pdf-tag { background: #f0f0f0; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
      .pdf-node-meta { font-size: 11px; color: #999; margin-top: 8px; }
      .pdf-edges { margin-top: 32px; }
      .pdf-edge { font-size: 13px; color: #555; padding: 4px 0; }
    </style>
  `;

  let content = `<h1>${escHtml(mapName)}</h1>
    <p style="color:#999;font-size:12px;margin-bottom:24px">Exportiert am ${new Date().toLocaleString('de-DE')} · ${visibleNodes.length} Blöcke</p>`;

  for (const n of visibleNodes) {
    const tags = (n.tags || []).map(t => `<span class="pdf-tag">${escHtml(t)}</span>`).join('');
    const fav = n.favorite ? '<span class="pdf-node-fav"> ★</span>' : '';
    const tpl = n.template && NODE_TEMPLATES[n.template];
    const tplLabel = tpl ? `${tpl.icon} ${tpl.label} · ` : '';
    const pri = n.priority && PRIORITIES[n.priority];
    const priLabel = pri ? `Priorität: ${pri.label} · ` : '';
    const dateStr = new Date(n.created).toLocaleString('de-DE');
    const attachCount = (n.attachments || []).length;
    const attachLabel = attachCount > 0 ? ` · 📎 ${attachCount} Datei${attachCount !== 1 ? 'en' : ''}` : '';

    content += `<div class="pdf-node">
      <div class="pdf-node-header">
        <div class="pdf-node-color" style="background:${n.color || '#ccc'}"></div>
        <div class="pdf-node-title">${escHtml(n.title || 'Ohne Titel')}</div>${fav}
      </div>
      ${n.content ? `<div class="pdf-node-body">${escHtml(n.content)}</div>` : ''}
      ${tags ? `<div class="pdf-node-tags">${tags}</div>` : ''}
      <div class="pdf-node-meta">${tplLabel}${priLabel}${dateStr}${attachLabel}</div>
    </div>`;
  }

  const visibleIds = new Set(visibleNodes.map(n => n.id));
  const visibleEdges = state.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));
  if (visibleEdges.length > 0) {
    content += `<div class="pdf-edges"><h2>Verbindungen (${visibleEdges.length})</h2>`;
    for (const e of visibleEdges) {
      const sn = state.nodes.find(n => n.id === e.source);
      const tn = state.nodes.find(n => n.id === e.target);
      const dir = e.bidirectional ? '↔' : '→';
      const label = e.label ? ` [${escHtml(e.label)}]` : '';
      content += `<div class="pdf-edge">${escHtml(sn?.title || '?')} ${dir} ${escHtml(tn?.title || '?')}${label}</div>`;
    }
    content += '</div>';
  }

  // Create a print-only overlay, print, then remove it
  const printContainer = document.createElement('div');
  printContainer.id = 'print-overlay';
  printContainer.innerHTML = printStyle + content;
  document.body.appendChild(printContainer);

  // Add print-specific CSS to hide app and show overlay
  const printCSS = document.createElement('style');
  printCSS.id = 'print-overlay-css';
  printCSS.textContent = `
    @media print {
      body > *:not(#print-overlay) { display: none !important; }
      #print-overlay { display: block !important; position: static !important; background: white; }
    }
    #print-overlay { display: none; }
  `;
  document.head.appendChild(printCSS);

  window.print();

  // Clean up after print dialog closes
  setTimeout(() => {
    printContainer.remove();
    printCSS.remove();
  }, 500);

  showToast('PDF-Export wird vorbereitet...', 'success');
}

// ─── MARKDOWN EXPORT ─────────────────────────────────────────────
async function exportMarkdown() {
  const visibleNodes = state.nodes.filter(n => !isNodeHidden(n.id));
  const mapName = $('current-map-name').textContent;

  let md = `# ${mapName}\n\n`;
  md += `> Exportiert am ${new Date().toLocaleString('de-DE')} · ${visibleNodes.length} Blöcke\n\n---\n\n`;

  const rootNodes = visibleNodes.filter(n => !n.parentId || !visibleNodes.find(p => p.id === n.parentId));
  const childMap = {};
  for (const n of visibleNodes) {
    if (n.parentId && visibleNodes.find(p => p.id === n.parentId)) {
      if (!childMap[n.parentId]) childMap[n.parentId] = [];
      childMap[n.parentId].push(n);
    }
  }

  function nodeToMd(node, depth) {
    const hLevel = Math.min(depth + 2, 6);
    const prefix = '#'.repeat(hLevel) + ' ';
    const fav = node.favorite ? ' ★' : '';
    const tags = (node.tags || []).length > 0 ? ` \`${node.tags.join('` `')}\`` : '';
    let s = `${prefix}${node.title || 'Ohne Titel'}${fav}${tags}\n\n`;
    if (node.content) s += `${node.content}\n\n`;
    const tpl = node.template && NODE_TEMPLATES[node.template];
    if (tpl) s += `*Template: ${tpl.icon} ${tpl.label}*\n\n`;
    const pri = node.priority && PRIORITIES[node.priority];
    if (pri) s += `*Priorität: ${pri.label}*\n\n`;
    if ((node.attachments || []).length > 0) {
      s += `📎 Anhänge: ${node.attachments.map(a => a.name).join(', ')}\n\n`;
    }
    if (childMap[node.id]) {
      for (const child of childMap[node.id]) s += nodeToMd(child, depth + 1);
    }
    return s;
  }

  for (const root of rootNodes) md += nodeToMd(root, 0);

  const visibleIds = new Set(visibleNodes.map(n => n.id));
  const visibleEdges = state.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));
  if (visibleEdges.length > 0) {
    md += `---\n\n## Verbindungen\n\n`;
    for (const e of visibleEdges) {
      const sn = state.nodes.find(n => n.id === e.source);
      const tn = state.nodes.find(n => n.id === e.target);
      const dir = e.bidirectional ? '↔' : '→';
      const label = e.label ? ` *(${e.label})*` : '';
      md += `- **${sn?.title || '?'}** ${dir} **${tn?.title || '?'}**${label}\n`;
    }
    md += '\n';
  }

  const saved = await saveFileWithDialog(md, `${mapName || 'mindgraph'}.md`, 'Markdown', ['md']);
  if (saved) showToast('Markdown exportiert', 'success');
}

// ─── KEYBOARD ────────────────────────────────────────────────────
document.addEventListener('keydown', async e => {
  // Undo/Redo (works even in inputs)
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); await undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); await redo(); return; }
  // Search
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openSearchPanel(); return; }
  // Copy/Paste (works even in inputs for Ctrl+C/V on canvas)
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); copySelected(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'v' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); await pasteClipboard(); return; }
  // Select all
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    state.selectedNodes.clear();
    for (const n of state.nodes) state.selectedNodes.add(n.id);
    for (const n of state.nodes) updateNodeSelection(n.id);
    showToast(`${state.selectedNodes.size} Blöcke ausgewählt`);
    return;
  }

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'n' || e.key === 'N') {
    const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
    const wp = screenToWorld(cx, cy);
    await addNode(wp.x - 110 + (Math.random()-0.5)*100, wp.y - 40 + (Math.random()-0.5)*60);
  }
  if (e.key === 'c' || e.key === 'C') setMode(state.mode === 'connect' ? 'normal' : 'connect');
  if (e.key === 'f' || e.key === 'F') fitView();
  if (e.key === 'z' || e.key === 'Z') {
    const mp = lastMousePos || { x: canvasWrap.offsetWidth / 2, y: canvasWrap.offsetHeight / 2 };
    smoothZoom(1.3, mp.x, mp.y);
  }
  if (e.key === 'u' || e.key === 'U') {
    const mp = lastMousePos || { x: canvasWrap.offsetWidth / 2, y: canvasWrap.offsetHeight / 2 };
    smoothZoom(0.7, mp.x, mp.y);
  }
  if (e.key === 'Escape') {
    setMode('normal');
    if (state.connectSource) { updateNodeSelection(state.connectSource); state.connectSource = null; }
    selectNode(null);
    toggleSidebar(false);
    closeSearchPanel();
    if (state.highlightedEdges) { state.highlightedEdges = null; renderEdges(); }
  }
  if (e.key === 'p' || e.key === 'P') highlightPath();
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedNodes.size > 0) {
    await deleteSelectedNodes();
  }
  // Group shortcut: Ctrl+G
  if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
    e.preventDefault();
    if (state.selectedNodes.size >= 2) {
      const name = prompt('Gruppenname:', 'Gruppe');
      if (name !== null) await createGroup(name, [...state.selectedNodes]);
    } else {
      showToast('Mindestens 2 Blöcke auswählen');
    }
  }
});

// ─── BUTTONS ─────────────────────────────────────────────────────
$('btn-new-node').addEventListener('click', async () => {
  const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
  const wp = screenToWorld(cx, cy);
  await addNode(wp.x - 110 + (Math.random()-0.5)*150, wp.y - 40 + (Math.random()-0.5)*100);
});
$('btn-connect-mode').addEventListener('click', () => setMode(state.mode === 'connect' ? 'normal' : 'connect'));
$('btn-fit').addEventListener('click', fitView);

// Undo/Redo buttons
if ($('btn-undo')) $('btn-undo').addEventListener('click', undo);
if ($('btn-redo')) $('btn-redo').addEventListener('click', redo);

// Template button
if ($('btn-template')) $('btn-template').addEventListener('click', openTemplateMenu);

// Search button
if ($('btn-search')) $('btn-search').addEventListener('click', openSearchPanel);

// Favorites button
if ($('btn-favorites')) $('btn-favorites').addEventListener('click', openFavoritesPanel);

// PDF & Markdown Export (handled via dropdown)
$('btn-export-pdf').addEventListener('click', exportPDF);
$('btn-export-md').addEventListener('click', exportMarkdown);

// Search panel handlers
$('search-close').addEventListener('click', closeSearchPanel);
$('search-input').addEventListener('input', performSearch);
$('filter-color').addEventListener('change', performSearch);
$('filter-tag').addEventListener('input', performSearch);
$('filter-fav').addEventListener('change', performSearch);
$('filter-global').addEventListener('change', performSearch);
$('search-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSearchPanel();
  e.stopPropagation();
});
$('filter-tag').addEventListener('keydown', e => e.stopPropagation());

// Group button
if ($('btn-group')) $('btn-group').addEventListener('click', async () => {
  if (state.selectedNodes.size >= 2) {
    const name = prompt('Gruppenname:', 'Gruppe');
    if (name !== null) await createGroup(name, [...state.selectedNodes]);
  } else {
    showToast('Mindestens 2 Blöcke auswählen zum Gruppieren');
  }
});

// ─── TOAST ───────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2200);
}

// ─── BOOT ────────────────────────────────────────────────────────
async function boot() {
  await openDB();

  let maps = await getAllMaps();
  let savedMapId = await loadCurrentMapId();

  if (maps.length === 0) {
    const oldNodes = await new Promise(res => { const r = dbStore('nodes').getAll(); r.onsuccess = () => res(r.result); });
    const oldEdges = await new Promise(res => { const r = dbStore('edges').getAll(); r.onsuccess = () => res(r.result); });
    const unmapped = oldNodes.filter(n => !n.mapId);
    const defaultMap = await createNewMap('SecondMap Architektur');
    currentMapId = defaultMap.id;
    if (unmapped.length > 0) {
      for (const n of oldNodes) { n.mapId = currentMapId; await saveNode(n); }
      for (const e of oldEdges) { e.mapId = currentMapId; await saveEdge(e); }
    }
    await saveCurrentMapId(currentMapId);
    maps = [defaultMap];
  } else {
    currentMapId = savedMapId && maps.find(m => m.id === savedMapId) ? savedMapId : maps[0].id;
  }

  await switchToMap(currentMapId);

  if (state.nodes.length === 0 && maps.length === 1) {
    try {
      const resp = await fetch('secondmap-architecture.json');
      if (resp.ok) {
        const data = await resp.json();
        for (const n of (data.nodes || [])) { n.mapId = currentMapId; state.nodes.push(n); await saveNode(n); }
        for (const ed of (data.edges || [])) { ed.mapId = currentMapId; state.edges.push(ed); await saveEdge(ed); }
        for (const g of (data.groups || [])) { g.mapId = currentMapId; state.groups.push(g); await saveGroupToDB(g); }
        await updateMapTimestamp();
        state.nodes.forEach(n => renderNode(n));
        renderEdges(); renderGroups();
      }
    } catch(_) { /* fallback: leere Map */ }
    undoStack.length = 0; redoStack.length = 0; updateUndoRedoButtons();
    fitView();
  }

  drawMinimap();
  updateUndoRedoButtons();
}

boot();
