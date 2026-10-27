import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadConfig, validateConfig, componentEnv, findObservationEnvHazards, OBSERVATION_PROFILE } from '../config.mjs';
import { createOwner, RESULT } from '../owner.mjs';
import { evaluateObservationComposition, evaluateObservationOwnership, evaluateObservationRule0Gate, readObservationGates } from '../gates.mjs';
import { observationRuntimeSpecs } from '../../../../starq-lifecycle/runtime-policy.mjs';
import { inventoryPaths } from '../../../../herdr-floor/src/rule0.mjs';
import { readNamedGate } from '../gate-status.mjs';
import { server as dataServer, listenerHost } from '../../../server/data-service.mjs';
import { server as buildingServer } from '../../../server/building-service.mjs';
import { observationBoundary, observationBoundaryPlugin } from '../../../observation/http-boundary.mjs';
import { inspectProcesses, listListeners } from '../inspect.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROFILE_CONFIG = path.join(PACKAGE_ROOT, 'lifecycle.observation.config.json');
const OBS_ROOT = path.join(PACKAGE_ROOT, 'observation');

test('profile pins exactly data, Building, and UI; no Herdr or worker admission environment', () => {
  const cfg = loadConfig(PROFILE_CONFIG);
  assert.equal(cfg.profile.name, OBSERVATION_PROFILE);
  assert.deepEqual(cfg.components.map((c) => [c.name, c.port]), [['data', 5177], ['building', 5178], ['ui', 5173]]);
  assert.deepEqual(cfg.components.find((c) => c.name === 'ui').depends_on, ['data', 'building']);
  assert.equal(cfg.components.find((c) => c.name === 'ui').cwd, '00_STARQ_HQ\\operations\\starq-command\\observation');
  assert.equal(cfg.profile.observation_only, true);
  assert.equal(cfg.profile.worker_admission, false);
  assert.equal(cfg.profile.room_event_adapter, false);
  assert.equal(cfg.profile.process_control, false);
  assert.equal(cfg.profile.agent_launch, false);
  assert.deepEqual(componentEnv(cfg, 'data'), { COMMAND_PORT: '5177', COMMAND_HOST: '127.0.0.1', COMMAND_OBSERVATION_ONLY: '1' });
  assert.deepEqual(componentEnv(cfg, 'building'), { BUILDING_SERVICE_PORT: '5178', COMMAND_OBSERVATION_ONLY: '1' });
  assert.deepEqual(componentEnv(cfg, 'ui'), {
    COMMAND_DATA_SERVICE: 'http://127.0.0.1:5177',
    BUILDING_SERVICE: 'http://127.0.0.1:5178',
    COMMAND_OBSERVATION_ONLY: '1',
  });
  const full = loadConfig(path.join(PACKAGE_ROOT, 'lifecycle.config.json'), { checkFiles: false });
  assert.deepEqual(full.components.map((c) => c.name), ['data', 'building', 'herdrBroker', 'herdr', 'pm', 'ui']);
  assert.equal(componentEnv(full, 'ui').HERDR_SERVICE, 'http://127.0.0.1:5179');
  assert.equal(componentEnv(full, 'data').COMMAND_OBSERVATION_ONLY, undefined);
  assert.equal(listenerHost({ COMMAND_OBSERVATION_ONLY: '1', COMMAND_HOST: '0.0.0.0' }), '127.0.0.1');
  assert.equal(cfg.system_root, 'C:\\Windows');
  assert.deepEqual(cfg.profile.required_components, ['data', 'building', 'ui']);
  assert.ok(cfg.profile.required_files.includes('00_STARQ_HQ\\operations\\starq-command\\scripts\\lifecycle\\owner.mjs'));

  const injected = structuredClone(JSON.parse(readFileSync(PROFILE_CONFIG, 'utf8')));
  injected.components.push({ name: 'herdr', kind: 'module', entry: 'herdr.mjs', cwd: '.', port: 5179, depends_on: [], health: { path: '/', status: 200, json_has: ['ok'] } });
  assert.ok(validateConfig(injected, { checkFiles: false }).some((problem) => /unknown component 'herdr'|exactly data, building, ui/.test(problem)));
});

function responseCapture() {
  return {
    status: null, headers: null, body: null,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
    end(body = '') { this.body = String(body); },
  };
}

async function dispatch(server, method, url) {
  const handler = server.listeners('request')[0];
  const response = responseCapture();
  await handler({ method, url, headers: { host: '127.0.0.1' } }, response);
  return response;
}

test('data and Building imports bind no socket; mutation verbs are refused before route work', async () => {
  assert.equal(dataServer.address(), null);
  assert.equal(buildingServer.address(), null);

  const previous = process.env.COMMAND_OBSERVATION_ONLY;
  process.env.COMMAND_OBSERVATION_ONLY = '1';
  try {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE']) {
      const data = await dispatch(dataServer, method, '/api/surface');
      assert.equal(data.status, 405, `data service ${method}`);
      assert.equal(data.headers.allow, 'GET, HEAD');
      const building = await dispatch(buildingServer, method, '/api/building');
      assert.equal(building.status, 405, `Building service ${method}`);
      assert.equal(building.headers.allow, 'GET, HEAD');
    }

    for (const method of ['GET', 'HEAD']) {
      const data = await dispatch(dataServer, method, '/api/gates');
      assert.equal(data.status, 404, `data ${method} /api/gates must not run audit scripts`);
      assert.match(data.body, /outside the observation-only/);
      const raw = await dispatch(dataServer, method, '/api/raw');
      assert.equal(raw.status, 404, `data ${method} /api/raw is not an observer endpoint`);
      const building = await dispatch(buildingServer, method, '/api/building/not-a-route');
      assert.equal(building.status, 404, `Building ${method} is accepted but unknown paths stay closed`);
    }

    for (const route of ['/api/herdr', '/api/command', '/api/terminal', '/api/room', '/api/agents/launch', '/api/lifecycle/drain', '/api/snapshot', '/api/identity', '/api/floor', '/api/health-floor']) {
      const response = await dispatch(dataServer, 'GET', route);
      assert.equal(response.status, 404, `${route} is outside the observer API`);
    }
  } finally {
    if (previous === undefined) delete process.env.COMMAND_OBSERVATION_ONLY;
    else process.env.COMMAND_OBSERVATION_ONLY = previous;
  }
});

test('observation UI contains no mutating client, Herdr proxy, Room adapter, terminal or process-control route', () => {
  const app = readFileSync(path.join(OBS_ROOT, 'ObservationApp.tsx'), 'utf8');
  const vite = readFileSync(path.join(OBS_ROOT, 'vite.config.ts'), 'utf8');
  const html = readFileSync(path.join(OBS_ROOT, 'index.html'), 'utf8');
  const lifecycleCli = readFileSync(path.join(PACKAGE_ROOT, 'scripts/command-lifecycle.mjs'), 'utf8');
  const buildingService = readFileSync(path.join(PACKAGE_ROOT, 'server/building-service.mjs'), 'utf8');
  assert.match(html, /STARQ \/\/ COMMAND · OBSERVATION ONLY/);
  assert.match(app, /useCommandSurface\(15000\)/);
  assert.match(app, /useBuildingProjection\(30000\)/);
  assert.doesNotMatch(app, /fetch\s*\(|runGates|fetchRawSource|EventSource|WebSocket|terminal|Room|process-control|agent-launch/i);
  assert.doesNotMatch(vite, /HERDR_SERVICE|\/api\/herdr|\/api\/command|ws\s*:\s*true|hmr\s*:\s*true/i);
  assert.match(vite, /hmr:\s*false/);
  assert.match(vite, /envDir:\s*false/);
  assert.match(vite, /envPrefix:\s*\[\]/);
  assert.match(vite, /server:\s*\{\s*host:\s*'127\.0\.0\.1'/);
  assert.match(vite, /preview:\s*\{\s*host:\s*'127\.0\.0\.1'/);
  assert.match(buildingService, /server\.listen\(port, '127\.0\.0\.1'/);
  assert.match(vite, /'\/api\/building'/);
  assert.match(vite, /'\/api'/);
  assert.match(lifecycleCli, /observation commands accept only --json/);
  assert.match(lifecycleCli, /runtimeDir:\s*path\.join\(PACKAGE_ROOT, '\.command-runtime'\)/);
  assert.match(lifecycleCli, /cfg\.abs\(cfg\.profile\.shared_lock_file\)/);
});

test('Vite HTTP boundary blocks mutation verbs and control routes before internal middleware', () => {
  const invoke = (method, url) => {
    const response = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
    let nextCalled = false;
    observationBoundary({ method, url }, response, () => { nextCalled = true; });
    return { response, nextCalled };
  };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE']) {
    const { response, nextCalled } = invoke(method, '/api/surface');
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, 'GET, HEAD');
    assert.equal(nextCalled, false);
  }
  for (const path of ['/__open-in-editor', '/__open-in-editor/', '/__open-in-editor?file=src/App.tsx', '/api/herdr', '/api/command', '/api/room', '/api/agents/launch', '/api/gates', '/api/raw']) {
    const { response, nextCalled } = invoke('GET', path);
    assert.equal(response.statusCode, 404, path);
    assert.equal(nextCalled, false, path);
  }
  for (const path of ['/api/health', '/api/surface', '/api/building', '/api/building/health']) {
    const { nextCalled } = invoke('GET', path);
    assert.equal(nextCalled, true, path);
  }
  const plugin = observationBoundaryPlugin();
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    const installed = [];
    plugin[hook]({ middlewares: { use: (middleware) => installed.push(middleware) } });
    assert.deepEqual(installed, [observationBoundary], hook);
  }
});

test('projection call graph has no file writes, service background jobs, or event subscriptions', () => {
  const projectionSources = [
    'server/data-service.mjs', 'server/floor.mjs', 'server/company-os.mjs',
    'server/snapshot.mjs', 'server/health-floor.mjs', 'server/building-service.mjs',
    'server/building.mjs', 'server/paths.mjs', 'server/path-guard.mjs',
  ].map((rel) => readFileSync(path.join(PACKAGE_ROOT, rel), 'utf8')).join('\n');
  assert.doesNotMatch(projectionSources, /(?:fs\.)?(?:writeFile|appendFile|rename|unlink|mkdir|createWriteStream)Sync?\s*\(/i);
  assert.doesNotMatch(projectionSources, /setInterval\s*\(|setTimeout\s*\(|setImmediate\s*\(|EventSource|WebSocket|child_process|process\.kill/i);
  const gatesSource = readFileSync(path.join(PACKAGE_ROOT, 'server/gates.mjs'), 'utf8');
  assert.match(gatesSource, /execFileSync/);
  const dataSource = readFileSync(path.join(PACKAGE_ROOT, 'server/data-service.mjs'), 'utf8');
  const readRoutes = dataSource.match(/export const OBSERVATION_READ_ROUTES = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  assert.match(readRoutes, /'\/api\/health'/);
  assert.match(readRoutes, /'\/api\/surface'/);
  assert.doesNotMatch(readRoutes, /'\/api\/gates'/);
});

function makeOwner({ gates, dir, onSpawn = () => {}, env = {}, listListeners = async () => [], prerequisites = null, lockFile = null, mutateConfig = null }) {
  const config = JSON.parse(readFileSync(PROFILE_CONFIG, 'utf8'));
  config.workspace_root = dir;
  if (mutateConfig) mutateConfig(config);
  const configFile = path.join(dir, 'lifecycle.observation.config.json');
  writeFileSync(configFile, JSON.stringify(config), 'utf8');
  const runtimeDir = path.join(dir, '.runtime');
  let standaloneGateCalls = 0;
  let standaloneProbeCalls = 0;
  const owner = createOwner({
    configFile,
    runtimeDir,
    lockFile: lockFile ?? path.join(runtimeDir, 'lifecycle.lock'),
    env,
    configOptions: { checkFiles: false },
    deps: {
      selfPid: 8123,
      inspect: async (pids) => new Map(pids.map((pid) => [pid, { pid, found: true, exe: 'C:\\node.exe', created: '2026-10-08T00:00:00.000Z' }])),
      listListeners,
      prerequisites: prerequisites ?? (async () => gates),
      spawnChild: async (...args) => { onSpawn(...args); throw new Error('spawn forbidden in the offline refusal test'); },
      standaloneHerdrGate: async () => { standaloneGateCalls += 1; return { resolved: true }; },
      probeStandaloneHerdr: async () => { standaloneProbeCalls += 1; return { state: 'AVAILABLE' }; },
    },
  });
  return { owner, runtimeDir, get standaloneGateCalls() { return standaloneGateCalls; }, get standaloneProbeCalls() { return standaloneProbeCalls; } };
}

test('observer gates fail closed on missing inventory and configuration/ownership drift', () => {
  const cfg = loadConfig(PROFILE_CONFIG);
  const scopedSpecs = observationRuntimeSpecs(cfg.workspace_root, cfg);
  const scopedPaths = scopedSpecs.map((spec) => String(spec.path).toLowerCase());
  assert.ok(scopedPaths.some((p) => p.endsWith('node.exe')));
  assert.ok(scopedSpecs.some((spec) => String(spec.path).toLowerCase().endsWith('\\server') && spec.recursive === true));
  assert.ok(scopedPaths.some((p) => p.endsWith('node_modules')));
  assert.equal(scopedPaths.some((p) => p.endsWith('herdr-floor\\manifest.json')), false);
  assert.equal(scopedPaths.some((p) => p.includes('\\.codex\\') || p.includes('\\.pi\\') || p.includes('\\.herdr\\')), false);
  assert.ok(scopedSpecs.every((spec) => !String(spec.owner).startsWith('agent:')));
  const missing = evaluateObservationRule0Gate(cfg.workspace_root, cfg, {
    check: () => ({ resolved: false, detail: 'inventory missing', failures: ['inventory missing'], inventory: { schema: 'starq.rule0.inventory/v1', entries: [], unresolved: [{ path: 'missing', error: 'ENOENT' }], sha256: '0'.repeat(64) } }),
  });
  assert.equal(missing.resolved, false);
  assert.equal(evaluateObservationComposition(cfg).resolved, true);
  assert.equal(evaluateObservationOwnership(cfg).resolved, true);
  const observerGates = readObservationGates(cfg.workspace_root, cfg, {
    checkRule0: () => ({ resolved: true, detail: 'mock scoped inventory', failures: [], inventory: { schema: 'starq.rule0.inventory/v1', entries: [{}], unresolved: [], sha256: '1'.repeat(64) } }),
    checkContainment: () => ({ resolved: false, detail: 'native containment evidence missing' }),
  });
  assert.deepEqual(observerGates.map((gate) => gate.kind), ['G-RULE0-OBS', 'G-PROFILE-OBS', 'G-OWNERSHIP-OBS', 'G-CONTAINMENT']);
  assert.equal(observerGates[3].resolved, false, 'observer composition does not bypass native containment');

  const drifted = JSON.parse(readFileSync(PROFILE_CONFIG, 'utf8'));
  drifted.components[0].port = 0.0;
  drifted.profile.shared_lock_file = 'different.lock';
  assert.equal(evaluateObservationComposition(drifted).resolved, false);
  assert.equal(evaluateObservationOwnership(drifted).resolved, false);
  assert.ok(validateConfig(drifted, { checkFiles: false }).some((p) => /data.port|shared_lock_file/.test(p)));
});

test('observer inventory declares the real child host and the historical incorrect path fails closed', () => {
  const cfg = loadConfig(PROFILE_CONFIG);
  const specs = observationRuntimeSpecs(cfg.workspace_root, cfg);
  const child = specs.find((spec) => spec.owner === 'observation-child-host');
  const expected = path.join(PACKAGE_ROOT, 'scripts/lifecycle-child.mjs');
  const historicalWrong = path.join(PACKAGE_ROOT, 'lifecycle-child.mjs');
  assert.equal(child?.path, expected);
  assert.equal(existsSync(expected), true);
  assert.equal(existsSync(historicalWrong), false);
  const failed = inventoryPaths([{ path: historicalWrong, role: 'entry', owner: 'observation-child-host' }]);
  assert.equal(failed.entries.length, 0);
  assert.deepEqual(failed.unresolved.map(({ path: unresolvedPath, error }) => ({ path: unresolvedPath, error })), [{ path: historicalWrong, error: 'ENOENT' }]);
});

test('named observer gates never fall through to the full-profile evaluator; unknown names fail closed', () => {
  const calls = { full: 0, observation: 0, profile: 0, containment: 0 };
  const deps = {
    loadObservation: () => ({ profile: { name: OBSERVATION_PROFILE } }),
    readObservation: () => {
      calls.observation += 1;
      return [
        { kind: 'G-RULE0-OBS', resolved: true },
        { kind: 'G-PROFILE-OBS', resolved: true },
        { kind: 'G-OWNERSHIP-OBS', resolved: true },
      ];
    },
    readFull: () => { calls.full += 1; return [{ kind: 'G-RULE0', resolved: true }]; },
    readProfile: () => { calls.profile += 1; return { resolved: true }; },
    readContainment: () => { calls.containment += 1; return { resolved: true }; },
  };
  for (const kind of ['G-RULE0-OBS', 'G-PROFILE-OBS', 'G-OWNERSHIP-OBS']) {
    assert.equal(readNamedGate('D:\\StarqTech', kind, deps).resolved, true);
  }
  assert.equal(calls.observation, 3);
  assert.equal(calls.full, 0, 'observer diagnostics must not evaluate the full-profile inventory');

  const unknown = readNamedGate('D:\\StarqTech', 'G-NOT-DECLARED', deps);
  assert.equal(unknown.resolved, false);
  assert.match(unknown.detail, /unknown gate/);
  assert.equal(calls.full, 0, 'unknown gate names must fail without scanning full Rule0');
  const cli = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, 'scripts/lifecycle/gate-status.mjs'), 'D:\\StarqTech', 'G-NOT-DECLARED'], { encoding: 'utf8' });
  assert.equal(cli.status, 2);
  assert.equal(JSON.parse(cli.stdout).resolved, false);

  assert.equal(readNamedGate('D:\\StarqTech', 'G-RULE0', deps).resolved, true);
  assert.equal(readNamedGate('D:\\StarqTech', 'G-PROFILE', deps).resolved, true);
  assert.equal(readNamedGate('D:\\StarqTech', 'G-CONTAINMENT', deps).resolved, true);
  assert.deepEqual(calls, { full: 1, observation: 3, profile: 1, containment: 1 });
});

test('observer environment injection and listener override keys are identified without revealing values', () => {
  const hazards = findObservationEnvHazards({ NODE_OPTIONS: '--require C:\\inject.js', NODE_PATH: 'C:\\inject', VITE_SECRET: 'hidden', COMMAND_HOST: '0.0.0.0', PATH: 'C:\\safe' });
  assert.deepEqual(hazards, ['NODE_OPTIONS=<set>', 'NODE_PATH=<set>', 'VITE_SECRET=<set>', 'COMMAND_HOST=<set>']);
});

test('observer native wrapper rejects injection before invoking pinned Node; inspection tools are path-pinned', async () => {
  const cfg = loadConfig(PROFILE_CONFIG);
  const ps = readFileSync(path.join(PACKAGE_ROOT, 'scripts/observation-start.ps1'), 'utf8');
  const batch = readFileSync(path.join(PACKAGE_ROOT, 'Start-Command-Observation.bat'), 'utf8');
  assert.ok(ps.indexOf('$unsafeNames') < ps.indexOf('& $node'));
  assert.match(ps, /NODE_OPTIONS/);
  assert.match(ps, /NODE_PATH/);
  assert.match(ps, /StartsWith\('VITE_'\)/);
  assert.match(batch, /C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);

  const invoked = [];
  const execFileImpl = (exe, args, options, callback) => {
    invoked.push(exe);
    if (exe === cfg.inspection_tools.powershell) callback(null, JSON.stringify([{ pid: 123, found: false }]), '');
    else callback(null, 'Proto Local Address          Foreign Address        State           PID\n', '');
  };
  await inspectProcesses([123], { execFileImpl, powershellExe: cfg.inspection_tools.powershell });
  await listListeners({ execFileImpl, netstatExe: cfg.inspection_tools.netstat });
  assert.deepEqual(invoked, [cfg.inspection_tools.powershell, cfg.inspection_tools.netstat, cfg.inspection_tools.netstat]);
});

test('scoped inventory and native containment evidence fail closed before any launch', async () => {
  for (const blockedKind of ['G-RULE0-OBS', 'G-CONTAINMENT']) {
    const dir = mkdtempSync(path.join(tmpdir(), `command-observation-${blockedKind}-`));
    try {
      let spawns = 0;
      const gates = ['G-RULE0-OBS', 'G-PROFILE-OBS', 'G-OWNERSHIP-OBS', 'G-CONTAINMENT'].map((kind) => ({ kind, resolved: kind !== blockedKind, detail: kind === blockedKind ? `${kind}: evidence missing` : `${kind}: test resolved` }));
      const { owner } = makeOwner({ gates, dir, onSpawn: () => { spawns += 1; } });
      const result = await owner.start();
      assert.equal(result.result, RESULT.REFUSED);
      assert.equal(result.code, 'PREREQUISITES');
      assert.equal(result.gates.find((g) => g.kind === blockedKind).resolved, false);
      assert.equal(spawns, 0, `${blockedKind} must stop before component launch`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('observer refuses module injection, bind overrides, configuration drift, and occupied ports before launch', async () => {
  const goodGates = ['G-RULE0-OBS', 'G-PROFILE-OBS', 'G-OWNERSHIP-OBS', 'G-CONTAINMENT'].map((kind) => ({ kind, resolved: true }));
  for (const env of [{ NODE_OPTIONS: '--require C:\\inject.js' }, { NODE_PATH: 'C:\\inject' }, { VITE_MODE: 'bad' }, { COMMAND_HOST: '0.0.0.0' }, { HOST: '0.0.0.0' }]) {
    const dir = mkdtempSync(path.join(tmpdir(), 'command-observation-env-'));
    try {
      let spawns = 0;
      const fixture = makeOwner({ gates: goodGates, dir, env, onSpawn: () => { spawns += 1; } });
      const result = await fixture.owner.start();
      assert.equal(result.result, RESULT.REFUSED);
      assert.equal(result.code, 'OBSERVATION_ENV_UNSAFE');
      assert.equal(spawns, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  const driftDir = mkdtempSync(path.join(tmpdir(), 'command-observation-drift-'));
  try {
    let spawns = 0;
    const fixture = makeOwner({ gates: goodGates, dir: driftDir, mutateConfig: (cfg) => { cfg.components[0].port = 5199; }, onSpawn: () => { spawns += 1; } });
    const result = await fixture.owner.start();
    assert.equal(result.result, RESULT.REFUSED);
    assert.equal(result.code, 'CONFIG_INVALID');
    assert.equal(spawns, 0);
  } finally { rmSync(driftDir, { recursive: true, force: true }); }

  const portDir = mkdtempSync(path.join(tmpdir(), 'command-observation-port-'));
  try {
    let spawns = 0;
    const fixture = makeOwner({ gates: goodGates, dir: portDir, listListeners: async () => [{ address: '127.0.0.1', port: 5178, pid: 4242 }], onSpawn: () => { spawns += 1; } });
    const result = await fixture.owner.start();
    assert.equal(result.result, RESULT.REFUSED);
    assert.equal(result.code, 'PORT_CONFLICT');
    assert.deepEqual(result.busy, [{ address: '127.0.0.1', port: 5178, pid: 4242 }]);
    assert.equal(spawns, 0);
  } finally { rmSync(portDir, { recursive: true, force: true }); }
});

test('observer and full profile share one exclusive lifecycle lock; incomplete rollback blocks retry', async () => {
  const firstDir = mkdtempSync(path.join(tmpdir(), 'command-observation-lock-a-'));
  const secondDir = mkdtempSync(path.join(tmpdir(), 'command-observation-lock-b-'));
  const sharedLock = path.join(firstDir, 'shared', 'lifecycle.lock');
  let releasePrerequisites;
  let enteredPrerequisites;
  const entered = new Promise((resolve) => { enteredPrerequisites = resolve; });
  const first = makeOwner({
    gates: [], dir: firstDir, lockFile: sharedLock,
    prerequisites: async () => { enteredPrerequisites(); return new Promise((resolve) => { releasePrerequisites = resolve; }); },
  });
  const firstStart = first.owner.start();
  await entered;
  try {
    let secondSpawns = 0;
    const goodGates = ['G-RULE0-OBS', 'G-PROFILE-OBS', 'G-OWNERSHIP-OBS', 'G-CONTAINMENT'].map((kind) => ({ kind, resolved: true }));
    const second = makeOwner({ gates: goodGates, dir: secondDir, lockFile: sharedLock, onSpawn: () => { secondSpawns += 1; } });
    const refused = await second.owner.start();
    assert.equal(refused.result, RESULT.REFUSED);
    assert.equal(refused.code, 'LOCKED');
    assert.equal(secondSpawns, 0);
  } finally {
    releasePrerequisites([{ kind: 'G-RULE0-OBS', resolved: false, detail: 'simulated missing inventory' }]);
  }
  const firstResult = await firstStart;
  assert.equal(firstResult.code, 'PREREQUISITES');
  assert.equal(existsSync(sharedLock), false, 'the shared lock is released after the refused offline operation');
  rmSync(firstDir, { recursive: true, force: true });
  rmSync(secondDir, { recursive: true, force: true });

  const rollbackDir = mkdtempSync(path.join(tmpdir(), 'command-observation-rollback-'));
  try {
    const config = JSON.parse(readFileSync(PROFILE_CONFIG, 'utf8'));
    config.workspace_root = rollbackDir;
    config.node = 'C:\\fake\\node.exe';
    const configFile = path.join(rollbackDir, 'lifecycle.observation.config.json');
    writeFileSync(configFile, JSON.stringify(config));
    const processes = new Map([[8123, { pid: 8123, found: true, exe: config.node, created: 'owner' }]]);
    const listeners = [];
    const shutdownOrder = [];
    const goodGates = ['G-RULE0-OBS', 'G-PROFILE-OBS', 'G-OWNERSHIP-OBS', 'G-CONTAINMENT'].map((kind) => ({ kind, resolved: true }));
    let nextPid = 9200;
    const owner = createOwner({
      configFile, runtimeDir: path.join(rollbackDir, '.runtime'), lockFile: path.join(rollbackDir, 'shared', 'lifecycle.lock'),
      env: { PATH: 'C:\\untrusted\\bin' }, configOptions: { checkFiles: false },
      deps: {
        selfPid: 8123, pollMs: 0, prerequisites: async () => goodGates,
        inspect: async (pids) => new Map(pids.map((pid) => [pid, processes.get(pid) ?? { pid, found: false }])),
        listListeners: async () => listeners.map((row) => ({ ...row })),
        spawnChild: async (exe, args, opts) => {
          if (opts.env.STARQ_LC_NAME === 'ui') throw new Error('simulated offline UI launch failure');
          const pid = ++nextPid;
          processes.set(pid, { pid, found: true, exe, created: `child-${pid}` });
          listeners.push({ port: Number(opts.env.STARQ_LC_PORT), pid });
          assert.equal(opts.env.PATH, 'C:\\Windows\\System32');
          assert.equal(opts.env.NODE_OPTIONS, undefined);
          assert.equal(opts.env.NODE_PATH, undefined);
          assert.equal(opts.env.COMMAND_HOST, opts.env.STARQ_LC_HOST === '127.0.0.1' && opts.env.STARQ_LC_NAME === 'data' ? '127.0.0.1' : undefined);
          return { pid, unref() {} };
        },
        proveInstance: async () => ({ ok: true, detail: 'simulated owner-issued proof' }),
        requestShutdown: async (child) => {
          shutdownOrder.push(child.name);
          processes.delete(child.pid);
          for (let i = listeners.length - 1; i >= 0; i -= 1) if (listeners[i].pid === child.pid) listeners.splice(i, 1);
          return { ok: true, detail: 'simulated graceful close' };
        },
        treeClosed: async () => false,
        forceKill: async () => { throw new Error('forced cleanup is forbidden'); },
        checkHealth: async () => ({ ok: true, detail: 'simulated health' }),
      },
    });
    const result = await owner.start();
    assert.equal(result.result, RESULT.ROLLBACK_INCOMPLETE);
    assert.deepEqual(shutdownOrder, ['building', 'data']);
    assert.equal((await owner.start()).code, 'NOT_STOPPED');
  } finally { rmSync(rollbackDir, { recursive: true, force: true }); }
});

test('simulated ready startup requests only the three observation services and no broker or agent API', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'command-observation-composition-'));
  try {
    const config = JSON.parse(readFileSync(PROFILE_CONFIG, 'utf8'));
    config.workspace_root = dir;
    config.node = 'C:\\fake\\node.exe';
    const configFile = path.join(dir, 'lifecycle.observation.config.json');
    writeFileSync(configFile, JSON.stringify(config), 'utf8');
    const processes = new Map();
    const launches = [];
    const brokerCalls = [];
    let nextPid = 9100;
    const owner = createOwner({
      configFile,
      runtimeDir: path.join(dir, '.runtime'),
      env: {},
      configOptions: { checkFiles: false },
      deps: {
        selfPid: 8123,
        pollMs: 0,
        prerequisites: async () => ['G-RULE0-OBS', 'G-PROFILE-OBS', 'G-OWNERSHIP-OBS', 'G-CONTAINMENT'].map((kind) => ({ kind, resolved: true })),
        inspect: async (pids) => new Map(pids.map((pid) => [pid, processes.get(pid) ?? { pid, found: true, exe: 'C:\\fake\\node.exe', created: '2026-10-08T00:00:00.000Z' }])),
        listListeners: async () => [...processes.values()].filter((p) => p.port).map(({ pid, port }) => ({ pid, port })),
        spawnChild: async (exe, args, opts) => {
          const pid = ++nextPid;
          const name = opts.env.STARQ_LC_NAME;
          launches.push({ name, env: opts.env });
          processes.set(pid, { pid, found: true, exe, created: `2026-10-08T00:00:0${pid - 9100}.000Z`, port: Number(opts.env.STARQ_LC_PORT) });
          return { pid, unref() {} };
        },
        proveInstance: async () => ({ ok: true, detail: 'simulated authenticated identity' }),
        checkHealth: async () => ({ ok: true, detail: 'simulated health contract' }),
        brokerRequest: async (...args) => { brokerCalls.push(args); throw new Error('broker must not be contacted'); },
      },
    });

    const result = await owner.start();
    assert.equal(result.result, RESULT.READY);
    assert.deepEqual(launches.map((c) => c.name), ['data', 'building', 'ui']);
    assert.deepEqual(Object.keys(result.state.ports), ['data', 'building', 'ui']);
    assert.equal(brokerCalls.length, 0);
    for (const launch of launches) {
      assert.equal(launch.env.COMMAND_OBSERVATION_ONLY, '1');
      assert.equal(launch.env.HERDR_SERVICE, undefined);
      assert.equal(launch.env.HERDR_FLOOR_URL, undefined);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('observation status never probes standalone Herdr', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'command-observation-status-'));
  try {
    const gates = ['G-RULE0-OBS', 'G-PROFILE-OBS', 'G-OWNERSHIP-OBS', 'G-CONTAINMENT'].map((kind) => ({ kind, resolved: true }));
    const fixture = makeOwner({ gates, dir });
    const report = await fixture.owner.status();
    assert.equal(report.overall, 'STOPPED');
    assert.equal(report.observation_profile.herdr_probe, 'NOT_PERFORMED');
    assert.equal(fixture.standaloneGateCalls, 0);
    assert.equal(fixture.standaloneProbeCalls, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
