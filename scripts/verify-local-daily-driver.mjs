/**
 * Real daily-driver acceptance for the local operating foundation (CV-C1c, D).
 *
 * This drives the ACTUAL pm-service process against an isolated scratch
 * instance (its own *.db and port 5190-5199) and proves the Founder's cycle
 * end to end, with nothing else online — no Hermes, Herdr, Room broker or WSL:
 *
 *   1. start the service locally          2. read organizations/projects
 *   3. create a project + task            4. update the task's status
 *   5. persist and read it back           6. restart the service
 *   7. recover the same records           8. back up, mutate, restore, verify
 *
 * It never touches the canonical operating database or ports. On-demand only
 * (npm run verify:local); it is not part of the auto-run offline suites because
 * it spawns a real server and binds a port.
 *
 * Usage: node scripts/verify-local-daily-driver.mjs [--port 5192] [--keep]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup, restoreBackup, integrityCheck } from './lifecycle/backup.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Resolve the canonical workspace by walking up to STARQ.md (works from the
// canonical checkout and from any worktree, which sits deeper under it).
function findWorkspaceRoot(from) {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'STARQ.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(from, '..', '..', '..');
    dir = up;
  }
}
const WORKSPACE_ROOT = process.env.STARQ_WORKSPACE || findWorkspaceRoot(PACKAGE_ROOT);
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1]) || 5192;
const KEEP = args.includes('--keep');
const ACTOR = 'claude';
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

fs.mkdirSync(path.join(PACKAGE_ROOT, '.command-runtime-local'), { recursive: true });
const scratchDir = fs.mkdtempSync(path.join(PACKAGE_ROOT, '.command-runtime-local', 'e2e-'));
const scratchDb = path.join(scratchDir, 'pm-operating.db');
const log = (step, detail) => console.log(`  [${step}] ${detail}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
function startService() {
  const p = spawn(process.execPath, ['server/pm-service.mjs'], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, STARQ_WORKSPACE: WORKSPACE_ROOT, PM_DB_PATH: scratchDb, PM_PORT: String(PORT), PM_ROOM_POST: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  p.stdout.on('data', () => {});
  p.stderr.on('data', (d) => process.env.E2E_DEBUG && process.stderr.write(d));
  return p;
}
async function stopService() {
  if (!proc) return;
  const dead = new Promise((r) => proc.once('exit', r));
  proc.kill();
  await Promise.race([dead, sleep(3000)]);
  proc = null;
  await sleep(300); // let the OS release the sqlite handle / port
}
async function waitHealthy(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/pm/health`);
      if (res.ok) { const b = await res.json(); if (b.state === 'OK') return b; }
    } catch { /* not up yet */ }
    if (Date.now() >= deadline) throw new Error('pm-service did not become healthy in time');
    await sleep(200);
  }
}
async function api(method, p, body) {
  // The PM service requires the X-PM-Client guard header on every mutating call.
  const headers = { 'X-PM-Client': 'starq-command', ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-json */ }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}
function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

async function main() {
  console.log(`Local daily-driver acceptance — scratch DB ${scratchDb}, port ${PORT}`);

  // 1. Start locally.
  proc = startService();
  const health = await waitHealthy();
  log('1 start', `pm-service healthy (state=${health.state}, scratch=${health.scratch})`);

  // 2. Read organizations/projects (empty on a fresh scratch DB, but served).
  const proj0 = await api('GET', '/api/pm/projects');
  log('2 read', `projects endpoint ok (${proj0.projects.length} existing)`);

  const tasksOf = async () => (await api('GET', '/api/pm/tasks?project_id=daily-driver')).tasks;
  const oneTask = async (id) => (await tasksOf()).find((t) => t.id === id);

  // 3. Create a project + task.
  await api('POST', '/api/pm/projects', { actor: ACTOR, id: 'daily-driver', name: 'Daily Driver Check', prefix: 'DDC', description: 'CV-C1c acceptance' });
  const task = (await api('POST', '/api/pm/tasks', { actor: ACTOR, project_id: 'daily-driver', title: 'Verify local persistence', owner: ACTOR, priority: 'P2' })).task;
  const taskId = task.id;
  log('3 create', `project daily-driver + task ${taskId} (status=${task.status}, stage=${task.stage})`);

  // 4. Update the task without any Room ceremony: an ungated local stage move
  //    (BACKLOG -> READY) plus ordinary field edits.
  const movedR = (await api('PATCH', `/api/pm/tasks/${taskId}`, { actor: ACTOR, expected_updated_at: task.updated_at, stage: 'READY', note: 'ready (local, no Room authorization)' })).task;
  assert(movedR.stage === 'READY', 'ungated local stage move to READY succeeded without a Room ref');
  const moved = (await api('PATCH', `/api/pm/tasks/${taskId}`, { actor: ACTOR, expected_updated_at: movedR.updated_at, title: 'Verify local persistence (edited)', priority: 'P1' })).task;
  log('4 update', `task ${taskId} -> stage=${moved.stage}, priority=${moved.priority}, title edited (no Room authorization requested)`);

  // 5. Persist and read back (via the API, not in-page state).
  const readBack = await oneTask(taskId);
  assert(readBack && readBack.stage === 'READY' && readBack.priority === 'P1' && /edited/.test(readBack.title), 'edits are readable via the API');
  log('5 persist', `task ${taskId} reads back stage=${readBack.stage}, priority=${readBack.priority}`);

  // 6. Restart the service.
  await stopService();
  proc = startService();
  await waitHealthy();
  log('6 restart', 'pm-service stopped and started again on the same scratch DB');

  // 7. Recover the same records after restart.
  const afterRestart = await oneTask(taskId);
  assert(afterRestart && afterRestart.stage === 'READY' && /edited/.test(afterRestart.title), 'records survive a restart');
  const projAfter = (await api('GET', '/api/pm/projects')).projects.find((p) => p.id === 'daily-driver');
  assert(projAfter, 'project survives a restart');
  log('7 recover', `task ${taskId} and project daily-driver recovered intact after restart`);

  // 8. Backup, mutate, restore, verify (stopped-state restore).
  const snap = createBackup(scratchDb, { keep: 14 });
  assert(integrityCheck(snap.backup).ok, 'backup passes integrity_check');
  log('8 backup', `snapshot ${path.basename(snap.backup)} (${snap.bytes} bytes, integrity=${snap.integrity})`);
  // Mutate: add a second task to the project so the DB differs from the snapshot.
  await api('POST', '/api/pm/tasks', { actor: ACTOR, project_id: 'daily-driver', title: 'Throwaway task to be rolled back', owner: ACTOR });
  assert((await tasksOf()).length === 2, 'mutation added a second task to daily-driver');
  await stopService(); // restore is stopped-state only
  const restored = await restoreBackup(snap.backup, scratchDb, { allowRunning: true }); // scratch is stopped; the probe targets the canonical port, not 5192
  assert(restored.safetyCopy && fs.existsSync(restored.safetyCopy), 'pre-restore safety snapshot kept');
  proc = startService();
  await waitHealthy();
  const afterRestore = await tasksOf();
  assert(afterRestore.length === 1 && afterRestore[0].id === taskId, 'restore rolled the project back to the one-task snapshot');
  log('8 restore', `restored snapshot (safety copy ${path.basename(restored.safetyCopy)}); daily-driver task count back to ${afterRestore.length}`);

  console.log('\nRESULT: PASS — standalone daily-driver cycle verified (start, read, create, update, persist, restart, recover, backup/restore).');
}

main()
  .then(async () => { await stopService(); if (!KEEP) fs.rmSync(scratchDir, { recursive: true, force: true }); process.exit(0); })
  .catch(async (err) => {
    console.error(`\nRESULT: FAIL — ${err.message}`);
    await stopService();
    if (!KEEP) { try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ } }
    process.exit(1);
  });
