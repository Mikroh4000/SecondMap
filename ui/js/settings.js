// App settings: defaults, themes, persistence and applying them to the UI.
// The settings dialog lives in settings-ui.js.

const SETTINGS_KEY = 'secondmap-settings-v1';

// A value of null for the color overrides means "use the color of the theme".
const DEFAULT_SETTINGS = {
  // Appearance
  theme: 'dark',
  colorAccent: null,
  colorBg: null,
  colorNodeBg: null,
  colorText: null,
  colorEdge: null,
  nodeFont: 'mono',
  nodeFontSize: 12.5,
  nodeRadius: 10,
  nodeBorderWidth: 1.5,
  defaultNodeWidth: 220,
  nodeShadow: false,
  // Node content
  previewEnabled: true,
  previewLines: 6,
  previewMaxChars: 400,
  previewStyle: 'plain',
  viewAllMode: 'reader',
  expandedMaxHeight: 600,
  renderMath: true,
  renderMermaid: true,
  highlightCode: true,
  showImages: true,
  // Edges
  edgeStyle: 'bezier',
  edgeShowLabels: true,
  edgeArrows: true,
  edgeWidth: 1,
  // Navigation & canvas
  zoomStep: 5,
  smoothZoom: true,
  canvasGrid: 'none',
  showMinimap: true,
  showHints: true,
  animations: true,
  graphModeEnabled: true,
  graphModeThreshold: 0.4,
};

const THEMES = {
  dark: {
    label: 'Dunkel (Standard)',
    colors: {
      bg: '#0f0f0f', surface: '#1a1a1a', surface2: '#242424', border: '#2e2e2e', border2: '#3d3d3d',
      text: '#e8e6e0', text2: '#8a8780', accent: '#c8f064', accent2: '#a0c840', link: '#64b4f0', danger: '#f06464',
      nodeBg: '#1e1e1e', nodeBorder: '#333333', edge: '#555555',
      grid: 'rgba(255,255,255,0.07)', graphEdge: 'rgba(255,255,255,0.16)', minimapBg: 'rgba(26,26,26,0.9)',
    },
  },
  midnight: {
    label: 'Mitternacht (OLED-Schwarz)',
    colors: {
      bg: '#000000', surface: '#0a0a0a', surface2: '#151515', border: '#1f1f1f', border2: '#303030',
      text: '#ececec', text2: '#8a8a8a', accent: '#5ee0d0', accent2: '#3cc4b4', link: '#64b4f0', danger: '#f06464',
      nodeBg: '#0b0b0b', nodeBorder: '#262626', edge: '#4a4a4a',
      grid: 'rgba(255,255,255,0.06)', graphEdge: 'rgba(255,255,255,0.18)', minimapBg: 'rgba(10,10,10,0.92)',
    },
  },
  obsidian: {
    label: 'Obsidian (Violett)',
    colors: {
      bg: '#1e1e1e', surface: '#262626', surface2: '#2f2f2f', border: '#363636', border2: '#444444',
      text: '#dadada', text2: '#999999', accent: '#a78bfa', accent2: '#8b6df0', link: '#7aa2f7', danger: '#ff6b6b',
      nodeBg: '#262626', nodeBorder: '#3a3a3a', edge: '#5a5a66',
      grid: 'rgba(255,255,255,0.07)', graphEdge: 'rgba(255,255,255,0.2)', minimapBg: 'rgba(38,38,38,0.92)',
    },
  },
  light: {
    label: 'Hell',
    colors: {
      bg: '#f3f3f1', surface: '#ffffff', surface2: '#ececea', border: '#dededa', border2: '#c9c9c4',
      text: '#1f1f1d', text2: '#6a6964', accent: '#6fa312', accent2: '#5b8a0d', link: '#1b6ec2', danger: '#d64545',
      nodeBg: '#ffffff', nodeBorder: '#d8d8d3', edge: '#9a9a94',
      grid: 'rgba(0,0,0,0.10)', graphEdge: 'rgba(0,0,0,0.22)', minimapBg: 'rgba(255,255,255,0.92)',
    },
  },
};

const NODE_FONTS = {
  mono: 'var(--font-mono)',
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

let settings = loadSettings();
// Resolved colors (theme + overrides). Used by JS that draws colors itself (edges, minimap).
let activePalette = resolvePalette();

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (_) { /* corrupt or unavailable: use defaults */ }
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in saved)) continue;
    const def = DEFAULT_SETTINGS[key], val = saved[key];
    const valid = def === null ? (val === null || HEX_COLOR.test(val)) : typeof val === typeof def;
    if (valid) result[key] = val;
  }
  if (!THEMES[result.theme]) result.theme = 'dark';
  return result;
}

let saveSettingsTimer = null;
function saveSettings() {
  clearTimeout(saveSettingsTimer);
  saveSettingsTimer = setTimeout(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* storage unavailable */ }
  }, 250);
}

function resolvePalette() {
  const p = { ...THEMES[settings.theme].colors };
  if (settings.colorAccent) { p.accent = settings.colorAccent; p.accent2 = settings.colorAccent; }
  if (settings.colorBg) p.bg = settings.colorBg;
  if (settings.colorNodeBg) p.nodeBg = settings.colorNodeBg;
  if (settings.colorText) p.text = settings.colorText;
  if (settings.colorEdge) p.edge = settings.colorEdge;
  return p;
}

function readableTextOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#0f0f0f' : '#ffffff';
}

// Edges created before the settings existed store '#555'/'#444' as "default color".
function resolveEdgeColor(color) {
  return (!color || color === '#555' || color === '#444') ? activePalette.edge : color;
}

// Changes whenever a setting that influences how edges are built changes.
function edgeSettingsKey() {
  const p = activePalette;
  return [settings.edgeStyle, settings.edgeShowLabels, settings.edgeArrows, settings.edgeWidth,
    p.edge, p.accent, p.surface, p.border, p.text2].join(',');
}

// Increases whenever a setting that influences how node bodies are rendered changes.
let contentRenderVersion = 0;

function applyCssSettings() {
  const p = activePalette = resolvePalette();
  const vars = {
    '--bg': p.bg, '--surface': p.surface, '--surface2': p.surface2, '--border': p.border, '--border2': p.border2,
    '--text': p.text, '--text2': p.text2, '--accent': p.accent, '--accent2': p.accent2, '--link': p.link, '--danger': p.danger,
    '--node-bg': p.nodeBg, '--node-border': p.nodeBorder, '--node-selected': p.accent,
    '--edge-color': p.edge, '--edge-hover': p.accent,
    '--grid-color': p.grid, '--graph-edge': p.graphEdge, '--minimap-bg': p.minimapBg,
    '--on-accent': readableTextOn(p.accent),
    '--node-font': NODE_FONTS[settings.nodeFont] || NODE_FONTS.mono,
    '--node-font-size': settings.nodeFontSize + 'px',
    '--node-radius': settings.nodeRadius + 'px',
    '--node-border-width': settings.nodeBorderWidth + 'px',
    '--node-shadow': settings.nodeShadow ? '0 6px 18px rgba(0,0,0,0.35)' : 'none',
    '--node-preview-lines': String(settings.previewLines),
    '--node-expanded-max-height': settings.expandedMaxHeight + 'px',
  };
  const rootStyle = document.documentElement.style;
  for (const [name, value] of Object.entries(vars)) rootStyle.setProperty(name, value);

  document.body.classList.toggle('no-anim', !settings.animations);
  document.body.classList.toggle('hide-minimap', !settings.showMinimap);
  document.body.classList.toggle('hide-hints', !settings.showHints);
  canvasWrap.classList.toggle('grid-dots', settings.canvasGrid === 'dots');
  canvasWrap.classList.toggle('grid-lines', settings.canvasGrid === 'lines');
  updateCanvasGrid();
}

// The grid follows pan and zoom through inline background properties (not inherited, so cheap).
const GRID_SIZE = 40;
function updateCanvasGrid() {
  if (settings.canvasGrid === 'none') {
    if (canvasWrap.style.backgroundSize) {
      canvasWrap.style.backgroundSize = '';
      canvasWrap.style.backgroundPosition = '';
    }
    return;
  }
  const t = state.transform;
  let size = GRID_SIZE * t.scale;
  while (size < 12) size *= 4;
  canvasWrap.style.backgroundSize = size + 'px ' + size + 'px';
  canvasWrap.style.backgroundPosition = (t.x % size) + 'px ' + (t.y % size) + 'px';
}

// Which part of the app has to be refreshed after a setting changed:
//   css     – CSS variables / classes     nodes   – re-render node bodies
//   edges   – rebuild edges               view    – zoom thresholds, grid
//   minimap – redraw the minimap
function applySettings(effects) {
  if (effects.has('css')) applyCssSettings();
  if (effects.has('nodes')) refreshNodeBodies();
  if (effects.has('edges')) renderEdges();
  if (effects.has('view')) applyTransform();
  if (effects.has('minimap')) drawMinimap();
}

let pendingSettingEffects = new Set();
function queueSettingEffects(effects) {
  const wasEmpty = pendingSettingEffects.size === 0;
  for (const fx of effects) pendingSettingEffects.add(fx);
  if (!wasEmpty) return;
  // Coalesced into one update per frame so dragging a slider stays smooth.
  requestAnimationFrame(() => {
    const fx = pendingSettingEffects;
    pendingSettingEffects = new Set();
    applySettings(fx);
  });
}

function setSetting(key, value, effects = []) {
  settings[key] = value;
  saveSettings();
  queueSettingEffects(effects);
}

function replaceSettings(values, effects) {
  Object.assign(settings, values);
  saveSettings();
  queueSettingEffects(effects);
}

applyCssSettings();
