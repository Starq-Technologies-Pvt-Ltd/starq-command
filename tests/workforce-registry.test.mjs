/**
 * Workforce Registry & Identity Import Tests (CV-AG2 / Journey J2).
 *
 * Verifies:
 *   1. Human and digital people creation with harness, capabilities, status, room_handle.
 *   2. Idempotent POST /api/pm/org/people/import-identities (never overwrites manual fields).
 *   3. Graceful UNAVAILABLE result when identities.json is absent/unreadable.
 *   4. GET /api/pm/workforce/:personId/summary returning appointments, open owned/verifying/blocked tasks, and recent audit activity.
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
import { DatabaseSync } from 'node:sqlite';
import {
  initOrgSchema,
  seedOperatingOrg,
  createPerson,
  updatePerson,
  importIdentitiesToOrg,
} from '../server/operating-org.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMAND_ENTRY = path.join(ROOT, 'server', 'pm-service.mjs');
const TEST_ROOT = process.env.STARQ_COMMAND_TEST_TMPDIR || os.tmpdir();

let serverProcess = null;
let serverPort = null;
let tempRoot = null;
let tempDb = null;

async function unusedPort() {
  for (let candidate = 5192; candidate <= 5199; candidate++) {
    try {
      const p = createServer();
      await new Promise((resolve, reject) => {
        p.once('error', reject);
        p.listen(candidate, '127.0.0.1', resolve);
      });
      await new Promise((resolve, reject) => p.close((error) => (error ? reject(error) : resolve())));
      return candidate;
    } catch { /* try next */ }
  }
  throw new Error('No available port in 5190-5199 for scratch PM server.');
}

function setup() {
  tempRoot = fs.mkdtempSync(path.join(TEST_ROOT, 'workforce-reg-'));
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
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
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

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/api/pm/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.status === 200) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('PM server did not become reachable');
}

function api(method, urlPath, body = null) {
  const opts = {
    method,
    headers: {
      'X-PM-Client': 'starq-command',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(5000),
  };
  if (body !== null) opts.body = JSON.stringify(body);
  return fetch(`http://127.0.0.1:${serverPort}${urlPath}`, opts).then(async (res) => ({
    status: res.status,
    body: await res.json(),
  }));
}

test('workforce unit: importIdentitiesToOrg degrades to UNAVAILABLE when identities.json is absent', () => {
  const db = new DatabaseSync(':memory:');
  initOrgSchema(db);
  seedOperatingOrg(db, () => '2026-10-31T00:00:00.000Z');

  const res = importIdentitiesToOrg(db, {
    identitiesPath: path.join(os.tmpdir(), 'non-existent-identities-99999.json'),
    actor: 'ali',
  });
  assert.equal(res.state, 'UNAVAILABLE');
  assert.deepEqual(res.created, []);
  assert.deepEqual(res.skipped, []);
});

test('workforce API (CV-AG2 / J2): human + digital worker registration, idempotent import-identities, and workforce summary', async () => {
  setup();
  await startServer();

  // 1. Register a human employee and a digital agent with harness & capabilities
  const humanRes = await api('POST', '/api/pm/org/people', {
    actor: 'ali',
    handle: 'fathimath-ops',
    display_name: 'Fathimath (Operations Manager)',
    kind: 'HUMAN',
    role_note: 'Daily operations and vendor coordination',
    capabilities: ['operations', 'finance', 'coordination'],
    status: 'active',
  });
  assert.equal(humanRes.status, 201);
  assert.equal(humanRes.body.kind, 'HUMAN');
  assert.equal(humanRes.body.source, 'manual');
  assert.deepEqual(humanRes.body.capabilities, ['operations', 'finance', 'coordination']);

  const agentRes = await api('POST', '/api/pm/org/people', {
    actor: 'ali',
    handle: 'hermes-qa-bot',
    display_name: 'Hermes QA Specialist',
    kind: 'DIGITAL',
    role_note: 'Automated verification specialist',
    harness: 'hermes:qa',
    capabilities: ['verifier', 'qa'],
    status: 'active',
    room_handle: 'hermes-qa',
  });
  assert.equal(agentRes.status, 201);
  assert.equal(agentRes.body.kind, 'DIGITAL');
  assert.equal(agentRes.body.harness, 'hermes:qa');
  assert.equal(agentRes.body.room_handle, 'hermes-qa');

  // 2. Customize an existing seeded person before import to prove import never overwrites manual fields
  const patchCursor = await api('PATCH', '/api/pm/org/people/cursor', {
    actor: 'ali',
    display_name: 'Cursor (Custom Manual Name)',
    role_note: 'Custom manual note',
  });
  assert.equal(patchCursor.status, 200);

  // 3. First import from canonical identities.json
  const import1 = await api('POST', '/api/pm/org/people/import-identities', {
    actor: 'ali',
    channel: 'ui',
  });
  assert.equal(import1.status, 200);
  assert.equal(import1.body.state, 'OK');
  assert.match(import1.body.source, /^identities\.json@[0-9a-f]{16}$/);
  assert.ok(import1.body.created.length > 0, 'first import should create missing canonical identities');
  assert.ok(import1.body.skipped.some((s) => s.handle === 'cursor'), 'existing cursor handle should be skipped');

  // Verify manual fields on cursor were NOT overwritten
  const orgAfterImport1 = await api('GET', '/api/pm/org');
  const cursorRow = orgAfterImport1.body.people.find((p) => p.handle === 'cursor');
  assert.equal(cursorRow.display_name, 'Cursor (Custom Manual Name)');
  assert.equal(cursorRow.role_note, 'Custom manual note');
  assert.equal(cursorRow.source, 'manual');

  // Verify an imported identity (e.g. antigravity or vision) has provenance source tag
  const agRow = orgAfterImport1.body.people.find((p) => p.handle === 'antigravity');
  assert.ok(agRow, 'antigravity should be present after import');
  assert.equal(agRow.source, import1.body.source);
  assert.equal(agRow.harness, 'antigravity');

  // 4. Second import is 100% idempotent (created = 0)
  const import2 = await api('POST', '/api/pm/org/people/import-identities', {
    actor: 'ali',
    channel: 'ui',
  });
  assert.equal(import2.status, 200);
  assert.equal(import2.body.created.length, 0);
  assert.ok(import2.body.skipped.length >= import1.body.created.length);

  // 5. Assign appointment and tasks to fathimath-ops and verify GET /api/pm/workforce/:personId/summary
  const posRes = await api('POST', '/api/pm/org/positions', {
    actor: 'ali',
    unit_id: 'starq-corporate',
    title: 'Operations Manager',
  });
  assert.equal(posRes.status, 201);

  const apptRes = await api('POST', '/api/pm/org/appointments', {
    actor: 'ali',
    position_id: posRes.body.id,
    person_id: humanRes.body.id,
    notes: 'Appointed Operations Manager',
  });
  assert.equal(apptRes.status, 201);

  const taskOwned = await api('POST', '/api/pm/tasks', {
    actor: 'ali',
    project_id: 'command',
    title: 'Prepare operational runbook',
    owner: 'fathimath-ops',
    verifier: 'hermes-qa-bot',
    priority: 'P1',
    status: 'NEXT',
  });
  assert.equal(taskOwned.status, 201);

  const summaryRes = await api('GET', `/api/pm/workforce/${humanRes.body.id}/summary`);
  assert.equal(summaryRes.status, 200);
  assert.equal(summaryRes.body.person.handle, 'fathimath-ops');
  assert.equal(summaryRes.body.appointments.active.length, 1);
  assert.equal(summaryRes.body.appointments.active[0].position_title, 'Operations Manager');
  assert.ok(summaryRes.body.tasks.owned_open.some((t) => t.id === taskOwned.body.task.id));
  assert.ok(Array.isArray(summaryRes.body.recent_activity));
  assert.ok(summaryRes.body.recent_activity.length >= 1);

  // Also check verifier summary by handle
  const verifierSummary = await api('GET', '/api/pm/workforce/hermes-qa-bot/summary');
  assert.equal(verifierSummary.status, 200);
  assert.ok(verifierSummary.body.tasks.verifying_open.some((t) => t.id === taskOwned.body.task.id));
});

after(async () => {
  await teardown();
});
