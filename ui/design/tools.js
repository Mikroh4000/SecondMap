// Design editor – canvas interaction: tools, selection, move/resize, text editing, keyboard.

let drag = null;
let spaceDown = false;

function isTyping(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

// Id of the deepest, unlocked layer under a DOM target (instance internals resolve to the instance).
function hitId(target) {
  let el = target.closest ? target.closest('[data-id]') : null;
  while (el) {
    const n = nodeOf(el.dataset.id);
    if (n && !n.locked && n.visible !== false) return n.id;
    el = el.parentElement ? el.parentElement.closest('[data-id]') : null;
  }
  return null;
}

// Figma-style selection depth: children of a top-level frame, or deeper inside entered containers.
function pickSelectable(id) {
  const chain = chainOf(id);
  let idx = chain[0].type === 'frame' ? 1 : 0;
  for (let i = chain.length - 1; i >= 0; i--) if (D.entered.has(chain[i].id)) { idx = i + 1; break; }
  return chain[Math.min(idx, chain.length - 1)].id;
}

function nearestFrame(id) {
  for (let n = nodeOf(id); n; n = parentOf(n.id)) if (n.type === 'frame') return n;
  return null;
}

// Topmost frame below the pointer that is not part of `exclude`.
function frameUnderPoint(x, y, exclude = []) {
  for (const el of document.elementsFromPoint(x, y)) {
    const id = el.dataset && el.dataset.id;
    const n = id && nodeOf(id);
    if (!n || n.visible === false || n.type !== 'frame') continue;
    if (exclude.some(ex => isInside(id, ex))) continue;
    return n;
  }
  return null;
}

function pointInView(e) {
  const r = viewportEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// ─── text editing ────────────────────────────────────────────────
function startTextEdit(id) {
  const n = nodeOf(id), el = elMap.get(id);
  if (!n || !el || n.type !== 'text') return;
  D.editing = id;
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.classList.add('editing');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const s = getSelection();
  s.removeAllRanges(); s.addRange(range);
  renderOverlay();
  const onInput = () => { n.text = el.innerText; refreshCanvas(); syncPropValues(); };
  const finish = () => {
    el.removeEventListener('input', onInput);
    el.removeEventListener('blur', finish);
    el.removeEventListener('keydown', onKey);
    el.contentEditable = 'false';
    el.classList.remove('editing');
    D.editing = null;
    n.text = el.innerText.replace(/\n$/, '');
    el._text = null;
    if (!n.text.trim()) { const list = siblingsOf(id); if (list) list.splice(list.indexOf(n), 1); D.sel = D.sel.filter(x => x !== id); }
    afterChange();
  };
  const onKey = e => { e.stopPropagation(); if (e.key === 'Escape') el.blur(); };
  el.addEventListener('input', onInput);
  el.addEventListener('blur', finish);
  el.addEventListener('keydown', onKey);
}

// ─── pointer handling ────────────────────────────────────────────
function startPan(e) {
  const v = view();
  drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
  viewportEl.classList.add('panning');
}

viewportEl.addEventListener('pointerdown', e => {
  if (D.editing) {
    if (elMap.get(D.editing)?.contains(e.target)) return;
    document.activeElement.blur();
  }
  if (e.button === 1 || (e.button === 0 && (spaceDown || D.tool === 'hand'))) {
    e.preventDefault();
    viewportEl.setPointerCapture(e.pointerId);
    startPan(e);
    return;
  }
  if (e.button !== 0) return;
  viewportEl.setPointerCapture(e.pointerId);

  if (['frame', 'rect', 'ellipse', 'text'].includes(D.tool)) {
    const hit = hitId(e.target);
    const parent = hit ? nearestFrame(hit) : null;
    drag = { kind: 'draw', type: D.tool, start: screenToWorld(e.clientX, e.clientY), sx: e.clientX, sy: e.clientY, parent, node: null };
    return;
  }

  const handle = e.target.dataset && e.target.dataset.handle;
  if (handle) { startResize(e, handle); return; }

  const label = e.target.closest('[data-label]');
  let id = label ? label.dataset.label : null;
  if (!id) {
    const hit = hitId(e.target);
    if (hit) id = pickSelectable(hit);
  }
  if (id) {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let reduceTo = null;
    if (additive) setSelection(D.sel.includes(id) ? D.sel.filter(x => x !== id) : [...D.sel, id], { keepEntered: true });
    else if (!D.sel.includes(id)) setSelection([id], { keepEntered: true });
    else if (D.sel.length > 1) reduceTo = id;
    startMove(e, reduceTo);
  } else {
    if (!e.shiftKey) setSelection([]);
    drag = { kind: 'marquee', sx: e.clientX, sy: e.clientY, base: e.shiftKey ? D.sel.slice() : [] };
  }
});

function startMove(e, reduceTo) {
  const roots = unlockedRoots();
  if (!roots.length) { drag = null; return; }
  drag = {
    kind: 'move', sx: e.clientX, sy: e.clientY, moved: false, reduceTo,
    items: roots.map(id => { const a = absPos(id); return { id, ax: a.x, ay: a.y }; }),
  };
}

function snapshotGeo(n) {
  return { x: n.x, y: n.y, w: n.w, h: n.h, children: n.children ? n.children.map(snapshotGeo) : null };
}
function restoreGeo(n, o) {
  n.x = o.x; n.y = o.y; n.w = o.w; n.h = o.h;
  if (n.children && o.children) n.children.forEach((c, i) => restoreGeo(c, o.children[i]));
}

function startResize(e, handle) {
  const roots = unlockedRoots();
  if (!roots.length) return;
  drag = {
    kind: 'resize', handle, sx: e.clientX, sy: e.clientY, bbox: selBounds(roots),
    items: roots.map(id => ({ id, abs: absRect(id), geo: snapshotGeo(nodeOf(id)) })),
  };
}

function applyResize(e) {
  const v = view(), B = drag.bbox, hk = drag.handle;
  const dx = (e.clientX - drag.sx) / v.zoom, dy = (e.clientY - drag.sy) / v.zoom;
  let x = B.x, y = B.y, w = B.w, h = B.h;
  if (hk.includes('e')) w = B.w + dx;
  if (hk.includes('w')) { x = B.x + dx; w = B.w - dx; }
  if (hk.includes('s')) h = B.h + dy;
  if (hk.includes('n')) { y = B.y + dy; h = B.h - dy; }
  if (e.shiftKey && hk.length === 2 && B.w && B.h) {
    const k = Math.max(Math.abs(w / B.w), Math.abs(h / B.h));
    w = B.w * k * Math.sign(w || 1); h = B.h * k * Math.sign(h || 1);
    if (hk.includes('w')) x = B.x + B.w - w;
    if (hk.includes('n')) y = B.y + B.h - h;
  }
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  w = Math.max(1, w); h = Math.max(1, h);
  const sx = w / B.w, sy = h / B.h;
  for (const it of drag.items) {
    const n = nodeOf(it.id);
    if (!n) continue;
    restoreGeo(n, it.geo);
    const p = parentOf(it.id), pa = p ? absPos(p.id) : { x: 0, y: 0 };
    const nw = Math.max(1, Math.round(it.abs.w * sx)), nh = Math.max(1, Math.round(it.abs.h * sy));
    if (n.type === 'group') scaleDescendants(n, nw / n.w, nh / n.h);
    n.x = Math.round(x + (it.abs.x - B.x) * sx - pa.x);
    n.y = Math.round(y + (it.abs.y - B.y) * sy - pa.y);
    n.w = nw;
    if (n.type === 'text') { if (sy !== 1) { n.h = nh; n.autoH = false; } } else n.h = nh;
  }
}

function applyMove(e) {
  const v = view();
  let dx = (e.clientX - drag.sx) / v.zoom, dy = (e.clientY - drag.sy) / v.zoom;
  if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
  for (const it of drag.items) {
    const n = nodeOf(it.id);
    if (!n) continue;
    const p = parentOf(it.id), pa = p ? absPos(p.id) : { x: 0, y: 0 };
    n.x = Math.round(it.ax + dx - pa.x);
    n.y = Math.round(it.ay + dy - pa.y);
  }
  // top-level frames are screens: they never get nested by dragging
  const eligible = drag.items.filter(it => !(nodeOf(it.id).type === 'frame' && !parentOf(it.id)));
  drag.eligible = eligible;
  const target = eligible.length ? frameUnderPoint(e.clientX, e.clientY, eligible.map(it => it.id)) : null;
  drag.target = target;
  const unchanged = eligible.every(it => (nearestFrame(parentOf(it.id)?.id)?.id || null) === (target?.id || null));
  D.dropTarget = eligible.length && !unchanged && target ? target.id : null;
}

function drawMove(e) {
  if (!drag.node) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    const n = newNode(drag.type);
    if (drag.type === 'text') n.autoH = true;
    listFor(drag.parent).push(n);
    reindex();
    drag.node = n;
    D.sel = [n.id];
  }
  const n = drag.node, cur = screenToWorld(e.clientX, e.clientY);
  let w = Math.abs(cur.x - drag.start.x), h = Math.abs(cur.y - drag.start.y);
  if (e.shiftKey && drag.type !== 'text') w = h = Math.max(w, h);
  const x = cur.x < drag.start.x ? drag.start.x - w : drag.start.x;
  const y = cur.y < drag.start.y ? drag.start.y - h : drag.start.y;
  const pa = drag.parent ? absPos(drag.parent.id) : { x: 0, y: 0 };
  n.x = Math.round(x - pa.x); n.y = Math.round(y - pa.y);
  n.w = Math.max(1, Math.round(w));
  if (drag.type === 'text') n.autoH = true; else n.h = Math.max(1, Math.round(h));
}

function marqueeSelect(rect) {
  const out = [];
  const hit = r => r.x < rect.x + rect.w && r.x + r.w > rect.x && r.y < rect.y + rect.h && r.y + r.h > rect.y;
  const inside = r => r.x >= rect.x && r.y >= rect.y && r.x + r.w <= rect.x + rect.w && r.y + r.h <= rect.y + rect.h;
  (function walk(list) {
    for (const n of list) {
      if (n.visible === false || n.locked) continue;
      const r = absRect(n.id);
      if (!hit(r)) continue;
      if (n.type === 'frame') { if (inside(r)) out.push(n.id); else walk(n.children); }
      else out.push(n.id);
    }
  })(curPage().children);
  return out;
}

let moveRaf = 0;
viewportEl.addEventListener('pointermove', e => {
  if (!drag) {
    if (D.tool === 'move' && !e.buttons) {
      const hit = hitId(e.target);
      const id = hit ? pickSelectable(hit) : null;
      if (id !== D.hover) { D.hover = id; renderOverlay(); }
    }
    return;
  }
  if (drag.kind === 'pan') {
    const v = view();
    v.x = drag.vx + e.clientX - drag.sx; v.y = drag.vy + e.clientY - drag.sy;
    applyView(); renderOverlay();
    return;
  }
  if (drag.kind === 'move') {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
    drag.moved = true;
    D.hover = null;
    applyMove(e);
  } else if (drag.kind === 'resize') applyResize(e);
  else if (drag.kind === 'draw') drawMove(e);
  else if (drag.kind === 'marquee') {
    const a = pointInView({ clientX: drag.sx, clientY: drag.sy }), b = pointInView(e);
    D.marquee = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    const w1 = screenToWorld(drag.sx, drag.sy), w2 = screenToWorld(e.clientX, e.clientY);
    const rect = { x: Math.min(w1.x, w2.x), y: Math.min(w1.y, w2.y), w: Math.abs(w2.x - w1.x), h: Math.abs(w2.y - w1.y) };
    D.sel = [...new Set([...drag.base, ...marqueeSelect(rect)])];
  }
  cancelAnimationFrame(moveRaf);
  moveRaf = requestAnimationFrame(() => { refreshCanvas(); syncPropValues(); });
});

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  viewportEl.classList.remove('panning');
  cancelAnimationFrame(moveRaf);
  if (d.kind === 'pan') return;

  if (d.kind === 'marquee') {
    D.marquee = null;
    setSelection(D.sel);
    renderOverlay();
    return;
  }
  if (d.kind === 'draw') {
    let n = d.node;
    if (!n) {
      n = newNode(d.type);
      const pa = d.parent ? absPos(d.parent.id) : { x: 0, y: 0 };
      n.x = Math.round(d.start.x - pa.x); n.y = Math.round(d.start.y - pa.y);
      listFor(d.parent).push(n);
    }
    if (d.type === 'text') { n.w = Math.max(n.w, 20); n.autoH = true; }
    setTool('move');
    commit(); reindex(); setSelection([n.id]); renderAll();
    if (d.type === 'text') startTextEdit(n.id);
    return;
  }
  if (d.kind === 'move') {
    D.dropTarget = null;
    if (!d.moved) {
      if (d.reduceTo) setSelection([d.reduceTo], { keepEntered: true });
      renderOverlay();
      return;
    }
    for (const it of d.eligible || []) {
      const cur = nearestFrame(parentOf(it.id)?.id) || null;
      if ((d.target?.id || null) !== (cur?.id || null)) moveNodeTo(it.id, d.target || null, null);
    }
  }
  commit(); reindex(); renderAll();
}
viewportEl.addEventListener('pointerup', endDrag);
viewportEl.addEventListener('pointercancel', endDrag);
viewportEl.addEventListener('pointerleave', () => { if (D.hover && !drag) { D.hover = null; renderOverlay(); } });

viewportEl.addEventListener('dblclick', e => {
  if (D.tool !== 'move') return;
  const hit = hitId(e.target);
  if (!hit) return;
  const chain = chainOf(hit), cur = pickSelectable(hit);
  const i = chain.findIndex(n => n.id === cur);
  const n = chain[i];
  if (n.type === 'text') { setSelection([n.id], { keepEntered: true }); startTextEdit(n.id); }
  else if (n.children && chain[i + 1]) {
    D.entered.add(n.id);
    setSelection([chain[i + 1].id], { keepEntered: true });
  }
});

viewportEl.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  else {
    const v = view();
    v.x -= e.shiftKey ? e.deltaY : e.deltaX;
    v.y -= e.shiftKey ? 0 : e.deltaY;
    applyView(); renderOverlay();
  }
}, { passive: false });

// Drop images / library assets onto the canvas.
viewportEl.addEventListener('dragover', e => {
  const types = e.dataTransfer.types;
  if (types.includes('Files') || types.includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
});
viewportEl.addEventListener('drop', async e => {
  e.preventDefault();
  const w = screenToWorld(e.clientX, e.clientY);
  const parent = frameUnderPoint(e.clientX, e.clientY);
  const pa = parent ? absPos(parent.id) : { x: 0, y: 0 };
  const at = { parent, x: Math.round(w.x - pa.x), y: Math.round(w.y - pa.y) };
  if (e.dataTransfer.files && e.dataTransfer.files.length) { await importImages([...e.dataTransfer.files], at); return; }
  const m = /^asset:(component|image|icon):(.+)$/.exec(e.dataTransfer.getData('text/plain'));
  if (!m) return;
  let n;
  if (m[1] === 'component') {
    const src = nodeOf(m[2]);
    if (!src) return;
    n = createInstance(m[2], { parent, x: at.x - src.w / 2, y: at.y - src.h / 2 });
  } else {
    const { w: iw, h: ih } = imageSize(getAsset(m[2]));
    n = addImageNode(m[2], { parent, x: at.x - iw / 2, y: at.y - ih / 2 });
  }
  if (!n) return;
  commit(); reindex(); setSelection([n.id]); renderAll();
});

// ─── keyboard ────────────────────────────────────────────────────
function doUndo() { if (undo()) { renderAll(); } }
function doRedo() { if (redo()) { renderAll(); } }

const TOOL_KEYS = { KeyV: 'move', KeyF: 'frame', KeyR: 'rect', KeyO: 'ellipse', KeyT: 'text', KeyH: 'hand' };

document.addEventListener('keydown', e => {
  if (isTyping(e.target) || !$('d-present-overlay').hidden) return;
  const ctrl = e.ctrlKey || e.metaKey, c = e.code;

  if (c === 'Space') { spaceDown = true; viewportEl.classList.add('space'); e.preventDefault(); return; }

  if (ctrl) {
    if (c === 'KeyZ') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (c === 'KeyY') { e.preventDefault(); doRedo(); return; }
    if (c === 'KeyD') { e.preventDefault(); duplicateSelection(); return; }
    if (c === 'KeyC') { e.preventDefault(); copySelection(false); return; }
    if (c === 'KeyX') { e.preventDefault(); copySelection(true); return; }
    if (c === 'KeyV') { e.preventDefault(); pasteClipboard(); return; }
    if (c === 'KeyA') { e.preventDefault(); selectAll(); return; }
    if (c === 'KeyG') { e.preventDefault(); e.shiftKey ? ungroupSelection() : groupSelection(); return; }
    if (c === 'KeyK' && e.altKey) { e.preventDefault(); createComponent(); return; }
    if (c === 'KeyB' && e.altKey) { e.preventDefault(); detachSelection(); return; }
    if (c === 'Enter') { e.preventDefault(); startPresent(); return; }
    if (c === 'KeyH' && e.shiftKey) { e.preventDefault(); toggleFlag('visible'); return; }
    if (c === 'KeyL' && e.shiftKey) { e.preventDefault(); toggleFlag('locked'); return; }
    if (c === 'BracketRight') { e.preventDefault(); reorderSelection(e.shiftKey ? 'front' : 'forward'); return; }
    if (c === 'BracketLeft') { e.preventDefault(); reorderSelection(e.shiftKey ? 'back' : 'backward'); return; }
    if (c === 'Equal' || c === 'NumpadAdd') { e.preventDefault(); zoomCenter(1.25); return; }
    if (c === 'Minus' || c === 'NumpadSubtract') { e.preventDefault(); zoomCenter(0.8); return; }
    return;
  }

  if (e.shiftKey && c === 'Digit1') { e.preventDefault(); fitView(); return; }
  if (e.shiftKey && c === 'Digit2') { e.preventDefault(); fitView(selRoots()); return; }
  if (e.shiftKey && c === 'Digit0') { e.preventDefault(); zoomCenter(1 / view().zoom); return; }
  if (!e.altKey && TOOL_KEYS[c] && !e.shiftKey) { setTool(TOOL_KEYS[c]); return; }
  if (c === 'Equal' || c === 'NumpadAdd') { zoomCenter(1.25); return; }
  if (c === 'Minus' || c === 'NumpadSubtract') { zoomCenter(0.8); return; }

  if (c === 'Delete' || c === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (c === 'Escape') { if (D.tool !== 'move') setTool('move'); else { D.entered = new Set(); setSelection([]); } return; }
  if (c === 'Enter') {
    const ids = selRoots();
    if (ids.length !== 1) return;
    const n = nodeOf(ids[0]);
    e.preventDefault();
    if (n.type === 'text') startTextEdit(n.id);
    else if (n.children && n.children.length) { D.entered.add(n.id); setSelection(n.children.map(x => x.id), { keepEntered: true }); }
    return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[c]) {
    e.preventDefault();
    const k = e.shiftKey ? 10 : 1;
    nudgeSelection(arrows[c][0] * k, arrows[c][1] * k);
  }
});

document.addEventListener('keyup', e => {
  if (e.code === 'Space') { spaceDown = false; viewportEl.classList.remove('space'); }
});

function zoomCenter(f) {
  const r = viewportEl.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
}

// ─── toolbar ─────────────────────────────────────────────────────
document.querySelectorAll('.d-tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('d-undo').addEventListener('click', doUndo);
$('d-redo').addEventListener('click', doRedo);
$('d-group').addEventListener('click', groupSelection);
$('d-component').addEventListener('click', createComponent);
$('d-zoom-in').addEventListener('click', () => zoomCenter(1.25));
$('d-zoom-out').addEventListener('click', () => zoomCenter(0.8));
$('d-zoom-label').addEventListener('click', () => fitView());

$('d-file-btn').addEventListener('click', e => { e.stopPropagation(); $('d-file-menu').classList.toggle('open'); });
document.addEventListener('click', () => $('d-file-menu').classList.remove('open'));
$('d-export-json').addEventListener('click', exportDesignJson);
$('d-import-json').addEventListener('click', () => $('d-file-json').click());
$('d-export-png').addEventListener('click', exportPng);
$('d-new-doc').addEventListener('click', newDesign);
$('d-file-json').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) await importDesignJson(f);
});

window.addEventListener('resize', () => { if (D.doc) renderOverlay(); });
