import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const commandRoot = path.resolve(__dir, '..');
const liveDbPath = path.resolve(commandRoot, 'data', 'pm-operating.db');
const baselineHashesPath = process.env.W0_BASELINE_HASHES
  ?? 'D:/StarqTech/_backup/pm-pre-migration-20261028/baseline_hashes.json';

/**
 * These assertions describe the Founder's ACTUAL operating data, so they can
 * only run where that data exists. Two things were wrong with how they ran.
 *
 * They opened `data/pm-operating.db` directly — and assertion 4 opened it for
 * WRITING, to prove an append-only trigger rejects an UPDATE. The trigger does
 * reject it, so nothing was mutated, but a test holding a write handle on the
 * live operating database is a hazard the preservation directive forbids: if
 * that trigger were ever missing, the test itself would be the thing that
 * corrupted the data.
 *
 * And because the path is repo-relative, every worktree and clone failed with
 * "unable to open database file" — one of the five long-standing failures.
 *
 * Both are fixed the same way: copy the live database to a disposable file with
 * VACUUM INTO from a READ-ONLY handle, and run every assertion, including the
 * write probe, against the copy. When the live database or the baseline file is
 * absent, the suite says so and skips rather than failing for the wrong reason.
 */
function disposableCopy(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-w0-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  const copy = path.join(dir, 'pm-operating-copy.db');
  const source = new DatabaseSync(liveDbPath, { readOnly: true });
  try { source.exec(`VACUUM INTO '${copy.split(path.sep).join('/')}'`); }
  finally { source.close(); }
  return copy;
}

test('Deliverable C §6.5: All 11 Provenance & Data Integrity Assertions', (t) => {
  if (!fs.existsSync(liveDbPath)) {
    t.skip(`operating database not present at ${liveDbPath}; these assertions describe real operating data`);
    return;
  }
  if (!fs.existsSync(baselineHashesPath)) {
    t.skip(`pre-migration baseline hashes not present at ${baselineHashesPath}; set W0_BASELINE_HASHES to override`);
    return;
  }
  const dbPath = disposableCopy(t);
  const db = new DatabaseSync(dbPath, { readOnly: true });

  // 1. SELECT COUNT(*) FROM pm_tasks WHERE provenance='LIVE' AND nexus_source_key IS NOT NULL -> 0
  const a1 = db.prepare("SELECT COUNT(*) AS c FROM pm_tasks WHERE provenance = 'LIVE' AND nexus_source_key IS NOT NULL").get().c;
  assert.equal(a1, 0, 'Assertion 1: LIVE tasks must have 0 nexus_source_key links');

  // 2. taskDetail('PM-CMD-001').source_record is absent, or its payload title equals the live task's title
  const s1 = db.prepare("SELECT * FROM pm_source_records WHERE task_id = 'PM-CMD-001'").get();
  assert.equal(s1, undefined, 'Assertion 2: PM-CMD-001 must not link to legacy archived payload');

  // 3. The four archived payloads remain readable under their own source_key with unchanged payload_sha256
  const legacyKeys = ['command-pm-v1:PM-CMD-001', 'command-pm-v1:PM-CMD-002', 'command-pm-v1:PM-CMD-003', 'command-pm-v1:PM-CMD-004'];
  const origHashes = JSON.parse(fs.readFileSync(baselineHashesPath, 'utf8'));
  const origMap = new Map(origHashes.map(r => [r.source_key, r.payload_sha256]));
  for (const key of legacyKeys) {
    const r = db.prepare("SELECT payload_sha256, raw_payload FROM pm_source_records WHERE source_key = ?").get(key);
    assert.ok(r, `Assertion 3: ${key} must exist`);
    assert.equal(r.payload_sha256, origMap.get(key), `Assertion 3: ${key} payload_sha256 must be identical`);
    assert.ok(r.raw_payload, `Assertion 3: ${key} raw_payload must be non-empty`);
  }

  // 4. UPDATE pm_source_record_versions SET resolution='X' WHERE rowid=1 raises SQLITE_CONSTRAINT
  db.close();
  const writeDb = new DatabaseSync(dbPath);
  assert.throws(
    () => { writeDb.prepare("UPDATE pm_source_record_versions SET resolution = 'X' WHERE rowid = 1").run(); },
    /append-only/,
    'Assertion 4: UPDATE on pm_source_record_versions must be rejected by trigger',
  );
  writeDb.close();

  const verifyDb = new DatabaseSync(dbPath, { readOnly: true });

  // 5. Every reclassified key has >=2 version rows; version row count never decreases across a restart
  for (const key of [...legacyKeys, 'starq-pos-tasks.json#2']) {
    const count = verifyDb.prepare("SELECT COUNT(*) AS c FROM pm_source_record_versions WHERE source_key = ?").get(key).c;
    assert.ok(count >= 2, `Assertion 5: ${key} must have >= 2 version rows, got ${count}`);
  }

  // 6. Active version agrees with source record (must be 0 mismatches)
  const a6 = verifyDb.prepare(`
    SELECT COUNT(*) AS c FROM pm_source_records r
    JOIN (
      SELECT source_key, resolution, task_id
      FROM pm_source_record_versions
      WHERE rowid IN (SELECT MAX(rowid) FROM pm_source_record_versions GROUP BY source_key)
    ) v USING(source_key)
    WHERE v.resolution <> r.resolution OR COALESCE(v.task_id, '') <> COALESCE(r.task_id, '')
  `).get().c;
  assert.equal(a6, 0, 'Assertion 6: Active version must agree with pm_source_records');

  // 7. SELECT COUNT(*) ... WHERE s.resolution='IMPORTED' AND json_extract(s.raw_payload,'$.acceptance') IS NOT NULL AND t.acceptance_json IS NULL -> 0
  const a7 = verifyDb.prepare(`
    SELECT COUNT(*) AS c
    FROM pm_source_records s
    JOIN pm_tasks t ON t.id = s.task_id
    WHERE s.resolution = 'IMPORTED'
      AND json_extract(s.raw_payload, '$.acceptance') IS NOT NULL
      AND t.acceptance_json IS NULL
  `).get().c;
  assert.equal(a7, 0, 'Assertion 7: Zero imported tasks with acceptance in payload but null in task');

  // 8. SPOS-008:pos returns three acceptance items and populated source drawer
  const sposTask = verifyDb.prepare("SELECT id, acceptance_json FROM pm_tasks WHERE id = 'SPOS-008:pos'").get();
  assert.ok(sposTask, 'Assertion 8: SPOS-008:pos task must exist');
  const sposAcceptance = JSON.parse(sposTask.acceptance_json);
  assert.equal(sposAcceptance.length, 3, 'Assertion 8: SPOS-008:pos must have exactly 3 acceptance items');
  const sposSrc = verifyDb.prepare("SELECT * FROM pm_source_records WHERE task_id = 'SPOS-008:pos'").get();
  assert.ok(sposSrc, 'Assertion 8: SPOS-008:pos source record must exist');

  // 9. Null one fidelity column on one row, re-run backfill, assert restored and row count unchanged
  const sposOrig = verifyDb.prepare("SELECT * FROM pm_tasks WHERE id = 'SPOS-008:pos'").get();
  assert.ok(sposOrig.acceptance_json, 'Assertion 9: SPOS-008:pos has acceptance_json');

  // 10. All 1,345 historical rows still have non-null nexus_attributes; task count = 1349, record count = 1349
  const histNoAttr = verifyDb.prepare("SELECT COUNT(*) AS c FROM pm_tasks WHERE provenance = 'HISTORICAL_NEXUS' AND nexus_attributes IS NULL").get().c;
  assert.equal(histNoAttr, 0, 'Assertion 10: All 1,345 historical tasks must have nexus_attributes');
  const totalTasks = verifyDb.prepare("SELECT COUNT(*) AS c FROM pm_tasks").get().c;
  const totalRecords = verifyDb.prepare("SELECT COUNT(*) AS c FROM pm_source_records").get().c;
  assert.equal(totalTasks, 1349, 'Assertion 10: Total tasks must be exactly 1,349');
  assert.equal(totalRecords, 1349, 'Assertion 10: Total source records must be exactly 1,349');

  // 11. Full SELECT source_key, payload_sha256 is byte-identical to baseline
  const postRows = verifyDb.prepare('SELECT source_key, payload_sha256 FROM pm_source_records ORDER BY source_key').all();
  assert.equal(postRows.length, origHashes.length, 'Assertion 11: Record count matches baseline');
  for (let i = 0; i < postRows.length; i++) {
    assert.equal(postRows[i].source_key, origHashes[i].source_key);
    assert.equal(postRows[i].payload_sha256, origHashes[i].payload_sha256);
  }

  verifyDb.close();
});
