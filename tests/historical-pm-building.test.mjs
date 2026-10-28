/**
 * Fixture-only Building projection wiring for historical Nexus records (#10646).
 * Does not start the Building service, does not read D:\\!starq or D:\\StarqTech\\Projects.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildBuilding } from '../server/building.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function nTasks(prefix, n, extra = []) {
  return [
    ...Array.from({ length: n }, (_, i) => ({
      id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
      title: `${prefix} ${i + 1}`,
      status: i % 3 === 0 ? 'planned' : 'todo',
      depends_on: [],
      workers: ['cipher'],
    })),
    ...extra,
  ];
}

function writeBoard(root, relative, tasks) {
  const abs = path.join(root, ...relative.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify({ tasks }));
}

test('buildBuilding does not auto-read canonical Nexus data without historicalWorkspaceRoot', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hist-pm-building-'));
  try {
    const building = buildBuilding(root, { process_truth: { hold_state: { implementation: 'ON_HOLD' } } });
    assert.equal(building.historical_pm.records.length, 0);
    assert.equal(building.historical_pm.pm_tasks_created, 0);
    assert.match(building.historical_pm.reason, /not auto-read/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fixture historicalWorkspaceRoot attaches 763 raw historical records to Building projection', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hist-pm-building-'));
  try {
    writeBoard(root, 'starqNexus/data/starq-erp-tasks.json', nTasks('SERP', 437));
    writeBoard(root, 'starqNexus/data/hoadha-tasks.json', nTasks('DHIV', 241, [
      { id: 'DHIV-IS-T1', status: 'preserved', depends_on: ['DHIV-PAY-T5'], workers: ['cipher'] },
      { id: 'DHIV-IS-T2', status: 'preserved', depends_on: ['DHIV-IS-T1'], workers: ['quill'] },
    ]));
    writeBoard(root, 'starqNexus/data/hoadha-social-tasks.json', nTasks('HSOC', 56));
    writeBoard(root, 'starqNexus/data/hoadha-concierge-tasks.json', nTasks('HIE', 27));

    const building = buildBuilding(root, { process_truth: { hold_state: { implementation: 'ON_HOLD' } } }, {
      historicalWorkspaceRoot: root,
    });
    const hist = building.historical_pm;
    assert.equal(hist.authority, 'HISTORICAL_SNAPSHOT');
    assert.equal(hist.access, 'READ_ONLY');
    assert.equal(hist.actionable, false);
    assert.deepEqual(hist.counts, {
      erp: 437, hoadha_core: 243, hoadha_social: 56, hoadha_concierge: 27, total: 763,
    });
    assert.equal(hist.count_match, true);
    assert.equal(hist.unique_id_match, true);
    assert.equal(hist.pm_tasks_created, 0);
    assert.equal(hist.pm_status_log_created, 0);
    assert.equal(hist.records.every((row) => row.kind === 'historical_snapshot' && row.actionable === false), true);
    const t1 = hist.records.find((row) => row.source_id === 'DHIV-IS-T1');
    assert.equal(t1.status, 'preserved');
    assert.equal(t1.status === 'CLOSED' || t1.status === 'ACCEPTANCE', false);
    assert.equal('owner' in t1, false);
    assert.equal('verifier' in t1, false);
    assert.ok(t1.source_sha256);
    assert.equal(typeof t1.source_row_index, 'number');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production Building origin consumes the configured historical source and excludes the mirror', () => {
  const service = readFileSync(path.join(ROOT, 'server', 'building-service.mjs'), 'utf8');
  assert.match(service, /HISTORICAL_NEXUS_WORKSPACE_ROOT/);
  assert.match(service, /historicalWorkspaceRoot: HISTORICAL_NEXUS_WORKSPACE_ROOT/);
  assert.doesNotMatch(service, /StarqTech\\\\Projects/);
  const adapter = readFileSync(path.join(ROOT, 'server', 'historical-pm-snapshot.mjs'), 'utf8');
  assert.match(adapter, /STARQ_NEXUS_WORKSPACE_ROOT/);
  assert.match(adapter, /STARQ_NEXUS_FORBIDDEN_MIRROR_ROOT/);
});

test('PM provenance stays separate from the read-only Building historical snapshot adapter', () => {
  const pm = readFileSync(path.join(ROOT, 'server', 'pm-service.mjs'), 'utf8');
  const data = readFileSync(path.join(ROOT, 'server', 'data-service.mjs'), 'utf8');
  assert.doesNotMatch(pm, /historical-pm-snapshot|historical_pm/);
  assert.doesNotMatch(data, /historical-pm-snapshot|historical_pm|HISTORICAL_NEXUS/);
  assert.match(pm, /provenance = 'HISTORICAL_NEXUS'/, 'PM retains its own historical import provenance');
});
