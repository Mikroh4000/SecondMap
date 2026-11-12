// Node content preview: long contents are shortened inside the node and can be shown in full
// via a "view all" button (reader window or inline, see settings). Only short previews are
// rendered by default, which keeps big maps fast.

// Returns the shortened source if the content is longer than the preview limits, otherwise null.
function getContentPreview(content) {
  if (!content) return null;
  const maxLines = settings.previewLines;
  const maxChars = settings.previewMaxChars;

  // Position of the newline that ends the last allowed line (without splitting huge contents).
  let pos = -1;
  for (let i = 0; i < maxLines; i++) {
    pos = content.indexOf('\n', pos + 1);
    if (pos === -1) break;
  }
  const cutByLines = pos !== -1 && content.slice(pos + 1).trim() !== '';
  const end = Math.min(cutByLines ? pos : content.length, maxChars);
  return end >= content.length ? null : content.slice(0, end);
}

// Heavy elements are never rendered inside a preview.
function stripHeavyMarkdown(src) {
  return src
    .replace(/```mermaid[\s\S]*?(?:```|$)/g, '[Diagramm]')
    .replace(/!\[[^\]]*\]\([^)]*(?:\)|$)/g, '[Bild]');
}

function plainPreviewText(src) {
  return stripHeavyMarkdown(src)
    .replace(/```\w*\n?/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/^\s*[-*]\s+\[x\]\s+/gmi, '☑ ')
    .replace(/^\s*[-*]\s+\[ \]\s+/gm, '☐ ')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Closes fences/formulas that were cut in half so the rest of the markdown stays intact.
function formattedPreviewSource(src) {
  let s = stripHeavyMarkdown(src);
  if ((s.match(/```/g) || []).length % 2) s += '\n```';
  if ((s.match(/\$\$/g) || []).length % 2) s += '\n$$';
  return s;
}

// Renders the body of a node according to the settings. Does nothing if nothing changed.
function renderNodeBody(el, node) {
  const body = el.querySelector('.node-body');
  if (!body) return;

  const preview = settings.previewEnabled ? getContentPreview(node.content) : null;
  const expanded = !!preview && settings.viewAllMode === 'inline' && state.expandedNodes.has(node.id);
  const mode = !preview ? 'full' : expanded ? 'expanded' : 'preview-' + settings.previewStyle;

  if (el._bodyContent !== node.content || el._bodyMode !== mode || el._bodyVersion !== contentRenderVersion) {
    if (mode === 'preview-plain') body.textContent = plainPreviewText(preview);
    else if (mode === 'preview-formatted') body.innerHTML = renderMarkdown(formattedPreviewSource(preview));
    else body.innerHTML = renderMarkdown(node.content);
    el._bodyContent = node.content;
    el._bodyMode = mode;
    el._bodyVersion = contentRenderVersion;
    body.classList.toggle('is-preview', !!preview && !expanded);
    body.classList.toggle('is-plain', mode === 'preview-plain');
    body.classList.toggle('is-expanded', expanded);
    if (el.isConnected && mode !== 'preview-plain') renderMermaidBlocks(body);
  }

  let btn = el.querySelector('.node-more-btn');
  if (!preview) { if (btn) btn.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'node-more-btn';
    btn.addEventListener('click', e => { e.stopPropagation(); onViewAllClick(node.id); });
    body.after(btn);
  }
  btn.textContent = expanded ? 'Weniger anzeigen ▴' : 'Alles anzeigen ▾';
}

function onViewAllClick(id) {
  if (settings.viewAllMode === 'inline') toggleNodeExpanded(id);
  else openNodeReader(id);
}

function toggleNodeExpanded(id) {
  if (state.expandedNodes.has(id)) state.expandedNodes.delete(id);
  else state.expandedNodes.add(id);
  const node = state.nodes.find(n => n.id === id);
  const el = getNodeEl(id);
  if (node && el) renderNodeBody(el, node);
}

// Re-renders all bodies after a content related setting changed.
function refreshNodeBodies() {
  contentRenderVersion++;
  for (const node of state.nodes) {
    const el = getNodeEl(node.id);
    if (el) renderNodeBody(el, node);
  }
}

function collapseAllNodes() {
  state.expandedNodes.clear();
  refreshNodeBodies();
}

// Read-only window with the complete content of a node.
function openNodeReader(id) {
  const node = state.nodes.find(n => n.id === id);
  if (!node || document.getElementById('reader-backdrop')) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'reader-backdrop';
  backdrop.innerHTML = `
    <div class="modal reader-modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title"><span class="reader-dot" style="background:${node.color || NODE_COLORS[0]}"></span>${escHtml(node.title || 'Ohne Titel')}</div>
        <div class="reader-actions">
          <button class="tb-btn" id="reader-edit-btn">Bearbeiten</button>
          <button class="modal-close" id="reader-close-btn" title="Schließen (Esc)">×</button>
        </div>
      </div>
      <div class="modal-body"><div class="node-body reader-body">${renderMarkdown(node.content)}</div></div>
    </div>`;
  document.body.appendChild(backdrop);
  renderMermaidBlocks(backdrop);

  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close() {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
  }
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#reader-close-btn').addEventListener('click', close);
  backdrop.querySelector('#reader-edit-btn').addEventListener('click', () => { close(); openEdit(id); });
}
