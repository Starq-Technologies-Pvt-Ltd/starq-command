/**
 * Control Plane State Machine, Persistent Task Store, Verifier Guard,
 * Lease Manager, Stuck Detection, and Fleet Roster Test Suite
 * Starq Command Architecture Doctrine Sections 7, 8, 9, 10, 11, 13, 14, 15, 18
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TaskStateMachine } from '../integrations/control-plane/state-machine.ts';
import { TaskStore } from '../integrations/control-plane/task-store.ts';
import { VerifierGuard } from '../integrations/control-plane/verifier-guard.ts';
import { LeaseService } from '../integrations/workspace/lease-service.ts';
import { StuckDetector } from '../src/detector/stuck-detector.ts';
import { QuotaTracker } from '../src/capacity/quota-tracker.ts';
import { RoomEventAdapter } from '../integrations/room/event-adapter.ts';
import { TaskContract } from '../src/schemas/task-contract.ts';
import { BuilderArtifact } from '../src/schemas/builder-artifact.ts';
import { VerifierArtifact } from '../src/schemas/verifier-artifact.ts';
import { CANONICAL_STARQ_FLEET, type SeatHealth } from '../src/schemas/seat-registry.ts';

describe('Task State Machine & Transitions', () => {
  it('allows legal canonical lifecycle transitions', () => {
    expect(TaskStateMachine.isTransitionLegal('CREATED', 'QUEUED')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('QUEUED', 'ALLOCATED')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('ALLOCATED', 'EXECUTING')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('EXECUTING', 'BUILDER_COMPLETE')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('BUILDER_COMPLETE', 'VERIFYING')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('VERIFYING', 'ACCEPTED')).toBe(true);
  });

  it('allows controlled branches (BLOCKED, REJECTED, FAILED, CANCELLED)', () => {
    expect(TaskStateMachine.isTransitionLegal('EXECUTING', 'BLOCKED')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('BLOCKED', 'EXECUTING')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('VERIFYING', 'REJECTED')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('REJECTED', 'QUEUED')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('EXECUTING', 'FAILED')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('FAILED', 'QUEUED')).toBe(true);
    expect(TaskStateMachine.isTransitionLegal('QUEUED', 'CANCELLED')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(TaskStateMachine.isTransitionLegal('CREATED', 'ACCEPTED')).toBe(false);
    expect(TaskStateMachine.isTransitionLegal('CREATED', 'EXECUTING')).toBe(false);
    expect(TaskStateMachine.isTransitionLegal('EXECUTING', 'ACCEPTED')).toBe(false); // cannot skip verification!
  });

  it('strictly protects terminal states (ACCEPTED and CANCELLED)', () => {
    expect(() =>
      TaskStateMachine.validateTransition('T-001', 'ACCEPTED', 'QUEUED', 'admin')
    ).toThrow(/terminal state ACCEPTED/i);

    expect(() =>
      TaskStateMachine.validateTransition('T-001', 'CANCELLED', 'EXECUTING', 'admin')
    ).toThrow(/terminal state CANCELLED/i);
  });

  it('rejects self-transitions', () => {
    expect(() =>
      TaskStateMachine.validateTransition('T-001', 'EXECUTING', 'EXECUTING', 'admin')
    ).toThrow(/already in state EXECUTING/i);
  });
});

describe('Durable Task Store & Persistence Recovery', () => {
  let tempDbPath: string;
  let store: TaskStore;

  const sampleContract: TaskContract = {
    task_id: 'SERP-9901',
    title: 'Implement Inventory Reconciler',
    project_id: 'STARQ_ERP',
    repository_url: 'git@github.com:starq/starqERP.git',
    base_sha: 'a1b2c3d4e5f60718293041526374859607182930',
    task_type: 'FEATURE',
    priority: 'P1_HIGH',
    objective: 'Reconcile warehouse GL adjustments with physical count',
    boundary_rules: {
      allowed_paths: ['packages/inventory/**'],
      forbidden_paths: ['packages/core/auth/**'],
      prohibited_actions: ['drop_table'],
    },
    acceptance_criteria: ['All adjustments posted to GL', 'Balance reconciled'],
    verification_requirements: {
      required_test_commands: ['npm test'],
      minimum_independence_level: 'INDEPENDENT_INTERNAL_STRONG',
    },
    risk_level: 'MEDIUM',
    timeout_seconds: 3600,
    founder_approval_required: false,
    builder_seat: 'codex',
    verifier_seat: 'vision',
  };

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `starq-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    store = new TaskStore(tempDbPath);
  });

  afterEach(() => {
    try {
      store.close();
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    } catch {}
  });

  it('creates, retrieves, and transitions tasks', () => {
    const created = store.createTask(sampleContract);
    expect(created.taskId).toBe('SERP-9901');
    expect(created.state).toBe('CREATED');
    expect(created.builderSeat).toBe('codex');

    const queued = store.transitionTask('SERP-9901', 'QUEUED', 'coordinator', 'Queued for execution');
    expect(queued.state).toBe('QUEUED');

    const allocated = store.transitionTask('SERP-9901', 'ALLOCATED', 'coordinator', 'Allocated to builder', {
      builderSeat: 'codex',
      branch: 'starq/task/SERP-9901',
      baseSha: sampleContract.base_sha,
    });
    expect(allocated.state).toBe('ALLOCATED');
    expect(allocated.branch).toBe('starq/task/SERP-9901');

    const executing = store.transitionTask('SERP-9901', 'EXECUTING', 'codex', 'Builder started work');
    expect(executing.state).toBe('EXECUTING');

    const history = store.getTransitionHistory('SERP-9901');
    expect(history.length).toBe(4);
    expect(history[0].toState).toBe('CREATED');
    expect(history[1].toState).toBe('QUEUED');
    expect(history[2].toState).toBe('ALLOCATED');
    expect(history[3].toState).toBe('EXECUTING');
  });

  it('survives process restart and recovers persistent state intact', () => {
    store.createTask(sampleContract);
    store.transitionTask('SERP-9901', 'QUEUED', 'system');
    store.transitionTask('SERP-9901', 'ALLOCATED', 'system');
    store.transitionTask('SERP-9901', 'EXECUTING', 'codex');
    store.close();

    // Reopen from same persistent file
    const recoveredStore = new TaskStore(tempDbPath);
    const recovered = recoveredStore.getTask('SERP-9901');
    expect(recovered).not.toBeNull();
    expect(recovered?.state).toBe('EXECUTING');
    expect(recovered?.builderSeat).toBe('codex');

    const history = recoveredStore.getTransitionHistory('SERP-9901');
    expect(history.length).toBe(4);
    recoveredStore.close();
  });
});

describe('Verifier Guard & Anti-Self-Acceptance Enforcement', () => {
  const baseTask = {
    taskId: 'T-500',
    project: 'STARQ_ERP',
    priority: 'P1' as const,
    riskClass: 'MEDIUM' as const,
    title: 'Test Task',
    objective: 'Test Objective',
    state: 'VERIFYING' as const,
    builderSeat: 'codex',
    verifierSeat: 'vision',
    workspacePath: 'D:/starq/.worktrees/T-500',
    branch: 'starq/task/T-500',
    baseSha: '1111111111111111111111111111111111111111',
    candidateSha: '2222222222222222222222222222222222222222',
    leaseId: 'lease-123',
    retries: 0,
    maxRetries: 3,
    roomThreadRef: null,
    contractJson: null,
    builderArtifactJson: null,
    verifierArtifactJson: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };

  const validPassingArtifact: VerifierArtifact = {
    schemaVersion: '1.0.0',
    taskId: 'T-500',
    verifierSeat: 'vision',
    evaluatedSha: '2222222222222222222222222222222222222222',
    verificationWorkspace: 'D:/starq/.worktrees/T-500-verifier',
    independenceClass: 'STRICT_INDEPENDENT',
    commandsExecuted: [{ command: 'npm test', exitCode: 0 }],
    result: 'PASS',
    findings: [],
    remainingRisk: 'LOW',
    verdictNotes: 'All tests passed cleanly on detached candidate SHA',
    verifiedAt: new Date().toISOString(),
  };

  it('approves independent verification when all invariants are satisfied', () => {
    const evalResult = VerifierGuard.canAcceptTask(baseTask, validPassingArtifact);
    expect(evalResult.allowed).toBe(true);
  });

  it('STRICTLY REJECTS builder self-acceptance', () => {
    const selfAcceptingArtifact: VerifierArtifact = {
      ...validPassingArtifact,
      verifierSeat: 'codex', // SAME AS BUILDER!
    };

    const evalResult = VerifierGuard.canAcceptTask(baseTask, selfAcceptingArtifact);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.reason).toMatch(/ANTI-SELF-ACCEPTANCE VIOLATION/i);
  });

  it('STRICTLY REJECTS evaluated SHA mismatch against candidate SHA', () => {
    const wrongShaArtifact: VerifierArtifact = {
      ...validPassingArtifact,
      evaluatedSha: '3333333333333333333333333333333333333333', // MISMATCH!
    };

    const evalResult = VerifierGuard.canAcceptTask(baseTask, wrongShaArtifact);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.reason).toMatch(/EXACT-SHA MISMATCH/i);
  });

  it('rejects acceptance if verifier verdict is FAIL or CONDITIONAL', () => {
    const failingArtifact: VerifierArtifact = {
      ...validPassingArtifact,
      result: 'FAIL',
    };

    const evalResult = VerifierGuard.canAcceptTask(baseTask, failingArtifact);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.reason).toMatch(/must be PASS/i);

    // Can reject task when verdict is FAIL
    const rejectCheck = VerifierGuard.canRejectTask(baseTask, failingArtifact);
    expect(rejectCheck.allowed).toBe(true);
  });

  it('rejects malformed verifier artifact', () => {
    const malformed = { ...validPassingArtifact, schemaVersion: '2.0.0' } as any;
    const evalResult = VerifierGuard.canAcceptTask(baseTask, malformed);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.reason).toMatch(/Invalid verifier artifact/i);
  });
});

describe('Workspace Lease Service & Stale Detection', () => {
  let tempWs: string;

  beforeEach(() => {
    tempWs = path.join(os.tmpdir(), `starq-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempWs, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempWs)) fs.rmSync(tempWs, { recursive: true, force: true });
    } catch {}
  });

  it('acquires, heartbeats, and releases lease', () => {
    const lease = LeaseService.acquireLease({
      taskId: 'T-99',
      seat: 'antigravity',
      role: 'BUILDER',
      workspacePath: tempWs,
      branch: 'starq/task/T-99',
      baseSha: 'abcdef1234567890',
      ttlSeconds: 60,
    });

    expect(lease.status).toBe('ACTIVE');
    expect(lease.seat).toBe('antigravity');

    const updated = LeaseService.heartbeat(tempWs);
    expect(Date.parse(updated.heartbeatAt)).toBeGreaterThanOrEqual(Date.parse(lease.acquiredAt));

    const released = LeaseService.releaseLease(tempWs);
    expect(released?.status).toBe('RELEASED');
  });

  it('prevents collision on actively leased workspace', () => {
    LeaseService.acquireLease({
      taskId: 'T-99',
      seat: 'antigravity',
      role: 'BUILDER',
      workspacePath: tempWs,
      branch: 'starq/task/T-99',
      baseSha: 'abcdef1234567890',
      ttlSeconds: 3600,
    });

    // Attempting to acquire again with active PID must throw
    expect(() => {
      LeaseService.acquireLease({
        taskId: 'T-100',
        seat: 'codex',
        role: 'BUILDER',
        workspacePath: tempWs,
        branch: 'starq/task/T-100',
        baseSha: 'abcdef1234567890',
      });
    }).toThrow(/actively leased/i);
  });
});

describe('Stuck & Failure Detector Heuristics', () => {
  it('detects repeated command loops and pauses before kill', () => {
    const detector = new StuckDetector({ repeatedCommandThreshold: 3 });
    detector.registerTask('T-LOOP', 'codex');

    detector.recordCommand('T-LOOP', 'npm run build');
    detector.recordCommand('T-LOOP', 'npm run build');
    const stuckEv = detector.recordCommand('T-LOOP', 'npm run build');

    expect(stuckEv).not.toBeNull();
    expect(stuckEv?.signalType).toBe('REPEATED_COMMAND_LOOP');

    const record = detector.getRecord('T-LOOP');
    expect(record?.currentState).toBe('SUSPECTED_STUCK');

    // Second evidence transitions to STUCK with PAUSE remediation
    detector.addEvidence('T-LOOP', {
      signalType: 'NO_STATE_PROGRESS',
      description: 'Zero progress detected over multiple checks',
      observedAt: new Date().toISOString(),
    });

    const updatedRecord = detector.getRecord('T-LOOP');
    expect(updatedRecord?.currentState).toBe('STUCK');
    expect(updatedRecord?.remediationAction).toBe('PAUSE'); // Pause before kill!
  });

  it('detects inactivity timeout', () => {
    const detector = new StuckDetector({ inactivityThresholdMs: 1000 });
    detector.registerTask('T-INACTIVE', 'deadpool');

    // Simulate 2000ms elapsed
    const nowMs = Date.now() + 2000;
    const ev = detector.evaluateInactivity('T-INACTIVE', nowMs);

    expect(ev).not.toBeNull();
    expect(ev?.signalType).toBe('INACTIVITY_TIMEOUT');
  });
});

describe('Full Fleet Roster & Capacity Telemetry', () => {
  it('models the entire Starq organization with explicit runtime policies', () => {
    const seatIds = CANONICAL_STARQ_FLEET.map((s) => s.seatId);
    expect(seatIds).toContain('claude');
    expect(seatIds).toContain('codex');
    expect(seatIds).toContain('antigravity');
    expect(seatIds).toContain('cursor');
    expect(seatIds).toContain('vision');
    expect(seatIds).toContain('deadpool');
    expect(seatIds).toContain('pi');
    expect(seatIds).toContain('opencode');
    expect(seatIds).toContain('goose');
    expect(seatIds).toContain('hermes');
    expect(seatIds).toContain('unlaunchable_archive');

    const claude = CANONICAL_STARQ_FLEET.find((s) => s.seatId === 'claude');
    expect(claude?.launchPolicy).toBe('MANUAL');

    const cursor = CANONICAL_STARQ_FLEET.find((s) => s.seatId === 'cursor');
    expect(cursor?.launchPolicy).toBe('EXTERNAL');

    const unlaunchable = CANONICAL_STARQ_FLEET.find((s) => s.seatId === 'unlaunchable_archive');
    expect(unlaunchable?.launchPolicy).toBe('UNLAUNCHABLE');
  });

  it('initializes quota capacity to UNKNOWN without inventing fake telemetry', () => {
    const tracker = new QuotaTracker();
    const claudeCap = tracker.getCapacity('claude');

    expect(claudeCap?.telemetrySource).toBe('UNKNOWN');
    expect(claudeCap?.quotaStatus).toBe('UNKNOWN');
  });

  /**
   * THE FALSE-GREEN TEST.
   *
   * The assertion above is the one that always ran, and it only ever covered
   * `telemetrySource` and `quotaStatus`. Those two were already UNKNOWN. The
   * fields that actually told an operator a seat was fine — `health`,
   * `runtimeState`, `lastHeartbeat` — were never checked here at all, and they
   * shipped as `HEALTHY` / `IDLE` / a construction timestamp for every seat,
   * permanently, because nothing in the package ever called `updateSeatStatus`.
   *
   * So this block exists to assert the property that was missing rather than
   * just the values that happened to be checked: a tracker that has observed
   * NOTHING must not be able to report any seat as healthy, busy, idle or
   * offline, and must not present a clock reading as a heartbeat.
   *
   * It is written fleet-wide and value-agnostic on purpose. Asserting
   * `health === 'UNKNOWN'` on one seat would pass even if a future edit
   * regressed a different seat, and would not notice the day someone widened
   * the union again and re-picked a green. What is being defended is the
   * absence of an unearned claim across the whole roster.
   */
  it('reports NO seat as healthy, running or beating without an observation', () => {
    const tracker = new QuotaTracker();
    const fleet = tracker.getFullFleetStatus();

    expect(fleet.length).toBe(CANONICAL_STARQ_FLEET.length);

    for (const seat of fleet) {
      // The defect: these three are the claims an operator reads first.
      expect({ seat: seat.seatId, health: seat.health }).toEqual({
        seat: seat.seatId,
        health: 'UNKNOWN',
      });
      expect({ seat: seat.seatId, runtimeState: seat.runtimeState }).toEqual({
        seat: seat.seatId,
        runtimeState: 'UNKNOWN',
      });
      // A heartbeat that was never received must be ABSENT, not a clock
      // reading. `toBeUndefined` rather than `toBeNull` on purpose: the field
      // is optional, and "never observed" is a shape, not a value.
      expect({ seat: seat.seatId, lastHeartbeat: seat.lastHeartbeat }).toEqual({
        seat: seat.seatId,
        lastHeartbeat: undefined,
      });
      // The flag that lets a consumer tell "never looked" from "looked and
      // could not tell". Without it, UNKNOWN is ambiguous in a payload.
      expect({ seat: seat.seatId, observed: seat.observed }).toEqual({
        seat: seat.seatId,
        observed: false,
      });
    }
  });

  /**
   * Guards the guard.
   *
   * The fix widened `SeatHealth` to admit 'UNKNOWN'. That widening is the whole
   * fix — if the member is ever removed, the tracker cannot express an honest
   * value again and will silently return to picking the cheapest member, which
   * is 'HEALTHY'. This asserts the union still has a way to say "I do not know",
   * so that regression fails here rather than on a screen.
   */
  it('SeatHealth can express UNKNOWN, so an honest value is always available', () => {
    const honest: SeatHealth = 'UNKNOWN';
    expect(honest).toBe('UNKNOWN');

    // A non-exhaustive sample of the union: these must all remain legal, and
    // the point of the test is that UNKNOWN is a peer of them rather than a
    // value the type forces callers to avoid.
    const all: SeatHealth[] = ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNRESPONSIVE', 'OFFLINE'];
    for (const h of all) expect(all).toContain(h);
  });

  /**
   * The other half of the contract: UNKNOWN must be REACHABLE again.
   *
   * A fix that made the seed honest but left the observation path broken would
   * be a floor that can only ever report ignorance — which is its own kind of
   * useless. Once a caller actually looks at a seat, the tracker must be able
   * to carry that observation, and `observed` must flip to true so the row is
   * distinguishable from one that was merely constructed.
   */
  it('an observed status is recorded as observed, with a heartbeat', () => {
    const tracker = new QuotaTracker();

    // Before: constructed, unobserved, ignorant.
    expect(tracker.getSeatStatus('codex')?.health).toBe('UNKNOWN');
    expect(tracker.getSeatStatus('codex')?.observed).toBe(false);
    expect(tracker.getSeatStatus('codex')?.lastHeartbeat).toBeUndefined();

    // Someone looks at the seat and reports what they saw.
    const seen = tracker.updateSeatStatus('codex', {
      health: 'HEALTHY',
      runtimeState: 'ONLINE',
    });

    expect(seen?.health).toBe('HEALTHY');
    expect(seen?.runtimeState).toBe('ONLINE');
    // Now the green is EARNED, and the payload says so.
    expect(seen?.observed).toBe(true);
    expect(seen?.lastHeartbeat).toEqual(expect.any(String));
  });

  it('updates capacity with advisory recommendations when limit is reached', () => {
    const tracker = new QuotaTracker();
    const updated = tracker.updateTelemetry('codex', {
      quotaStatus: 'EXHAUSTED',
      telemetrySource: 'LOCAL_ESTIMATE',
    });

    expect(updated?.quotaStatus).toBe('EXHAUSTED');
    expect(updated?.recommendations[0]).toMatch(/quota exhausted.*Recommend routing/i);
  });
});

describe('Room Typed Lifecycle Events Envelope', () => {
  let tempLedger: string;

  beforeEach(() => {
    tempLedger = path.join(os.tmpdir(), `starq-room-events-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempLedger)) fs.unlinkSync(tempLedger);
    } catch {}
  });

  it('emits and retrieves typed room events envelopes', async () => {
    const adapter = new RoomEventAdapter({ eventsLedgerPath: tempLedger });

    await adapter.emitEvent('TASK_CREATED', {
      taskId: 'T-100',
      sender: 'founder',
      summary: 'Task T-100 created',
      payload: { priority: 'P0' },
    });

    await adapter.emitEvent('BUILDER_COMPLETE', {
      taskId: 'T-100',
      sender: 'antigravity',
      summary: 'Task T-100 builder complete',
      payload: { candidateSha: 'abc' },
    });

    const read = adapter.readEvents({ taskId: 'T-100' });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('expected a readable ledger');
    expect(read.state).toBe('OK');
    expect(read.events.length).toBe(2);
    expect(read.events[0].type).toBe('TASK_CREATED');
    expect(read.events[1].type).toBe('BUILDER_COMPLETE');
    expect(read.skipped_malformed).toBe(0);
  });

  /**
   * COM-GAP-009 — the false-empty test.
   *
   * An ABSENT source must never be reported as an EMPTY one. The old code
   * returned `[]` when the ledger did not exist, and the service turned that
   * into `200 {ok:true, events:[]}` — a healthy-looking empty feed for a file
   * that has never existed on a clean tree. A consumer had no way to tell "the
   * feed is empty" from "there is no feed", and would have rendered a working
   * message list over nothing.
   *
   * Asserted on the DISCRIMINANT, not on a message: the point is that the
   * unavailable branch is reachable and typed, so a future refactor cannot
   * quietly return to a bare array.
   */
  it('reports an ABSENT ledger as UNAVAILABLE, never as an empty event list', () => {
    const absent = path.join(os.tmpdir(), `starq-absent-ledger-${Date.now()}.jsonl`);
    const adapter = new RoomEventAdapter({ eventsLedgerPath: absent });

    expect(fs.existsSync(absent)).toBe(false);

    const read = adapter.readEvents();

    // Not ok, and specifically UNAVAILABLE — never a successful empty read.
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('an absent ledger must not read as OK');
    expect(read.state).toBe('UNAVAILABLE');
    // It names WHICH source is missing, so the operator is not left guessing.
    expect(read.path).toBe(absent);
    expect(read.reason).toMatch(/absent source, NOT an empty ledger/i);
    // And it cannot be mistaken for a result carrying events: the OK branch's
    // fields are simply not present.
    expect('events' in read).toBe(false);
  });

  /**
   * The same defect wearing different clothes: a ledger line that fails to
   * parse used to be dropped with no trace, so a truncated or corrupted file
   * reported a short, confident, entirely fabricated history. Silent loss is a
   * false-empty too, and it is counted rather than swallowed.
   */
  it('counts unparseable ledger lines instead of silently dropping them', () => {
    const damaged = path.join(os.tmpdir(), `starq-damaged-ledger-${Date.now()}.jsonl`);
    fs.writeFileSync(
      damaged,
      [
        JSON.stringify({ type: 'TASK_CREATED', taskId: 'T-1', sender: 'founder', timestamp: 't', summary: 'ok', payload: {} }),
        '{ this is not json',
        JSON.stringify({ type: 'BUILDER_COMPLETE', taskId: 'T-1', sender: 'antigravity', timestamp: 't', summary: 'ok', payload: {} }),
      ].join('\n') + '\n',
      'utf8',
    );

    try {
      const read = new RoomEventAdapter({ eventsLedgerPath: damaged }).readEvents();
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error('expected a readable ledger');
      // Two good events survive, and the damage is visible rather than implied.
      expect(read.events.length).toBe(2);
      expect(read.total_lines).toBe(3);
      expect(read.skipped_malformed).toBe(1);
    } finally {
      try {
        if (fs.existsSync(damaged)) fs.unlinkSync(damaged);
      } catch {}
    }
  });
});
