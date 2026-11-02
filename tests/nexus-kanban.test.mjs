import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importLegacyPmSnapshot, importNexusBoards, mapKanbanStatus, NEXUS_BOARDS, nexusTaskToRow } from '../server/nexus-kanban.mjs';

test('Nexus planned/todo land in To Do, next in Next Up, done stays Done', () => {
  assert.equal(mapKanbanStatus('planned'), 'TODO');
  assert.equal(mapKanbanStatus('todo'), 'TODO');
  assert.equal(mapKanbanStatus('next'), 'NEXT');
  assert.equal(mapKanbanStatus('in_progress'), 'IN_PROGRESS');
  assert.equal(mapKanbanStatus('blocked'), 'BLOCKED');
  assert.equal(mapKanbanStatus('done'), 'DONE');
  assert.equal(mapKanbanStatus('CLOSED'), 'DONE');
  assert.equal(mapKanbanStatus('BACKLOG'), 'TODO');
  assert.equal(mapKanbanStatus('READY'), 'NEXT');
});

test('catalog covers the Nexus task JSON boards plus Command', () => {
  const ids = NEXUS_BOARDS.map((b) => b.id);
  assert.ok(ids.includes('command'));
  assert.ok(ids.includes('erp'));
  assert.ok(ids.includes('hoadha'));
  assert.ok(ids.includes('founder-decisions'));
  assert.ok(ids.includes('starqbooks'));
  assert.equal(NEXUS_BOARDS.filter((b) => b.file).length, 18);
});

test('import rows keep original ids and original status in notes', () => {
  const row = nexusTaskToRow(
    { id: 'SERP-001', title: 'Supplier CREATE', status: 'planned', workers: ['codex'], description: 'Keep the board.' },
    { id: 'erp', file: 'starq-erp-tasks.json' },
    '2026-10-27T00:00:00.000Z',
  );
  assert.equal(row.id, 'SERP-001');
  assert.equal(row.status, 'TODO');
  assert.equal(row.owner, 'codex');
  assert.match(row.notes, /original status: planned/);
});

test('import retains full source payloads, relationships, hashes, and duplicate rows', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'command-nexus-source-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE pm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE pm_projects (id TEXT PRIMARY KEY, name TEXT, prefix TEXT, description TEXT, hold_state TEXT, source_gap TEXT, next_seq INTEGER, created_at TEXT);
    CREATE TABLE pm_tasks (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, description TEXT, priority TEXT, status TEXT, owner TEXT, verifier TEXT, room_authorization_ref TEXT, evidence_refs TEXT, depends_on TEXT, notes TEXT, created_by TEXT, created_at TEXT, updated_at TEXT, closed_at TEXT);
    CREATE TABLE pm_status_log (id INTEGER PRIMARY KEY, task_id TEXT, event_type TEXT, from_status TEXT, to_status TEXT, actor TEXT, detail TEXT, timestamp TEXT, room_sync TEXT);
    CREATE TABLE pm_import_sources (source_file TEXT PRIMARY KEY, source_system TEXT, content_sha256 TEXT, row_count INTEGER, imported_at TEXT);
    CREATE TABLE pm_source_records (source_key TEXT PRIMARY KEY, source_system TEXT, source_file TEXT, source_row_index INTEGER, task_id TEXT, resolution TEXT, raw_status TEXT, payload_sha256 TEXT, raw_payload TEXT, imported_at TEXT, UNIQUE(source_file,source_row_index));
    CREATE TABLE pm_import_source_versions (source_file TEXT, content_sha256 TEXT, row_count INTEGER, imported_at TEXT, PRIMARY KEY(source_file,content_sha256));
    CREATE TABLE pm_source_record_versions (source_key TEXT, payload_sha256 TEXT, source_system TEXT, source_file TEXT, source_row_index INTEGER, task_id TEXT, resolution TEXT, raw_status TEXT, raw_payload TEXT, imported_at TEXT, PRIMARY KEY(source_key,payload_sha256));
  `);
  const when = '2026-10-27T00:00:00.000Z';
  const duplicateRows = [
    { id: 'STU-001', title: 'Retain source graph', status: 'planned', workers: ['codex', 'cursor'], depends_on: ['STU-000'], blocked_by: ['STU-099'], related: ['SERP-002'], parent: 'STU-ROOT', children: ['STU-001A'], acceptance_evidence: ['evidence/a.md'], phase: 'P1', custom_field: { source: 'kept' } },
    { id: 'STU-001', title: 'Duplicate source row', status: 'todo', workers: ['vision'], depends_on: ['STU-500'] },
  ];
  for (const board of NEXUS_BOARDS) {
    if (!board.file) continue;
    mkdirSync(path.dirname(path.join(dir, board.file)), { recursive: true });
    writeFileSync(path.join(dir, board.file), JSON.stringify({ project: board.name, tasks: board.id === 'studio' ? duplicateRows : [] }));
    db.prepare('INSERT INTO pm_projects (id,name,prefix,description,next_seq,created_at) VALUES (?,?,?,?,?,?)')
      .run(board.id, board.name, board.prefix, board.description, 1, when);
  }

  const result = importNexusBoards(db, { nowIso: () => when, json: JSON.stringify, dataRoot: dir });
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  const rows = db.prepare('SELECT * FROM pm_source_records WHERE source_file = ? ORDER BY source_row_index').all('starq-studio-tasks.json');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].resolution, 'IMPORTED');
  assert.equal(rows[1].resolution, 'DUPLICATE_TASK_ID');
  assert.equal(rows[1].task_id, null);
  assert.equal(rows[0].raw_status, 'planned');
  assert.equal(rows[0].payload_sha256, createHash('sha256').update(JSON.stringify(duplicateRows[0])).digest('hex'));
  assert.deepEqual(JSON.parse(rows[0].raw_payload), duplicateRows[0]);
  assert.deepEqual(JSON.parse(rows[1].raw_payload), duplicateRows[1]);
  const source = db.prepare('SELECT * FROM pm_import_sources WHERE source_file = ?').get('starq-studio-tasks.json');
  assert.equal(source.row_count, 2);
  assert.equal(source.content_sha256, createHash('sha256').update(JSON.stringify({ project: 'Starq Studio', tasks: duplicateRows })).digest('hex'));
  const repeated = importNexusBoards(db, { nowIso: () => when, json: JSON.stringify, dataRoot: dir });
  assert.equal(repeated.imported, 0);
  assert.equal(repeated.preserved, 1);
  assert.equal(repeated.skipped, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pm_tasks').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pm_source_records').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pm_import_source_versions').get().n, 18);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pm_source_record_versions').get().n, 2);
});

test('legacy Command PM database is preserved as archived records without colliding with live task ids', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'command-legacy-pm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourcePath = path.join(dir, 'pm-board.db');
  const legacy = new DatabaseSync(sourcePath);
  legacy.exec(`
    CREATE TABLE pm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE pm_projects (id TEXT PRIMARY KEY, name TEXT, prefix TEXT, description TEXT, hold_state TEXT, source_gap TEXT, next_seq INTEGER, created_at TEXT);
    CREATE TABLE pm_tasks (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, status TEXT, owner TEXT, created_by TEXT, notes TEXT);
    CREATE TABLE pm_status_log (id INTEGER PRIMARY KEY, task_id TEXT, event_type TEXT, from_status TEXT, to_status TEXT, actor TEXT, detail TEXT, timestamp TEXT, room_ref TEXT);
  `);
  legacy.prepare('INSERT INTO pm_meta VALUES (?,?)').run('db_id', 'legacy-db-id');
  legacy.prepare('INSERT INTO pm_projects VALUES (?,?,?,?,?,?,?,?)').run('command', 'Starq Command', 'CMD', '', null, null, 5, '2026-10-13');
  legacy.prepare('INSERT INTO pm_tasks VALUES (?,?,?,?,?,?,?)').run('PM-CMD-001', 'command', 'Historical closed work', 'CLOSED', 'cursor', 'antigravity', 'legacy notes');
  legacy.prepare('INSERT INTO pm_tasks VALUES (?,?,?,?,?,?,?)').run('PM-CMD-009', 'command', 'Historical work with no live row', 'CLOSED', 'cursor', 'antigravity', 'unlinked notes');
  legacy.prepare('INSERT INTO pm_status_log VALUES (?,?,?,?,?,?,?,?,?)').run(1, 'PM-CMD-001', 'STATUS_CHANGED', 'ACCEPTANCE', 'CLOSED', 'claude', '{"reason":"verified"}', '2026-10-14T00:00:00.000Z', '{"sequence":42}');
  legacy.close();

  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE pm_import_sources (source_file TEXT PRIMARY KEY, source_system TEXT, content_sha256 TEXT, row_count INTEGER, imported_at TEXT);
    CREATE TABLE pm_source_records (source_key TEXT PRIMARY KEY, source_system TEXT, source_file TEXT, source_row_index INTEGER, task_id TEXT, resolution TEXT, raw_status TEXT, payload_sha256 TEXT, raw_payload TEXT, imported_at TEXT, UNIQUE(source_file,source_row_index));
    CREATE TABLE pm_import_source_versions (source_file TEXT, content_sha256 TEXT, row_count INTEGER, imported_at TEXT, PRIMARY KEY(source_file,content_sha256));
    CREATE TABLE pm_source_record_versions (source_key TEXT, payload_sha256 TEXT, source_system TEXT, source_file TEXT, source_row_index INTEGER, task_id TEXT, resolution TEXT, raw_status TEXT, raw_payload TEXT, imported_at TEXT, PRIMARY KEY(source_key,payload_sha256));
    CREATE TABLE pm_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT);
  `);
  db.prepare('INSERT INTO pm_tasks (id, title, project_id) VALUES (?, ?, ?)').run('PM-CMD-001', 'Live native task', 'command');
  const imported = importLegacyPmSnapshot(db, { dbPath: sourcePath, nowIso: () => '2026-10-27T00:00:00.000Z', json: JSON.stringify });
  assert.equal(imported.preserved, 2);
  assert.equal(imported.history_rows, 1);
  assert.equal(imported.projects, 1);
  const row = db.prepare("SELECT * FROM pm_source_records WHERE source_key = 'command-pm-v1:PM-CMD-001'").get();
  assert.equal(row.source_system, 'starqCommand-pm-board-v1');
  assert.equal(row.task_id, null);
  assert.equal(row.resolution, 'ARCHIVED_ID_COLLISION');
  const raw = JSON.parse(row.raw_payload);
  assert.equal(raw.task.id, 'PM-CMD-001');
  assert.equal(raw.task.status, 'CLOSED');
  assert.equal(raw.history[0].detail, '{"reason":"verified"}');
  assert.equal(raw.history[0].room_ref, '{"sequence":42}');
  const absent = db.prepare("SELECT * FROM pm_source_records WHERE source_key = 'command-pm-v1:PM-CMD-009'").get();
  assert.equal(absent.task_id, null, 'an unused legacy id must not be linked when no pm_tasks row is created');
  assert.equal(absent.resolution, 'ARCHIVED_ID_COLLISION');
  assert.equal(JSON.parse(absent.raw_payload).task.title, 'Historical work with no live row');
  assert.equal(db.prepare('SELECT title FROM pm_tasks WHERE id = ?').get('PM-CMD-001').title, 'Live native task');
  const dangling = db.prepare(
    'SELECT COUNT(*) AS n FROM pm_source_records r WHERE r.task_id IS NOT NULL AND r.task_id NOT IN (SELECT id FROM pm_tasks)',
  ).get();
  assert.equal(Number(dangling.n), 0);
});

test('legacy import does not treat a missing pm_tasks table as a free id', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'command-legacy-pm-notable-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourcePath = path.join(dir, 'pm-board.db');
  const legacy = new DatabaseSync(sourcePath);
  legacy.exec(`
    CREATE TABLE pm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE pm_projects (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE pm_tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT);
    CREATE TABLE pm_status_log (id INTEGER PRIMARY KEY, task_id TEXT);
  `);
  legacy.prepare('INSERT INTO pm_meta VALUES (?,?)').run('db_id', 'legacy-db-id');
  legacy.prepare('INSERT INTO pm_projects VALUES (?,?)').run('command', 'Starq Command');
  legacy.prepare('INSERT INTO pm_tasks VALUES (?,?,?)').run('PM-CMD-009', 'Archive only', 'CLOSED');
  legacy.close();

  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE pm_import_sources (source_file TEXT PRIMARY KEY, source_system TEXT, content_sha256 TEXT, row_count INTEGER, imported_at TEXT);
    CREATE TABLE pm_source_records (source_key TEXT PRIMARY KEY, source_system TEXT, source_file TEXT, source_row_index INTEGER, task_id TEXT, resolution TEXT, raw_status TEXT, payload_sha256 TEXT, raw_payload TEXT, imported_at TEXT, UNIQUE(source_file,source_row_index));
    CREATE TABLE pm_import_source_versions (source_file TEXT, content_sha256 TEXT, row_count INTEGER, imported_at TEXT, PRIMARY KEY(source_file,content_sha256));
    CREATE TABLE pm_source_record_versions (source_key TEXT, payload_sha256 TEXT, source_system TEXT, source_file TEXT, source_row_index INTEGER, task_id TEXT, resolution TEXT, raw_status TEXT, raw_payload TEXT, imported_at TEXT, PRIMARY KEY(source_key,payload_sha256));
  `);
  const imported = importLegacyPmSnapshot(db, { dbPath: sourcePath, nowIso: () => '2026-10-27T00:00:00.000Z', json: JSON.stringify });
  assert.equal(imported.preserved, 1);
  const row = db.prepare('SELECT task_id, resolution, raw_payload FROM pm_source_records').get();
  assert.equal(row.task_id, null);
  assert.equal(row.resolution, 'ARCHIVED_ID_COLLISION');
  assert.equal(JSON.parse(row.raw_payload).task.id, 'PM-CMD-009');
});
