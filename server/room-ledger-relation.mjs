/**
 * Classify live Room vs a verified activity checkpoint.
 *
 * Raw-row domain: recordedCount is activity_ledger.records_total (raw Room rows). A prefix
 * extension is proven only by an exact raw byte prefix (see readRoomRawPrefix in
 * agent-comms/scripts/room.mjs), supplied by the caller as input.rawPrefix. Event-list counts
 * and max broker sequence are separate facts and are not used as prefix proof. brokerSequence is
 * not unique, so duplicate sequences in appended records are permitted; eventId is the identity.
 * Does not ingest, write, or hash the live ledger file itself.
 */
export const LEDGER_RELATION = {
  MATCH: 'MATCH',
  PREFIX_EXTENSION: 'PREFIX_EXTENSION',
  TRUNCATED: 'TRUNCATED',
  NON_PREFIX: 'NON_PREFIX',
  CHECKPOINT_MISSING: 'CHECKPOINT_MISSING',
  EPOCH_MISMATCH: 'EPOCH_MISMATCH',
  UNREADABLE: 'UNREADABLE',
};

function eventIdOf(record) {
  return record?.eventId ?? record?.event?.eventId ?? null;
}

function blocked(relation, reason, healthState = 'UNREADABLE') {
  return { relation, blocking: true, healthState, lag: false, reason };
}

/**
 * @param {object} input
 * @param {string|null} input.recordedHash       activity_ledger.sha256_prefix (whole ledger at ingest)
 * @param {string|null} input.liveHash           live Room sha256 prefix
 * @param {object[]} input.liveRecords           live raw Room records
 * @param {number|null} input.liveTailSequence
 * @param {number|null} input.recordedCount      activity_ledger.records_total (raw rows)
 * @param {number|null} input.recordedSeq        max broker sequence (separate checkpoint fact)
 * @param {string|null} input.lastEventId        checkpoint last event identity
 * @param {{proven: boolean, reason?: string|null}|null} [input.rawPrefix]
 * @param {string|null} [input.recordedEpoch]
 * @param {string|null} [input.liveEpoch]
 */
export function classifyRoomLedgerRelation(input = {}) {
  const liveRecords = Array.isArray(input.liveRecords) ? input.liveRecords : null;
  if (input.recordedEpoch && input.liveEpoch && input.recordedEpoch !== input.liveEpoch) {
    return blocked(LEDGER_RELATION.EPOCH_MISMATCH, 'Room epoch does not match the recorded activity epoch');
  }
  if (!liveRecords) {
    return blocked(LEDGER_RELATION.UNREADABLE, 'live Room records unavailable for prefix comparison');
  }
  const recordedCount = Number.isInteger(input.recordedCount) && input.recordedCount >= 1 ? input.recordedCount : null;
  if (recordedCount == null) {
    return blocked(LEDGER_RELATION.UNREADABLE, 'checkpoint raw record count is missing or malformed');
  }
  const recordedSeq = Number.isInteger(input.recordedSeq) ? input.recordedSeq : null;
  if (recordedSeq == null) {
    return blocked(LEDGER_RELATION.UNREADABLE, 'checkpoint max broker sequence is missing or malformed');
  }
  if (liveRecords.length < recordedCount) {
    return blocked(LEDGER_RELATION.TRUNCATED, 'live Room is shorter than the verified activity checkpoint');
  }
  if (Number.isInteger(input.liveTailSequence) && input.liveTailSequence < recordedSeq) {
    return blocked(LEDGER_RELATION.TRUNCATED, 'live Room tail sequence is behind the verified checkpoint sequence');
  }
  const lastEventId = input.lastEventId ?? null;
  if (!lastEventId) {
    return blocked(LEDGER_RELATION.UNREADABLE, 'room ledger changed since last ingest and no checkpoint eventId is available to prove a prefix extension', 'STALE');
  }
  // The checkpoint identity must sit inside the checkpointed raw prefix.
  const inPrefix = liveRecords.slice(0, recordedCount).some((r) => eventIdOf(r) === lastEventId);
  if (!inPrefix) {
    return blocked(LEDGER_RELATION.CHECKPOINT_MISSING, 'verified checkpoint eventId is not present in the checkpointed prefix');
  }

  const hashesEqual = Boolean(input.recordedHash && input.liveHash && input.recordedHash === input.liveHash);
  if (hashesEqual) {
    if (liveRecords.length !== recordedCount) {
      return blocked(LEDGER_RELATION.UNREADABLE, 'exact hash match is inconsistent with the checkpoint record count');
    }
    return { relation: LEDGER_RELATION.MATCH, blocking: false, healthState: 'OK', lag: false, reason: null };
  }

  const after = liveRecords.slice(recordedCount);
  for (const record of after) {
    if (!eventIdOf(record)) {
      return blocked(LEDGER_RELATION.NON_PREFIX, 'appended record lacks an eventId; append-only extension cannot be proven');
    }
  }
  if (!input.rawPrefix || typeof input.rawPrefix !== 'object') {
    return blocked(LEDGER_RELATION.UNREADABLE, 'raw prefix proof was not supplied; prefix extension cannot be proven');
  }
  if (input.rawPrefix.proven !== true) {
    return blocked(LEDGER_RELATION.NON_PREFIX, input.rawPrefix.reason || 'raw prefix is not proven; checkpointed bytes changed or were not reproduced');
  }
  if (after.length === 0) {
    return blocked(LEDGER_RELATION.UNREADABLE, 'room ledger hash moved without appended records', 'STALE');
  }
  return {
    relation: LEDGER_RELATION.PREFIX_EXTENSION,
    blocking: false,
    healthState: 'OK',
    lag: true,
    reason: 'valid append-only Room extension beyond a verified activity checkpoint; projection lag, not corruption',
  };
}
