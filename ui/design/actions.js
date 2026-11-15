// Design editor – commands that change the document (selection, grouping, components, assets, pages, files).

function renderAll() {
  refreshCanvas();
  renderDesignsList();
  renderPages();
  renderLayers();
  if (leftTab() === 'assets') renderAssets();
  renderProps();
  renderProto();
  updateToolbar();
}

function afterChange() { commit(); renderAll(); }

function setSelection(ids, opts = {}) {
  D.sel = ids.filter(id => byId.has(id));
  if (!opts.keepEntered) {
    D.entered = new Set();
    for (const id of D.sel) for (let p = parentOf(id); p; p = parentOf(p.id)) D.entered.add(p.id);
  }
  renderOverlay();
  renderLayers();
  renderProps();
  renderProto();
  updateToolbar();
}

function setTool(t) {
  D.tool = t;
  document.querySelectorAll('.d-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  viewportEl.dataset.tool = t;
}

function unlockedRoots() { return selRoots().filter(id => !nodeOf(id).locked); }

function viewCenterLocal(parent) {
  const v = viewportEl.getBoundingClientRect();
  const c = screenToWorld(v.left + v.width / 2, v.top + v.height / 2);
  const pa = parent ? absPos(parent.id) : { x: 0, y: 0 };
  return { x: c.x - pa.x, y: c.y - pa.y };
}

// ─── instances / components ──────────────────────────────────────
function detachInstance(inst) {
  const m = nodeOf(inst.componentId);
  const list = siblingsOf(inst.id);
  if (!m || !list) return null;
  const c = cloneNode(m, { overrides: inst.overrides });
  scaleDescendants(c, inst.w / (m.w || 1), inst.h / (m.h || 1));
  Object.assign(c, {
    x: inst.x, y: inst.y, w: inst.w, h: inst.h, name: inst.name,
    opacity: m.opacity * inst.opacity, visible: inst.visible, locked: inst.locked, link: inst.link,
  });
  if (inst.overrides && inst.overrides[m.id]) Object.assign(c, inst.overrides[m.id]);
  list[list.indexOf(inst)] = c;
  return c;
}

function createComponent() {
  const ids = unlockedRoots().filter(id => nodeOf(id).type !== 'instance' && !nodeOf(id).isComponent);
  if (!ids.length) { showToast('Select a frame, group or shape that is not already a component'); return; }
  for (const id of ids) nodeOf(id).isComponent = true;
  afterChange();
  showToast(ids.length > 1 ? `${ids.length} components created` : 'Component created', 'ok');
}

// x / y are local to `parent`; they default to the centre of the visible canvas.
function createInstance(masterId, opts = {}) {
  const m = nodeOf(masterId);
  if (!m) return null;
  const parent = opts.parent || null;
  if (parent && (parent.id === masterId || isInside(parent.id, masterId))) { showToast("A component can't contain its own instance"); return null; }
  const c = viewCenterLocal(parent);
  const inst = newNode('instance', {
    componentId: masterId, name: m.name, w: m.w, h: m.h,
    x: Math.round(opts.x ?? c.x - m.w / 2), y: Math.round(opts.y ?? c.y - m.h / 2),
  });
  listFor(parent).push(inst);
  return inst;
}

function instanceFromSelection() {
  const [id] = selRoots();
  const m = id && nodeOf(id);
  if (!m || !m.isComponent) return;
  const inst = createInstance(id, { parent: parentOf(id), x: m.x + m.w + 40, y: m.y });
  if (!inst) return;
  commit(); reindex(); setSelection([inst.id]); renderAll();
}

// A plain, independent copy of a group (unlike components/instances, groups have no master/instance
// link, so reusing one from the Assets tab just clones it). x / y are local to `parent`, defaulting to
// the centre of the visible canvas.
function groupCopyAt(groupId, opts = {}) {
  const g = nodeOf(groupId);
  if (!g || g.type !== 'group') return null;
  const parent = opts.parent || null;
  if (parent && (parent.id === groupId || isInside(parent.id, groupId))) { showToast("A group can't contain its own copy"); return null; }
  const c = viewCenterLocal(parent);
  const copy = cloneNode(g, { keepComponent: true });
  copy.x = Math.round(opts.x ?? c.x - g.w / 2);
  copy.y = Math.round(opts.y ?? c.y - g.h / 2);
  listFor(parent).push(copy);
  return copy;
}

function detachSelection() {
  const ids = selRoots().filter(id => nodeOf(id).type === 'instance');
  if (!ids.length) { showToast('Select an instance to detach'); return; }
  const out = [];
  for (const id of ids) { const c = detachInstance(nodeOf(id)); if (c) out.push(c.id); reindex(); }
  commit(); reindex(); setSelection(out); renderAll();
  showToast('Instance detached', 'ok');
}

function goToMain(instId) {
  const inst = nodeOf(instId);
  const e = inst && byId.get(inst.componentId);
  if (!e) { showToast('Main component not found'); return; }
  if (e.pageId !== D.pageId) switchPage(e.pageId);
  setSelection([e.node.id]);
  fitView([e.node.id]);
}

function setOverride(instId, nodeId, key, value) {
  const inst = nodeOf(instId);
  if (!inst) return;
  inst.overrides = inst.overrides || {};
  inst.overrides[nodeId] = { ...(inst.overrides[nodeId] || {}), [key]: value };
}

function resetOverrides(instId) {
  const inst = nodeOf(instId);
  if (inst) { inst.overrides = null; afterChange(); }
}

// ─── structure ───────────────────────────────────────────────────
// Instances of a removed main component stay behind as plain copies.
function detachInstancesOfMasters(doomedIds, mastersIds) {
  if (!mastersIds.size) return;
  const insts = [];
  eachNodeAllPages(n => { if (n.type === 'instance' && mastersIds.has(n.componentId) && !doomedIds.has(n.id)) insts.push(n); });
  for (const i of insts) { detachInstance(i); reindex(); }
}

function removeNodes(ids) {
  const masters = new Set(), doomed = new Set();
  for (const id of ids) eachNode([nodeOf(id)], n => { doomed.add(n.id); if (n.isComponent) masters.add(n.id); });
  detachInstancesOfMasters(doomed, masters);
  for (const id of ids) {
    const list = siblingsOf(id);
    if (list) list.splice(list.indexOf(nodeOf(id)), 1);
  }
}

function deleteSelection() {
  const ids = unlockedRoots();
  if (!ids.length) return;
  removeNodes(ids);
  D.sel = [];
  afterChange();
}

function moveNodeTo(id, parent, index) {
  const n = nodeOf(id);
  if (!n || (parent && (parent.id === id || isInside(parent.id, id) || !parent.children))) return false;
  const abs = absPos(id);
  const pa = parent ? absPos(parent.id) : { x: 0, y: 0 };
  const from = siblingsOf(id), to = listFor(parent);
  const oldIdx = from.indexOf(n);
  from.splice(oldIdx, 1);
  let at = index == null ? to.length : index;
  if (from === to && at > oldIdx) at--;
  to.splice(Math.max(0, Math.min(at, to.length)), 0, n);
  n.x = abs.x - pa.x; n.y = abs.y - pa.y;
  return true;
}

function duplicateSelection() {
  const ids = unlockedRoots();
  if (!ids.length) return;
  const out = [];
  for (const id of ids) {
    const list = siblingsOf(id);
    const c = cloneNode(nodeOf(id), { keepComponent: true });
    c.x += 20; c.y += 20;
    list.splice(list.indexOf(nodeOf(id)) + 1, 0, c);
    out.push(c.id);
  }
  commit(); reindex(); setSelection(out); renderAll();
}

function copySelection(cut) {
  const ids = unlockedRoots();
  if (!ids.length) return;
  D.clipboard = { nodes: ids.map(id => JSON.parse(JSON.stringify(nodeOf(id)))), parentId: parentOf(ids[0])?.id || null, bumps: 0 };
  if (cut) { removeNodes(ids); D.sel = []; afterChange(); }
  else showToast('Copied');
}

function pasteClipboard() {
  const cb = D.clipboard;
  if (!cb) return;
  cb.bumps++;
  const target = cb.parentId && byId.get(cb.parentId)?.pageId === D.pageId ? nodeOf(cb.parentId) : null;
  const out = [];
  for (const src of cb.nodes) {
    const c = cloneNode(src, { keepComponent: true });
    c.x += 20 * cb.bumps; c.y += 20 * cb.bumps;
    listFor(target).push(c);
    out.push(c.id);
  }
  commit(); reindex(); setSelection(out); renderAll();
}

// Like pasteClipboard(), but centers the pasted nodes on a screen point (the right-click context menu's
// "Paste" item) instead of stepping diagonally away from where they were copied.
function pasteClipboardAt(clientX, clientY) {
  const cb = D.clipboard;
  if (!cb) return;
  const target = cb.parentId && byId.get(cb.parentId)?.pageId === D.pageId ? nodeOf(cb.parentId) : frameUnderPoint(clientX, clientY);
  const pa = target ? absPos(target.id) : { x: 0, y: 0 };
  const world = screenToWorld(clientX, clientY);
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const src of cb.nodes) { x1 = Math.min(x1, src.x); y1 = Math.min(y1, src.y); x2 = Math.max(x2, src.x + src.w); y2 = Math.max(y2, src.y + src.h); }
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const out = [];
  for (const src of cb.nodes) {
    const c = cloneNode(src, { keepComponent: true });
    c.x = Math.round(world.x - pa.x + (src.x - cx));
    c.y = Math.round(world.y - pa.y + (src.y - cy));
    listFor(target).push(c);
    out.push(c.id);
  }
  commit(); reindex(); setSelection(out); renderAll();
}

function selectAll() {
  const first = selRoots()[0];
  const list = first ? siblingsOf(first) : curPage().children;
  setSelection(list.filter(n => n.visible !== false && !n.locked).map(n => n.id), { keepEntered: !!first });
}

function groupSelection() {
  let ids = unlockedRoots();
  if (!ids.length) return;
  const lists = new Set(ids.map(siblingsOf));
  if (lists.size === 1) { const l = [...lists][0]; ids = ids.slice().sort((a, b) => l.indexOf(nodeOf(a)) - l.indexOf(nodeOf(b))); }
  const marker = ids[ids.length - 1];           // the group takes the place of the topmost layer
  const parent = parentOf(marker);
  const b = selBounds(ids), pa = parent ? absPos(parent.id) : { x: 0, y: 0 };
  const g = newNode('group', { x: b.x - pa.x, y: b.y - pa.y, w: b.w, h: b.h });
  const abs = new Map(ids.map(id => [id, absPos(id)]));
  const markerNode = nodeOf(marker), dest = siblingsOf(marker);
  for (const id of ids) {
    const n = nodeOf(id), a = abs.get(id);
    n.x = a.x - b.x; n.y = a.y - b.y;
    g.children.push(n);
    if (id !== marker) { const l = siblingsOf(id); l.splice(l.indexOf(n), 1); }
  }
  dest[dest.indexOf(markerNode)] = g;
  commit(); reindex(); setSelection([g.id]); renderAll();
}

function ungroupSelection() {
  const ids = selRoots().filter(id => nodeOf(id).type === 'group' && !nodeOf(id).locked);
  if (!ids.length) { showToast('Select a group to ungroup'); return; }
  const out = [];
  for (const id of ids) {
    const g = nodeOf(id), list = siblingsOf(id);
    for (const c of g.children) { c.x += g.x; c.y += g.y; out.push(c.id); }
    list.splice(list.indexOf(g), 1, ...g.children);
  }
  commit(); reindex(); setSelection(out); renderAll();
}

function reorderSelection(mode) {
  const ids = unlockedRoots();
  const lists = new Set(ids.map(siblingsOf));
  for (const list of lists) {
    const picked = ids.map(nodeOf).filter(n => list.includes(n)).sort((a, b) => list.indexOf(a) - list.indexOf(b));
    const set = new Set(picked);
    if (mode === 'front' || mode === 'back') {
      const rest = list.filter(n => !set.has(n));
      list.splice(0, list.length, ...(mode === 'front' ? [...rest, ...picked] : [...picked, ...rest]));
    } else if (mode === 'forward') {
      for (const n of picked.slice().reverse()) { const i = list.indexOf(n); if (i < list.length - 1 && !set.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]]; }
    } else {
      for (const n of picked) { const i = list.indexOf(n); if (i > 0 && !set.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]]; }
    }
  }
  afterChange();
}

// One layer aligns to its parent frame, several layers align to their common bounds.
function alignSelection(kind) {
  const ids = unlockedRoots();
  if (!ids.length) return;
  let ref;
  if (ids.length > 1) ref = selBounds(ids);
  else {
    const p = parentOf(ids[0]);
    if (!p) return;
    const pa = absPos(p.id);
    ref = { x: pa.x, y: pa.y, w: p.w, h: p.h };
  }
  for (const id of ids) {
    const n = nodeOf(id), a = absPos(id), dx = a.x - n.x, dy = a.y - n.y;
    if (kind === 'left') n.x = ref.x - dx;
    if (kind === 'hcenter') n.x = ref.x + (ref.w - n.w) / 2 - dx;
    if (kind === 'right') n.x = ref.x + ref.w - n.w - dx;
    if (kind === 'top') n.y = ref.y - dy;
    if (kind === 'vcenter') n.y = ref.y + (ref.h - n.h) / 2 - dy;
    if (kind === 'bottom') n.y = ref.y + ref.h - n.h - dy;
    n.x = Math.round(n.x); n.y = Math.round(n.y);
  }
  afterChange();
}

function nudgeSelection(dx, dy) {
  const ids = unlockedRoots();
  if (!ids.length) return;
  for (const id of ids) { const n = nodeOf(id); n.x += dx; n.y += dy; }
  refreshCanvas(); syncPropValues();
  clearTimeout(nudgeSelection._t);
  nudgeSelection._t = setTimeout(afterChange, 350);
}

function toggleFlag(key) {
  const ids = selRoots();
  if (!ids.length) return;
  if (key === 'locked') { const all = ids.every(id => nodeOf(id).locked); for (const id of ids) nodeOf(id).locked = !all; }
  else { const allHidden = ids.every(id => nodeOf(id).visible === false); for (const id of ids) nodeOf(id).visible = allHidden; }
  afterChange();
}

// ─── pages ───────────────────────────────────────────────────────
function switchPage(id) {
  if (id === D.pageId) return;
  D.pageId = id;
  D.sel = []; D.entered = new Set(); D.hover = null; D.layerFilter.clear();
  reindex();
  renderAll();
  schedulePersist();
}
function addPage() {
  const p = { id: uid(), name: `Page ${D.doc.pages.length + 1}`, bg: '#2c2c2c', children: [] };
  D.doc.pages.push(p);
  D.doc.views[p.id] = { x: 200, y: 120, zoom: 1 };
  commit();
  switchPage(p.id);
}

function deletePage(id) {
  if (D.doc.pages.length < 2) { showToast("You can't delete the last page"); return; }
  const p = D.doc.pages.find(x => x.id === id);
  if (!confirm(`Delete page "${p.name}"?`)) return;
  const masters = new Set(), doomed = new Set();
  eachNode(p.children, n => { doomed.add(n.id); if (n.isComponent) masters.add(n.id); });
  detachInstancesOfMasters(doomed, masters);
  D.doc.pages = D.doc.pages.filter(x => x.id !== id);
  if (D.pageId === id) D.pageId = D.doc.pages[0].id;
  D.sel = [];
  afterChange();
}

// ─── designs (the document library; see design/design-db.js) ────
// Switches which design is open in this editor, saving the current one first.
async function switchDesign(id) {
  if (!D.doc || id === D.doc.id) return;
  await saveDocNow();
  const doc = await getDesignDoc(id);
  if (!doc) { showToast('Design not found'); return; }
  setDoc(doc);
  await setCurrentDesignId(id);
  renderAll();
  renderDesignsList();
  fitView();
}

async function createDesignAndSwitch() {
  await saveDocNow();
  const doc = await createDesignDoc(`Design ${(await getAllDesignDocs()).length + 1}`);
  setDoc(doc);
  await setCurrentDesignId(doc.id);
  renderAll();
  renderDesignsList();
}

async function deleteDesignPrompt(id) {
  const all = await getAllDesignDocs();
  if (all.length < 2) { showToast("You can't delete the last design"); return; }
  const doc = all.find(d => d.id === id);
  if (!doc || !confirm(`Delete design "${doc.name}"?`)) return;
  await deleteDesignDoc(id);
  if (id === D.doc.id) {
    const remaining = all.filter(d => d.id !== id);
    const next = await getDesignDoc(remaining[0].id);
    setDoc(next);
    await setCurrentDesignId(next.id);
    renderAll();
    fitView();
  }
  renderDesignsList();
}

// ─── assets ──────────────────────────────────────────────────────
function readImageFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight, dataUrl = reader.result;
        const max = 2000;
        if (/^data:image\/(png|jpe?g|webp)/.test(dataUrl) && Math.max(w, h) > max) {
          const k = max / Math.max(w, h), c = document.createElement('canvas');
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          dataUrl = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
          w = c.width; h = c.height;
        }
        resolve({ id: uid(), name: file.name.replace(/\.[^.]+$/, ''), kind: 'image', w: w || 100, h: h || 100, dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// `at` ({ parent, x, y }, local coordinates) places the images on the canvas as well.
async function importImages(files, at) {
  const added = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const a = await readImageFile(f);
    if (a) { D.doc.assets.push(a); added.push(a); }
  }
  if (!added.length) { showToast('No readable image found'); return; }
  if (at) {
    let x = at.x;
    const ids = [];
    for (const a of added) { const n = addImageNode(a.id, { parent: at.parent, x, y: at.y }); ids.push(n.id); x += n.w + 20; }
    commit(); reindex(); setSelection(ids);
  } else commit();
  renderAll();
  showToast(`${added.length} image${added.length > 1 ? 's' : ''} added to assets`, 'ok');
}

function imageSize(a) {
  const k = a.kind === 'icon' ? 2 : Math.min(1, 480 / a.w, 480 / a.h);
  return { w: Math.max(1, Math.round(a.w * k)), h: Math.max(1, Math.round(a.h * k)) };
}

// x / y are local to `parent`; they default to the centre of the visible canvas.
function addImageNode(assetId, opts = {}) {
  const a = getAsset(assetId), { w, h } = imageSize(a);
  const parent = opts.parent || null, c = viewCenterLocal(parent);
  const n = newNode('image', {
    assetId, name: a.name, w, h, fit: a.kind === 'icon' ? 'contain' : 'cover',
    x: Math.round(opts.x ?? c.x - w / 2), y: Math.round(opts.y ?? c.y - h / 2),
  });
  listFor(parent).push(n);
  return n;
}

function insertAssetAtCenter(kind, id) {
  const sel = selRoots();
  const frame = sel.length === 1 && nodeOf(sel[0]).type === 'frame' ? nodeOf(sel[0]) : null;
  let n;
  if (kind === 'component') {
    const m = nodeOf(id);
    n = createInstance(id, frame ? { parent: frame, x: (frame.w - m.w) / 2, y: (frame.h - m.h) / 2 } : {});
  } else if (kind === 'group') {
    n = groupCopyAt(id, { parent: frame });
  } else {
    const { w, h } = imageSize(getAsset(id));
    n = addImageNode(id, frame ? { parent: frame, x: (frame.w - w) / 2, y: (frame.h - h) / 2 } : {});
  }
  if (!n) return;
  commit(); reindex(); setSelection([n.id]); renderAll();
}

function deleteAsset(id) {
  let used = 0;
  eachNodeAllPages(n => { if (n.assetId === id) used++; });
  if (used && !confirm(`This image is used by ${used} layer${used > 1 ? 's' : ''}. Delete anyway?`)) return;
  D.doc.assets = D.doc.assets.filter(a => a.id !== id);
  afterChange();
}

// ─── files ───────────────────────────────────────────────────────
async function saveFile(data, defaultName, filterName, extensions) {
  const tauri = window.__TAURI__;
  if (tauri && tauri.dialog && tauri.fs) {
    try {
      const path = await tauri.dialog.save({ defaultPath: defaultName, filters: [{ name: filterName, extensions }] });
      if (!path) return false;
      if (typeof data === 'string') await tauri.fs.writeTextFile(path, data);
      else await tauri.fs.writeFile(path, data);
      return true;
    } catch (e) { console.error('Save dialog error:', e); }
  }
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}

async function exportDesignJson() {
  const payload = JSON.stringify({ app: 'secondmap-design', doc: { ...D.doc, pageId: D.pageId } }, null, 2);
  if (await saveFile(payload, 'design.json', 'SecondMap Design', ['json'])) showToast('Design exported', 'ok');
}

async function importDesignJson(file) {
  try {
    const data = JSON.parse(await file.text());
    const doc = data.doc || data;
    if (!Array.isArray(doc.pages) || !doc.pages.length) throw new Error('invalid');
    if (!confirm('Replace the current design with the imported file?')) return;
    doc.id = D.doc.id; doc.name = D.doc.name; doc.created = D.doc.created;
    setDoc(doc);
    schedulePersist();
    renderAll();
    fitView();
    showToast('Design imported', 'ok');
  } catch (e) { showToast('Not a valid design file', 'err'); }
}

// Creates a brand-new, independent design and switches to it (see the Designs list for the old one).
async function newDesign() {
  await createDesignAndSwitch();
  showToast('New design created', 'ok');
}

async function exportPng() {
  const ids = selRoots();
  if (ids.length !== 1) { showToast('Select exactly one layer or frame to export'); return; }
  const n = nodeOf(ids[0]), scale = 2;
  const xhtml = new XMLSerializer().serializeToString(buildStatic(n, { root: true }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n.w * scale}" height="${n.h * scale}" viewBox="0 0 ${n.w} ${n.h}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const img = new Image();
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const c = document.createElement('canvas');
    c.width = Math.round(n.w * scale); c.height = Math.round(n.h * scale);
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (await saveFile(bytes, `${n.name}.png`, 'PNG image', ['png'])) showToast('PNG exported', 'ok');
  } catch (e) { console.error(e); showToast('PNG export failed', 'err'); }
}
