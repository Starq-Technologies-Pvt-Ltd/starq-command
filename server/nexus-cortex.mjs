import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NEXUS_CORTEX_GRAPH = path.resolve(
  process.env.STARQ_COMMAND_NEXUS_GRAPH || path.join(APP_ROOT, 'recovered', 'nexus', 'starqNexus', 'data', 'index', 'graph.json'),
);
let cache = null;

function readGraph(graphPath = NEXUS_CORTEX_GRAPH) {
  const stat = fs.statSync(graphPath);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('Cortex graph source is outside the read boundary');
  if (cache?.path === graphPath && cache.size === stat.size && cache.mtimeMs === stat.mtimeMs) return cache;
  const bytes = fs.readFileSync(graphPath);
  const graph = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Cortex graph requires node and edge arrays');
  const nodeIds = new Set(graph.nodes.filter((n) => n && typeof n.id === 'string').map((n) => n.id));
  const edges = graph.edges.filter((e) => e && typeof e.id === 'string' && nodeIds.has(e.from) && nodeIds.has(e.to));
  const nodes = graph.nodes.filter((n) => n && typeof n.id === 'string');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  cache = {
    path: graphPath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    modified_at: stat.mtime.toISOString(),
    sha256,
    nodes,
    edges,
    byId: new Map(nodes.map((node) => [node.id, node])),
  };
  return cache;
}

export function nexusCortexStats(graphPath = NEXUS_CORTEX_GRAPH) {
  const graph = readGraph(graphPath);
  const nodeTypes = {};
  const edgeTypes = {};
  for (const node of graph.nodes) nodeTypes[node.type || 'unknown'] = (nodeTypes[node.type || 'unknown'] || 0) + 1;
  for (const edge of graph.edges) edgeTypes[edge.type || 'unknown'] = (edgeTypes[edge.type || 'unknown'] || 0) + 1;
  return {
    state: 'AVAILABLE',
    authority: 'RECOVERED_SOURCE_COPY',
    read_only: true,
    source: 'starqNexus/data/index/graph.json',
    modified_at: graph.modified_at,
    sha256: graph.sha256,
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    node_types: nodeTypes,
    edge_types: edgeTypes,
  };
}

export function searchNexusCortex({ query = '', type = '', limit = 12 } = {}, graphPath = NEXUS_CORTEX_GRAPH) {
  const graph = readGraph(graphPath);
  const terms = String(query).trim().slice(0, 240).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const selectedType = String(type).trim().slice(0, 80);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const matches = graph.nodes.filter((node) => {
    if (selectedType && node.type !== selectedType) return false;
    const searchable = `${node.id}\n${node.title || ''}\n${node.summary || ''}\n${node.canonicalPath || ''}\n${node.domain || ''}`.toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
  matches.sort((a, b) => {
    if (terms.length) {
      const score = (node) => terms.reduce((sum, term) => sum + (node.id.toLocaleLowerCase().includes(term) ? 4 : 0) + (String(node.title || '').toLocaleLowerCase().includes(term) ? 2 : 0), 0);
      const delta = score(b) - score(a);
      if (delta) return delta;
    }
    return String(a.title || a.id).localeCompare(String(b.title || b.id));
  });
  return {
    state: 'AVAILABLE', authority: 'RECOVERED_SOURCE_COPY', read_only: true,
    query: String(query).trim().slice(0, 240), total: matches.length,
    nodes: matches.slice(0, safeLimit),
  };
}

export function nexusCortexNeighborhood({ id, depth = 1, limit = 56 } = {}, graphPath = NEXUS_CORTEX_GRAPH) {
  const graph = readGraph(graphPath);
  const focusId = String(id || '').trim().slice(0, 300);
  const focus = graph.byId.get(focusId);
  if (!focus) return { state: 'NOT_FOUND', authority: 'RECOVERED_SOURCE_COPY', read_only: true, focus: null, nodes: [], edges: [] };
  const maxDepth = Math.max(1, Math.min(3, Number(depth) || 1));
  const maxNodes = Math.max(2, Math.min(120, Number(limit) || 56));
  const adjacency = new Map();
  for (const edge of graph.edges) {
    const from = adjacency.get(edge.from) || [];
    from.push(edge);
    adjacency.set(edge.from, from);
    const to = adjacency.get(edge.to) || [];
    to.push(edge);
    adjacency.set(edge.to, to);
  }
  const distance = new Map([[focusId, 0]]);
  const selectedEdges = new Map();
  const queue = [focusId];
  let truncated = false;
  while (queue.length) {
    const currentId = queue.shift();
    const currentDepth = distance.get(currentId);
    if (currentDepth >= maxDepth) continue;
    for (const edge of adjacency.get(currentId) || []) {
      selectedEdges.set(edge.id, edge);
      const nextId = edge.from === currentId ? edge.to : edge.from;
      if (distance.has(nextId)) continue;
      if (distance.size >= maxNodes) { truncated = true; continue; }
      distance.set(nextId, currentDepth + 1);
      queue.push(nextId);
    }
  }
  const nodes = [...distance.keys()].map((nodeId) => graph.byId.get(nodeId)).filter(Boolean);
  const nodeSet = new Set(nodes.map((node) => node.id));
  const edges = [...selectedEdges.values()].filter((edge) => nodeSet.has(edge.from) && nodeSet.has(edge.to));
  return {
    state: 'AVAILABLE', authority: 'RECOVERED_SOURCE_COPY', read_only: true,
    focus, nodes, edges, depth: maxDepth, truncated,
  };
}

