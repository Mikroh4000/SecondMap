// Toolbar button handlers.

// ─── BUTTONS ─────────────────────────────────────────────────────
$('btn-new-node').addEventListener('click', async () => {
  const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
  const wp = screenToWorld(cx, cy);
  await addNode(wp.x - 110 + (Math.random()-0.5)*150, wp.y - 40 + (Math.random()-0.5)*100);
});
$('btn-connect-mode').addEventListener('click', () => setMode(state.mode === 'connect' ? 'normal' : 'connect'));
$('btn-fit').addEventListener('click', fitView);

// Undo/Redo buttons
if ($('btn-undo')) $('btn-undo').addEventListener('click', undo);
if ($('btn-redo')) $('btn-redo').addEventListener('click', redo);

// Template button
if ($('btn-template')) $('btn-template').addEventListener('click', openTemplateMenu);

// Settings button
$('btn-settings').addEventListener('click', () => openSettings());

// Search button
if ($('btn-search')) $('btn-search').addEventListener('click', openSearchPanel);

// Favorites button
if ($('btn-favorites')) $('btn-favorites').addEventListener('click', openFavoritesPanel);

// PDF & Markdown Export (handled via dropdown)
$('btn-export-pdf').addEventListener('click', exportPDF);
$('btn-export-md').addEventListener('click', exportMarkdown);

// Search panel handlers
$('search-close').addEventListener('click', closeSearchPanel);
$('search-input').addEventListener('input', performSearch);
$('filter-color').addEventListener('change', performSearch);
$('filter-tag').addEventListener('input', performSearch);
$('filter-fav').addEventListener('change', performSearch);
$('filter-global').addEventListener('change', performSearch);
$('search-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSearchPanel();
  e.stopPropagation();
});
$('filter-tag').addEventListener('keydown', e => e.stopPropagation());

// Group button
if ($('btn-group')) $('btn-group').addEventListener('click', async () => {
  if (state.selectedNodes.size >= 2) {
    const name = prompt('Gruppenname:', 'Gruppe');
    if (name !== null) await createGroup(name, [...state.selectedNodes]);
  } else {
    showToast('Mindestens 2 Blöcke auswählen zum Gruppieren');
  }
});
