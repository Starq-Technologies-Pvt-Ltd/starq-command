/**
 * Local backup and recovery (CV-C1c).
 *
 * These cases prove the daily-driver guarantees WITHOUT any service online: a
 * backup is a verified consistent snapshot, retention keeps the last N, a
 * corrupt source or copy is refused rather than silently trusted, and restore
 * is stopped-state-only and never discards the current DB. Everything runs on
 * a throwaway sqlite file under the worktree; the PM-port probe is injected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  createBackup, integrityCheck, listBackups, pruneBackups, restoreBackup,
  backupsDirFor, backupTimestamp, BackupError, DEFAULT_KEEP, PRERESTORE_MARK,
} from '../backup.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** A throwaway workspace dir under the worktree, removed after each case. */
function tmpSpace() {
  const dir = fs.mkdtempSync(path.join(here, 'tmp-backup-'));
  return { dir, cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } };
}

/** Make a small, valid operating DB with some rows so a real VACUUM INTO runs. */
function makeDb(file, rows = 3) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE pm_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO pm_tasks (id, title) VALUES (?, ?)');
  for (let i = 0; i < rows; i++) ins.run(`T-${i}`, `task ${i}`);
  db.close();
}

const neverLive = async () => false;
const alwaysLive = async () => true;

test('createBackup writes a verified, sha-stamped snapshot into data/backups', () => {
  const { dir, cleanup } = tmpSpace();
  try {
    const dbPath = path.join(dir, 'pm-operating.db');
    makeDb(dbPath, 5);
    const r = createBackup(dbPath);
    assert.equal(path.dirname(r.backup), backupsDirFor(dbPath));
    assert.match(path.basename(r.backup), /^pm-operating-.*\.db$/);
    assert.equal(r.integrity, 'ok');
    assert.ok(r.bytes > 0);
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
    // The snapshot is itself a readable DB with the same rows.
    const copy = new DatabaseSync(r.backup, { readOnly: true });
    assert.equal(Number(copy.prepare('SELECT COUNT(*) n FROM pm_tasks').get().n), 5);
    copy.close();
  } finally { cleanup(); }
});

test('createBackup refuses a missing database', () => {
  const { dir, cleanup } = tmpSpace();
  try {
    assert.throws(() => createBackup(path.join(dir, 'nope.db')), BackupError);
  } finally { cleanup(); }
});

test('integrityCheck flags a corrupt file and createBackup refuses it', () => {
  const { dir, cleanup } = tmpSpace();
  try {
    const dbPath = path.join(dir, 'pm-operating.db');
    fs.writeFileSync(dbPath, 'this is not a sqlite database');
    assert.equal(integrityCheck(dbPath).ok, false);
    assert.throws(() => createBackup(dbPath), /integrity_check/);
  } finally { cleanup(); }
});

test('pruneBackups keeps only the most recent N ordinary backups', () => {
  const { dir, cleanup } = tmpSpace();
  try {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    // 20 ordinary backups with increasing timestamps in the filename.
    const names = [];
    for (let i = 0; i < 20; i++) {
      const ts = backupTimestamp(new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
      const name = `pm-operating-${ts}.db`;
      fs.writeFileSync(path.join(backupsDir, name), 'x');
      names.push(name);
    }
    const removed = pruneBackups(backupsDir, DEFAULT_KEEP);
    const kept = listBackups(backupsDir);
    assert.equal(kept.length, DEFAULT_KEEP);
    assert.equal(removed.length, 20 - DEFAULT_KEEP);
    // The newest 14 (largest timestamps) survive.
    assert.ok(kept.every((b) => names.slice(-DEFAULT_KEEP).includes(b.name)));
  } finally { cleanup(); }
});

test('pruneBackups budgets ordinary and pre-restore snapshots separately', () => {
  const { dir, cleanup } = tmpSpace();
  try {
    const backupsDir = path.join(dir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const write = (name) => fs.writeFileSync(path.join(backupsDir, name), 'x');
    for (let i = 0; i < 16; i++) write(`pm-operating-2026-01-01T00-00-${String(i).padStart(2, '0')}-000Z.db`);
    for (let i = 0; i < 16; i++) write(`pm-operating-2026-01-01T00-00-${String(i).padStart(2, '0')}-000Z${PRERESTORE_MARK}.db`);
    pruneBackups(backupsDir, DEFAULT_KEEP);
    const kept = listBackups(backupsDir);
    assert.equal(kept.filter((b) => !b.name.includes(PRERESTORE_MARK)).length, DEFAULT_KEEP);
    assert.equal(kept.filter((b) => b.name.includes(PRERESTORE_MARK)).length, DEFAULT_KEEP);
  } finally { cleanup(); }
});

test('restoreBackup refuses while Command is live (stopped-state only)', async () => {
  const { dir, cleanup } = tmpSpace();
  try {
    const dbPath = path.join(dir, 'pm-operating.db');
    makeDb(dbPath, 2);
    const { backup } = createBackup(dbPath);
    await assert.rejects(
      restoreBackup(backup, dbPath, { probe: alwaysLive }),
      /running|live/i,
    );
  } finally { cleanup(); }
});

test('restoreBackup restores data and keeps a pre-restore safety snapshot', async () => {
  const { dir, cleanup } = tmpSpace();
  try {
    const dbPath = path.join(dir, 'pm-operating.db');
    makeDb(dbPath, 2);                    // original has 2 rows
    const { backup } = createBackup(dbPath);

    // Mutate the live DB to 7 rows, then restore the 2-row snapshot.
    const db = new DatabaseSync(dbPath);
    const ins = db.prepare('INSERT INTO pm_tasks (id, title) VALUES (?, ?)');
    for (let i = 2; i < 7; i++) ins.run(`T-${i}`, `task ${i}`);
    db.close();

    const r = await restoreBackup(backup, dbPath, { probe: neverLive });
    assert.ok(r.safetyCopy && fs.existsSync(r.safetyCopy), 'pre-restore snapshot exists');
    assert.ok(r.safetyCopy.includes(PRERESTORE_MARK));

    const after = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(Number(after.prepare('SELECT COUNT(*) n FROM pm_tasks').get().n), 2, 'restored to snapshot');
    after.close();

    // The safety snapshot preserved the 7-row pre-restore state.
    const safe = new DatabaseSync(r.safetyCopy, { readOnly: true });
    assert.equal(Number(safe.prepare('SELECT COUNT(*) n FROM pm_tasks').get().n), 7);
    safe.close();
  } finally { cleanup(); }
});

test('restoreBackup refuses a corrupt backup file', async () => {
  const { dir, cleanup } = tmpSpace();
  try {
    const dbPath = path.join(dir, 'pm-operating.db');
    makeDb(dbPath, 1);
    const bad = path.join(dir, 'bad-backup.db');
    fs.writeFileSync(bad, 'not sqlite');
    await assert.rejects(restoreBackup(bad, dbPath, { probe: neverLive }), /integrity_check/);
  } finally { cleanup(); }
});
