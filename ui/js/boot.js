// Application start-up. Must be loaded last.

// ─── BOOT ────────────────────────────────────────────────────────
async function boot() {
  await openDB();

  let maps = await getAllMaps();
  const requestedMapId = new URLSearchParams(location.search).get('map');
  let savedMapId = (requestedMapId && maps.some(m => m.id === requestedMapId) && requestedMapId) || await loadCurrentMapId();

  if (maps.length === 0) {
    const oldNodes = await new Promise(res => { const r = dbStore('nodes').getAll(); r.onsuccess = () => res(r.result); });
    const oldEdges = await new Promise(res => { const r = dbStore('edges').getAll(); r.onsuccess = () => res(r.result); });
    const unmapped = oldNodes.filter(n => !n.mapId);
    const defaultMap = await createNewMap('SecondMap Architektur');
    currentMapId = defaultMap.id;
    if (unmapped.length > 0) {
      for (const n of oldNodes) { n.mapId = currentMapId; await saveNode(n); }
      for (const e of oldEdges) { e.mapId = currentMapId; await saveEdge(e); }
    }
    await saveCurrentMapId(currentMapId);
    maps = [defaultMap];
  } else {
    currentMapId = savedMapId && maps.find(m => m.id === savedMapId) ? savedMapId : maps[0].id;
  }

  await switchToMap(currentMapId);

  if (state.nodes.length === 0 && maps.length === 1) {
    try {
      const resp = await fetch('secondmap-architecture.json');
      if (resp.ok) {
        const data = await resp.json();
        for (const n of (data.nodes || [])) { n.mapId = currentMapId; state.nodes.push(n); await saveNode(n); }
        for (const ed of (data.edges || [])) { ed.mapId = currentMapId; state.edges.push(ed); await saveEdge(ed); }
        for (const g of (data.groups || [])) { g.mapId = currentMapId; state.groups.push(g); await saveGroupToDB(g); }
        await updateMapTimestamp();
        state.nodes.forEach(n => renderNode(n));
        renderEdges(); renderGroups();
      }
    } catch(_) { /* fallback: leere Map */ }
    undoStack.length = 0; redoStack.length = 0; updateUndoRedoButtons();
    fitView();
  }

  drawMinimap();
  updateUndoRedoButtons();
}

boot();
