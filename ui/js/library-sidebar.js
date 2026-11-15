// Library sidebar (Mind maps + Designs): shared by index.html and design.html so both platforms
// open the exact same "Mindmaps / Designs" panel (see shared-sidebar.css for the markup it fills).
// It adapts to whichever page loaded it: index.html already has a rich Mindmaps renderer
// (ui/js/sidebar.js's renderSidebar()) which is reused as-is; design.html gets a light one here,
// built on ui/js/maps-lite.js. The Designs tab is identical on both pages (ui/design/design-db.js).

const LIB_LANG = document.documentElement.lang === 'de' ? 'de' : 'en';
const LIB_T = {
  de: { newMindmap: 'Neue Mindmap', newDesign: 'Neues Design', rename: 'Umbenennen', del: 'Löschen', blocks: 'Blöcke', screens: 'Screens', noDesigns: 'Keine Designs vorhanden.', noMaps: 'Keine Mindmaps vorhanden.', lastDesign: 'Letztes Design kann nicht gelöscht werden', lastMap: 'Letzte Mindmap kann nicht gelöscht werden', confirmDesign: n => `Design "${n}" löschen?`, confirmMap: n => `Mindmap "${n}" löschen?` },
  en: { newMindmap: 'New mind map', newDesign: 'New design', rename: 'Rename', del: 'Delete', blocks: 'blocks', screens: 'screens', noDesigns: 'No designs yet.', noMaps: 'No mind maps yet.', lastDesign: "You can't delete the last design", lastMap: "You can't delete the last mind map", confirmDesign: n => `Delete design "${n}"?`, confirmMap: n => `Delete mind map "${n}"?` },
}[LIB_LANG];

const LIB_RENAME_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3L11 2z"/></svg>';
const LIB_DELETE_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>';

// index.html has escHtml() (js/utils.js), design.html has esc() (design/render.js); this helper works on both.
function libEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

let activeLibraryTab = document.getElementById('sidebar-tabs')?.dataset.defaultTab || 'mindmaps';

// index.html defines its own richer toggleSidebar() (folders, drag & drop); design.html gets this one.
if (typeof window.toggleSidebar !== 'function') {
  window.toggleSidebar = function toggleSidebar(open) {
    const sidebar = $('sidebar'), overlay = $('sidebar-overlay');
    const shouldOpen = open !== undefined ? open : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', shouldOpen);
    overlay.classList.toggle('open', shouldOpen);
    if (shouldOpen) renderLibraryActiveTab();
  };
}

function updateLibraryNewBtnLabel() {
  const label = $('sidebar-new-label');
  if (label) label.textContent = activeLibraryTab === 'designs' ? LIB_T.newDesign : LIB_T.newMindmap;
}

// Rapid tab switching can start overlapping async renders that resolve out of order; each call tags
// itself with a generation number and, if a newer one was issued meanwhile, re-renders once more after
// finishing so the DOM always ends up matching the tab that is current when things settle.
let libRenderGen = 0;
async function renderLibraryActiveTab() {
  const gen = ++libRenderGen;
  if (activeLibraryTab === 'designs') await renderDesignsTabList();
  // index.html already has a full Mindmaps renderer (folders, drag & drop); reuse it unchanged.
  else if (typeof renderSidebar === 'function') await renderSidebar();
  else await renderMindmapsTabList();
  if (gen !== libRenderGen) await renderLibraryActiveTab();
}

// A name label is swapped for an <input>; Enter/blur saves, Escape cancels.
function libInlineRename(host, value, onSave) {
  const input = document.createElement('input');
  input.className = 'd-rename';
  input.value = value;
  input.style.cssText = 'width:100%;background:var(--bg);border:1px solid var(--accent);border-radius:4px;padding:2px 6px;color:var(--text);font:inherit';
  host.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    if (ok && input.value.trim()) onSave(input.value.trim());
    else renderLibraryActiveTab();
  };
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', e => e.stopPropagation());
}

function openDesignFromLibrary(id) {
  if (typeof switchDesign === 'function') { switchDesign(id); toggleSidebar(false); }
  else location.href = 'design.html?design=' + encodeURIComponent(id);
}

async function libRenameDesign(nameEl, doc) {
  libInlineRename(nameEl, doc.name, async name => {
    await renameDesignDoc(doc.id, name);
    if (typeof D !== 'undefined' && D.doc && D.doc.id === doc.id) { D.doc.name = name; if (typeof renderDesignsList === 'function') renderDesignsList(); }
    renderLibraryActiveTab();
  });
}

async function libDeleteDesign(id, name, totalCount) {
  if (totalCount < 2) { showToast(LIB_T.lastDesign); return; }
  if (!confirm(LIB_T.confirmDesign(name))) return;
  // deleteDesignPrompt() (design.html only) also switches the editor away if this design is open.
  if (typeof deleteDesignPrompt === 'function' && typeof D !== 'undefined' && D.doc && D.doc.id === id) await deleteDesignPrompt(id);
  else await deleteDesignDoc(id);
  renderLibraryActiveTab();
}

async function renderDesignsTabList() {
  const list = $('sidebar-list');
  if (!list) return;
  const docs = await ensureDesignLibrary();
  docs.sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  const currentId = (typeof D !== 'undefined' && D.doc) ? D.doc.id : null;
  list.innerHTML = '';
  for (const doc of docs) {
    const screens = listEmbeddableLayers(doc).filter(l => !l.component).length;
    const date = new Date(doc.updated || doc.created);
    const dateStr = date.toLocaleString(LIB_LANG === 'de' ? 'de-DE' : 'en-US', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (doc.id === currentId ? ' active' : '');
    item.innerHTML = `
      <div class="sidebar-item-info">
        <div class="sidebar-item-name"></div>
        <div class="sidebar-item-meta">${screens} ${libEsc(LIB_T.screens)} · ${libEsc(dateStr)}</div>
      </div>
      <div class="sidebar-item-actions">
        <button class="sidebar-action-btn rename-btn" title="${LIB_T.rename}">${LIB_RENAME_SVG}</button>
        <button class="sidebar-action-btn del" title="${LIB_T.del}">${LIB_DELETE_SVG}</button>
      </div>`;
    item.querySelector('.sidebar-item-name').textContent = doc.name;
    item.querySelector('.sidebar-item-info').addEventListener('click', () => openDesignFromLibrary(doc.id));
    item.querySelector('.rename-btn').addEventListener('click', e => { e.stopPropagation(); libRenameDesign(item.querySelector('.sidebar-item-name'), doc); });
    item.querySelector('.del').addEventListener('click', e => { e.stopPropagation(); libDeleteDesign(doc.id, doc.name, docs.length); });
    list.appendChild(item);
  }
  if (!docs.length) list.innerHTML = `<div class="d-empty" style="padding:16px">${libEsc(LIB_T.noDesigns)}</div>`;
  const footer = $('sidebar-footer');
  if (footer) footer.textContent = LIB_LANG === 'de' ? `${docs.length} Design${docs.length !== 1 ? 's' : ''} · Lokal gespeichert` : `${docs.length} design${docs.length !== 1 ? 's' : ''} · Stored locally`;
}

// Light Mindmaps tab renderer for design.html (no folders; index.html keeps its own full version).
async function renderMindmapsTabList() {
  const list = $('sidebar-list');
  if (!list) return;
  const maps = await listMapsLite();
  maps.sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  list.innerHTML = '';
  for (const map of maps) {
    const date = new Date(map.updated || map.created);
    const dateStr = date.toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    item.innerHTML = `
      <div class="sidebar-item-info">
        <div class="sidebar-item-name"></div>
        <div class="sidebar-item-meta">${map.nodeCount} ${libEsc(LIB_T.blocks)} · ${libEsc(dateStr)}</div>
      </div>
      <div class="sidebar-item-actions">
        <button class="sidebar-action-btn rename-btn" title="${LIB_T.rename}">${LIB_RENAME_SVG}</button>
        <button class="sidebar-action-btn del" title="${LIB_T.del}">${LIB_DELETE_SVG}</button>
      </div>`;
    item.querySelector('.sidebar-item-name').textContent = map.name;
    item.querySelector('.sidebar-item-info').addEventListener('click', () => { location.href = 'index.html?map=' + encodeURIComponent(map.id); });
    item.querySelector('.rename-btn').addEventListener('click', e => {
      e.stopPropagation();
      libInlineRename(item.querySelector('.sidebar-item-name'), map.name, async name => { await renameMapLite(map.id, name); renderLibraryActiveTab(); });
    });
    item.querySelector('.del').addEventListener('click', async e => {
      e.stopPropagation();
      if (maps.length < 2) { showToast(LIB_T.lastMap); return; }
      if (!confirm(LIB_T.confirmMap(map.name))) return;
      await deleteMapLite(map.id);
      renderLibraryActiveTab();
    });
    list.appendChild(item);
  }
  if (!maps.length) list.innerHTML = `<div class="d-empty" style="padding:16px">${libEsc(LIB_T.noMaps)}</div>`;
  const footer = $('sidebar-footer');
  if (footer) footer.textContent = `${maps.length} mind map${maps.length !== 1 ? 's' : ''} · Stored locally`;
}

async function libCreateDesignAndRender() {
  if (typeof createDesignAndSwitch === 'function') { await createDesignAndSwitch(); renderLibraryActiveTab(); return; }
  const doc = await createDesignDoc(LIB_T.newDesign);
  openDesignFromLibrary(doc.id);
}

async function libCreateMapAndRender() {
  const map = await createMapLite(LIB_T.newMindmap);
  location.href = 'index.html?map=' + encodeURIComponent(map.id);
}

$('sidebar-tabs')?.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  activeLibraryTab = b.dataset.tab;
  document.querySelectorAll('#sidebar-tabs button').forEach(x => x.classList.toggle('active', x === b));
  updateLibraryNewBtnLabel();
  renderLibraryActiveTab();
});

$('sidebar-new-btn')?.addEventListener('click', async e => {
  if (activeLibraryTab === 'designs') { e.stopPropagation(); await libCreateDesignAndRender(); return; }
  if (typeof renderSidebar === 'function') return; // index.html's sidebar.js already handles this tab
  e.stopPropagation();
  await libCreateMapAndRender();
});

$('d-btn-library')?.addEventListener('click', () => toggleSidebar());
$('sidebar-close-btn')?.addEventListener('click', () => toggleSidebar(false));
$('sidebar-overlay')?.addEventListener('click', () => toggleSidebar(false));

updateLibraryNewBtnLabel();
