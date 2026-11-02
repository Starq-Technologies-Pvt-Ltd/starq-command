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
import { backupDataStores, readLatestBackup, sqlitePathLiteral } from '../scripts/backup-data-stores.mjs';
import { publishSeam } from '../scripts/sqlite-vacuum.mjs';

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
  const copy = fingerprint(path.join(out, manifest.files['pm.db'].backup_path));
  assert.deepEqual(copy.rows, rows);
  assert.equal(fs.readFileSync(path.join(out, manifest.files['notes.txt'].backup_path), 'utf8'), "don't delete");
  assert.equal(readLatestBackup(out).manifest.version, manifest.version);
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

test('publish uses the verified-object helper and never renames a temp over a destination', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /vacuumIntoDistinct\(/);
  assert.match(source, /publishVerifiedFd\(/);
  assert.doesNotMatch(source, /\brenameSync\b/);
  assert.doesNotMatch(source, /\.partial-/);
});

test('new publication links the backup into place and leaves no temp', (t) => {
  const root = tempDir(t, 'command-backup-fresh-');
  const { src, out, dbPath } = makeFileDb(root, [{ id: 'T-1', title: 'fresh' }]);
  const before = fingerprint(dbPath);
  const manifest = backupDataStores(src, out);
  assert.equal(manifest.files['pm.db'].backup_integrity_check, 'ok');
  assert.deepEqual(fingerprint(dbPath), before);
  assert.deepEqual(fingerprint(path.join(out, manifest.files['pm.db'].backup_path)).rows, before.rows);
  assert.equal(readLatestBackup(out).manifest.current, manifest.version);
  assert.deepEqual(backupResidue(out), []);
});

test('a second backup succeeds and leaves the first version readable', (t) => {
  const root = tempDir(t, 'command-backup-repeat-');
  const { src, out, dbPath } = makeFileDb(root, [{ id: 'T-1', title: 'first backup' }]);
  const first = backupDataStores(src, out);
  const firstFile = path.join(out, first.files['pm.db'].backup_path);
  const firstHash = createHash('sha256').update(fs.readFileSync(firstFile)).digest('hex');
  const db = new DatabaseSync(dbPath);
  db.prepare('UPDATE items SET title = ? WHERE id = ?').run('second backup', 'T-1');
  db.close();
  const second = backupDataStores(src, out);
  const latest = readLatestBackup(out);
  const secondFile = path.join(out, latest.manifest.files['pm.db'].backup_path);
  assert.equal(latest.manifest.current, second.version);
  assert.equal(latest.manifest.previous_version, first.version);
  assert.deepEqual(latest.manifest.history, [first.version, second.version]);
  assert.equal(createHash('sha256').update(fs.readFileSync(firstFile)).digest('hex'), firstHash);
  assert.deepEqual(fingerprint(firstFile).rows, [{ id: 'T-1', title: 'first backup' }]);
  assert.deepEqual(fingerprint(secondFile).rows, [{ id: 'T-1', title: 'second backup' }]);
  assert.notEqual(path.resolve(firstFile), path.resolve(secondFile));
});

test('a pre-existing backup file is preserved while a new version is published', (t) => {
  const root = tempDir(t, 'command-backup-occupied-');
  const { src, out, dbPath } = makeFileDb(root, [{ id: 'T-1', title: 'new backup' }]);
  fs.mkdirSync(out, { recursive: true });
  const dest = path.join(out, 'pm.db');
  makeDb(dest, [{ id: 'OLD', title: 'prior backup' }]);
  const occupied = fs.statSync(dest, { bigint: true });
  const prior = fingerprint(dest);
  const sourceBefore = fingerprint(dbPath);
  const manifest = backupDataStores(src, out);
  const after = fs.statSync(dest, { bigint: true });
  assert.equal(after.ino, occupied.ino);
  assert.deepEqual(fingerprint(dest), prior);
  assert.notEqual(path.resolve(path.join(out, manifest.files['pm.db'].backup_path)), path.resolve(dest));
  assert.deepEqual(fingerprint(path.join(out, manifest.files['pm.db'].backup_path)).rows, [{ id: 'T-1', title: 'new backup' }]);
  assert.deepEqual(fingerprint(dbPath), sourceBefore);
  assert.equal(readLatestBackup(out).manifest.current, manifest.version);
});

test('a destination created during publication is not overwritten or recorded as the backup', (t) => {
  const root = tempDir(t, 'command-backup-race-');
  const { src, out, dbPath } = makeFileDb(root, [{ id: 'T-1', title: 'ours' }]);
  const sourceBefore = fingerprint(dbPath);
  const competitor = Buffer.from('competitor-kept-bytes');
  const competitorHash = createHash('sha256').update(competitor).digest('hex');
  const realPlace = publishSeam.placeExclusive;
  let victim = null;
  publishSeam.placeExclusive = (existing, neu) => {
    victim = neu;
    fs.writeFileSync(neu, competitor);
    return realPlace(existing, neu);
  };
  t.after(() => { publishSeam.placeExclusive = realPlace; });
  try {
    assert.throws(() => backupDataStores(src, out), (error) => {
      assert.equal(error.code, 'BACKUP_DESTINATION_UNSAFE');
      assert.match(error.message, /already exists/);
      return true;
    });
    assert.equal(createHash('sha256').update(fs.readFileSync(victim)).digest('hex'), competitorHash);
    assert.deepEqual(fingerprint(dbPath), sourceBefore);
    assert.throws(() => readLatestBackup(out), (error) => error.code === 'BACKUP_MANIFEST_MISSING');
    assert.deepEqual(backupResidue(out), []);
  } finally {
    publishSeam.placeExclusive = realPlace;
  }
});

test('a staging backup replaced after verification is not recorded as success', (t) => {
  const root = tempDir(t, 'command-backup-swap-');
  const { src, out, dbPath } = makeFileDb(root, [{ id: 'SRC', title: 'verified row' }]);
  const sourceBefore = fingerprint(dbPath);
  const realBefore = publishSeam.beforeExclusivePublish;
  let substitutePath = null;
  let substituteHash = null;
  publishSeam.beforeExclusivePublish = (temp) => {
    fs.renameSync(temp, `${temp}.verified-aside`);
    makeDb(temp, [{ id: 'SUB', title: 'substitute row' }]);
    substitutePath = temp;
    substituteHash = createHash('sha256').update(fs.readFileSync(temp)).digest('hex');
  };
  t.after(() => { publishSeam.beforeExclusivePublish = realBefore; });
  try {
    assert.throws(() => backupDataStores(src, out), (error) => {
      assert.equal(error.code, 'BACKUP_STAGING_SUBSTITUTED');
      return true;
    });
    assert.equal(createHash('sha256').update(fs.readFileSync(substitutePath)).digest('hex'), substituteHash);
    assert.deepEqual(fingerprint(substitutePath).rows, [{ id: 'SUB', title: 'substitute row' }]);
    assert.deepEqual(fingerprint(dbPath), sourceBefore);
    assert.throws(() => readLatestBackup(out), (error) => error.code === 'BACKUP_MANIFEST_MISSING');
  } finally {
    publishSeam.beforeExclusivePublish = realBefore;
  }
});

test('a cleanup target replaced immediately before unlink is preserved and is not success', (t) => {
  const root = tempDir(t, 'command-backup-cleanup-');
  const { src, out, dbPath } = makeFileDb(root, [{ id: 'T-1', title: 'cleanup' }]);
  const sourceBefore = fingerprint(dbPath);
  const realCleanup = publishSeam.beforeCleanupUnlink;
  let foreignPath = null;
  let foreignHash = null;
  let foreignIno = null;
  publishSeam.beforeCleanupUnlink = (file) => {
    fs.renameSync(file, `${file}.ours`);
    fs.writeFileSync(file, 'foreign-cleanup-bytes');
    foreignPath = file;
    foreignHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    foreignIno = fs.statSync(file, { bigint: true }).ino;
  };
  t.after(() => { publishSeam.beforeCleanupUnlink = realCleanup; });
  try {
    assert.throws(() => backupDataStores(src, out), (error) => {
      assert.equal(error.code, 'BACKUP_CLEANUP_INCOMPLETE');
      return true;
    });
    const after = fs.statSync(foreignPath, { bigint: true });
    assert.equal(after.ino, foreignIno);
    assert.equal(createHash('sha256').update(fs.readFileSync(foreignPath)).digest('hex'), foreignHash);
    assert.deepEqual(fingerprint(dbPath), sourceBefore);
    assert.throws(() => readLatestBackup(out), (error) => error.code === 'BACKUP_MANIFEST_MISSING');
  } finally {
    publishSeam.beforeCleanupUnlink = realCleanup;
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
    const manifest = backupDataStores(src, out);
    const after = fs.statSync(dest, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(after.nlink >= 1n, true);
    assert.equal(createHash('sha256').update(fs.readFileSync(dest)).digest('hex'), rewrittenHash);
    assert.notEqual(path.resolve(path.join(out, manifest.files['pm.db'].backup_path)), path.resolve(dest));
    assert.deepEqual(fingerprint(path.join(out, manifest.files['pm.db'].backup_path)).rows, [{ id: 'T-1', title: 'new backup' }]);
    assert.deepEqual(fingerprint(dbPath), sourceBefore);
    assert.equal(readLatestBackup(out).manifest.current, manifest.version);
  } finally {
    fs.unlinkSync = realUnlink;
    fs.rmSync = realRm;
    fs.renameSync = realRename;
  }
});

