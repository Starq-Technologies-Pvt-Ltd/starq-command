/** #9538: read adapters over canonical Room; no writer, runtime or business closure. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { resolveReadOnlyTarget } from './path-guard.mjs';
import { computeRecordHash } from '../../../../agent-comms/protocol/v1/hashChain.mjs';
import { computeEventId } from '../../../../agent-comms/protocol/v1/envelope.mjs';
import { readRoomSnapshot } from './room-snapshot.mjs';

const SOURCES = ['agent-comms/protocol/v1/ledger-epoch.json',
  'agent-comms/protocol/v1/projects.json', 'agent-comms/protocol/v1/identities.json',
  '00_STARQ_HQ/operations/starqerp-control-board/activity.json',
  '00_STARQ_HQ/operations/starqerp-control-board/activity_state.json'];
const text = (v) => typeof v === 'string' && v.trim() ? v : null;
function field(body, label) {
  // Only explicitly labelled source values, never recipients, mentions or NLP.
  const match = body.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
  return match ? text(match[1]) : null;
}
function read(root, source) {
  const result = resolveReadOnlyTarget({ workspaceRoot: root, requested: source, allowed: SOURCES });
  if (!result.ok) throw new Error(result.error);
  return fs.readFileSync(result.resolved, 'utf8');
}
export function projectRoomRecords(records, epoch, projects, identities, ingestedIds = records.map(r => r.eventId)) {
  const anchor = records.findIndex(r => r.eventId === epoch.current?.anchor?.eventId);
  if (anchor < 0) throw new Error('Current Room epoch anchor unavailable');
  const projectIds = new Set(projects.projects.map(p => p.slug));
  const registry = new Map(identities.identities.map(i => [i.identityId, i]));
  const eligibleIds = new Set(ingestedIds);
  let previous = null;
  const work = [], history = [];
  const seen = new Map();
  for (const [index, record] of records.entries()) {
    const event = record.event;
    if (!event) continue;
    const currentEpoch = index >= anchor;
    if (currentEpoch) {
      if (computeRecordHash(record) !== record.recordHash || computeEventId(event) !== record.eventId ||
          (previous && record.previousRecordHash !== previous)) throw new Error('Current Room epoch integrity failure');
      previous = record.recordHash;
    }
    // Preserve all source branches. A repeated ID with differing content is not
    // resolved by selecting the latest value, even in historical material.
    if (seen.has(record.eventId)) {
      if (seen.get(record.eventId) !== JSON.stringify(record)) throw new Error('Conflicting Room event ID');
      continue;
    }
    seen.set(record.eventId, JSON.stringify(record));
    if (!eligibleIds.has(record.eventId)) continue;
    if (record.authorityDecision?.allowed !== true) continue;
    const body = text(event.body) ?? '';
    const metadata = event.metadata ?? {};
    const identity = registry.get(event.senderIdentityId);
    const verifiedIdentity = identity?.canonicalHandle === event.senderHandle && identity.status === 'active';
    const founder = verifiedIdentity && identity.authorityLevel === 'ROOT_GENESIS' &&
      record.authorityDecision.senderAuthorityLevel === 'ROOT_GENESIS';
    const reference = `agent-comms/room.jsonl#eventId=${record.eventId};sequence=${record.brokerSequence}`;
    const reportedAction = text(metadata.action);
    const provenance = {
      event_id: record.eventId, sequence: record.brokerSequence ?? null,
      record_hash: record.recordHash ?? null, recorded_at: event.createdAt ?? record.receivedAt ?? null,
      reporter: text(event.senderHandle), source_reference: reference,
      integrity: currentEpoch ? 'CURRENT_EPOCH_VERIFIED' : 'HISTORICAL_UNVERIFIED',
      reported_action: reportedAction,
      reported_status: field(body, 'Status'), blockers: field(body, 'Blocker(?:s)?'),
      reported_verification: field(body, 'Verification'),
      independent_verification: 'UNKNOWN', current_execution: 'UNKNOWN',
      evidence: body, kind: founder ? 'FOUNDER_RECORD' :
        ['done', 'complete', 'result'].includes(reportedAction) ? 'REPORTED_OUTCOME' :
        ['verify', 'rejected'].includes(reportedAction) ? 'VERIFICATION_REPORT' :
        ['claim', 'started', 'accepted', 'accepted_assignment'].includes(reportedAction) ? 'RECORDED_ASSIGNMENT' : 'RECORDED_WORK_REFERENCE',
    };
    if (founder || ['done', 'complete', 'result', 'verify', 'rejected', 'blocked'].includes(reportedAction)) {
      history.push(provenance);
    }
    const workId = text(metadata.task) ?? text(event.taskId) ?? field(body, 'Work-ID');
    const project = text(metadata.project);
    // Title is a source heading/subject, not an invented description of work.
    const title = field(body, 'Title') ?? field(body, 'Subject') ?? text(body.split(/\r?\n/).find(l => l.trim()));
    if (!workId || !projectIds.has(project) || !title) continue;
    const explicitProject = field(body, 'Project');
    if (explicitProject && explicitProject !== project) continue; // source conflict, no adjudication
    work.push({
      id: record.eventId, project_id: project, title,
      current_stage: field(body, 'Current stage') ?? field(body, 'Stage'),
      owner: field(body, 'Owner'), verifier: field(body, 'Verifier'), board_lane: field(body, 'Board lane'),
      source: { kind: 'GENERAL_ASSIGNMENT', reference },
      record: { ...provenance, work_id: workId },
    });
  }
  return { work: work.reverse(), history: history.slice(-100).reverse(), history_total: history.length,
    max_sequence: records.at(-1)?.brokerSequence ?? null, state: 'OK',
    note: 'Recorded Room history, not current runtime activity or accepted closure. Historical integrity failures remain preserved.' };
}
let cached = null;
export function readRoomVisibility(root) {
  try {
    const room = readRoomSnapshot(root);
    if (room.state !== 'OK' || !room.stable || room.parseStatus !== 'OK')
      throw new Error(room.reason ?? `Room snapshot is ${room.state}/${room.parseStatus}`);
    const inputs = SOURCES.map(s => read(root, s));
    const digest = crypto.createHash('sha256').update(JSON.stringify({
      room: { sha256: room.sha256, byteLength: room.byteLength },
      inputs,
    })).digest('hex');
    if (cached?.root === root && cached.digest === digest) return cached.value;
    const records = room.records;
    const [epochText, projectsText, identitiesText, activityText, checkpointText] = inputs;
    const [epoch, projects, identities, activity, checkpoint] = [epochText, projectsText, identitiesText, activityText, checkpointText].map(s => JSON.parse(s));
    if (!Array.isArray(activity.record_event_ids)) throw new Error('Activity evidence index has not been ingested');
    if (checkpoint.activity_sha256 !== crypto.createHash('sha256').update(activityText).digest('hex'))
      throw new Error('Activity output/checkpoint handoff mismatch');
    const value = projectRoomRecords(records, epoch, projects, identities, activity.record_event_ids);
    value.room_head_sequence = room.tailSequence;
    value.room_tail_hash = room.tailHash;
    value.max_sequence = activity.activity_ledger?.max_broker_sequence ?? null;
    value.generated_at = activity.generated_at ?? null;
    value.state = room.sha256Prefix === activity.activity_ledger?.sha256_prefix ? 'OK' : 'STALE';
    for (const row of value.work) row.record.projection_state = value.state;
    for (const row of value.history) row.projection_state = value.state;
    cached = {root, digest, value};
    return value;
  } catch (error) {
    cached = null;
    return { work: null, history: null, state: 'UNAVAILABLE', reason: error.message };
  }
}
