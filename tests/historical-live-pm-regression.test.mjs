import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initSchema, seedProjects, setDbForTesting, portfolio } from '../server/pm-service.mjs';

test('historical numerator/denominator unchanged when a LIVE row is added (real aggregation)', () => {
  const db = new DatabaseSync(':memory:');
  initSchema(db);
  seedProjects(db);
  setDbForTesting(db);

  // Seed one historical DONE task and one historical TODO task for project 'command'
  db.prepare(`INSERT INTO pm_tasks (id, project_id, title, status, provenance, created_by, created_at, updated_at)
    VALUES ('H-1','command','hist done','DONE','HISTORICAL_NEXUS','nexus-import','2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO pm_tasks (id, project_id, title, status, provenance, created_by, created_at, updated_at)
    VALUES ('H-2','command','hist todo','TODO','HISTORICAL_NEXUS','nexus-import','2026-01-01','2026-01-01')`).run();

  const before = portfolio().projects.find((p) => p.id === 'command');
  assert.equal(before.done_historical, 1);
  assert.equal(before.historical_total, 2);

  // Add a LIVE row (DONE) — should not affect historical counts
  db.prepare(`INSERT INTO pm_tasks (id, project_id, title, status, provenance, created_by, created_at, updated_at)
    VALUES ('L-1','command','live done','DONE','LIVE','ali','2026-01-02','2026-01-02')`).run();

  const after = portfolio().projects.find((p) => p.id === 'command');
  assert.equal(after.done_historical, before.done_historical, 'done_historical unchanged');
  assert.equal(after.historical_total, before.historical_total, 'historical_total unchanged');
  // Sanity: total changed due to live row
  assert.equal(after.total, before.total + 1);
});
