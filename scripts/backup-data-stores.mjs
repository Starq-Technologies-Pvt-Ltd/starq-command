/**
 * Verified backup of every Command data store — READ-ONLY on the source.
 *
 * Founder directive (1 Nov 2026) §5: establish verified backups of every
 * affected data store and validate their integrity before any persistence
 * change. `VACUUM INTO` is used rather than a file copy because it writes a
 * consistent snapshot of the committed state, including anything still in the
 * write-ahead log, while the source is opened read-only and never modified.
 *
 * Each run publishes a new immutable version. Previous version files and
 * previous manifests stay. The latest manifest is the one whose history is
 * the longest and whose recorded digests still match the version files.
 * Nothing here rewrites or deletes an older version.
 *
 * Concurrency contract this module implements:
 * 1. Cooperative Starq processes are not coordinated here. There is no lock
 *    file. Two overlapping runs each allocate a new version name. An occupied
 *    name fails the exclusive link and is left in place.
 * 2. Another process that replaces a staging directory entry is not published.
 *    Publication goes through the verified-fd helper in sqlite-vacuum.mjs.
 *    The substituted inode is not unlinked. The call does not return a manifest.
 * 3. Another process that rewrites the same inode, keeps the byte length, and
 *    restores mtime is not judged "unchanged". dev:inode:size:mtime is not
 *    used to authorize deletion. A pre-existing file in the output directory
 *    is never a deletion candidate. A new version is published beside it.
 * 4. A same-user writer with full write access to an open inode after this
 *    call returns is outside the contract. No absolute protection against
 *    that party is claimed.
 *
 * Temps live in a private mkdtemp directory. Cleanup of those names uses the
 * helper that refuses to unlink when a fresh fstat shows a different inode.
 * That outcome is BACKUP_CLEANUP_INCOMPLETE and is not a successful backup.
 *
 * Usage: node scripts/backup-data-stores.mjs --data <dir> --out <dir>
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFilesystemPath } from '../server/room-path.mjs';
import {
  createPrivateStagingDir,
  publishVerifiedFd,
  releaseOwnedTemp,
  removeEmptyPrivateDir,
  sqlitePathLiteral,
  vacuumIntoDistinct,
} from './sqlite-vacuum.mjs';

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

function relativePosix(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function versionId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${process.pid}-${randomBytes(4).toString('hex')}`;
}

function walkFiles(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink() || st.isFile()) found.push(full);
    else if (st.isDirectory()) walkFiles(full, found);
  }
  return found;
}

function manifestEntries(outRoot) {
  const dir = path.join(outRoot, 'manifests');
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(dir, name);
    try {
      const manifest = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (manifest?.version && manifest?.files) entries.push({ manifest, manifestPath: full });
    } catch {
      // An unreadable manifest is left in place and is not current.
    }
  }
  entries.sort((a, b) => {
    const ah = Array.isArray(a.manifest.history) ? a.manifest.history.length : 0;
    const bh = Array.isArray(b.manifest.history) ? b.manifest.history.length : 0;
    if (ah !== bh) return ah - bh;
    if (a.manifest.created_at !== b.manifest.created_at) return a.manifest.created_at < b.manifest.created_at ? -1 : 1;
    return a.manifest.version < b.manifest.version ? -1 : a.manifest.version > b.manifest.version ? 1 : 0;
  });
  return entries;
}

function manifestIsIntact(outRoot, manifest) {
  return Object.values(manifest.files).every((file) => {
    if (!file?.backup_path || !file?.backup_sha256) return false;
    const full = path.join(outRoot, file.backup_path);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
    return sha256(full) === file.backup_sha256;
  });
}

/**
 * The latest intact versioned manifest. Older manifests stay on disk.
 * A manifest whose recorded digest does not match its file is skipped.
 */
export function readLatestBackup(outDir) {
  const outRoot = path.resolve(outDir);
  const entries = manifestEntries(outRoot);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (manifestIsIntact(outRoot, entries[i].manifest)) return entries[i];
  }
  throw Object.assign(new Error(`no intact backup manifest in ${outRoot}`), { code: 'BACKUP_MANIFEST_MISSING' });
}

function allocateVersion(outRoot) {
  const root = path.join(outRoot, 'versions');
  fs.mkdirSync(root, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const version = versionId();
    const dir = path.join(root, version);
    try {
      fs.mkdirSync(dir);
      return { version, dir };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw Object.assign(new Error('could not allocate a new backup version directory'), { code: 'BACKUP_NAME_OCCUPIED' });
}

function publishCopiedFile(source, destination) {
  const privateDir = createPrivateStagingDir(destination);
  const staging = path.join(privateDir, 'payload');
  const inFd = fs.openSync(source, 'r');
  const outFd = fs.openSync(staging, 'wx');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (true) {
      const count = fs.readSync(inFd, buf, 0, buf.length, offset);
      if (count === 0) break;
      let wrote = 0;
      while (wrote < count) {
        const n = fs.writeSync(outFd, buf, wrote, count - wrote, offset + wrote);
        if (n === 0) throw Object.assign(new Error('short write of a backup payload'), { code: 'BACKUP_PUBLISH_MISMATCH' });
        wrote += n;
      }
      offset += count;
    }
    fs.fsyncSync(outFd);
  } finally {
    fs.closeSync(inFd);
    fs.closeSync(outFd);
  }
  const fd = fs.openSync(staging, 'r');
  try {
    const published = publishVerifiedFd(fd, staging, destination, { source, privateDir });
    releaseOwnedTemp(staging, fd, privateDir, source);
    removeEmptyPrivateDir(privateDir);
    return published;
  } catch (error) {
    if (error.code !== 'BACKUP_STAGING_SUBSTITUTED' && error.code !== 'BACKUP_CLEANUP_INCOMPLETE') {
      try { releaseOwnedTemp(staging, fd, privateDir, source); }
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
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

function publishManifest(outRoot, manifest, sources) {
  const dest = path.join(outRoot, 'manifests', `${manifest.version}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  distinctFromSources(dest, sources, 'manifest');
  const privateDir = createPrivateStagingDir(dest);
  const staging = path.join(privateDir, 'manifest.json');
  const body = Buffer.from(JSON.stringify(manifest, null, 2));
  const writeFd = fs.openSync(staging, 'wx');
  try {
    let wrote = 0;
    while (wrote < body.length) {
      const count = fs.writeSync(writeFd, body, wrote, body.length - wrote, wrote);
      if (count === 0) throw Object.assign(new Error('short write of the backup manifest'), { code: 'BACKUP_PUBLISH_MISMATCH' });
      wrote += count;
    }
    fs.fsyncSync(writeFd);
  } finally {
    fs.closeSync(writeFd);
  }
  const fd = fs.openSync(staging, 'r');
  try {
    publishVerifiedFd(fd, staging, dest, { privateDir });
    releaseOwnedTemp(staging, fd, privateDir);
    removeEmptyPrivateDir(privateDir);
    return dest;
  } catch (error) {
    if (error.code !== 'BACKUP_STAGING_SUBSTITUTED' && error.code !== 'BACKUP_CLEANUP_INCOMPLETE') {
      try { releaseOwnedTemp(staging, fd, privateDir); }
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
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

/**
 * Copy every store in `srcDir` into a new version under `outDir`.
 * Throws before deleting anything when the destination is the source, an
 * alias of the source, or not provably different. A failed run does not
 * return a manifest and does not delete a previous version.
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
  for (const existing of walkFiles(outRoot)) distinctFromSources(existing, sources, 'existing output');

  const plan = [];
  for (const file of sources) {
    if (file.name.endsWith('-wal') || file.name.endsWith('-shm')) continue;
    plan.push({ ...file, kind: file.name.endsWith('.db') ? 'sqlite' : 'file' });
  }

  const { version, dir } = allocateVersion(outRoot);
  for (const item of plan) distinctFromSources(path.join(dir, item.name), sources, 'destination');

  const files = {};
  for (const item of plan) {
    const dest = path.join(dir, item.name);
    if (item.kind === 'sqlite') {
      const published = vacuumIntoDistinct(item.src, dest);
      files[item.name] = {
        kind: 'sqlite',
        source_bytes: fs.statSync(item.src).size,
        source_sha256: sha256(item.src),
        backup_path: relativePosix(outRoot, dest),
        backup_bytes: published.bytes,
        backup_sha256: published.digest,
        backup_integrity_check: published.integrity,
      };
    } else {
      const published = publishCopiedFile(item.src, dest);
      files[item.name] = {
        kind: 'file',
        source_sha256: sha256(item.src),
        backup_path: relativePosix(outRoot, dest),
        backup_bytes: published.bytes,
        backup_sha256: published.digest,
      };
    }
  }

  const manifestFile = path.join(outRoot, 'manifests', `${version}.json`);
  const prior = manifestEntries(outRoot).map((entry) => entry.manifest.version);
  const manifest = {
    created_at: new Date().toISOString(),
    source: srcRoot,
    version,
    current: version,
    previous_version: prior.length ? prior[prior.length - 1] : null,
    history: [...prior, version],
    files,
    manifest_path: relativePosix(outRoot, manifestFile),
  };
  publishManifest(outRoot, manifest, sources);
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
    console.log(`\nmanifest: ${path.join(path.resolve(out), manifest.manifest_path)}`);
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
