/**
 * Offline tests: standalone Herdr is a required external runtime with ONE
 * declared binary/storage truth, observed read-only, never owned by Command.
 * Nothing here executes Herdr or reads a real owner record.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validateConfig, componentEnv, findEnvOverrides, standaloneHerdr } from '../config.mjs';
import { evaluateStandaloneHerdrOwner, readStandaloneHerdrGate } from '../gates.mjs';
import { runtimeSpecs } from '../../../../starq-lifecycle/runtime-policy.mjs';

const ENTRY = {
  id: 'standalone-herdr', owner_protocol: 'OPERATOR_INTERACTIVE', command_actuation: 'NONE',
  executable: 'D:\\fake\\herdr.exe', storage_root: 'D:\\fake\\herdr-data', owner_record: 'state\\standalone-herdr-owner.json',
};
const PORTS = { data: 5177, building: 5178, herdrBroker: 5188, herdr: 5179, ui: 5173 };
function config(entry = ENTRY) {
  const c = (name, deps, extra = {}) => ({ name, kind: name === 'ui' ? 'vite' : 'module', entry: `x\\${name}.mjs`, cwd: 'x', port: PORTS[name], depends_on: deps, health: { path: '/h', status: 200, json_has: ['ok'] }, ...extra });
  return {
    schema: 'starq.command.lifecycle.config/v1', workspace_root: 'D:\\fake', node: 'D:\\fake\\node.exe', host: '127.0.0.1',
    timeouts_ms: { identity: 1, health: 1, graceful_exit: 1, broker_request: 1, agent_stop: 1 },
    components: [c('data', []), c('building', []), c('herdrBroker', [], { lifecycle_token: 't', manifest: 'm' }), c('herdr', ['herdrBroker']), c('ui', ['data', 'building', 'herdr'], { vite_config: 'v' })],
    profile: { required_files: [], external_required: entry ? [entry] : [] },
  };
}
const BIN = Buffer.from('inert mock herdr bytes');
const EVIDENCE = Buffer.from('inert mock owner evidence');
const hex = (b) => createHash('sha256').update(b).digest('hex');
const record = (over = {}) => ({
  schema: 'starq.standalone-herdr.owner/v1', decided_by: 'Founder', decision_id: 'MOCK_ONLY', decided_at: '2026-10-03T00:00:00Z',
  owner_protocol: 'OPERATOR_INTERACTIVE', command_actuation: 'NONE', executable: ENTRY.executable, storage_root: ENTRY.storage_root,
  executable_sha256: hex(BIN), builder: 'builder', verifier: 'independent', verified_at: '2026-10-03T01:00:00Z',
  evidence: [{ path: 'D:\\fake\\evidence.json', sha256: hex(EVIDENCE) }], ...over,
});
const read = (p) => (p === ENTRY.executable ? BIN : p === 'D:\\fake\\evidence.json' ? EVIDENCE : (() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); })());

test('config: Command can never be declared a second standalone Herdr owner', () => {
  assert.deepEqual(validateConfig(config(), { checkFiles: false }), []);
  for (const bad of [{ command_actuation: 'START_STOP' }, { owner_protocol: 'COMMAND_LIFECYCLE' }, { executable: 'herdr' }, { storage_root: undefined }, { owner_record: 'D:\\abs.json' }]) {
    assert.ok(validateConfig(config({ ...ENTRY, ...bad }), { checkFiles: false }).length > 0, JSON.stringify(bad));
  }
  const twice = config(); twice.profile.external_required.push({ ...ENTRY });
  assert.ok(validateConfig(twice, { checkFiles: false }).some((p) => /more than once/.test(p)));
});

test('config: the broker probe receives the pinned binary; an operator HERDR_BIN is a refused second truth', () => {
  const cfg = config();
  assert.equal(componentEnv(cfg, 'herdrBroker').HERDR_BIN, ENTRY.executable);
  assert.equal(componentEnv(config(null), 'herdrBroker').HERDR_BIN, undefined);
  assert.equal(standaloneHerdr(cfg).id, 'standalone-herdr');
  assert.deepEqual(findEnvOverrides({ HERDR_BIN: 'C:\\other\\herdr.exe' }), ['HERDR_BIN=C:\\other\\herdr.exe']);
});

test('G-PROFILE: missing record, self-verification, actuation, path mismatch, hash drift and evidence drift all refuse', () => {
  assert.equal(evaluateStandaloneHerdrOwner(record(), ENTRY, { read }).resolved, true);
  assert.match(evaluateStandaloneHerdrOwner(null, ENTRY, { read }).detail, /not commissioned/);
  assert.equal(evaluateStandaloneHerdrOwner(record(), null, { read }).resolved, false);
  for (const bad of [
    { decided_by: 'agent' }, { verifier: 'builder' }, { command_actuation: 'START_STOP' }, { owner_protocol: 'COMMAND_LIFECYCLE' },
    { executable: 'C:\\other\\herdr.exe' }, { storage_root: 'C:\\other' }, { executable_sha256: hex(Buffer.from('drift')) },
    { evidence: [] }, { evidence: [{ path: 'D:\\fake\\evidence.json', sha256: hex(Buffer.from('drift')) }] }, { schema: 'v0' },
  ]) assert.equal(evaluateStandaloneHerdrOwner(record(bad), ENTRY, { read }).resolved, false, JSON.stringify(bad));
});

test('G-PROFILE: an absent record in the real workspace is unresolved, never assumed', () => {
  const ws = path.resolve(import.meta.dirname, '../../../../../..');
  const g = readStandaloneHerdrGate(ws, { read: (p, enc) => {
    if (p.endsWith('lifecycle.config.json')) return JSON.stringify(config());
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  } });
  assert.equal(g.resolved, false); assert.match(g.detail, /not commissioned/);
});

test('Rule0 inventory takes standalone Herdr binary and storage from the config, and refuses an undeclared entry', () => {
  const manifest = { agents: [] };
  const specs = runtimeSpecs('D:\\fake', config(), manifest);
  assert.ok(specs.some((s) => s.path === ENTRY.executable && s.role === 'executable' && s.owner === 'standalone-herdr'));
  assert.ok(specs.some((s) => s.path === ENTRY.storage_root && s.role === 'data' && s.recursive === true));
  assert.throws(() => runtimeSpecs('D:\\fake', config(null), manifest), /standalone-herdr/);
});

test('Rule0 inventory includes the OS tools the owner actually executes; none is assumed exempt', () => {
  const specs = runtimeSpecs('D:\\fake', config(), { agents: [] });
  for (const tool of ['powershell.exe', 'NETSTAT.EXE', 'taskkill.exe', 'conhost.exe']) {
    assert.ok(specs.some((s) => s.role === 'os-runtime' && s.path.toLowerCase().endsWith(tool.toLowerCase())), tool);
  }
});
