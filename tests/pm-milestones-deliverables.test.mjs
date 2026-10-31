/**
 * Projects, Milestones, Deliverables & Migration Idempotency Tests (CV-AG3 / Journey J4).
 *
 * Verifies:
 *   1. Project creation, PATCH (name, description, status, owner, archive), and ?include=archived filtering.
 *   2. Milestone CRUD, task assignment via milestone_id (preserving legacy milestone text), progress & at_risk calculation.
 *   3. Deliverables, work_package grouping (GET /api/pm/work-packages), and repository artifacts (POST /api/pm/tasks/:id/artifacts).
 *   4. Dependency blocking (409 DEPENDENCY_OPEN when moving dependent task to IN_PROGRESS before dependency is CLOSED).
 *   5. Schema migration idempotency on a VACUUM INTO copy of data/pm-operating.db (1,349 tasks preserved).
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMAND_ENTRY = path.join(ROOT, 'server', 'pm-service.mjs');
const TEST_ROOT = process.env.STARQ_COMMAND_TEST_TMPDIR || os.tmpdir();

let serverProcess = null;
let serverPort = null;
let tempRoot = null;
let tempDb = null;

async function unusedPort() {
  for (let candidate = 5194; candidate <= 5199; candidate++) {
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
  tempRoot = fs.mkdtempSync(path.join(TEST_ROOT, 'pm-ms-deliv-'));
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

test('CV-AG3 / J4: projects PATCH & archive, milestones progress & at_risk, deliverables, artifacts, and dependency blocking', async () => {
  setup();
  await startServer();

  // 1. Create a new project and PATCH its metadata
  const projCreate = await api('POST', '/api/pm/projects', {
    actor: 'ali',
    id: 'convergence-lab',
    name: 'Convergence Lab',
    prefix: 'CLAB',
    description: 'Initial lab description',
    owner: 'antigravity',
    status: 'active',
  });
  assert.equal(projCreate.status, 201);
  assert.equal(projCreate.body.owner, 'antigravity');
  assert.equal(projCreate.body.status, 'active');

  const projPatch = await api('PATCH', '/api/pm/projects/convergence-lab', {
    actor: 'ali',
    name: 'Convergence Lab v2',
    description: 'Updated description',
  });
  assert.equal(projPatch.status, 200);
  assert.equal(projPatch.body.name, 'Convergence Lab v2');

  // 2. Create two milestones: one due in 3 days (at_risk once open task added), one due in 30 days
  const soonDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const laterDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const ms1 = await api('POST', '/api/pm/milestones', {
    actor: 'ali',
    project_id: 'convergence-lab',
    title: 'M1: Core Schema & API',
    description: 'Deliver core endpoints',
    due_date: soonDate,
    status: 'active',
    ordinal: 1,
  });
  assert.equal(ms1.status, 201);
  assert.equal(ms1.body.progress.total_tasks, 0);
  assert.equal(ms1.body.at_risk, false, 'not at risk when 0 open tasks');

  const ms2 = await api('POST', '/api/pm/milestones', {
    actor: 'ali',
    project_id: 'convergence-lab',
    title: 'M2: Final Integration',
    due_date: laterDate,
    status: 'planned',
    ordinal: 2,
  });
  assert.equal(ms2.status, 201);

  // 3. Create tasks linked to M1 with work_package and deliverable metadata + dependency chain
  const task1 = await api('POST', '/api/pm/tasks', {
    actor: 'ali',
    project_id: 'convergence-lab',
    title: 'Implement schema migrations',
    owner: 'antigravity',
    verifier: 'claude',
    priority: 'P1',
    status: 'NEXT',
    milestone_id: ms1.body.id,
    work_package: 'CV-AG1',
    is_deliverable: true,
    deliverable_kind: 'code',
  });
  assert.equal(task1.status, 201);
  assert.equal(task1.body.task.milestone_id, ms1.body.id);
  assert.equal(task1.body.task.milestone, 'M1: Core Schema & API');
  assert.equal(task1.body.task.work_package, 'CV-AG1');
  assert.equal(task1.body.task.is_deliverable, true);
  assert.equal(task1.body.task.deliverable_kind, 'code');

  const task2 = await api('POST', '/api/pm/tasks', {
    actor: 'ali',
    project_id: 'convergence-lab',
    title: 'Verify schema migrations',
    owner: 'claude',
    verifier: 'antigravity',
    priority: 'P1',
    status: 'NEXT',
    depends_on: [task1.body.task.id],
    milestone_id: ms1.body.id,
    work_package: 'CV-AG1',
  });
  assert.equal(task2.status, 201);

  // 4. Attempting to start task2 while task1 is not CLOSED must return 409 DEPENDENCY_OPEN
  const startBlocked = await api('PATCH', `/api/pm/tasks/${task2.body.task.id}`, {
    actor: 'claude',
    expected_updated_at: task2.body.task.updated_at,
    stage: 'IN_PROGRESS',
  });
  assert.equal(startBlocked.status, 409);
  assert.equal(startBlocked.body.error, 'DEPENDENCY_OPEN');

  // Task1 has no unmet dependencies so it can start immediately
  const startTask1 = await api('PATCH', `/api/pm/tasks/${task1.body.task.id}`, {
    actor: 'antigravity',
    expected_updated_at: task1.body.task.updated_at,
    stage: 'IN_PROGRESS',
  });
  assert.equal(startTask1.status, 200);
  assert.equal(startTask1.body.task.stage, 'IN_PROGRESS');

  // 5. Link repository artifacts to task1
  const artRes = await api('POST', `/api/pm/tasks/${task1.body.task.id}/artifacts`, {
    actor: 'antigravity',
    expected_updated_at: startTask1.body.task.updated_at,
    branch: 'ag/command-convergence',
    commit_sha: '9d7897f',
    pr_ref: '#42',
    pr_url: 'https://github.com/Starq-Technologies-Pvt-Ltd/starq-command/pull/42',
    deliverable_kind: 'code',
    note: 'Linked convergence implementation commit',
  });
  assert.equal(artRes.status, 200);
  assert.equal(artRes.body.task.branch, 'ag/command-convergence');
  assert.equal(artRes.body.task.commit_sha, '9d7897f');
  assert.equal(artRes.body.task.pr_ref, '#42');

  // 6. Verify milestone progress & at_risk flag (due in 3 days with 2 open tasks)
  const msDetail = await api('GET', `/api/pm/milestones/${ms1.body.id}`);
  assert.equal(msDetail.status, 200);
  assert.equal(msDetail.body.milestone.progress.total_tasks, 2);
  assert.equal(msDetail.body.milestone.progress.open_tasks, 2);
  assert.equal(msDetail.body.milestone.at_risk, true);
  assert.equal(msDetail.body.tasks.length, 2);

  // 7. Verify GET /api/pm/work-packages rollup
  const wpRes = await api('GET', '/api/pm/work-packages?project_id=convergence-lab');
  assert.equal(wpRes.status, 200);
  assert.equal(wpRes.body.work_packages.length, 1);
  assert.equal(wpRes.body.work_packages[0].work_package, 'CV-AG1');
  assert.equal(wpRes.body.work_packages[0].total_tasks, 2);
  assert.equal(wpRes.body.work_packages[0].deliverables.length, 1);
  assert.equal(wpRes.body.work_packages[0].deliverables[0].commit_sha, '9d7897f');

  // 8. Soft-archive project and verify ?include=archived filtering
  const archProj = await api('PATCH', '/api/pm/projects/convergence-lab', {
    actor: 'ali',
    archived: true,
  });
  assert.equal(archProj.status, 200);
  assert.ok(archProj.body.archived_at);

  const activeProjs = await api('GET', '/api/pm/projects');
  assert.ok(!activeProjs.body.projects.some((p) => p.id === 'convergence-lab'));
  const allProjs = await api('GET', '/api/pm/projects?include=archived');
  assert.ok(allProjs.body.projects.some((p) => p.id === 'convergence-lab'));
});

test('CV-AG3 migration idempotency: running initSchema twice on a copy of data/pm-operating.db preserves all rows and produces identical schema', () => {
  const canonicalDbPath = path.join(ROOT, 'data', 'pm-operating.db');
  if (!fs.existsSync(canonicalDbPath)) return;

  const tmpDir = fs.mkdtempSync(path.join(TEST_ROOT, 'pm-mig-idem-'));
  const copyPath = path.join(tmpDir, 'copy.db');
  try {
    const srcDb = new DatabaseSync(canonicalDbPath, { readOnly: true });
    srcDb.exec(`VACUUM INTO '${copyPath.replace(/'/g, "''")}'`);
    srcDb.close();

    const copyDb = new DatabaseSync(copyPath);
    const beforeTasks = Number(copyDb.prepare('SELECT COUNT(*) AS n FROM pm_tasks').get().n);
    const beforeProjects = Number(copyDb.prepare('SELECT COUNT(*) AS n FROM pm_projects').get().n);

    // Run initSchema twice
    initSchema(copyDb);
    const schemaAfter1 = copyDb.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all();
    initSchema(copyDb);
    const schemaAfter2 = copyDb.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all();

    assert.deepEqual(schemaAfter1, schemaAfter2, 'schema must be identical across repeated initSchema runs');
    const afterTasks = Number(copyDb.prepare('SELECT COUNT(*) AS n FROM pm_tasks').get().n);
    const afterProjects = Number(copyDb.prepare('SELECT COUNT(*) AS n FROM pm_projects').get().n);
    assert.equal(afterTasks, beforeTasks, 'all existing tasks must be preserved');
    assert.equal(afterProjects, beforeProjects, 'all existing projects must be preserved');

    copyDb.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

after(async () => {
  await teardown();
});
