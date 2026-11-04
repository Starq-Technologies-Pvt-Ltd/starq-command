import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { attention, initSchema, seedProjects, setDbForTesting } from '../server/pm-service.mjs';

test('Founder gate projection separates current gates from generic attention and historical records', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  initSchema(db);
  seedProjects(db);
  setDbForTesting(db);

  const insert = db.prepare(`
    INSERT INTO pm_tasks (
      id, project_id, title, status, owner, verifier, created_by,
      created_at, updated_at, stage, provenance
    ) VALUES (?, 'command', ?, ?, 'codex', 'mustarq', ?, '2026-11-04', '2026-11-04', ?, ?)
  `);
  insert.run('CMD-BLOCKED', 'Blocked but not a Founder gate', 'BLOCKED', 'codex', 'BLOCKED', 'LIVE');
  insert.run('CMD-PROGRESS', 'In progress but not a Founder gate', 'IN_PROGRESS', 'codex', 'IN_PROGRESS', 'LIVE');
  insert.run('CMD-FOUNDER-GATE', 'Explicit current Founder gate', 'BLOCKED', 'codex', 'FOUNDER_GATE', 'LIVE');
  insert.run('HIST-FOUNDER-GATE', 'Historical gate evidence', 'BLOCKED', 'nexus-import', 'FOUNDER_GATE', 'HISTORICAL_NEXUS');
  insert.run('DONE-FOUNDER-GATE', 'Closed gate', 'DONE', 'codex', 'FOUNDER_GATE', 'LIVE');

  const result = attention();
  assert.equal(result.founder_gate, 1);
  assert.deepEqual(result.founder_gate_actions.map((task) => task.task_id), ['CMD-FOUNDER-GATE']);
  assert.equal(result.founder_gate_actions[0].stage, 'FOUNDER_GATE');
  assert.equal(result.founder_gate_actions[0].reason, 'blocked');

  assert.ok(result.next_actions.some((task) => task.task_id === 'CMD-BLOCKED'));
  assert.ok(result.next_actions.some((task) => task.task_id === 'CMD-PROGRESS'));
  assert.ok(result.next_actions.some((task) => task.task_id === 'HIST-FOUNDER-GATE'));
  assert.ok(!result.next_actions.some((task) => task.task_id === 'DONE-FOUNDER-GATE'));
  assert.equal(result.next_actions.find((task) => task.task_id === 'CMD-PROGRESS').stage, 'IN_PROGRESS');
});
