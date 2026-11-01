/**
 * command-local/v1 judges its containment by the tier it DECLARES.
 *
 * Incident (acceptance run, 2 Nov): the Founder's one-click start was REFUSED -
 * "G-CONTAINMENT: exact-build independent compatibility proof required" - on the
 * real workspace. readCommandLocalGates had hard-wired the RELEASE gate, which
 * demands windows-job-compatibility.json signed by an independent verifier, into
 * a profile that declares tier "development". That proof does not exist yet, so
 * the daily driver could not start, and every test passed because they all inject
 * a fake containment gate.
 *
 * These tests use the real function with recording stand-ins for the two gates,
 * so what is asserted is WHICH gate is consulted, which is the thing that was
 * wrong. The release gate stays strict, and an unknown tier can only get stricter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readCommandLocalGates } from '../gates.mjs';

const present = () => true; // workspace markers and entries exist

function recorder() {
  const calls = [];
  return {
    calls,
    development: (ws) => { calls.push('development'); return { resolved: true, detail: 'dev gate ran' }; },
    release: (ws) => { calls.push('release'); return { resolved: false, detail: 'release proof missing' }; },
  };
}

const cfg = (tier) => ({
  profile: { name: 'command-local/v1', tier, required_components: [] },
  components: [],
});

const run = (tier, extra = {}) => {
  const r = recorder();
  const gates = readCommandLocalGates('D:/ws', cfg(tier), {
    exists: present,
    checkDevelopmentContainment: r.development,
    checkReleaseContainment: r.release,
    ...extra,
  });
  return { r, gates, containment: gates.find((g) => g.kind === 'G-CONTAINMENT') };
};

test('a development-tier profile is judged by the development containment gate', () => {
  const { r, containment } = run('development');
  assert.deepEqual(r.calls, ['development']);
  assert.equal(containment.resolved, true);
});

test('a release-tier profile is still judged by the strict release gate', () => {
  const { r, containment } = run('release');
  assert.deepEqual(r.calls, ['release']);
  assert.equal(containment.resolved, false, 'the release gate must not be softened');
});

test('an unknown or missing tier falls back to the strict gate, never the lenient one', () => {
  for (const tier of [undefined, null, '', 'staging', 'DEVELOPMENT ']) {
    const { r, containment } = run(tier);
    assert.deepEqual(r.calls, ['release'], `tier ${JSON.stringify(tier)} reached the lenient gate`);
    assert.equal(containment.resolved, false);
  }
});

test('an explicitly supplied containment check still wins over the tier', () => {
  const r = recorder();
  let called = 0;
  const gates = readCommandLocalGates('D:/ws', cfg('development'), {
    exists: present,
    checkContainment: () => { called += 1; return { resolved: true, detail: 'injected' }; },
    checkDevelopmentContainment: r.development,
    checkReleaseContainment: r.release,
  });
  assert.equal(called, 1);
  assert.deepEqual(r.calls, []);
  assert.equal(gates.find((g) => g.kind === 'G-CONTAINMENT').detail, 'injected');
});

test('the workspace gate is evaluated independently of containment', () => {
  const r = recorder();
  const gates = readCommandLocalGates('D:/ws', cfg('development'), {
    exists: () => false,
    checkDevelopmentContainment: r.development,
    checkReleaseContainment: r.release,
  });
  assert.equal(gates.find((g) => g.kind === 'G-WORKSPACE-LOCAL').resolved, false);
  assert.equal(gates.find((g) => g.kind === 'G-CONTAINMENT').resolved, true);
});
