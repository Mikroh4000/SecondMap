// Importing source code and config files as nodes.

// ─── CODE FILE IMPORT ────────────────────────────────────────────
$('btn-import-code').addEventListener('click', () => $('file-import-code').click());
$('file-import-code').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const ext = file.name.split('.').pop().toLowerCase();
  const langMap = {
    c:'c', h:'c', cpp:'cpp', hpp:'cpp', rs:'rust', py:'python', js:'javascript',
    ts:'typescript', java:'java', asm:'x86asm', s:'x86asm', sh:'bash', bat:'batch',
    ps1:'powershell', go:'go', zig:'zig', v:'verilog', sv:'verilog', vhdl:'vhdl',
    rb:'ruby', lua:'lua', toml:'toml', yaml:'yaml', yml:'yaml', xml:'xml',
    txt:'plaintext', md:'markdown', csv:'csv'
  };
  const lang = langMap[ext] || '';
  const content = '```' + lang + '\n' + text + '\n```';
  const cx = (canvasWrap.clientWidth / 2 - state.transform.x) / state.transform.scale;
  const cy = (canvasWrap.clientHeight / 2 - state.transform.y) / state.transform.scale;
  await addNode(cx, cy, {
    title: file.name,
    content,
    template: 'code',
    width: Math.min(600, Math.max(300, text.split('\n').reduce((m, l) => Math.max(m, l.length), 0) * 7 + 40)),
    tags: [lang || ext]
  });
  fitView();
  showToast(`"${file.name}" importiert`, 'success');
  e.target.value = '';
});

// ─── CONFIG FILE IMPORT (Kconfig / defconfig / ini / env) ────────
$('btn-import-config').addEventListener('click', () => $('file-import-config').click());
$('file-import-config').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split('\n');

  // Parse config into sections/entries
  const sections = {};
  let currentSection = '__root__';
  sections[currentSection] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue;
    // INI-style section headers
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) { currentSection = secMatch[1]; sections[currentSection] = sections[currentSection] || []; continue; }
    // Key=value or key: value
    const kvMatch = line.match(/^([A-Za-z0-9_.\-\/]+)\s*[=:]\s*(.*)$/);
    if (kvMatch) { sections[currentSection].push({ key: kvMatch[1], value: kvMatch[2].replace(/^["']|["']$/g, '') }); continue; }
    // CONFIG_XXX=y / CONFIG_XXX is not set (Kconfig)
    const kcMatch = line.match(/^(CONFIG_\w+)=(.+)$/);
    if (kcMatch) { sections[currentSection].push({ key: kcMatch[1], value: kcMatch[2] }); continue; }
    // Fallback: add as-is
    sections[currentSection].push({ key: line, value: '' });
  }

  const cx = (canvasWrap.clientWidth / 2 - state.transform.x) / state.transform.scale;
  const cy = (canvasWrap.clientHeight / 2 - state.transform.y) / state.transform.scale;

  // Create root node
  const rootId = uid();
  await addNode(cx, cy, {
    title: file.name,
    content: `Config-Datei mit ${lines.length} Zeilen\n\n` +
      Object.keys(sections).filter(s => s !== '__root__').map(s => `- **[${s}]** (${sections[s].length})`).join('\n'),
    template: 'config',
    tags: ['config', file.name.split('.').pop()],
    skipEdit: true
  });
  const rootNode = state.nodes[state.nodes.length - 1];

  // Create child nodes for each section
  const sectionNames = Object.keys(sections);
  let offsetY = 0;
  for (const secName of sectionNames) {
    const entries = sections[secName];
    if (entries.length === 0) continue;

    // Build table content
    let content = `| Key | Value |\n| --- | --- |\n`;
    for (const entry of entries) {
      content += `| \`${entry.key}\` | \`${entry.value || '—'}\` |\n`;
    }

    offsetY += 200;
    await addNode(cx + 300, cy + offsetY - 100, {
      title: secName === '__root__' ? 'Einstellungen' : secName,
      content,
      template: 'config',
      parentId: rootNode.id,
      width: 400,
      tags: ['config-section'],
      skipEdit: true
    });
    const childNode = state.nodes[state.nodes.length - 1];
    await createEdge(rootNode.id, childNode.id);
  }

  fitView();
  showToast(`Config "${file.name}" importiert: ${sectionNames.length} Sektionen`, 'success');
  e.target.value = '';
});

$('btn-clear').addEventListener('click', async () => {
  if (!confirm('Alle Blöcke und Verbindungen löschen?')) return;
  pushUndo({ type: 'clear', nodes: state.nodes.map(n => ({...n})), edges: state.edges.map(e => ({...e})), groups: state.groups.map(g => ({...g})) });
  for (const n of [...state.nodes]) await deleteNode(n.id);
  for (const e of [...state.edges]) await deleteEdge(e.id);
  for (const g of [...state.groups]) await deleteGroupFromDB(g.id);
  state.nodes = []; state.edges = []; state.groups = [];
  nodesLayer.innerHTML = '';
  await updateMapTimestamp();
  renderEdges(); renderGroups();
  showToast('Geleert');
});

let lastMousePos = null;
canvasWrap.addEventListener('mousemove', e => { lastMousePos = { x: e.clientX, y: e.clientY }; });
