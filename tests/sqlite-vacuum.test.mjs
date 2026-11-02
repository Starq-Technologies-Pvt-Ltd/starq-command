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
import { publishSeam, vacuumIntoDistinct } from '../scripts/sqlite-vacuum.mjs';

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
  const sourceStat = fs.statSync(source);
  const destinationStat = fs.statSync(destination);
  assert.notEqual(`${sourceStat.dev}:${sourceStat.ino}`, `${destinationStat.dev}:${destinationStat.ino}`);
  assert.equal(destinationStat.nlink, 1);
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

  const hard = path.join(root, 'hard-link.db');
  fs.linkSync(source, hard);
  assert.throws(() => vacuumIntoDistinct(source, hard), /SAME/);
  assert.equal(fs.statSync(hard).ino, fs.statSync(source).ino);

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

test('a destination created immediately before publication is not replaced', (t) => {
  const root = tempDir(t, 'starq-vac-race-');
  const source = path.join(root, 'source.db');
  const destination = path.join(root, 'board.db');
  const rows = [{ id: 'T-1', title: "O'Brien task" }];
  makeDb(source, rows);
  const sourceBefore = fingerprint(source);
  const competitor = Buffer.from('competitor-kept-bytes');
  const competitorHash = createHash('sha256').update(competitor).digest('hex');
  const realPlace = publishSeam.placeExclusive;
  const realRename = fs.renameSync;
  let renameCalls = 0;
  let publishedHash = null;
  fs.renameSync = (...args) => {
    renameCalls += 1;
    return realRename(...args);
  };
  publishSeam.placeExclusive = (existing, neu) => {
    fs.writeFileSync(neu, competitor);
    publishedHash = createHash('sha256').update(fs.readFileSync(neu)).digest('hex');
    return realPlace(existing, neu);
  };
  t.after(() => {
    publishSeam.placeExclusive = realPlace;
    fs.renameSync = realRename;
  });

  try {
    assert.throws(() => vacuumIntoDistinct(source, destination), (error) => {
      assert.equal(error.code, 'BACKUP_DESTINATION_UNSAFE');
      assert.match(error.message, /already exists/);
      return true;
    });

    const competitorAfter = createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
    assert.equal(publishedHash, competitorHash);
    assert.equal(competitorAfter, competitorHash);
    assert.deepEqual(fingerprint(source), sourceBefore);
    assert.equal(renameCalls, 0);
    assert.deepEqual(ownedTemps(root), []);
  } finally {
    publishSeam.placeExclusive = realPlace;
    fs.renameSync = realRename;
  }
});

test('an unavailable exclusive link fails closed without renaming', (t) => {
  const root = tempDir(t, 'starq-vac-noclobber-');
  const realPlace = publishSeam.placeExclusive;
  const realRename = fs.renameSync;
  t.after(() => {
    publishSeam.placeExclusive = realPlace;
    fs.renameSync = realRename;
  });

  for (const code of ['ENOTSUP', 'EXDEV', 'EPERM']) {
    const source = path.join(root, code, 'source.db');
    const destination = path.join(root, code, 'board.db');
    const kept = path.join(root, code, 'preexisting.db');
    makeDb(source, [{ id: code, title: 'source row' }]);
    makeDb(kept, [{ id: 'KEEP', title: 'pre-existing' }]);
    const sourceBefore = fingerprint(source);
    const keptBefore = fingerprint(kept);
    let renameCalls = 0;
    fs.renameSync = () => {
      renameCalls += 1;
      throw new Error('rename fallback is forbidden');
    };
    publishSeam.placeExclusive = () => {
      const error = new Error(`simulated ${code}`);
      error.code = code;
      throw error;
    };

    assert.throws(() => vacuumIntoDistinct(source, destination), (error) => {
      assert.equal(error.code, 'BACKUP_DESTINATION_UNSAFE');
      assert.match(error.message, new RegExp(`exclusive hard link is unavailable \\(${code}\\)`));
      return true;
    });

    assert.equal(fs.existsSync(destination), false);
    assert.equal(renameCalls, 0);
    assert.deepEqual(fingerprint(source), sourceBefore);
    assert.deepEqual(fingerprint(kept), keptBefore);
    assert.deepEqual(ownedTemps(path.join(root, code)), []);
    publishSeam.placeExclusive = realPlace;
    fs.renameSync = realRename;
  }
});

test('a staging database replaced after verification is not published', (t) => {
  const root = tempDir(t, 'starq-vac-swap-');
  const source = path.join(root, 'source.db');
  const destination = path.join(root, 'board.db');
  const witness = path.join(root, 'witness.db');
  makeDb(source, [{ id: 'SRC', title: 'verified row' }]);
  makeDb(witness, [{ id: 'KEEP', title: 'pre-existing' }]);
  const sourceBefore = fingerprint(source);
  const witnessBefore = fingerprint(witness);
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
    assert.throws(() => vacuumIntoDistinct(source, destination), (error) => {
      assert.equal(error.code, 'BACKUP_STAGING_SUBSTITUTED');
      return true;
    });
    assert.equal(fs.existsSync(destination), false);
    assert.equal(createHash('sha256').update(fs.readFileSync(substitutePath)).digest('hex'), substituteHash);
    assert.deepEqual(fingerprint(substitutePath).rows, [{ id: 'SUB', title: 'substitute row' }]);
    assert.deepEqual(fingerprint(source), sourceBefore);
    assert.deepEqual(fingerprint(witness), witnessBefore);
  } finally {
    publishSeam.beforeExclusivePublish = realBefore;
  }
});

test('publication binds the verified descriptor and has no rename fallback', () => {
  const helper = fs.readFileSync(path.join(ROOT, 'scripts', 'sqlite-vacuum.mjs'), 'utf8');
  assert.match(helper, /spawnSync\('ln', \['-L'/);
  assert.match(helper, /\/proc\/\$\{process\.pid\}\/fd\/\$\{fd\}/);
  assert.doesNotMatch(helper, /\brenameSync\b/);
  assert.doesNotMatch(helper, /fs\.linkSync\(temp/);
});

test('the Windows acceptance seed calls the shared helper instead of interpolating a path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'acceptance', 'windows-lifecycle-acceptance.mjs'), 'utf8');
  assert.match(source, /vacuumIntoDistinct\(SEED, DB\(\)\)/);
  assert.doesNotMatch(source, /VACUUM INTO '\$\{/);
});
