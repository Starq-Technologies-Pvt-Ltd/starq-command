/**
 * Local backup and recovery for the PM operating database (CV-C1c).
 *
 * The daily-driver foundation must keep the Founder's organizational data safe
 * across restarts, crashes and Windows reboots WITHOUT the development
 * infrastructure. This module gives the local operating profile a dependable
 * backup-on-start and a stopped-state restore, using only node builtins so it
 * runs with nothing else online.
 *
 * Layout: backups live beside the DB in `<db-dir>/backups/pm-operating-<ts>.db`.
 * Every backup is a `VACUUM INTO` snapshot (a single consistent file, safe to
 * copy), integrity-checked after it is written, sha256-stamped, and the set is
 * pruned to the most recent N (default 14). Restore refuses while Command is
 * serving, and first takes a pre-restore safety snapshot of the current DB.
 *
 * It intentionally duplicates NONE of pm-service's request/authority logic; it
 * only reads and copies the database file. The canonical DB path and PM port
 * are resolved from the same authorities pm-service and the lifecycle use.
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { resolveWorkspace, CANONICAL, abs } from '../../server/paths.mjs';
import { PINNED_PM_PORT } from './config.mjs';

export const BACKUP_PREFIX = 'pm-operating-';
export const BACKUP_SUFFIX = '.db';
export const PRERESTORE_MARK = '-prerestore';
export const DEFAULT_KEEP = 14;
export const PM_HOST = '127.0.0.1';

/** Backup/pre-restore file names match this; anything else in the dir is left alone. */
const BACKUP_RE = new RegExp(`^${BACKUP_PREFIX}.+${BACKUP_SUFFIX.replace('.', '\\.')}$`);

export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * The same DB resolution pm-service uses: PM_DB_PATH override (absolute *.db,
 * never a protected store) else the canonical operating DB. Keeping one truth
 * means a scratch instance backs up its own scratch DB, not the live one.
 */
export function resolveDbPath(env = process.env) {
  const override = env.PM_DB_PATH;
  if (override) {
    const resolved = path.resolve(override);
    const base = path.basename(resolved).toLowerCase();
    if (!path.isAbsolute(override) || /control-plane|room\.jsonl/.test(base) || !base.endsWith('.db')) {
      throw new BackupError('PM_DB_PATH must be an absolute *.db path and may never name a protected store.');
    }
    return resolved;
  }
  const ws = resolveWorkspace();
  if (!ws.root) throw new BackupError('Workspace unresolved; cannot locate the operating database.');
  return abs(ws.root, CANONICAL.pmBoardDb);
}

export function backupsDirFor(dbPath) {
  return path.join(path.dirname(dbPath), 'backups');
}

/** Filesystem-safe, lexically sortable timestamp (ISO with : and . as -). */
export function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** PRAGMA integrity_check + foreign_key_check on a file, read-only. */
export function integrityCheck(file) {
  if (!fs.existsSync(file)) return { ok: false, detail: 'file does not exist' };
  let handle;
  try {
    handle = new DatabaseSync(file, { readOnly: true });
    const rows = handle.prepare('PRAGMA integrity_check').all();
    const ok = rows.length === 1 && Object.values(rows[0])[0] === 'ok';
    const fk = handle.prepare('PRAGMA foreign_key_check').all();
    return {
      ok: ok && fk.length === 0,
      detail: ok ? (fk.length ? 'foreign_key_check failed' : 'ok') : rows.map((r) => Object.values(r)[0]).slice(0, 5).join('; '),
    };
  } catch (err) {
    return { ok: false, detail: `integrity check error: ${err.message}` };
  } finally {
    try { handle?.close(); } catch { /* ignore */ }
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Existing backups, newest first (lexical ts sort), excluding pre-restore snapshots by default. */
export function listBackups(backupsDir, { includePreRestore = true } = {}) {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter((name) => BACKUP_RE.test(name))
    .filter((name) => includePreRestore || !name.includes(PRERESTORE_MARK))
    .map((name) => {
      const file = path.join(backupsDir, name);
      const st = fs.statSync(file);
      return { file, name, bytes: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/**
 * Keep the most recent `keep` ordinary backups; delete the rest. Pre-restore
 * safety snapshots are retained separately under the same `keep` budget so a
 * burst of restores can never evict every ordinary backup.
 */
export function pruneBackups(backupsDir, keep = DEFAULT_KEEP) {
  if (!Number.isInteger(keep) || keep < 1) throw new BackupError('keep must be a positive integer');
  const all = listBackups(backupsDir); // newest first
  const ordinary = all.filter((b) => !b.name.includes(PRERESTORE_MARK));
  const preRestore = all.filter((b) => b.name.includes(PRERESTORE_MARK));
  const removed = [];
  for (const group of [ordinary, preRestore]) {
    for (const old of group.slice(keep)) { fs.rmSync(old.file, { force: true }); removed.push(old.file); }
  }
  return removed;
}

/**
 * Create one consistent backup of `dbPath`.
 *  1. refuse to snapshot a corrupt source (VACUUM of corruption is unsafe);
 *  2. VACUUM INTO backups/pm-operating-<ts>.db;
 *  3. verify the copy; delete it and fail if it is not ok;
 *  4. prune to `keep`.
 * @returns {{backup:string, bytes:number, sha256:string, integrity:string, pruned:string[]}}
 */
export function createBackup(dbPath, { backupsDir = backupsDirFor(dbPath), keep = DEFAULT_KEEP, now = new Date(), mark = '' } = {}) {
  if (!fs.existsSync(dbPath)) throw new BackupError(`operating database not found: ${dbPath}`);
  const src = integrityCheck(dbPath);
  if (!src.ok) throw new BackupError(`refusing to back up a database that fails integrity_check: ${src.detail}`);

  fs.mkdirSync(backupsDir, { recursive: true });
  let out = path.join(backupsDir, `${BACKUP_PREFIX}${backupTimestamp(now)}${mark}${BACKUP_SUFFIX}`);
  let n = 1;
  while (fs.existsSync(out)) out = path.join(backupsDir, `${BACKUP_PREFIX}${backupTimestamp(now)}${mark}-${n++}${BACKUP_SUFFIX}`);

  let handle;
  try {
    handle = new DatabaseSync(dbPath);
    handle.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  } finally {
    try { handle?.close(); } catch { /* ignore */ }
  }

  const check = integrityCheck(out);
  if (!check.ok) {
    fs.rmSync(out, { force: true });
    throw new BackupError(`backup failed its own integrity check and was discarded: ${check.detail}`);
  }
  const pruned = pruneBackups(backupsDir, keep);
  return { backup: out, bytes: fs.statSync(out).size, sha256: sha256File(out), integrity: check.detail, pruned };
}

/** True if something is accepting TCP connections on the PM port (Command is serving). */
export function probePort({ host = PM_HOST, port = PINNED_PM_PORT, timeoutMs = 400 } = {}) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (live) => { if (done) return; done = true; try { sock.destroy(); } catch { /* ignore */ } resolve(live); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

/**
 * Restore `backupFile` over `dbPath`. Stopped-state only: refuses while the PM
 * port is live unless `allowRunning`. Takes a pre-restore safety snapshot of
 * the current DB first, then swaps atomically (copy to temp, rename), and
 * verifies the restored file.
 * @returns {{restored:string, from:string, safetyCopy:string|null}}
 */
export async function restoreBackup(backupFile, dbPath, { allowRunning = false, backupsDir = backupsDirFor(dbPath), now = new Date(), probe = probePort } = {}) {
  const from = path.resolve(backupFile);
  if (!fs.existsSync(from)) throw new BackupError(`backup file not found: ${from}`);
  const check = integrityCheck(from);
  if (!check.ok) throw new BackupError(`refusing to restore a backup that fails integrity_check: ${check.detail}`);

  if (!allowRunning && await probe()) {
    throw new BackupError(`Command appears to be running (PM port ${PINNED_PM_PORT} is live). Stop Command before restoring, or pass --force.`);
  }

  let safetyCopy = null;
  if (fs.existsSync(dbPath)) {
    const cur = integrityCheck(dbPath);
    if (cur.ok) {
      const snap = createBackup(dbPath, { backupsDir, keep: DEFAULT_KEEP, now, mark: PRERESTORE_MARK });
      safetyCopy = snap.backup;
    } else {
      // Current DB is unreadable: keep a raw byte copy so nothing is thrown away.
      safetyCopy = path.join(backupsDir, `${BACKUP_PREFIX}${backupTimestamp(now)}${PRERESTORE_MARK}-raw${BACKUP_SUFFIX}`);
      fs.mkdirSync(backupsDir, { recursive: true });
      fs.copyFileSync(dbPath, safetyCopy);
    }
  }

  const tmp = `${dbPath}.restore-${process.pid}.tmp`;
  fs.copyFileSync(from, tmp);
  // Clear any stale WAL/SHM so the restored file is read exactly as snapshotted.
  for (const side of ['-wal', '-shm']) { try { fs.rmSync(dbPath + side, { force: true }); } catch { /* ignore */ } }
  fs.renameSync(tmp, dbPath);

  const restored = integrityCheck(dbPath);
  if (!restored.ok) throw new BackupError(`restored database fails integrity_check: ${restored.detail}`);
  return { restored: dbPath, from, safetyCopy };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--if-exists') out.ifExists = true;
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--keep') out.keep = Number(argv[++i]);
    else out._.push(a);
  }
  return out;
}

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0] || 'backup';
  const dbPath = args.db ? path.resolve(args.db) : resolveDbPath();
  const keep = Number.isInteger(args.keep) ? args.keep : DEFAULT_KEEP;

  if (cmd === 'backup') {
    // Backup-on-start uses --if-exists so a fresh install (no DB yet) is a
    // clean no-op rather than an error that would block the first launch.
    if (args.ifExists && !fs.existsSync(dbPath)) {
      console.log(JSON.stringify({ skipped: 'no operating database yet', db: dbPath }));
      return 0;
    }
    const r = createBackup(dbPath, { keep });
    console.log(JSON.stringify(r));
    return 0;
  }
  if (cmd === 'list') {
    console.log(JSON.stringify({ db: dbPath, backupsDir: backupsDirFor(dbPath), backups: listBackups(backupsDirFor(dbPath)) }, null, 2));
    return 0;
  }
  if (cmd === 'verify') {
    const target = args.file ? path.resolve(args.file) : dbPath;
    const check = integrityCheck(target);
    console.log(JSON.stringify({ file: target, integrity: check.detail, ok: check.ok }));
    return check.ok ? 0 : 3;
  }
  if (cmd === 'restore') {
    if (!args.file) { console.error('restore requires --file <backup.db>'); return 2; }
    const r = await restoreBackup(args.file, dbPath, { allowRunning: Boolean(args.force) });
    console.log(JSON.stringify(r));
    return 0;
  }
  console.error(`unknown command '${cmd}'. Use: backup | list | verify | restore`);
  return 2;
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => { console.error(err instanceof BackupError ? err.message : err); process.exit(1); });
}
