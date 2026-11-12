// Node DOM: creating and updating node elements.

// ─── NODE DOM ────────────────────────────────────────────────────
function createNodeEl(node) {
  const el = document.createElement('div');
  el.className = 'node';
  el.dataset.id = node.id;
  nodeEls.set(node.id, el);
  nodeSizes.delete(node.id);
  nodeResizeObserver.observe(el);
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';
  el.style.width = (node.width || 220) + 'px';
  if (node.height) el.style.height = node.height + 'px';

  const tpl = node.template && NODE_TEMPLATES[node.template];
  const pri = node.priority && PRIORITIES[node.priority];
  const tplIcon = tpl ? `<span class="node-tpl-icon" title="${tpl.label}">${tpl.icon}</span>` : '';
  const priBadge = pri ? `<span class="node-priority-badge" style="background:${pri.color}" title="${pri.label}"></span>` : '';
  const subMapIcon = node.subMapId ? `<span class="node-submap-icon" title="Sub-Map öffnen (Doppelklick)" onclick="openSubMap('${node.id}')">🗂️</span>` : '';
  const favStar = `<span class="node-fav-star ${node.favorite ? 'active' : ''}" title="Favorit" onclick="event.stopPropagation();toggleFavorite('${node.id}')">★</span>`;
  const tagsHtml = (node.tags && node.tags.length > 0) ? `<div class="node-tags">${node.tags.map(t => `<span class="node-tag">${escHtml(t)}</span>`).join('')}</div>` : '';
  const attachHtml = (node.attachments && node.attachments.length > 0) ? `<div class="node-attach-bar">📎 ${node.attachments.length} Datei${node.attachments.length !== 1 ? 'en' : ''}</div>` : '';

  el.innerHTML = `
    <div class="node-header">
      ${favStar}${tplIcon}${priBadge}
      <div class="node-color-dot" style="background:${node.color || NODE_COLORS[0]}" title="Farbe ändern" onclick="cycleColor(event,'${node.id}')"></div>
      <input class="node-title" value="${escHtml(node.title || '')}" placeholder="Titel..." data-id="${node.id}" spellcheck="false"/>
      <div class="node-actions">
        ${subMapIcon}
        <button class="node-action-btn" title="Kind hinzufügen" onclick="addChildNode('${node.id}')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v6m0 0l-4 4m4-4l4 4"/></svg>
        </button>
        <button class="node-action-btn" title="Bearbeiten" onclick="openEdit('${node.id}')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3L11 2z"/></svg>
        </button>
        <button class="node-action-btn del" title="Löschen" onclick="deleteNodeById('${node.id}')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
        </button>
      </div>
    </div>
    <div class="node-body" id="body-${node.id}"></div>
    ${tagsHtml}
    ${attachHtml}
    <div class="node-connect-handle" title="Verbinden" data-id="${node.id}"></div>
    <div class="node-resize-handle" data-id="${node.id}"></div>
    <div class="node-graph-dot"><span class="node-graph-label">${escHtml(node.title || '')}</span></div>
  `;
  el.style.setProperty('--node-color', node.color || NODE_COLORS[0]);
  renderNodeBody(el, node);

  const titleInput = el.querySelector('.node-title');
  titleInput.addEventListener('change', async () => {
    const n = state.nodes.find(n => n.id === node.id);
    if (n) { n.title = titleInput.value; await saveNode(n); updateMapTimestamp(); }
  });
  titleInput.addEventListener('input', () => {
    el.querySelector('.node-graph-label').textContent = titleInput.value;
  });
  titleInput.addEventListener('mousedown', e => e.stopPropagation());
  titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') titleInput.blur(); e.stopPropagation(); });

  el.addEventListener('mousedown', e => onNodeMouseDown(e, node.id));
  el.addEventListener('click', e => onNodeClick(e, node.id));
  el.addEventListener('dblclick', e => onNodeDblClick(e, node.id));

  el.querySelector('.node-connect-handle').addEventListener('mousedown', e => onHandleMouseDown(e, node.id));
  el.querySelector('.node-resize-handle').addEventListener('mousedown', e => onResizeMouseDown(e, node.id));

  return el;
}

function renderNode(node) {
  let el = getNodeEl(node.id);
  if (!el) { el = createNodeEl(node); nodesLayer.appendChild(el); renderMermaidBlocks(el); }
  else {
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.style.width = (node.width || 220) + 'px';
    el.style.height = node.height ? node.height + 'px' : '';
    const dot = el.querySelector('.node-color-dot');
    if (dot) dot.style.background = node.color || NODE_COLORS[0];
    el.style.setProperty('--node-color', node.color || NODE_COLORS[0]);
    const graphLabel = el.querySelector('.node-graph-label');
    if (graphLabel) graphLabel.textContent = node.title || '';
    renderNodeBody(el, node);
    const titleInput = el.querySelector('.node-title');
    if (titleInput && document.activeElement !== titleInput) titleInput.value = node.title || '';
    // Update favorite star
    const star = el.querySelector('.node-fav-star');
    if (star) star.classList.toggle('active', !!node.favorite);
    // Update tags
    let tagsEl = el.querySelector('.node-tags');
    if (node.tags && node.tags.length > 0) {
      const tagsHtml = node.tags.map(t => `<span class="node-tag">${escHtml(t)}</span>`).join('');
      if (tagsEl) { tagsEl.innerHTML = tagsHtml; }
      else {
        tagsEl = document.createElement('div');
        tagsEl.className = 'node-tags';
        tagsEl.innerHTML = tagsHtml;
        const bodyEl = el.querySelector('.node-body');
        if (bodyEl) (el.querySelector('.node-more-btn') || bodyEl).after(tagsEl);
      }
    } else if (tagsEl) { tagsEl.remove(); }
    // Update attachments bar
    let attachBar = el.querySelector('.node-attach-bar');
    if (node.attachments && node.attachments.length > 0) {
      const text = `📎 ${node.attachments.length} Datei${node.attachments.length !== 1 ? 'en' : ''}`;
      if (attachBar) { attachBar.textContent = text; }
      else {
        attachBar = document.createElement('div');
        attachBar.className = 'node-attach-bar';
        attachBar.textContent = text;
        const ins = el.querySelector('.node-collapse-bar') || el.querySelector('.node-connect-handle');
        if (ins) el.insertBefore(attachBar, ins);
      }
    } else if (attachBar) { attachBar.remove(); }
  }
  updateNodeSelection(node.id);
  updateCollapseBar(node.id);
  if (isNodeHidden(node.id)) el.style.display = 'none';
}

function updateNodeSelection(id) {
  const el = getNodeEl(id);
  if (!el) return;
  el.classList.toggle('selected', state.selectedNodes.has(id));
  el.classList.toggle('connect-source', state.connectSource === id);
}

function removeNodeEl(id) {
  const el = getNodeEl(id);
  if (el) { nodeResizeObserver.unobserve(el); el.remove(); }
  nodeEls.delete(id);
  nodeSizes.delete(id);
}

async function updateMapTimestamp() {
  const maps = await getAllMaps();
  const map = maps.find(m => m.id === currentMapId);
  if (map) { map.updated = Date.now(); await saveMap(map); }
}
