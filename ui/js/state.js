// Global app state and references to the main DOM elements.

// ─── STATE ──────────────────────────────────────────────────────
let state = {
  nodes: [],
  edges: [],
  groups: [],
  transform: { x: 0, y: 0, scale: 1 },
  mode: 'normal',
  connectSource: null,
  selectedNodes: new Set(),
  dragging: null,
  dragOffset: { x: 0, y: 0 },
  dragStartPositions: null,
  panning: false,
  panStart: { x: 0, y: 0 },
  panOrigin: { x: 0, y: 0 },
  selectionRect: null,
  resizing: null,
  clipboard: null,
  highlightedEdges: null,
};

let currentMapId = null;
const mapNavStack = [];

const $ = id => document.getElementById(id);
const edgesGroup = $('edges-group');
const nodesLayer = $('nodes-layer');
const tempEdge = $('temp-edge');
const canvasWrap = $('canvas-wrap');
const minimap = $('minimap');
const mmCtx = minimap.getContext('2d');
const modeIndicator = $('mode-indicator');
minimap.width = 140; minimap.height = 90;
