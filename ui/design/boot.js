// Design editor – startup: load the saved design (or an empty one) and render.

(async function boot() {
  const saved = await loadDoc();
  setDoc(saved && Array.isArray(saved.pages) && saved.pages.length ? saved : defaultDoc());
  setTool('move');
  renderAll();
})();
