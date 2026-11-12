// Map management: create, switch, rename and delete maps.

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
