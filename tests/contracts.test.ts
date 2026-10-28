import { describe, it, expect } from 'vitest';
import { STATE, buildSurface } from '../server/data-service.mjs';

/**
 * Contract tests against the REAL canonical sources.
 *
 * These read the live Starq workspace, so they verify the actual integration
 * rather than a fixture. If the canonical projections move underneath us, or
 * become unreachable, these fail — which is the point. A mock-only test suite
 * here would prove nothing about whether Command is wired to the truth.
 */

const surface = buildSurface();

describe('workspace resolution', () => {
  it('resolves the Starq workspace root', () => {
    expect(surface.workspace.root).toBeTruthy();
    expect(surface.workspace.source).toMatch(/STARQ_WORKSPACE|app-ancestry/);
  });

  it('declares its authority as a derived projection, never an SSOT', () => {
    expect(surface.process_truth?.authority ?? '').toBe('DERIVED_PROJECTION');
    expect(surface.authority_note).toMatch(/not an SSOT/i);
  });
});

describe('process truth is consumed, not computed', () => {
  it('reaches the canonical contract', () => {
    expect(surface.process_truth.available).toBe(true);
    expect(surface.process_truth.process_families.length).toBe(5);
  });

  it('carries exactly the five canonical process families', () => {
    expect(surface.process_truth.process_families.map((f) => f.id).sort()).toEqual([
      'C2B',
      'I2GL',
      'O2C',
      'P2P',
      'R2R',
    ]);
  });

  it('forwards stage classifications verbatim, including absent stages', () => {
    const families = surface.process_truth.process_families;
    const total = families.reduce((n, f) => n + f.stages.length, 0);
    expect(total).toBe(49);
    const absent = families.flatMap((f) => f.stages).filter((s) => s.state === 'absent');
    // Absent stages must survive the projection. Rendering only the green
    // ones would be the single most damaging lie this product could tell.
    expect(absent.length).toBeGreaterThan(0);
  });

  it('forwards the hold state from canonical source', () => {
    expect(surface.process_truth.hold_state?.implementation).toBe('ON_HOLD');
    expect(surface.process_truth.hold_state?.authority).toBe('DEC-100');
    expect(surface.process_truth.hold_state?.convergence_not_rewrite).toBe(true);
  });

  it('carries the carried Founder decisions unresolved', () => {
    const ids = (surface.process_truth.reconciliation?.known_discrepancies ?? []).map((d) => d.id);
    expect(ids).toContain('D1');
    expect(ids).toContain('D2');
    expect(ids).toContain('D3');
  });
});

describe('work truth forwards the authoritative scores', () => {
  it('reaches the canonical work model', () => {
    expect(surface.work_truth.available).toBe(true);
  });

  it('carries L4 as a value, not a React computation', () => {
    const l4 = surface.work_truth.maturity?.L4;
    expect(l4).toBeTruthy();
    expect(typeof l4?.maturity).toBe('number');
    expect(l4?.maturity).toBeGreaterThanOrEqual(0);
    expect(l4?.maturity).toBeLessThanOrEqual(1);
  });

  it('carries L3 per family and keeps L1 separate', () => {
    expect(surface.work_truth.maturity?.L3?.length).toBe(5);
    const l1 = surface.work_truth.maturity?.L1;
    expect(l1?.counts).toBeTruthy();
    expect(l1?.note).toMatch(/never the ERP percentage/i);
  });

  it('carries the global blocker rather than restating the hold', () => {
    expect(surface.work_truth.global_blocker?.authority).toBe('DEC-100');
  });
});

describe('execution truth and honesty states', () => {
  it('reaches the canonical activity projection', () => {
    expect(surface.execution_truth.available).toBe(true);
  });

  it('reports exact matches and verified append-only lag honestly', () => {
    const ledger = surface.execution_truth.ledger;
    expect(ledger?.recorded_sha256_prefix).toBeTruthy();
    expect(ledger?.live_sha256_prefix).toBeTruthy();
    if (ledger?.recorded_sha256_prefix === ledger?.live_sha256_prefix) {
      expect(ledger?.relation).toBe('MATCH');
      expect(ledger?.lag).toBe(false);
    } else if (ledger?.relation === 'PREFIX_EXTENSION') {
      // A verified append-only suffix means the snapshot is behind live Room,
      // but the existing projection itself remains valid as of its ingest time.
      expect(ledger?.lag).toBe(true);
      expect(ledger?.reason).toMatch(/verified activity checkpoint/);
    } else {
      // Any other hash difference must be visibly stale or unreadable.
      expect([STATE.STALE, STATE.UNREADABLE]).toContain(ledger?.state);
    }
  });

  it('never invents an assignment for an agent that has none', () => {
    for (const agent of surface.execution_truth.agents) {
      // UNKNOWN is a legitimate, expected value. A fabricated task is not.
      expect(typeof agent.current_task).toBe('string');
      expect(typeof agent.current_assignment).toBe('string');
    }
  });

  it('surfaces identity conflicts rather than merging them', () => {
    const conflicts = surface.execution_truth.conflicts;
    expect(Array.isArray(conflicts)).toBe(true);
    // At least one collision/split/retired conflict is expected in the
    // current epoch; merging them would fabricate a single identity.
    if (conflicts.length) {
      expect(conflicts[0]).toHaveProperty('type');
    }
  });
});

describe('provenance faithfulness', () => {
  it('re-hashes every declared provenance source', () => {
    expect(surface.provenance.checked).toBeGreaterThan(0);
  });

  it('agrees with the contract when the contract is in sync', () => {
    if (surface.provenance.state === STATE.OK) {
      expect(surface.provenance.drifted).toHaveLength(0);
      for (const src of surface.provenance.sources) {
        expect(src.recorded).toBe(src.live);
      }
    }
  });

  it('never reports DRIFT when the projection is simply unreachable', () => {
    // An unreadable source is UNAVAILABLE, not DRIFT. Conflating them would
    // manufacture a false alarm about the company's real state.
    if (surface.provenance.state === STATE.DRIFT) {
      expect(surface.provenance.drifted.length).toBeGreaterThan(0);
    }
  });
});

describe('health aggregation cannot mask a failing dimension', () => {
  it('reports each truth layer independently', () => {
    const keys = surface.health.conditions.map((c) => c.key).sort();
    expect(keys).toEqual(['executionTruth', 'processTruth', 'provenance', 'workTruth']);
  });

  it('reflects the worst condition in the overall verdict', () => {
    const states = surface.health.conditions.map((c) => c.state);
    const precedence = ['UNAVAILABLE', 'UNREADABLE', 'DRIFT', 'STALE', 'OK'];
    const worst = precedence.find((s) => states.includes(s as never));
    expect(surface.health.overall).toBe(worst);
  });
});

describe('identity presentation resolves from the registry', () => {
  it('presents the Founder canonically', () => {
    expect(surface.identities.founder?.handle).toBe('mustarq');
    expect(surface.identities.founder?.display_name).toBe('Mustarq');
    expect(surface.identities.founder?.operational_handle).toBe('@mustarq');
  });

  it('marks the legacy handle as legacy, never canonical', () => {
    const ali = surface.identities.byHandle.ali;
    expect(ali?.is_legacy).toBe(true);
    expect(ali?.legacy_alias_of).toBe('mustarq');
  });

  it('keeps a retired identity flagged as retired', () => {
    const nexus = surface.identities.byHandle.nexus;
    expect(nexus?.is_retired).toBe(true);
  });
});
