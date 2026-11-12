// Copy and paste of nodes.

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
