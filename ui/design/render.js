// Design editor – canvas rendering (DOM nodes, selection overlay, viewport transform).

const viewportEl = $('d-viewport');
const worldEl = $('d-world');
const overlayEl = $('d-overlay');
const elMap = new Map(); // node id -> live element

const FONTS = {
  sans: 'Inter, "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"IBM Plex Mono", Consolas, monospace',
  display: 'Syne, "Segoe UI", sans-serif',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rgba(hex, alpha) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})` : hex;
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
function createEl(n) {
  const el = document.createElement('div');
  el.className = 'dn dn-' + n.type;
  el._type = n.type;
  if (n.type === 'image') {
    const img = document.createElement('img');
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none';
    el.appendChild(img);
  }
  return el;
}

function applyStyle(el, n, opt = {}) {
  const s = el.style, t = n.type;
  s.position = 'absolute'; s.boxSizing = 'border-box'; s.margin = '0';
  s.left = opt.root ? '0px' : n.x + 'px';
  s.top = opt.root ? '0px' : n.y + 'px';
  s.width = n.w + 'px';
  s.height = (t === 'text' && n.autoH !== false) ? 'auto' : n.h + 'px';
  s.opacity = n.opacity === 1 ? '' : n.opacity;
  s.display = (n.visible === false && !opt.root) ? 'none' : '';
  s.pointerEvents = t === 'group' ? 'none' : 'auto';
  const shadow = n.shadow ? `${n.shadow.x}px ${n.shadow.y}px ${n.shadow.blur}px ${rgba(n.shadow.color, n.shadow.alpha ?? 1)}` : '';
  if (t === 'frame' || t === 'rect' || t === 'ellipse' || t === 'image') {
    s.background = n.fill && t !== 'image' ? n.fill : 'transparent';
    // outline keeps the stroke inside the box without shifting child coordinates
    s.outline = n.stroke ? `${n.strokeWidth}px solid ${n.stroke}` : 'none';
    s.outlineOffset = n.stroke ? `-${n.strokeWidth}px` : '0';
    s.borderRadius = t === 'ellipse' ? '50%' : (n.radius || 0) + 'px';
    s.boxShadow = shadow;
    s.overflow = (t === 'frame' && n.clip !== false) || t === 'image' ? 'hidden' : 'visible';
  }
  if (t === 'text') {
    s.color = n.fill || '#111';
    s.fontSize = n.fontSize + 'px';
    s.fontWeight = n.fontWeight;
    s.fontFamily = FONTS[n.font] || FONTS.sans;
    s.textAlign = n.align;
    s.whiteSpace = 'pre-wrap'; s.wordBreak = 'break-word'; s.lineHeight = '1.25';
    s.textShadow = n.shadow ? shadow : '';
    if (D.editing !== n.id && el._text !== n.text) { el.textContent = n.text; el._text = n.text; }
  }
  if (t === 'image') {
    const a = getAsset(n.assetId), img = el.firstChild;
    const src = a ? a.dataUrl : '';
    if (img._src !== src) { img.src = src; img._src = src; }
    img.style.objectFit = n.fit || 'cover';
  }
}

function fillInstance(el, n, depth) {
  const m = nodeOf(n.componentId);
  if (!m || depth > 6) {
    if (el._sig !== 'missing') { el.textContent = 'Missing component'; el.className = 'dn dn-instance missing'; el._sig = 'missing'; el._inner = null; }
    return;
  }
  const sig = JSON.stringify([m, n.overrides || null]);
  if (el._sig !== sig) {
    el.textContent = '';
    el.className = 'dn dn-instance';
    el._inner = buildStatic(m, { root: true, overrides: n.overrides, depth: depth + 1 });
    el.appendChild(el._inner);
    el._sig = sig;
  }
  el._inner.style.transformOrigin = '0 0';
  el._inner.style.transform = `scale(${n.w / (m.w || 1)}, ${n.h / (m.h || 1)})`;
}

// Stand-alone DOM for a node (instances, thumbnails, export, prototype playback).
function buildStatic(n, opt = {}) {
  const depth = opt.depth || 0;
  if (opt.overrides && opt.overrides[n.id]) n = { ...n, ...opt.overrides[n.id] };
  const el = createEl(n);
  applyStyle(el, n, opt);
  if (n.type === 'text') { el.textContent = n.text; el._text = n.text; }
  if (opt.interactive) el.dataset.pid = n.id;
  if (n.type === 'instance') fillInstance(el, n, depth);
  else if (n.children) {
    for (const c of n.children) el.appendChild(buildStatic(c, { ...opt, root: false, depth }));
  }
  return el;
}

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

function renderOverlay() {
  const v = view(), z = v.zoom;
  const box = (r, cls) => `<div class="ov ${cls}" style="left:${r.x * z + v.x}px;top:${r.y * z + v.y}px;width:${r.w * z}px;height:${r.h * z}px"></div>`;
  let h = '';
  for (const n of curPage().children) {
    if (n.type !== 'frame' || n.visible === false) continue;
    const cls = D.sel.includes(n.id) ? ' sel' : '';
    h += `<div class="ov-label${cls}" data-label="${n.id}" style="left:${n.x * z + v.x}px;top:${n.y * z + v.y - 20}px;max-width:${Math.max(40, n.w * z)}px">${n.isComponent ? '◆ ' : ''}${esc(n.name)}</div>`;
  }
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
