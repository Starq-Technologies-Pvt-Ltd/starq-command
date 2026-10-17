// Integration test for the PM service's milestone and work-package routes
// (CMD-PROJ-1, Founder #9605). Spawns the real server in SCRATCH mode: an
// isolated *.db file under the OS temp dir, a loopback port in 5190-5199,
// and PM_ROOM_POST=off so no event is ever posted to the live Room. Never
// touches the production pm-board.db at 5176.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 5191;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADERS = { 'content-type': 'application/json', 'x-pm-client': 'starq-command' };
const ACTOR = 'claude'; // known active identity in the real (read-only) registry

let child: ChildProcess;
let tmpDir: string;

function api(method: string, p: string, body?: unknown) {
  return fetch(`${BASE}${p}`, {
    method,
    headers: method === 'GET' ? undefined : HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function waitForReady() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/pm/health`);
      if (r.ok || r.status === 503) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pm-service did not become ready in time');
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pm-wp-test-'));
  const dbPath = path.join(tmpDir, 'scratch-pm-board.db');
  child = spawn(process.execPath, [path.resolve(__dirname, '../server/pm-service.mjs')], {
    env: { ...process.env, PM_DB_PATH: dbPath, PM_PORT: String(PORT), PM_ROOM_POST: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForReady();
}, 20000);

// child.kill() does not synchronously release the scratch SQLite/WAL file
// handles on Windows, so an immediate recursive delete throws EPERM and a
// fully green suite is reported as a failed file. Retry briefly, then give
// up quietly: a leftover temp dir must never fail the run.
afterAll(async () => {
  child?.kill();
  if (!tmpDir) return;
  for (let i = 0; i < 20; i += 1) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}, 20000);

describe('PM milestones and work packages (isolated scratch instance)', () => {
  it('reports the new tables in health, with zero rows initially', async () => {
    const r = await api('GET', '/api/pm/health');
    const h = await r.json();
    expect(h.state).toBe('OK');
    expect(h.milestones).toBe(0);
    expect(h.work_packages).toBe(0);
  });

  it('exposes milestone and work-package vocabularies in meta', async () => {
    const r = await api('GET', '/api/pm/meta');
    const m = await r.json();
    expect(m.milestone_statuses).toEqual(['OPEN', 'AT_RISK', 'ACHIEVED', 'MISSED']);
    expect(m.work_package_statuses).toEqual(['OPEN', 'IN_PROGRESS', 'DONE']);
  });

  it('creates a milestone under the seeded command project', async () => {
    const r = await api('POST', '/api/pm/milestones', {
      project_id: 'command', title: 'Project boards v1', description: 'First usable board', target_date: '2026-12-01', actor: ACTOR,
    });
    expect(r.status).toBe(201);
    const ms = await r.json();
    expect(ms.id).toMatch(/^MS-CMD-\d{3}$/);
    expect(ms.status).toBe('OPEN');
    expect(ms.work_package_total).toBe(0);
  });

  it('rejects a milestone for an unknown project', async () => {
    const r = await api('POST', '/api/pm/milestones', { project_id: 'nope', title: 'valid title', actor: ACTOR });
    expect(r.status).toBe(404);
  });

  it('rejects an unknown field on milestone create', async () => {
    const r = await api('POST', '/api/pm/milestones', { project_id: 'command', title: 'valid title', actor: ACTOR, sneaky: true });
    expect(r.status).toBe(400);
  });

  it('lists milestones filtered by project', async () => {
    const r = await api('GET', '/api/pm/milestones?project_id=command');
    const body = await r.json();
    expect(body.milestones.length).toBeGreaterThanOrEqual(1);
    expect(body.milestones.every((m: any) => m.project_id === 'command')).toBe(true);
  });

  it('creates a work package linked to that milestone', async () => {
    const msRes = await api('GET', '/api/pm/milestones?project_id=command');
    const msId = (await msRes.json()).milestones[0].id;
    const r = await api('POST', '/api/pm/work-packages', {
      project_id: 'command', milestone_id: msId, title: 'PM API extensions', owner: ACTOR, actor: ACTOR,
    });
    expect(r.status).toBe(201);
    const wp = await r.json();
    expect(wp.id).toMatch(/^WP-CMD-\d{3}$/);
    expect(wp.milestone_id).toBe(msId);
    expect(wp.task_total).toBe(0);
  });

  it('rejects a work package pointing at a milestone from another project', async () => {
    await api('POST', '/api/pm/milestones', { project_id: 'erp', title: 'ERP milestone', actor: ACTOR });
    const ms = await (await api('GET', '/api/pm/milestones?project_id=erp')).json();
    const r = await api('POST', '/api/pm/work-packages', {
      project_id: 'command', milestone_id: ms.milestones[0].id, title: 'cross project', actor: ACTOR,
    });
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.error).toBe('MILESTONE_CROSS_PROJECT');
  });

  // Regression for Deadpool's independent-review finding (#9616): GET
  // /api/pm/work-packages?project_id=command&milestone_id=<an ERP milestone>
  // used to return the ERP milestone's work packages (listWorkPackages only
  // honored milestone_id, silently ignoring project_id once both were
  // given). Must now reject the mismatched filter combination instead of
  // leaking cross-project rows.
  it('rejects a cross-project milestone_id+project_id filter combination on GET work-packages (#9616)', async () => {
    const erpMs = await (await api('POST', '/api/pm/milestones', { project_id: 'erp', title: 'ERP leak-check milestone', actor: ACTOR })).json();
    const erpWp = await (await api('POST', '/api/pm/work-packages', { project_id: 'erp', milestone_id: erpMs.id, title: 'ERP leak-check work package', actor: ACTOR })).json();

    const leaked = await api('GET', `/api/pm/work-packages?project_id=command&milestone_id=${erpMs.id}`);
    expect(leaked.status).toBe(422);
    const body = await leaked.json();
    expect(body.error).toBe('MILESTONE_CROSS_PROJECT');

    // Confirm the ERP work package IS real and reachable on its own project,
    // so this is genuinely a filter-combination rejection, not a false
    // negative from the work package never having existed.
    const erpScoped = await (await api('GET', `/api/pm/work-packages?project_id=erp&milestone_id=${erpMs.id}`)).json();
    expect(erpScoped.work_packages.map((w: any) => w.id)).toContain(erpWp.id);
  });

  it('creates a task linked to the work package and the rollup counts it', async () => {
    const wpList = await (await api('GET', '/api/pm/work-packages?project_id=command')).json();
    const wpId = wpList.work_packages[0].id;
    const taskRes = await api('POST', '/api/pm/tasks', {
      project_id: 'command', title: 'Implement milestone CRUD', actor: ACTOR, work_package_id: wpId,
    });
    expect(taskRes.status).toBe(201);
    const task = await taskRes.json();
    expect(task.task.work_package_id).toBe(wpId);

    const detail = await (await api('GET', `/api/pm/work-packages/${wpId}`)).json();
    expect(detail.work_package.task_total).toBe(1);
    expect(detail.work_package.task_counts.BACKLOG).toBe(1);
    expect(detail.tasks).toHaveLength(1);
    expect(detail.tasks[0].id).toBe(task.task.id);
  });

  it('rejects linking a task to a work package from a different project', async () => {
    const wpList = await (await api('GET', '/api/pm/work-packages?project_id=command')).json();
    const wpId = wpList.work_packages[0].id;
    const r = await api('POST', '/api/pm/tasks', { project_id: 'erp', title: 'cross project task', actor: ACTOR, work_package_id: wpId });
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.error).toBe('WORK_PACKAGE_CROSS_PROJECT');
  });

  it('updates a work package status with optimistic concurrency, and the milestone rollup reflects it', async () => {
    const wpList = await (await api('GET', '/api/pm/work-packages?project_id=command')).json();
    const wp = wpList.work_packages[0];
    const r = await api('PATCH', `/api/pm/work-packages/${wp.id}`, {
      actor: ACTOR, expected_updated_at: wp.updated_at, status: 'DONE',
    });
    expect(r.status).toBe(200);
    const updated = await r.json();
    expect(updated.status).toBe('DONE');
    expect(updated.closed_at).not.toBeNull();

    const ms = await (await api('GET', `/api/pm/milestones/${wp.milestone_id}`)).json();
    expect(ms.milestone.work_package_counts.DONE).toBe(1);
  });

  it('rejects a stale work-package edit', async () => {
    const wpList = await (await api('GET', '/api/pm/work-packages?project_id=command')).json();
    const wp = wpList.work_packages[0];
    const r = await api('PATCH', `/api/pm/work-packages/${wp.id}`, {
      actor: ACTOR, expected_updated_at: '2020-01-01T00:00:00.000Z', title: 'renamed',
    });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toBe('STALE_EDIT');
  });

  it('marks a milestone ACHIEVED', async () => {
    const msRes = await api('GET', '/api/pm/milestones?project_id=command');
    const ms = msRes.ok ? (await msRes.json()).milestones[0] : null;
    const r = await api('PATCH', `/api/pm/milestones/${ms.id}`, { actor: ACTOR, expected_updated_at: ms.updated_at, status: 'ACHIEVED' });
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('ACHIEVED');
  });

  it('surfaces milestone and work-package rollups on the portfolio endpoint', async () => {
    const portfolio = await (await api('GET', '/api/pm/portfolio')).json();
    const command = portfolio.projects.find((p: any) => p.id === 'command');
    expect(command.milestones.total).toBeGreaterThanOrEqual(1);
    expect(command.work_packages.total).toBeGreaterThanOrEqual(1);
    expect(portfolio.milestone_statuses).toBeDefined();
    expect(portfolio.work_package_statuses).toBeDefined();
  });
});
