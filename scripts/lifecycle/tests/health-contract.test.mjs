/**
 * A health contract may say "up, with a recognized verdict", without becoming lax.
 *
 * Incident (acceptance run, 2 Nov): in a workspace with none of Starq's Room,
 * identity or control-board files, the REQUIRED data service answered 503 and the
 * local profile could not start. The data service reports the health of its
 * projection CONTENT through its HTTP status - 503 whenever any Starq source is
 * unavailable - while the lifecycle only needs to know whether it is UP. So a
 * non-Starq installation could never reach READY, which contradicts the
 * requirement that Command run without Starq's records or agent systems.
 *
 * The strict rule in health.mjs stays: "a status code alone never passes".
 * `status_in` widens only the accepted status, and the config validator refuses
 * to let it stand without a body assertion (`json_one_of` or `json_equals`). The
 * tests below pin both halves: the case that must now pass, and every case that
 * must still fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateHealth } from '../health.mjs';
import { validateConfig } from '../config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CONFIG = path.resolve(HERE, '..', '..', '..', 'lifecycle.command-local.config.json');
const ONLINE_CONFIG = path.resolve(HERE, '..', '..', '..', 'lifecycle.config.json');

const json = (status, doc) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(doc) });
const doc = (overall) => ({ assembled_at: '2026-11-02T00:00:00Z', workspace: { root: null }, health: { overall } });

const localData = () => JSON.parse(readFileSync(LOCAL_CONFIG, 'utf8')).components.find((c) => c.name === 'data').health;

test('a contract without status_in behaves exactly as before: only its own status passes', () => {
  const contract = { status: 200, content_type: 'application/json', json_has: ['health'] };
  assert.equal(evaluateHealth(contract, json(200, doc('OK'))).ok, true);
  const r = evaluateHealth(contract, json(503, doc('UNAVAILABLE')));
  assert.equal(r.ok, false);
  assert.equal(r.detail, 'HTTP 503, expected 200');
});

test('the local profile data contract accepts a service that is UP with unavailable sources', () => {
  const contract = localData();
  assert.equal(evaluateHealth(contract, json(200, doc('OK'))).ok, true, 'all sources healthy');
  for (const state of ['UNAVAILABLE', 'STALE', 'DRIFT', 'UNREADABLE']) {
    assert.equal(evaluateHealth(contract, json(503, doc(state))).ok, true, `503 with ${state} is a running service reporting honestly`);
  }
});

test('and still REFUSES everything that is not a running service giving a recognized verdict', () => {
  const contract = localData();
  const refused = (label, response) => assert.equal(evaluateHealth(contract, response).ok, false, `${label} must not pass`);

  refused('a crashed handler (500) even with a plausible body', json(500, doc('UNAVAILABLE')));
  refused('a gateway error (502)', json(502, doc('UNAVAILABLE')));
  refused('a 404', json(404, doc('OK')));
  refused('a 503 whose verdict is not a recognized state', json(503, doc('MELTING')));
  refused('a 200 whose verdict is not a recognized state', json(200, doc('FINE')));
  refused('a 503 with no verdict at all', json(503, { assembled_at: 'x', workspace: {}, health: {} }));
  refused('a 503 missing the assembled surface', json(503, { health: { overall: 'UNAVAILABLE' } }));
  refused('an HTML error page', { status: 503, contentType: 'text/html', body: '<html>Service Unavailable</html>' });
  refused('JSON content type but a non-JSON body', { status: 503, contentType: 'application/json', body: 'upstream connect error' });
  refused('no response at all', null);
});

test('the strict online profile still demands OK and 200 for the data service', () => {
  const contract = JSON.parse(readFileSync(ONLINE_CONFIG, 'utf8')).components.find((c) => c.name === 'data').health;
  assert.equal(contract.status_in, undefined, 'the online profile must not have been loosened');
  assert.equal(evaluateHealth(contract, json(200, doc('OK'))).ok, true);
  assert.equal(evaluateHealth(contract, json(503, doc('UNAVAILABLE'))).ok, false);
});

// ── the validator refuses configurations that would loosen too far ──────────
const withData = (health) => {
  const cfg = JSON.parse(readFileSync(LOCAL_CONFIG, 'utf8'));
  cfg.components.find((c) => c.name === 'data').health = health;
  return validateConfig(cfg, { checkFiles: false });
};

test('the shipped local profile config validates', () => {
  assert.deepEqual(validateConfig(JSON.parse(readFileSync(LOCAL_CONFIG, 'utf8')), { checkFiles: false }), []);
});

test('status_in cannot stand alone: a non-200 must still assert a recognized body', () => {
  const problems = withData({ path: '/api/health', status: 200, status_in: [200, 503], content_type: 'application/json', json_has: ['health'] });
  assert.ok(problems.some((m) => /status_in must be paired with json_one_of or json_equals/.test(m)), JSON.stringify(problems));
});

test('status_in must be a non-empty integer list that includes status', () => {
  const base = { path: '/api/health', status: 200, content_type: 'application/json', json_one_of: { 'health.overall': ['OK'] } };
  for (const bad of [[], [503], ['200'], 'oops', [200.5]]) {
    const problems = withData({ ...base, status_in: bad });
    assert.ok(problems.some((m) => /status_in must be a non-empty list of integers that includes status/.test(m)), `${JSON.stringify(bad)} was accepted`);
  }
});

test('json_one_of must map a field to a non-empty list of strings', () => {
  const base = { path: '/api/health', status: 200, status_in: [200, 503], content_type: 'application/json', json_has: ['health'] };
  for (const bad of [{ 'health.overall': [] }, { 'health.overall': [1] }, { 'health.overall': 'OK' }, [], 'x']) {
    const problems = withData({ ...base, json_one_of: bad });
    assert.ok(problems.some((m) => /json_one_of must map a field to a non-empty list of strings/.test(m)), `${JSON.stringify(bad)} was accepted`);
  }
});
