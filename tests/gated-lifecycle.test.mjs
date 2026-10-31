/**
 * Gated lifecycle — Founder decision D1.
 *
 * Runs standalone and touches nothing:
 *   node --test tests/gated-lifecycle.test.mjs
 *
 * It opens no port, no database and no service, so it is safe to run while the
 * stack is live. The module under test is pure by construction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GATED_STAGES,
  PROVENANCE,
  allowedStageNext,
  assignmentLocked,
  columnDragToStage,
  evaluateStageTransition,
  nextPriorStage,
  stageToColumn,
} from '../server/gated-lifecycle.mjs';

const ENTERED = '2026-10-28T00:00:00.000Z';
const AFTER = '2026-10-28T01:00:00.000Z';
const BEFORE = '2026-10-27T23:00:00.000Z';

function task(over = {}) {
  return {
    id: 'CMD-001',
    stage: 'BACKLOG',
    prior_stage: null,
    owner: 'UNASSIGNED',
    verifier: 'UNASSIGNED',
    provenance: PROVENANCE.LIVE,
    depends_on: [],
    evidence_refs: [],
    room_authorization_ref: null,
    ...over,
  };
}

function ev({ to, note = null, t = task(), hold = null, holdBlocks = false, stageOf = () => 'CLOSED', entered = () => ENTERED, startRequiresAuthorization = undefined }) {
  return evaluateStageTransition({
    task: t, to, note, project: { name: 'Starq Command' }, hold, holdBlocks,
    stageOf, enteredAt: entered, startRequiresAuthorization,
  });
}

test('the nine gated stages survive', () => {
  assert.deepEqual([...GATED_STAGES], [
    'BACKLOG', 'READY', 'IN_PROGRESS', 'REVIEW', 'VERIFICATION',
    'ACCEPTANCE', 'CLOSED', 'BLOCKED', 'FOUNDER_GATE',
  ]);
});

test('nine stages project onto exactly five Nexus columns', () => {
  assert.equal(stageToColumn('BACKLOG'), 'TODO');
  assert.equal(stageToColumn('READY'), 'NEXT');
  assert.equal(stageToColumn('IN_PROGRESS'), 'IN_PROGRESS');
  assert.equal(stageToColumn('REVIEW'), 'IN_PROGRESS');
  assert.equal(stageToColumn('VERIFICATION'), 'IN_PROGRESS');
  assert.equal(stageToColumn('ACCEPTANCE'), 'DONE');
  assert.equal(stageToColumn('CLOSED'), 'DONE');
  assert.equal(stageToColumn('BLOCKED'), 'BLOCKED');
  assert.equal(stageToColumn('FOUNDER_GATE'), 'BLOCKED');
  const columns = new Set(GATED_STAGES.map(stageToColumn));
  assert.equal(columns.size, 5);
});

test('a card cannot be DRAGGED into acceptance: Done advances one gate only', () => {
  assert.equal(columnDragToStage(task({ stage: 'IN_PROGRESS' }), 'DONE'), 'REVIEW');
  assert.equal(columnDragToStage(task({ stage: 'REVIEW' }), 'DONE'), 'VERIFICATION');
  assert.equal(columnDragToStage(task({ stage: 'VERIFICATION' }), 'DONE'), 'ACCEPTANCE');
  assert.equal(columnDragToStage(task({ stage: 'ACCEPTANCE' }), 'DONE'), 'CLOSED');
  // and the ordinary columns map straight through, exactly as Nexus behaved
  assert.equal(columnDragToStage(task(), 'TODO'), 'BACKLOG');
  assert.equal(columnDragToStage(task(), 'NEXT'), 'READY');
  assert.equal(columnDragToStage(task(), 'BLOCKED'), 'BLOCKED');
});

test('HISTORICAL_NEXUS records drag freely — gates do not apply to history', () => {
  const historical = task({ provenance: PROVENANCE.HISTORICAL, stage: 'BACKLOG' });
  const r = ev({ to: 'CLOSED', t: historical });
  assert.equal(r.ok, true);
  assert.equal(r.ungated, true);
  // even a transition the gated machine forbids outright
  assert.equal(ev({ to: 'ACCEPTANCE', t: historical }).ok, true);
});

test('a LIVE card may not skip from BACKLOG to CLOSED', () => {
  const r = ev({ to: 'CLOSED' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TRANSITION_NOT_ALLOWED');
});

test('local operating mode: work starts without a Room authorization, and says so', () => {
  // Founder decision 2026-10-31: ungate ordinary task start.
  const r = ev({ to: 'IN_PROGRESS', t: task({ stage: 'READY' }) });
  assert.equal(r.ok, true);
  assert.equal(r.start_authorization, 'NOT_REQUIRED_LOCAL_POLICY', 'the basis is recorded, not implied');
});

test('a linked Room authorization is still recognised as the basis for a start', () => {
  const r = ev({ to: 'IN_PROGRESS', t: task({ stage: 'READY', room_authorization_ref: { sequence: 1 } }) });
  assert.equal(r.ok, true);
  assert.equal(r.start_authorization, 'ROOM_AUTHORIZED');
});

test('enterprise policy keeps the Room authorization requirement for a start', () => {
  const r = ev({ to: 'IN_PROGRESS', t: task({ stage: 'READY' }), startRequiresAuthorization: true });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AUTHORIZATION_REQUIRED');
});

test('work cannot start while a dependency is open — with or without authorization', () => {
  for (const ref of [null, { sequence: 1 }]) {
    const t = task({ stage: 'READY', room_authorization_ref: ref, depends_on: ['CMD-000'] });
    const r = ev({ to: 'IN_PROGRESS', t, stageOf: () => 'IN_PROGRESS' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'DEPENDENCY_OPEN');
  }
});

test('ungating start does not ungate closure: CLOSED still needs a Room authorization', () => {
  const r = ev({
    to: 'CLOSED',
    t: task({
      stage: 'ACCEPTANCE', owner: 'codex', verifier: 'claude', room_authorization_ref: null,
      evidence_refs: [{ kind: 'evidence', root_authority: true, mentions_task: true, received_at: AFTER }],
    }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AUTHORIZATION_REQUIRED');
});

test('review requires an owner', () => {
  const r = ev({ to: 'REVIEW', t: task({ stage: 'IN_PROGRESS' }) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'OWNER_REQUIRED');
});

test('verification requires a verifier who is NOT the owner', () => {
  const same = task({ stage: 'REVIEW', owner: 'codex', verifier: 'codex' });
  const r = ev({ to: 'VERIFICATION', t: same });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VERIFIER_REQUIRED');

  const ok = task({ stage: 'REVIEW', owner: 'codex', verifier: 'claude' });
  assert.equal(ev({ to: 'VERIFICATION', t: ok }).ok, true);
});

test('ACCEPTANCE refuses self-acceptance and demands the verifier own attestation', () => {
  const base = {
    stage: 'VERIFICATION', owner: 'codex', verifier: 'claude',
    room_authorization_ref: { sequence: 1 },
  };

  // no attestation at all
  let r = ev({ to: 'ACCEPTANCE', t: task(base) });
  assert.equal(r.code, 'VERIFIER_ATTESTATION_REQUIRED');

  // attestation sent by the OWNER, not the verifier — self-acceptance
  r = ev({
    to: 'ACCEPTANCE',
    t: task({ ...base, evidence_refs: [{ kind: 'evidence', senderHandle: 'codex', mentions_task: true, received_at: AFTER }] }),
  });
  assert.equal(r.code, 'VERIFIER_ATTESTATION_REQUIRED', 'the owner may not attest their own work');

  // right sender, but posted BEFORE the task entered VERIFICATION
  r = ev({
    to: 'ACCEPTANCE',
    t: task({ ...base, evidence_refs: [{ kind: 'evidence', senderHandle: 'claude', mentions_task: true, received_at: BEFORE }] }),
  });
  assert.equal(r.code, 'VERIFIER_ATTESTATION_REQUIRED', 'a record predating the stage is not its attestation');

  // the real thing
  r = ev({
    to: 'ACCEPTANCE',
    t: task({ ...base, evidence_refs: [{ kind: 'evidence', senderHandle: 'claude', mentions_task: true, received_at: AFTER }] }),
  });
  assert.equal(r.ok, true);
});

test('CLOSED requires an authenticated Founder record', () => {
  const base = {
    stage: 'ACCEPTANCE', owner: 'codex', verifier: 'claude',
    room_authorization_ref: { sequence: 1 },
  };

  let r = ev({ to: 'CLOSED', t: task(base) });
  assert.equal(r.code, 'FOUNDER_CLOSURE_REQUIRED');

  // a non-root sender cannot close
  r = ev({
    to: 'CLOSED',
    t: task({ ...base, evidence_refs: [{ kind: 'evidence', root_authority: false, mentions_task: true, received_at: AFTER }] }),
  });
  assert.equal(r.code, 'FOUNDER_CLOSURE_REQUIRED');

  r = ev({
    to: 'CLOSED',
    t: task({ ...base, evidence_refs: [{ kind: 'evidence', root_authority: true, mentions_task: true, received_at: AFTER }] }),
  });
  assert.equal(r.ok, true);
});

test('a LOCAL_LEDGER record never attests, whatever handle it claims', () => {
  // With Room posting off — the supported lifecycle's default — the PM service
  // mints LOCAL_LEDGER evidence whose senderHandle is the caller's own `actor`.
  // Before this guard, picking the verifier or "mustarq" in the Acting-as
  // picker satisfied acceptance and Founder closure.
  const local = (over) => ({
    authority: 'LOCAL_LEDGER', kind: 'evidence', mentions_task: true, received_at: AFTER, ...over,
  });

  let r = ev({
    to: 'ACCEPTANCE',
    t: task({
      stage: 'VERIFICATION', owner: 'codex', verifier: 'claude', room_authorization_ref: { sequence: 1 },
      evidence_refs: [local({ senderHandle: 'claude' })],
    }),
  });
  assert.equal(r.code, 'VERIFIER_ATTESTATION_REQUIRED', 'a claimed verifier is not an authenticated one');

  r = ev({
    to: 'CLOSED',
    t: task({
      stage: 'ACCEPTANCE', owner: 'codex', verifier: 'claude', room_authorization_ref: { sequence: 1 },
      evidence_refs: [local({ senderHandle: 'mustarq', root_authority: true })],
    }),
  });
  assert.equal(r.code, 'FOUNDER_CLOSURE_REQUIRED', 'a claimed Founder is not an authenticated one');
});

test('a project on hold cannot progress past READY', () => {
  const t = task({ stage: 'READY', room_authorization_ref: { sequence: 1 } });
  const r = ev({ to: 'IN_PROGRESS', t, hold: { state: 'ON_HOLD', authority: 'DEC-100' }, holdBlocks: true });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PROJECT_ON_HOLD');
});

test('rejection back to READY is a rejection, and needs a note', () => {
  const t = task({ stage: 'VERIFICATION', owner: 'codex', verifier: 'claude' });
  let r = ev({ to: 'READY', t });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOTE_REQUIRED');

  r = ev({ to: 'READY', t, note: 'fails the integration test' });
  assert.equal(r.ok, true);
  assert.equal(r.rejecting, true, 'returning from VERIFICATION is recorded as a rejection');
});

test('owner and verifier freeze once the work is being judged', () => {
  assert.equal(assignmentLocked(task({ stage: 'VERIFICATION' })), true);
  assert.equal(assignmentLocked(task({ stage: 'ACCEPTANCE' })), true);
  assert.equal(assignmentLocked(task({ stage: 'IN_PROGRESS' })), false);
  assert.equal(
    assignmentLocked(task({ stage: 'VERIFICATION', provenance: PROVENANCE.HISTORICAL })),
    false,
    'history is not locked',
  );
});

test('BLOCKED remembers where it came from, and returns there', () => {
  const t = task({ stage: 'IN_PROGRESS' });
  assert.equal(nextPriorStage(t, 'BLOCKED'), 'IN_PROGRESS');
  const blocked = task({ stage: 'BLOCKED', prior_stage: 'IN_PROGRESS' });
  assert.equal(nextPriorStage(blocked, 'FOUNDER_GATE'), 'IN_PROGRESS', 'does not overwrite with BLOCKED');
  assert.ok(allowedStageNext(blocked).includes('IN_PROGRESS'));
});

test('CLOSED is terminal', () => {
  assert.deepEqual(allowedStageNext(task({ stage: 'CLOSED' })), []);
});
