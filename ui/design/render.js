// Design editor – canvas rendering (DOM nodes, selection overlay, viewport transform).

const viewportEl = $('d-viewport');
const worldEl = $('d-world');
const overlayEl = $('d-overlay');
const elMap = new Map(); // node id -> live element

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(msg, kind = '') {
  const t = $('d-toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.className = ''; }, 2200);
}

// Selected nodes whose ancestors are not selected too (the ones that actually get moved/resized).
function selRoots() {
  const set = new Set(D.sel);
  return D.sel.filter(id => {
    for (let p = parentOf(id); p; p = parentOf(p.id)) if (set.has(p.id)) return false;
    return true;
  });
}

// ─── viewport ────────────────────────────────────────────────────
function applyView() {
  const v = view();
  worldEl.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  const g = 20 * v.zoom;
  viewportEl.style.backgroundSize = g > 6 ? `${g}px ${g}px` : '0 0';
  viewportEl.style.backgroundPosition = `${v.x}px ${v.y}px`;
  $('d-zoom-label').textContent = Math.round(v.zoom * 100) + '%';
}

function screenToWorld(clientX, clientY) {
  const r = viewportEl.getBoundingClientRect(), v = view();
  return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
}

function zoomAt(clientX, clientY, factor) {
  const r = viewportEl.getBoundingClientRect(), v = view();
  const nz = Math.min(8, Math.max(0.05, v.zoom * factor));
  const px = clientX - r.left, py = clientY - r.top;
  v.x = px - (px - v.x) * (nz / v.zoom);
  v.y = py - (py - v.y) * (nz / v.zoom);
  v.zoom = nz;
  applyView(); renderOverlay();
}

function fitView(ids) {
  const list = ids && ids.length ? ids.map(nodeOf).filter(Boolean) : curPage().children;
  const v = view();
  if (!list.length) { v.x = 200; v.y = 120; v.zoom = 1; applyView(); renderOverlay(); return; }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of list) {
    const r = absRect(n.id);
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  const vr = viewportEl.getBoundingClientRect();
  const z = Math.min(4, Math.max(0.05, Math.min(vr.width / (x2 - x1 + 120), vr.height / (y2 - y1 + 120))));
  v.zoom = z;
  v.x = (vr.width - (x2 - x1) * z) / 2 - x1 * z;
  v.y = (vr.height - (y2 - y1) * z) / 2 - y1 * z;
  applyView(); renderOverlay();
}

// ─── node elements ───────────────────────────────────────────────
// createEl / applyStyle / fillInstance / buildStatic live in static.js (shared with the mind map).
function syncList(parentEl, nodes) {
  nodes.forEach((n, i) => {
    let el = elMap.get(n.id);
    if (!el || el._type !== n.type) {
      if (el) el.remove();
      el = createEl(n);
      el.dataset.id = n.id;
      elMap.set(n.id, el);
    }
    applyStyle(el, n);
    if (n.type === 'instance') fillInstance(el, n, 0);
    else if (n.children) syncList(el, n.children);
    if (parentEl.children[i] !== el) parentEl.insertBefore(el, parentEl.children[i] || null);
  });
}

function measureTexts(page) {
  let changed = false;
  eachNode(page.children, n => {
    if (n.type !== 'text' || n.autoH === false || n.visible === false) return;
    const el = elMap.get(n.id);
    const h = el && el.offsetHeight;
    if (h && h !== n.h) { n.h = h; changed = true; }
  });
  return changed;
}

function renderCanvas(again = true) {
  const page = curPage();
  const live = new Set();
  eachNode(page.children, n => live.add(n.id));
  for (const [id, el] of elMap) if (!live.has(id)) { el.remove(); elMap.delete(id); }
  syncList(worldEl, page.children);
  viewportEl.style.backgroundColor = page.bg || '#2c2c2c';
  $('d-empty-hint').hidden = page.children.length > 0;
  if (measureTexts(page) && again) { reindex(); renderCanvas(false); }
}

// ─── overlay (selection, handles, labels) ────────────────────────
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function selBounds(ids) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const id of ids) {
    const r = absRect(id);
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  return ids.length ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

const LABEL_TYPES = ['frame', 'rect', 'ellipse', 'image', 'instance'];
const isCompNode = n => !!(n.isComponent || n.type === 'instance');

// Nodes whose prototype links are drawn: the selection, the hovered layer, or every link in the Prototype tab.
function linkSources() {
  const out = new Map();
  const add = n => { if (n.link && n.visible !== false) out.set(n.id, n); };
  if (rightTab() === 'prototype') eachNode(curPage().children, add);
  else {
    for (const id of D.sel) { const n = nodeOf(id); if (n) eachNode([n], add); }
    if (D.hover && byId.has(D.hover)) eachNode([nodeOf(D.hover)], add);
  }
  return [...out.values()];
}

// Curve from the edge of rect `a` to the facing edge of rect `b` (screen coordinates).
function linkCurve(a, b) {
  let p1, p2, c1, c2;
  const k = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 3);
  if (b.y >= a.y + a.h && b.x < a.x + a.w && b.x + b.w > a.x) {
    p1 = [a.x + a.w / 2, a.y + a.h]; p2 = [b.x + b.w / 2, b.y];
    c1 = [p1[0], p1[1] + k]; c2 = [p2[0], p2[1] - k];
  } else if (b.y + b.h <= a.y && b.x < a.x + a.w && b.x + b.w > a.x) {
    p1 = [a.x + a.w / 2, a.y]; p2 = [b.x + b.w / 2, b.y + b.h];
    c1 = [p1[0], p1[1] - k]; c2 = [p2[0], p2[1] + k];
  } else if (b.x + b.w <= a.x) {
    p1 = [a.x, a.y + a.h / 2]; p2 = [b.x + b.w, b.y + b.h / 2];
    c1 = [p1[0] - k, p1[1]]; c2 = [p2[0] + k, p2[1]];
  } else {
    p1 = [a.x + a.w, a.y + a.h / 2]; p2 = [b.x, b.y + b.h / 2];
    c1 = [p1[0] + k, p1[1]]; c2 = [p2[0] - k, p2[1]];
  }
  return { p1, p2, d: `M${p1} C${c1} ${c2} ${p2}`, mid: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2] };
}

// Figma-like prototype connections: arrows from an interactive layer to the screen it opens.
function linkOverlayHtml(v, z) {
  const toScreen = r => ({ x: r.x * z + v.x, y: r.y * z + v.y, w: r.w * z, h: r.h * z });
  let paths = '', extra = '';
  const targets = new Set();
  for (const n of linkSources()) {
    const src = toScreen(absRect(n.id));
    const badge = (text, x, y) => `<div class="ov-badge" style="left:${x}px;top:${y}px">${esc(text)}</div>`;
    if (n.link.type === 'back') { extra += badge('↩ Back', src.x + src.w + 4, src.y); continue; }
    const t = nodeOf(n.link.target);
    if (!t || isInside(n.id, t.id)) continue;
    const turn = n.link.turn ? (n.link.turn === 'ccw' ? ' ↺' : ' ↻') : '';
    if (byId.get(t.id).pageId !== D.pageId) {
      const page = D.doc.pages.find(p => p.id === byId.get(t.id).pageId);
      extra += badge(`→ ${page ? page.name + ' / ' : ''}${t.name}${turn}`, src.x + src.w + 4, src.y);
      continue;
    }
    const c = linkCurve(src, toScreen(absRect(t.id)));
    targets.add(t.id);
    paths += `<path class="ov-link-line" d="${c.d}" marker-end="url(#ov-arrow)"/><circle class="ov-link-dot" cx="${c.p1[0]}" cy="${c.p1[1]}" r="4"/>`;
    if (turn) extra += badge(turn.trim(), c.mid[0], c.mid[1]);
  }
  if (!paths && !extra) return '';
  let h = '';
  for (const id of targets) h += `<div class="ov link-target" style="left:${absRect(id).x * z + v.x}px;top:${absRect(id).y * z + v.y}px;width:${absRect(id).w * z}px;height:${absRect(id).h * z}px"></div>`;
  return h + `<svg class="ov-links"><defs><marker id="ov-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path class="ov-link-head" d="M0,0 L10,5 L0,10 z"/></marker></defs>${paths}</svg>${extra}`;
}

function renderOverlay() {
  const v = view(), z = v.zoom;
  const box = (r, cls) => `<div class="ov ${cls}" style="left:${r.x * z + v.x}px;top:${r.y * z + v.y}px;width:${r.w * z}px;height:${r.h * z}px"></div>`;
  let h = '';
  for (const n of curPage().children) {
    if (!LABEL_TYPES.includes(n.type) || n.visible === false) continue;
    const comp = isCompNode(n);
    const cls = (D.sel.includes(n.id) ? ' sel' : '') + (comp ? ' comp' : '');
    h += `<div class="ov-label${cls}" data-label="${n.id}" style="left:${n.x * z + v.x}px;top:${n.y * z + v.y - 20}px;max-width:${Math.max(80, n.w * z)}px">${comp ? '◆ ' : ''}${esc(n.name)}</div>`;
  }
  h += linkOverlayHtml(v, z);
  if (D.hover && !D.sel.includes(D.hover) && byId.has(D.hover)) h += box(absRect(D.hover), 'hover');
  if (D.dropTarget && byId.has(D.dropTarget)) h += box(absRect(D.dropTarget), 'drop');
  for (const id of D.sel) {
    if (!byId.has(id)) continue;
    const n = nodeOf(id);
    h += box(absRect(id), n.isComponent || n.type === 'instance' ? 'sel comp' : 'sel');
  }
  const roots = selRoots();
  if (roots.length && D.editing == null) {
    const b = selBounds(roots);
    if (roots.length > 1) h += box(b, 'sel-multi');
    const locked = roots.some(id => nodeOf(id).locked);
    if (!locked && !D.marquee) {
      const sx = b.x * z + v.x, sy = b.y * z + v.y, sw = b.w * z, sh = b.h * z;
      const pos = { nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5] };
      for (const k of HANDLES) {
        h += `<div class="ov-handle h-${k}" data-handle="${k}" style="left:${sx + sw * pos[k][0]}px;top:${sy + sh * pos[k][1]}px"></div>`;
      }
      h += `<div class="ov-size" style="left:${sx + sw / 2}px;top:${sy + sh + 14}px">${Math.round(b.w)} × ${Math.round(b.h)}</div>`;
    }
  }
  if (D.marquee) {
    const m = D.marquee;
    h += `<div class="ov marquee" style="left:${Math.min(m.x1, m.x2)}px;top:${Math.min(m.y1, m.y2)}px;width:${Math.abs(m.x2 - m.x1)}px;height:${Math.abs(m.y2 - m.y1)}px"></div>`;
  }
  overlayEl.innerHTML = h;
}

// Thumbnail of a node scaled to fit a square box (assets panel).
function buildThumb(n, size) {
  const wrap = document.createElement('div');
  wrap.className = 'thumb';
  wrap.style.cssText = `width:${size}px;height:${size}px;position:relative;overflow:hidden`;
  const k = Math.min(size / (n.w || 1), size / (n.h || 1), 1);
  const inner = buildStatic(n, { root: true });
  inner.style.transformOrigin = '0 0';
  inner.style.transform = `translate(${(size - n.w * k) / 2}px, ${(size - n.h * k) / 2}px) scale(${k})`;
  wrap.appendChild(inner);
  return wrap;
}

function refreshCanvas() { renderCanvas(); applyView(); renderOverlay(); }
