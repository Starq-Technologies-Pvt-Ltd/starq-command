import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { TruthSurface } from '@/surfaces/truth';
import { HoldBanner } from '@/components/state-gate';
import { DIMENSION_TONE } from '@/lib/states';
import { buildPhase2Surface } from '../server/data-service.mjs';

/**
 * The Phase 2 floor must actually RENDER.
 *
 * A type system proves a component is well-formed. It does not prove the
 * component mounts, does not throw on a real payload, and does not put the
 * right words on screen. This renders the REAL assembled surface — the same
 * object the browser receives — and asserts on the markup.
 *
 * These assertions are about HONESTY OF PRESENTATION, not about appearance:
 * that the four states appear as distinct labels, that the preserved history
 * is fenced off, that a source-fixed issue is not dressed as a runtime fix, and
 * that no value appears on screen that did not arrive in the payload.
 */

const surface = await buildPhase2Surface();
const html = renderToStaticMarkup(React.createElement(TruthSurface, { surface }));
const text = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

describe('the Truth & Health floor renders from the real surface', () => {
  it('mounts without throwing and produces substantial markup', () => {
    expect(html.length).toBeGreaterThan(5000);
    expect(text.length).toBeGreaterThan(1000);
  });

  it('states the principle that a green projection is not a green control plane', () => {
    expect(text).toMatch(/green projection is NOT a green control plane/i);
  });

  it('renders every dimension that the payload actually contains', () => {
    for (const d of surface.health_floor!.current_health) {
      expect(text, `dimension label missing from render: ${d.label}`).toContain(d.label);
    }
  });

  it('keeps the four honesty states on screen as distinct words', () => {
    // The vocabulary is always legible, whether or not a state happens to occur
    // today. A state the Founder can only decode at the moment it fires is a
    // state that will be misread at exactly the moment it matters.
    for (const state of ['STALE', 'DRIFT', 'UNAVAILABLE', 'UNKNOWN', 'FAIL']) {
      expect(text, `${state} never reaches the screen`).toContain(state);
    }
  });

  it('renders every state that is actually occurring, with its own meaning', () => {
    // The stronger property: whatever the payload says, that state is visible
    // AND explained. This is what makes the legend more than decoration.
    const occurring = new Set<string>([
      ...surface.health_floor!.current_health.map((d) => d.state),
      surface.health_floor!.state,
      ...surface.health_floor!.tool_health!.dimensions.map((d) => d.state),
    ]);
    expect(occurring.size).toBeGreaterThan(0);
    for (const state of occurring) {
      const meaning = DIMENSION_TONE[state]?.meaning;
      expect(meaning, `no meaning defined for occurring state ${state}`).toBeTruthy();
      expect(text, `state ${state} occurs but is not on screen`).toContain(state);
      expect(text, `state ${state} occurs but is not explained`).toContain(meaning!);
    }
  });

  it('fences the preserved historical issue off from the current verdict', () => {
    expect(text).toMatch(/EXCLUDED FROM THE CURRENT VERDICT/);
    const epoch1 = surface.health_floor!.preserved_historical[0];
    expect(epoch1).toBeTruthy();
    expect(text).toContain(epoch1!.epoch_id);
    expect(text).toContain(epoch1!.verdict);
    // The preserved failure is still shown as a failure, not tidied away.
    expect(text).toMatch(/FAIL_PRESERVED/);
  });

  it('says where each carried issue is actually fixed', () => {
    expect(text).toMatch(/Where is each issue actually fixed\?/i);
    for (const f of surface.health_floor!.fix_status) {
      expect(text, `fix-status entry missing: ${f.title}`).toContain(f.title);
    }
    // A source defect must not be presented as something this machine fixed.
    expect(text).toMatch(/SOURCE/);
  });

  it('separates the blocked tool from the truth underneath it', () => {
    const tool = surface.health_floor!.current_health.find((d) => d.id === 'healthTool')!;
    expect(tool.underlying_truth_reachable).toBe(true);
    expect(text).toContain('underlying truth reachable');
    expect(text).toMatch(/no — canonical, read-only/i);
  });

  it('shows the preserved failure without letting it recolour the present', () => {
    // The floor header reports the current aggregate and the preserved count
    // as two separate numbers, not one blended verdict.
    expect(text).toMatch(/preserved historical epoch\(s\) held separately/i);
    expect(text).toContain(String(surface.health_floor_summary!.preserved_historical_count));
  });

  it('renders the gates as unrun rather than as passing', () => {
    const gates = surface.health_floor!.tool_health!.reconciliation_gates.gates;
    for (const g of gates) {
      expect(g.state).toBe('UNKNOWN');
    }
    expect(text).toMatch(/Run read-only gates/);
    expect(text).toMatch(/never runs the ingester/i);
  });

  it('shows the verified stage state per family, worst-stage coloured', () => {
    for (const f of surface.process_truth.process_families) {
      expect(text, `family missing: ${f.id}`).toContain(f.id);
    }
    // The absent stages must survive to the screen. A floor that quietly drops
    // them would be the single most damaging thing this product could do.
    const absent = surface.process_truth.process_families
      .flatMap((f) => f.stages)
      .filter((s) => s.state === 'absent');
    expect(absent.length).toBeGreaterThan(0);
    expect(text).toMatch(/absent/);
  });

  it('keeps the current ERP decision in the payload without presenting a false hold', () => {
    expect(surface.process_truth.hold_state?.authority).toBe('DEC-109');
    expect(surface.process_truth.hold_state?.implementation).toBe('RESTART_AUTHORIZED');
    expect(text).not.toMatch(/ERP implementation ON HOLD under DEC-100/);
  });

  it('never prints a value that did not arrive in the payload', () => {
    // Spot-check the load-bearing numbers: each must be present in the payload
    // and in the render. This catches a hardcoded fixture creeping into markup.
    const recordsChecked = surface.health_floor!.ledger_integrity!.current!.records_checked;
    expect(recordsChecked, 'integrity count must be present on the payload').toBeGreaterThan(0);
    const facts = [
      surface.health_floor_summary!.dimensions_total.toString(),
      surface.health_floor_summary!.dimensions_healthy.toString(),
      surface.health_floor!.ledger_integrity!.current!.epoch_id!,
      Number(recordsChecked).toLocaleString('en-US'),
    ];
    for (const f of facts) {
      expect(text, `payload value not rendered: ${f}`).toContain(f);
    }
  });

  it('renders the current decision banner non-dismissably alongside the floor', () => {
    const hold = surface.process_truth.hold_state!;
    const banner = renderToStaticMarkup(
      React.createElement(HoldBanner, {
        implementation: hold.implementation,
        authority: hold.authority,
        effective: hold.effective,
        restartRequires: hold.restart_requires,
        convergenceNotRewrite: hold.convergence_not_rewrite,
      }),
    );
    expect(banner).toMatch(/RESTART_AUTHORIZED/);
    expect(banner).toMatch(/DEC-109/);
    expect(banner).not.toMatch(/dismiss/i);
  });
});
