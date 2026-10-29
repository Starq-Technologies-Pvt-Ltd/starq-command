/**
 * Focused backend tests for the Command repository-status feed.
 *
 * Scope: the backend contract only (`server/repository-status.mjs` + its route
 * registration in `server/pm-service.mjs`). Cursor's UI contract lives in
 * `tests/pm-repository-status.test.tsx` and is not touched here.
 *
 * No test writes anything, starts the server, or contacts a remote.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIVE_REPOSITORY_PROJECTS,
  REPOSITORY_STATUS_SCHEMA,
  createRepositoryStatusService,
  loadRepositoryMap,
  probeRepository,
  redactRemote,
} from '../server/repository-status.mjs';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SERVER_DIR, '..');
const COMMAND_REPO = REPO_ROOT;

/** Scripted async Git double: records every invocation. */
function fakeGit(responses) {
  const calls = [];
  const git = async (repoPath, args) => {
    const key = args.join(' ');
    calls.push({ repoPath, key });
    const value = responses[key];
    if (value === undefined) return { ok: false, timedOut: false, reason: `unexpected git ${key}` };
    return typeof value === 'string' ? { ok: true, out: value } : value;
  };
  git.calls = calls;
  return git;
}

const HAPPY = {
  'rev-parse --abbrev-ref HEAD': 'pm-portfolio-convergence-20261028',
  'rev-parse --short HEAD': '4b40d698',
  'log -1 --format=%cI HEAD': '2026-10-28T12:00:00.000Z',
  'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/pm-portfolio-convergence-20261028',
  'status --porcelain=v1 --untracked-files=normal': ' M server/pm-service.mjs\n?? tests/new.test.mjs\n',
  'rev-list --left-right --count HEAD...@{upstream}': '0\t1',
};

test('schema id and the live repository set are exactly the contracted ones', () => {
  assert.equal(REPOSITORY_STATUS_SCHEMA, 'starq.command.repository_status/v1');
  assert.deepEqual([...LIVE_REPOSITORY_PROJECTS], ['command', 'erp']);
});

test('redacts credential-bearing remotes and leaves plain refs alone', () => {
  assert.equal(redactRemote(null), null);
  assert.equal(redactRemote(''), null);
  assert.equal(redactRemote('origin/main'), 'origin/main');
  assert.equal(redactRemote('https://user:secret@github.com/almstq/starqERP.git'), 'REDACTED');
  assert.equal(redactRemote('git@github.com:almstq/starqERP.git'), 'REDACTED');
});

test('repository_map is read from lifecycle.config.json for Command and ERP', () => {
  const { map, reason } = loadRepositoryMap();
  assert.equal(reason, null);
  assert.equal(typeof map.command?.path, 'string');
  assert.equal(typeof map.erp?.path, 'string');
  assert.ok(path.isAbsolute(map.command.path), 'Command path must be absolute');
  assert.ok(path.isAbsolute(map.erp.path), 'ERP path must be absolute');
  // Documented sharing: these three project ids resolve to the one ERP checkout.
  for (const shared of ['pos', 'starqbooks']) {
    if (map[shared]) assert.equal(map[shared].path, map.erp.path, `${shared} must not look independent`);
  }
});

test('probe returns the full contract row and asserts no task-completion meaning', async () => {
  const git = fakeGit(HAPPY);
  const entry = await probeRepository('command', COMMAND_REPO, { git });

  assert.equal(entry.project_id, 'command');
  assert.equal(entry.branch, 'pm-portfolio-convergence-20261028');
  assert.equal(entry.upstream, 'origin/pm-portfolio-convergence-20261028');
  assert.equal(entry.head, '4b40d698');
  assert.equal(entry.commit_time, '2026-10-28T12:00:00.000Z');
  assert.equal(entry.ahead, 0);
  assert.equal(entry.behind, 1);
  assert.equal(entry.dirty_file_count, 2);
  assert.ok(entry.last_origin_fetch === null || typeof entry.last_origin_fetch === 'string');
  assert.equal(entry.state, 'CURRENT');

  // Nothing in the row may read as task progress.
  for (const forbidden of ['task_id', 'task', 'status', 'done', 'verified', 'accepted', 'progress']) {
    assert.equal(Object.hasOwn(entry, forbidden), false, `row must not carry ${forbidden}`);
  }
  assert.deepEqual(Object.keys(entry).sort(), [
    'ahead', 'behind', 'branch', 'commit_time', 'dirty_file_count', 'head',
    'last_origin_fetch', 'project_id', 'reason', 'state', 'upstream',
  ]);
  // Counts come from @{upstream}, never from a fetch on this path.
  assert.ok(!git.calls.some((call) => call.key.includes('fetch')));
});

test('a URL upstream is redacted while ahead/behind are still counted', async () => {
  const git = fakeGit({
    ...HAPPY,
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'https://user:secret@github.com/almstq/starqERP.git',
    'rev-list --left-right --count HEAD...@{upstream}': '0\t3',
  });
  const entry = await probeRepository('erp', COMMAND_REPO, { git });
  assert.equal(entry.upstream, 'REDACTED');
  assert.equal(entry.ahead, 0);
  assert.equal(entry.behind, 3);
  assert.equal(entry.state, 'CURRENT');
  assert.ok(!JSON.stringify(entry).includes('secret'));
});

test('missing upstream keeps counts unknown instead of inventing zero', async () => {
  const git = fakeGit({
    ...HAPPY,
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { ok: false, timedOut: false, reason: "fatal: no upstream configured for branch 'main'" },
  });
  const entry = await probeRepository('command', COMMAND_REPO, { git });
  assert.equal(entry.upstream, null);
  assert.equal(entry.ahead, null);
  assert.equal(entry.behind, null);
  assert.equal(entry.state, 'CURRENT');
  assert.match(entry.reason, /No upstream branch/);
});

test('an unreadable HEAD is UNAVAILABLE, not a zero-valued row', async () => {
  const git = fakeGit({
    ...HAPPY,
    'rev-parse --short HEAD': { ok: false, timedOut: true, reason: 'git rev-parse --short HEAD timed out after 4000ms' },
  });
  const entry = await probeRepository('command', COMMAND_REPO, { git });
  assert.equal(entry.state, 'UNAVAILABLE');
  assert.equal(entry.head, null);
  assert.equal(entry.branch, null);
  assert.equal(entry.ahead, null);
  assert.equal(entry.dirty_file_count, null);
  assert.match(entry.reason, /timed out/);
});

test('a failing working-tree probe degrades to STALE rather than CURRENT', async () => {
  const git = fakeGit({
    ...HAPPY,
    'status --porcelain=v1 --untracked-files=normal': { ok: false, timedOut: true, reason: 'timed out' },
  });
  const entry = await probeRepository('command', COMMAND_REPO, { git });
  assert.equal(entry.state, 'STALE');
  assert.equal(entry.head, '4b40d698');
  assert.equal(entry.dirty_file_count, null);
  assert.match(entry.reason, /working-tree state could not be read/);
});

test('a detached HEAD reports a null branch with an explicit reason', async () => {
  const git = fakeGit({ ...HAPPY, 'rev-parse --abbrev-ref HEAD': 'HEAD' });
  const entry = await probeRepository('command', COMMAND_REPO, { git });
  assert.equal(entry.branch, null);
  assert.equal(entry.state, 'CURRENT');
  assert.match(entry.reason, /Detached HEAD/);
});

test('a path that does not exist, or is not a checkout, is UNRESOLVED', async () => {
  const missing = await probeRepository('erp', path.join(COMMAND_REPO, 'no-such-dir-oc-probe'), { git: fakeGit(HAPPY) });
  assert.equal(missing.state, 'UNRESOLVED');
  assert.equal(missing.head, null);
  assert.match(missing.reason, /does not exist/);

  const notRepo = await probeRepository('erp', path.join(COMMAND_REPO, 'server'), { git: fakeGit(HAPPY) });
  assert.equal(notRepo.state, 'UNRESOLVED');
  assert.match(notRepo.reason, /not a Git checkout/);

  const unmapped = await probeRepository('erp', null, { git: fakeGit(HAPPY), missingReason: 'no mapping' });
  assert.equal(unmapped.state, 'UNRESOLVED');
  assert.equal(unmapped.reason, 'no mapping');
});

test('snapshot is answered from cache: two live rows, no probe on the read path', async () => {
  const probed = [];
  const service = createRepositoryStatusService({
    repositoryMap: {
      command: { path: 'C:/repos/command' },
      erp: { path: 'C:/repos/erp' },
      pos: { path: 'C:/repos/erp' },
      starqbooks: { path: 'C:/repos/erp' },
      hoadha: { path: 'C:/repos/hoadha' },
    },
    now: () => Date.parse('2026-10-29T09:00:00.000Z'),
    probe: async (projectId, repoPath) => {
      probed.push({ projectId, repoPath });
      return {
        project_id: projectId,
        branch: 'main',
        upstream: 'origin/main',
        head: `head-${projectId}`,
        commit_time: '2026-10-29T08:59:00.000Z',
        ahead: 0,
        behind: 0,
        dirty_file_count: 1,
        last_origin_fetch: '2026-10-29T08:00:00.000Z',
        state: 'CURRENT',
        reason: null,
      };
    },
  });

  const before = service.snapshot();
  assert.equal(before.schema, REPOSITORY_STATUS_SCHEMA);
  assert.equal(before.generated_at, null);
  assert.deepEqual(before.repositories.map((row) => row.project_id), ['command', 'erp']);
  assert.ok(before.repositories.every((row) => row.state === 'UNAVAILABLE' && row.head === null));
  assert.equal(probed.length, 0, 'reading the feed must not run a probe');

  await service.refresh();
  const after = service.snapshot();
  assert.equal(after.generated_at, '2026-10-29T09:00:00.000Z');
  assert.equal(after.repositories.length, 2, 'shared or unmapped projects add no rows');
  assert.deepEqual(after.repositories.map((row) => row.project_id), ['command', 'erp']);
  assert.deepEqual(probed.map((call) => call.projectId), ['command', 'erp']);
  assert.equal(probed.find((call) => call.projectId === 'erp').repoPath, 'C:/repos/erp');
  assert.ok(after.repositories.every((row) => row.state === 'CURRENT'));

  const probesAfterRefresh = probed.length;
  service.snapshot();
  assert.equal(probed.length, probesAfterRefresh, 'repeat reads still run no probe');
  service.stop();
});

test('a failed refresh keeps last known facts and says STALE', async () => {
  let fail = false;
  const service = createRepositoryStatusService({
    repositoryMap: { command: { path: 'C:/repos/command' }, erp: { path: 'C:/repos/erp' } },
    now: () => Date.parse('2026-10-29T09:00:00.000Z'),
    probe: async (projectId) => {
      if (fail) throw new Error('git exploded');
      return {
        project_id: projectId,
        branch: 'main',
        upstream: 'origin/main',
        head: `head-${projectId}`,
        commit_time: '2026-10-29T08:59:00.000Z',
        ahead: 0,
        behind: 0,
        dirty_file_count: 0,
        last_origin_fetch: null,
        state: 'CURRENT',
        reason: null,
      };
    },
  });

  await service.refresh();
  assert.equal(service.snapshot().repositories[0].head, 'head-command');

  fail = true;
  await service.refresh();
  const stale = service.snapshot();
  assert.equal(stale.repositories[0].state, 'STALE');
  assert.equal(stale.repositories[0].head, 'head-command', 'facts survive the failed refresh');
  assert.match(stale.repositories[0].reason, /Repository probe failed: git exploded/);
  service.stop();
});

test('facts older than the staleness bound are downgraded on read', async () => {
  let clockMs = Date.parse('2026-10-29T09:00:00.000Z');
  const service = createRepositoryStatusService({
    repositoryMap: { command: { path: 'C:/repos/command' }, erp: { path: 'C:/repos/erp' } },
    now: () => clockMs,
    staleAfterMs: 60000,
    probe: async (projectId) => ({
      project_id: projectId,
      branch: 'main',
      upstream: 'origin/main',
      head: `head-${projectId}`,
      commit_time: null,
      ahead: 0,
      behind: 0,
      dirty_file_count: 0,
      last_origin_fetch: null,
      state: 'CURRENT',
      reason: null,
    }),
  });

  await service.refresh();
  assert.equal(service.snapshot().repositories[0].state, 'CURRENT');

  clockMs += 121000;
  const aged = service.snapshot();
  assert.equal(aged.repositories[0].state, 'STALE');
  assert.match(aged.repositories[0].reason, /Last successful refresh was 121s ago/);
  assert.equal(aged.repositories[1].state, 'STALE');
  service.stop();
});

test('overlapping refresh calls coalesce into one collection', async () => {
  let probes = 0;
  const service = createRepositoryStatusService({
    repositoryMap: { command: { path: 'C:/repos/command' }, erp: { path: 'C:/repos/erp' } },
    now: () => Date.parse('2026-10-29T09:00:00.000Z'),
    probe: async (projectId) => {
      probes += 1;
      return {
        project_id: projectId,
        branch: 'main',
        upstream: null,
        head: 'abc1234',
        commit_time: null,
        ahead: null,
        behind: null,
        dirty_file_count: null,
        last_origin_fetch: null,
        state: 'CURRENT',
        reason: null,
      };
    },
  });

  await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
  assert.equal(probes, 2, 'one probe per live repository, not per caller');
  service.stop();
});

test('the route is registered once, read-only, and never runs the sync preflight', () => {
  const serviceSource = fs.readFileSync(path.join(REPO_ROOT, 'server/pm-service.mjs'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(REPO_ROOT, 'server/repository-status.mjs'), 'utf8');

  const routeHits = serviceSource.match(/p === '\/api\/pm\/repositories\/status'/g) ?? [];
  assert.equal(routeHits.length, 1, 'exactly one route registration');
  assert.ok(
    serviceSource.indexOf("p === '/api/pm/repositories/status'") > serviceSource.indexOf("p === '/api/pm/roadmaps'"),
    'registered alongside the other read-only GET routes',
  );
  assert.ok(serviceSource.includes('repositoryStatusPayload()'));
  assert.ok(!serviceSource.includes('buildRepositoryPreflight'), 'no synchronous preflight builder in the server');
  assert.ok(!/execFileSync\s*\(/.test(moduleSource), 'repository-status must be async only');
  assert.ok(!moduleSource.includes("['fetch'"), 'no git fetch anywhere; last_origin_fetch is FETCH_HEAD mtime');
  assert.ok(!/method:\s*'POST'/.test(moduleSource));
});
