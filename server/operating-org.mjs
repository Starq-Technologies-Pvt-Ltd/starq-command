/**
 * Writable operating organization stored beside PM tasks.
 *
 * Canonical seats remain company-seats.json / Company OS Structure+Seats.
 * This module is the Founder-editable company graph used for appointments
 * and management work. It never writes Nexus JSON or company-os.mjs.
 */
const UNIT_KINDS = new Set(['COMPANY', 'DIVISION', 'DEPARTMENT', 'TEAM']);
const PERSON_KINDS = new Set(['HUMAN', 'DIGITAL']);

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
      kind TEXT NOT NULL CHECK (kind IN ('COMPANY','DIVISION','DEPARTMENT','TEAM')),
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS org_positions (
      id TEXT PRIMARY KEY,
      unit_id TEXT NOT NULL REFERENCES org_units(id),
      title TEXT NOT NULL,
      job_description TEXT,
      reports_to_position_id TEXT REFERENCES org_positions(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS org_people (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('HUMAN','DIGITAL')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS org_appointments (
      id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL REFERENCES org_positions(id),
      person_id TEXT NOT NULL REFERENCES org_people(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')),
      appointed_at TEXT NOT NULL,
      ended_at TEXT
    );
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
  `);
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

export function orgPeopleHandles(handle) {
  try {
    return handle.prepare('SELECT handle FROM org_people').all().map((r) => r.handle);
  } catch {
    return [];
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
    'INSERT INTO org_units (id, company_id, parent_id, kind, name, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  insUnit.run('starq-corporate', 'starq-technologies', null, 'DIVISION', 'Corporate', 'Founder office, governance, and company administration.', ts);
  insUnit.run('starq-dev-studio', 'starq-technologies', null, 'DEPARTMENT', 'Development Studio', 'Engineering factory. Not a product; builds Command, ERP, Hoadhaa.', ts);
  insUnit.run('starq-dynamics', 'starq-technologies', null, 'DEPARTMENT', 'Starq Dynamics', 'Commercial operating arm (ISIC 8211).', ts);
  const insPos = handle.prepare(
    'INSERT INTO org_positions (id, unit_id, title, job_description, reports_to_position_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insPos.run('pos-md', 'starq-corporate', 'Managing Director', 'Binds the company. Final authority on org, work, and acceptance.', null, ts);
  insPos.run('pos-studio-lead', 'starq-dev-studio', 'Studio Lead', 'Coordinates engineering execution under Founder authority.', 'pos-md', ts);
  insPos.run('pos-engineer', 'starq-dev-studio', 'Lead Engineer', 'Implements and verifies Command as the company operating system.', 'pos-studio-lead', ts);
  const insPerson = handle.prepare(
    'INSERT INTO org_people (id, handle, display_name, kind, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  insPerson.run('person-ali', 'ali', 'Ali Mushthaq Ibrahim (Founder)', 'HUMAN', ts);
  insPerson.run('person-cursor', 'cursor', 'Cursor (Lead Engineer seat)', 'DIGITAL', ts);
  insPerson.run('person-codex', 'codex', 'Codex (technical coordinator)', 'DIGITAL', ts);
  insPerson.run('person-claude', 'claude', 'Claude (Elder)', 'DIGITAL', ts);
  const insAppt = handle.prepare(
    'INSERT INTO org_appointments (id, position_id, person_id, status, appointed_at, ended_at) VALUES (?, ?, ?, ?, ?, NULL)',
  );
  insAppt.run('appt-md-ali', 'pos-md', 'person-ali', 'ACTIVE', ts);
  insAppt.run('appt-engineer-cursor', 'pos-engineer', 'person-cursor', 'ACTIVE', ts);
}

export function readOrg(handle, { generatedAt, roomPost }) {
  const companies = handle.prepare('SELECT * FROM org_companies ORDER BY created_at').all();
  return {
    company: companies.length === 1 ? companies[0] : companies,
    units: handle.prepare('SELECT * FROM org_units ORDER BY created_at').all(),
    positions: handle.prepare('SELECT * FROM org_positions ORDER BY created_at').all(),
    people: handle.prepare('SELECT * FROM org_people ORDER BY created_at').all(),
    appointments: handle.prepare(
      "SELECT * FROM org_appointments WHERE status = 'ACTIVE' ORDER BY appointed_at",
    ).all(),
    generated_at: generatedAt,
    room_post: roomPost,
  };
}

export function createCompany(handle, { id, name, legal_name, notes, nowIso }) {
  const cid = id || slug('co', name);
  if (rowOrNull(handle, 'SELECT id FROM org_companies WHERE id = ?', cid)) {
    throw Object.assign(new Error(`Company id already exists: ${cid}`), { code: 'COMPANY_EXISTS' });
  }
  const ts = nowIso();
  handle.prepare(
    'INSERT INTO org_companies (id, name, legal_name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(cid, name, legal_name ?? null, notes ?? null, ts, ts);
  return handle.prepare('SELECT * FROM org_companies WHERE id = ?').get(cid);
}

export function createUnit(handle, { id, company_id, parent_id, kind, name, description, nowIso }) {
  if (!UNIT_KINDS.has(kind)) throw Object.assign(new Error('Unit kind invalid.'), { code: 'VALIDATION' });
  if (!rowOrNull(handle, 'SELECT id FROM org_companies WHERE id = ?', company_id)) {
    throw Object.assign(new Error(`Unknown company: ${company_id}`), { code: 'COMPANY_NOT_FOUND' });
  }
  if (parent_id && !rowOrNull(handle, 'SELECT id FROM org_units WHERE id = ?', parent_id)) {
    throw Object.assign(new Error(`Unknown parent unit: ${parent_id}`), { code: 'UNIT_NOT_FOUND' });
  }
  const uid = id || slug('unit', name);
  if (rowOrNull(handle, 'SELECT id FROM org_units WHERE id = ?', uid)) {
    throw Object.assign(new Error(`Unit id already exists: ${uid}`), { code: 'UNIT_EXISTS' });
  }
  handle.prepare(
    'INSERT INTO org_units (id, company_id, parent_id, kind, name, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(uid, company_id, parent_id ?? null, kind, name, description ?? null, nowIso());
  return handle.prepare('SELECT * FROM org_units WHERE id = ?').get(uid);
}

export function createPosition(handle, { id, unit_id, title, job_description, reports_to_position_id, nowIso }) {
  if (!rowOrNull(handle, 'SELECT id FROM org_units WHERE id = ?', unit_id)) {
    throw Object.assign(new Error(`Unknown unit: ${unit_id}`), { code: 'UNIT_NOT_FOUND' });
  }
  if (reports_to_position_id && !rowOrNull(handle, 'SELECT id FROM org_positions WHERE id = ?', reports_to_position_id)) {
    throw Object.assign(new Error(`Unknown reports-to position: ${reports_to_position_id}`), { code: 'POSITION_NOT_FOUND' });
  }
  const pid = id || slug('pos', title);
  if (rowOrNull(handle, 'SELECT id FROM org_positions WHERE id = ?', pid)) {
    throw Object.assign(new Error(`Position id already exists: ${pid}`), { code: 'POSITION_EXISTS' });
  }
  handle.prepare(
    'INSERT INTO org_positions (id, unit_id, title, job_description, reports_to_position_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(pid, unit_id, title, job_description ?? null, reports_to_position_id ?? null, nowIso());
  return handle.prepare('SELECT * FROM org_positions WHERE id = ?').get(pid);
}

export function createPerson(handle, { id, handle: personHandle, display_name, kind, nowIso }) {
  if (!PERSON_KINDS.has(kind)) throw Object.assign(new Error('Person kind invalid.'), { code: 'VALIDATION' });
  if (!/^[a-z0-9][a-z0-9._-]{1,38}$/i.test(personHandle)) {
    throw Object.assign(new Error('Handle must be 2-40 letters, digits, dot, underscore or hyphen.'), { code: 'VALIDATION' });
  }
  if (rowOrNull(handle, 'SELECT id FROM org_people WHERE handle = ?', personHandle)) {
    throw Object.assign(new Error(`Handle already recorded: ${personHandle}`), { code: 'PERSON_EXISTS' });
  }
  const pid = id || slug('person', personHandle);
  handle.prepare(
    'INSERT INTO org_people (id, handle, display_name, kind, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(pid, personHandle, display_name, kind, nowIso());
  return handle.prepare('SELECT * FROM org_people WHERE id = ?').get(pid);
}

export function createAppointment(handle, { id, position_id, person_id, nowIso }) {
  if (!rowOrNull(handle, 'SELECT id FROM org_positions WHERE id = ?', position_id)) {
    throw Object.assign(new Error(`Unknown position: ${position_id}`), { code: 'POSITION_NOT_FOUND' });
  }
  if (!rowOrNull(handle, 'SELECT id FROM org_people WHERE id = ?', person_id)) {
    throw Object.assign(new Error(`Unknown person: ${person_id}`), { code: 'PERSON_NOT_FOUND' });
  }
  const active = rowOrNull(
    handle,
    "SELECT id FROM org_appointments WHERE position_id = ? AND status = 'ACTIVE'",
    position_id,
  );
  if (active) {
    throw Object.assign(new Error(`Position already has an active appointment (${active.id}).`), { code: 'POSITION_OCCUPIED' });
  }
  const aid = id || slug('appt', `${position_id}-${person_id}`);
  handle.prepare(
    'INSERT INTO org_appointments (id, position_id, person_id, status, appointed_at, ended_at) VALUES (?, ?, ?, ?, ?, NULL)',
  ).run(aid, position_id, person_id, 'ACTIVE', nowIso());
  return handle.prepare('SELECT * FROM org_appointments WHERE id = ?').get(aid);
}
