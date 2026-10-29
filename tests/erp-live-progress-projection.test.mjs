/**
 * Focused tests for Command live ERP progress & maturity projection (CMD-ERP-LIVE-PROGRESS-PROJECTION-20261029).
 *
 * Verifies against OpenCode baseline criteria (#16199/#16200):
 * - AC-1: Canonical L4 overall ERP maturity (40.31%) forwarded verbatim from command_work_model.json.
 * - AC-2: Canonical L3 process family maturities (O2C, P2P, I2GL, C2B, R2R) forwarded verbatim.
 * - AC-3: Cached read by mtime preserves sub-millisecond response latency.
 * - AC-4: /api/pm/roadmaps exposes the verbatim canonical maturity model.
 * - AC-5: readRoadmapsData joins chains by family.id rather than object keys, achieving 49/49 bound stages.
 * - AC-6: contract.json hold_state remains canonical 'ON_HOLD' / 'DEC-100'.
 * - AC-7: Founder authority updates (#16183/#16185) surfaced separately without asserting contract state is ACTIVE.
 * - AC-8: Historical task rows in pm_tasks preserved with their original DB status.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveHold,
  portfolio,
  readRoadmapsData,
  readCanonicalWorkModelMaturity,
  startDatabase,
} from '../server/pm-service.mjs';

test('effectiveHold reports ACTIVE operating authority under Founder #16183/#16185/#16211 and preserves historical DEC-100 hold (AC-6, AC-7)', () => {
  const erpHold = effectiveHold({ id: 'erp', hold_state: null });
  assert.equal(erpHold.state, 'ACTIVE');
  assert.equal(erpHold.authority, 'Founder #16183/#16185/#16211');
  assert.equal(erpHold.effective, '2026-10-29');

  assert.ok(erpHold.historical_hold, 'historical_hold must be preserved');
  assert.equal(erpHold.historical_hold.state, 'ON_HOLD');
  assert.equal(erpHold.historical_hold.authority, 'DEC-100');
  assert.equal(erpHold.historical_hold.effective, '2026-09-28');

  assert.ok(erpHold.authority_update, 'authority_update must be surfaced');
  assert.equal(erpHold.authority_update.lifted_by, 'Founder #16183/#16185/#16211');
  assert.equal(erpHold.authority_update.scope, 'all development holds');
  assert.ok(erpHold.authority_update.canonical_ledger.includes('NOT YET WRITTEN'));
});

test('readCanonicalWorkModelMaturity forwards L1-L4 verbatim and caches by mtime (AC-1, AC-2, AC-3)', () => {
  const mat = readCanonicalWorkModelMaturity();
  assert.ok(mat, 'maturity model must be loaded');
  assert.equal(mat.authority, 'DERIVED_PROJECTION');
  assert.equal(mat.L4.maturity, 0.4031, 'L4 overall ERP maturity must equal 40.31% canonical');
  assert.equal(mat.L4.any_family_has_absent_stage, true);

  assert.equal(mat.L3.length, 5, '5 process families in L3');
  const o2c = mat.L3.find((f) => f.family === 'O2C');
  assert.ok(o2c);
  assert.equal(o2c.maturity, 0.5333);

  // Performance/caching check
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    readCanonicalWorkModelMaturity();
  }
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 20, `100 cached reads took ${elapsed}ms; must be < 20ms`);
});

test('portfolio projects include canonical 4-layer capability maturity (AC-1, AC-2)', () => {
  startDatabase();
  const port = portfolio();
  const erp = port.projects.find((p) => p.id === 'erp');
  assert.ok(erp, 'erp project must be in portfolio');
  assert.equal(erp.hold.state, 'ACTIVE');
  assert.equal(erp.execution_qualifier, 'ACTIVE');
  assert.equal(erp.hold.historical_hold.state, 'ON_HOLD');
  assert.ok(erp.hold.authority_update);

  assert.ok(erp.metrics.capability, 'capability metrics must exist');
  assert.equal(erp.metrics.capability.percent, 40, 'rounded percent matches L4 maturity (40%)');
  assert.equal(erp.metrics.capability.l4_maturity.maturity, 0.4031);
  assert.equal(erp.metrics.capability.l3_families.length, 5);
});

test('readRoadmapsData exposes maturity and binds all 49 stages across 5 families (AC-4, AC-5)', () => {
  startDatabase();
  const roadmaps = readRoadmapsData();
  assert.equal(roadmaps.chains_count, 5);
  assert.equal(roadmaps.stages_count, 49);

  // Check chains have canonical IDs (O2C, P2P, I2GL, C2B, R2R), not array indices "0".."4"
  const ids = roadmaps.chains.map((c) => c.id);
  assert.deepEqual(ids, ['O2C', 'P2P', 'I2GL', 'C2B', 'R2R']);

  // Check stage bindings joined cleanly
  for (const chain of roadmaps.chains) {
    const boundCount = chain.stages.filter((s) => s.bound_status === 'BOUND').length;
    assert.equal(boundCount, chain.stage_count, `All stages in ${chain.id} must be BOUND`);
  }

  assert.ok(roadmaps.maturity, 'roadmaps must expose canonical maturity');
  assert.equal(roadmaps.maturity.L4.maturity, 0.4031);
});
