// Node and edge edit dialogs.

// ─── EDIT MODAL ──────────────────────────────────────────────────
function openEdit(id) {
  const n = state.nodes.find(n => n.id === id);
  if (!n) return;
  selectNode(id);

  const oldData = { title: n.title, content: n.content, color: n.color, template: n.template, priority: n.priority, width: n.width, subMapId: n.subMapId, tags: [...(n.tags||[])], favorite: n.favorite, attachments: [...(n.attachments||[])] };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title">Block bearbeiten</div>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Titel</label>
          <input class="form-input" id="edit-title" value="${escHtml(n.title || '')}" placeholder="Titel..."/>
        </div>
        <div class="form-group">
          <label class="form-label">Inhalt (Markdown, Links erlaubt)</label>
          <textarea class="form-textarea" id="edit-content" placeholder="Inhalt...">${escHtml(n.content || '')}</textarea>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <button class="tb-btn" id="edit-insert-image-btn" style="font-size:12px">🖼 Bild einfügen</button>
            <span class="form-hint">PNG/JPG als Inline-Bild (max. 2 MB)</span>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label class="form-label">Template</label>
            <select class="form-input" id="edit-template">
              <option value="">Keins</option>
              ${Object.entries(NODE_TEMPLATES).map(([k,v]) => `<option value="${k}" ${n.template===k?'selected':''}>${v.icon} ${v.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">Priorität</label>
            <select class="form-input" id="edit-priority">
              <option value="">Keine</option>
              ${Object.entries(PRIORITIES).map(([k,v]) => `<option value="${k}" ${n.priority===k?'selected':''}>${v.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Farbe</label>
          <div class="color-picker-row" id="color-picker-row"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Tags</label>
          <div id="edit-tags" class="tag-chips"></div>
          <input class="form-input" id="edit-tag-input" placeholder="Tag eingeben + Enter" style="margin-top:6px"/>
        </div>
        <div class="form-group">
          <label class="form-label">Dateianhänge</label>
          <div id="edit-attachments" class="attach-list"></div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <button class="tb-btn" id="edit-attach-btn" style="font-size:12px">📎 Datei anhängen</button>
            <span class="form-hint">Max. 5 MB pro Datei</span>
          </div>
        </div>
        <div class="form-group">
          <label class="edge-toggle-label">
            <input type="checkbox" id="edit-favorite" ${n.favorite ? 'checked' : ''}/>
            <span>★ Als Favorit markieren</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-label">Sub-Map</label>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="form-hint" id="submap-info" style="flex:1">${n.subMapId ? 'Verknüpft (Doppelklick zum Öffnen)' : 'Keine Sub-Map'}</span>
            <button class="tb-btn" id="edit-create-submap" style="font-size:12px">${n.subMapId ? 'Sub-Map öffnen' : 'Sub-Map erstellen'}</button>
          </div>
        </div>
        ${n.parentId ? `<div class="form-group" id="edit-parent-wrap">
          <label class="form-label">Eltern-Block</label>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="form-hint" id="edit-parent-info" style="flex:1"></span>
            <button class="tb-btn" id="edit-detach-parent" style="font-size:12px">Ablösen</button>
          </div>
        </div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="tb-btn" onclick="this.closest('.modal-backdrop').remove()">Abbrechen</button>
        <button class="tb-btn accent" id="edit-save">Speichern</button>
      </div>
    </div>
  `;

  const colorRow = backdrop.querySelector('#color-picker-row');
  NODE_COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'color-option' + (n.color === c ? ' selected' : '');
    dot.style.background = c;
    dot.addEventListener('click', () => {
      colorRow.querySelectorAll('.color-option').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
    });
    colorRow.appendChild(dot);
  });

  // Template change auto-sets color
  const tplSelect = backdrop.querySelector('#edit-template');
  tplSelect.addEventListener('change', () => {
    const tpl = NODE_TEMPLATES[tplSelect.value];
    if (tpl) {
      colorRow.querySelectorAll('.color-option').forEach(d => {
        d.classList.toggle('selected', d.style.background === tpl.color || rgb2hex(d.style.background) === tpl.color);
      });
    }
  });

  // Tags
  const tagsContainer = backdrop.querySelector('#edit-tags');
  const tagInput = backdrop.querySelector('#edit-tag-input');
  let editTags = [...(n.tags || [])];
  function renderEditTags() {
    tagsContainer.innerHTML = editTags.map((t, i) =>
      `<span class="tag-chip">${escHtml(t)}<button class="tag-remove" data-idx="${i}">×</button></span>`
    ).join('');
    tagsContainer.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', () => { editTags.splice(parseInt(btn.dataset.idx), 1); renderEditTags(); });
    });
  }
  renderEditTags();
  tagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const tag = tagInput.value.trim();
      if (tag && !editTags.includes(tag)) { editTags.push(tag); renderEditTags(); }
      tagInput.value = '';
    }
    e.stopPropagation();
  });

  // Insert inline image into content
  backdrop.querySelector('#edit-insert-image-btn').addEventListener('click', () => {
    const imgInput = document.createElement('input');
    imgInput.type = 'file';
    imgInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
    imgInput.onchange = async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { showToast('Bild zu groß (max. 2 MB)'); return; }
      const data = await fileToBase64(file);
      const markdown = `![${file.name}](${data})`;
      const ta = backdrop.querySelector('#edit-content');
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = ta.value.substring(0, start);
      const after = ta.value.substring(end);
      ta.value = before + (before && !before.endsWith('\n') ? '\n' : '') + markdown + (after && !after.startsWith('\n') ? '\n' : '') + after;
      ta.selectionStart = ta.selectionEnd = start + markdown.length;
      ta.focus();
    };
    imgInput.click();
  });

  // Attachments
  const attachList = backdrop.querySelector('#edit-attachments');
  let editAttachments = [...(n.attachments || [])];
  function renderEditAttachments() {
    attachList.innerHTML = editAttachments.map((a, i) =>
      `<div class="attach-item">
        <span class="attach-name">${escHtml(a.name)}</span>
        <span class="attach-size">${formatFileSize(a.size)}</span>
        <button class="attach-dl" data-idx="${i}" title="Herunterladen">⬇</button>
        <button class="attach-rm" data-idx="${i}" title="Entfernen">×</button>
      </div>`
    ).join('');
    attachList.querySelectorAll('.attach-dl').forEach(btn => {
      btn.addEventListener('click', () => downloadAttachment(editAttachments[parseInt(btn.dataset.idx)]));
    });
    attachList.querySelectorAll('.attach-rm').forEach(btn => {
      btn.addEventListener('click', () => { editAttachments.splice(parseInt(btn.dataset.idx), 1); renderEditAttachments(); });
    });
  }
  renderEditAttachments();
  backdrop.querySelector('#edit-attach-btn').addEventListener('click', () => {
    const fileInput = $('file-attach');
    fileInput.onchange = async (ev) => {
      for (const file of ev.target.files) {
        if (file.size > 5 * 1024 * 1024) { showToast(`${file.name} ist zu groß (max. 5 MB)`); continue; }
        const data = await fileToBase64(file);
        editAttachments.push({ name: file.name, type: file.type, size: file.size, data });
        renderEditAttachments();
      }
      fileInput.value = '';
    };
    fileInput.click();
  });

  // Sub-map button
  backdrop.querySelector('#edit-create-submap').addEventListener('click', async () => {
    if (n.subMapId) {
      backdrop.remove();
      openSubMap(id);
    } else {
      await createSubMapForNode(id);
      backdrop.querySelector('#submap-info').textContent = 'Verknüpft (Doppelklick zum Öffnen)';
      backdrop.querySelector('#edit-create-submap').textContent = 'Sub-Map öffnen';
    }
  });

  // Parent detach button
  if (n.parentId) {
    const parentNode = state.nodes.find(x => x.id === n.parentId);
    backdrop.querySelector('#edit-parent-info').textContent = parentNode ? `Kind von \u201e${parentNode.title}\u201c` : 'Eltern nicht gefunden';
    backdrop.querySelector('#edit-detach-parent').addEventListener('click', async () => {
      const oldParentId = n.parentId;
      n.parentId = null;
      await saveNode(n);
      pushUndo({ type: 'edit-node', id: n.id, oldData: { parentId: oldParentId }, newData: { parentId: null } });
      const pw = backdrop.querySelector('#edit-parent-wrap');
      if (pw) pw.style.display = 'none';
      removeNodeEl(n.id);
      renderNode(n);
      refreshCollapsedState();
      showToast('Vom Eltern-Block abgelöst');
    });
  }

  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  backdrop.querySelector('#edit-save').addEventListener('click', async () => {
    const newData = {
      title: backdrop.querySelector('#edit-title').value,
      content: backdrop.querySelector('#edit-content').value,
      template: tplSelect.value || null,
      priority: backdrop.querySelector('#edit-priority').value || null,
      color: n.color,
      width: n.width,
      subMapId: n.subMapId,
      tags: editTags,
      favorite: backdrop.querySelector('#edit-favorite').checked,
      attachments: editAttachments
    };
    const sel = colorRow.querySelector('.color-option.selected');
    if (sel) newData.color = rgb2hex(sel.style.background) || sel.style.background;

    Object.assign(n, newData);
    await saveNode(n);
    pushUndo({ type: 'edit-node', id: n.id, oldData, newData: {...newData} });
    await updateMapTimestamp();
    removeNodeEl(n.id);
    renderNode(n);
    renderEdges();
    backdrop.remove();
    showToast('Gespeichert', 'success');
  });

  document.body.appendChild(backdrop);
  setTimeout(() => backdrop.querySelector('#edit-title').focus(), 50);
}
window.openEdit = openEdit;

function rgb2hex(rgb) {
  if (!rgb || rgb.startsWith('#')) return rgb;
  const m = rgb.match(/(\d+)/g);
  if (!m || m.length < 3) return rgb;
  return '#' + m.slice(0,3).map(x => parseInt(x).toString(16).padStart(2,'0')).join('');
}
