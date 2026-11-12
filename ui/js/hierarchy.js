// Parent/child nodes, collapsing, and sub-map breadcrumbs.

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
