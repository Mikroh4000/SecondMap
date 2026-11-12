// Highlighting the path between two nodes.

// ─── PATH HIGHLIGHTING ──────────────────────────────────────────
function findShortestPath(startId, endId) {
  const adj = {};
  for (const n of state.nodes) adj[n.id] = [];
  for (const e of state.edges) {
    if (!adj[e.source]) adj[e.source] = [];
    if (!adj[e.target]) adj[e.target] = [];
    adj[e.source].push({ node: e.target, edge: e.id });
    adj[e.target].push({ node: e.source, edge: e.id });
  }
  const queue = [{ node: startId, path: [], edges: [] }];
  const visited = new Set([startId]);
  while (queue.length > 0) {
    const { node, path, edges } = queue.shift();
    if (node === endId) return { nodes: [...path, node], edges };
    for (const neighbor of (adj[node] || [])) {
      if (!visited.has(neighbor.node)) {
        visited.add(neighbor.node);
        queue.push({ node: neighbor.node, path: [...path, node], edges: [...edges, neighbor.edge] });
      }
    }
  }
  return null;
}

function highlightPath() {
  const ids = [...state.selectedNodes];
  if (ids.length !== 2) {
    showToast('Wähle genau 2 Blöcke für Pfad-Highlighting');
    return;
  }
  const result = findShortestPath(ids[0], ids[1]);
  if (!result) {
    showToast('Kein Pfad gefunden');
    state.highlightedEdges = null;
    renderEdges();
    return;
  }
  state.highlightedEdges = new Set(result.edges);
  renderEdges();
  showToast(`Kürzester Pfad: ${result.nodes.length} Blöcke, ${result.edges.length} Verbindungen`, 'success');
}
