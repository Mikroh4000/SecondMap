// Viewport: pan/zoom transform, graph (zoom-out) mode, fit-to-view and minimap.

// ─── TRANSFORM ───────────────────────────────────────────────────
// The graph view is left slightly above the zoom level it is entered at, so it does not flicker.
const GRAPH_EXIT_MARGIN = 0.06;
let graphMode = false;
let interactTimer = null;

// Zoomed far out the map turns into an Obsidian-style graph: dots, thin straight lines, faint labels.
// Node contents are display:none there, so heights are frozen first to keep edge anchors stable.
function updateGraphMode() {
  const s = state.transform.scale;
  const enter = settings.graphModeThreshold;
  const now = settings.graphModeEnabled && (graphMode ? s < enter + GRAPH_EXIT_MARGIN : s < enter);
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
  updateCanvasGrid();
  const t = `translate(${state.transform.x}px, ${state.transform.y}px) scale(${state.transform.scale})`;
  nodesLayer.style.transform = t; nodesLayer.style.transformOrigin = '0 0';
  const el = $('edges-layer');
  el.style.transform = t; el.style.transformOrigin = '0 0';
  const gl = $('groups-layer');
  if (gl) { gl.style.transform = t; gl.style.transformOrigin = '0 0'; }
}
function worldToScreen(wx, wy) { return { x: wx * state.transform.scale + state.transform.x, y: wy * state.transform.scale + state.transform.y }; }
function screenToWorld(sx, sy) { return { x: (sx - state.transform.x) / state.transform.scale, y: (sy - state.transform.y) / state.transform.scale }; }

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
  if (!settings.showMinimap) return;
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
    mmCtx.strokeStyle = isHL ? activePalette.accent : activePalette.edge;
    mmCtx.lineWidth = Math.max(1, (edge.weight || 1) * 0.5 + 0.5);
    mmCtx.stroke();
    mmCtx.setLineDash([]);
  }
  for (const n of visibleNodes) {
    const x = pad + (n.x - minX) * sc, y = pad + (n.y - minY) * sc;
    const w = Math.max(8, (n.width||220) * sc), h = Math.max(4, 80 * sc);
    mmCtx.fillStyle = n.color || activePalette.edge; mmCtx.globalAlpha = 0.6;
    mmCtx.beginPath(); mmCtx.roundRect(x, y, w, h, 2); mmCtx.fill();
    mmCtx.globalAlpha = 1;
  }
}
