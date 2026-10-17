// Regression for Codex's independent-review finding (#9641): the
// idx_pm_tasks_wp index creation must not live inside the same guard as the
// work_package_id column ALTER. If a prior process added the column but
// died before the index was created, a later startup must still create the
// index - PRAGMA table_info already shows the column present, so a startup
// that only checks "does the column exist" would otherwise skip the index
// forever.
//
// This simulates that exact half-upgraded state directly on a scratch db
// file between two real server spawns, never touching the production
// pm-board.db at :5176.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// node:sqlite is a newer Node builtin that this repo's Vite/vitest version
// does not recognize for externalization - any ESM import of it, static or
// dynamic, gets caught by esbuild's dependency scanner and rewritten to the
// bare "sqlite" specifier, which then fails to resolve. A CommonJS require()
// is opaque to that scanner, so it is the one load path that reaches the
// real builtin - the same one pm-service.mjs gets for free by never being
// transformed (it runs as a plain node child process, not through Vite).
const DatabaseSync = (createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => {
    prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] };
    exec: (sql: string) => void;
    close: () => void;
  };
}).DatabaseSync;

const PORT = 5192;
const BASE = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | null = null;
let tmpDir: string | null = null;

afterEach(async () => {
  child?.kill();
  child = null;
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows WAL handles can lag kill(); best effort */ }
  }
  tmpDir = null;
  await new Promise((r) => setTimeout(r, 300)); // let the port free up between spawns
});

async function waitForReady() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/pm/health`);
      if (r.ok || r.status === 503) return;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('pm-service did not become ready in time');
}

function spawnServer(dbPath: string) {
  return spawn(process.execPath, [path.resolve(__dirname, '../server/pm-service.mjs')], {
    env: { ...process.env, PM_DB_PATH: dbPath, PM_PORT: String(PORT), PM_ROOM_POST: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function hasIndex(dbPath: string): boolean {
  const handle = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return handle.prepare("PRAGMA index_list('pm_tasks')").all().some((r: any) => r.name === 'idx_pm_tasks_wp');
  } finally {
    handle.close();
  }
}

describe('pm-service schema migration resume safety (#9641)', () => {
  it('creates the work_package_id index on first boot', async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'pm-migration-test-'));
    const dbPath = path.join(tmpDir, 'scratch-pm-board.db');
    child = spawnServer(dbPath);
    await waitForReady();
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    expect(hasIndex(dbPath)).toBe(true);
  }, 20000);

  it('still creates the index on a later startup even if a prior run added the column but crashed before indexing it', async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'pm-migration-test-'));
    const dbPath = path.join(tmpDir, 'scratch-pm-board.db');

    // First boot with the fixed code: column AND index both get created
    // (hasColumn was false). Stop it, then manually drop just the index -
    // this reproduces exactly the half-upgraded state Codex's #9641
    // described (column present, index missing), however it originally
    // happened, without having to fight the now-always-on index creation
    // to get there.
    child = spawnServer(dbPath);
    await waitForReady();
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    child = null;
    expect(hasIndex(dbPath)).toBe(true); // sanity: first boot did create it

    const handle = new DatabaseSync(dbPath);
    handle.exec('DROP INDEX idx_pm_tasks_wp');
    handle.close();
    expect(hasIndex(dbPath)).toBe(false); // confirm the simulated half-upgrade really is missing the index

    // Second boot: the fixed initSchema must notice the column already
    // exists (hasColumn is true) but still create the index unconditionally
    // - this is the exact bug: the pre-fix code would have skipped this
    // entirely because it only ran CREATE INDEX inside the column guard.
    child = spawnServer(dbPath);
    await waitForReady();
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    child = null;

    expect(hasIndex(dbPath)).toBe(true);
  }, 30000);
});
