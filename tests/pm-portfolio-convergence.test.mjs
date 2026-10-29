import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  initSchema,
  seedProjects,
  seedCurrentCommandWork,
  setDbForTesting,
  listTasks,
  taskDetail,
  portfolio,
  readRoadmapsData,
  executionQualifier,
} from '../server/pm-service.mjs';
import {
  importNexusBoards,
  importLegacyPmSnapshot,
  NEXUS_BOARDS,
  NEXUS_DATA_ROOT,
} from '../server/nexus-kanban.mjs';
import {
  restoreCollidedRecords,
  backfillNexusAttributes,
  ensureFidelityColumns,
} from '../server/nexus-fidelity.mjs';
import { seedOperatingOrg } from '../server/operating-org.mjs';
import { resolveWorkspace, CANONICAL, abs } from '../server/paths.mjs';

test('WP-0: Full Portfolio & Source Convergence (18 Nexus boards, 1,349 tasks, fidelity)', () => {
  const ws = resolveWorkspace();
  const root = ws.root;
  assert.ok(root, 'Workspace root must resolve');

  const nowIso = () => '2026-10-28T12:00:00.000Z';
  const json = (v) => JSON.stringify(v);

  const db = new DatabaseSync(':memory:');
  initSchema(db);
  seedProjects(db);
  seedOperatingOrg(db, nowIso);
  seedCurrentCommandWork(db);

  // 1. Verify 18 board files in NEXUS_BOARDS (19 total including native command)
  const boardFiles = NEXUS_BOARDS.filter((b) => b.file);
  assert.equal(boardFiles.length, 18, 'Must have 18 Nexus board files');
  assert.ok(NEXUS_BOARDS.some((b) => b.id === 'starqbooks' && b.file === 'starqbooks-tasks.json'));

  // 2. Import all Nexus boards
  const importSummary = importNexusBoards(db, {
    nowIso,
    json,
    dataRoot: NEXUS_DATA_ROOT,
  });
  assert.equal(importSummary.boards.length, 19);

  // 3. Import legacy PM snapshot
  const legacyDbPath = abs(root, CANONICAL.pmBoardLegacyDb);
  const legacySummary = importLegacyPmSnapshot(db, {
    dbPath: legacyDbPath,
    nowIso,
    json,
  });
  assert.equal(legacySummary.preserved, 4, 'Legacy Command PM snapshot has 4 tasks');

  // 4. Restore collided records (SPOS-008 in starq-pos-tasks.json)
  const boardsById = Object.fromEntries(boardFiles.map((b) => [b.file, b.id]));
  const restored = restoreCollidedRecords(db, { nowIso, boardsById });
  assert.equal(restored.length, 1, 'Exactly one collision (SPOS-008:pos) restored');
  assert.equal(restored[0].stored_as, 'SPOS-008:pos');

  // 5. Backfill Nexus fidelity attributes
  ensureFidelityColumns(db);
  const fill = backfillNexusAttributes(db);
  assert.ok(fill.considered >= 1345, 'At least 1,345 records considered for fidelity');

  // Set test db on pm-service
  setDbForTesting(db);

  // 6. Verify total task counts: 1,345 historical + 4 native = 1,349 tasks
  const totalTasks = Number(db.prepare('SELECT COUNT(*) AS n FROM pm_tasks').get().n);
  const historicalTasks = Number(db.prepare("SELECT COUNT(*) AS n FROM pm_tasks WHERE provenance = 'HISTORICAL_NEXUS'").get().n);
  const liveTasks = Number(db.prepare("SELECT COUNT(*) AS n FROM pm_tasks WHERE provenance = 'LIVE'").get().n);

  assert.equal(totalTasks, 1349, 'Total tasks must be exactly 1,349');
  assert.equal(historicalTasks, 1345, 'Historical tasks must be exactly 1,345');
  assert.equal(liveTasks, 4, 'Live native tasks must be exactly 4');

  // 7. Verify starqBooks (SBK) board: 40 tasks imported
  const sbkTasks = db.prepare("SELECT * FROM pm_tasks WHERE project_id = 'starqbooks' ORDER BY id").all();
  assert.equal(sbkTasks.length, 40, 'starqBooks must have 40 tasks imported');
  const sbk000 = sbkTasks.find((t) => t.id === 'SBK-000');
  assert.ok(sbk000, 'SBK-000 must exist');
  assert.equal(sbk000.epic, 'SBK-E00');
  assert.equal(sbk000.sprint, 'Goal 1 - Definition');
  assert.equal(sbk000.lane, 'Definition');
  assert.equal(sbk000.phase, 'Goal 1 - ERP-ready core');
  assert.equal(sbk000.priority_raw, 'P0');
  assert.ok(sbk000.acceptance_json, 'SBK-000 must have acceptance_json');

  // 8. Verify SPOS-008 collision resolution and provenance
  const erpSource = db.prepare("SELECT * FROM pm_source_records WHERE task_id = 'SPOS-008'").get();
  assert.ok(erpSource, 'SPOS-008 source record must exist');
  assert.equal(erpSource.resolution, 'IMPORTED');
  assert.equal(erpSource.source_file, 'starq-erp-tasks.json');

  const posSource = db.prepare("SELECT * FROM pm_source_records WHERE task_id = 'SPOS-008:pos'").get();
  assert.ok(posSource, 'SPOS-008:pos source record must exist');
  assert.equal(posSource.resolution, 'IMPORTED');
  assert.equal(posSource.source_file, 'starq-pos-tasks.json');

  const erpDetail = taskDetail('SPOS-008');
  assert.equal(erpDetail.task.project_id, 'erp');
  assert.ok(erpDetail.source_record, 'SPOS-008 taskDetail must return source_record');
  assert.equal(erpDetail.source_record.resolution, 'IMPORTED');
  assert.equal(erpDetail.source_record.source_file, 'starq-erp-tasks.json');

  const posDetail = taskDetail('SPOS-008:pos');
  assert.equal(posDetail.task.project_id, 'pos');
  assert.ok(posDetail.source_record, 'SPOS-008:pos taskDetail must return source_record');
  assert.equal(posDetail.source_record.resolution, 'IMPORTED');
  assert.equal(posDetail.source_record.source_file, 'starq-pos-tasks.json');

  // 9. Verify legacy PM snapshot links preserved as ARCHIVED_ID_COLLISION (P-1)
  for (let i = 1; i <= 4; i++) {
    const id = `PM-CMD-00${i}`;
    const legacyRec = db.prepare("SELECT * FROM pm_source_records WHERE source_key = ?").get(`command-pm-v1:${id}`);
    assert.ok(legacyRec, `Legacy record for ${id} must exist`);
    assert.equal(legacyRec.resolution, 'ARCHIVED_ID_COLLISION');
    assert.equal(legacyRec.task_id, null);

    const cmdDetail = taskDetail(id);
    assert.ok(!cmdDetail.source_record, `taskDetail('${id}') must not link to legacy archived record`);
  }

  // 10. Verify API: listTasks() returns fidelity columns
  const allHydratedTasks = listTasks(null);
  assert.equal(allHydratedTasks.length, 1349);
  const sample = allHydratedTasks.find((t) => t.id === 'SBK-000');
  assert.ok('epic' in sample);
  assert.ok('sprint' in sample);
  assert.ok('milestone' in sample);
  assert.ok('release_track' in sample);
  assert.ok('workers' in sample);
  assert.ok('priority_raw' in sample);
  assert.ok('acceptance_json' in sample);
  assert.ok('evidence_json' in sample);
  assert.ok('verification_json' in sample);
  assert.ok('stage' in sample);
  assert.ok('prior_stage' in sample);
  assert.ok('provenance' in sample);
  assert.ok('gated' in sample);
  assert.ok('allowed_stage_next' in sample);

  // 11. Verify portfolio() structure and qualifiers
  const port = portfolio();
  assert.ok(Array.isArray(port.projects));
  assert.ok(port.projects.some((p) => p.id === 'starqbooks'));
  assert.ok(port.projects.some((p) => p.id === 'buzzlab'));

  const erpP = port.projects.find((p) => p.id === 'erp');
  assert.equal(erpP.execution_qualifier, 'ON_HOLD');
  assert.ok('done_historical' in erpP);
  assert.ok('stages' in erpP);
  assert.ok('provenance' in erpP);

  const hoadhaP = port.projects.find((p) => p.id === 'hoadha');
  assert.equal(hoadhaP.execution_qualifier, 'PRE_ACTIVATION');

  const posP = port.projects.find((p) => p.id === 'pos');
  assert.equal(posP.execution_qualifier, 'HISTORICAL');

  const sbkP = port.projects.find((p) => p.id === 'starqbooks');
  assert.equal(sbkP.execution_qualifier, 'HISTORICAL');
  assert.equal(sbkP.total, 40);

  const buzzP = port.projects.find((p) => p.id === 'buzzlab');
  assert.equal(buzzP.execution_qualifier, 'SANDBOX');

  // 12. Verify roadmaps data
  const roadmaps = readRoadmapsData();
  assert.equal(roadmaps.chains_count, 5);
  assert.equal(roadmaps.stages_count, 49);
  assert.equal(roadmaps.gaps_count, 8);
  assert.ok(Array.isArray(roadmaps.milestones));

  db.close();
});
