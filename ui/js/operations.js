// Core operations: selection, modes, adding/deleting nodes, creating/editing edges, node colors.

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
