// Visual groups around nodes.

// ─── GROUPS ──────────────────────────────────────────────────────
const groupRecs = new Map();
function renderGroups() {
  const gl = $('groups-layer');
  if (!gl) return;
  const membersByGroup = new Map();
  for (const n of state.nodes) {
    if (!n.groupId) continue;
    let list = membersByGroup.get(n.groupId);
    if (!list) membersByGroup.set(n.groupId, list = []);
    list.push(n);
  }
  const seen = new Set();
  for (const group of state.groups) {
    const members = membersByGroup.get(group.id);
    if (!members) continue;
    seen.add(group.id);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of members) {
      const sz = getNodeSize(n);
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.width || 220)); maxY = Math.max(maxY, n.y + sz.h);
    }
    const pad = 20;
    const sig = (group.name || '') + '|' + (group.color || '');
    let rec = groupRecs.get(group.id);
    if (!rec || rec.sig !== sig || !rec.el.isConnected) {
      if (rec) rec.el.remove();
      const gEl = document.createElement('div');
      gEl.className = 'group-box';
      gEl.dataset.groupId = group.id;
      gEl.style.borderColor = group.color || '#555';
      gEl.style.background = (group.color || '#555') + '12';
      gEl.innerHTML = `<div class="group-label" style="color:${group.color || '#999'}">${escHtml(group.name || 'Gruppe')}
        <button class="group-del-btn" onclick="deleteGroupById('${group.id}')" title="Gruppe auflösen">×</button>
      </div>`;
      gEl.querySelector('.group-label').addEventListener('dblclick', () => renameGroup(group.id));
      gl.appendChild(gEl);
      rec = { el: gEl, sig, geo: '' };
      groupRecs.set(group.id, rec);
    }
    const left = minX - pad, top = minY - pad - 24;
    const width = maxX - minX + pad * 2, height = maxY - minY + pad * 2 + 24;
    const geo = left + ',' + top + ',' + width + ',' + height;
    if (rec.geo !== geo) {
      rec.geo = geo;
      rec.el.style.left = left + 'px'; rec.el.style.top = top + 'px';
      rec.el.style.width = width + 'px'; rec.el.style.height = height + 'px';
    }
  }
  for (const [id, rec] of groupRecs) {
    if (!seen.has(id)) { rec.el.remove(); groupRecs.delete(id); }
  }
}

async function createGroup(name, nodeIds) {
  const group = { id: uid(), mapId: currentMapId, name: name || 'Gruppe', color: '#c8f064' };
  state.groups.push(group);
  await saveGroupToDB(group);
  for (const nid of nodeIds) {
    const n = state.nodes.find(x => x.id === nid);
    if (n) { n.groupId = group.id; await saveNode(n); }
  }
  pushUndo({ type: 'add-group', group: {...group}, nodeIds: [...nodeIds] });
  await updateMapTimestamp();
  renderGroups();
  showToast('Gruppe erstellt', 'success');
  return group;
}

async function deleteGroupById(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  const members = state.nodes.filter(n => n.groupId === groupId);
  for (const n of members) { n.groupId = null; await saveNode(n); }
  state.groups = state.groups.filter(g => g.id !== groupId);
  await deleteGroupFromDB(groupId);
  pushUndo({ type: 'delete-group', group: {...group} });
  await updateMapTimestamp();
  renderGroups();
  showToast('Gruppe aufgelöst');
}
window.deleteGroupById = deleteGroupById;

function renameGroup(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  const name = prompt('Gruppenname:', group.name);
  if (name === null) return;
  group.name = name || 'Gruppe';
  saveGroupToDB(group);
  renderGroups();
}
