/**
 * Writable operating organization stored beside PM tasks.
 *
 * Canonical seats remain company-seats.json / Company OS Structure+Seats.
 * This module is the Founder-editable company graph used for appointments
 * and management work. It never writes Nexus JSON or company-os.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STAFF_PROFILE } from './staff-profile.mjs';

const UNIT_KINDS = new Set(['COMPANY', 'DIVISION', 'DEPARTMENT', 'TEAM', 'OFFICE']);
const PERSON_KINDS = new Set(['HUMAN', 'DIGITAL']);
const PERSON_STATUSES = new Set(['active', 'inactive']);
const CHANNELS = new Set(['ui', 'api', 'automation']);

function ensureColumn(handle, table, col, def) {
  const existing = new Set(
    handle.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name),
  );
  if (!existing.has(col)) {
    handle.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

function migrateOrgUnitsCheckIfNeeded(handle) {
  const row = handle.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'org_units'",
  ).get();
  if (!row || !row.sql || row.sql.includes("'OFFICE'")) return;
  handle.exec('PRAGMA foreign_keys = OFF');
  try {
    handle.exec('DROP TRIGGER IF EXISTS org_units_no_delete');
    handle.exec('ALTER TABLE org_units RENAME TO org_units_legacy');
    handle.exec(`
      CREATE TABLE org_units (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES org_companies(id),
        parent_id TEXT REFERENCES org_units(id),
        kind TEXT NOT NULL CHECK (kind IN ('COMPANY','DIVISION','DEPARTMENT','TEAM','OFFICE')),
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        archived_at TEXT
      );
    `);
    const cols = new Set(
      handle.prepare("SELECT name FROM pragma_table_info('org_units_legacy')").all().map((r) => r.name),
    );
    const updatedExpr = cols.has('updated_at') ? 'updated_at' : 'created_at';
    const archivedExpr = cols.has('archived_at') ? 'archived_at' : 'NULL';
    handle.exec(`
      INSERT INTO org_units (id, company_id, parent_id, kind, name, description, created_at, updated_at, archived_at)
      SELECT id, company_id, parent_id, kind, name, description, created_at, ${updatedExpr}, ${archivedExpr}
      FROM org_units_legacy;
    `);
    handle.exec('DROP TABLE org_units_legacy');
    handle.exec(`
      CREATE TRIGGER IF NOT EXISTS org_units_no_delete BEFORE DELETE ON org_units
        BEGIN SELECT RAISE(ABORT, 'units are never deleted'); END;
    `);
    // If org_positions had a foreign key rewritten to org_units_legacy by SQLite RENAME, fix it:
    const posRow = handle.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'org_positions'",
    ).get();
    if (posRow?.sql?.includes('org_units_legacy')) {
      const posCols = new Set(
        handle.prepare("SELECT name FROM pragma_table_info('org_positions')").all().map((r) => r.name),
      );
      const posUpdatedExpr = posCols.has('updated_at') ? 'updated_at' : 'created_at';
      const posArchivedExpr = posCols.has('archived_at') ? 'archived_at' : 'NULL';
      handle.exec('DROP TRIGGER IF EXISTS org_positions_no_delete');
      handle.exec('ALTER TABLE org_positions RENAME TO org_positions_legacy');
      handle.exec(`
        CREATE TABLE org_positions (
          id TEXT PRIMARY KEY,
          unit_id TEXT NOT NULL REFERENCES org_units(id),
          title TEXT NOT NULL,
          job_description TEXT,
          reports_to_position_id TEXT REFERENCES org_positions(id),
          created_at TEXT NOT NULL,
          updated_at TEXT,
          archived_at TEXT
        );
        INSERT INTO org_positions (id, unit_id, title, job_description, reports_to_position_id, created_at, updated_at, archived_at)
        SELECT id, unit_id, title, job_description, reports_to_position_id, created_at, ${posUpdatedExpr}, ${posArchivedExpr}
        FROM org_positions_legacy;
        DROP TABLE org_positions_legacy;
        CREATE TRIGGER IF NOT EXISTS org_positions_no_delete BEFORE DELETE ON org_positions
          BEGIN SELECT RAISE(ABORT, 'positions are never deleted'); END;
      `);
      const apptRow = handle.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'org_appointments'",
      ).get();
      if (apptRow?.sql?.includes('org_positions_legacy')) {
        const apptCols = new Set(
          handle.prepare("SELECT name FROM pragma_table_info('org_appointments')").all().map((r) => r.name),
        );
        const notesExpr = apptCols.has('notes') ? 'notes' : 'NULL';
        handle.exec('DROP TRIGGER IF EXISTS org_appointments_no_delete');
        handle.exec('ALTER TABLE org_appointments RENAME TO org_appointments_legacy');
        handle.exec(`
          CREATE TABLE org_appointments (
            id TEXT PRIMARY KEY,
            position_id TEXT NOT NULL REFERENCES org_positions(id),
            person_id TEXT NOT NULL REFERENCES org_people(id),
            status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')),
            appointed_at TEXT NOT NULL,
            ended_at TEXT,
            notes TEXT
          );
          INSERT INTO org_appointments (id, position_id, person_id, status, appointed_at, ended_at, notes)
          SELECT id, position_id, person_id, status, appointed_at, ended_at, ${notesExpr}
          FROM org_appointments_legacy;
          DROP TABLE org_appointments_legacy;
          CREATE TRIGGER IF NOT EXISTS org_appointments_no_delete BEFORE DELETE ON org_appointments
            BEGIN SELECT RAISE(ABORT, 'appointments are never deleted; end them'); END;
        `);
      }
    }
  } finally {
    handle.exec('PRAGMA foreign_keys = ON');
  }
}

export function initOrgSchema(handle) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS org_companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      legal_name TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS org_units (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES org_companies(id),
      parent_id TEXT REFERENCES org_units(id),
      kind TEXT NOT NULL CHECK (kind IN ('COMPANY','DIVISION','DEPARTMENT','TEAM','OFFICE')),
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS org_positions (
      id TEXT PRIMARY KEY,
      unit_id TEXT NOT NULL REFERENCES org_units(id),
      title TEXT NOT NULL,
      job_description TEXT,
      reports_to_position_id TEXT REFERENCES org_positions(id),
      created_at TEXT NOT NULL,
      updated_at TEXT,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS org_people (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('HUMAN','DIGITAL')),
      created_at TEXT NOT NULL,
      updated_at TEXT,
      archived_at TEXT,
      role_note TEXT,
      harness TEXT,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'manual',
      room_handle TEXT
    );
    CREATE TABLE IF NOT EXISTS org_appointments (
      id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL REFERENCES org_positions(id),
      person_id TEXT NOT NULL REFERENCES org_people(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')),
      appointed_at TEXT NOT NULL,
      ended_at TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS org_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'api' CHECK (channel IN ('ui','api','automation')),
      before_json TEXT,
      after_json TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_org_audit_entity ON org_audit(entity, entity_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_org_audit_actor ON org_audit(actor, id DESC);
    CREATE TRIGGER IF NOT EXISTS org_companies_no_delete BEFORE DELETE ON org_companies
      BEGIN SELECT RAISE(ABORT, 'companies are never deleted'); END;
    CREATE TRIGGER IF NOT EXISTS org_units_no_delete BEFORE DELETE ON org_units
      BEGIN SELECT RAISE(ABORT, 'units are never deleted'); END;
    CREATE TRIGGER IF NOT EXISTS org_positions_no_delete BEFORE DELETE ON org_positions
      BEGIN SELECT RAISE(ABORT, 'positions are never deleted'); END;
    CREATE TRIGGER IF NOT EXISTS org_people_no_delete BEFORE DELETE ON org_people
      BEGIN SELECT RAISE(ABORT, 'people are never deleted'); END;
    CREATE TRIGGER IF NOT EXISTS org_appointments_no_delete BEFORE DELETE ON org_appointments
      BEGIN SELECT RAISE(ABORT, 'appointments are never deleted; end them'); END;
    CREATE TRIGGER IF NOT EXISTS org_audit_no_delete BEFORE DELETE ON org_audit
      BEGIN SELECT RAISE(ABORT, 'org_audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS org_audit_no_update BEFORE UPDATE ON org_audit
      BEGIN SELECT RAISE(ABORT, 'org_audit is append-only'); END;
  `);

  migrateOrgUnitsCheckIfNeeded(handle);
  ensureColumn(handle, 'org_units', 'updated_at', 'TEXT');
  ensureColumn(handle, 'org_units', 'archived_at', 'TEXT');
  ensureColumn(handle, 'org_positions', 'updated_at', 'TEXT');
  ensureColumn(handle, 'org_positions', 'archived_at', 'TEXT');
  ensureColumn(handle, 'org_people', 'updated_at', 'TEXT');
  ensureColumn(handle, 'org_people', 'archived_at', 'TEXT');
  ensureColumn(handle, 'org_people', 'role_note', 'TEXT');
  ensureColumn(handle, 'org_people', 'harness', 'TEXT');
  ensureColumn(handle, 'org_people', 'capabilities_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(handle, 'org_people', 'status', "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(handle, 'org_people', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn(handle, 'org_people', 'room_handle', 'TEXT');
  ensureColumn(handle, 'org_appointments', 'notes', 'TEXT');
  ensureColumn(handle, 'org_companies', 'archived_at', 'TEXT');
}

function slug(prefix, name, extra = '') {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'item';
  const id = extra ? `${prefix}-${base}-${extra}` : `${prefix}-${base}`;
  return id.slice(0, 64);
}

function rowOrNull(handle, sql, ...args) {
  return handle.prepare(sql).get(...args) ?? null;
}

function countRows(handle, sql, ...args) {
  return Number(handle.prepare(sql).get(...args)?.n ?? 0);
}

function refuseDependents(count, message) {
  if (count > 0) {
    throw Object.assign(new Error(message), { code: 'HAS_DEPENDENTS' });
  }
}

function normalizeChannel(channel) {
  const c = typeof channel === 'string' ? channel.trim().toLowerCase() : 'api';
  return CHANNELS.has(c) ? c : 'api';
}

export function recordOrgAudit(handle, {
  entity,
  entity_id,
  action,
  actor = 'system',
  channel = 'api',
  before = null,
  after = null,
  nowIso = () => new Date().toISOString(),
}) {
  const ts = typeof nowIso === 'function' ? nowIso() : String(nowIso);
  const info = handle.prepare(
    `INSERT INTO org_audit (entity, entity_id, action, actor, channel, before_json, after_json, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    String(entity),
    String(entity_id),
    String(action),
    String(actor || 'system'),
    normalizeChannel(channel),
    before === null || before === undefined ? null : JSON.stringify(before),
    after === null || after === undefined ? null : JSON.stringify(after),
    ts,
  );
  return Number(info.lastInsertRowid);
}

export function hydratePerson(row) {
  if (!row) return null;
  let capabilities = [];
  try {
    const parsed = JSON.parse(row.capabilities_json || '[]');
    if (Array.isArray(parsed)) {
      capabilities = parsed.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
    }
  } catch {
    capabilities = [];
  }
  return {
    ...row,
    role_note: row.role_note ?? null,
    harness: row.harness ?? null,
    capabilities_json: row.capabilities_json ?? '[]',
    capabilities,
    status: row.status ?? 'active',
    source: row.source ?? 'manual',
    room_handle: row.room_handle ?? null,
    updated_at: row.updated_at ?? row.created_at ?? null,
    archived_at: row.archived_at ?? null,
  };
}

export function orgPeopleHandles(handle) {
  try {
    return handle.prepare('SELECT handle FROM org_people WHERE archived_at IS NULL').all().map((r) => r.handle);
  } catch {
    try {
      return handle.prepare('SELECT handle FROM org_people').all().map((r) => r.handle);
    } catch {
      return [];
    }
  }
}

export function seedOperatingOrg(handle, nowIso) {
  const existing = handle.prepare('SELECT COUNT(*) AS n FROM org_companies').get();
  if (Number(existing.n) > 0) return;
  const ts = nowIso();
  handle.prepare(
    'INSERT INTO org_companies (id, name, legal_name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    'starq-technologies',
    'Starq Technologies',
    'Starq Technologies Pvt. Ltd.',
    'First real operating company. Canonical seats remain Company OS Structure/Seats; this row is the writable operating org.',
    ts,
    ts,
  );
  const insUnit = handle.prepare(
    'INSERT INTO org_units (id, company_id, parent_id, kind, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  insUnit.run('starq-corporate', 'starq-technologies', null, 'DIVISION', 'Corporate', 'Founder office, governance, and company administration.', ts, ts);
  insUnit.run('starq-dev-studio', 'starq-technologies', null, 'DEPARTMENT', 'Development Studio', 'Engineering factory. Not a product; builds Command, ERP, Hoadhaa.', ts, ts);
  insUnit.run('starq-dynamics', 'starq-technologies', null, 'DEPARTMENT', 'Starq Dynamics', 'Commercial operating arm (ISIC 8211).', ts, ts);
  const insPos = handle.prepare(
    'INSERT INTO org_positions (id, unit_id, title, job_description, reports_to_position_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  insPos.run('pos-md', 'starq-corporate', 'Managing Director', 'Binds the company. Final authority on org, work, and acceptance.', null, ts, ts);
  insPos.run('pos-studio-lead', 'starq-dev-studio', 'Studio Lead', 'Coordinates engineering execution under Founder authority.', 'pos-md', ts, ts);
  insPos.run('pos-engineer', 'starq-dev-studio', 'Lead Engineer', 'Implements and verifies Command as the company operating system.', 'pos-studio-lead', ts, ts);
  const insPerson = handle.prepare(
    `INSERT INTO org_people (id, handle, display_name, kind, role_note, harness, capabilities_json, status, source, room_handle, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'manual', ?, ?, ?)`,
  );
  insPerson.run('person-ali', 'ali', 'Ali Mushthaq Ibrahim (Founder)', 'HUMAN', 'Founder & Managing Director', null, JSON.stringify(['governance', 'approval']), 'ali', ts, ts);
  insPerson.run('person-cursor', 'cursor', 'Cursor (Lead Engineer seat)', 'DIGITAL', 'UI & Founder surface', 'cursor', JSON.stringify(['builder', 'ui']), 'cursor', ts, ts);
  insPerson.run('person-codex', 'codex', 'Codex (technical coordinator)', 'DIGITAL', 'Floor coordinator & builder', 'codex', JSON.stringify(['builder', 'coordination']), 'codex', ts, ts);
  insPerson.run('person-claude', 'claude', 'Claude (Elder)', 'DIGITAL', 'Architecture & verification', 'claude-code', JSON.stringify(['builder', 'verifier', 'architecture']), 'claude', ts, ts);
  const insAppt = handle.prepare(
    'INSERT INTO org_appointments (id, position_id, person_id, status, appointed_at, ended_at) VALUES (?, ?, ?, ?, ?, NULL)',
  );
  insAppt.run('appt-md-ali', 'pos-md', 'person-ali', 'ACTIVE', ts);
  insAppt.run('appt-engineer-cursor', 'pos-engineer', 'person-cursor', 'ACTIVE', ts);
}

export function readOrg(handle, { generatedAt, roomPost, includeArchived = false } = {}) {
  const companySql = includeArchived
    ? 'SELECT * FROM org_companies ORDER BY created_at'
    : 'SELECT * FROM org_companies WHERE archived_at IS NULL ORDER BY created_at';
  const companies = handle.prepare(companySql).all();
  const unitSql = includeArchived
    ? 'SELECT * FROM org_units ORDER BY created_at'
    : 'SELECT * FROM org_units WHERE archived_at IS NULL ORDER BY created_at';
  const posSql = includeArchived
    ? 'SELECT * FROM org_positions ORDER BY created_at'
    : 'SELECT * FROM org_positions WHERE archived_at IS NULL ORDER BY created_at';
  const peopleSql = includeArchived
    ? 'SELECT * FROM org_people ORDER BY created_at'
    : 'SELECT * FROM org_people WHERE archived_at IS NULL ORDER BY created_at';
  return {
    company: companies.length === 1 ? companies[0] : companies,
    companies,
    units: handle.prepare(unitSql).all(),
    positions: handle.prepare(posSql).all(),
    people: handle.prepare(peopleSql).all().map(hydratePerson),
    appointments: handle.prepare(
      "SELECT * FROM org_appointments WHERE status = 'ACTIVE' ORDER BY appointed_at",
    ).all(),
    ended_appointments: handle.prepare(
      "SELECT * FROM org_appointments WHERE status = 'ENDED' ORDER BY ended_at DESC, appointed_at DESC",
    ).all(),
    include_archived: Boolean(includeArchived),
    generated_at: generatedAt,
    room_post: roomPost,
  };
}

export function readOrgHistory(handle, { entity = null, id = null, limit = 100 } = {}) {
  const capped = Math.min(500, Math.max(1, Number(limit) || 100));
  const clauses = [];
  const args = [];
  if (entity) {
    clauses.push('entity = ?');
    args.push(String(entity));
  }
  if (id) {
    clauses.push('entity_id = ?');
    args.push(String(id));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = handle.prepare(
    `SELECT * FROM org_audit ${where} ORDER BY id DESC LIMIT ?`,
  ).all(...args, capped);
  return rows.map((r) => {
    let before = null;
    let after = null;
    try { before = r.before_json ? JSON.parse(r.before_json) : null; } catch { before = null; }
    try { after = r.after_json ? JSON.parse(r.after_json) : null; } catch { after = null; }
    return {
      ...r,
      before,
      after,
    };
  });
}

export function createCompany(handle, { id, name, legal_name, notes, actor = 'system', channel = 'api', nowIso }) {
  const cid = id || slug('co', name);
  const existing = rowOrNull(handle, 'SELECT * FROM org_companies WHERE id = ?', cid);
  const ts = nowIso();
  if (existing && !existing.archived_at) {
    throw Object.assign(new Error(`Company id already exists: ${cid}`), { code: 'COMPANY_EXISTS' });
  }
  if (existing) {
    handle.prepare(
      'UPDATE org_companies SET name = ?, legal_name = ?, notes = ?, updated_at = ?, archived_at = NULL WHERE id = ?',
    ).run(name, legal_name ?? null, notes ?? null, ts, cid);
  } else {
    handle.prepare(
      'INSERT INTO org_companies (id, name, legal_name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(cid, name, legal_name ?? null, notes ?? null, ts, ts);
  }
  const created = handle.prepare('SELECT * FROM org_companies WHERE id = ?').get(cid);
  recordOrgAudit(handle, {
    entity: 'company',
    entity_id: cid,
    action: 'CREATE',
    actor,
    channel,
    before: existing,
    after: created,
    nowIso: () => ts,
  });
  return created;
}

export function updateCompany(handle, id, { name, legal_name, notes, archived, actor = 'system', channel = 'api', nowIso }) {
  const existing = rowOrNull(handle, 'SELECT * FROM org_companies WHERE id = ?', id);
  if (!existing) {
    throw Object.assign(new Error(`Unknown company: ${id}`), { code: 'COMPANY_NOT_FOUND' });
  }
  const nextName = name !== undefined ? name : existing.name;
  const nextLegal = legal_name !== undefined ? legal_name : existing.legal_name;
  const nextNotes = notes !== undefined ? notes : existing.notes;
  const ts = nowIso();
  let nextArchivedAt = existing.archived_at ?? null;
  if (archived === true && !nextArchivedAt) {
    const units = countRows(
      handle,
      'SELECT COUNT(*) AS n FROM org_units WHERE company_id = ? AND archived_at IS NULL',
      id,
    );
    refuseDependents(
      units,
      `Company ${id} still holds ${units} active unit(s). Archive or move those first. Nothing was removed.`,
    );
    nextArchivedAt = ts;
  }
  if (archived === false) nextArchivedAt = null;
  handle.prepare(
    'UPDATE org_companies SET name = ?, legal_name = ?, notes = ?, updated_at = ?, archived_at = ? WHERE id = ?',
  ).run(nextName, nextLegal ?? null, nextNotes ?? null, ts, nextArchivedAt, id);
  const updated = handle.prepare('SELECT * FROM org_companies WHERE id = ?').get(id);
  const action = archived === true && !existing.archived_at
    ? 'ARCHIVE'
    : archived === false && existing.archived_at
      ? 'UNARCHIVE'
      : 'UPDATE';
  recordOrgAudit(handle, {
    entity: 'company',
    entity_id: id,
    action,
    actor,
    channel,
    before: existing,
    after: updated,
    nowIso: () => ts,
  });
  return updated;
}

function checkUnitCycle(handle, unitId, targetParentId) {
  if (!targetParentId) return;
  if (unitId === targetParentId) {
    throw Object.assign(new Error(`Unit ${unitId} cannot be its own parent.`), { code: 'UNIT_CYCLE' });
  }
  const seen = new Set([unitId]);
  let cur = targetParentId;
  while (cur) {
    if (seen.has(cur)) {
      throw Object.assign(new Error(`Cycle detected in org_units hierarchy for ${unitId} -> ${targetParentId}.`), { code: 'UNIT_CYCLE' });
    }
    seen.add(cur);
    const parentRow = rowOrNull(handle, 'SELECT parent_id FROM org_units WHERE id = ?', cur);
    cur = parentRow?.parent_id ?? null;
  }
}

export function createUnit(handle, { id, company_id, parent_id, kind, name, description, actor = 'system', channel = 'api', nowIso }) {
  if (!UNIT_KINDS.has(kind)) throw Object.assign(new Error('Unit kind invalid.'), { code: 'VALIDATION' });
  const company = rowOrNull(handle, 'SELECT * FROM org_companies WHERE id = ?', company_id);
  if (!company) {
    throw Object.assign(new Error(`Unknown company: ${company_id}`), { code: 'COMPANY_NOT_FOUND' });
  }
  if (company.archived_at) {
    throw Object.assign(new Error(`Company is archived: ${company_id}`), { code: 'ARCHIVED_TARGET' });
  }
  if (parent_id) {
    const parent = rowOrNull(handle, 'SELECT * FROM org_units WHERE id = ?', parent_id);
    if (!parent) {
      throw Object.assign(new Error(`Unknown parent unit: ${parent_id}`), { code: 'UNIT_NOT_FOUND' });
    }
    if (parent.archived_at) {
      throw Object.assign(new Error(`Parent unit is archived: ${parent_id}`), { code: 'ARCHIVED_TARGET' });
    }
  }
  const uid = id || slug('unit', name);
  const existing = rowOrNull(handle, 'SELECT * FROM org_units WHERE id = ?', uid);
  if (existing && !existing.archived_at) {
    throw Object.assign(new Error(`Unit id already exists: ${uid}`), { code: 'UNIT_EXISTS' });
  }
  const ts = nowIso();
  if (existing) {
    handle.prepare(
      'UPDATE org_units SET company_id = ?, parent_id = ?, kind = ?, name = ?, description = ?, updated_at = ?, archived_at = NULL WHERE id = ?',
    ).run(company_id, parent_id ?? null, kind, name, description ?? null, ts, uid);
  } else {
    handle.prepare(
      'INSERT INTO org_units (id, company_id, parent_id, kind, name, description, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
    ).run(uid, company_id, parent_id ?? null, kind, name, description ?? null, ts, ts);
  }
  const created = handle.prepare('SELECT * FROM org_units WHERE id = ?').get(uid);
  recordOrgAudit(handle, {
    entity: 'unit',
    entity_id: uid,
    action: 'CREATE',
    actor,
    channel,
    before: existing,
    after: created,
    nowIso: () => ts,
  });
  return created;
}

export function updateUnit(handle, id, { name, description, kind, parent_id, archived, actor = 'system', channel = 'api', nowIso }) {
  const existing = rowOrNull(handle, 'SELECT * FROM org_units WHERE id = ?', id);
  if (!existing) {
    throw Object.assign(new Error(`Unknown unit: ${id}`), { code: 'UNIT_NOT_FOUND' });
  }
  if (kind !== undefined && !UNIT_KINDS.has(kind)) {
    throw Object.assign(new Error('Unit kind invalid.'), { code: 'VALIDATION' });
  }
  let nextParent = existing.parent_id;
  if (parent_id !== undefined) {
    if (parent_id === null || parent_id === '') {
      nextParent = null;
    } else {
      const parentRow = rowOrNull(handle, 'SELECT * FROM org_units WHERE id = ?', parent_id);
      if (!parentRow) {
        throw Object.assign(new Error(`Unknown parent unit: ${parent_id}`), { code: 'UNIT_NOT_FOUND' });
      }
      if (parentRow.archived_at) {
        throw Object.assign(new Error(`Parent unit is archived: ${parent_id}`), { code: 'ARCHIVED_TARGET' });
      }
      checkUnitCycle(handle, id, parent_id);
      nextParent = parent_id;
    }
  }
  const ts = nowIso();
  const nextName = name !== undefined ? name : existing.name;
  const nextDesc = description !== undefined ? description : existing.description;
  const nextKind = kind !== undefined ? kind : existing.kind;
  let nextArchivedAt = existing.archived_at ?? null;
  if (archived === true && !nextArchivedAt) {
    const children = countRows(
      handle,
      'SELECT COUNT(*) AS n FROM org_units WHERE parent_id = ? AND archived_at IS NULL',
      id,
    );
    const positions = countRows(
      handle,
      'SELECT COUNT(*) AS n FROM org_positions WHERE unit_id = ? AND archived_at IS NULL',
      id,
    );
    refuseDependents(
      children + positions,
      `Unit ${id} still holds ${children} active child unit(s) and ${positions} active position(s). Nothing was removed.`,
    );
    nextArchivedAt = ts;
  }
  if (archived === false) nextArchivedAt = null;
  if (archived === false) {
    const homeCompany = rowOrNull(handle, 'SELECT id, archived_at FROM org_companies WHERE id = ?', existing.company_id);
    if (homeCompany?.archived_at) {
      throw Object.assign(new Error(`Company is archived: ${existing.company_id}`), { code: 'ARCHIVED_TARGET' });
    }
    if (nextParent) {
      const parent = rowOrNull(handle, 'SELECT id, archived_at FROM org_units WHERE id = ?', nextParent);
      if (parent?.archived_at) {
        throw Object.assign(new Error(`Parent unit is archived: ${nextParent}`), { code: 'ARCHIVED_TARGET' });
      }
    }
  }

  handle.prepare(
    'UPDATE org_units SET name = ?, description = ?, kind = ?, parent_id = ?, updated_at = ?, archived_at = ? WHERE id = ?',
  ).run(nextName, nextDesc ?? null, nextKind, nextParent, ts, nextArchivedAt, id);
  const updated = handle.prepare('SELECT * FROM org_units WHERE id = ?').get(id);
  const action = archived === true && !existing.archived_at
    ? 'ARCHIVE'
    : archived === false && existing.archived_at
      ? 'UNARCHIVE'
      : 'UPDATE';
  recordOrgAudit(handle, {
    entity: 'unit',
    entity_id: id,
    action,
    actor,
    channel,
    before: existing,
    after: updated,
    nowIso: () => ts,
  });
  return updated;
}

function checkPositionCycle(handle, positionId, targetReportsToId) {
  if (!targetReportsToId) return;
  if (positionId === targetReportsToId) {
    throw Object.assign(new Error(`Position ${positionId} cannot report to itself.`), { code: 'POSITION_CYCLE' });
  }
  const seen = new Set([positionId]);
  let cur = targetReportsToId;
  while (cur) {
    if (seen.has(cur)) {
      throw Object.assign(new Error(`Cycle detected in org_positions hierarchy for ${positionId} -> ${targetReportsToId}.`), { code: 'POSITION_CYCLE' });
    }
    seen.add(cur);
    const parentPos = rowOrNull(handle, 'SELECT reports_to_position_id FROM org_positions WHERE id = ?', cur);
    cur = parentPos?.reports_to_position_id ?? null;
  }
}

export function createPosition(handle, { id, unit_id, title, job_description, reports_to_position_id, actor = 'system', channel = 'api', nowIso }) {
  const unitRow = rowOrNull(handle, 'SELECT * FROM org_units WHERE id = ?', unit_id);
  if (!unitRow) {
    throw Object.assign(new Error(`Unknown unit: ${unit_id}`), { code: 'UNIT_NOT_FOUND' });
  }
  if (unitRow.archived_at) {
    throw Object.assign(new Error(`Unit is archived: ${unit_id}`), { code: 'ARCHIVED_TARGET' });
  }
  if (reports_to_position_id) {
    const repRow = rowOrNull(handle, 'SELECT * FROM org_positions WHERE id = ?', reports_to_position_id);
    if (!repRow) {
      throw Object.assign(new Error(`Unknown reports-to position: ${reports_to_position_id}`), { code: 'POSITION_NOT_FOUND' });
    }
    if (repRow.archived_at) {
      throw Object.assign(new Error(`Reports-to position is archived: ${reports_to_position_id}`), { code: 'ARCHIVED_TARGET' });
    }
  }
  const pid = id || slug('pos', title);
  const existing = rowOrNull(handle, 'SELECT * FROM org_positions WHERE id = ?', pid);
  if (existing && !existing.archived_at) {
    throw Object.assign(new Error(`Position id already exists: ${pid}`), { code: 'POSITION_EXISTS' });
  }
  const ts = nowIso();
  if (existing) {
    handle.prepare(
      'UPDATE org_positions SET unit_id = ?, title = ?, job_description = ?, reports_to_position_id = ?, updated_at = ?, archived_at = NULL WHERE id = ?',
    ).run(unit_id, title, job_description ?? null, reports_to_position_id ?? null, ts, pid);
  } else {
    handle.prepare(
      'INSERT INTO org_positions (id, unit_id, title, job_description, reports_to_position_id, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
    ).run(pid, unit_id, title, job_description ?? null, reports_to_position_id ?? null, ts, ts);
  }
  const created = handle.prepare('SELECT * FROM org_positions WHERE id = ?').get(pid);
  recordOrgAudit(handle, {
    entity: 'position',
    entity_id: pid,
    action: 'CREATE',
    actor,
    channel,
    before: existing,
    after: created,
    nowIso: () => ts,
  });
  return created;
}

export function updatePosition(handle, id, { title, job_description, unit_id, reports_to_position_id, archived, actor = 'system', channel = 'api', nowIso }) {
  const existing = rowOrNull(handle, 'SELECT * FROM org_positions WHERE id = ?', id);
  if (!existing) {
    throw Object.assign(new Error(`Unknown position: ${id}`), { code: 'POSITION_NOT_FOUND' });
  }
  let nextUnitId = existing.unit_id;
  if (unit_id !== undefined) {
    const unitRow = rowOrNull(handle, 'SELECT * FROM org_units WHERE id = ?', unit_id);
    if (!unitRow) {
      throw Object.assign(new Error(`Unknown unit: ${unit_id}`), { code: 'UNIT_NOT_FOUND' });
    }
    if (unitRow.archived_at) {
      throw Object.assign(new Error(`Unit is archived: ${unit_id}`), { code: 'ARCHIVED_TARGET' });
    }
    nextUnitId = unit_id;
  }
  let nextReportsTo = existing.reports_to_position_id;
  if (reports_to_position_id !== undefined) {
    if (reports_to_position_id === null || reports_to_position_id === '') {
      nextReportsTo = null;
    } else {
      const repRow = rowOrNull(handle, 'SELECT * FROM org_positions WHERE id = ?', reports_to_position_id);
      if (!repRow) {
        throw Object.assign(new Error(`Unknown reports-to position: ${reports_to_position_id}`), { code: 'POSITION_NOT_FOUND' });
      }
      if (repRow.archived_at) {
        throw Object.assign(new Error(`Reports-to position is archived: ${reports_to_position_id}`), { code: 'ARCHIVED_TARGET' });
      }
      checkPositionCycle(handle, id, reports_to_position_id);
      nextReportsTo = reports_to_position_id;
    }
  }
  const ts = nowIso();
  const nextTitle = title !== undefined ? title : existing.title;
  const nextJd = job_description !== undefined ? job_description : existing.job_description;
  let nextArchivedAt = existing.archived_at ?? null;
  if (archived === true && !nextArchivedAt) {
    const reports = countRows(
      handle,
      'SELECT COUNT(*) AS n FROM org_positions WHERE reports_to_position_id = ? AND archived_at IS NULL',
      id,
    );
    const appointments = countRows(
      handle,
      "SELECT COUNT(*) AS n FROM org_appointments WHERE position_id = ? AND status = 'ACTIVE'",
      id,
    );
    refuseDependents(
      reports + appointments,
      `Position ${id} still holds ${reports} reporting position(s) and ${appointments} active appointment(s). Nothing was removed.`,
    );
    nextArchivedAt = ts;
  }
  if (archived === false) nextArchivedAt = null;
  if (archived === false) {
    const home = rowOrNull(handle, 'SELECT id, archived_at FROM org_units WHERE id = ?', nextUnitId);
    if (!home) {
      throw Object.assign(new Error(`Unknown unit: ${nextUnitId}`), { code: 'UNIT_NOT_FOUND' });
    }
    if (home.archived_at) {
      throw Object.assign(new Error(`Unit is archived: ${nextUnitId}`), { code: 'ARCHIVED_TARGET' });
    }
  }

  handle.prepare(
    'UPDATE org_positions SET unit_id = ?, title = ?, job_description = ?, reports_to_position_id = ?, updated_at = ?, archived_at = ? WHERE id = ?',
  ).run(nextUnitId, nextTitle, nextJd ?? null, nextReportsTo, ts, nextArchivedAt, id);
  const updated = handle.prepare('SELECT * FROM org_positions WHERE id = ?').get(id);
  const action = archived === true && !existing.archived_at
    ? 'ARCHIVE'
    : archived === false && existing.archived_at
      ? 'UNARCHIVE'
      : 'UPDATE';
  recordOrgAudit(handle, {
    entity: 'position',
    entity_id: id,
    action,
    actor,
    channel,
    before: existing,
    after: updated,
    nowIso: () => ts,
  });
  return updated;
}

function normalizeCapabilities(capabilities) {
  if (capabilities === undefined || capabilities === null) return [];
  if (!Array.isArray(capabilities)) {
    throw Object.assign(new Error('capabilities must be an array of strings.'), { code: 'VALIDATION' });
  }
  return capabilities
    .filter((c) => typeof c === 'string' && c.trim())
    .map((c) => c.trim().slice(0, 64));
}

export function createPerson(handle, {
  id,
  handle: personHandle,
  display_name,
  kind,
  role_note = null,
  harness = null,
  capabilities = [],
  status = 'active',
  source = 'manual',
  room_handle = null,
  actor = 'system',
  channel = 'api',
  nowIso,
}) {
  if (!PERSON_KINDS.has(kind)) throw Object.assign(new Error('Person kind invalid.'), { code: 'VALIDATION' });
  if (!/^[a-z0-9][a-z0-9._-]{1,38}$/i.test(personHandle)) {
    throw Object.assign(new Error('Handle must be 2-40 letters, digits, dot, underscore or hyphen.'), { code: 'VALIDATION' });
  }
  const normStatus = String(status || 'active').toLowerCase();
  if (!PERSON_STATUSES.has(normStatus)) {
    throw Object.assign(new Error('Person status must be active or inactive.'), { code: 'VALIDATION' });
  }
  const byHandle = rowOrNull(handle, 'SELECT * FROM org_people WHERE handle = ?', personHandle);
  if (byHandle && !byHandle.archived_at) {
    throw Object.assign(new Error(`Handle already recorded: ${personHandle}`), { code: 'PERSON_EXISTS' });
  }
  const pid = byHandle?.id || id || slug('person', personHandle);
  const byId = byHandle || rowOrNull(handle, 'SELECT * FROM org_people WHERE id = ?', pid);
  if (byId && !byId.archived_at) {
    throw Object.assign(new Error(`Person id already exists: ${pid}`), { code: 'PERSON_EXISTS' });
  }
  const caps = normalizeCapabilities(capabilities);
  const ts = nowIso();
  if (byId) {
    handle.prepare(
      `UPDATE org_people
          SET handle = ?, display_name = ?, kind = ?, role_note = ?, harness = ?, capabilities_json = ?,
              status = ?, source = ?, room_handle = ?, updated_at = ?, archived_at = NULL
        WHERE id = ?`,
    ).run(
      personHandle,
      display_name,
      kind,
      role_note ?? null,
      harness ?? null,
      JSON.stringify(caps),
      normStatus,
      source || 'manual',
      room_handle ?? null,
      ts,
      byId.id,
    );
  } else {
    handle.prepare(
      `INSERT INTO org_people (
         id, handle, display_name, kind, role_note, harness, capabilities_json,
         status, source, room_handle, created_at, updated_at, archived_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      pid,
      personHandle,
      display_name,
      kind,
      role_note ?? null,
      harness ?? null,
      JSON.stringify(caps),
      normStatus,
      source || 'manual',
      room_handle ?? null,
      ts,
      ts,
    );
  }
  const created = hydratePerson(handle.prepare('SELECT * FROM org_people WHERE id = ?').get(byId?.id || pid));
  recordOrgAudit(handle, {
    entity: 'person',
    entity_id: created.id,
    action: 'CREATE',
    actor,
    channel,
    before: byId,
    after: created,
    nowIso: () => ts,
  });
  return created;
}

export function updatePerson(handle, idOrHandle, {
  display_name,
  kind,
  status,
  role_note,
  harness,
  capabilities,
  room_handle,
  archived,
  actor = 'system',
  channel = 'api',
  nowIso,
}) {
  const existingRow = rowOrNull(
    handle,
    'SELECT * FROM org_people WHERE id = ? OR handle = ?',
    idOrHandle,
    idOrHandle,
  );
  if (!existingRow) {
    throw Object.assign(new Error(`Unknown person: ${idOrHandle}`), { code: 'PERSON_NOT_FOUND' });
  }
  const existing = hydratePerson(existingRow);
  if (kind !== undefined && !PERSON_KINDS.has(kind)) {
    throw Object.assign(new Error('Person kind invalid.'), { code: 'VALIDATION' });
  }
  let nextStatus = existing.status;
  if (status !== undefined) {
    const s = String(status).toLowerCase();
    if (!PERSON_STATUSES.has(s)) {
      throw Object.assign(new Error('Person status must be active or inactive.'), { code: 'VALIDATION' });
    }
    nextStatus = s;
  }
  const nextCaps = capabilities !== undefined ? normalizeCapabilities(capabilities) : existing.capabilities;
  const ts = nowIso();
  const nextDisplayName = display_name !== undefined ? display_name : existing.display_name;
  const nextKind = kind !== undefined ? kind : existing.kind;
  const nextRoleNote = role_note !== undefined ? role_note : existing.role_note;
  const nextHarness = harness !== undefined ? harness : existing.harness;
  const nextRoomHandle = room_handle !== undefined ? room_handle : existing.room_handle;
  let nextArchivedAt = existing.archived_at ?? null;
  if (archived === true && !nextArchivedAt) {
    const appointments = countRows(
      handle,
      "SELECT COUNT(*) AS n FROM org_appointments WHERE person_id = ? AND status = 'ACTIVE'",
      existing.id,
    );
    refuseDependents(
      appointments,
      `Person ${existing.handle} still holds ${appointments} active appointment(s). End those first. Nothing was removed.`,
    );
    nextArchivedAt = ts;
  }
  if (archived === false) nextArchivedAt = null;

  handle.prepare(
    `UPDATE org_people
        SET display_name = ?, kind = ?, status = ?, role_note = ?, harness = ?,
            capabilities_json = ?, room_handle = ?, updated_at = ?, archived_at = ?
      WHERE id = ?`,
  ).run(
    nextDisplayName,
    nextKind,
    nextStatus,
    nextRoleNote ?? null,
    nextHarness ?? null,
    JSON.stringify(nextCaps),
    nextRoomHandle ?? null,
    ts,
    nextArchivedAt,
    existing.id,
  );
  const updated = hydratePerson(handle.prepare('SELECT * FROM org_people WHERE id = ?').get(existing.id));
  const action = archived === true && !existing.archived_at
    ? 'ARCHIVE'
    : archived === false && existing.archived_at
      ? 'UNARCHIVE'
      : 'UPDATE';
  recordOrgAudit(handle, {
    entity: 'person',
    entity_id: existing.id,
    action,
    actor,
    channel,
    before: existing,
    after: updated,
    nowIso: () => ts,
  });
  return updated;
}

export function createAppointment(handle, { id, position_id, person_id, notes = null, actor = 'system', channel = 'api', nowIso }) {
  const posRow = rowOrNull(handle, 'SELECT * FROM org_positions WHERE id = ?', position_id);
  if (!posRow) {
    throw Object.assign(new Error(`Unknown position: ${position_id}`), { code: 'POSITION_NOT_FOUND' });
  }
  if (posRow.archived_at) {
    throw Object.assign(new Error(`Position is archived: ${position_id}`), { code: 'ARCHIVED_TARGET' });
  }
  const personRow = rowOrNull(handle, 'SELECT * FROM org_people WHERE id = ? OR handle = ?', person_id, person_id);
  if (!personRow) {
    throw Object.assign(new Error(`Unknown person: ${person_id}`), { code: 'PERSON_NOT_FOUND' });
  }
  if (personRow.archived_at) {
    throw Object.assign(new Error(`Person is archived: ${person_id}`), { code: 'ARCHIVED_TARGET' });
  }
  const active = rowOrNull(
    handle,
    "SELECT id FROM org_appointments WHERE position_id = ? AND status = 'ACTIVE'",
    position_id,
  );
  if (active) {
    throw Object.assign(new Error(`Position already has an active appointment (${active.id}).`), { code: 'POSITION_OCCUPIED' });
  }
  const ts = nowIso();
  const baseAid = id || slug('appt', `${position_id}-${personRow.id}`);
  const aid = rowOrNull(handle, 'SELECT id FROM org_appointments WHERE id = ?', baseAid)
    ? `${baseAid}-${crypto.randomUUID().slice(0, 6)}`
    : baseAid;
  handle.prepare(
    'INSERT INTO org_appointments (id, position_id, person_id, status, appointed_at, ended_at, notes) VALUES (?, ?, ?, ?, ?, NULL, ?)',
  ).run(aid, position_id, personRow.id, 'ACTIVE', ts, notes ?? null);
  const created = handle.prepare('SELECT * FROM org_appointments WHERE id = ?').get(aid);
  recordOrgAudit(handle, {
    entity: 'appointment',
    entity_id: aid,
    action: 'CREATE',
    actor,
    channel,
    before: null,
    after: created,
    nowIso: () => ts,
  });
  return created;
}

export function endAppointment(handle, id, {
  notes = undefined,
  reassign_to_person_id = null,
  reassign_notes = null,
  actor = 'system',
  channel = 'api',
  nowIso,
}) {
  const existing = rowOrNull(handle, 'SELECT * FROM org_appointments WHERE id = ?', id);
  if (!existing) {
    throw Object.assign(new Error(`Unknown appointment: ${id}`), { code: 'APPOINTMENT_NOT_FOUND' });
  }
  const ts = nowIso();
  const nextNotes = notes !== undefined ? notes : existing.notes;
  const endedAt = existing.ended_at || ts;
  handle.prepare(
    "UPDATE org_appointments SET status = 'ENDED', ended_at = ?, notes = ? WHERE id = ?",
  ).run(endedAt, nextNotes ?? null, id);
  const ended = handle.prepare('SELECT * FROM org_appointments WHERE id = ?').get(id);
  recordOrgAudit(handle, {
    entity: 'appointment',
    entity_id: id,
    action: 'END',
    actor,
    channel,
    before: existing,
    after: ended,
    nowIso: () => ts,
  });
  let reassigned = null;
  if (reassign_to_person_id) {
    reassigned = createAppointment(handle, {
      position_id: existing.position_id,
      person_id: reassign_to_person_id,
      notes: reassign_notes ?? null,
      actor,
      channel,
      nowIso: () => ts,
    });
  }
  return { ended, reassigned };
}

function inferHarness(canonicalHandle, ident, staffByHandle) {
  const profile = staffByHandle.get(canonicalHandle);
  if (profile) {
    if (canonicalHandle === 'claude') return 'claude-code';
    if (canonicalHandle === 'codex') return 'codex';
    if (canonicalHandle === 'antigravity') return 'antigravity';
    if (canonicalHandle === 'cursor') return 'cursor';
    if (canonicalHandle === 'copilot') return 'copilot';
    if (canonicalHandle === 'vision') return 'hermes:vision';
    if (canonicalHandle === 'deadpool') return 'hermes:deadpool';
    if (canonicalHandle === 'opencode') return 'opencode';
    if (canonicalHandle === 'pi') return 'pi';
    if (canonicalHandle === 'goose') return 'goose';
    return profile.harness ?? null;
  }
  if (canonicalHandle === 'antigravity-command') return 'antigravity';
  if (canonicalHandle === 'claude-command') return 'claude-code';
  if (canonicalHandle === 'cursor-command') return 'cursor';
  if (canonicalHandle === 'codex-command') return 'codex';
  if (canonicalHandle.startsWith('hermes-')) return `hermes:${canonicalHandle.slice('hermes-'.length)}`;
  const role = String(ident?.role || '').toLowerCase();
  if (role.includes('hermes')) return `hermes:${canonicalHandle}`;
  return null;
}

function inferCapabilities(canonicalHandle, ident, staffByHandle) {
  const caps = new Set();
  const profile = staffByHandle.get(canonicalHandle);
  if (profile?.role_family) {
    const rf = profile.role_family.toLowerCase();
    if (rf.includes('builder')) caps.add('builder');
    if (rf.includes('verifier')) caps.add('verifier');
  }
  if (ident?.authorityLevel === 'ROOT_GENESIS') {
    caps.add('governance');
    caps.add('approval');
  }
  const role = String(ident?.role || '').toLowerCase();
  if (role.includes('qa') || role.includes('verifier') || role.includes('test')) caps.add('verifier');
  if (role.includes('engineer') || role.includes('specialist') || role.includes('builder')) caps.add('builder');
  if (role.includes('coordinator') || role.includes('lead')) caps.add('coordination');
  return [...caps];
}

export function importIdentitiesToOrg(handle, {
  workspaceRoot,
  identitiesPath = null,
  actor = 'system',
  channel = 'api',
  nowIso = () => new Date().toISOString(),
} = {}) {
  const resolvedPath = identitiesPath
    ? path.resolve(identitiesPath)
    : (workspaceRoot ? path.join(workspaceRoot, 'agent-comms', 'protocol', 'v1', 'identities.json') : null);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return {
      state: 'UNAVAILABLE',
      reason: 'identities.json is absent or workspace is unresolved',
      source: null,
      created: [],
      skipped: [],
      conflicts: [],
    };
  }
  let rawBytes;
  let parsed;
  try {
    rawBytes = fs.readFileSync(resolvedPath, 'utf8');
    parsed = JSON.parse(rawBytes);
  } catch (e) {
    return {
      state: 'UNAVAILABLE',
      reason: `identities.json unreadable: ${e.message}`,
      source: null,
      created: [],
      skipped: [],
      conflicts: [],
    };
  }
  const sha = crypto.createHash('sha256').update(rawBytes).digest('hex').slice(0, 16);
  const sourceTag = `identities.json@${sha}`;
  const staffByHandle = new Map(STAFF_PROFILE.map((s) => [s.handle, s]));

  const created = [];
  const skipped = [];
  const conflicts = [];
  const ts = nowIso();

  for (const ident of parsed.identities ?? []) {
    const canonicalHandle = typeof ident.canonicalHandle === 'string' ? ident.canonicalHandle.trim() : '';
    if (!canonicalHandle) continue;

    const expectedKind = ident.authorityIdentityId === 'founder' || ident.authorityLevel === 'ROOT_GENESIS'
      ? 'HUMAN'
      : 'DIGITAL';
    const existing = rowOrNull(handle, 'SELECT * FROM org_people WHERE handle = ?', canonicalHandle);
    if (existing) {
      if (existing.kind !== expectedKind) {
        conflicts.push({
          handle: canonicalHandle,
          id: existing.id,
          reason: `existing kind ${existing.kind} differs from registry kind ${expectedKind}; manual record preserved`,
        });
      }
      skipped.push({
        handle: canonicalHandle,
        id: existing.id,
        reason: 'already_present',
      });
      continue;
    }

    const baseId = slug('person', canonicalHandle);
    const pid = rowOrNull(handle, 'SELECT id FROM org_people WHERE id = ?', baseId)
      ? `${baseId}-${sha.slice(0, 6)}`
      : baseId;
    const status = ident.status === 'retired' ? 'inactive' : 'active';
    const harness = expectedKind === 'DIGITAL' ? inferHarness(canonicalHandle, ident, staffByHandle) : null;
    const capabilities = inferCapabilities(canonicalHandle, ident, staffByHandle);
    const displayName = String(ident.displayName || canonicalHandle).slice(0, 80);
    const roleNote = typeof ident.role === 'string' ? ident.role.slice(0, 400) : null;

    handle.prepare(
      `INSERT INTO org_people (
         id, handle, display_name, kind, role_note, harness, capabilities_json,
         status, source, room_handle, created_at, updated_at, archived_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      pid,
      canonicalHandle,
      displayName,
      expectedKind,
      roleNote,
      harness,
      JSON.stringify(capabilities),
      status,
      sourceTag,
      canonicalHandle,
      ts,
      ts,
    );
    const person = hydratePerson(handle.prepare('SELECT * FROM org_people WHERE id = ?').get(pid));
    recordOrgAudit(handle, {
      entity: 'person',
      entity_id: pid,
      action: 'IMPORT',
      actor,
      channel,
      before: null,
      after: person,
      nowIso: () => ts,
    });
    created.push(person);
  }

  return {
    state: 'OK',
    source: sourceTag,
    created,
    skipped,
    conflicts,
  };
}

export function workforcePersonSummary(handle, personIdOrHandle, { hydrateTask = (r) => r } = {}) {
  const personRow = rowOrNull(
    handle,
    'SELECT * FROM org_people WHERE id = ? OR handle = ?',
    personIdOrHandle,
    personIdOrHandle,
  );
  if (!personRow) {
    throw Object.assign(new Error(`Unknown person: ${personIdOrHandle}`), { code: 'PERSON_NOT_FOUND' });
  }
  const person = hydratePerson(personRow);

  const apptRows = handle.prepare(
    `SELECT a.*, p.title AS position_title, p.unit_id, u.name AS unit_name, u.kind AS unit_kind
       FROM org_appointments a
       LEFT JOIN org_positions p ON p.id = a.position_id
       LEFT JOIN org_units u ON u.id = p.unit_id
      WHERE a.person_id = ?
      ORDER BY a.appointed_at DESC`,
  ).all(person.id);

  const activeAppointments = apptRows.filter((a) => a.status === 'ACTIVE');
  const historicalAppointments = apptRows.filter((a) => a.status === 'ENDED');

  let ownedOpen = [];
  let verifyingOpen = [];
  let blockedTasks = [];
  try {
    const taskRows = handle.prepare(
      `SELECT * FROM pm_tasks
        WHERE (owner = ? OR verifier = ?)
          AND status <> 'DONE'
          AND COALESCE(stage, 'BACKLOG') <> 'CLOSED'
        ORDER BY updated_at DESC`,
    ).all(person.handle, person.handle);
    const hydrated = taskRows.map((r) => hydrateTask(r));
    ownedOpen = hydrated.filter((t) => t.owner === person.handle);
    verifyingOpen = hydrated.filter((t) => t.verifier === person.handle);
    blockedTasks = hydrated.filter((t) => t.status === 'BLOCKED' || t.stage === 'BLOCKED' || t.stage === 'FOUNDER_GATE');
  } catch {
    // pm_tasks might not exist in isolated unit tests that only call initOrgSchema
  }

  const events = [];
  try {
    const statusLogs = handle.prepare(
      `SELECT id, task_id, event_type, from_status, to_status, actor, detail, timestamp
         FROM pm_status_log
        WHERE actor = ?
        ORDER BY id DESC
        LIMIT 10`,
    ).all(person.handle);
    for (const s of statusLogs) {
      let detail = {};
      try { detail = JSON.parse(s.detail || '{}'); } catch { detail = {}; }
      events.push({
        source: 'pm_status_log',
        id: s.id,
        entity: 'task',
        entity_id: s.task_id,
        action: s.event_type,
        actor: s.actor,
        from_status: s.from_status,
        to_status: s.to_status,
        detail,
        timestamp: s.timestamp,
      });
    }
  } catch {
    // pm_status_log might not exist in isolated org-only unit test DB
  }

  const orgLogs = handle.prepare(
    `SELECT id, entity, entity_id, action, actor, channel, before_json, after_json, timestamp
       FROM org_audit
      WHERE actor = ? OR (entity = 'person' AND entity_id = ?)
      ORDER BY id DESC
      LIMIT 10`,
  ).all(person.handle, person.id);
  for (const o of orgLogs) {
    let after = null;
    try { after = o.after_json ? JSON.parse(o.after_json) : null; } catch { after = null; }
    events.push({
      source: 'org_audit',
      id: o.id,
      entity: o.entity,
      entity_id: o.entity_id,
      action: o.action,
      actor: o.actor,
      channel: o.channel,
      detail: after,
      timestamp: o.timestamp,
    });
  }

  events.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

  return {
    person,
    appointments: {
      active: activeAppointments,
      historical: historicalAppointments,
    },
    tasks: {
      owned_open: ownedOpen,
      verifying_open: verifyingOpen,
      blocked: blockedTasks,
    },
    recent_activity: events.slice(0, 10),
  };
}
