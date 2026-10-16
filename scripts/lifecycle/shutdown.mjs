/** Bounded server closeout; injectable servers/timers, no process execution. */
export async function closeServers(servers, timeoutMs = 8000) {
  if (!servers.length || servers.some((s) => typeof s?.close !== 'function')) {
    throw new Error('no supported server shutdown adapter');
  }
  let timer;
  try {
    await Promise.race([
      Promise.all(servers.map((server) => new Promise((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
        server.closeIdleConnections?.();
      }))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('server shutdown deadline exceeded')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
