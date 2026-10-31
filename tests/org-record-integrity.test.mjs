import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initOrgSchema, seedOperatingOrg, readOrg } from '../server/operating-org.mjs';

const nowIso = () => '2026-10-31T00:00:00.000Z';

test('org records: create/readback stable ids and duplicate/invalid refs', async () => {
  const db = new DatabaseSync(':memory:');
  initOrgSchema(db);
  seedOperatingOrg(db, nowIso);

  const mod = await import('../server/operating-org.mjs');
  const { createCompany, createUnit, createPosition, createPerson, createAppointment } = mod;

  // duplicate company id
  assert.throws(() => createCompany(db, { id: 'starq-technologies', name: 'Dup', nowIso }), /already exists/);

  // invalid parent unit
  assert.throws(() => createUnit(db, { company_id: 'starq-technologies', parent_id: 'nope', kind: 'TEAM', name: 'T', nowIso }), /Unknown parent unit/);

  // invalid company
  assert.throws(() => createUnit(db, { company_id: 'nope', kind: 'TEAM', name: 'T', nowIso }), /Unknown company/);

  // create unit stable id
  const unit = createUnit(db, { company_id: 'starq-technologies', kind: 'TEAM', name: 'QA Team', nowIso });
  assert.ok(unit.id);
  const reread = db.prepare('SELECT * FROM org_units WHERE id = ?').get(unit.id);
  assert.equal(reread.id, unit.id);

  // invalid reports_to position
  assert.throws(() => createPosition(db, { unit_id: unit.id, title: 'X', reports_to_position_id: 'nope', nowIso }), /Unknown reports-to position/);

  // duplicate handle person
  createPerson(db, { handle: 'tester', display_name: 'Tester', kind: 'HUMAN', nowIso });
  assert.throws(() => createPerson(db, { handle: 'tester', display_name: 'Tester2', kind: 'HUMAN', nowIso }), /Handle already recorded/);

  // appointment invalid person/position
  assert.throws(() => createAppointment(db, { position_id: 'nope', person_id: 'person-ali', nowIso }), /Unknown position/);

  // readOrg includes created
  const org = readOrg(db, { generatedAt: nowIso(), roomPost: 'OFF' });
  assert.ok(org.units.some((u) => u.id === unit.id));
});