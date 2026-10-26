/**
 * Canonical contract types.
 *
 * These mirror the SHAPES the data service emits. They are deliberately
 * loose about anything the canonical source itself marks UNKNOWN, because a
 * strict type that forbids "UNKNOWN" would tempt a component into inventing
 * a value to satisfy the compiler. That is the exact failure this product
 * exists to prevent.
 */

export type SurfaceState = 'OK' | 'UNAVAILABLE' | 'STALE' | 'DRIFT' | 'UNREADABLE';

/** Canonical stage classification key, from contract.json. */
export type StageState =
  | 'implemented'
  | 'partial'
  | 'schema-only'
  | 'test-only'
  | 'absent'
  | 'UNKNOWN';

export type WorkState =
  | 'READY'
  | 'ACTIVE'
  | 'REVIEW'
  | 'BLOCKED'
  | 'GATED'
  | 'CORRECTIVE'
  | 'VERIFIED'
  | 'PRESERVED'
  | 'UNMAPPED';

export interface HealthCondition {
  key: string;
  state: SurfaceState;
  available: boolean;
}

export interface Health {
  overall: SurfaceState;
  conditions: HealthCondition[];
  counts: { ok: number; total: number };
}

export interface Stage {
  stage: string;
  state: StageState;
  serp: string[];
  evidence: string[];
  blocked_by: string | null;
  blocked_by_present?: boolean;
  note: string | null;
}

export interface ProcessFamily {
  id: string;
  name: string;
  maturity: string | null;
  headline: string | null;
  critical_blocker: string | null;
  critical_blocker_present?: boolean;
  stages: Stage[];
}

export interface ConvergenceGap {
  id: string;
  title: string;
  chains?: string[];
  why?: string;
  [k: string]: unknown;
}

export interface KnownDiscrepancy {
  id: string;
  item: string;
  roadmap_says?: string;
  local_board_says?: string;
  resolution?: string;
  founder_decision_required?: boolean;
  [k: string]: unknown;
}

export interface HoldState {
  implementation: string;
  effective?: string;
  authority?: string;
  reason?: string;
  restart_requires?: string;
  convergence_not_rewrite?: boolean;
  restart_gate_conditions?: string[];
}

export interface ProcessTruth {
  available: boolean;
  state: SurfaceState;
  reason?: string;
  authority?: string;
  not_a_new_ssoT?: string | null;
  status?: string;
  version?: string;
  generated_at?: string | null;
  canonical_ssoT?: Record<string, string>;
  hold_state?: HoldState | null;
  stage_classification_key?: Record<string, string>;
  doctrine_summary?: Record<string, unknown> | null;
  process_families: ProcessFamily[];
  convergence_gaps: ConvergenceGap[];
  corrective_tasks?: Array<Record<string, unknown>>;
  reconciliation?: { known_discrepancies?: KnownDiscrepancy[]; known_discrepancies_present?: boolean; [k: string]: unknown };
  hold_state_present?: boolean;
  corrective_tasks_present?: boolean;
  reconciliation_invariants_pending?: Record<string, unknown> | null;
  restart_wave_after_authorization?: Array<Record<string, unknown>>;
  preserved_state?: Record<string, unknown> | null;
  execution_truth_layer_meta?: {
    staleness?: { stale_after_hours?: number; rule?: string } | null;
    identity_authority?: Record<string, unknown> | null;
    activity_ledger?: Record<string, unknown> | null;
    hard_rule?: string | null;
  };
}

export interface AgentRow {
  handle: string;
  identity_ids: string[];
  /**
   * Phase 3 rename of the canonical `events` field.
   *
   * The canonical value is an ALL-TIME count. The activity window holds a
   * fraction of it (claude: 1975 lifetime, 52 in window). The old shared name
   * `events` is what makes a lifetime total read as recent activity, so the
   * forwarded field says what it actually is.
   */
  lifetime_events: number;
  last_activity_at: string | null;
  last_broker_sequence: number | null;
  current_state: string;
  current_state_confidence: string;
  activity_freshness: string;
  /**
   * Frozen at ingest by the control board and never recomputed on read.
   *
   * Forwarded under a name that says so. The Phase 3 floor renders
   * `last_activity_at` plus the projection's `generated_at` instead: a
   * recomputed age on a stale projection is wrong by exactly the projection's
   * own age, and nothing on this surface may present it as live.
   */
  hours_since_last_activity_at_ingest: number | null;
  current_assignment: string;
  current_assignment_confidence: string;
  current_assignment_source: string | null;
  current_task: string;
  current_task_confidence: string;
  current_task_source: string | null;
  /**
   * A COUNT of ledger mentions. Never an assignment, and the canonical
   * `mentioned_tasks` id array is deliberately not forwarded at all — it runs
   * to 186 entries per agent and forwarding the list would make it presentable
   * as work in progress.
   */
  mentioned_task_count: number;
  staff_classification: string;
  counts_as_active_staff: boolean | null;
  identity_status: string;
  identity_role: string | null;
  identity_revocation?: Record<string, unknown> | null;
  project?: string | null;
}

export interface ActivityEvent {
  event_id: string;
  broker_sequence: number | null;
  created_at: string;
  agent: { handle: string; identity_id?: string | null };
  action: string | null;
  state: string;
  state_confidence?: string;
  action_confidence?: string;
  task: string | null;
  project?: string | null;
  process_family?: string | null;
  process_stage?: string | null;
  has_evidence: boolean;
  is_blocker: boolean;
  is_handoff: boolean;
  needs_founder: boolean;
  mentions?: string[];
  serp_refs?: string[];
  body_sha?: string;
  record_hash?: string;
  source?: string;
}

export interface IdentityConflict {
  type: string;
  handle?: string;
  identity_id?: string;
  identity_ids?: string[];
  handles?: string[];
  detail: string;
}

export interface ExecutionTruth {
  available: boolean;
  state: SurfaceState;
  reason?: string | null;
  generated_at?: string | null;
  authority?: string;
  not_a_new_ssoT?: string | null;
  ledger?: {
    recorded_sha256_prefix: string | null;
    live_sha256_prefix: string | null;
    state: SurfaceState;
    reason: string | null;
    records_total: number | null;
    broker_records: number | null;
    max_broker_sequence: number | null;
  };
  idempotency?: Record<string, unknown> | null;
  process_truth_link?: Record<string, unknown> | null;
  agents: AgentRow[];
  activity_events: ActivityEvent[];
  conflicts: IdentityConflict[];
  conflicts_present?: boolean;
  board_readonly_reference?: Record<string, unknown> | null;
}

export interface FamilyMaturity {
  family: string;
  family_weight?: number;
  stages?: number;
  any_stage_absent?: boolean;
  maturity_raw?: number;
  maturity: number;
  caps_applied?: string[];
}

export interface WorkTruth {
  available: boolean;
  state: SurfaceState;
  reason?: string;
  generated_at?: string | null;
  work_state_vocabulary?: Record<string, string>;
  reclassification_rule?: Record<string, unknown> | null;
  global_blocker?: {
    id: string;
    type: string;
    authority: string;
    description: string;
    effect: string;
  } | null;
  global_blocker_present?: boolean;
  historical_completion_rule?: Record<string, unknown> | null;
  corrective_lineage?: Array<Record<string, unknown>>;
  maturity_regression_policy?: Record<string, unknown> | null;
  counts?: Record<string, number>;
  maturity?: {
    authority?: string;
    not_an_ssoT?: string | null;
    hard_rule?: string | null;
    honesty_rule?: string | null;
    L1?: { note?: string; source?: string; counts?: Record<string, number> } | null;
    L2?: Array<Record<string, unknown>>;
    L3?: FamilyMaturity[];
    L4?: {
      raw?: number;
      maturity: number;
      caps_applied?: string[];
      any_family_has_absent_stage?: boolean;
      excludes?: string;
    } | null;
  };
  family_rollup?: Record<string, unknown>;
  tasks?: Array<Record<string, unknown>>;
}

export interface IdentityEntry {
  handle: string;
  display_name: string;
  role: string | null;
  status: string;
  authority_level: string;
  authority_identity_id: string | null;
  legacy_alias_of: string | null;
  aliases: string[];
  avatar: string | null;
  is_legacy: boolean;
  is_retired: boolean;
}

export interface Identities {
  available: boolean;
  state: SurfaceState;
  reason?: string;
  version?: string;
  count?: number;
  byHandle: Record<string, IdentityEntry>;
  founder: {
    handle: string;
    display_name: string;
    operational_handle: string;
    authority_level: string;
  } | null;
}

export interface StaffEntry {
  handle: string;
  duty_state: string;
  /**
   * Phase 3 rename of the staff-side `current_task`.
   *
   * There are TWO canonical current-task values for most handles — this one and
   * the execution-side `AgentRow.current_task` — and they disagree. Founder
   * ruling: render both with explicit provenance, never merge or choose. The
   * rename makes the two impossible to confuse at the call site.
   */
  duty_current_task: string | null;
  /** Forwarded because a Founder restriction must never render as freely assignable. */
  restrictions: string | null;
  capacity_note: string | null;
  capacity_reset_at: string | null;
  last_updated_at: string | null;
  last_updated_by: string | null;
  evidence_count: number;
}

export interface StaffState {
  available: boolean;
  state: SurfaceState;
  reason?: string;
  schema_version?: string;
  count?: number;
  byHandle: Record<string, StaffEntry>;
}

/**
 * Phase 3 — session presence from the identity-lease directory.
 *
 * A lease says a handle is HELD by a session instance. It is presence, not
 * activity: a lease routinely outlives the work it was claimed for. The two are
 * rendered separately and never combined into a "who is working" number.
 */
export interface SessionLease {
  handle: string;
  instance_id: string | null;
  hostname: string | null;
  pid: number | null;
  label: string | null;
  claimed_at: string | null;
  last_seen_at: string | null;
}

export interface Sessions {
  available: boolean;
  state: SurfaceState;
  reason?: string | null;
  count: number;
  source?: string | null;
  meaning?: string;
  byHandle: Record<string, SessionLease>;
}

export interface ProvenanceSource {
  name: string;
  path: string;
  state: SurfaceState;
  recorded: string | null;
  live: string | null;
  reason?: string;
}

// ── Phase 2: the health floor ───────────────────────────────────────────────
//
// These are CONTROL-PLANE states, not process-truth stage states. A stage can
// be `implemented` while the ledger serving it is UNAVAILABLE, and both facts
// are true simultaneously. Collapsing the two vocabularies is the specific
// mistake this type split exists to prevent.

export type DimensionState =
  | 'OK'
  | 'FAIL'
  | 'STALE'
  | 'DRIFT'
  | 'UNAVAILABLE'
  | 'UNREADABLE'
  | 'UNKNOWN';

/**
 * Where a carried issue is fixed, if anywhere. This is a fact with a citation,
 * never a reassurance.
 *
 *   SOURCE                        the defect lives in canonical code
 *   SOURCE_FIXED_RECORD_PRESERVED the code was fixed; the artefact stays failed on purpose
 *   RUNTIME                       canonical code is sound; this host is what fails
 *   NONE                          open, unaddressed anywhere
 */
export type FixLocus = 'SOURCE' | 'SOURCE_FIXED_RECORD_PRESERVED' | 'RUNTIME' | 'NONE';

export interface HealthDimension {
  id: string;
  label: string;
  state: DimensionState;
  detail: string;
  evidence: string[];
  /** Canonical modules this dimension is allowed to cite as its basis. */
  underlying_truth_reachable?: boolean;
  blocked_by?: string;
  fix_locus?: FixLocus;
  fix_status?: string;
  remediation_owner?: string;
  lines?: number[];
  command_did_not_modify?: boolean;
  epoch_id?: string | null;
  records_checked?: number;
  failure_count?: number;
  anchor_consistent?: boolean | null;
  verified_at?: string | null;
  checked?: number;
  unreachable?: string[];
  node_version?: string;
  platform?: string;
  uptime_seconds?: number;
  lease_count?: number;
  known_gaps?: string[];
  installed?: boolean;
  probe_policy?: string;
  gates?: GateStatus[];
  [k: string]: unknown;
}

export interface GateStatus {
  id: string;
  label?: string;
  truth?: string;
  path: string;
  state: DimensionState;
  detail: string;
  exit_code: number | null;
  verdict: string | null;
}

export interface PreservedEpoch {
  epoch_id: string;
  verdict: string;
  immutable: boolean;
  /** Always false. A frozen historical failure must not redden the present. */
  affects_current_verdict: boolean;
  established_at: string | null;
  frozen_at: string | null;
  known_failure_count: number;
  known_failures: Array<Record<string, unknown>>;
  policy: Record<string, string> | null;
  note: string | null;
}

export interface FixStatusEntry {
  id: string;
  title: string;
  state: DimensionState;
  locus: FixLocus;
  detail: string;
  evidence: string[];
}

export interface ReachableSource {
  id: string;
  path: string;
  role: string;
  state: DimensionState;
  detail: string;
  bytes: number | null;
  modified_at: string | null;
  sha256_prefix: string | null;
  hashed?: boolean;
}

export interface LedgerIntegrity {
  state: DimensionState;
  detail: string;
  method?: string;
  remedy?: string;
  current: {
    epoch_id: string | null;
    parent_epoch: string | null;
    anchor: {
      broker_sequence: number | null;
      event_id: string | null;
      record_hash: string | null;
      line: number | null;
      record_index: number | null;
    } | null;
    anchor_consistent: boolean | null;
    anchor_problems: string[];
    records_checked: number;
    failure_count: number;
    failures: Array<Record<string, unknown>>;
    state: DimensionState;
    detail: string;
  } | null;
  preserved_historical: PreservedEpoch[];
  evidence: string[];
  recomputed?: boolean;
  verified_at?: string;
}

export interface HealthFloor {
  state: DimensionState;
  generated_at: string;
  authority?: string;
  principle: string;
  states?: Record<string, DimensionState>;
  precedence?: DimensionState[];
  current_health: HealthDimension[];
  preserved_historical: PreservedEpoch[];
  preserved_historical_note?: string;
  fix_status: FixStatusEntry[];
  runtime: Record<string, unknown> | null;
  source_reachability: {
    state: DimensionState;
    detail: string;
    checked: number;
    unreachable?: string[];
    sources: ReachableSource[];
  } | null;
  ledger_integrity: LedgerIntegrity | null;
  tool_health: {
    state: DimensionState;
    detail: string;
    dimensions: HealthDimension[];
    reconciliation_gates: {
      state: DimensionState;
      detail: string;
      gates: GateStatus[];
      execution_policy?: string;
    };
  } | null;
}

export interface FloorSummary {
  overall: DimensionState;
  dimensions_total: number;
  dimensions_assessed: number;
  dimensions_healthy: number;
  by_state: Record<string, number>;
  preserved_historical_count: number;
}

export interface GateRunResult {
  id: string;
  label?: string;
  truth?: string;
  path: string;
  state: DimensionState;
  detail: string;
  exit_code: number | null;
  verdict: string | null;
  interpreter?: string;
  ran_at?: string;
  read_only?: boolean;
  truth_impact?: string;
  stdout_tail?: string[];
  stderr_tail?: string[];
}

export interface GatesResponse {
  state: DimensionState;
  ran_at: string;
  detail: string;
  gates: GateRunResult[];
  refused: Array<{ id: string; script: string; reason: string }>;
  run_policy: string;
}

export interface Provenance {
  state: SurfaceState;
  checked: number;
  drifted: string[];
  missing: string[];
  sources: ProvenanceSource[];
  reason?: string;
}

export interface CommandSurface {
  /** #9538: canonical communication records, not reconstructed queue state. */
  room_visibility?: {
    state: string;
    history: RoomWorkEvidence[] | null;
    history_total?: number;
    max_sequence?: number;
    room_head_sequence?: number;
    generated_at?: string | null;
    reason?: string;
    note?: string;
  };
  building?: BuildingProjection;
  workspace: { root: string | null; source: string; attempted?: string | null };
  assembled_at: string;
  authority_note?: string;
  health: Health;
  process_truth: ProcessTruth;
  execution_truth: ExecutionTruth;
  work_truth: WorkTruth;
  identities: Identities;
  staff_state: StaffState;
  /** Phase 3. Session presence, separate from execution state on purpose. */
  sessions: Sessions;
  provenance: Provenance;
  read_only_sources?: string[];
  /** Phase 2. Attached alongside `health`, never merged into it. */
  health_floor?: HealthFloor | null;
  health_floor_summary?: FloorSummary | null;
  phase2?: {
    dimensions: Record<string, DimensionState>;
    current_health_separate_from: string;
    preserved_historical_count: number;
    snapshot_endpoint: string;
    gates_endpoint: string;
  };
  /** Phase 3. Attached alongside Phase 1 and Phase 2, merged into neither. */
  floor?: FloorPayload | null;
  /**
   * Company OS. Attached at Phase 1 level, deliberately OUTSIDE `floor`.
   *
   * The company is the whole skyscraper; Dev Studio is one floor. Nesting the
   * company inside the Dev Studio floor payload would make the misreading the
   * Founder corrected at seq 8487 the default shape of the data.
   *
   * Also deliberately outside `health`: an unreadable company registry is a
   * company-shaped absence, not a control-plane fault, and Phase 1's four
   * condition worst-wins contract is proven by accepted tests.
   */
  company_os?: CompanyOsProjection;
  phase3?: {
    name: string;
    endpoint: string;
    authority: string;
    reads: string[];
    writes: string[];
    ingest_embedded: boolean;
  };
}

// ── Phase 3: the Dev Studio Floor ───────────────────────────────────────────
//
// Assembled server-side by server/floor.mjs. The types below are the contract
// between that assembly and the renderer; the renderer computes nothing, so
// every judgement it can make is already made and visible here.

/**
 * The two current-task truths, held apart.
 *
 * `activity.json` records what the execution ledger says an agent is on.
 * `staff-state.json` records duty and status context. For all 14 handles that
 * carry both, the values disagree. Command reports the inequality and renders
 * both — it does not adjudicate between two canonical sources.
 */
export interface TruthDisagreement {
  values_differ: boolean;
  execution_side: { source: 'activity.json'; value: string };
  duty_side: { source: 'staff-state.json'; value: string };
  resolution: string;
}

/**
 * DECLARED seat metadata for one canonical Dev Studio seat.
 *
 * This is not measurement. No signal on this floor distinguishes a paid seat
 * from a free one, tells Command which provider a session is talking to, or
 * reports a normal host — so the Founder declared them (Room seq 8473) and they
 * are carried as declarations. `provider_owner` may read `VARIES BY SESSION`
 * for exactly that reason: an invented constant there would be worse than an
 * honest variable.
 */
export interface StaffProfileSeat {
  seat_label: string;
  provider_owner: string;
  product_client: string;
  /** PAID_L1 | FREE_SUPPORT | UNKNOWN. A declared commercial class. */
  capacity_class: string;
  /** WINDOWS | WSL | UNKNOWN. The seat's NORMAL home, not a live reading. */
  normal_host: string;
  harness: string;
  /** BUILDER | VERIFIER | BUILDER_VERIFIER | BUILDER_VERIFIER_SUPPORT | UNKNOWN */
  role_family: string;
  /** The Herdr manifest seat id, or null when the manifest declares no row. */
  herdr_seat_id: string | null;
}

/**
 * DECLARED launch facts joined from the Herdr Floor manifest, read-only.
 *
 * Deliberately carries NO `pid`, `state`, `session_id` or floor open count.
 * Those are runtime facts and exist only in the broker projection; a PID here
 * would be a hard-coded live value, and the manifest is not where they live.
 */
export interface StaffHerdrJoin {
  declared: boolean;
  seat_id: string | null;
  declared_runtime: string | null;
  launchable: boolean | null;
  startup_policy: string | null;
  terminal: boolean | null;
  executable_present: boolean | null;
  identity_probe: string | null;
  herdr_kind: string | null;
  evidence: string | null;
  /** Present only when `declared` is false. */
  absent_reason?: string;
}

export interface RosterEntry {
  handle: string;
  identity_present: boolean;
  identity_status: string;
  display_name: string | null;
  role: string | null;
  authority_level: string | null;
  is_legacy: boolean;
  is_revoked: boolean;

  staff_classification: string;
  counts_as_active_staff: boolean | null;
  is_retired: boolean;
  is_system: boolean;
  /** True only on canonical corroboration. Absence of a flag is never enough. */
  is_active_staff: boolean;

  // ── Canonical ten-seat curation ─────────────────────────────────────────
  /** True only for a handle in the declared Dev Studio staff profile. */
  is_canonical_seat: boolean;
  /** Declared seat metadata. Null on every non-canonical row, always. */
  staff_profile: StaffProfileSeat | null;
  /** Non-null only when suppressed from the main staff surface. */
  suppression_reason: string | null;
  suppressed_from_main_staff_surface: boolean;
  /** Declared launch facts. Null on non-canonical rows and unjoined seats. */
  herdr: StaffHerdrJoin | null;
  /** True when the declared normal host and the manifest runtime disagree. */
  herdr_host_conflict: boolean;

  /**
   * Present only on the curated `floor.staff.canonical_seats` rows. False means
   * the seat is DECLARED but has no row in the current activity projection — so
   * every execution value on it is UNKNOWN. A false here is never read as a
   * retirement and never as an absence of staff.
   */
  observed_in_ledger?: boolean;
  /** Why a declared seat is unobserved. Present only alongside a false above. */
  absence_reason?: string;

  current_state: string;
  current_state_confidence: string;
  activity_freshness: string;
  last_activity_at: string | null;
  /** Last Room sequence this handle is recorded in. Forwarded, never computed. */
  last_meaningful_seq: number | null;
  lifetime_events: number;
  hours_since_last_activity_at_ingest: number | null;
  mentioned_task_count: number;

  execution_current_task: string | null;
  execution_task_confidence: string;
  execution_task_source: string | null;
  execution_current_assignment: string | null;
  execution_assignment_confidence: string;
  execution_assignment_source: string | null;

  duty_state: string;
  duty_current_task: string | null;
  duty_capacity_note: string | null;
  duty_capacity_reset_at: string | null;
  duty_restrictions: string | null;
  duty_last_updated_at: string | null;
  duty_last_updated_by: string | null;
  duty_evidence_count: number;

  truth_disagreement: TruthDisagreement | null;

  has_session: boolean;
  session: SessionLease | null;
  has_duty_record: boolean;
  conflict_types: string[];
  has_conflict: boolean;
}

export interface RosterCounts {
  observed: number;
  active_staff: number;
  retired: number;
  system: number;
  unknown_identity: number;
  conflicted: number;
  with_duty_record: number;
  with_session: number;
  execution_and_duty_both_present: number;
  truth_disagreements: number;
  /** Curation counts. `observed` is what the ledger holds; these are the board. */
  canonical_seats: number;
  canonical_observed: number;
  canonical_not_observed: number;
  suppressed: number;
  herdr_host_conflicts: number;
  herdr_seats_without_manifest_row: number;
}

/**
 * Exact-token status groups for Staff Glance, computed by server/floor.mjs
 * from each roster row's declared duty_state and current_state. Groups can
 * overlap when those two source fields disagree; unknown counts rows that
 * match none of the named groups. This is separate from the identity census.
 */
export interface StaffGlanceCounts {
  working: number;
  idle: number;
  blocked: number;
  awaiting_review: number;
  unavailable: number;
  unknown: number;
}

/** One handle excluded from the main staff surface, with the reason stated. */
export interface SuppressedHandle {
  handle: string;
  reason: string;
  staff_classification: string;
  identity_status: string;
  is_retired: boolean;
  is_system: boolean;
  last_meaningful_seq: number | null;
}

/**
 * Presence from identity leases — and the explicit refusal to read it as a turn.
 *
 * `turn_holder` is typed as `string` for contract completeness but is always
 * the literal `UNKNOWN`. A lease says a handle is held by a session instance;
 * it does not say that session is mid-task, and it does not pick one holder out
 * of several. Naming a turn-holder here would be Command deciding who is
 * working, from presence.
 */
export interface StaffSessionLeases {
  holders: Array<{
    handle: string;
    instance_id: string | null;
    hostname: string | null;
    claimed_at: string | null;
    last_seen_at: string | null;
  }>;
  holders_count: number;
  turn_holder: string;
  turn_holder_reason: string;
  source: string;
}

/** Provenance and declared limits of the seat-profile source. */
export interface StaffProfileAuthority {
  name: string;
  authority: string;
  is_ssot_for_live_state: boolean;
  source: string;
  supersedes: string;
  note: string;
  excludes: Record<string, string>;
}

/**
 * The curated Dev Studio staff board.
 *
 * Attached to `FloorPayload` alongside `roster`, never merged into it. `roster`
 * stays the COMPLETE observed population; this is the declared ten plus a
 * stated account of everything that was left off it. `accounting` states whether
 * those two reconcile, so a dropped handle is visible rather than silent.
 */
export interface StaffBlock {
  authority: StaffProfileAuthority;
  declared_handles: string[];
  canonical_seats: RosterEntry[];
  canonical_count: number;
  observed_in_ledger: number;
  declared_not_observed: string[];
  suppressed: SuppressedHandle[];
  suppressed_count: number;
  accounting: string;
  observed_but_undeclared: string[];
  session_leases: StaffSessionLeases;
  roster_still_complete: boolean;
  roster_completeness_note: string;
  herdr_manifest: {
    available: boolean;
    state: string;
    reason: string | null;
    path: string | null;
    authority: string;
    seat_count: number;
    meaning: string | null;
    live_state_source: string | null;
    live_state_note: string | null;
  };
}

export interface AssignmentRow {
  handle: string;
  display_name: string | null;
  identity_present: boolean;
  current_assignment: string | null;
  assignment_confidence: string;
  assignment_source: string | null;
  current_task: string | null;
  task_confidence: string;
  task_source: string | null;
  /** A count of mentions. Carries `mention_note` so it can never read as work. */
  mention_count: number;
  mention_note: string;
  last_activity_at: string | null;
  is_retired: boolean;
  truth_disagreement: TruthDisagreement | null;
}

export interface FloorEvent {
  event_id: string;
  broker_sequence: number | null;
  created_at: string;
  handle: string;
  /** Null when canonical source records no action. The UI renders UNKNOWN. */
  action: string | null;
  action_confidence: string;
  task: string | null;
  state: string;
  state_confidence: string;
  project: string | null;
  process_family_context: string | null;
  has_evidence: boolean;
  is_blocker: boolean;
  is_handoff: boolean;
  needs_founder: boolean;
  serp_refs: string[];
  mentions: string[];
  /** Provenance travels with the row. Without these it is a claim, not evidence. */
  body_sha: string | null;
  record_hash: string | null;
  source: string | null;
}

export interface ActivityFeed {
  window: {
    size: number;
    broker_sequence_min: number | null;
    broker_sequence_max: number | null;
    source: string;
  };
  filter: {
    rule: string;
    signal_flags: string[];
    window_total: number;
    signal_total: number;
    shown: number;
    filtered_out: number;
    /** Must be 0. Non-zero means the feed hid flagged evidence — a defect. */
    signal_loss: number;
    guarantee: string;
  };
  events: FloorEvent[];
}

export interface FloorConstraint {
  kind: string;
  subject: string;
  detail: string;
  canonical_source: string;
  resolution: string;
}

export interface FloorPayload {
  phase: number;
  name: string;
  authority: string;
  is_ssot: boolean;
  access: string;
  generated_at: string;
  execution_projection: {
    generated_at: string | null;
    state: string;
    reason: string | null;
    authority: string;
    not_a_new_ssoT: string | null;
    ledger: Record<string, unknown> | null;
    ingest_performed_by_command: boolean;
    ingest_note: string;
  };
  roster: { entries: RosterEntry[]; counts: RosterCounts };
  staff_glance_counts: StaffGlanceCounts;
  /**
   * The curated Dev Studio staff board — the declared canonical ten, joined to
   * their ledger rows, plus a stated account of every handle left off it.
   * Attached alongside `roster`, never merged into it.
   */
  staff?: StaffBlock;
  assignments: AssignmentRow[];
  activity: ActivityFeed;
  sessions: {
    available: boolean;
    state: string;
    reason: string | null;
    count: number;
    source: string | null;
    meaning: string;
    entries: SessionLease[];
    not_a_measure_of_work: boolean;
  };
  runtime: {
    state: string;
    detail: string;
    node_version?: string | null;
    platform?: string | null;
    uptime_seconds?: number | null;
    measured_by: string;
  };
  constraints: FloorConstraint[];
  /** Absent-by-ruling, declared in the payload so it cannot read as oversight. */
  excluded: Record<string, string>;
}
/**
 * CMD-DI-3-2a — normalized row for the Design Integration Work surface only.
 * This does not define the future full Command WorkPackage architecture.
 * Work and Evidence → Rooms are distinct concepts: this row neither owns nor
 * replaces, repurposes, or shares the EvidenceRoomsPeer surface.
 *
 * Mapping rules:
 * - ERP tasks: consume `building.erp_tasks`; use the declared ERP project
 *   mapping (`erp` / `starqERP`) and stable task id/title. Copy a source stage,
 *   lane, owner, or verifier only when its source field declares that value;
 *   preserve stage tokens verbatim.
 * - Hoadha items: consume only records in `building.hoadha.boards`; take the
 *   project id from the live board's `project` field and preserve item ids,
 *   titles, and declared stage/lane/owner/verifier values. `hoadha.proposed`
 *   records are not live board items and do not map here.
 * - General assignments: normalize only a canonical assignment record with a
 *   stable id, explicit project id, title, and source reference. An
 *   AssignmentRow or mention alone does not provide those package keys; do not
 *   derive them from a handle, task text, or mention. Stage, lane, owner, and
 *   verifier are copied only when explicitly declared by that assignment.
 *
 * Across all sources, do not translate status synonyms or infer a lane. A
 * missing or conflicting canonical stage/lane is unsupported and must not be
 * filled by a fallback; source.reference identifies the record for review.
 */
export type WorkPackageSourceKind = 'ERP_TASK' | 'HOADHA_ITEM' | 'GENERAL_ASSIGNMENT';

export interface WorkPackageSource {
  kind: WorkPackageSourceKind;
  /** Canonical source reference, preserved from the source adapter. */
  reference: string;
}

export interface WorkPackageRow {
  id: string;
  project_id: string;
  title: string;
  current_stage: string | null;
  owner: string | null;
  verifier: string | null;
  board_lane: string | null;
  source: WorkPackageSource;
}

export interface WorkPackageEvidenceRow extends WorkPackageRow {
  /** Optional recorded evidence under #9538; required row semantics unchanged. */
  record?: RoomWorkEvidence & { work_id: string };
}

export interface RoomWorkEvidence {
  event_id: string;
  sequence: number | null;
  record_hash: string | null;
  recorded_at: string | null;
  reporter: string | null;
  source_reference: string;
  integrity: 'CURRENT_EPOCH_VERIFIED' | 'HISTORICAL_UNVERIFIED';
  reported_action: string | null;
  reported_status: string | null;
  blockers: string | null;
  reported_verification: string | null;
  independent_verification: 'UNKNOWN';
  current_execution: 'UNKNOWN';
  evidence: string;
  kind: 'FOUNDER_RECORD' | 'REPORTED_OUTCOME' | 'VERIFICATION_REPORT' | 'RECORDED_ASSIGNMENT' | 'RECORDED_WORK_REFERENCE';
  projection_state?: string;
}

/**
 * Read-only Work feed implemented under Founder directive #9535.
 * GET /api/work-packages?project_id={optional project id} returns
 * WorkPackageRow[] when verified canonical inputs are available, [] for a
 * verified empty result, and null when source availability is unknown or
 * unavailable. #9538 adds optional recorded Room evidence through the existing
 * ingestion index; absent project boards and current runtime proof stay unknown.
 */
export interface WorkPackagesEndpointSignature {
  method: 'GET';
  path: '/api/work-packages';
  query: { project_id?: string };
  response: WorkPackageRow[] | null;
}

export interface BuildingRecord { id: string; title?: string; status?: string; state?: string; wave?: string; collection: string; source: string; [key: string]: unknown }
// ── Company OS (Founder ruling seq 8486/8487; contract seq 8488) ────────────
//
// The company is the building. Dev Studio is ONE floor of it. These types are the
// contract between server/company-os.mjs and the renderer.
//
// The load-bearing shape is that FOUR objects stay four objects: seat, occupant,
// acting capacity, delegation. They are separate types here on purpose. A single
// combined "role" type is the exact refactor that would let a company collapse
// into a headcount, and the type system is the last place that can refuse it.

export interface CompanyOsSeat {
  seat_id: string;
  seat_name: string;
  floor_id: string | null;
  room_id: string | null;
  organizational_area: string | null;
  business_activity: string | null;

  /** OBJECT 1 — the durable organizational function. */
  seat_state: string;

  /** OBJECT 2 — who fills it. Never the seat itself. */
  occupant_id: string | null;
  occupant_type: string;
  occupant_coherent: boolean;

  /** OBJECT 3 — which seat is being exercised. NOT a copy of identity. */
  current_acting_status: string;
  acting_capacity_candidate: boolean;
  /** Always 'NONE'. Present so a renderer cannot drop the qualifier. */
  acting_capacity_authority_effect: string;

  /** OBJECT 4 — who may EXECUTE beneath. Never authority. */
  delegations: string[];
  delegation_note: string | null;

  /** Only the Founder seat may carry a grant, and only with a canonical source. */
  authority_granted: string[];
  authority_granted_declared: string[];
  authority_reserved: string[];
  authority_source: string | null;
  scope: string | null;
  source_reference: string | null;
  note: string | null;
}

export interface CompanyOsRoom {
  id: string;
  floor_id: string | null;
  ordinal: number | null;
  name: string;
  state: string;
  state_label: string | null;
  purpose: string | null;
  future_entity: boolean;
  activation_conditions: string[];
  entity_gate: string | null;
  entity_gate_state: string | null;
  boundary: {
    rule: string;
    devstudio_owns: string[];
    dynamics_owns: string[];
    source: string;
  } | null;
  note: string | null;
}

export interface CompanyOsFloor {
  id: string;
  ordinal: number | null;
  name: string;
  purpose: string | null;
  state: string;
  division_type: string | null;
  /** Refused-and-reported if a floor ever claims to be an officer surface. */
  is_corporate_officer_surface: boolean;
  above_operating_company: boolean;
  note: string | null;
}

export interface CompanyOsFounder {
  person_id: string | null;
  display_as: string | null;
  room_handles: string[];
  handle_note: string | null;
  authority_level: string;
  authority_level_source: string | null;
  permanent_capacities: string[];
  /** Null unless a real seat is declared. Otherwise the active hat. */
  current_acting_capacity: string | null;
  /** UNKNOWN | CONFLICT | DECLARED. UNKNOWN is the honest default. */
  current_acting_capacity_state: string;
  current_acting_capacity_note: string | null;
  /** Always 'NONE'. Acting capacity never widens authority. */
  acting_capacity_authority_effect: string;
  reserved_to_founder: string[];
  reserved_note: string | null;
  /** Seats the Founder COULD exercise. A menu, never an active hat. */
  candidate_seats: string[];
}

export interface CompanyOsProjection {
  available: boolean;
  state: string;
  reason?: string | null;
  path: string | null;
  authority: string;
  /** The prose governance source remains the SSOT; this is its projection. */
  is_ssot: boolean;
  ssot_note: string | null;
  version?: string;
  provenance?: Record<string, unknown> | null;
  company: {
    company_id: string;
    legal_name: string;
    short_name: string;
    entity_type: string;
    incorporation_state: string;
    incorporation_note: string | null;
    primary_occupant: Record<string, unknown> | null;
    structure_note: string | null;
  } | null;
  floors: CompanyOsFloor[];
  rooms: CompanyOsRoom[];
  seats: CompanyOsSeat[];
  shared_infrastructure: Array<{
    id: string;
    name: string;
    kind: string;
    is_staff: false;
    is_seat: false;
    owns: string | null;
    authority: string;
    operating_order: string | null;
    never_overrides: string[];
    note: string | null;
    source: string | null;
  }>;
  founder: CompanyOsFounder | null;
  authority_model: {
    rule: string | null;
    authority_binds_to: string | null;
    seat_grants_authority: false;
    acting_capacity_grants_authority: false;
    delegation_grants_authority: false;
    tooling_creates_authority: false;
    detail: string | null;
    builder_is_verifier: string | null;
  };
  counts: {
    floors: number;
    floors_active: number;
    rooms: number;
    rooms_active: number;
    rooms_dormant: number;
    devstudio_rooms: number;
    devstudio_rooms_dormant: number;
    seats: number;
    seats_occupied_founder: number;
    seats_vacant: number;
    seats_dormant: number;
    seats_with_delegation: number;
    seats_claiming_authority: number;
    infrastructure: number;
    infrastructure_claiming_staff: number;
    distinct_occupants: number;
  } | null;
  /** Measured proof that the four objects stayed distinct. */
  separation: {
    objects: string[];
    seat_ids_unique: boolean;
    seat_is_not_occupant: boolean;
    seats_per_occupant: number | null;
    acting_capacity_is_a_seat_reference: boolean;
    delegation_is_not_the_seat: boolean;
    no_agent_occupies_a_seat: boolean;
    infrastructure_counted_as_staff: boolean;
    note: string;
  } | null;
  problems: string[];
  conflicts: Array<{
    kind: string;
    subject: string;
    detail: string;
    resolution: string;
  }>;
}

export interface CompanySurface extends CommandSurface {
  company_os: CompanyOsProjection;
}

export interface BuildingProjection {
  authority: string; access: string; company: string; floor: string;
  capacity: { state: string; reason: string };
  projects: { id: string; name: string; classification: string; state: string; source: string }[];
  sources: {
    source: string; state: string; sha256?: string; modified_at?: string; reason?: string;
    source_kind?: 'NEXUS_COMPANY_BOARD' | 'HOADHA_COMPANY_DOCUMENT'; source_root?: string;
  }[];
  erp_tasks: BuildingRecord[] | null; note: string;
  hoadha: {
    integrity: string; source_status: string; current_wave: string; execution: string; execution_basis: string; production: string; integration: string;
    loops: { id: string; name: string; state: string; blocker: string; tasks: string[] }[];
    blockers: string[];
    boards: { project: string; source: string; state: string; count: number | null; expected: number; records: BuildingRecord[] }[];
    live_count: number | null; proposed_count: number | null; proposed: BuildingRecord[];
    waves: { id: string; title: string; objective: string; entry: string; invariant: string; source: string }[];
    stages: { loop: string; stages: string; state: string; evidence: string; source: string }[];
    evidence: { claim: string; evidence: string; source: string }[];
    board_snapshot: Record<string, number> | null;
  };
}
