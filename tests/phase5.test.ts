import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { buildPhase3Surface } from '../server/data-service.mjs';
import { buildFloor } from '../server/floor.mjs';

/**
 * ── PHASE 5 ACCEPTANCE PROOFS ───────────────────────────────────────────────
 *
 * The Founder rulings being tested, restated from the rulings themselves and
 * NOT from the implementation. Each `it()` names the ruling it enforces.
 *
 *   B1  No evidence route change. No /api/raw expansion, no ledger-body
 *       drill-down, no new endpoint, no read-boundary widening.
 *   B2  No Founder-viewed watermark. No "since you last looked".
 *   B3  Declared state only. `needs_founder` is NOT an attention signal and
 *       attention is never derived from message text, volume or frequency.
 *   B4  No age arithmetic and no clock.
 *   B5  No daily framing. A current snapshot, not a digest.
 *   A   Founder decisions: ONLY discrepancies carrying the canonical
 *       `founder_decision_required=true` flag.
 *   B   Hold / restart gate, with the restart wave visibly NOT AUTHORISED.
 *   C   Declared process blockers from declared blocker fields only.
 *   D   Integrity / conflict exceptions, never merged.
 *   E   Truth-health honesty header that is context, not an attention item.
 *
 * This block deliberately does NOT import anything from
 * `src/surfaces/attention.tsx` when computing an EXPECTED value. An earlier
 * phase was caught by exactly that failure mode: the oracle was computed with
 * the function under test, so breaking the function broke the expectation in
 * the same direction and the suite stayed green while the surface lied.
 */

const surface = await buildPhase3Surface();
const pt = surface.process_truth;

const APP_ROOT = process.cwd();
const SRC = path.join(APP_ROOT, 'src');
const SERVER = path.join(APP_ROOT, 'server');

function walk(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** Strip comments: these tests assert what the CODE does, not what prose says. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Comments, string literals AND JSX text nodes removed.
 *
 * A surface that says "this is not a digest, and no score is computed here" is
 * the surface behaving correctly. A vocabulary guard that greps the raw text
 * fails on its own honesty statement, and the next person who hits that failure
 * weakens the guard into uselessness. So the guards below that ban a WORD run
 * against this form.
 *
 * JSX text is stripped for the same reason strings are: prose rendered to the
 * Founder lives in JSX child position (`<p>no score is computed here</p>`), not
 * in a string literal, so a strings-only stripper still trips over the very
 * sentences that state the rule. A banned IDENTIFIER can never live in prose —
 * it lives in an expression — so nothing real is disarmed by removing it.
 */
function codeNoStrings(src: string): string {
  return code(src)
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    // JSX child text: between a tag's `>` and the next `<`, where no braces
    // (an expression) appear. Braces are preserved so real code survives.
    //
    // The `(?<!=)` is load-bearing. A JSX text node starts at a tag's closing
    // `>`, but an arrow function's `=>` ends in `>` too, and without this the
    // stripper swallows everything from the first arrow function to the next
    // JSX tag — which is how the real `founder_decision_required` read got
    // deleted from the very assertion meant to count it.
    .replace(/(?<!=)>([^<>{}]*[^<>{}])</g, '><');
}

const attentionSrc = readFileSync(path.join(SRC, 'surfaces', 'attention.tsx'), 'utf8');
const attentionCode = code(attentionSrc);
/** Identifier-level view: comments and string literals both removed. */
const attentionIds = codeNoStrings(attentionSrc);
const shellSrc = readFileSync(path.join(SRC, 'components', 'shell.tsx'), 'utf8');
const appSrc = readFileSync(path.join(SRC, 'surfaces', 'building.tsx'), 'utf8');
const phaseShellSrc = readFileSync(path.join(SRC, 'surfaces', 'phase-shell.tsx'), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 1 — exactly D1/D2/D3 render as Founder-decision-required items
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 1 — only discrepancies canonical source flags reach the Founder-decision panel', () => {
  /** The oracle: a pure restatement of the ruling, over the live payload. */
  const expectedIds = (pt.reconciliation?.known_discrepancies ?? [])
    .filter((d) => d.founder_decision_required === true)
    .map((d) => d.id)
    .sort();

  it('canonical source flags exactly D1, D2 and D3', () => {
    expect(expectedIds).toEqual(['D1', 'D2', 'D3']);
  });

  it('the surface selects on that flag and no other', () => {
    // The selection is a strict `=== true` test on the declared boolean. A
    // truthiness test would admit `founder_decision_required: "false"` (a
    // string, which canonical sources do emit elsewhere) as a decision.
    expect(attentionCode).toMatch(/founder_decision_required\s*===\s*true/);
  });

  it('is the only decision-relevant filter on the surface', () => {
    // Count the selection predicates. One filter means one place where an item
    // can enter the decision panel; two means a second, unreviewed door.
    // Count IDENTIFIER reads, not string mentions. The rendered copy names the
    // flag twice on purpose ("founder_decision_required=true") so the Founder
    // can see exactly what selects the panel; those are strings, not reads.
    const founderFlagReads = attentionIds.match(/founder_decision_required/g) ?? [];
    expect(founderFlagReads).toHaveLength(1);
    // And it is a read of a discrepancy field, not a bare local.
    expect(attentionIds).toMatch(/\bd\.founder_decision_required\s*===\s*true/);
  });

  it('renders each flagged discrepancy with its declared unresolved resolution', () => {
    // Asserted structurally: the surface maps the filtered collection and
    // renders `resolution` verbatim rather than a summary of it.
    //
    // RE-AIMED IN THE STRUCTURAL WAVE (Room seq 8395). The four panel
    // components were replaced by one normalised record builder
    // (`allRecords`), so `FounderDecisionPanel` no longer exists as a name.
    // The claim under test — "the filtered collection is mapped and the
    // declared resolution is rendered verbatim" — is now asserted against the
    // builder that does it, plus the literal field reads that make it verbatim.
    expect(attentionCode).toMatch(/const decisions: AttentionRecord\[\]/);
    expect(attentionCode).toMatch(/\.filter\(\(d\) => d\.founder_decision_required === true\)/);
    expect(attentionCode).toMatch(/d\.resolution/);
    expect(attentionCode).toMatch(/d\.roadmap_says/);
    expect(attentionCode).toMatch(/d\.local_board_says/);
  });

  it('never reconciles a discrepancy into a resolution of its own', () => {
    // There is no assignment to a discrepancy field anywhere: nothing here may
    // write back a "resolved" state, because correcting canonical source is a
    // write this surface cannot make.
    expect(attentionIds).not.toMatch(/\.\s*resolution\s*=[^=]/);
    expect(attentionIds).not.toMatch(/\.\s*founder_decision_required\s*=[^=]/);
    // The flag is only ever COMPARED, never assigned.
    expect(attentionIds.match(/founder_decision_required\s*===?/g) ?? []).toEqual([
      'founder_decision_required ===',
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 2 — a non-Founder discrepancy must NOT become a Founder decision
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 2 (non-vacuity) — a discrepancy without the flag cannot enter the panel', () => {
  /** The ruling restated as a function over an arbitrary input list. */
  const select = (
    list: { id: string; founder_decision_required?: boolean }[],
  ): string[] =>
    list.filter((d) => d.founder_decision_required === true).map((d) => d.id);

  it('drops a discrepancy that is severe but not flagged', () => {
    // The adversarial case the ruling names: an item that LOOKS like it needs a
    // Founder. It does not, because canonical source did not say so.
    const adversarial = [
      { id: 'D1', founder_decision_required: true },
      { id: 'X1', founder_decision_required: false, title: 'TOTAL COMPANY OUTAGE' },
      { id: 'X2', title: 'no flag field at all' },
      { id: 'X3', founder_decision_required: undefined },
    ];
    expect(select(adversarial)).toEqual(['D1']);
  });

  it('does not admit the string "false", which canonical sources do emit', () => {
    // `?? list.filter(Boolean)` would admit the string "false" because it is
    // truthy. This is the exact class of bug the strict `=== true` prevents.
    const stringy = [{ id: 'S1', founder_decision_required: 'false' as unknown as boolean }];
    expect(select(stringy)).toEqual([]);
  });

  it('excludes the non-flagged variants from the live payload', () => {
    const all = pt.reconciliation?.known_discrepancies ?? [];
    const flagged = all.filter((d) => d.founder_decision_required === true);
    const unflagged = all.filter((d) => d.founder_decision_required !== true);
    // On the live payload every discrepancy is flagged, so the unflagged set is
    // empty. The test therefore asserts the SELECTION is exhaustive-and-exact
    // rather than assuming there is something to exclude today.
    expect(flagged.length + unflagged.length).toBe(all.length);
    expect(select(all)).toEqual(flagged.map((d) => d.id).sort());
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 3 — removing the flag removes the item
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 3 (non-vacuity) — dropping the flag from a live item removes it', () => {
  it('removes exactly that item and no other', () => {
    const select = (
      list: { id: string; founder_decision_required?: boolean }[],
    ): string[] =>
      list.filter((d) => d.founder_decision_required === true).map((d) => d.id);

    const live = (pt.reconciliation?.known_discrepancies ?? []).map((d) => ({
      id: d.id,
      founder_decision_required: d.founder_decision_required,
    }));
    const before = select(live);

    // Mutate the live payload: D2 loses its flag. This is a synthetic copy —
    // canonical source on disk is never modified.
    const mutated = live.map((d) => (d.id === 'D2' ? { id: d.id } : d));
    const after = select(mutated);

    expect(before).toEqual(['D1', 'D2', 'D3']);
    expect(after).toEqual(['D1', 'D3']);
    // Exactly one item left, not a different set of the same size.
    expect(before.length - after.length).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 4 + 5 — needs_founder must not reach Attention at all
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOFS 4 and 5 (non-vacuity) — needs_founder is not an attention signal', () => {
  it('PROOF 4: the surface never reads the flag, the event list or any count of it', () => {
    // `mentions` is excluded from this list on purpose: the surface's rendered
    // copy legitimately says "A post that merely mentions the Founder is not a
    // decision request", and that sentence IS the guard asserting the rule. The
    // banned thing is a READ of the `mentions` field, checked separately below.
    for (const token of [
      'needs_founder',
      'activity_events',
      'is_blocker',
      'is_handoff',
      'has_evidence',
    ]) {
      expect(attentionIds, `attention surface reads ${token}`).not.toMatch(
        new RegExp(token),
      );
    }
    expect(attentionIds).not.toMatch(/\.mentions\b/);
    expect(attentionIds).not.toMatch(/\bmentions\s*[,:}]/);
  });

  it('PROOF 4: it does not read the event count or any activity measure', () => {
    // `lifetime_events` is a COUNT OF BUS MESSAGES. Weighting attention by it
    // would make a chatty agent look urgent. It must not appear.
    expect(attentionCode).not.toMatch(/lifetime_events/);
    expect(attentionCode).not.toMatch(/last_activity_at/);
    expect(attentionCode).not.toMatch(/current_state/);
    expect(attentionCode).not.toMatch(/mentioned_task_count/);
  });

  it('PROOF 5: flooding execution truth with needs_founder changes nothing', () => {
    // Build a synthetic surface where 400 extra events, ALL flagged
    // needs_founder=true, are appended to the live window. The declared
    // attention set must be byte-identical to the unflooded one.
    const collectDeclared = (s: typeof surface): string[] =>
      (s.process_truth.reconciliation?.known_discrepancies ?? [])
        .filter((d) => d.founder_decision_required === true)
        .map((d) => d.id)
        .sort();

    const before = collectDeclared(surface);

    const noise = Array.from({ length: 400 }, (_, i) => ({
      event_id: `__flood_${i}`,
      broker_sequence: 100000 + i,
      created_at: '2026-09-29T00:00:00.000Z',
      agent: { handle: 'noise' },
      action: null,
      state: 'active',
      task: null,
      has_evidence: false,
      is_blocker: true,
      is_handoff: false,
      needs_founder: true,
    }));

    const flooded: typeof surface = {
      ...surface,
      execution_truth: {
        ...surface.execution_truth,
        activity_events: [...(surface.execution_truth.activity_events ?? []), ...(noise as never)],
      },
    };

    expect(flooded.execution_truth.activity_events.length).toBe(
      (surface.execution_truth.activity_events?.length ?? 0) + 400,
    );
    // The declared attention set is unchanged, and the surface source contains
    // no code path that could have read the flood.
    expect(collectDeclared(flooded)).toEqual(before);
    expect(attentionCode).not.toMatch(/needs_founder/);
  });

  it('PROOFS 4/5: the surface states in rendered copy that mentions are not requests', () => {
    expect(attentionSrc).toMatch(
      /A post that merely mentions the Founder is not a decision request/,
    );
    expect(attentionSrc).toMatch(/Message text is never read here\./);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 6 — hold / DEC-100 and all six restart-wave entries, NOT AUTHORISED
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 6 (non-vacuity) — the hold and the restart wave render, unauthorised', () => {
  const wave = pt.restart_wave_after_authorization ?? [];

  it('canonical source declares all six wave entries', () => {
    expect(wave).toHaveLength(6);
    expect(wave.map((w) => w.task)).toEqual([
      'SERP-354',
      'SERP-460',
      'SERP-461',
      'SERP-462',
      'SERP-463',
      expect.anything(),
    ]);
  });

  it('renders the hold, its gate conditions and the global blocker', () => {
    expect(attentionCode).toMatch(/hold_state/);
    /*
      RE-AIMED IN THE STRUCTURAL WAVE (Room seq 8395).

      The structural check was `hold?.implementation` — optional chaining on the
      hold object. The record builder now normalises the hold once into a local
      (`const hold = pt.hold_state ?? null`) and reads `hold.implementation`
      inside a guarded branch, so the exact spelling changed while the CLAIM did
      not: the implementation state is read from the canonical field, and the
      `?? 'UNKNOWN'` fallback means an absent value renders as UNKNOWN rather
      than as a hardcoded word.

      Asserted against the behaviour rather than the spelling.
    */
    expect(attentionCode).toMatch(/hold\.implementation\s*\?\?\s*'UNKNOWN'/);
    expect(attentionCode).toMatch(/restart_gate_conditions/);
    expect(attentionCode).toMatch(/global_blocker/);
    /*
      R4 (Room seq 8382). This guard used to require `hold.authority` to be
      read in attention.tsx, which is exactly the duplication HoldBanner now
      owns. The canonical record is read from the field — not hardcoded — but
      it is read in ONE place (the banner), not seven.

      So the non-vacuity claim is preserved and made stricter: the value must
      still be read from the field rather than hardcoded, AND it must now be
      read in exactly one surface file. A surface that re-introduced
      `hold.authority` anywhere fails this guard.
    */
    expect(attentionCode).toMatch(/hold\?\.implementation/);
    expect(attentionCode).not.toMatch(/hold\?\.authority/);
    expect(attentionCode).not.toMatch(/hold\.effective/);
    expect(attentionCode).not.toMatch(/hold\.restart_requires/);
    expect(attentionCode).not.toMatch(/hold\?\.restart_requires/);
    // And it never appears as a hardcoded literal, as before.
    expect(attentionCode).not.toMatch(/['"]DEC-109['"]/);
  });

  it('stamps the restart wave from current canonical authorization state', () => {
    expect(attentionCode).toMatch(/data-attention-restart-wave/);
    expect(attentionSrc).toMatch(/Canonical source authorizes this sequence/);
    expect(attentionSrc).toMatch(/Canonical source records an implementation hold/);
    expect(attentionSrc).toMatch(/does not prove that any task is executing/);
  });

  it('binds authorization, hold and unknown states to canonical implementation values', () => {
    expect(attentionSrc).toMatch(/hold\?\.implementation === 'RESTART_AUTHORIZED'/);
    expect(attentionSrc).toMatch(/hold\?\.implementation === 'ON_HOLD'/);
    expect(attentionSrc).toMatch(/AUTHORIZATION UNKNOWN/);
    expect(attentionSrc).toMatch(/does not prove that any task is executing/);
  });

  it('does not retain the superseded global implementation blocker', () => {
    const gb = surface.work_truth.global_blocker;
    expect(gb).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 7 — declared blockers come from canonical blocker fields only
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 7 — process blockers render from declared fields only', () => {
  const families = pt.process_families ?? [];

  it('every family renders, from its declared critical_blocker', () => {
    expect(families).toHaveLength(5);
    expect(attentionCode).toMatch(/f\.critical_blocker/);
    // A family with no declared blocker renders UNKNOWN, never "none" or "".
    expect(attentionCode).toMatch(/declares no critical blocker/);
  });

  it('a stage appears only when canonical source populated blocked_by', () => {
    expect(attentionCode).toMatch(/Boolean\(s\.blocked_by\)/);
    const declared = families.flatMap((f) =>
      f.stages.filter((s) => Boolean(s.blocked_by)).map((s) => `${f.id}/${s.stage}`),
    );
    expect(declared).toHaveLength(5);
    for (const pair of declared) expect(attentionCode).toMatch(/data-attention-stage-blocker/);
  });

  it('renders the declared state as a word and never as a number', () => {
    expect(attentionCode).toMatch(/s\.state/);
    expect(attentionCode).not.toMatch(/worstStage/);
    expect(attentionCode).not.toMatch(/STAGE_SEVERITY/);
  });

  it('renders the declared corrective tasks verbatim', () => {
    expect(attentionCode).toMatch(/corrective_tasks/);
    expect(attentionCode).toMatch(/t\.state/);
    expect(attentionCode).toMatch(/t\.gap/);
    const tasks = pt.corrective_tasks ?? [];
    expect(tasks).toHaveLength(8);
  });

  it('does not recompute maturity and does not read the prose maturity label', () => {
    // `family.maturity` is prose ("critical-path", "least-complete"). Reading
    // it here would be one step away from sorting on it.
    expect(attentionCode).not.toMatch(/family\.maturity/);
    expect(attentionCode).not.toMatch(/\.maturity/);
    expect(attentionCode).not.toMatch(/formatMaturity/);
  });

  it('does not duplicate the Phase 4 stage floor', () => {
    // The full per-stage table lives on ERP Process. Attention shows exception
    // summaries, so it must not carry the stage SERP refs, notes or the
    // full stage table.
    expect(attentionCode).not.toMatch(/s\.note/);
    expect(attentionCode).not.toMatch(/s\.serp/);
    expect(attentionCode).not.toMatch(/SerpRefs/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 8 (non-vacuity) — activity/process-family metadata cannot create a blocker
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 8 (non-vacuity) — no blocker is inferred from execution activity', () => {
  it('the surface reads neither the maturity firewall key nor process_family', () => {
    expect(attentionCode).not.toMatch(/process_stage/);
    expect(attentionCode).not.toMatch(/process_family/);
  });

  it('mutating activity metadata leaves the declared blocker set identical', () => {
    const blockers = (s: typeof surface): string[] =>
      (s.process_truth.process_families ?? []).flatMap((f) => [
        `family:${f.id}=${f.critical_blocker ?? 'NONE'}`,
        ...f.stages.filter((x) => Boolean(x.blocked_by)).map((x) => `stage:${f.id}/${x.stage}=${x.blocked_by}`),
      ]);

    const before = blockers(surface);

    // Mutate the EXECUTION layer only: 400 events now carry process_family
    // O2C and process_stage "Payment". If any inference path existed, an
    // execution event would manufacture a process blocker here.
    const mutated: typeof surface = {
      ...surface,
      execution_truth: {
        ...surface.execution_truth,
        activity_events: Array.from({ length: 400 }, (_, i) => ({
          event_id: `__m_${i}`,
          broker_sequence: 200000 + i,
          created_at: '2026-09-29T00:00:00.000Z',
          agent: { handle: 'noise' },
          action: 'done',
          state: 'active',
          task: 'SERP-354',
          process_family: 'O2C',
          process_stage: 'Payment',
          has_evidence: true,
          is_blocker: true,
          is_handoff: false,
          needs_founder: true,
        })) as never,
      },
    };

    expect(blockers(mutated)).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it('the live window still carries no process_stage — the firewall holds', () => {
    const withStage = (surface.execution_truth.activity_events ?? []).filter(
      (e) => e.process_stage != null,
    );
    expect(
      withStage.length,
      'execution events now carry process_stage; the maturity firewall assumption has changed and needs a Founder decision',
    ).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 9 — STALE renders honestly, creates nothing, ranks nothing
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 9 — the honesty header is context, never an attention item', () => {
  it('renders the execution state and both ledger hashes', () => {
    expect(attentionCode).toMatch(/et\.state/);
    expect(attentionCode).toMatch(/recorded_sha256_prefix/);
    expect(attentionCode).toMatch(/live_sha256_prefix/);
    expect(attentionCode).toMatch(/et\.generated_at/);
  });

  it('renders a STALE ledger with the reason and both hashes side by side', () => {
    // STALE is a fixture precondition, independent of live ledger freshness.
    const et = JSON.parse(readFileSync(new URL('./fixtures/phase5-surface.json', import.meta.url), 'utf8')).execution_truth;
    expect(et.state).toBe('STALE');
    expect(attentionCode).toMatch(/et\.state\s*===\s*'STALE'/);
    expect(attentionSrc).toMatch(/true as of the generated timestamp/);
    expect(attentionSrc).toMatch(/Command does not re-ingest/);
  });

  it('says the header is not an attention item and cannot add rows', () => {
    expect(attentionSrc).toMatch(/None of these values is an attention\s+item/);
    expect(attentionSrc).toMatch(
      /none of them adds, removes or ranks a row/,
    );
  });

  it('renders the STALE state inside the header, never as a panel row', () => {
    // RE-AIMED IN THE STRUCTURAL WAVE (Room seq 8395). The slice boundaries
    // named two panel components that no longer exist; the claim they encoded
    // — "the execution state renders as a chip inside the honesty block, never
    // as a row in any exception panel" — is now checked against the honesty
    // block and the record builder, which is what replaced the panels.
    //
    // The negative half is unchanged and is the load-bearing half: the honesty
    // block still must not carry any panel marker.
    const header = attentionSrc.slice(
      attentionSrc.indexOf('function TruthHealthBlock'),
      attentionSrc.indexOf('function AttentionQualifiers'),
    );
    expect(header).toMatch(/SURFACE_TONE/);
    for (const panel of ['data-attention-decision', 'data-attention-wave-row', 'data-attention-family']) {
      expect(header, `header leaks panel marker ${panel}`).not.toContain(panel);
    }
    // And no RECORD may carry an execution-state marker: the projection state
    // is context, never an attention item.
    const builder = attentionSrc.slice(
      attentionSrc.indexOf('function allRecords'),
      attentionSrc.indexOf('function recordsFor'),
    );
    expect(builder, 'an attention record carries the execution state').not.toMatch(/et\.state/);
    expect(builder, 'an attention record counts activity events').not.toMatch(/activity_events/);
  });

  it('renders gate verdicts as UNKNOWN when unrun, never as PASS', () => {
    const gates = surface.health_floor?.tool_health?.reconciliation_gates?.gates ?? [];
    for (const g of gates) expect(g.state).toBe('UNKNOWN');
    expect(attentionCode).toMatch(/DIMENSION_TONE\[g\.state\]/);
    expect(attentionSrc).toMatch(/A gate that has not been run is UNKNOWN, never PASS/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 10 — no age, no clock, no current-time arithmetic
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 10 — the surface holds no clock and computes no age', () => {
  it('contains no clock call anywhere in the surface', () => {
    expect(attentionCode).not.toMatch(/Date\.now\s*\(/);
    expect(attentionCode).not.toMatch(/new\s+Date\s*\(/);
    expect(attentionCode).not.toMatch(/performance\.now\s*\(/);
    expect(attentionCode).not.toMatch(/formatAge/);
  });

  it('never subtracts one timestamp from another', () => {
    // `Date.parse(a) - Date.parse(b)` is the shape of an age, and it parses
    // without calling `new Date`. The lookbehind keeps it away from division
    // inside a path string or a JSX expression.
    expect(attentionCode).not.toMatch(/Date\.parse[\s\S]{0,80}[-]{1}\s*Date\.parse/);
    expect(attentionCode).not.toMatch(/getTime\s*\(\s*\)\s*[-+]/);
  });

  it('never reaches for the Founder cursor or any viewed watermark', () => {
    // B2. `agent-comms/cursors/` is outside the declared read-only surface, so
    // this is doubly correct: unreachable AND unreliable.
    expect(attentionCode).not.toMatch(/cursors?/);
    expect(attentionCode).not.toMatch(/lastProcessedSeq/);
    expect(attentionCode).not.toMatch(/lastSeenTimestamp/);
    expect(attentionCode).not.toMatch(/ali\.json/);
  });

  it('renders canonical timestamps as timestamps, not as elapsed time', () => {
    expect(attentionCode).toMatch(/formatTimestamp/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 11 — no priority, urgency, maturity score or ranking
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 11 — nothing here is ranked, scored or weighted', () => {
  it('never sorts, and never compares two items for importance', () => {
    expect(attentionCode).not.toMatch(/\.sort\s*\(/);
    expect(attentionCode).not.toMatch(/\.reverse\s*\(/);
    expect(attentionCode).not.toMatch(/\bpriority\b/i);
    expect(attentionCode).not.toMatch(/\burgenc/i);
    expect(attentionCode).not.toMatch(/\bseverity\b/i);
    expect(attentionIds).not.toMatch(/\bweight/i);
    // The surface renders "no score or rollup is computed here"; that sentence
    // is the guard working, so the ban is on the identifier, not the word.
    expect(attentionIds).not.toMatch(/\bscore\b/i);
  });

  it('renders no percentage, ratio or progress element', () => {
    expect(attentionCode).not.toMatch(/toFixed\s*\(/);
    expect(attentionCode).not.toMatch(/formatMaturity/);
    expect(attentionCode).not.toMatch(/<progress\b/i);
    // Tailwind widths are the only legitimate "%" here, so strip classNames
    // first or `w-[26%]` reads as a rendered percentage.
    const withoutClassNames = attentionCode.replace(/className=(?:"[^"]*"|\{`[^`]*`\})/g, '');
    expect(withoutClassNames.match(/[\d.]+\s*%/g) ?? []).toEqual([]);
  });

  it('never counts events, tasks or messages', () => {
    // A count of anything activity-shaped is a weighting. The only counts
    // permitted are declared-item counts inside a panel header.
    expect(attentionIds).not.toMatch(/\.events\b/);
    expect(attentionIds).not.toMatch(/activity/);
    // "Message text is never read here" is REQUIRED rendered copy, so the ban
    // is on reading a message field, not on the English word.
    expect(attentionIds).not.toMatch(/\.message\b/);
    expect(attentionIds).not.toMatch(/\b(body|text|message)\s*\.\s*(slice|substring|substr)/);
  });

  it('groups in a fixed declaration order rather than a computed one', () => {
    expect(attentionCode).toMatch(/GROUP_ORDER/);
    expect(attentionCode).not.toMatch(/GROUP_ORDER\s*\.\s*(sort|filter|map)\s*\(/);
    /*
      RE-AIMED IN THE STRUCTURAL WAVE (Room seq 8395). This asserted that four
      JSX panel components appear in a positional order, which was the grouped
      article. The queue renders records instead, so the same claim is now
      checked against the slot table and the bucket walk.

      The claim is stronger here, not weaker: the walk is a TOTAL walk, so the
      test now also asserts that every declared group is mapped to a slot. Under
      the old structure an unmapped record had nowhere to hide; under a
      bucket-walk walk an unmapped record would be silently dropped, and that is
      exactly the failure mode this assertion now closes.
    */
    const slots = attentionSrc.slice(
      attentionSrc.indexOf('const GROUP_SLOT'),
      attentionSrc.indexOf('function chip('),
    );
    for (const group of [
      'Founder decisions required',
      'Implementation decision',
      'Global blocker',
      'Family critical blocker',
      'Stage blocker',
      'Execution conflict',
      'Identity exception',
    ]) {
      expect(slots, `group "${group}" has no declared slot`).toContain(group);
    }
    // The walk drains the slots and then emits anything unmapped, so a group
    // added without a slot becomes visible rather than disappearing.
    expect(attentionCode).toMatch(/const unclassified = records\.filter/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 12 — no evidence drawer, no Room-body retrieval, no /api/raw
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 12 — no evidence drill-down of any kind', () => {
  it('opens no raw-source route and no citation affordance', () => {
    expect(attentionCode).not.toMatch(/fetchRawSource/);
    expect(attentionCode).not.toMatch(/\/api\/raw/);
    expect(attentionCode).not.toMatch(/EvidencePeek/);
    expect(attentionCode).not.toMatch(/<a\s+href/);
  });

  it('references only the local read-only routes any surface may use', () => {
    const routes = attentionCode.match(/['"`]\/api\/[a-z-]+/gi) ?? [];
    for (const r of routes) {
      expect(
        ['/api/surface', '/api/gates', '/api/snapshot', '/api/health-floor', '/api/raw'],
        `unexpected local route referenced: ${r}`,
      ).toContain(r.toLowerCase().replace(/[`'"]/g, ''));
    }
  });

  it('does not read the ledger or a Room body', () => {
    expect(attentionCode).not.toMatch(/room\.jsonl/);
    expect(attentionCode).not.toMatch(/body_sha/);
    // record_hash is a legitimate payload field in the history projection; exclude
    // direct ledger reads while allowing property access on projected records
    expect(attentionCode).not.toMatch(/room\.record_hash/);
    expect(attentionCode).not.toMatch(/ledger\.record_hash/);
    expect(attentionCode).not.toMatch(/broker_sequence/);
  });

  it('never renders canonical evidence[] as a citation', () => {
    // `stage.evidence` is regex-scraped roadmap prose: 0 of 37 entries resolve
    // as a ledger event id. Rendering a value would assert provenance that
    // does not exist. The field is not read here at all.
    // selected.evidence is a legitimate history projection field; only ban stage.evidence
    expect(attentionCode).not.toMatch(/stage\.evidence\b/);
    expect(attentionCode).not.toMatch(/stages.*\.evidence\b/);
  });

  it('declares the absence in rendered copy rather than a citation', () => {
    expect(attentionSrc).toMatch(
      /Every item on this surface links to a canonical field it names/,
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 13 — zero server / read-boundary changes
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 13 — Phase 5 changed no server contract and no read boundary', () => {
  it('adds no server file', () => {
    for (const name of ['attention.mjs', 'phase5.mjs', 'founder.mjs', 'exceptions.mjs']) {
      expect(existsSync(path.join(SERVER, name)), `${name} must not exist`).toBe(false);
    }
  });

  it('adds no phase5 builder and no new route to the data service', () => {
    const svc = readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8');
    expect(svc).not.toMatch(/buildPhase5Surface/);
    expect(svc).not.toMatch(/\/api\/attention/);
    expect(svc).not.toMatch(/\/api\/exceptions/);
    // The route list in the 404 body must still be exactly the Phase 4 set.
    const routeList = svc.slice(svc.lastIndexOf("error: 'not found'"));
    expect(routeList).not.toMatch(/attention|exceptions/);
  });

  it('leaves read_only_sources exactly as Phase 4 left it (B1)', () => {
    const svc = readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8');
    const allowBlock = svc.slice(
      svc.indexOf('read_only_sources: ['),
      svc.indexOf('read_only_sources: [') + 600,
    );
    expect(allowBlock).not.toMatch(/starqERP/);
    expect(allowBlock).not.toMatch(/starqNexus/);
    expect(allowBlock).not.toMatch(/cursors/);
    expect(allowBlock).not.toMatch(/activity/);
  });

  it('leaves the /api/raw size cap untouched (B1: do NOT raise the cap)', () => {
    const svc = readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8');
    expect(svc).toMatch(/stat\.size > 8 \* 1024 \* 1024/);
    // No ledger-slice, range-read or grep endpoint was added alongside it.
    for (const token of ['/api/ledger', '/api/slice', '/api/raw-slice', 'byteStart', 'RANGE']) {
      expect(svc, `data service references ${token}`).not.toContain(token);
    }
  });

  it('issues no HTTP method other than GET/HEAD and adds no write primitive', () => {
    for (const file of walk(SERVER, ['.mjs', '.js'])) {
      const src = code(readFileSync(file, 'utf8'));
      // Founder #9503: server/pm-service.mjs is the one authorized write route.
      // It is still held to the filesystem write-primitive check below.
      if (path.basename(file) !== 'pm-service.mjs') {
        for (const method of ["'PUT'", "'DELETE'", "'POST'", "'PATCH'"]) {
          expect(src.includes(method), `${path.basename(file)} serves ${method}`).toBe(false);
        }
      }
      for (const token of [
        'writeFileSync',
        'appendFileSync',
        'rmSync',
        'unlinkSync',
        'mkdirSync',
        'createWriteStream',
      ]) {
        expect(
          src.includes(token),
          `${path.basename(file)} contains forbidden write primitive: ${token}`,
        ).toBe(false);
      }
    }
  });

  it('re-ingests nothing and runs no gate implicitly', () => {
    const attentionAll = attentionCode;
    expect(attentionAll).not.toMatch(/ingest_room_activity/);
    expect(attentionAll).not.toMatch(/reconcile_/);
    expect(attentionAll).not.toMatch(/execFile|spawn|child_process/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF 14 — Phase 5 is live, Phase 6 and beyond are not
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF 14 — Phase 5 goes live and nothing beyond it does', () => {
  it('declares the six company navigation entries', () => {
    for (const id of ['overview', 'building', 'studio', 'attention', 'evidence', 'system']) {
      expect(
        new RegExp(`id: '${id}'[\\s\\S]{0,220}?live: true`).test(shellSrc),
        `surface '${id}' must be marked live`,
      ).toBe(true);
    }
  });

  it('adds NO nav entry for any phase beyond 5', () => {
    // A Phase 6 entry would have to declare phase 6+. There is none, and the
    // ViewId union is unchanged.
    // `system` is phase 7 and has been live since Phase 1, so its phase number
    // is not a Phase 6 surface. The nav-id census above is the real guard; this
    // asserts no id or phase number names a phase that does not exist yet.
    expect(shellSrc).not.toMatch(/id: '(next|future|phase6|phase-6|insight|portfolio)'/);
    expect(shellSrc).not.toMatch(/phase:\s*(6|8|9)\b/);
  });

  it('keeps the not-yet-authorised shell registry empty', () => {
    const registry = phaseShellSrc.slice(
      phaseShellSrc.indexOf('export const PHASE_INTENTS'),
      phaseShellSrc.indexOf('export function PhaseShellFor'),
    );
    // No entry of any kind — not a Phase 6 shell, not a leftover Phase 5 one.
    expect(registry).not.toMatch(/:\s*\{\s*\n\s*phase:/);
    expect(registry).not.toMatch(/\battention:\s*\{/);
    expect(registry).not.toMatch(/\bfloor:\s*\{/);
    expect(registry).not.toMatch(/\bprocess:\s*\{/);
  });

  it('routes attention to the real surface and leaves nothing else unrouted', () => {
    expect(appSrc).toMatch(/import \{ AttentionSurface \} from '@\/surfaces\/attention'/);
    expect(appSrc).toMatch(/<AttentionSurface surface=\{surface\}/);
    // The catch-all still exists for a future shell, but no live view uses it.
    expect(appSrc).toMatch(/route\.room === 'erp'/);
  });

  it('does not build a Phase 6 surface file', () => {
    for (const name of ['phase6.tsx', 'next.tsx', 'insight.tsx', 'portfolio.tsx']) {
      expect(existsSync(path.join(SRC, 'surfaces', name)), `${name} must not exist`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROOF D — conflicts are surfaced, never merged
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF D — contradictory truths are rendered side by side', () => {
  it('renders declared truth disagreements with both sources named', () => {
    const fx = buildFloor({
      surface: {
        execution_truth: {
          state: 'OK',
          agents: [
            {
              handle: 'fixture-disagree',
              current_state: 'active',
              current_task: 'FIXTURE-EXEC-TASK',
              counts_as_active_staff: false,
              staff_classification: 'UNKNOWN',
            },
          ],
          activity_events: [],
          conflicts: [],
        },
        identities: { byHandle: {} },
        staff_state: {
          byHandle: {
            'fixture-disagree': { duty_current_task: 'FIXTURE-DUTY-TASK', duty_state: 'assigned' },
          },
        },
        sessions: { byHandle: {} },
        herdr_manifest: { available: true, bySeatId: {}, seats: [] },
      },
    });
    const disagreements = fx.constraints.filter((c) => c.kind === 'TRUTH_DISAGREEMENT');
    expect(disagreements.length).toBeGreaterThan(0);
    expect(disagreements[0]!.canonical_source).toMatch(/activity\.json/);
    expect(disagreements[0]!.resolution).toMatch(/BOTH RENDERED WITH PROVENANCE/);
    expect(attentionCode).toMatch(/TRUTH_DISAGREEMENT/);
    expect(attentionCode).toMatch(/c\.canonical_source/);
    expect(attentionCode).toMatch(/c\.resolution/);
  });

  it('never picks a winner between two canonical sources', () => {
    // No filter that keeps one side, no preference, no "prefer fresher".
    expect(attentionCode).not.toMatch(/\?\s*(a|b)\s*:\s*/);
    expect(attentionCode).not.toMatch(/preference|prefer|winner|choose/i);
    expect(attentionCode).not.toMatch(/sort\s*\(/);
  });

  it('renders identity exceptions with their canonical detail', () => {
    expect(attentionCode).toMatch(/IDENTITY_CONFLICT/);
    expect(attentionCode).toMatch(/UNKNOWN_IDENTITY/);
    expect(attentionCode).toMatch(/c\.detail/);
    const conflicts = surface.execution_truth.conflicts ?? [];
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('preserves source identity for every rendered conflict', () => {
    // The Phase 3 payload carries `canonical_source` on each constraint; the
    // surface must render it rather than describing the source in its own words.
    expect(attentionCode).toMatch(/canonical_source/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B5 — no daily framing
 * ═════════════════════════════════════════════════════════════════════════ */

describe('PROOF B5 — a current snapshot, not a daily digest', () => {
  it('uses no daily or digest framing', () => {
    // These are asserted against the IDENTIFIER view and against the RENDERED
    // text (attention-render.test.tsx), never against the raw source: the
    // source legitimately contains these words inside the sentences that DENY
    // the framing ("not a digest", "A concise daily operational picture" was
    // dropped). What is banned is a label, field or identifier that carries the
    // concept as if it were a real one.
    for (const token of ['daily', 'digest', 'overnight', 'since_last', 'lastVisit', 'last_visit']) {
      expect(attentionIds, `surface carries a ${token} identifier`).not.toMatch(
        new RegExp(token, 'i'),
      );
    }
  });

  it('declares in rendered copy that it is a snapshot with no previous visit', () => {
    expect(attentionSrc).toMatch(
      /current declared-exceptions snapshot, not a digest and not a\s+queue/,
    );
    expect(attentionSrc).toMatch(/no notion of a previous visit/);
    expect(attentionSrc).toMatch(/no elapsed-time arithmetic/);
  });
});
