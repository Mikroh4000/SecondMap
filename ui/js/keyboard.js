// Keyboard shortcuts.

// ─── KEYBOARD ────────────────────────────────────────────────────
document.addEventListener('keydown', async e => {
  // Undo/Redo (works even in inputs)
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); await undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); await redo(); return; }
  // Search
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openSearchPanel(); return; }
  // Copy/Paste (works even in inputs for Ctrl+C/V on canvas)
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); copySelected(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'v' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); await pasteClipboard(); return; }
  // Select all
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    state.selectedNodes.clear();
    for (const n of state.nodes) state.selectedNodes.add(n.id);
    for (const n of state.nodes) updateNodeSelection(n.id);
    showToast(`${state.selectedNodes.size} Blöcke ausgewählt`);
    return;
  }

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'n' || e.key === 'N') {
    const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
    const wp = screenToWorld(cx, cy);
    await addNode(wp.x - 110 + (Math.random()-0.5)*100, wp.y - 40 + (Math.random()-0.5)*60);
  }
  if (e.key === 'c' || e.key === 'C') setMode(state.mode === 'connect' ? 'normal' : 'connect');
  if (e.key === 'f' || e.key === 'F') fitView();
  if (e.key === 'z' || e.key === 'Z') {
    const mp = lastMousePos || { x: canvasWrap.offsetWidth / 2, y: canvasWrap.offsetHeight / 2 };
    smoothZoom(1.3, mp.x, mp.y);
  }
  if (e.key === 'u' || e.key === 'U') {
    const mp = lastMousePos || { x: canvasWrap.offsetWidth / 2, y: canvasWrap.offsetHeight / 2 };
    smoothZoom(0.7, mp.x, mp.y);
  }
  if (e.key === 'Escape') {
    setMode('normal');
    if (state.connectSource) { updateNodeSelection(state.connectSource); state.connectSource = null; }
    selectNode(null);
    toggleSidebar(false);
    closeSearchPanel();
    if (state.highlightedEdges) { state.highlightedEdges = null; renderEdges(); }
  }
  if (e.key === 'p' || e.key === 'P') highlightPath();
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedNodes.size > 0) {
    await deleteSelectedNodes();
  }
  // Group shortcut: Ctrl+G
  if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
    e.preventDefault();
    if (state.selectedNodes.size >= 2) {
      const name = prompt('Gruppenname:', 'Gruppe');
      if (name !== null) await createGroup(name, [...state.selectedNodes]);
    } else {
      showToast('Mindestens 2 Blöcke auswählen');
    }
  }
});
