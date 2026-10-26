/**
 * Control Plane HTTP Service Integration Test Suite
 * Starq Command Architecture Doctrine Sections 7, 8, 9, 10, 11, 13, 14, 15, 18
 * Verifies Blocker A protection, Origin validation, CSRF checks, and full lifecycle.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHerdrService } from '../integrations/herdr/herdr-service.mjs';
import { TaskStore } from '../integrations/control-plane/task-store.ts';
import { QuotaTracker } from '../src/capacity/quota-tracker.ts';
import { StuckDetector } from '../src/detector/stuck-detector.ts';
import { RoomEventAdapter } from '../integrations/room/event-adapter.ts';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

describe('Control Plane HTTP Service & Security Guards', () => {
  let service: ReturnType<typeof createHerdrService>;
  let port: number;
  let taskStore: TaskStore;
  let stuckDetector: StuckDetector;
  let quotaTracker: QuotaTracker;
  let roomAdapter: RoomEventAdapter;
  let tempLedger: string;
  let activeSessionCookie: string;
  let activeCsrfToken: string;

  beforeAll(async () => {
    tempLedger = path.join(os.tmpdir(), `test-room-ledger-${Date.now()}.jsonl`);
    taskStore = new TaskStore(':memory:');
    stuckDetector = new StuckDetector();
    quotaTracker = new QuotaTracker();
    roomAdapter = new RoomEventAdapter({ eventsLedgerPath: tempLedger });

    const mockClient = {
      hasActiveSession: true,
      sessionCsrfToken: 'test-valid-csrf-token',
      async mintSession() {
        return {
          cookie: 'test-session-cookie',
          csrfToken: 'test-valid-csrf-token',
          bootId: 'test-boot-id',
        };
      },
      async getHealth() { return { ok: true, boot_id: 'test-boot-id' }; },
      async getState() { return { ok: true }; },
      async getAgents() { return []; },
      async getSessions() { return []; },
    };

    service = createHerdrService({
      port: 0, // OS assigns open port
      client: mockClient as any,
      taskStore,
      stuckDetector,
      quotaTracker,
      roomAdapter,
    });

    const addr = (await service.listen()) as { port: number };
    port = addr.port;

    // Mint an authenticated session to get CSRF token and cookie
    const sessionRes = await fetch(`http://127.0.0.1:${port}/api/herdr/session`, {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    const sessionBody = await sessionRes.json();
    activeSessionCookie = sessionBody.session.cookie;
    activeCsrfToken = sessionBody.session.csrfToken;
  });

  afterAll(async () => {
    await service.close();
    taskStore.close();
    try {
      if (fs.existsSync(tempLedger)) fs.unlinkSync(tempLedger);
    } catch {}
  });

  it('serves GET /api/command/health', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/command/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe('command-control-plane');
  });

  it('BLOCKER A ENFORCEMENT: rejects GET on mutating endpoints with 405 METHOD_NOT_ALLOWED', async () => {
    const mutatingGetUrls = [
      `/api/herdr/action?agent=codex&verb=start`,
      `/api/herdr/floor/open`,
      `/api/herdr/agents/codex/start`,
      `/api/command/tasks/T-1/transition`,
      `/api/command/tasks/T-1/builder-completion`,
      `/api/command/tasks/T-1/verify`,
      `/api/command/stuck/T-1/escalate`,
    ];

    for (const url of mutatingGetUrls) {
      const res = await fetch(`http://127.0.0.1:${port}${url}`);
      expect(res.status).toBe(405);
      const body = await res.json();
      expect(body.code).toBe('METHOD_NOT_ALLOWED');
      expect(body.error).toMatch(/GET NEVER LAUNCHES OR MUTATES/i);
    }
  });

  it('SECURITY: rejects POST with unauthorized Origin', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/command/tasks`, {
      method: 'POST',
      headers: {
        Origin: 'http://malicious-site.com',
        'X-CSRF-Token': activeCsrfToken,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ORIGIN_REFUSED');
  });

  it('SECURITY: rejects POST with invalid or missing CSRF token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/command/tasks`, {
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'X-CSRF-Token': 'bogus-token',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('CSRF_INVALID');
  });

  it('executes full task lifecycle over HTTP: create -> queue -> allocate -> execute -> builder complete -> verify -> accept', async () => {
    const authHeaders = {
      Origin: 'http://127.0.0.1:5173',
      'X-CSRF-Token': activeCsrfToken,
      'Content-Type': 'application/json',
    };

    // 1. Create task
    const createRes = await fetch(`http://127.0.0.1:${port}/api/command/tasks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        task_id: 'TASK-HTTP-1',
        title: 'HTTP Pipeline Task',
        project_id: 'STARQ_ERP',
        repository_url: 'git@github.com:starq/starqERP.git',
        base_sha: '1111111111111111111111111111111111111111',
        task_type: 'FEATURE',
        priority: 'P1_HIGH',
        objective: 'Test complete control-plane HTTP lifecycle',
        boundary_rules: { allowed_paths: ['src/**'], forbidden_paths: [], prohibited_actions: [] },
        acceptance_criteria: ['Passes'],
        verification_requirements: { required_test_commands: ['npm test'], minimum_independence_level: 'INDEPENDENT_INTERNAL_STRONG' },
        risk_level: 'MEDIUM',
        timeout_seconds: 3600,
        founder_approval_required: false,
        builder_seat: 'codex',
        verifier_seat: 'vision',
      }),
    });

    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.task.taskId).toBe('TASK-HTTP-1');
    expect(created.task.state).toBe('CREATED');

    // 2. Transition to QUEUED
    const queueRes = await fetch(`http://127.0.0.1:${port}/api/command/tasks/TASK-HTTP-1/transition`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ nextState: 'QUEUED', actor: 'dispatcher' }),
    });
    expect(queueRes.status).toBe(200);

    // 3. Transition to ALLOCATED
    await fetch(`http://127.0.0.1:${port}/api/command/tasks/TASK-HTTP-1/transition`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        nextState: 'ALLOCATED',
        actor: 'dispatcher',
        updates: { builderSeat: 'codex', baseSha: '1111111111111111111111111111111111111111' },
      }),
    });

    // 4. Transition to EXECUTING
    await fetch(`http://127.0.0.1:${port}/api/command/tasks/TASK-HTTP-1/transition`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ nextState: 'EXECUTING', actor: 'codex' }),
    });

    // 5. Submit Builder Completion
    const candidateSha = '2222222222222222222222222222222222222222';
    const builderRes = await fetch(`http://127.0.0.1:${port}/api/command/tasks/TASK-HTTP-1/builder-completion`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        artifact: {
          schemaVersion: '1.0.0',
          taskId: 'TASK-HTTP-1',
          builderSeat: 'codex',
          baseSha: '1111111111111111111111111111111111111111',
          candidateSha,
          workspacePath: 'D:/starq/.worktrees/TASK-HTTP-1-builder',
          filesChanged: ['src/index.ts'],
          diffStat: { insertions: 10, deletions: 2, filesCount: 1 },
          implementationSummary: 'Implemented feature cleanly with tests',
          testsExecuted: [{ command: 'npm test', exitCode: 0 }],
          knownLimitations: [],
          evidenceReferences: [],
          completedAt: new Date().toISOString(),
        },
      }),
    });
    expect(builderRes.status).toBe(200);
    const builderBody = await builderRes.json();
    expect(builderBody.task.state).toBe('BUILDER_COMPLETE');

    // 6. Transition to VERIFYING
    await fetch(`http://127.0.0.1:${port}/api/command/tasks/TASK-HTTP-1/transition`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ nextState: 'VERIFYING', actor: 'vision' }),
    });

    // 7. Verify: Anti-self-acceptance test (Codex tries to verify own task)
    const selfAcceptRes = await fetch(`http://127.0.0.1:${port}/api/command/tasks/TASK-HTTP-1/verify`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        artifact: {
          schemaVersion: '1.0.0',
          taskId: 'TASK-HTTP-1',
          verifierSeat: 'codex', // Builder trying to self-accept!
          evaluatedSha: candidateSha,
          verificationWorkspace: 'D:/starq/.worktrees/TASK-HTTP-1-verifier',
          independenceClass: 'STRICT_INDEPENDENT',
          commandsExecuted: [{ command: 'npm test', exitCode: 0 }],
          result: 'PASS',
          findings: [],
          remainingRisk: 'LOW',
          verdictNotes: 'Looks good to me',
          verifiedAt: new Date().toISOString(),
        },
      }),
    });
    expect(selfAcceptRes.status).toBe(400);
    const selfAcceptBody = await selfAcceptRes.json();
    expect(selfAcceptBody.error).toMatch(/ANTI-SELF-ACCEPTANCE VIOLATION/i);

    // 8. Legitimate Independent Verification by Vision
    const verifyRes = await fetch(`http://127.0.0.1:${port}/api/command/tasks/TASK-HTTP-1/verify`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        artifact: {
          schemaVersion: '1.0.0',
          taskId: 'TASK-HTTP-1',
          verifierSeat: 'vision',
          evaluatedSha: candidateSha,
          verificationWorkspace: 'D:/starq/.worktrees/TASK-HTTP-1-verifier',
          independenceClass: 'STRICT_INDEPENDENT',
          commandsExecuted: [{ command: 'npm test', exitCode: 0 }],
          result: 'PASS',
          findings: [],
          remainingRisk: 'LOW',
          verdictNotes: 'Independently verified detached candidate SHA',
          verifiedAt: new Date().toISOString(),
        },
      }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.verdict).toBe('ACCEPTED');
    expect(verifyBody.task.state).toBe('ACCEPTED');

    // 9. Verify transition history
    const taskDetailsRes = await fetch(`http://127.0.0.1:${port}/api/command/tasks/TASK-HTTP-1`);
    const details = await taskDetailsRes.json();
    expect(details.history.length).toBeGreaterThanOrEqual(6);
  });

  it('serves fleet, capacity, and stuck endpoints', async () => {
    const fleetRes = await fetch(`http://127.0.0.1:${port}/api/command/fleet`);
    const fleetBody = await fleetRes.json();
    expect(fleetBody.ok).toBe(true);
    expect(fleetBody.fleet.length).toBeGreaterThanOrEqual(10);

    const capRes = await fetch(`http://127.0.0.1:${port}/api/command/capacity`);
    const capBody = await capRes.json();
    expect(capBody.ok).toBe(true);
    expect(capBody.capacity.length).toBeGreaterThanOrEqual(10);

    const stuckRes = await fetch(`http://127.0.0.1:${port}/api/command/stuck`);
    const stuckBody = await stuckRes.json();
    expect(stuckBody.ok).toBe(true);
    expect(Array.isArray(stuckBody.stuckTasks)).toBe(true);
  });
});
