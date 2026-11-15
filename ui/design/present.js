// Design editor – prototype playback (follows the click interactions defined in the Prototype tab).

const presentEl = $('d-present-overlay');
const presentStage = $('d-present-stage');
const presentState = { stack: [], frameId: null };
let presentTurning = false;

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

function showPresentFrame(id, turn) {
  if (!nodeOf(id)) return;
  const old = presentStage.firstChild;
  if (turn && old && !presentTurning) turnDisplay(old, turn, () => renderPresentFrame(id, true));
  else renderPresentFrame(id, false);
}

// The display is physically turned sideways before the next screen appears.
function turnDisplay(wrap, turn, done) {
  presentTurning = true;
  const r = presentStage.getBoundingClientRect();
  const s = Math.min(1, (r.width - 40) / wrap.offsetHeight, (r.height - 40) / wrap.offsetWidth);
  wrap.style.transition = 'transform .5s ease-in-out';
  wrap.style.transform = `rotate(${turn === 'ccw' ? -90 : 90}deg) scale(${s})`;
  setTimeout(() => { presentTurning = false; if (!presentEl.hidden) done(); }, 520);
}

function renderPresentFrame(id, fadeIn) {
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
  wrap.className = 'd-present-frame' + (fadeIn ? ' fade-in' : '');
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
  if (presentTurning) return;
  const prev = presentState.stack.pop();
  if (!prev || !nodeOf(prev.id)) return;
  const undoTurn = { cw: 'ccw', ccw: 'cw' }[prev.turn] || null;
  showPresentFrame(prev.id, undoTurn);
}

presentStage.addEventListener('click', e => {
  if (presentTurning) return;
  let el = e.target.closest('[data-pid]');
  while (el) {
    const n = nodeOf(el.dataset.pid);
    if (n && n.link) {
      if (n.link.type === 'back') presentBack();
      else {
        const t = nodeOf(n.link.target);
        if (t && t.type === 'frame') {
          const turn = n.link.turn || null;
          presentState.stack.push({ id: presentState.frameId, turn });
          showPresentFrame(t.id, turn);
        }
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
