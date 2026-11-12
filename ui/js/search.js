// Search and filter across nodes and maps.

// ─── SEARCH & FILTER ─────────────────────────────────────────────
function openSearchPanel() {
  const panel = $('search-panel');
  panel.classList.add('open');
  const input = $('search-input');
  input.value = '';
  input.focus();

  // Populate color filter
  const colorFilter = $('filter-color');
  if (colorFilter.options.length <= 1) {
    NODE_COLORS.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      opt.style.background = c;
      colorFilter.appendChild(opt);
    });
  }
  $('filter-tag').value = '';
  $('filter-fav').checked = false;
  $('filter-global').checked = false;
  $('search-results').innerHTML = '<div class="search-hint">Suchbegriff eingeben oder Filter setzen...</div>';
}

function closeSearchPanel() {
  $('search-panel').classList.remove('open');
  state.nodes.forEach(n => {
    const el = getNodeEl(n.id);
    if (el) el.classList.remove('search-match');
  });
}

async function performSearch() {
  const query = $('search-input').value.trim().toLowerCase();
  const colorFilter = $('filter-color').value;
  const tagFilter = $('filter-tag').value.trim().toLowerCase();
  const favOnly = $('filter-fav').checked;
  const globalSearch = $('filter-global').checked;

  let searchNodes;
  let mapNames = {};

  if (globalSearch) {
    const allNodes = await new Promise(res => { const r = dbStore('nodes').getAll(); r.onsuccess = () => res(r.result); });
    searchNodes = allNodes;
  } else {
    searchNodes = state.nodes;
  }

  const maps = await getAllMaps();
  maps.forEach(m => { mapNames[m.id] = m.name; });

  const results = searchNodes.filter(n => {
    if (query && !n.title.toLowerCase().includes(query) && !(n.content || '').toLowerCase().includes(query)
        && !(n.tags || []).some(t => t.toLowerCase().includes(query))) return false;
    if (colorFilter && n.color !== colorFilter) return false;
    if (tagFilter && !(n.tags || []).some(t => t.toLowerCase().includes(tagFilter))) return false;
    if (favOnly && !n.favorite) return false;
    return true;
  });

  const resultsEl = $('search-results');
  if (!query && !colorFilter && !tagFilter && !favOnly) {
    resultsEl.innerHTML = '<div class="search-hint">Suchbegriff eingeben oder Filter setzen...</div>';
    return;
  }

  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="search-hint">Keine Ergebnisse</div>';
    return;
  }

  resultsEl.innerHTML = `<div class="search-count">${results.length} Ergebnis${results.length !== 1 ? 'se' : ''}</div>` +
    results.slice(0, 50).map(n => {
      const mapLabel = globalSearch && n.mapId !== currentMapId ? `<span class="search-result-map">${escHtml(mapNames[n.mapId] || '?')}</span>` : '';
      const tags = (n.tags || []).map(t => `<span class="search-result-tag">${escHtml(t)}</span>`).join('');
      const fav = n.favorite ? ' ★' : '';
      return `<div class="search-result-item" data-id="${n.id}" data-map="${n.mapId}">
        <div class="search-result-color" style="background:${n.color || '#444'}"></div>
        <div class="search-result-info">
          <div class="search-result-title">${escHtml(n.title || 'Ohne Titel')}${fav}</div>
          ${tags}${mapLabel}
        </div>
      </div>`;
    }).join('');

  resultsEl.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', async () => {
      const nodeId = item.dataset.id;
      const mapId = item.dataset.map;
      if (mapId !== currentMapId) await switchToMap(mapId);
      closeSearchPanel();
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
    });
  });

  // Highlight matching nodes on current map
  state.nodes.forEach(n => {
    const el = getNodeEl(n.id);
    if (el) el.classList.toggle('search-match', results.some(r => r.id === n.id));
  });
}
