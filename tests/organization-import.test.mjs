/**
 * CV-AG8 — Optional Organization Snapshot Import Acceptance Tests.
 *
 * Authority: Founder Directive (1 Nov 2026), Handover CV-AG8.
 *
 * Acceptance Cases:
 *  - C: Import into a clean instance — row counts and all 9 relationship checks match snapshot manifest
 *  - C2: Relationships preserved — tasks resolve to projects, appointments to people and positions
 *  - C3: Provenance preserved — HISTORICAL_NEXUS count unchanged; no row silently becomes LIVE
 *  - Dry: dry_run — full summary returned; database content-identical afterwards
 *  - D: Invalid snapshot — rejected; target database content-identical before and after
 *  - D2: Mid-import failure — injected failure rolls back entirely; no partial organization
 *  - D3: Duplicate import — second run creates nothing and reports every row as duplicate / skipped
 *  - CLI: import-organization.mjs script execution
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTablesSha256 } from '../server/pm-import.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'server', 'pm-service.mjs');
const CLI_ENTRY = path.join(ROOT, 'scripts', 'import-organization.mjs');
const SCRATCH_PORTS = [5190, 5191, 5192, 5193, 5194, 5195, 5196, 5197, 5198, 5199];

const freePort = (port) => new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});

const taken = new Set();
async function reservePort() {
  for (const p of SCRATCH_PORTS) {
    if (taken.has(p)) continue;
    if (await freePort(p)) { taken.add(p); return p; }
  }
  const p = SCRATCH_PORTS[0];
  taken.add(p);
  return p;
}

const headers = { 'content-type': 'application/json', 'x-pm-client': 'starq-command' };
async function call(port, method, route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw text */ }
  return { status: res.status, json, text };
}

function disposableDbPath(t) {
  const file = path.join(os.tmpdir(), `test-pm-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  t.after(() => {
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(file + ext); } catch { /* ignore */ }
    }
  });
  return file;
}

async function start(t, dbPath, { provision = null } = {}) {
  const port = await reservePort();
  const env = { ...process.env, PM_DB_PATH: dbPath, PM_PORT: String(port), PM_ROOM_POST: 'off' };
  if (provision === null) delete env.COMMAND_PROVISION; else env.COMMAND_PROVISION = provision;

  const child = spawn(process.execPath, [ENTRY], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.once('exit', r));

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  t.after(stop);

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`service exited ${child.exitCode}:\n${out}`);
    try {
      const h = await call(port, 'GET', '/api/pm/health');
      if (h.status === 200) {
        assert.equal(h.json.db, dbPath, `health reports another database:\n${h.text}`);
        return { port, stop, health: h.json };
      }
    } catch { /* starting */ }
    if (Date.now() >= deadline) throw new Error(`service never became healthy:\n${out}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** The 9 relationship queries from scripts/preservation-baseline.mjs */
const INTEGRITY_QUERIES = [
  ['tasks_without_project', 'SELECT COUNT(*) n FROM pm_tasks t LEFT JOIN pm_projects p ON p.id = t.project_id WHERE p.id IS NULL'],
  ['status_log_without_task', 'SELECT COUNT(*) n FROM pm_status_log s LEFT JOIN pm_tasks t ON t.id = s.task_id WHERE t.id IS NULL'],
  ['units_without_company', 'SELECT COUNT(*) n FROM org_units u LEFT JOIN org_companies c ON c.id = u.company_id WHERE c.id IS NULL'],
  ['positions_without_unit', 'SELECT COUNT(*) n FROM org_positions p LEFT JOIN org_units u ON u.id = p.unit_id WHERE u.id IS NULL'],
  ['appointments_without_person', 'SELECT COUNT(*) n FROM org_appointments a LEFT JOIN org_people pe ON pe.id = a.person_id WHERE pe.id IS NULL'],
  ['appointments_without_position', 'SELECT COUNT(*) n FROM org_appointments a LEFT JOIN org_positions po ON po.id = a.position_id WHERE po.id IS NULL'],
  ['source_versions_without_record', 'SELECT COUNT(*) n FROM pm_source_record_versions v LEFT JOIN pm_source_records r ON r.source_key = v.source_key WHERE r.source_key IS NULL'],
  ['source_records_without_task', 'SELECT COUNT(*) n FROM pm_source_records r WHERE r.task_id IS NOT NULL AND r.task_id NOT IN (SELECT id FROM pm_tasks)'],
  ['tasks_with_missing_dependency', "SELECT COUNT(*) n FROM pm_tasks t, json_each(COALESCE(NULLIF(t.depends_on,''),'[]')) d WHERE json_valid(COALESCE(NULLIF(t.depends_on,''),'[]')) AND d.value NOT IN (SELECT id FROM pm_tasks)"],
];

function checkIntegrity(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const results = {};
  try {
    for (const [name, sql] of INTEGRITY_QUERIES) {
      results[name] = Number(db.prepare(sql).get().n);
    }
  } finally {
    db.close();
  }
  return results;
}

function computeDbContentFingerprint(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const hash = createHash('sha256');
    for (const t of tables) {
      const rows = db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all();
      hash.update(t);
      hash.update(JSON.stringify(rows));
    }
    return hash.digest('hex');
  } finally {
    db.close();
  }
}

/** Generate a realistic, valid organization snapshot fixture. */
function buildSampleSnapshot() {
  const tables = {
    org_companies: [
      { id: 'comp_starq', name: 'Starq Technologies LLC', legal_name: 'Starq Technologies LLC', notes: 'Operating HQ', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' },
    ],
    org_units: [
      { id: 'unit_command', company_id: 'comp_starq', parent_id: null, kind: 'DIVISION', name: 'Command Division', description: 'Core product', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', archived_at: null },
    ],
    org_positions: [
      { id: 'pos_architect', unit_id: 'unit_command', title: 'System Architect', job_description: 'Architecture', reports_to_position_id: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', archived_at: null },
      { id: 'pos_engineer', unit_id: 'unit_command', title: 'Lead Engineer', job_description: 'Implementation', reports_to_position_id: 'pos_architect', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', archived_at: null },
    ],
    org_people: [
      { id: 'person_founder', handle: 'ali', display_name: 'Ali Musthaq', kind: 'HUMAN', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', archived_at: null, role_note: 'Founder', harness: null, capabilities_json: '[]', status: 'active', source: 'manual', room_handle: 'ali' },
      { id: 'person_ag', handle: 'antigravity', display_name: 'Antigravity', kind: 'DIGITAL', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', archived_at: null, role_note: 'Pair Programmer', harness: 'AGY', capabilities_json: '["code"]', status: 'active', source: 'herdr', room_handle: 'antigravity' },
    ],
    org_appointments: [
      { id: 'app_founder', position_id: 'pos_architect', person_id: 'person_founder', status: 'ACTIVE', appointed_at: '2026-10-01T00:00:00.000Z', ended_at: null, notes: null },
      { id: 'app_ag', position_id: 'pos_engineer', person_id: 'person_ag', status: 'ACTIVE', appointed_at: '2026-10-01T00:00:00.000Z', ended_at: null, notes: null },
    ],
    pm_projects: [
      { id: 'command_os', name: 'Command OS', prefix: 'CMD', description: 'Command operating surface', hold_state: null, source_gap: null, next_seq: 10, created_at: '2026-10-01T00:00:00.000Z' },
    ],
    pm_milestones: [
      { id: 'ms_release_v1', project_id: 'command_os', title: 'Command V1.0 Release', description: 'Baseline convergence', due_date: '2026-11-15T00:00:00.000Z', status: 'active', ordinal: 1, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', archived_at: null },
    ],
    pm_tasks: [
      {
        id: 'CMD-001',
        project_id: 'command_os',
        title: 'Initial Command Blueprint',
        description: 'Establish foundational schema and lifecycle',
        priority: 'P1',
        status: 'DONE',
        prior_status: 'IN_PROGRESS',
        owner: 'antigravity',
        verifier: 'ali',
        room_authorization_ref: null,
        evidence_refs: '[]',
        depends_on: '[]',
        notes: 'Nexus task imported',
        created_by: 'ali',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-10T00:00:00.000Z',
        closed_at: '2026-09-10T00:00:00.000Z',
        provenance: 'HISTORICAL_NEXUS',
        stage: 'CLOSED',
        milestone_id: 'ms_release_v1',
      },
      {
        id: 'CMD-002',
        project_id: 'command_os',
        title: 'Convergence Delivery',
        description: 'Complete CV-AG8 optional import',
        priority: 'P0',
        status: 'IN_PROGRESS',
        prior_status: 'NEXT',
        owner: 'antigravity',
        verifier: 'ali',
        room_authorization_ref: null,
        evidence_refs: '[]',
        depends_on: '["CMD-001"]',
        notes: 'Live current task',
        created_by: 'ali',
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
        closed_at: null,
        provenance: 'LIVE',
        stage: 'IN_FLIGHT',
        milestone_id: 'ms_release_v1',
      },
    ],
    pm_status_log: [
      {
        id: 1,
        task_id: 'CMD-001',
        event_type: 'CREATED',
        from_status: null,
        to_status: 'TODO',
        actor: 'ali',
        detail: '{"seed":true}',
        timestamp: '2026-09-01T00:00:00.000Z',
        room_sync: 'DISABLED',
        room_ref: null,
        room_error: null,
        room_attempts: 0,
      },
      {
        id: 2,
        task_id: 'CMD-002',
        event_type: 'CREATED',
        from_status: null,
        to_status: 'IN_PROGRESS',
        actor: 'ali',
        detail: '{"work":true}',
        timestamp: '2026-10-01T00:00:00.000Z',
        room_sync: 'DISABLED',
        room_ref: null,
        room_error: null,
        room_attempts: 0,
      },
    ],
    pm_import_sources: [
      {
        source_file: 'nexus-command.json',
        source_system: 'STARQ_NEXUS',
        content_sha256: '9f833778d5020f10b0e0129a318b394c15bca3946328b835c842c207779b70f2',
        row_count: 1,
        imported_at: '2026-10-01T00:00:00.000Z',
      },
    ],
    pm_import_source_versions: [
      {
        source_file: 'nexus-command.json',
        content_sha256: '9f833778d5020f10b0e0129a318b394c15bca3946328b835c842c207779b70f2',
        row_count: 1,
        imported_at: '2026-10-01T00:00:00.000Z',
      },
    ],
    pm_source_records: [
      {
        source_key: 'nexus:CMD-001',
        source_system: 'STARQ_NEXUS',
        source_file: 'nexus-command.json',
        source_row_index: 0,
        task_id: 'CMD-001',
        resolution: 'IMPORTED',
        raw_status: 'DONE',
        payload_sha256: '9f833778d5020f10b0e0129a318b394c15bca3946328b835c842c207779b70f2',
        raw_payload: '{"title":"Initial Command Blueprint"}',
        imported_at: '2026-10-01T00:00:00.000Z',
      },
    ],
    pm_source_record_versions: [
      {
        source_key: 'nexus:CMD-001',
        payload_sha256: '9f833778d5020f10b0e0129a318b394c15bca3946328b835c842c207779b70f2',
        source_system: 'STARQ_NEXUS',
        source_file: 'nexus-command.json',
        source_row_index: 0,
        task_id: 'CMD-001',
        resolution: 'IMPORTED',
        raw_status: 'DONE',
        raw_payload: '{"title":"Initial Command Blueprint"}',
        imported_at: '2026-10-01T00:00:00.000Z',
      },
    ],
  };

  const counts = {};
  for (const [t, rows] of Object.entries(tables)) counts[t] = rows.length;
  const sha = computeTablesSha256(tables);

  return {
    format: 'starq-command.organization-snapshot',
    format_version: 1,
    schema_version: 3,
    exported_at: '2026-11-01T15:00:00.000Z',
    source_db_id: 'db-test-fixture-12345',
    counts,
    content_sha256: sha,
    tables,
  };
}

// ── Test Dry: dry_run ────────────────────────────────────────────────────────

test('Dry: dry_run returns full summary and leaves target database content-identical', async (t) => {
  const dbPath = disposableDbPath(t);
  const srv = await start(t, dbPath);
  const snapshot = buildSampleSnapshot();

  const fpBefore = computeDbContentFingerprint(dbPath);
  const res = await call(srv.port, 'POST', '/api/pm/import/organization', {
    snapshot,
    dry_run: true,
  });

  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.dry_run, true);
  assert.equal(res.json.total_created, 18);
  assert.equal(res.json.total_skipped, 0);

  const fpAfter = computeDbContentFingerprint(dbPath);
  assert.equal(fpAfter, fpBefore, 'database must be byte-identical in content before and after dry run');

  // Verify no tables gained rows
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM pm_projects').get().n), 0);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM org_companies').get().n), 0);
  } finally {
    db.close();
  }
});

// ── Test C: Import into clean instance & all 9 relationship checks ───────────

test('C: import into a clean instance matches row counts and passes all 9 relationship checks', async (t) => {
  const dbPath = disposableDbPath(t);
  const srv = await start(t, dbPath);
  const snapshot = buildSampleSnapshot();

  const res = await call(srv.port, 'POST', '/api/pm/import/organization', {
    snapshot,
  });

  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.dry_run, false);
  assert.equal(res.json.total_created, 18);

  // Check row counts against manifest
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    for (const [table, rows] of Object.entries(snapshot.tables)) {
      const count = Number(db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n);
      assert.equal(count, rows.length, `table '${table}' count ${count} does not match snapshot ${rows.length}`);
    }
  } finally {
    db.close();
  }

  // All 9 relationship checks must return 0
  const integrity = checkIntegrity(dbPath);
  for (const [name, violations] of Object.entries(integrity)) {
    assert.equal(violations, 0, `relationship check '${name}' failed with ${violations} violation(s)`);
  }
});

// ── Test C2: Relationships preserved ─────────────────────────────────────────

test('C2: relationships preserved: tasks resolve to projects, appointments to people and positions', async (t) => {
  const dbPath = disposableDbPath(t);
  const srv = await start(t, dbPath);
  const snapshot = buildSampleSnapshot();

  const res = await call(srv.port, 'POST', '/api/pm/import/organization', { snapshot });
  assert.equal(res.status, 200, res.text);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // Tasks resolve to project
    const taskRows = db.prepare('SELECT t.id, t.project_id, p.name FROM pm_tasks t JOIN pm_projects p ON p.id = t.project_id').all();
    assert.equal(taskRows.length, 2);
    assert.equal(taskRows[0].name, 'Command OS');

    // Appointments resolve to person and position
    const appRows = db.prepare('SELECT a.id, pe.handle, po.title FROM org_appointments a JOIN org_people pe ON pe.id = a.person_id JOIN org_positions po ON po.id = a.position_id').all();
    assert.equal(appRows.length, 2);
    assert.ok(appRows.some((a) => a.handle === 'ali' && a.title === 'System Architect'));
    assert.ok(appRows.some((a) => a.handle === 'antigravity' && a.title === 'Lead Engineer'));
  } finally {
    db.close();
  }
});

// ── Test C3: Provenance preserved ────────────────────────────────────────────

test('C3: provenance preserved: HISTORICAL_NEXUS count unchanged; no row silently becomes LIVE', async (t) => {
  const dbPath = disposableDbPath(t);
  const srv = await start(t, dbPath);
  const snapshot = buildSampleSnapshot();

  const res = await call(srv.port, 'POST', '/api/pm/import/organization', { snapshot });
  assert.equal(res.status, 200, res.text);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const historical = db.prepare("SELECT COUNT(*) n FROM pm_tasks WHERE provenance = 'HISTORICAL_NEXUS'").get().n;
    const live = db.prepare("SELECT COUNT(*) n FROM pm_tasks WHERE provenance = 'LIVE'").get().n;
    assert.equal(Number(historical), 1, 'expected exactly 1 HISTORICAL_NEXUS task');
    assert.equal(Number(live), 1, 'expected exactly 1 LIVE task');

    const histTask = db.prepare("SELECT * FROM pm_tasks WHERE id = 'CMD-001'").get();
    assert.equal(histTask.provenance, 'HISTORICAL_NEXUS');
    assert.equal(histTask.created_by, 'ali');
    assert.equal(histTask.created_at, '2026-09-01T00:00:00.000Z', 'historical timestamps must not be overwritten');
  } finally {
    db.close();
  }
});

// ── Test D: Invalid snapshot rejection ──────────────────────────────────────

test('D: invalid snapshot is safely rejected and database remains content-identical', async (t) => {
  const dbPath = disposableDbPath(t);
  const srv = await start(t, dbPath);
  const snapshot = buildSampleSnapshot();

  const fpBefore = computeDbContentFingerprint(dbPath);

  // Format version mismatch
  const badVersion = { ...snapshot, format_version: 99 };
  const resVersion = await call(srv.port, 'POST', '/api/pm/import/organization', { snapshot: badVersion });
  assert.equal(resVersion.status, 400);
  assert.equal(resVersion.json.error, 'VALIDATION_FAILED');

  // Schema version mismatch
  const badSchema = { ...snapshot, schema_version: 99 };
  const resSchema = await call(srv.port, 'POST', '/api/pm/import/organization', { snapshot: badSchema });
  assert.equal(resSchema.status, 400);
  assert.equal(resSchema.json.error, 'VALIDATION_FAILED');

  // Broken referential integrity: task referencing non-existent project
  const brokenRel = JSON.parse(JSON.stringify(snapshot));
  brokenRel.tables.pm_tasks.push({
    id: 'CMD-999',
    project_id: 'non_existent_project',
    title: 'Broken Task',
    status: 'TODO',
    owner: 'ali',
    verifier: 'ali',
    created_by: 'ali',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  });
  const resBroken = await call(srv.port, 'POST', '/api/pm/import/organization', { snapshot: brokenRel });
  assert.equal(resBroken.status, 400);
  assert.equal(resBroken.json.error, 'VALIDATION_FAILED');

  // DB content must be identical before and after all failed attempts
  const fpAfter = computeDbContentFingerprint(dbPath);
  assert.equal(fpAfter, fpBefore, 'database must be unchanged after rejected imports');
});

// ── Test D2: Mid-import failure rolls back atomically ────────────────────────

test('D2: mid-import failure rolls back entirely and commits no partial organization', async (t) => {
  const dbPath = disposableDbPath(t);
  const srv = await start(t, dbPath);
  const snapshot = buildSampleSnapshot();

  const fpBefore = computeDbContentFingerprint(dbPath);

  const res = await call(srv.port, 'POST', '/api/pm/import/organization', {
    snapshot,
    _injectFailure: 'mid_import',
  });

  assert.equal(res.status, 500);
  assert.equal(res.json.error, 'INJECTED_FAILURE');

  // Verify rollback: not even org_companies or org_units committed
  const fpAfter = computeDbContentFingerprint(dbPath);
  assert.equal(fpAfter, fpBefore, 'database must be content-identical following rolled back mid-import failure');

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM org_companies').get().n), 0);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM pm_projects').get().n), 0);
  } finally {
    db.close();
  }
});

// ── Test D3: Duplicate import & target-not-empty protection ───────────────────

test('D3: duplicate import is refused by default, and skipped with on_conflict: skip', async (t) => {
  const dbPath = disposableDbPath(t);
  const srv = await start(t, dbPath);
  const snapshot = buildSampleSnapshot();

  // First import succeeds
  const res1 = await call(srv.port, 'POST', '/api/pm/import/organization', { snapshot });
  assert.equal(res1.status, 200, res1.text);
  assert.equal(res1.json.total_created, 18);

  // Second import with default on_conflict: 'abort' must be refused (TARGET_NOT_EMPTY / conflict)
  const res2 = await call(srv.port, 'POST', '/api/pm/import/organization', { snapshot });
  assert.equal(res2.status, 409, 'second import on populated database without skip must return 409');
  assert.ok(res2.json.error === 'TARGET_NOT_EMPTY' || res2.json.error === 'IMPORT_CONFLICT');

  // Third import with on_conflict: 'skip' must succeed, create 0, skip all
  const res3 = await call(srv.port, 'POST', '/api/pm/import/organization', {
    snapshot,
    on_conflict: 'skip',
  });
  assert.equal(res3.status, 200, res3.text);
  assert.equal(res3.json.total_created, 0);
  assert.equal(res3.json.total_skipped, 18);
});

// ── Test CLI: scripts/import-organization.mjs ────────────────────────────────

test('CLI: import-organization.mjs runs snapshot import against a target database', async (t) => {
  const dbPath = disposableDbPath(t);
  // Initialize schema with a disposable instance first
  const srv = await start(t, dbPath);
  await srv.stop();

  const snapshot = buildSampleSnapshot();
  const tmpSnapshot = path.join(os.tmpdir(), `test-snapshot-${Date.now()}.json`);
  fs.writeFileSync(tmpSnapshot, JSON.stringify(snapshot, null, 2), 'utf8');
  t.after(() => { try { fs.unlinkSync(tmpSnapshot); } catch {} });

  // Test dry-run CLI
  const dryRunProc = spawnSync(process.execPath, [CLI_ENTRY, '--snapshot', tmpSnapshot, '--db', dbPath, '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(dryRunProc.status, 0, dryRunProc.stderr);
  const dryOutput = JSON.parse(dryRunProc.stdout);
  assert.equal(dryOutput.ok, true);
  assert.equal(dryOutput.dry_run, true);

  // Test live CLI import
  const importProc = spawnSync(process.execPath, [CLI_ENTRY, '--snapshot', tmpSnapshot, '--db', dbPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(importProc.status, 0, importProc.stderr);
  const importOutput = JSON.parse(importProc.stdout);
  assert.equal(importOutput.ok, true);
  assert.equal(importOutput.dry_run, false);
  assert.equal(importOutput.total_created, 18);

  // Relationship check on imported DB
  const integrity = checkIntegrity(dbPath);
  for (const [name, count] of Object.entries(integrity)) {
    assert.equal(count, 0, `CLI import left broken relationship: ${name}`);
  }
});
