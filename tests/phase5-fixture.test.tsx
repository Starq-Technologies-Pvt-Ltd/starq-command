import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { AttentionSurface } from '@/surfaces/attention';
import type { CommandSurface } from '@/lib/contracts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/phase5-surface.json', import.meta.url), 'utf8')) as CommandSurface;
const render = (s: CommandSurface) => renderToStaticMarkup(React.createElement(AttentionSurface, { surface: s }));
const mutate = (fn: (s: any) => void) => { const s: any = structuredClone(fixture); fn(s); return render(s); };
describe('Phase 5.1 deterministic commit fixture', () => {
  it('keeps Founder-decision semantics strict', () => expect(mutate(s => { s.process_truth.reconciliation.known_discrepancies[0].founder_decision_required = false; })).not.toContain('data-attention-decision'));
  it('shows missing declared-decision truth', () => expect(mutate(s => { delete s.process_truth.reconciliation.known_discrepancies; s.process_truth.reconciliation.known_discrepancies_present = false; })).toContain('SOURCE MISSING'));
  it('shows missing stage blocker truth', () => expect(mutate(s => { delete s.process_truth.process_families[0].stages[0].blocked_by; s.process_truth.process_families[0].stages[0].blocked_by_present = false; })).toContain('SOURCE MISSING: O2C/Payment'));
  it('shows missing conflict truth', () => expect(mutate(s => { delete s.execution_truth.conflicts; s.execution_truth.conflicts_present = false; })).toContain('SOURCE MISSING'));
  it('shows missing global blocker truth', () => expect(mutate(s => { delete s.work_truth.global_blocker; s.work_truth.global_blocker_present = false; })).toContain('SOURCE MISSING'));
  it('shows unavailable provenance and gates explicitly', () => expect(mutate(s => { s.provenance = { state: 'UNAVAILABLE', checked: 0, drifted: [], missing: ['contract'], sources: [] }; s.health_floor.tool_health.reconciliation_gates.gates = [{ id: 'gate', state: 'UNAVAILABLE' }]; })).toContain('UNAVAILABLE'));
});
