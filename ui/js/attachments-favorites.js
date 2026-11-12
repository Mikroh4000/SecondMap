// Node attachments and the favorites dropdown.

// ─── HELPERS (Attachments) ────────────────────────────────────────
function fileToBase64(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function downloadAttachment(attachment) {
  const a = document.createElement('a');
  a.href = attachment.data;
  a.download = attachment.name;
  a.click();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── FAVORITES ───────────────────────────────────────────────────
async function toggleFavorite(nodeId) {
  const n = state.nodes.find(x => x.id === nodeId);
  if (!n) return;
  const oldFav = !!n.favorite;
  n.favorite = !oldFav;
  await saveNode(n);
  pushUndo({ type: 'edit-node', id: n.id, oldData: { favorite: oldFav }, newData: { favorite: n.favorite } });
  renderNode(n);
  showToast(n.favorite ? 'Als Favorit markiert' : 'Favorit entfernt');
}
window.toggleFavorite = toggleFavorite;

function openFavoritesPanel() {
  const favNodes = state.nodes.filter(n => n.favorite);
  if (favNodes.length === 0) { showToast('Keine Favoriten vorhanden'); return; }

  const existing = document.querySelector('.favorites-dropdown');
  if (existing) { existing.remove(); return; }

  const btn = $('btn-favorites');
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'favorites-dropdown';
  dd.style.top = rect.bottom + 4 + 'px';
  dd.style.left = Math.max(8, rect.left - 100) + 'px';

  dd.innerHTML = `<div class="fav-dd-title">★ Favoriten (${favNodes.length})</div>` +
    favNodes.map(n => `<div class="fav-dd-item" data-id="${n.id}">
      <span class="fav-dd-color" style="background:${n.color || '#444'}"></span>
      <span class="fav-dd-name">${escHtml(n.title || 'Ohne Titel')}</span>
    </div>`).join('');

  dd.querySelectorAll('.fav-dd-item').forEach(item => {
    item.addEventListener('click', () => {
      const nodeId = item.dataset.id;
      const n = state.nodes.find(x => x.id === nodeId);
      if (n) {
        selectNode(nodeId);
        const el = getNodeEl(nodeId);
        const w = el ? el.offsetWidth : (n.width || 220);
        const h = el ? el.offsetHeight : 80;
        const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
        state.transform.x = cx - (n.x + w / 2) * state.transform.scale;
        state.transform.y = cy - (n.y + h / 2) * state.transform.scale;
        applyTransform(); drawMinimap();
      }
      dd.remove();
    });
  });

  document.body.appendChild(dd);
  const close = (e) => { if (!dd.contains(e.target) && e.target !== btn) { dd.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}
