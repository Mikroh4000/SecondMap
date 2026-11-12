// Settings dialog. Every setting is declared once in SETTINGS_SCHEMA; the dialog, the performance
// badges and the "active performance-intensive settings" summary are all generated from it.
//
// item fields: key, type (toggle | select | range | color | button), label, desc, fx (what to refresh,
// see applySettings in settings.js), perf (true = can hurt performance), heavyWhen (value that is heavy),
// showIf (only show the row when this returns true).

const ALL_SETTING_EFFECTS = ['css', 'nodes', 'edges', 'view', 'minimap'];

const SETTINGS_SCHEMA = [
  {
    id: 'appearance', icon: '🎨', title: 'Darstellung',
    items: [
      { key: 'theme', type: 'select', label: 'Farbschema', fx: ['css', 'edges', 'minimap'],
        options: Object.entries(THEMES).map(([id, t]) => [id, t.label]) },
      { key: 'colorAccent', type: 'color', themeKey: 'accent', label: 'Akzentfarbe', desc: 'Auswahl, Buttons und Hervorhebungen.', fx: ['css', 'edges', 'minimap'] },
      { key: 'colorBg', type: 'color', themeKey: 'bg', label: 'Hintergrund', fx: ['css'] },
      { key: 'colorNodeBg', type: 'color', themeKey: 'nodeBg', label: 'Block-Hintergrund', fx: ['css'] },
      { key: 'colorText', type: 'color', themeKey: 'text', label: 'Textfarbe', fx: ['css'] },
      { key: 'colorEdge', type: 'color', themeKey: 'edge', label: 'Standardfarbe der Verbindungen', desc: 'Gilt für Verbindungen ohne eigene Farbe.', fx: ['css', 'edges', 'minimap'] },
      { key: 'nodeFont', type: 'select', label: 'Schrift im Block', fx: ['css'],
        options: [['mono', 'Monospace (Standard)'], ['sans', 'Sans-Serif'], ['serif', 'Serif']] },
      { key: 'nodeFontSize', type: 'range', label: 'Schriftgröße im Block', min: 10, max: 18, step: 0.5, unit: 'px', fx: ['css'] },
      { key: 'nodeRadius', type: 'range', label: 'Eckenradius der Blöcke', min: 0, max: 24, step: 1, unit: 'px', fx: ['css'] },
      { key: 'nodeBorderWidth', type: 'range', label: 'Rahmenstärke der Blöcke', min: 0, max: 4, step: 0.5, unit: 'px', fx: ['css'] },
      { key: 'defaultNodeWidth', type: 'range', label: 'Standardbreite neuer Blöcke', min: 160, max: 500, step: 10, unit: 'px', fx: [] },
      { key: 'nodeShadow', type: 'toggle', label: 'Schatten unter Blöcken', desc: 'Weiche Schatten – bei vielen Blöcken aufwendig zu zeichnen.', perf: true, heavyWhen: true, fx: ['css'] },
    ],
  },
  {
    id: 'content', icon: '📄', title: 'Block-Inhalt',
    items: [
      { key: 'previewEnabled', type: 'toggle', label: 'Lange Inhalte kürzen', perf: true, heavyWhen: false, fx: ['nodes'],
        desc: 'Zeigt in langen Blöcken nur den Anfang und einen „Alles anzeigen“-Button. Aus = jeder Block wird komplett gerendert (langsam, riesige Blöcke).' },
      { key: 'previewLines', type: 'range', label: 'Zeilen in der Vorschau', min: 2, max: 20, step: 1, fx: ['css', 'nodes'], showIf: s => s.previewEnabled },
      { key: 'previewMaxChars', type: 'range', label: 'Zeichen in der Vorschau (max.)', min: 100, max: 2000, step: 50, fx: ['nodes'], showIf: s => s.previewEnabled },
      { key: 'previewStyle', type: 'select', label: 'Stil der Vorschau', perf: true, heavyWhen: 'formatted', fx: ['nodes'], showIf: s => s.previewEnabled,
        options: [['plain', 'Nur Text (schnell)'], ['formatted', 'Formatiert (langsamer)']],
        desc: 'Formatiert rendert Markdown, Tabellen und Formeln auch in der Vorschau.' },
      { key: 'viewAllMode', type: 'select', label: '„Alles anzeigen“ öffnet…', fx: ['nodes'], showIf: s => s.previewEnabled,
        options: [['reader', 'Lesefenster (überlappt nichts)'], ['inline', 'Im Block aufgeklappt']] },
      { key: 'expandedMaxHeight', type: 'range', label: 'Max. Höhe aufgeklappter Blöcke', min: 200, max: 1600, step: 50, unit: 'px', fx: ['css'],
        showIf: s => s.previewEnabled && s.viewAllMode === 'inline' },
      { key: 'collapseAll', type: 'button', label: 'Alle aufgeklappten Blöcke zuklappen', buttonText: 'Zuklappen', action: collapseAllNodes,
        showIf: s => s.previewEnabled && s.viewAllMode === 'inline' },
      { key: 'renderMath', type: 'toggle', label: 'LaTeX-Formeln rendern', perf: true, heavyWhen: true, fx: ['nodes'], desc: 'Aus = Formeln werden als Rohtext angezeigt.' },
      { key: 'renderMermaid', type: 'toggle', label: 'Mermaid-Diagramme rendern', perf: true, heavyWhen: true, fx: ['nodes'], desc: 'Aus = Diagramme werden als Code angezeigt.' },
      { key: 'highlightCode', type: 'toggle', label: 'Syntax-Highlighting in Code-Blöcken', perf: true, heavyWhen: true, fx: ['nodes'] },
      { key: 'showImages', type: 'toggle', label: 'Bilder anzeigen', perf: true, heavyWhen: true, fx: ['nodes'], desc: 'Aus = Platzhalter statt Bild (spart viel Speicher bei eingebetteten Bildern).' },
    ],
  },
  {
    id: 'edges', icon: '🔗', title: 'Verbindungen',
    items: [
      { key: 'edgeStyle', type: 'select', label: 'Linienform', fx: ['edges'],
        options: [['bezier', 'Geschwungen (Standard)'], ['straight', 'Gerade']] },
      { key: 'edgeShowLabels', type: 'toggle', label: 'Beschriftungen anzeigen', fx: ['edges'] },
      { key: 'edgeArrows', type: 'toggle', label: 'Pfeilspitzen anzeigen', fx: ['edges'] },
      { key: 'edgeWidth', type: 'range', label: 'Linienstärke', min: 0.5, max: 3, step: 0.25, unit: '×', fx: ['edges'] },
    ],
  },
  {
    id: 'navigation', icon: '🧭', title: 'Navigation',
    items: [
      { key: 'zoomStep', type: 'range', label: 'Zoom-Geschwindigkeit (Mausrad)', min: 2, max: 20, step: 1, unit: '%', fx: [] },
      { key: 'smoothZoom', type: 'toggle', label: 'Weicher Zoom', perf: true, heavyWhen: true, fx: [], desc: 'Kurze Animation beim Zoomen.' },
      { key: 'canvasGrid', type: 'select', label: 'Raster im Hintergrund', perf: true, heavyWhen: v => v !== 'none', fx: ['css'],
        options: [['none', 'Aus'], ['dots', 'Punkte'], ['lines', 'Linien']], desc: 'Wandert beim Verschieben und Zoomen mit.' },
      { key: 'showMinimap', type: 'toggle', label: 'Minimap anzeigen', perf: true, heavyWhen: true, fx: ['css', 'minimap'] },
      { key: 'showHints', type: 'toggle', label: 'Tastenkürzel-Hinweise anzeigen', fx: ['css'] },
    ],
  },
  {
    id: 'performance', icon: '⚡', title: 'Leistung',
    intro: 'Bei großen Maps helfen vor allem: lange Inhalte kürzen, die Graph-Ansicht beim Herauszoomen und das Abschalten der markierten Einstellungen.',
    presets: true,
    items: [
      { key: 'graphModeEnabled', type: 'toggle', label: 'Graph-Ansicht beim Herauszoomen', perf: true, heavyWhen: false, fx: ['view'],
        desc: 'Ab einer bestimmten Zoomstufe werden Blöcke zu Punkten. Das ist bei vielen Blöcken der größte Leistungsgewinn.' },
      { key: 'graphModeThreshold', type: 'range', label: 'Graph-Ansicht ab Zoomstufe', min: 0.1, max: 0.8, step: 0.05, fx: ['view'],
        format: v => Math.round(v * 100) + ' %', showIf: s => s.graphModeEnabled,
        desc: 'Höher = früher Punkte = schneller.' },
      { key: 'animations', type: 'toggle', label: 'Animationen und Übergänge', perf: true, heavyWhen: true, fx: ['css'] },
    ],
  },
];

const SETTING_ITEMS = {};
for (const section of SETTINGS_SCHEMA) for (const item of section.items) SETTING_ITEMS[item.key] = item;

// Only the performance-intensive settings, set to their cheapest / default value.
const PERFORMANCE_PRESETS = {
  max: {
    previewEnabled: true, previewStyle: 'plain', renderMath: false, renderMermaid: false, highlightCode: false,
    showImages: false, nodeShadow: false, canvasGrid: 'none', smoothZoom: false, showMinimap: false,
    animations: false, graphModeEnabled: true, graphModeThreshold: 0.5,
  },
  balanced: {
    previewEnabled: true, previewStyle: 'plain', renderMath: true, renderMermaid: true, highlightCode: true,
    showImages: true, nodeShadow: false, canvasGrid: 'none', smoothZoom: true, showMinimap: true,
    animations: true, graphModeEnabled: true, graphModeThreshold: 0.4,
  },
};

function isHeavySetting(item) {
  if (!item.perf) return false;
  const v = settings[item.key];
  return typeof item.heavyWhen === 'function' ? item.heavyWhen(v) : v === item.heavyWhen;
}

function formatSettingValue(item, value) {
  if (item.format) return item.format(value);
  return value + (item.unit ? ' ' + item.unit : '');
}

function settingControlHtml(item) {
  const v = settings[item.key];
  switch (item.type) {
    case 'toggle':
      return `<label class="switch"><input type="checkbox" ${v ? 'checked' : ''}><span class="slider"></span></label>`;
    case 'select':
      return `<select class="form-input">${item.options.map(([val, label]) =>
        `<option value="${escHtml(val)}" ${val === v ? 'selected' : ''}>${escHtml(label)}</option>`).join('')}</select>`;
    case 'range':
      return `<input type="range" min="${item.min}" max="${item.max}" step="${item.step}" value="${v}">
        <span class="range-value">${escHtml(formatSettingValue(item, v))}</span>`;
    case 'color':
      return `<input type="color" value="${settings[item.key] || THEMES[settings.theme].colors[item.themeKey]}">
        <button class="tb-btn setting-reset" title="Auf Farbe des Farbschemas zurücksetzen" ${settings[item.key] ? '' : 'hidden'}>↺</button>`;
    case 'button':
      return `<button class="tb-btn">${escHtml(item.buttonText)}</button>`;
  }
  return '';
}

function settingRowHtml(item) {
  const badge = item.perf ? '<span class="perf-badge" title="Kann die Leistung bei vielen Blöcken spürbar beeinträchtigen">⚡ Performance-intensiv</span>' : '';
  return `<div class="setting-row" data-key="${item.key}" ${!item.showIf || item.showIf(settings) ? '' : 'hidden'}>
    <div class="setting-info">
      <div class="setting-label">${escHtml(item.label)}${badge}</div>
      ${item.desc ? `<div class="setting-desc">${escHtml(item.desc)}</div>` : ''}
    </div>
    <div class="setting-control">${settingControlHtml(item)}</div>
  </div>`;
}

function settingsSectionHtml(section) {
  const intro = section.intro ? `<div class="settings-intro">${escHtml(section.intro)}</div>` : '';
  const presets = section.presets ? `
    <div class="settings-presets">
      <button class="tb-btn accent" data-preset="max" title="Schaltet alle performance-intensiven Funktionen ab">⚡ Maximale Leistung</button>
      <button class="tb-btn" data-preset="balanced" title="Setzt die performance-intensiven Einstellungen auf den Standard">Ausgewogen (Standard)</button>
    </div>
    <div class="settings-intro" id="perf-summary"></div>` : '';
  return intro + presets + section.items.map(settingRowHtml).join('');
}

function openSettings(tabId = SETTINGS_SCHEMA[0].id) {
  if (document.getElementById('settings-backdrop')) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'settings-backdrop';
  backdrop.innerHTML = `
    <div class="modal settings-modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title">⚙ Einstellungen</div>
        <button class="modal-close" id="settings-close-btn" title="Schließen (Esc)">×</button>
      </div>
      <div class="settings-layout">
        <nav class="settings-tabs">${SETTINGS_SCHEMA.map(s =>
          `<button class="settings-tab" data-tab="${s.id}"><span>${s.icon}</span>${escHtml(s.title)}</button>`).join('')}</nav>
        <div class="settings-content" id="settings-content"></div>
      </div>
      <div class="modal-footer settings-footer">
        <button class="tb-btn danger" id="settings-reset-btn">Alles zurücksetzen</button>
        <div style="font-size:11px;color:var(--text2);align-self:center">⚡ = kann die Leistung beeinträchtigen. Änderungen werden sofort gespeichert.</div>
        <button class="tb-btn accent" id="settings-done-btn">Fertig</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const content = backdrop.querySelector('#settings-content');
  let currentTab = tabId;

  function renderTab(id) {
    currentTab = id;
    const section = SETTINGS_SCHEMA.find(s => s.id === id) || SETTINGS_SCHEMA[0];
    content.innerHTML = settingsSectionHtml(section);
    content.scrollTop = 0;
    backdrop.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === section.id));
    updatePerfSummary();
  }

  // Keeps conditional rows, theme colors and the summary in sync after a change.
  function refreshRows() {
    for (const row of content.querySelectorAll('.setting-row')) {
      const item = SETTING_ITEMS[row.dataset.key];
      row.hidden = !!item.showIf && !item.showIf(settings);
      if (item.type === 'color') {
        const input = row.querySelector('input[type="color"]');
        input.value = settings[item.key] || THEMES[settings.theme].colors[item.themeKey];
        row.querySelector('.setting-reset').hidden = !settings[item.key];
      }
    }
    updatePerfSummary();
  }

  function updatePerfSummary() {
    const el = content.querySelector('#perf-summary');
    if (!el) return;
    const heavy = Object.values(SETTING_ITEMS).filter(isHeavySetting).map(i => i.label);
    el.textContent = heavy.length
      ? `Aktive performance-intensive Einstellungen (${heavy.length}): ${heavy.join(', ')}.`
      : 'Keine performance-intensiven Einstellungen aktiv.';
  }

  function onChange(e) {
    const row = e.target.closest('.setting-row');
    if (!row) return;
    const item = SETTING_ITEMS[row.dataset.key];
    const input = e.target;
    const live = input.type === 'range' || input.type === 'color';
    if ((e.type === 'input') !== live) return;

    let value;
    if (item.type === 'toggle') value = input.checked;
    else if (item.type === 'range') value = parseFloat(input.value);
    else value = input.value;

    setSetting(item.key, value, item.fx);
    if (item.type === 'range') row.querySelector('.range-value').textContent = formatSettingValue(item, value);
    refreshRows();
  }
  content.addEventListener('input', onChange);
  content.addEventListener('change', onChange);

  content.addEventListener('click', e => {
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      replaceSettings(PERFORMANCE_PRESETS[preset.dataset.preset], ALL_SETTING_EFFECTS);
      renderTab(currentTab);
      return;
    }
    const row = e.target.closest('.setting-row');
    if (!row) return;
    const item = SETTING_ITEMS[row.dataset.key];
    if (item.type === 'button' && e.target.closest('button')) item.action();
    if (item.type === 'color' && e.target.closest('.setting-reset')) {
      setSetting(item.key, null, item.fx);
      refreshRows();
    }
  });

  backdrop.querySelector('.settings-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.settings-tab');
    if (tab) renderTab(tab.dataset.tab);
  });

  backdrop.querySelector('#settings-reset-btn').addEventListener('click', () => {
    if (!confirm('Alle Einstellungen auf die Standardwerte zurücksetzen?')) return;
    replaceSettings({ ...DEFAULT_SETTINGS }, ALL_SETTING_EFFECTS);
    renderTab(currentTab);
  });

  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close() {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
  }
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#settings-close-btn').addEventListener('click', close);
  backdrop.querySelector('#settings-done-btn').addEventListener('click', close);

  renderTab(tabId);
}
