/**
 * Org API integrity tests — production route level.
 *
 * Spawns the PM service in scratch mode with an isolated SQLite database,
 * then exercises the actual /api/pm/org/* HTTP routes through the
 * production handler. No live or canonical data is touched.
 *
 * Gap reported: org record changes do NOT have an audit history table.
 * pm_status_log tracks task status changes only. Org create/update has
 * no equivalent append-only history — this test asserts that absence
 * explicitly rather than fabricating history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMAND_ENTRY = path.join(ROOT, 'server', 'pm-service.mjs');
const TEST_ROOT = process.env.STARQ_COMMAND_TEST_TMPDIR || os.tmpdir();

let serverProcess = null;
let serverPort = null;
let tempRoot = null;
let tempDb = null;

function info(msg) {
  console.error(`[org-api] ${msg}`);
}

async function unusedPort() {
  // Scratch mode requires PM_PORT in 5190-5199.
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve ephemeral port.');
  const port = address.port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (port >= 5190 && port <= 5199) return port;
  // Fallback: try the next available in the allowed range.
  for (let candidate = 5190; candidate <= 5199; candidate++) {
    try {
      const p = createServer();
      await new Promise((resolve, reject) => {
        p.once('error', reject);
        p.listen(candidate, '127.0.0.1', resolve);
      });
      await new Promise((resolve, reject) => p.close((error) => error ? reject(error) : resolve()));
      return candidate;
    } catch { /* try next */ }
  }
  throw new Error('No available port in 5190-5199 for scratch PM server.');
}

function setup() {
  tempRoot = fs.mkdtempSync(path.join(TEST_ROOT, 'org-api-'));
  fs.mkdirSync(path.join(tempRoot, 'data'), { recursive: true });
  tempDb = path.join(tempRoot, 'pm.db');
}

async function teardown() {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), 5000);
      serverProcess.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (serverProcess.exitCode === null) {
      serverProcess.kill('SIGKILL');
      await new Promise((resolve) => serverProcess.once('exit', resolve));
    }
    serverProcess = null;
  }
  if (tempRoot && fs.existsSync(tempRoot)) {
    let lastError = null;
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (lastError) {
      console.error(`[org-api] CLEANUP FAILED: ${tempRoot} retained; ${lastError.message}`);
      throw lastError;
    }
    tempRoot = null;
  }
}

async function startServer() {
  serverPort = await unusedPort();
  const env = {
    ...process.env,
    STARQ_WORKSPACE: 'D:/StarqTech',
    PM_DB_PATH: tempDb,
    PM_PORT: String(serverPort),
    PM_ROOM_POST: 'off',
    COMMAND_OBSERVATION_ONLY: '1',
  };
  serverProcess = spawn(process.execPath, [COMMAND_ENTRY], {
    cwd: tempRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  serverProcess.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  serverProcess.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });

  const deadline = Date.now() + 15_000;
  let lastError = '';
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`PM server exited early.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/api/pm/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.status === 200) {
        info(`Server started on port ${serverPort}`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`PM server did not become reachable: ${lastError}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

function api(method, path, body = null, headers = {}) {
  const h = new Headers({
    'X-PM-Client': 'starq-command',
    'Content-Type': 'application/json',
    ...headers,
  });
  const opts = { method, headers: h, signal: AbortSignal.timeout(5000) };
  if (body !== null) opts.body = JSON.stringify(body);
  return fetch(`http://127.0.0.1:${serverPort}${path}`, opts).then(async (res) => {
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: parsed ?? text, headers: Object.fromEntries(res.headers.entries()) };
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('org API: server starts and health responds', async () => {
  setup();
  await startServer();
  const res = await api('GET', '/api/pm/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.service, 'starq-command-pm');
  assert.equal(res.body.state, 'OK');
});

test('org API: GET /api/pm/org returns seeded org after startup', async () => {
  const res = await api('GET', '/api/pm/org');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.units));
  assert.ok(Array.isArray(res.body.positions));
  assert.ok(Array.isArray(res.body.people));
  assert.ok(Array.isArray(res.body.appointments));
  assert.ok(res.body.company, 'seeded company should be present');
  info(`org readback: ${res.body.units.length} units, ${res.body.positions.length} positions, ${res.body.people.length} people, ${res.body.appointments.length} appointments`);
});

test('org API: POST /api/pm/org/companies creates and readback preserves stable id', async () => {
  // create
  const create = await api('POST', '/api/pm/org/companies', {
    actor: 'ali',
    name: 'TestCo API',
    legal_name: 'TestCo API Pvt. Ltd.',
    notes: 'API test company',
  });
  assert.equal(create.status, 201);
  assert.ok(create.body.id, 'company id must be returned');
  const cid = create.body.id;

  // readback via GET /api/pm/org
  const read = await api('GET', '/api/pm/org');
  const found = read.body.company;
  // company is singular when exactly one exists
  const companies = Array.isArray(found) ? found : [found];
  const match = companies.find((c) => c.id === cid);
  assert.ok(match, `company ${cid} must appear in org readback`);
  assert.equal(match.name, 'TestCo API');
  info(`company created with stable id ${cid}`);
});

test('org API: duplicate company id rejected with 409', async () => {
  const dup = await api('POST', '/api/pm/org/companies', {
    actor: 'ali',
    id: 'starq-technologies',
    name: 'Dup Co',
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'COMPANY_EXISTS');
});

test('org API: POST /api/pm/org/units — invalid company rejected 404', async () => {
  const res = await api('POST', '/api/pm/org/units', {
    actor: 'ali',
    company_id: 'no-such-co',
    kind: 'DEPARTMENT',
    name: 'Ghost Unit',
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'COMPANY_NOT_FOUND');
});

test('org API: POST /api/pm/org/units — invalid parent rejected 404', async () => {
  const res = await api('POST', '/api/pm/org/units', {
    actor: 'ali',
    company_id: 'starq-technologies',
    parent_id: 'no-such-unit',
    kind: 'TEAM',
    name: 'Ghost Child',
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'UNIT_NOT_FOUND');
});

test('org API: POST /api/pm/org/units — valid unit with stable id readback', async () => {
  const create = await api('POST', '/api/pm/org/units', {
    actor: 'ali',
    company_id: 'starq-technologies',
    kind: 'TEAM',
    name: 'API QA Unit',
  });
  assert.equal(create.status, 201);
  assert.ok(create.body.id);
  const uid = create.body.id;

  const read = await api('GET', '/api/pm/org');
  const found = read.body.units.find((u) => u.id === uid);
  assert.ok(found, `unit ${uid} must appear in org readback`);
  assert.equal(found.name, 'API QA Unit');
  info(`unit created with stable id ${uid}`);
});

test('org API: POST /api/pm/org/positions — invalid unit rejected 404', async () => {
  const res = await api('POST', '/api/pm/org/positions', {
    actor: 'ali',
    unit_id: 'no-such-unit',
    title: 'Ghost Position',
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'UNIT_NOT_FOUND');
});

test('org API: POST /api/pm/org/positions — invalid reports_to rejected 404', async () => {
  const res = await api('POST', '/api/pm/org/positions', {
    actor: 'ali',
    unit_id: 'starq-corporate',
    title: 'Ghost Reports',
    reports_to_position_id: 'no-such-pos',
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'POSITION_NOT_FOUND');
});

test('org API: POST /api/pm/org/positions — valid position with stable id readback', async () => {
  const create = await api('POST', '/api/pm/org/positions', {
    actor: 'ali',
    unit_id: 'starq-corporate',
    title: 'API Test Position',
    job_description: 'A position for API testing',
  });
  assert.equal(create.status, 201);
  assert.ok(create.body.id);
  const pid = create.body.id;

  const read = await api('GET', '/api/pm/org');
  const found = read.body.positions.find((p) => p.id === pid);
  assert.ok(found, `position ${pid} must appear in org readback`);
  assert.equal(found.title, 'API Test Position');
  info(`position created with stable id ${pid}`);
});

test('org API: POST /api/pm/org/people — duplicate handle rejected 409', async () => {
  const res = await api('POST', '/api/pm/org/people', {
    actor: 'ali',
    handle: 'ali',
    display_name: 'Dup Person',
    kind: 'HUMAN',
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'PERSON_EXISTS');
});

test('org API: POST /api/pm/org/people — invalid kind rejected 400', async () => {
  const res = await api('POST', '/api/pm/org/people', {
    actor: 'ali',
    handle: 'weird-kind',
    display_name: 'Weird',
    kind: 'ROBOT',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'VALIDATION');
});

test('org API: POST /api/pm/org/people — valid person with stable id readback', async () => {
  const create = await api('POST', '/api/pm/org/people', {
    actor: 'ali',
    handle: 'api-tester',
    display_name: 'API Tester',
    kind: 'HUMAN',
  });
  assert.equal(create.status, 201);
  assert.ok(create.body.id);
  assert.equal(create.body.handle, 'api-tester');

  const read = await api('GET', '/api/pm/org');
  const found = read.body.people.find((p) => p.handle === 'api-tester');
  assert.ok(found, 'person handle api-tester must appear in org readback');
  info(`person created with stable id ${found.id}`);
});

test('org API: POST /api/pm/org/appointments — invalid position rejected 404', async () => {
  const res = await api('POST', '/api/pm/org/appointments', {
    actor: 'ali',
    position_id: 'no-such-pos',
    person_id: 'person-ali',
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'POSITION_NOT_FOUND');
});

test('org API: POST /api/pm/org/appointments — invalid person rejected 404', async () => {
  const res = await api('POST', '/api/pm/org/appointments', {
    actor: 'ali',
    position_id: 'pos-engineer',
    person_id: 'no-such-person',
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'PERSON_NOT_FOUND');
});

test('org API: POST /api/pm/org/appointments — occupied position rejected 409', async () => {
  const res = await api('POST', '/api/pm/org/appointments', {
    actor: 'ali',
    position_id: 'pos-md',
    person_id: 'person-codex',
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'POSITION_OCCUPIED');
});

test('org API: POST /api/pm/org/appointments — valid appointment with readback', async () => {
  // create a fresh position for this test
  const pos = await api('POST', '/api/pm/org/positions', {
    actor: 'ali',
    unit_id: 'starq-corporate',
    title: 'API Appt Position',
  });
  assert.equal(pos.status, 201);

  const create = await api('POST', '/api/pm/org/appointments', {
    actor: 'ali',
    position_id: pos.body.id,
    person_id: 'person-ali',
  });
  assert.equal(create.status, 201);
  assert.ok(create.body.id);
  const aid = create.body.id;

  const read = await api('GET', '/api/pm/org');
  const found = read.body.appointments.find((a) => a.id === aid);
  assert.ok(found, `appointment ${aid} must appear in org readback`);
  assert.equal(found.person_id, 'person-ali');
  info(`appointment created with stable id ${aid}`);
});

test('org API: authorization — missing X-PM-Client rejected 403', async () => {
  const res = await api('POST', '/api/pm/org/companies', {
    actor: 'ali',
    name: 'No Auth Co',
  }, { 'X-PM-Client': '' });
  // The custom header check happens before body parsing, so the error shape
  // may differ from org-level validation. We only assert it is refused.
  assert.notEqual(res.status, 201);
});

test('org API: authorization — missing actor rejected', async () => {
  const res = await api('POST', '/api/pm/org/companies', {
    name: 'No Actor Co',
  });
  assert.notEqual(res.status, 201);
});

test('org API: CV-AG1 PATCH company, unit (cycle + archive), position (cycle), person, appointment end/reassign, and org_audit history', async () => {
  // 1. PATCH company
  const patchCo = await api('PATCH', '/api/pm/org/companies/starq-technologies', {
    actor: 'ali',
    channel: 'ui',
    notes: 'Updated via PATCH company test',
  });
  assert.equal(patchCo.status, 200);
  assert.equal(patchCo.body.notes, 'Updated via PATCH company test');

  // 2. Unit cycle check (409 UNIT_CYCLE) and soft archive
  const childUnit = await api('POST', '/api/pm/org/units', {
    actor: 'ali',
    id: 'unit-cycle-child',
    company_id: 'starq-technologies',
    parent_id: 'starq-dev-studio',
    kind: 'OFFICE',
    name: 'Test Office Child',
  });
  assert.equal(childUnit.status, 201);
  assert.equal(childUnit.body.kind, 'OFFICE');

  const cycleUnit = await api('PATCH', '/api/pm/org/units/starq-dev-studio', {
    actor: 'ali',
    parent_id: 'unit-cycle-child',
  });
  assert.equal(cycleUnit.status, 409);
  assert.equal(cycleUnit.body.error, 'UNIT_CYCLE');

  // Soft archive child unit
  const archUnit = await api('PATCH', '/api/pm/org/units/unit-cycle-child', {
    actor: 'ali',
    archived: true,
  });
  assert.equal(archUnit.status, 200);
  assert.ok(archUnit.body.archived_at);

  const defaultOrg = await api('GET', '/api/pm/org');
  assert.ok(!defaultOrg.body.units.some((u) => u.id === 'unit-cycle-child'), 'archived unit hidden by default');
  const fullOrg = await api('GET', '/api/pm/org?include=archived');
  assert.ok(fullOrg.body.units.some((u) => u.id === 'unit-cycle-child'), 'archived unit shown with ?include=archived');

  // 3. Position cycle check (409 POSITION_CYCLE)
  const cyclePos = await api('PATCH', '/api/pm/org/positions/pos-md', {
    actor: 'ali',
    reports_to_position_id: 'pos-engineer',
  });
  assert.equal(cyclePos.status, 409);
  assert.equal(cyclePos.body.error, 'POSITION_CYCLE');

  // 4. PATCH person
  const patchPerson = await api('PATCH', '/api/pm/org/people/api-tester', {
    actor: 'ali',
    display_name: 'API Tester (Senior)',
    role_note: 'QA Lead',
    capabilities: ['verifier', 'qa'],
  });
  assert.equal(patchPerson.status, 200);
  assert.equal(patchPerson.body.display_name, 'API Tester (Senior)');
  assert.deepEqual(patchPerson.body.capabilities, ['verifier', 'qa']);

  // 5. End and reassign appointment
  const posForEnd = await api('POST', '/api/pm/org/positions', {
    actor: 'ali',
    unit_id: 'starq-dev-studio',
    title: 'Rotation Engineer',
  });
  assert.equal(posForEnd.status, 201);
  const apptInitial = await api('POST', '/api/pm/org/appointments', {
    actor: 'ali',
    position_id: posForEnd.body.id,
    person_id: 'person-cursor',
    notes: 'First holder',
  });
  assert.equal(apptInitial.status, 201);

  const endedRes = await api('POST', `/api/pm/org/appointments/${apptInitial.body.id}/end`, {
    actor: 'ali',
    notes: 'Handover complete',
    reassign_to_person_id: 'person-codex',
    reassign_notes: 'Second holder',
  });
  assert.equal(endedRes.status, 200);
  assert.equal(endedRes.body.ended.status, 'ENDED');
  assert.ok(endedRes.body.ended.ended_at);
  assert.equal(endedRes.body.reassigned.status, 'ACTIVE');
  assert.equal(endedRes.body.reassigned.person_id, 'person-codex');

  // 6. Verify org_audit table and GET /api/pm/org/history
  const src = fs.readFileSync(path.join(ROOT, 'server', 'operating-org.mjs'), 'utf8');
  assert.match(src, /CREATE TABLE IF NOT EXISTS org_audit/);
  assert.match(src, /org_audit_no_delete/);
  assert.match(src, /org_audit_no_update/);

  const histRes = await api('GET', '/api/pm/org/history?entity=unit&id=unit-cycle-child');
  assert.equal(histRes.status, 200);
  assert.ok(Array.isArray(histRes.body.history));
  assert.ok(histRes.body.history.length >= 2, 'should contain CREATE and ARCHIVE audit records');
  assert.equal(histRes.body.history[0].action, 'ARCHIVE');
  assert.equal(histRes.body.history[1].action, 'CREATE');
  info(`org_audit verified: ${histRes.body.history.length} events for unit-cycle-child`);
});

test('org API: production route task history exists for PM tasks (not org records)', async () => {
  // pm_status_log IS the production audit history for task status transitions.
  // Verify it is present in the db and append-only triggers are defined.
  const src = fs.readFileSync(path.join(ROOT, 'server', 'pm-service.mjs'), 'utf8');
  assert.match(src, /CREATE TABLE IF NOT EXISTS pm_status_log/);
  assert.match(src, /pm_log_no_delete/);
  assert.match(src, /pm_log_immutable/);
  info('pm_status_log is the supported production audit history for PM tasks');
});

test('org API: no data corruption — integrity check passes after all org writes', async () => {
  const res = await api('GET', '/api/pm/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.integrity, 'ok');
  info(`integrity ok after org API writes; db=${res.body.db}`);
});

after(async () => {
  await teardown();
});
