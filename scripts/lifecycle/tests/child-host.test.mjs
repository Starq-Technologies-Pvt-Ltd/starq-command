/**
 * Real-OS test of the child host + control pipe + inspection, using a throwaway
 * module on an ephemeral port. No Starq component and no Starq port is touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { CHILD_HOST } from '../owner.mjs';
import { proveInstance, requestShutdown, pipePath } from '../control.mjs';
import { inspectProcesses, osVerdict } from '../inspect.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('child host: pipe identity proof, unauthenticated shutdown refused, authenticated shutdown exits gracefully', { skip: process.platform !== 'win32' || process.env.STARQ_AUTHORIZED_LIVE_TESTS !== '1' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'starq-child-'));
  const entry = path.join(dir, 'svc.mjs');
  // Mimics a component with a direct-run guard, like data-service.mjs.
  writeFileSync(entry, [
    "import http from 'node:http';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "export const server = http.createServer((q, s) => s.end('ok'));",
    "if (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {",
    "  server.listen(0, '127.0.0.1', () => console.log('svc up'));",
    "}",
  ].join('\n'));
  const instance = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('base64url');
  const child = spawn(process.execPath, [CHILD_HOST], {
    env: { ...process.env, STARQ_LC_NAME: 'data', STARQ_LC_INSTANCE: instance, STARQ_LC_TOKEN: token, STARQ_LC_KIND: 'module', STARQ_LC_ENTRY: entry, STARQ_LC_PORT: '0', STARQ_LC_HOST: '127.0.0.1', STARQ_LC_ROOT: dir },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  try {
    for (let i = 0; i < 100 && !out.includes('svc up'); i += 1) await sleep(50);
    assert.match(out, /svc up/, `entry ran under its own direct-run guard: ${out}`);

    const info = (await inspectProcesses([child.pid])).get(child.pid);
    assert.equal(info.found, true);
    const rec = { name: 'data', pid: child.pid, instance_id: instance, token, exe: info.exe, created_at: info.created };
    assert.equal(osVerdict(rec, info, process.execPath).verdict, 'MATCH');
    assert.deepEqual(await proveInstance(rec).then((r) => r.ok), true);
    assert.equal((await proveInstance({ ...rec, token: 'wrong-token' })).ok, false, 'wrong token fails the MAC');
    assert.equal((await proveInstance({ ...rec, pid: rec.pid + 1 })).ok, false, 'pid mismatch fails');

    const forged = await requestShutdown({ ...rec, token: 'forged' });
    assert.equal(forged.ok, false, 'a shutdown without the launch token is refused');
    assert.equal(child.exitCode, null, 'and the child is still running');

    const ack = await requestShutdown(rec);
    assert.equal(ack.ok, true);
    assert.equal(await exited, 0, 'graceful exit code 0');
    const after = (await inspectProcesses([child.pid])).get(child.pid);
    assert.equal(osVerdict(rec, after, process.execPath).verdict, after.found ? 'FOREIGN' : 'GONE');
    assert.match(out, /graceful shutdown \(owner request\)/);
  } finally {
    if (child.exitCode === null) child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('child host refuses to run without its launch environment', { skip: process.platform !== 'win32' || process.env.STARQ_AUTHORIZED_LIVE_TESTS !== '1' }, async () => {
  const child = spawn(process.execPath, [CHILD_HOST], { env: { ...process.env, STARQ_LC_NAME: '' }, stdio: 'ignore', windowsHide: true });
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 64);
});

test('pipePath rejects anything but a 32-hex instance id', () => {
  assert.throws(() => pipePath('..\\..\\evil'));
  assert.match(pipePath('a'.repeat(32)), /^\\\\\.\\pipe\\starq-command-a{32}$/);
});
