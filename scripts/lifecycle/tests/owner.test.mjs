/**
 * Offline tests for the Command lifecycle owner. Nothing here spawns a real
 * component: every OS seam (process table, listeners, control pipes, health,
 * broker lifecycle channel, forced kill) is a simulated world.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createOwner, RESULT } from '../owner.mjs';
import { readState, writeState } from '../state.mjs';
import { loadConfig, validateConfig, ConfigError, findEnvOverrides } from '../config.mjs';
import { evaluateHealth } from '../health.mjs';
import { osVerdict } from '../inspect.mjs';
import { InspectionError } from '../inspect.mjs';

const NODE = 'D:\\fake\\runtime\\node.exe';
const PORTS = { data: 5177, building: 5178, herdrBroker: 5188, herdr: 5179, pm: 5176, ui: 5173 };

function baseConfig(root) {
  const c = (name, deps, extra = {}) => ({
    name, kind: name === 'ui' ? 'vite' : 'module', entry: `x\\${name}.mjs`, cwd: 'x', port: PORTS[name], depends_on: deps,
    health: { path: '/h', status: 200, json_has: ['ok'] }, ...extra,
  });
  return {
    schema: 'starq.command.lifecycle.config/v1', workspace_root: root, node: NODE, host: '127.0.0.1',
    timeouts_ms: { identity: 40, health: 40, graceful_exit: 40, broker_request: 40, agent_stop: 40 },
    components: [
      c('data', []), c('building', []),
      c('herdrBroker', [], { lifecycle_token: 'tok.txt', manifest: 'manifest.json' }),
      c('herdr', ['herdrBroker']),
      c('pm', []),
      c('ui', ['data', 'building', 'herdr', 'pm'], { vite_config: 'vite.config.ts', health: { path: '/', status: 200, content_type: 'text/html', body_includes: ['root'] } }),
    ],
    profile: { required_files: [] },
  };
}

/** A simulated machine. */
function world({ mutateConfig = null, env = {}, historicalCloseoutHandoff = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'starq-owner-'));
  const cfgDoc = baseConfig(dir);
  if (mutateConfig) mutateConfig(cfgDoc);
  const configFile = path.join(dir, 'lifecycle.config.json');
  writeFileSync(configFile, JSON.stringify(cfgDoc), 'utf8');
  const runtimeDir = path.join(dir, '.command-runtime');
  const procs = new Map();       // pid -> {found, name, exe, created}
  const pipes = new Map();       // pid -> {instance, name}
  const listeners = [];          // {port, pid}
  const behaviour = {};          // name -> 'exit' | 'stubborn'
  const health = {};             // name -> {ok, detail}
  const files = { [path.join(dir, 'manifest.json')]: JSON.stringify({ workspace_root: dir, agents: [{ id: 'a', startup_policy: 'FLOOR_LAUNCH' }] }) };
  const calls = { spawn: [], shutdown: [], forceKill: [], broker: [], gracefulStopContained: [], historicalCloseoutHandoff: [] };
  const brokerSim = {
    token: 'TOKEN', admission: 'OPEN', running: [], stopAgents: 'ok', openTerminals: 0,
    pendingLaunches: 0, unresolvedLaunches: 0, orphanedSessions: 0, historicalUnverified: 0,
    registryRecords: [],
  };
  let nextPid = 1000;
  let clock = Date.parse('2026-10-03T10:00:00Z');
  let inspectFails = false;
  let listenersFail = false;
  const iso = () => new Date(clock += 1).toISOString().replace('Z', '0000Z');
  const SELF = 999;
  procs.set(SELF, { found: true, name: 'node.exe', exe: NODE, created: iso() });

  const kill = (pid) => {
    const p = procs.get(pid);
    procs.delete(pid); pipes.delete(pid);
    for (let i = listeners.length - 1; i >= 0; i -= 1) if (listeners[i].pid === pid) listeners.splice(i, 1);
    return p;
  };
  const deps = {
    treeClosed: async () => true, // this simulated world contains leaf processes only
    treeSignalSafe: async () => true,
    prerequisites: async () => [{ resolved: true }], // independent gate tests cover refusals
    selfPid: SELF,
    pollMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
    inspect: async (pids) => {
      if (inspectFails) throw new InspectionError('Access is denied');
      const m = new Map();
      for (const pid of pids) m.set(pid, procs.has(pid) ? { pid, ...procs.get(pid) } : { pid, found: false });
      return m;
    },
    inspectInfrastructure: async () => [],
    listListeners: async () => { if (listenersFail) throw new InspectionError('netstat failed'); return listeners.map((l) => ({ ...l })); },
    spawnChild: (exe, args, opts) => {
      const pid = ++nextPid;
      const name = opts.env.STARQ_LC_NAME;
      // Snapshot the persisted state at the moment of each spawn (persist-as-you-go evidence).
      const snap = readState(path.join(runtimeDir, 'state.json'));
      calls.spawn.push({
        name, pid, exe,
        priorChildren: snap.kind === 'OK' ? snap.state.children.map((c) => `${c.name}:${c.status}`) : [],
        env: {
          PM_PORT: opts.env.PM_PORT ?? null,
          PM_ROOM_POST: opts.env.PM_ROOM_POST ?? null,
          PM_DB_PATH: opts.env.PM_DB_PATH ?? null,
          PM_ROOM_LEDGER: opts.env.PM_ROOM_LEDGER ?? null,
          PM_ROOM_FROM: opts.env.PM_ROOM_FROM ?? null,
          PM_ROOM_INSTANCE: opts.env.PM_ROOM_INSTANCE ?? null,
          PM_ROOM_SEND_SCRIPT: opts.env.PM_ROOM_SEND_SCRIPT ?? null,
        },
      });
      procs.set(pid, { found: true, name: 'node.exe', exe, created: iso() });
      pipes.set(pid, { instance: opts.env.STARQ_LC_INSTANCE, name });
      listeners.push({ port: Number(opts.env.STARQ_LC_PORT), pid });
      return { pid, containment: name === 'herdrBroker' ? { kind: 'TEST_JOB' } : null, unref() {} };
    },
    proveInstance: async (child) => {
      const p = pipes.get(child.pid);
      return p && p.instance === child.instance_id && p.name === child.name ? { ok: true, detail: 'proven' } : { ok: false, detail: 'pipe mismatch' };
    },
    requestShutdown: async (child) => {
      calls.shutdown.push(child.name);
      if ((behaviour[child.name] ?? 'exit') === 'exit') kill(child.pid);
      return { ok: true, detail: 'ack' };
    },
    gracefulStopContained: async (child, graceMs) => {
      calls.gracefulStopContained.push({ name: child.name, graceMs, forced: false });
      if ((behaviour[child.name] ?? 'exit') === 'exit') kill(child.pid);
      const closed = !procs.has(child.pid);
      return { owned: true, closed, active: closed ? 0 : 1, outcome: closed ? 'GONE' : 'STILL_RUNNING', forced: false };
    },
    historicalCloseoutHandoff: async (evidence) => {
      calls.historicalCloseoutHandoff.push(evidence);
      return historicalCloseoutHandoff ?? { applied: false, reason: 'no authorized exception fixture' };
    },
    checkHealth: async (host, c) => health[c.name] ?? { ok: true, detail: 'ok' },
    readFile: (f) => {
      if (f.endsWith('tok.txt')) { if (!brokerSim.token) throw new Error('ENOENT'); return brokerSim.token; }
      if (f in files) return files[f];
      return readFileSync(f, 'utf8');
    },
    brokerRequest: async (host, port, method, p, token) => {
      calls.broker.push(`${method} ${p}`);
      if (token !== brokerSim.token) return { status: 401, body: { code: 'LIFECYCLE_TOKEN_INVALID' } };
      const view = () => ({
        admission: brokerSim.admission,
        running: brokerSim.running,
        open_terminals: brokerSim.openTerminals,
        pending_launches: brokerSim.pendingLaunches,
        unresolved_launches: brokerSim.unresolvedLaunches,
        orphaned_sessions: brokerSim.orphanedSessions,
        historical_closeout_unverified: brokerSim.historicalUnverified,
        drained: brokerSim.running.length === 0 && brokerSim.openTerminals === 0 && brokerSim.pendingLaunches === 0
          && brokerSim.unresolvedLaunches === 0 && brokerSim.orphanedSessions === 0 && brokerSim.historicalUnverified === 0,
      });
      if (p === '/api/lifecycle') return { status: 200, body: view() };
      if (p === '/api/lifecycle/drain') { brokerSim.admission = 'DRAINING'; return { status: 200, body: view() }; }
      if (p === '/api/agents') return { status: 200, body: { registry_records: brokerSim.registryRecords } };
      if (p === '/api/lifecycle/stop-agents' || p === '/api/lifecycle/force-stop-agents') {
        if (brokerSim.stopAgents === 'ok') brokerSim.running = [];
        return { status: 200, body: { complete: brokerSim.running.length === 0, after: view() } };
      }
      if (p === '/api/lifecycle/shutdown') {
        if (brokerSim.admission !== 'DRAINING' || !view().drained) return { status: 409, body: { code: 'NOT_DRAINED' } };
        calls.shutdown.push('herdrBroker');
        const b = [...pipes].find(([, v]) => v.name === 'herdrBroker');
        if (b && (behaviour.herdrBroker ?? 'exit') === 'exit') kill(b[0]);
        return { status: 202, body: view() };
      }
      return { status: 404, body: null };
    },
    forceKill: async (pid) => { calls.forceKill.push(pid); kill(pid); return { ok: true, detail: 'killed' }; },
  };
  const owner = createOwner({ configFile, runtimeDir, env, configOptions: { checkFiles: false }, deps });
  return {
    dir, configFile, runtimeDir, owner, procs, pipes, listeners, behaviour, health, calls, brokerSim, files, SELF, deps,
    statePath: path.join(runtimeDir, 'state.json'),
    set inspectFails(v) { inspectFails = v; }, set listenersFail(v) { listenersFail = v; },
    iso, kill,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ── Start: dependency order, persistence, readiness ─────────────────────────
test('RECOVERY refuses missing broker channel before any forced signal', async () => {
  const w = world();
  try {
    assert.equal((await w.owner.start()).result, RESULT.READY);
    w.brokerSim.token = null;
    assert.equal((await w.owner.recoverForce()).result, RESULT.STOP_INCOMPLETE);
    assert.deepEqual(w.calls.forceKill, []);
  } finally { w.cleanup(); }
});

test('RECOVERY refuses tree force without descendant ownership proof', async () => {
  const w = world();
  try {
    assert.equal((await w.owner.start()).result, RESULT.READY);
    const owner = createOwner({ configFile: w.configFile, runtimeDir: w.runtimeDir, configOptions: { checkFiles: false }, deps: { ...w.deps, treeSignalSafe: async () => false } });
    assert.equal((await owner.recoverForce()).phase, 'descendant-ownership');
    assert.deepEqual(w.calls.forceKill, []);
  } finally { w.cleanup(); }
});

test('historical EXITED owner records without tree proof block start, stop and recovery', async () => {
  const w = world();
  try {
    assert.equal((await w.owner.start()).result, RESULT.READY);
    assert.equal((await w.owner.stop()).result, RESULT.STOPPED);
    const state = readState(w.statePath).state;
    delete state.children[0].tree_closeout_verified;
    writeState(w.statePath, state);
    assert.equal((await w.owner.start()).code, 'NOT_STOPPED');
    assert.equal((await w.owner.stop()).phase, 'historical-closeout');
    assert.equal((await w.owner.recoverForce()).phase, 'historical-closeout');
    assert.deepEqual(w.calls.forceKill, []);
    assert.equal((await w.owner.status()).components[0].ownership, 'EXITED_UNVERIFIED');
  } finally { w.cleanup(); }
});

test('START direct owner refuses unresolved prerequisites without spawning', async () => {
  const w = world();
  try {
    const owner = createOwner({ configFile: w.configFile, runtimeDir: w.runtimeDir, configOptions: { checkFiles: false }, deps: { ...w.deps, prerequisites: async () => [{ resolved: false }] } });
    assert.equal((await owner.start()).code, 'PREREQUISITES');
    assert.deepEqual(w.calls.spawn, []);
  } finally { w.cleanup(); }
});

test('STOP root absence with unresolved descendants is incomplete', async () => {
  const w = world();
  try {
    assert.equal((await w.owner.start()).result, RESULT.READY);
    const owner = createOwner({ configFile: w.configFile, runtimeDir: w.runtimeDir, configOptions: { checkFiles: false }, deps: { ...w.deps, treeClosed: async () => false } });
    assert.equal((await owner.stop()).result, RESULT.STOP_INCOMPLETE);
  } finally { w.cleanup(); }
});

test('START: dependency-readiness order, every launch persisted as it occurs', async () => {
  const w = world();
  try {
    const r = await w.owner.start();
    assert.equal(r.result, RESULT.READY);
    assert.deepEqual(w.calls.spawn.map((s) => s.name), ['data', 'building', 'herdrBroker', 'herdr', 'pm', 'ui']);
    // When herdr is spawned, its dependency herdrBroker is already persisted READY.
    assert.deepEqual(w.calls.spawn[3].priorChildren, ['data:READY', 'building:READY', 'herdrBroker:READY']);
    const pmSpawn = w.calls.spawn.find((s) => s.name === 'pm');
    assert.equal(pmSpawn.env.PM_PORT, '5176');
    assert.equal(pmSpawn.env.PM_ROOM_POST, 'off');
    assert.equal(pmSpawn.env.PM_DB_PATH, null);
    assert.equal(pmSpawn.env.PM_ROOM_LEDGER, null);
    assert.equal(pmSpawn.env.PM_ROOM_FROM, null);
    const dataSpawn = w.calls.spawn.find((s) => s.name === 'data');
    assert.equal(dataSpawn.env.PM_PORT, null);
    const s = await w.owner.status();
    assert.ok(s.components.some((c) => c.name === 'pm' && c.port === 5176));
    assert.ok(w.calls.spawn.every((s) => s.exe === NODE));
    const st = readState(w.statePath);
    assert.equal(st.kind, 'OK');
    assert.equal(st.state.state, 'READY');
    assert.ok(st.state.children.every((c) => c.status === 'READY' && c.created_at && c.exe === NODE && c.instance_id));
  } finally { w.cleanup(); }
});

test('FAILED STARTUP ROLLBACK: unwinds only this attempt, newest first, gracefully', async () => {
  const w = world();
  try {
    // A foreign process that is not ours must be untouched.
    w.procs.set(4242, { found: true, name: 'node.exe', exe: NODE, created: w.iso() });
    w.health.herdr = { ok: false, detail: 'HTTP 404, expected 200' };
    const r = await w.owner.start();
    assert.equal(r.result, RESULT.START_FAILED);
    assert.equal(r.failure.component, 'herdr');
    assert.ok(!w.calls.spawn.some((s) => s.name === 'ui'), 'components after the failure are never created');
    assert.deepEqual(w.calls.shutdown, ['herdr', 'herdrBroker', 'building', 'data']);
    assert.deepEqual(w.calls.forceKill, [], 'rollback never forces');
    assert.ok(w.procs.has(4242), 'foreign process untouched');
    const st = readState(w.statePath).state;
    assert.equal(st.state, 'START_FAILED');
    assert.ok(st.children.every((c) => c.status === 'EXITED'));
  } finally { w.cleanup(); }
});

test('FAILED STARTUP ROLLBACK: a component that will not exit leaves ROLLBACK_INCOMPLETE, not a forced kill', async () => {
  const w = world();
  try {
    w.health.ui = { ok: false, detail: 'body lacks root' };
    w.behaviour.building = 'stubborn';
    const r = await w.owner.start();
    assert.equal(r.result, RESULT.ROLLBACK_INCOMPLETE);
    assert.deepEqual(w.calls.forceKill, []);
    assert.equal(readState(w.statePath).state.state, 'ROLLBACK_INCOMPLETE');
    // A new start is refused until this is settled.
    const again = await w.owner.start();
    assert.equal(again.result, RESULT.REFUSED);
    assert.equal(again.code, 'NOT_STOPPED');
  } finally { w.cleanup(); }
});

test('HTTP 404 / non-health responses never satisfy a health contract', () => {
  const json = { path: '/api/health', status: 200, content_type: 'application/json', json_has: ['assembled_at'] };
  assert.equal(evaluateHealth(json, { status: 404, contentType: 'application/json', body: '{"error":"not found"}' }).ok, false);
  assert.equal(evaluateHealth(json, { status: 200, contentType: 'text/html', body: '<html>' }).ok, false);
  assert.equal(evaluateHealth(json, { status: 200, contentType: 'application/json', body: '{"error":"x"}' }).ok, false);
  assert.equal(evaluateHealth(json, { status: 200, contentType: 'application/json; charset=utf-8', body: '{"assembled_at":"t"}' }).ok, true);
  const eq = { path: '/api/health', status: 200, json_equals: { ok: true, 'broker.ok': true } };
  assert.equal(evaluateHealth(eq, { status: 200, contentType: '', body: '{"ok":true,"broker":{"ok":false}}' }).ok, false);
  const html = { path: '/', status: 200, content_type: 'text/html', body_includes: ['<title>STARQ // COMMAND</title>'] };
  assert.equal(evaluateHealth(html, { status: 200, contentType: 'text/html', body: '<title>Vite</title>' }).ok, false);
});

// ── Fail-closed preconditions ───────────────────────────────────────────────

test('PORT OVERRIDE MISMATCH: any runtime override is refused before anything spawns', async () => {
  for (const env of [{ COMMAND_PORT: '5199' }, { HERDR_FLOOR_URL: 'http://127.0.0.1:6000' }, { COMMAND_UI_PORT: '5173' }, { STARQ_WORKSPACE: 'D:\\elsewhere' }, { COMMS_ROOM_PATH: 'D:\\scratch\\room.fixture' }, { PM_ROOM_LEDGER: 'D:\\scratch\\room.fixture' }, { PM_PORT: '5191' }, { PM_DB_PATH: 'D:\\scratch\\pm.db' }, { PM_ROOM_POST: 'on' }, { PM_ROOM_FROM: 'cursor' }, { PM_ROOM_INSTANCE: 'x' }, { PM_ROOM_SEND_SCRIPT: 'D:\\scratch\\send.mjs' }]) {
    const w = world({ env });
    try {
      const r = await w.owner.start();
      assert.equal(r.result, RESULT.REFUSED, JSON.stringify(env));
      assert.equal(r.code, 'PORT_OVERRIDE_REJECTED');
      assert.equal(w.calls.spawn.length, 0);
    } finally { w.cleanup(); }
  }
  assert.deepEqual(findEnvOverrides({}), []);
});

test('INCOMPLETE COMPONENT REGISTRY: config missing a component is invalid; start refuses', async () => {
  const w = world({ mutateConfig: (c) => { c.components = c.components.filter((x) => x.name !== 'herdr'); c.components.find((x) => x.name === 'ui').depends_on = ['data']; } });
  try {
    const r = await w.owner.start();
    assert.equal(r.result, RESULT.REFUSED);
    assert.equal(r.code, 'CONFIG_INVALID');
    assert.match(r.reason, /'herdr' is missing/);
    assert.equal(w.calls.spawn.length, 0);
  } finally { w.cleanup(); }
  const doc = baseConfig('D:\\x');
  doc.components[1].port = 5177;
  assert.ok(validateConfig(doc, { checkFiles: false }).some((p) => /unique/.test(p)));
  const cyc = baseConfig('D:\\x');
  cyc.components[0].depends_on = ['ui'];
  assert.ok(validateConfig(cyc, { checkFiles: false }).some((p) => /cycle/.test(p)));
  const ui = baseConfig('D:\\x');
  ui.components.find((c) => c.name === 'ui').port = 5999;
  assert.ok(validateConfig(ui, { checkFiles: false }).some((p) => /ui port must be 5173/.test(p)));
});

test('INCOMPLETE COMPONENT REGISTRY: a READY state missing a component is never RUNNING', async () => {
  const w = world();
  try {
    await w.owner.start();
    const st = readState(w.statePath).state;
    st.children = st.children.filter((c) => c.name !== 'building');
    writeState(w.statePath, st);
    const s = await w.owner.status();
    assert.notEqual(s.overall, 'RUNNING');
    assert.ok(s.problems.some((p) => /missing components: building/.test(p)));
  } finally { w.cleanup(); }
});

test('CORRUPT / BOM STATE: distinguished from absent, and blocks start and stop', async () => {
  const w = world();
  try {
    assert.equal(readState(w.statePath).kind, 'ABSENT');
    mkdirSync(w.runtimeDir, { recursive: true });
    const good = { schema: 'starq.command.lifecycle.state/v2', version: 2, state: 'STOPPED', attempt_id: 'a', config_sha256: 'x', children: [] };
    writeFileSync(w.statePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(good))]));
    const bom = readState(w.statePath);
    assert.equal(bom.kind, 'CORRUPT');
    assert.match(bom.reason, /BOM/);
    assert.equal((await w.owner.start()).code, 'STATE_CORRUPT');
    assert.equal((await w.owner.stop()).code, 'STATE_CORRUPT');
    writeFileSync(w.statePath, '{"schema": "starq.command.lifecycle.state/v2", "state": ');
    assert.equal(readState(w.statePath).kind, 'CORRUPT');
    writeFileSync(w.statePath, JSON.stringify({ ...good, state: 'WHATEVER' }));
    assert.equal(readState(w.statePath).kind, 'CORRUPT');
    assert.equal((await w.owner.status()).overall, 'UNKNOWN');
    assert.equal(w.calls.spawn.length, 0);
    // The owner's own writer is BOM-free.
    writeState(w.statePath, good);
    const raw = readFileSync(w.statePath);
    assert.notDeepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  } finally { w.cleanup(); }
});

test('legacy v1 state is honoured only as STOPPED; a running v1 record is CORRUPT', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'starq-v1-'));
  try {
    const f = path.join(dir, 'state.json');
    writeFileSync(f, JSON.stringify({ version: 1, state: 'STOPPED', children: [{ name: 'data', pid: 1 }] }));
    assert.equal(readState(f).kind, 'LEGACY_STOPPED');
    writeFileSync(f, JSON.stringify({ version: 1, state: 'READY', children: [{ name: 'data', pid: 1 }] }));
    assert.equal(readState(f).kind, 'CORRUPT');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('foreign listener on a configured port refuses start; listener inspection failure refuses start', async () => {
  const w = world();
  try {
    w.listeners.push({ port: 5177, pid: 31337 });
    const r = await w.owner.start();
    assert.equal(r.code, 'PORT_CONFLICT');
    w.listeners.length = 0;
    w.listenersFail = true;
    assert.equal((await w.owner.start()).code, 'INSPECTION_FAILED');
    assert.equal(w.calls.spawn.length, 0);
  } finally { w.cleanup(); }
});

test('an AUTO agent row in the broker manifest refuses start', async () => {
  const w = world();
  try {
    w.files[path.join(w.dir, 'manifest.json')] = JSON.stringify({ workspace_root: w.dir, agents: [{ id: 'z', startup_policy: 'AUTO' }] });
    const r = await w.owner.start();
    assert.equal(r.code, 'AUTO_AGENT');
    assert.equal(w.calls.spawn.length, 0);
  } finally { w.cleanup(); }
});

// ── Ownership: PID reuse, inaccessible inspection ───────────────────────────

test('PID REUSE WITH MATCHING PROCESS NAME AND EXECUTABLE: classified FOREIGN, never signalled', async () => {
  const w = world();
  try {
    await w.owner.start();
    const st = readState(w.statePath).state;
    const data = st.children.find((c) => c.name === 'data');
    // The original data process exits; the OS hands the same pid to another node.exe from the SAME runtime.
    w.kill(data.pid);
    w.procs.set(data.pid, { found: true, name: 'node.exe', exe: NODE, created: w.iso() });
    assert.equal(osVerdict(data, { pid: data.pid, ...w.procs.get(data.pid) }, NODE).verdict, 'FOREIGN');
    const s = await w.owner.status();
    assert.equal(s.components.find((c) => c.name === 'data').ownership, 'FOREIGN');
    assert.notEqual(s.overall, 'RUNNING');
    const r = await w.owner.stop();
    assert.equal(r.result, RESULT.STOPPED);
    assert.ok(!w.calls.shutdown.includes('data'), 'the reused pid received no shutdown');
    assert.deepEqual(w.calls.forceKill, []);
    assert.ok(w.procs.has(data.pid), 'the unrelated process is still alive');
  } finally { w.cleanup(); }
});

test('same executable + creation time but the instance proof fails: UNPROVEN, stop refuses, nothing signalled', async () => {
  const w = world();
  try {
    await w.owner.start();
    const ui = readState(w.statePath).state.children.find((c) => c.name === 'ui');
    w.pipes.set(ui.pid, { instance: '0'.repeat(32), name: 'ui' });
    const r = await w.owner.stop();
    assert.equal(r.code, 'OWNERSHIP_UNPROVEN');
    assert.deepEqual(w.calls.shutdown, []);
    assert.equal(w.brokerSim.admission, 'OPEN', 'refusal had no side effect');
  } finally { w.cleanup(); }
});

test('INACCESSIBLE PROCESS INSPECTION: stop refuses, status is UNKNOWN, nothing is signalled', async () => {
  const w = world();
  try {
    await w.owner.start();
    w.inspectFails = true;
    const s = await w.owner.status();
    assert.equal(s.overall, 'UNKNOWN');
    assert.equal(s.inspection.complete, false);
    const r = await w.owner.stop();
    assert.equal(r.result, RESULT.REFUSED);
    assert.deepEqual(w.calls.shutdown, []);
    assert.deepEqual(w.calls.forceKill, []);
    // A present-but-unreadable process (exe/creation unreadable) is also UNKNOWN, not gone.
    w.inspectFails = false;
    const data = readState(w.statePath).state.children.find((c) => c.name === 'data');
    w.procs.set(data.pid, { found: true, name: 'node.exe', exe: null, created: null });
    assert.equal((await w.owner.stop()).code, 'OWNERSHIP_UNPROVEN');
    assert.equal((await w.owner.recoverForce()).result, RESULT.STOP_INCOMPLETE);
    assert.ok(!w.calls.forceKill.includes(data.pid), 'force recovery never signals an unprovable pid');
  } finally { w.cleanup(); }
});

// ── Stop: drain first, graceful only ────────────────────────────────────────

test('STOP with live agents and no --stop-agents is refused with no side effect', async () => {
  const w = world();
  try {
    await w.owner.start();
    w.brokerSim.running = [{ agent_id: 'goose', session_id: 's', pid: 77 }];
    const r = await w.owner.stop();
    assert.equal(r.code, 'LIVE_AGENTS');
    assert.equal(w.brokerSim.admission, 'OPEN', 'not drained on refusal');
    assert.deepEqual(w.calls.shutdown, []);
  } finally { w.cleanup(); }
});

test('STOP sequence: drain -> agents -> verify drained -> ui, herdr, herdrBroker, building, data', async () => {
  const w = world();
  try {
    await w.owner.start();
    w.brokerSim.running = [{ agent_id: 'goose', session_id: 's', pid: 77 }];
    const r = await w.owner.stop({ stopAgents: true });
    assert.equal(r.result, RESULT.STOPPED);
    const b = w.calls.broker;
    assert.ok(b.indexOf('POST /api/lifecycle/drain') < b.indexOf('POST /api/lifecycle/stop-agents'));
    assert.ok(b.indexOf('POST /api/lifecycle/stop-agents') < b.lastIndexOf('POST /api/lifecycle/shutdown'));
    assert.deepEqual(w.calls.shutdown, ['ui', 'pm', 'herdr', 'herdrBroker', 'building', 'data']);
    assert.deepEqual(w.calls.forceKill, []);
    assert.equal(readState(w.statePath).state.state, 'STOPPED');
    assert.equal(r.verification.ports_free, true);
  } finally { w.cleanup(); }
});

test('STOP: exact quiescent #15821 exception uses only the non-forced contained broker handoff', async () => {
  const handoff = {
    applied: true,
    reason: 'exact six UNKNOWN historical rows',
    decision: { roomSequence: 15821, eventId: 'founder-event', recordHash: 'founder-record' },
    session_ids: ['legacy-1', 'legacy-2', 'legacy-3', 'legacy-4', 'legacy-5', 'legacy-6'],
    historical_closeout: 'UNKNOWN',
    broker_boot_id: 'old-broker-boot',
  };
  const w = world({ historicalCloseoutHandoff: handoff });
  try {
    await w.owner.start();
    w.brokerSim.historicalUnverified = 6;
    const r = await w.owner.stop();
    assert.equal(r.result, RESULT.STOPPED);
    assert.equal(w.calls.historicalCloseoutHandoff.length, 2, 'validate at drain and immediately before the broker signal');
    assert.deepEqual(w.calls.gracefulStopContained, [{ name: 'herdrBroker', graceMs: 40, forced: false }]);
    assert.deepEqual(w.calls.forceKill, []);
    assert.deepEqual(w.calls.shutdown, ['ui', 'herdr', 'pm', 'building', 'data'], 'dependent services stop first; independent services wait until broker closeout');
    const state = readState(w.statePath).state;
    assert.ok(state.events.some((e) => e.event === 'stop.historical_closeout_exception_verified'));
    assert.ok(state.events.some((e) => e.event === 'child.historical_closeout_exception_graceful_handoff'));
    const handoffEvent = state.events.find((e) => e.event === 'child.historical_closeout_exception_graceful_handoff');
    assert.equal(handoffEvent.historical_closeout, 'UNKNOWN');
    assert.equal(handoffEvent.forced, false);
    assert.equal(handoffEvent.command_child_job_closed, true);
  } finally { w.cleanup(); }
});

test('STOP: exception handoff refuses when any other broker blocker remains, before stopping Command services', async () => {
  const w = world({ historicalCloseoutHandoff: { applied: false, reason: 'pending launch remains' } });
  try {
    await w.owner.start();
    w.brokerSim.historicalUnverified = 6;
    w.brokerSim.pendingLaunches = 1;
    const r = await w.owner.stop();
    assert.equal(r.result, RESULT.STOP_INCOMPLETE);
    assert.equal(r.phase, 'drain-verify');
    assert.deepEqual(w.calls.shutdown, [], 'no Command service is stopped');
    assert.deepEqual(w.calls.gracefulStopContained, []);
    assert.deepEqual(w.calls.forceKill, []);
  } finally { w.cleanup(); }
});

test('STOP: failed non-forced broker handoff does not escalate or stop independent services', async () => {
  const w = world({ historicalCloseoutHandoff: { applied: true, decision: { roomSequence: 15821 }, session_ids: ['six'], broker_boot_id: 'old' } });
  try {
    await w.owner.start();
    w.brokerSim.historicalUnverified = 6;
    w.behaviour.herdrBroker = 'stubborn';
    const r = await w.owner.stop();
    assert.equal(r.result, RESULT.STOP_INCOMPLETE);
    assert.equal(r.phase, 'control-plane');
    assert.deepEqual(w.calls.shutdown, ['ui', 'herdr']);
    assert.deepEqual(w.calls.gracefulStopContained.map((call) => [call.name, call.forced]), [['herdrBroker', false]]);
    assert.deepEqual(w.calls.forceKill, []);
    assert.ok(w.procs.size > 0, 'broker and independent Command services remain owned');
  } finally { w.cleanup(); }
});

test('STOP: agents that do not exit gracefully halt shutdown; the broker stays up and DRAINING', async () => {
  const w = world();
  try {
    await w.owner.start();
    w.brokerSim.running = [{ agent_id: 'elder', session_id: 's', pid: 78 }];
    w.brokerSim.stopAgents = 'incomplete';
    const r = await w.owner.stop({ stopAgents: true });
    assert.equal(r.result, RESULT.STOP_INCOMPLETE);
    assert.equal(r.phase, 'agents');
    assert.deepEqual(w.calls.shutdown, [], 'no control-plane component was stopped');
    assert.equal(w.brokerSim.admission, 'DRAINING');
  } finally { w.cleanup(); }
});

test('STOP: a component that ignores shutdown halts the sequence as STOP_INCOMPLETE (no force)', async () => {
  const w = world();
  try {
    await w.owner.start();
    w.behaviour.herdr = 'stubborn';
    const r = await w.owner.stop();
    assert.equal(r.result, RESULT.STOP_INCOMPLETE);
    assert.deepEqual(w.calls.shutdown, ['ui', 'pm', 'herdr']);
    assert.deepEqual(w.calls.forceKill, []);
    // Explicit recovery forces only what it can re-prove.
    const rec = await w.owner.recoverForce();
    assert.equal(rec.result, RESULT.STOPPED);
    const herdrPid = readState(w.statePath).state.children.find((c) => c.name === 'herdr').pid;
    assert.ok(w.calls.forceKill.includes(herdrPid));
  } finally { w.cleanup(); }
});

test('STOP refuses when the broker is live but its lifecycle channel is unavailable', async () => {
  const w = world();
  try {
    await w.owner.start();
    w.brokerSim.token = null;
    const r = await w.owner.stop({ stopAgents: true });
    assert.equal(r.code, 'BROKER_UNAVAILABLE');
    assert.deepEqual(w.calls.shutdown, []);
  } finally { w.cleanup(); }
});

// ── Status truthfulness ─────────────────────────────────────────────────────

test('STATUS: RUNNING only with full ownership, contract health, owned listeners and an open broker', async () => {
  const w = world();
  try {
    await w.owner.start();
    assert.equal((await w.owner.status()).overall, 'RUNNING');
    w.health.building = { ok: false, detail: 'HTTP 404, expected 200' };
    let s = await w.owner.status();
    assert.equal(s.overall, 'DEGRADED');
    assert.ok(s.problems.some((p) => /building unhealthy/.test(p)));
    delete w.health.building;
    w.listeners.push({ port: 5178, pid: 55555 });
    s = await w.owner.status();
    assert.equal(s.overall, 'DEGRADED');
    assert.ok(s.problems.some((p) => /non-owned/.test(p)));
    w.listeners.pop();
    w.brokerSim.admission = 'DRAINING';
    assert.equal((await w.owner.status()).overall, 'DEGRADED');
  } finally { w.cleanup(); }
});

test('STATUS: stopped with a foreign listener on a control-plane port is CONFLICT, not STOPPED', async () => {
  const w = world();
  try {
    const stopped = await w.owner.status();
    assert.equal(stopped.overall, 'STOPPED');
    assert.equal(stopped.health_preflight.overall, 'STOPPED');
    assert.equal(stopped.health_preflight.idle_cooldown, true);
    assert.ok(stopped.health_preflight.ports.every((p) => p.state === 'STOPPED'));
    w.listeners.push({ port: 5173, pid: 4444 });
    const conflict = await w.owner.status();
    assert.equal(conflict.overall, 'CONFLICT');
    assert.equal(conflict.health_preflight.overall, 'DEGRADED');
    assert.equal(conflict.health_preflight.idle_cooldown, false);
    assert.equal(conflict.health_preflight.ports.find((p) => p.name === 'ui').state, 'DEGRADED');
  } finally { w.cleanup(); }
});

test('STATUS: live listener PIDs are classified; declared infrastructure still blocks Command ports', async () => {
  const w = world();
  try {
    const script = path.join(w.dir, 'agent-comms', 'scripts', 'room-watch-codex.mjs');
    w.procs.set(4444, {
      found: true, name: 'node.exe', exe: NODE, created: w.iso(),
      cmd: `"${NODE}" "${script}" `,
    });
    w.listeners.push({ port: 5173, pid: 4444 });
    const s = await w.owner.status();
    assert.equal(s.overall, 'CONFLICT');
    const ui = s.components.find((c) => c.name === 'ui');
    assert.equal(ui.listener.classifications[0].id, 'room-watcher');
    assert.ok(s.problems.some((p) => /non-owned/.test(p)));
  } finally { w.cleanup(); }
});

// ── Lock: direct owner mutation is serialised ───────────────────────────────

test('DIRECT OWNER MUTATION DURING LOCK: start/stop/recover by another invocation are refused', async () => {
  const w = world();
  try {
    mkdirSync(w.runtimeDir, { recursive: true });
    // A live holder (e.g. Stop-Starq mid-drain) — pid 999 is alive with this creation time.
    const holder = { nonce: 'n', pid: w.SELF, created: w.procs.get(w.SELF).created, op: 'stop', at: 'now' };
    writeFileSync(path.join(w.runtimeDir, 'lifecycle.lock'), JSON.stringify(holder));
    for (const op of [() => w.owner.start(), () => w.owner.stop(), () => w.owner.recoverForce()]) {
      const r = await op();
      assert.equal(r.result, RESULT.REFUSED);
      assert.equal(r.code, 'LOCKED');
    }
    assert.equal(w.calls.spawn.length, 0);
    // An uninspectable holder is respected, not reclaimed.
    w.inspectFails = true;
    assert.equal((await w.owner.start()).code, 'LOCKED');
    w.inspectFails = false;
    // A holder proven gone (pid reused by another process) is reclaimed, with the stale lock kept as evidence.
    writeFileSync(path.join(w.runtimeDir, 'lifecycle.lock'), JSON.stringify({ ...holder, created: '2001-01-01T00:00:00.0000000Z' }));
    assert.equal((await w.owner.start()).result, RESULT.READY);
    assert.equal(existsSync(path.join(w.runtimeDir, 'lifecycle.lock')), false, 'lock released after the operation');
  } finally { w.cleanup(); }
});

test('config loader refuses a BOM-prefixed config', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'starq-cfg-'));
  try {
    const f = path.join(dir, 'c.json');
    writeFileSync(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(baseConfig(dir)))]));
    assert.throws(() => loadConfig(f, { checkFiles: false }), (e) => e instanceof ConfigError && /BOM/.test(e.message));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durable pending reservation blocks start, graceful stop and forced recovery without signals', async () => {
  const w = world(); try {
    assert.equal((await w.owner.start()).result, RESULT.READY);
    const doc = readState(w.statePath).state; doc.pending_launches = [{ name: 'mock', containment: { kind: 'MOCK_ONLY' } }]; writeState(w.statePath, doc);
    assert.equal((await w.owner.stop()).phase, 'pending-launch'); assert.equal((await w.owner.recoverForce()).phase, 'pending-launch'); assert.equal((await w.owner.start()).code, 'NOT_STOPPED');
    assert.deepEqual(w.calls.shutdown, []); assert.deepEqual(w.calls.forceKill, []);
  } finally { w.cleanup(); }
});


// ── Standalone Herdr: observed, never owned ─────────────────────────────────
const STANDALONE = {
  id: 'standalone-herdr', owner_protocol: 'OPERATOR_INTERACTIVE', command_actuation: 'NONE',
  executable: 'D:\\fake\\herdr.exe', storage_root: 'D:\\fake\\herdr-data', owner_record: 'state\\standalone-herdr-owner.json',
};
const withStandalone = (c) => { c.profile = { required_files: [], external_required: [STANDALONE] }; };

test('STATUS: an uncommissioned standalone Herdr owner protocol never executes the binary and blocks profile readiness', async () => {
  const w = world({ mutateConfig: withStandalone });
  try {
    assert.equal((await w.owner.start()).result, RESULT.READY);
    const probed = [];
    const owner = createOwner({ configFile: w.configFile, runtimeDir: w.runtimeDir, configOptions: { checkFiles: false }, deps: { ...w.deps,
      standaloneHerdrGate: async () => ({ resolved: false, detail: 'G-PROFILE: no Founder owner record' }),
      probeStandaloneHerdr: async (e) => { probed.push(e); return { state: 'AVAILABLE' }; } } });
    const s = await owner.status();
    assert.equal(s.overall, 'RUNNING'); assert.equal(s.normal_profile.ready, false);
    assert.equal(s.normal_profile.standalone_herdr.observed.state, 'NOT_PROBED'); assert.deepEqual(probed, []);
  } finally { w.cleanup(); }
});

test('START: delayed listener row for the launched pid becomes READY', async () => {
  const w = world();
  try {
    let dataPid = null;
    let dataPortPolls = 0;
    const owner = createOwner({
      configFile: w.configFile, runtimeDir: w.runtimeDir, configOptions: { checkFiles: false },
      deps: {
        ...w.deps,
        pollMs: 0,
        spawnChild: async (exe, args, opts) => {
          const child = await w.deps.spawnChild(exe, args, opts);
          if (opts.env.STARQ_LC_NAME === 'data') dataPid = child.pid;
          return child;
        },
        listListeners: async () => {
          const rows = await w.deps.listListeners();
          if (dataPid == null) return rows;
          dataPortPolls += 1;
          if (dataPortPolls < 3) return rows.filter((r) => r.port !== PORTS.data);
          return rows;
        },
      },
    });
    const r = await owner.start();
    assert.equal(r.result, RESULT.READY);
    assert.ok(dataPortPolls >= 3);
    const st = readState(w.statePath).state;
    assert.equal(st.children.find((c) => c.name === 'data').status, 'READY');
  } finally { w.cleanup(); }
});

test('START: empty listener rows through the health deadline fail closed and roll back', async () => {
  const w = world();
  try {
    let dataPid = null;
    const owner = createOwner({
      configFile: w.configFile, runtimeDir: w.runtimeDir, configOptions: { checkFiles: false },
      deps: {
        ...w.deps,
        pollMs: 0,
        spawnChild: async (exe, args, opts) => {
          const child = await w.deps.spawnChild(exe, args, opts);
          if (opts.env.STARQ_LC_NAME === 'data') dataPid = child.pid;
          return child;
        },
        listListeners: async () => {
          const rows = await w.deps.listListeners();
          if (dataPid == null) return rows;
          return rows.filter((r) => r.port !== PORTS.data);
        },
      },
    });
    const r = await owner.start();
    assert.equal(r.result, RESULT.START_FAILED);
    assert.equal(r.failure.component, 'data');
    assert.match(r.failure.error, /port 5177 listener is not owned by pid \d+ \(none\)/);
    assert.deepEqual(w.calls.forceKill, []);
    const st = readState(w.statePath).state;
    assert.equal(st.state, 'START_FAILED');
    assert.ok(st.children.every((c) => c.status === 'EXITED'));
  } finally { w.cleanup(); }
});

test('START: a foreign PID on the configured port is a hard failure', async () => {
  const w = world();
  try {
    const owner = createOwner({
      configFile: w.configFile, runtimeDir: w.runtimeDir, configOptions: { checkFiles: false },
      deps: {
        ...w.deps,
        spawnChild: async (exe, args, opts) => {
          const child = await w.deps.spawnChild(exe, args, opts);
          if (opts.env.STARQ_LC_NAME === 'data') {
            for (const row of w.listeners) {
              if (row.port === PORTS.data && row.pid === child.pid) row.pid = 4242;
            }
          }
          return child;
        },
      },
    });
    const r = await owner.start();
    assert.equal(r.result, RESULT.START_FAILED);
    assert.equal(r.failure.component, 'data');
    assert.match(r.failure.error, /port 5177 listener is not owned by pid \d+ \(\?:5177<-pid 4242\)/);
    assert.deepEqual(w.calls.forceKill, []);
    const st = readState(w.statePath).state;
    assert.equal(st.state, 'START_FAILED');
  } finally { w.cleanup(); }
});

test('STATUS: profile readiness needs RUNNING, a commissioned owner protocol AND standalone Herdr observed AVAILABLE via the pinned binary', async () => {
  const w = world({ mutateConfig: withStandalone });
  try {
    assert.equal((await w.owner.start()).result, RESULT.READY);
    for (const [state, ready] of [['AVAILABLE', true], ['UNAVAILABLE', false], ['ERROR', false]]) {
      const probed = [];
      const owner = createOwner({ configFile: w.configFile, runtimeDir: w.runtimeDir, configOptions: { checkFiles: false }, deps: { ...w.deps,
        standaloneHerdrGate: async () => ({ resolved: true, detail: 'mock commissioned' }),
        probeStandaloneHerdr: async (e) => { probed.push(e.executable); return { state, detail: 'mock' }; } } });
      const s = await owner.status();
      assert.equal(s.normal_profile.ready, ready, state); assert.deepEqual(probed, [STANDALONE.executable]);
    }
    // A stopped control plane is never profile-ready, whatever Herdr reports.
    assert.equal((await w.owner.stop()).result, RESULT.STOPPED);
    const owner = createOwner({ configFile: w.configFile, runtimeDir: w.runtimeDir, configOptions: { checkFiles: false }, deps: { ...w.deps,
      standaloneHerdrGate: async () => ({ resolved: true }), probeStandaloneHerdr: async () => ({ state: 'AVAILABLE' }) } });
    assert.equal((await owner.status()).normal_profile.ready, false);
  } finally { w.cleanup(); }
});
