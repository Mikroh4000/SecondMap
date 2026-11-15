// Design rendering shared by the design editor and the mind map (embedded designs).
// Everything is resolved through a context ({ node(id), asset(id), editing?() }) so the same code
// works on the live editor document and on a design document that was only loaded from storage.

const FONTS = {
  sans: 'Inter, "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"IBM Plex Mono", Consolas, monospace',
  display: 'Syne, "Segoe UI", sans-serif',
};

const ICON_PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  heart: 'M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z',
  star: 'M12 3l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.5 6.1 20.8l1.3-6.5L2.5 9.8 9.1 9z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  plus: 'M12 4v16M4 12h16',
  check: 'M4 12l5 5L20 6',
  close: 'M5 5l14 14M19 5L5 19',
  arrow: 'M4 12h16M14 6l6 6-6 6',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 11a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
};

const BUILTIN_ASSETS = Object.entries(ICON_PATHS).map(([name, d]) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#333333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  return { id: 'icon-' + name, name, kind: 'icon', w: 24, h: 24, dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) };
});

function rgba(hex, alpha) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})` : hex;
}

// Context of the live editor document.
const editorCtx = { node: id => nodeOf(id), asset: id => getAsset(id), editing: () => D.editing };

// Context of a design document that is not open in the editor (used by the mind map).
function docCtx(doc) {
  const byNodeId = new Map();
  const walk = list => { for (const n of list) { byNodeId.set(n.id, n); if (n.children) walk(n.children); } };
  for (const p of doc.pages) walk(p.children);
  return {
    node: id => byNodeId.get(id) || null,
    asset: id => (doc.assets || []).find(a => a.id === id) || BUILTIN_ASSETS.find(a => a.id === id) || null,
  };
}

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
  const ctx = opt.ctx || editorCtx;
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
    const editing = ctx.editing ? ctx.editing() : null;
    if (editing !== n.id && el._text !== n.text) { el.textContent = n.text; el._text = n.text; }
  }
  if (t === 'image') {
    const a = ctx.asset(n.assetId), img = el.firstChild;
    const src = a ? a.dataUrl : '';
    if (img._src !== src) { img.src = src; img._src = src; }
    img.style.objectFit = n.fit || 'cover';
  }
}

function fillInstance(el, n, depth, ctx = editorCtx) {
  const m = ctx.node(n.componentId);
  if (!m || depth > 6) {
    if (el._sig !== 'missing') { el.textContent = 'Missing component'; el.className = 'dn dn-instance missing'; el._sig = 'missing'; el._inner = null; }
    return;
  }
  const sig = JSON.stringify([m, n.overrides || null]);
  if (el._sig !== sig) {
    el.textContent = '';
    el.className = 'dn dn-instance';
    el._inner = buildStatic(m, { root: true, overrides: n.overrides, depth: depth + 1, ctx });
    el.appendChild(el._inner);
    el._sig = sig;
  }
  el._inner.style.transformOrigin = '0 0';
  el._inner.style.transform = `scale(${n.w / (m.w || 1)}, ${n.h / (m.h || 1)})`;
}

// Stand-alone DOM for a node (instances, thumbnails, export, prototype playback, mind map embeds).
function buildStatic(n, opt = {}) {
  const depth = opt.depth || 0;
  if (opt.overrides && opt.overrides[n.id]) n = { ...n, ...opt.overrides[n.id] };
  const el = createEl(n);
  applyStyle(el, n, opt);
  if (n.type === 'text') { el.textContent = n.text; el._text = n.text; }
  if (opt.interactive) el.dataset.pid = n.id;
  if (n.type === 'instance') fillInstance(el, n, depth, opt.ctx);
  else if (n.children) {
    for (const c of n.children) el.appendChild(buildStatic(c, { ...opt, root: false, depth }));
  }
  return el;
}
