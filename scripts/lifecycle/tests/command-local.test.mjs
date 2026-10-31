/**
 * Offline tests for the command-local/v1 daily-driver profile (CV-C1c).
 *
 * The guarantees proven here, with no real process spawned (every OS seam is a
 * simulated world): required services {data, pm, ui} fail closed; optional
 * services never block local readiness; the lean prerequisites need no WSL,
 * Room broker or standalone-Herdr; and the config validator accepts a correct
 * local profile while rejecting the unsafe shapes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createOwner, RESULT } from '../owner.mjs';
import { validateConfig, COMMAND_LOCAL_PROFILE } from '../config.mjs';
import { readCommandLocalGates, evaluateCommandLocalWorkspace } from '../gates.mjs';

const NODE = 'D:\\fake\\runtime\\node.exe';
const PORTS = { data: 5177, building: 5178, pm: 5176, ui: 5173 };

/** A valid command-local config document (data, pm, ui required; building optional). */
function localConfig(root) {
  const c = (name, deps, extra = {}) => ({
    name, kind: name === 'ui' ? 'vite' : 'module', entry: `x\\${name}.mjs`, cwd: 'x', port: PORTS[name], depends_on: deps,
    health: { path: '/h', status: 200, json_has: ['ok'] }, ...extra,
  });
  return {
    schema: 'starq.command.lifecycle.config/v1', workspace_root: root, node: NODE, host: '127.0.0.1',
    timeouts_ms: { identity: 40, health: 40, graceful_exit: 40, broker_request: 40, agent_stop: 40 },
    components: [
      c('data', []),
      c('building', []),
      c('pm', []),
      c('ui', ['data', 'pm'], { vite_config: 'vite.config.ts', health: { path: '/', status: 200, content_type: 'text/html', body_includes: ['root'] } }),
    ],
    profile: {
      name: COMMAND_LOCAL_PROFILE, tier: 'development',
      required_components: ['data', 'pm', 'ui'],
      optional_components: ['building', 'herdrBroker', 'herdr'],
      required_files: [],
    },
  };
}

/** A simulated single-machine world for the local profile (leaf processes, no broker). */
function world({ mutateConfig = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'starq-local-'));
  const doc = localConfig(dir);
  if (mutateConfig) mutateConfig(doc);
  const configFile = path.join(dir, 'lifecycle.command-local.config.json');
  writeFileSync(configFile, JSON.stringify(doc), 'utf8');
  const runtimeDir = path.join(dir, '.command-runtime-local');
  const procs = new Map();
  const pipes = new Map();
  const listeners = [];
  const health = {};
  let nextPid = 2000;
  let clock = Date.parse('2026-11-01T10:00:00Z');
  const iso = () => new Date(clock += 1).toISOString().replace('Z', '0000Z');
  const SELF = 1999;
  procs.set(SELF, { found: true, name: 'node.exe', exe: NODE, created: iso() });
  const kill = (pid) => {
    procs.delete(pid); pipes.delete(pid);
    for (let i = listeners.length - 1; i >= 0; i -= 1) if (listeners[i].pid === pid) listeners.splice(i, 1);
  };
  const deps = {
    treeClosed: async () => true,
    treeSignalSafe: async () => true,
    prerequisites: async () => [{ kind: 'G-WORKSPACE-LOCAL', resolved: true }, { kind: 'G-CONTAINMENT', resolved: true }],
    selfPid: SELF, pollMs: 0, sleep: () => new Promise((r) => setImmediate(r)),
    inspect: async (pids) => {
      const m = new Map();
      for (const pid of pids) m.set(pid, procs.has(pid) ? { pid, ...procs.get(pid) } : { pid, found: false });
      return m;
    },
    inspectInfrastructure: async () => [],
    listListeners: async () => listeners.map((l) => ({ ...l })),
    spawnChild: (exe, args, opts) => {
      const pid = ++nextPid;
      const name = opts.env.STARQ_LC_NAME;
      procs.set(pid, { found: true, name: 'node.exe', exe, created: iso() });
      pipes.set(pid, { instance: opts.env.STARQ_LC_INSTANCE, name });
      listeners.push({ port: Number(opts.env.STARQ_LC_PORT), pid });
      return { pid, containment: null, unref() {} };
    },
    proveInstance: async (child) => {
      const p = pipes.get(child.pid);
      return p && p.instance === child.instance_id && p.name === child.name ? { ok: true, detail: 'proven' } : { ok: false, detail: 'pipe mismatch' };
    },
    requestShutdown: async (child) => { kill(child.pid); return { ok: true, detail: 'ack' }; },
    checkHealth: async (host, c) => health[c.name] ?? { ok: true, detail: 'ok' },
    readFile: () => { throw new Error('ENOENT'); },
    forceKill: async (pid) => { kill(pid); return { ok: true, detail: 'killed' }; },
  };
  const owner = createOwner({ configFile, runtimeDir, env: {}, configOptions: { checkFiles: false }, deps });
  return { dir, owner, procs, listeners, health, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('local start reaches READY on the three required services', async () => {
  const w = world();
  try {
    const r = await w.owner.start();
    assert.equal(r.result, RESULT.READY);
    const ready = new Set(r.state.readiness.map((x) => x.name));
    for (const req of ['data', 'pm', 'ui']) assert.ok(ready.has(req), `${req} ready`);
    assert.ok(ready.has('building'), 'available optional building also started');
    const s = await w.owner.status();
    assert.equal(s.overall, 'RUNNING');
    assert.equal(s.local_profile.ready, true);
  } finally { w.cleanup(); }
});

test('an unavailable OPTIONAL service does not block local readiness', async () => {
  const w = world();
  w.health.building = { ok: false, detail: 'building down' }; // optional service never becomes healthy
  try {
    const r = await w.owner.start();
    assert.equal(r.result, RESULT.READY, 'required set still reaches READY');
    assert.ok((r.state.optional_skipped ?? []).some((o) => o.name === 'building'), 'building recorded as skipped');
    // The half-started optional child is not left running.
    assert.ok(!w.listeners.some((l) => l.port === PORTS.building), 'optional building listener cleaned up');
    const s = await w.owner.status();
    assert.equal(s.overall, 'RUNNING');
  } finally { w.cleanup(); }
});

test('a failed REQUIRED service fails the local start closed', async () => {
  const w = world();
  w.health.pm = { ok: false, detail: 'pm unhealthy' };
  try {
    const r = await w.owner.start();
    assert.equal(r.result, RESULT.START_FAILED);
    assert.equal(r.failure.component, 'pm');
    // Nothing is left READY after a clean unwind.
    const s = await w.owner.status();
    assert.notEqual(s.overall, 'RUNNING');
  } finally { w.cleanup(); }
});

test('local prerequisites are lean: workspace + containment only, no WSL/standalone-Herdr', () => {
  const cfg = { workspace_root: 'D:\\StarqTech', profile: { required_components: ['data', 'pm', 'ui'] }, components: [] };
  const gates = readCommandLocalGates('D:\\StarqTech', cfg, {
    exists: () => true,
    checkContainment: () => ({ resolved: true, detail: 'G-CONTAINMENT: ok' }),
  });
  const kinds = gates.map((g) => g.kind).sort();
  assert.deepEqual(kinds, ['G-CONTAINMENT', 'G-WORKSPACE-LOCAL']);
  assert.ok(gates.every((g) => g.resolved === true));
  assert.ok(!kinds.includes('G-WSL') && !kinds.includes('G-PROFILE'), 'no WSL or standalone-Herdr gate');
});

test('workspace gate fails closed when a canonical marker is missing', () => {
  const g = evaluateCommandLocalWorkspace('D:\\StarqTech', { components: [] }, { exists: (p) => !p.endsWith('STARQ.md') });
  assert.equal(g.resolved, false);
  assert.match(g.detail, /STARQ\.md/);
});

test('validateConfig accepts a correct local profile and rejects unsafe shapes', () => {
  const base = () => localConfig('D:\\StarqTech');
  assert.deepEqual(validateConfig(base(), { checkFiles: false }), []);

  // Missing a required service.
  const noPm = base(); noPm.components = noPm.components.filter((c) => c.name !== 'pm');
  assert.ok(validateConfig(noPm, { checkFiles: false }).some((p) => /component 'pm' is missing/.test(p)));

  // A component outside required+optional.
  const unknown = base(); unknown.components.push({ name: 'rogue', kind: 'module', entry: 'x\\r.mjs', cwd: 'x', port: 5999, depends_on: [], health: { path: '/h', status: 200, json_has: ['ok'] } });
  assert.ok(validateConfig(unknown, { checkFiles: false }).some((p) => /unknown component 'rogue'/.test(p)));

  // A required service must not depend on an optional one.
  const badDep = base(); badDep.components.find((c) => c.name === 'ui').depends_on = ['data', 'pm', 'building'];
  assert.ok(validateConfig(badDep, { checkFiles: false }).some((p) => /must not depend on optional 'building'/.test(p)));

  // optional_components outside the allowed set.
  const badOpt = base(); badOpt.profile.optional_components = ['building', 'nonsense'];
  assert.ok(validateConfig(badOpt, { checkFiles: false }).some((p) => /optional_components must be a subset/.test(p)));
});
