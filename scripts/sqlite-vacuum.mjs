/**
 * Shared SQLite path literal and a read-only VACUUM INTO.
 *
 * VACUUM INTO cannot take a bound parameter. The destination is quoted, and
 * the copy is refused when it is not a different file from the source.
 *
 * Concurrency contract this module implements:
 * 1. Cooperative Starq processes are not coordinated by a lock file. An
 *    existing destination name fails closed with EEXIST and is not modified.
 * 2. Another process that replaces the staging directory entry after
 *    verification is refused. The verified database is the inode held on the
 *    fd opened before publication. The substituted directory entry is not
 *    published and not unlinked. The call does not return integrity "ok".
 * 3. Another process that rewrites that same inode before publication changes
 *    the digest re-read from the fd. The call fails and does not return
 *    integrity "ok". This does not stop a writer who changes the inode after
 *    a successful return.
 * 4. A same-user writer with full write access to the staging directory and
 *    the open inode is not absolutely excluded. Linux publishes by hard-linking
 *    the verifying fd (`ln -L /proc/<pid>/fd/N`), not by looking up the staging
 *    path again. Node's link() of that proc path fails EXDEV because it does
 *    not follow the descriptor, so GNU ln -L is the primitive that names the
 *    inode. Windows cannot hard-link a handle: the bytes are read from the
 *    verifying handle, written to a new file, and exclusive-linked. Success
 *    requires the destination file index and digest to match that image.
 *    A mismatch is failure. There is no rename fallback.
 *
 * Cleanup removes only a temp whose device and inode are still the one this
 * process created. The source, a pre-existing destination, and a substituted
 * file are never unlinked.
 *
 * Used by the data-store backup and the Windows lifecycle acceptance seed.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { classifyFilesystemPath } from '../server/room-path.mjs';

/**
 * Injection point for deterministic tests. Production calls these functions.
 * The default publishes through the exclusive primitive, not through rename.
 */
export const publishSeam = {
  beforeExclusivePublish(_tempPath) {},
  placeExclusive(existingPath, destination) {
    placeExclusiveDefault(existingPath, destination);
  },
};

/** SQLite string literal for a filesystem path. */
export function sqlitePathLiteral(filePath) {
  const normalized = path.resolve(filePath).split(path.sep).join('/');
  if (/[\u0000-\u001f]/.test(normalized)) {
    const error = new Error('SQLite path contains a control character');
    error.code = 'BACKUP_DESTINATION_UNSAFE';
    throw error;
  }
  return `'${normalized.replaceAll("'", "''")}'`;
}

function refuseAlias(source, candidate) {
  const verdict = classifyFilesystemPath(source, candidate);
  if (verdict !== 'DIFFERENT') {
    const error = new Error(`refusing VACUUM INTO: destination is ${verdict} relative to source ${source}`);
    error.code = 'BACKUP_DESTINATION_UNSAFE';
    throw error;
  }
}

function readAll(fd) {
  const size = Number(fs.fstatSync(fd).size);
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = fs.readSync(fd, buffer, offset, size - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  if (offset !== size) {
    const error = new Error('short read from the verified database handle');
    error.code = 'BACKUP_STAGING_SUBSTITUTED';
    throw error;
  }
  return buffer;
}

function digestOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function unlinkOwned(file, owned, source) {
  if (!owned || !file || !fs.existsSync(file)) return;
  const resolved = path.resolve(file);
  if (source && resolved === path.resolve(source)) return;
  let current;
  try { current = fs.statSync(file, { bigint: true }); }
  catch { return; }
  if (current.dev !== owned.dev || current.ino !== owned.ino) return;
  fs.rmSync(resolved, { force: true });
}

function exclusiveFailure(error, destination) {
  const code = error?.code || 'UNKNOWN';
  const wrapped = new Error(
    code === 'EEXIST'
      ? `refusing VACUUM INTO: destination already exists: ${destination}`
      : `refusing VACUUM INTO: exclusive hard link is unavailable (${code}); destination was not replaced`,
  );
  wrapped.code = 'BACKUP_DESTINATION_UNSAFE';
  wrapped.cause = error;
  return wrapped;
}

function placeExclusiveDefault(existingPath, destination) {
  if (process.platform === 'linux') {
    const proc = spawnSync('ln', ['-L', '--', existingPath, destination], { encoding: 'utf8' });
    if (proc.error) {
      const error = new Error(proc.error.message);
      error.code = proc.error.code || 'ENOENT';
      throw error;
    }
    if (proc.status !== 0) {
      const stderr = proc.stderr || '';
      const error = new Error(stderr.trim() || `ln exited ${proc.status}`);
      if (/File exists/i.test(stderr)) error.code = 'EEXIST';
      else if (/cross-device/i.test(stderr)) error.code = 'EXDEV';
      else if (/not supported/i.test(stderr)) error.code = 'ENOTSUP';
      else if (/Permission denied|Operation not permitted/i.test(stderr)) error.code = 'EPERM';
      else error.code = 'EPERM';
      throw error;
    }
    return;
  }
  fs.linkSync(existingPath, destination);
}

function assertPublishedMatches(destination, owned, verifiedDigest) {
  const fd = fs.openSync(destination, 'r');
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    const digest = digestOf(readAll(fd));
    if (stat.dev !== owned.dev || stat.ino !== owned.ino || digest !== verifiedDigest) {
      const error = new Error(`refusing VACUUM INTO: published file ${destination} is not the verified database`);
      error.code = 'BACKUP_PUBLISH_MISMATCH';
      error.ours = stat.dev === owned.dev && stat.ino === owned.ino;
      throw error;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function publishVerified(fd, owned, verifiedBytes, verifiedDigest, destination, source) {
  if (process.platform === 'linux') {
    try {
      publishSeam.placeExclusive(`/proc/${process.pid}/fd/${fd}`, destination);
    } catch (error) {
      throw exclusiveFailure(error, destination);
    }
    try {
      assertPublishedMatches(destination, owned, verifiedDigest);
    } catch (error) {
      if (error.ours) unlinkOwned(destination, owned, source);
      throw error;
    }
    return;
  }

  const image = path.join(
    path.dirname(destination),
    `.vacuum-image-${process.pid}-${randomBytes(6).toString('hex')}.db`,
  );
  const imageFd = fs.openSync(image, 'wx');
  const imageStat = fs.fstatSync(imageFd, { bigint: true });
  try {
    let written = 0;
    while (written < verifiedBytes.length) {
      const count = fs.writeSync(imageFd, verifiedBytes, written, verifiedBytes.length - written, written);
      if (count === 0) {
        throw Object.assign(new Error('short write of the verified database image'), { code: 'BACKUP_PUBLISH_MISMATCH' });
      }
      written += count;
    }
    fs.fsyncSync(imageFd);
  } catch (error) {
    fs.closeSync(imageFd);
    unlinkOwned(image, imageStat, source);
    throw error;
  }
  fs.closeSync(imageFd);
  try {
    publishSeam.placeExclusive(image, destination);
    assertPublishedMatches(destination, imageStat, verifiedDigest);
  } catch (error) {
    if (error.ours) unlinkOwned(destination, imageStat, source);
    unlinkOwned(image, imageStat, source);
    if (error.code === 'BACKUP_PUBLISH_MISMATCH') throw error;
    throw exclusiveFailure(error, destination);
  }
  unlinkOwned(image, imageStat, source);
}

/**
 * Copy a SQLite database with VACUUM INTO.
 * The source is opened read-only. The destination must not exist and must
 * not resolve to the source. Nothing here deletes or replaces the source.
 */
export function vacuumIntoDistinct(sourcePath, destinationPath) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  sqlitePathLiteral(destination);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    const error = new Error(`source database not found: ${source}`);
    error.code = 'BACKUP_SOURCE_UNAVAILABLE';
    throw error;
  }
  refuseAlias(source, destination);
  if (fs.existsSync(destination)) {
    const error = new Error(`refusing VACUUM INTO: destination already exists: ${destination}`);
    error.code = 'BACKUP_DESTINATION_UNSAFE';
    throw error;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  refuseAlias(source, destination);
  if (fs.existsSync(destination)) {
    const error = new Error(`refusing VACUUM INTO: destination already exists: ${destination}`);
    error.code = 'BACKUP_DESTINATION_UNSAFE';
    throw error;
  }

  const temp = path.join(
    path.dirname(destination),
    `.vacuum-${process.pid}-${randomBytes(6).toString('hex')}.db`,
  );
  sqlitePathLiteral(temp);
  refuseAlias(source, temp);

  const db = new DatabaseSync(source, { readOnly: true });
  let fd;
  let owned;
  try {
    db.exec(`VACUUM INTO ${sqlitePathLiteral(temp)}`);
    fd = fs.openSync(temp, 'r');
    owned = fs.fstatSync(fd, { bigint: true });
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    unlinkOwned(temp, owned, source);
    throw error;
  } finally {
    db.close();
  }

  try {
    const check = new DatabaseSync(temp, { readOnly: true });
    let verdict;
    try {
      const row = check.prepare('PRAGMA integrity_check').get();
      verdict = row.integrity_check ?? Object.values(row)[0];
    } finally {
      check.close();
    }
    if (verdict !== 'ok') {
      throw new Error(`VACUUM INTO copy failed integrity_check: ${verdict}`);
    }
    const verifiedBytes = readAll(fd);
    const verifiedDigest = digestOf(verifiedBytes);
    publishSeam.beforeExclusivePublish(temp);
    let current;
    try { current = fs.statSync(temp, { bigint: true }); }
    catch { current = null; }
    if (!current || current.dev !== owned.dev || current.ino !== owned.ino) {
      const error = new Error(`refusing VACUUM INTO: staging path ${temp} no longer names the verified database; the substituted file was not published or deleted`);
      error.code = 'BACKUP_STAGING_SUBSTITUTED';
      throw error;
    }
    const heldAgain = readAll(fd);
    if (digestOf(heldAgain) !== verifiedDigest) {
      const error = new Error('refusing VACUUM INTO: the verified database changed before publication');
      error.code = 'BACKUP_STAGING_SUBSTITUTED';
      throw error;
    }
    refuseAlias(source, destination);
    publishVerified(fd, owned, heldAgain, verifiedDigest, destination, source);
    unlinkOwned(temp, owned, source);
    return { destination, integrity: verdict };
  } catch (error) {
    unlinkOwned(temp, owned, source);
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}
