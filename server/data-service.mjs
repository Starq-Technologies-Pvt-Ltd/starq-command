/**
 * STARQ // COMMAND — local data service. READ-ONLY BY CONSTRUCTION.
 *
 * This is the ONLY place that touches the filesystem. The React layer never
 * reads a canonical file directly, and nothing here writes to Starq.
 *
 * Hard rules enforced structurally, not by convention:
 *   - This file opens canonical sources with the 'r' flag only.
 *   - No fs.write / rename / unlink / mkdir appears anywhere in the server.
 *   - Business maturity (L1-L4) is never computed here. It is forwarded
 *     verbatim from command_work_model.json, which computed it from the
 *     canonical roadmap.
 *   - Stage classification is never computed here. It is forwarded verbatim
 *     from contract.json.
 *
 * What this file DOES compute is metadata about the projections, never the
 * projections' truth:
 *   - reachability      : can we see the canonical source at all
 *   - freshness         : does the recorded ledger hash still match the live one
 *   - drift             : do the contract's recorded provenance hashes still match
 *   - parse validity    : is the projection structurally readable
 *
 * Each failure mode is reported as its own distinct state. UNKNOWN, STALE,
 * DRIFT and UNAVAILABLE are never collapsed into one another, and an
 * unavailable source is never rendered as a healthy empty one.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace, CANONICAL, CONTROL_BOARD_FILES, abs } from './paths.mjs';
import { resolveReadOnlyTarget } from './path-guard.mjs';
import { buildHealthFloor, summarizeFloor, DIMENSION } from './health-floor.mjs';
import { buildFloor } from './floor.mjs';
import { loadCompanyOs } from './company-os.mjs';
import { buildSnapshot } from './snapshot.mjs';
import { runReadOnlyGates } from './gates.mjs';
import { readRoomVisibility } from './room-work.mjs';

const PORT = Number(process.env.COMMAND_PORT || 5177);
// The observer profile is pinned to loopback even if a caller bypasses the
// lifecycle owner's sanitized child environment and sets COMMAND_HOST.
export function listenerHost(env = process.env) {
  return env.COMMAND_OBSERVATION_ONLY === '1' ? '127.0.0.1' : (env.COMMAND_HOST || '127.0.0.1');
}
const HOST = listenerHost();

// ── State vocabulary. One source of truth for these strings. ───────────────
export const STATE = {
  OK: 'OK',
  UNAVAILABLE: 'UNAVAILABLE',
  STALE: 'STALE',
  DRIFT: 'DRIFT',
  UNREADABLE: 'UNREADABLE',
};

/** sha256 prefix, matching the control board's own recording width. */
function sha256Prefix(filePath, width = 16) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').slice(0, width);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** Read a canonical JSON source read-only and classify the outcome. */
function loadSource(relPath, workspaceRoot) {
  const target = abs(workspaceRoot, relPath);
  const meta = { path: relPath, absolute_path: target };

  if (!fs.existsSync(target)) {
    return { ...meta, state: STATE.UNAVAILABLE, reason: 'canonical source not found on disk', data: null };
  }
  try {
    const stat = fs.statSync(target);
    const data = readJson(target);
    return {
      ...meta,
      state: STATE.OK,
      bytes: stat.size,
      modified_at: stat.mtime.toISOString(),
      data,
    };
  } catch (err) {
    return {
      ...meta,
      state: STATE.UNREADABLE,
      reason: `parse failed: ${err.message}`,
      data: null,
    };
  }
}

// ── Process truth (contract.json) ──────────────────────────────────────────
// Stage classifications are FORWARDED, never derived. This function only
// reports whether the projection is reachable and what it declares about
// its own authority.
function readProcessTruth(contract, sourceState) {
  if (sourceState !== STATE.OK) {
    return {
      available: false,
      state: sourceState,
      reason: contract.reason,
    };
  }
  const c = contract.data;
  const families = Array.isArray(c.process_families) ? c.process_families : [];

  return {
    available: true,
    state: STATE.OK,
    authority: c.contract?.authority ?? 'UNKNOWN',
    not_a_new_ssoT: c.contract?.not_a_new_ssoT ?? null,
    status: c.contract?.status ?? 'UNKNOWN',
    version: c.contract?.version ?? 'UNKNOWN',
    generated_at: c.volatile?.generated_at ?? null,
    canonical_ssoT: c.contract?.canonical_ssoT ?? {},
    hold_state: c.hold_state ?? null,
    hold_state_present: Object.hasOwn(c, 'hold_state'),
    stage_classification_key: c.stage_classification_key ?? {},
    doctrine_summary: c.doctrine_summary ?? null,
    process_families: families.map((f) => ({
      id: f.id,
      name: f.name,
      maturity: f.maturity ?? null,
      headline: f.headline ?? null,
      critical_blocker: f.critical_blocker ?? null,
      critical_blocker_present: Object.hasOwn(f, 'critical_blocker'),
      // stages forwarded verbatim — states are canonical-roadmap-parsed
      stages: (f.stages ?? []).map((s) => ({
        stage: s.stage,
        state: s.state,
        serp: s.serp ?? [],
        evidence: s.evidence ?? [],
        blocked_by: s.blocked_by ?? null,
        blocked_by_present: Object.hasOwn(s, 'blocked_by'),
        note: s.note ?? null,
      })),
    })),
    convergence_gaps: c.convergence_gaps ?? [],
    corrective_tasks: c.corrective_tasks ?? [],
    corrective_tasks_present: Object.hasOwn(c, 'corrective_tasks'),
    reconciliation: { ...(c.reconciliation ?? {}), known_discrepancies_present: Object.hasOwn(c.reconciliation ?? {}, 'known_discrepancies') },
    reconciliation_invariants_pending: c.reconciliation_invariants_pending ?? null,
    restart_wave_after_authorization: c.restart_wave_after_authorization ?? [],
    preserved_state: c.preserved_state ?? null,
    execution_truth_layer_meta: {
      staleness: c.execution_truth_layer?.staleness ?? null,
      identity_authority: c.execution_truth_layer?.identity_authority ?? null,
      activity_ledger: c.execution_truth_layer?.activity_ledger ?? null,
      hard_rule: c.execution_truth_layer?.hard_rule ?? null,
    },
  };
}

// ── Execution truth (activity.json) ────────────────────────────────────────
// The event/agent layer is forwarded verbatim. Freshness is the one thing
// added here, and it is added because the contract itself demands it:
// "Room changed since ingest -> render STALE, re-ingest."
function readExecutionTruth(activity, sourceState, workspaceRoot) {
  if (sourceState !== STATE.OK) {
    return {
      available: false,
      roster_input_available: false,
      state: sourceState,
      reason: activity.reason,
    };
  }
  const a = activity.data;

  const recordedHash = a.activity_ledger?.sha256_prefix ?? null;
  let liveHash = null;
  let ledgerState = STATE.OK;
  let ledgerReason = null;

  try {
    const ledgerPath = abs(workspaceRoot, CANONICAL.roomLedger);
    if (!fs.existsSync(ledgerPath)) {
      ledgerState = STATE.UNAVAILABLE;
      ledgerReason = 'room ledger not found';
    } else {
      liveHash = sha256Prefix(ledgerPath);
      if (recordedHash && liveHash !== recordedHash) {
        ledgerState = STATE.STALE;
        ledgerReason = 'room ledger changed since last ingest; regeneration required';
      }
    }
  } catch (err) {
    ledgerState = STATE.UNREADABLE;
    ledgerReason = `ledger hash failed: ${err.message}`;
  }

  const events = Array.isArray(a.activity_events) ? a.activity_events : [];
  const rosterInputAvailable = Array.isArray(a.agents);
  const agents = rosterInputAvailable ? a.agents : [];

  return {
    available: true,
    roster_input_available: rosterInputAvailable,
    state: ledgerState,
    reason: ledgerReason,
    generated_at: a.generated_at ?? null,
    authority: a.authority ?? 'UNKNOWN',
    not_a_new_ssoT: a.not_a_new_ssoT ?? null,
    ledger: {
      recorded_sha256_prefix: recordedHash,
      live_sha256_prefix: liveHash,
      state: ledgerState,
      reason: ledgerReason,
      records_total: a.activity_ledger?.records_total ?? null,
      broker_records: a.activity_ledger?.broker_records ?? null,
      max_broker_sequence: a.activity_ledger?.max_broker_sequence ?? null,
    },
    idempotency: a.idempotency ?? null,
    process_truth_link: a.process_truth_link ?? null,
    // forwarded verbatim — never re-derived in the UI
    //
    // Phase 3 (Founder-authorised 29 Sep 2026) added five fields that the
    // roster cannot honestly render without, because each one carries a
    // distinction the UI must not invent:
    //
    //   staff_classification   STAFF | SYSTEM | RETIRED. Without it, `nexus`
    //                           (RETIRED 12 Sep 2026) is indistinguishable from
    //                           a working agent.
    //   counts_as_active_staff the canonical yes/no, forwarded not computed.
    //   identity_status        active | retired | UNKNOWN.
    //   identity_role          the role text the registry carries.
    //   mentioned_task_count   a COUNT ONLY. The canonical `mentioned_tasks`
    //                           array runs to 186 entries per agent and is a
    //                           mention index, never an assignment. Forwarding
    //                           the count makes it summarisable; forwarding the
    //                           list would make it presentable as work.
    agents: agents.map((ag) => ({
      handle: ag.handle,
      identity_ids: ag.identity_ids ?? [],
      // Named `lifetime_events`, NOT `events`. The canonical value is an
      // all-time count (claude 1975) and the feed window holds 52 of them.
      // Placing one next to the other under a shared name is how a lifetime
      // total becomes a false "recent activity" number.
      lifetime_events: ag.events ?? 0,
      last_activity_at: ag.last_activity_at ?? null,
      last_broker_sequence: ag.last_broker_sequence ?? null,
      current_state: ag.current_state ?? 'UNKNOWN',
      current_state_confidence: ag.current_state_confidence ?? 'UNKNOWN',
      activity_freshness: ag.activity_freshness ?? 'UNKNOWN',
      // Frozen at ingest, never recomputed on read. The Phase 3 floor must not
      // render this as live truth (Founder ruling 4); it is forwarded only so
      // the contract stays complete.
      hours_since_last_activity_at_ingest: ag.hours_since_last_activity ?? null,
      current_assignment: ag.current_assignment ?? 'UNKNOWN',
      current_assignment_confidence: ag.current_assignment_confidence ?? 'UNKNOWN',
      current_assignment_source: ag.current_assignment_source ?? null,
      current_task: ag.current_task ?? 'UNKNOWN',
      current_task_confidence: ag.current_task_confidence ?? 'UNKNOWN',
      current_task_source: ag.current_task_source ?? null,
      mentioned_task_count: Array.isArray(ag.mentioned_tasks) ? ag.mentioned_tasks.length : 0,
      staff_classification: ag.staff_classification ?? 'UNKNOWN',
      counts_as_active_staff: ag.counts_as_active_staff ?? null,
      identity_status: ag.identity_status ?? 'UNKNOWN',
      identity_role: ag.identity_role ?? null,
      identity_revocation: ag.identity_revocation ?? null,
      project: ag.project ?? null,
    })),
    activity_events: events,
    conflicts: a.conflicts ?? [],
    conflicts_present: Object.hasOwn(a, 'conflicts'),
    board_readonly_reference: a.board_readonly_reference ?? null,
  };
}

// ── Work truth (command_work_model.json) ───────────────────────────────────
// L1-L4 maturity is FORWARDED VERBATIM. This service does not recompute a
// single number. That is the single most important boundary in the product:
// "Scoring/business maturity remains outside React" — and outside here too.
function readWorkTruth(workModel, sourceState) {
  if (sourceState !== STATE.OK) {
    return { available: false, state: sourceState, reason: workModel.reason };
  }
  const m = workModel.data;
  const mat = m.maturity ?? {};

  return {
    available: true,
    state: STATE.OK,
    generated_at: m.contract?.generated_at ?? null,
    work_state_vocabulary: m.work_state_vocabulary ?? {},
    reclassification_rule: m.reclassification_rule ?? null,
    global_blocker: m.global_blocker ?? null,
    global_blocker_present: Object.hasOwn(m, 'global_blocker'),
    historical_completion_rule: m.historical_completion_rule ?? null,
    corrective_lineage: m.corrective_lineage ?? [],
    maturity_regression_policy: m.maturity_regression_policy ?? null,
    counts: m.counts ?? {},
    // forwarded verbatim — the authoritative derived scores
    maturity: {
      authority: mat.authority ?? 'UNKNOWN',
      not_an_ssoT: mat.not_an_ssoT ?? null,
      hard_rule: mat.hard_rule ?? null,
      honesty_rule: mat.honesty_rule ?? null,
      L1: mat.L1_task_execution_progress ?? null,
      L2: mat.L2_stage_maturity ?? [],
      L3: mat.L3_process_family_maturity ?? [],
      L4: mat.L4_overall_erp_maturity ?? null,
    },
    family_rollup: m.family_rollup ?? {},
    tasks: m.tasks ?? [],
  };
}

// ── Identity + staff (read-only registries) ────────────────────────────────
// Identity presentation is resolved HERE, once, from the canonical registry,
// so no component invents a name or a handle.
function readIdentities(identities, sourceState) {
  if (sourceState !== STATE.OK) {
    return { available: false, state: sourceState, reason: identities.reason, byHandle: {} };
  }
  const list = Array.isArray(identities.data.identities) ? identities.data.identities : [];
  const byHandle = {};

  for (const ident of list) {
    const handle = ident.canonicalHandle;
    if (!handle) continue;
    byHandle[handle] = {
      handle,
      display_name: ident.displayName ?? handle,
      role: ident.role ?? null,
      status: ident.status ?? 'UNKNOWN',
      authority_level: ident.authorityLevel ?? 'UNKNOWN',
      authority_identity_id: ident.authorityIdentityId ?? null,
      legacy_alias_of: ident.legacyAliasOf ?? null,
      aliases: ident.aliases ?? [],
      avatar: ident.avatar ?? null,
      is_legacy: Boolean(ident.legacyAliasOf),
      is_retired: String(ident.status).toLowerCase() === 'retired',
    };
  }

  const founder = Object.values(byHandle).find(
    (i) => i.authority_identity_id === 'founder' && !i.is_legacy,
  );

  return {
    available: true,
    state: STATE.OK,
    version: identities.data.version ?? 'UNKNOWN',
    count: list.length,
    byHandle,
    // The Founder presentation contract, resolved from the registry — never
    // hardcoded in a component. display Mustarq / address Founder / handle @mustarq.
    founder: founder
      ? {
          handle: founder.handle,
          display_name: founder.display_name,
          operational_handle: `@${founder.handle}`,
          authority_level: founder.authority_level,
        }
      : null,
  };
}

function readStaffState(staff, sourceState) {
  if (sourceState !== STATE.OK) {
    return { available: false, state: sourceState, reason: staff.reason, byHandle: {} };
  }
  const entries = staff.data?.entries ?? {};
  const byHandle = {};
  for (const [handle, e] of Object.entries(entries)) {
    byHandle[handle] = {
      handle,
      duty_state: e.duty_state ?? 'UNKNOWN',
      // Phase 3: `restrictions` is forwarded because a staff member carrying an
      // explicit Founder restriction must never render as freely assignable.
      // It is prose, not a machine value, and is rendered as prose.
      restrictions: e.restrictions ?? null,
      // Kept as its own name. See the Phase 3 ruling: the execution-side
      // `current_task` and this duty-side `current_task` are DIFFERENT FACTS
      // from different canonical sources. They are forwarded separately and are
      // never merged into one "the truth about this agent".
      duty_current_task: e.current_task ?? null,
      capacity_note: e.capacity_note ?? null,
      capacity_reset_at: e.capacity_reset_at ?? null,
      last_updated_at: e.last_updated_at ?? null,
      last_updated_by: e.last_updated_by ?? null,
      evidence_count: Array.isArray(e.evidence) ? e.evidence.length : 0,
    };
  }
  return {
    available: true,
    state: STATE.OK,
    schema_version: staff.data?.schema_version ?? 'UNKNOWN',
    count: Object.keys(byHandle).length,
    byHandle,
  };
}

/**
 * Phase 3 — session presence from the identity-lease directory.
 *
 * A lease file says "this handle is held by this instance, claimed at this
 * time". It is NOT proof that the agent is currently doing anything: a lease
 * outlives the work. That distinction is why the floor renders lease state and
 * execution state as two separate things.
 *
 * READ-ONLY: readdir + readFileSync only. No lease is created, renewed or
 * released here — those are bus operations and belong to send.mjs, not to a
 * read-only surface.
 */
function readSessions(workspaceRoot) {
  if (!workspaceRoot) {
    return { available: false, state: STATE.UNAVAILABLE, reason: 'workspace root unresolved', count: 0, byHandle: {} };
  }
  const dir = abs(workspaceRoot, CANONICAL.identityLeases);
  const byHandle = {};
  let count = 0;

  try {
    if (!fs.existsSync(dir)) {
      return {
        available: false,
        state: STATE.UNAVAILABLE,
        reason: `identity lease directory not found: ${CANONICAL.identityLeases}`,
        count: 0,
        byHandle,
      };
    }
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const lease = JSON.parse(fs.readFileSync(abs(dir, file), 'utf8'));
        const handle = lease.handle ?? file.replace(/\.json$/, '');
        byHandle[handle] = {
          handle,
          instance_id: lease.instanceId ?? null,
          hostname: lease.hostname ?? null,
          pid: lease.pid ?? null,
          label: lease.label ?? null,
          claimed_at: lease.claimedAt ?? null,
          last_seen_at: lease.lastSeenAt ?? null,
        };
        count += 1;
      } catch {
        // A malformed lease is a fact about that lease, not a reason to fail
        // the whole surface. It is simply absent from the roster.
      }
    }
  } catch (err) {
    return { available: false, state: STATE.UNREADABLE, reason: err.message, count, byHandle };
  }

  return {
    available: true,
    state: STATE.OK,
    count,
    source: CANONICAL.identityLeases,
    // Stated, because it is the single easiest thing to misread on this
    // surface: a lease proves a session exists, not that work is happening.
    meaning: 'A lease records that a handle is held by a session instance. It is presence, not activity.',
    byHandle,
  };
}

// ── Herdr Floor manifest (declared launch facts, read-only) ─────────────────
//
// The manifest is the only source of argv/cwd for the Herdr floor, and it is
// also the authoritative statement of what each seat's launch runtime IS
// declared to be and whether it is launchable at all. Those are declared,
// static facts and they belong on the staff surface.
//
// What the manifest does NOT contain is live state. `state`, `pid`,
// `session_id` and the floor's open-count all live in the broker's own runtime
// state. This function therefore forwards NO live value, and `live_state_source`
// names where those values must come from instead — a reader who finds a PID
// in this projection has found a bug.
function readHerdrManifest(manifest, sourceState) {
  if (sourceState !== STATE.OK) {
    return {
      available: false,
      state: sourceState,
      reason: manifest.reason ?? null,
      path: CANONICAL.herdrManifest,
      authority: 'UNAVAILABLE',
      seats: [],
      bySeatId: {},
      live_state_source: 'GET /api/herdr/state (Herdr broker, read-only)',
    };
  }

  const rows = Array.isArray(manifest.data.agents) ? manifest.data.agents : [];
  const seats = [];
  const bySeatId = {};

  for (const row of rows) {
    const seatId = row.id;
    if (!seatId) continue;
    const seat = {
      seat_id: seatId,
      label: row.label ?? seatId,
      // The runtime the manifest DECLARES for launch. This is not the same
      // question as the seat's NORMAL host in the staff profile, and where they
      // disagree the floor says so rather than picking a winner.
      declared_runtime: row.runtime ?? 'UNKNOWN',
      startup_policy: row.startup_policy ?? 'UNKNOWN',
      launchable: row.launchable === true,
      terminal: row.terminal === true,
      // Presence of an argv target, not its path — the path is host-specific and
      // carrying it onto a projection invites it to be treated as portable.
      executable_present: typeof row.executable === 'string' && row.executable.length > 0,
      identity_probe: row.identity_probe ?? null,
      herdr_kind: row.herdr?.kind ?? null,
      evidence: row.evidence ?? null,
    };
    seats.push(seat);
    bySeatId[seatId] = seat;
  }

  return {
    available: true,
    state: STATE.OK,
    path: CANONICAL.herdrManifest,
    absolute_path: manifest.absolute_path,
    authority: manifest.data.authority ?? 'HERDR_FLOOR_MANIFEST',
    manifest_version: manifest.data.version ?? null,
    count: seats.length,
    seats,
    bySeatId,
    // Stated so nobody has to guess, and so a client can tell the difference
    // between "the manifest says this seat is not launchable" and "we did not
    // look".
    meaning:
      'Declared launch facts per seat: what runtime the manifest launches, whether it is launchable, and under which startup policy.',
    live_state_source: 'GET /api/herdr/state (Herdr broker, read-only)',
    live_state_note:
      'PID, process state and PTY session are NOT read from the manifest. They are runtime facts and exist only in the broker projection.',
  };
}

// ── Provenance drift: does contract.json still describe the live files? ───
// This re-hashes the provenance set the contract DECLARES and compares it to
// the digests the contract RECORDED. It is a faithfulness check on the
// projection, never a re-derivation of business truth.
function checkProvenanceDrift(contract, sourceState, workspaceRoot) {
  if (sourceState !== STATE.OK) {
    return { state: STATE.UNAVAILABLE, sources: [], reason: 'contract.json unavailable' };
  }
  const recorded = contract.data.provenance?.generated_from ?? {};
  const results = [];

  for (const [name, entry] of Object.entries(recorded)) {
    const rel = entry?.path;
    if (!rel) continue;
    const target = abs(workspaceRoot, rel);
    const recordedDigest = entry.sha256_prefix ?? null;

    if (!fs.existsSync(target)) {
      results.push({ name, path: rel, state: STATE.UNAVAILABLE, recorded: recordedDigest, live: null, reason: 'canonical source not found on disk' });
      continue;
    }
    let live = null;
    try {
      live = sha256Prefix(target);
    } catch (err) {
      results.push({ name, path: rel, state: STATE.UNREADABLE, recorded: recordedDigest, live: null, reason: err.message });
      continue;
    }
    const matches = live === recordedDigest;
    results.push({
      name,
      path: rel,
      state: matches ? STATE.OK : STATE.DRIFT,
      recorded: recordedDigest,
      live,
    });
  }

  const drifted = results.filter((r) => r.state === STATE.DRIFT);
  const missing = results.filter((r) => r.state === STATE.UNAVAILABLE);
  const unreadable = results.filter((r) => r.state === STATE.UNREADABLE);

  return {
    state: drifted.length ? STATE.DRIFT : missing.length ? STATE.UNAVAILABLE : unreadable.length ? STATE.UNREADABLE : STATE.OK,
    checked: results.length,
    drifted: drifted.map((d) => d.name),
    missing: missing.map((d) => d.name),
    sources: results,
  };
}

/** Aggregate the surface into one honest health summary. */
function summarize(surface) {
  const { process_truth: p, execution_truth: e, work_truth: w, provenance } = surface;

  const conditions = [
    { key: 'processTruth', state: p.state, available: p.available },
    { key: 'executionTruth', state: e.state, available: e.available },
    { key: 'workTruth', state: w.state, available: w.available },
    { key: 'provenance', state: provenance.state, available: true },
  ];

  // Order matters: an unreachable source outranks a drifted one, because you
  // cannot judge truth against something you cannot read.
  const precedence = [STATE.UNAVAILABLE, STATE.UNREADABLE, STATE.DRIFT, STATE.STALE, STATE.OK];
  const overall = precedence.find((s) => conditions.some((c) => c.state === s)) ?? STATE.OK;

  return {
    overall,
    conditions,
    counts: {
      ok: conditions.filter((c) => c.state === STATE.OK).length,
      total: conditions.length,
    },
  };
}

/**
 * Assemble the whole read-only surface. SYNCHRONOUS BY CONTRACT.
 *
 * This stays synchronous on purpose: the Phase 1 contract tests import it and
 * read the result directly, and forcing them to await would change a boundary
 * that Phase 1 already proved. The Phase 2 health floor needs one await — the
 * canonical epoch module is ESM and can only be imported asynchronously — so it
 * is assembled by `buildPhase2Surface()` and merged in by the HTTP layer.
 */
export function buildSurface() {
  const resolved = resolveWorkspace();
  const workspaceRoot = resolved.root;

  if (!workspaceRoot) {
    const surface = {
      workspace: { root: null, source: resolved.source, attempted: resolved.attempted ?? null },
      assembled_at: new Date().toISOString(),
      process_truth: { available: false, state: STATE.UNAVAILABLE, reason: 'workspace root unresolved' },
      execution_truth: {
        available: false,
        roster_input_available: false,
        state: STATE.UNAVAILABLE,
        reason: 'workspace root unresolved',
      },
      work_truth: { available: false, state: STATE.UNAVAILABLE, reason: 'workspace root unresolved' },
      identities: { available: false, state: STATE.UNAVAILABLE, byHandle: {}, founder: null },
      staff_state: { available: false, state: STATE.UNAVAILABLE, byHandle: {} },
      sessions: { available: false, state: STATE.UNAVAILABLE, reason: 'workspace root unresolved', count: 0, byHandle: {} },
      herdr_manifest: {
        available: false,
        state: STATE.UNAVAILABLE,
        reason: 'workspace root unresolved',
        path: CANONICAL.herdrManifest,
        authority: 'UNAVAILABLE',
        seats: [],
        bySeatId: {},
        live_state_source: 'GET /api/herdr/state (Herdr broker, read-only)',
      },
      company_os: {
        available: false,
        state: STATE.UNAVAILABLE,
        reason: 'workspace root unresolved',
        path: CANONICAL.companySeats,
        authority: 'UNAVAILABLE',
        company: null,
        floors: [],
        rooms: [],
        seats: [],
        shared_infrastructure: [],
        founder: null,
        counts: null,
        separation: null,
        problems: [],
        conflicts: [],
      },
      provenance: { state: STATE.UNAVAILABLE, sources: [], reason: 'workspace root unresolved' },
    };
    surface.health = summarize(surface);
    return surface;
  }

  const contract = loadSource(`${CANONICAL.controlBoard}/${CONTROL_BOARD_FILES.contract}`, workspaceRoot);
  const activity = loadSource(`${CANONICAL.controlBoard}/${CONTROL_BOARD_FILES.activity}`, workspaceRoot);
  const workModel = loadSource(`${CANONICAL.controlBoard}/${CONTROL_BOARD_FILES.workModel}`, workspaceRoot);
  const identities = loadSource(CANONICAL.identities, workspaceRoot);
  const staff = loadSource(CANONICAL.staffState, workspaceRoot);
  const herdrManifest = loadSource(CANONICAL.herdrManifest, workspaceRoot);
  const roomVisibility = readRoomVisibility(workspaceRoot);

  const surface = {
    workspace: { root: workspaceRoot, source: resolved.source },
    room_visibility: {
      state: roomVisibility.state, history: roomVisibility.history,
      history_total: roomVisibility.history_total, max_sequence: roomVisibility.max_sequence,
      room_head_sequence: roomVisibility.room_head_sequence, generated_at: roomVisibility.generated_at,
      reason: roomVisibility.reason, note: roomVisibility.note,
    },
    assembled_at: new Date().toISOString(),
    process_truth: readProcessTruth(contract, contract.state),
    execution_truth: readExecutionTruth(activity, activity.state, workspaceRoot),
    work_truth: readWorkTruth(workModel, workModel.state),
    identities: readIdentities(identities, identities.state),
    staff_state: readStaffState(staff, staff.state),
    sessions: readSessions(workspaceRoot),
    herdr_manifest: readHerdrManifest(herdrManifest, herdrManifest.state),
    // Company OS. Attached at Phase 1 level, NOT inside the Dev Studio floor
    // payload and NOT inside the separate Building projection: the company is the
    // whole skyscraper and Dev Studio is one floor of it, so burying the company
    // inside its own floor would be the exact misreading the brief forbids.
    //
    // Deliberately absent from `health`. Phase 1's health contract is four
    // conditions, worst-wins, and is proven by accepted tests; a company surface
    // that cannot be read is a company-shaped absence, not a control-plane fault,
    // and folding it in would blur a distinction those tests exist to protect.
    company_os: loadCompanyOs(workspaceRoot, CANONICAL.companySeats),
    provenance: checkProvenanceDrift(contract, contract.state, workspaceRoot),
    // Declared read-only surface. Command does not write to any of these.
    //
    // DELIBERATELY NOT WIDENED for the seat-profile join.
    //
    // `identityLeases` and `herdrManifest` are both READ by this service — the
    // session projection and the declared launch facts both come from them —
    // and neither is on this list. That list is the `/api/raw` evidence-drawer
    // ALLOWLIST, not an inventory of what the service can see. Adding the Herdr
    // manifest to it would have widened the raw surface for no requirement:
    // nothing asked to serve the manifest's bytes, and a wider allowlist is a
    // wider door. The Phase 1 list stays exactly as Phase 1 declared it, and
    // phase3.reads is the place a new source is recorded.
    read_only_sources: [
      CANONICAL.controlBoard,
      CANONICAL.roomLedger,
      CANONICAL.identities,
      CANONICAL.staffState,
      CANONICAL.decisions,
      CANONICAL.onboarding,
    ],
    authority_note:
      'STARQ // COMMAND is a DERIVED_PROJECTION of canonical Starq truth. It is not an SSOT. Where it disagrees with a canonical source, the canonical source wins and this surface is drift.',
  };

  surface.health = summarize(surface);
  return surface;
}

/**
 * Phase 2: the Phase 1 surface with the health floor merged in.
 *
 * The floor is attached, never merged INTO `health`. Phase 1's `health` object
 * is the state of the three truth layers plus provenance, and its contract —
 * four conditions, worst-wins — is proven by the accepted Phase 1 tests.
 * Folding runtime dimensions into it would change a proven contract and would
 * blur the exact line this phase exists to draw: a projection being in sync is
 * a different fact from a control plane being healthy.
 */
export async function buildPhase2Surface() {
  const surface = buildSurface();
  const resolved = resolveWorkspace();
  const floor = await buildHealthFloor({ root: resolved.root, resolution: resolved });
  surface.health_floor = floor;
  surface.health_floor_summary = summarizeFloor(floor);
  surface.phase2 = {
    dimensions: DIMENSION,
    current_health_separate_from: 'preserved_historical',
    preserved_historical_count: (floor.preserved_historical ?? []).length,
    snapshot_endpoint: '/api/snapshot',
    gates_endpoint: '/api/gates',
  };
  return surface;
}

/**
 * Phase 3: the Dev Studio Floor.
 *
 * The floor is ATTACHED to the Phase 1 + Phase 2 surface, never merged into
 * either. Phase 1's `health` contract (four conditions, worst-wins) and Phase
 * 2's separation between projection conditions and control-plane dimensions are
 * both proven by accepted tests; folding a staff roster into either of them
 * would change a contract that is not this phase's to change.
 *
 * `buildFloor()` is pure — it reads the assembled surface and touches no
 * filesystem — so the whole Phase 3 payload is a deterministic function of the
 * canonical projections that were already read read-only.
 */
export async function buildPhase3Surface() {
  const surface = await buildPhase2Surface();
  surface.floor = buildFloor({ surface });
  surface.phase3 = {
    name: 'Dev Studio Floor',
    endpoint: '/api/floor',
    authority: 'DERIVED_PROJECTION',
    reads: ['activity.json', 'staff-state.json', 'identities.json', 'identity-leases', 'herdr-floor/manifest.json'],
    writes: [],
    ingest_embedded: false,
  };
  return surface;
}

// ── HTTP: thin, local, read-only. GET only. ────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-starq-command-authority': 'DERIVED_PROJECTION',
    'x-starq-command-access': 'READ_ONLY',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Read-only surface. Writes are refused structurally, not by policy text.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end(JSON.stringify({ error: 'STARQ // COMMAND data service is READ-ONLY.' }));
  }

  // The observation-only owner opts into a narrower GET/HEAD route set. In
  // particular, /api/gates is excluded because it launches audit scripts even
  // though it is transported as GET. Full-floor behavior is unchanged when
  // this explicit profile marker is absent.
  if (process.env.COMMAND_OBSERVATION_ONLY === '1' && !OBSERVATION_READ_ROUTES.has(url.pathname)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ error: 'route is outside the observation-only Command projection allowlist' }));
  }

  if (url.pathname === '/api/health') {
    try {
      const surface = await buildPhase2Surface();
      const isHealthy = surface.health?.overall === STATE.OK;
      return sendJson(res, isHealthy ? 200 : 503, {
        assembled_at: surface.assembled_at,
        workspace: surface.workspace,
        health: surface.health,
        health_floor_summary: surface.health_floor_summary ?? null,
        authority_note: surface.authority_note,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (url.pathname === '/api/health-floor') {
    try {
      const surface = await buildPhase2Surface();
      return sendJson(res, 200, {
        generated_at: surface.assembled_at,
        summary: surface.health_floor_summary ?? null,
        floor: surface.health_floor ?? null,
        authority_note: surface.authority_note,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message, state: STATE.UNREADABLE });
    }
  }

  if (url.pathname === '/api/surface') {
    try {
      return sendJson(res, 200, await buildPhase3Surface());
    } catch (err) {
      return sendJson(res, 500, { error: err.message, state: STATE.UNREADABLE });
    }
  }

  // Phase 3: the Dev Studio Floor payload on its own.
  //
  // Same data as `/api/surface.floor`, exposed separately so the roster and the
  // feed can be consumed without dragging the full process-truth and work-truth
  // payloads along. Still GET-only, still read-only, still the same assembly.
  if (url.pathname === '/api/floor') {
    try {
      const surface = await buildPhase3Surface();
      return sendJson(res, 200, {
        generated_at: surface.floor.generated_at,
        authority_note: surface.authority_note,
        phase3: surface.phase3,
        floor: surface.floor,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message, state: STATE.UNREADABLE });
    }
  }

  // #9538 extends #9535 with evidence-backed Room records. These records never
  // establish current runtime activity, business acceptance or process maturity.
  if (url.pathname === '/api/work-packages') {
    const visibility = readRoomVisibility(resolveWorkspace().root);
    const project = url.searchParams.get('project_id');
    return sendJson(res, 200, visibility.work === null ? null :
      project ? visibility.work.filter(row => row.project_id === project) : visibility.work);
  }

  // Phase 2: the versioned, transport-agnostic envelope.
  //
  // This is a READ of the same surface the local UI renders, wrapped in a
  // self-describing envelope with no absolute host paths. It is NOT remote
  // access: nothing is pushed, no transport is opened, and the local Command
  // remains authoritative. The route exists so a future client has a contract
  // to code against without a second negotiation of the data boundary.
  if (url.pathname === '/api/snapshot') {
    try {
      const surface = await buildPhase2Surface();
      const snapshot = buildSnapshot({
        surface,
        floor: surface.health_floor ?? null,
        workspaceRoot: surface.workspace.root,
        scope: url.searchParams.get('scope') ?? 'full',
      });
      return sendJson(res, 200, snapshot);
    } catch (err) {
      return sendJson(res, 500, { error: err.message, state: STATE.UNREADABLE });
    }
  }

  // Phase 2: run the read-only reconciliation gates, on explicit request only.
  if (url.pathname === '/api/gates') {
    try {
      const resolved = resolveWorkspace();
      return sendJson(res, 200, runReadOnlyGates({ root: resolved.root }));
    } catch (err) {
      return sendJson(res, 500, { error: err.message, state: STATE.UNREADABLE });
    }
  }

  if (url.pathname === '/api/identity') {
    try {
      const surface = buildSurface();
      return sendJson(res, 200, {
        state: surface.identities.state,
        version: surface.identities.version,
        count: surface.identities.count,
        founder: surface.identities.founder,
        identities: surface.identities.byHandle,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (url.pathname === '/api/raw') {
    // Optional provenance read: stream a canonical file read-only for the
    // evidence drawer. Restricted to declared canonical paths.
    try {
      const surface = buildSurface();
      if (!surface.workspace.root) return sendJson(res, 503, { error: 'workspace unresolved' });
      const rel = url.searchParams.get('path') || '';

      // Corrective fix (Room seq 8316): the allowlist is applied to a
      // NORMALISED, resolved path inside the declared boundary — never to the
      // raw request string, which `../` could walk out of. See path-guard.mjs.
      const guard = resolveReadOnlyTarget({
        workspaceRoot: surface.workspace.root,
        requested: rel,
        allowed: surface.read_only_sources,
      });
      if (!guard.ok) {
        return sendJson(res, guard.status, {
          error: guard.error,
          read_only_sources: surface.read_only_sources,
        });
      }

      const target = guard.resolved;
      if (!fs.existsSync(target)) return sendJson(res, 404, { error: 'not found', path: rel });
      const stat = fs.statSync(target);
      if (stat.isDirectory()) return sendJson(res, 400, { error: 'path is a directory', path: rel });
      if (stat.size > 8 * 1024 * 1024) return sendJson(res, 413, { error: 'file too large to inline', path: rel, bytes: stat.size });
      const content = fs.readFileSync(target, 'utf8');
      res.writeHead(200, {
        'content-type': MIME[path.extname(target)] || 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-starq-command-access': 'READ_ONLY',
      });
      return res.end(content);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    error: 'not found',
    routes: [
      '/api/health',
      '/api/health-floor',
      '/api/surface',
      '/api/floor',
      '/api/work-packages',
      '/api/snapshot',
      '/api/gates',
      '/api/identity',
      '/api/raw?path=',
    ],
  }));
});

// Only bind a port when executed directly. When the test suite imports this
// module to exercise buildSurface(), it must not occupy a port.
const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isDirectRun) {
  server.listen(PORT, HOST, () => {
    const resolved = resolveWorkspace();
    console.log(`[starq-command] data service (READ-ONLY) on http://${HOST}:${PORT}`);
    console.log(`[starq-command] workspace: ${resolved.root ?? 'UNRESOLVED'} (via ${resolved.source})`);
    if (!resolved.root) {
      console.warn(
        '[starq-command] WARNING: workspace root unresolved — surfaces will report UNAVAILABLE, not empty.',
      );
    }
  });
}

export { server, PORT, HOST };

// GET / HEAD only; excludes /api/gates (script execution) and any absent or
// future route until it is reviewed for observation-only safety.
export const OBSERVATION_READ_ROUTES = new Set([
  '/api/health', '/api/surface', '/api/work-packages',
]);
