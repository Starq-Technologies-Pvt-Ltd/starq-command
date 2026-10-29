/**
 * STARQ // COMMAND — repository sync status (READ-ONLY).
 *
 * Answers one question per configured live repository: what does this checkout
 * actually contain, and how fresh is that answer?
 *
 * Invariants, all deliberate:
 *   - READ ONLY. No writes, no checkout, no fetch, no push, no process signal.
 *     `last_origin_fetch` is the mtime of FETCH_HEAD, so this service never
 *     talks to a remote and never waits on the network.
 *   - NOT A COMPLETION SIGNAL. `head` is a checkout HEAD, not progress, not a
 *     verified or accepted task. Callers must not derive task state from it.
 *   - NEVER BLOCKS THE EVENT LOOP. Every Git probe is asynchronous and bounded
 *     by a timeout, and runs off the request path. The synchronous lifecycle
 *     preflight builder (scripts/lifecycle/preflight.mjs, `execFileSync`) is
 *     deliberately NOT used here: on a 30s polled route it would stall the
 *     single-threaded server for the sum of every probe.
 *   - LAST KNOWN FACTS SURVIVE FAILURE. A failed refresh keeps the previous
 *     facts and reports STALE, or UNAVAILABLE when nothing was ever collected,
 *     instead of blanking the feed.
 *   - NO DUPLICATE CHECKOUTS. Only the two live repositories (Command, ERP) are
 *     reported. Projects without their own checkout, and projects that share
 *     one (erp/pos/starqbooks all resolve to the ERP worktree), are not
 *     presented as if each had an independent repository.
 *
 * Public contract: GET /api/pm/repositories/status, schema
 * `starq.command.repository_status/v1`, joined with Cursor's UI in Room #16099.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');

export const REPOSITORY_STATUS_SCHEMA = 'starq.command.repository_status/v1';

/**
 * The only repositories that are reported. `project_id` is the pm_projects id
 * the portfolio card already uses, so the two rows join without a second map.
 */
export const LIVE_REPOSITORY_PROJECTS = Object.freeze(['command', 'erp']);

/** Bounded per-probe Git timeout. */
export const DEFAULT_GIT_TIMEOUT_MS = 4000;
/** Background refresh cadence. The UI polls every 30s; this stays ahead of it. */
export const DEFAULT_REFRESH_MS = 15000;
/** After this age, even a successful collection is reported as STALE. */
export const DEFAULT_STALE_AFTER_MS = 60000;

export const SYNC_STATES = Object.freeze(['CURRENT', 'STALE', 'UNAVAILABLE', 'UNRESOLVED']);

export const DEFAULT_CONFIG_PATH = path.join(APP_ROOT, 'lifecycle.config.json');

/**
 * A remote URL can carry credentials. Anything that looks like a URL or an
 * scp-style `user@host` value is shown as REDACTED; a plain `origin/main` is not.
 */
export function redactRemote(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return /:\/\/|@/.test(text) ? 'REDACTED' : text;
}

/**
 * Read `repository_map` from lifecycle.config.json. That file is the single
 * source of control-plane runtime truth; this module only reads it.
 *
 * @returns {{ map: Record<string, { path?: string }>, reason: string | null }}
 */
export function loadRepositoryMap(configPath = DEFAULT_CONFIG_PATH) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    const doc = JSON.parse(raw);
    const map = doc && typeof doc.repository_map === 'object' && doc.repository_map !== null
      ? doc.repository_map
      : null;
    if (!map) return { map: {}, reason: 'lifecycle.config.json declares no repository_map.' };
    return { map, reason: null };
  } catch (err) {
    return { map: {}, reason: `repository_map is unavailable: ${reasonOf(err)}` };
  }
}

function reasonOf(err) {
  const text = err && typeof err.message === 'string' ? err.message : String(err);
  return text.split(/\r?\n/)[0].trim();
}

/** Normalize a Git date (`%cI` may carry a local offset) to UTC ISO-8601. */
function isoOrNull(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? String(value) : new Date(ms).toISOString();
}

function blankEntry(projectId) {
  return {
    project_id: projectId,
    branch: null,
    upstream: null,
    head: null,
    commit_time: null,
    ahead: null,
    behind: null,
    dirty_file_count: null,
    last_origin_fetch: null,
    state: 'UNAVAILABLE',
    reason: null,
  };
}

function uncollectedEntry(projectId) {
  return { ...blankEntry(projectId), reason: 'Repository status has not been collected yet.' };
}

/**
 * Resolve the git directory of a checkout, including a linked worktree whose
 * `.git` is a file pointing at the real dir. Returns null when the path is not
 * a Git checkout.
 */
function resolveGitDir(root) {
  const dotGit = path.join(root, '.git');
  let stat;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return dotGit;
  try {
    const text = fs.readFileSync(dotGit, 'utf8');
    const match = /^gitdir:\s*(.+)$/im.exec(text);
    if (!match) return null;
    return path.resolve(root, match[1].trim());
  } catch {
    return null;
  }
}

/**
 * When did this checkout last fetch from its remote? Read from FETCH_HEAD's
 * mtime — never from the network. `@origin` still works offline because this
 * reports the last successful fetch, not a fresh one.
 */
function readLastFetch(gitDir) {
  const candidates = [path.join(gitDir, 'FETCH_HEAD')];
  try {
    const common = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim();
    if (common) candidates.unshift(path.join(path.resolve(gitDir, common), 'FETCH_HEAD'));
  } catch { /* not a linked worktree */ }
  for (const file of candidates) {
    try {
      return new Date(fs.statSync(file).mtimeMs).toISOString();
    } catch { /* try the next candidate */ }
  }
  return null;
}

/**
 * Run one bounded, asynchronous Git command. `-C` keeps the child process cwd
 * independent of the server's, and the timeout guarantees a stuck probe cannot
 * accumulate.
 *
 * @returns {Promise<{ ok: true, out: string } | { ok: false, timedOut: boolean, reason: string }>}
 */
function runGit(repoPath, args, timeoutMs = DEFAULT_GIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoPath, ...args], {
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const timedOut = error.killed === true || error.signal === 'SIGKILL';
        const detail = timedOut
          ? `git ${args.join(' ')} timed out after ${timeoutMs}ms`
          : reasonOf(stderr) || reasonOf(error);
        resolve({ ok: false, timedOut, reason: detail });
        return;
      }
      resolve({ ok: true, out: String(stdout ?? '').trim() });
    });
  });
}

/**
 * Probe one repository and return a contract-shaped row. Pure read-only Git
 * facts; never a claim about task state.
 */
export async function probeRepository(projectId, repoPath, options = {}) {
  const git = options.git ?? runGit;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const missingReason = options.missingReason ?? 'No repository is configured for this project.';
  const base = blankEntry(projectId);

  if (!repoPath) return { ...base, state: 'UNRESOLVED', reason: missingReason };

  let stat;
  try {
    stat = fs.statSync(repoPath);
  } catch {
    return { ...base, state: 'UNRESOLVED', reason: `Configured repository path does not exist: ${repoPath}` };
  }
  if (!stat.isDirectory()) {
    return { ...base, state: 'UNRESOLVED', reason: `Configured repository path is not a directory: ${repoPath}` };
  }

  const gitDir = resolveGitDir(repoPath);
  if (!gitDir) {
    return { ...base, state: 'UNRESOLVED', reason: `Configured path is not a Git checkout: ${repoPath}` };
  }

  const lastFetch = readLastFetch(gitDir);

  const [branchResult, headResult, commitResult, upstreamResult, dirtyResult] = await Promise.all([
    git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], timeoutMs),
    git(repoPath, ['rev-parse', '--short', 'HEAD'], timeoutMs),
    git(repoPath, ['log', '-1', '--format=%cI', 'HEAD'], timeoutMs),
    git(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], timeoutMs),
    git(repoPath, ['status', '--porcelain=v1', '--untracked-files=normal'], timeoutMs),
  ]);

  if (!headResult.ok) {
    return {
      ...base,
      last_origin_fetch: lastFetch,
      state: 'UNAVAILABLE',
      reason: `HEAD could not be read: ${headResult.reason}`,
    };
  }

  const problems = [];
  const notes = [];

  const branch = branchResult.ok && branchResult.out && branchResult.out !== 'HEAD'
    ? branchResult.out
    : null;
  if (branch === null) {
    notes.push(branchResult.ok
      ? 'Detached HEAD: no branch is checked out.'
      : `Branch could not be read: ${branchResult.reason}`);
  }

  const commitTime = commitResult.ok && commitResult.out ? isoOrNull(commitResult.out) : null;
  if (commitTime === null) problems.push(`commit time could not be read: ${commitResult.reason}`);

  let ahead = null;
  let behind = null;
  const hasUpstream = upstreamResult.ok && upstreamResult.out;
  if (hasUpstream) {
    // Counted against @{upstream} rather than the displayed string, so a
    // redacted URL upstream still yields real counts.
    const counts = await git(repoPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], timeoutMs);
    if (counts.ok) {
      const parts = counts.out.split(/\s+/).map((part) => Number(part));
      if (parts.length === 2 && parts.every((n) => Number.isInteger(n) && n >= 0)) {
        [ahead, behind] = parts;
      } else {
        problems.push('ahead/behind could not be parsed');
      }
    } else {
      problems.push(`ahead/behind could not be read: ${counts.reason}`);
    }
  } else {
    notes.push('No upstream branch is configured, so ahead/behind are unknown.');
  }

  let dirtyFileCount = null;
  if (dirtyResult.ok) {
    dirtyFileCount = dirtyResult.out ? dirtyResult.out.split(/\r?\n/).filter((line) => line.trim()).length : 0;
  } else {
    problems.push(`working-tree state could not be read: ${dirtyResult.reason}`);
  }

  const reason = [...notes, ...problems].join(' ') || null;

  return {
    project_id: projectId,
    branch,
    upstream: hasUpstream ? redactRemote(upstreamResult.out) : null,
    head: headResult.out,
    commit_time: commitTime,
    ahead,
    behind,
    dirty_file_count: dirtyFileCount,
    last_origin_fetch: lastFetch,
    state: problems.length ? 'STALE' : 'CURRENT',
    reason,
  };
}

/**
 * Cached, non-blocking repository status. `snapshot()` is synchronous and pure
 * of I/O; `refresh()` collects off the request path; `ensureRefresh()` starts
 * one unref'd background interval on first use.
 *
 * Options exist so the focused tests can inject `probe`, `repositoryMap` and
 * `now` without touching the real checkouts or the clock.
 */
export function createRepositoryStatusService(options = {}) {
  const projectIds = [...(options.projectIds ?? LIVE_REPOSITORY_PROJECTS)];
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  const injectedMap = options.repositoryMap ?? null;
  const git = options.git ?? runGit;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const readClock = options.now ?? (() => Date.now());
  const probe = options.probe ?? ((projectId, repoPath, extra) => probeRepository(projectId, repoPath, {
    git,
    timeoutMs,
    ...extra,
  }));

  const clock = () => {
    const value = readClock();
    return typeof value === 'number' ? value : new Date(value).getTime();
  };

  let records = projectIds.map((projectId) => ({ entry: uncollectedEntry(projectId), collectedAt: null }));
  let generatedAtMs = null;
  let inFlight = null;
  let timer = null;

  function resolveMap() {
    if (injectedMap) return { map: injectedMap, reason: null };
    return loadRepositoryMap(configPath);
  }

  async function collect() {
    const { map, reason: mapReason } = resolveMap();
    const previous = records;

    const fresh = await Promise.all(projectIds.map(async (projectId) => {
      const entry = map[projectId];
      const repoPath = entry && typeof entry.path === 'string' ? entry.path : null;
      try {
        return { entry: await probe(projectId, repoPath, { missingReason: mapReason ?? undefined }), collectedAt: clock() };
      } catch (err) {
        return {
          entry: { ...blankEntry(projectId), state: 'UNAVAILABLE', reason: `Repository probe failed: ${reasonOf(err)}` },
          collectedAt: null,
        };
      }
    }));

    records = fresh.map((item, index) => {
      const before = previous[index];
      const collectedNow = item.entry.head !== null;
      // Keep last known facts when a refresh fails after an earlier success.
      if (!collectedNow && before && before.entry.head !== null) {
        return {
          entry: {
            ...before.entry,
            state: 'STALE',
            reason: item.entry.reason ?? 'The last repository refresh failed.',
          },
          collectedAt: before.collectedAt,
        };
      }
      return { entry: item.entry, collectedAt: collectedNow ? item.collectedAt : null };
    });

    const succeeded = records.filter((record) => record.collectedAt !== null);
    generatedAtMs = succeeded.length
      ? Math.max(...succeeded.map((record) => record.collectedAt))
      : null;
  }

  function refresh() {
    if (!inFlight) {
      inFlight = collect()
        .catch((err) => {
          // A collection failure must not erase the cache; mark it stale.
          records = records.map((record) => (record.entry.head === null ? record : {
            entry: { ...record.entry, state: 'STALE', reason: `Repository refresh failed: ${reasonOf(err)}` },
            collectedAt: record.collectedAt,
          }));
        })
        .finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  function ensureRefresh() {
    if (!timer) {
      timer = setInterval(() => { void refresh(); }, refreshMs);
      if (typeof timer.unref === 'function') timer.unref();
    }
    return refresh();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function snapshot() {
    const at = clock();
    const repositories = records.map(({ entry, collectedAt }) => {
      let state = entry.state;
      let reason = entry.reason;
      if (state === 'CURRENT' && collectedAt !== null && at - collectedAt > staleAfterMs) {
        state = 'STALE';
        reason = `Last successful refresh was ${Math.round((at - collectedAt) / 1000)}s ago.`;
      }
      return {
        project_id: entry.project_id,
        branch: entry.branch,
        upstream: entry.upstream,
        head: entry.head,
        commit_time: entry.commit_time,
        ahead: entry.ahead,
        behind: entry.behind,
        dirty_file_count: entry.dirty_file_count,
        last_origin_fetch: entry.last_origin_fetch,
        state,
        reason: reason ?? null,
      };
    });
    return {
      schema: REPOSITORY_STATUS_SCHEMA,
      generated_at: generatedAtMs === null ? null : new Date(generatedAtMs).toISOString(),
      repositories,
    };
  }

  return { snapshot, refresh, ensureRefresh, stop, projectIds: [...projectIds] };
}
