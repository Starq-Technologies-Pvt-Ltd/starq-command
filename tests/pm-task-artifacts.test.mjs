import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  initSchema, seedProjects, seedCurrentCommandWork, setDbForTesting,
  updateTaskArtifacts, taskDetail, linkRoom, setRoomLookupForTesting,
} from '../server/pm-service.mjs';

test('PM task repository artifacts', async (t) => {
  let db;
  let taskId;
  let expected;

  const setup = () => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
    seedProjects(db);
    seedCurrentCommandWork(db);
    setDbForTesting(db);
    const row = db.prepare("SELECT id, updated_at FROM pm_tasks WHERE project_id = 'command' ORDER BY id LIMIT 1").get();
    taskId = row.id;
    expected = row.updated_at;
  };

  const cleanup = () => { setRoomLookupForTesting(null); db.close(); };

  await t.test('stores valid refs and appends one auditable event', () => {
    setup();
    try {
    const result = updateTaskArtifacts(taskId, {
      actor: 'reviewer', expected_updated_at: expected,
      branch: 'feature/task-artifacts', commit_sha: 'a'.repeat(40),
      pr_ref: '#42', pr_url: 'https://github.com/example/project/pull/42',
    });
    assert.deepEqual({ branch: result.task.branch, commit_sha: result.task.commit_sha, pr_ref: result.task.pr_ref, pr_url: result.task.pr_url }, {
      branch: 'feature/task-artifacts', commit_sha: 'a'.repeat(40),
      pr_ref: '#42', pr_url: 'https://github.com/example/project/pull/42',
    });
    assert.equal(result.history[0].event_type, 'ARTIFACTS_UPDATED');
    assert.equal(result.history[0].actor, 'reviewer');
    assert.equal(result.history[0].room_sync, 'NOT_REQUIRED');
    assert.deepEqual(result.history[0].detail.artifacts.branch, { from: null, to: 'feature/task-artifacts' });
    } finally { cleanup(); }
  });

  for (const [field, value] of [
    ['branch', 'bad branch'], ['branch', 'refs/heads/../escape'], ['commit_sha', 'abc123'],
    ['pr_ref', 'not-a-pr'], ['pr_url', 'http://github.com/example/project/pull/42'],
    ['pr_url', 'https://github.com/example/project/issues/42'],
  ]) await t.test(`rejects invalid ${field} value`, () => {
    setup();
    try {
      const before = taskDetail(taskId);
      assert.throws(() => updateTaskArtifacts(taskId, {
        actor: 'reviewer', expected_updated_at: expected, [field]: value,
      }));
      assert.equal(taskDetail(taskId).task.updated_at, before.task.updated_at);
      assert.equal(taskDetail(taskId).history.length, before.history.length);
    } finally { cleanup(); }
  });

  await t.test('uses optimistic concurrency and does not append on a stale write', () => {
    setup();
    try {
      updateTaskArtifacts(taskId, { actor: 'reviewer', expected_updated_at: expected, pr_ref: 'example/project#42' });
      assert.throws(() => updateTaskArtifacts(taskId, { actor: 'reviewer', expected_updated_at: expected, branch: 'other-branch' }),
        (error) => error.status === 409 && error.code === 'STALE_EDIT');
      assert.equal(taskDetail(taskId).history.filter((event) => event.event_type === 'ARTIFACTS_UPDATED').length, 1);
    } finally { cleanup(); }
  });

  await t.test('rejects empty artifact patches and permits explicit clearing', () => {
    setup();
    try {
      assert.throws(() => updateTaskArtifacts(taskId, { actor: 'reviewer', expected_updated_at: expected }), (error) => error.status === 400);
      updateTaskArtifacts(taskId, { actor: 'reviewer', expected_updated_at: expected, branch: 'feature/x' });
      const updated = taskDetail(taskId).task.updated_at;
      assert.equal(updateTaskArtifacts(taskId, { actor: 'reviewer', expected_updated_at: updated, branch: null }).task.branch, null);
    } finally { cleanup(); }
  });

  await t.test('links only the exact verified Room record with concurrency and an event', () => {
    setup();
    try {
      const eventId = 'b'.repeat(64);
      setRoomLookupForTesting((sequence) => ({
        sequence, eventId, recordHash: 'c'.repeat(64), senderHandle: 'ali', body: `Authorization for ${taskId}`,
        hashVerified: true, authorityAllowed: true, registryLevel: 'ROOT_GENESIS', isRoot: true, receivedAt: '2026-10-30T00:00:00Z',
      }));
      const linked = linkRoom(taskId, {
        actor: 'reviewer', expected_updated_at: expected, sequence: 16875, eventId,
        purpose: 'Authorize PM-CMD task work', kind: 'authorization',
      });
      assert.equal(linked.task.room_authorization_ref.sequence, 16875);
      assert.equal(linked.task.room_authorization_ref.eventId, eventId);
      assert.equal(linked.task.room_authorization_ref.root_authority, true);
      assert.equal(linked.task.room_authorization_ref.mentions_task, true);
      assert.equal(linked.history[0].event_type, 'ROOM_AUTHORIZATION_LINKED');
    } finally { cleanup(); }
  });

  await t.test('rejects Room eventId mismatch and stale Room links without mutation', () => {
    setup();
    try {
      setRoomLookupForTesting((sequence) => ({ sequence, eventId: 'c'.repeat(64), hashVerified: true, authorityAllowed: true, isRoot: true }));
      assert.throws(() => linkRoom(taskId, {
        actor: 'reviewer', expected_updated_at: expected, sequence: 16875, eventId: 'b'.repeat(64),
        purpose: 'Authorize PM-CMD task work', kind: 'authorization',
      }), (error) => error.status === 422 && error.code === 'ROOM_REF_MISMATCH');
      setRoomLookupForTesting((sequence) => ({
        sequence, eventId: 'b'.repeat(64), hashVerified: true, authorityAllowed: true,
        registryLevel: 'ROOT_GENESIS', isRoot: true, body: taskId,
      }));
      linkRoom(taskId, { actor: 'reviewer', expected_updated_at: expected, sequence: 16875, eventId: 'b'.repeat(64), purpose: 'Authorize task work', kind: 'authorization' });
      assert.throws(() => linkRoom(taskId, { actor: 'reviewer', expected_updated_at: expected, sequence: 16875, eventId: 'b'.repeat(64), purpose: 'Authorize task work', kind: 'authorization' }),
        (error) => error.status === 409 && error.code === 'STALE_EDIT');
      assert.equal(taskDetail(taskId).history.filter((event) => event.event_type === 'ROOM_AUTHORIZATION_LINKED').length, 1);
    } finally { cleanup(); }
  });
});
