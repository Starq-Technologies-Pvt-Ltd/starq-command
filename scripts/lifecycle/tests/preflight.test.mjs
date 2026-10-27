/**
 * Offline health-preflight tests. Command control-plane ports are never bound.
 * The ephemeral-socket case uses port 0 (OS-assigned) and asserts it is not
 * a Command port.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  buildHealthPreflight,
  classifyComponentPreflight,
  isCommandControlPlanePort,
  COMMAND_CONTROL_PLANE_PORTS,
  PM_CMD_001_CLOSURE,
} from '../preflight.mjs';

const NAMES = [
  ['ui', 5173], ['pm', 5176], ['data', 5177],
  ['building', 5178], ['herdr', 5179], ['herdrBroker', 5188],
];

function idleComponent(name, port) {
  return {
    name, port, ownership: 'NOT_RECORDED', pid: null,
    listener: { present: false, owned: false, pids: [], classifications: [] },
  };
}

function idleReport(extra = {}) {
  return {
    inspection: { complete: true, errors: [] },
    overall: 'STOPPED',
    problems: [],
    components: NAMES.map(([name, port]) => idleComponent(name, port)),
    live_infrastructure: [],
    normal_profile: {
      standalone_herdr: { owner_gate: { resolved: true, detail: 'G-PROFILE recorded' } },
    },
    ...extra,
  };
}

test('idle cooldown: all six Command ports STOPPED; declared infra is not a false alarm', () => {
  const report = idleReport({
    live_infrastructure: [
      { pid: 1, id: 'standalone-herdr', kind: 'DECLARED_EXTERNAL_INFRASTRUCTURE', blocking_for_command: false },
      { pid: 2, id: 'starqbot-gateway', kind: 'DECLARED_EXTERNAL_INFRASTRUCTURE', blocking_for_command: false },
    ],
  });
  const hp = buildHealthPreflight(report);
  assert.equal(hp.schema, 'starq.command.health_preflight/v1');
  assert.equal(hp.overall, 'STOPPED');
  assert.equal(hp.idle_cooldown, true);
  assert.deepEqual(hp.command_ports, COMMAND_CONTROL_PLANE_PORTS);
  assert.equal(hp.ports.length, 6);
  assert.ok(hp.ports.every((p) => p.state === 'STOPPED'));
  assert.equal(hp.declared_infrastructure.blocking_for_command, false);
  assert.equal(hp.gates['G-PROFILE'].resolved, true);
  assert.equal(hp.prerequisite.event_id, PM_CMD_001_CLOSURE.event_id);
  assert.equal(hp.prerequisite.room_sequence, 11235);
  assert.equal(hp.prerequisite.depends_on_retained, true);
});

test('HEALTHY only when owned, listener owned, and health contract ok', () => {
  const c = {
    name: 'pm', port: 5176, ownership: 'OWNED',
    health: { ok: true, detail: 'ok' },
    listener: { present: true, owned: true, pids: [9], classifications: [] },
  };
  assert.equal(classifyComponentPreflight(c).state, 'HEALTHY');
  c.health = { ok: false, detail: 'HTTP 404' };
  assert.equal(classifyComponentPreflight(c).state, 'DEGRADED');
});

test('foreign listener on a Command port is DEGRADED, not idle STOPPED', () => {
  const report = idleReport();
  report.components = report.components.map((c) => (c.name === 'ui' ? {
    ...c, ownership: 'NOT_RECORDED',
    listener: { present: true, owned: false, pids: [4444], classifications: [{ kind: 'NOT_CLASSIFIED' }] },
  } : c));
  const hp = buildHealthPreflight(report);
  assert.equal(hp.overall, 'DEGRADED');
  assert.equal(hp.idle_cooldown, false);
  assert.equal(hp.ports.find((p) => p.name === 'ui').state, 'DEGRADED');
  assert.ok(hp.ports.filter((p) => p.name !== 'ui').every((p) => p.state === 'STOPPED'));
});

test('partial HEALTHY mix is overall DEGRADED', () => {
  const report = idleReport();
  report.components = report.components.map((c) => (c.name === 'pm' ? {
    ...c, ownership: 'OWNED',
    health: { ok: true, detail: 'ok' },
    listener: { present: true, owned: true, pids: [8] },
  } : c));
  const hp = buildHealthPreflight(report);
  assert.equal(hp.overall, 'DEGRADED');
  assert.equal(hp.ports.find((p) => p.name === 'pm').state, 'HEALTHY');
});

test('all HEALTHY rolls up to HEALTHY', () => {
  const report = idleReport({
    components: NAMES.map(([name, port]) => ({
      name, port, ownership: 'OWNED',
      health: { ok: true, detail: 'ok' },
      listener: { present: true, owned: true, pids: [1] },
    })),
  });
  const hp = buildHealthPreflight(report);
  assert.equal(hp.overall, 'HEALTHY');
  assert.equal(hp.idle_cooldown, false);
  assert.ok(hp.ports.every((p) => p.state === 'HEALTHY'));
});

test('incomplete inspection is UNKNOWN, not a false STOPPED', () => {
  const hp = buildHealthPreflight({ inspection: { complete: false, errors: ['netstat failed'] }, components: idleReport().components });
  assert.equal(hp.overall, 'UNKNOWN');
  assert.equal(hp.idle_cooldown, false);
});

test('isolated ephemeral socket is not a Command control-plane port', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve())));
  const port = server.address().port;
  try {
    assert.ok(Number.isInteger(port) && port > 0);
    assert.equal(isCommandControlPlanePort(port), false);
    assert.ok(!COMMAND_CONTROL_PLANE_PORTS.includes(port));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
