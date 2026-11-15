// Design editor – startup: pick a design document (from ?design=<id>, the last used one, or the
// first available) and render it. Multiple designs are supported (see design/design-db.js); boot
// only decides which one opens initially, design/actions.js's switchDesign() changes it afterwards.

(async function boot() {
  const docs = await ensureDesignLibrary();
  const params = new URLSearchParams(location.search);
  const requestedId = params.get('design');
  const lastId = await getCurrentDesignId();
  const targetId = (requestedId && docs.some(d => d.id === requestedId) && requestedId)
    || (lastId && docs.some(d => d.id === lastId) && lastId)
    || docs[0].id;
  const doc = (await getDesignDoc(targetId)) || docs[0];
  setDoc(doc);
  await setCurrentDesignId(doc.id);
  setTool('move');
  renderAll();
  openLinkedLayer();
})();

// Opened from a design embedded in the mind map (design.html?design=<id>#layer=<id>): jump to that layer.
function openLinkedLayer() {
  const m = /[#&]layer=([^&]+)/.exec(location.hash);
  const entry = m && byId.get(decodeURIComponent(m[1]));
  if (!entry) return;
  if (entry.pageId !== D.pageId) switchPage(entry.pageId);
  setSelection([entry.node.id]);
  fitView([entry.node.id]);
}
