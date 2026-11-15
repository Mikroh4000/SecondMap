// Designs from the design editor shown inside nodes. A node references a top-level frame (screen) or a
// component by id (node.designId); the design itself stays in the editor's storage, so every node showing
// it is updated when the design changes. Uses the shared renderer from design/static.js.

const DESIGN_DB = 'secondmap-design';
let designDoc = null;
let designCtx = null;
let designVersion = 0; // bumped whenever the design document was (re)loaded

function readDesignDoc() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(DESIGN_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction('kv').objectStore('kv').get('doc');
        get.onsuccess = () => { db.close(); resolve(get.result || null); };
        get.onerror = () => { db.close(); resolve(null); };
      };
    } catch (_) { resolve(null); }
  });
}

// Loads the saved design document and re-renders every node that shows a design.
async function refreshDesignEmbeds() {
  const doc = await readDesignDoc();
  designDoc = doc && Array.isArray(doc.pages) ? doc : { pages: [], assets: [] };
  designCtx = docCtx(designDoc);
  designVersion++;
  for (const n of state.nodes) {
    const el = n.designId && getNodeEl(n.id);
    if (el) renderNodeDesign(el, n);
  }
  return designDoc;
}

// Everything that can be embedded: top-level frames and components.
function listEmbeddableDesigns() {
  const out = [];
  if (!designDoc) return out;
  for (const p of designDoc.pages) {
    const walk = (list, top) => {
      for (const n of list) {
        if ((top && n.type === 'frame') || n.isComponent) out.push({ id: n.id, name: n.name, page: p.name, component: !!n.isComponent });
        if (n.children) walk(n.children, false);
      }
    };
    walk(p.children, true);
  }
  return out;
}

function openDesignInEditor(id) {
  location.href = 'design.html#layer=' + encodeURIComponent(id);
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
    box.addEventListener('dblclick', e => { e.stopPropagation(); openDesignInEditor(box._id); });
    el.querySelector('.node-header').after(box);
    designObserver.observe(box);
  }
  if (box._id === node.designId && box._version === designVersion) return;
  box._id = node.designId;
  box._version = designVersion;
  box._w = 0;
  box.className = 'node-design';
  box.style.aspectRatio = '';
  box.replaceChildren();
  if (!designDoc) { box.textContent = 'Design wird geladen …'; box.classList.add('pending'); return; }
  const target = designCtx.node(node.designId);
  if (!target) { box.textContent = 'Design nicht mehr vorhanden'; box.classList.add('missing'); return; }
  const inner = buildStatic(target, { root: true, ctx: designCtx });
  inner.style.transformOrigin = '0 0';
  box._w = target.w || 1;
  box.style.aspectRatio = `${target.w || 1} / ${target.h || 1}`;
  box.appendChild(inner);
  scaleDesignEmbed(box, box.clientWidth);
}

// Fills the design picker of the edit dialog.
async function fillDesignSelect(select, currentId) {
  await refreshDesignEmbeds();
  const items = listEmbeddableDesigns();
  const pages = [...new Set(items.map(i => i.page))];
  select.innerHTML = '<option value="">Kein Design</option>' + pages.map(p =>
    `<optgroup label="${escHtml(p)}">${items.filter(i => i.page === p).map(i =>
      `<option value="${i.id}">${i.component ? '◆ ' : ''}${escHtml(i.name)}</option>`).join('')}</optgroup>`).join('');
  if (currentId && !items.some(i => i.id === currentId)) select.insertAdjacentHTML('beforeend', `<option value="${escHtml(currentId)}">(fehlendes Design)</option>`);
  select.value = currentId || '';
  if (!items.length) select.title = 'Im Design-Editor zuerst einen Frame oder eine Komponente erstellen';
}

window.addEventListener('pageshow', e => { if (e.persisted) refreshDesignEmbeds(); });
refreshDesignEmbeds();
