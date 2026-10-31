import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  initOrgSchema,
  seedOperatingOrg,
  readOrg,
  readOrgHistory,
  createCompany,
  updateCompany,
  createUnit,
  updateUnit,
  createPosition,
  updatePosition,
  createPerson,
  updatePerson,
  createAppointment,
  endAppointment,
} from '../server/operating-org.mjs';

const nowIso = () => '2026-10-31T00:00:00.000Z';

test('org records: create/readback stable ids and duplicate/invalid refs', () => {
  const db = new DatabaseSync(':memory:');
  initOrgSchema(db);
  seedOperatingOrg(db, nowIso);

  // duplicate company id
  assert.throws(() => createCompany(db, { id: 'starq-technologies', name: 'Dup', nowIso }), /already exists/);

  // invalid parent unit
  assert.throws(() => createUnit(db, { company_id: 'starq-technologies', parent_id: 'nope', kind: 'TEAM', name: 'T', nowIso }), /Unknown parent unit/);

  // invalid company
  assert.throws(() => createUnit(db, { company_id: 'nope', kind: 'TEAM', name: 'T', nowIso }), /Unknown company/);

  // create unit stable id
  const unit = createUnit(db, { company_id: 'starq-technologies', kind: 'TEAM', name: 'QA Team', actor: 'ali', nowIso });
  assert.ok(unit.id);
  const reread = db.prepare('SELECT * FROM org_units WHERE id = ?').get(unit.id);
  assert.equal(reread.id, unit.id);

  // invalid reports_to position
  assert.throws(() => createPosition(db, { unit_id: unit.id, title: 'X', reports_to_position_id: 'nope', nowIso }), /Unknown reports-to position/);

  // duplicate handle person
  createPerson(db, { handle: 'tester', display_name: 'Tester', kind: 'HUMAN', actor: 'ali', nowIso });
  assert.throws(() => createPerson(db, { handle: 'tester', display_name: 'Tester2', kind: 'HUMAN', nowIso }), /Handle already recorded/);

  // appointment invalid person/position
  assert.throws(() => createAppointment(db, { position_id: 'nope', person_id: 'person-ali', nowIso }), /Unknown position/);

  // readOrg includes created
  const org = readOrg(db, { generatedAt: nowIso(), roomPost: 'OFF' });
  assert.ok(org.units.some((u) => u.id === unit.id));
});

test('org records (CV-AG1): PATCH company/unit/position/person, cycle checks, soft archive, end/reassign appointment, and org_audit', () => {
  const db = new DatabaseSync(':memory:');
  initOrgSchema(db);
  seedOperatingOrg(db, nowIso);

  // 1. Update company
  const updatedCo = updateCompany(db, 'starq-technologies', {
    name: 'Starq Technologies HQ',
    notes: 'Updated notes',
    actor: 'ali',
    channel: 'ui',
    nowIso,
  });
  assert.equal(updatedCo.name, 'Starq Technologies HQ');

  // 2. Unit hierarchy & cycle detection
  const uA = createUnit(db, { id: 'unit-a', company_id: 'starq-technologies', kind: 'DEPARTMENT', name: 'Dept A', actor: 'ali', nowIso });
  const uB = createUnit(db, { id: 'unit-b', company_id: 'starq-technologies', parent_id: uA.id, kind: 'TEAM', name: 'Team B', actor: 'ali', nowIso });
  const uC = createUnit(db, { id: 'unit-c', company_id: 'starq-technologies', parent_id: uB.id, kind: 'OFFICE', name: 'Office C', actor: 'ali', nowIso });
  assert.equal(uC.kind, 'OFFICE');

  // Self-parent cycle check
  assert.throws(
    () => updateUnit(db, uA.id, { parent_id: uA.id, actor: 'ali', nowIso }),
    (err) => err.code === 'UNIT_CYCLE',
  );
  // Ancestor cycle check (uA -> uC when uC -> uB -> uA)
  assert.throws(
    () => updateUnit(db, uA.id, { parent_id: uC.id, actor: 'ali', nowIso }),
    (err) => err.code === 'UNIT_CYCLE',
  );

  // 3. Position hierarchy & cycle detection
  const p1 = createPosition(db, { id: 'pos-1', unit_id: uA.id, title: 'Director A', actor: 'ali', nowIso });
  const p2 = createPosition(db, { id: 'pos-2', unit_id: uB.id, title: 'Lead B', reports_to_position_id: p1.id, actor: 'ali', nowIso });
  assert.throws(
    () => updatePosition(db, p1.id, { reports_to_position_id: p2.id, actor: 'ali', nowIso }),
    (err) => err.code === 'POSITION_CYCLE',
  );

  // 4. Soft archive & ?include=archived filtering
  updateUnit(db, uC.id, { archived: true, actor: 'ali', nowIso });
  const activeOrg = readOrg(db, { generatedAt: nowIso(), roomPost: 'OFF', includeArchived: false });
  assert.ok(!activeOrg.units.some((u) => u.id === uC.id), 'archived unit excluded by default');
  const fullOrg = readOrg(db, { generatedAt: nowIso(), roomPost: 'OFF', includeArchived: true });
  assert.ok(fullOrg.units.some((u) => u.id === uC.id && u.archived_at !== null), 'archived unit included with includeArchived=true');

  // Cannot create a position in an archived unit
  assert.throws(
    () => createPosition(db, { unit_id: uC.id, title: 'Ghost Pos', actor: 'ali', nowIso }),
    (err) => err.code === 'ARCHIVED_TARGET',
  );

  // 5. End and reassign appointment without deleting rows
  const person1 = createPerson(db, { handle: 'alice', display_name: 'Alice', kind: 'HUMAN', actor: 'ali', nowIso });
  const person2 = createPerson(db, { handle: 'bob', display_name: 'Bob', kind: 'HUMAN', actor: 'ali', nowIso });
  const appt1 = createAppointment(db, { position_id: p2.id, person_id: person1.id, notes: 'Initial appointment', actor: 'ali', nowIso });
  assert.equal(appt1.status, 'ACTIVE');

  const { ended, reassigned } = endAppointment(db, appt1.id, {
    notes: 'Completed rotation',
    reassign_to_person_id: person2.id,
    reassign_notes: 'Taking over Lead B',
    actor: 'ali',
    nowIso,
  });
  assert.equal(ended.status, 'ENDED');
  assert.ok(ended.ended_at);
  assert.ok(reassigned);
  assert.equal(reassigned.status, 'ACTIVE');
  assert.equal(reassigned.person_id, person2.id);

  // Verify old appointment is still in DB (never deleted)
  const allAppts = db.prepare('SELECT * FROM org_appointments WHERE position_id = ?').all(p2.id);
  assert.equal(allAppts.length, 2);

  // 6. Verify org_audit recorded every change and is append-only
  const history = readOrgHistory(db, { entity: 'unit', id: uC.id });
  assert.equal(history.length, 2); // CREATE + ARCHIVE
  assert.equal(history[0].action, 'ARCHIVE');
  assert.equal(history[1].action, 'CREATE');

  assert.throws(
    () => db.prepare('DELETE FROM org_audit WHERE id = 1').run(),
    /org_audit is append-only/,
  );
  assert.throws(
    () => db.prepare("UPDATE org_audit SET action = 'TAMPER' WHERE id = 1").run(),
    /org_audit is append-only/,
  );
});
