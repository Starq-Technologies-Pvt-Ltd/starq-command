import fs from 'node:fs';
import http from 'node:http';
import { execSync } from 'node:child_process';

export function isWsl({ env = process.env, platform = process.platform, readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  if (platform !== 'linux') return false;
  try {
    const v = readFile('/proc/version');
    return /microsoft/i.test(v) || /wsl/i.test(v);
  } catch {
    return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
  }
}

export function discoverWindowsHost({ exec = execSync, readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  // Prefer the default route gateway (WSL2 vEthernet adapter -> Windows host).
  try {
    const out = exec('ip route', { encoding: 'utf8' });
    const m = out.match(/^default\s+via\s+(\d+\.\d+\.\d+\.\d+)/m);
    if (m) return m[1];
  } catch {}
  // Fallback to resolver nameserver.
  try {
    const resolv = readFile('/etc/resolv.conf');
    const m = resolv.match(/^nameserver\s+(\d+\.\d+\.\d+\.\d+)/m);
    if (m) return m[1];
  } catch {}
  return null;
}

export async function probe({
  config,
  host = null,
  isWslFn = isWsl,
  discoverHostFn = discoverWindowsHost,
  httpGet = defaultHttpGet,
  timeoutMs = 3000,
} = {}) {
  const wsl = isWslFn();
  const windowsHost = host ?? discoverHostFn();
  const components = (config?.components ?? []).filter((c) => c.port && c.health?.path);
  const results = [];
  for (const c of components) {
    const r = await runOne(windowsHost, c, httpGet, timeoutMs);
    results.push(r);
  }
  return {
    generatedAt: new Date().toISOString(),
    isWsl: wsl,
    windowsHost,
    hostSource: host ? 'injected' : 'discovered',
    results,
  };
}

async function runOne(host, component, httpGet, timeoutMs) {
  const url = `http://${host}:${component.port}${component.health.path}`;
  try {
    const res = await httpGet(host, component.port, component.health.path, { timeoutMs });
    const ok = res?.status === (component.health?.status ?? 200);
    return { name: component.name, port: component.port, path: component.health.path, url, ok, status: res?.status ?? null, error: null };
  } catch (err) {
    return { name: component.name, port: component.port, path: component.health.path, url, ok: false, status: null, error: err?.message ?? String(err) };
  }
}

function defaultHttpGet(host, port, pathname, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: pathname, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 1 << 20) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, contentType: String(res.headers['content-type'] ?? ''), body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// CLI entrypoint
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (import.meta.url === pathToFileURL(invokedPath).href) {
  const cfgPath = process.argv[2] || 'lifecycle.config.json';
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const out = await probe({ config });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
