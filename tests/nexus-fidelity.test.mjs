import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initSchema } from '../server/pm-service.mjs';
import { restoreCollidedRecords } from '../server/nexus-fidelity.mjs';

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
      // Relink also records a source-record version. No prior version exists here.
      if (sql.includes('FROM pm_source_record_versions')) return { get: () => undefined };
      if (sql.includes('INSERT INTO pm_source_record_versions')) return { run: () => {} };
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

test('first collision restore appends an IMPORTED version and a second restore does not', () => {
  const db = new DatabaseSync(':memory:');
  initSchema(db);
  const ts = '2026-10-28T00:00:00.000Z';
  const payload = JSON.stringify({ id: 'SPOS-008', title: 'POS task', status: 'planned' });
  const payloadHash = createHash('sha256').update(payload).digest('hex');

  db.prepare('INSERT INTO pm_projects (id, name, prefix, created_at) VALUES (?, ?, ?, ?)').run('erp', 'STARQ ERP', 'SERP', ts);
  db.prepare('INSERT INTO pm_projects (id, name, prefix, created_at) VALUES (?, ?, ?, ?)').run('pos', 'STARQ POS', 'SPOS', ts);
  db.prepare(
    `INSERT INTO pm_tasks (id, project_id, title, status, created_by, created_at, updated_at)
     VALUES ('SPOS-008', 'erp', 'ERP card', 'DONE', 'nexus-import', ?, ?)`,
  ).run(ts, ts);
  db.prepare(
    `INSERT INTO pm_import_sources (source_file, source_system, content_sha256, row_count, imported_at)
     VALUES ('starq-pos-tasks.json', 'starqNexus', ?, 1, ?)`,
  ).run(payloadHash, ts);
  db.prepare(
    `INSERT INTO pm_source_records (
       source_key, source_system, source_file, source_row_index, task_id, resolution, raw_status, payload_sha256, raw_payload, imported_at
     ) VALUES ('starq-pos-tasks.json#2', 'starqNexus', 'starq-pos-tasks.json', 2, NULL, 'DUPLICATE_TASK_ID', 'planned', ?, ?, ?)`,
  ).run(payloadHash, payload, ts);
  db.prepare(
    `INSERT INTO pm_source_record_versions (
       source_key, payload_sha256, source_system, source_file, source_row_index, task_id, resolution, raw_status, raw_payload, imported_at
     ) VALUES ('starq-pos-tasks.json#2', ?, 'starqNexus', 'starq-pos-tasks.json', 2, NULL, 'DUPLICATE_TASK_ID', 'planned', ?, ?)`,
  ).run(payloadHash, payload, ts);

  const restored = restoreCollidedRecords(db, {
    nowIso: () => ts,
    boardsById: { 'starq-pos-tasks.json': 'pos' },
  });
  assert.equal(restored.length, 1);
  assert.equal(restored[0].stored_as, 'SPOS-008:pos');

  const source = db.prepare("SELECT task_id, resolution FROM pm_source_records WHERE source_key = 'starq-pos-tasks.json#2'").get();
  assert.equal(source.task_id, 'SPOS-008:pos');
  assert.equal(source.resolution, 'IMPORTED');

  const versions = db.prepare(
    "SELECT task_id, resolution FROM pm_source_record_versions WHERE source_key = 'starq-pos-tasks.json#2' ORDER BY rowid",
  ).all();
  assert.equal(versions.length, 2);
  assert.equal(versions[0].task_id, null);
  assert.equal(versions[0].resolution, 'DUPLICATE_TASK_ID');
  assert.equal(versions[1].task_id, 'SPOS-008:pos');
  assert.equal(versions[1].resolution, 'IMPORTED');

  const again = restoreCollidedRecords(db, {
    nowIso: () => '2026-10-28T01:00:00.000Z',
    boardsById: { 'starq-pos-tasks.json': 'pos' },
  });
  assert.deepEqual(again, []);
  const after = db.prepare(
    "SELECT COUNT(*) AS n FROM pm_source_record_versions WHERE source_key = 'starq-pos-tasks.json#2'",
  ).get();
  assert.equal(after.n, 2);
  db.close();
});
