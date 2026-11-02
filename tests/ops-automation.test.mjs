/**
 * Operations Automation & Standalone Mode Tests (CV-AG4 & CV-AG5 / Journeys J8 & J10).
 *
 * Verifies:
 *   1. Injectable clock (`now`): advancing clock 4 days past an IN_PROGRESS task's last activity
 *      creates exactly one pm_followups row per staleness episode (deduplicated by episode_key).
 *   2. Follow-up acknowledge and snooze lifecycle + org_audit records.
 *   3. Daily digest generation (`id = YYYY-MM-DD` idempotency across restart/re-run) + zero outbound
 *      delivery calls when PM_DIGEST_DELIVERY=off.
 *   4. Journey J10 (Standalone operation): with a workspace fixture where agent-comms (Room, identities.json,
 *      leases) and herdr-floor (manifest.json) are completely absent, all local PM operations succeed and
 *      data-service projections degrade per-source to UNAVAILABLE without crashing.
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
import { initSchema } from '../server/pm-service.mjs';
import { seedOperatingOrg, readOrgHistory } from '../server/operating-org.mjs';
import {
  generateDigest,
  detectStaleTasks,
  listFollowups,
  acknowledgeFollowup,
  snoozeFollowup,
} from '../server/ops-automation.mjs';
import { buildSurface } from '../server/data-service.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMAND_ENTRY = path.join(ROOT, 'server', 'pm-service.mjs');
const TEST_ROOT = process.env.STARQ_COMMAND_TEST_TMPDIR || os.tmpdir();

let serverProcess = null;
let serverPort = null;
let tempRoot = null;
let tempDb = null;

async function unusedPort() {
  for (let candidate = 5196; candidate <= 5199; candidate++) {
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

function setupStandaloneWorkspace() {
  tempRoot = fs.mkdtempSync(path.join(TEST_ROOT, 'ops-auto-j10-'));
  // Create minimal workspace fingerprint (STARQ.md + 00_STARQ_HQ) WITHOUT agent-comms or herdr-floor!
  fs.writeFileSync(path.join(tempRoot, 'STARQ.md'), '# Standalone Test Workspace\n', 'utf8');
  fs.mkdirSync(path.join(tempRoot, '00_STARQ_HQ', 'operations', 'starq-command', 'board'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, '00_STARQ_HQ', 'operations', 'starq-command', 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, '00_STARQ_HQ', 'operations', 'starq-command', 'board', 'pm-projects.json'),
    JSON.stringify({
      projects: [
        { id: 'command', name: 'Starq Command', prefix: 'CMD', description: 'Standalone Command' },
      ],
    }),
    'utf8',
  );
  tempDb = path.join(tempRoot, '00_STARQ_HQ', 'operations', 'starq-command', 'data', 'pm-operating.db');
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

async function startStandalonePmServer() {
  serverPort = await unusedPort();
  const env = {
    ...process.env,
    STARQ_WORKSPACE: tempRoot,
    PM_DB_PATH: tempDb,
    PM_PORT: String(serverPort),
    PM_ROOM_POST: 'off',
    // CV-C6: fresh databases are empty by default, so a test that needs
    // the Starq fixtures must ask for them explicitly.
    COMMAND_PROVISION: 'starq',
    PM_DIGEST_DELIVERY: 'off',
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
  throw new Error('Standalone PM server did not become reachable');
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

test('CV-AG4 unit (J8): injectable clock stale detector deduplicates episodes, acknowledges/snoozes, and daily digest is idempotent with 0 outbound calls', async () => {
  const db = new DatabaseSync(':memory:');
  initSchema(db);
  const t0 = '2026-10-31T08:00:00.000Z';
  seedOperatingOrg(db, () => t0);

  db.prepare(
    "INSERT INTO pm_projects (id, name, prefix, description, status, owner, next_seq, created_at) VALUES ('command', 'Starq Command', 'CMD', '', 'active', 'ali', 2, ?)",
  ).run(t0);

  // Insert an IN_PROGRESS task with last activity at t0
  db.prepare(
    `INSERT INTO pm_tasks (id, project_id, title, description, priority, status, stage, provenance, owner, verifier, evidence_refs, depends_on, notes, created_by, created_at, updated_at)
     VALUES ('PM-CMD-001', 'command', 'Stale candidate task', '', 'P1', 'IN_PROGRESS', 'IN_PROGRESS', 'LIVE', 'cursor', 'claude', '[]', '[]', '', 'ali', ?, ?)`,
  ).run(t0, t0);
  db.prepare(
    `INSERT INTO pm_status_log (task_id, event_type, from_status, to_status, actor, detail, timestamp, room_sync)
     VALUES ('PM-CMD-001', 'STAGE_CHANGED', 'READY', 'IN_PROGRESS', 'cursor', '{}', ?, 'DISABLED')`,
  ).run(t0);

  // 1. At +2 days, task is NOT stale (threshold default 3 days)
  const day2 = new Date(Date.parse(t0) + 2 * 86_400_000);
  const scanDay2 = detectStaleTasks(db, { now: () => day2, staleDays: 3 });
  assert.equal(scanDay2.created.length, 0);

  // 2. Advance clock to +4 days -> creates exactly 1 follow-up
  const day4 = new Date(Date.parse(t0) + 4 * 86_400_000);
  const scanDay4a = detectStaleTasks(db, { now: () => day4, staleDays: 3 });
  assert.equal(scanDay4a.created.length, 1);
  const fu = scanDay4a.created[0];
  assert.equal(fu.task_id, 'PM-CMD-001');
  assert.equal(fu.status, 'open');
  assert.equal(fu.stale_days, 4);

  // 3. Re-running detector at +4.5 days does NOT create a duplicate follow-up for the same staleness episode
  const day4Half = new Date(Date.parse(t0) + 4.5 * 86_400_000);
  const scanDay4b = detectStaleTasks(db, { now: () => day4Half, staleDays: 3 });
  assert.equal(scanDay4b.created.length, 0);

  // 4. Snooze for 2 days -> hidden from default open follow-ups until snooze expires
  const snoozed = snoozeFollowup(db, fu.id, {
    actor: 'ali',
    days: 2,
    note: 'Waiting on hardware',
    now: () => day4,
  });
  assert.equal(snoozed.status, 'snoozed');
  const openDuringSnooze = listFollowups(db, { status: 'open', includeSnoozed: false, now: () => day4Half });
  assert.equal(openDuringSnooze.length, 0);

  // 5. Acknowledge follow-up -> status becomes acknowledged & audited in org_audit
  const acked = acknowledgeFollowup(db, fu.id, {
    actor: 'ali',
    note: 'Followed up with Cursor',
    nowIso: () => day4Half.toISOString(),
  });
  assert.equal(acked.status, 'acknowledged');
  assert.equal(acked.acknowledged_by, 'ali');

  const auditRows = readOrgHistory(db, { entity: 'followup', id: fu.id });
  assert.equal(auditRows.length, 3); // CREATE, SNOOZE, ACKNOWLEDGE

  // 6. Daily digest idempotency & zero delivery calls when PM_DIGEST_DELIVERY=off
  let deliverCalls = 0;
  const deliverSpy = async () => { deliverCalls += 1; return 'sent'; };

  const dig1 = await generateDigest(db, {
    now: () => day4,
    trigger: 'auto',
    force: false,
    deliver: deliverSpy,
  });
  assert.equal(dig1.created, true);
  assert.equal(dig1.digest.id, '2026-11-04');
  assert.equal(dig1.digest.delivery_state, 'OFF');
  assert.equal(deliverCalls, 0, 'deliver callback must not be called when PM_DIGEST_DELIVERY is off');
  assert.ok(Array.isArray(dig1.digest.summary.person_load));

  const dig2 = await generateDigest(db, {
    now: () => day4Half,
    trigger: 'auto',
    force: false,
    deliver: deliverSpy,
  });
  assert.equal(dig2.created, false, 'second auto digest on same YYYY-MM-DD is a no-op');
  assert.equal(dig2.digest.id, '2026-11-04');
});

test('CV-AG4 & CV-AG5 (Journey J10): standalone operation with Room, Herdr, and identities.json absent', async () => {
  setupStandaloneWorkspace();
  const prevWorkspace = process.env.STARQ_WORKSPACE;
  process.env.STARQ_WORKSPACE = tempRoot;
  try {
    await startStandalonePmServer();

    // 1. Verify data-service buildSurface degrades per-source to UNAVAILABLE without throwing
    const surface = buildSurface();
    assert.equal(surface.execution_truth.state, 'UNAVAILABLE');
    assert.equal(surface.identities.state, 'UNAVAILABLE');
    assert.equal(surface.herdr_manifest.state, 'UNAVAILABLE');
    assert.equal(surface.room_visibility.state, 'UNAVAILABLE');

    // 2. Verify PM org, workforce, project, milestone, task, digest, and followup routes all work standalone
    const orgRes = await api('GET', '/api/pm/org');
    assert.equal(orgRes.status, 200);
    assert.ok(orgRes.body.people.length >= 4);

    // Import identities when identities.json is absent returns 200 with state: UNAVAILABLE (never crashes)
    const impRes = await api('POST', '/api/pm/org/people/import-identities', {
      actor: 'ali',
    });
    assert.equal(impRes.status, 200);
    assert.equal(impRes.body.state, 'UNAVAILABLE');

    // Create a human person, milestone, and task in standalone mode
    const personRes = await api('POST', '/api/pm/org/people', {
      actor: 'ali',
      handle: 'standalone-dev',
      display_name: 'Standalone Developer',
      kind: 'HUMAN',
    });
    assert.equal(personRes.status, 201);

    const msRes = await api('POST', '/api/pm/milestones', {
      actor: 'ali',
      project_id: 'command',
      title: 'Standalone Milestone 1',
      due_date: '2026-11-05',
      status: 'active',
    });
    assert.equal(msRes.status, 201);

    const taskRes = await api('POST', '/api/pm/tasks', {
      actor: 'ali',
      project_id: 'command',
      title: 'Standalone task execution',
      owner: 'standalone-dev',
      verifier: 'cursor',
      status: 'NEXT',
      milestone_id: msRes.body.id,
      work_package: 'CV-AG5',
      is_deliverable: true,
      deliverable_kind: 'code',
    });
    assert.equal(taskRes.status, 201);

    // Generate daily digest via HTTP endpoint
    const genDigest = await api('POST', '/api/pm/digests/generate', {
      actor: 'ali',
      date: '2026-10-31',
    });
    assert.ok(genDigest.status === 200 || genDigest.status === 201);
    assert.equal(genDigest.body.digest.id, '2026-10-31');

    const getDigestRes = await api('GET', '/api/pm/digests/2026-10-31');
    assert.equal(getDigestRes.status, 200);
    assert.equal(getDigestRes.body.digest.id, '2026-10-31');

    const followupsRes = await api('GET', '/api/pm/followups');
    assert.equal(followupsRes.status, 200);
    assert.ok(Array.isArray(followupsRes.body.followups));
  } finally {
    if (prevWorkspace === undefined) delete process.env.STARQ_WORKSPACE;
    else process.env.STARQ_WORKSPACE = prevWorkspace;
  }
});

after(async () => {
  await teardown();
});
