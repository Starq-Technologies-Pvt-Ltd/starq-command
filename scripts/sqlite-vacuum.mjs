/**
 * Shared SQLite path literal and a read-only VACUUM INTO.
 *
 * VACUUM INTO cannot take a bound parameter. The destination is quoted, and
 * the copy is refused when it is not a different file from the source. A
 * failure deletes only a temporary file this call created.
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

function discardOwnedTemp(source, file) {
  if (!file || !fs.existsSync(file)) return;
  if (classifyFilesystemPath(source, file) !== 'DIFFERENT') return;
  fs.rmSync(file, { force: true });
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
    discardOwnedTemp(source, temp);
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
    refuseAlias(source, destination);
    refuseAlias(source, temp);
    if (fs.existsSync(destination)) {
      const error = new Error(`refusing VACUUM INTO: destination already exists: ${destination}`);
      error.code = 'BACKUP_DESTINATION_UNSAFE';
      throw error;
    }
    fs.renameSync(temp, destination);
  } catch (error) {
    discardOwnedTemp(source, temp);
    throw error;
  }
  return { destination, integrity: verdict };
}
