import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nexusCortexNeighborhood, nexusCortexStats, searchNexusCortex } from '../server/nexus-cortex.mjs';

function graphFixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'command-nexus-cortex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'graph.json');
  const graph = {
    nodes: [
      { id: 'project:alpha', type: 'project', title: 'Alpha Project' },
      { id: 'task:A-1', type: 'task', title: 'Supplier evidence' },
      { id: 'doc:contract', type: 'document', title: 'Supplier contract' },
    ],
    edges: [
      { id: 'PART_OF:task->project', type: 'PART_OF', from: 'task:A-1', to: 'project:alpha', provenance: { source: 'fixture', method: 'explicit' } },
      { id: 'EVIDENCED_BY:task->doc', type: 'EVIDENCED_BY', from: 'task:A-1', to: 'doc:contract', provenance: { source: 'contract.md', line: 4 } },
    ],
  };
  writeFileSync(file, JSON.stringify(graph));
  return file;
}

test('Cortex search returns linked source nodes and source counts', (t) => {
  const file = graphFixture(t);
  const stats = nexusCortexStats(file);
  const search = searchNexusCortex({ query: 'supplier evidence' }, file);
  assert.equal(stats.node_count, 3);
  assert.equal(stats.edge_count, 2);
  assert.equal(search.total, 1);
  assert.equal(search.nodes[0].id, 'task:A-1');
});

test('Cortex neighborhood follows relationships and retains provenance', (t) => {
  const file = graphFixture(t);
  const direct = nexusCortexNeighborhood({ id: 'project:alpha', depth: 1 }, file);
  assert.deepEqual(direct.nodes.map((node) => node.id), ['project:alpha', 'task:A-1']);
  assert.equal(direct.edges[0].type, 'PART_OF');
  assert.deepEqual(direct.edges[0].provenance, { source: 'fixture', method: 'explicit' });

  const twoSteps = nexusCortexNeighborhood({ id: 'project:alpha', depth: 2 }, file);
  assert.equal(twoSteps.nodes.length, 3);
  assert.equal(twoSteps.edges.length, 2);
  assert.equal(nexusCortexNeighborhood({ id: 'missing' }, file).state, 'NOT_FOUND');
});

