// Sidebar UI: map and folder list, toggling the sidebar.

// ─── SIDEBAR UI ──────────────────────────────────────────────────
function toggleSidebar(open) {
  const sidebar = $('sidebar'), overlay = $('sidebar-overlay');
  const isOpen = sidebar.classList.contains('open');
  const shouldOpen = open !== undefined ? open : !isOpen;
  sidebar.classList.toggle('open', shouldOpen);
  overlay.classList.toggle('open', shouldOpen);
  if (shouldOpen) renderSidebar();
}

async function renderSidebar() {
  const maps = await getAllMaps();
  const folders = await getAllFolders();
  maps.sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  const allNodes = await new Promise(res => { const r = dbStore('nodes').getAll(); r.onsuccess = () => res(r.result || []); });
  const nodeCounts = new Map();
  for (const n of allNodes) nodeCounts.set(n.mapId, (nodeCounts.get(n.mapId) || 0) + 1);
  
  const list = $('sidebar-list');
  list.innerHTML = '';

  // Build folder tree
  const rootFolders = folders.filter(f => !f.parentId);

  // Render root folder maps
  const rootMaps = maps.filter(m => !m.folderId);
  
  // Helper to render folder and its contents
  async function renderFolder(folder, level = 0) {
    const subFolders = folders.filter(f => f.parentId === folder.id);
    const folderMaps = maps.filter(m => m.folderId === folder.id);
    
    const folderEl = document.createElement('div');
    folderEl.className = 'sidebar-folder' + (folder.expanded ? '' : ' collapsed');
    folderEl.dataset.folderId = folder.id;
    folderEl.style.paddingLeft = (level * 16) + 'px';
    
    const header = document.createElement('div');
    header.className = 'sidebar-folder-header';
    header.innerHTML = `
      <span class="folder-toggle">${folder.expanded ? '▼' : '▶'}</span>
      <svg class="folder-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M2 2h5l1 2h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
      </svg>
      <span class="folder-name">${escHtml(folder.name)}</span>
      <div class="folder-actions">
        <button class="folder-action-btn" title="Ordner hinzufügen">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>
        </button>
        <button class="folder-action-btn rename-btn" title="Umbenennen">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3L11 2z"/></svg>
        </button>
        <button class="folder-action-btn del" title="Löschen">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
        </button>
      </div>
    `;
    
    header.querySelector('.folder-toggle').addEventListener('click', async e => {
      e.stopPropagation();
      folder.expanded = !folder.expanded;
      await saveFolder(folder);
      renderSidebar();
    });

    header.querySelector('.folder-action-btn:nth-of-type(1)').addEventListener('click', async e => {
      e.stopPropagation();
      const newFolder = await createNewFolder('Neuer Ordner', folder.id);
      folder.expanded = true;
      await saveFolder(folder);
      renderSidebar();
    });

    header.querySelector('.rename-btn').addEventListener('click', e => {
      e.stopPropagation();
      renameFolder(folder.id);
    });

    header.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      deleteFolderById(folder.id);
    });

    // Tauri WebView works reliably with text/plain data transfer
    header.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      header.classList.add('drag-over');
    });
    header.addEventListener('dragleave', () => header.classList.remove('drag-over'));
    header.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      header.classList.remove('drag-over');
      const mapId = e.dataTransfer.getData('application/x-secondmap-mapid') || e.dataTransfer.getData('text/plain');
      if (!mapId) return;
      const map = maps.find(m => m.id === mapId);
      if (!map) return;
      if (map.folderId === folder.id) return;
      map.folderId = folder.id;
      folder.expanded = true;
      await saveMap(map);
      await saveFolder(folder);
      await renderSidebar();
    });

    folderEl.appendChild(header);

    if (folder.expanded) {
      // Render subfolder maps
      for (const map of folderMaps) {
        const item = await createMapElement(map);
        item.style.paddingLeft = ((level + 1) * 16) + 'px';
        item.classList.add('sidebar-item-in-folder');
        folderEl.appendChild(item);
      }

      // Render subfolders
      for (const subFolder of subFolders) {
        const subEl = await renderFolder(subFolder, level + 1);
        folderEl.appendChild(subEl);
      }
    }

    return folderEl;
  }

  // Helper to create map element
  async function createMapElement(map) {
    const isActive = map.id === currentMapId;
    const count = nodeCounts.get(map.id) || 0;
    const date = new Date(map.updated || map.created);
    const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (isActive ? ' active' : '');
    item.draggable = true;
    item.innerHTML = `
      <div class="sidebar-item-info">
        <div class="sidebar-item-name">${escHtml(map.name)}</div>
        <div class="sidebar-item-meta">${count} Blöcke · ${dateStr}</div>
      </div>
      <div class="sidebar-item-actions">
        <button class="sidebar-action-btn rename-btn" title="Umbenennen">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3L11 2z"/></svg>
        </button>
        <button class="sidebar-action-btn del" title="Löschen">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
        </button>
      </div>
    `;
    item.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-secondmap-mapid', map.id);
      e.dataTransfer.setData('text/plain', map.id);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.querySelector('.sidebar-item-info').addEventListener('click', async () => {
      if (map.id !== currentMapId) { await switchToMap(map.id); toggleSidebar(false); }
    });
    item.querySelector('.rename-btn').addEventListener('click', e => { e.stopPropagation(); renameMap(map.id); });
    item.querySelector('.del').addEventListener('click', e => { e.stopPropagation(); deleteMapById(map.id); });
    
    return item;
  }

  // Render root folders
  for (const folder of rootFolders) {
    list.appendChild(await renderFolder(folder));
  }

  // Render root maps
  for (const map of rootMaps) {
    list.appendChild(await createMapElement(map));
  }

  $('sidebar-footer').textContent = `${maps.length} Mindmap${maps.length !== 1 ? 's' : ''} · Lokal gespeichert`;
}

$('btn-sidebar').addEventListener('click', () => toggleSidebar());
$('sidebar-close-btn').addEventListener('click', () => toggleSidebar(false));
$('sidebar-overlay').addEventListener('click', () => toggleSidebar(false));
$('sidebar-new-btn').addEventListener('click', async e => {
  e.stopPropagation();
  const menu = document.createElement('div');
  menu.className = 'sidebar-new-menu';
  menu.innerHTML = `
    <button class="sidebar-new-item" id="new-map-btn">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/><line x1="5" y1="6" x2="11" y2="6"/><line x1="5" y1="10" x2="9" y2="10"/></svg>
      Neue Mindmap
    </button>
    <button class="sidebar-new-item" id="new-folder-btn">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2h5l1 2h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/></svg>
      Neuer Ordner
    </button>
  `;
  $('sidebar').appendChild(menu);
  
  menu.querySelector('#new-map-btn').addEventListener('click', async () => {
    const map = await createNewMap('Neue Mindmap');
    await switchToMap(map.id);
    toggleSidebar(false);
    showToast('Neue Mindmap erstellt', 'success');
    renameMap(map.id);
    menu.remove();
  });

  menu.querySelector('#new-folder-btn').addEventListener('click', async () => {
    const folder = await createNewFolder('Neuer Ordner');
    renderSidebar();
    renameFolder(folder.id);
    menu.remove();
  });

  document.addEventListener('click', function removeMenu(e) {
    if (!menu.contains(e.target) && e.target !== $('sidebar-new-btn')) {
      menu.remove();
      document.removeEventListener('click', removeMenu);
    }
  });
});
