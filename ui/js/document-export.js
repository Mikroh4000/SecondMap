// PDF and Markdown export.

// ─── PDF EXPORT ──────────────────────────────────────────────────
function exportPDF() {
  const visibleNodes = state.nodes.filter(n => !isNodeHidden(n.id));
  const mapName = $('current-map-name').textContent;

  const printStyle = `
    <style>
      body { font-family: 'Segoe UI', sans-serif; padding: 40px; max-width: 800px; margin: auto; color: #222; }
      h1 { font-size: 24px; border-bottom: 2px solid #c8f064; padding-bottom: 8px; margin-bottom: 24px; }
      .pdf-node { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; page-break-inside: avoid; }
      .pdf-node-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .pdf-node-color { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
      .pdf-node-title { font-size: 16px; font-weight: 600; }
      .pdf-node-fav { color: #f0c864; }
      .pdf-node-body { font-size: 13px; line-height: 1.6; color: #555; white-space: pre-wrap; }
      .pdf-node-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
      .pdf-tag { background: #f0f0f0; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
      .pdf-node-meta { font-size: 11px; color: #999; margin-top: 8px; }
      .pdf-edges { margin-top: 32px; }
      .pdf-edge { font-size: 13px; color: #555; padding: 4px 0; }
    </style>
  `;

  let content = `<h1>${escHtml(mapName)}</h1>
    <p style="color:#999;font-size:12px;margin-bottom:24px">Exportiert am ${new Date().toLocaleString('de-DE')} · ${visibleNodes.length} Blöcke</p>`;

  for (const n of visibleNodes) {
    const tags = (n.tags || []).map(t => `<span class="pdf-tag">${escHtml(t)}</span>`).join('');
    const fav = n.favorite ? '<span class="pdf-node-fav"> ★</span>' : '';
    const tpl = n.template && NODE_TEMPLATES[n.template];
    const tplLabel = tpl ? `${tpl.icon} ${tpl.label} · ` : '';
    const pri = n.priority && PRIORITIES[n.priority];
    const priLabel = pri ? `Priorität: ${pri.label} · ` : '';
    const dateStr = new Date(n.created).toLocaleString('de-DE');
    const attachCount = (n.attachments || []).length;
    const attachLabel = attachCount > 0 ? ` · 📎 ${attachCount} Datei${attachCount !== 1 ? 'en' : ''}` : '';

    content += `<div class="pdf-node">
      <div class="pdf-node-header">
        <div class="pdf-node-color" style="background:${n.color || '#ccc'}"></div>
        <div class="pdf-node-title">${escHtml(n.title || 'Ohne Titel')}</div>${fav}
      </div>
      ${n.content ? `<div class="pdf-node-body">${escHtml(n.content)}</div>` : ''}
      ${tags ? `<div class="pdf-node-tags">${tags}</div>` : ''}
      <div class="pdf-node-meta">${tplLabel}${priLabel}${dateStr}${attachLabel}</div>
    </div>`;
  }

  const visibleIds = new Set(visibleNodes.map(n => n.id));
  const visibleEdges = state.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));
  if (visibleEdges.length > 0) {
    content += `<div class="pdf-edges"><h2>Verbindungen (${visibleEdges.length})</h2>`;
    for (const e of visibleEdges) {
      const sn = state.nodes.find(n => n.id === e.source);
      const tn = state.nodes.find(n => n.id === e.target);
      const dir = e.bidirectional ? '↔' : '→';
      const label = e.label ? ` [${escHtml(e.label)}]` : '';
      content += `<div class="pdf-edge">${escHtml(sn?.title || '?')} ${dir} ${escHtml(tn?.title || '?')}${label}</div>`;
    }
    content += '</div>';
  }

  // Create a print-only overlay, print, then remove it
  const printContainer = document.createElement('div');
  printContainer.id = 'print-overlay';
  printContainer.innerHTML = printStyle + content;
  document.body.appendChild(printContainer);

  // Add print-specific CSS to hide app and show overlay
  const printCSS = document.createElement('style');
  printCSS.id = 'print-overlay-css';
  printCSS.textContent = `
    @media print {
      body > *:not(#print-overlay) { display: none !important; }
      #print-overlay { display: block !important; position: static !important; background: white; }
    }
    #print-overlay { display: none; }
  `;
  document.head.appendChild(printCSS);

  window.print();

  // Clean up after print dialog closes
  setTimeout(() => {
    printContainer.remove();
    printCSS.remove();
  }, 500);

  showToast('PDF-Export wird vorbereitet...', 'success');
}

// ─── MARKDOWN EXPORT ─────────────────────────────────────────────
async function exportMarkdown() {
  const visibleNodes = state.nodes.filter(n => !isNodeHidden(n.id));
  const mapName = $('current-map-name').textContent;

  let md = `# ${mapName}\n\n`;
  md += `> Exportiert am ${new Date().toLocaleString('de-DE')} · ${visibleNodes.length} Blöcke\n\n---\n\n`;

  const rootNodes = visibleNodes.filter(n => !n.parentId || !visibleNodes.find(p => p.id === n.parentId));
  const childMap = {};
  for (const n of visibleNodes) {
    if (n.parentId && visibleNodes.find(p => p.id === n.parentId)) {
      if (!childMap[n.parentId]) childMap[n.parentId] = [];
      childMap[n.parentId].push(n);
    }
  }

  function nodeToMd(node, depth) {
    const hLevel = Math.min(depth + 2, 6);
    const prefix = '#'.repeat(hLevel) + ' ';
    const fav = node.favorite ? ' ★' : '';
    const tags = (node.tags || []).length > 0 ? ` \`${node.tags.join('` `')}\`` : '';
    let s = `${prefix}${node.title || 'Ohne Titel'}${fav}${tags}\n\n`;
    if (node.content) s += `${node.content}\n\n`;
    const tpl = node.template && NODE_TEMPLATES[node.template];
    if (tpl) s += `*Template: ${tpl.icon} ${tpl.label}*\n\n`;
    const pri = node.priority && PRIORITIES[node.priority];
    if (pri) s += `*Priorität: ${pri.label}*\n\n`;
    if ((node.attachments || []).length > 0) {
      s += `📎 Anhänge: ${node.attachments.map(a => a.name).join(', ')}\n\n`;
    }
    if (childMap[node.id]) {
      for (const child of childMap[node.id]) s += nodeToMd(child, depth + 1);
    }
    return s;
  }

  for (const root of rootNodes) md += nodeToMd(root, 0);

  const visibleIds = new Set(visibleNodes.map(n => n.id));
  const visibleEdges = state.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));
  if (visibleEdges.length > 0) {
    md += `---\n\n## Verbindungen\n\n`;
    for (const e of visibleEdges) {
      const sn = state.nodes.find(n => n.id === e.source);
      const tn = state.nodes.find(n => n.id === e.target);
      const dir = e.bidirectional ? '↔' : '→';
      const label = e.label ? ` *(${e.label})*` : '';
      md += `- **${sn?.title || '?'}** ${dir} **${tn?.title || '?'}**${label}\n`;
    }
    md += '\n';
  }

  const saved = await saveFileWithDialog(md, `${mapName || 'mindgraph'}.md`, 'Markdown', ['md']);
  if (saved) showToast('Markdown exportiert', 'success');
}
