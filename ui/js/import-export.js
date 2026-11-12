// JSON import and export of maps.

// ─── IMPORT / EXPORT ─────────────────────────────────────────────

async function saveFileWithDialog(content, defaultName, filterName, extensions) {
  if (window.__TAURI__) {
    try {
      const path = await window.__TAURI__.dialog.save({
        defaultPath: defaultName,
        filters: [{ name: filterName, extensions }]
      });
      if (!path) return false;
      await window.__TAURI__.fs.writeTextFile(path, content);
      return true;
    } catch(e) { console.error('Save dialog error:', e); }
  }
  // Fallback for browser / dev mode
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  return true;
}

$('btn-export-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('export-menu');
  menu.classList.toggle('open');
});
document.addEventListener('click', () => { $('export-menu').classList.remove('open'); });
$('btn-export-json').addEventListener('click', async () => {
  const data = JSON.stringify({ nodes: state.nodes, edges: state.edges, groups: state.groups }, null, 2);
  const mapName = $('current-map-name').textContent || 'mindgraph';
  const saved = await saveFileWithDialog(data, `${mapName}.json`, 'JSON', ['json']);
  if (saved) showToast('Exportiert', 'success');
});

$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (!data.nodes || !data.edges) throw new Error('Ungültiges Format');
    if (!confirm(`${data.nodes.length} Blöcke und ${data.edges.length} Verbindungen importieren?`)) return;

    // Remap all IDs to fresh UIDs so that importing the same JSON file into
    // multiple maps never overwrites records that belong to another map.
    const idMap = {};
    const remappedNodes = data.nodes.map(n => {
      const newId = uid();
      idMap[n.id] = newId;
      return { ...n, id: newId, mapId: currentMapId };
    });
    // Fix intra-map references after all IDs are mapped
    for (const n of remappedNodes) {
      if (n.parentId) n.parentId = idMap[n.parentId] || n.parentId;
    }
    const remappedEdges = data.edges.map(ed => ({
      ...ed,
      id: uid(),
      mapId: currentMapId,
      source: idMap[ed.source] || ed.source,
      target: idMap[ed.target] || ed.target,
    }));

    for (const n of remappedNodes) { state.nodes.push(n); await saveNode(n); }
    for (const ed of remappedEdges) { state.edges.push(ed); await saveEdge(ed); }

    if (data.groups) {
      for (const g of data.groups) {
        const remappedGroup = {
          ...g,
          id: uid(),
          mapId: currentMapId,
          nodeIds: (g.nodeIds || []).map(nid => idMap[nid] || nid),
        };
        state.groups.push(remappedGroup);
        await saveGroupToDB(remappedGroup);
      }
    }
    await updateMapTimestamp();
    state.nodes.forEach(n => renderNode(n));
    renderEdges(); renderGroups(); fitView();
    showToast(`${data.nodes.length} Blöcke importiert`, 'success');
  } catch(err) { showToast('Fehler beim Import: ' + err.message); }
  e.target.value = '';
});
