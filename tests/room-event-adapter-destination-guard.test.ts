/**
 * P0 D4: PRESERVED, UNREVIEWED. Destination-guard test carried from live
 * Command. Independent review is required before this counts as accepted.
 * A4 (OpenCode) owns the D2 fixture rewrite so this form must not hash the
 * canonical Room when the suite runs.
 */
import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CANONICAL_ROOM_LEDGER,
  RoomEventAdapter,
} from '../integrations/room/event-adapter.ts';

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let read = 0;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

describe('RoomEventAdapter destination guard', () => {
  it('refuses canonical and equivalent Room targets before any write; temp side-ledger still appends', async () => {
    expect(fs.existsSync(CANONICAL_ROOM_LEDGER)).toBe(true);
    const roomSizeBefore = fs.statSync(CANONICAL_ROOM_LEDGER).size;
    const roomShaBefore = sha256File(CANONICAL_ROOM_LEDGER);

    const equivalent = path.join(path.dirname(CANONICAL_ROOM_LEDGER), '..', 'agent-comms', 'room.jsonl');
    const mixedSlashes = CANONICAL_ROOM_LEDGER.replace(/\\/g, '/');

    expect(() => new RoomEventAdapter({ eventsLedgerPath: CANONICAL_ROOM_LEDGER }))
      .toThrow(/REFUSED: RoomEventAdapter cannot append the typed side-ledger to canonical Room/);
    expect(() => new RoomEventAdapter({ eventsLedgerPath: equivalent }))
      .toThrow(/REFUSED: RoomEventAdapter cannot append/);
    expect(() => new RoomEventAdapter({ eventsLedgerPath: mixedSlashes }))
      .toThrow(/REFUSED: RoomEventAdapter cannot append/);

    let symlinkCaseTestable = false;
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-room-adapter-link-'));
    const linkPath = path.join(linkDir, 'alias-room.jsonl');
    try {
      fs.symlinkSync(CANONICAL_ROOM_LEDGER, linkPath);
      symlinkCaseTestable = true;
      expect(() => new RoomEventAdapter({ eventsLedgerPath: linkPath }))
        .toThrow(/REFUSED: RoomEventAdapter cannot append/);
    } catch (error) {
      if (symlinkCaseTestable) throw error;
    } finally {
      try { fs.rmSync(linkDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

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
      fs.rmSync(sideDir, { recursive: true, force: true });
    }

    expect(fs.statSync(CANONICAL_ROOM_LEDGER).size).toBe(roomSizeBefore);
    expect(sha256File(CANONICAL_ROOM_LEDGER)).toBe(roomShaBefore);
    if (!symlinkCaseTestable) {
      console.warn('SKIPPED: symlink creation unavailable');
    }
  });
});
