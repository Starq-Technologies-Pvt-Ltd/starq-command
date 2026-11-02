/**
 * The organization import CLI must default to the PM service's canonical store.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL } from '../server/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts', 'import-organization.mjs');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-import-db-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  return dir;
}

function run(args, env) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env,
  });
}

test('default import database is the canonical operating store, not <workspace>/data', (t) => {
  const workspace = tempDir(t);
  fs.writeFileSync(path.join(workspace, 'STARQ.md'), '# fixture\n');
  fs.mkdirSync(path.join(workspace, '00_STARQ_HQ'));
  const snapshot = path.join(workspace, 'snapshot.json');
  fs.writeFileSync(snapshot, '{}');
  const env = { ...process.env, STARQ_WORKSPACE: workspace };
  delete env.PM_DB_PATH;

  const proc = run(['--snapshot', snapshot, '--dry-run'], env);
  const canonical = path.join(workspace, CANONICAL.pmBoardDb);
  assert.notEqual(proc.status, 0);
  assert.match(proc.stderr, /pm-operating\.db/);
  assert.ok(proc.stderr.includes(canonical) || proc.stderr.replaceAll('/', '\\').includes(canonical), proc.stderr);
  assert.equal(fs.existsSync(path.join(workspace, 'data', 'pm-operating.db')), false);
  assert.equal(fs.existsSync(canonical), false);
});

test('--db and PM_DB_PATH still override the canonical default', (t) => {
  const workspace = tempDir(t);
  fs.writeFileSync(path.join(workspace, 'STARQ.md'), '# fixture\n');
  fs.mkdirSync(path.join(workspace, '00_STARQ_HQ'));
  const snapshot = path.join(workspace, 'snapshot.json');
  fs.writeFileSync(snapshot, '{}');
  const override = path.join(workspace, 'explicit', 'override.db');
  const env = { ...process.env, STARQ_WORKSPACE: workspace, PM_DB_PATH: path.join(workspace, 'from-env.db') };

  const byFlag = run(['--snapshot', snapshot, '--db', override], env);
  assert.match(`${byFlag.stderr}\n${byFlag.stdout}`, /override\.db/);
  assert.equal(fs.existsSync(path.join(workspace, 'data', 'pm-operating.db')), false);
  assert.equal(fs.existsSync(path.join(workspace, CANONICAL.pmBoardDb)), false);
  assert.equal(fs.existsSync(path.join(workspace, 'from-env.db')), false);

  const byEnv = run(['--snapshot', snapshot], env);
  assert.equal(fs.existsSync(path.join(workspace, 'from-env.db')), true, `${byEnv.stderr}\n${byEnv.stdout}`);
  assert.equal(fs.existsSync(path.join(workspace, 'data', 'pm-operating.db')), false);
  assert.equal(fs.existsSync(path.join(workspace, CANONICAL.pmBoardDb)), false);
});
