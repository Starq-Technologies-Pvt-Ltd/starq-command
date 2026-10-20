import type { DimensionState, FixLocus, StageState, SurfaceState } from './contracts';

/**
 * Single vocabulary mapping truth states to presentation.
 *
 * Components must not invent their own colour logic. Every state in this
 * product has exactly one meaning, and it is defined against the canonical
 * stage_classification_key, not against taste.
 */

export const STAGE_TONE: Record<StageState, { chip: string; bar: string; label: string }> = {
  implemented: {
    chip: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30',
    bar: 'bg-truth-ok',
    label: 'implemented',
  },
  partial: {
    chip: 'bg-stage-partial/12 text-stage-partial border-stage-partial/30',
    bar: 'bg-stage-partial',
    label: 'partial',
  },
  'schema-only': {
    chip: 'bg-stage-schema_only/12 text-stage-schema_only border-stage-schema_only/30',
    bar: 'bg-stage-schema_only',
    label: 'schema-only',
  },
  'test-only': {
    chip: 'bg-stage-test_only/12 text-stage-test_only border-stage-test_only/30',
    bar: 'bg-stage-test_only',
    label: 'test-only',
  },
  absent: {
    chip: 'bg-stage-absent/12 text-stage-absent border-stage-absent/30',
    bar: 'bg-stage-absent',
    label: 'absent',
  },
  UNKNOWN: {
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
    bar: 'bg-truth-unknown',
    label: 'UNKNOWN',
  },
};

/** Worst-state-first ranking, used for family colouring. Never an average. */
export const STAGE_SEVERITY: Record<StageState, number> = {
  absent: 5,
  UNKNOWN: 4,
  'test-only': 3,
  'schema-only': 2,
  partial: 1,
  implemented: 0,
};

export function worstStage(states: StageState[]): StageState {
  if (!states.length) return 'UNKNOWN';
  return states.reduce((worst, s) => (STAGE_SEVERITY[s] > STAGE_SEVERITY[worst] ? s : worst), states[0]);
}

export const SURFACE_TONE: Record<SurfaceState, { chip: string; dot: string; label: string }> = {
  OK: { chip: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30', dot: 'bg-truth-ok', label: 'IN SYNC' },
  STALE: {
    chip: 'bg-truth-stale-soft text-truth-stale border-truth-stale/30',
    dot: 'bg-truth-stale',
    label: 'STALE',
  },
  DRIFT: {
    chip: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
    dot: 'bg-truth-drift',
    label: 'DRIFT',
  },
  UNAVAILABLE: {
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
    dot: 'bg-truth-unknown',
    label: 'UNAVAILABLE',
  },
  UNREADABLE: {
    chip: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
    dot: 'bg-truth-drift',
    label: 'UNREADABLE',
  },
};

/**
 * Execution-state chips. `activity_state_vocabulary` from the contract,
 * with STALE and CONFLICT handled as overlays rather than as task states.
 */
export const EXECUTION_TONE: Record<string, string> = {
  active: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30',
  reviewing: 'bg-stage-partial/12 text-stage-partial border-stage-partial/30',
  blocked: 'bg-stage-absent/12 text-stage-absent border-stage-absent/30',
  waiting: 'bg-truth-stale-soft text-truth-stale border-truth-stale/30',
  stopped: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  UNKNOWN: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  STALE: 'bg-truth-stale-soft text-truth-stale border-truth-stale/30',
  CONFLICT: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
  // ── Phase 3: canonical values that occur in the live ledger ─────────────
  //
  // `RETIRED` and `SYSTEM` are not styling choices. They are canonical
  // classifications that appear in `activity.json` today, and a chip that had
  // no entry for them would fall through to unstyled text — which is how a
  // retired identity ends up rendering like a working one.
  RETIRED: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  SYSTEM: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  STAFF: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30',
  ACTIVE: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30',
};

/**
 * Phase 3 — staff classification tones.
 *
 * Kept separate from `EXECUTION_TONE` because they answer different questions.
 * `EXECUTION_TONE` styles an agent's momentary activity state; this styles who
 * they ARE to the company. An agent can be `active` in execution and `RETIRED`
 * as staff, and both statements are true at once — which is exactly why they
 * need different chips.
 */
export const STAFF_CLASS_TONE: Record<
  string,
  { chip: string; label: string; meaning: string }
> = {
  STAFF: {
    chip: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30',
    label: 'STAFF',
    meaning: 'Canonical staff classification. Counts as active only when canonical source also says so.',
  },
  SYSTEM: {
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
    label: 'SYSTEM',
    meaning: 'A machine participant on the bus, not a person or an agent seat.',
  },
  RETIRED: {
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
    label: 'RETIRED',
    meaning:
      'Canonical source records this identity as retired. Never rendered as active staff, never merged into another handle.',
  },
  UNKNOWN: {
    chip: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
    label: 'UNKNOWN',
    meaning: 'Canonical source records no classification. Not inferred.',
  },
};

/**
 * Phase 3 — constraint rail tones, by kind.
 *
 * These are the conditions that would silently corrupt the roster if they were
 * smoothed over, so each gets a distinct visual weight. `TRUTH_DISAGREEMENT`
 * is the loudest: it is not a fault in the system, it is two canonical sources
 * disagreeing with each other, and that must never be tidied into one answer.
 */
export const CONSTRAINT_TONE: Record<string, { chip: string; accent: string }> = {
  IDENTITY_CONFLICT: {
    chip: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
    accent: 'border-truth-drift/40',
  },
  UNKNOWN_IDENTITY: {
    chip: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
    accent: 'border-truth-drift/40',
  },
  REVOKED_IDENTITY: {
    chip: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
    accent: 'border-truth-drift/40',
  },
  STALE_EXECUTION_PROJECTION: {
    chip: 'bg-truth-stale-soft text-truth-stale border-truth-stale/30',
    accent: 'border-truth-stale/40',
  },
  TRUTH_DISAGREEMENT: {
    chip: 'bg-truth-founder-soft text-truth-founder border-truth-founder/40',
    accent: 'border-truth-founder/40',
  },
  /*
    Seat-curation constraints. Three of these are ABSTENCES, not conflicts, and
    they are deliberately toned differently from `TRUTH_DISAGREEMENT`:

      · HERDR_MANIFEST_UNAVAILABLE and NO_HERDR_MANIFEST_ROW mean "we did not
        read it" / "there is no row". Nothing disagrees with anything, and
        colouring these as drift would accuse a source of conflict it does not
        have.
      · HERDR_HOST_CONFLICT IS a real disagreement between two declared sources
        and is toned like one. Elder is the live case.
      · DECLARED_SEAT_NOT_OBSERVED is a fact about the ledger's window, so it
        takes the stale tone: read, but the source has moved.
      · STAFF_ACCOUNTING_INCOMPLETE is the loudest thing on this rail. If it
        fires, the board is hiding a handle, and it must not look like the
        quiet categories above it.
  */
  HERDR_MANIFEST_UNAVAILABLE: {
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
    accent: 'border-truth-unknown/40',
  },
  NO_HERDR_MANIFEST_ROW: {
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
    accent: 'border-truth-unknown/40',
  },
  HERDR_HOST_CONFLICT: {
    chip: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
    accent: 'border-truth-drift/40',
  },
  DECLARED_SEAT_NOT_OBSERVED: {
    chip: 'bg-truth-stale-soft text-truth-stale border-truth-stale/30',
    accent: 'border-truth-stale/40',
  },
  STAFF_ACCOUNTING_INCOMPLETE: {
    chip: 'bg-truth-founder-soft text-truth-founder border-truth-founder/40',
    accent: 'border-truth-founder/40',
  },
};

/** The capacity-class axis, as declared by the Founder. Not a measurement. */
export const CAPACITY_CLASS_TONE: Record<string, { chip: string; label: string; meaning: string }> = {
  PAID_L1: {
    chip: 'bg-truth-founder-soft text-truth-founder border-truth-founder/40',
    label: 'PAID L1',
    meaning:
      'Declared paid first-tier seat. Its quota is not tracked by any system on this floor; usage stays manual in staff-state.json.',
  },
  FREE_SUPPORT: {
    chip: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30',
    label: 'FREE / OFFLOAD',
    meaning:
      'Declared free or offload seat. Preferable to a paid seat when it can absorb the task.',
  },
  UNKNOWN: {
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
    label: 'UNKNOWN',
    meaning: 'No capacity class is declared for this handle.',
  },
};

/** Role family, the builder/verifier separation the floor already enforces. */
export const ROLE_FAMILY_TONE: Record<string, { label: string; meaning: string }> = {
  BUILDER: { label: 'BUILDER', meaning: 'Builds. Verification is not this seat\'s declared role.' },
  VERIFIER: { label: 'VERIFIER', meaning: 'Verifies. This seat is not declared to build.' },
  BUILDER_VERIFIER: { label: 'BUILDER + VERIFIER', meaning: 'Declared to both build and verify.' },
  BUILDER_VERIFIER_SUPPORT: {
    label: 'BUILDER + VERIFIER + SUPPORT',
    meaning: 'Declared to build, verify and carry support load.',
  },
  UNKNOWN: { label: 'UNKNOWN', meaning: 'No role family is declared for this handle.' },
};

export const WORK_STATE_TONE: Record<string, string> = {
  VERIFIED: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30',
  ACTIVE: 'bg-stage-partial/12 text-stage-partial border-stage-partial/30',
  READY: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  REVIEW: 'bg-truth-stale-soft text-truth-stale border-truth-stale/30',
  BLOCKED: 'bg-stage-absent/12 text-stage-absent border-stage-absent/30',
  GATED: 'bg-stage-schema_only/12 text-stage-schema_only border-stage-schema_only/30',
  CORRECTIVE: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
  PRESERVED: 'bg-truth-founder-soft text-truth-founder border-truth-founder/30',
  UNMAPPED: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
};

// ── Phase 2: control-plane dimension states ────────────────────────────────
//
// A separate vocabulary from STAGE_TONE on purpose. The two answer different
// questions and must never share a chip: `absent` is a process-stage verdict,
// `FAIL` is a control-plane verdict. A family can be fully implemented while
// the ledger that records it is DRIFT, and rendering both in the same colour
// would assert a relationship that does not exist.
export const DIMENSION_TONE: Record<
  DimensionState,
  { chip: string; dot: string; label: string; meaning: string }
> = {
  OK: {
    chip: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30',
    dot: 'bg-truth-ok',
    label: 'OK',
    meaning: 'read, and it agrees with what it is checked against',
  },
  FAIL: {
    chip: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
    dot: 'bg-truth-drift',
    label: 'FAIL',
    meaning: 'read, and it does not agree — a real fault, not a gap in knowledge',
  },
  STALE: {
    chip: 'bg-truth-stale-soft text-truth-stale border-truth-stale/30',
    dot: 'bg-truth-stale',
    label: 'STALE',
    meaning: 'read, but its source has moved since it was produced',
  },
  DRIFT: {
    chip: 'bg-truth-drift-soft text-truth-drift border-truth-drift/30',
    dot: 'bg-truth-drift',
    label: 'DRIFT',
    meaning: 'the projection disagrees with the provenance it declares',
  },
  UNAVAILABLE: {
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
    dot: 'bg-truth-unknown',
    label: 'UNAVAILABLE',
    meaning: 'could not be reached. Says nothing about whether it would agree',
  },
  UNREADABLE: {
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
    dot: 'bg-truth-unknown',
    label: 'UNREADABLE',
    meaning: 'present but could not be parsed or hashed',
  },
  UNKNOWN: {
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30 border-dashed',
    dot: 'bg-truth-unknown',
    label: 'UNKNOWN',
    meaning: 'never assessed. Not a pass, and not a failure — nobody checked',
  },
};

/** Fix locus → what it actually means for the Founder. */
export const FIX_LOCUS_TONE: Record<FixLocus, { chip: string; label: string; meaning: string }> = {
  SOURCE: {
    chip: 'border-truth-drift/30 bg-truth-drift-soft text-truth-drift',
    label: 'SOURCE',
    meaning: 'the defect is in canonical code. Fixing this machine changes nothing',
  },
  SOURCE_FIXED_RECORD_PRESERVED: {
    chip: 'border-truth-founder/30 bg-truth-founder-soft text-truth-founder',
    label: 'SOURCE FIXED · RECORD PRESERVED',
    meaning: 'the cause was fixed; the failed artefact is preserved on purpose and stays failed',
  },
  RUNTIME: {
    chip: 'border-truth-stale/30 bg-truth-stale-soft text-truth-stale',
    label: 'RUNTIME',
    meaning: 'the canonical code is sound; this environment is what cannot run it',
  },
  NONE: {
    chip: 'border-truth-unknown/30 bg-truth-unknown-soft text-truth-unknown',
    label: 'NOT FIXED ANYWHERE',
    meaning: 'open. No source fix and no runtime compensation',
  },
};
