import test from 'node:test';
import assert from 'node:assert/strict';
import { mapStatus, restoreCollidedRecords } from '../server/nexus-fidelity.mjs';

test('historical preserved status stays open, matching the Nexus importer', () => {
  assert.equal(mapStatus('preserved'), 'TODO');
});

test('relinks an already-restored collided task source row on importer restart', () => {
  const source = {
    source_key: 'starq-pos-tasks.json#2',
    source_file: 'starq-pos-tasks.json',
    source_row_index: 2,
    raw_payload: JSON.stringify({ id: 'SPOS-008', title: 'POS task' }),
  };
  const updates = [];
  const handle = {
    prepare(sql) {
      if (sql.includes('FROM pm_source_records')) return { all: () => [source] };
      if (sql.includes('FROM pm_tasks')) return { get: (id) => id === 'SPOS-008:pos' ? { 1: 1 } : undefined };
      if (sql.includes('UPDATE pm_source_records')) return { run: (...args) => updates.push(args) };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const restored = restoreCollidedRecords(handle, {
    nowIso: () => '2026-10-28T00:00:00.000Z',
    boardsById: { 'starq-pos-tasks.json': 'pos' },
  });

  assert.deepEqual(restored, []);
  assert.deepEqual(updates, [['SPOS-008:pos', 'starq-pos-tasks.json#2']]);
});
