import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveReadOnlyTarget } from './path-guard.mjs';

export const HOADHA_ROOT = '03_PROJECTS/hoadha/HOADHA_DEV_STUDIO';
export const HOADHA_DOCUMENT_SOURCES = [
  `${HOADHA_ROOT}/roadmap.machine.json`,
  ...[
    'TASK_RECONCILIATION.md',
    'DEVELOPMENT_WAVES.md',
    'LOOP_STAGE_MATRIX.md',
    'EVIDENCE_INDEX.md',
    'DEV_STUDIO_HANDOVER.md',
    'COMMERCIAL_DISCOVERY_LOOPS.md',
  ].map((f) => `${HOADHA_ROOT}/${f}`),
];
// Nexus remains preserved in its original workspace.  Command consumes these
// four files as an explicit, read-only company-board projection; it does not
// redirect the Command workspace (and therefore Room/identity/PM paths) to
// the historical root.
export const NEXUS_TASK_SOURCES = [
  'starqNexus/data/hoadha-tasks.json',
  'starqNexus/data/hoadha-social-tasks.json',
  'starqNexus/data/hoadha-concierge-tasks.json',
  'starqNexus/data/starq-erp-tasks.json',
];
export const NEXUS_COMPANY_BOARD_ROOT = 'D:\\!starq\\starqNexus\\data';
export const HOADHA_COMPANY_DOCUMENT_ROOT = 'D:\\!starq\\03_PROJECTS\\hoadha\\HOADHA_DEV_STUDIO';
export const BUILDING_SOURCES = [
  ...HOADHA_DOCUMENT_SOURCES,
  ...NEXUS_TASK_SOURCES,
];
const EXPECTED = [243, 56, 27];

function isContained(child, parent) {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
}

function readNexusTaskSource(workspaceRoot, source) {
  const filename = path.basename(source);
  if (!NEXUS_TASK_SOURCES.includes(source) || filename !== path.basename(source)) {
    throw new Error('Source outside the declared Nexus board surface');
  }

  // Test fixtures and a future company-side migration may place a preserved
  // copy beneath the Command root.  Production falls back only to the named,
  // historical Nexus data directory -- never to STARQ_WORKSPACE.
  const localRoot = workspaceRoot && path.resolve(workspaceRoot, 'starqNexus', 'data');
  const sourceRoot = localRoot && fs.existsSync(localRoot) ? localRoot : NEXUS_COMPANY_BOARD_ROOT;
  const rootReal = fs.realpathSync(sourceRoot);
  const target = path.resolve(rootReal, filename);
  if (!isContained(target, rootReal)) throw new Error('Nexus task source escapes its declared root');

  const targetReal = fs.realpathSync(target);
  if (!isContained(targetReal, rootReal)) {
    throw new Error('Nexus task source escapes its declared root via a link');
  }
  const stat = fs.statSync(targetReal);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Source exceeds read boundary');
  const text = fs.readFileSync(targetReal, 'utf8');
  return {
    source,
    source_kind: 'NEXUS_COMPANY_BOARD',
    source_root: rootReal,
    state: 'AVAILABLE',
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    modified_at: stat.mtime.toISOString(),
    content: text,
    data: JSON.parse(text),
  };
}

function readHoadhaDocumentSource(workspaceRoot, source) {
  const filename = path.basename(source);
  if (!HOADHA_DOCUMENT_SOURCES.includes(source) || source !== `${HOADHA_ROOT}/${filename}`) {
    throw new Error('Source outside the declared Hoadha document surface');
  }
  const localRoot = workspaceRoot && path.resolve(workspaceRoot, HOADHA_ROOT);
  const sourceRoot =
    localRoot && fs.existsSync(localRoot) ? localRoot : HOADHA_COMPANY_DOCUMENT_ROOT;
  const rootReal = fs.realpathSync(sourceRoot);
  const target = path.resolve(rootReal, filename);
  if (!isContained(target, rootReal)) throw new Error('Hoadha document escapes its declared root');

  const targetReal = fs.realpathSync(target);
  if (!isContained(targetReal, rootReal)) {
    throw new Error('Hoadha document escapes its declared root via a link');
  }
  const stat = fs.statSync(targetReal);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Source exceeds read boundary');
  const text = fs.readFileSync(targetReal, 'utf8');
  return {
    source,
    source_kind: 'HOADHA_COMPANY_DOCUMENT',
    source_root: rootReal,
    state: 'AVAILABLE',
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    modified_at: stat.mtime.toISOString(),
    content: text,
    data: source.endsWith('.json') ? JSON.parse(text) : text,
  };
}

export function readBuildingSource(root, source) {
  try {
    if (!root) throw new Error('Workspace unresolved');
    if (NEXUS_TASK_SOURCES.includes(source)) return readNexusTaskSource(root, source);
    if (HOADHA_DOCUMENT_SOURCES.includes(source)) return readHoadhaDocumentSource(root, source);
    const guard = resolveReadOnlyTarget({
      workspaceRoot: root,
      requested: source,
      allowed: BUILDING_SOURCES,
    });
    if (!guard.ok) throw new Error(guard.error);
    const stat = fs.statSync(guard.resolved);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
      throw new Error('Source exceeds read boundary');
    const text = fs.readFileSync(guard.resolved, 'utf8');
    const data = source.endsWith('.json') ? JSON.parse(text) : text;
    return {
      source,
      state: 'AVAILABLE',
      sha256: crypto.createHash('sha256').update(text).digest('hex'),
      modified_at: stat.mtime.toISOString(),
      content: text,
      data,
    };
  } catch (error) {
    return {
      source,
      state: error.code === 'ENOENT' || !root ? 'UNAVAILABLE' : 'UNREADABLE',
      reason: error.message,
      data: null,
    };
  }
}
function table(text) {
  return typeof text === 'string'
    ? text
        .split(/\r?\n/)
        .filter((l) => l.startsWith('|'))
        .map((l) =>
          l
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim().replaceAll('`', '')),
        )
        .filter((c) => c.length && !c[0].startsWith('---'))
    : [];
}
function rows(source, collection) {
  if (
    !source.data ||
    !Array.isArray(source.data.tasks) ||
    !source.data.tasks.every((t) => t && typeof t.id === 'string')
  )
    return null;
  return source.data.tasks.map((t) => ({ ...t, collection, source: source.source }));
}
export function buildBuilding(root, surface) {
  const loaded = BUILDING_SOURCES.map((s) => readBuildingSource(root, s));
  const get = (suffix) => loaded.find((s) => s.source.endsWith(suffix));
  const machine = get('roadmap.machine.json');
  const roadmap = machine.data;
  const validLoops =
    Array.isArray(roadmap?.loops) &&
    roadmap.loops.every(
      (l) => l && typeof l.id === 'string' && typeof l.state === 'string' && Array.isArray(l.tasks),
    );
  const validRoadmap = validLoops && typeof roadmap?.current_wave === 'string';
  const boards = ['hoadha', 'hoadha-social', 'hoadha-concierge'].map((p, i) => {
    const source = get(`/${p}-tasks.json`);
    const records = rows(source, p);
    return {
      project: p,
      source: source.source,
      state:
        records === null
          ? source.state === 'AVAILABLE'
            ? 'UNREADABLE'
            : source.state
          : records.length === EXPECTED[i]
            ? 'MATCH'
            : 'DRIFT',
      count: records?.length ?? null,
      expected: EXPECTED[i],
      records: records ?? [],
    };
  });
  const reconciliation = get('TASK_RECONCILIATION.md');
  const proposed = table(reconciliation.data)
    .filter((c) => /^HCD-H\d+-\d+$/.test(c[0]))
    .map((c) => ({
      id: c[0],
      wave: c[1],
      title: c[2],
      status: c[3],
      collection: 'PROPOSED',
      source: reconciliation.source,
    }));
  const waves = table(get('DEVELOPMENT_WAVES.md').data)
    .filter((c) => /^H\d+\s/.test(c[0]))
    .map((c) => ({
      id: c[0].match(/^H\d+/)[0],
      title: c[0],
      objective: c[1],
      entry: c[2],
      invariant: c[3],
      source: get('DEVELOPMENT_WAVES.md').source,
    }));
  const stages = table(get('LOOP_STAGE_MATRIX.md').data)
    .filter((c) => /^(C2G|N2D|O2K|S2A|A2F|C2C)$/.test(c[0]))
    .map((c) => ({
      loop: c[0],
      stages: c[1],
      state: c[2],
      evidence: c[3],
      source: get('LOOP_STAGE_MATRIX.md').source,
    }));
  const evidence = table(get('EVIDENCE_INDEX.md').data)
    .filter((c) => c[0] !== 'Claim area')
    .map((c) => ({ claim: c[0], evidence: c[1], source: get('EVIDENCE_INDEX.md').source }));
  const errors = loaded.filter((s) => s.state !== 'AVAILABLE');
  const complete = boards.every((b) => b.count !== null);
  const integrity = errors.length
    ? 'UNAVAILABLE'
    : boards.some((b) => b.state === 'DRIFT') ||
        proposed.length !== 33 ||
        waves.map((w) => w.id).join(',') !== 'H0,H1,H2,H3,H4,H5,H6,H7,H8,H9,H10' ||
        !validRoadmap ||
        roadmap.loops.map((l) => l.id).join(',') !== 'C2G,N2D,O2K,S2A,A2F,C2C'
      ? 'DRIFT'
      : 'SOURCE_READ';
  return {
    authority: 'DERIVED_PROJECTION',
    access: 'READ_ONLY',
    company: 'Starq Technologies',
    floor: 'Dev Studio',
    capacity: {
      state: 'UNKNOWN',
      reason:
        'No canonical provider quota projection declared. Session presence is not available quota.',
    },
    projects: [
      {
        id: 'erp',
        name: 'starqERP',
        classification: 'OCCUPIED',
        state: surface.process_truth?.hold_state?.implementation ?? 'UNKNOWN',
        source: '00_STARQ_HQ/operations/starqerp-control-board/contract.json',
      },
      {
        id: 'hoadha',
        name: 'Hoadha',
        classification: machine.state === 'AVAILABLE' && validRoadmap ? 'PREPARED' : 'UNAVAILABLE',
        state: 'NOT STARTED',
        source: machine.source,
      },
      {
        id: 'ai',
        name: 'starqAI',
        classification: 'FRAMEWORK_ONLY',
        state: 'NO OPERATIONAL SOURCE',
        source: 'STARQ_COMMAND_MASTER_OPERATING_BUILDING_PLAN_2026-09-30.md',
      },
    ],
    hoadha: {
      integrity,
      source_status: roadmap?.status ?? 'UNKNOWN',
      current_wave: roadmap?.current_wave ?? 'UNKNOWN',
      execution: 'NOT STARTED',
      execution_basis:
        'Prepared roadmap is not execution authorization; PHASE_7_DEV_STUDIO_DUAL_ROOM_BUILD_PACKET.md',
      production: 'UNKNOWN / UNVERIFIED',
      integration: 'UNAVAILABLE / UNVERIFIED',
      loops: validLoops ? roadmap.loops : [],
      blockers: Array.isArray(roadmap?.root_blockers) ? roadmap.root_blockers : [],
      boards,
      live_count: complete ? boards.reduce((sum, b) => sum + b.count, 0) : null,
      proposed_count: reconciliation.state === 'AVAILABLE' ? proposed.length : null,
      proposed,
      waves,
      stages,
      evidence,
      board_snapshot: roadmap?.board_snapshot ?? null,
    },
    erp_tasks: rows(get('/starq-erp-tasks.json'), 'starqERP'),
    sources: loaded.map(({ data, content, ...metadata }) => metadata),
    note: 'Source hashes prove the files read, not production deployment or independent acceptance. Command summarizes → Room proves.',
  };
}
