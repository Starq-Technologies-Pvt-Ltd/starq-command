// Behavioral PM writer-gate test (D3). Spawns the real pm-service in SCRATCH
// mode only: an isolated *.db under the OS temp dir, a loopback port in
// 5190-5199, and a stub send script. Never touches production pm-board.db at
// 5176, never the real send.mjs, never the canonical Room, and never starts a
// production service. A temp workspace fixture (identities + PM projects +
// hashChain/envelope copied read-only from agent-comms/protocol/v1 source;
// no Room data touched) is provided via STARQ_WORKSPACE so pm-service does
// not read canonical agent-comms/protocol/v1/identities.json. Temp DB,
// Room fixture ledger, stub sender, and workspace fixture all live under OS
// temp and are cleaned up after each test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT_BASE = 5193;
const HEADERS = { 'content-type': 'application/json', 'x-pm-client': 'starq-command' };
const ACTOR = 'claude'; // identity present in the temp workspace fixture

let child: ChildProcess | null = null;
let tmpDir: string | null = null;
let workspaceDir: string | null = null;
let failClosedStubPath: string | null = null;
let failClosedLedgerPath: string | null = null;

function api(port: number, method: string, p: string, body?: unknown) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: method === 'GET' ? undefined : HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function waitForReady(port: number, expectedDbPath: string) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/pm/health`);
      if (r.ok || r.status === 503) {
        const h = await r.json();
        if (h.state === 'OK' && h.service === 'starq-command-pm' && h.scratch === true && h.port === port && h.db === expectedDbPath) return;
      }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pm-service did not become ready with expected configuration');
}

async function waitForExit(proc: ChildProcess, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(true); } };
    proc.once('exit', done);
    setTimeout(() => { if (!settled) { settled = true; resolve(false); proc.kill(); } }, timeoutMs);
  });
}

async function portIsOccupied(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/pm/health`);
    return true;
  } catch {
    return false;
  }
}

function buildWorkspace(): string {
  const ws = mkdtempSync(path.join(tmpdir(), 'pm-writer-gate-ws-'));
  // resolveWorkspace fingerprint: STARQ.md + 00_STARQ_HQ directory
  writeFileSync(path.join(ws, 'STARQ.md'), '# temp workspace fixture for PM writer-gate test\n');
  mkdirSync(path.join(ws, '00_STARQ_HQ'), { recursive: true });
  // Identity fixture: claude active (avoids reading canonical identities.json)
  mkdirSync(path.join(ws, 'agent-comms', 'protocol', 'v1'), { recursive: true });
  writeFileSync(
    path.join(ws, 'agent-comms', 'protocol', 'v1', 'identities.json'),
    JSON.stringify({ identities: [{ canonicalHandle: 'claude', status: 'active', authorityLevel: 'ROOT_GENESIS' }] }),
  );
  // hashChain + envelope for computeRecordHash (avoids reading canonical protocol)
  copyFileSync(
    path.resolve('D:/StarqTech/agent-comms/protocol/v1/hashChain.mjs'),
    path.join(ws, 'agent-comms', 'protocol', 'v1', 'hashChain.mjs'),
  );
  copyFileSync(
    path.resolve('D:/StarqTech/agent-comms/protocol/v1/envelope.mjs'),
    path.join(ws, 'agent-comms', 'protocol', 'v1', 'envelope.mjs'),
  );
  // PM seed fixture (avoids reading canonical pm-projects.json)
  mkdirSync(
    path.join(ws, '00_STARQ_HQ', 'operations', 'starq-command', 'board'),
    { recursive: true },
  );
  writeFileSync(
    path.join(ws, '00_STARQ_HQ', 'operations', 'starq-command', 'board', 'pm-projects.json'),
    JSON.stringify({ projects: [{ id: 'command', name: 'Starq Command', prefix: 'CMD', hold_state: null }] }),
  );
  return ws;
}

function spawnPm(env: Record<string, string>, port: number): ChildProcess {
  return spawn(process.execPath, [path.resolve(__dirname, '../server/pm-service.mjs')], {
    env: {
      ...process.env,
      // Safe defaults so no host writer env can leak into any child.
      PM_ROOM_FROM: '',
      PM_ROOM_INSTANCE: '',
      PM_ROOM_SEND_SCRIPT: failClosedStubPath ?? '',
      PM_ROOM_LEDGER: failClosedLedgerPath ?? '',
      ...env,
      PM_PORT: String(port),
      PM_DB_PATH: path.join(tmpDir!, 'scratch-pm-board.db'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function rmTreeRetry(dirPath: string, label: string, maxRetries = 20, delayMs = 100): Promise<void> {
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      rmSync(dirPath, { recursive: true, force: true });
      // Confirm removal: path should no longer exist. A probe error retries;
      // only a successful existsSync false proves removal.
      let gone = false;
      try { gone = !existsSync(dirPath); } catch { /* probe error - retry */ }
      if (gone) return;
    } catch { /* rmSync error - retry */ }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Cleanup failed: could not remove ${label} at ${dirPath}`);
}

async function stopChild() {
  if (child) {
    // Confirm exit only from exitCode/signalCode or the exit event.
    // Register the exit listener before kill to avoid missing a fast exit.
    if (child.exitCode === null && child.signalCode === null) {
      let exitConfirmed = false;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Cleanup blocked: child did not exit before temp removal')), 5000);
        const onExit = () => { clearTimeout(timer); exitConfirmed = true; resolve(); };
        const onError = (err: Error) => { clearTimeout(timer); reject(new Error(`Child error before confirmed exit: ${err.message}`)); };
        child.once('exit', onExit);
        child.once('error', onError);
        child.kill();
      });
      if (!exitConfirmed) {
        throw new Error('Cleanup blocked: child exit not confirmed before temp removal');
      }
    }
    child = null;
  }
  const errors: string[] = [];
  if (workspaceDir) {
    try { await rmTreeRetry(workspaceDir, 'workspaceDir'); } catch (e) { errors.push((e as Error).message); }
    workspaceDir = null;
  }
  if (tmpDir) {
    try { await rmTreeRetry(tmpDir, 'tmpDir'); } catch (e) { errors.push((e as Error).message); }
    tmpDir = null;
  }
  if (errors.length) throw new Error(errors.join('; '));
}

afterEach(async () => { await stopChild(); });

describe('PM writer gate (behavioral, scratch)', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'pm-writer-gate-'));
    workspaceDir = buildWorkspace();
    // Fail-closed defaults for every child: temp stub (not real send.mjs)
    // and temp fixture ledger (not canonical room.jsonl).
    failClosedStubPath = path.join(tmpDir, 'fail-closed-stub.mjs');
    writeFileSync(
      failClosedStubPath,
      "console.error('fail-closed stub: writer not authorized');\nprocess.exit(2);\n",
      'utf8',
    );
    failClosedLedgerPath = path.join(tmpDir, 'room-ledger.jsonl');
    writeFileSync(failClosedLedgerPath, '', 'utf8');
  });

  it('PM_ROOM_POST=on with empty writer identity exits before listen (gate closed)', async () => {
    const port = PORT_BASE;
    if (await portIsOccupied(port)) throw new Error(`port ${port} occupied; aborting before any POST`);
    child = spawnPm({ PM_ROOM_POST: 'on', STARQ_WORKSPACE: workspaceDir }, port);
    const exited = await waitForExit(child, 5000);
    expect(exited).toBe(true);
    // It must never have become ready with the expected configuration.
    let ready = false;
    try { await waitForReady(port, path.join(tmpDir, 'scratch-pm-board.db')); ready = true; } catch { /* expected: never listens */ }
    expect(ready).toBe(false);
  }, 15000);

  it('PM_ROOM_POST=off starts against temp DB/scratch loopback port', async () => {
    const port = PORT_BASE + 1;
    if (await portIsOccupied(port)) throw new Error(`port ${port} occupied; aborting before any POST`);
    child = spawnPm({ PM_ROOM_POST: 'off', STARQ_WORKSPACE: workspaceDir }, port);
    await waitForReady(port, path.join(tmpDir, 'scratch-pm-board.db'));
    const r = await api(port, 'GET', '/api/pm/health');
    expect(r.status).toBe(200);
    const h = await r.json();
    expect(h.service).toBe('starq-command-pm');
    expect(h.state).toBe('OK');
    expect(h.scratch).toBe(true);
    expect(h.port).toBe(port);
    expect(h.db).toBe(path.join(tmpDir, 'scratch-pm-board.db'));
  }, 15000);

  it('explicit writer identity + PM_ROOM_SEND_SCRIPT stub produces a stub call, never real send.mjs', async () => {
    const port = PORT_BASE + 2;
    if (await portIsOccupied(port)) throw new Error(`port ${port} occupied; aborting before any POST`);
    const stubPath = path.join(tmpDir, 'stub-send.mjs');
    const stubLog = path.join(tmpDir, 'stub-invoked.log');
    const ledgerPath = path.join(tmpDir, 'room-ledger.jsonl');
    // Empty temp fixture ledger: Room reference lookup reads this, not canonical room.jsonl.
    writeFileSync(ledgerPath, '', 'utf8');
    // Stub send script: logs invocation, emulates a broker receipt line.
    writeFileSync(
      stubPath,
      'import { appendFileSync } from \'node:fs\';\n'
      + 'const log = process.env.STUB_LOG_PATH || \'\';\n'
      + 'if (log) appendFileSync(log, \'stub-invoked \' + JSON.stringify(process.argv.slice(2)) + \'\\n\', \'utf8\');\n'
      + "console.log('Broker Record #1 posted');\n",
      'utf8',
    );

    child = spawnPm(
      {
        PM_ROOM_POST: 'on',
        PM_ROOM_FROM: 'test-sender',
        PM_ROOM_INSTANCE: 'test-instance',
        PM_ROOM_SEND_SCRIPT: stubPath,
        PM_ROOM_LEDGER: ledgerPath,
        STARQ_WORKSPACE: workspaceDir,
        STUB_LOG_PATH: stubLog,
      },
      port,
    );
    await waitForReady(port, path.join(tmpDir, 'scratch-pm-board.db'));

    expect(stubPath).toContain(tmpDir);
    expect(stubPath).not.toBe(path.resolve('D:/StarqTech/agent-comms/scripts/send.mjs'));

    const r = await api(port, 'POST', '/api/pm/tasks', {
      project_id: 'command', title: 'writer-gate task', actor: ACTOR,
    });
    expect(r.status).toBe(201);

    // Wait for the stub to be invoked (room sync is asynchronous).
    let invoked = false;
    for (let i = 0; i < 100; i += 1) {
      if (existsSync(stubLog)) {
        const text = readFileSync(stubLog, 'utf8');
        if (text.includes('stub-invoked')) { invoked = true; break; }
      }
      await new Promise((res) => setTimeout(res, 100));
    }
    expect(invoked).toBe(true);
  }, 20000);
});
