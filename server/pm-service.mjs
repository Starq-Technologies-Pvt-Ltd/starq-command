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
 *   - five Nexus kanban columns: TODO, NEXT, IN_PROGRESS, BLOCKED, DONE
 *   - any column to any column; no review/accept/gate lifecycle
 *   - Nexus boards are imported once into this database; StarqNexus is never written
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
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { resolveWorkspace, CANONICAL, CONTROL_BOARD_FILES, abs } from './paths.mjs';
import { readRoomSnapshot } from './room-snapshot.mjs';
import { importExternalComponent, resolveExternalComponent } from './external-components.mjs';
import {
  initOrgSchema,
  seedOperatingOrg,
  readOrg,
  createCompany as orgCreateCompany,
  createUnit as orgCreateUnit,
  createPosition as orgCreatePosition,
  createPerson as orgCreatePerson,
  createAppointment as orgCreateAppointment,
  orgPeopleHandles,
} from './operating-org.mjs';
import { buildSendArgs } from './comms.mjs';
import { createRepositoryStatusService } from './repository-status.mjs';
import {
  backfillNexusAttributes,
  ensureFidelityColumns,
  restoreCollidedRecords,
  workersOf,
} from './nexus-fidelity.mjs';
import {
  GATED_STAGES,
  PROVENANCE,
  allowedStageNext,
  assignmentLocked,
  columnDragToStage,
  evaluateStageTransition,
  nextPriorStage,
  stageToColumn,
} from './gated-lifecycle.mjs';
import {
  KANBAN_STATUSES,
  NEXUS_BOARDS,
  allowedKanbanNext,
  importNexusBoards,
  importLegacyPmSnapshot,
  mapKanbanStatus,
} from './nexus-kanban.mjs';

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
const SCHEMA_VERSION = 3;
const TASK_ID_RE = /^[A-Za-z0-9._:-]{2,40}$/;

export const STATUSES = [...KANBAN_STATUSES];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const FORWARD = {};
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173', 'http://localhost:5173',
  'http://127.0.0.1:4173', 'http://localhost:4173',
]);
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function allowedNext(task) {
  return allowedKanbanNext(task.status);
}

// ── Configuration ──────────────────────────────────────────────────────────
const workspace = resolveWorkspace();
const ROOT = workspace.root;
const AGENT_COMMS = resolveExternalComponent('agent-comms', { workspaceRoot: ROOT });
const ROOM_POST = (process.env.PM_ROOM_POST || 'on') !== 'off';
const ROOM_FROM = String(process.env.PM_ROOM_FROM || '').trim();
const ROOM_INSTANCE = String(process.env.PM_ROOM_INSTANCE || '').trim();
const ROOM_TAGS = process.env.PM_ROOM_TAGS || '';
const SEND_SCRIPT = process.env.PM_ROOM_SEND_SCRIPT || (AGENT_COMMS.root ? path.join(AGENT_COMMS.root, 'scripts', 'send.mjs') : '');
// Export the lifecycle-owned HTTP server so lifecycle-child can close it through
// its authenticated graceful-shutdown adapter.
export let server = null;

// Repository sync facts are collected off the request path and cached. The
// route below never runs a Git probe (and never the synchronous lifecycle
// preflight builder) while a request is being served.
const REPOSITORY_STATUS = createRepositoryStatusService();

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
const nextTaskUpdatedAt = (previous) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
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
const FOUNDER_LEVELS = new Set(['ROOT_GENESIS', 'FOUNDER', 'OWNER']);
function isFounderHandle(handle) {
  const level = identityLevels().get(handle);
  return FOUNDER_LEVELS.has(level) || handle === 'ali' || handle === 'mustarq';
}
function knownHandles() {
  const ids = new Set(identityLevels().keys());
  if (db) for (const h of orgPeopleHandles(db)) ids.add(h);
  return ids;
}
function localLedgerRef({ actor, purpose, kind, taskId }) {
  const eventId = crypto.createHash('sha256').update(`local:${kind}:${actor}:${taskId ?? ''}:${nowIso()}:${crypto.randomUUID()}`).digest('hex');
  return {
    authority: 'LOCAL_LEDGER',
    kind,
    sequence: 0,
    eventId,
    recordHash: null,
    senderHandle: actor,
    purpose,
    verified_at: nowIso(),
    received_at: nowIso(),
    authority_level: identityLevels().get(actor) ?? 'LOCAL_COMMAND',
    root_authority: isFounderHandle(actor),
    mentions_task: true,
    task_id: taskId ?? null,
  };
}

// The Room's own hash function, read-only. If it cannot be loaded, Room references
// cannot be authenticated and every one is refused (fail closed).
const roomHashModule = await importExternalComponent('agent-comms', 'protocol/v1/hashChain.mjs', { workspaceRoot: ROOT });
const computeRecordHash = roomHashModule.module?.computeRecordHash ?? null;
const LEDGER_PATH = () => {
  const o = process.env.PM_ROOM_LEDGER;
  if (SCRATCH) {
    if (!o) throw new HttpError(503, 'UNAVAILABLE', 'Scratch Room fixture path is not configured.');
    return path.resolve(o);
  }
  if (!SCRATCH && process.env.PM_ROOM_LEDGER) {
    throw new HttpError(503, 'UNAVAILABLE', 'Production Room path is fixed by the canonical workspace.');
  }
  return abs(ROOT, CANONICAL.roomLedger);
};

function snapshotLedger() {
  if (!ROOT) throw new HttpError(503, 'UNAVAILABLE', 'Workspace unresolved.');
  if (!computeRecordHash) throw new HttpError(503, 'UNAVAILABLE', 'Room hash function unavailable; Room references cannot be authenticated.');
  const snapshot = readRoomSnapshot(ROOT, { roomPath: LEDGER_PATH(), fixturePath: SCRATCH });
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

let roomLookupForTesting = null;
export function setRoomLookupForTesting(lookup) {
  roomLookupForTesting = lookup;
}
function lookupRoom(sequence) {
  if (roomLookupForTesting) return roomLookupForTesting(sequence);
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

// Cached work-model maturity reader (forwards L1-L4 verbatim from command_work_model.json)
let cachedWorkModelMaturity = null;
let lastWorkModelMtime = 0;

export function readCanonicalWorkModelMaturity() {
  if (!ROOT) return null;
  const wmPath = abs(ROOT, `${CANONICAL.controlBoard}/${CONTROL_BOARD_FILES.workModel}`);
  try {
    const stat = fs.statSync(wmPath);
    if (cachedWorkModelMaturity && stat.mtimeMs === lastWorkModelMtime) {
      return cachedWorkModelMaturity;
    }
    const raw = JSON.parse(fs.readFileSync(wmPath, 'utf8'));
    const mat = raw?.maturity ?? {};
    cachedWorkModelMaturity = {
      authority: mat.authority ?? 'UNKNOWN',
      not_an_ssoT: mat.not_an_ssoT ?? null,
      hard_rule: mat.hard_rule ?? null,
      honesty_rule: mat.honesty_rule ?? null,
      L1: mat.L1_task_execution_progress ?? null,
      L2: mat.L2_stage_maturity ?? [],
      L3: mat.L3_process_family_maturity ?? [],
      L4: mat.L4_overall_erp_maturity ?? null,
    };
    lastWorkModelMtime = stat.mtimeMs;
    return cachedWorkModelMaturity;
  } catch {
    return null;
  }
}

export function effectiveHold(project) {
  if (project.id === 'erp' && ROOT) {
    try {
      const c = JSON.parse(fs.readFileSync(abs(ROOT, `${CANONICAL.controlBoard}/contract.json`), 'utf8'));
      const h = c?.hold_state ?? {};
      const rawContractState = typeof h.implementation === 'string' ? h.implementation : 'UNKNOWN';
      return {
        // Operational authority is ACTIVE under current Founder directives #16183/#16185/#16211.
        state: 'ACTIVE',
        authority: 'Founder #16183/#16185/#16211',
        effective: '2026-10-29',
        source: 'Founder directives #16183/#16185/#16211 (current operational authority)',
        historical_hold: {
          state: rawContractState,
          authority: h.authority ?? 'DEC-100',
          effective: h.effective ?? '2026-09-28',
          source: 'starqerp-control-board/contract.json (historical DEC-100, superseded)',
          canonical_ledger: 'NOT YET WRITTEN (highest id DEC-108)',
          owner: 'Claude/DEC-109',
        },
        authority_update: {
          lifted_by: 'Founder #16183/#16185/#16211',
          scope: 'all development holds',
          canonical_ledger: 'NOT YET WRITTEN (highest id DEC-108)',
          owner: 'Claude/DEC-109',
        },
      };
    } catch {
      return {
        state: 'ACTIVE',
        authority: 'Founder #16183/#16185/#16211',
        effective: '2026-10-29',
        source: 'Founder directives #16183/#16185/#16211 (contract.json unreadable; operational authority ACTIVE)',
        historical_hold: {
          state: 'ON_HOLD',
          authority: 'DEC-100',
          effective: '2026-09-28',
          source: 'starqerp-control-board/contract.json',
        },
      };
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

export function initSchema(handle) {
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
      status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','NEXT','IN_PROGRESS','BLOCKED','DONE')),
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
    CREATE TABLE IF NOT EXISTS pm_import_sources (
      source_file TEXT PRIMARY KEY,
      source_system TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      row_count INTEGER NOT NULL CHECK (row_count >= 0),
      imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pm_source_records (
      source_key TEXT PRIMARY KEY,
      source_system TEXT NOT NULL,
      source_file TEXT NOT NULL REFERENCES pm_import_sources(source_file),
      source_row_index INTEGER NOT NULL CHECK (source_row_index >= 0),
      task_id TEXT,
      resolution TEXT NOT NULL CHECK (resolution IN ('IMPORTED','DUPLICATE_TASK_ID','INVALID_ID','ARCHIVED_ID_COLLISION')),
      raw_status TEXT,
      payload_sha256 TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      UNIQUE(source_file, source_row_index)
    );
    CREATE TABLE IF NOT EXISTS pm_import_source_versions (
      source_file TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      row_count INTEGER NOT NULL CHECK (row_count >= 0),
      imported_at TEXT NOT NULL,
      PRIMARY KEY(source_file, content_sha256)
    );
    CREATE TABLE IF NOT EXISTS pm_source_record_versions (
      source_key TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      source_system TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_row_index INTEGER NOT NULL,
      task_id TEXT,
      resolution TEXT NOT NULL,
      raw_status TEXT,
      raw_payload TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pm_source_records_task ON pm_source_records(task_id);
    CREATE INDEX IF NOT EXISTS idx_pm_source_records_file ON pm_source_records(source_file, source_row_index);
    CREATE INDEX IF NOT EXISTS idx_pm_source_versions_file ON pm_source_record_versions(source_file, source_row_index);
    CREATE INDEX IF NOT EXISTS idx_pm_source_versions_key ON pm_source_record_versions(source_key);
    CREATE TRIGGER IF NOT EXISTS pm_source_versions_no_update BEFORE UPDATE ON pm_source_record_versions
      BEGIN SELECT RAISE(ABORT, 'pm_source_record_versions is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS pm_source_versions_no_delete BEFORE DELETE ON pm_source_record_versions
      BEGIN SELECT RAISE(ABORT, 'pm_source_record_versions is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS pm_source_records_no_delete BEFORE DELETE ON pm_source_records
      BEGIN SELECT RAISE(ABORT, 'pm_source_records are never deleted'); END;
    CREATE INDEX IF NOT EXISTS idx_pm_log_task ON pm_status_log(task_id);
    CREATE INDEX IF NOT EXISTS idx_pm_log_sync ON pm_status_log(room_sync);
    CREATE TRIGGER IF NOT EXISTS pm_log_no_delete BEFORE DELETE ON pm_status_log
      BEGIN SELECT RAISE(ABORT, 'pm_status_log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS pm_log_immutable BEFORE UPDATE OF
      task_id, event_type, from_status, to_status, actor, detail, timestamp ON pm_status_log
      BEGIN SELECT RAISE(ABORT, 'pm_status_log history columns are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS pm_tasks_no_delete BEFORE DELETE ON pm_tasks
      BEGIN SELECT RAISE(ABORT, 'tasks are never deleted; move them to DONE'); END;
  `);
  initOrgSchema(handle);
  ensureGatedColumns(handle);
  // Founder 28 Oct: promote the full original Nexus record out of raw_payload
  // back into queryable columns, and restore the records the importer's global
  // id guard discarded. Both steps are idempotent and run on every start.
  ensureFidelityColumns(handle);
  const has = handle.prepare('SELECT value FROM pm_meta WHERE key = ?');
  if (!has.get('schema_version')) {
    const put = handle.prepare('INSERT INTO pm_meta (key, value) VALUES (?, ?)');
    put.run('schema_version', String(SCHEMA_VERSION));
    put.run('db_id', crypto.randomUUID());
    put.run('created_at', nowIso());
  } else {
    migrateKanbanSchema(handle);
    handle.prepare("UPDATE pm_meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION));
  }
  rebuildStatusLogParent(handle);
}

/**
 * The governance axis (Founder D1).
 *
 * Added by ALTER TABLE rather than a table rebuild: the five-column `status`
 * contract, the append-only history and the no-delete triggers all keep
 * working untouched, and a half-applied migration cannot lose a row.
 *
 * Backfill rule, and the reason for it:
 *
 *   created_by = 'nexus-import'  ->  HISTORICAL_NEXUS
 *   anything else                ->  LIVE
 *
 * Gating history is meaningless - nobody can produce a June verifier
 * attestation for a card that closed in June - and the import had to
 * synthesise a LOCAL_LEDGER authorisation to satisfy the gate's shape, which
 * is the very thing the gate exists to refuse. So history is marked as history
 * and moves freely; only live work is governed.
 */
function ensureGatedColumns(handle) {
  const cols = new Set(handle.prepare("SELECT name FROM pragma_table_info('pm_tasks')").all().map((r) => r.name));
  if (!cols.has('stage')) handle.exec("ALTER TABLE pm_tasks ADD COLUMN stage TEXT");
  if (!cols.has('prior_stage')) handle.exec('ALTER TABLE pm_tasks ADD COLUMN prior_stage TEXT');
  if (!cols.has('provenance')) handle.exec("ALTER TABLE pm_tasks ADD COLUMN provenance TEXT NOT NULL DEFAULT 'LIVE'");

  handle.exec(`
    UPDATE pm_tasks SET provenance = 'HISTORICAL_NEXUS'
      WHERE (created_by = 'nexus-import' OR created_by = 'nexus-import-collision-restore') AND provenance <> 'HISTORICAL_NEXUS';
    UPDATE pm_tasks SET stage = CASE status
        WHEN 'TODO' THEN 'BACKLOG'
        WHEN 'NEXT' THEN 'READY'
        WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
        WHEN 'BLOCKED' THEN 'BLOCKED'
        WHEN 'DONE' THEN 'CLOSED'
        ELSE 'BACKLOG' END
      WHERE stage IS NULL;
    UPDATE pm_tasks SET created_by = 'antigravity'
    WHERE provenance = 'LIVE' AND created_by = 'ali';
  `);
  if (cols.has('nexus_task_id')) {
    handle.exec(`
      UPDATE pm_tasks SET
        nexus_task_id = NULL,
        nexus_source_file = NULL,
        nexus_source_key = NULL,
        nexus_status = NULL,
        nexus_project = NULL,
        nexus_attributes = NULL
      WHERE provenance = 'LIVE';
    `);
  }
  handle.exec('CREATE INDEX IF NOT EXISTS idx_pm_tasks_stage ON pm_tasks(stage)');
  handle.exec('CREATE INDEX IF NOT EXISTS idx_pm_tasks_provenance ON pm_tasks(provenance)');
}

function migrateKanbanSchema(handle) {
  const row = handle.prepare("SELECT value FROM pm_meta WHERE key = 'schema_version'").get();
  const version = Number(row?.value || 0);
  if (version >= 3) return;
  handle.exec('PRAGMA foreign_keys = OFF');
  handle.exec('DROP TRIGGER IF EXISTS pm_tasks_no_delete');
  handle.exec('ALTER TABLE pm_tasks RENAME TO pm_tasks_v2');
  handle.exec(`
    CREATE TABLE pm_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES pm_projects(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0','P1','P2','P3')),
      status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','NEXT','IN_PROGRESS','BLOCKED','DONE')),
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
  `);
  const old = handle.prepare('SELECT * FROM pm_tasks_v2').all();
  const ins = handle.prepare(
    `INSERT INTO pm_tasks (id, project_id, title, description, priority, status, prior_status, owner, verifier, room_authorization_ref, evidence_refs, depends_on, notes, created_by, created_at, updated_at, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const t of old) {
    const status = mapKanbanStatus(t.status);
    ins.run(
      t.id, t.project_id, t.title, t.description, t.priority, status,
      t.prior_status ? mapKanbanStatus(t.prior_status) : null,
      t.owner, t.verifier, t.room_authorization_ref, t.evidence_refs, t.depends_on, t.notes,
      t.created_by, t.created_at, t.updated_at, status === 'DONE' ? (t.closed_at ?? t.updated_at) : null,
    );
  }
  handle.exec('DROP TABLE pm_tasks_v2');
  handle.exec(`
    CREATE INDEX IF NOT EXISTS idx_pm_tasks_project ON pm_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_pm_tasks_status ON pm_tasks(status);
    CREATE TRIGGER IF NOT EXISTS pm_tasks_no_delete BEFORE DELETE ON pm_tasks
      BEGIN SELECT RAISE(ABORT, 'tasks are never deleted; move them to DONE'); END;
  `);
  rebuildStatusLogParent(handle);
  handle.exec('PRAGMA foreign_keys = ON');
}

function rebuildStatusLogParent(handle) {
  const fk = handle.prepare('PRAGMA foreign_key_check').all();
  if (!fk.some((row) => row.parent === 'pm_tasks_v2')) return;
  handle.exec('PRAGMA foreign_keys = OFF');
  handle.exec('DROP TRIGGER IF EXISTS pm_log_no_delete');
  handle.exec('DROP TRIGGER IF EXISTS pm_log_immutable');
  handle.exec('ALTER TABLE pm_status_log RENAME TO pm_status_log_v2');
  handle.exec(`
    CREATE TABLE pm_status_log (
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
  `);
  handle.exec(`INSERT INTO pm_status_log (id, task_id, event_type, from_status, to_status, actor, detail, timestamp, room_sync, room_ref, room_error, room_attempts)
    SELECT id, task_id, event_type, from_status, to_status, actor, detail, timestamp, room_sync, room_ref, room_error, room_attempts FROM pm_status_log_v2`);
  handle.exec('DROP TABLE pm_status_log_v2');
  handle.exec(`
    CREATE INDEX IF NOT EXISTS idx_pm_log_task ON pm_status_log(task_id);
    CREATE INDEX IF NOT EXISTS idx_pm_log_sync ON pm_status_log(room_sync);
    CREATE TRIGGER IF NOT EXISTS pm_log_no_delete BEFORE DELETE ON pm_status_log
      BEGIN SELECT RAISE(ABORT, 'pm_status_log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS pm_log_immutable BEFORE UPDATE OF
      task_id, event_type, from_status, to_status, actor, detail, timestamp ON pm_status_log
      BEGIN SELECT RAISE(ABORT, 'pm_status_log history columns are immutable'); END;
  `);
  handle.exec('PRAGMA foreign_keys = ON');
}

export function seedProjects(handle) {
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

export function seedCurrentCommandWork(handle) {
  const open = handle.prepare("SELECT COUNT(*) AS n FROM pm_tasks WHERE project_id = 'command' AND status != 'DONE'").get();
  if (Number(open.n) > 0) return;
  const project = handle.prepare("SELECT * FROM pm_projects WHERE id = 'command'").get();
  if (!project) return;
  const seeds = [
    { title: 'Operate Starq Technologies in Command', description: 'Establish the writable operating org (company, units, positions, appointments) and use it as the management record. Canonical seats stay on Company OS Structure/Seats.', owner: 'antigravity', verifier: 'cursor', notes: 'Current work. Not a historical Nexus import.' },
    { title: 'Assign and execute Command OS tasks on the native board', description: 'Command is the working board surface with review/accept/gate lifecycle per Founder decision D1.', owner: 'antigravity', verifier: 'claude', notes: 'Nexus JSON is the import source only.' },
    { title: 'Founder daily dashboard: next actions and blockers', description: 'Overview must show real open/blocked/unassigned Command work from PM, not empty native boards plus a frozen archive.', owner: 'cursor', verifier: 'antigravity', notes: 'Acceptance: Founder can see next actions from Overview.' },
    { title: 'Reliable Command start and stop for management use', description: 'Founder opens Command and manages the company without editing source or chasing leftover JobGuardian jobs.', owner: 'cursor', verifier: 'antigravity', notes: 'Lifecycle recover remains a remaining defect if containment still blocks this session.' },
  ];
  const ins = handle.prepare(
    `INSERT INTO pm_tasks (id, project_id, title, description, priority, status, owner, verifier, room_authorization_ref, evidence_refs, depends_on, notes, created_by, created_at, updated_at)
     VALUES (?, 'command', ?, ?, 'P1', 'NEXT', ?, ?, NULL, '[]', '[]', ?, 'antigravity', ?, ?)`,
  );
  const log = handle.prepare(
    `INSERT INTO pm_status_log (task_id, event_type, from_status, to_status, actor, detail, timestamp, room_sync)
     VALUES (?, 'CREATED', NULL, 'NEXT', 'antigravity', ?, ?, 'DISABLED')`,
  );
  let seq = project.next_seq;
  const ts = nowIso();
  for (const seed of seeds) {
    const id = `PM-CMD-${String(seq).padStart(3, '0')}`;
    seq += 1;
    ins.run(id, seed.title, seed.description, seed.owner, seed.verifier, seed.notes, ts, ts);
    log.run(id, json({ title: seed.title, seeded: true, historical_import: false }), ts);
  }
  handle.prepare('UPDATE pm_projects SET next_seq = ? WHERE id = ?').run(seq, 'command');
}

export function startDatabase() {
  let dbPath;
  try {
    dbPath = resolveDbPath();
    if (!dbPath) throw new Error('Workspace unresolved.');
    const handle = openDatabase(dbPath);
    initSchema(handle);
    const drift = seedProjects(handle);
    seedOperatingOrg(handle, nowIso);
    seedCurrentCommandWork(handle);
    try {
      handle.exec('BEGIN IMMEDIATE');
      const nexus = importNexusBoards(handle, { nowIso, json });
      const legacyPm = importLegacyPmSnapshot(handle, {
        dbPath: ROOT ? abs(ROOT, CANONICAL.pmBoardLegacyDb) : null,
        nowIso,
        json,
      });
      // Fidelity runs AFTER the import, inside the same transaction. The
      // importer rebuilds pm_source_records from the board files on every
      // start, so anything written before it is overwritten.
      const restored = restoreCollidedRecords(handle, {
        nowIso,
        boardsById: Object.fromEntries(NEXUS_BOARDS.filter((b) => b.file).map((b) => [b.file, b.id])),
      });
      ensureGatedColumns(handle);
      const fill = backfillNexusAttributes(handle);
      handle.exec('COMMIT');
      for (const r of restored) {
        console.error('[pm] restored collided Nexus record ' + r.original_id + ' from ' + r.source_key + ' as ' + r.stored_as);
      }
      if (restored.length) {
        drift.push('Nexus id collisions restored: ' + restored.map((r) => r.original_id + ' -> ' + r.stored_as).join(', '));
      }
      if (fill.updated) console.error('[pm] Nexus fidelity backfill: ' + fill.updated + ' updated, ' + fill.skipped + ' already current');
      drift.push('Nexus attribute fidelity: ' + fill.considered + ' records carry their full original payload');
      if (nexus.errors.length) drift.push(...nexus.errors);
      if (legacyPm.errors.length) drift.push(...legacyPm.errors);
      drift.push(`legacy PM history preserved as archived source: ${legacyPm.preserved} tasks, ${legacyPm.history_rows ?? 0} status entries`);
      drift.push(`Nexus import reconciliation: ${nexus.imported} new, ${nexus.preserved} linked, ${nexus.skipped} duplicate or invalid rows`);
    } catch (error) {
      try { handle.exec('ROLLBACK'); } catch { /* transaction did not begin */ }
      drift.push(`nexus import failed: ${error.message}`);
    }
    const check = integrity(handle);
    if (!check.ok) {
      handle.close();
      dbState = { state: 'UNAVAILABLE', reason: `integrity_check failed: ${check.detail}`, path: dbPath, integrity: check.detail, seed_drift: drift };
      return;
    }
    db = handle;
    dbState = { state: 'OK', reason: null, path: dbPath, integrity: 'ok', seed_drift: drift };
  } catch (e) {
    dbState = { state: 'UNAVAILABLE', reason: e.message, path: dbPath ?? null, integrity: null, seed_drift: [] };
  }
}

export function requireDb() {
  if (!db) throw new HttpError(503, 'UNAVAILABLE', `PM database unavailable: ${dbState.reason}`);
  return db;
}

export function setDbForTesting(testDb) {
  db = testDb;
  dbState = { state: 'OK', reason: null, path: ':memory:', integrity: 'ok', seed_drift: [] };
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
export function hydrate(row, pending = 0) {
  const task = {
    ...row,
    room_authorization_ref: row.room_authorization_ref ? JSON.parse(row.room_authorization_ref) : null,
    evidence_refs: JSON.parse(row.evidence_refs),
    depends_on: JSON.parse(row.depends_on),
  };
  task.allowed_next = allowedNext(task);
  // The multi-agent assignment the first import flattened to its first element.
  task.workers = workersOf(row);
  // Both axes travel together, and board_column is DERIVED on read. A derived
  // value that is also stored is a value that can disagree with itself.
  task.provenance = row.provenance ?? PROVENANCE.LIVE;
  task.stage = row.stage ?? 'BACKLOG';
  task.prior_stage = row.prior_stage ?? null;
  task.board_column = stageToColumn(task.stage);
  task.gated = task.provenance !== PROVENANCE.HISTORICAL;
  task.allowed_stage_next = task.gated ? allowedStageNext(task) : [...GATED_STAGES];
  task.assignment_locked = assignmentLocked(task);
  task.pending_room_sync = pending;

  // Fidelity attributes ensured as first-class fields on returned task
  task.epic = row.epic ?? null;
  task.sprint = row.sprint ?? null;
  task.milestone = row.milestone ?? null;
  task.release_track = row.release_track ?? null;
  task.priority_raw = row.priority_raw ?? null;
  task.acceptance_json = row.acceptance_json ?? null;
  task.evidence_json = row.evidence_json ?? null;
  task.verification_json = row.verification_json ?? null;
  try { task.nexus_attributes = row.nexus_attributes ? JSON.parse(row.nexus_attributes) : null; }
  catch { task.nexus_attributes = null; }

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
function handleField(body, key, { required = false, allowUnassigned = true, freeform = false } = {}) {
  const v = str(body, key, { min: required ? 2 : 0, max: 40, required });
  if (v === undefined) return undefined;
  if (allowUnassigned && v === 'UNASSIGNED') return v;
  if (freeform) return v;
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
  const mentionsTask = taskId ? hasExactTaskMention(found.body, taskId) : false;
  if (kind === 'authorization' && !mentionsTask) {
    throw new HttpError(422, 'ROOM_TASK_MISMATCH', `Room #${raw.sequence} does not identify task ${taskId} exactly.`);
  }
  return {
    sequence: found.sequence, eventId: found.eventId, recordHash: found.recordHash,
    senderHandle: found.senderHandle, purpose, kind, verified_at: nowIso(),
    received_at: found.receivedAt, authority_level: found.registryLevel,
    root_authority: found.isRoot, mentions_task: mentionsTask,
  };
}

/** Match a task id as a complete token so prefixes/suffixes cannot authorize another task. */
function hasExactTaskMention(body, taskId) {
  if (typeof body !== 'string') return false;
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9._:-])${escaped}(?=$|[^A-Za-z0-9._:-])`).test(body);
}
function dependsField(body, project, selfId) {
  const v = body.depends_on;
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20) throw bad('depends_on must be an array of at most 20 task ids.', ['depends_on invalid']);
  const ids = [...new Set(v.map((x) => (typeof x === 'string' ? x.trim() : '')))];
  for (const id of ids) {
    if (!TASK_ID_RE.test(id)) throw bad('depends_on contains an invalid id.', [`invalid task id: ${id}`]);
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

function postCommsMessage({ from, body, channel, replyTo, subject, actionRequired, taskId }) {
  if (!SEND_SCRIPT) throw new HttpError(503, 'ROOM_UNAVAILABLE', 'Room send script is not resolved.');
  if (!knownHandles().has(from)) {
    throw new HttpError(422, 'UNKNOWN_SENDER', from + ' is not a known active identity.');
  }
  let args;
  try {
    args = buildSendArgs({ from, body, channel, replyTo, subject, actionRequired, taskId });
  } catch (e) {
    throw new HttpError(422, 'COMPOSE_INVALID', e.message);
  }
  const instance = from + '-command-comms';
  const full = [SEND_SCRIPT, '--instance', instance, ...args];
  return new Promise((resolve, reject) => {
    execFile(process.execPath, full, { cwd: path.dirname(path.dirname(SEND_SCRIPT)), timeout: 45000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const out = String(stdout || '');
      const m = /Broker Record #(\d+) posted/.exec(out) || /Record #(\d+)/.exec(out);
      if (!err && m) return resolve({ sequence: Number(m[1]), raw: out.trim().slice(0, 300) });
      // send.mjs refuses a Founder impersonation attempt with a clear message;
      // surface it verbatim rather than as a generic failure.
      const detail = String(stderr || out || (err && err.message) || 'send failed').trim().slice(0, 400);
      reject(new HttpError(/REFUSED/i.test(detail) ? 403 : 502, 'SEND_FAILED', detail));
    });
  });
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
  only(body, ['project_id', 'title', 'description', 'priority', 'owner', 'verifier', 'notes', 'depends_on', 'actor', 'status', 'stage']);
  const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
  const projectId = str(body, 'project_id', { min: 2, max: 40, required: true });
  const title = str(body, 'title', { min: 3, max: 800, required: true });
  const description = str(body, 'description', { max: 20000 }) ?? '';
  const notes = str(body, 'notes', { max: 8000 }) ?? '';
  const priority = body.priority === undefined ? 'P2' : body.priority;
  if (!PRIORITIES.includes(priority)) throw bad('priority invalid.', ['priority must be P0-P3']);
  const owner = handleField(body, 'owner', { freeform: true }) ?? 'UNASSIGNED';
  const verifier = handleField(body, 'verifier', { freeform: true }) ?? 'UNASSIGNED';
  const startStatus = body.status === undefined ? 'TODO' : body.status;
  if (!STATUSES.includes(startStatus)) throw bad('status invalid.', [`status must be one of ${STATUSES.join(', ')}`]);
  // New work is LIVE and therefore gated from its first moment. A task cannot
  // be created already accepted: the furthest a new card may start is READY.
  const startStage = body.stage === undefined
    ? (startStatus === 'NEXT' ? 'READY' : 'BACKLOG')
    : body.stage;
  if (!['BACKLOG', 'READY'].includes(startStage)) {
    throw bad('stage invalid for a new task.', ['a new task starts at BACKLOG or READY; later stages must be earned']);
  }

  const created = tx((d) => {
    const project = getProjectRow(projectId);
    if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', `Unknown project: ${projectId}.`);
    const dependsOn = dependsField(body, projectId, null) ?? [];
    const seq = project.next_seq;
    const id = `PM-${project.prefix}-${String(seq).padStart(3, '0')}`;
    d.prepare('UPDATE pm_projects SET next_seq = next_seq + 1 WHERE id = ?').run(projectId);
    const ts = nowIso();
    d.prepare(
      `INSERT INTO pm_tasks (id, project_id, title, description, priority, status, stage, provenance, owner, verifier, room_authorization_ref, evidence_refs, depends_on, notes, created_by, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'LIVE', ?, ?, NULL, '[]', ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, title, description, priority, startStatus, startStage, owner, verifier, json(dependsOn), notes, actor, ts, ts, startStatus === 'DONE' ? ts : null);
    logEvent(d, { taskId: id, type: 'CREATED', to: startStatus, actor, detail: { title, priority, owner }, post: false });
    return id;
  });
  return taskDetail(created);
}

function updateTask(id, body) {
  only(body, ['expected_updated_at', 'actor', 'title', 'description', 'priority', 'owner', 'verifier', 'notes', 'depends_on', 'status', 'stage', 'note']);
  const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
  const expected = str(body, 'expected_updated_at', { min: 10, max: 40, required: true });
  const note = str(body, 'note', { max: 1000 });
  const title = str(body, 'title', { min: 3, max: 800 });
  const description = str(body, 'description', { max: 20000 });
  const notes = str(body, 'notes', { max: 8000 });
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority)) throw bad('priority invalid.', ['priority must be P0-P3']);
  if (body.status !== undefined && !STATUSES.includes(body.status)) throw bad('status invalid.', [`status must be one of ${STATUSES.join(', ')}`]);
  if (body.stage !== undefined && !GATED_STAGES.includes(body.stage)) throw bad('stage invalid.', [`stage must be one of ${GATED_STAGES.join(', ')}`]);
  const owner = handleField(body, 'owner', { freeform: true });
  const verifier = handleField(body, 'verifier', { freeform: true });

  tx((d) => {
    const row = getTaskRow(id);
    if (!row) throw new HttpError(404, 'TASK_NOT_FOUND', `Unknown task: ${id}.`);
    if (row.updated_at !== expected) throw new HttpError(409, 'STALE_EDIT', 'Task changed since you loaded it; reload before editing. Nothing was saved.', { current_updated_at: row.updated_at });
    const task = hydrate(row);
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

    // Owner and verifier freeze once the work is being judged, so a failing
    // review cannot be reassigned to a friendlier verifier.
    if (Object.keys(assignment).length && assignmentLocked(task)) {
      throw new HttpError(409, 'ASSIGNMENT_LOCKED',
        `Owner and verifier cannot change once the task is in ${task.stage}.`);
    }
    if (next.owner !== 'UNASSIGNED' && next.owner === next.verifier) {
      throw new HttpError(409, 'DEC_072', 'Owner and verifier must be different identities (DEC-072).');
    }

    const events = [];

    /*
      ONE intent, two ways of expressing it.

      `stage` is an explicit governance move. `status` is a five-column drag,
      which is read as an INTENT and translated into the stage it implies -
      dragging to Done asks for the NEXT gate, never for closure. Either way the
      same adjudication runs, so there is no path to acceptance that skips it.
    */
    let targetStage;
    if (body.stage !== undefined) {
      targetStage = body.stage;
    } else if (body.status !== undefined && body.status !== task.board_column) {
      targetStage = columnDragToStage(task, body.status);
      if (targetStage === null) {
        throw new HttpError(409, 'TRANSITION_NOT_ALLOWED',
          `${task.stage} is terminal; the Done column cannot advance further.`);
      }
    }

    if (targetStage !== undefined && targetStage !== task.stage) {
      const verdict = evaluateStageTransition({
        task: { ...task, owner: next.owner, verifier: next.verifier, depends_on: next.depends_on, evidence_refs: next.evidence_refs, room_authorization_ref: next.room_authorization_ref },
        to: targetStage,
        note,
        project: getProjectRow(task.project_id) ?? { name: task.project_id },
        hold: effectiveHold(getProjectRow(task.project_id) ?? { id: task.project_id }),
        holdBlocks: holdBlocks(effectiveHold(getProjectRow(task.project_id) ?? { id: task.project_id })),
        stageOf: (dep) => getTaskRow(dep)?.stage ?? null,
        enteredAt: (stage) => d.prepare(
          'SELECT timestamp FROM pm_status_log WHERE task_id = ? AND to_status = ? ORDER BY id DESC LIMIT 1',
        ).get(id, stage)?.timestamp ?? null,
      });
      if (!verdict.ok) throw new HttpError(verdict.status, verdict.code, verdict.message, verdict.extra);

      next.prior_stage = nextPriorStage(task, targetStage);
      next.stage = targetStage;
      next.status = stageToColumn(targetStage);
      next.prior_status = next.status === 'BLOCKED'
        ? (task.status === 'BLOCKED' ? task.prior_status : task.status)
        : null;
      next.closed_at = targetStage === 'CLOSED' ? nowIso() : null;
      events.push({
        type: verdict.rejecting ? 'REJECTED' : 'STAGE_CHANGED',
        from: task.stage,
        to: targetStage,
        detail: { note: note ?? null, board_column: next.status, ungated: verdict.ungated === true },
        post: false,
      });
    } else if (body.status !== undefined && body.status !== task.status) {
      // A column correction that implies no stage change (history reshuffling
      // inside one column). Recorded, never gated.
      next.status = body.status;
      events.push({ type: 'STATUS_CHANGED', from: task.status, to: body.status, detail: { note: note ?? null }, post: false });
    }
    if (Object.keys(assignment).length) events.push({ type: 'ASSIGNED', detail: { ...assignment, note: note ?? null }, post: false });
    if (Object.keys(changed).length) events.push({ type: 'FIELDS_UPDATED', detail: changed, post: false });
    if (!events.length) throw bad('Nothing to change.', ['no changes supplied']);

    const ts = nowIso();
    d.prepare(
      `UPDATE pm_tasks SET title = ?, description = ?, priority = ?, status = ?, prior_status = ?, stage = ?, prior_stage = ?, owner = ?, verifier = ?,
         room_authorization_ref = ?, evidence_refs = ?, depends_on = ?, notes = ?, updated_at = ?, closed_at = ? WHERE id = ?`,
    ).run(next.title, next.description, next.priority, next.status, next.prior_status ?? null, next.stage, next.prior_stage ?? null, next.owner, next.verifier,
      next.room_authorization_ref ? json(next.room_authorization_ref) : null, json(next.evidence_refs), json(next.depends_on),
      next.notes, ts, next.closed_at ?? null, id);
    for (const e of events) logEvent(d, { taskId: id, type: e.type, from: e.from ?? null, to: e.to ?? null, actor, detail: e.detail, post: e.post });
  });
  return taskDetail(id);
}

/** Persist repository artifacts as one optimistic, auditable task update. */
export function updateTaskArtifacts(id, body) {
  const fields = ['branch', 'commit_sha', 'pr_ref', 'pr_url'];
  only(body, ['actor', 'expected_updated_at', ...fields]);
  const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
  const expected = str(body, 'expected_updated_at', { min: 10, max: 40, required: true });
  const values = {};
  for (const field of fields) {
    const value = body[field] === null ? null : str(body, field, { max: field === 'branch' ? 255 : field === 'pr_url' ? 500 : 200 });
    if (value === undefined) continue;
    if (field === 'branch' && value !== null && value !== '' && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(value)
      || value.includes('..') || value.includes('@{') || value.endsWith('/') || value.includes('//')
      || value.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock') || part === '@'))) {
      throw bad('branch is not a valid Git branch ref.', ['branch must be a valid Git branch ref']);
    }
    if (field === 'commit_sha' && value !== null && value !== '' && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) {
      throw bad('commit_sha is invalid.', ['commit_sha must be a 40- or 64-character hexadecimal object id']);
    }
    if (field === 'pr_ref' && value !== null && value !== '' && !/^(?:#[1-9][0-9]*|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*)$/.test(value)) {
      throw bad('pr_ref is invalid.', ['pr_ref must be #<number> or owner/repository#<number>']);
    }
    if (field === 'pr_url' && value !== null && value !== '') {
      let url;
      try { url = new URL(value); } catch { throw bad('pr_url is invalid.', ['pr_url must be a GitHub pull request URL']); }
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.search || url.hash
        || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*\/?$/.test(url.pathname) || url.username || url.password) {
        throw bad('pr_url is invalid.', ['pr_url must be an https://github.com/<owner>/<repository>/pull/<number> URL']);
      }
    }
    values[field] = value === '' ? null : value;
  }
  if (!Object.keys(values).length) throw bad('No artifact fields supplied.', ['at least one artifact field is required']);

  tx((d) => {
    const row = getTaskRow(id);
    if (!row) throw new HttpError(404, 'TASK_NOT_FOUND', `Unknown task: ${id}.`);
    if (row.updated_at !== expected) throw new HttpError(409, 'STALE_EDIT', 'Task changed since you loaded it; reload before editing. Nothing was saved.', { current_updated_at: row.updated_at });
    if (row.stage === 'CLOSED') throw new HttpError(409, 'TASK_CLOSED', 'Closed tasks are immutable.');
    const changed = Object.fromEntries(Object.entries(values)
      .filter(([field, value]) => (row[field] ?? null) !== value)
      .map(([field, value]) => [field, { from: row[field] ?? null, to: value }]));
    if (!Object.keys(changed).length) throw bad('No artifact values changed.', ['no changes supplied']);
    const ts = nextTaskUpdatedAt(row.updated_at);
    const assignments = Object.keys(changed).map((field) => `${field} = ?`).join(', ');
    d.prepare(`UPDATE pm_tasks SET ${assignments}, updated_at = ? WHERE id = ?`)
      .run(...Object.keys(changed).map((field) => values[field]), ts, id);
    logEvent(d, { taskId: id, type: 'ARTIFACTS_UPDATED', actor, detail: { artifacts: changed }, post: false });
  });
  return taskDetail(id);
}

export function linkRoom(id, body) {
  only(body, ['actor', 'expected_updated_at', 'sequence', 'eventId', 'purpose', 'kind']);
  const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
  const expected = str(body, 'expected_updated_at', { min: 10, max: 40, required: true });
  const sequence = body.sequence;
  if (!Number.isInteger(sequence) || sequence < 1) throw bad('Room sequence invalid.', ['room sequence must be a positive integer']);
  if (typeof body.eventId !== 'string' || !/^[a-f0-9]{64}$/i.test(body.eventId)) throw bad('Room eventId invalid.', ['eventId must be 64 hex characters']);
  const purpose = str(body, 'purpose', { min: 3, max: 200, required: true });
  const kind = body.kind === undefined ? 'authorization' : body.kind;
  if (!['authorization', 'evidence'].includes(kind)) throw bad('Room ref kind invalid.', ['kind must be authorization or evidence']);
  const ref = parseRoomRef({ sequence, eventId: body.eventId, purpose, kind }, { taskId: id });
  tx((d) => {
    const row = getTaskRow(id);
    if (!row) throw new HttpError(404, 'TASK_NOT_FOUND', `Unknown task: ${id}.`);
    if (row.updated_at !== expected) throw new HttpError(409, 'STALE_EDIT', 'Task changed since you loaded it; reload before editing. Nothing was saved.', { current_updated_at: row.updated_at });
    if (row.stage === 'CLOSED') throw new HttpError(409, 'TASK_CLOSED', 'Closed tasks are immutable.');
    const task = hydrate(row);
    let detail;
    let type;
    if (kind === 'authorization') {
      if (JSON.stringify(task.room_authorization_ref) === JSON.stringify(ref)) throw bad('Room authorization is already linked.', ['no changes supplied']);
      d.prepare('UPDATE pm_tasks SET room_authorization_ref = ?, updated_at = ? WHERE id = ?').run(json(ref), nextTaskUpdatedAt(row.updated_at), id);
      type = 'ROOM_AUTHORIZATION_LINKED';
      detail = { room_ref: ref };
    } else {
      const nextRefs = [...task.evidence_refs, ref];
      d.prepare('UPDATE pm_tasks SET evidence_refs = ?, updated_at = ? WHERE id = ?').run(json(nextRefs), nextTaskUpdatedAt(row.updated_at), id);
      type = 'ROOM_EVIDENCE_LINKED';
      detail = { room_ref: ref };
    }
    logEvent(d, { taskId: id, type, actor, detail, post: false });
  });
  return taskDetail(id);
}

function addLocalEvidence(id, body) {
  only(body, ['actor', 'expected_updated_at', 'note']);
  if (ROOM_POST) {
    throw new HttpError(409, 'ROOM_POST_ON', 'Room posting is ON; link a verified Room record instead of local evidence.');
  }
  const actor = handleField(body, 'actor', { required: true, allowUnassigned: false });
  const expected = str(body, 'expected_updated_at', { min: 10, max: 40, required: true });
  const note = str(body, 'note', { min: 5, max: 1000, required: true });
  tx((d) => {
    const row = getTaskRow(id);
    if (!row) throw new HttpError(404, 'TASK_NOT_FOUND', `Unknown task: ${id}.`);
    if (row.updated_at !== expected) throw new HttpError(409, 'STALE_EDIT', 'Task changed since you loaded it; reload before editing. Nothing was saved.', { current_updated_at: row.updated_at });
    if (row.status === 'CLOSED') throw new HttpError(409, 'TASK_CLOSED', 'Closed tasks are immutable.');
    const task = hydrate(row);
    const ev = localLedgerRef({ actor, purpose: note, kind: 'evidence', taskId: id });
    const nextRefs = [...task.evidence_refs, ev];
    const ts = nextTaskUpdatedAt(row.updated_at);
    d.prepare('UPDATE pm_tasks SET evidence_refs = ?, updated_at = ? WHERE id = ?').run(json(nextRefs), ts, id);
    logEvent(d, { taskId: id, type: 'LOCAL_EVIDENCE', actor, detail: { room_ref: ev, note }, post: false });
  });
  return taskDetail(id);
}

function mapOrgError(e) {
  const code = e.code || 'VALIDATION';
  const status = code.endsWith('NOT_FOUND') ? 404 : code.endsWith('EXISTS') || code === 'POSITION_OCCUPIED' ? 409 : 400;
  throw new HttpError(status, code, e.message);
}

function orgWrite(fn) {
  try {
    return tx((d) => fn(d));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    mapOrgError(e);
  }
}

function createProject(body) {
  only(body, ['actor', 'id', 'name', 'prefix', 'description']);
  handleField(body, 'actor', { required: true, allowUnassigned: false });
  const id = str(body, 'id', { min: 2, max: 40, required: true }).toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) throw bad('Project id invalid.', ['id must be lowercase letters, digits and hyphen']);
  const name = str(body, 'name', { min: 2, max: 80, required: true });
  const prefix = str(body, 'prefix', { min: 2, max: 4, required: true }).toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(prefix)) throw bad('prefix invalid.', ['prefix must be 2-4 letters']);
  const description = str(body, 'description', { max: 400 }) ?? '';
  return tx((d) => {
    if (getProjectRow(id)) throw new HttpError(409, 'PROJECT_EXISTS', `Project already exists: ${id}.`);
    if (d.prepare('SELECT id FROM pm_projects WHERE prefix = ?').get(prefix)) {
      throw new HttpError(409, 'PREFIX_EXISTS', `Prefix already in use: ${prefix}.`);
    }
    d.prepare(
      'INSERT INTO pm_projects (id, name, prefix, description, hold_state, source_gap, next_seq, created_at) VALUES (?, ?, ?, ?, NULL, NULL, 1, ?)',
    ).run(id, name, prefix, description, nowIso());
    return { ...getProjectRow(id), hold: effectiveHold(getProjectRow(id)) };
  });
}

function attention() {
  const tasks = listTasks(null).filter((t) => t.status !== 'DONE');
  const href = (t) => {
    const routes = { command: '#studio/command', erp: '#studio/erp/tasks', hoadha: '#studio/hoadha/board' };
    return `${routes[t.project_id] ?? `#studio/${t.project_id}`}?task=${encodeURIComponent(t.id)}`;
  };
  const reason = (t) => {
    if (t.status === 'BLOCKED') return 'blocked';
    if (t.owner === 'UNASSIGNED') return 'unassigned';
    if (t.status === 'IN_PROGRESS') return 'in_progress';
    if (t.status === 'NEXT') return 'next';
    return 'open';
  };
  const ranked = [...tasks].sort((a, b) => {
    const rank = { BLOCKED: 0, IN_PROGRESS: 1, NEXT: 2, TODO: 3 };
    return (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
  });
  return {
    generated_at: nowIso(),
    room_post: ROOM_POST ? 'ON' : 'OFF',
    next_actions: ranked.slice(0, 12).map((t) => ({
      task_id: t.id,
      project_id: t.project_id,
      title: t.title,
      status: t.status,
      owner: t.owner,
      verifier: t.verifier,
      priority: t.priority,
      reason: reason(t),
      href: href(t),
    })),
    blocked: tasks.filter((t) => t.status === 'BLOCKED').length,
    founder_gate: tasks.filter((t) => t.stage === 'FOUNDER_GATE').length,
    unassigned: tasks.filter((t) => t.owner === 'UNASSIGNED').length,
    in_progress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
  };
}

export function taskDetail(id) {
  const row = getTaskRow(id);
  if (!row) throw new HttpError(404, 'TASK_NOT_FOUND', `Unknown task: ${id}.`);
  const d = requireDb();
  const history = d.prepare('SELECT * FROM pm_status_log WHERE task_id = ? ORDER BY id DESC').all(id).map((h) => ({
    ...h, detail: JSON.parse(h.detail), room_ref: h.room_ref ? JSON.parse(h.room_ref) : null,
  }));
  const pending = history.filter((h) => h.room_sync === 'PENDING').length;
  const project = getProjectRow(row.project_id);
  const source = d.prepare(
    `SELECT r.source_system, r.source_file, r.source_row_index, r.resolution, r.raw_status, r.payload_sha256,
            r.raw_payload, s.content_sha256 AS source_file_sha256
       FROM pm_source_records r JOIN pm_import_sources s ON s.source_file = r.source_file
      WHERE r.task_id = ? AND r.resolution = 'IMPORTED' ORDER BY r.source_file, r.source_row_index LIMIT 1`,
  ).get(id);
  const source_record = source ? {
    source_system: source.source_system,
    source_file: source.source_file,
    source_row_index: source.source_row_index,
    resolution: source.resolution,
    raw_status: source.raw_status,
    payload_sha256: source.payload_sha256,
    source_file_sha256: source.source_file_sha256,
    raw_payload: JSON.parse(source.raw_payload),
  } : null;
  return { task: hydrate(row, pending), history, hold: effectiveHold(project), source_record };
}

function nexusSources(file = null) {
  const d = requireDb();
  const sources = d.prepare(
    `SELECT s.source_file, s.source_system, s.content_sha256, s.row_count, s.imported_at,
            COUNT(r.source_key) AS preserved_rows,
            COALESCE(SUM(CASE WHEN r.resolution = 'DUPLICATE_TASK_ID' THEN 1 ELSE 0 END), 0) AS duplicate_rows,
            COALESCE(SUM(CASE WHEN r.resolution = 'INVALID_ID' THEN 1 ELSE 0 END), 0) AS invalid_rows,
            COALESCE(SUM(CASE WHEN r.resolution = 'ARCHIVED_ID_COLLISION' THEN 1 ELSE 0 END), 0) AS archived_rows
       FROM pm_import_sources s LEFT JOIN pm_source_records r ON r.source_file = s.source_file
      GROUP BY s.source_file ORDER BY s.source_file`,
  ).all();
  if (!file) return { sources };
  const known = sources.find((s) => s.source_file === file);
  if (!known) throw new HttpError(404, 'SOURCE_NOT_FOUND', `No imported Nexus source file: ${file}.`);
  const records = d.prepare(
    `SELECT source_row_index, task_id, resolution, raw_status, payload_sha256, raw_payload
       FROM pm_source_records WHERE source_file = ? ORDER BY source_row_index`,
  ).all(file).map((r) => ({ ...r, raw_payload: JSON.parse(r.raw_payload) }));
  return { sources, records };
}

export function listProjects() {
  return requireDb().prepare('SELECT * FROM pm_projects ORDER BY rowid').all().map((p) => ({ ...p, hold: effectiveHold(p) }));
}

export function listTasks(projectId) {
  const d = requireDb();
  const pend = pendingCounts();
  const rows = projectId
    ? d.prepare('SELECT * FROM pm_tasks WHERE project_id = ? ORDER BY id').all(projectId)
    : d.prepare('SELECT * FROM pm_tasks ORDER BY id').all();
  return rows.map((r) => hydrate(r, pend.get(r.id) ?? 0));
}

export function executionQualifier(project) {
  if (project.hold?.state === 'ON_HOLD') return 'ON_HOLD';
  if (project.id === 'erp') return project.hold?.state === 'ACTIVE' ? 'ACTIVE' : 'CP2_HOLD';
  if (['portal', 'pos', 'starqbooks'].includes(project.id)) return 'HISTORICAL';
  if (['hoadha', 'hoadha-social', 'hoadha-concierge'].includes(project.id)) return 'PRE_ACTIVATION';
  if (['academy', 'pay'].includes(project.id)) return 'FORMATION';
  if (project.id === 'buzzlab') return 'SANDBOX';
  if (['antrac-erp', 'orgsync', 'biography'].includes(project.id)) return 'PERSONAL';
  if (['foundation', 'founder-decisions'].includes(project.id)) return 'GOVERNANCE';
  return 'ACTIVE';
}

export function readRoadmapsData() {
  let contract = null;
  if (ROOT) {
    try {
      contract = JSON.parse(fs.readFileSync(abs(ROOT, `${CANONICAL.controlBoard}/contract.json`), 'utf8'));
    } catch {
      contract = null;
    }
  }

  let planGenerations = [];
  try {
    const pGenPath = path.resolve(fileURLToPath(new URL('../data/erp-plan-generations.json', import.meta.url)));
    if (fs.existsSync(pGenPath)) planGenerations = JSON.parse(fs.readFileSync(pGenPath, 'utf8'));
  } catch { planGenerations = []; }

  let phaseLabelMap = [];
  try {
    const pMapPath = path.resolve(fileURLToPath(new URL('../data/erp-phase-label-map.json', import.meta.url)));
    if (fs.existsSync(pMapPath)) phaseLabelMap = JSON.parse(fs.readFileSync(pMapPath, 'utf8'));
  } catch { phaseLabelMap = []; }

  let stageBindings = {};
  try {
    const bPath = path.resolve(fileURLToPath(new URL('../data/erp-stage-bindings.json', import.meta.url)));
    if (fs.existsSync(bPath)) stageBindings = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  } catch { stageBindings = {}; }

  const familiesList = Array.isArray(contract?.process_families)
    ? contract.process_families
    : Object.values(contract?.process_families ?? {});
  const gaps = contract?.convergence_gaps ?? [];
  const chains = familiesList.map((v, idx) => {
    const familyKey = v.id ?? String(idx);
    return {
      id: familyKey,
      name: v.name ?? `Chain ${familyKey}`,
      description: v.description ?? '',
      target_maturity: v.target_maturity ?? '',
      stages: (v.stages ?? []).map((st) => {
        const bound = stageBindings[`${familyKey}/${st.stage ?? st.name}`] ?? (st.serp ?? []);
        return {
          ...st,
          name: st.stage ?? st.name,
          bound_cards: bound,
          bound_status: bound.length > 0 ? 'BOUND' : 'NO CARDS BOUND',
        };
      }),
      stage_count: (v.stages ?? []).length,
    };
  });
  const totalStages = chains.reduce((acc, c) => acc + c.stage_count, 0);

  const d = requireDb();
  const milestones = d.prepare(`
    SELECT project_id, milestone, COUNT(*) AS task_count,
           SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) AS done_count,
           SUM(CASE WHEN status != 'DONE' THEN 1 ELSE 0 END) AS open_count
      FROM pm_tasks
     WHERE milestone IS NOT NULL AND TRIM(milestone) != ''
     GROUP BY project_id, milestone
     ORDER BY project_id, milestone
  `).all();

  const maturity = readCanonicalWorkModelMaturity();

  return {
    generated_at: nowIso(),
    authority: 'starqerp-control-board/contract.json (5 chains, 49 stages, 8 gaps) · live PM milestones · M-1/M-3/M-5 plan generations & bindings',
    chains,
    chains_count: chains.length,
    stages_count: totalStages,
    gaps,
    gaps_count: gaps.length,
    milestones,
    plan_generations: planGenerations,
    current_approved_plan: planGenerations.find((g) => g.is_current) ?? null,
    phase_label_map: phaseLabelMap,
    stage_bindings: stageBindings,
    process_families: familiesList,
    convergence_gaps: gaps,
    maturity,
  };
}

export function portfolio() {
  const projects = listProjects();
  const tasks = listTasks(null);
  const syncRow = requireDb().prepare("SELECT COUNT(*) AS n FROM pm_status_log WHERE room_sync = 'PENDING'").get();
  const canonicalMaturity = readCanonicalWorkModelMaturity();
  return {
    generated_at: nowIso(),
    pending_room_sync: Number(syncRow.n),
    statuses: STATUSES,
    stages: GATED_STAGES,
    projects: projects.map((p) => {
      const mine = tasks.filter((t) => t.project_id === p.id);
      const counts = Object.fromEntries(STATUSES.map((s) => [s, mine.filter((t) => t.status === s).length]));
      const stages = Object.fromEntries(GATED_STAGES.map((s) => [s, mine.filter((t) => t.stage === s).length]));
      const provenance = {
        HISTORICAL_NEXUS: mine.filter((t) => t.provenance === PROVENANCE.HISTORICAL).length,
        LIVE: mine.filter((t) => t.provenance === PROVENANCE.LIVE).length,
      };
      const done = mine.filter((t) => t.status === 'DONE').length;
      const done_historical = mine.filter((t) => t.status === 'DONE' && t.provenance === PROVENANCE.HISTORICAL).length;
      const withCommit = mine.filter((t) => t.status === 'DONE' && (t.commit_sha || t.commit)).length;
      const withAcceptance = mine.filter((t) => t.status === 'DONE' && (t.acceptance_json || t.accepted_at)).length;
      const capability = p.id === 'erp'
        ? (canonicalMaturity?.L4 ? {
            implemented: 7,
            total: 49,
            percent: Math.round(Number(canonicalMaturity.L4.maturity ?? 0) * 100),
            l4_maturity: canonicalMaturity.L4,
            l3_families: canonicalMaturity.L3,
          } : { implemented: 7, total: 49, percent: 14 })
        : null;
      const metrics = {
        claimed: { done, total: mine.length, percent: mine.length > 0 ? Math.round((done / mine.length) * 100) : 0 },
        committed: { count: withCommit, total: done, percent: done > 0 ? Math.round((withCommit / done) * 100) : 0 },
        proven: { count: withAcceptance, total: done, percent: done > 0 ? Math.round((withAcceptance / done) * 100) : 0 },
        capability,
      };
      const eq = executionQualifier(p);
      return {
        id: p.id,
        name: p.name,
        prefix: p.prefix,
        hold: p.hold,
        source_gap: p.source_gap,
        total: mine.length,
        done_historical,
        open: mine.filter((t) => t.status !== 'DONE').length,
        counts,
        stages,
        provenance,
        metrics,
        execution_qualifier: eq,
        founder_gate: stages.FOUNDER_GATE ?? 0,
        blocked: counts.BLOCKED,
        pending_room_sync: mine.reduce((n, t) => n + t.pending_room_sync, 0),
        unassigned: mine.filter((t) => t.status !== 'DONE' && t.owner === 'UNASSIGNED').length,
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

/**
 * Repository sync facts for `GET /api/pm/repositories/status`.
 *
 * Answers from the cached snapshot; the first call starts a background
 * refresh. Nothing here touches Git while the request is being served, so the
 * route cannot stall the server behind a slow checkout.
 */
export function repositoryStatusPayload() {
  REPOSITORY_STATUS.ensureRefresh();
  return REPOSITORY_STATUS.snapshot();
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
    if (req.method === 'GET' && p === '/api/pm/nexus/sources') {
      return send(res, 200, nexusSources(url.searchParams.get('file') || null), origin);
    }
    if (req.method === 'GET' && p === '/api/pm/meta') {
      return send(res, 200, {
        statuses: STATUSES,
        stages: GATED_STAGES,
        lifecycle: {
          authority: 'Founder D1 2026-10-28',
          governance_axis: 'stage',
          view_axis: 'board_column (derived from stage)',
          gated_provenance: 'LIVE',
          ungated_provenance: PROVENANCE.HISTORICAL,
        },
        priorities: PRIORITIES,
        forward: FORWARD,
        handles: [...knownHandles()].sort(),
      }, origin);
    }
    if (req.method === 'GET' && p === '/api/pm/projects') return send(res, 200, { projects: listProjects() }, origin);
    if (req.method === 'POST' && p === '/api/pm/projects') return send(res, 201, createProject(await readBody(req)), origin);
    if (req.method === 'GET' && p === '/api/pm/portfolio') return send(res, 200, portfolio(), origin);
    if (req.method === 'GET' && p === '/api/pm/roadmaps') return send(res, 200, readRoadmapsData(), origin);
    if (req.method === 'GET' && p === '/api/pm/repositories/status') return send(res, 200, repositoryStatusPayload(), origin);
    if (req.method === 'GET' && p === '/api/pm/org') return send(res, 200, readOrg(requireDb(), { generatedAt: nowIso(), roomPost: ROOM_POST ? 'ON' : 'OFF' }), origin);
    if (req.method === 'GET' && p === '/api/pm/attention') return send(res, 200, attention(), origin);
    if (req.method === 'POST' && p === '/api/pm/org/companies') {
      const body = await readBody(req);
      only(body, ['actor', 'name', 'legal_name', 'notes']);
      handleField(body, 'actor', { required: true, allowUnassigned: false });
      return send(res, 201, orgWrite((d) => orgCreateCompany(d, {
        name: str(body, 'name', { min: 2, max: 80, required: true }),
        legal_name: str(body, 'legal_name', { max: 120 }),
        notes: str(body, 'notes', { max: 400 }),
        nowIso,
      })), origin);
    }
    if (req.method === 'POST' && p === '/api/pm/org/units') {
      const body = await readBody(req);
      only(body, ['actor', 'company_id', 'parent_id', 'kind', 'name', 'description']);
      handleField(body, 'actor', { required: true, allowUnassigned: false });
      return send(res, 201, orgWrite((d) => orgCreateUnit(d, {
        company_id: str(body, 'company_id', { min: 2, max: 64, required: true }),
        parent_id: str(body, 'parent_id', { max: 64 }),
        kind: str(body, 'kind', { min: 4, max: 20, required: true }),
        name: str(body, 'name', { min: 2, max: 80, required: true }),
        description: str(body, 'description', { max: 400 }),
        nowIso,
      })), origin);
    }
    if (req.method === 'POST' && p === '/api/pm/org/positions') {
      const body = await readBody(req);
      only(body, ['actor', 'unit_id', 'title', 'job_description', 'reports_to_position_id']);
      handleField(body, 'actor', { required: true, allowUnassigned: false });
      return send(res, 201, orgWrite((d) => orgCreatePosition(d, {
        unit_id: str(body, 'unit_id', { min: 2, max: 64, required: true }),
        title: str(body, 'title', { min: 2, max: 80, required: true }),
        job_description: str(body, 'job_description', { max: 400 }),
        reports_to_position_id: str(body, 'reports_to_position_id', { max: 64 }),
        nowIso,
      })), origin);
    }
    if (req.method === 'POST' && p === '/api/pm/org/people') {
      const body = await readBody(req);
      only(body, ['actor', 'handle', 'display_name', 'kind']);
      handleField(body, 'actor', { required: true, allowUnassigned: false });
      return send(res, 201, orgWrite((d) => orgCreatePerson(d, {
        handle: str(body, 'handle', { min: 2, max: 40, required: true }),
        display_name: str(body, 'display_name', { min: 2, max: 80, required: true }),
        kind: str(body, 'kind', { min: 5, max: 10, required: true }),
        nowIso,
      })), origin);
    }
    if (req.method === 'POST' && p === '/api/pm/org/appointments') {
      const body = await readBody(req);
      only(body, ['actor', 'position_id', 'person_id']);
      handleField(body, 'actor', { required: true, allowUnassigned: false });
      return send(res, 201, orgWrite((d) => orgCreateAppointment(d, {
        position_id: str(body, 'position_id', { min: 2, max: 64, required: true }),
        person_id: str(body, 'person_id', { min: 2, max: 64, required: true }),
        nowIso,
      })), origin);
    }
    if (req.method === 'GET' && p === '/api/pm/export') return send(res, 200, exportAll(), origin);
    if (req.method === 'GET' && p === '/api/pm/tasks') {
      const pid = url.searchParams.get('project_id');
      if (pid && !getProjectRow(pid)) throw new HttpError(404, 'PROJECT_NOT_FOUND', `Unknown project: ${pid}.`);
      return send(res, 200, { project_id: pid, tasks: listTasks(pid || null) }, origin);
    }
    let m = /^\/api\/pm\/tasks\/([A-Za-z0-9._:-]{2,40})$/.exec(p);
    if (m && req.method === 'GET') return send(res, 200, taskDetail(decodeURIComponent(m[1])), origin);
    if (m && req.method === 'PATCH') return send(res, 200, updateTask(decodeURIComponent(m[1]), await readBody(req)), origin);
    m = /^\/api\/pm\/tasks\/([A-Za-z0-9._:-]{2,40})\/room-link$/.exec(p);
    if (m && req.method === 'POST') return send(res, 200, linkRoom(decodeURIComponent(m[1]), await readBody(req)), origin);
    m = /^\/api\/pm\/tasks\/([A-Za-z0-9._:-]{2,40})\/evidence$/.exec(p);
    if (m && req.method === 'POST') return send(res, 200, addLocalEvidence(decodeURIComponent(m[1]), await readBody(req)), origin);
    m = /^\/api\/pm\/tasks\/([A-Za-z0-9._:-]{2,40})\/artifacts$/.exec(p);
    if (m && req.method === 'POST') return send(res, 200, updateTaskArtifacts(decodeURIComponent(m[1]), await readBody(req)), origin);
    if (req.method === 'POST' && p === '/api/pm/tasks') return send(res, 201, createTask(await readBody(req)), origin);
    if (req.method === 'POST' && p === '/api/pm/room-sync/retry') {
      await readBody(req);
      requireDb();
      enqueueRoomSync();
      return send(res, 202, { queued: true, pending_room_sync: health().pending_room_sync }, origin);
    }
    if (req.method === 'POST' && p === '/api/pm/comms/send') {
      const body = await readBody(req);
      only(body, ['from', 'body', 'channel', 'reply_to', 'subject', 'action_required', 'task_id']);
      const result = await postCommsMessage({
        from: str(body, 'from', { min: 2, max: 40, required: true }),
        body: str(body, 'body', { min: 1, max: 7800, required: true }),
        channel: str(body, 'channel', { max: 80 }),
        replyTo: str(body, 'reply_to', { max: 80 }),
        subject: str(body, 'subject', { max: 120 }),
        actionRequired: str(body, 'action_required', { max: 300 }),
        taskId: str(body, 'task_id', { max: 40 }),
      });
      return send(res, 201, { posted: true, ...result }, origin);
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
  const target = file ? path.resolve(file) : (resolveDbPath() || path.resolve('data/pm-operating.db'));
  const handle = new DatabaseSync(target, { readOnly: true });
  const check = integrity(handle);
  const n = (t) => Number(handle.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  console.log(json({ file: target, integrity: check.detail, projects: n('pm_projects'), tasks: n('pm_tasks'), history_rows: n('pm_status_log') }));
  handle.close();
  process.exit(check.ok ? 0 : 3);
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isDirectRun) {
  const argv = process.argv.slice(2);
  if (argv.includes('--backup')) cliBackup();
  else if (argv.includes('--verify')) cliVerify(argv[argv.indexOf('--verify') + 1]);
  else {
    if (ROOM_POST) requireExplicitRoomWriter();
    startDatabase();
    server = http.createServer((req, res) => { void handle(req, res); });
    server.listen(PORT, HOST, () => {
      console.log(json({ service: 'starq-command-pm', listening: `${HOST}:${PORT}`, db_state: dbState.state, db: dbState.path, room_post: ROOM_POST ? 'ON' : 'OFF', reason: dbState.reason }));
      setTimeout(enqueueRoomSync, 3000);
    });
    const shutdown = () => { server.close(); try { db?.close(); } catch { /* ignore */ } process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}
