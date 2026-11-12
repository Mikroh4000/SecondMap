// Folder management for organising maps in the sidebar.

// ─── FOLDER MANAGEMENT ───────────────────────────────────────────
async function getAllFolders() {
  return new Promise(res => { const r = dbStore('folders').getAll(); r.onsuccess = () => res(r.result || []); });
}

async function saveFolder(folder) {
  return new Promise(res => { dbStore('folders', 'readwrite').put(folder).onsuccess = res; });
}

async function deleteFolderFromDB(id) {
  return new Promise(res => { dbStore('folders', 'readwrite').delete(id).onsuccess = res; });
}

async function createNewFolder(name, parentFolderId = null) {
  const folders = await getAllFolders();
  const parent = parentFolderId ? folders.find(f => f.id === parentFolderId) : null;
  let fsPath = null;
  const createdPath = await tauriInvoke('create_folder_on_disk', {
    name: name || 'Neuer Ordner',
    parentPath: parent?.fsPath || null,
  });
  if (createdPath && typeof createdPath === 'string') fsPath = createdPath;

  const folder = {
    id: uid(),
    name: name || 'Neuer Ordner',
    created: Date.now(),
    parentId: parentFolderId,
    color: '#666',
    fsPath,
    expanded: true,
  };
  await saveFolder(folder);
  return folder;
}

async function rebaseChildFolderPaths(parentFolderId, oldParentPath, newParentPath) {
  if (!oldParentPath || !newParentPath) return;
  const folders = await getAllFolders();
  for (const child of folders.filter(f => f.parentId === parentFolderId)) {
    if (child.fsPath && child.fsPath.startsWith(oldParentPath)) {
      child.fsPath = newParentPath + child.fsPath.slice(oldParentPath.length);
      await saveFolder(child);
    }
    await rebaseChildFolderPaths(child.id, oldParentPath, newParentPath);
  }
}

async function renameFolder(folderId) {
  const folders = await getAllFolders();
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="width:400px">
      <div class="modal-header">
        <div class="modal-title">Ordner umbenennen</div>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="rename-input" value="${escHtml(folder.name)}" placeholder="Name..." autocomplete="off"/>
        </div>
      </div>
      <div class="modal-footer">
        <button class="tb-btn" onclick="this.closest('.modal-backdrop').remove()">Abbrechen</button>
        <button class="tb-btn accent" id="rename-save">Speichern</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  const input = backdrop.querySelector('#rename-input');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') backdrop.querySelector('#rename-save').click(); e.stopPropagation(); });
  backdrop.querySelector('#rename-save').addEventListener('click', async () => {
    const name = input.value.trim() || 'Neuer Ordner';
    const oldPath = folder.fsPath || null;
    const parent = folder.parentId ? folders.find(f => f.id === folder.parentId) : null;
    const renamedPath = oldPath
      ? await tauriInvoke('rename_folder_on_disk', { path: oldPath, newName: name })
      : await tauriInvoke('create_folder_on_disk', { name, parentPath: parent?.fsPath || null });
    folder.name = name;
    if (renamedPath && typeof renamedPath === 'string') {
      folder.fsPath = renamedPath;
      await rebaseChildFolderPaths(folder.id, oldPath, renamedPath);
    }
    await saveFolder(folder);
    renderSidebar();
    backdrop.remove();
    showToast('Ordner umbenannt', 'success');
  });
  document.body.appendChild(backdrop);
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

async function deleteFolderById(folderId) {
  const folders = await getAllFolders();
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  if (!confirm(`Ordner "${folder.name}" löschen? (Mindmaps bleiben erhalten)`)) return;

  // Unassign maps from this folder
  const maps = await getAllMaps();
  for (const map of maps.filter(m => m.folderId === folderId)) {
    map.folderId = null;
    await saveMap(map);
  }

  // Delete subfolders
  const subfolders = folders.filter(f => f.parentId === folderId);
  for (const subfolder of subfolders) {
    await deleteFolderById(subfolder.id);
  }

  if (folder.fsPath) {
    await tauriInvoke('delete_folder_on_disk', { path: folder.fsPath });
  }

  await deleteFolderFromDB(folderId);
  renderSidebar();
  showToast('Ordner gelöscht', 'success');
}

window.renameFolder = renameFolder;
window.deleteFolderById = deleteFolderById;
