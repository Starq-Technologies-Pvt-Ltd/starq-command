import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { server } from '../server/data-service.mjs';
import { computeStaffGlanceCounts } from '../server/floor.mjs';

const FILTER_TOKENS = {
  working: ['WORKING', 'Working'],
  idle: ['IDLE', 'Idle'],
  blocked: ['BLOCKED', 'Blocked'],
  awaiting_review: ['AWAITING_REVIEW', 'Awaiting review', 'AWAITING REVIEW'],
  unavailable: ['UNAVAILABLE', 'Unavailable'],
} as const;

function matchesAny(entry: Record<string, unknown>, tokens: readonly string[]) {
  return [entry.duty_state, entry.current_state].some(
    (value) => typeof value === 'string' && tokens.includes(value.trim()),
  );
}

async function getFloorWithoutListening(workspaceRoot: string) {
  const previousWorkspace = process.env.STARQ_WORKSPACE;
  process.env.STARQ_WORKSPACE = workspaceRoot;
  return new Promise<{ status: number; body: string }>((resolve) => {
    const request = {
      method: 'GET',
      url: '/api/floor',
      headers: { host: '127.0.0.1' },
    };
    const response = {
      status: 0,
      writeHead(status: number) {
        this.status = status;
        return this;
      },
      end(body = '') {
        resolve({ status: this.status, body: String(body) });
        return this;
      },
    };

    // Exercise the actual GET route handler without binding a port or starting
    // the data service.
    server.emit('request', request as never, response as never);
  }).finally(() => {
    if (previousWorkspace === undefined) delete process.env.STARQ_WORKSPACE;
    else process.env.STARQ_WORKSPACE = previousWorkspace;
  });
}

function makeTemporaryRoot(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeTemporaryRoot(root: string) {
  const relativeRoot = relative(resolve(tmpdir()), resolve(root));
  if (
    !relativeRoot ||
    relativeRoot === '..' ||
    relativeRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(relativeRoot)
  ) {
    throw new Error(`Refusing to remove a test root outside the temp directory: ${root}`);
  }
  rmSync(root, { recursive: true, force: true });
}

function makeWorkspaceFixture(
  agents: unknown,
  staffEntries: Record<string, Record<string, unknown>> = {},
) {
  const root = makeTemporaryRoot('starq-command-floor-api-');
  const controlBoard = join(root, '00_STARQ_HQ', 'operations', 'starqerp-control-board');
  const protocol = join(root, 'agent-comms', 'protocol', 'v1');
  mkdirSync(controlBoard, { recursive: true });
  mkdirSync(protocol, { recursive: true });
  writeFileSync(join(root, 'STARQ.md'), 'temporary API test workspace\n');
  const activity: Record<string, unknown> = { activity_events: [], activity_ledger: {} };
  if (agents !== undefined) activity.agents = agents;
  writeFileSync(join(controlBoard, 'activity.json'), JSON.stringify(activity));
  writeFileSync(join(protocol, 'staff-state.json'), JSON.stringify({ entries: staffEntries }));
  // A readable empty ledger keeps the execution source available for the
  // source-confirmed empty-roster case.
  writeFileSync(join(root, 'agent-comms', 'room.jsonl'), '');
  return root;
}

describe('CMD-DI-3-1 · GET /api/floor staff glance counts', () => {
  it('publishes populated non-negative buckets matching exact roster filters', async () => {
    expect(server.listening).toBe(false);
    const root = makeWorkspaceFixture(
      [
        { handle: 'worker-working', current_state: 'WORKING' },
        { handle: 'worker-idle', current_state: 'IDLE' },
        { handle: 'worker-blocked', current_state: 'BLOCKED' },
        { handle: 'worker-review', current_state: 'AWAITING_REVIEW' },
        { handle: 'worker-unavailable', current_state: 'UNAVAILABLE' },
        { handle: 'worker-unknown', current_state: 'OFFLINE' },
        { handle: 'worker-disagreement', current_state: 'Working' },
      ],
      { 'worker-disagreement': { duty_state: 'BLOCKED' } },
    );
    try {
      const response = await getFloorWithoutListening(root);
      expect(response.status).toBe(200);

      const payload = JSON.parse(response.body) as {
        floor: {
          execution_projection: { state: string };
          roster: { entries: Array<Record<string, unknown>> };
          staff_glance_counts?: Record<string, unknown>;
        };
      };
      expect(payload.floor.execution_projection.state).toBe('OK');
      const entries = payload.floor.roster.entries;
      const buckets = payload.floor.staff_glance_counts;
      expect(buckets).toBeTruthy();
      expect(Object.keys(buckets!).sort()).toEqual([
        'awaiting_review',
        'blocked',
        'idle',
        'unavailable',
        'unknown',
        'working',
      ]);

      const expected: Record<string, number> = {};
      for (const [key, tokens] of Object.entries(FILTER_TOKENS)) {
        expected[key] = entries.filter((entry) => matchesAny(entry, tokens)).length;
      }
      expected.unknown = entries.filter(
        (entry) => !Object.values(FILTER_TOKENS).some((tokens) => matchesAny(entry, tokens)),
      ).length;
      expect(buckets).toEqual(expected);
      expect(buckets).toEqual({
        working: 2,
        idle: 1,
        blocked: 2,
        awaiting_review: 1,
        unavailable: 1,
        unknown: 1,
      });
      for (const count of Object.values(buckets!)) {
        expect(typeof count).toBe('number');
        expect(Number.isInteger(count)).toBe(true);
        expect(count as number).toBeGreaterThanOrEqual(0);
      }
      expect(server.listening).toBe(false);
    } finally {
      removeTemporaryRoot(root);
    }
  });

  it('does not publish measured-zero buckets when the workspace source is unavailable', async () => {
    expect(server.listening).toBe(false);
    const invalidRoot = makeTemporaryRoot('starq-command-floor-invalid-');
    try {
      const response = await getFloorWithoutListening(invalidRoot);
      expect(response.status).toBe(200);

      const payload = JSON.parse(response.body) as {
        floor: {
          execution_projection: { state: string };
          staff_glance_counts?: Record<string, unknown>;
        };
      };
      expect(payload.floor.execution_projection.state).toBe('UNAVAILABLE');
      expect(Object.hasOwn(payload.floor, 'staff_glance_counts')).toBe(false);
      expect(server.listening).toBe(false);
    } finally {
      removeTemporaryRoot(invalidRoot);
    }
  });

  it('does not publish measured-zero buckets when activity.json omits agents', async () => {
    expect(server.listening).toBe(false);
    const root = makeWorkspaceFixture(undefined);
    try {
      const response = await getFloorWithoutListening(root);
      expect(response.status).toBe(200);

      const payload = JSON.parse(response.body) as {
        floor: {
          execution_projection: { state: string };
          staff_glance_counts?: Record<string, unknown>;
        };
      };
      expect(payload.floor.execution_projection.state).toBe('OK');
      expect(Object.hasOwn(payload.floor, 'staff_glance_counts')).toBe(false);
      expect(server.listening).toBe(false);
    } finally {
      removeTemporaryRoot(root);
    }
  });

  it('does not publish measured-zero buckets when activity.json agents is not an array', async () => {
    expect(server.listening).toBe(false);
    const root = makeWorkspaceFixture({ malformed: true });
    try {
      const response = await getFloorWithoutListening(root);
      expect(response.status).toBe(200);

      const payload = JSON.parse(response.body) as {
        floor: {
          execution_projection: { state: string };
          staff_glance_counts?: Record<string, unknown>;
        };
      };
      expect(payload.floor.execution_projection.state).toBe('OK');
      expect(Object.hasOwn(payload.floor, 'staff_glance_counts')).toBe(false);
      expect(server.listening).toBe(false);
    } finally {
      removeTemporaryRoot(root);
    }
  });

  it('keeps numeric zeroes for a source-confirmed empty roster', async () => {
    expect(server.listening).toBe(false);
    const root = makeWorkspaceFixture([]);
    try {
      const response = await getFloorWithoutListening(root);
      expect(response.status).toBe(200);

      const payload = JSON.parse(response.body) as {
        floor: {
          execution_projection: { state: string };
          roster: { entries: Array<Record<string, unknown>> };
          staff_glance_counts?: Record<string, unknown>;
        };
      };
      expect(payload.floor.execution_projection.state).toBe('OK');
      expect(payload.floor.roster.entries).toEqual([]);
      expect(payload.floor.staff_glance_counts).toEqual({
        working: 0,
        idle: 0,
        blocked: 0,
        awaiting_review: 0,
        unavailable: 0,
        unknown: 0,
      });
      expect(server.listening).toBe(false);
    } finally {
      removeTemporaryRoot(root);
    }
  });

  it('keeps disagreement and unmapped source values explicit instead of inferring', () => {
    expect(
      computeStaffGlanceCounts([
        { duty_state: 'WORKING', current_state: 'UNKNOWN' },
        { duty_state: 'BLOCKED', current_state: 'Working' },
        { duty_state: 'IDLE', current_state: 'UNKNOWN' },
        { duty_state: 'OFFLINE', current_state: '' },
        { duty_state: '', current_state: '' },
        { duty_state: 'Awaiting review', current_state: 'UNAVAILABLE' },
      ]),
    ).toEqual({
      working: 2,
      idle: 1,
      blocked: 1,
      awaiting_review: 1,
      unavailable: 1,
      unknown: 2,
    });
  });
});
