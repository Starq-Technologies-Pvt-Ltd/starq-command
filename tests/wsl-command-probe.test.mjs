import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWsl, discoverWindowsHost, probe } from '../scripts/lifecycle/wsl-command-probe.mjs';

test('isWsl detects microsoft kernel', () => {
  assert.equal(isWsl({ platform: 'linux', readFile: () => 'Linux version 6.6.87.2-microsoft-standard-WSL2' }), true);
});

test('isWsl false on non-linux', () => {
  assert.equal(isWsl({ platform: 'win32' }), false);
});

test('discoverWindowsHost from ip route', () => {
  const host = discoverWindowsHost({ exec: () => 'default via 172.30.160.1 dev eth0\n', readFile: () => '' });
  assert.equal(host, '172.30.160.1');
});

test('discoverWindowsHost fallback resolver', () => {
  const host = discoverWindowsHost({ exec: () => { throw new Error('no ip'); }, readFile: () => 'nameserver 10.255.255.254\n' });
  assert.equal(host, '10.255.255.254');
});

test('probe runs bounded requests with injected deps', async () => {
  const config = { components: [
    { name: 'data', port: 5177, health: { path: '/api/health', status: 200 } },
    { name: 'pm', port: 5176, health: { path: '/api/health', status: 200 } },
  ]};
  const out = await probe({
    config,
    host: '1.2.3.4',
    isWslFn: () => true,
    discoverHostFn: () => '9.9.9.9',
    httpGet: async (host, port) => ({ status: port === 5177 ? 200 : 503, contentType: 'application/json', body: '{}' }),
    timeoutMs: 10,
  });
  assert.equal(out.isWsl, true);
  assert.equal(out.windowsHost, '1.2.3.4');
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].ok, true);
  assert.equal(out.results[1].ok, false);
});

test('probe records errors without throwing', async () => {
  const config = { components: [{ name: 'x', port: 1, health: { path: '/', status: 200 } }] };
  const out = await probe({ config, host: '1.2.3.4', isWslFn: () => false, httpGet: async () => { throw new Error('boom'); } });
  assert.equal(out.results[0].ok, false);
  assert.equal(out.results[0].error, 'boom');
});
