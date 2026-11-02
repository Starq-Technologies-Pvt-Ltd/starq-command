/**
 * Incident (acceptance run, 2 Nov): after a clean stop, `netstat` still listed the
 * service ports as LISTENING under pid 0, and the lifecycle refused the next start
 * with "ports occupied: 5177<-pid 0" even though bind() on those ports succeeds.
 * pid 0 is the System Idle Process; it cannot own a socket. These rows are kernel
 * records of sockets whose process is gone, and name nobody.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { listListeners } from '../inspect.mjs';

const HEADER = '\r\nActive Connections\r\n\r\n  Proto  Local Address          Foreign Address        State           PID\r\n';
const fake = (rows) => (exe, args, opts, cb) => cb(null, args.includes('tcp') ? HEADER + rows.join('\r\n') + '\r\n' : HEADER);

test('listListeners drops pid 0 ghost rows but keeps every real owner', async () => {
  const out = await listListeners({
    execFileImpl: fake([
      '  TCP    127.0.0.1:5177         0.0.0.0:0              LISTENING       0',
      '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       0',
      '  TCP    127.0.0.1:5176         0.0.0.0:0              LISTENING       4242',
      '  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4',
    ]),
  });
  assert.deepEqual(out.map((r) => [r.port, r.pid]).sort((a, b) => a[0] - b[0]), [[445, 4], [5176, 4242]]);
});
