/**
 * Room Typed Lifecycle Event Adapter
 * Starq Command Architecture Doctrine Section 18 & Requirement 5H
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { type RoomEventEnvelope, type RoomEventType } from '../../src/schemas/room-event.ts';
import { resolveExternalComponent } from '../../server/external-components.mjs';
import { resolveWorkspace } from '../../server/paths.mjs';

const agentComms = resolveExternalComponent('agent-comms');
const workspaceRoot = resolveWorkspace().root;
export const CANONICAL_ROOM_LEDGER = agentComms.root
  ? path.join(agentComms.root, 'room.jsonl')
  : workspaceRoot
    ? path.join(workspaceRoot, 'agent-comms', 'room.jsonl')
    : path.resolve(process.cwd(), 'agent-comms', 'room.jsonl');

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
  const candidates = [CANONICAL_ROOM_LEDGER, path.resolve(process.cwd(), 'agent-comms', 'room.jsonl')];
  if (workspaceRoot) candidates.push(path.join(workspaceRoot, 'agent-comms', 'room.jsonl'));
  if (agentComms.root) candidates.push(path.join(agentComms.root, 'room.jsonl'));
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
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
  private instanceId?: string;

  constructor(options?: { eventsLedgerPath?: string; commsScriptPath?: string; instanceId?: string }) {
    this.eventsLedgerPath = assertEventsLedgerIsNotCanonicalRoom(
      options?.eventsLedgerPath ||
      path.resolve(process.cwd(), 'agent-comms', 'room-events.jsonl'),
    );
    this.commsScriptPath =
      options?.commsScriptPath ||
      path.resolve(process.cwd(), 'agent-comms', 'scripts', 'send.mjs');
    this.instanceId = options?.instanceId;

    const dir = path.dirname(this.eventsLedgerPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  public requiredRoomDeliveryReady(): boolean {
    return Boolean(this.instanceId && fs.existsSync(this.commsScriptPath));
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
      recipient?: string;
      subject?: string;
      actionRequired?: string;
      requiredRoomDelivery?: boolean;
    }
  ): Promise<RoomEventEnvelope> {
    const envelope: RoomEventEnvelope = {
      type,
      taskId: params.taskId,
      sender: params.sender,
      timestamp: new Date().toISOString(),
      summary: params.summary,
      payload: { ...(params.payload || {}), ...(params.recipient ? { recipient: params.recipient } : {}) },
    };

    // 1. Validate required Room configuration before recording local activity.
    if (params.requiredRoomDelivery && !params.broadcastToRoom) {
      throw new Error('Required Room delivery must enable broadcastToRoom.');
    }
    if (params.broadcastToRoom && params.requiredRoomDelivery && !fs.existsSync(this.commsScriptPath)) {
      throw new Error(`Required Room delivery script is missing: ${this.commsScriptPath}`);
    }
    if (params.broadcastToRoom && params.requiredRoomDelivery && !this.instanceId) {
      throw new Error('Required Room delivery needs an explicit stable Room writer instance id.');
    }

    // 2. Broadcast before persisting the typed side-ledger. Required activity
    // is not represented locally as recorded unless Room confirms a sequence.
    if (params.broadcastToRoom && !this.instanceId) {
      envelope.room_ref = { status: 'UNCONFIRMED', reason: 'No stable Room writer instance is configured.' };
    } else if (params.broadcastToRoom && !fs.existsSync(this.commsScriptPath)) {
      envelope.room_ref = { status: 'UNCONFIRMED', reason: 'Room delivery script is missing.' };
    } else if (params.broadcastToRoom) {
      const roomBody = this.formatRoomBody(envelope, params.recipient, params.actionRequired);
      const result = await this.postViaSendScript(params.sender, roomBody, params.taskId, {
        subject: params.subject ?? `[${type}] ${params.summary}`,
        actionRequired: params.actionRequired ?? 'NONE',
        instanceId: this.instanceId!,
        required: params.requiredRoomDelivery === true,
      });
      envelope.room_ref = result.sequence
        ? { sequence: result.sequence, status: 'POSTED' }
        : { status: 'UNCONFIRMED', reason: result.stdout || 'send.mjs did not report a Room sequence.' };
      if (params.requiredRoomDelivery && !result.sequence) {
        throw new Error('Required Room delivery was not confirmed: send.mjs did not report a Room sequence.');
      }
    }

    // 3. Persist the final envelope, including the confirmed Room reference.
    // The side-ledger remains distinct from canonical Room and is never a
    // substitute for a required Room delivery.
    assertEventsLedgerIsNotCanonicalRoom(this.eventsLedgerPath);
    try {
      fs.appendFileSync(
        this.eventsLedgerPath,
        JSON.stringify(envelope) + '\n',
        'utf8'
      );
    } catch (error) {
      if (envelope.room_ref?.status === 'POSTED') {
        throw new Error(
          `Room record #${envelope.room_ref.sequence} was confirmed, but typed side-ledger persistence failed: ${(error as Error).message}`,
        );
      }
      throw error;
    }

    return envelope;
  }

  /**
   * Format structured event for Room
   */
  public formatRoomBody(envelope: RoomEventEnvelope, recipient?: string, actionRequired?: string): string {
    const lines = [
      `[CONTROL-PLANE // ${envelope.type}]`,
      recipient ? `@${recipient}` : '',
      envelope.taskId ? `Task: ${envelope.taskId}` : '',
      `Summary: ${envelope.summary}`,
      actionRequired && actionRequired !== 'NONE' ? `Action required: ${actionRequired}` : '',
    ].filter(Boolean);

    if (Object.keys(envelope.payload).length > 0) {
      lines.push(`Payload: ${JSON.stringify(envelope.payload)}`);
    }

    return lines.join('\n');
  }

  private postViaSendScript(sender: string, body: string, taskId: string | undefined, options: {
    subject: string; actionRequired: string; instanceId: string; required: boolean;
  }): Promise<{ stdout: string; sequence: number | null }> {
    return new Promise((resolve, reject) => {
      const args = [
        this.commsScriptPath,
        '--from',
        sender,
        '--instance',
        options.instanceId,
        '--room',
        '--subject',
        options.subject,
        '--action-required',
        options.actionRequired,
        '--body',
        body,
      ];
      if (taskId) {
        args.push('--task', taskId);
      }

      execFile('node', args, { timeout: 15000 }, (error, stdout = '') => {
        const sequence = /Room Record\s+#(\d+)\s+posted/i.exec(stdout)?.[1]
          ?? /Record\s+#(\d+)\s+posted/i.exec(stdout)?.[1];
        if (error) {
          console.warn(`[RoomEventAdapter] Room broadcast warning: ${error.message}`);
          // A confirmed sequence proves the append completed even if send.mjs
          // later failed while writing its local receipt. Preserve that proof
          // so a caller does not blindly repeat an already-posted event.
          if (options.required && !sequence) {
            reject(new Error(`Required Room delivery failed: ${error.message}`));
            return;
          }
        }
        resolve({ stdout, sequence: sequence ? Number(sequence) : null });
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
