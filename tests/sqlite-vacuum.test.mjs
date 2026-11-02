/**
 * Disposable-fixture regressions for the shared VACUUM INTO helper.
 * Never opens data/pm-operating.db. The Windows acceptance seed calls this helper.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { vacuumIntoDistinct } from '../scripts/sqlite-vacuum.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function ownedTemps(dir) {
  return fs.readdirSync(dir).filter((name) => name.startsWith('.vacuum-') || name.startsWith('.replaced-'));
}

test('a path with an apostrophe and spaces copies without changing the source', (t) => {
  const root = tempDir(t, "starq-vac-o'brien ");
  const source = path.join(root, 'source data', 'board.db');
  const destination = path.join(root, "copy (1)", 'board.db');
  const rows = [{ id: 'T-1', title: "O'Brien task" }, { id: 'T-2', title: 'canal gate' }];
  makeDb(source, rows);
  const before = fingerprint(source);

  const result = vacuumIntoDistinct(source, destination);

  assert.equal(result.integrity, 'ok');
  assert.deepEqual(fingerprint(source), before);
  assert.deepEqual(fingerprint(destination).rows, rows);
  assert.deepEqual(ownedTemps(path.dirname(destination)), []);
});

test('a destination that is the source, a case alias, or a file symlink is rejected', (t) => {
  const root = tempDir(t, 'starq-vac-reject-');
  const source = path.join(root, 'board.db');
  makeDb(source);
  const before = fingerprint(source);

  assert.throws(() => vacuumIntoDistinct(source, source), (error) => {
    assert.equal(error.code, 'BACKUP_DESTINATION_UNSAFE');
    assert.match(error.message, /SAME/);
    return true;
  });
  const alias = path.join(root, 'BOARD.DB');
  assert.throws(() => vacuumIntoDistinct(source, alias), /SAME/);

  const link = path.join(root, 'linked.db');
  fs.symlinkSync(source, link, 'file');
  assert.throws(() => vacuumIntoDistinct(source, link), (error) => {
    assert.equal(error.code, 'BACKUP_DESTINATION_UNSAFE');
    return true;
  });

  assert.deepEqual(fingerprint(source), before);
  assert.equal(fs.readlinkSync(link), source);
  assert.equal(fs.readdirSync(root).some((name) => name.startsWith('.vacuum-')), false);
});

test('a control character is rejected before any destination is created', (t) => {
  const root = tempDir(t, 'starq-vac-control-');
  const source = path.join(root, 'board.db');
  makeDb(source);
  const before = fingerprint(source);
  const destination = path.join(root, 'bad\nname', 'board.db');

  assert.throws(() => vacuumIntoDistinct(source, destination), (error) => {
    assert.equal(error.code, 'BACKUP_DESTINATION_UNSAFE');
    assert.match(error.message, /control character/);
    return true;
  });

  assert.deepEqual(fingerprint(source), before);
  assert.equal(fs.existsSync(path.join(root, 'bad\nname')), false);
});

test('a failed copy leaves the source bytes in place and creates no destination', (t) => {
  const root = tempDir(t, 'starq-vac-fail-');
  const source = path.join(root, 'corrupt.db');
  fs.writeFileSync(source, 'this is not a sqlite database');
  const sourceBytes = fs.readFileSync(source);
  const destination = path.join(root, 'kept', 'board.db');

  assert.throws(() => vacuumIntoDistinct(source, destination), /not a database|SQLITE/i);

  assert.deepEqual(fs.readFileSync(source), sourceBytes);
  assert.equal(fs.existsSync(destination), false);
  assert.deepEqual(ownedTemps(path.join(root, 'kept')), []);
});

test('an existing distinct destination is refused rather than replaced', (t) => {
  const root = tempDir(t, 'starq-vac-exists-');
  const source = path.join(root, 'source.db');
  const destination = path.join(root, 'dest.db');
  makeDb(source, [{ id: 'NEW', title: 'incoming' }]);
  makeDb(destination, [{ id: 'OLD', title: 'stay' }]);
  const sourceBefore = fingerprint(source);
  const destBefore = fingerprint(destination);

  assert.throws(() => vacuumIntoDistinct(source, destination), (error) => {
    assert.equal(error.code, 'BACKUP_DESTINATION_UNSAFE');
    assert.match(error.message, /already exists/);
    return true;
  });

  assert.deepEqual(fingerprint(source), sourceBefore);
  assert.deepEqual(fingerprint(destination), destBefore);
});

test('the Windows acceptance seed calls the shared helper instead of interpolating a path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'acceptance', 'windows-lifecycle-acceptance.mjs'), 'utf8');
  assert.match(source, /vacuumIntoDistinct\(SEED, DB\(\)\)/);
  assert.doesNotMatch(source, /VACUUM INTO '\$\{/);
});
