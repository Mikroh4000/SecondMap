// Edges: SVG rendering of connections between nodes.

// ─── EDGES SVG ───────────────────────────────────────────────────
function getNodeCenter(id) {
  const n = state.nodes.find(n => n.id === id);
  if (!n) return null;
  const sz = getNodeSize(n);
  return { x: n.x + sz.w / 2, y: n.y + sz.h / 2 };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const edgeRecs = new Map();

function buildEdgeRecord(edge, graphMode, isHighlighted) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.dataset.edgeId = edge.id;

  const baseWidth = 1 + (edge.weight || 1) * 0.5;
  const strokeColor = isHighlighted ? '#c8f064' : (edge.color || '#444');
  const strokeWidth = isHighlighted ? baseWidth + 1.5 : baseWidth;

  let dashArray = '';
  if (edge.style === 'dashed') dashArray = '8 4';
  else if (edge.style === 'dotted') dashArray = '2 4';

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('stroke', strokeColor);
  path.setAttribute('stroke-width', strokeWidth.toString());
  path.setAttribute('fill', 'none');
  path.classList.add('edge-line');
  path.setAttribute('marker-end', isHighlighted ? 'url(#arrow-hover)' : 'url(#arrow)');
  if (dashArray) path.setAttribute('stroke-dasharray', dashArray);
  if (edge.bidirectional) path.setAttribute('marker-start', isHighlighted ? 'url(#arrow-start-hover)' : 'url(#arrow-start)');
  if (isHighlighted) g.classList.add('edge-path-highlighted');
  path.style.cursor = 'pointer';

  path.addEventListener('mouseenter', () => {
    path.setAttribute('stroke', '#c8f064');
    path.setAttribute('marker-end', 'url(#arrow-hover)');
    if (edge.bidirectional) path.setAttribute('marker-start', 'url(#arrow-start-hover)');
  });
  path.addEventListener('mouseleave', () => {
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('marker-end', isHighlighted ? 'url(#arrow-hover)' : 'url(#arrow)');
    if (edge.bidirectional) path.setAttribute('marker-start', isHighlighted ? 'url(#arrow-start-hover)' : 'url(#arrow-start)');
  });

  const openEd = () => openEdgeEdit(edge.id);
  path.addEventListener('click', openEd);

  const hitPath = document.createElementNS(SVG_NS, 'path');
  hitPath.setAttribute('stroke', 'transparent');
  hitPath.setAttribute('stroke-width', '12');
  hitPath.setAttribute('fill', 'none');
  hitPath.classList.add('edge-hit');
  hitPath.style.cursor = 'pointer';
  hitPath.addEventListener('click', openEd);

  g.appendChild(path);
  g.appendChild(hitPath);

  const rec = { g, path, hit: hitPath, d: '', bg: null, text: null, labelKey: '' };

  // Labels are hidden in graph mode, so they are not even created there.
  const label = graphMode ? '' : (edge.label ?? '').toString().trim();
  if (label) {
    const textLen = Math.max(24, label.length * 7 + 16);
    const bgRect = document.createElementNS(SVG_NS, 'rect');
    bgRect.setAttribute('width', textLen.toString());
    bgRect.setAttribute('height', '20');
    bgRect.setAttribute('rx', '4');
    bgRect.setAttribute('fill', '#1a1a1a');
    bgRect.setAttribute('stroke', '#2e2e2e');
    bgRect.setAttribute('stroke-width', '1');
    bgRect.style.pointerEvents = 'auto';
    bgRect.style.cursor = 'pointer';
    bgRect.addEventListener('click', openEd);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-family', 'IBM Plex Mono, monospace');
    text.setAttribute('font-size', '11');
    text.setAttribute('fill', '#8a8780');
    text.style.pointerEvents = 'auto';
    text.style.cursor = 'pointer';
    text.textContent = label;
    text.addEventListener('click', openEd);

    g.appendChild(bgRect);
    g.appendChild(text);
    rec.bg = bgRect; rec.text = text; rec.textLen = textLen;
  }
  return rec;
}

// Reconciles the SVG against state: existing edges only get their geometry updated,
// DOM is (re)built only for edges whose appearance changed.
function renderEdges() {
  const nodeMap = buildNodeMap();
  const hidden = computeHiddenSet(nodeMap);
  const seen = new Set();
  let structural = false;

  for (const edge of state.edges) {
    try {
      const sn = nodeMap.get(edge.source), tn = nodeMap.get(edge.target);
      if (!sn || !tn || hidden.has(sn.id) || hidden.has(tn.id)) continue;
      seen.add(edge.id);

      const isHighlighted = !!(state.highlightedEdges && state.highlightedEdges.has(edge.id));
      const sig = [edge.source, edge.target, edge.color, edge.style, edge.weight, edge.bidirectional,
        edge.label, isHighlighted, graphMode].join('|');
      let rec = edgeRecs.get(edge.id);
      if (!rec || rec.sig !== sig || !rec.g.isConnected) {
        if (rec) rec.g.remove();
        rec = buildEdgeRecord(edge, graphMode, isHighlighted);
        rec.sig = sig;
        edgeRecs.set(edge.id, rec);
        edgesGroup.appendChild(rec.g);
        structural = true;
      }

      const ssz = getNodeSize(sn), tsz = getNodeSize(tn);
      const sx = sn.x + ssz.w / 2, sy = sn.y + ssz.h / 2;
      const tx = tn.x + tsz.w / 2, ty = tn.y + tsz.h / 2;
      const cx1 = sx + (tx - sx) * 0.3, cy1 = sy;
      const cx2 = sx + (tx - sx) * 0.7, cy2 = ty;
      const d = graphMode
        ? `M${sx},${sy} L${tx},${ty}`
        : `M${sx},${sy} C${cx1},${cy1} ${cx2},${cy2} ${tx},${ty}`;
      if (rec.d !== d) {
        rec.d = d;
        rec.path.setAttribute('d', d);
        rec.hit.setAttribute('d', d);
        if (rec.bg) {
          const mx = 0.125 * sx + 0.375 * cx1 + 0.375 * cx2 + 0.125 * tx;
          const my = 0.125 * sy + 0.375 * cy1 + 0.375 * cy2 + 0.125 * ty;
          rec.bg.setAttribute('x', (mx - rec.textLen / 2).toString());
          rec.bg.setAttribute('y', (my - 10).toString());
          rec.text.setAttribute('x', mx.toString());
          rec.text.setAttribute('y', my.toString());
        }
      }
    } catch (err) {
      // Skip malformed edge entries without breaking full render.
      console.warn('Edge render skipped', edge?.id, err);
    }
  }

  for (const [id, rec] of edgeRecs) {
    if (!seen.has(id)) { rec.g.remove(); edgeRecs.delete(id); structural = true; }
  }
  if (structural) updateGraphDotSizes();
  drawMinimap();
}
