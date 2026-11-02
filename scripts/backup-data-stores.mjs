/**
 * Verified backup of every Command data store — READ-ONLY on the source.
 *
 * Founder directive (1 Nov 2026) §5: establish verified backups of every
 * affected data store and validate their integrity before any persistence
 * change. `VACUUM INTO` is used rather than a file copy because it writes a
 * consistent snapshot of the committed state, including anything still in the
 * write-ahead log, while the source is opened read-only and never modified.
 *
 * The destination is proven distinct from the source before any publication.
 * A failed backup deletes only a temp file this process created.
 *
 * Concurrency contract this module implements:
 * 1. Cooperative Starq processes are not coordinated here. There is no lock
 *    file. An occupied canonical backup name is a conflict, not a retirement.
 * 2. Another process that replaces a directory entry is not overwritten.
 *    The exclusive link fails with EEXIST and the occupied name stays.
 * 3. Another process that rewrites the same inode, keeps the byte length, and
 *    restores mtime is not judged "unchanged". dev:inode:size:mtime is not
 *    used to authorize deletion. Those bytes stay on that inode.
 * 4. A same-user writer with full write access to an open inode after this
 *    call returns is outside the contract. No absolute protection against
 *    that party is claimed.
 *
 * Usage: node scripts/backup-data-stores.mjs --data <dir> --out <dir>
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFilesystemPath } from '../server/room-path.mjs';
import { sqlitePathLiteral } from './sqlite-vacuum.mjs';

export { sqlitePathLiteral };

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

function distinctFromSources(candidate, sources, label) {
  for (const file of sources) {
    const verdict = classifyFilesystemPath(file.src, candidate);
    if (verdict !== 'DIFFERENT') {
      throw Object.assign(
        new Error(`refusing backup: ${label} ${candidate} is ${verdict} relative to source ${file.src}`),
        { code: 'BACKUP_DESTINATION_UNSAFE' },
      );
    }
  }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Copy every store in `srcDir` into a different directory.
 * Throws before deleting anything when the destination is the source, an
 * alias of the source, or not provably different.
 */
export function backupDataStores(srcDir, outDir) {
  if (!srcDir || !outDir) {
    throw Object.assign(new Error('both --data and --out are required'), { code: 'BACKUP_DESTINATION_UNSAFE' });
  }
  const srcRoot = path.resolve(srcDir);
  const outRoot = path.resolve(outDir);
  if (!fs.existsSync(srcRoot) || !fs.statSync(srcRoot).isDirectory()) {
    throw Object.assign(new Error(`source directory not found: ${srcRoot}`), { code: 'BACKUP_DESTINATION_UNSAFE' });
  }
  const directoryRelation = classifyFilesystemPath(srcRoot, outRoot);
  if (directoryRelation !== 'DIFFERENT') {
    throw Object.assign(
      new Error(`refusing backup: destination directory is ${directoryRelation} relative to source ${srcRoot}`),
      { code: 'BACKUP_DESTINATION_UNSAFE' },
    );
  }

  fs.mkdirSync(outRoot, { recursive: true });
  const afterCreate = classifyFilesystemPath(srcRoot, outRoot);
  if (afterCreate !== 'DIFFERENT') {
    throw Object.assign(
      new Error(`refusing backup: destination directory is ${afterCreate} relative to source ${srcRoot}`),
      { code: 'BACKUP_DESTINATION_UNSAFE' },
    );
  }

  const sources = [];
  for (const name of fs.readdirSync(srcRoot).sort()) {
    const src = path.join(srcRoot, name);
    if (!fs.statSync(src).isFile()) continue;
    sources.push({ name, src });
  }

  const plan = [];
  for (const file of sources) {
    if (file.name.endsWith('-wal') || file.name.endsWith('-shm')) continue;
    const dest = path.join(outRoot, file.name);
    distinctFromSources(dest, sources, 'destination');
    plan.push({ ...file, dest, kind: file.name.endsWith('.db') ? 'sqlite' : 'file' });
  }
  const manifestPath = path.join(outRoot, 'backup-manifest.json');
  distinctFromSources(manifestPath, sources, 'manifest');

  const manifest = { created_at: new Date().toISOString(), source: srcRoot, files: {} };
  const createdByUs = new Set();

  const discardTemp = (temp) => {
    if (!temp || !createdByUs.has(path.resolve(temp)) || !fs.existsSync(temp)) return;
    distinctFromSources(temp, sources, 'temporary file');
    fs.rmSync(temp, { force: true });
    createdByUs.delete(path.resolve(temp));
  };

  // Exclusive no-clobber publish. link fails with EEXIST when the name
  // exists, including a symlink, and does not replace that name.
  const linkIntoPlace = (temp, dest) => {
    fs.linkSync(temp, dest);
    try { fs.unlinkSync(temp); } catch { /* dest holds the inode */ }
    createdByUs.delete(path.resolve(temp));
  };

  const publish = (temp, dest) => {
    distinctFromSources(temp, sources, 'temporary file');
    distinctFromSources(dest, sources, 'destination');
    try {
      linkIntoPlace(temp, dest);
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    // The canonical name is occupied. Do not rename it, hash it, or unlink it.
    // Keep whatever inode is there, and place this process's new bytes at a
    // unique sibling. The call still fails: an occupied name is not success.
    const sibling = `${dest}.preserved-${process.pid}-${randomBytes(4).toString('hex')}`;
    distinctFromSources(sibling, sources, 'preserved backup');
    try {
      fs.linkSync(temp, sibling);
    } catch (linkError) {
      throw Object.assign(new Error(
        `backup name occupied: ${dest} was left unchanged and was not deleted; the new backup could not be placed at ${sibling}`,
      ), { code: 'BACKUP_NAME_OCCUPIED', preserved: dest, cause: linkError });
    }
    try { fs.unlinkSync(temp); } catch { /* sibling holds the inode */ }
    createdByUs.delete(path.resolve(temp));
    throw Object.assign(new Error(
      `backup name occupied: ${dest} was not replaced or deleted; new backup preserved at ${sibling}`,
    ), { code: 'BACKUP_NAME_OCCUPIED', preserved: dest, sibling });
  };

  try {
    for (const item of plan) {
      const temp = path.join(outRoot, `.partial-${process.pid}-${randomBytes(4).toString('hex')}-${item.name}`);
      distinctFromSources(temp, sources, 'temporary file');
      createdByUs.add(path.resolve(temp));
      try {
        if (item.kind === 'sqlite') {
          const db = new DatabaseSync(item.src, { readOnly: true });
          try {
            db.exec(`VACUUM INTO ${sqlitePathLiteral(temp)}`);
          } finally {
            db.close();
          }
          const check = new DatabaseSync(temp, { readOnly: true });
          let verdict;
          try {
            const row = check.prepare('PRAGMA integrity_check').get();
            verdict = row.integrity_check ?? Object.values(row)[0];
          } finally {
            check.close();
          }
          if (verdict !== 'ok') {
            throw new Error(`${item.name} backup failed integrity_check: ${verdict}`);
          }
          publish(temp, item.dest);
          manifest.files[item.name] = {
            kind: 'sqlite',
            source_bytes: fs.statSync(item.src).size,
            source_sha256: sha256(item.src),
            backup_bytes: fs.statSync(item.dest).size,
            backup_sha256: sha256(item.dest),
            backup_integrity_check: verdict,
          };
        } else {
          fs.copyFileSync(item.src, temp);
          publish(temp, item.dest);
          manifest.files[item.name] = {
            kind: 'file',
            source_sha256: sha256(item.src),
            backup_sha256: sha256(item.dest),
          };
        }
      } catch (error) {
        discardTemp(temp);
        throw error;
      }
    }
  } catch (error) {
    for (const temp of createdByUs) discardTemp(temp);
    throw error;
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

function main() {
  const src = arg('--data');
  const out = arg('--out');
  if (!src || !out) {
    console.error('Usage: node scripts/backup-data-stores.mjs --data <dir> --out <dir>');
    process.exit(2);
  }
  try {
    const manifest = backupDataStores(src, out);
    for (const [name, file] of Object.entries(manifest.files)) {
      if (file.kind === 'sqlite') {
        const verdict = file.backup_integrity_check;
        console.log(`${verdict === 'ok' ? 'OK  ' : 'FAIL'} ${name} -> ${(file.backup_bytes / 1048576).toFixed(1)}MB (${verdict})`);
      } else {
        console.log(`OK   ${name} (copied)`);
      }
    }
    const manifestPath = path.join(path.resolve(out), 'backup-manifest.json');
    console.log(`\nmanifest: ${manifestPath}`);
    const bad = Object.entries(manifest.files).filter(([, file]) => file.kind === 'sqlite' && file.backup_integrity_check !== 'ok');
    if (bad.length) {
      console.error(`FAILED integrity: ${bad.map(([name]) => name).join(', ')}`);
      process.exit(1);
    }
    console.log(`all ${Object.keys(manifest.files).length} stores backed up and verified`);
  } catch (error) {
    console.error(error.message);
    process.exit(error.code === 'BACKUP_DESTINATION_UNSAFE' ? 2 : 1);
  }
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isDirectRun) main();
