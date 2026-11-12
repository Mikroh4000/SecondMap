// Quick-create nodes from templates.

// ─── TEMPLATE QUICK-CREATE ───────────────────────────────────────
function openTemplateMenu() {
  const existing = document.querySelector('.template-dropdown');
  if (existing) { existing.remove(); return; }

  const btn = $('btn-template');
  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'template-dropdown';
  dd.style.top = rect.bottom + 4 + 'px';
  dd.style.left = rect.left + 'px';

  for (const [key, tpl] of Object.entries(NODE_TEMPLATES)) {
    const item = document.createElement('button');
    item.className = 'template-dropdown-item';
    item.innerHTML = `<span>${tpl.icon}</span> ${tpl.label}`;
    item.addEventListener('click', async () => {
      dd.remove();
      const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
      const wp = screenToWorld(cx, cy);
      await addNode(wp.x - 110 + (Math.random()-0.5)*150, wp.y - 40 + (Math.random()-0.5)*100, { template: key });
    });
    dd.appendChild(item);
  }

  // Separator + URL Import
  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--border2);margin:4px 0;';
  dd.appendChild(sep);
  const urlItem = document.createElement('button');
  urlItem.className = 'template-dropdown-item';
  urlItem.innerHTML = '<span>🌐</span> URL Import';
  urlItem.addEventListener('click', () => { dd.remove(); openUrlImportDialog(); });
  dd.appendChild(urlItem);

  document.body.appendChild(dd);
  const close = (e) => { if (!dd.contains(e.target) && e.target !== btn) { dd.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}
