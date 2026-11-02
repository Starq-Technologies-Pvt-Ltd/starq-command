/**
 * Regression tests for Copilot's independent review findings.
 *
 * Copilot reproduced four defects against the earlier PR #13/#14 branches.
 * These tests re-state each finding as an executable expectation against the
 * COMBINED candidate, so "still present" or "already fixed" is decided by the
 * code rather than by reading diffs. Each test asserts the CORRECT behaviour,
 * so a failure here is the defect and a pass is the fix.
 *
 * F1  archived-parent invariants bypassed
 * F2  on_conflict:'skip' attaches imported children to a different company
 * F3  unknown snapshot tables silently ignored
 * F4  import CLI dry-run changes the SQLite journal mode (persistent)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initOrgSchema, createCompany, createUnit, createPosition,
  updateCompany, updateUnit, updatePosition,
} from '../server/operating-org.mjs';
import { validateSnapshot, computeTablesSha256, TABLE_INSERTION_ORDER } from '../server/pm-import.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nowIso = () => new Date().toISOString();

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-copilot-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  return dir;
}

function orgDb(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => { try { db.close(); } catch { /* already closed */ } });
  initOrgSchema(db);
  return db;
}

/**
 * A database carrying the FULL Command schema, built by letting the real
 * service create it once on a disposable file.
 *
 * The import validator checks every table in TABLE_INSERTION_ORDER against the
 * target schema, so an org-only database makes it fail for the wrong reason —
 * "pm_projects does not exist" — which would mask whatever F2 and F3 are
 * actually doing. The schema has to be the real one.
 */
function fullSchemaDbPath(t) {
  const dir = tempDir(t);
  const dbPath = path.join(dir, 'full.db');
  // Runs the service's own startup path with an empty provisioning choice, so
  // the schema is whatever the product actually creates.
  const child = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'init-schema-probe.mjs'), dbPath], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 60_000,
  });
  if (!fs.existsSync(dbPath) || child.status !== 0) {
    throw new Error(`could not materialize schema: status=${child.status} ${child.stderr ?? ''}`);
  }
  return dbPath;
}

const threw = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ── F1 ─────────────────────────────────────────────────────────────────────

test('F1a: a unit cannot be created under an ARCHIVED company', (t) => {
  const db = orgDb(t);
  createCompany(db, { id: 'co-x', name: 'Company X', nowIso });
  updateCompany(db, 'co-x', { archived: true, nowIso });

  const err = threw(() => createUnit(db, {
    id: 'u-ghost', company_id: 'co-x', kind: 'DEPARTMENT', name: 'Ghost Dept', nowIso,
  }));

  assert.ok(err, 'creating a unit under an archived company must be refused');
  assert.equal(err.code, 'ARCHIVED_TARGET', `expected ARCHIVED_TARGET, got ${err.code}: ${err.message}`);
  const row = db.prepare("SELECT id FROM org_units WHERE id = 'u-ghost'").get();
  assert.equal(row, undefined, 'no unit may be left behind by a refused create');
});

test('F1b: a position cannot be revived under an ARCHIVED unit', (t) => {
  const db = orgDb(t);
  createCompany(db, { id: 'co-y', name: 'Company Y', nowIso });
  createUnit(db, { id: 'u-y', company_id: 'co-y', kind: 'DEPARTMENT', name: 'Dept Y', nowIso });
  createPosition(db, { id: 'p-y', unit_id: 'u-y', title: 'Engineer', nowIso });

  // Archive the position, then its parent unit.
  updatePosition(db, 'p-y', { archived: true, nowIso });
  updateUnit(db, 'u-y', { archived: true, nowIso });

  // Revive the position WITHOUT naming a unit: it would land under an archived parent.
  const err = threw(() => updatePosition(db, 'p-y', { archived: false, nowIso }));

  assert.ok(err, 'reviving a position under an archived unit must be refused');
  assert.equal(err.code, 'ARCHIVED_TARGET', `expected ARCHIVED_TARGET, got ${err.code}: ${err.message}`);
  const row = db.prepare("SELECT archived_at FROM org_positions WHERE id = 'p-y'").get();
  assert.ok(row.archived_at, 'the position must remain archived after a refused revival');
});

test('F1c: a unit cannot be MOVED under an archived company', (t) => {
  const db = orgDb(t);
  createCompany(db, { id: 'co-live', name: 'Live Co', nowIso });
  createCompany(db, { id: 'co-dead', name: 'Dead Co', nowIso });
  createUnit(db, { id: 'u-move', company_id: 'co-live', kind: 'TEAM', name: 'Movable', nowIso });
  updateCompany(db, 'co-dead', { archived: true, nowIso });

  const err = threw(() => updateUnit(db, 'u-move', { company_id: 'co-dead', nowIso }));
  if (err === null) {
    const row = db.prepare("SELECT company_id FROM org_units WHERE id = 'u-move'").get();
    assert.notEqual(row.company_id, 'co-dead', 'a unit must not end up owned by an archived company');
  } else {
    assert.equal(err.code, 'ARCHIVED_TARGET', `expected ARCHIVED_TARGET, got ${err.code}: ${err.message}`);
  }
});

// ── F2 / F3 ────────────────────────────────────────────────────────────────

/** Minimal valid snapshot; `tables` is merged over the empty skeleton. */
function snapshot(tables, over = {}) {
  const full = Object.fromEntries(TABLE_INSERTION_ORDER.map((t) => [t, []]));
  Object.assign(full, tables);
  const counts = Object.fromEntries(Object.entries(full).map(([k, v]) => [k, v.length]));
  return {
    format: 'starq-command.organization-snapshot',
    format_version: 1,
    schema_version: 3,
    exported_at: nowIso(),
    source_db_id: 'test-source',
    counts,
    content_sha256: computeTablesSha256(full),
    tables: full,
    ...over,
  };
}

test('F2: on_conflict skip must not attach imported children to a DIFFERENT existing company', (t) => {
  const dbPath = fullSchemaDbPath(t);
  const db = new DatabaseSync(dbPath);
  t.after(() => { try { db.close(); } catch { /* closed */ } });
  // Target already has its own company under the same id, but it is a different organization.
  createCompany(db, { id: 'co-1', name: 'Target Organisation', nowIso });

  const snap = snapshot({
    org_companies: [{ id: 'co-1', name: 'Source Organisation', legal_name: null, notes: null, created_at: nowIso(), updated_at: null, archived_at: null }],
    org_units: [{ id: 'u-src', company_id: 'co-1', parent_id: null, kind: 'DEPARTMENT', name: 'Source Dept', description: null, created_at: nowIso(), updated_at: null, archived_at: null }],
  });

  const result = validateSnapshot(snap, db, { on_conflict: 'skip' });

  // The company is a duplicate and will be skipped. Its child must not then be
  // silently re-parented onto the target's unrelated company of the same id.
  const unitWillInsert = JSON.stringify(result).includes('u-src');
  if (result.ok && unitWillInsert) {
    assert.fail(
      'import would attach the snapshot unit to an existing but DIFFERENT company of the same id; '
      + 'a skipped parent must either block its children or be reported as a conflict',
    );
  }
  assert.ok(
    result.conflicts?.length > 0 || !result.ok,
    'a name mismatch on a skipped parent must be surfaced as a conflict, not accepted silently',
  );
});

test('F3: unknown snapshot tables must be rejected, never silently ignored', (t) => {
  const dbPath = fullSchemaDbPath(t);
  const db = new DatabaseSync(dbPath);
  t.after(() => { try { db.close(); } catch { /* closed */ } });
  const snap = snapshot({});
  // A table the importer does not know about, carrying real rows.
  snap.tables.org_audit = [{ id: 'a-1', entity: 'company', entity_id: 'co-1', action: 'created', actor: 'ali', at: nowIso() }];
  snap.counts.org_audit = 1;
  snap.content_sha256 = computeTablesSha256(snap.tables);

  const result = validateSnapshot(snap, db, {});

  assert.equal(
    result.ok, false,
    'a snapshot carrying a table the importer cannot insert must be rejected, '
    + 'otherwise historical and audit rows are discarded while the import reports success',
  );
  assert.ok(
    JSON.stringify(result.errors ?? []).includes('org_audit'),
    `the rejection must name the unsupported table; got: ${JSON.stringify(result.errors)}`,
  );
});

// ── F4 ─────────────────────────────────────────────────────────────────────

test('F4: CLI dry-run must not change the target journal mode', (t) => {
  const dir = tempDir(t);
  const dbPath = path.join(dir, 'target.db');

  // A target in the default journal mode, with organizational data present.
  const seed = new DatabaseSync(dbPath);
  initOrgSchema(seed);
  createCompany(seed, { id: 'co-keep', name: 'Keep Co', nowIso });
  const before = seed.prepare('PRAGMA journal_mode').get().journal_mode;
  seed.close();

  const snapPath = path.join(dir, 'snap.json');
  fs.writeFileSync(snapPath, JSON.stringify(snapshot({})));

  spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'import-organization.mjs'),
    '--snapshot', snapPath, '--db', dbPath, '--dry-run',
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true });

  const after = new DatabaseSync(dbPath, { readOnly: true });
  const mode = after.prepare('PRAGMA journal_mode').get().journal_mode;
  after.close();

  assert.equal(
    String(mode).toLowerCase(), String(before).toLowerCase(),
    `dry-run changed the persistent journal mode from ${before} to ${mode}; a dry run must leave the target byte-for-byte alone`,
  );
});
