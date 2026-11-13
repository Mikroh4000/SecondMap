// Design editor – prototype playback (follows the click interactions defined in the Prototype tab).

const presentEl = $('d-present-overlay');
const presentStage = $('d-present-stage');
const presentState = { stack: [], frameId: null };

function startPresent() {
  let startId = null;
  const top = D.sel[0] ? chainOf(D.sel[0])[0] : null;
  if (top && top.type === 'frame') startId = top.id;
  else {
    const first = curPage().children.find(n => n.type === 'frame' && n.visible !== false);
    if (first) startId = first.id;
  }
  if (!startId) { showToast('Add a frame (screen) first, then present it'); return; }
  presentState.stack = [];
  presentEl.hidden = false;
  showPresentFrame(startId);
}

function showPresentFrame(id) {
  const f = nodeOf(id);
  if (!f) return;
  presentState.frameId = id;
  const page = D.doc.pages.find(p => p.id === byId.get(id).pageId);
  $('d-present-title').textContent = `${page ? page.name + ' / ' : ''}${f.name}`;
  const root = buildStatic(f, { root: true, interactive: true });
  root.style.transformOrigin = '0 0';
  [root, ...root.querySelectorAll('[data-pid]')].forEach(el => {
    const n = nodeOf(el.dataset.pid);
    if (n && n.link) el.style.cursor = 'pointer';
  });
  const wrap = document.createElement('div');
  wrap.className = 'd-present-frame';
  wrap.appendChild(root);
  presentStage.replaceChildren(wrap);
  fitPresent();
}

function fitPresent() {
  const wrap = presentStage.firstChild, f = nodeOf(presentState.frameId);
  if (!wrap || !f) return;
  const r = presentStage.getBoundingClientRect();
  const k = Math.min(3, Math.max(0.05, Math.min((r.width - 40) / f.w, (r.height - 40) / f.h)));
  wrap.style.width = f.w * k + 'px';
  wrap.style.height = f.h * k + 'px';
  wrap.firstChild.style.transform = `scale(${k})`;
}

function closePresent() {
  presentEl.hidden = true;
  presentStage.replaceChildren();
}

function presentBack() {
  const prev = presentState.stack.pop();
  if (prev && nodeOf(prev)) showPresentFrame(prev);
}

presentStage.addEventListener('click', e => {
  let el = e.target.closest('[data-pid]');
  while (el) {
    const n = nodeOf(el.dataset.pid);
    if (n && n.link) {
      if (n.link.type === 'back') presentBack();
      else {
        const t = nodeOf(n.link.target);
        if (t && t.type === 'frame') { presentState.stack.push(presentState.frameId); showPresentFrame(t.id); }
      }
      return;
    }
    el = el.parentElement ? el.parentElement.closest('[data-pid]') : null;
  }
});

$('d-present').addEventListener('click', startPresent);
$('d-present-close').addEventListener('click', closePresent);
window.addEventListener('resize', () => { if (!presentEl.hidden) fitPresent(); });
document.addEventListener('keydown', e => {
  if (presentEl.hidden) return;
  if (e.key === 'Escape') closePresent();
  else if (e.key === 'ArrowLeft' || e.key === 'Backspace') presentBack();
});
