/**
 * CV-C6 — provisioning is a first-run choice, never a startup repair.
 *
 * Founder directive (1 Nov 2026): fresh installations start with an empty
 * organization; existing data is never reseeded; deletions are not reversed by
 * startup seeding.
 *
 * Each case runs a REAL service process against a disposable database and
 * verifies through the HTTP API, because the defect this guards only appears
 * across a process restart. Service identity is established from the unique
 * database path the service reports back, not from the OS port table, and
 * teardown signals only the PID the test spawned.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'server', 'pm-service.mjs');
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
  // Every port is spoken for in this process; fall back to the least recently
  // used one rather than failing outright.
  const p = SCRATCH_PORTS[0];
  taken.add(p);
  return p;
}

const headers = { 'content-type': 'application/json', 'x-pm-client': 'starq-command' };
async function call(port, method, route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, json, text };
}

/** Start the service on `dbPath`, prove identity, return a handle. */
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

function disposableDbPath(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-provisioning-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  return path.join(dir, 'pm.db');
}

const provisioningOf = (dbPath) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare("SELECT value FROM pm_meta WHERE key = 'provisioning'").get()?.value ?? null; }
  finally { db.close(); }
};

// ── Test A: a fresh installation is empty ──────────────────────────────────

test('A: a fresh installation starts with no organization and records that choice', async (t) => {
  const dbPath = disposableDbPath(t);
  const svc = await start(t, dbPath);

  assert.equal(svc.health.state, 'OK');
  assert.equal(svc.health.projects, 0, 'a fresh installation must contain no projects');
  assert.equal(svc.health.tasks, 0, 'a fresh installation must contain no tasks');

  const org = await call(svc.port, 'GET', '/api/pm/org');
  assert.equal(org.status, 200, org.text);
  assert.equal((org.json.companies ?? []).length, 0, 'a fresh installation must contain no company');

  assert.equal(provisioningOf(dbPath), 'empty');
});

test('A2: the empty installation is usable — a first organization can be created and read back', async (t) => {
  const dbPath = disposableDbPath(t);
  const svc = await start(t, dbPath);

  const created = await call(svc.port, 'POST', '/api/pm/org/companies', {
    actor: 'ali', name: 'Northwind Trading', legal_name: 'Northwind Trading Ltd',
  });
  assert.equal(created.status, 201, `creating the first company failed: ${created.text}`);

  const org = await call(svc.port, 'GET', '/api/pm/org');
  assert.equal(org.status, 200, org.text);
  assert.equal(org.json.companies.length, 1);
  assert.equal(org.json.companies[0].name, 'Northwind Trading');
});

// ── The defect this guard exists for ───────────────────────────────────────

test('E: a deleted project stays deleted across a restart', async (t) => {
  const dbPath = disposableDbPath(t);

  // Provision Starq fixtures explicitly so there is something to delete.
  const first = await start(t, dbPath, { provision: 'starq' });
  assert.ok(first.health.projects > 0, 'explicit provisioning should have created projects');
  assert.equal(provisioningOf(dbPath), 'starq-fixtures@3');

  const before = await call(first.port, 'GET', '/api/pm/projects');
  const victim = before.json.projects.find((p) => p.id === 'buzzlab') ?? before.json.projects[0];
  assert.ok(victim, 'expected at least one provisioned project');

  // Delete directly: the API-level delete control is Cursor's CV-CU6. What is
  // under test here is that STARTUP does not undo a deletion.
  const db = new DatabaseSync(dbPath);
  try { db.prepare('DELETE FROM pm_projects WHERE id = ?').run(victim.id); }
  finally { db.close(); }
  await first.stop();

  const second = await start(t, dbPath);
  const after = await call(second.port, 'GET', '/api/pm/projects');
  assert.equal(after.status, 200, after.text);
  assert.ok(
    !after.json.projects.some((p) => p.id === victim.id),
    `startup seeding resurrected the deleted project ${victim.id}`,
  );
});

// ── Test B: an existing database is never reseeded ─────────────────────────

test('B: an existing database is classified legacy-seeded and never reseeded', async (t) => {
  const dbPath = disposableDbPath(t);

  // Build a populated database the way a pre-guard installation would look.
  const seeded = await start(t, dbPath, { provision: 'starq' });
  const projects = seeded.health.projects;
  assert.ok(projects > 0);
  await seeded.stop();

  // Erase the provisioning marker to simulate a database that predates CV-C6.
  const db = new DatabaseSync(dbPath);
  try { db.prepare("DELETE FROM pm_meta WHERE key = 'provisioning'").run(); }
  finally { db.close(); }

  // Even with provisioning requested, existing data must be classified, not reseeded.
  const reopened = await start(t, dbPath, { provision: 'starq' });
  assert.equal(provisioningOf(dbPath), 'legacy-seeded');
  assert.equal(reopened.health.projects, projects, 'row counts must be unchanged');
  assert.ok(
    reopened.health.seed_drift.some((d) => /seeding and imports are disabled/i.test(d)),
    `expected the guard to report itself: ${JSON.stringify(reopened.health.seed_drift)}`,
  );
});

test('B2: a database already marked empty is not provisioned later, even on request', async (t) => {
  const dbPath = disposableDbPath(t);
  const first = await start(t, dbPath);
  assert.equal(provisioningOf(dbPath), 'empty');
  await first.stop();

  const second = await start(t, dbPath, { provision: 'starq' });
  assert.equal(second.health.projects, 0, 'a decided database must never be provisioned afterwards');
  assert.equal(provisioningOf(dbPath), 'empty');
});

// ── Test F: persistence across restart ─────────────────────────────────────

test('F: user-created data survives a restart of an empty installation', async (t) => {
  const dbPath = disposableDbPath(t);
  const first = await start(t, dbPath);

  /*
    Order matters on a brand new installation, and this test pins it.

    `createProject` validates `actor` against the known handles, which are the
    identity registry plus `org_people`. A fresh database has no people, and a
    standalone installation has no identity registry, so the FIRST thing a new
    organization must do is register a person. Until then no actor is valid and
    nothing can be created.

    That ordering is a real constraint on the first-run experience (CV-CU8):
    onboarding has to create the first person before offering to create
    anything else, or the user meets "actor is not a known active identity"
    with no way forward.
  */
  const person = await call(first.port, 'POST', '/api/pm/org/people', {
    actor: 'ali', handle: 'ali', display_name: 'Ali Musthaq', kind: 'HUMAN',
  });
  assert.equal(person.status, 201, `registering the first person failed: ${person.text}`);

  const created = await call(first.port, 'POST', '/api/pm/projects', {
    actor: 'ali', id: 'northwind', name: 'Northwind Rollout', prefix: 'NW',
    description: 'First project of a brand new organization.', status: 'active',
  });
  assert.equal(created.status, 201, created.text);
  await first.stop();

  const second = await start(t, dbPath);
  const list = await call(second.port, 'GET', '/api/pm/projects');
  assert.ok(list.json.projects.some((p) => p.id === 'northwind'), 'user project did not survive restart');
  assert.equal(second.health.projects, 1, 'restart must not add fixtures alongside user data');
});
