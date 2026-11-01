/**
 * The standalone profile must start without Herdr Floor.
 *
 * Review finding (PR #19, Room #17430): the ordinary command-local one-click path
 * pinned Node to herdr-floor\runtime\nodejs\node.exe, imported Herdr Floor's
 * containment-config at load and refused to start when it was absent, so Command
 * was not standalone. Containment, the guardian binary and the approved Node
 * runtime now come from Command's own package. These tests pin the two halves:
 * nothing on the local path reaches for Herdr Floor, and containment stays
 * strictly fail-closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_ROOT, RECEIPT_WAIT_MS, containmentRoot, verifyNodeRuntime, localDevelopmentGate, localReleaseGate, localContainmentOptions,
} from '../containment/local-gate.mjs';
import { loadConfig, validateConfig, ConfigError } from '../config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CONFIG = path.join(APP_ROOT, 'lifecycle.command-local.config.json');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** A throwaway app root holding a copy of the shipped containment package. */
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'starq-standalone-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(containmentRoot(APP_ROOT), path.join(dir, 'runtime', 'containment'), { recursive: true });
  // Only the bytes are ever hashed by these tests, so a small stand-in will do.
  const node = path.join(dir, 'runtime', 'node', 'node.exe');
  mkdirSync(path.dirname(node), { recursive: true });
  writeFileSync(node, 'stand-in node runtime bytes');
  return { dir, node };
}
const pinNode = (dir, bytesOfNode) => {
  const file = path.join(dir, 'runtime', 'containment', 'node-pins.json');
  const pins = JSON.parse(readFileSync(file, 'utf8'));
  pins.runtimes = [{ version: 'test', platform: 'win32-x64', sha256: sha256(bytesOfNode) }];
  writeFileSync(file, JSON.stringify(pins));
};

// ── independence from Herdr Floor ────────────────────────────────────────────

test('the local profile names a Node runtime inside the install, not Herdr Floor', () => {
  const raw = JSON.parse(readFileSync(LOCAL_CONFIG, 'utf8'));
  assert.doesNotMatch(raw.node, /herdr/i, 'the local profile must not pin Node to Herdr Floor');
  assert.equal(path.isAbsolute(raw.node), false, 'it is named relative to the install');
  assert.deepEqual(validateConfig(raw, { checkFiles: false }), []);
});

test('loadConfig resolves the relative runtime against the config file; it cannot climb out of the install', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'starq-cfgnode-'));
  try {
    const raw = JSON.parse(readFileSync(LOCAL_CONFIG, 'utf8'));
    raw.workspace_root = dir;
    const write = (node, profile = raw.profile) => {
      const file = path.join(dir, 'lifecycle.command-local.config.json');
      writeFileSync(file, JSON.stringify({ ...raw, node, profile }));
      return file;
    };
    const cfg = loadConfig(write('runtime/node/node.exe'), { checkFiles: false });
    assert.equal(cfg.node, path.resolve(dir, 'runtime', 'node', 'node.exe'));
    assert.throws(() => loadConfig(write('..\\outside\\node.exe'), { checkFiles: false }), ConfigError);
    assert.throws(() => loadConfig(write('../outside/node.exe'), { checkFiles: false }), ConfigError);
    // other profiles keep the absolute-path rule
    const online = JSON.parse(readFileSync(path.join(APP_ROOT, 'lifecycle.config.json'), 'utf8'));
    online.node = 'runtime/node/node.exe';
    assert.ok(validateConfig(online, { checkFiles: false }).some((m) => /node must be an absolute path/.test(m)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('containment gates, options and launch run with Herdr Floor and the lifecycle package absent', (t) => {
  const { dir, node } = fixture(t);
  const nowhere = path.join(dir, 'does-not-exist');
  // A fresh process, so nothing cached from an environment that HAS Herdr Floor can help.
  const probe = [
    "import { localDevelopmentGate, localContainmentOptions } from './scripts/lifecycle/containment/local-gate.mjs';",
    "import { readCommandLocalGates } from './scripts/lifecycle/gates.mjs';",
    'const nodePath = process.argv[1];',
    'const gate = localDevelopmentGate(process.cwd(), { nodePath, verifyRuntime: false });',
    'const opts = localContainmentOptions(process.cwd(), process.cwd(), { tier: "development", verifyRuntime: false, nodePath });',
    'const gates = readCommandLocalGates(process.cwd(), { profile: { tier: "development", required_components: [] }, node: nodePath, components: [] }, { exists: () => true, checkDevelopmentContainment: (ws, c) => localDevelopmentGate(process.cwd(), { nodePath: c.node, verifyRuntime: false }) });',
    'console.log(JSON.stringify({ gate: gate.resolved, opts: Boolean(opts.guardian), gates: gates.map((g) => [g.kind, g.resolved]) }));',
  ].join(' ');
  const appCopy = path.join(dir, 'app');
  cpSync(path.join(APP_ROOT, 'scripts'), path.join(appCopy, 'scripts'), { recursive: true, filter: (s) => !s.includes('tests') });
  cpSync(path.join(APP_ROOT, 'server'), path.join(appCopy, 'server'), { recursive: true });
  cpSync(path.join(dir, 'runtime'), path.join(appCopy, 'runtime'), { recursive: true });
  cpSync(path.join(APP_ROOT, 'package.json'), path.join(appCopy, 'package.json'));
  pinNode(appCopy, readFileSync(node));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe, path.join(appCopy, 'runtime', 'node', 'node.exe')], {
    cwd: appCopy, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, STARQ_HERDR_FLOOR_ROOT: nowhere, STARQ_LIFECYCLE_ROOT: nowhere, STARQ_WORKSPACE: dir },
  });
  assert.equal(r.status, 0, `${r.stderr}`.slice(0, 800));
  const got = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(got.gate, true, 'the development gate resolves from Command\'s own package');
  assert.equal(got.opts, true);
  assert.deepEqual(got.gates.find((g) => g[0] === 'G-CONTAINMENT'), ['G-CONTAINMENT', true]);
});

test('no module on the local containment path imports Herdr Floor or the lifecycle package', () => {
  const files = [
    path.join(APP_ROOT, 'scripts', 'lifecycle', 'containment', 'local-gate.mjs'),
    path.join(APP_ROOT, 'scripts', 'lifecycle', 'containment', 'windows-job.mjs'),
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8').split('\n').filter((l) => /^\s*import\b|\bimportExternalComponent\b|\bresolveExternalComponent\b/.test(l)).join('\n');
    assert.doesNotMatch(src, /herdr|starq-lifecycle|external-components/i, `${path.basename(f)} must not reach for an external component`);
  }
  // and the shipped package is complete on its own
  const names = readdirSync(containmentRoot(APP_ROOT));
  for (const n of ['JobGuardian.exe', 'JobGuardian.cs', 'guardian-build.json', 'node-pins.json']) assert.ok(names.includes(n), `runtime/containment/${n} ships with Command`);
  assert.ok(statSync(path.join(containmentRoot(APP_ROOT), 'JobGuardian.exe')).size > 0);
});

// ── containment is still fail-closed ────────────────────────────────────────

test('REFUSES a Node runtime that is not on the approved list', (t) => {
  const { dir, node } = fixture(t);
  pinNode(dir, Buffer.from('some other build'));
  const gate = localDevelopmentGate(dir, { nodePath: node, verifyRuntime: false });
  assert.equal(gate.resolved, false);
  assert.match(gate.detail, /not an approved build/);
  assert.throws(() => verifyNodeRuntime(node, dir), /not an approved build/);
  assert.throws(() => localContainmentOptions(dir, dir, { tier: 'development', verifyRuntime: false, nodePath: node }), /not an approved build/);
});

test('REFUSES a relative or missing Node runtime path', (t) => {
  const { dir } = fixture(t);
  assert.equal(localDevelopmentGate(dir, { nodePath: 'node.exe', verifyRuntime: false }).resolved, false);
  assert.equal(localDevelopmentGate(dir, { nodePath: path.join(dir, 'runtime', 'node', 'absent.exe'), verifyRuntime: false }).resolved, false);
  assert.equal(localDevelopmentGate(dir, { verifyRuntime: false }).resolved, false);
});

test('REFUSES a tampered guardian binary or source', (t) => {
  for (const file of ['JobGuardian.exe', 'JobGuardian.cs']) {
    const { dir, node } = fixture(t);
    pinNode(dir, readFileSync(node));
    const target = path.join(dir, 'runtime', 'containment', file);
    writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from(' ')]));
    const gate = localDevelopmentGate(dir, { nodePath: node, verifyRuntime: false });
    assert.equal(gate.resolved, false, `${file} drift must be refused`);
    assert.match(gate.detail, /pin drift/);
  }
});

test('REFUSES when the runtime probe cannot prove containment', (t) => {
  const { dir, node } = fixture(t);
  pinNode(dir, readFileSync(node));
  const gate = localDevelopmentGate(dir, {
    nodePath: node, scratchRoot: path.join(dir, 'probe'),
    probe: () => ({ ok: false, error: 'authenticated started receipt has no root_pid', cleanup: 'UNVERIFIED_RETAINED' }),
  });
  assert.equal(gate.resolved, false);
  assert.match(gate.detail, /runtime containment evidence failed: authenticated started receipt has no root_pid/);
});

test('the probe waits long enough for a cold first launch (a measured 4.5 s, not the old 2.5 s)', () => {
  assert.ok(RECEIPT_WAIT_MS >= 15000, `RECEIPT_WAIT_MS=${RECEIPT_WAIT_MS} would fail a contained child whose first launch is scanned by the OS`);
});

test('the release tier stays unresolved without an independent exact-build proof', () => {
  const gate = localReleaseGate(APP_ROOT);
  assert.equal(gate.resolved, false);
  assert.match(gate.detail, /independent compatibility proof required/);
});

test('the guardian pins shipped with Command match their build record', () => {
  const root = containmentRoot(APP_ROOT);
  const build = JSON.parse(readFileSync(path.join(root, 'guardian-build.json'), 'utf8'));
  assert.equal(sha256(readFileSync(path.join(root, 'JobGuardian.exe'))), build.binary_sha256);
  assert.equal(sha256(readFileSync(path.join(root, 'JobGuardian.cs'))), build.source_sha256);
});

// ── the real thing, when this machine can do it ─────────────────────────────

const canProbe = process.platform !== 'win32'
  ? `requires Windows Job Objects (current OS: ${process.platform})`
  : (() => { try { verifyNodeRuntime(process.execPath); return false; } catch { return 'the running Node build is not on the approved list'; } })();

test('the real runtime probe proves containment with the shipped guardian', { skip: canProbe }, (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'starq-probe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const gate = localDevelopmentGate(APP_ROOT, { nodePath: process.execPath, scratchRoot: path.join(dir, 'probe') });
  assert.equal(gate.resolved, true, gate.detail);
  assert.equal(gate.runtime_containment.assigned_before_resume, true);
  assert.equal(gate.runtime_containment.interrupted_recovery_outcome, 'GONE');
  assert.equal(gate.runtime_containment.cleanup, 'VERIFIED_AND_REMOVED');
});

void HERE;

// ── the one-click launcher ──────────────────────────────────────────────────

test('the launcher provisions Node only from an allowlisted hash, without cmdlets that may not autoload', () => {
  const ps1 = readFileSync(path.join(APP_ROOT, 'scripts', 'command-local-start.ps1'), 'utf8');
  assert.match(ps1, /node-pins\.json/, 'the allowlist is the committed node-pins.json');
  assert.match(ps1, /\$approved -contains/, 'a candidate is copied only if its hash is on that list');
  const code = ps1.split('\n').filter((l) => !l.trim().startsWith('#')).join(' ');
  assert.doesNotMatch(code, /herdr/i, 'the launcher executes nothing that refers to Herdr Floor');
  // Run from pwsh, Windows PowerShell inherits a module path where
  // Microsoft.PowerShell.Utility does not autoload: Get-FileHash was "not
  // recognized" and the one-click start was refused (acceptance run n).
  assert.doesNotMatch(code, /Get-FileHash/, 'hash with .NET so the launcher works however it was started');
});
