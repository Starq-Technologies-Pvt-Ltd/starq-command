/**
 * STARQ // COMMAND — human-operated Project Management service (CMD-PM-MIN).
 *
 * Authority: Founder Room #9497, scope #9493, controls #9494.
 *
 * This is NOT agent orchestration. It never touches Herdr, B1, ConPTY or the
 * Herdr TaskStore (control-plane.db). It owns exactly one new SQLite file,
 * data/pm-board.db, and reads (never writes) the Room ledger, the identity
 * registry and the ERP control-board contract.
 *
 * Controls enforced here, server-side:
 *   - loopback bind, loopback peer, Host + Origin allowlists, custom header
 *   - strict input validation, unknown fields rejected, body size capped
 *   - optimistic concurrency (expected_updated_at) so edits are never lost
 *   - append-only history (SQLite triggers), WAL, synchronous=FULL
 *   - Room references are VERIFIED against readRoomSnapshot(), not self-asserted
 *   - Room posting is failure-safe: a failed post stays PENDING and visible
 *   - Room authority (Founder #9503, R1-R3): an authorization reference must be an
 *     authenticated ROOT_GENESIS Room record; acceptance and closure are proven by
 *     verified Room sender evidence (hash + chain checked), never by the UI actor
 *   - DEC-072: verifier != owner; the verifier's own Room record is the proof
 *   - an ON_HOLD project (ERP, DEC-100) cannot progress past READY
 *   - no task is ever imported or invented
 *
 * RESIDUAL LIMITATION (recorded per #9503): identity here is the Room's identity.
 * Anyone who can post to the Room as a handle (send.mjs identity lease on this
 * machine) can produce that handle's evidence. The "actor" field is attribution
 * only. A per-user login would be a separate Founder decision.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolveWorkspace, CANONICAL, abs } from './paths.mjs';
import { readRoomSnapshot } from '../../../../agent-comms/scripts/room.mjs';

// Production is always 5176. A disposable verification instance (PM_DB_PATH set)
// may use one unused loopback port in 5190-5199 and nothing else.
const SCRATCH = Boolean(process.env.PM_DB_PATH);
const WANT_PORT = Number(process.env.PM_PORT || 5176);
const PORT = SCRATCH && Number.isInteger(WANT_PORT) && WANT_PORT >= 5190 && WANT_PORT <= 5199 ? WANT_PORT : 5176;
if (process.env.PM_PORT && PORT !== WANT_PORT) {
  console.error('PM_PORT is accepted only with PM_DB_PATH and only in 5190-5199.');
  process.exit(2);
}
const HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024;
const SCHEMA_VERSION = 1;

export const STATUSES = [
  'BACKLOG', 'READY', 'IN_PROGRESS', 'REVIEW', 'VERIFICATION',
  'ACCEPTANCE', 'CLOSED', 'BLOCKED', 'FOUNDER_GATE',
];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const FORWARD = {
  BACKLOG: 'READY', READY: 'IN_PROGRESS', IN_PROGRESS: 'REVIEW',
  REVIEW: 'VERIFICATION', VERIFICATION: 'ACCEPTANCE', ACCEPTANCE: 'CLOSED',
};
const STATIC_NEXT = {
  BACKLOG: ['READY', 'BLOCKED', 'FOUNDER_GATE'],
  READY: ['IN_PROGRESS', 'BACKLOG', 'BLOCKED', 'FOUNDER_GATE'],
  IN_PROGRESS: ['REVIEW', 'READY', 'BLOCKED', 'FOUNDER_GATE'],
  REVIEW: ['VERIFICATION', 'READY', 'BLOCKED', 'FOUNDER_GATE'],
  VERIFICATION: ['ACCEPTANCE', 'READY', 'BLOCKED', 'FOUNDER_GATE'],
  ACCEPTANCE: ['CLOSED', 'READY', 'BLOCKED', 'FOUNDER_GATE'],
  CLOSED: [],
};
const REJECTABLE = new Set(['REVIEW', 'VERIFICATION', 'ACCEPTANCE']);
const HOLD_BLOCKED_TARGETS = new Set(['IN_PROGRESS', 'REVIEW', 'VERIFICATION', 'ACCEPTANCE', 'CLOSED']);
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173', 'http://localhost:5173',
  'http://127.0.0.1:4173', 'http://localhost:4173',
]);
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function allowedNext(task) {
  if (task.status === 'BLOCKED') return [task.prior_status || 'BACKLOG'];
  if (task.status === 'FOUNDER_GATE') {
    const prior = task.prior_status || 'BACKLOG';
    return [...new Set([prior, FORWARD[prior], 'BLOCKED'].filter(Boolean))];
  }
  return STATIC_NEXT[task.status] ?? [];
}

// ── Configuration ──────────────────────────────────────────────────────────
const workspace = resolveWorkspace();
const ROOT = workspace.root;
const ROOM_POST = (process.env.PM_ROOM_POST || 'on') !== 'off';
const ROOM_FROM = String(process.env.PM_ROOM_FROM || '').trim();
const ROOM_INSTANCE = String(process.env.PM_ROOM_INSTANCE || '').trim();
const ROOM_TAGS = process.env.PM_ROOM_TAGS || '';
const SEND_SCRIPT = process.env.PM_ROOM_SEND_SCRIPT || (ROOT ? abs(ROOT, 'agent-comms/scripts/send.mjs') : '');

function requireExplicitRoomWriter() {
  if (!ROOM_FROM || !ROOM_INSTANCE) {
    throw new Error('PM Room posting is enabled without explicit PM_ROOM_FROM and PM_ROOM_INSTANCE');
  }
}

function resolveDbPath() {
  const override = process.env.PM_DB_PATH;
  if (!override) return ROOT ? abs(ROOT, CANONICAL.pmBoardDb) : null;
  const resolved = path.resolve(override);
  const base = path.basename(resolved).toLowerCase();
  if (!path.isAbsolute(override) || /control-plane|room\.jsonl/.test(base) || !base.endsWith('.db')) {
    throw new Error('PM_DB_PATH must be an absolute *.db path and may never name a protected store.');
  }
  return resolved;
}

const nowIso = () => new Date().toISOString();
const json = (v) => JSON.stringify(v);

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const bad = (message, errors) => new HttpError(400, 'VALIDATION', message, { errors });

// ── Read-only canonical inputs ─────────────────────────────────────────────
let identityCache = { at: 0, levels: null };
function identityLevels() {
  if (identityCache.levels && Date.now() - identityCache.at < 30000) return identityCache.levels;
  if (!ROOT) throw new HttpError(503, 'UNAVAILABLE', 'Workspace unresolved.');
  try {
    const reg = JSON.parse(fs.readFileSync(abs(ROOT, CANONICAL.identities), 'utf8'));
    const levels = new Map(
      (reg.identities ?? [])
        .filter((i) => i.status !== 'retired' && typeof i.canonicalHandle === 'string')
        .map((i) => [i.canonicalHandle, i.authorityLevel ?? 'NONE']),
    );
    identityCache = { at: Date.now(), levels };
    return levels;
  } catch {
    throw new HttpError(503, 'UNAVAILABLE', 'Identity registry unreadable; writes refused (fail closed).');
  }
}
const knownHandles = () => new Set(identityLevels().keys());

// The Room's own hash function, read-only. If it cannot be loaded, Room references
// cannot be authenticated and every one is refused (fail closed).
let computeRecordHash = null;
if (ROOT) {
  try {
    const mod = await import(pathToFileURL(abs(ROOT, 'agent-comms/protocol/v1/hashChain.mjs')).href);
    computeRecordHash = mod.computeRecordHash;
  } catch { computeRecordHash = null; }
}
const LEDGER_PATH = () => {
  const o = process.env.PM_ROOM_LEDGER;
  if (o && SCRATCH) return path.resolve(o);
  return abs(ROOT, CANONICAL.roomLedger);
};

function snapshotLedger() {
  if (!ROOT) throw new HttpError(503, 'UNAVAILABLE', 'Workspace unresolved.');
  if (!computeRecordHash) throw new HttpError(503, 'UNAVAILABLE', 'Room hash function unavailable; Room references cannot be authenticated.');
  const snapshot = readRoomSnapshot({ roomPath: LEDGER_PATH() });
  if (!snapshot.stable || snapshot.state !== 'OK') {
    throw new HttpError(503, 'UNAVAILABLE', snapshot.reason || 'Room snapshot unavailable; reference cannot be verified.');
  }
  return snapshot;
}

// Authenticate one snapshot record: recomputed record hash, previous-record link, and
// the broker's own authority decision plus the registry level of the sender.
function describeRecord(rec, previousHash) {
  let hashVerified = computeRecordHash(rec) === rec.recordHash;
  if (hashVerified && rec.brokerSequence > 1) {
    hashVerified = previousHash === rec.previousRecordHash;
  }
  const sender = rec.event?.senderHandle ?? null;
  const level = sender ? (identityLevels().get(sender) ?? 'UNREGISTERED') : 'UNREGISTERED';
  const allowed = rec.authorityDecision?.allowed === true;
  return {
    sequence: rec.brokerSequence,
    eventId: rec.eventId ?? rec.event?.eventId ?? null,
    recordHash: rec.recordHash ?? null,
    senderHandle: sender,
    receivedAt: rec.receivedAt ?? null,
    body: typeof rec.event?.body === 'string' ? rec.event.body : '',
    hashVerified,
    authorityAllowed: allowed,
    registryLevel: level,
    isRoot: hashVerified && allowed && level === 'ROOT_GENESIS' && rec.authorityDecision?.senderAuthorityLevel === 'ROOT_GENESIS',
  };
}

function lookupRoom(sequence) {
  const snapshot = snapshotLedger();
  const idx = snapshot.records.findIndex((rec) => rec.brokerSequence === sequence);
  if (idx < 0) return null;
  const rec = snapshot.records[idx];
  const previousHash = idx > 0 ? snapshot.records[idx - 1].recordHash : null;
  return describeRecord(rec, previousHash);
}

// Idempotency for Room sync: has an event already been written for this token?
function findRoomByToken(token) {
  const snapshot = snapshotLedger();
  for (let i = snapshot.records.length - 1; i >= 0; i--) {
    const rec = snapshot.records[i];
    const body = rec.event?.body;
    if (typeof body !== 'string' || !body.includes(token)) continue;
    const previousHash = i > 0 ? snapshot.records[i - 1].recordHash : null;
    const info = describeRecord(rec, previousHash);
    return info.senderHandle === ROOM_FROM && info.body.includes(token) ? info : null;
  }
  return null;
}

function effectiveHold(project) {
  if (project.id === 'erp' && ROOT) {
    try {
      const c = JSON.parse(fs.readFileSync(abs(ROOT, `${CANONICAL.controlBoard}/contract.json`), 'utf8'));
      const h = c?.hold_state ?? {};
      return {
        state: typeof h.implementation === 'string' ? h.implementation : 'UNKNOWN',
        authority: h.authority ?? null,
        effective: h.effective ?? null,
        source: 'starqerp-control-board/contract.json (read live)',
      };
    } catch {
      return { state: 'ON_HOLD', authority: null, effective: null, source: 'contract.json unreadable; failing closed' };
    }
  }
  return { state: project.hold_state ?? null, authority: null, effective: null, source: 'pm_projects' };
}
const holdBlocks = (hold) => hold.state === 'ON_HOLD' || hold.state === 'UNKNOWN';

// ── Database ───────────────────────────────────────────────────────────────
let db = null;
let dbState = { state: 'UNAVAILABLE', reason: 'not opened', path: null, integrity: null, seed_drift: [] };

function openDatabase(dbPath) {
  const handle = new DatabaseSync(dbPath);
  handle.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
  return handle;
}

function integrity(handle) {
  const rows = handle.prepare('PRAGMA integrity_check').all();
  const ok = rows.length === 1 && Object.values(rows[0])[0] === 'ok';
  const fk = handle.prepare('PRAGMA foreign_key_check').all();
  return { ok: ok && fk.length === 0, detail: ok ? (fk.length ? 'foreign_key_check failed' : 'ok') : rows.map((r) => Object.values(r)[0]).slice(0, 5).join('; ') };
}

function initSchema(handle) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS pm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pm_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '', hold_state TEXT, source_gap TEXT,
      next_seq INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pm_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES pm_projects(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0','P1','P2','P3')),
      status TEXT NOT NULL DEFAULT 'BACKLOG' CHECK (status IN ('BACKLOG','READY','IN_PROGRESS','REVIEW','VERIFICATION','ACCEPTANCE','CLOSED','BLOCKED','FOUNDER_GATE')),
      prior_status TEXT,
      owner TEXT NOT NULL DEFAULT 'UNASSIGNED',
      verifier TEXT NOT NULL DEFAULT 'UNASSIGNED',
      room_authorization_ref TEXT,
      evidence_refs TEXT NOT NULL DEFAULT '[]',
      depends_on TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pm_tasks_project ON pm_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_pm_tasks_status ON pm_tasks(status);
    CREATE TABLE IF NOT EXISTS pm_status_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES pm_tasks(id),
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      actor TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL,
      room_sync TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (room_sync IN ('NOT_REQUIRED','DISABLED','PENDING','POSTED')),
      room_ref TEXT,
      room_error TEXT,
      room_attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pm_log_task ON pm_status_log(task_id);
    CREATE INDEX IF NOT EXISTS idx_pm_log_sync ON pm_status_log(room_sync);
    CREATE TRIGGER IF NOT EXISTS pm_log_no_delete BEFORE DELETE ON pm_status_log
      BEGIN SELECT RAISE(ABORT, 'pm_status_log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS pm_log_immutable BEFORE UPDATE OF
      task_id, event_type, from_status, to_status, actor, detail, timestamp ON pm_status_log
      BEGIN SELECT RAISE(ABORT, 'pm_status_log history columns are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS pm_tasks_no_delete BEFORE DELETE ON pm_tasks
      BEGIN SELECT RAISE(ABORT, 'tasks are never deleted; close them'); END;
  `);
  const has = handle.prepare('SELECT value FROM pm_meta WHERE key = ?');
  if (!has.get('schema_version')) {
    const put = handle.prepare('INSERT INTO pm_meta (key, value) VALUES (?, ?)');
    put.run('schema_version', String(SCHEMA_VERSION));
    put.run('db_id', crypto.randomUUID());
    put.run('created_at', nowIso());
  }
}

function seedProjects(handle) {
  const drift = [];
  if (!ROOT) return drift;
  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(abs(ROOT, CANONICAL.pmProjects), 'utf8'));
  } catch (e) {
    return [`pm-projects.json unreadable: ${e.message}`];
  }
  const get = handle.prepare('SELECT * FROM pm_projects WHERE id = ?');
  const ins = handle.prepare(
    'INSERT INTO pm_projects (id, name, prefix, description, hold_state, source_gap, next_seq, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
  );
  for (const p of seed.projects ?? []) {
    const row = get.get(p.id);
    if (!row) {
      ins.run(p.id, p.name, p.prefix, p.description ?? '', p.hold_state ?? null, p.source_gap ?? null, nowIso());
    } else if (row.name !== p.name || row.prefix !== p.prefix || (row.source_gap ?? null) !== (p.source_gap ?? null)) {
      drift.push(`${p.id}: pm-projects.json differs from the stored row; stored row preserved`);
    }
  }
  return drift;
}

function startDatabase() {
  let dbPath;
  try {
    dbPath = resolveDbPath();
    if (!dbPath) throw new Error('Workspace unresolved.');
    const handle = openDatabase(dbPath);
    const check = integrity(handle);
    if (!check.ok) {
      handle.close();
      dbState = { state: 'UNAVAILABLE', reason: `integrity_check failed: ${check.detail}`, path: dbPath, integrity: check.detail, seed_drift: [] };
      return;
    }
    initSchema(handle);
    const drift = seedProjects(handle);
    db = handle;
    dbState = { state: 'OK', reason: null, path: dbPath, integrity: 'ok', seed_drift: drift };
  } catch (e) {
    dbState = { state: 'UNAVAILABLE', reason: e.message, path: dbPath ?? null, integrity: null, seed_drift: [] };
  }
}

function requireDb() {
  if (!db) throw new HttpError(503, 'UNAVAILABLE', `PM database unavailable: ${dbState.reason}`);
  return db;
}

function tx(fn) {
  const d = requireDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(d);
    d.exec('COMMIT');
    return result;
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

// ── Row mapping ────────────────────────────────────────────────────────────
function hydrate(row, pending = 0) {
  const task = {
    ...row,
    room_authorization_ref: row.room_authorization_ref ? JSON.parse(row.room_authorization_ref) : null,
    evidence_refs: JSON.parse(row.evidence_refs),
    depends_on: JSON.parse(row.depends_on),
  };
  task.allowed_next = allowedNext(task);
  task.pending_room_sync = pending;
  return task;
}
function pendingCounts() {
  const out = new Map();
  for (const r of requireDb().prepare("SELECT task_id, COUNT(*) AS n FROM pm_status_log WHERE room_sync = 'PENDING' GROUP BY task_id").all()) {
    out.set(r.task_id, Number(r.n));
  }
  return out;
}
const getTaskRow = (id) => requireDb().prepare('SELECT * FROM pm_tasks WHERE id = ?').get(id);
const getProjectRow = (id) => requireDb().prepare('SELECT * FROM pm_projects WHERE id = ?').get(id);

// ── Validation ─────────────────────────────────────────────────────────────
function only(body, allowed) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('Body must be a JSON object.');
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw bad('Unknown field(s) rejected.', extra.map((k) => `unknown field: ${k}`));
}
function str(body, key, { min = 0, max, required = false } = {}) {
  const v = body[key];
  if (v === undefined) {
    if (required) throw bad(`${key} is required.`, [`${key} is required`]);
    return undefined;
  }
  if (typeof v !== 'string') throw bad(`${key} must be a string.`, [`${key} must be a string`]);
  const t = v.trim();
  if (t.length < min || t.length > max) throw bad(`${key} length invalid.`, [`${key} must be ${min}-${max} characters`]);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t)) throw bad(`${key} contains control characters.`, [`${key} has control characters`]);
  return t;
}
function handleField(body, key, { required = false, allowUnassigned = true } = {}) {
  const v = str(body, key, { min: required ? 2 : 0, max: 40, required });
  if (v === undefined) return undefined;
  if (allowUnassigned && v === 'UNASSIGNED') return v;
  if (!knownHandles().has(v)) throw bad(`${key} is not a known active identity.`, [`${key}: ${v} is not an active identity handle`]);
  return v;
}
function parseRoomRef(raw, { requirePurpose = true, taskId = null } = {}) {
  only(raw, ['sequence', 'eventId', 'purpose', 'kind']);
  if (!Number.isInteger(raw.sequence) || raw.sequence < 1) throw bad('Room sequence invalid.', ['room sequence must be a positive integer']);
  if (typeof raw.eventId !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.eventId)) throw bad('Room eventId invalid.', ['eventId must be 64 hex characters']);
  const purpose = typeof raw.purpose === 'string' ? raw.purpose.trim() : '';
  if (requirePurpose && (purpose.length < 3 || purpose.length > 200)) throw bad('Room purpose invalid.', ['purpose must be 3-200 characters']);
  const kind = raw.kind === undefined ? 'authorization' : raw.kind;
  if (!['authorization', 'evidence'].includes(kind)) throw bad('Room ref kind invalid.', ['kind must be authorization or evidence']);
  const found = lookupRoom(raw.sequence);
  if (!found) throw new HttpError(422, 'ROOM_REF_NOT_FOUND', `Room #${raw.sequence} does not exist in the ledger.`);
  if (found.eventId.toLowerCase() !== raw.eventId.toLowerCase()) {
    throw new HttpError(422, 'ROOM_REF_MISMATCH', `eventId does not match Room #${raw.sequence}.`);
  }
  if (!found.hashVerified) {
    throw new HttpError(422, 'ROOM_RECORD_UNVERIFIED', `Room #${raw.sequence} failed its record-hash or chain-link check and is not accepted.`);
  }
  if (!found.authorityAllowed) {
    throw new HttpError(422, 'ROOM_RECORD_NOT_ALLOWED', `Room #${raw.sequence} was not allowed by the broker's authority decision.`);
  }
  // R1: only an authenticated ROOT_GENESIS (Founder) record can authorize a task.
  if (kind === 'authorization' && !found.isRoot) {
    throw new HttpError(422, 'ROOM_AUTHORITY_INSUFFICIENT', `Room #${raw.sequence} was sent by ${found.senderHandle ?? 'UNKNOWN'} (${found.registryLevel}). An authorization reference must be an authenticated ROOT_GENESIS record.`);
  }
  return {
    sequence: found.sequence, eventId: found.eventId, recordHash: found.recordHash,
    senderHandle: found.senderHandle, purpose, kind, verified_at: nowIso(),
    received_at: found.receivedAt, authority_level: found.registryLevel,
    root_authority: found.isRoot, mentions_task: taskId ? found.body.includes(taskId) : false,
  };
}
function dependsField(body, project, selfId) {
  const v = body.depends_on;
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20) throw bad('depends_on must be an array of at most 20 task ids.', ['depends_on invalid']);
  const ids = [...new Set(v.map((x) => (typeof x === 'string' ? x.trim() : '')))];
  for (const id of ids) {
    if (!/^PM-[A-Z]{2,4}-\d{3,}$/.test(id)) throw bad('depends_on contains an invalid id.', [`invalid task id: ${id}`]);
    if (id === selfId) throw bad('A task cannot depend on itself.', ['self-dependency']);
    const row = getTaskRow(id);
    if (!row) throw new HttpError(422, 'DEPENDENCY_NOT_FOUND', `Dependency ${id} does not exist.`);
    if (row.project_id !== project) throw new HttpError(422, 'DEPENDENCY_CROSS_PROJECT', `Dependency ${id} belongs to another project; boards stay separate.`);
  }
  return ids;
}

// ── History + Room sync ────────────────────────────────────────────────────
function logEvent(d, { taskId, type, from = null, to = null, actor, detail = {}, post }) {
  const sync = post ? (ROOM_POST ? 'PENDING' : 'DISABLED') : 'NOT_REQUIRED';
  const info = d.prepare(
    'INSERT INTO pm_status_log (task_id, event_type, from_status, to_status, actor, detail, timestamp, room_sync) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(taskId, type, from, to, actor, json(detail), nowIso(), sync);
  return Number(info.lastInsertRowid);
}

let queue = Promise.resolve();
function enqueueRoomSync() {
  if (!ROOM_POST || !db) return;
  queue = queue.then(flushRoomSync).catch((e) => console.error('[pm] room sync worker error:', e.message));
}
const neutral = (s) => String(s ?? '').replace(/@/g, '(at)').replace(/\s+/g, ' ').slice(0, 400);

function roomBody(row, task, dbId) {
  const detail = JSON.parse(row.detail);
  const auth = task.room_authorization_ref ? `Room #${task.room_authorization_ref.sequence}` : 'UNLINKED';
  return [
    `PM TASK EVENT · ${row.event_type} · ${task.id} [${task.project_id}]`,
    `Title: ${neutral(task.title)}`,
    row.from_status || row.to_status ? `Status: ${row.from_status ?? '-'} -> ${row.to_status ?? '-'}` : `Status: ${task.status}`,
    `Priority: ${task.priority} · Owner: ${task.owner} · Verifier: ${task.verifier}`,
    `Actor: ${row.actor}`,
    detail.note ? `Note: ${neutral(detail.note)}` : null,
    detail.room_ref ? `Linked Room reference: #${detail.room_ref.sequence} (${detail.room_ref.kind})` : null,
    `Room authorization ref: ${auth} · Evidence refs: ${task.evidence_refs.length}`,
    `pm-event-id: pm-${dbId.slice(0, 8)}-${row.id}`,
    'Source: Starq Command PM board (human-operated). This record reports an event; it does not itself authorize work.',
  ].filter(Boolean).join('\n');
}

function postToRoom(body) {
  requireExplicitRoomWriter();
  return new Promise((resolve, reject) => {
    const args = [SEND_SCRIPT, '--from', ROOM_FROM, '--instance', ROOM_INSTANCE, '--room', '--body', body];
    if (ROOM_TAGS) args.push('--tag', ROOM_TAGS);
    execFile(process.execPath, args, { cwd: path.dirname(path.dirname(SEND_SCRIPT)), timeout: 45000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const m = /Broker Record #(\d+) posted/.exec(stdout || '');
      if (!err && m) return resolve(Number(m[1]));
      reject(new Error(((stderr || stdout || err?.message || 'send failed') + '').trim().slice(0, 300)));
    });
  });
}

async function flushRoomSync() {
  const d = db;
  if (!d) return;
  const dbId = d.prepare("SELECT value FROM pm_meta WHERE key = 'db_id'").get().value;
  const rows = d.prepare("SELECT * FROM pm_status_log WHERE room_sync = 'PENDING' ORDER BY id").all();
  for (const row of rows) {
    const task = hydrate(getTaskRow(row.task_id));
    const token = `pm-event-id: pm-${dbId.slice(0, 8)}-${row.id}`;
    try {
      // R3: never trust send's stdout alone. If the event is already in the ledger
      // (an earlier receipt was lost) resolve it instead of posting a duplicate.
      let rec = findRoomByToken(token);
      if (!rec) {
        const seq = await postToRoom(roomBody(row, task, dbId));
        rec = lookupRoom(seq);
        if (!rec) throw new Error(`Room receipt unresolved: send reported #${seq} but the ledger has no such record`);
        if (!rec.body.includes(token)) throw new Error(`Room receipt unresolved: record #${seq} does not carry this event's id`);
      }
      if (!rec.eventId || !rec.recordHash || !rec.hashVerified) {
        throw new Error(`Room receipt unresolved: record #${rec.sequence} has no verified eventId and record hash`);
      }
      d.prepare("UPDATE pm_status_log SET room_sync = 'POSTED', room_ref = ?, room_error = NULL, room_attempts = room_attempts + 1 WHERE id = ?")
        .run(json({ sequence: rec.sequence, eventId: rec.eventId, recordHash: rec.recordHash }), row.id);
    } catch (e) {
      d.prepare('UPDATE pm_status_log SET room_error = ?, room_attempts = room_attempts + 1 WHERE id = ?').run(e.message, row.id);
    }
  }
}

// ── Task operations ────────────────────────────────────────────────────────
function createTask(body) {
  only(body, ['project_id', 'title', 'description', 'priority', 'owner', 'verifier', 'notes', 'depends_on', 'actor', 'room_authorization_ref']);
  const actor = handleField(body, 'actor', { required: true, allowUnassigned: false });
  const projectId = str(body, 'project_id', { min: 2, max: 40, required: true });
  const title = str(body, 'title', { min: 3, max: 200, required: true });
  const description = str(body, 'description', { max: 4000 }) ?? '';
  const notes = str(body, 'notes', { max: 4000 }) ?? '';
  const priority = body.priority === undefined ? 'P2' : body.priority;
  if (!PRIORITIES.includes(priority)) throw bad('priority invalid.', ['priority must be P0-P3']);
  const owner = handleField(body, 'owner') ?? 'UNASSIGNED';
  const verifier = handleField(body, 'verifier') ?? 'UNASSIGNED';
  if (owner !== 'UNASSIGNED' && owner === verifier) throw new HttpError(409, 'DEC_072', 'Owner and verifier must be different identities (DEC-072).');
  const auth = body.room_authorization_ref === undefined ? null : parseRoomRef({ ...body.room_authorization_ref, kind: 'authorization' });

  const created = tx((d) => {
    const project = getProjectRow(projectId);
    if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', `Unknown project: ${projectId}.`);
    const dependsOn = dependsField(body, projectId, null) ?? [];
    const seq = project.next_seq;
    const id = `PM-${project.prefix}-${String(seq).padStart(3, '0')}`;
    d.prepare('UPDATE pm_projects SET next_seq = next_seq + 1 WHERE id = ?').run(projectId);
    const ts = nowIso();
    d.prepare(
      `INSERT INTO pm_tasks (id, project_id, title, description, priority, status, owner, verifier, room_authorization_ref, evidence_refs, depends_on, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'BACKLOG', ?, ?, ?, '[]', ?, ?, ?, ?, ?)`,
    ).run(id, projectId, title, description, priority, owner, verifier, auth ? json(auth) : null, json(dependsOn), notes, actor, ts, ts);
    logEvent(d, { taskId: id, type: 'CREATED', to: 'BACKLOG', actor, detail: { title, priority, owner, verifier, room_ref: auth }, post: true });
    return id;
  });
  enqueueRoomSync();
  return taskDetail(created);
}

function updateTask(id, body) {
  only(body, ['expected_updated_at', 'actor', 'title', 'description', 'priority', 'owner', 'verifier', 'notes', 'depends_on', 'status', 'note', 'room_ref']);
  const actor = handleField(body, 'actor', { required: true, allowUnassigned: false });
  const expected = str(body, 'expected_updated_at', { min: 10, max: 40, required: true });
  const note = str(body, 'note', { max: 1000 });
  const title = str(body, 'title', { min: 3, max: 200 });
  const description = str(body, 'description', { max: 4000 });
  const notes = str(body, 'notes', { max: 4000 });
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority)) throw bad('priority invalid.', ['priority must be P0-P3']);
  if (body.status !== undefined && !STATUSES.includes(body.status)) throw bad('status invalid.', [`status must be one of ${STATUSES.join(', ')}`]);
  const owner = handleField(body, 'owner');
  const verifier = handleField(body, 'verifier');
  const roomRef = body.room_ref === undefined ? null : parseRoomRef(body.room_ref, { taskId: id });

  tx((d) => {
    const row = getTaskRow(id);
    if (!row) throw new HttpError(404, 'TASK_NOT_FOUND', `Unknown task: ${id}.`);
    if (row.updated_at !== expected) throw new HttpError(409, 'STALE_EDIT', 'Task changed since you loaded it; reload before editing. Nothing was saved.', { current_updated_at: row.updated_at });
    if (row.status === 'CLOSED') throw new HttpError(409, 'TASK_CLOSED', 'Closed tasks are immutable.');
    const task = hydrate(row);
    const project = getProjectRow(task.project_id);
    const dependsOn = dependsField(body, task.project_id, id);
    const next = { ...task };
    const changed = {};
    for (const [k, v] of [['title', title], ['description', description], ['priority', body.priority], ['notes', notes]]) {
      if (v !== undefined && v !== task[k]) { next[k] = v; changed[k] = { from: task[k], to: v }; }
    }
    if (dependsOn && json(dependsOn) !== json(task.depends_on)) { next.depends_on = dependsOn; changed.depends_on = { from: task.depends_on, to: dependsOn }; }
    const assignment = {};
    if (owner !== undefined && owner !== task.owner) { next.owner = owner; assignment.owner = { from: task.owner, to: owner }; }
    if (verifier !== undefined && verifier !== task.verifier) { next.verifier = verifier; assignment.verifier = { from: task.verifier, to: verifier }; }
    if (next.owner !== 'UNASSIGNED' && next.owner === next.verifier) throw new HttpError(409, 'DEC_072', 'Owner and verifier must be different identities (DEC-072).');
    if (Object.keys(assignment).length && ['VERIFICATION', 'ACCEPTANCE'].includes(task.status)) {
      throw new HttpError(409, 'ASSIGNMENT_LOCKED', 'Owner and verifier cannot change once the task is in VERIFICATION or ACCEPTANCE.');
    }

    const events = [];
    if (roomRef) {
      if (roomRef.kind === 'authorization') next.room_authorization_ref = roomRef;
      else next.evidence_refs = [...task.evidence_refs.filter((r) => r.sequence !== roomRef.sequence), roomRef];
    }
    const to = body.status;
    if (to !== undefined && to !== task.status) {
      const allowed = allowedNext(task);
      if (!allowed.includes(to)) throw new HttpError(409, 'TRANSITION_NOT_ALLOWED', `${task.status} -> ${to} is not allowed. Allowed: ${allowed.join(', ') || 'none'}.`);
      const hold = effectiveHold(project);
      if (holdBlocks(hold) && HOLD_BLOCKED_TARGETS.has(to)) {
        throw new HttpError(409, 'PROJECT_ON_HOLD', `${project.name} is ${hold.state}${hold.authority ? ` (${hold.authority})` : ''}; tasks cannot progress past READY until the Founder lifts the hold.`);
      }
      const rejecting = to === 'READY' && REJECTABLE.has(task.status);
      if ((rejecting || to === 'BLOCKED' || to === 'FOUNDER_GATE') && (!note || note.length < 5)) {
        throw bad('A note of at least 5 characters is required for this transition.', [`note required for ${rejecting ? 'rejection' : to}`]);
      }
      if (to === 'IN_PROGRESS') {
        if (!next.room_authorization_ref) throw new HttpError(409, 'AUTHORIZATION_REQUIRED', 'A verified Room authorization reference is required before work starts.');
        const open = next.depends_on.filter((dep) => getTaskRow(dep)?.status !== 'CLOSED');
        if (open.length) throw new HttpError(409, 'DEPENDENCY_OPEN', `Dependencies not closed: ${open.join(', ')}.`);
      }
      if (to === 'REVIEW' && next.owner === 'UNASSIGNED') throw new HttpError(409, 'OWNER_REQUIRED', 'Assign an owner before review.');
      if (to === 'VERIFICATION' && (next.verifier === 'UNASSIGNED' || next.verifier === next.owner)) {
        throw new HttpError(409, 'VERIFIER_REQUIRED', 'Assign an independent verifier (different from the owner) before verification.');
      }
      // R2: the proof is the Room-authenticated sender of a linked record, never the
      // self-declared actor. The record must name this task and post-date the stage entry.
      const enteredAt = (stage) => d.prepare('SELECT timestamp FROM pm_status_log WHERE task_id = ? AND to_status = ? ORDER BY id DESC LIMIT 1').get(id, stage)?.timestamp ?? null;
      const attests = (ref, stage, senderOk) => {
        const since = enteredAt(stage);
        return ref.kind === 'evidence' && senderOk(ref) && ref.mentions_task === true && since !== null
          && Date.parse(ref.received_at) > Date.parse(since);
      };
      if (to === 'ACCEPTANCE') {
        if (next.verifier === 'UNASSIGNED' || next.verifier === next.owner) {
          throw new HttpError(409, 'VERIFIER_REQUIRED', 'An independent verifier (different from the owner) is required.');
        }
        if (!next.evidence_refs.some((r) => attests(r, 'VERIFICATION', (x) => x.senderHandle === next.verifier))) {
          throw new HttpError(409, 'VERIFIER_ATTESTATION_REQUIRED', `Acceptance needs a linked Room record sent by the assigned verifier (${next.verifier}), naming ${id}, posted after the task entered VERIFICATION. The actor field is not accepted as proof.`);
        }
      }
      if (to === 'CLOSED') {
        if (!next.room_authorization_ref) throw new HttpError(409, 'AUTHORIZATION_REQUIRED', 'Closure needs a Room authorization reference.');
        if (!next.evidence_refs.some((r) => attests(r, 'ACCEPTANCE', (x) => x.root_authority === true))) {
          throw new HttpError(409, 'FOUNDER_CLOSURE_REQUIRED', `Closure needs a linked authenticated ROOT_GENESIS (Founder) Room record naming ${id}, posted after the task entered ACCEPTANCE.`);
        }
      }
      next.prior_status = (to === 'BLOCKED' || to === 'FOUNDER_GATE')
        ? (task.status === 'BLOCKED' || task.status === 'FOUNDER_GATE' ? task.prior_status : task.status)
        : null;
      next.status = to;
      next.closed_at = to === 'CLOSED' ? nowIso() : null;
      events.push({ type: rejecting ? 'REJECTED' : 'STATUS_CHANGED', from: task.status, to, detail: { note: note ?? null, room_ref: roomRef }, post: true });
    }
    if (Object.keys(assignment).length) events.push({ type: 'ASSIGNED', detail: { ...assignment, note: note ?? null }, post: true });
    if (Object.keys(changed).length) events.push({ type: 'FIELDS_UPDATED', detail: changed, post: false });
    if (roomRef && !events.some((e) => e.detail?.room_ref)) events.push({ type: 'ROOM_LINKED', detail: { room_ref: roomRef, note: note ?? null }, post: true });
    if (!events.length) throw bad('Nothing to change.', ['no changes supplied']);

    const ts = nowIso();
    d.prepare(
      `UPDATE pm_tasks SET title = ?, description = ?, priority = ?, status = ?, prior_status = ?, owner = ?, verifier = ?,
         room_authorization_ref = ?, evidence_refs = ?, depends_on = ?, notes = ?, updated_at = ?, closed_at = ? WHERE id = ?`,
    ).run(next.title, next.description, next.priority, next.status, next.prior_status ?? null, next.owner, next.verifier,
      next.room_authorization_ref ? json(next.room_authorization_ref) : null, json(next.evidence_refs), json(next.depends_on),
      next.notes, ts, next.closed_at ?? null, id);
    for (const e of events) logEvent(d, { taskId: id, type: e.type, from: e.from ?? null, to: e.to ?? null, actor, detail: e.detail, post: e.post });
  });
  enqueueRoomSync();
  return taskDetail(id);
}

function linkRoom(id, body) {
  only(body, ['actor', 'expected_updated_at', 'sequence', 'eventId', 'purpose', 'kind']);
  return updateTask(id, {
    actor: body.actor,
    expected_updated_at: body.expected_updated_at,
    room_ref: { sequence: body.sequence, eventId: body.eventId, purpose: body.purpose, kind: body.kind },
  });
}

function taskDetail(id) {
  const row = getTaskRow(id);
  if (!row) throw new HttpError(404, 'TASK_NOT_FOUND', `Unknown task: ${id}.`);
  const d = requireDb();
  const history = d.prepare('SELECT * FROM pm_status_log WHERE task_id = ? ORDER BY id DESC').all(id).map((h) => ({
    ...h, detail: JSON.parse(h.detail), room_ref: h.room_ref ? JSON.parse(h.room_ref) : null,
  }));
  const pending = history.filter((h) => h.room_sync === 'PENDING').length;
  const project = getProjectRow(row.project_id);
  return { task: hydrate(row, pending), history, hold: effectiveHold(project) };
}

function listProjects() {
  return requireDb().prepare('SELECT * FROM pm_projects ORDER BY rowid').all().map((p) => ({ ...p, hold: effectiveHold(p) }));
}

function listTasks(projectId) {
  const d = requireDb();
  const pend = pendingCounts();
  const rows = projectId
    ? d.prepare('SELECT * FROM pm_tasks WHERE project_id = ? ORDER BY id').all(projectId)
    : d.prepare('SELECT * FROM pm_tasks ORDER BY id').all();
  return rows.map((r) => hydrate(r, pend.get(r.id) ?? 0));
}

function portfolio() {
  const projects = listProjects();
  const tasks = listTasks(null);
  const syncRow = requireDb().prepare("SELECT COUNT(*) AS n FROM pm_status_log WHERE room_sync = 'PENDING'").get();
  return {
    generated_at: nowIso(),
    pending_room_sync: Number(syncRow.n),
    statuses: STATUSES,
    projects: projects.map((p) => {
      const mine = tasks.filter((t) => t.project_id === p.id);
      const counts = Object.fromEntries(STATUSES.map((s) => [s, mine.filter((t) => t.status === s).length]));
      return {
        id: p.id, name: p.name, prefix: p.prefix, hold: p.hold, source_gap: p.source_gap,
        total: mine.length, counts,
        open: mine.filter((t) => t.status !== 'CLOSED').length,
        founder_gate: counts.FOUNDER_GATE, blocked: counts.BLOCKED,
        pending_room_sync: mine.reduce((n, t) => n + t.pending_room_sync, 0),
        unassigned: mine.filter((t) => t.status !== 'CLOSED' && t.owner === 'UNASSIGNED').length,
      };
    }),
  };
}

function health() {
  const base = { service: 'starq-command-pm', authority: 'Founder #9497 / #9503', port: PORT, bind: HOST, scratch: SCRATCH, db: dbState.path, state: dbState.state, reason: dbState.reason, integrity: dbState.integrity, seed_drift: dbState.seed_drift, room_post: ROOM_POST ? 'ON' : 'OFF', checked_at: nowIso() };
  if (!db) return base;
  const q = (sql) => Number(db.prepare(sql).get().n);
  return {
    ...base,
    schema_version: Number(db.prepare("SELECT value FROM pm_meta WHERE key = 'schema_version'").get().value),
    db_id: db.prepare("SELECT value FROM pm_meta WHERE key = 'db_id'").get().value,
    projects: q('SELECT COUNT(*) AS n FROM pm_projects'),
    tasks: q('SELECT COUNT(*) AS n FROM pm_tasks'),
    history_rows: q('SELECT COUNT(*) AS n FROM pm_status_log'),
    pending_room_sync: q("SELECT COUNT(*) AS n FROM pm_status_log WHERE room_sync = 'PENDING'"),
  };
}

function exportAll() {
  const d = requireDb();
  const payload = {
    exported_at: nowIso(),
    projects: d.prepare('SELECT * FROM pm_projects ORDER BY rowid').all(),
    tasks: d.prepare('SELECT * FROM pm_tasks ORDER BY id').all(),
    history: d.prepare('SELECT * FROM pm_status_log ORDER BY id').all(),
  };
  return { ...payload, sha256: crypto.createHash('sha256').update(json({ p: payload.projects, t: payload.tasks, h: payload.history })).digest('hex') };
}

// ── HTTP ───────────────────────────────────────────────────────────────────
function send(res, status, payload, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'content-type, x-pm-client';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, OPTIONS';
  }
  res.writeHead(status, headers);
  res.end(json(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    const tooLarge = () => {
      if (over) return;
      over = true;
      chunks.length = 0;
      reject(new HttpError(413, 'TOO_LARGE', 'Request body too large.'));
    };
    if (Number(req.headers['content-length']) > MAX_BODY) tooLarge();
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { tooLarge(); return; }
      if (!over) chunks.push(c);
    });
    req.on('end', () => {
      if (over) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
      catch { reject(bad('Body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const origin = req.headers.origin;
  try {
    if (!LOOPBACK.has(req.socket.remoteAddress)) throw new HttpError(403, 'LOCAL_ONLY', 'Local access only.');
    if (!ALLOWED_HOSTS.has(String(req.headers.host ?? '').toLowerCase())) throw new HttpError(403, 'HOST_REJECTED', 'Host header rejected.');
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) throw new HttpError(403, 'ORIGIN_REJECTED', 'Origin rejected.');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': origin ?? '', 'Access-Control-Allow-Headers': 'content-type, x-pm-client', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' }); res.end(); return; }

    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const p = url.pathname.replace(/\/+$/, '');
    const write = req.method !== 'GET';
    if (write) {
      if (req.headers['x-pm-client'] !== 'starq-command') throw new HttpError(403, 'CLIENT_HEADER', 'Missing X-PM-Client header.');
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'CONTENT_TYPE', 'Content-Type must be application/json.');
    }

    if (req.method === 'GET' && p === '/api/pm/health') return send(res, 200, health(), origin);
    if (req.method === 'GET' && p === '/api/pm/meta') {
      return send(res, 200, { statuses: STATUSES, priorities: PRIORITIES, forward: FORWARD, handles: [...knownHandles()].sort() }, origin);
    }
    if (req.method === 'GET' && p === '/api/pm/projects') return send(res, 200, { projects: listProjects() }, origin);
    if (req.method === 'GET' && p === '/api/pm/portfolio') return send(res, 200, portfolio(), origin);
    if (req.method === 'GET' && p === '/api/pm/export') return send(res, 200, exportAll(), origin);
    if (req.method === 'GET' && p === '/api/pm/tasks') {
      const pid = url.searchParams.get('project_id');
      if (pid && !getProjectRow(pid)) throw new HttpError(404, 'PROJECT_NOT_FOUND', `Unknown project: ${pid}.`);
      return send(res, 200, { project_id: pid, tasks: listTasks(pid || null) }, origin);
    }
    let m = /^\/api\/pm\/tasks\/(PM-[A-Z]{2,4}-\d{3,})$/.exec(p);
    if (m && req.method === 'GET') return send(res, 200, taskDetail(m[1]), origin);
    if (m && req.method === 'PATCH') return send(res, 200, updateTask(m[1], await readBody(req)), origin);
    m = /^\/api\/pm\/tasks\/(PM-[A-Z]{2,4}-\d{3,})\/room-link$/.exec(p);
    if (m && req.method === 'POST') return send(res, 200, linkRoom(m[1], await readBody(req)), origin);
    if (req.method === 'POST' && p === '/api/pm/tasks') return send(res, 201, createTask(await readBody(req)), origin);
    if (req.method === 'POST' && p === '/api/pm/room-sync/retry') {
      await readBody(req);
      requireDb();
      enqueueRoomSync();
      return send(res, 202, { queued: true, pending_room_sync: health().pending_room_sync }, origin);
    }
    throw new HttpError(404, 'NOT_FOUND', 'No such route.');
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 413) {
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.destroy());
      }
      return send(res, e.status, { error: e.code, message: e.message, ...(e.extra ?? {}) }, origin);
    }
    console.error('[pm] unhandled:', e);
    return send(res, 500, { error: 'INTERNAL', message: 'Internal error. Nothing partial was committed.' }, origin);
  }
}

// ── CLI: --backup / --verify ───────────────────────────────────────────────
function cliBackup() {
  startDatabase();
  if (!db) { console.error(`PM database unavailable: ${dbState.reason}`); process.exit(2); }
  const out = path.join(path.dirname(dbState.path), `pm-board-backup-${nowIso().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  db.close();
  const copy = openDatabase(out);
  const check = integrity(copy);
  copy.close();
  const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
  console.log(json({ backup: out, bytes: fs.statSync(out).size, sha256: sha, integrity: check.detail }));
  process.exit(check.ok ? 0 : 3);
}

function cliVerify(file) {
  const handle = new DatabaseSync(path.resolve(file), { readOnly: true });
  const check = integrity(handle);
  const n = (t) => Number(handle.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  console.log(json({ file: path.resolve(file), integrity: check.detail, projects: n('pm_projects'), tasks: n('pm_tasks'), history_rows: n('pm_status_log') }));
  handle.close();
  process.exit(check.ok ? 0 : 3);
}

const argv = process.argv.slice(2);
if (argv.includes('--backup')) cliBackup();
else if (argv.includes('--verify')) cliVerify(argv[argv.indexOf('--verify') + 1]);
else {
  if (ROOM_POST) requireExplicitRoomWriter();
  startDatabase();
  const server = http.createServer((req, res) => { void handle(req, res); });
  server.listen(PORT, HOST, () => {
    console.log(json({ service: 'starq-command-pm', listening: `${HOST}:${PORT}`, db_state: dbState.state, db: dbState.path, room_post: ROOM_POST ? 'ON' : 'OFF', reason: dbState.reason }));
    setTimeout(enqueueRoomSync, 3000);
  });
  const shutdown = () => { server.close(); try { db?.close(); } catch { /* ignore */ } process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
