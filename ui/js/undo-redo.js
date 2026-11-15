// Undo/redo stacks and the actions they can revert.

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
    case 'set-group': {
      for (const ch of action.changes) {
        const n = state.nodes.find(x => x.id === ch.id);
        if (n) { n.groupId = isUndo ? ch.oldGroupId : ch.newGroupId; await saveNode(n); }
      }
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
