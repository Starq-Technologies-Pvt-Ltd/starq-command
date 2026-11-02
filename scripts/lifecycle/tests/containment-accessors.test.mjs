/**
 * Launch and recorded-descriptor containment have different preconditions.
 *
 * Incident (Founder acceptance run, 1 Nov): `start` reached READY on this
 * machine, then `stop` died with
 *
 *   G-CONTAINMENT-DEV: runtime containment evidence failed: reliable process
 *   identification failed: authenticated started receipt has no root_pid
 *
 * with all services still running. `stop` had asked the companion for
 * containment options, and by default that runs a RUNTIME PROBE: it launches a
 * throwaway child and gives it a fixed 2.5 s to write a signed started receipt.
 * Stopping running services therefore depended on a brand new child spawning
 * in time. `waitGone` polls, and did this on every iteration.
 *
 * The probe stays exactly where it belongs - before LAUNCHING - and these tests
 * pin both halves: launch still fails closed when containment cannot be proven,
 * and acting on an already-issued descriptor never needs the probe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContainmentAccessors } from '../owner.mjs';

const PROBE_FAILURE = 'G-CONTAINMENT-DEV: runtime containment evidence failed: reliable process identification failed: authenticated started receipt has no root_pid';

/** A companion whose runtime probe always fails, and which records how it was asked. */
function failingProbeCompanion() {
  const asked = [];
  const containmentOptions = (workspace, stateDir, { tier, verifyRuntime }) => {
    asked.push({ workspace, stateDir, tier, verifyRuntime });
    if (verifyRuntime !== false) throw new Error(PROBE_FAILURE);
    return { guardian: 'JobGuardian.exe', guardianSha256: 'a'.repeat(64), stateDir, tier };
  };
  const nativeContainment = (options) => ({
    options,
    launch: () => ({ launched: true }),
    status: async () => ({ owned: true, closed: true, active: 0, guardian_gone: true, root_gone: true }),
    stop: async () => ({ outcome: 'GONE', owned: true, closed: true, active: 0 }),
    receipt: () => ({ root_pid: 4242 }),
  });
  return { asked, containmentOptions, nativeContainment };
}

const accessors = (companion) => createContainmentAccessors({
  containmentOptions: companion.containmentOptions,
  nativeContainment: companion.nativeContainment,
  resolve: () => ({ workspace: 'D:\\ws', stateDir: 'D:\\ws\\runtime', tier: 'development' }),
});

test('launching asks for the runtime probe, and FAILS CLOSED when it cannot be proven', () => {
  const companion = failingProbeCompanion();
  assert.throws(() => accessors(companion).forLaunch(), /no root_pid/);
  assert.deepEqual(companion.asked.map((a) => a.verifyRuntime), [true]);
});

test('a failing runtime probe cannot block status, stop or receipt on an issued descriptor', async () => {
  const companion = failingProbeCompanion();
  const recorded = accessors(companion).forRecorded();

  assert.equal((await recorded.status({ kind: 'WINDOWS_JOB_V1' })).closed, true);
  assert.equal((await recorded.stop({ kind: 'WINDOWS_JOB_V1' }, { force: false, graceMs: 1 })).outcome, 'GONE');
  assert.equal(recorded.receipt({ kind: 'WINDOWS_JOB_V1' }).root_pid, 4242);

  assert.deepEqual(
    companion.asked.map((a) => a.verifyRuntime),
    [false],
    'acting on a recorded descriptor must never request the throwaway-child probe',
  );
});

test('every polling iteration is cheap: repeated recorded access never requests the probe', async () => {
  const companion = failingProbeCompanion();
  const a = accessors(companion);
  for (let i = 0; i < 50; i += 1) await a.forRecorded().status({ kind: 'WINDOWS_JOB_V1' });
  assert.equal(companion.asked.length, 50);
  assert.ok(companion.asked.every((x) => x.verifyRuntime === false), 'a probe was requested while polling');
});

test('the unprobed accessor cannot be used to launch anything', () => {
  const recorded = accessors(failingProbeCompanion()).forRecorded();
  assert.equal('launch' in recorded, false);
  assert.deepEqual(Object.keys(recorded).sort(), ['receipt', 'status', 'stop']);
});

test('workspace, state directory and tier are resolved lazily on every call', () => {
  const companion = failingProbeCompanion();
  let tier = 'development';
  const a = createContainmentAccessors({
    containmentOptions: companion.containmentOptions,
    nativeContainment: companion.nativeContainment,
    resolve: () => ({ workspace: 'D:\\ws', stateDir: 'D:\\ws\\runtime', tier }),
  });
  a.forRecorded();
  tier = 'release';
  a.forRecorded();
  assert.deepEqual(companion.asked.map((x) => x.tier), ['development', 'release']);
});
