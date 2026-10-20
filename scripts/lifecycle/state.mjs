/**
 * Lifecycle state file: BOM-free UTF-8, atomic replace, strict schema.
 *
 * readState() never collapses "unreadable" or "corrupt" into "absent". Only a
 * file that does not exist is ABSENT; everything else that is not a valid
 * document is CORRUPT or UNREADABLE, and both block consequential decisions.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

export const STATE_SCHEMA = 'starq.command.lifecycle.state/v2';
export const RUNTIME_STATES = Object.freeze([
  'STARTING', 'READY', 'STOPPING', 'STOPPED', 'START_FAILED', 'ROLLBACK_INCOMPLETE', 'STOP_INCOMPLETE',
]);
export const CHILD_STATUSES = Object.freeze(['LAUNCHED', 'IDENTIFIED', 'READY', 'STOPPING', 'EXITED', 'FAILED']);

export function readState(file) {
  let raw;
  try {
    raw = readFileSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return { kind: 'ABSENT' };
    return { kind: 'UNREADABLE', reason: err.message };
  }
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return { kind: 'CORRUPT', reason: 'UTF-8 BOM present; state files must be BOM-free' };
  }
  if (raw.length === 0) return { kind: 'CORRUPT', reason: 'empty file' };
  let doc;
  try { doc = JSON.parse(raw.toString('utf8')); } catch (err) { return { kind: 'CORRUPT', reason: `not JSON: ${err.message}` }; }
  // Version 1 (the pre-corrective launcher) is honoured ONLY as a stopped record:
  // it carries no executable or creation identity, so it can never prove ownership.
  if (doc && doc.version === 1 && doc.schema === undefined) {
    if (['STOPPED', 'FAILED'].includes(doc.state)) return { kind: 'LEGACY_STOPPED', state: doc };
    return { kind: 'CORRUPT', reason: `legacy v1 state '${doc.state}' carries no provable identity` };
  }
  const problems = validateState(doc);
  if (problems.length) return { kind: 'CORRUPT', reason: problems.join('; ') };
  return { kind: 'OK', state: doc };
}

export function validateState(doc) {
  const p = [];
  if (!doc || typeof doc !== 'object') return ['state is not an object'];
  if (doc.schema !== STATE_SCHEMA) p.push(`schema must be ${STATE_SCHEMA}`);
  if (!RUNTIME_STATES.includes(doc.state)) p.push(`unknown state '${doc.state}'`);
  if (typeof doc.attempt_id !== 'string') p.push('attempt_id missing');
  if (typeof doc.config_sha256 !== 'string') p.push('config_sha256 missing');
  if (doc.pending_launches !== undefined && !Array.isArray(doc.pending_launches)) p.push('pending_launches must be an array');
  if (!Array.isArray(doc.children)) p.push('children must be an array');
  else {
    const seen = new Set();
    for (const c of doc.children) {
      if (!c || typeof c.name !== 'string') { p.push('child without name'); continue; }
      if (seen.has(c.name)) p.push(`duplicate child ${c.name}`);
      seen.add(c.name);
      if (!Number.isInteger(c.pid) || c.pid <= 0) p.push(`${c.name}: invalid pid`);
      if (typeof c.instance_id !== 'string' || typeof c.token !== 'string') p.push(`${c.name}: instance identity missing`);
      if (!CHILD_STATUSES.includes(c.status)) p.push(`${c.name}: unknown status '${c.status}'`);
      if (c.status !== 'LAUNCHED' && c.status !== 'FAILED' && (typeof c.exe !== 'string' || typeof c.created_at !== 'string')) {
        p.push(`${c.name}: status ${c.status} requires exe and created_at`);
      }
    }
  }
  return p;
}

/** Atomic, BOM-free write. Node's 'utf8' encoding never emits a BOM. */
export function writeState(file, doc) {
  const problems = validateState(doc);
  if (problems.length) throw new Error(`refusing to write invalid state: ${problems.join('; ')}`);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8' });
  renameSync(tmp, file);
}

export function archiveState(file, label) {
  const target = `${file}.${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(file, target);
  return target;
}

export function appendEvent(doc, event, data = {}) {
  const events = Array.isArray(doc.events) ? doc.events : [];
  events.push({ at: new Date().toISOString(), event, ...data });
  doc.events = events.slice(-80);
  return doc;
}
