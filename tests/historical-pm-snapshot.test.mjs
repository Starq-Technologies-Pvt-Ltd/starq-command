/**
 * Focused offline tests for the historical PM snapshot adapter (#10634).
 * Fixture inputs only: boards are written under OS temp. Canonical Nexus
 * boards, pm-board.db, live routes, and existing Command files are not read.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  HISTORICAL_NEXUS_WORKSPACE_ROOT,
  HISTORICAL_PM_BOARD_SOURCES,
  HISTORICAL_PM_EXPECTED_COUNTS,
  isForbiddenHistoricalMirror,
  loadHistoricalPmSnapshot,
} from '../server/historical-pm-snapshot.mjs';

const ADAPTER_SRC = readFileSync(
  fileURLToPath(new URL('../server/historical-pm-snapshot.mjs', import.meta.url)),
  'utf8',
);

function sha(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function writeBoard(root, relative, tasks, extra = {}) {
  const abs = path.join(root, ...relative.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  const payload = `${JSON.stringify({ project: relative, tasks, ...extra })}\n`;
  writeFileSync(abs, payload);
  return { abs, payload, digest: sha(Buffer.from(payload)) };
}

function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), 'historical-pm-snapshot-'));
}

function nTasks(prefix, n, extra = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
    title: `${prefix} row ${i + 1}`,
    status: i % 2 === 0 ? 'todo' : 'done',
    depends_on: i > 0 ? [`${prefix}-${String(i).padStart(3, '0')}`] : [],
    workers: ['cipher'],
    ...extra(i),
  }));
}

test('live historical workspace root is D:\\\\!starq, not the Projects mirror', () => {
  assert.equal(HISTORICAL_NEXUS_WORKSPACE_ROOT, 'D:\\!starq');
  assert.equal(isForbiddenHistoricalMirror('D:\\StarqTech\\Projects'), true);
  assert.equal(isForbiddenHistoricalMirror('D:\\StarqTech\\Projects\\StarqNexus'), true);
  assert.equal(isForbiddenHistoricalMirror('D:\\!starq'), false);
  const refused = loadHistoricalPmSnapshot({ workspaceRoot: 'D:\\StarqTech\\Projects' });
  assert.equal(refused.records.length, 0);
  assert.match(refused.reason, /not historical authority/);
});

test('contract constants are the 763-row historical boards from #10623', () => {
  assert.deepEqual(HISTORICAL_PM_BOARD_SOURCES, [
    'starqNexus/data/starq-erp-tasks.json',
    'starqNexus/data/hoadha-tasks.json',
    'starqNexus/data/hoadha-social-tasks.json',
    'starqNexus/data/hoadha-concierge-tasks.json',
  ]);
  assert.deepEqual(HISTORICAL_PM_EXPECTED_COUNTS, {
    erp: 437,
    hoadha_core: 243,
    hoadha_social: 56,
    hoadha_concierge: 27,
    total: 763,
  });
  assert.equal(
    HISTORICAL_PM_EXPECTED_COUNTS.erp
      + HISTORICAL_PM_EXPECTED_COUNTS.hoadha_core
      + HISTORICAL_PM_EXPECTED_COUNTS.hoadha_social
      + HISTORICAL_PM_EXPECTED_COUNTS.hoadha_concierge,
    763,
  );
});

test('adapter source is read-only: no writes, sqlite, pm_tasks, or workspace auto-resolve', () => {
  const code = ADAPTER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /writeFileSync|appendFileSync|DatabaseSync|resolveWorkspace/);
  assert.doesNotMatch(code, /INSERT INTO|CREATE TABLE|pm-service|pm-board\.db/);
  assert.match(code, /readFileSync/);
  assert.match(code, /workspaceRoot is required/);
  assert.match(code, /kind: 'historical_snapshot'/);
});

test('missing workspaceRoot fail-closes without reading canonical data', () => {
  const snap = loadHistoricalPmSnapshot();
  assert.equal(snap.records.length, 0);
  assert.equal(snap.pm_tasks_created, 0);
  assert.match(snap.reason, /workspaceRoot is required/);
});

test('preserves raw status, relations, and provenance without mapping or inference', () => {
  const root = makeRoot();
  try {
    const erp = writeBoard(root, 'starqNexus/data/starq-erp-tasks.json', [
      {
        id: 'SERP-001',
        title: 'Keep planned',
        status: 'planned',
        depends_on: ['SERP-000'],
        workers: ['codex', 'cursor'],
        lane: 'engine',
        priority: 'P1',
      },
    ]);
    writeBoard(root, 'starqNexus/data/hoadha-tasks.json', [
      {
        id: 'DHIV-IS-T1',
        title: 'Identity API',
        status: 'preserved',
        depends_on: ['DHIV-PAY-T5'],
        workers: ['cipher', 'quill'],
        epic: 'DHIV-IDENTITY-STANDARD',
      },
      {
        id: 'DHIV-IS-T2',
        title: 'Identity Standard',
        status: 'preserved',
        depends_on: ['DHIV-IS-T1'],
        workers: ['quill'],
      },
    ]);
    writeBoard(root, 'starqNexus/data/hoadha-social-tasks.json', [
      { id: 'HSOC-1', status: 'todo', depends_on: [], workers: ['quill'] },
    ]);
    writeBoard(root, 'starqNexus/data/hoadha-concierge-tasks.json', [
      { id: 'HIE-1', status: 'in_progress', depends_on: ['HSOC-1'], blocked_by: ['HSOC-1'] },
    ]);

    const snap = loadHistoricalPmSnapshot({ workspaceRoot: root });
    assert.equal(snap.authority, 'HISTORICAL_SNAPSHOT');
    assert.equal(snap.access, 'READ_ONLY');
    assert.equal(snap.actionable, false);
    assert.equal(snap.pm_tasks_created, 0);
    assert.equal(snap.pm_status_log_created, 0);
    assert.equal(snap.records.length, 5);
    assert.equal(snap.records.every((row) => row.kind === 'historical_snapshot' && row.actionable === false), true);

    const planned = snap.records.find((row) => row.source_id === 'SERP-001');
    assert.equal(planned.status, 'planned');
    assert.equal(planned.status === 'BACKLOG' || planned.status === 'READY', false);
    assert.deepEqual(planned.relations.depends_on, ['SERP-000']);
    assert.deepEqual(planned.relations.workers, ['codex', 'cursor']);
    assert.equal('owner' in planned, false);
    assert.equal('verifier' in planned, false);
    assert.equal('room_authorization_ref' in planned, false);
    assert.equal('owner' in planned.raw, false);
    assert.equal(planned.raw.lane, 'engine');
    assert.equal(planned.source_path, 'starqNexus/data/starq-erp-tasks.json');
    assert.equal(planned.source_sha256, erp.digest);
    assert.equal(planned.source_row_index, 0);

    const preserved = snap.records.filter((row) => row.board === 'hoadha_core');
    assert.deepEqual(preserved.map((row) => row.source_id), ['DHIV-IS-T1', 'DHIV-IS-T2']);
    assert.equal(preserved.every((row) => row.status === 'preserved'), true);
    assert.equal(preserved[1].source_row_index, 1);
    assert.deepEqual(preserved[1].relations.depends_on, ['DHIV-IS-T1']);

    const concierge = snap.records.find((row) => row.source_id === 'HIE-1');
    assert.equal(concierge.status, 'in_progress');
    assert.deepEqual(concierge.relations.blocked_by, ['HSOC-1']);
    assert.equal(snap.count_match, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fixture matching 437/243/56/27 yields unique 763 and includes preserved DHIV-IS rows', () => {
  const root = makeRoot();
  try {
    const core = [
      ...nTasks('DHIV', 241),
      {
        id: 'DHIV-IS-T1',
        title: 'Hoadha Identity API',
        status: 'preserved',
        depends_on: ['DHIV-PAY-T5'],
        workers: ['cipher', 'quill'],
      },
      {
        id: 'DHIV-IS-T2',
        title: 'Hoadha Identity Standard',
        status: 'preserved',
        depends_on: ['DHIV-IS-T1'],
        workers: ['quill'],
      },
    ];
    writeBoard(root, 'starqNexus/data/starq-erp-tasks.json', nTasks('SERP', 437));
    writeBoard(root, 'starqNexus/data/hoadha-tasks.json', core);
    writeBoard(root, 'starqNexus/data/hoadha-social-tasks.json', nTasks('HSOC', 56));
    writeBoard(root, 'starqNexus/data/hoadha-concierge-tasks.json', nTasks('HIE', 27));

    const snap = loadHistoricalPmSnapshot({ workspaceRoot: root });
    assert.deepEqual(snap.counts, {
      erp: 437, hoadha_core: 243, hoadha_social: 56, hoadha_concierge: 27, total: 763,
    });
    assert.equal(snap.count_match, true);
    assert.equal(snap.unique_source_ids.length, 763);
    assert.equal(snap.duplicate_source_ids.length, 0);
    assert.equal(snap.unique_id_match, true);
    assert.equal(snap.unique_source_ids.includes('DHIV-IS-T1'), true);
    assert.equal(snap.unique_source_ids.includes('DHIV-IS-T2'), true);
    const t1 = snap.records.find((row) => row.source_id === 'DHIV-IS-T1');
    assert.equal(t1.status, 'preserved');
    assert.equal(t1.board, 'hoadha_core');
    assert.equal(t1.source_row_index, 241);
    assert.equal(snap.pm_tasks_created, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('idempotent snapshot and source file bytes are unchanged', () => {
  const root = makeRoot();
  try {
    const files = [
      writeBoard(root, 'starqNexus/data/starq-erp-tasks.json', nTasks('SERP', 2)),
      writeBoard(root, 'starqNexus/data/hoadha-tasks.json', nTasks('DHIV', 2)),
      writeBoard(root, 'starqNexus/data/hoadha-social-tasks.json', nTasks('HSOC', 1)),
      writeBoard(root, 'starqNexus/data/hoadha-concierge-tasks.json', nTasks('HIE', 1)),
    ];
    const before = files.map((file) => sha(readFileSync(file.abs)));
    const first = loadHistoricalPmSnapshot({ workspaceRoot: root });
    const second = loadHistoricalPmSnapshot({ workspaceRoot: root });
    const after = files.map((file) => sha(readFileSync(file.abs)));
    assert.deepEqual(after, before);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.records[0].raw === second.records[0].raw, false);
    first.records[0].raw.title = 'mutated';
    assert.notEqual(second.records[0].raw.title, 'mutated');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate source ids are preserved as separate rows and reported', () => {
  const root = makeRoot();
  try {
    writeBoard(root, 'starqNexus/data/starq-erp-tasks.json', [
      { id: 'DUP-1', status: 'todo', depends_on: [] },
    ]);
    writeBoard(root, 'starqNexus/data/hoadha-tasks.json', [
      { id: 'DUP-1', status: 'done', depends_on: ['X'] },
    ]);
    writeBoard(root, 'starqNexus/data/hoadha-social-tasks.json', []);
    writeBoard(root, 'starqNexus/data/hoadha-concierge-tasks.json', []);
    const snap = loadHistoricalPmSnapshot({ workspaceRoot: root });
    assert.equal(snap.records.length, 2);
    assert.deepEqual(snap.duplicate_source_ids, ['DUP-1']);
    assert.equal(snap.records[0].status, 'todo');
    assert.equal(snap.records[1].status, 'done');
    assert.equal(snap.unique_id_match, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses undeclared paths and does not open pm_tasks databases', () => {
  const root = makeRoot();
  try {
    mkdirSync(path.join(root, 'data'), { recursive: true });
    writeFileSync(path.join(root, 'data', 'pm-board.db'), 'not-a-db');
    writeBoard(root, 'starqNexus/data/starq-erp-tasks.json', [{ id: 'SERP-001', status: 'todo' }]);
    const snap = loadHistoricalPmSnapshot({
      workspaceRoot: root,
      sources: ['data/pm-board.db'],
    });
    assert.equal(snap.records.length, 0);
    assert.match(snap.reason, /allowlist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
