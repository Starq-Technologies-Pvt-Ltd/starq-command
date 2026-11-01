import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const COMMAND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ROOT = findWorkspaceRoot(COMMAND_ROOT);
const TEST_ROOT = process.env.STARQ_COMMAND_TEST_TMPDIR || os.tmpdir();
const children: ChildProcessWithoutNullStreams[] = [];
const tempDirs: string[] = [];

type ServiceCase = {
  name: string;
  entry: string;
  route: string;
  portEnv: string;
  extraEnv?: (root: string, port: number) => Record<string, string>;
};

function findWorkspaceRoot(from: string): string | undefined {
  for (let candidate = path.resolve(from); ; candidate = path.dirname(candidate)) {
    if (fs.existsSync(path.join(candidate, 'STARQ.md'))
      && fs.existsSync(path.join(candidate, '00_STARQ_HQ'))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) return undefined;
  }
}

async function unusedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve an ephemeral loopback port.');
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

function tempDirectory(): string {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(TEST_ROOT, 'command-entrypoint-'));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  return root;
}

function diagnostic(child: ChildProcessWithoutNullStreams, stdout: string, stderr: string): string {
  return `exit=${child.exitCode}; signal=${child.signalCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
}

function expectedMissingCompanion(output: string): string | null {
  const match = output.match(/ERR_MODULE_NOT_FOUND[\s\S]{0,600}?(agent-comms|herdr-floor|starq-lifecycle)/i)
    ?? output.match(/Cannot find (?:module|package) ['"]([^'"]*(?:agent-comms|herdr-floor|starq-lifecycle)[^'"]*)/i);
  return match?.[1] ?? match?.[0] ?? null;
}

async function startAndProbe(service: ServiceCase): Promise<{ state: 'STARTED' } | { state: 'UNAVAILABLE'; dependency: string; output: string }> {
  const root = tempDirectory();
  const port = service.portEnv === 'PM_PORT' ? await pmPort() : await unusedPort();
  const env = {
    ...process.env,
    ...(WORKSPACE_ROOT ? { STARQ_WORKSPACE: WORKSPACE_ROOT } : {}),
    [service.portEnv]: String(port),
    PM_ROOM_POST: 'off',
    COMMAND_OBSERVATION_ONLY: '1',
    ...service.extraEnv?.(root, port),
  };
  const child = spawn(process.execPath, [path.join(COMMAND_ROOT, service.entry)], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });

  const deadline = Date.now() + 18_000;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const output = diagnostic(child, stdout, stderr);
      const dependency = expectedMissingCompanion(output);
      if (dependency) return { state: 'UNAVAILABLE', dependency, output };
      throw new Error(`${service.name} production entrypoint exited before startup.\n${output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}${service.route}`, {
        signal: AbortSignal.timeout(2500),
      });
      if (response.status !== 404) {
        await response.arrayBuffer();
        return { state: 'STARTED' };
      }
      lastError = `route returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`${service.name} did not become reachable at ${service.route}: ${lastError}\n${diagnostic(child, stdout, stderr)}`);
}

async function pmPort(): Promise<number> {
  const ports = [5190, 5191, 5192, 5193, 5194, 5195, 5196, 5197, 5198, 5199];
  for (const port of ports) {
    try {
      const probe = createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', resolve);
      });
      await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
      return port;
    } catch { /* try the next reserved scratch port */ }
  }
  throw new Error('No unused scratch PM port is available in 5190-5199.');
}

afterEach(async () => {
  // Wait for each child to actually exit (bounded) before deleting its directory:
  // a fixed sleep raced the process still holding its files, which showed up as an
  // occasional Windows EPERM in the default parallel run.
  await Promise.all(children.splice(0).map((child) => {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const giveUp = setTimeout(resolve, 5000);
      child.once('exit', () => { clearTimeout(giveUp); resolve(); });
      child.kill();
    });
  }));
  for (const root of tempDirs.splice(0)) {
    const resolved = path.resolve(root);
    const parent = path.resolve(TEST_ROOT);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('command-entrypoint-')) {
      throw new Error(`Refusing to remove test data outside its isolated directory: ${resolved}`);
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('production entrypoints under the configured Node loader', () => {
  const services: ServiceCase[] = [
    { name: 'data', entry: 'server/data-service.mjs', route: '/api/health', portEnv: 'COMMAND_PORT' },
    { name: 'Building', entry: 'server/building-service.mjs', route: '/api/building/health', portEnv: 'BUILDING_SERVICE_PORT' },
    {
      name: 'PM', entry: 'server/pm-service.mjs', route: '/api/pm/health', portEnv: 'PM_PORT',
      extraEnv: (root) => ({ PM_DB_PATH: path.join(root, 'pm.db') }),
    },
    {
      name: 'Herdr', entry: 'integrations/herdr/herdr-service.mjs', route: '/api/herdr/health', portEnv: 'HERDR_SERVICE_PORT',
      extraEnv: (root) => ({ COMMAND_PM_DB_PATH: path.join(root, 'pm-operating.db') }),
    },
  ];

  it.each(services)('$name service starts and serves its health route (or reports an absent companion explicitly)', async (service, context) => {
    const result = await startAndProbe(service);
    if (result.state === 'UNAVAILABLE') {
      context.skip(`UNAVAILABLE_DEPENDENCY: ${result.dependency}; service startup is not proven in this clone.`);
      return;
    }
    expect(result.state).toBe('STARTED');
  }, 25_000);
});
