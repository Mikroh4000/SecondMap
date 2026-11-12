// Rendering performance helpers: element/size caches, frame batching.

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
