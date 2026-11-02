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
      // Prefer a server the component exports; otherwise close every TCP server it
      // bound in this process (recorded by the listen() wrapper above). PM creates
      // its server inside a direct-run block and exports nothing, so without this
      // fallback an owner stop request could never be honoured for it.
      const exported = componentModule?.server ?? componentModule?.lifecycleService?.server;
      await closeServers(exported ? [exported] : [...boundServers].filter((s) => s !== control));
    }
    await closeServers([control]);
    process.exitCode = 0;
    // The listeners are closed; a component's own timers (PM's automation loop)
    // must not keep a stopped service alive past the owner's grace period.
    setTimeout(() => process.exit(0), 250);
  } catch (err) {
    log(`shutdown error: ${err.message}`);
    process.exitCode = 1;
    shuttingDown = false;
  }
}

/*
  Observe binds rather than hunting for exports.

  Components expose their server differently and some do not expose it at all:
  the data service exports `server`, Vite keeps an `httpServer`, and the
  herdr-floor broker creates its server inside compose() and exports only that
  factory. Guessing export shapes would be fragile and would mean editing
  external components, including the frozen data service.

  Instead the host records every TCP server that successfully binds inside THIS
  process, by wrapping listen() before the component is imported. The control
  pipe binds a named pipe, whose address() is a string rather than {port}, so it
  is naturally excluded below.
*/
const boundServers = new Set();
const nativeListen = net.Server.prototype.listen;
net.Server.prototype.listen = function patchedListen(...args) {
  this.once('listening', () => boundServers.add(this));
  this.once('close', () => boundServers.delete(this));
  return nativeListen.apply(this, args);
};

/**
 * Every address this component is really listening on. Returns [] before the
 * component has bound, which is a truthful "not yet", never a guess.
 */
function boundAddresses() {
  const out = [];
  const seen = new Set();
  for (const s of boundServers) {
    let a;
    try { a = s.address?.(); } catch { a = null; }
    if (!a || typeof a !== 'object' || !Number.isInteger(a.port)) continue;
    const key = `${a.address}:${a.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ address: a.address, port: a.port, family: a.family ?? null });
  }
  // Stable order so the MAC is reproducible for the same set of addresses.
  return out.sort((x, y) => (x.port - y.port) || String(x.address).localeCompare(String(y.address)));
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
    /*
      Where is this component ACTUALLY listening?

      Readiness used to require a matching LISTENING row from the OS TCP table,
      owned by the launched pid. On this machine that table does not reliably
      report loopback listeners even while a service is demonstrably serving
      HTTP, so a healthy child could never be marked ready and `start` failed at
      the first component whose row was missing.

      The component itself knows the answer: `server.address()` is the kernel's
      reply to its own bind. We already have an authenticated channel to it, so
      we ask it here instead of asking the OS about it. The addresses are folded
      into the MAC, so a process that does not hold the launch token can neither
      answer nor alter the answer.
    */
    if (msg.op === 'bound') {
      const addresses = boundAddresses();
      socket.end(`${JSON.stringify({
        name: NAME, instance_id: INSTANCE, pid: process.pid, nonce, addresses,
        mac: mac(TOKEN, `bound|${JSON.stringify(addresses)}`, nonce, process.pid, INSTANCE),
      })}\n`);
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
