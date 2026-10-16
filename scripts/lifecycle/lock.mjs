/**
 * The lifecycle lock serialises every mutating owner operation (start, stop,
 * recover), whoever invokes it: Start-Starq.ps1, npm run command:*, or a direct
 * `node command-lifecycle.mjs`. The lock records the holder's pid AND creation
 * time; a lock is reclaimed only when the holder is PROVEN gone (or its pid was
 * reused). If the holder cannot be inspected, the lock is respected.
 */
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export class LockedError extends Error {
  constructor(message, holder) { super(message); this.name = 'LockedError'; this.holder = holder; }
}

export async function acquireLock(file, op, { inspect, selfPid = process.pid }) {
  mkdirSync(path.dirname(file), { recursive: true });
  const self = (await inspect([selfPid])).get(selfPid);
  if (!self?.found || !self.created) throw new LockedError('cannot establish own process identity for the lock', null);
  const record = { nonce: randomBytes(12).toString('hex'), pid: selfPid, created: self.created, op, at: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, JSON.stringify(record));
      closeSync(fd);
      return { file, record, reclaimed: attempt > 0 };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let holder = null;
    try { holder = JSON.parse(readFileSync(file, 'utf8')); } catch {}
    if (!holder || !Number.isInteger(holder.pid)) throw new LockedError(`lock file ${file} is unreadable; refusing to guess`, holder);
    let info;
    try { info = (await inspect([holder.pid])).get(holder.pid); } catch (e) {
      throw new LockedError(`lock held by pid ${holder.pid} (${holder.op}); holder cannot be inspected: ${e.message}`, holder);
    }
    const alive = info?.found && info.created === holder.created;
    if (alive) throw new LockedError(`LOCKED: '${holder.op}' is in progress (pid ${holder.pid} since ${holder.at})`, holder);
    // Holder proven gone (or pid reused): keep the stale lock as evidence, then retry once.
    renameSync(file, `${file}.stale-${Date.now()}`);
  }
  throw new LockedError('could not acquire lifecycle lock', null);
}

export function releaseLock(lock) {
  if (!lock) return;
  try {
    const current = JSON.parse(readFileSync(lock.file, 'utf8'));
    if (current.nonce === lock.record.nonce) unlinkSync(lock.file);
  } catch {}
}

export function readLock(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (err) { return err.code === 'ENOENT' ? null : { unreadable: true }; }
}
