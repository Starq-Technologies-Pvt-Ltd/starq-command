/**
 * Per-instance control pipe: launch-identity proof and graceful shutdown.
 *
 * Each child host listens on \\.\pipe\starq-command-<instance_id>. The launch
 * token never crosses the pipe: both directions are HMAC-SHA256 over
 * (op | nonce | pid | instance_id). A process squatting the pipe name cannot
 * answer without the token, and a shutdown MAC computed for one pid is useless
 * against another.
 */
import net from 'node:net';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function pipePath(instanceId) {
  if (!/^[a-f0-9]{32}$/.test(instanceId)) throw new Error(`invalid instance id ${JSON.stringify(instanceId)}`);
  return `\\\\.\\pipe\\starq-command-${instanceId}`;
}

export function mac(token, op, nonce, pid, instanceId) {
  return createHmac('sha256', token).update(`${op}|${nonce}|${pid}|${instanceId}`).digest('hex');
}

export function macEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function exchange(pipe, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipe);
    let buf = '';
    const done = (fn, v) => { clearTimeout(timer); socket.destroy(); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('control pipe timeout')), timeoutMs);
    socket.on('connect', () => socket.write(`${JSON.stringify(message)}\n`));
    socket.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i >= 0) {
        try { done(resolve, JSON.parse(buf.slice(0, i))); } catch (e) { done(reject, new Error('control pipe sent malformed reply')); }
      }
    });
    socket.on('error', (e) => done(reject, e));
  });
}

/**
 * Prove a recorded child is THE instance this owner launched.
 * @returns {Promise<{ok: boolean, detail: string}>} never throws
 */
export async function proveInstance(child, { timeoutMs = 2000, exchangeImpl = exchange } = {}) {
  const nonce = randomBytes(16).toString('hex');
  let reply;
  try {
    reply = await exchangeImpl(pipePath(child.instance_id), { op: 'identity', nonce }, timeoutMs);
  } catch (err) {
    return { ok: false, detail: `control pipe unreachable: ${err.message}` };
  }
  if (!reply || reply.nonce !== nonce) return { ok: false, detail: 'control pipe reply nonce mismatch' };
  if (reply.pid !== child.pid) return { ok: false, detail: `control pipe answered for pid ${reply.pid}, recorded ${child.pid}` };
  if (reply.instance_id !== child.instance_id || reply.name !== child.name) return { ok: false, detail: 'control pipe instance/name mismatch' };
  if (!macEqual(reply.mac, mac(child.token, 'identity', nonce, child.pid, child.instance_id))) {
    return { ok: false, detail: 'control pipe failed the instance proof (MAC)' };
  }
  return { ok: true, detail: 'instance proven over control pipe' };
}

/** Ask a proven instance to exit gracefully. Never signals the OS. */
export async function requestShutdown(child, { timeoutMs = 3000, exchangeImpl = exchange } = {}) {
  const nonce = randomBytes(16).toString('hex');
  let reply;
  try {
    reply = await exchangeImpl(pipePath(child.instance_id), {
      op: 'shutdown', nonce, mac: mac(child.token, 'shutdown', nonce, child.pid, child.instance_id),
    }, timeoutMs);
  } catch (err) {
    return { ok: false, detail: `control pipe unreachable: ${err.message}` };
  }
  if (!reply?.accepted || !macEqual(reply.mac, mac(child.token, 'shutdown-ack', nonce, child.pid, child.instance_id))) {
    return { ok: false, detail: `shutdown not acknowledged: ${reply?.error ?? 'bad ack'}` };
  }
  return { ok: true, detail: 'graceful shutdown acknowledged' };
}
