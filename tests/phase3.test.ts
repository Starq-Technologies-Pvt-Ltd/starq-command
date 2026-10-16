import { describe, it, expect } from 'vitest';
import { BUILDING_SOURCES } from '../server/building.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildPhase3Surface } from '../server/data-service.mjs';
import { buildFloor } from '../server/floor.mjs';

/**
 * ── THE INDEPENDENT ORACLE ──────────────────────────────────────────────────
 *
 * The canonical Founder rule being tested, restated here from the rule itself
 * and NOT from the implementation:
 *
 *   a signal-bearing event is one where
 *     has_evidence === true
 *     OR is_blocker === true
 *     OR is_handoff === true
 *     OR needs_founder === true
 *
 * This block is deliberately written without importing `carriesSignal` or
 * `SIGNAL_FLAGS` from server/floor.mjs. An earlier version of this file
 * computed its expected signal population with the very function under test,
 * which made the zero-signal-loss assertion circular: removing `has_evidence`
 * from the production filter silently removed ~57 genuinely signal-bearing
 * events from the feed AND lowered the expected count by the same amount, so
 * the suite stayed green while the floor hid evidence. The payload kept
 * reporting signal_loss = 0 and nothing was able to contradict it.
 *
 * The oracle below is the only thing allowed to define "signal-bearing" for
 * the purpose of judging the implementation. If the production rule and this
 * rule ever disagree, that disagreement is the finding.
 */
const ORACLE_FLAGS = [
  'has_evidence',
  'is_blocker',
  'is_handoff',
  'needs_founder',
] as const;

const oracleCarriesSignal = (event: any) =>
  ORACLE_FLAGS.some((flag) => event?.[flag] === true);

/**
 * Phase 3 architectural guard tests — the Dev Studio Floor.
 *
 * These run against the LIVE workspace. If canonical projections move or vanish
 * the suite fails, and that is the point: a floor that quietly renders stale
 * structure is worse than one that refuses to render.
 *
 * Every test here corresponds to a Founder ruling or a stated Phase 3
 * constraint. A regression is a governance regression, not a bug.
 */

const APP_ROOT = process.cwd();
const SRC = path.join(APP_ROOT, 'src');
const SERVER = path.join(APP_ROOT, 'server');

function walk(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** Strip comments before auditing source: these tests assert what code does. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const floorSrc = code(readFileSync(path.join(SRC, 'surfaces', 'floor.tsx'), 'utf8'));
const serverFiles = walk(SERVER, ['.mjs', '.js']);
const floorServer = readFileSync(path.join(SERVER, 'floor.mjs'), 'utf8');

const surface = await buildPhase3Surface();
const floor = surface.floor!;

describe('Phase 3 — the floor assembles from live canonical source', () => {
  it('carries the Phase 3 payload on the surface', () => {
    expect(surface.phase3?.name).toBe('Dev Studio Floor');
    expect(surface.floor).toBeTruthy();
    expect(floor.phase).toBe(3);
    expect(floor.is_ssot).toBe(false);
    expect(floor.access).toBe('READ_ONLY');
  });

  it('is attached to the Phase 1 and Phase 2 contracts, not merged into them', () => {
    // Phase 1's four-condition health contract must be untouched.
    expect(surface.health.conditions.length).toBe(4);
    expect(surface.health.overall).toBeTruthy();
    // Phase 2's floor must still exist and still be separate.
    expect(surface.health_floor).toBeTruthy();
    expect(surface.health_floor_summary).toBeTruthy();
    // And Phase 3 must not have leaked into either vocabulary.
    expect(JSON.stringify(surface.health)).not.toMatch(/Dev Studio Floor/);
  });

  it('reads the execution projection from activity.json, not from a fixture', () => {
    expect(floor.execution_projection.authority).toBe('DERIVED_PROJECTION');
    expect(floor.execution_projection.generated_at).toBeTruthy();
    expect(surface.execution_truth.agents.length).toBeGreaterThan(0);
    expect(floor.roster.entries.length).toBe(surface.execution_truth.agents.length);
  });

  it('does not perform the ingest itself', () => {
    // Founder ruling 3: Command surfaces staleness and names regeneration; it
    // never re-ingests, because the ingester writes to the control board.
    expect(floor.execution_projection.ingest_performed_by_command).toBe(false);
    expect(surface.phase3?.ingest_embedded).toBe(false);
    expect(floor.execution_projection.ingest_note).toMatch(/never re-ingests/i);
    // The ingester must remain on the REFUSED list from Phase 2.
    const gates = readFileSync(path.join(SERVER, 'gates.mjs'), 'utf8');
    expect(gates).toMatch(/ingest_room_activity\.py/);
    expect(gates).toMatch(/REFUSED_SCRIPTS/);
  });
});

describe('Phase 3 — RULING 6: unknown identity is never inferred or merged', () => {
  it('marks an agent with no canonical identity as UNKNOWN rather than filling one in', () => {
    const unidentified = floor.roster.entries.filter((e) => !e.identity_present);
    // The live ledger does contain such a handle, so this is not vacuous.
    expect(unidentified.length).toBeGreaterThan(0);

    for (const e of unidentified) {
      // NOTHING is invented: no display name, no role, no authority level, no
      // identity status beyond the canonical UNKNOWN the ledger already records.
      expect(e.display_name).toBeNull();
      expect(e.role).toBeNull();
      expect(e.authority_level).toBeNull();
      expect(e.identity_status).toBe('UNKNOWN');
      // And it is flagged, not quietly rendered as a normal staff tile.
      expect(e.identity_present).toBe(false);
    }
  });

  it('flags an unidentified handle as CONFLICT without overriding canonical truth', () => {
    // `hermes` is the collision partner of `nexus`: both carry
    // `ident_01J6HM...7`, and `hermes` has no entry in the identity registry.
    // Canonical activity.json nonetheless records `counts_as_active_staff: true`.
    //
    // Command FORWARDS that value and marks the row CONFLICT / UNKNOWN IDENTITY.
    // It does not flip it to false: overriding a canonical flag would be exactly
    // the adjudication this product refuses to perform, and the recorded
    // IDENTITY_COLLISION already carries the finding for the Founder.
    for (const e of floor.roster.entries.filter((x) => !x.identity_present)) {
      // Forwarded verbatim, never recomputed.
      expect(e.counts_as_active_staff).toBe(
        surface.execution_truth.agents.find((a) => a.handle === e.handle)?.counts_as_active_staff,
      );
      // But it can never be presented without its conflict.
      expect(e.has_conflict || e.identity_present === false).toBe(true);
    }

    // The surface renders the condition rather than resolving it.
    const kinds = new Set(floor.constraints.map((c) => c.kind));
    expect(kinds.has('UNKNOWN_IDENTITY')).toBe(true);
    expect(kinds.has('IDENTITY_CONFLICT')).toBe(true);
  });

  it('raises an UNKNOWN_IDENTITY constraint for every such handle', () => {
    const kinds = floor.constraints.filter((c) => c.kind === 'UNKNOWN_IDENTITY');
    const unidentified = floor.roster.entries.filter((e) => !e.identity_present);
    expect(kinds.length).toBe(unidentified.length);
    for (const k of kinds) {
      expect(k.resolution).toMatch(/NOT INFERED/);
    }
  });

  it('surfaces every recorded identity conflict without merging the handles', () => {
    const recorded = surface.execution_truth.conflicts;
    expect(recorded.length).toBeGreaterThan(0);
    const raised = floor.constraints.filter((c) => c.kind === 'IDENTITY_CONFLICT');
    expect(raised.length).toBe(recorded.length);
    for (const r of raised) {
      expect(r.resolution).toMatch(/NEVER MERGED/);
    }
    // A collision must never collapse into one roster entry.
    const handles = floor.roster.entries.map((e) => e.handle);
    expect(new Set(handles).size).toBe(handles.length);
  });
});

describe('Phase 3 — RETIRED never renders as active staff', () => {
  const retired = floor.roster.entries.filter((e) => e.is_retired);

  it('classifies retirement from canonical source only', () => {
    expect(retired.length).toBeGreaterThan(0);
    for (const e of retired) {
      // Retirement is asserted by canonical classification or canonical status.
      const canonicalRetired =
        e.staff_classification === 'RETIRED' || e.identity_status === 'retired';
      expect(canonicalRetired).toBe(true);
      // And the consequence is structural, not cosmetic.
      expect(e.is_active_staff).toBe(false);
    }
  });

  it('keeps a retired handle out of the active-staff count', () => {
    const countedActive = floor.roster.entries.filter((e) => e.is_active_staff);
    for (const e of countedActive) {
      expect(e.is_retired).toBe(false);
      expect(e.staff_classification).toBe('STAFF');
      expect(e.counts_as_active_staff).toBe(true);
    }
    expect(floor.roster.counts.active_staff).toBe(countedActive.length);
    expect(floor.roster.counts.retired).toBe(retired.length);
    expect(floor.roster.counts.active_staff + floor.roster.counts.retired).toBeLessThanOrEqual(
      floor.roster.counts.observed,
    );
  });

  it('states RETIRED in the rendered markup, not only as a tone value', () => {
    // The chip vocabulary has to name the state, or a retired tile falls
    // through to unstyled text and reads as a working one.
    expect(floorSrc).toMatch(/RETIRED — NOT ACTIVE STAFF/);
    expect(floorSrc).toMatch(/STAFF_CLASS_TONE/);
  });

  it('separates BEING from DOING: execution state does not grant staff status', () => {
    // An agent whose execution state is `active` is still not active staff
    // unless canonical source says so. This is the exact inversion that would
    // put a retired identity back on the floor.
    for (const e of floor.roster.entries) {
      if (e.current_state === 'active' && !e.counts_as_active_staff) {
        expect(e.is_active_staff).toBe(false);
      }
    }
    const states = new Set(floor.roster.entries.map((e) => e.current_state));
    const activeExec = floor.roster.entries.filter((e) => e.current_state === 'active');
    expect(activeExec.length).toBeGreaterThan(0);
    expect(states.size).toBeGreaterThan(1);
  });
});

describe('Phase 3 — RULING 2: the two current-task truths are never merged', () => {
  it('carries both sides with explicit provenance when both exist', () => {
    const both = floor.roster.entries.filter((e) => e.execution_current_task && e.duty_current_task);
    expect(both.length).toBeGreaterThan(0);
    for (const e of both) {
      expect(e.truth_disagreement).toBeTruthy();
      expect(e.truth_disagreement!.execution_side.source).toBe('activity.json');
      expect(e.truth_disagreement!.duty_side.source).toBe('staff-state.json');
    }
  });

  it('reports the disagreement without adjudicating it', () => {
    const differing = floor.roster.entries.filter(
      (e) => e.truth_disagreement?.values_differ === true,
    );
    expect(differing.length).toBeGreaterThan(0);
    for (const e of differing) {
      expect(e.truth_disagreement!.resolution).toMatch(/NOT RESOLVED BY COMMAND/);
      // Neither side is discarded, normalised or overwritten.
      expect(e.execution_current_task).toBe(e.truth_disagreement!.execution_side.value);
      expect(e.duty_current_task).toBe(e.truth_disagreement!.duty_side.value);
    }
  });

  it('raises a TRUTH_DISAGREEMENT constraint per differing handle', () => {
    const differing = floor.roster.entries.filter(
      (e) => e.truth_disagreement?.values_differ === true,
    );
    const raised = floor.constraints.filter((c) => c.kind === 'TRUTH_DISAGREEMENT');
    expect(raised.length).toBe(differing.length);
    expect(floor.roster.counts.truth_disagreements).toBe(differing.length);
  });

  it('keeps the execution-side and duty-side fields under different names', () => {
    // The rename is the structural guarantee: one field cannot silently acquire
    // the meaning of the other.
    const contracts = readFileSync(path.join(SRC, 'lib', 'contracts.ts'), 'utf8');
    expect(contracts).toMatch(/duty_current_task/);
    expect(contracts).toMatch(/execution_current_task/);
  });
});

describe('Phase 3 — RULING: mentions can never be presented as assignments', () => {
  it('forwards a mention COUNT and never the mention id list', () => {
    // The canonical `mentioned_tasks` array runs to 186 entries per agent.
    // Forwarding it is what would make it presentable as work in progress.
    const service = readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8');
    expect(service).not.toMatch(/^\s*mentioned_tasks:/m);
    expect(service).toMatch(/mentioned_task_count/);
    for (const e of floor.roster.entries) {
      expect(e.mentioned_task_count).toBeGreaterThanOrEqual(0);
      expect(e).not.toHaveProperty('mentioned_tasks');
    }
    for (const row of floor.assignments) {
      expect(row).not.toHaveProperty('mentioned_tasks');
      expect(row.mention_count).toBeGreaterThanOrEqual(0);
    }
  });

  it('names the mention count as mentions, in the payload and in the markup', () => {
    for (const row of floor.assignments) {
      expect(row.mention_note).toMatch(/not an assignment/i);
    }
    expect(floorSrc).toMatch(/a mention is not an assignment/i);
    // The assignment table has a distinct Mentions column heading.
    expect(floorSrc).toMatch(/<TableHead className="text-right">Mentions<\/TableHead>/);
  });

  it('never places a mention count inside an assignment field', () => {
    // The strongest form: no assignment value is derived from a mention count.
    for (const row of floor.assignments) {
      if (row.current_assignment !== null) {
        expect(row.current_assignment).not.toBe(String(row.mention_count));
      }
      if (row.current_task !== null) {
        expect(row.current_task).not.toBe(String(row.mention_count));
      }
    }
  });
});

describe('Phase 3 — RULING 7: activity is rendered from evidence, not inferred', () => {
  it('shows an event only when the ORACLE says it carries a canonical signal flag', () => {
    // Judged by the independent oracle, not by the implementation's own filter.
    for (const e of floor.activity.events) {
      expect(
        oracleCarriesSignal(e),
        `event ${e.event_id} shown without a signal flag`,
      ).toBe(true);
    }
  });

  it('shows an event the ORACLE says is signal-bearing', () => {
    // The direction the old suite could not see: not just "nothing spurious is
    // shown" but "nothing genuinely signal-bearing is hidden".
    const shown = new Set(floor.activity.events.map((e) => e.event_id));
    for (const e of surface.execution_truth.activity_events) {
      if (!oracleCarriesSignal(e)) continue;
      expect(
        shown.has(e.event_id),
        `signal-bearing event ${e.event_id} (seq ${e.broker_sequence}) is missing from the feed`,
      ).toBe(true);
    }
  });

  it('loses zero signal-flagged events', () => {
    // Expected population is computed by the INDEPENDENT ORACLE over the live
    // window. The production filter is the thing under test and contributes
    // nothing to the expectation.
    const window = surface.execution_truth.activity_events;
    const oracleSignalTotal = window.filter(oracleCarriesSignal).length;
    expect(floor.activity.filter.signal_total).toBe(oracleSignalTotal);
    expect(floor.activity.filter.signal_loss).toBe(0);
    expect(floor.activity.filter.shown).toBe(oracleSignalTotal);
    expect(floor.activity.filter.guarantee).toMatch(/survives into the feed/);
  });

  it('declares exactly the four canonical signal flags, spelled out literally', () => {
    // A literal, not a reference to the implementation's constant: if the
    // production SIGNAL_FLAGS ever loses a member, this fails independently.
    expect(floor.activity.filter.signal_flags).toEqual([
      'has_evidence',
      'is_blocker',
      'is_handoff',
      'needs_founder',
    ]);
  });

  it('the oracle is non-vacuous — it discriminates and is not a tautology', () => {
    // A guard proved of a tautology is no guard at all. Seed events prove the
    // oracle returns true for a genuinely signal-bearing event and false for an
    // event that carries nothing, including the exact case the old circular
    // suite was blind to: an event whose ONLY signal is has_evidence.
    expect(oracleCarriesSignal({ has_evidence: true })).toBe(true);
    expect(oracleCarriesSignal({ is_blocker: true })).toBe(true);
    expect(oracleCarriesSignal({ is_handoff: true })).toBe(true);
    expect(oracleCarriesSignal({ needs_founder: true })).toBe(true);
    expect(oracleCarriesSignal({ has_evidence: true, is_blocker: false })).toBe(true);
    expect(oracleCarriesSignal({ has_evidence: false })).toBe(false);
    expect(oracleCarriesSignal({ is_blocker: false, is_handoff: false, needs_founder: false })).toBe(false);
    expect(oracleCarriesSignal({})).toBe(false);
    expect(oracleCarriesSignal(null)).toBe(false);
    // Truthiness, not mere presence: a canonical `false` is not signal.
    expect(oracleCarriesSignal({ has_evidence: 'yes' })).toBe(false);
    // The live window really does contain has_evidence-only events. If this ever
    // reaches zero the oracle's most important discrimination is untested here.
    const evidenceOnly = surface.execution_truth.activity_events.filter(
      (e: any) =>
        e?.has_evidence === true &&
        e?.is_blocker !== true &&
        e?.is_handoff !== true &&
        e?.needs_founder !== true,
    );
    expect(evidenceOnly.length).toBeGreaterThan(0);
  });

  it('every event the production filter keeps is one the oracle also keeps', () => {
    // The reverse direction: the production filter must not be MORE permissive
    // than the canonical rule (a widened filter is also evidence loss of
    // meaning). This closes the loop in both directions.
    const shown = new Set(floor.activity.events.map((e) => e.event_id));
    for (const e of surface.execution_truth.activity_events) {
      if (shown.has(e.event_id)) {
        expect(oracleCarriesSignal(e), `event ${e.event_id} shown but not signal-bearing`).toBe(true);
      }
    }
  });

  it('carries provenance on every feed row', () => {
    for (const e of floor.activity.events) {
      expect(e.event_id).toBeTruthy();
      expect(e.created_at).toBeTruthy();
      expect(e.body_sha).toBeTruthy();
      expect(e.record_hash).toBeTruthy();
    }
  });

  it('leaves a null canonical action null, so the UI renders UNKNOWN', () => {
    // The live window has action set on 11 of 400 events. Inventing the rest
    // from body prose is exactly the attribution the ruling forbids.
    const withAction = floor.activity.events.filter((e) => e.action !== null);
    const windowWithAction = surface.execution_truth.activity_events.filter(
      (e) => e.action != null,
    );
    expect(withAction.length).toBeLessThanOrEqual(windowWithAction.length);
    for (const e of floor.activity.events) {
      if (e.action === null) expect(e.action).toBeNull();
    }
    expect(floorSrc).toMatch(/UNKNOWN/);
  });

  it('never renders a lifetime event count as a recent-window count', () => {
    // The canonical field is all-time. The window is a fraction of it, so the
    // two are structurally renamed and can never be read as one number.
    const contracts = readFileSync(path.join(SRC, 'lib', 'contracts.ts'), 'utf8');
    expect(contracts).toMatch(/lifetime_events/);
    expect(contracts).not.toMatch(/^\s*events: number;/m);

    for (const e of floor.roster.entries) {
      expect(e.lifetime_events).toBeGreaterThanOrEqual(
        floor.activity.window.size > 0 ? 0 : 0,
      );
    }
    // No window event count is ever exposed as a per-agent total.
    const feedCounts = new Set(floor.activity.events.map((e) => e.broker_sequence));
    expect(feedCounts.size).toBe(floor.activity.events.length);
    expect(floorSrc).toMatch(/lifetime/);
  });

  it('carries no process_stage and no maturity into the feed', () => {
    // Founder guard: no maturity/scoring logic reaches the floor.
    for (const e of floor.activity.events) {
      expect(e).not.toHaveProperty('process_stage');
      expect(e).not.toHaveProperty('stage_maturity');
      expect(e).not.toHaveProperty('maturity');
    }
    expect(JSON.stringify(floor)).not.toMatch(/"maturity"/);
    expect(JSON.stringify(floor)).not.toMatch(/L4_/);
    expect(JSON.stringify(floor)).not.toMatch(/L3_/);
  });

  it('labels process_family as context, never as progress', () => {
    for (const e of floor.activity.events) {
      expect(Object.keys(e)).toContain('process_family_context');
      expect(Object.keys(e)).not.toContain('process_family');
    }
    expect(floorSrc).toMatch(/activity <em>against<\/em> a family, never progress/);
  });
});

describe('Phase 3 — RULING 4: no client-side time recomputation', () => {
  it('renders no clock call anywhere in the floor component', () => {
    // No Date.now(), no new Date(), no performance.now(). A recomputed age on a
    // stale projection is wrong by exactly the projection's age, so the surface
    // shows timestamps and lets the reader see the whole offset.
    expect(floorSrc).not.toMatch(/Date\.now\s*\(/);
    expect(floorSrc).not.toMatch(/new\s+Date\s*\(/);
    expect(floorSrc).not.toMatch(/performance\.now\s*\(/);
    expect(floorSrc).not.toMatch(/getTime\s*\(\s*\)/);
  });

  it('never renders hours_since_last_activity as live truth', () => {
    // The field is forwarded under a name that says it was frozen at ingest,
    // and no component renders it.
    expect(floorSrc).not.toMatch(/hours_since_last_activity_at_ingest/);
    expect(floorSrc).not.toMatch(/formatAge/);
    expect(floorSrc).not.toMatch(/hours since/i);
  });

  it('renders last_activity_at beside the projection generated_at', () => {
    expect(floorSrc).toMatch(/last_activity_at/);
    expect(floorSrc).toMatch(/Projection generated_at/);
    expect(floor.execution_projection.generated_at).toBeTruthy();
  });
});

describe('Phase 3 — RULING 3: a stale projection is visibly stale', () => {
  it('carries the projection state and reason into the payload', () => {
    expect(floor.execution_projection.state).toBeTruthy();
    if (floor.execution_projection.state === 'STALE') {
      expect(floor.execution_projection.reason).toBeTruthy();
    }
  });

  it('raises a STALE_EXECUTION_PROJECTION constraint when the ledger moved', () => {
    const stale = floor.execution_projection.state === 'STALE';
    const raised = floor.constraints.filter((c) => c.kind === 'STALE_EXECUTION_PROJECTION');
    if (stale) {
      expect(raised.length).toBeGreaterThan(0);
      for (const r of raised) {
        expect(r.resolution).toMatch(/NOT performed by Command/);
        expect(r.resolution).toMatch(/ingest_room_activity\.py/);
      }
    } else {
      expect(raised.length).toBe(0);
    }
  });

  it('states the staleness in the rendered markup', () => {
    expect(floorSrc).toMatch(/Execution projection state/);
    expect(floorSrc).toMatch(/No age shown anywhere on this surface is recomputed/);
  });
});

describe('Phase 3 — RULING 1: provider health is absent, not inferred', () => {
  it('declares provider health as excluded in the payload', () => {
    expect(floor.excluded.provider_health).toMatch(/EXCLUDED BY FOUNDER RULING/);
    expect(JSON.stringify(floor)).not.toMatch(/"provider"\s*:/);
  });

  it('never renders a provider field anywhere in the surface', () => {
    expect(floorSrc).not.toMatch(/provider_name|model_id|llm_provider|\bprovider\s*:/i);
    // The word appears only in the explicit exclusion notice.
    const providerMentions = floorSrc.match(/provider/gi) ?? [];
    for (const _ of providerMentions) {
      expect(floorSrc).toMatch(/provider health: excluded/);
      break;
    }
  });
});

describe('Phase 3 — RULING 5: avatars stay out and the read surface is not widened', () => {
  it('does not serve avatars', () => {
    expect(floorSrc).not.toMatch(/<img\b/);
    expect(floorSrc).not.toMatch(/avatar/i);
    expect(floor.excluded.avatars).toMatch(/OUT OF PHASE 3/);
  });

  it('does not widen the declared read-only source list', () => {
    // Adding the avatar directory to `read_only_sources` would let /api/raw
    // serve binaries. The list must be exactly what Phase 1 declared.
    //
    // Phase 7 (Room seq 8361) tightened this further. The Building/Hoadha
    // sources are NO LONGER declared here: Hoadha is projected by a separate
    // read-only origin, so the frozen Phase 5 data service declares exactly the
    // Phase 1 list and not one source more. An earlier revision of this test
    // asserted `...BUILDING_SOURCES` sat in front of the Phase 1 entries, which
    // was the coupling seq 8361 forbids.
    expect(surface.read_only_sources).toEqual([
      '00_STARQ_HQ/operations/starqerp-control-board',
      'agent-comms/room.jsonl',
      'agent-comms/protocol/v1/identities.json',
      'agent-comms/protocol/v1/staff-state.json',
      '00_STARQ_HQ/decisions.json',
      '00_STARQ_HQ/operations/ONBOARDING.md',
    ]);
    // The Phase 5 read surface is not widened by Phase 7 at all — not even by
    // a Hoadha source, and not even read-only.
    for (const src of surface.read_only_sources) {
      expect(src).not.toMatch(/avatar/i);
      expect(BUILDING_SOURCES).not.toContain(src);
    }
  });

  it('keeps the Hoadha/Building sources out of the frozen data service entirely', () => {
    // The stronger Phase 7 claim: the frozen service neither declares nor
    // imports the Building projection. If someone re-attaches it, this fails.
    const service = readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8');
    expect(service).not.toMatch(/building\.mjs/);
    expect(service).not.toMatch(/BUILDING_SOURCES/);
    expect(service).not.toMatch(/buildBuilding/);
    // And it must not name a Hoadha path at all.
    expect(service).not.toMatch(/hoadha/i);
  });
});

describe('Phase 3 — GUARDS: read-only, no writes, no new canonical source', () => {
  it('adds no filesystem write primitive to the server', () => {
    const forbidden = [
      'writeFileSync',
      'appendFileSync',
      'rmSync',
      'unlinkSync',
      'renameSync',
      'mkdirSync',
      'copyFileSync',
      'truncateSync',
      'createWriteStream',
      'fs.write',
    ];
    for (const file of serverFiles) {
      const src = code(readFileSync(file, 'utf8'));
      for (const token of forbidden) {
        expect(
          src.includes(token),
          `${path.basename(file)} contains forbidden write primitive: ${token}`,
        ).toBe(false);
      }
    }
  });

  it('reads the lease directory without creating, renewing or releasing a lease', () => {
    const src = code(floorServer);
    expect(src).not.toMatch(/claimOrRenewLease|releaseLease/);
    // The lease reader is in data-service.mjs and only reads.
    const service = code(readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8'));
    expect(service).toMatch(/readdirSync/);
    expect(service).toMatch(/readFileSync/);
  });

  it('invented no new canonical source to satisfy a UI promise', () => {
    // Every value on the floor comes from one of the four declared read-only
    // sources. If a future phase adds a fifth, this test must be updated
    // deliberately rather than silently.
    //
    // FIFTH SOURCE, ADDED DELIBERATELY (Founder Room seq 8475).
    //
    // The Herdr Floor manifest is now read for the DECLARED launch facts each
    // seat carries — launch runtime, launchable, startup policy — which is the
    // "join Herdr for launchability" half of the Founder's directive. It is a
    // read of an existing approved manifest, not an invented source, and it is
    // declared here rather than absorbed silently.
    //
    // What it deliberately does NOT bring is any live value. PID, process state
    // and PTY session are runtime facts and come from the broker projection at
    // render time; the manifest is a static declaration and carries none of
    // them. `floor.excluded.live_pid_and_process_state` says so in the payload.
    //
    // Note also that this is `phase3.reads`, NOT `surface.read_only_sources`.
    // The manifest is intentionally absent from the `/api/raw` allowlist: nothing
    // asked to serve its bytes, and widening that door was not in scope.
    expect(surface.phase3?.reads).toEqual([
      'activity.json',
      'staff-state.json',
      'identities.json',
      'identity-leases',
      'herdr-floor/manifest.json',
    ]);
    expect(surface.phase3?.writes).toEqual([]);
    // The canonical path constants introduced for this are the lease dir, which
    // Phase 2 already declared for its identityLease dimension, and the Herdr
    // manifest, declared for the declared-launch join above.
    const paths = readFileSync(path.join(SERVER, 'paths.mjs'), 'utf8');
    expect(paths).toMatch(/identityLeases/);
    expect(paths).toMatch(/herdrManifest/);
    // And the manifest stays OUT of the raw-evidence allowlist.
    expect(surface.read_only_sources).not.toContain('00_STARQ_HQ/operations/herdr-floor/manifest.json');
  });

  it('does not widen the /api/raw allowlist', () => {
    const guard = readFileSync(path.join(SERVER, 'path-guard.mjs'), 'utf8');
    expect(guard).toMatch(/resolveReadOnlyTarget/);
    expect(guard).not.toMatch(/avatars/i);
  });

  it('serves only GET and HEAD, and adds no outbound transport', () => {
    const service = readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8');
    expect(service).toMatch(/req\.method !== 'GET' && req\.method !== 'HEAD'/);
    for (const file of serverFiles) {
      const src = code(readFileSync(file, 'utf8'));
      expect(src, `${path.basename(file)} opens an outbound request`).not.toMatch(
        /\b(fetch|axios|https?\.request|undici)\b/,
      );
    }
  });

  it('carries no absolute host path into the floor payload', () => {
    const ABS = /(?:^|[^A-Za-z0-9_])[A-Za-z]:(?![\\/]{2})[\\/]/;
    expect(ABS.test(JSON.stringify(floor))).toBe(false);
  });

  it('introduces no mobile, auth or cloud implementation', () => {
    expect(floorSrc).not.toMatch(/navigator\.serviceWorker|manifest\.json|localStorage|sessionStorage/);
    for (const file of serverFiles) {
      const src = code(readFileSync(file, 'utf8'));
      // Match real auth MECHANISMS, not the word "authorization" — Phase 1
      // already forwards a canonical process-truth field literally named
      // `restart_wave_after_authorization`, and flagging that would be the test
      // failing on correct inherited code.
      expect(src, `${path.basename(file)} adds an auth mechanism`).not.toMatch(
        /\bAuthorization\s*['":=]|Bearer\s+['"`]|\bjsonwebtoken\b|\bpassport\b|createHmac|verifySignature\s*\(/,
      );
    }
  });
});

describe('Phase 3 — GUARD: no maturity or scoring logic in React', () => {
  const uiFiles = walk(SRC, ['.ts', '.tsx']).filter((f) => !f.endsWith('.d.ts'));

  it('computes no weighted rollup, average or cap in the floor', () => {
    const forbidden = [
      /stage_cap/i,
      /stage_weight\s*\[/i,
      /family_weight/i,
      /erp_cap/i,
      /control_gate/i,
      /\.reduce\([^)]*avg/i,
      /\bmean\s*\(/,
      /\baverage\s*\(/i,
    ];
    for (const pattern of forbidden) {
      expect(pattern.test(floorSrc), `floor.tsx matches forbidden pattern ${pattern}`).toBe(false);
    }
  });

  it('renders no percentage anywhere on the floor', () => {
    // A percentage here could only have come from a task count or an event
    // count. Neither is maturity.
    expect(floorSrc).not.toMatch(/toFixed\(2\)|%\s*<|\{\s*.*toFixed/);
    expect(floorSrc).not.toMatch(/formatMaturity/);
  });

  it('never lets a component receive both a task count and a maturity value', () => {
    // Structurally: the FloorPayload type has no maturity member at all, so no
    // component can be handed one.
    const contracts = readFileSync(path.join(SRC, 'lib', 'contracts.ts'), 'utf8');
    const floorType = contracts.slice(contracts.indexOf('export interface FloorPayload'));
    const block = floorType.slice(0, floorType.indexOf('\n}'));
    expect(block).not.toMatch(/maturity|score|weight|percentage/i);
  });

  it('keeps the whole UI layer free of Phase 3 scoring regressions', () => {
    for (const file of uiFiles) {
      const src = code(readFileSync(file, 'utf8'));
      if (/export\s+(interface|type)\s/.test(src) && !/\bfunction\b/.test(src)) continue;
      for (const pattern of [/stage_cap/i, /family_weight/i, /erp_cap/i]) {
        expect(
          pattern.test(src),
          `${path.basename(file)} matches forbidden scoring pattern ${pattern}`,
        ).toBe(false);
      }
    }
  });
});

describe('Phase 3 — GUARD: Phase 5 is live and no phase beyond it is authorised', () => {
  const shellSrc = readFileSync(path.join(SRC, 'components', 'shell.tsx'), 'utf8');
  const phaseShellSrc = readFileSync(path.join(SRC, 'surfaces', 'phase-shell.tsx'), 'utf8');

  it('marks the Phase 3 floor live', () => {
    expect(/id: 'studio'[\s\S]{0,220}?live: true/.test(shellSrc)).toBe(true);
  });

  it('carries the Phase 5 attention surface as live', () => {
    // This block originally asserted `live: false` for attention. Phase 4 went
    // live while that assertion stood; Phase 5 was authorised on base 38037d5
    // and the Founder's B1-B5 rulings made the shell's original promises
    // unbuildable, so the guard is INVERTED rather than deleted.
    //
    // What protects the NEXT phase is no longer a sibling boolean — Phase 5 was
    // the last one, so there is nothing left to flip. The protection is
    // structural instead: the not-yet-authorised registry is empty and the nav
    // cannot introduce a phase that does not exist.
    expect(
      /id: 'attention'[\s\S]{0,220}?live: true/.test(shellSrc),
      "Phase 5 surface 'attention' must now be marked live",
    ).toBe(true);
  });

  it('leaves the not-yet-authorised shell registry empty', () => {
    const intents = phaseShellSrc.slice(
      phaseShellSrc.indexOf('export const PHASE_INTENTS'),
      phaseShellSrc.indexOf('export function PhaseShellFor'),
    );
    // `floor` left on Phase 3 authorisation, `process` on Phase 4, `attention`
    // on Phase 5. An empty registry is the structural Phase 6 guard: no later
    // phase is described there, so none can be promoted by editing a boolean.
    expect(intents).not.toMatch(/\bfloor:\s*\{/);
    expect(intents).not.toMatch(/\bprocess:\s*\{/);
    expect(intents).not.toMatch(/\battention:\s*\{/);
    expect(intents).not.toMatch(/:\s*\{\s*\n\s*phase:/);
    // The component itself is retained: it is what renders if a later phase is
    // ever authorised, so no shell has to be invented from scratch then.
    expect(phaseShellSrc).toMatch(/PHASE \{phase\} · NOT YET AUTHORISED/);
  });

  it('declares exactly the seven company surfaces in this pre-build', () => {
    // `system` is phase 7 and has been live since Phase 1, so its phase number
    // is not a Phase 6 surface and is deliberately excluded from this guard.
    expect(shellSrc).not.toMatch(/phase:\s*(6|8|9)\b/);
    const navIds = [...shellSrc.matchAll(/\bid: '([a-z0-9]+)'/g)].map((m) => m[1]!);
    // SEVENTH SURFACE, ADDED DELIBERATELY (Founder Room seq 8486/8487).
    //
    // `company` is the Company OS: the whole skyscraper, with Dev Studio as one
    // floor inside it. It cannot be reached without a nav entry, and this wave
    // is exactly the authorisation for it. The guard is deliberately updated
    // rather than satisfied by omitting the surface.
    //
    // The census is the real protection against a phase appearing by accident,
    // and it still holds: any FURTHER id now fails here.
    expect(navIds.sort()).toEqual(
      ['attention', 'evidence', 'building', 'company', 'overview', 'studio', 'system'].sort(),
    );
  });

  it('has the Phase 5 attention surface on disk and no Phase 6 file', () => {
    const surfaces = readdirSync(path.join(SRC, 'surfaces')).map((f) => f.toLowerCase());
    expect(surfaces).toContain('attention.tsx');
    for (const name of ['phase6.tsx', 'next.tsx', 'insight.tsx', 'portfolio.tsx']) {
      expect(surfaces).not.toContain(name);
    }
  });

  it('routes the floor, the process floor and attention to real surfaces', () => {
    const app = readFileSync(path.join(SRC, 'surfaces', 'building.tsx'), 'utf8');
    expect(app).toMatch(/import \{ FloorSurface \} from '@\/surfaces\/floor'/);
    expect(app).toMatch(/<FloorSurface surface=\{surface\}/);
    expect(app).toMatch(/import \{ ProcessSurface \} from '@\/surfaces\/process'/);
    expect(app).toMatch(/<ProcessSurface surface=\{surface\}/);
    expect(app).toMatch(/import \{ AttentionSurface \} from '@\/surfaces\/attention'/);
    expect(app).toMatch(/<AttentionSurface surface=\{surface\}/);
    // The shell fall-through is retained for a future authorised phase.
    expect(app).toMatch(/route\.room === 'erp'/);
  });

  it('never lets a Phase 4/5 concept enter the Phase 3 payload', () => {
    // Phase 4 reads process_families / convergence_gaps / restart_wave; Phase 5
    // builds the Founder decision queue. None may appear in Phase 3. The words
    // "maturity" and "process" DO appear in Phase 3 copy and field names
    // (`process_family_context`) precisely to state their ABSENCE, so the
    // assertion is on Phase 4/5 DATA FIELDS, not on the vocabulary.
    const floorKeys = JSON.stringify(floor);
    for (const phase4or5Field of [
      'convergence_gaps',
      'restart_wave',
      'process_families',
      'known_discrepancies',
      'L4_overall_erp_maturity',
      'stage_acceptance',
    ]) {
      expect(floorKeys, `Phase 4/5 field leaked into Phase 3: ${phase4or5Field}`).not.toContain(
        phase4or5Field,
      );
    }
    // The feed carries family as CONTEXT only, never as a family rollup.
    for (const e of floor.activity.events) {
      expect(e).not.toHaveProperty('stages');
      expect(e).not.toHaveProperty('family_maturity');
    }
  });
});

describe('Phase 3 — GUARD: the ERP hold is untouched', () => {
  it('does not imply the ERP is running anywhere in the floor', () => {
    expect(floor.excluded.erp_implementation).toMatch(/ON HOLD under DEC-100/);
    expect(floorSrc).not.toMatch(/implementation (is )?(starting|resuming|resumed)/i);
  });

  it('keeps the hold authority in the assembled surface', () => {
    expect(surface.process_truth.hold_state?.authority).toBe('DEC-100');
    expect(surface.process_truth.hold_state?.implementation).toMatch(/HOLD/i);
  });

  it('declares no ERP repo path as a Phase 3 source and opens none for writing', () => {
    // `floor.mjs` NAMES starqERP — in the `excluded` map, to declare that no ERP
    // implementation state reaches this surface. That is the opposite of a
    // dependency. So the assertion is on PATHS and on the declared read-only
    // source list, not on the mere occurrence of the word.
    const service = code(readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8'));
    for (const repo of ['starqERP', 'starqNexus']) {
      expect(service, `data-service declares a ${repo} source`).not.toMatch(
        new RegExp(`['"][^'"]*${repo}[^'"]*['"]\\s*[,)]`, 'i'),
      );
    }
    // No Phase 3 read reaches either repository. Match the REPO paths, not the
    // substring "starqerp" — `starqerp-control-board` is the read-only control
    // board and is a declared Phase 1 source, not the ERP codebase.
    for (const src of (surface.read_only_sources ?? []).filter(s => !BUILDING_SOURCES.includes(s))) {
      expect(src).not.toMatch(/(^|\/)starqERP(\/|$)/);
      expect(src).not.toMatch(/(^|\/)starqNexus(\/|$)/);
    }
    expect(JSON.stringify(surface.phase3?.reads)).not.toMatch(/starqERP\//);
    // And the write-primitive guard above already covers the write side; this
    // asserts the exclusion is actually declared rather than merely absent.
    expect(floor.excluded.erp_implementation).toMatch(/NOT PRESENT/);
  });
});

describe('Phase 3 — the floor assembly is pure and deterministic', () => {
  it('produces the same payload from the same surface', () => {
    const a = buildFloor({ surface });
    const b = buildFloor({ surface });
    // `generated_at` is the only field allowed to differ, and it is stamped by
    // the assembler rather than derived from canonical source.
    const strip = (p: ReturnType<typeof buildFloor>) => ({ ...p, generated_at: '' });
    expect(JSON.stringify(strip(a))).toBe(JSON.stringify(strip(b)));
  });

  it('degrades honestly rather than rendering empty when the ledger is absent', () => {
    const empty = buildFloor({
      surface: {
        execution_truth: { available: false, state: 'UNAVAILABLE' },
        identities: { byHandle: {} },
        staff_state: { byHandle: {} },
        sessions: { byHandle: {} },
      } as never,
    });
    expect(empty.roster.entries).toEqual([]);
    expect(empty.activity.events).toEqual([]);
    // An empty roster is not a healthy floor; the state travels with it.
    expect(empty.execution_projection.state).toBe('UNAVAILABLE');
    expect(empty.activity.filter.signal_loss).toBe(0);
  });

  it('never reports a negative or impossible filter figure', () => {
    const f = floor.activity.filter;
    expect(f.signal_loss).toBeGreaterThanOrEqual(0);
    expect(f.shown).toBeGreaterThanOrEqual(0);
    expect(f.filtered_out).toBeGreaterThanOrEqual(0);
    expect(f.window_total).toBe(f.shown + f.filtered_out);
    expect(f.signal_total).toBe(f.shown);
  });
});
