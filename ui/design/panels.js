// Design editor – side panels: pages, layers, assets, properties and prototype links.

const propsEl = $('d-props');
const protoEl = $('d-proto');
const layersEl = $('d-layers');
const assetsEl = $('d-assets');

function leftTab() { return document.querySelector('#d-left-tabs .active').dataset.tab; }
function rightTab() { return document.querySelector('#d-right-tabs .active').dataset.tab; }

function setTabs(barId, tab, panels) {
  document.querySelectorAll(`#${barId} button`).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  for (const [name, el] of Object.entries(panels)) el.hidden = name !== tab;
}

$('d-left-tabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  setTabs('d-left-tabs', b.dataset.tab, { layers: layersEl, assets: assetsEl });
  if (b.dataset.tab === 'assets') renderAssets();
});
$('d-right-tabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  setTabs('d-right-tabs', b.dataset.tab, { design: propsEl, prototype: protoEl });
  renderProps(); renderProto();
});

function updateToolbar() {
  $('d-undo').disabled = D.histIdx <= 0;
  $('d-redo').disabled = D.histIdx >= D.hist.length - 1;
  $('d-group').disabled = !unlockedRoots().length;
  $('d-component').disabled = !unlockedRoots().length;
  $('d-zoom-label').textContent = Math.round(view().zoom * 100) + '%';
}

function inlineRename(host, value, onDone) {
  const input = document.createElement('input');
  input.className = 'd-rename';
  input.value = value;
  host.replaceChildren(input);
  input.focus(); input.select();
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    if (ok && input.value.trim() && input.value.trim() !== value) onDone(input.value.trim());
    else { renderPages(); renderLayers(); }
  };
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', e => e.stopPropagation());
}

// ─── pages ───────────────────────────────────────────────────────
function renderPages() {
  $('d-pages').innerHTML = D.doc.pages.map(p => `
    <div class="d-page${p.id === D.pageId ? ' active' : ''}" data-pid="${p.id}">
      <span class="d-page-name">${esc(p.name)}</span>
      <button class="d-icon-btn" data-act="del-page" title="Delete page">×</button>
    </div>`).join('');
}

$('d-pages').addEventListener('click', e => {
  const row = e.target.closest('.d-page');
  if (!row) return;
  if (e.target.closest('[data-act="del-page"]')) { deletePage(row.dataset.pid); return; }
  switchPage(row.dataset.pid);
});
$('d-pages').addEventListener('dblclick', e => {
  const row = e.target.closest('.d-page');
  if (!row) return;
  const p = D.doc.pages.find(x => x.id === row.dataset.pid);
  inlineRename(row.querySelector('.d-page-name'), p.name, v => { p.name = v; afterChange(); });
});
$('d-add-page').addEventListener('click', addPage);

// ─── layers ──────────────────────────────────────────────────────
const TYPE_ICON = { frame: '#', rect: '▭', ellipse: '◯', text: 'T', image: '▣', group: '▤', instance: '◇' };

function layerRows(list, depth, out) {
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    const hasKids = !!(n.children && n.children.length);
    const collapsed = D.collapsed.has(n.id);
    const cls = ['d-layer'];
    if (D.sel.includes(n.id)) cls.push('sel');
    if (n.visible === false) cls.push('hidden');
    if (n.isComponent || n.type === 'instance') cls.push('comp');
    out.push(`<div class="${cls.join(' ')}" draggable="true" data-lid="${n.id}" style="padding-left:${8 + depth * 14}px">
      <span class="d-caret" data-act="caret">${hasKids ? (collapsed ? '▸' : '▾') : ''}</span>
      <span class="d-licon">${n.isComponent ? '◆' : TYPE_ICON[n.type] || '•'}</span>
      <span class="d-lname">${esc(n.name)}</span>
      <button class="d-lbtn${n.locked ? ' on' : ''}" data-act="lock" title="Lock / unlock">${n.locked ? '🔒' : '·'}</button>
      <button class="d-lbtn${n.visible === false ? ' on' : ''}" data-act="vis" title="Show / hide">${n.visible === false ? '○' : '●'}</button>
    </div>`);
    if (hasKids && !collapsed) layerRows(n.children, depth + 1, out);
  }
}

function renderLayers() {
  const out = [];
  layerRows(curPage().children, 0, out);
  layersEl.innerHTML = out.length ? out.join('') : '<div class="d-empty">No layers yet.</div>';
}

layersEl.addEventListener('click', e => {
  const row = e.target.closest('.d-layer');
  if (!row) return;
  const id = row.dataset.lid, n = nodeOf(id);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'caret') { D.collapsed.has(id) ? D.collapsed.delete(id) : D.collapsed.add(id); renderLayers(); return; }
  if (act === 'lock') { n.locked = !n.locked; afterChange(); return; }
  if (act === 'vis') { n.visible = n.visible === false; afterChange(); return; }
  if (e.shiftKey || e.ctrlKey || e.metaKey) setSelection(D.sel.includes(id) ? D.sel.filter(x => x !== id) : [...D.sel, id]);
  else setSelection([id]);
});
layersEl.addEventListener('dblclick', e => {
  const row = e.target.closest('.d-layer');
  if (!row || !e.target.closest('.d-lname')) return;
  const n = nodeOf(row.dataset.lid);
  inlineRename(row.querySelector('.d-lname'), n.name, v => { n.name = v; afterChange(); });
});

let layerDrag = null;
function dropZone(e, row) {
  const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  const n = nodeOf(row.dataset.lid);
  if (n.children && y > 0.25 && y < 0.75) return 'inside';
  return y < 0.5 ? 'above' : 'below';
}
function clearDropMarks() { layersEl.querySelectorAll('.drop-above,.drop-below,.drop-inside').forEach(r => r.classList.remove('drop-above', 'drop-below', 'drop-inside')); }

layersEl.addEventListener('dragstart', e => {
  const row = e.target.closest('.d-layer');
  if (!row) return;
  layerDrag = row.dataset.lid;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'layer:' + layerDrag);
});
layersEl.addEventListener('dragover', e => {
  const row = e.target.closest('.d-layer');
  if (!row || !layerDrag) return;
  e.preventDefault();
  clearDropMarks();
  row.classList.add('drop-' + dropZone(e, row));
});
layersEl.addEventListener('dragleave', e => { if (!layersEl.contains(e.relatedTarget)) clearDropMarks(); });
layersEl.addEventListener('dragend', () => { layerDrag = null; clearDropMarks(); });
layersEl.addEventListener('drop', e => {
  const row = e.target.closest('.d-layer');
  clearDropMarks();
  if (!row || !layerDrag) return;
  e.preventDefault();
  const zone = dropZone(e, row), target = nodeOf(row.dataset.lid), id = layerDrag;
  layerDrag = null;
  if (id === target.id) return;
  let ok;
  if (zone === 'inside') ok = moveNodeTo(id, target, null);
  else {
    const list = siblingsOf(target.id), idx = list.indexOf(target);
    ok = moveNodeTo(id, parentOf(target.id), zone === 'above' ? idx + 1 : idx);
  }
  if (!ok) { showToast("A layer can't be moved into itself"); return; }
  commit(); reindex(); setSelection([id]); renderAll();
});

// ─── assets ──────────────────────────────────────────────────────
function assetTile(kind, id, name, thumb) {
  return `<div class="d-asset" draggable="true" data-kind="${kind}" data-id="${id}" title="${esc(name)}">${thumb}<span>${esc(name)}</span>${kind === 'image' ? '<button class="d-asset-del" data-act="del-asset" title="Delete">×</button>' : ''}</div>`;
}

function renderAssets() {
  const comps = [];
  eachNodeAllPages(n => { if (n.isComponent) comps.push(n); });
  assetsEl.innerHTML = '';
  const section = (title, body, extra = '') => {
    const s = document.createElement('div');
    s.className = 'd-asset-section';
    s.innerHTML = `<div class="d-section-head"><span>${title}</span>${extra}</div><div class="d-asset-grid">${body}</div>`;
    assetsEl.appendChild(s);
    return s;
  };
  const cs = section('Components', comps.length ? '' : '<div class="d-empty">Select a frame or shape and press <kbd>Ctrl+Alt+K</kbd> to create a component.</div>');
  const grid = cs.querySelector('.d-asset-grid');
  for (const m of comps) {
    const tile = document.createElement('div');
    tile.className = 'd-asset';
    tile.draggable = true;
    tile.dataset.kind = 'component'; tile.dataset.id = m.id; tile.title = m.name;
    tile.appendChild(buildThumb(m, 56));
    const label = document.createElement('span');
    label.textContent = m.name;
    tile.appendChild(label);
    grid.appendChild(tile);
  }
  section('Images', D.doc.assets.length ? D.doc.assets.map(a => assetTile('image', a.id, a.name, `<img src="${a.dataUrl}" draggable="false">`)).join('') : '<div class="d-empty">Upload images or drop image files onto the canvas.</div>',
    '<button class="d-icon-btn" data-act="upload" title="Upload images">+</button>');
  section('Icons', BUILTIN_ASSETS.map(a => assetTile('icon', a.id, a.name, `<img src="${a.dataUrl}" draggable="false">`)).join(''));
}

assetsEl.addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'upload') { $('d-file-image').click(); return; }
  const tile = e.target.closest('.d-asset');
  if (!tile) return;
  if (act === 'del-asset') { deleteAsset(tile.dataset.id); return; }
  insertAssetAtCenter(tile.dataset.kind === 'component' ? 'component' : 'image', tile.dataset.id);
});
assetsEl.addEventListener('dblclick', e => {
  const tile = e.target.closest('.d-asset');
  if (!tile || tile.dataset.kind !== 'component') return;
  const entry = byId.get(tile.dataset.id);
  if (!entry) return;
  if (entry.pageId !== D.pageId) switchPage(entry.pageId);
  setSelection([tile.dataset.id]);
  fitView([tile.dataset.id]);
});
assetsEl.addEventListener('dragstart', e => {
  const tile = e.target.closest('.d-asset');
  if (!tile) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', `asset:${tile.dataset.kind}:${tile.dataset.id}`);
});
$('d-file-image').addEventListener('change', async e => {
  await importImages([...e.target.files]);
  e.target.value = '';
});

// ─── properties ──────────────────────────────────────────────────
const FILL_TYPES = ['frame', 'rect', 'ellipse', 'text'];
const STROKE_TYPES = ['frame', 'rect', 'ellipse', 'image'];
const RADIUS_TYPES = ['frame', 'rect', 'image'];
const SHADOW_TYPES = ['frame', 'rect', 'ellipse', 'text', 'image'];

function hex6(v) {
  if (typeof v !== 'string') return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : '#000000';
}

function readProp(n, k) {
  if (k === 'opacity') return Math.round(n.opacity * 100);
  if (k === 'shadow.alpha') return n.shadow ? Math.round((n.shadow.alpha ?? 1) * 100) : '';
  if (k.startsWith('shadow.')) return n.shadow ? n.shadow[k.slice(7)] : '';
  const v = n[k];
  return typeof v === 'number' ? Math.round(v * 100) / 100 : v;
}

function applyProp(n, k, v) {
  const num = (min, max) => Math.min(max, Math.max(min, v));
  switch (k) {
    case 'x': case 'y': n[k] = v; break;
    case 'w': case 'h':
      v = Math.max(1, v);
      if (n.type === 'group') scaleDescendants(n, k === 'w' ? v / n.w : 1, k === 'h' ? v / n.h : 1);
      if (n.type === 'text' && k === 'h') n.autoH = false;
      n[k] = v;
      break;
    case 'opacity': n.opacity = num(0, 100) / 100; break;
    case 'radius': if (RADIUS_TYPES.includes(n.type)) n.radius = num(0, 9999); break;
    case 'strokeWidth': if (STROKE_TYPES.includes(n.type)) n.strokeWidth = num(0, 200); break;
    case 'fontSize': if (n.type === 'text') n.fontSize = num(1, 600); break;
    case 'fontWeight': if (n.type === 'text') n.fontWeight = v; break;
    case 'font': case 'align': case 'text': if (n.type === 'text') n[k] = v; break;
    case 'fill': if (FILL_TYPES.includes(n.type)) n.fill = v; break;
    case 'stroke': if (STROKE_TYPES.includes(n.type)) n.stroke = v; break;
    case 'clip': if (n.type === 'frame') n.clip = v; break;
    case 'fit': if (n.type === 'image') n.fit = v; break;
    case 'preset': if (n.type === 'frame') { n.w = FRAME_PRESETS[v][1]; n.h = FRAME_PRESETS[v][2]; } break;
    default:
      if (k.startsWith('shadow.') && SHADOW_TYPES.includes(n.type)) {
        n.shadow = n.shadow || { x: 0, y: 4, blur: 12, color: '#000000', alpha: 0.25 };
        const key = k.slice(7);
        n.shadow[key] = key === 'color' ? v : key === 'alpha' ? Math.min(1, Math.max(0, v / 100)) : v;
      }
  }
}

function fieldTargets(k) {
  const nodes = D.sel.map(nodeOf).filter(n => n && !n.locked);
  return ['x', 'y', 'w', 'h'].includes(k) ? nodes.slice(0, 1) : nodes;
}

function handleField(e, final) {
  const el = e.target;
  if (!el.dataset) return;
  let v;
  if (el.type === 'checkbox') { if (!final) return; v = el.checked; }
  else if (el.type === 'number') { v = parseFloat(el.value); if (Number.isNaN(v)) { if (final) syncPropValues(); return; } }
  else if (el.dataset.hex !== undefined) {
    const m = /^#?([0-9a-f]{6})$/i.exec(el.value.trim());
    if (!m) { if (final) syncPropValues(); return; }
    v = '#' + m[1].toLowerCase();
  } else v = el.value;

  if (el.dataset.ov) {
    setOverride(el.dataset.inst, el.dataset.ov, el.dataset.ovk, v);
    if (final) commit();
    refreshCanvas();
    return;
  }
  const k = el.dataset.k;
  if (!k) return;
  if (k === 'pagebg') curPage().bg = v;
  else {
    if (k === 'preset' || k === 'fontWeight') { v = parseInt(v, 10); if (Number.isNaN(v)) return; }
    for (const n of fieldTargets(k)) applyProp(n, k, v);
    if (k === 'preset') el.value = '';
  }
  if (final) { commit(); renderLayers(); updateToolbar(); }
  refreshCanvas();
  syncPropValues();
}

propsEl.addEventListener('input', e => handleField(e, false));
propsEl.addEventListener('change', e => handleField(e, true));

// Updates field values in place (the focused field is left alone so typing is not interrupted).
function syncPropValues() {
  const first = nodeOf(D.sel[0]);
  propsEl.querySelectorAll('[data-k]').forEach(el => {
    if (el === document.activeElement) return;
    const k = el.dataset.k;
    if (k === 'preset') return;
    const v = k === 'pagebg' ? curPage().bg : first && readProp(first, k);
    if (v == null || v === '') return;
    if (el.type === 'checkbox') el.checked = v !== false;
    else el.value = el.type === 'color' ? hex6(v) : v;
  });
}

const ALIGN_ICONS = {
  left: '<path d="M2 1v14M5 4h9v3H5zM5 9h5v3H5z"/>',
  hcenter: '<path d="M8 1v14M3 4h10v3H3zM5 9h6v3H5z"/>',
  right: '<path d="M14 1v14M2 4h9v3H2zM6 9h5v3H6z"/>',
  top: '<path d="M1 2h14M4 5v9h3V5zM9 5v5h3V5z"/>',
  vcenter: '<path d="M1 8h14M4 3v10h3V3zM9 5v6h3V5z"/>',
  bottom: '<path d="M1 14h14M4 2v9h3V2zM9 6v5h3V6z"/>',
};

const fnum = (k, label, val, step = 1, min = '') => `<label class="f"><span>${label}</span><input type="number" data-k="${k}" step="${step}" ${min !== '' ? `min="${min}"` : ''} value="${val}"></label>`;
const colorRow = (k, val) => `<div class="f-color"><input type="color" data-k="${k}" value="${hex6(val)}"><input type="text" class="hex" data-k="${k}" data-hex value="${hex6(val)}" spellcheck="false"></div>`;
const section = (title, body, actions = '') => `<div class="d-prop-sec"><div class="d-prop-head"><span>${title}</span>${actions}</div>${body}</div>`;
const iconBtn = (act, title, label) => `<button class="d-icon-btn" data-act="${act}" title="${title}">${label}</button>`;

function propsFor(nodes) {
  const first = nodes[0], single = nodes.length === 1;
  const has = types => nodes.some(n => types.includes(n.type));
  const firstOf = types => nodes.find(n => types.includes(n.type));
  let h = '';

  const aligns = Object.keys(ALIGN_ICONS).map(k => `<button class="d-icon-btn" data-act="align" data-kind="${k}" title="Align ${k}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">${ALIGN_ICONS[k]}</svg></button>`).join('');
  h += `<div class="d-prop-sec d-align">${aligns}</div>`;

  const opacityRadius = `<div class="f-grid">${fnum('opacity', '%', readProp(first, 'opacity'), 1, 0)}${has(RADIUS_TYPES) ? fnum('radius', 'R', readProp(firstOf(RADIUS_TYPES), 'radius'), 1, 0) : ''}</div>`;
  if (single) {
    h += section('Layer', `
      <div class="f-grid">${fnum('x', 'X', readProp(first, 'x'))}${fnum('y', 'Y', readProp(first, 'y'))}${fnum('w', 'W', readProp(first, 'w'), 1, 1)}${fnum('h', 'H', readProp(first, 'h'), 1, 1)}</div>
      ${opacityRadius}
      ${first.type === 'frame' ? `<label class="f-line"><span>Preset</span><select data-k="preset"><option value="">Size preset…</option>${FRAME_PRESETS.map((p, i) => `<option value="${i}">${p[0]}</option>`).join('')}</select></label>
      <label class="f-check"><input type="checkbox" data-k="clip" ${first.clip !== false ? 'checked' : ''}> Clip content</label>` : ''}`);
  } else {
    h += section('Layer', `<div class="d-note">${nodes.length} layers selected</div>${opacityRadius}`);
  }

  if (has(['text'])) {
    const t = firstOf(['text']);
    h += section('Text', `
      ${single ? `<textarea data-k="text" rows="3">${esc(t.text)}</textarea>` : ''}
      <label class="f-line"><span>Font</span><select data-k="font">${Object.keys(FONTS).map(f => `<option value="${f}"${t.font === f ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
      <div class="f-grid">${fnum('fontSize', 'Size', t.fontSize, 1, 1)}
      <label class="f"><span>Wt</span><select data-k="fontWeight">${[300, 400, 500, 600, 700, 800].map(w => `<option value="${w}"${t.fontWeight == w ? ' selected' : ''}>${w}</option>`).join('')}</select></label></div>
      <div class="d-seg">${['left', 'center', 'right'].map(a => `<button class="${t.align === a ? 'on' : ''}" data-act="text-align" data-kind="${a}">${a}</button>`).join('')}</div>`);
  }

  if (has(FILL_TYPES)) {
    const f = firstOf(FILL_TYPES);
    const act = f.fill ? (f.type === 'text' ? '' : iconBtn('fill-remove', 'Remove fill', '−')) : iconBtn('fill-add', 'Add fill', '+');
    h += section(f.type === 'text' ? 'Color' : 'Fill', f.fill ? colorRow('fill', f.fill) : '<div class="d-note">No fill</div>', act);
  }
  if (has(STROKE_TYPES)) {
    const s = firstOf(STROKE_TYPES);
    h += section('Stroke', s.stroke ? `${colorRow('stroke', s.stroke)}<div class="f-grid">${fnum('strokeWidth', 'W', s.strokeWidth, 1, 0)}</div>` : '<div class="d-note">No stroke</div>',
      s.stroke ? iconBtn('stroke-remove', 'Remove stroke', '−') : iconBtn('stroke-add', 'Add stroke', '+'));
  }
  if (has(SHADOW_TYPES)) {
    const s = firstOf(SHADOW_TYPES).shadow;
    h += section('Drop shadow', s ? `<div class="f-grid">${fnum('shadow.x', 'X', s.x)}${fnum('shadow.y', 'Y', s.y)}${fnum('shadow.blur', 'Blur', s.blur, 1, 0)}${fnum('shadow.alpha', '%', Math.round((s.alpha ?? 1) * 100), 1, 0)}</div>${colorRow('shadow.color', s.color)}` : '<div class="d-note">No shadow</div>',
      s ? iconBtn('shadow-remove', 'Remove shadow', '−') : iconBtn('shadow-add', 'Add shadow', '+'));
  }
  if (single && first.type === 'image') {
    const a = getAsset(first.assetId);
    h += section('Image', `<div class="d-note">${a ? esc(a.name) : 'Asset missing'}</div><label class="f-line"><span>Fit</span><select data-k="fit">${['cover', 'contain', 'fill'].map(f => `<option${first.fit === f ? ' selected' : ''}>${f}</option>`).join('')}</select></label>`);
  }

  h += componentSection(nodes);
  h += section('Arrange', `<div class="d-seg"><button data-act="order" data-kind="front">Front</button><button data-act="order" data-kind="forward">Forward</button><button data-act="order" data-kind="backward">Backward</button><button data-act="order" data-kind="back">Back</button></div>`);
  return h;
}

function overrideRows(inst, master) {
  const rows = [];
  eachNode([master], x => {
    if (x.type === 'instance' || rows.length >= 20) return;
    const o = (inst.overrides && inst.overrides[x.id]) || {};
    const attrs = k => `data-inst="${inst.id}" data-ov="${x.id}" data-ovk="${k}"`;
    if (x.type === 'text') rows.push(`<div class="d-ov"><span>${esc(x.name)}</span><input type="text" ${attrs('text')} value="${esc(o.text ?? x.text)}"><input type="color" ${attrs('fill')} value="${hex6(o.fill ?? x.fill)}"></div>`);
    else if (x.fill && ['frame', 'rect', 'ellipse'].includes(x.type)) rows.push(`<div class="d-ov"><span>${esc(x.name)}</span><input type="color" ${attrs('fill')} value="${hex6(o.fill ?? x.fill)}"></div>`);
  });
  return rows.length ? `<div class="d-subhead">Overrides</div>${rows.join('')}` : '<div class="d-note">Nothing to override</div>';
}

function componentSection(nodes) {
  if (nodes.length !== 1) {
    return nodes.every(n => n.type !== 'instance' && !n.isComponent) ? section('Component', '<button class="d-wide" data-act="create-component">Create components</button>') : '';
  }
  const n = nodes[0];
  if (n.type === 'instance') {
    const m = nodeOf(n.componentId);
    return section('Instance', `<div class="d-note">${m ? `of <b>◆ ${esc(m.name)}</b>` : 'Main component was deleted'}</div>
      <div class="d-seg"><button data-act="goto-main">Go to main</button><button data-act="detach">Detach</button></div>${m ? overrideRows(n, m) : ''}
      ${n.overrides ? '<button class="d-wide" data-act="reset-overrides">Reset overrides</button>' : ''}`);
  }
  if (n.isComponent) {
    let count = 0;
    eachNodeAllPages(x => { if (x.type === 'instance' && x.componentId === n.id) count++; });
    return section('Main component', `<div class="d-note">◆ ${count} instance${count === 1 ? '' : 's'}. Changes here update every instance.</div><button class="d-wide" data-act="create-instance">Create instance</button>`);
  }
  return section('Component', '<button class="d-wide" data-act="create-component">Create component</button>');
}

function renderProps() {
  if (rightTab() !== 'design') return;
  const nodes = D.sel.map(nodeOf).filter(Boolean);
  if (!nodes.length) {
    propsEl.innerHTML = section('Page', `<div class="f-line"><span>Background</span></div>${colorRow('pagebg', curPage().bg || '#2c2c2c')}`) +
      section('Frame presets', `<div class="d-presets">${FRAME_PRESETS.map((p, i) => `<button data-act="new-frame" data-i="${i}">${p[0]}</button>`).join('')}</div>`) +
      '<div class="d-note pad">Select a layer to edit its properties.<br>Frames are the screens of your prototype; use the <b>Prototype</b> tab to link them.</div>';
    return;
  }
  propsEl.innerHTML = propsFor(nodes);
}

propsEl.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, kind = b.dataset.kind;
  const nodes = D.sel.map(nodeOf).filter(n => n && !n.locked);
  const each = fn => { for (const n of nodes) fn(n); afterChange(); };
  switch (act) {
    case 'align': alignSelection(kind); break;
    case 'order': reorderSelection(kind); break;
    case 'text-align': each(n => { if (n.type === 'text') n.align = kind; }); break;
    case 'fill-add': each(n => { if (FILL_TYPES.includes(n.type) && !n.fill) n.fill = n.type === 'text' ? '#111111' : '#d9d9d9'; }); break;
    case 'fill-remove': each(n => { if (n.type !== 'text') n.fill = null; }); break;
    case 'stroke-add': each(n => { if (STROKE_TYPES.includes(n.type)) { n.stroke = '#000000'; n.strokeWidth = n.strokeWidth || 1; } }); break;
    case 'stroke-remove': each(n => { n.stroke = null; }); break;
    case 'shadow-add': each(n => { if (SHADOW_TYPES.includes(n.type)) n.shadow = { x: 0, y: 4, blur: 12, color: '#000000', alpha: 0.25 }; }); break;
    case 'shadow-remove': each(n => { n.shadow = null; }); break;
    case 'create-component': createComponent(); break;
    case 'create-instance': instanceFromSelection(); break;
    case 'detach': detachSelection(); break;
    case 'goto-main': goToMain(D.sel[0]); break;
    case 'reset-overrides': resetOverrides(D.sel[0]); break;
    case 'new-frame': createFramePreset(parseInt(b.dataset.i, 10)); break;
  }
});

function createFramePreset(i) {
  const [name, w, h] = FRAME_PRESETS[i];
  const c = viewCenterLocal(null);
  const f = newNode('frame', { w, h, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) });
  f.name = `${name.split(' (')[0]} ${D.doc.counters.frame}`;
  curPage().children.push(f);
  commit(); reindex(); setSelection([f.id]); renderAll();
  fitView([f.id]);
}

// ─── prototype ───────────────────────────────────────────────────
function topLevelFrames() {
  const out = [];
  for (const p of D.doc.pages) for (const n of p.children) if (n.type === 'frame') out.push({ node: n, page: p });
  return out;
}

function renderProto() {
  if (rightTab() !== 'prototype') return;
  const ids = selRoots();
  let h = '';
  const frames = topLevelFrames();
  if (ids.length === 1) {
    const n = nodeOf(ids[0]), l = n.link;
    const opts = frames.map(f => `<option value="${f.node.id}"${l && l.target === f.node.id ? ' selected' : ''}>${esc(f.page.name)} / ${esc(f.node.name)}</option>`).join('');
    h += section('Interaction', `<div class="d-note">${esc(n.name)}</div>
      <label class="f-line"><span>On click</span><select id="d-link-type">
        <option value="">Nothing</option>
        <option value="navigate"${l && l.type === 'navigate' ? ' selected' : ''}>Navigate to…</option>
        <option value="back"${l && l.type === 'back' ? ' selected' : ''}>Back</option></select></label>
      ${l && l.type === 'navigate' ? `<label class="f-line"><span>Frame</span><select id="d-link-target">${opts}</select></label>` : ''}`);
  } else {
    h += '<div class="d-note pad">Select a button, shape or frame to make it clickable in the prototype.</div>';
  }
  const links = [];
  eachNodeAllPages(n => { if (n.link) links.push(n); });
  h += section('Flows', links.length ? links.map(n => {
    const t = n.link.type === 'navigate' ? nodeOf(n.link.target) : null;
    const label = n.link.type === 'back' ? 'Back' : (t ? esc(t.name) : '<i>missing frame</i>');
    return `<div class="d-flow" data-nid="${n.id}">${esc(n.name)} <span>→</span> ${label}</div>`;
  }).join('') : '<div class="d-note">No interactions yet.</div>') +
    '<div class="d-note pad">Present (Ctrl+Enter) starts at the selected frame, or the first frame of this page.</div>';
  protoEl.innerHTML = h;
}

protoEl.addEventListener('change', e => {
  const ids = selRoots();
  if (ids.length !== 1) return;
  const n = nodeOf(ids[0]);
  if (e.target.id === 'd-link-type') {
    const v = e.target.value, frames = topLevelFrames();
    if (v === 'navigate') {
      const f = frames.find(x => x.node.id !== n.id) || frames[0];
      if (!f) { showToast('Create a frame to link to first'); renderProto(); return; }
      n.link = { type: 'navigate', target: f.node.id };
    } else n.link = v === 'back' ? { type: 'back' } : null;
    afterChange();
  } else if (e.target.id === 'd-link-target') {
    n.link = { type: 'navigate', target: e.target.value };
    afterChange();
  }
});
protoEl.addEventListener('click', e => {
  const f = e.target.closest('.d-flow');
  if (!f) return;
  const entry = byId.get(f.dataset.nid);
  if (!entry) return;
  if (entry.pageId !== D.pageId) switchPage(entry.pageId);
  setSelection([f.dataset.nid]);
});
