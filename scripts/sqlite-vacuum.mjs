/**
 * Shared SQLite path literal and verified no-clobber publication.
 *
 * VACUUM INTO cannot take a bound parameter. The destination is quoted, and
 * the copy is refused when it is not a different file from the source.
 *
 * Concurrency contract this module implements:
 * 1. Cooperative Starq processes are not coordinated by a lock file. An
 *    existing destination name fails closed with EEXIST and is not modified.
 * 2. Another process that replaces the staging directory entry after
 *    verification is refused. The verified object is the inode held on the
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
 *    verifying handle, written to a new file in the private staging directory,
 *    and exclusive-linked. Success requires the destination file index and
 *    digest to match that image. A mismatch is failure. There is no fallback
 *    that replaces an existing name.
 *
 * Temps live in a private mkdtemp directory (mode 0700) on the destination
 * volume. Cleanup may unlink a name in that directory only while the fd this
 * process still holds refers to the inode it created and a fresh fstat of the
 * directory entry still names that inode. If the entry's inode differs, the
 * name is left in place and the call throws BACKUP_CLEANUP_INCOMPLETE.
 * Public names, including the destination, are never unlinked.
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
 * The default publishes through the exclusive primitive.
 */
export const publishSeam = {
  beforeExclusivePublish(_tempPath) {},
  beforeCleanupUnlink(_file) {},
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

/** Private staging directory on the same volume as `anchor`. Mode 0700. */
export function createPrivateStagingDir(anchor) {
  const parent = path.dirname(path.resolve(anchor));
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, `.staging-${process.pid}-`));
  try { fs.chmodSync(dir, 0o700); } catch { /* mode bits are advisory on Windows */ }
  return dir;
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
    const error = new Error('short read from the verified handle');
    error.code = 'BACKUP_STAGING_SUBSTITUTED';
    throw error;
  }
  return buffer;
}

function digestOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function insidePrivate(file, privateDir) {
  const rel = path.relative(path.resolve(privateDir), path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Unlink `file` only when it is inside `privateDir` and a fresh fstat of that
 * directory entry still names the inode held by `heldFd`.
 */
export function releaseOwnedTemp(file, heldFd, privateDir, source) {
  if (file === undefined || heldFd === undefined || heldFd === null || !privateDir) return;
  const resolved = path.resolve(file);
  if (source && resolved === path.resolve(source)) {
    throw Object.assign(new Error('refusing to unlink the source'), { code: 'BACKUP_CLEANUP_INCOMPLETE', preserved: resolved });
  }
  if (!insidePrivate(resolved, privateDir)) {
    throw Object.assign(
      new Error(`refusing to unlink ${resolved} outside the private staging directory`),
      { code: 'BACKUP_CLEANUP_INCOMPLETE', preserved: resolved },
    );
  }
  publishSeam.beforeCleanupUnlink(resolved);
  let entryFd;
  try {
    entryFd = fs.openSync(resolved, 'r');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  try {
    const entry = fs.fstatSync(entryFd, { bigint: true });
    const held = fs.fstatSync(heldFd, { bigint: true });
    if (entry.dev !== held.dev || entry.ino !== held.ino) {
      throw Object.assign(
        new Error(`cleanup left ${resolved} in place because its directory entry is not the inode this process holds`),
        { code: 'BACKUP_CLEANUP_INCOMPLETE', preserved: resolved },
      );
    }
  } finally {
    fs.closeSync(entryFd);
  }
  fs.unlinkSync(resolved);
}

/** Remove a private staging directory only when it is already empty. */
export function removeEmptyPrivateDir(privateDir) {
  try {
    fs.rmdirSync(privateDir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw Object.assign(
      new Error(`private staging directory ${privateDir} still holds a file that was not removed`),
      { code: 'BACKUP_CLEANUP_INCOMPLETE', preserved: privateDir, cause: error },
    );
  }
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
      const error = new Error(`published file ${destination} is not the verified object`);
      error.code = 'BACKUP_PUBLISH_MISMATCH';
      throw error;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function publishObject(fd, owned, verifiedBytes, verifiedDigest, destination, source, privateDir) {
  if (process.platform === 'linux') {
    try {
      publishSeam.placeExclusive(`/proc/${process.pid}/fd/${fd}`, destination);
    } catch (error) {
      throw exclusiveFailure(error, destination);
    }
    assertPublishedMatches(destination, owned, verifiedDigest);
    return;
  }

  const image = path.join(privateDir, `image-${randomBytes(4).toString('hex')}.db`);
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
    try { releaseOwnedTemp(image, imageFd, privateDir, source); }
    catch (cleanup) {
      if (cleanup.code === 'BACKUP_CLEANUP_INCOMPLETE') {
        fs.closeSync(imageFd);
        throw cleanup;
      }
    }
    fs.closeSync(imageFd);
    throw error;
  }
  try {
    publishSeam.placeExclusive(image, destination);
    assertPublishedMatches(destination, imageStat, verifiedDigest);
    releaseOwnedTemp(image, imageFd, privateDir, source);
  } catch (error) {
    if (error.code !== 'BACKUP_PUBLISH_MISMATCH' && error.code !== 'BACKUP_CLEANUP_INCOMPLETE' && error.code !== 'BACKUP_STAGING_SUBSTITUTED') {
      try { releaseOwnedTemp(image, imageFd, privateDir, source); }
      catch (cleanup) {
        if (cleanup.code === 'BACKUP_CLEANUP_INCOMPLETE') {
          fs.closeSync(imageFd);
          throw cleanup;
        }
      }
      fs.closeSync(imageFd);
      throw exclusiveFailure(error, destination);
    }
    fs.closeSync(imageFd);
    throw error;
  }
  fs.closeSync(imageFd);
}

/**
 * Publish the inode held by `fd` to `destination`.
 * `stagingPath` is the private-directory entry that must still name that inode.
 * A substituted entry is not published and not unlinked.
 */
export function publishVerifiedFd(fd, stagingPath, destination, { source, privateDir } = {}) {
  if (!privateDir) {
    throw Object.assign(new Error('verified publication requires a private staging directory'), { code: 'BACKUP_DESTINATION_UNSAFE' });
  }
  const verifiedBytes = readAll(fd);
  const verifiedDigest = digestOf(verifiedBytes);
  const owned = fs.fstatSync(fd, { bigint: true });
  publishSeam.beforeExclusivePublish(stagingPath);
  let current = null;
  try { current = fs.statSync(stagingPath, { bigint: true }); } catch { current = null; }
  if (!current || current.dev !== owned.dev || current.ino !== owned.ino) {
    throw Object.assign(new Error(
      `refusing publication: staging path ${stagingPath} no longer names the verified object; the substituted file was not published or deleted`,
    ), { code: 'BACKUP_STAGING_SUBSTITUTED', preserved: stagingPath });
  }
  const heldAgain = readAll(fd);
  if (digestOf(heldAgain) !== verifiedDigest) {
    throw Object.assign(new Error('refusing publication: the verified object changed before publication'), { code: 'BACKUP_STAGING_SUBSTITUTED' });
  }
  publishObject(fd, owned, heldAgain, verifiedDigest, destination, source, privateDir);
  return { destination, digest: verifiedDigest, bytes: heldAgain.length };
}

/**
 * Copy a SQLite database with VACUUM INTO.
 * The source is opened read-only. The destination must not exist and must
 * not resolve to the source. Nothing here deletes or replaces the source,
 * a pre-existing destination, or a substituted staging inode.
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

  const privateDir = createPrivateStagingDir(destination);
  const temp = path.join(privateDir, 'vacuum.db');
  sqlitePathLiteral(temp);
  refuseAlias(source, temp);

  const db = new DatabaseSync(source, { readOnly: true });
  let fd;
  try {
    db.exec(`VACUUM INTO ${sqlitePathLiteral(temp)}`);
    fd = fs.openSync(temp, 'r');
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
    const published = publishVerifiedFd(fd, temp, destination, { source, privateDir });
    releaseOwnedTemp(temp, fd, privateDir, source);
    removeEmptyPrivateDir(privateDir);
    return { destination, integrity: verdict, digest: published.digest, bytes: published.bytes };
  } catch (error) {
    if (fd !== undefined && error.code !== 'BACKUP_STAGING_SUBSTITUTED' && error.code !== 'BACKUP_CLEANUP_INCOMPLETE') {
      try { releaseOwnedTemp(temp, fd, privateDir, source); }
      catch (cleanup) {
        if (cleanup.code === 'BACKUP_CLEANUP_INCOMPLETE') throw cleanup;
      }
      try { removeEmptyPrivateDir(privateDir); }
      catch (cleanup) {
        if (cleanup.code === 'BACKUP_CLEANUP_INCOMPLETE') throw cleanup;
      }
    }
    throw error;
  } finally {
    db.close();
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* closed by an earlier failure path */ }
    }
  }
}
