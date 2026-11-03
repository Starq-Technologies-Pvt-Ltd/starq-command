import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { AttentionSurface } from '@/surfaces/attention';
import { buildPhase3Surface } from '../server/data-service.mjs';
import { buildFloor } from '../server/floor.mjs';
import { readFileSync } from 'node:fs';
import type { CommandSurface } from '@/lib/contracts';

/**
 * The Phase 5 surface must actually RENDER — and the rows it renders must be
 * the declared rows, counted from the MARKUP rather than inferred from a
 * string being present somewhere on the page.
 *
 * Why the census matters here specifically: Phase 5's whole claim is that it
 * shows D1/D2/D3 and nothing it invented. A `text.includes('D1')` assertion
 * cannot tell a Founder-decision row that rendered from the string "D1"
 * appearing in a heading, a count badge or a stray caption. So every row
 * assertion below parses the markup, anchors to the container the row belongs
 * to, and counts.
 */

const surface = await buildPhase3Surface();
const html = renderToStaticMarkup(React.createElement(AttentionSurface, { surface }));

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const text = decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Every element carrying a `data-attention-*` marker, in render order. */
function marked(markup: string, attr: string): string[] {
  return [...markup.matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))].map((m) => m[1]!);
}

function tablesOf(markup: string): string[] {
  return markup.match(/<table[\s>][\s\S]*?<\/table>/g) ?? [];
}

function dataRowCount(table: string): number {
  const tbody = table.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? '';
  return [...tbody.matchAll(/<tr[\s>]/g)].length;
}

describe('the surface renders against the real assembled payload', () => {
  it('mounts and produces a non-trivial document', () => {
    expect(html.length).toBeGreaterThan(2000);
    expect(text).toContain('Founder Attention');
  });

  it('declares its own scope in the header', () => {
    expect(text).toContain('Declared exceptions only');
    expect(text).toContain('inferred from message text, ranked or scored');
  });
});

describe('PROOF 1/2/3 — the Founder-decision panel holds exactly the flagged rows', () => {
  it('renders one row per declared Founder decision, and no more', () => {
    const declared = (surface.process_truth.reconciliation?.known_discrepancies ?? []).filter(
      (d) => d.founder_decision_required === true,
    );
    const rows = marked(html, 'data-attention-decision');

    expect(declared.map((d) => d.id).sort()).toEqual(['D1', 'D2', 'D3']);
    // The census, not a string search.
    expect(rows.sort()).toEqual(['D1', 'D2', 'D3']);
    expect(rows).toHaveLength(declared.length);
  });

  it('renders each decision with both declared positions and its resolution', () => {
    for (const d of surface.process_truth.reconciliation?.known_discrepancies ?? []) {
      if (d.founder_decision_required !== true) continue;
      expect(text).toContain(d.item);
      expect(text).toContain(decode(d.resolution));
    }
    // The panel is labelled as a selection on the canonical flag, not as a
    // judgement about severity.
    expect(text).toContain('Founder decisions required');
    expect(text).toContain('founder_decision_required=true');
  });

  it('does not render a row for a discrepancy lacking the flag', () => {
    // Synthetic: inject an unflagged, maximally alarming discrepancy. It must
    // produce no row. Canonical source on disk is untouched.
    const injected = {
      ...surface,
      process_truth: {
        ...surface.process_truth,
        reconciliation: {
          known_discrepancies: [
            ...(surface.process_truth.reconciliation?.known_discrepancies ?? []),
            {
              id: 'ZZ9',
              item: 'SYNTHETIC UNFLAGGED ITEM',
              resolution: 'UNRESOLVED - synthetic, must not render.',
              founder_decision_required: false,
            },
          ],
        },
      },
    };
    const injectedHtml = renderToStaticMarkup(
      React.createElement(AttentionSurface, { surface: injected as typeof surface }),
    );
    const rows = marked(injectedHtml, 'data-attention-decision');
    expect(rows).toHaveLength(3);
    expect(rows).not.toContain('ZZ9');
    expect(injectedHtml).not.toContain('SYNTHETIC UNFLAGGED ITEM');
  });

  it('drops the row entirely when the flag is removed from a live item', () => {
    const mutated = {
      ...surface,
      process_truth: {
        ...surface.process_truth,
        reconciliation: {
          known_discrepancies: (
            surface.process_truth.reconciliation?.known_discrepancies ?? []
          ).map((d) => (d.id === 'D2' ? { id: d.id, item: d.item, resolution: d.resolution } : d)),
        },
      },
    };
    const mutatedHtml = renderToStaticMarkup(
      React.createElement(AttentionSurface, { surface: mutated as typeof surface }),
    );
    const rows = marked(mutatedHtml, 'data-attention-decision').sort();
    expect(rows).toEqual(['D1', 'D3']);
  });
});

describe('PROOFS 4/5/8/9 — activity cannot create, move or rank an attention row', () => {
  it('renders the same declared rows after a needs_founder flood', () => {
    const noise = Array.from({ length: 400 }, (_, i) => ({
      event_id: `__flood_${i}`,
      broker_sequence: 300000 + i,
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
    }));
    const flooded = {
      ...surface,
      execution_truth: {
        ...surface.execution_truth,
        activity_events: [...(surface.execution_truth.activity_events ?? []), ...(noise as never)],
      },
    };
    const floodedHtml = renderToStaticMarkup(
      React.createElement(AttentionSurface, { surface: flooded as typeof surface }),
    );

    // Every declared-exception marker is byte-identical under the flood.
    for (const attr of [
      'data-attention-decision',
      'data-attention-wave-row',
      'data-attention-family',
      'data-attention-stage-blocker',
      'data-attention-corrective',
      'data-attention-disagreement',
    ]) {
      expect(
        marked(floodedHtml, attr),
        `${attr} changed under a needs_founder flood`,
      ).toEqual(marked(html, attr));
    }

    // And the flood itself never reaches the page.
    expect(floodedHtml).not.toContain('__flood_');
    expect(floodedHtml).not.toContain('noise');
  });

  it('renders no agent, event or activity attribution anywhere', () => {
    for (const token of [
      'needs_founder',
      'activity_events',
      'lifetime_events',
      'broker_sequence',
      'last_activity_at',
    ]) {
      expect(text.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });

  it('renders no agent handle from the roster', () => {
    // The handles that appear in canonical identity/conflict data may appear
    // ONLY inside a declared conflict row. This asserts no roster column
    // leaked in, by checking the surface carries no roster-shaped section.
    expect(text).not.toContain('current_task');
    expect(text).not.toContain('duty_current_task');
  });
});

describe('PROOF 6 — current restart authorization and the six declared wave rows', () => {
  it('renders exactly six wave rows, one per canonical entry', () => {
    const wave = surface.process_truth.restart_wave_after_authorization ?? [];
    expect(wave).toHaveLength(6);

    const tables = tablesOf(html);
    // The wave table is the one whose header row starts with '#'.
    const waveTable = tables.find((t) => /<th[^>]*>Task<\/th>/.test(t));
    expect(waveTable, 'no restart wave table rendered').toBeDefined();
    expect(dataRowCount(waveTable!)).toBe(6);
    expect(marked(html, 'data-attention-wave-row')).toHaveLength(6);

    for (const w of wave) {
      expect(text).toContain(String(w.task));
      expect(text).toContain(decode(String(w.title)));
    }
  });

  it('renders the current authorization without claiming a task is executing', () => {
    expect(marked(html, 'data-attention-restart-wave')).toEqual(['authorized']);
    expect(text).toContain('RESTART_AUTHORIZED');
    expect(text).not.toContain('AUTHORIZED BY DEC-109');
    expect(text).not.toContain('2026-10-29');
    expect(text).toMatch(/does not prove that any task is executing/i);
  });

  it('renders the current implementation decision and its sequence basis', () => {
    const hold = surface.process_truth.hold_state!;
    expect(hold.implementation).toBe('RESTART_AUTHORIZED');
    expect(hold.authority).toBe('DEC-109');
    expect(hold.restart_requires).toBeNull();
    expect(text).toContain('RESTART_AUTHORIZED');
    expect(text).not.toContain('AUTHORIZED BY DEC-109');
    expect(text).not.toContain(hold.effective!);
    for (const g of hold.restart_gate_conditions ?? []) {
      expect(text).toContain(decode(g));
    }
    expect(surface.work_truth.global_blocker).toBeNull();
    expect(marked(html, 'data-attention-global-blocker')).toEqual([]);
  });

  it('renders RESTART_AUTHORIZED from the canonical field rather than a literal', () => {
    // The value appears because the field carries it. Asserting the literal
    // here would pass even if the renderer hardcoded the string, so the
    // structural check lives in phase5.test.ts; this pins the rendered word.
    expect(surface.process_truth.hold_state!.implementation).toBe('RESTART_AUTHORIZED');
    expect(text).toContain('RESTART_AUTHORIZED');
  });
});

describe('PROOF 7 — declared blockers render from declared fields only', () => {
  it('renders one row per family, from critical_blocker', () => {
    const families = surface.process_truth.process_families ?? [];
    const rows = marked(html, 'data-attention-family');
    expect(rows.sort()).toEqual(families.map((f) => f.id).sort());
    for (const f of families) {
      expect(text).toContain(f.critical_blocker!);
    }
  });

  it('renders exactly the stages canonical source declares a blocker on', () => {
    const declared = (surface.process_truth.process_families ?? []).flatMap((f) =>
      f.stages.filter((s) => Boolean(s.blocked_by)).map((s) => `${f.id}/${s.stage}`),
    );
    expect(marked(html, 'data-attention-stage-blocker').sort()).toEqual(declared.sort());
    expect(marked(html, 'data-attention-stage-blocker')).toHaveLength(5);
  });

  it('renders every declared corrective task verbatim', () => {
    const tasks = surface.process_truth.corrective_tasks ?? [];
    const rows = marked(html, 'data-attention-corrective');
    expect(rows.sort()).toEqual(tasks.map((t) => String(t.id)).sort());
    for (const t of tasks) {
      expect(text).toContain(decode(String(t.title)));
    }
  });

  it('renders no stage note and no SERP ref — the Phase 4 floor is not duplicated', () => {
    const note = 'FIXTURE-PHASE4-STAGE-NOTE-MUST-NOT-APPEAR-ON-ATTENTION';
    const cloned: any = structuredClone(surface);
    const families = cloned.process_truth.process_families ?? [];
    cloned.process_truth = {
      ...cloned.process_truth,
      process_families: families.length
        ? families.map((f: any, i: number) =>
            i === 0
              ? {
                  ...f,
                  stages: [
                    ...(f.stages ?? []),
                    { stage: 'FixtureNote', note, blocked_by: null },
                  ],
                }
              : f,
          )
        : [{ id: 'FIX', stages: [{ stage: 'FixtureNote', note, blocked_by: null }] }],
    };
    const fixtureText = decode(
      renderToStaticMarkup(React.createElement(AttentionSurface, { surface: cloned })).replace(
        /<[^>]+>/g,
        ' ',
      ),
    );
    expect(fixtureText).not.toContain(note);
    expect(fixtureText).not.toContain('SERP-FIXTURE-SHOULD-NOT-RENDER');
  });
});

describe('PROOF 9 — the STALE header is honest context, not an attention item', () => {
  it('renders the fixture STALE execution state with both hashes', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/phase5-surface.json', import.meta.url), 'utf8')) as CommandSurface;
    const et = fixture.execution_truth;
    const fixtureText = decode(renderToStaticMarkup(React.createElement(AttentionSurface, { surface: fixture })).replace(/<[^>]+>/g, ' '));
    expect(et.state).toBe('STALE');
    expect(fixtureText).toContain('STALE');
    expect(fixtureText).toContain(et.ledger!.recorded_sha256_prefix!);
    expect(fixtureText).toContain(et.ledger!.live_sha256_prefix!);
    expect(fixtureText).toContain('Command does not re-ingest');
  });

  it('renders the gate verdicts as UNKNOWN, never PASS', () => {
    const gates = surface.health_floor?.tool_health?.reconciliation_gates?.gates ?? [];
    expect(gates.length).toBeGreaterThan(0);
    for (const g of gates) expect(g.state).toBe('UNKNOWN');
    expect(text).toContain('UNKNOWN');
    expect(text).toContain('A gate that has not been run is UNKNOWN, never PASS');
    expect(text).not.toMatch(/gate.{0,40}\bPASS\b/);
  });

  it('declares the header carries no attention weight', () => {
    expect(text).toContain('None of these values is an attention item');
    expect(text).toContain('none of them adds, removes or ranks a row');
  });
});

describe('PROOF D — declared conflicts render and are never merged', () => {
  it('renders one row per declared truth disagreement', () => {
    const cloned: any = structuredClone(surface);
    cloned.execution_truth = {
      ...cloned.execution_truth,
      agents: [
        ...(cloned.execution_truth.agents ?? []),
        {
          handle: 'fixture-disagree',
          current_state: 'active',
          current_task: 'FIXTURE-EXEC-TASK',
          counts_as_active_staff: false,
          staff_classification: 'UNKNOWN',
        },
      ],
    };
    cloned.staff_state = {
      ...cloned.staff_state,
      byHandle: {
        ...(cloned.staff_state?.byHandle ?? {}),
        'fixture-disagree': { duty_current_task: 'FIXTURE-DUTY-TASK', duty_state: 'assigned' },
      },
    };
    cloned.floor = buildFloor({ surface: cloned });
    const declared = (cloned.floor?.constraints ?? []).filter(
      (c: { kind: string }) => c.kind === 'TRUTH_DISAGREEMENT',
    );
    expect(declared.length).toBeGreaterThan(0);
    const fixtureHtml = renderToStaticMarkup(
      React.createElement(AttentionSurface, { surface: cloned }),
    );
    const rows = marked(fixtureHtml, 'data-attention-disagreement');
    expect(rows.sort()).toEqual(declared.map((c: { subject: string }) => c.subject).sort());
    expect(rows).toContain('fixture-disagree');
  });

  it('names the canonical source on every rendered conflict row', () => {
    for (const c of surface.floor?.constraints ?? []) {
      if (c.kind !== 'TRUTH_DISAGREEMENT') continue;
      expect(text).toContain(c.canonical_source);
    }
  });

  it('renders identity exceptions and raw conflicts', () => {
    const identityKinds = (surface.floor?.constraints ?? []).filter((c) =>
      ['IDENTITY_CONFLICT', 'UNKNOWN_IDENTITY', 'REVOKED_IDENTITY'].includes(c.kind),
    );
    expect(identityKinds.length).toBeGreaterThan(0);
    expect(marked(html, 'data-attention-identity').length).toBe(identityKinds.length);
    expect(marked(html, 'data-attention-conflict').length).toBe(
      (surface.execution_truth.conflicts ?? []).length,
    );
  });
});

describe('PROOF 10/11/12 — no clock, no score, no drill-down on the rendered page', () => {
  it('renders no percentage, no ratio and no age', () => {
    expect(text).not.toMatch(/[\d.]+\s*%/);
    expect(text).not.toMatch(/\b\d+\s*(hours?|hrs?|days?|minutes?|mins?)\b/i);
    expect(text).not.toMatch(/\bwaiting for\b/i);
  });

  it('renders no "since you last looked" and no daily framing', () => {
    // These words are checked on RENDERED TEXT, and the two that legitimately
    // appear — "digest" and "scored" — appear only inside the sentences that
    // DENY the framing. So each is asserted to appear ONLY in a negated
    // construction, which is a stronger check than a bare absence: it would
    // catch the surface quietly adopting the framing it says it does not have.
    for (const token of ['last looked', 'since you', 'today', 'overnight', 'daily']) {
      expect(text.toLowerCase(), `rendered text uses "${token}" framing`).not.toContain(token);
    }
    // The window is the PREFIX before the word, so the negation must sit in it.
    for (const m of text.matchAll(/(.{0,28})digest/gi)) {
      expect(m[1], `unqualified digest framing after: "${m[1]}"`).toMatch(/not a\s*$/i);
    }
  });

  it('renders no priority, urgency or ranking language', () => {
    for (const token of ['priority', 'urgent', 'urgency', 'most important', 'score', 'ranked']) {
      // Same rule: the word may appear only inside a negation, and the window
      // is the PREFIX before it. "Nothing here is inferred from message text,
      // ranked or scored" puts the negation 44 characters back, so the window
      // has to be wide enough to reach it — and must not span a sentence
      // boundary, or a negation from the PREVIOUS sentence would vouch for
      // this one.
      const hits = [...text.matchAll(new RegExp(`(.{0,60})${token}`, 'gi'))].map((m) => m[1]!);
      for (const prefix of hits) {
        const lastSentence = prefix.split(/[.!?]\s/).pop() ?? prefix;
        expect(lastSentence, `unqualified ranking language after: "${prefix}"`).toMatch(
          /\b(no|not|never|nothing|nor|neither)\b/i,
        );
      }
    }
  });

  it('renders no ledger body, no raw path and no citation affordance', () => {
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('/api/raw');
    expect(text).not.toContain('room.jsonl');
    expect(text).not.toContain('body_sha');
  });

  it('states the snapshot scope in rendered copy', () => {
    expect(text).toContain('current declared-exceptions snapshot, not a digest and not a queue');
    expect(text).toContain('no notion of a previous visit');
  });

  it('states the B1 absence in rendered copy', () => {
    expect(text).toContain('Every item on this surface links to a canonical field it names');
  });
});
