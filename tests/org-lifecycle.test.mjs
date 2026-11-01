/**
 * CV-CU6 / CV-CU8 — first person before a project, archive that sticks,
 * dependency refusal, audit, and the same id after archive.
 *
 * Disposable database only. Service identity is the database path reported by
 * /api/pm/health. Teardown signals only the PID this file spawned.
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
const SCRATCH_PORTS = [5190, 5191, 5192, 5193, 5194, 5195, 5196, 5197, 5198, 5199];
const taken = new Set();

const freePort = (port) => new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});

async function reservePort() {
  for (const port of SCRATCH_PORTS) {
    if (taken.has(port)) continue;
    if (await freePort(port)) {
      taken.add(port);
      return port;
    }
  }
  throw new Error('no scratch PM port free in 5190-5199');
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
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, json, text };
}

async function start(t, dbPath) {
  const port = await reservePort();
  const env = { ...process.env, PM_DB_PATH: dbPath, PM_PORT: String(port), PM_ROOM_POST: 'off' };
  delete env.COMMAND_PROVISION;
  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    taken.delete(port);
  };
  t.after(stop);
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`service exited ${child.exitCode}:\n${out}`);
    try {
      const health = await call(port, 'GET', '/api/pm/health');
      if (health.status === 200) {
        assert.equal(health.json.db, dbPath, health.text);
        return { port, stop, health: health.json };
      }
    } catch { /* starting */ }
    if (Date.now() >= deadline) throw new Error(`service never became healthy:\n${out}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

test('empty install requires a person, and archive survives restart with the id reusable', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-lifecycle-'));
  const dbPath = path.join(dir, 'pm.db');
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  const first = await start(t, dbPath);
  const blocked = await call(first.port, 'POST', '/api/pm/projects', {
    actor: 'ali',
    id: 'northwind',
    name: 'Northwind Rollout',
    prefix: 'NW',
    description: 'Should not exist yet.',
  });
  assert.equal(blocked.status, 400, blocked.text);
  assert.match(blocked.json?.message ?? '', /actor is not a known active identity/);

  const company = await call(first.port, 'POST', '/api/pm/org/companies', {
    actor: 'founder',
    id: 'northwind-co',
    name: 'Northwind',
  });
  assert.equal(company.status, 201, company.text);
  const edited = await call(first.port, 'PATCH', '/api/pm/org/companies/northwind-co', {
    actor: 'founder',
    name: 'Northwind Trading',
  });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.json.name, 'Northwind Trading');

  const unit = await call(first.port, 'POST', '/api/pm/org/units', {
    actor: 'founder',
    id: 'northwind-ops',
    company_id: 'northwind-co',
    kind: 'DEPARTMENT',
    name: 'Operations',
  });
  assert.equal(unit.status, 201, unit.text);

  const refused = await call(first.port, 'PATCH', '/api/pm/org/companies/northwind-co', {
    actor: 'founder',
    archived: true,
  });
  assert.equal(refused.status, 409, refused.text);
  assert.equal(refused.json.error, 'HAS_DEPENDENTS');
  assert.match(refused.json.message, /Nothing was removed/);
  const stillThere = await call(first.port, 'GET', '/api/pm/org');
  assert.ok(stillThere.json.companies.some((row) => row.id === 'northwind-co'));
  assert.ok(stillThere.json.units.some((row) => row.id === 'northwind-ops'));

  const archived = await call(first.port, 'PATCH', '/api/pm/org/units/northwind-ops', {
    actor: 'founder',
    archived: true,
  });
  assert.equal(archived.status, 200, archived.text);
  assert.ok(archived.json.archived_at);
  const history = await call(first.port, 'GET', '/api/pm/org/history?entity=unit&id=northwind-ops');
  const audit = history.json.history.find((row) => row.action === 'ARCHIVE');
  assert.ok(audit, JSON.stringify(history.json));
  assert.equal(audit.actor, 'founder');
  assert.equal(typeof audit.timestamp, 'string');
  assert.ok(audit.timestamp.length > 0);

  await first.stop();
  const second = await start(t, dbPath);
  const afterRestart = await call(second.port, 'GET', '/api/pm/org');
  assert.ok(!afterRestart.json.units.some((row) => row.id === 'northwind-ops'), 'archived unit returned on restart');
  const archivedView = await call(second.port, 'GET', '/api/pm/org?include=archived');
  assert.ok(archivedView.json.units.some((row) => row.id === 'northwind-ops' && row.archived_at));

  const recreated = await call(second.port, 'POST', '/api/pm/org/units', {
    actor: 'founder',
    id: 'northwind-ops',
    company_id: 'northwind-co',
    kind: 'DEPARTMENT',
    name: 'Operations Again',
  });
  assert.equal(recreated.status, 201, recreated.text);
  assert.equal(recreated.json.name, 'Operations Again');
  assert.equal(recreated.json.archived_at, null);

  const person = await call(second.port, 'POST', '/api/pm/org/people', {
    actor: 'founder',
    handle: 'founder',
    display_name: 'Founder',
    kind: 'HUMAN',
  });
  assert.equal(person.status, 201, person.text);
  const project = await call(second.port, 'POST', '/api/pm/projects', {
    actor: 'founder',
    id: 'northwind',
    name: 'Northwind Rollout',
    prefix: 'NW',
    description: 'First project.',
  });
  assert.equal(project.status, 201, project.text);
  const projectArchive = await call(second.port, 'PATCH', '/api/pm/projects/northwind', {
    actor: 'founder',
    archived: true,
  });
  assert.equal(projectArchive.status, 200, projectArchive.text);
  await second.stop();

  const third = await start(t, dbPath);
  const projects = await call(third.port, 'GET', '/api/pm/projects');
  assert.ok(!projects.json.projects.some((row) => row.id === 'northwind'));
  const restored = await call(third.port, 'POST', '/api/pm/projects', {
    actor: 'founder',
    id: 'northwind',
    name: 'Northwind Rollout',
    prefix: 'NW',
    description: 'Recreated after archive.',
  });
  assert.equal(restored.status, 201, restored.text);
  const visible = await call(third.port, 'GET', '/api/pm/projects');
  assert.ok(visible.json.projects.some((row) => row.id === 'northwind'));
});
