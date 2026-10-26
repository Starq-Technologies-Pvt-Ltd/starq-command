/**
 * Read-only historical PM snapshot adapter (#10634 / #10623).
 *
 * Loads declared Nexus board JSON files from an explicit fixture/workspace
 * root and emits provenance-rich historical records. It never writes, never
 * opens pm-board.db, never creates pm_tasks / pm_status_log rows, never
 * translates Nexus status values, and never infers owner, verifier, or Room
 * authorization.
 *
 * Callers MUST pass an explicit workspaceRoot. This module does not resolve
 * the live Starq workspace and does not read canonical boards by default.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveReadOnlyTarget } from './path-guard.mjs';

/** Live Building historical root (#10646). Adapter paths are relative to this parent. */
export const HISTORICAL_NEXUS_WORKSPACE_ROOT = 'D:\\!starq';
export const HISTORICAL_NEXUS_DATA_ROOT = 'D:\\!starq\\starqNexus\\data';
const FORBIDDEN_MIRROR = 'd:\\starqtech\\projects';

export const HISTORICAL_PM_BOARD_SOURCES = Object.freeze([
  'starqNexus/data/starq-erp-tasks.json',
  'starqNexus/data/hoadha-tasks.json',
  'starqNexus/data/hoadha-social-tasks.json',
  'starqNexus/data/hoadha-concierge-tasks.json',
]);

export const HISTORICAL_PM_EXPECTED_COUNTS = Object.freeze({
  erp: 437,
  hoadha_core: 243,
  hoadha_social: 56,
  hoadha_concierge: 27,
  total: 763,
});

const BOARD_BY_SOURCE = Object.freeze({
  'starqNexus/data/starq-erp-tasks.json': 'erp',
  'starqNexus/data/hoadha-tasks.json': 'hoadha_core',
  'starqNexus/data/hoadha-social-tasks.json': 'hoadha_social',
  'starqNexus/data/hoadha-concierge-tasks.json': 'hoadha_concierge',
});

const RELATION_KEYS = Object.freeze([
  'depends_on', 'blocked_by', 'blocks', 'parent', 'children', 'related', 'workers',
]);

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function normalizeHistoricalWorkspaceRoot(root) {
  return path.resolve(String(root || '')).replaceAll('/', '\\').toLowerCase();
}

/** The D:\\StarqTech\\Projects copy is hash-identical, not authority (#10642/#10646). */
export function isForbiddenHistoricalMirror(root) {
  const normalised = normalizeHistoricalWorkspaceRoot(root);
  return normalised === FORBIDDEN_MIRROR || normalised.startsWith(`${FORBIDDEN_MIRROR}\\`);
}

export function emptyHistoricalPmSnapshot(reason) {
  return {
    authority: 'HISTORICAL_SNAPSHOT',
    access: 'READ_ONLY',
    actionable: false,
    reason,
    files: [],
    records: [],
    counts: {
      erp: 0, hoadha_core: 0, hoadha_social: 0, hoadha_concierge: 0, total: 0,
    },
    expected_counts: { ...HISTORICAL_PM_EXPECTED_COUNTS },
    unique_source_ids: [],
    duplicate_source_ids: [],
    count_match: false,
    unique_id_match: false,
    pm_tasks_created: 0,
    pm_status_log_created: 0,
  };
}

function readDeclaredBoard(workspaceRoot, source) {
  const guard = resolveReadOnlyTarget({
    workspaceRoot,
    requested: source,
    allowed: HISTORICAL_PM_BOARD_SOURCES,
  });
  if (!guard.ok) {
    return {
      source,
      board: BOARD_BY_SOURCE[source] ?? null,
      state: 'REFUSED',
      reason: guard.error,
      sha256: null,
      byteLength: null,
      records: [],
    };
  }
  let bytes;
  try {
    bytes = fs.readFileSync(guard.resolved);
  } catch (error) {
    return {
      source,
      board: BOARD_BY_SOURCE[source],
      state: error.code === 'ENOENT' ? 'UNAVAILABLE' : 'UNREADABLE',
      reason: error.message,
      sha256: null,
      byteLength: null,
      records: [],
    };
  }
  const digest = sha256(bytes);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return {
      source,
      board: BOARD_BY_SOURCE[source],
      state: 'UNREADABLE',
      reason: error.message,
      sha256: digest,
      byteLength: bytes.length,
      records: [],
    };
  }
  if (!parsed || !Array.isArray(parsed.tasks)
      || !parsed.tasks.every((task) => task && typeof task.id === 'string')) {
    return {
      source,
      board: BOARD_BY_SOURCE[source],
      state: 'UNREADABLE',
      reason: 'Board JSON must contain a tasks array of objects with string id',
      sha256: digest,
      byteLength: bytes.length,
      records: [],
    };
  }

  const records = parsed.tasks.map((task, source_row_index) => {
    const raw = clone(task);
    const relations = {};
    for (const key of RELATION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) relations[key] = clone(raw[key]);
    }
    return {
      kind: 'historical_snapshot',
      actionable: false,
      board: BOARD_BY_SOURCE[source],
      source_path: source,
      source_sha256: digest,
      source_row_index,
      source_id: raw.id,
      status: Object.prototype.hasOwnProperty.call(raw, 'status') ? clone(raw.status) : null,
      relations,
      raw,
    };
  });

  return {
    source,
    board: BOARD_BY_SOURCE[source],
    state: 'AVAILABLE',
    reason: null,
    sha256: digest,
    byteLength: bytes.length,
    records,
  };
}

function summarize(files) {
  const records = files.flatMap((file) => file.records);
  const counts = {
    erp: 0, hoadha_core: 0, hoadha_social: 0, hoadha_concierge: 0, total: records.length,
  };
  const seen = new Map();
  for (const rec of records) {
    if (counts[rec.board] != null) counts[rec.board] += 1;
    const hits = seen.get(rec.source_id) || [];
    hits.push({ board: rec.board, source_path: rec.source_path, source_row_index: rec.source_row_index });
    seen.set(rec.source_id, hits);
  }
  const unique_source_ids = [...seen.keys()].sort();
  const duplicate_source_ids = unique_source_ids.filter((id) => seen.get(id).length > 1);
  const expected = HISTORICAL_PM_EXPECTED_COUNTS;
  const count_match = counts.erp === expected.erp
    && counts.hoadha_core === expected.hoadha_core
    && counts.hoadha_social === expected.hoadha_social
    && counts.hoadha_concierge === expected.hoadha_concierge
    && counts.total === expected.total;
  const unique_id_match = unique_source_ids.length === expected.total && duplicate_source_ids.length === 0;
  return { records, counts, unique_source_ids, duplicate_source_ids, count_match, unique_id_match };
}

/**
 * @param {{ workspaceRoot: string, sources?: string[] }} opts
 */
export function loadHistoricalPmSnapshot(opts = {}) {
  const workspaceRoot = opts.workspaceRoot;
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim() === '') {
    return emptyHistoricalPmSnapshot('workspaceRoot is required; canonical workspace is not auto-resolved');
  }
  if (isForbiddenHistoricalMirror(workspaceRoot)) {
    return emptyHistoricalPmSnapshot('D:\\StarqTech\\Projects is not historical authority; use D:\\!starq');
  }
  const sources = opts.sources ?? HISTORICAL_PM_BOARD_SOURCES;
  if (!Array.isArray(sources) || sources.some((source) => !HISTORICAL_PM_BOARD_SOURCES.includes(source))) {
    return emptyHistoricalPmSnapshot('sources must be a subset of the declared historical PM board allowlist');
  }

  const files = sources.map((source) => readDeclaredBoard(workspaceRoot, source));
  const summary = summarize(files);
  return {
    authority: 'HISTORICAL_SNAPSHOT',
    access: 'READ_ONLY',
    actionable: false,
    reason: null,
    files: files.map(({ records, ...file }) => ({
      ...file,
      count: records.length,
      expected: HISTORICAL_PM_EXPECTED_COUNTS[file.board] ?? null,
    })),
    records: summary.records,
    counts: summary.counts,
    expected_counts: { ...HISTORICAL_PM_EXPECTED_COUNTS },
    unique_source_ids: summary.unique_source_ids,
    duplicate_source_ids: summary.duplicate_source_ids,
    count_match: summary.count_match,
    unique_id_match: summary.unique_id_match,
    pm_tasks_created: 0,
    pm_status_log_created: 0,
  };
}
