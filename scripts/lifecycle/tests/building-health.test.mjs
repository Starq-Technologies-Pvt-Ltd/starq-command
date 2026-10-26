/**
 * Offline Building health-contract tests for PM-CMD-003.
 * No Command control-plane port is bound. Responses are fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateHealth, ACCEPTABLE_BUILDING_INTEGRITY } from '../health.mjs';
import { loadConfig } from '../config.mjs';
import { classifyComponentPreflight } from '../preflight.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function jsonResponse(status, body, contentType = 'application/json') {
  return { status, contentType, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

function healthyBody(integrity = 'SOURCE_READ') {
  return {
    generated_at: '2026-10-22T00:00:00.000Z',
    origin: 'building-projection',
    integrity,
    sources_checked: 3,
  };
}

test('canonical Building contract requires integrity SOURCE_READ, not mere field presence', () => {
  assert.equal(ACCEPTABLE_BUILDING_INTEGRITY, 'SOURCE_READ');
  const cfg = loadConfig(path.join(PACKAGE_ROOT, 'lifecycle.config.json'), { checkFiles: false });
  const building = cfg.components.find((c) => c.name === 'building');
  assert.equal(building.port, 5178);
  assert.equal(building.health.path, '/api/building/health');
  assert.equal(building.health.status, 200);
  assert.deepEqual(building.health.json_equals, { integrity: 'SOURCE_READ' });
  assert.ok(building.health.json_has.includes('integrity'));
  const obs = loadConfig(path.join(PACKAGE_ROOT, 'lifecycle.observation.config.json'), { checkFiles: false });
  assert.deepEqual(obs.components.find((c) => c.name === 'building').health.json_equals, { integrity: 'SOURCE_READ' });
});

test('SOURCE_READ on HTTP 200 satisfies the contract; UNAVAILABLE and DRIFT do not', () => {
  const cfg = loadConfig(path.join(PACKAGE_ROOT, 'lifecycle.config.json'), { checkFiles: false });
  const contract = cfg.components.find((c) => c.name === 'building').health;
  assert.equal(evaluateHealth(contract, jsonResponse(200, healthyBody('SOURCE_READ'))).ok, true);
  assert.equal(evaluateHealth(contract, jsonResponse(200, healthyBody('UNAVAILABLE'))).ok, false);
  assert.equal(evaluateHealth(contract, jsonResponse(200, healthyBody('DRIFT'))).ok, false);
  assert.equal(evaluateHealth(contract, jsonResponse(200, healthyBody('UNKNOWN'))).ok, false);
});

test('malformed body, missing integrity, or fail-closed HTTP 503 are unhealthy', () => {
  const cfg = loadConfig(path.join(PACKAGE_ROOT, 'lifecycle.config.json'), { checkFiles: false });
  const contract = cfg.components.find((c) => c.name === 'building').health;
  assert.equal(evaluateHealth(contract, jsonResponse(200, '{not-json')).ok, false);
  assert.equal(evaluateHealth(contract, jsonResponse(200, { generated_at: 't', origin: 'o' })).ok, false);
  assert.equal(evaluateHealth(contract, jsonResponse(200, { generated_at: 't', origin: 'o', integrity: null })).ok, false);
  assert.equal(evaluateHealth(contract, jsonResponse(503, healthyBody('UNAVAILABLE'))).ok, false);
  assert.equal(evaluateHealth(contract, jsonResponse(500, { error: 'UNREADABLE' })).ok, false);
});

test('owned Building listener with failed integrity contract is preflight DEGRADED', () => {
  const failed = classifyComponentPreflight({
    name: 'building', port: 5178, ownership: 'OWNED',
    health: { ok: false, detail: "JSON 'integrity' is \"UNAVAILABLE\", expected \"SOURCE_READ\"" },
    listener: { present: true, owned: true, pids: [9] },
  });
  assert.equal(failed.state, 'DEGRADED');
  const ok = classifyComponentPreflight({
    name: 'building', port: 5178, ownership: 'OWNED',
    health: { ok: true, detail: 'contract satisfied' },
    listener: { present: true, owned: true, pids: [9] },
  });
  assert.equal(ok.state, 'HEALTHY');
});
