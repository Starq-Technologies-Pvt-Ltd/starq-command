/**
 * Disposable-fixture regressions for the backup source-loss and path-literal defects.
 * Never opens data/pm-operating.db.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { backupDataStores, sqlitePathLiteral } from '../scripts/backup-data-stores.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'backup-data-stores.mjs');

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  return dir;
}

function makeDb(file, rows = [{ id: 'T-1', title: "O'Brien task" }]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO items (id, title) VALUES (?, ?)');
  for (const row of rows) insert.run(row.id, row.title);
  db.close();
}

function fingerprint(file) {
  const bytes = fs.readFileSync(file);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      rows: db.prepare('SELECT id, title FROM items ORDER BY id').all().map((row) => ({ id: row.id, title: row.title })),
    };
  } finally {
    db.close();
  }
}

test('sqlitePathLiteral keeps apostrophes inside the VACUUM INTO string', () => {
  // The literal normalizes the host's own separator to '/', so the expected
  // string is platform-specific. Assert each OS with its native path shape and
  // an exact (not sqlitePathLiteral-derived) expected literal.
  if (process.platform === 'win32') {
    assert.equal(sqlitePathLiteral("D:\\keep\\o'brien\\file.db"), "'D:/keep/o''brien/file.db'");
  } else {
    assert.equal(sqlitePathLiteral("/keep/o'brien/file.db"), "'/keep/o''brien/file.db'");
  }
  // Control-character rejection is platform-independent (the \n is the hazard).
  assert.throws(() => sqlitePathLiteral(`${path.sep}keep${path.sep}bad\npath${path.sep}file.db`), /control character/);
});

test('same directory, case alias, and parent alias are refused without deleting the source', (t) => {
  const root = tempDir(t, 'command-backup-same-');
  const src = path.join(root, 'SourceData');
  const dbPath = path.join(src, 'pm.db');
  makeDb(dbPath);
  const before = fingerprint(dbPath);
  fs.writeFileSync(path.join(src, 'notes.txt'), 'keep me');

  assert.throws(() => backupDataStores(src, src), /refusing backup/);
  assert.throws(() => backupDataStores(src, src.toUpperCase() === src ? src.toLowerCase() : src.toUpperCase()), /refusing backup/);
  fs.mkdirSync(path.join(src, 'nested'));
  assert.throws(() => backupDataStores(src, path.join(src, 'nested', '..')), /refusing backup/);

  assert.deepEqual(fingerprint(dbPath), before);
  assert.equal(fs.readFileSync(path.join(src, 'notes.txt'), 'utf8'), 'keep me');
  assert.equal(fs.readdirSync(src).includes('backup-manifest.json'), false);
});

test('a directory junction that aliases the source is refused before any removal', (t) => {
  const root = tempDir(t, 'command-backup-link-');
  const src = path.join(root, 'data');
  const dbPath = path.join(src, 'pm.db');
  makeDb(dbPath);
  const before = fingerprint(dbPath);
  const link = path.join(root, 'alias');
  fs.symlinkSync(src, link, 'junction');

  assert.throws(() => backupDataStores(src, link), /refusing backup/);
  assert.deepEqual(fingerprint(dbPath), before);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});

test('a destination file that is a symlink to the source database is not removed', (t) => {
  const root = tempDir(t, 'command-backup-filelink-');
  const src = path.join(root, 'data');
  const out = path.join(root, 'out');
  const dbPath = path.join(src, 'pm.db');
  makeDb(dbPath);
  const before = fingerprint(dbPath);
  fs.mkdirSync(out);
  const linked = path.join(out, 'pm.db');
  fs.symlinkSync(dbPath, linked, 'file');

  assert.throws(() => backupDataStores(src, out), /refusing backup/);
  assert.deepEqual(fingerprint(dbPath), before);
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
});

test('an apostrophe in the output path still produces a readable backup and leaves the source bytes', (t) => {
  const root = tempDir(t, 'command-backup-quote-');
  const src = path.join(root, 'data');
  const out = path.join(root, "o'brien (1)");
  const dbPath = path.join(src, 'pm.db');
  const rows = [{ id: 'T-1', title: "archive; 'quoted'" }, { id: 'T-2', title: 'second' }];
  makeDb(dbPath, rows);
  fs.writeFileSync(path.join(src, 'notes.txt'), "don't delete");
  const before = fingerprint(dbPath);

  const manifest = backupDataStores(src, out);

  assert.deepEqual(fingerprint(dbPath), before);
  assert.equal(fs.readFileSync(path.join(src, 'notes.txt'), 'utf8'), "don't delete");
  assert.equal(manifest.files['pm.db'].backup_integrity_check, 'ok');
  const copy = fingerprint(path.join(out, 'pm.db'));
  assert.deepEqual(copy.rows, rows);
  assert.equal(fs.readFileSync(path.join(out, 'notes.txt'), 'utf8'), "don't delete");
});

test('a failed snapshot does not replace an existing valid destination or the source', (t) => {
  const root = tempDir(t, 'command-backup-fail-');
  const src = path.join(root, 'data');
  const out = path.join(root, 'out');
  const dbPath = path.join(src, 'pm.db');
  fs.mkdirSync(src);
  fs.writeFileSync(dbPath, 'not a sqlite database');
  const sourceBytes = fs.readFileSync(dbPath);
  fs.mkdirSync(out);
  const previous = path.join(out, 'pm.db');
  makeDb(previous, [{ id: 'KEEP', title: 'previous backup' }]);
  const previousFingerprint = fingerprint(previous);

  assert.throws(() => backupDataStores(src, out));
  assert.deepEqual(fs.readFileSync(dbPath), sourceBytes);
  assert.deepEqual(fingerprint(previous), previousFingerprint);
});

test('the CLI refuses a same-directory backup and keeps the source file', (t) => {
  const root = tempDir(t, 'command-backup-cli-');
  const src = path.join(root, 'data');
  const dbPath = path.join(src, 'pm.db');
  makeDb(dbPath);
  const before = fingerprint(dbPath);
  const proc = spawnSync(process.execPath, [SCRIPT, '--data', src, '--out', src], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.notEqual(proc.status, 0);
  assert.match(proc.stderr, /refusing backup/);
  assert.deepEqual(fingerprint(dbPath), before);
});

// ── no-clobber publication regressions ────────────────────────────────────

function backupResidue(dir) {
  return fs.readdirSync(dir).filter((name) => name.startsWith('.partial-'));
}

function makeFileDb(root, rows) {
  const src = path.join(root, 'data');
  const out = path.join(root, 'out');
  makeDb(path.join(src, 'pm.db'), rows);
  return { src, out, dbPath: path.join(src, 'pm.db') };
}

test('publish links the backup into place and never renames a temp over a destination', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /fs\.linkSync\(temp, dest\)/);
  assert.doesNotMatch(source, /renameSync\(temp, dest\)/);
});

test('new publication links the backup into place and leaves no temp', (t) => {
  const root = tempDir(t, 'command-backup-fresh-');
  const { src, out, dbPath } = makeFileDb(root, [{ id: 'T-1', title: 'fresh' }]);
  const before = fingerprint(dbPath);
  const manifest = backupDataStores(src, out);
  assert.equal(manifest.files['pm.db'].backup_integrity_check, 'ok');
  assert.deepEqual(fingerprint(dbPath), before);
  assert.deepEqual(fingerprint(path.join(out, 'pm.db')).rows, before.rows);
  assert.deepEqual(backupResidue(out), []);
});

test('an occupied backup name is preserved and the new bytes go to a sibling', (t) => {
  const root = tempDir(t, 'command-backup-occupied-');
  const { src, out, dbPath } = makeFileDb(root, [{ id: 'T-1', title: 'new backup' }]);
  fs.mkdirSync(out, { recursive: true });
  const dest = path.join(out, 'pm.db');
  makeDb(dest, [{ id: 'OLD', title: 'prior backup' }]);
  const occupied = fs.statSync(dest, { bigint: true });
  const prior = fingerprint(dest);
  const sourceBefore = fingerprint(dbPath);
  let sibling = null;
  assert.throws(() => backupDataStores(src, out), (error) => {
    assert.equal(error.code, 'BACKUP_NAME_OCCUPIED');
    assert.equal(path.resolve(error.preserved), path.resolve(dest));
    sibling = error.sibling;
    return true;
  });
  const after = fs.statSync(dest, { bigint: true });
  assert.equal(after.ino, occupied.ino);
  assert.deepEqual(fingerprint(dest), prior);
  assert.ok(sibling && fs.existsSync(sibling));
  assert.deepEqual(fingerprint(sibling).rows, [{ id: 'T-1', title: 'new backup' }]);
  assert.deepEqual(fingerprint(dbPath), sourceBefore);
  assert.equal(fs.existsSync(path.join(out, 'backup-manifest.json')), false);
});

test('a destination created during fresh publication is not overwritten', (t) => {
  const root = tempDir(t, 'command-backup-race-');
  const { src, out, dbPath } = makeFileDb(root, [{ id: 'T-1', title: 'ours' }]);
  const sourceBefore = fingerprint(dbPath);
  const competitor = Buffer.from('competitor-kept-bytes');
  const competitorHash = createHash('sha256').update(competitor).digest('hex');
  const realLink = fs.linkSync;
  fs.linkSync = (existing, neu) => {
    if (path.basename(neu) === 'pm.db') fs.writeFileSync(neu, competitor);
    return realLink(existing, neu);
  };
  t.after(() => { fs.linkSync = realLink; });
  try {
    let sibling = null;
    assert.throws(() => backupDataStores(src, out), (error) => {
      assert.equal(error.code, 'BACKUP_NAME_OCCUPIED');
      assert.equal(error.preserved, path.join(out, 'pm.db'));
      sibling = error.sibling;
      return true;
    });
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(out, 'pm.db'))).digest('hex'), competitorHash);
    assert.ok(sibling && fs.existsSync(sibling));
    assert.deepEqual(fingerprint(sibling).rows, [{ id: 'T-1', title: 'ours' }]);
    assert.deepEqual(fingerprint(dbPath), sourceBefore);
    assert.equal(fs.existsSync(path.join(out, 'backup-manifest.json')), false);
    assert.deepEqual(backupResidue(out), []);
  } finally {
    fs.linkSync = realLink;
  }
});

test('an in-place rewrite with the same inode, size, and restored mtime is not deleted', (t) => {
  const root = tempDir(t, 'command-backup-mtime-');
  const { src, out, dbPath } = makeFileDb(root, [{ id: 'T-1', title: 'new backup' }]);
  fs.mkdirSync(out, { recursive: true });
  const dest = path.join(out, 'pm.db');
  makeDb(dest, [{ id: 'OLD', title: 'prior backup' }]);
  const stamp = new Date('2026-11-02T12:00:00.000Z');
  fs.utimesSync(dest, stamp, stamp);
  const before = fs.statSync(dest, { bigint: true });
  const original = fs.readFileSync(dest);
  const mutated = Buffer.from(original);
  mutated[mutated.length - 1] ^= 0xff;
  const handle = fs.openSync(dest, 'r+');
  try { fs.writeSync(handle, mutated, 0, mutated.length, 0); }
  finally { fs.closeSync(handle); }
  fs.utimesSync(dest, stamp, stamp);
  const rewritten = fs.statSync(dest, { bigint: true });
  const rewrittenHash = createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  assert.equal(rewritten.dev, before.dev);
  assert.equal(rewritten.ino, before.ino);
  assert.equal(rewritten.size, before.size);
  assert.equal(rewritten.mtimeNs, before.mtimeNs);
  assert.notEqual(rewrittenHash, createHash('sha256').update(original).digest('hex'));
  const sourceBefore = fingerprint(dbPath);
  const realUnlink = fs.unlinkSync;
  const realRm = fs.rmSync;
  const realRename = fs.renameSync;
  const refuseOccupied = (file) => {
    if (path.resolve(String(file)) === path.resolve(dest)) throw new Error(`occupied path was removed: ${file}`);
    try {
      const st = fs.statSync(file, { bigint: true });
      if (st.dev === before.dev && st.ino === before.ino) throw new Error(`occupied inode was removed: ${file}`);
    } catch (error) {
      if (String(error.message).includes('occupied')) throw error;
    }
  };
  fs.unlinkSync = (file, ...rest) => { refuseOccupied(file); return realUnlink(file, ...rest); };
  fs.rmSync = (file, ...rest) => { refuseOccupied(file); return realRm(file, ...rest); };
  fs.renameSync = (from, to, ...rest) => { refuseOccupied(from); return realRename(from, to, ...rest); };
  t.after(() => { fs.unlinkSync = realUnlink; fs.rmSync = realRm; fs.renameSync = realRename; });
  try {
    let sibling = null;
    assert.throws(() => backupDataStores(src, out), (error) => {
      assert.equal(error.code, 'BACKUP_NAME_OCCUPIED');
      assert.equal(path.resolve(error.preserved), path.resolve(dest));
      sibling = error.sibling;
      return true;
    });
    const after = fs.statSync(dest, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(after.nlink >= 1n, true);
    assert.equal(createHash('sha256').update(fs.readFileSync(dest)).digest('hex'), rewrittenHash);
    assert.ok(sibling && fs.existsSync(sibling));
    assert.deepEqual(fingerprint(sibling).rows, [{ id: 'T-1', title: 'new backup' }]);
    assert.deepEqual(fingerprint(dbPath), sourceBefore);
    assert.equal(fs.existsSync(path.join(out, 'backup-manifest.json')), false);
  } finally {
    fs.unlinkSync = realUnlink;
    fs.rmSync = realRm;
    fs.renameSync = realRename;
  }
});

