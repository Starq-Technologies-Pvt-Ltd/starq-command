// scripts/migrations/migrate-w0-provenance.mjs
// W0 Foundation Repair: P-1, P-2, P-3, P-4 per Claude r2 Convergence Package Deliverable C

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const commandRoot = path.resolve(__dir, '..', '..');
const dbPath = path.resolve(commandRoot, 'data', 'pm-operating.db');

console.log('[w0-migration] Opening database at', dbPath);
const db = new DatabaseSync(dbPath);

const baseline = {
  tasks: db.prepare('SELECT COUNT(*) AS c FROM pm_tasks').get().c,
  records: db.prepare('SELECT COUNT(*) AS c FROM pm_source_records').get().c,
  versions: db.prepare('SELECT COUNT(*) AS c FROM pm_source_record_versions').get().c,
  nullTasks: db.prepare('SELECT COUNT(*) AS c FROM pm_source_records WHERE task_id IS NULL').get().c,
  dupVersions: db.prepare("SELECT COUNT(*) AS c FROM pm_source_record_versions WHERE resolution = 'DUPLICATE_TASK_ID'").get().c,
  projects: db.prepare('SELECT COUNT(*) AS c FROM pm_projects').get().c,
  integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
};
console.log('[w0-migration] Baseline:', baseline);

const ts = new Date().toISOString();

db.exec('BEGIN IMMEDIATE');

// 1. Recreate pm_source_record_versions without PRIMARY KEY(source_key, payload_sha256) constraint
// to enable true append-only version history per P-2 / Deliverable C
db.exec(`
  CREATE TABLE pm_source_record_versions_migrated (
    source_key TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_file TEXT NOT NULL,
    source_row_index INTEGER NOT NULL,
    task_id TEXT,
    resolution TEXT NOT NULL,
    raw_status TEXT,
    raw_payload TEXT NOT NULL,
    imported_at TEXT NOT NULL
  );
  INSERT INTO pm_source_record_versions_migrated 
    SELECT source_key, payload_sha256, source_system, source_file, source_row_index, task_id, resolution, raw_status, raw_payload, imported_at
    FROM pm_source_record_versions ORDER BY rowid;
  DROP TABLE pm_source_record_versions;
  ALTER TABLE pm_source_record_versions_migrated RENAME TO pm_source_record_versions;
  CREATE INDEX IF NOT EXISTS idx_pm_source_versions_file ON pm_source_record_versions(source_file, source_row_index);
  CREATE INDEX IF NOT EXISTS idx_pm_source_versions_key ON pm_source_record_versions(source_key);
`);

// 2. Step A2: For each command-pm-v1:PM-CMD-00n, append a new version row with ARCHIVED_ID_COLLISION and task_id = NULL
const legacyKeys = [
  'command-pm-v1:PM-CMD-001',
  'command-pm-v1:PM-CMD-002',
  'command-pm-v1:PM-CMD-003',
  'command-pm-v1:PM-CMD-004',
];
for (const key of legacyKeys) {
  const current = db.prepare('SELECT * FROM pm_source_records WHERE source_key = ?').get(key);
  if (current) {
    db.prepare(`
      INSERT INTO pm_source_record_versions (source_key, payload_sha256, source_system, source_file, source_row_index, task_id, resolution, raw_status, raw_payload, imported_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'ARCHIVED_ID_COLLISION', ?, ?, ?)
    `).run(current.source_key, current.payload_sha256, current.source_system, current.source_file, current.source_row_index, current.raw_status, current.raw_payload, ts);
  }
}

// 3. Step A3: Set pm_source_records resolution='ARCHIVED_ID_COLLISION', task_id=NULL
for (const key of legacyKeys) {
  db.prepare("UPDATE pm_source_records SET resolution = 'ARCHIVED_ID_COLLISION', task_id = NULL WHERE source_key = ?").run(key);
}

// 4. Step A5: Null contaminated columns on the four provenance='LIVE' rows
db.prepare(`
  UPDATE pm_tasks SET
    nexus_task_id = NULL,
    nexus_source_file = NULL,
    nexus_source_key = NULL,
    nexus_status = NULL,
    nexus_project = NULL,
    nexus_attributes = NULL
  WHERE provenance = 'LIVE' AND id IN ('PM-CMD-001', 'PM-CMD-002', 'PM-CMD-003', 'PM-CMD-004')
`).run();

// 5. Step A7: Re-seed four LIVE rows' created_by to 'antigravity'
db.prepare(`
  UPDATE pm_tasks SET created_by = 'antigravity'
  WHERE provenance = 'LIVE' AND id IN ('PM-CMD-001', 'PM-CMD-002', 'PM-CMD-003', 'PM-CMD-004') AND created_by = 'ali'
`).run();

// 6. Step B3: Append a version row reconciling starq-pos-tasks.json#2 to IMPORTED / SPOS-008:pos
const posRow = db.prepare("SELECT * FROM pm_source_records WHERE source_key = 'starq-pos-tasks.json#2'").get();
if (posRow) {
  db.prepare(`
    INSERT INTO pm_source_record_versions (source_key, payload_sha256, source_system, source_file, source_row_index, task_id, resolution, raw_status, raw_payload, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, 'IMPORTED', ?, ?, ?)
  `).run(posRow.source_key, posRow.payload_sha256, posRow.source_system, posRow.source_file, posRow.source_row_index, 'SPOS-008:pos', posRow.raw_status, posRow.raw_payload, ts);
}

// 7. Step C2: Backfill fidelity on SPOS-008:pos so it gains its acceptance criteria
if (posRow) {
  const p = JSON.parse(posRow.raw_payload);
  const acceptanceJson = JSON.stringify(p.acceptance ?? p.acceptance_criteria ?? null);
  db.prepare("UPDATE pm_tasks SET acceptance_json = ? WHERE id = 'SPOS-008:pos'").run(acceptanceJson);
}

// 8. Step B4 & A1: Add append-only triggers
db.exec(`
  CREATE TRIGGER IF NOT EXISTS pm_source_versions_no_update BEFORE UPDATE ON pm_source_record_versions
    BEGIN SELECT RAISE(ABORT, 'pm_source_record_versions is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS pm_source_versions_no_delete BEFORE DELETE ON pm_source_record_versions
    BEGIN SELECT RAISE(ABORT, 'pm_source_record_versions is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS pm_source_records_no_delete BEFORE DELETE ON pm_source_records
    BEGIN SELECT RAISE(ABORT, 'pm_source_records are never deleted'); END;
`);

db.exec('COMMIT');
console.log('[w0-migration] Transaction committed.');
db.close();
