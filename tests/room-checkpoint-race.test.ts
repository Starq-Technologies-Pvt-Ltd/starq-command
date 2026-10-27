import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyRoomLedgerRelation, LEDGER_RELATION } from '../server/room-ledger-relation.mjs';
import { readRoomBoundSnapshot, readRoomRawPrefix } from '../../../../agent-comms/scripts/room.mjs';

function rec(seq: number, eventId: string) {
  return { brokerSequence: seq, eventId };
}

const PROVEN = { proven: true, byteLength: 1, reason: null };
const NOT_PROVEN = { proven: false, byteLength: null, reason: 'raw prefix digest does not match the recorded digest' };

describe('Room checkpoint race — valid append vs integrity failure', () => {
  const checkpoint = {
    recordedHash: 'aaaaaaaaaaaaaaaa',
    liveHash: 'bbbbbbbbbbbbbbbb',
    recordedCount: 2,
    recordedSeq: 2,
    lastEventId: 'evt-2',
    liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-2')],
    liveTailSequence: 2,
    rawPrefix: PROVEN,
  };

  it('treats a proven append after a verified checkpoint as non-blocking lag (startup window)', () => {
    const result = classifyRoomLedgerRelation({
      ...checkpoint,
      liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-2'), rec(3, 'evt-3')],
      liveTailSequence: 3,
    });
    expect(result.relation).toBe(LEDGER_RELATION.PREFIX_EXTENSION);
    expect(result.blocking).toBe(false);
    expect(result.healthState).toBe('OK');
    expect(result.lag).toBe(true);
  });

  it('keeps an exact hash match as OK with no lag', () => {
    const result = classifyRoomLedgerRelation({ ...checkpoint, liveHash: checkpoint.recordedHash });
    expect(result.relation).toBe(LEDGER_RELATION.MATCH);
    expect(result.blocking).toBe(false);
    expect(result.lag).toBe(false);
    expect(result.healthState).toBe('OK');
  });

  it('blocks truncated (non-prefix) Room state', () => {
    const result = classifyRoomLedgerRelation({ ...checkpoint, liveRecords: [rec(1, 'evt-1')], liveTailSequence: 1 });
    expect(result.relation).toBe(LEDGER_RELATION.TRUNCATED);
    expect(result.blocking).toBe(true);
    expect(result.healthState).toBe('UNREADABLE');
  });

  it('blocks a missing checkpoint eventId', () => {
    const result = classifyRoomLedgerRelation({
      ...checkpoint,
      liveRecords: [rec(1, 'evt-1'), rec(2, 'other'), rec(3, 'evt-3')],
      liveTailSequence: 3,
    });
    expect(result.relation).toBe(LEDGER_RELATION.CHECKPOINT_MISSING);
    expect(result.blocking).toBe(true);
  });

  it('blocks rewritten history when the raw prefix is not reproduced, whatever the sequences', () => {
    const result = classifyRoomLedgerRelation({
      ...checkpoint,
      liveRecords: [rec(1, 'evt-1'), rec(9, 'evt-2'), rec(10, 'evt-3')],
      liveTailSequence: 10,
      rawPrefix: NOT_PROVEN,
    });
    expect(result.relation).toBe(LEDGER_RELATION.NON_PREFIX);
    expect(result.blocking).toBe(true);
  });

  it('blocks epoch mismatch even when the raw prefix is proven', () => {
    const result = classifyRoomLedgerRelation({
      ...checkpoint,
      liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-2'), rec(3, 'evt-3')],
      recordedEpoch: 'epoch-a',
      liveEpoch: 'epoch-b',
    });
    expect(result.relation).toBe(LEDGER_RELATION.EPOCH_MISMATCH);
    expect(result.blocking).toBe(true);
    expect(result.healthState).toBe('UNREADABLE');
  });
});

describe('exact hash equality requires consistent checkpoint metadata', () => {
  const base = {
    recordedHash: 'aaaaaaaaaaaaaaaa',
    liveHash: 'aaaaaaaaaaaaaaaa',
    recordedCount: 2,
    recordedSeq: 2,
    lastEventId: 'evt-2',
    liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-2')],
    liveTailSequence: 2,
  };

  it('blocks an equal hash when the checkpoint eventId is absent', () => {
    const result = classifyRoomLedgerRelation({ ...base, lastEventId: null });
    expect(result.relation).toBe(LEDGER_RELATION.UNREADABLE);
    expect(result.blocking).toBe(true);
    expect(result.healthState).toBe('STALE');
  });

  it('blocks an equal hash when the checkpoint eventId is not in the live Room', () => {
    const result = classifyRoomLedgerRelation({ ...base, lastEventId: 'evt-missing' });
    expect(result.relation).toBe(LEDGER_RELATION.CHECKPOINT_MISSING);
    expect(result.blocking).toBe(true);
  });

  it('blocks an equal hash when the checkpoint eventId sits beyond the checkpointed prefix', () => {
    const result = classifyRoomLedgerRelation({
      ...base,
      liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-x'), rec(3, 'evt-2')],
      liveTailSequence: 3,
    });
    expect(result.relation).toBe(LEDGER_RELATION.CHECKPOINT_MISSING);
    expect(result.blocking).toBe(true);
  });

  it('blocks an equal hash when the recorded sequence is malformed', () => {
    const result = classifyRoomLedgerRelation({ ...base, recordedSeq: null });
    expect(result.relation).toBe(LEDGER_RELATION.UNREADABLE);
    expect(result.blocking).toBe(true);
  });

  it('blocks an equal hash when the recorded count is malformed', () => {
    const result = classifyRoomLedgerRelation({ ...base, recordedCount: '2' as unknown as number });
    expect(result.relation).toBe(LEDGER_RELATION.UNREADABLE);
    expect(result.blocking).toBe(true);
  });

  it('blocks an equal hash when live records are unavailable', () => {
    const result = classifyRoomLedgerRelation({ ...base, liveRecords: null });
    expect(result.relation).toBe(LEDGER_RELATION.UNREADABLE);
    expect(result.blocking).toBe(true);
  });

  it('blocks an equal hash when live records extend beyond the checkpoint count', () => {
    const result = classifyRoomLedgerRelation({
      ...base,
      liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-2'), rec(3, 'evt-3')],
      liveTailSequence: 3,
    });
    expect(result.relation).toBe(LEDGER_RELATION.UNREADABLE);
    expect(result.blocking).toBe(true);
  });

  it('still returns MATCH for an equal hash with consistent checkpoint metadata', () => {
    const result = classifyRoomLedgerRelation(base);
    expect(result.relation).toBe(LEDGER_RELATION.MATCH);
    expect(result.blocking).toBe(false);
    expect(result.healthState).toBe('OK');
  });
});

describe('hash mismatch requires a proven raw byte prefix', () => {
  const mismatch = {
    recordedHash: 'aaaaaaaaaaaaaaaa',
    liveHash: 'bbbbbbbbbbbbbbbb',
    recordedCount: 2,
    recordedSeq: 2,
    lastEventId: 'evt-2',
    liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-2'), rec(3, 'evt-3')],
    liveTailSequence: 3,
    rawPrefix: PROVEN,
  };

  it('blocks when recordedSeq is malformed', () => {
    const result = classifyRoomLedgerRelation({ ...mismatch, recordedSeq: null });
    expect(result.relation).toBe(LEDGER_RELATION.UNREADABLE);
    expect(result.blocking).toBe(true);
  });

  it('blocks when recordedCount is malformed', () => {
    const result = classifyRoomLedgerRelation({ ...mismatch, recordedCount: '2' as unknown as number });
    expect(result.relation).toBe(LEDGER_RELATION.UNREADABLE);
    expect(result.blocking).toBe(true);
  });

  it('blocks when no raw prefix proof is supplied', () => {
    const { rawPrefix: _omit, ...withoutProof } = mismatch;
    const result = classifyRoomLedgerRelation(withoutProof);
    expect(result.relation).toBe(LEDGER_RELATION.UNREADABLE);
    expect(result.blocking).toBe(true);
  });

  it('blocks changed prior bytes (raw prefix not proven) with a valid-looking suffix', () => {
    const result = classifyRoomLedgerRelation({ ...mismatch, rawPrefix: NOT_PROVEN });
    expect(result.relation).toBe(LEDGER_RELATION.NON_PREFIX);
    expect(result.blocking).toBe(true);
  });

  it('blocks a changed hash with no appended records', () => {
    const result = classifyRoomLedgerRelation({ ...mismatch, liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-2')], liveTailSequence: 2 });
    expect(result.relation).toBe(LEDGER_RELATION.UNREADABLE);
    expect(result.blocking).toBe(true);
    expect(result.healthState).toBe('STALE');
  });

  it('blocks an appended record that lacks an eventId', () => {
    const result = classifyRoomLedgerRelation({ ...mismatch, liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-2'), { brokerSequence: 3 }] });
    expect(result.relation).toBe(LEDGER_RELATION.NON_PREFIX);
    expect(result.blocking).toBe(true);
  });

  it('permits an appended record whose brokerSequence collides with an earlier one', () => {
    const result = classifyRoomLedgerRelation({
      ...mismatch,
      liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-2'), rec(2, 'evt-3')],
      liveTailSequence: 2,
    });
    expect(result.relation).toBe(LEDGER_RELATION.PREFIX_EXTENSION);
    expect(result.blocking).toBe(false);
  });
});

describe('raw prefix proof on real ledger bytes', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function fixture(content: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-raw-prefix-'));
    dirs.push(dir);
    const roomPath = path.join(dir, 'room.jsonl');
    fs.writeFileSync(roomPath, content);
    return roomPath;
  }
  const line = (seq: number, eventId: string) => JSON.stringify(rec(seq, eventId));
  const digestOf = (text: string) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

  it('proves a valid append and classifies it as PREFIX_EXTENSION', () => {
    const first = line(1, 'evt-1');
    const roomPath = fixture(`${first}\n${line(2, 'evt-2')}\n`);
    const proof = readRoomRawPrefix({ roomPath, recordCount: 1, expectedSha16: digestOf(first) });
    expect(proof.proven).toBe(true);
    expect(proof.byteLength).toBeGreaterThan(0);
    const result = classifyRoomLedgerRelation({
      recordedHash: digestOf(first),
      liveHash: 'ffffffffffffffff',
      liveRecords: [rec(1, 'evt-1'), rec(2, 'evt-2')],
      liveTailSequence: 2,
      recordedCount: 1,
      recordedSeq: 1,
      lastEventId: 'evt-1',
      rawPrefix: proof,
    });
    expect(result.relation).toBe(LEDGER_RELATION.PREFIX_EXTENSION);
  });

  it('refuses an injected record before the checkpoint', () => {
    const first = line(1, 'evt-1');
    const roomPath = fixture(`${line(0, 'evt-injected')}\n${first}\n${line(2, 'evt-2')}\n`);
    const proof = readRoomRawPrefix({ roomPath, recordCount: 1, expectedSha16: digestOf(first) });
    expect(proof.proven).toBe(false);
  });

  it('refuses changed prior bytes with the same record count', () => {
    const first = line(1, 'evt-1');
    const roomPath = fixture(`${line(1, 'evt-0')}\n${line(2, 'evt-2')}\n`);
    const proof = readRoomRawPrefix({ roomPath, recordCount: 1, expectedSha16: digestOf(first) });
    expect(proof.proven).toBe(false);
  });

  it('refuses a live ledger shorter than the recorded count', () => {
    const first = line(1, 'evt-1');
    const roomPath = fixture(`${first}\n`);
    const proof = readRoomRawPrefix({ roomPath, recordCount: 2, expectedSha16: digestOf(`${first}\n`) });
    expect(proof.proven).toBe(false);
    expect(proof.reason).toMatch(/fewer records/);
  });

  it('refuses malformed recorded counts and digests', () => {
    const first = line(1, 'evt-1');
    const roomPath = fixture(`${first}\n`);
    expect(readRoomRawPrefix({ roomPath, recordCount: 0, expectedSha16: digestOf(first) }).proven).toBe(false);
    expect(readRoomRawPrefix({ roomPath, recordCount: 1, expectedSha16: 'XYZ' }).proven).toBe(false);
    expect(readRoomRawPrefix({ roomPath, recordCount: 1, expectedSha16: null }).proven).toBe(false);
  });

  it('refuses a boundary that falls inside a line holding two records', () => {
    const a = line(1, 'evt-1');
    const b = line(2, 'evt-2');
    const roomPath = fixture(`${a}${b}\n`);
    const proof = readRoomRawPrefix({ roomPath, recordCount: 1, expectedSha16: digestOf(a) });
    expect(proof.proven).toBe(false);
    expect(proof.reason).toMatch(/inside a line/);
  });

  it('accepts a valid append that reuses a brokerSequence', () => {
    const first = line(1, 'evt-1');
    const roomPath = fixture(`${first}\n${line(2, 'evt-2')}\n${line(2, 'evt-3')}\n`);
    const proof = readRoomRawPrefix({ roomPath, recordCount: 1, expectedSha16: digestOf(first) });
    expect(proof.proven).toBe(true);
  });
});

describe('single-snapshot binding: records and proof come from one read', () => {
  const digest = (text: string) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  function tempRoom(content: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bound-snapshot-'));
    dirs.push(dir);
    const roomPath = path.join(dir, 'room.jsonl');
    fs.writeFileSync(roomPath, content);
    return roomPath;
  }

  it('refuses classification when the file signature changes during the single read', () => {
    const first = JSON.stringify(rec(1, 'evt-1'));
    const roomPath = tempRoom(`${first}\n`);
    const snap = readRoomBoundSnapshot({
      roomPath,
      recordCount: 1,
      expectedSha16: digest(first),
      readBytes: (p: string) => {
        const buf = fs.readFileSync(p);
        fs.utimesSync(p, new Date(), new Date(Date.now() + 60_000));
        return buf;
      },
    });
    expect(snap.state).toBe('UNSTABLE');
    expect(snap.stable).toBe(false);
    expect(snap.rawPrefix.proven).toBe(false);
    expect(snap.records).toEqual([]);
  });

  it('ignores a restored prefix on a later read: the first read decides records and proof', () => {
    const first = JSON.stringify(rec(1, 'evt-1'));
    const clean = `${first}\n${JSON.stringify(rec(2, 'evt-2'))}\n`;
    const tampered = `${JSON.stringify(rec(1, 'evt-0'))}\n${JSON.stringify(rec(2, 'evt-2'))}\n${JSON.stringify(rec(3, 'evt-3'))}\n`;
    const roomPath = tempRoom(tampered);
    let reads = 0;
    const readBytes = (p: string) => {
      reads += 1;
      return fs.readFileSync(p);
    };
    const snap = readRoomBoundSnapshot({ roomPath, recordCount: 1, expectedSha16: digest(first), readBytes });
    expect(reads).toBe(1);
    expect(snap.records[0].eventId).toBe('evt-0');
    expect(snap.rawPrefix.proven).toBe(false);
    const result = classifyRoomLedgerRelation({
      recordedHash: digest(first),
      liveHash: snap.sha256Prefix,
      liveRecords: snap.records,
      liveTailSequence: snap.tailSequence,
      recordedCount: 1,
      recordedSeq: 1,
      lastEventId: 'evt-1',
      rawPrefix: snap.rawPrefix,
    });
    expect(result.relation).not.toBe(LEDGER_RELATION.PREFIX_EXTENSION);
    expect(result.blocking).toBe(true);
  });

  it('classifies a valid append as PREFIX_EXTENSION from one read', () => {
    const first = JSON.stringify(rec(1, 'evt-1'));
    const bytes = `${first}\n${JSON.stringify(rec(2, 'evt-2'))}\n${JSON.stringify(rec(2, 'evt-3'))}\n`;
    const roomPath = tempRoom(bytes);
    let reads = 0;
    const snap = readRoomBoundSnapshot({
      roomPath,
      recordCount: 1,
      expectedSha16: digest(first),
      readBytes: (p: string) => {
        reads += 1;
        return fs.readFileSync(p);
      },
    });
    expect(reads).toBe(1);
    expect(snap.state).toBe('OK');
    expect(snap.rawPrefix.proven).toBe(true);
    const result = classifyRoomLedgerRelation({
      recordedHash: digest(first),
      liveHash: snap.sha256Prefix,
      liveRecords: snap.records,
      liveTailSequence: snap.tailSequence,
      recordedCount: 1,
      recordedSeq: 1,
      lastEventId: 'evt-1',
      rawPrefix: snap.rawPrefix,
    });
    expect(result.relation).toBe(LEDGER_RELATION.PREFIX_EXTENSION);
    expect(result.blocking).toBe(false);
  });
});
