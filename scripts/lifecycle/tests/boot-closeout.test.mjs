/**
 * Cross-boot closeout proof.
 *
 * The point of these cases is that the proof is FALSIFIABLE: every way of not
 * knowing must come back NOT PROVEN, so this can never become a blanket excuse
 * to declare a family closed. Only the one positive case passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { provablyGoneAcrossBoot, systemBootTime, SKEW_MARGIN_MS } from '../boot-closeout.mjs';

const NODE = 'D:\\node\\node.exe';
const LAUNCHED = '2026-10-30T08:04:52.552Z';
const launchedMs = Date.parse(LAUNCHED);

/** A child record as the lifecycle state file stores one. */
const child = (over = {}) => ({
  name: 'pm',
  pid: 47752,
  exe: NODE,
  created_at: '2026-10-30T08:04:52.5090320Z',
  launched_at: LAUNCHED,
  containment: { kind: 'WINDOWS_JOB_V1' },
  ...over,
});

const gone = async () => new Map([[47752, { pid: 47752, found: false }]]);
const alive = async () => new Map([[47752, {
  pid: 47752, found: true, name: 'node.exe', exe: NODE, created: child().created_at,
}]]);
const noListeners = async () => [];

const bootAfter = new Date(launchedMs + 28 * 3600 * 1000);
const ctx = (over = {}) => ({
  expectedExe: NODE, port: 5176, inspect: gone, listListeners: noListeners, bootTime: bootAfter, ...over,
});

test('a reboot after the launch proves the whole family gone', async () => {
  const r = await provablyGoneAcrossBoot(child(), ctx());
  assert.equal(r.proven, true);
  assert.match(r.reason, /system booted after this launch/);
  assert.equal(r.basis.root_verdict, 'GONE');
  assert.deepEqual(r.basis.port_listener_pids, []);
  // The basis is what makes the decision auditable rather than asserted.
  assert.equal(r.basis.launched_at, LAUNCHED);
  assert.ok(r.basis.booted_after_launch_by_ms > 0);
});

test('a boot BEFORE the launch proves nothing', async () => {
  const r = await provablyGoneAcrossBoot(child(), ctx({ bootTime: new Date(launchedMs - 60_000) }));
  assert.equal(r.proven, false);
  assert.match(r.reason, /did not boot after this launch/);
});

test('a boot inside the skew margin proves nothing', async () => {
  const r = await provablyGoneAcrossBoot(child(), ctx({ bootTime: new Date(launchedMs + SKEW_MARGIN_MS - 1) }));
  assert.equal(r.proven, false);
  assert.match(r.reason, /clock skew/);
});

test('a live root that still matches the record contradicts the reboot and proves nothing', async () => {
  const r = await provablyGoneAcrossBoot(child(), ctx({ inspect: alive }));
  assert.equal(r.proven, false);
  assert.match(r.reason, /contradicts the reboot/);
  assert.equal(r.basis.root_verdict, 'MATCH');
});

test('a reused PID belonging to another executable is FOREIGN, which is still not ours', async () => {
  const foreign = async () => new Map([[47752, {
    pid: 47752, found: true, name: 'other.exe', exe: 'D:\\other\\other.exe', created: '2026-10-31T18:00:00.0000000Z',
  }]]);
  const r = await provablyGoneAcrossBoot(child(), ctx({ inspect: foreign }));
  assert.equal(r.proven, true);
  assert.equal(r.basis.root_verdict, 'FOREIGN');
});

test('an unclassifiable root proves nothing', async () => {
  const murky = async () => new Map([[47752, { pid: 47752, found: true, exe: null, created: null }]]);
  const r = await provablyGoneAcrossBoot(child(), ctx({ inspect: murky }));
  assert.equal(r.proven, false);
  assert.match(r.reason, /not classifiable/);
});

test('a listener still holding the recorded port proves nothing', async () => {
  const held = async () => [{ address: '127.0.0.1', port: 5176, pid: 1234 }];
  const r = await provablyGoneAcrossBoot(child(), ctx({ listListeners: held }));
  assert.equal(r.proven, false);
  assert.match(r.reason, /still has a listener/);
  assert.deepEqual(r.basis.port_listener_pids, [1234]);
});

test('a missing launch timestamp proves nothing', async () => {
  const r = await provablyGoneAcrossBoot(child({ launched_at: undefined, created_at: undefined }), ctx());
  assert.equal(r.proven, false);
  assert.match(r.reason, /no parseable launch time/);
});

test('an unreadable boot time proves nothing', async () => {
  const r = await provablyGoneAcrossBoot(child(), ctx({ bootTime: null }));
  assert.equal(r.proven, false);
  assert.match(r.reason, /boot time unreadable/);
});

test('a failed inspection proves nothing', async () => {
  const r = await provablyGoneAcrossBoot(child(), ctx({
    inspect: async () => { throw new Error('Access is denied'); },
  }));
  assert.equal(r.proven, false);
  assert.match(r.reason, /root inspection failed/);
});

test('a failed listener inspection proves nothing', async () => {
  const r = await provablyGoneAcrossBoot(child(), ctx({
    listListeners: async () => { throw new Error('netstat failed'); },
  }));
  assert.equal(r.proven, false);
  assert.match(r.reason, /listener inspection failed/);
});

test('no child record proves nothing', async () => {
  assert.equal((await provablyGoneAcrossBoot(null, ctx())).proven, false);
});

test('systemBootTime refuses a nonsensical uptime instead of inventing a boot', () => {
  assert.equal(systemBootTime({ uptimeSeconds: () => Number.NaN }), null);
  assert.equal(systemBootTime({ uptimeSeconds: () => -1 }), null);
  assert.equal(systemBootTime({ uptimeSeconds: () => { throw new Error('no uptime'); } }), null);
  const boot = systemBootTime({ uptimeSeconds: () => 3600, now: () => Date.parse('2026-10-31T12:00:00Z') });
  assert.equal(boot.toISOString(), '2026-10-31T11:00:00.000Z');
});
