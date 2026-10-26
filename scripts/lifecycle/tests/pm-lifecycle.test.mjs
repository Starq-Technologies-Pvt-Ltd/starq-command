/**
 * Focused offline tests for the normal-profile PM lifecycle component (#10248).
 * Nothing here starts pm-service, opens pm-board.db, or reads canonical Room.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig, validateConfig, componentEnv, findEnvOverrides, topoOrder,
  REQUIRED_COMPONENTS, OBSERVATION_COMPONENTS, PINNED_PM_PORT, PM_OVERRIDE_ENV,
} from '../config.mjs';
import { evaluateHealth } from '../health.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORTS = { data: 5177, building: 5178, herdrBroker: 5188, herdr: 5179, pm: 5176, ui: 5173 };

function fixtureConfig(root) {
  const c = (name, deps, extra = {}) => ({
    name, kind: name === 'ui' ? 'vite' : 'module', entry: `x\\${name}.mjs`, cwd: 'x', port: PORTS[name], depends_on: deps,
    health: { path: '/h', status: 200, json_has: ['ok'] }, ...extra,
  });
  return {
    schema: 'starq.command.lifecycle.config/v1', workspace_root: root, node: 'D:\\fake\\runtime\\node.exe', host: '127.0.0.1',
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

test('normal profile requires pm in the fixed order; observation set is unchanged', () => {
  assert.deepEqual(REQUIRED_COMPONENTS, ['data', 'building', 'herdrBroker', 'herdr', 'pm', 'ui']);
  assert.deepEqual(OBSERVATION_COMPONENTS, ['data', 'building', 'ui']);
  const cfg = loadConfig(path.join(PACKAGE_ROOT, 'lifecycle.config.json'), { checkFiles: false });
  assert.equal(cfg.profile.name, 'starq-online/v1');
  assert.deepEqual(cfg.components.map((c) => c.name), REQUIRED_COMPONENTS);
  assert.deepEqual(cfg.profile.required_components, [...REQUIRED_COMPONENTS]);
  const pm = cfg.components.find((c) => c.name === 'pm');
  assert.equal(pm.port, PINNED_PM_PORT);
  assert.equal(pm.kind, 'module');
  assert.equal(pm.entry, '00_STARQ_HQ\\operations\\starq-command\\server\\pm-service.mjs');
  assert.equal(pm.cwd, '00_STARQ_HQ\\operations\\starq-command');
  assert.deepEqual(pm.depends_on, []);
  assert.equal(pm.health.path, '/api/pm/health');
  assert.deepEqual(pm.health.json_equals, { state: 'OK', scratch: false, room_post: 'OFF' });
  assert.ok(cfg.components.find((c) => c.name === 'ui').depends_on.includes('pm'));
  assert.deepEqual(topoOrder(cfg.components).map((c) => c.name), REQUIRED_COMPONENTS);
  const obs = loadConfig(path.join(PACKAGE_ROOT, 'lifecycle.observation.config.json'), { checkFiles: false });
  assert.deepEqual(obs.components.map((c) => c.name), OBSERVATION_COMPONENTS);
  assert.deepEqual(obs.components.find((c) => c.name === 'ui').depends_on, ['data', 'building']);
});

test('config validation: pm port, empty deps, and UI dependency on pm', () => {
  const doc = fixtureConfig('D:\\x');
  assert.deepEqual(validateConfig(doc, { checkFiles: false }), []);
  doc.components.find((c) => c.name === 'pm').port = 5191;
  assert.ok(validateConfig(doc, { checkFiles: false }).some((p) => /pm port must be 5176/.test(p)));
  const deps = fixtureConfig('D:\\x');
  deps.components.find((c) => c.name === 'pm').depends_on = ['data'];
  assert.ok(validateConfig(deps, { checkFiles: false }).some((p) => /pm: depends_on must be \[\]/.test(p)));
  const ui = fixtureConfig('D:\\x');
  ui.components.find((c) => c.name === 'ui').depends_on = ['data', 'building', 'herdr'];
  assert.ok(validateConfig(ui, { checkFiles: false }).some((p) => /ui: depends_on must include pm/.test(p)));
  const missing = fixtureConfig('D:\\x');
  missing.components = missing.components.filter((c) => c.name !== 'pm');
  missing.components.find((c) => c.name === 'ui').depends_on = ['data', 'building', 'herdr'];
  assert.ok(validateConfig(missing, { checkFiles: false }).some((p) => /component 'pm' is missing/.test(p)));
});

test('componentEnv maps pm to PM_PORT=5176 and PM_ROOM_POST=off only', () => {
  const cfg = loadConfig(path.join(PACKAGE_ROOT, 'lifecycle.config.json'), { checkFiles: false });
  assert.deepEqual(componentEnv(cfg, 'pm'), { PM_PORT: '5176', PM_ROOM_POST: 'off' });
  assert.equal(componentEnv(cfg, 'ui').PM_PORT, undefined);
  assert.equal(componentEnv(cfg, 'data').PM_ROOM_POST, undefined);
});

test('parent PM_* overrides are refused; Room-path COMMS_ROOM_PATH remains refused', () => {
  for (const key of PM_OVERRIDE_ENV) {
    const found = findEnvOverrides({ [key]: 'x' });
    assert.deepEqual(found, [`${key}=x`], key);
  }
  assert.deepEqual(findEnvOverrides({ COMMS_ROOM_PATH: 'D:\\scratch\\room.fixture' }), ['COMMS_ROOM_PATH=D:\\scratch\\room.fixture']);
  assert.deepEqual(findEnvOverrides({}), []);
});

test('PM health contract requires state OK, scratch false, room_post OFF', () => {
  const contract = {
    path: '/api/pm/health', status: 200, content_type: 'application/json',
    json_equals: { state: 'OK', scratch: false, room_post: 'OFF' },
  };
  const okBody = JSON.stringify({ state: 'OK', scratch: false, room_post: 'OFF', service: 'starq-command-pm' });
  assert.equal(evaluateHealth(contract, { status: 200, contentType: 'application/json', body: okBody }).ok, true);
  assert.equal(evaluateHealth(contract, { status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'OK', scratch: true, room_post: 'OFF' }) }).ok, false);
  assert.equal(evaluateHealth(contract, { status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'OK', scratch: false, room_post: 'ON' }) }).ok, false);
  assert.equal(evaluateHealth(contract, { status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'UNAVAILABLE', scratch: false, room_post: 'OFF' }) }).ok, false);
});
