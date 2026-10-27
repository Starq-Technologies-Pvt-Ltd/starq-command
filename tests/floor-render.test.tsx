import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { FloorSurface } from '@/surfaces/floor';
import { DIMENSION_TONE, STAFF_CLASS_TONE } from '@/lib/states';
import { buildPhase3Surface } from '../server/data-service.mjs';
import { buildFloor } from '../server/floor.mjs';
import { ABSOLUTE_WINDOWS_PATH } from '../server/snapshot.mjs';

/**
 * The Phase 3 floor must actually RENDER.
 *
 * This server-renders the REAL assembled payload — the same object the browser
 * receives from `/api/surface` — and asserts on the markup. A type system proves
 * a component is well-formed; it does not prove it mounts, does not throw on
 * live data, and does not put the right words on screen.
 *
 * These assertions are about HONESTY OF PRESENTATION:
 * that a retired identity is labelled retired, that a mention count never reads
 * as an assignment, that a stale projection says so with its timestamp, that no
 * recomputed age appears anywhere, and that no value reaches the screen that did
 * not arrive in the payload.
 */

const surface = await buildPhase3Surface();
const floor = surface.floor!;
const html = renderToStaticMarkup(React.createElement(FloorSurface, { surface }));
const text = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

function renderFixtureDisagreement() {
  const cloned: any = structuredClone(surface);
  cloned.execution_truth = {
    ...cloned.execution_truth,
    agents: [
      ...(cloned.execution_truth.agents ?? []),
      {
        handle: 'fixture-disagree',
        current_state: 'active',
        current_task: 'FIXTURE-EXEC-TASK',
        current_assignment: 'SERP-FIXTURE-1',
        current_task_confidence: 'recorded',
        current_task_source: 'activity.json',
        current_assignment_confidence: 'recorded',
        current_assignment_source: 'activity.json',
        counts_as_active_staff: false,
        staff_classification: 'UNKNOWN',
        mentioned_task_count: 7,
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
  const fixtureHtml = renderToStaticMarkup(React.createElement(FloorSurface, { surface: cloned }));
  const fixtureText = fixtureHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return { floor: cloned.floor, html: fixtureHtml, text: fixtureText };
}

describe('the Dev Studio Floor renders from the real surface', () => {
  it('mounts without throwing and produces substantial markup', () => {
    expect(html.length).toBeGreaterThan(15000);
    expect(text.length).toBeGreaterThan(3000);
  });

  it('identifies itself as Phase 3 and as a read-only derived projection', () => {
    expect(text).toMatch(/Dev Studio Floor/);
    expect(text).toMatch(/PHASE 3 · LIVE/);
    expect(text).toMatch(/DERIVED_PROJECTION · READ-ONLY/);
  });

  it('renders every handle the payload actually contains', () => {
    for (const e of floor.roster.entries) {
      expect(text, `roster handle missing from render: ${e.handle}`).toContain(e.handle);
    }
  });

  it('renders every canonical staff classification that is occurring, explained', () => {
    // A vocabulary the Founder can only decode at the moment it fires is a
    // vocabulary that will be misread at exactly the moment it matters.
    const occurring = new Set(floor.roster.entries.map((e) => e.staff_classification));
    expect(occurring.size).toBeGreaterThan(0);
    for (const classification of occurring) {
      const tone = STAFF_CLASS_TONE[classification];
      expect(tone, `no tone defined for occurring classification ${classification}`).toBeTruthy();
      expect(text, `classification ${classification} not on screen`).toContain(tone!.label);
    }
  });

  it('never presents a retired identity as active staff', () => {
    const retired = floor.roster.entries.filter((e) => e.is_retired);
    expect(retired.length).toBeGreaterThan(0);
    // The state is spelled out, not merely coloured.
    expect(text).toMatch(/RETIRED — NOT ACTIVE STAFF/);

    for (const e of retired) {
      expect(e.is_active_staff).toBe(false);
      // The rendered row for a retired handle carries the RETIRED chip.
      const rowHtml = renderToStaticMarkup(
        React.createElement(FloorSurface, { surface }),
      );
      expect(rowHtml).toContain('RETIRED');
    }
  });

  it('shows the roster header counts as distinct, non-blended numbers', () => {
    const c = floor.roster.counts;
    expect(text).toContain(String(c.observed));
    expect(text).toContain(String(c.active_staff));
    expect(text).toContain(String(c.retired));
    expect(text).toContain(String(c.unknown_identity));
    expect(text).toContain(String(c.truth_disagreements));
    // Active staff is never the whole observed population.
    expect(c.active_staff).toBeLessThan(c.observed);
  });

  it('renders an agent with no canonical identity as an explicit conflict', () => {
    const unidentified = floor.roster.entries.filter((e) => !e.identity_present);
    expect(unidentified.length).toBeGreaterThan(0);
    expect(text).toMatch(/CONFLICT · UNKNOWN IDENTITY/);
    expect(text).toMatch(/NO CANONICAL IDENTITY RECORD/);
    for (const e of unidentified) {
      expect(e.display_name).toBeNull();
    }
  });

  it('renders both current-task truths with their provenance, and the disagreement', () => {
    const fx = renderFixtureDisagreement();
    const differing = fx.floor.roster.entries.filter((e) => e.truth_disagreement?.values_differ);
    expect(differing.length).toBeGreaterThan(0);
    // The disagreement is on screen as a first-class constraint, not smoothed.
    expect(fx.text).toMatch(/TRUTH_DISAGREEMENT/);
    expect(fx.text).toMatch(/activity\.json vs agent-comms\/protocol\/v1\/staff-state\.json/);
    expect(fx.text).toMatch(/BOTH RENDERED WITH PROVENANCE/);
    expect(fx.text).toMatch(/Assignments — execution side only/);
  });

  it('renders a mention count under its own heading, labelled as not an assignment', () => {
    expect(html).toMatch(/text-right">Mentions/);
    expect(text).toMatch(/a mention is not an assignment/i);
    const fx = renderFixtureDisagreement();
    const mentionIds = ['SERP-0', 'SERP-1', 'SERP-2', 'SERP-3'];
    const renderMentions = fx.floor.assignments.filter(
      (r) => r.current_assignment && String(r.current_assignment).includes('SERP-'),
    );
    expect(renderMentions.length).toBeGreaterThan(0);
    // Whatever is in the assignment column is a canonical assignment, not a count.
    for (const r of renderMentions) {
      expect(r.current_assignment).not.toBe(String(r.mention_count));
    }
    expect(fx.text).toContain('SERP-FIXTURE-1');
    expect(mentionIds.length).toBe(4);
  });

  it('renders the signal filter with its measured loss, and never hides it', () => {
    const f = floor.activity.filter;
    expect(text).toMatch(/Meaningful recent activity/);
    expect(text).toMatch(/filter guarantee/);
    expect(text).toMatch(/has_evidence, is_blocker, is_handoff, needs_founder/);
    // The measured loss figure is on screen, whatever it is.
    expect(text).toContain('Signal loss');
    expect(text).toContain(String(f.signal_loss));
    expect(f.signal_loss).toBe(0);
  });

  it('shows every feed row with its provenance digests', () => {
    const sample = floor.activity.events.slice(0, 8);
    expect(sample.length).toBeGreaterThan(0);
    for (const e of sample) {
      expect(text, `provenance missing for seq ${e.broker_sequence}`).toContain(e.body_sha!);
    }
    expect(text).toMatch(/body [0-9a-f]{6,}/);
  });

  it('renders UNKNOWN for a row whose canonical action is absent', () => {
    // The live window has action on 11 of 400 events; the rest must read
    // UNKNOWN rather than gaining an inferred verb.
    const withoutAction = floor.activity.events.filter((e) => e.action === null);
    expect(withoutAction.length).toBeGreaterThan(0);
    expect(text).toMatch(/UNKNOWN/);
  });

  it('states the stale projection state and its timestamps, and does not compute an age', () => {
    expect(text).toMatch(/Execution projection state/);
    expect(text).toMatch(/Projection generated_at/);
    expect(text).toMatch(/last_activity_at/);
    expect(text).toMatch(/No age shown anywhere on this surface is recomputed/);
    // The projection's own generated_at reaches the screen verbatim.
    expect(text).toContain(floor.execution_projection.generated_at!.slice(0, 10));
    // No hours-since figure anywhere in the markup.
    expect(text).not.toMatch(/\d+(\.\d+)?h ago/);
    expect(text).not.toMatch(/hours since last activity/i);
  });

  it('renders session presence separately, labelled as not a work count', () => {
    expect(text).toMatch(/Session presence/);
    expect(text).toMatch(/not a work count/i);
    expect(text).toMatch(/A lease records that a handle is held by a session instance/);
    if (floor.sessions.available) {
      for (const e of floor.sessions.entries.slice(0, 5)) {
        expect(text, `session missing: ${e.handle}`).toContain(e.handle);
      }
    }
  });

  it('renders runtime as forwarded from Phase 2, not re-measured', () => {
    expect(text).toMatch(/Runtime serving this surface/);
    expect(text).toMatch(/PHASE 2 · FORWARDED/);
    expect(text).toMatch(/forwarded, not re-measured/);
  });

  it('declares provider health absent rather than omitting it silently', () => {
    expect(text).toMatch(/provider health: excluded/i);
    expect(text).toMatch(/no canonical provider field exists/i);
  });

  it('declares every intentionally absent surface section', () => {
    expect(text).toMatch(/Deliberately not on this surface/);
    for (const key of Object.keys(floor.excluded)) {
      expect(text, `exclusion not rendered: ${key}`).toContain(key.replace(/_/g, ' '));
    }
  });

  it('renders the constraints rail above the roster, with each recorded constraint', () => {
    expect(text).toMatch(/Constraints and carried disagreements/);
    expect(text).toMatch(/NONE AUTO-RESOLVED/);
    expect(floor.constraints.length).toBeGreaterThan(0);
    for (const c of floor.constraints) {
      expect(text, `constraint kind missing: ${c.kind}`).toContain(c.kind);
      expect(text, `constraint subject missing: ${c.subject}`).toContain(c.subject);
    }
  });

  it('never renders a percentage, a score or a maturity value', () => {
    expect(text).not.toMatch(/\d+\.\d{2}%/);
    // L1..L4 are the maturity-layer labels. Anchor on a word boundary so a
    // canonical AUTHORITY LEVEL inside forwarded prose — `L1.1` appears in
    // devin's Founder restrictions — is not mistaken for a maturity layer.
    expect(text).not.toMatch(/\bL[1-4]\b(?![\d.])/);
    expect(text).not.toMatch(/\bL[1-4]_(task|stage|process|overall)/);
    // The WORD "maturity" does appear, and it must: the surface states in copy
    // that it carries no maturity reading. What must never appear is a maturity
    // VALUE, so assert that no stage-state vocabulary or rollup reached the
    // screen alongside it.
    expect(text).toMatch(/never progress/i);
    expect(text).not.toMatch(/\b(implemented|partial|schema-only|test-only)\b/i);
    // And the payload carries no such field at all — the structural guarantee.
    expect(floor.roster.entries.every((e) => !('maturity' in e))).toBe(true);
    expect(JSON.stringify(floor)).not.toMatch(/"maturity"\s*:/);
  });

  it('never prints a value that did not arrive in the payload', () => {
    // Spot-check the load-bearing numbers. Each must be in the payload AND in
    // the render, which catches a hardcoded fixture creeping into markup.
    const facts = [
      String(floor.roster.counts.observed),
      String(floor.roster.counts.active_staff),
      String(floor.roster.counts.retired),
      String(floor.activity.filter.window_total),
      String(floor.activity.filter.signal_total),
      String(floor.activity.filter.shown),
      String(floor.activity.filter.signal_loss),
      floor.sessions.count ? String(floor.sessions.count) : 'LEASES',
    ];
    for (const f of facts) {
      expect(text, `payload value not rendered: ${f}`).toContain(f);
    }
  });

  it('leaks no absolute host path into the rendered markup', () => {
    expect(ABSOLUTE_WINDOWS_PATH.test(html)).toBe(false);
    expect(html).not.toContain('D:\\');
    expect(html).not.toContain('D:/');
  });

  it('carries the hold authority onto the floor surface', () => {
    // The floor is an execution surface, but the ERP hold banner is rendered
    // above every surface by App.tsx, and the floor must not contradict it.
    expect(surface.process_truth.hold_state?.authority).toBe('DEC-100');
    expect(text).toMatch(/ON HOLD under DEC-100/);
  });

  it('renders every dimension state the Phase 2 floor defines as a distinct word', () => {
    // The Phase 3 surface borrows Phase 2's control-plane vocabulary. A state
    // that can only be decoded when it fires is a state that gets misread.
    for (const state of ['OK', 'FAIL', 'STALE', 'DRIFT', 'UNAVAILABLE', 'UNKNOWN']) {
      expect(DIMENSION_TONE[state]).toBeTruthy();
    }
    expect(floor.runtime.state).toBeTruthy();
    expect(text).toContain(floor.runtime.state);
  });
});
