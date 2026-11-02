/**
 * Shared SQLite path literal and a read-only VACUUM INTO.
 *
 * VACUUM INTO cannot take a bound parameter. The destination is quoted, and
 * the copy is refused when it is not a different file from the source.
 *
 * Publication is an exclusive hard link (`link(2)` / `CreateHardLinkW`).
 * A rename replaces an existing name, so it is not used to publish. The link
 * fails with EEXIST when another process created the name, including a
 * symlink. Cross-volume and unsupported filesystems fail closed; there is
 * no rename or copy-over fallback.
 *
 * Cleanup removes only the process-owned temporary name. A failed publish
 * unlinks that temp when it is still a different file from the source and
 * from the destination. A successful link commits the destination name;
 * the temp name is then unlinked because it is the same inode. The
 * destination, the source, and a competing file are never unlinked.
 *
 * Used by the data-store backup and the Windows lifecycle acceptance seed.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classifyFilesystemPath } from '../server/room-path.mjs';

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

function discardOwnedTemp(source, file, destination) {
  if (!file || !fs.existsSync(file)) return;
  const resolved = path.resolve(file);
  if (destination && resolved === path.resolve(destination)) return;
  if (classifyFilesystemPath(source, file) !== 'DIFFERENT') return;
  if (destination && fs.existsSync(destination) && classifyFilesystemPath(file, destination) !== 'DIFFERENT') return;
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
  try {
    db.exec(`VACUUM INTO ${sqlitePathLiteral(temp)}`);
  } catch (error) {
    discardOwnedTemp(source, temp, destination);
    throw error;
  } finally {
    db.close();
  }

  let verdict;
  try {
    const check = new DatabaseSync(temp, { readOnly: true });
    try {
      const row = check.prepare('PRAGMA integrity_check').get();
      verdict = row.integrity_check ?? Object.values(row)[0];
    } finally {
      check.close();
    }
    if (verdict !== 'ok') {
      throw new Error(`VACUUM INTO copy failed integrity_check: ${verdict}`);
    }
  } catch (error) {
    discardOwnedTemp(source, temp, destination);
    throw error;
  }

  refuseAlias(source, destination);
  refuseAlias(source, temp);
  let published = false;
  try {
    fs.linkSync(temp, destination);
    published = true;
    fs.unlinkSync(temp);
  } catch (error) {
    if (!published) {
      discardOwnedTemp(source, temp, destination);
      throw exclusiveFailure(error, destination);
    }
    const wrapped = new Error(`exclusive publish committed ${destination}; temporary name remains: ${error.message}`);
    wrapped.code = 'BACKUP_TEMP_CLEANUP';
    throw wrapped;
  }
  return { destination, integrity: verdict };
}
