/**
 * P0 D4: PRESERVED, UNREVIEWED. Destination-guard test carried from live
 * Command. Independent review is required before this counts as accepted.
 * Fixture-based checks: never opens, reads, or hashes the canonical Room.
 * Canonical ledger path strings are passed only as arguments to assert the
 * guard refuses them; no canonical path constant is imported from production
 * code. The node:fs module is mocked so canonical-path existsSync/realpathSync
 * calls are stubbed in memory (fail closed); non-canonical paths delegate to
 * the real implementation. Refusal cases are string-only and short-circuit
 * before any filesystem check. Positive case asserts a temp side-ledger append
 * under OS temp only. Coverage note: the symlink-alias refusal case is
 * simulated with test-local stubs (alias existsSync true, alias realpathSync
 * returns the canonical target string); no temp alias file or symlink is
 * created, and the canonical Room is never touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import { RoomEventAdapter } from '../integrations/room/event-adapter.ts';

const CANONICAL_LEDGER = 'D:\\StarqTech\\agent-comms\\room.jsonl';

const CANONICAL_CANDIDATES = [
  CANONICAL_LEDGER,
  path.resolve('D:/StarqTech/agent-comms/room.jsonl'),
  path.resolve(process.cwd(), 'agent-comms', 'room.jsonl'),
  path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'agent-comms', 'room.jsonl'),
].map((p) => path.normalize(path.resolve(p)).toLowerCase());

function isCanonicalPath(p: string): boolean {
  return CANONICAL_CANDIDATES.includes(path.normalize(path.resolve(p)).toLowerCase());
}

// Mutable per-test alias state, read by the mocked fs functions. Cleared after each test.
let aliasPath: string | null = null;
let aliasResolvesToCanonical: boolean | null = null;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      if (isCanonicalPath(p)) return false;
      if (aliasPath && p === aliasPath) return true;
      return actual.existsSync(p);
    }),
    realpathSync: vi.fn((p: string) => {
      if (isCanonicalPath(p)) throw new Error('canonical path must not be resolved');
      if (aliasPath && p === aliasPath) {
        return aliasResolvesToCanonical ? CANONICAL_LEDGER : actual.realpathSync(p);
      }
      return actual.realpathSync(p);
    }),
  };
});

import * as fs from 'node:fs';
import * as os from 'node:os';

function rmTreeRetrySync(dirPath: string, label: string, maxRetries = 20, delayMs = 100): void {
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      // Confirm removal: path should no longer exist. A probe error retries;
      // only a successful existsSync false proves removal.
      let gone = false;
      try { gone = !fs.existsSync(dirPath); } catch { /* probe error - retry */ }
      if (gone) return;
    } catch { /* rmSync error - retry */ }
    const start = Date.now();
    while (Date.now() - start < delayMs) { /* busy wait */ }
  }
  throw new Error(`Cleanup failed: could not remove ${label} at ${dirPath}`);
}

describe('RoomEventAdapter destination guard (fixture-based)', () => {
  beforeEach(() => {
    aliasPath = null;
    aliasResolvesToCanonical = null;
  });

  afterEach(() => {
    aliasPath = null;
    aliasResolvesToCanonical = null;
    vi.restoreAllMocks();
  });

  it('refuses canonical and equivalent Room target strings without touching the canonical Room file', () => {
    // Pass path strings only. These short-circuit on string equality before
    // any filesystem check; the mocked fs guarantees no canonical metadata access.
    const equivalent = path.join(path.dirname(CANONICAL_LEDGER), '..', 'agent-comms', 'room.jsonl');
    const mixedSlashes = CANONICAL_LEDGER.replace(/\\/g, '/');

    expect(() => new RoomEventAdapter({ eventsLedgerPath: CANONICAL_LEDGER }))
      .toThrow(/REFUSED: RoomEventAdapter cannot append the typed side-ledger to canonical Room/);
    expect(() => new RoomEventAdapter({ eventsLedgerPath: equivalent }))
      .toThrow(/REFUSED: RoomEventAdapter cannot append/);
    expect(() => new RoomEventAdapter({ eventsLedgerPath: mixedSlashes }))
      .toThrow(/REFUSED: RoomEventAdapter cannot append/);
  });

  it('refuses a simulated symlink alias of the canonical Room without touching the canonical file', () => {
    // Simulate an alias path whose realpath resolves to the canonical Room.
    // No symlink or temp alias file is created; the mock provides the metadata.
    const aliasDir = path.join(os.tmpdir(), 'cmd-room-adapter-alias');
    aliasPath = path.join(aliasDir, 'alias-room.jsonl');
    aliasResolvesToCanonical = true;
    try {
      expect(() => new RoomEventAdapter({ eventsLedgerPath: aliasPath }))
        .toThrow(/REFUSED: RoomEventAdapter cannot append/);
    } finally {
      aliasPath = null;
      aliasResolvesToCanonical = null;
    }
  });

  it('accepts and appends to a temp side-ledger, never the canonical Room', async () => {
    const sideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-room-adapter-side-'));
    const sideLedger = path.join(sideDir, 'room-events.jsonl');
    try {
      const adapter = new RoomEventAdapter({
        eventsLedgerPath: sideLedger,
        commsScriptPath: path.join(sideDir, 'send-missing.mjs'),
      });
      const envelope = await adapter.emitEvent('TASK_CREATED', {
        taskId: 'T-GUARD',
        sender: 'founder',
        summary: 'side-ledger only',
        broadcastToRoom: false,
      });
      expect(envelope.type).toBe('TASK_CREATED');
      expect(fs.existsSync(sideLedger)).toBe(true);
      expect(fs.readFileSync(sideLedger, 'utf8')).toMatch(/T-GUARD/);
    } finally {
      rmTreeRetrySync(sideDir, 'sideDir');
    }
  });
});
