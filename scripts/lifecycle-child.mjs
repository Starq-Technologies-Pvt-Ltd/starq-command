#!/usr/bin/env node
/**
 * STARQ // COMMAND lifecycle child host.
 *
 * Every control-plane component runs inside one of these, spawned ONLY by
 * command-lifecycle.mjs. It:
 *   1. opens the per-instance control pipe FIRST, so the owner can prove this
 *      is the instance it launched (HMAC over the launch token; see control.mjs);
 *   2. then runs the component UNMODIFIED: a module entry is imported as if it
 *      were the main script (process.argv[1] is set to it, so each entry's own
 *      direct-run guard fires exactly as before); the UI runs Vite through its
 *      JS API so it shares this process and this pipe;
 *   3. exits gracefully when, and only when, the owner sends an authenticated
 *      shutdown. There is no other control input and no self-restart.
 *
 * data-service.mjs is frozen; it is imported, never edited.
 */
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mac, macEqual, pipePath } from './lifecycle/control.mjs';
import { closeServers } from './lifecycle/shutdown.mjs';

const NAME = process.env.STARQ_LC_NAME;
const INSTANCE = process.env.STARQ_LC_INSTANCE;
const TOKEN = process.env.STARQ_LC_TOKEN;
const KIND = process.env.STARQ_LC_KIND;
const ENTRY = process.env.STARQ_LC_ENTRY;
const PORT = Number(process.env.STARQ_LC_PORT);
const HOST = process.env.STARQ_LC_HOST;
const VITE_CONFIG = process.env.STARQ_LC_VITE_CONFIG;
const ROOT = process.env.STARQ_LC_ROOT;
// The token must not leak to anything this component spawns.
for (const k of Object.keys(process.env)) if (k.startsWith('STARQ_LC_')) delete process.env[k];

const log = (msg) => process.stdout.write(`[lifecycle-child ${NAME} ${new Date().toISOString()}] ${msg}\n`);

if (!NAME || !INSTANCE || !TOKEN || !ENTRY || !['module', 'vite'].includes(KIND)) {
  process.stderr.write('lifecycle-child: missing launch environment; refusing to run\n');
  process.exit(64);
}

let viteServer = null;
let componentModule = null;
let shuttingDown = false;

async function gracefulExit(why) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`graceful shutdown (${why})`);
  try {
    if (NAME === 'herdrBroker') throw new Error('broker shutdown requires authenticated drain channel');
    if (viteServer) {
      let timer;
      try {
        await Promise.race([viteServer.close(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Vite shutdown deadline exceeded')), 8000);
        })]);
      } finally { clearTimeout(timer); }
    } else {
      await closeServers([componentModule?.server ?? componentModule?.lifecycleService?.server]);
    }
    await closeServers([control]);
    process.exitCode = 0;
  } catch (err) {
    log(`shutdown error: ${err.message}`);
    process.exitCode = 1;
    shuttingDown = false;
  }
}

const control = net.createServer((socket) => {
  let buf = '';
  socket.on('data', (d) => {
    buf += d;
    const i = buf.indexOf('\n');
    if (i < 0) { if (buf.length > 4096) socket.destroy(); return; }
    let msg;
    try { msg = JSON.parse(buf.slice(0, i)); } catch { socket.end('{"error":"malformed"}\n'); return; }
    const nonce = typeof msg.nonce === 'string' && /^[a-f0-9]{32}$/.test(msg.nonce) ? msg.nonce : null;
    if (!nonce) { socket.end('{"error":"nonce required"}\n'); return; }
    if (msg.op === 'identity') {
      socket.end(`${JSON.stringify({ name: NAME, instance_id: INSTANCE, pid: process.pid, nonce,
        mac: mac(TOKEN, 'identity', nonce, process.pid, INSTANCE) })}\n`);
      return;
    }
    if (msg.op === 'shutdown') {
      if (!macEqual(msg.mac, mac(TOKEN, 'shutdown', nonce, process.pid, INSTANCE))) {
        log('REFUSED unauthenticated shutdown request');
        socket.end('{"accepted":false,"error":"unauthenticated"}\n');
        return;
      }
      socket.end(`${JSON.stringify({ accepted: true, nonce, mac: mac(TOKEN, 'shutdown-ack', nonce, process.pid, INSTANCE) })}\n`,
        () => { setImmediate(() => gracefulExit('owner request')); });
      return;
    }
    socket.end('{"error":"unknown op"}\n');
  });
  socket.on('error', () => {});
});

control.on('error', (err) => {
  // Another process already owns this instance's pipe name: we cannot be proven.
  process.stderr.write(`lifecycle-child: control pipe unavailable (${err.message}); exiting\n`);
  process.exit(65);
});

control.listen(pipePath(INSTANCE), async () => {
  log(`control pipe ready; starting ${KIND} ${ENTRY}`);
  try {
    if (KIND === 'vite') {
      const { createServer } = await import(pathToFileURL(ENTRY).href);
      viteServer = await createServer({
        configFile: VITE_CONFIG, root: ROOT, clearScreen: false,
        server: { host: HOST, port: PORT, strictPort: true },
      });
      await viteServer.listen();
      log(`vite listening on ${HOST}:${PORT}`);
    } else {
      process.argv[1] = path.resolve(ENTRY);
      componentModule = await import(pathToFileURL(ENTRY).href);
    }
  } catch (err) {
    process.stderr.write(`lifecycle-child: component failed to start: ${err.stack || err.message}\n`);
    process.exit(70);
  }
});
