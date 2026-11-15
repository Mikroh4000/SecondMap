// Designs from the design editor shown inside nodes. A node references one layer (a top-level frame
// = "screen", or a component) of one design document: node.designDocId + node.designId. The design
// itself stays in its own document (see design/design-db.js), so every node showing it updates when
// that document changes. Uses the shared renderer from design/static.js.

let designDocs = new Map();   // docId -> raw design document
let designCtxs = new Map();   // docId -> docCtx(doc), see design/static.js
let designVersion = 0;        // bumped whenever the design library was (re)loaded

// Loads every design document and re-renders all nodes that show one.
async function refreshDesignEmbeds() {
  const docs = await getAllDesignDocs();
  designDocs = new Map(docs.map(d => [d.id, d]));
  designCtxs = new Map(docs.map(d => [d.id, docCtx(d)]));
  designVersion++;
  for (const n of state.nodes) {
    const el = n.designId && getNodeEl(n.id);
    if (el) renderNodeDesign(el, n);
  }
  return designDocs;
}

function openDesignInEditor(docId, layerId) {
  location.href = `design.html?design=${encodeURIComponent(docId)}#layer=${encodeURIComponent(layerId)}`;
}

const designObserver = new ResizeObserver(entries => {
  for (const entry of entries) scaleDesignEmbed(entry.target, entry.contentRect.width);
});

function scaleDesignEmbed(box, width) {
  const inner = box.firstElementChild;
  if (inner && box._w && inner.classList.contains('dn')) inner.style.transform = `scale(${width / box._w})`;
}

// Shows (or removes) the embedded design of a node. Does nothing if nothing changed.
function renderNodeDesign(el, node) {
  const body = el.querySelector('.node-body');
  let box = el.querySelector('.node-design');
  if (!node.designId) {
    if (box) { designObserver.unobserve(box); box.remove(); }
    el.classList.remove('has-design');
    if (body) body.hidden = false;
    return;
  }
  el.classList.add('has-design');
  // a design without text content does not need the empty text area below it
  if (body) body.hidden = !(node.content || '').trim();
  if (!box) {
    box = document.createElement('div');
    box.className = 'node-design';
    box.title = 'Doppelklick: im Design-Editor öffnen';
    box.addEventListener('dblclick', e => { e.stopPropagation(); openDesignInEditor(box._docId, box._id); });
    el.querySelector('.node-header').after(box);
    designObserver.observe(box);
  }
  const sig = node.designDocId + '|' + node.designId;
  if (box._sig === sig && box._version === designVersion) return;
  box._sig = sig; box._docId = node.designDocId; box._id = node.designId;
  box._version = designVersion;
  box._w = 0;
  box.className = 'node-design';
  box.style.aspectRatio = '';
  box.replaceChildren();
  const ctx = designCtxs.get(node.designDocId);
  if (!ctx) { box.textContent = 'Design wird geladen …'; box.classList.add('pending'); return; }
  const target = ctx.node(node.designId);
  if (!target) { box.textContent = 'Design nicht mehr vorhanden'; box.classList.add('missing'); return; }
  const inner = buildStatic(target, { root: true, ctx });
  inner.style.transformOrigin = '0 0';
  box._w = target.w || 1;
  box.style.aspectRatio = `${target.w || 1} / ${target.h || 1}`;
  box.appendChild(inner);
  scaleDesignEmbed(box, box.clientWidth);
}

// Fills the design picker of the edit dialog. Option values are "<designDocId>::<layerId>".
async function fillDesignSelect(select, currentDocId, currentLayerId) {
  await refreshDesignEmbeds();
  const docs = [...designDocs.values()].sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  let html = '<option value="">Kein Design</option>';
  let any = false;
  for (const doc of docs) {
    const items = listEmbeddableLayers(doc);
    if (!items.length) continue;
    any = true;
    const multiPage = new Set(items.map(i => i.page)).size > 1;
    html += `<optgroup label="${escHtml(doc.name)}">${items.map(i =>
      `<option value="${doc.id}::${i.id}">${i.component ? '◆ ' : ''}${escHtml(i.name)}${multiPage ? ' – ' + escHtml(i.page) : ''}</option>`).join('')}</optgroup>`;
  }
  select.innerHTML = html;
  const curVal = currentLayerId ? `${currentDocId}::${currentLayerId}` : '';
  if (curVal && ![...select.options].some(o => o.value === curVal)) select.insertAdjacentHTML('beforeend', `<option value="${escHtml(curVal)}">(fehlendes Design)</option>`);
  select.value = curVal;
  if (!any) select.title = 'Im Design-Editor zuerst einen Frame oder eine Komponente erstellen';
}

window.addEventListener('pageshow', e => { if (e.persisted) refreshDesignEmbeds(); });
refreshDesignEmbeds();
