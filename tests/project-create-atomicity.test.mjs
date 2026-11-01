/**
 * Project creation is atomic: a rejected field leaves no project behind.
 *
 * WHY THIS EXISTS. `POST /api/pm/projects` ran two steps. `createProject`
 * inserted the row in its own transaction and committed; `updateProjectRecord`
 * then validated `status` in a second transaction. An invalid status therefore
 * answered 400 VALIDATION *after* the insert had already committed, leaving a
 * half-made project that the next retry rejected with 409 PROJECT_EXISTS — a
 * project the Founder never successfully created and cannot re-create.
 *
 * WHY IT IS WRITTEN THIS WAY. Earlier attempts to prove this over real HTTP
 * stalled twice (Room #17405, #17406) because the harness tried to confirm it
 * was talking to its own service by looking for a LISTENING row in `netstat`.
 * On this machine netstat does not reliably report loopback listeners even
 * while the service is demonstrably serving, so the probe refused to POST and
 * no result was ever obtained. Asking the operating system who owns the port
 * is the wrong question.
 *
 * This test asks the SERVICE instead. Each run creates a database at a unique
 * temporary path and asserts that `/api/pm/health` reports exactly that path
 * back. Only a process holding this run's own database can answer that way, so
 * identity is established from evidence the test itself created. Teardown
 * signals only the PID this test spawned and waits for its exit; no process
 * matching, no `kill -9` of anything it did not start.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'server', 'pm-service.mjs');
/** A scratch PM instance may bind only 5190-5199 (server/pm-service.mjs). */
const SCRATCH_PORTS = [5190, 5191, 5192, 5193, 5194, 5195, 5196, 5197, 5198, 5199];

const free = (port) => new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});

async function reservePort() {
  for (const port of SCRATCH_PORTS) if (await free(port)) return port;
  throw new Error(`no free scratch port in ${SCRATCH_PORTS[0]}-${SCRATCH_PORTS.at(-1)}`);
}

const headers = { 'content-type': 'application/json', 'x-pm-client': 'starq-command' };
const call = async (port, method, route, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body is reported raw */ }
  return { status: res.status, json, text };
};

/**
 * Start a PM service on its own database and prove it is ours.
 * Returns a handle whose `stop()` ends only this child.
 */
async function startOwnedService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-atomicity-'));
  const dbPath = path.join(dir, 'pm-atomicity.db');
  const port = await reservePort();

  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    env: { ...process.env, PM_DB_PATH: dbPath, PM_PORT: String(port), PM_ROOM_POST: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });

  const exited = new Promise((resolve) => child.once('exit', resolve));
  let stopped = false;
  /** `keepData` stops the process but leaves the database, so a restart can reopen it. */
  const stop = async ({ keepData = false } = {}) => {
    if (!stopped) {
      stopped = true;
      // Only this child, by the PID we hold. Never a name or port match.
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    if (!keepData) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  };
  t.after(() => stop());

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`PM service exited ${child.exitCode}:\n${out}`);
    try {
      const health = await call(port, 'GET', '/api/pm/health');
      if (health.status === 200) {
        // IDENTITY: only a process holding this run's own database can say this.
        assert.equal(health.json.db, dbPath, `health reports a different database:\n${health.text}`);
        assert.equal(health.json.state, 'OK', `database not OK:\n${health.text}`);
        assert.equal(health.json.scratch, true, 'service is not in scratch mode');
        return { port, dbPath, child, stop };
      }
    } catch { /* not accepting connections yet */ }
    if (Date.now() >= deadline) throw new Error(`PM service never became healthy:\n${out}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

const PROJECT = {
  actor: 'ali',
  id: 'atomicity-probe',
  name: 'Atomicity Probe',
  prefix: 'ATP',
  description: 'Disposable fixture for the project-create atomicity contract.',
};

test('a rejected project field leaves no project behind, and the id stays usable', async (t) => {
  const svc = await startOwnedService(t);
  const listIds = async () => {
    const res = await call(svc.port, 'GET', '/api/pm/projects');
    assert.equal(res.status, 200, res.text);
    return res.json.projects.map((p) => p.id);
  };

  const before = await listIds();
  assert.ok(!before.includes(PROJECT.id), 'fixture database already contains the probe project');

  // An invalid status is rejected only in the second step, after the insert.
  const rejected = await call(svc.port, 'POST', '/api/pm/projects', { ...PROJECT, status: 'not-a-status' });
  assert.equal(rejected.status, 400, `expected 400 VALIDATION, got ${rejected.status}: ${rejected.text}`);

  // THE CONTRACT: a refused create must leave nothing behind.
  const after = await listIds();
  assert.ok(
    !after.includes(PROJECT.id),
    'a refused create committed a partial project: the insert was not rolled back with its validation failure',
  );

  // And the consequence the Founder would actually hit: the id is still usable.
  const retry = await call(svc.port, 'POST', '/api/pm/projects', { ...PROJECT, status: 'active' });
  assert.equal(retry.status, 201, `retry after a refused create failed (${retry.status}): ${retry.text}`);
  assert.equal(retry.json.id, PROJECT.id);

  // Readback through the API, not the in-memory response.
  assert.ok((await listIds()).includes(PROJECT.id), 'created project is not readable back');
});

test('the created project survives a service restart', async (t) => {
  const first = await startOwnedService(t);
  const created = await call(first.port, 'POST', '/api/pm/projects', { ...PROJECT, status: 'active' });
  assert.equal(created.status, 201, created.text);
  await first.stop({ keepData: true });

  // Same database file, a new process: proves the row was committed, not cached.
  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    env: { ...process.env, PM_DB_PATH: first.dbPath, PM_PORT: String(first.port), PM_ROOM_POST: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  });

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const health = await call(first.port, 'GET', '/api/pm/health');
      if (health.status === 200 && health.json.db === first.dbPath) break;
    } catch { /* starting */ }
    if (Date.now() >= deadline) throw new Error('restarted PM service never became healthy');
    await new Promise((r) => setTimeout(r, 150));
  }

  const res = await call(first.port, 'GET', '/api/pm/projects');
  assert.equal(res.status, 200, res.text);
  assert.ok(res.json.projects.map((p) => p.id).includes(PROJECT.id), 'project did not survive restart');
});
