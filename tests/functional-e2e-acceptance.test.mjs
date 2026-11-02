/**
 * STARQ // COMMAND — Real Functional End-to-End Acceptance Test Suite
 *
 * Exercises the 12 real user journeys against an actual, spawned PM service process
 * running on an isolated scratch port (5190–5199) with an isolated scratch SQLite
 * database in os.tmpdir().
 *
 * Rules:
 *  - Strict isolation: uses scratch port in 5190–5199.
 *  - Never touches canonical data/*.db stores.
 *  - Teardown terminates only the spawned child PID.
 *  - Truthful assertion: records exact behavior; does not fabricate passing tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { portableWorkspaceRoot } from './portable-workspace.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMAND_ENTRY = path.join(ROOT, 'server', 'pm-service.mjs');
const TEST_ROOT = process.env.STARQ_COMMAND_TEST_TMPDIR || os.tmpdir();

let serverProcess = null;
let serverPort = null;
let tempRoot = null;
let tempDb = null;

async function unusedPort() {
  for (let candidate = 5190; candidate <= 5199; candidate++) {
    try {
      const p = createServer();
      await new Promise((resolve, reject) => {
        p.once('error', reject);
        p.listen(candidate, '127.0.0.1', resolve);
      });
      await new Promise((resolve, reject) => p.close((error) => (error ? reject(error) : resolve())));
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error('No available port in 5190-5199 for scratch PM server.');
}

async function stopServer() {
  if (serverProcess && serverProcess.exitCode === null) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t'], { stdio: 'ignore' });
      } else {
        serverProcess.kill('SIGKILL');
      }
    } catch {
      try {
        serverProcess.kill();
      } catch {}
    }
    serverProcess = null;
  }
}

async function startServer(dbPath) {
  await stopServer();
  serverPort = await unusedPort();
  const env = {
    ...process.env,
    STARQ_WORKSPACE: portableWorkspaceRoot(),
    PM_DB_PATH: dbPath,
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
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`PM server exited prematurely:\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/pm/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.status === 200) {
        return;
      }
    } catch {
      // wait and retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`PM server failed to start within 15s on port ${serverPort}.\n${stderr}`);
}

async function pmRequest(method, endpoint, body) {
  const url = `http://127.0.0.1:${serverPort}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-PM-Client': 'starq-command',
      Origin: 'http://127.0.0.1:5173',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

test('Starq Command Functional End-to-End Acceptance Suite (12 User Journeys)', async (t) => {
  // Prepare scratch workspace
  tempRoot = fs.mkdtempSync(path.join(TEST_ROOT, 'starq-acceptance-'));
  tempDb = path.join(tempRoot, 'pm.db');

  let companyId = null;
  let personId = null;
  let unitId = null;
  let positionId = null;
  let appointmentId = null;
  let digitalPersonId = null;
  let projectId = null;
  let milestoneId = null;
  let taskId = null;
  let taskUpdatedAt = null;

  try {
    await startServer(tempDb);

    // ── Workflow 1: Fresh empty installation and first organization creation ──
    await t.test('Workflow 1: Fresh empty installation and first organization creation', async () => {
      const initialOrg = await pmRequest('GET', '/api/pm/org');
      assert.equal(initialOrg.status, 200);
      assert.deepEqual(initialOrg.data.companies, []);

      const createCompany = await pmRequest('POST', '/api/pm/org/companies', {
        actor: 'ali',
        name: 'Acme Systems',
        legal_name: 'Acme Systems LLC',
      });
      assert.equal(createCompany.status, 201);
      assert.ok(createCompany.data.id);
      companyId = createCompany.data.id;
      assert.equal(createCompany.data.name, 'Acme Systems');
    });

    // ── Workflow 2: First-person registration and authorized onboarding ────────
    await t.test('Workflow 2: First-person registration and authorized onboarding', async () => {
      const createPerson = await pmRequest('POST', '/api/pm/org/people', {
        actor: 'ali',
        handle: 'ali',
        display_name: 'Ali Musthaq',
        kind: 'HUMAN',
      });
      assert.equal(createPerson.status, 201);
      assert.ok(createPerson.data.id);
      personId = createPerson.data.id;
      assert.equal(createPerson.data.handle, 'ali');
    });

    // ── Workflow 3: Department and workforce creation ─────────────────────────
    await t.test('Workflow 3: Department and workforce creation', async () => {
      // 1. Create Department
      const createUnit = await pmRequest('POST', '/api/pm/org/units', {
        actor: 'ali',
        company_id: companyId,
        name: 'Engineering',
        kind: 'DEPARTMENT',
      });
      assert.equal(createUnit.status, 201);
      unitId = createUnit.data.id;

      // 2. Create Position
      const createPos = await pmRequest('POST', '/api/pm/org/positions', {
        actor: 'ali',
        unit_id: unitId,
        title: 'Lead Architect',
      });
      assert.equal(createPos.status, 201);
      positionId = createPos.data.id;

      // 3. Create Digital Worker
      const createDigital = await pmRequest('POST', '/api/pm/org/people', {
        actor: 'ali',
        handle: 'antigravity',
        display_name: 'Antigravity Digital Worker',
        kind: 'DIGITAL',
        harness: 'AGY',
      });
      assert.equal(createDigital.status, 201);
      digitalPersonId = createDigital.data.id;

      // 4. Appoint First Person to Lead Position
      const appoint = await pmRequest('POST', '/api/pm/org/appointments', {
        actor: 'ali',
        position_id: positionId,
        person_id: personId,
      });
      assert.equal(appoint.status, 201);
      appointmentId = appoint.data.id;

      // 5. Verify Workforce Summary
      const summary = await pmRequest('GET', `/api/pm/workforce/${encodeURIComponent(personId)}/summary`);
      assert.equal(summary.status, 200);
      assert.equal(summary.data.person.handle, 'ali');
    });

    // ── Workflow 4: Project and milestone creation ────────────────────────────
    await t.test('Workflow 4: Project and milestone creation', async () => {
      // Create Project
      const createProj = await pmRequest('POST', '/api/pm/projects', {
        actor: 'ali',
        id: 'acm',
        name: 'Acme Platform',
        prefix: 'ACM',
        description: 'Core product development platform',
      });
      assert.equal(createProj.status, 201);
      projectId = createProj.data.id;
      assert.equal(createProj.data.prefix, 'ACM');

      // Create Milestone
      const createMilestone = await pmRequest('POST', '/api/pm/milestones', {
        actor: 'ali',
        project_id: projectId,
        title: 'M1 Architecture Baseline',
        due_date: '2026-12-01',
      });
      assert.equal(createMilestone.status, 201);
      assert.ok(createMilestone.data.id);
      milestoneId = createMilestone.data.id;
      assert.equal(createMilestone.data.title, 'M1 Architecture Baseline');
    });

    // ── Workflow 5: Board and work-package creation ───────────────────────────
    await t.test('Workflow 5: Board and work-package creation', async () => {
      const createTask = await pmRequest('POST', '/api/pm/tasks', {
        actor: 'ali',
        project_id: projectId,
        title: 'Setup CI/CD Pipeline',
        description: 'Configure automated pipeline and linting',
        priority: 'P1',
        owner: 'ali',
        verifier: 'antigravity',
      });
      assert.equal(createTask.status, 201);
      assert.ok(createTask.data.task);
      taskId = createTask.data.task.id;
      taskUpdatedAt = createTask.data.task.updated_at;
      assert.ok(taskId.startsWith('PM-ACM-'));

      const boardTasks = await pmRequest('GET', `/api/pm/tasks?project_id=${encodeURIComponent(projectId)}`);
      assert.equal(boardTasks.status, 200);
      assert.equal(boardTasks.data.tasks.length, 1);
      assert.equal(boardTasks.data.tasks[0].id, taskId);
    });

    // ── Workflow 6: Task assignment and state transitions ─────────────────────
    await t.test('Workflow 6: Task assignment and state transitions', async () => {
      // Reassign owner to digital worker
      const reassign = await pmRequest('PATCH', `/api/pm/tasks/${encodeURIComponent(taskId)}`, {
        actor: 'ali',
        expected_updated_at: taskUpdatedAt,
        owner: 'antigravity',
        verifier: 'ali',
      });
      assert.equal(reassign.status, 200);
      assert.equal(reassign.data.task.owner, 'antigravity');
      taskUpdatedAt = reassign.data.task.updated_at;

      // Transition task from TODO to NEXT
      const transition = await pmRequest('PATCH', `/api/pm/tasks/${encodeURIComponent(taskId)}`, {
        actor: 'antigravity',
        expected_updated_at: taskUpdatedAt,
        status: 'NEXT',
      });
      assert.equal(transition.status, 200);
      assert.equal(transition.data.task.status, 'NEXT');
      taskUpdatedAt = transition.data.task.updated_at;
    });

    // ── Workflow 7: Workforce activity and operational visibility ─────────────
    await t.test('Workflow 7: Workforce activity and operational visibility', async () => {
      const attention = await pmRequest('GET', '/api/pm/attention');
      assert.equal(attention.status, 200);
      assert.ok(Array.isArray(attention.data.next_actions) || Array.isArray(attention.data.attention));

      const digest = await pmRequest('GET', '/api/pm/digests/latest');
      assert.equal(digest.status, 200);

      const followups = await pmRequest('GET', '/api/pm/followups');
      assert.equal(followups.status, 200);
      assert.ok(Array.isArray(followups.data.followups));
    });

    // ── Workflow 8: Communication, evidence and review workflows ──────────────
    await t.test('Workflow 8: Communication, evidence and review workflows', async () => {
      const attachEvidence = await pmRequest('POST', `/api/pm/tasks/${encodeURIComponent(taskId)}/evidence`, {
        actor: 'antigravity',
        expected_updated_at: taskUpdatedAt,
        note: 'Acceptance suite execution log verified against schema',
      });
      assert.equal(attachEvidence.status, 200);
      taskUpdatedAt = attachEvidence.data.task.updated_at;

      const taskWithEvidence = await pmRequest('GET', `/api/pm/tasks/${encodeURIComponent(taskId)}`);
      assert.equal(taskWithEvidence.status, 200);
      assert.ok(Array.isArray(taskWithEvidence.data.task.evidence_refs));
      assert.ok(taskWithEvidence.data.task.evidence_refs.length >= 1);
    });

    // ── Workflow 9: Organizational archive/revival and dependency rules ────────
    await t.test('Workflow 9: Organizational archive/revival and dependency rules', async () => {
      // 1. Dependency rule test: archiving unit with active position must be REFUSED
      const unitArchiveRefusal = await pmRequest('PATCH', `/api/pm/org/units/${encodeURIComponent(unitId)}`, {
        actor: 'ali',
        archived: true,
      });
      assert.equal(unitArchiveRefusal.status, 409);
      assert.equal(unitArchiveRefusal.data.error, 'HAS_DEPENDENTS');

      // 2. Dependency rule test: archiving position with active appointment must be REFUSED
      const posArchiveRefusal = await pmRequest('PATCH', `/api/pm/org/positions/${encodeURIComponent(positionId)}`, {
        actor: 'ali',
        archived: true,
      });
      assert.equal(posArchiveRefusal.status, 409);
      assert.equal(posArchiveRefusal.data.error, 'HAS_DEPENDENTS');

      // 3. End appointment first
      const endAppt = await pmRequest('POST', `/api/pm/org/appointments/${encodeURIComponent(appointmentId)}/end`, {
        actor: 'ali',
      });
      assert.equal(endAppt.status, 200);

      // 4. Archive position now succeeds
      const archivePos = await pmRequest('PATCH', `/api/pm/org/positions/${encodeURIComponent(positionId)}`, {
        actor: 'ali',
        archived: true,
      });
      assert.equal(archivePos.status, 200);
      assert.ok(archivePos.data.archived_at);

      // 5. Archive unit now succeeds
      const archiveUnit = await pmRequest('PATCH', `/api/pm/org/units/${encodeURIComponent(unitId)}`, {
        actor: 'ali',
        archived: true,
      });
      assert.equal(archiveUnit.status, 200);
      assert.ok(archiveUnit.data.archived_at);

      // 6. Verify org readback reflects archived state when requested
      const orgWithArchived = await pmRequest('GET', '/api/pm/org?include=archived');
      assert.equal(orgWithArchived.status, 200);
      const archivedRow = orgWithArchived.data.units.find((u) => u.id === unitId);
      assert.ok(archivedRow && archivedRow.archived_at);
    });

    // ── Workflow 10: Restart persistence without record resurrection ──────────
    await t.test('Workflow 10: Restart persistence without record resurrection', async () => {
      // Stop and restart server pointing to same tempDb
      await startServer(tempDb);

      const orgAfterRestart = await pmRequest('GET', '/api/pm/org?include=archived');
      assert.equal(orgAfterRestart.status, 200);
      assert.equal(orgAfterRestart.data.companies.length, 1);
      assert.equal(orgAfterRestart.data.companies[0].id, companyId);
      assert.equal(orgAfterRestart.data.people.length, 2);

      const projAfterRestart = await pmRequest('GET', '/api/pm/projects');
      assert.equal(projAfterRestart.status, 200);
      const projRow = projAfterRestart.data.projects.find((p) => p.id === projectId);
      assert.ok(projRow);

      const taskAfterRestart = await pmRequest('GET', `/api/pm/tasks/${encodeURIComponent(taskId)}`);
      assert.equal(taskAfterRestart.status, 200);
      assert.equal(taskAfterRestart.data.task.status, 'NEXT');
      assert.equal(taskAfterRestart.data.task.owner, 'antigravity');
    });

    // ── Workflow 11: Optional organization snapshot import on a clean database ─
    await t.test('Workflow 11: Optional organization snapshot import on a clean database', async () => {
      // The availability probe must report the POST import, not 404.
      const probe = await pmRequest('GET', '/api/pm/import/organization');
      assert.equal(probe.status, 200);
      assert.equal(probe.data.available, true);

      // Start server on a fresh clean database to test snapshot import
      const cleanDb = path.join(tempRoot, 'clean-import.db');
      await startServer(cleanDb);

      // Test functional dry-run import via POST on clean database
      const dryRunImport = await pmRequest('POST', '/api/pm/import/organization', {
        dry_run: true,
        snapshot: {
          format: 'starq-command.organization-snapshot',
          format_version: 1,
          schema_version: 3,
          source_system: 'starq-acceptance-fixture',
          exported_at: new Date().toISOString(),
          tables: {
            org_companies: [{ id: 'co_test_snap', name: 'Snapshot Co', legal_name: 'Snapshot Co LLC', created_at: new Date().toISOString() }],
            org_units: [],
            org_positions: [],
            org_people: [],
            org_appointments: [],
          },
        },
      });
      assert.equal(dryRunImport.status, 200);
      assert.equal(dryRunImport.data.ok, true);
      assert.equal(dryRunImport.data.dry_run, true);
      assert.equal(dryRunImport.data.counts.org_companies.created, 1);

      // Return server to main test database for dashboard navigation
      await startServer(tempDb);
    });

    // ── Workflow 12: Founder dashboard navigation and usable day-to-day workflows
    await t.test('Workflow 12: Founder dashboard navigation and usable day-to-day workflows', async () => {
      const portfolio = await pmRequest('GET', '/api/pm/portfolio');
      assert.equal(portfolio.status, 200);
      assert.ok(Array.isArray(portfolio.data.projects));

      const meta = await pmRequest('GET', '/api/pm/meta');
      assert.equal(meta.status, 200);
      assert.ok(meta.data.statuses.includes('TODO'));
      assert.ok(meta.data.handles.includes('ali'));

      const health = await pmRequest('GET', '/api/pm/health');
      assert.equal(health.status, 200);
      assert.equal(health.data.state, 'OK');
    });

  } finally {
    await stopServer();
    if (tempRoot && fs.existsSync(tempRoot)) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // Temp cleanup error ignored on exit
      }
    }
  }
});
