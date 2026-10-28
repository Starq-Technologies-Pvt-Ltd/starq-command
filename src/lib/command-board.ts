export const COMMAND_BOARD_SOURCE = Object.freeze({
  input: 'command_tasks',
  identity: 'board/command-board.json',
  boardSha256: 'E3B6A30246A44CBAF9BBA88B5C930EB643FA4D4BF565D9E632F26B74C3F09651',
  schemaSha256: '2B8BB447E089F238CBE961F02C99CCC23C3545D544B008AD7CC8B11D7F47B5CD',
  manifestSha256: '4AD73C8D4A8D7981012BC63600EE16FCEFE51AA13A157A8522DCAEE40E548611',
  checkpoint: Object.freeze({
    sequence: 9455,
    eventId: '421f81968f26051917f1ee4bcc325ceac8437d92c4fca2db6428562a3f18493a',
    recordHash: 'b28c21b72d524f7d3262e1fc268798f3d4a70aa7fbe0f9d3000bf16177c1a070',
  }),
} as const);

export const PHASE1_ACCEPTANCE = Object.freeze({
  sequence: 9462,
  eventId: 'be17d38644207ea3c10325c8949042070ab51e72c63e4bc0d63bf674e2444357',
  recordHash: '30e31c54eb032474a1c51d5334df5216e2137f7e0a70e0206ccbf486a4e20dde',
  disposition: 'ACCEPT WITH RECORDED EXCEPTIONS',
} as const);

const BOARD_URL = new URL('../../board/command-board.json', import.meta.url);
const SCHEMA_URL = new URL('../../board/board-schema.json', import.meta.url);
const MANIFEST_URL = new URL('../../board/board-manifest.json', import.meta.url);
const HISTORICAL_LEDGER_SHA256 = '91C16B4FB74F8551CFBFAD0E260C1D9747E919910A1A5DB3D0F11D016187297F';

type JsonObject = Record<string, unknown>;

export interface CommandBoardTask {
  id: string;
  title: string;
  source_state: string;
  current_owner: 'UNKNOWN';
  current_verifier: 'UNKNOWN';
  workflow_stage: 'unknown' | 'UNKNOWN';
  disposition: string;
  source_record: {
    id: string;
    title: string;
    state: string;
    dependsOn: string[];
  };
  authorization_refs: RoomReference[];
  independent_verdict_refs: RoomReference[];
  room_overlay_refs: Array<{ room_ref: RoomReference }>;
  supersedes: string[];
  superseded_by: string[];
}

interface RoomReference {
  sequence: number;
  eventId: string;
  recordHash: string;
  previousRecordHash: string;
  senderHandle: string;
  purpose: string;
}

export interface CommandBoardSnapshot {
  state: 'STALE';
  input: 'command_tasks';
  reason: string;
  boardStatus: 'CANDIDATE_NOT_ACCEPTED';
  source: typeof COMMAND_BOARD_SOURCE;
  acceptance: typeof PHASE1_ACCEPTANCE;
  tasks: readonly CommandBoardTask[];
  historicalLimitations: readonly string[];
}

export interface CommandBoardUnavailable {
  state: 'CONFLICT' | 'UNAVAILABLE';
  input: 'command_tasks';
  reason: string;
  source: typeof COMMAND_BOARD_SOURCE;
  acceptance: typeof PHASE1_ACCEPTANCE;
  tasks: null;
  historicalLimitations: readonly string[];
}

export type CommandBoardProjection = CommandBoardSnapshot | CommandBoardUnavailable;

const HISTORICAL_LIMITATIONS = [
  'ERP contract historical non-modification: UNKNOWN; no pre-#9456 digest is pinned.',
  'Herdr TaskStore historical non-access: UNKNOWN; no permitted independent audit evidence exists.',
] as const;

const ROOT_REQUIRED = [
  'board_id',
  'schema_version',
  'scope',
  'revision',
  'previous_board_sha256',
  'status',
  'last_reconciled_room_head',
  'source_manifest',
  'reconciliation',
  'tasks',
] as const;

const TASK_REQUIRED = [
  'id',
  'title',
  'programme',
  'source_qualifier',
  'source_state',
  'source_owner_at_checkpoint',
  'source_record',
  'current_owner',
  'current_verifier',
  'workflow_stage',
  'disposition',
  'disposition_basis',
  'current_authorization_status',
  'authorization_refs',
  'independent_verdict_refs',
  'blocker',
  'evidence_refs',
  'room_overlay_refs',
  'supersedes',
  'superseded_by',
] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function sameRoomReference(left: unknown, right: unknown): boolean {
  if (!isObject(left) || !isObject(right)) return false;
  return (
    left.sequence === right.sequence &&
    left.eventId === right.eventId &&
    left.recordHash === right.recordHash &&
    left.previousRecordHash === right.previousRecordHash &&
    left.senderHandle === right.senderHandle &&
    left.purpose === right.purpose
  );
}

function parseJson(raw: string, label: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!isObject(value)) throw new Error(`${label} must contain a JSON object.`);
  return value;
}

async function sha256(raw: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SHA-256 verification is unavailable in this environment.');
  const bytes = new TextEncoder().encode(raw);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function assertSchema(schema: JsonObject): void {
  const properties = schema.properties;
  const definitions = schema.definitions;
  // The exact schema digest is pinned, and the structural checks below guard
  // the fields consumed by this projection without importing a schema engine.
  if (schema.type !== 'object' || !Array.isArray(schema.required) || !isObject(properties) || !isObject(definitions)) {
    throw new Error('Board schema has an invalid root definition.');
  }
  const rootRequired = schema.required as unknown[];
  if (!ROOT_REQUIRED.every((name) => rootRequired.includes(name) && Object.hasOwn(properties, name))) {
    throw new Error('Board schema omits a required root field.');
  }
  const taskDefinition = definitions.task;
  if (!isObject(taskDefinition) || !Array.isArray(taskDefinition.required) || !isObject(taskDefinition.properties)) {
    throw new Error('Board schema omits the task definition.');
  }
  const required = taskDefinition.required as unknown[];
  if (!TASK_REQUIRED.every((name) => required.includes(name) && Object.hasOwn(taskDefinition.properties as JsonObject, name))) {
    throw new Error('Board task schema omits a required task field.');
  }
  const tasksSchema = properties.tasks;
  if (
    !isObject(tasksSchema) ||
    tasksSchema.type !== 'array' ||
    !isObject(tasksSchema.items) ||
    tasksSchema.items.$ref !== '#/definitions/task'
  ) {
    throw new Error('Board schema does not define an array of task records.');
  }
}

function assertAcceptance(): void {
  if (!Object.isFrozen(PHASE1_ACCEPTANCE) || PHASE1_ACCEPTANCE.sequence !== 9462) {
    throw new Error('Canonical Room #9462 acceptance reference is unavailable.');
  }
  if (
    PHASE1_ACCEPTANCE.eventId !== 'be17d38644207ea3c10325c8949042070ab51e72c63e4bc0d63bf674e2444357' ||
    PHASE1_ACCEPTANCE.recordHash !== '30e31c54eb032474a1c51d5334df5216e2137f7e0a70e0206ccbf486a4e20dde' ||
    PHASE1_ACCEPTANCE.disposition !== 'ACCEPT WITH RECORDED EXCEPTIONS'
  ) {
    throw new Error('Canonical Room #9462 acceptance reference conflicts with the pinned verdict.');
  }
}

function assertRoomReference(reference: unknown): asserts reference is RoomReference {
  if (!isObject(reference)) throw new Error('A task Room reference is not an object.');
  if (
    !Number.isInteger(reference.sequence) ||
    typeof reference.eventId !== 'string' || !/^[a-f0-9]{64}$/i.test(reference.eventId) ||
    typeof reference.recordHash !== 'string' || !/^[a-f0-9]{64}$/i.test(reference.recordHash) ||
    typeof reference.previousRecordHash !== 'string' || !/^[a-f0-9]{64}$/i.test(reference.previousRecordHash) ||
    typeof reference.senderHandle !== 'string' ||
    typeof reference.purpose !== 'string'
  ) {
    throw new Error('A task Room reference is malformed.');
  }
}

function assertManifestAndBoard(
  board: JsonObject,
  manifest: JsonObject,
  schema: JsonObject,
  computedBoardHash: string,
): asserts board is JsonObject & { tasks: CommandBoardTask[] } {
  assertSchema(schema);
  if (
    board.board_id !== 'STARQ-COMMAND-MODS' ||
    board.schema_version !== '1.0.0' ||
    board.status !== 'CANDIDATE_NOT_ACCEPTED' ||
    manifest.board_id !== board.board_id
  ) {
    throw new Error('Board identity or candidate status conflicts with the accepted snapshot.');
  }
  if (!Array.isArray(board.tasks) || board.tasks.length !== 33) {
    throw new Error('Board must contain exactly the 33 accepted task records.');
  }

  const artifacts = manifest.artifacts;
  const migration = manifest.migration;
  const manifestCutoff = isObject(manifest.room_reconciliation) ? manifest.room_reconciliation.cutoff : null;
  const sourceManifest = board.source_manifest;
  const boardCheckpoint = board.last_reconciled_room_head;
  if (!isObject(artifacts) || !isObject(migration) || !isObject(sourceManifest) || !isObject(boardCheckpoint)) {
    throw new Error('Manifest or board provenance is incomplete.');
  }
  const boardArtifact = artifacts.board;
  const schemaArtifact = artifacts.schema;
  const snapshotArtifact = artifacts.immutable_snapshot;
  const sourceCutoff = sourceManifest.room_cutoff;
  const historicalSource = manifest.source;
  const boardHistoricalSource = sourceManifest.historical_ledger;
  if (
    !isObject(boardArtifact) || !isObject(schemaArtifact) || !isObject(snapshotArtifact) ||
    !isObject(sourceCutoff) || !isObject(manifestCutoff) || !isObject(historicalSource) ||
    !isObject(boardHistoricalSource)
  ) {
    throw new Error('Manifest artifact or checkpoint references are incomplete.');
  }
  // The actual byte lengths are checked after hashing; these manifest pins
  // prevent a self-consistent but unaccepted artifact set.
  if (
    boardArtifact.sha256 !== computedBoardHash ||
    boardArtifact.sha256 !== COMMAND_BOARD_SOURCE.boardSha256 ||
    schemaArtifact.sha256 !== COMMAND_BOARD_SOURCE.schemaSha256 ||
    snapshotArtifact.sha256 !== COMMAND_BOARD_SOURCE.boardSha256 ||
    snapshotArtifact.bytes_identical_to_board !== true ||
    snapshotArtifact.bytes !== boardArtifact.bytes
  ) {
    throw new Error('Manifest artifact hashes or immutable snapshot claims conflict.');
  }
  if (
    manifest.manifest_version !== '1.0.0' ||
    historicalSource.historical_ledger_sha256 !== HISTORICAL_LEDGER_SHA256 ||
    historicalSource.expected_sha256_from_room_9451 !== HISTORICAL_LEDGER_SHA256 ||
    historicalSource.historical_ledger_bytes !== 26842 ||
    historicalSource.source_checkpoint_sequence !== 9367 ||
    historicalSource.fingerprint_match !== true ||
    boardHistoricalSource.sha256 !== HISTORICAL_LEDGER_SHA256 ||
    boardHistoricalSource.expected_sha256_from_room_9451 !== HISTORICAL_LEDGER_SHA256 ||
    boardHistoricalSource.bytes !== 26842 ||
    boardHistoricalSource.checkpoint_sequence !== 9367
  ) {
    throw new Error('Manifest historical source provenance conflicts with its accepted pin.');
  }
  if (
    boardCheckpoint.sequence !== COMMAND_BOARD_SOURCE.checkpoint.sequence ||
    boardCheckpoint.eventId !== COMMAND_BOARD_SOURCE.checkpoint.eventId ||
    boardCheckpoint.recordHash !== COMMAND_BOARD_SOURCE.checkpoint.recordHash ||
    sourceCutoff.sequence !== COMMAND_BOARD_SOURCE.checkpoint.sequence ||
    sourceCutoff.event_id !== COMMAND_BOARD_SOURCE.checkpoint.eventId ||
    sourceCutoff.record_hash !== COMMAND_BOARD_SOURCE.checkpoint.recordHash ||
    manifestCutoff.sequence !== COMMAND_BOARD_SOURCE.checkpoint.sequence ||
    manifestCutoff.eventId !== COMMAND_BOARD_SOURCE.checkpoint.eventId ||
    manifestCutoff.recordHash !== COMMAND_BOARD_SOURCE.checkpoint.recordHash
  ) {
    throw new Error('Board and manifest Room checkpoint references conflict.');
  }
  if (
    migration.source_task_count !== 33 ||
    migration.imported_task_count !== 33 ||
    migration.exact_id_order_match !== true ||
    migration.raw_source_record_deep_match_count !== 33 ||
    migration.dependency_reference_count !== 52 ||
    !Array.isArray(migration.source_ids) ||
    !Array.isArray(migration.imported_ids) ||
    !Array.isArray(migration.duplicate_ids) || migration.duplicate_ids.length !== 0 ||
    !Array.isArray(migration.unresolved_dependency_targets) || migration.unresolved_dependency_targets.length !== 0
  ) {
    throw new Error('Manifest migration counts or reference status are inconsistent.');
  }

  const tasks = board.tasks as unknown[];
  const ids = tasks.map((task) => (isObject(task) ? task.id : null));
  if (ids.some((id) => typeof id !== 'string' || id.length === 0) || new Set(ids).size !== 33) {
    throw new Error('Board contains a missing or duplicate task ID.');
  }
  if (
    JSON.stringify(migration.source_ids) !== JSON.stringify(ids) ||
    JSON.stringify(migration.imported_ids) !== JSON.stringify(ids)
  ) {
    throw new Error('Manifest task IDs do not exactly match board order.');
  }

  const idSet = new Set(ids as string[]);
  let dependencyCount = 0;
  const taskRoomRefs: RoomReference[] = [];
  for (const taskValue of tasks) {
    if (!isObject(taskValue) || !isObject(taskValue.source_record)) throw new Error('A board task is malformed.');
    const task = taskValue;
    const sourceRecord = task.source_record as JsonObject;
    if (!TASK_REQUIRED.every((name) => Object.hasOwn(task, name))) {
      throw new Error(`Task ${String(task.id)} omits a schema-required field.`);
    }
    if (
      typeof task.id !== 'string' || typeof task.title !== 'string' ||
      typeof task.source_state !== 'string' || typeof task.disposition !== 'string' ||
      task.current_owner !== 'UNKNOWN' || task.current_verifier !== 'UNKNOWN' ||
      !['unknown', 'UNKNOWN'].includes(String(task.workflow_stage))
    ) {
      throw new Error('A task is missing required source fields or truthful UNKNOWN current fields.');
    }
    if (
      sourceRecord.id !== task.id ||
      sourceRecord.title !== task.title ||
      sourceRecord.state !== task.source_state ||
      !isStringArray(sourceRecord.dependsOn)
    ) {
      throw new Error(`Task ${task.id} does not preserve its source record fields.`);
    }
    dependencyCount += sourceRecord.dependsOn.length;
    for (const reference of sourceRecord.dependsOn) {
      if (!idSet.has(reference)) throw new Error(`Task ${task.id} has an invalid dependency reference: ${reference}.`);
    }
    for (const referenceSet of [task.supersedes, task.superseded_by]) {
      if (!isStringArray(referenceSet) || referenceSet.some((reference) => !idSet.has(reference))) {
        throw new Error(`Task ${task.id} has an invalid supersession reference.`);
      }
    }
    if (!Array.isArray(task.authorization_refs) || !Array.isArray(task.independent_verdict_refs)) {
      throw new Error(`Task ${task.id} has invalid Room reference arrays.`);
    }
    for (const reference of [...task.authorization_refs, ...task.independent_verdict_refs]) {
      assertRoomReference(reference);
      taskRoomRefs.push(reference);
    }
    if (!Array.isArray(task.room_overlay_refs)) throw new Error(`Task ${task.id} has invalid Room overlays.`);
    for (const overlay of task.room_overlay_refs) {
      if (!isObject(overlay)) throw new Error(`Task ${task.id} has a malformed Room overlay.`);
      assertRoomReference(overlay.room_ref);
      taskRoomRefs.push(overlay.room_ref);
    }
  }
  if (dependencyCount !== 52) throw new Error('Board dependency total does not match the accepted manifest.');
  const roomReconciliation = manifest.room_reconciliation;
  if (!isObject(roomReconciliation) || !Array.isArray(roomReconciliation.event_refs)) {
    throw new Error('Manifest Room reference set is unavailable.');
  }
  const manifestRefs = roomReconciliation.event_refs as unknown[];
  const manifestRefKeys = new Map<string, RoomReference>();
  for (const reference of manifestRefs) {
    assertRoomReference(reference);
    const key = `${reference.sequence}|${reference.eventId}|${reference.recordHash}`;
    if (manifestRefKeys.has(key)) throw new Error('Manifest contains duplicate Room references.');
    manifestRefKeys.set(key, reference);
  }
  for (const reference of taskRoomRefs) {
    const key = `${reference.sequence}|${reference.eventId}|${reference.recordHash}`;
    const manifestReference = manifestRefKeys.get(key);
    if (!manifestReference || !sameRoomReference(reference, manifestReference)) {
      throw new Error(`Task Room reference ${reference.sequence} is missing or conflicts with the manifest.`);
    }
  }
  const sourceStateCounts = isObject(migration.source_state_counts) ? migration.source_state_counts : null;
  const actualStateCounts: Record<string, number> = {};
  for (const task of tasks as CommandBoardTask[]) {
    actualStateCounts[task.source_state] = (actualStateCounts[task.source_state] ?? 0) + 1;
  }
  if (!sourceStateCounts || Object.entries(actualStateCounts).some(([state, count]) => sourceStateCounts[state] !== count)) {
    throw new Error('Manifest source-state counts do not match the task rows.');
  }
}

function conflict(reason: string): CommandBoardUnavailable {
  return {
    state: 'CONFLICT',
    input: 'command_tasks',
    reason,
    source: COMMAND_BOARD_SOURCE,
    acceptance: PHASE1_ACCEPTANCE,
    tasks: null,
    historicalLimitations: HISTORICAL_LIMITATIONS,
  };
}

function unavailable(reason: string): CommandBoardUnavailable {
  return {
    state: 'UNAVAILABLE',
    input: 'command_tasks',
    reason,
    source: COMMAND_BOARD_SOURCE,
    acceptance: PHASE1_ACCEPTANCE,
    tasks: null,
    historicalLimitations: HISTORICAL_LIMITATIONS,
  };
}

export async function validateCommandBoardBundle(
  raw: { board: string; schema: string; manifest: string },
): Promise<CommandBoardProjection> {
  try {
    assertAcceptance();
    const [boardHash, schemaHash, manifestHash] = await Promise.all([
      sha256(raw.board), sha256(raw.schema), sha256(raw.manifest),
    ]);
    if (
      boardHash !== COMMAND_BOARD_SOURCE.boardSha256 ||
      schemaHash !== COMMAND_BOARD_SOURCE.schemaSha256 ||
      manifestHash !== COMMAND_BOARD_SOURCE.manifestSha256
    ) {
      return conflict('Board, schema, or manifest SHA-256 differs from the accepted pins.');
    }

    const board = parseJson(raw.board, 'Command board');
    const schema = parseJson(raw.schema, 'Command board schema');
    const manifest = parseJson(raw.manifest, 'Command board manifest');
    assertManifestAndBoard(board, manifest, schema, boardHash);
    const bytes = {
      board: new TextEncoder().encode(raw.board).length,
      schema: new TextEncoder().encode(raw.schema).length,
      manifest: new TextEncoder().encode(raw.manifest).length,
    };
    const artifacts = manifest.artifacts as JsonObject;
    const boardArtifact = artifacts.board as JsonObject;
    const schemaArtifact = artifacts.schema as JsonObject;
    if (boardArtifact.bytes !== bytes.board || schemaArtifact.bytes !== bytes.schema) {
      return conflict('Manifest byte counts do not match the supplied board or schema.');
    }
    return {
      state: 'STALE',
      input: 'command_tasks',
      reason: 'Offline snapshot only; current Room freshness is not refreshed. Last reconciled cutoff is #9455.',
      boardStatus: 'CANDIDATE_NOT_ACCEPTED',
      source: COMMAND_BOARD_SOURCE,
      acceptance: PHASE1_ACCEPTANCE,
      tasks: board.tasks,
      historicalLimitations: HISTORICAL_LIMITATIONS,
    };
  } catch (error) {
    return conflict(error instanceof Error ? error.message : 'Board validation failed.');
  }
}

export async function loadCommandBoard(
  fetchAsset: (input: URL) => Promise<Response> = (input) => fetch(input),
): Promise<CommandBoardProjection> {
  try {
    const [boardResponse, schemaResponse, manifestResponse] = await Promise.all([
      fetchAsset(BOARD_URL), fetchAsset(SCHEMA_URL), fetchAsset(MANIFEST_URL),
    ]);
    if (!boardResponse.ok || !schemaResponse.ok || !manifestResponse.ok) {
      return unavailable('A pinned Command board, schema, or manifest asset is missing. No fallback source is used.');
    }
    const [board, schema, manifest] = await Promise.all([
      boardResponse.text(), schemaResponse.text(), manifestResponse.text(),
    ]);
    return validateCommandBoardBundle({ board, schema, manifest });
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : 'Pinned Command board assets could not be read.');
  }
}
