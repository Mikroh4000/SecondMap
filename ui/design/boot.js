// Design editor – startup: load the saved design (or an empty one) and render.

(async function boot() {
  const saved = await loadDoc();
  setDoc(saved && Array.isArray(saved.pages) && saved.pages.length ? saved : defaultDoc());
  setTool('move');
  renderAll();
  openLinkedLayer();
})();

// Opened from a design embedded in the mind map (design.html#layer=<id>): jump to that design.
function openLinkedLayer() {
  const m = /[#&]layer=([^&]+)/.exec(location.hash);
  const entry = m && byId.get(decodeURIComponent(m[1]));
  if (!entry) return;
  if (entry.pageId !== D.pageId) switchPage(entry.pageId);
  setSelection([entry.node.id]);
  fitView([entry.node.id]);
}
