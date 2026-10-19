/**
 * Room Typed Lifecycle Event Adapter
 * Starq Command Architecture Doctrine Section 18 & Requirement 5H
 *
 * P0 D4: PRESERVED, UNREVIEWED. Carried from live Command as protective
 * destination-guard code. Independent review is required before this counts
 * as accepted. Do not treat overlay as authorization or acceptance.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type RoomEventEnvelope, type RoomEventType } from '../../src/schemas/room-event.ts';

const ADAPTER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CANONICAL_ROOM_LEDGER = path.resolve('D:\\StarqTech\\agent-comms\\room.jsonl');

function sameFilesystemPath(left: string, right: string): boolean {
  const a = path.normalize(path.resolve(left));
  const b = path.normalize(path.resolve(right));
  const fold = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);
  if (fold(a) === fold(b)) return true;
  try {
    if (fs.existsSync(a) && fs.existsSync(b)) {
      return fold(fs.realpathSync(a)) === fold(fs.realpathSync(b));
    }
    if (fs.existsSync(a) && !fs.existsSync(b)) {
      return fold(fs.realpathSync(a)) === fold(b);
    }
    if (!fs.existsSync(a) && fs.existsSync(b)) {
      return fold(a) === fold(fs.realpathSync(b));
    }
  } catch {
    /* compare resolved strings only */
  }
  return false;
}

export function canonicalRoomLedgerPaths(): string[] {
  return [
    CANONICAL_ROOM_LEDGER,
    path.resolve('D:/StarqTech/agent-comms/room.jsonl'),
    path.resolve(process.cwd(), 'agent-comms', 'room.jsonl'),
    path.resolve(ADAPTER_DIR, '..', '..', '..', '..', '..', 'agent-comms', 'room.jsonl'),
  ];
}

export function assertEventsLedgerIsNotCanonicalRoom(eventsLedgerPath: string): string {
  const resolved = path.resolve(eventsLedgerPath);
  if (canonicalRoomLedgerPaths().some((candidate) => sameFilesystemPath(resolved, candidate))) {
    throw new Error(
      'REFUSED: RoomEventAdapter cannot append the typed side-ledger to canonical Room '
      + '(agent-comms/room.jsonl), including normalized, resolved, or symlink-equivalent paths. '
      + 'Use agent-comms/room-events.jsonl and broadcast via send.mjs.',
    );
  }
  return resolved;
}

/**
 * The result of reading the typed events ledger.
 *
 * COM-GAP-009. This is a discriminated union rather than a bare array because a
 * bare array cannot distinguish "the ledger is empty" from "there is no
 * ledger". Those are different facts and the old code conflated them: an absent
 * file returned `[]`, the service answered `200 {ok:true, events:[]}`, and a
 * consumer read that as a healthy feed with nothing in it. That is a
 * FALSE-EMPTY — a successful-looking answer to a question that was never asked
 * of anything.
 *
 * It matters more than usual here, because `eventsLedgerPath` defaults to a
 * path that does not exist and never has: this adapter writes and reads
 * `agent-comms/room-events.jsonl`, a Command-local typed-events side ledger,
 * while the canonical communication record is `agent-comms/room.jsonl` (see
 * `server/paths.mjs` CANONICAL.roomLedger). So the absent case is not
 * hypothetical, it is the DEFAULT case on a clean tree. A caller asking this
 * adapter for the Room's messages was never getting them, and was being told
 * `ok:true` when it asked.
 *
 * `skipped_malformed` closes the second silent-drop in this same function: a
 * ledger line that fails to parse used to vanish with no trace, so a corrupted
 * or truncated file reported a short, confident, entirely fabricated history.
 * Silent loss and false-empty are the same defect wearing different clothes,
 * and they are fixed together.
 */
export type RoomEventsRead =
  | {
      ok: true;
      state: 'OK';
      events: RoomEventEnvelope[];
      /** Physical non-empty lines in the ledger, before filtering. */
      total_lines: number;
      /** Lines that could not be parsed. Non-zero means the file is damaged. */
      skipped_malformed: number;
    }
  | {
      ok: false;
      state: 'UNAVAILABLE';
      reason: string;
      /** Named in the error so the caller is told WHICH source is missing. */
      path: string;
    };

export class RoomEventAdapter {
  private eventsLedgerPath: string;
  private commsScriptPath: string;

  constructor(options?: { eventsLedgerPath?: string; commsScriptPath?: string }) {
    this.eventsLedgerPath = assertEventsLedgerIsNotCanonicalRoom(
      options?.eventsLedgerPath ||
      path.resolve(process.cwd(), 'agent-comms', 'room-events.jsonl'),
    );
    this.commsScriptPath =
      options?.commsScriptPath ||
      path.resolve(process.cwd(), 'agent-comms', 'scripts', 'send.mjs');

    const dir = path.dirname(this.eventsLedgerPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Post a structured typed event to both the append-only typed events ledger
   * and optionally broadcast to the live Room ledger via send.mjs.
   */
  public async emitEvent(
    type: RoomEventType,
    params: {
      taskId?: string;
      sender: string;
      summary: string;
      payload?: Record<string, unknown>;
      broadcastToRoom?: boolean;
    }
  ): Promise<RoomEventEnvelope> {
    const envelope: RoomEventEnvelope = {
      type,
      taskId: params.taskId,
      sender: params.sender,
      timestamp: new Date().toISOString(),
      summary: params.summary,
      payload: params.payload || {},
    };

    // 1. Append to typed events JSONL — never the canonical Room ledger.
    assertEventsLedgerIsNotCanonicalRoom(this.eventsLedgerPath);
    fs.appendFileSync(
      this.eventsLedgerPath,
      JSON.stringify(envelope) + '\n',
      'utf8'
    );

    // 2. Broadcast to live Room if requested
    if (params.broadcastToRoom && fs.existsSync(this.commsScriptPath)) {
      const roomBody = this.formatRoomBody(envelope);
      await this.postViaSendScript(params.sender, roomBody, params.taskId);
    }

    return envelope;
  }

  /**
   * Format structured event for Room
   */
  public formatRoomBody(envelope: RoomEventEnvelope): string {
    const lines = [
      `[CONTROL-PLANE // ${envelope.type}]`,
      envelope.taskId ? `Task: ${envelope.taskId}` : '',
      `Summary: ${envelope.summary}`,
    ].filter(Boolean);

    if (Object.keys(envelope.payload).length > 0) {
      lines.push(`Payload: ${JSON.stringify(envelope.payload)}`);
    }

    return lines.join('\n');
  }

  private postViaSendScript(sender: string, body: string, taskId?: string): Promise<void> {
    return new Promise((resolve) => {
      const args = [
        this.commsScriptPath,
        '--from',
        sender,
        '--instance',
        `${sender}-control-plane`,
        '--room',
        '--body',
        body,
      ];
      if (taskId) {
        args.push('--task', taskId);
      }

      execFile('node', args, { timeout: 15000 }, (error) => {
        // We log but don't blow up if send.mjs fails (e.g. during test run or mock environment)
        if (error) {
          console.warn(`[RoomEventAdapter] Room broadcast warning: ${error.message}`);
        }
        resolve();
      });
    });
  }

  /**
   * Read the typed events ledger, honestly.
   *
   * Fails LOUD and SPECIFIC when the source cannot be read. It never returns an
   * empty list to mean "unavailable", because an empty list is a claim.
   */
  public readEvents(filter?: { taskId?: string; type?: RoomEventType }): RoomEventsRead {
    if (!fs.existsSync(this.eventsLedgerPath)) {
      return {
        ok: false,
        state: 'UNAVAILABLE',
        reason:
          'the typed events ledger does not exist at the configured path, so no events can be read. ' +
          'This is an absent source, NOT an empty ledger. Note this adapter reads and writes ' +
          '`agent-comms/room-events.jsonl`; the canonical communication record is ' +
          '`agent-comms/room.jsonl`, and this adapter does not read that.',
        path: this.eventsLedgerPath,
      };
    }

    let raw: string;
    try {
      raw = fs.readFileSync(this.eventsLedgerPath, 'utf8');
    } catch (err) {
      // Present but unreadable is a different failure from absent, and is
      // reported as such rather than collapsing into the empty case.
      return {
        ok: false,
        state: 'UNAVAILABLE',
        reason: `the typed events ledger exists but could not be read: ${(err as Error).message}`,
        path: this.eventsLedgerPath,
      };
    }

    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    const results: RoomEventEnvelope[] = [];
    let skippedMalformed = 0;

    for (const line of lines) {
      try {
        const env: RoomEventEnvelope = JSON.parse(line);
        if (filter?.taskId && env.taskId !== filter.taskId) continue;
        if (filter?.type && env.type !== filter.type) continue;
        results.push(env);
      } catch {
        // Counted, not discarded. The count travels with the result so a damaged
        // file cannot masquerade as a complete one.
        skippedMalformed += 1;
      }
    }

    return {
      ok: true,
      state: 'OK',
      events: results,
      total_lines: lines.length,
      skipped_malformed: skippedMalformed,
    };
  }
}
