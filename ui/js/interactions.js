// Mouse interaction: node click/drag, connecting, resizing, panning, selection rectangle, wheel zoom.

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
  const step = settings.zoomStep / 100;
  const delta = e.deltaY > 0 ? 1 - step : 1 + step;
  smoothZoom(delta, e.clientX, e.clientY);
}, { passive: false });

function smoothZoom(delta, clientX, clientY) {
  const rect = canvasWrap.getBoundingClientRect();
  const mx = clientX - rect.left, my = clientY - rect.top;
  const newScale = Math.max(0.1, Math.min(4, state.transform.scale * delta));
  const actualDelta = newScale / state.transform.scale;
  const targetX = mx - (mx - state.transform.x) * actualDelta;
  const targetY = my - (my - state.transform.y) * actualDelta;
  if (!settings.smoothZoom) {
    state.transform.x = targetX; state.transform.y = targetY; state.transform.scale = newScale;
    applyTransform();
    return;
  }
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
