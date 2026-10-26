import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { closeServers } from '../shutdown.mjs';
import { evaluateGate } from '../gates.mjs';

test('server close waits for completion and closes idle connections', async () => {
  let callback;
  let idle = false;
  let complete = false;
  const closing = closeServers([{ close(cb) { callback = cb; }, closeIdleConnections() { idle = true; } }], 100).then(() => { complete = true; });
  assert.equal(idle, true);
  assert.equal(complete, false);
  callback();
  await closing;
  assert.equal(complete, true);
});
test('unsupported adapter, close failure and stuck connections report incomplete', async () => {
  await assert.rejects(closeServers([]), /adapter/);
  await assert.rejects(closeServers([{ close(cb) { cb(new Error('close failed')); } }]), /failed/);
  await assert.rejects(closeServers([{ close() {} }], 5), /deadline/);
});
test('populated candidate4 gate fields are insufficient', () => {
  assert.equal(evaluateGate('G-WSL', { audited_at: 'today', distro: 'Ubuntu', method: 'x', enabled_units: [], findings: 'safe', auditor: 'x' }).resolved, false);
  assert.equal(evaluateGate('G-RULE0', { decided_by: 'Founder', option: 'migrate', allowlist_or_migration_plan: 'plan' }).resolved, false);
});
test('WSL safe outcomes and evidence hashes are required', () => {
  const bytes = Buffer.from('offline audit fixture');
  const record = { schema: 'starq.lifecycle.gate/v2', scope: 'ALL_REGISTERED_DISTROS', verified_at: '2026-10-03T00:00:00Z', verifier: 'fixture', outcome: 'SAFE', evidence: [{ path: path.resolve('fixture-audit'), sha256: createHash('sha256').update(bytes).digest('hex') }], distros: [{ name: 'Ubuntu', result: 'SAFE', enabled_starq_units: [], unresolved: [] }] };
  assert.equal(evaluateGate('G-WSL', record, { read: () => bytes }).resolved, true);
  assert.equal(evaluateGate('G-WSL', record, { read: () => Buffer.from('drift') }).resolved, false);
  record.distros[0].enabled_starq_units.push('starq-bot.service');
  assert.equal(evaluateGate('G-WSL', record, { read: () => bytes }).resolved, false);
});
