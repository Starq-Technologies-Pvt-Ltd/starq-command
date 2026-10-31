/**
 * STARQ // COMMAND — the gated production lifecycle, as a module.
 *
 * Authority: Founder decision D1 (28 Oct 2026) — "KEEP the gated lifecycle.
 * Preserve the existing review, independent verification, acceptance and
 * closure mechanisms. Integrate the Nexus Kanban functionality without
 * sacrificing these capabilities."
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * The gated lifecycle and the Nexus five-column board were being treated as
 * alternatives: the working tree had replaced BACKLOG/READY/IN_PROGRESS/REVIEW/
 * VERIFICATION/ACCEPTANCE/CLOSED + BLOCKED + FOUNDER_GATE with a flat board
 * whose own header read "any column to any column; no review/accept/gate
 * lifecycle". They are not alternatives. They are two AXES of one task:
 *
 *   stage         what the organisation has PROVEN about this work   (governance)
 *   board_column  where the card sits on a five-column board         (view)
 *
 * `stage` is authoritative. `board_column` is DERIVED from it and is never
 * stored, because a derived value that is also stored is a value that can
 * disagree with itself.
 *
 * ── PROVENANCE DECIDES WHETHER GATES APPLY ──────────────────────────────────
 *
 * 1,305 Nexus records were imported as history. Gating history is meaningless:
 * nobody is going to produce a 2026-06 verifier attestation for a card that
 * closed in June. Worse, the import had to synthesise a `LOCAL_LEDGER`
 * authorisation token to satisfy the gate's shape — a self-issued credential,
 * which is exactly the thing the gate exists to refuse.
 *
 * So provenance, not policy, decides:
 *
 *   HISTORICAL_NEXUS   history. Drags freely, exactly as it did in Nexus.
 *                      No gate applies. It is a record of what happened.
 *   LIVE               work this organisation is doing now. Fully gated.
 *
 * This is what lets both things be true at once: the board behaves like Nexus
 * for the 1,305 imported cards, and like a software factory for new work.
 *
 * ── THE GUARDS ARE REPRODUCED, NOT REINVENTED ───────────────────────────────
 *
 * Every rule below is carried over verbatim in meaning from the committed
 * pm-service.mjs at 95c3903 (owner-before-review, verifier != owner,
 * verifier-attested acceptance, Founder-attested closure, assignment lock,
 * hold blocking, dependency closure, note-on-rejection). Nothing is relaxed.
 * The only change is WHERE they live.
 *
 * This module is pure: it throws nothing and touches no database. It returns
 * refusals as values, and the caller maps them onto its own error type.
 */

/** The authoritative governance axis. Order is the production order. */
export const GATED_STAGES = Object.freeze([
  'BACKLOG',
  'READY',
  'IN_PROGRESS',
  'REVIEW',
  'VERIFICATION',
  'ACCEPTANCE',
  'CLOSED',
  'BLOCKED',
  'FOUNDER_GATE',
]);

/** The single forward step from each stage. Used when a drag says "advance". */
export const STAGE_FORWARD = Object.freeze({
  BACKLOG: 'READY',
  READY: 'IN_PROGRESS',
  IN_PROGRESS: 'REVIEW',
  REVIEW: 'VERIFICATION',
  VERIFICATION: 'ACCEPTANCE',
  ACCEPTANCE: 'CLOSED',
  CLOSED: null,
});

/** Every legal transition. BLOCKED and FOUNDER_GATE return via prior_status. */
export const STAGE_ALLOWED = Object.freeze({
  BACKLOG: ['READY', 'BLOCKED', 'FOUNDER_GATE'],
  READY: ['IN_PROGRESS', 'BACKLOG', 'BLOCKED', 'FOUNDER_GATE'],
  IN_PROGRESS: ['REVIEW', 'READY', 'BLOCKED', 'FOUNDER_GATE'],
  REVIEW: ['VERIFICATION', 'READY', 'BLOCKED', 'FOUNDER_GATE'],
  VERIFICATION: ['ACCEPTANCE', 'READY', 'BLOCKED', 'FOUNDER_GATE'],
  ACCEPTANCE: ['CLOSED', 'READY', 'BLOCKED', 'FOUNDER_GATE'],
  CLOSED: [],
});

/** Returning to READY from a review stage is a REJECTION, and is logged as one. */
export const REJECTABLE = Object.freeze(new Set(['REVIEW', 'VERIFICATION', 'ACCEPTANCE']));

/** A project on hold cannot progress past READY. */
export const HOLD_BLOCKED_TARGETS = Object.freeze(
  new Set(['IN_PROGRESS', 'REVIEW', 'VERIFICATION', 'ACCEPTANCE', 'CLOSED']),
);

export const PROVENANCE = Object.freeze({ LIVE: 'LIVE', HISTORICAL: 'HISTORICAL_NEXUS' });

/**
 * The five-column view. Nexus parity is a PROJECTION of the nine stages, so a
 * card can never be in a column that disagrees with its governance state.
 */
export const STAGE_TO_COLUMN = Object.freeze({
  BACKLOG: 'TODO',
  READY: 'NEXT',
  IN_PROGRESS: 'IN_PROGRESS',
  REVIEW: 'IN_PROGRESS',
  VERIFICATION: 'IN_PROGRESS',
  ACCEPTANCE: 'DONE',
  CLOSED: 'DONE',
  BLOCKED: 'BLOCKED',
  FOUNDER_GATE: 'BLOCKED',
});

export function stageToColumn(stage) {
  return STAGE_TO_COLUMN[stage] ?? 'TODO';
}

export function allowedStageNext(task) {
  if (task.stage === 'BLOCKED' || task.stage === 'FOUNDER_GATE') {
    const prior = task.prior_stage || 'BACKLOG';
    return [...new Set([prior, STAGE_FORWARD[prior], 'BLOCKED', 'FOUNDER_GATE'].filter(Boolean))]
      .filter((s) => s !== task.stage);
  }
  return STAGE_ALLOWED[task.stage] ?? [];
}

/**
 * Translate a five-column DRAG into a stage transition.
 *
 * This is the heart of "Nexus kanban without losing the gates". On a LIVE card
 * the operator drags exactly as they did in Nexus, and the drag is read as an
 * INTENT which the gates then adjudicate:
 *
 *   -> To Do       BACKLOG
 *   -> Next Up     READY
 *   -> In Progress IN_PROGRESS
 *   -> Blocked     BLOCKED
 *   -> Done        advance ONE forward stage, not a jump to CLOSED.
 *
 * That last line is the whole design. Dragging to Done from IN_PROGRESS asks
 * for REVIEW, not closure; the card visibly stays in the In Progress column
 * until it has actually passed verification, and only reaches Done at
 * ACCEPTANCE. The operator keeps a one-gesture workflow and the organisation
 * keeps its proof chain. A card cannot be dragged into being accepted.
 */
export function columnDragToStage(task, column) {
  switch (column) {
    case 'TODO': return 'BACKLOG';
    case 'NEXT': return 'READY';
    case 'IN_PROGRESS': return 'IN_PROGRESS';
    case 'BLOCKED': return 'BLOCKED';
    case 'DONE': return STAGE_FORWARD[task.stage] ?? null;
    default: return null;
  }
}

const refuse = (status, code, message, extra) => ({ ok: false, status, code, message, extra });

/**
 * Adjudicate one stage transition.
 *
 * Pure. The caller supplies the facts this cannot know — the project's hold,
 * how to read a dependency's stage, and when the task entered a given stage —
 * and receives either { ok: true, ... } or a structured refusal.
 *
 * @param {object}   a
 * @param {object}   a.task          current task (stage, prior_stage, owner, verifier, provenance, depends_on, evidence_refs, room_authorization_ref)
 * @param {string}   a.to            target stage
 * @param {string?}  a.note          operator note
 * @param {object}   a.project       { name }
 * @param {object?}  a.hold          effective hold, or null
 * @param {boolean}  a.holdBlocks    whether that hold blocks progress
 * @param {(id:string)=>string|null} a.stageOf        a dependency's stage
 * @param {(stage:string)=>string|null} a.enteredAt   ISO time this task entered a stage
 * @param {boolean?} a.startRequiresAuthorization  enterprise policy: demand a Room
 *        authorization reference before work starts. Off in the local operating mode.
 */
export function evaluateStageTransition({
  task, to, note, project, hold, holdBlocks, stageOf, enteredAt,
  startRequiresAuthorization = false,
}) {
  // HISTORY IS NOT GATED. An imported Nexus card moves like a Nexus card.
  if (task.provenance === PROVENANCE.HISTORICAL) {
    if (!GATED_STAGES.includes(to)) {
      return refuse(400, 'STAGE_INVALID', `stage must be one of ${GATED_STAGES.join(', ')}.`);
    }
    return { ok: true, rejecting: false, ungated: true, reason: 'HISTORICAL_NEXUS record; gates do not apply.' };
  }

  if (!GATED_STAGES.includes(to)) {
    return refuse(400, 'STAGE_INVALID', `stage must be one of ${GATED_STAGES.join(', ')}.`);
  }

  const allowed = allowedStageNext(task);
  if (!allowed.includes(to)) {
    return refuse(409, 'TRANSITION_NOT_ALLOWED',
      `${task.stage} -> ${to} is not allowed. Allowed: ${allowed.join(', ') || 'none'}.`);
  }

  if (holdBlocks && HOLD_BLOCKED_TARGETS.has(to)) {
    return refuse(409, 'PROJECT_ON_HOLD',
      `${project?.name ?? 'This project'} is ${hold?.state ?? 'ON_HOLD'}${hold?.authority ? ` (${hold.authority})` : ''}; tasks cannot progress past READY until the Founder lifts the hold.`);
  }

  const rejecting = to === 'READY' && REJECTABLE.has(task.stage);
  if ((rejecting || to === 'BLOCKED' || to === 'FOUNDER_GATE') && (!note || note.length < 5)) {
    return refuse(400, 'NOTE_REQUIRED',
      `A note of at least 5 characters is required for ${rejecting ? 'a rejection' : to}.`);
  }

  /*
    Starting work is an ORDINARY operation (Founder decision, 2026-10-31: ungate
    task start in the private single-Founder operating mode). It is audited, not
    authorised: the caller records which basis applied. The enterprise policy
    that demands a Room authorization first is kept behind
    `startRequiresAuthorization`, not deleted. Judgement gates below —
    verifier attestation and Founder closure — are unaffected.
  */
  let startAuthorization;
  if (to === 'IN_PROGRESS') {
    if (task.room_authorization_ref) {
      startAuthorization = 'ROOM_AUTHORIZED';
    } else if (startRequiresAuthorization) {
      return refuse(409, 'AUTHORIZATION_REQUIRED',
        'A verified Room authorization reference is required before work starts.');
    } else {
      startAuthorization = 'NOT_REQUIRED_LOCAL_POLICY';
    }
    const open = (task.depends_on ?? []).filter((dep) => stageOf(dep) !== 'CLOSED');
    if (open.length) {
      return refuse(409, 'DEPENDENCY_OPEN', `Dependencies not closed: ${open.join(', ')}.`);
    }
  }

  if (to === 'REVIEW' && task.owner === 'UNASSIGNED') {
    return refuse(409, 'OWNER_REQUIRED', 'Assign an owner before review.');
  }

  if (to === 'VERIFICATION' && (task.verifier === 'UNASSIGNED' || task.verifier === task.owner)) {
    return refuse(409, 'VERIFIER_REQUIRED',
      'Assign an independent verifier (different from the owner) before verification.');
  }

  /*
    The proof is the Room-AUTHENTICATED SENDER of a linked record, never the
    self-declared `actor` field. The record must name this task and must
    post-date the stage entry, so a record written before the work was even
    submitted cannot be reused as its attestation.
  */
  // A LOCAL_LEDGER ref is minted by the PM service from the caller's own
  // `actor` field whenever Room posting is off — which the supported lifecycle
  // always sets. It records a claim; it is not a Room-authenticated sender, so
  // it can never attest. Without this check, choosing "mustarq" in the
  // "Acting as" picker produced Founder-authority evidence.
  const attests = (ref, stage, senderOk) => {
    const since = enteredAt(stage);
    return ref.kind === 'evidence'
      && ref.authority !== 'LOCAL_LEDGER'
      && senderOk(ref)
      && ref.mentions_task === true
      && since !== null
      && Date.parse(ref.received_at) > Date.parse(since);
  };

  if (to === 'ACCEPTANCE') {
    if (task.verifier === 'UNASSIGNED' || task.verifier === task.owner) {
      return refuse(409, 'VERIFIER_REQUIRED',
        'An independent verifier (different from the owner) is required.');
    }
    const ok = (task.evidence_refs ?? []).some((r) => attests(r, 'VERIFICATION', (x) => x.senderHandle === task.verifier));
    if (!ok) {
      return refuse(409, 'VERIFIER_ATTESTATION_REQUIRED',
        `Acceptance needs a linked Room record sent by the assigned verifier (${task.verifier}), naming ${task.id}, posted after the task entered VERIFICATION. The actor field is not accepted as proof.`);
    }
  }

  if (to === 'CLOSED') {
    if (!task.room_authorization_ref) {
      return refuse(409, 'AUTHORIZATION_REQUIRED', 'Closure needs a Room authorization reference.');
    }
    const ok = (task.evidence_refs ?? []).some((r) => attests(r, 'ACCEPTANCE', (x) => x.root_authority === true));
    if (!ok) {
      return refuse(409, 'FOUNDER_CLOSURE_REQUIRED',
        `Closure needs a linked authenticated ROOT_GENESIS (Founder) Room record naming ${task.id}, posted after the task entered ACCEPTANCE.`);
    }
  }

  return {
    ok: true, rejecting, ungated: false,
    ...(startAuthorization ? { start_authorization: startAuthorization } : {}),
  };
}

/** Owner/verifier are frozen once a task is being judged. */
export function assignmentLocked(task) {
  return task.provenance !== PROVENANCE.HISTORICAL
    && ['VERIFICATION', 'ACCEPTANCE'].includes(task.stage);
}

/** The stage a BLOCKED/FOUNDER_GATE transition should remember. */
export function nextPriorStage(task, to) {
  if (to !== 'BLOCKED' && to !== 'FOUNDER_GATE') return null;
  return task.stage === 'BLOCKED' || task.stage === 'FOUNDER_GATE' ? task.prior_stage : task.stage;
}
