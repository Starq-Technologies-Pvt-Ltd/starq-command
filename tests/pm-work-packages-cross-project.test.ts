// Cross-project verification of the milestone / work-package feature for the
// projects OTHER than 'command' (WP-3, Room #9631).
//
// tests/pm-work-packages-api.test.ts proved the flow against the 'command'
// project only. PmBoardSurface, MilestonesPanel and the PM service routes are
// all generic over project_id, so 'erp' and 'hoadha' SHOULD behave identically
// - but that was an untested assumption. This file exercises the real HTTP
// surface in SCRATCH mode for erp and hoadha: create milestone -> create work
// package -> link task -> rollups -> optimistic update -> status cycling, plus
// the #9616 cross-project rejection with erp/hoadha as the QUERIED project
// rather than command.
//
// Isolation, same contract as the sibling file: an isolated *.db under the OS
// temp dir, a loopback port in 5190-5199, PM_ROOM_POST=off so nothing is ever
// posted to the live Room, and never the production pm-board.db at 5176.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 5193;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADERS = { 'content-type': 'application/json', 'x-pm-client': 'starq-command' };
const ACTOR = 'opencode'; // known active identity in the real (read-only) registry

// project_id -> the id prefix its rows must carry, straight from the canonical
// seed (00_STARQ_HQ/operations/starq-command/board/pm-projects.json).
const PROJECTS = [
  { id: 'erp', prefix: 'ERP' },
  { id: 'hoadha', prefix: 'HOA' },
] as const;

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pm-wp-cross-test-'));
  const dbPath = path.join(tmpDir, 'scratch-pm-board.db');
  child = spawn(process.execPath, [path.resolve(__dirname, '../server/pm-service.mjs')], {
    env: { ...process.env, PM_DB_PATH: dbPath, PM_PORT: String(PORT), PM_ROOM_POST: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForReady();
}, 20000);

// child.kill() does not synchronously release the scratch SQLite/WAL handles on
// Windows, so an immediate recursive delete throws EPERM. Retry briefly, then
// best-effort: a leaked temp dir must never fail an otherwise green suite.
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

describe('milestones and work packages on erp and hoadha (isolated scratch instance)', () => {
  it('seeds both non-command projects with their canonical prefixes', async () => {
    const body = await (await api('GET', '/api/pm/projects')).json();
    for (const { id, prefix } of PROJECTS) {
      const row = body.projects.find((p: any) => p.id === id);
      expect(row, `project ${id} must exist`).toBeDefined();
      expect(row.prefix).toBe(prefix);
    }
  });

  it.each(PROJECTS)('creates a milestone, work package and linked task on $id', async ({ id, prefix }) => {
    const msRes = await api('POST', '/api/pm/milestones', {
      project_id: id, title: `${id} cross-project milestone`, description: 'WP-3 verification', target_date: '2026-12-31', actor: ACTOR,
    });
    expect(msRes.status).toBe(201);
    const ms = await msRes.json();
    expect(ms.id).toMatch(new RegExp(`^MS-${prefix}-\\d{3}$`));
    expect(ms.project_id).toBe(id);
    expect(ms.work_package_total).toBe(0);

    const wpRes = await api('POST', '/api/pm/work-packages', {
      project_id: id, milestone_id: ms.id, title: `${id} work package`, description: 'under the milestone', owner: ACTOR, actor: ACTOR,
    });
    expect(wpRes.status).toBe(201);
    const wp = await wpRes.json();
    expect(wp.id).toMatch(new RegExp(`^WP-${prefix}-\\d{3}$`));
    expect(wp.project_id).toBe(id);
    expect(wp.milestone_id).toBe(ms.id);
    expect(wp.status).toBe('OPEN');
    expect(wp.task_total).toBe(0);

    // A task linked to the work package is a normal governed task; the
    // milestone/work-package grouping must not weaken that path.
    const taskRes = await api('POST', '/api/pm/tasks', {
      project_id: id, title: `Task under the ${id} work package`, actor: ACTOR, work_package_id: wp.id,
    });
    expect(taskRes.status).toBe(201);
    const task = await taskRes.json();
    expect(task.task.project_id).toBe(id);
    expect(task.task.work_package_id).toBe(wp.id);
    expect(task.task.id).toMatch(new RegExp(`^PM-${prefix}-\\d{3}$`));

    const detail = await (await api('GET', `/api/pm/work-packages/${wp.id}`)).json();
    expect(detail.work_package.task_total).toBe(1);
    expect(detail.work_package.task_counts.BACKLOG).toBe(1);
    expect(detail.tasks.map((t: any) => t.id)).toEqual([task.task.id]);

    // Rollup up to the milestone, on the milestone's own project.
    const msAfter = await (await api('GET', `/api/pm/milestones/${ms.id}`)).json();
    expect(msAfter.milestone.work_package_total).toBe(1);
    expect(msAfter.milestone.work_package_counts.OPEN).toBe(1);
    expect(msAfter.milestone.work_package_counts.DONE).toBe(0);
  });

  it.each(PROJECTS)('returns only $id work packages when filtered by $id alone', async ({ id, prefix }) => {
    const body = await (await api('GET', `/api/pm/work-packages?project_id=${id}`)).json();
    expect(body.work_packages.length).toBeGreaterThanOrEqual(1);
    expect(body.work_packages.every((w: any) => w.project_id === id)).toBe(true);
    expect(body.work_packages.every((w: any) => new RegExp(`^WP-${prefix}-`).test(w.id))).toBe(true);

    // The decisive non-leak assertion for this project: no row from any other
    // project may appear in this project's listing.
    const allIds = new Set<string>();
    for (const other of ['command', ...PROJECTS.map((p) => p.id)]) {
      const rows = await (await api('GET', `/api/pm/work-packages?project_id=${other}`)).json();
      for (const w of rows.work_packages) {
        expect(w.project_id).toBe(other);
        allIds.add(w.id);
      }
    }
    expect(allIds.size).toBeGreaterThanOrEqual(2);
  });

  it.each(PROJECTS)('honours project_id + milestone_id together on $id (both filters, same project)', async ({ id, prefix }) => {
    const ms = (await (await api('GET', `/api/pm/milestones?project_id=${id}`)).json()).milestones
      .find((m: any) => m.project_id === id);
    const scoped = await (await api('GET', `/api/pm/work-packages?project_id=${id}&milestone_id=${ms.id}`)).json();
    expect(scoped.work_packages.length).toBe(1);
    expect(scoped.work_packages[0].id).toMatch(new RegExp(`^WP-${prefix}-`));
    expect(scoped.work_packages[0].milestone_id).toBe(ms.id);
    expect(scoped.work_packages.every((w: any) => w.project_id === id)).toBe(true);
  });

  // The #9616 rejection, re-proved with erp and hoadha in the project_id slot
  // instead of command. Both directions, and every third project as the
  // queried one, so a fix that only special-cased 'command' cannot pass.
  it('rejects every mismatched project_id + milestone_id pair, erp/hoadha included (#9616)', async () => {
    const projects = ['command', 'erp', 'hoadha'];
    // command is the third project in the mix here, so it needs its own rows:
    // the point is that the rejection is symmetric, not command-specific.
    await api('POST', '/api/pm/milestones', { project_id: 'command', title: 'command third-party milestone', actor: ACTOR });
    await api('POST', '/api/pm/work-packages', {
      project_id: 'command', title: 'command third-party work package', actor: ACTOR,
      milestone_id: (await (await api('GET', '/api/pm/milestones?project_id=command')).json()).milestones[0].id,
    });
    for (const holder of projects) {
      const ms = (await (await api('GET', `/api/pm/milestones?project_id=${holder}`)).json()).milestones
        .find((m: any) => m.project_id === holder);
      const wpOnHolder = (await (await api('GET', `/api/pm/work-packages?project_id=${holder}`)).json()).work_packages
        .find((w: any) => w.project_id === holder);
      expect(ms, `a milestone must exist on ${holder}`).toBeDefined();

      for (const querier of projects) {
        if (querier === holder) continue;
        const r = await api('GET', `/api/pm/work-packages?project_id=${querier}&milestone_id=${ms.id}`);
        expect(r.status, `${holder} milestone queried as ${querier}`).toBe(422);
        expect((await r.json()).error).toBe('MILESTONE_CROSS_PROJECT');
      }

      // And the rejected row is still reachable on its own project, so the
      // 422s above are filter rejections and not records that never existed.
      const own = await (await api('GET', `/api/pm/work-packages?project_id=${holder}&milestone_id=${ms.id}`)).json();
      expect(own.work_packages.map((w: any) => w.id)).toContain(wpOnHolder.id);
    }
  });

  it('refuses to create or reassign a work package onto another project milestone', async () => {
    const erpMs = (await (await api('GET', '/api/pm/milestones?project_id=erp')).json()).milestones[0];
    const hoadhaMs = (await (await api('GET', '/api/pm/milestones?project_id=hoadha')).json()).milestones[0];

    const create = await api('POST', '/api/pm/work-packages', {
      project_id: 'hoadha', milestone_id: erpMs.id, title: 'hoadha package on an erp milestone', actor: ACTOR,
    });
    expect(create.status).toBe(422);
    expect((await create.json()).error).toBe('MILESTONE_CROSS_PROJECT');

    const hoadhaWp = (await (await api('GET', '/api/pm/work-packages?project_id=hoadha')).json()).work_packages[0];
    const patch = await api('PATCH', `/api/pm/work-packages/${hoadhaWp.id}`, {
      actor: ACTOR, expected_updated_at: hoadhaWp.updated_at, milestone_id: erpMs.id,
    });
    expect(patch.status).toBe(422);
    expect((await patch.json()).error).toBe('MILESTONE_CROSS_PROJECT');

    // Unchanged after the refused reassignment.
    const after = await (await api('GET', `/api/pm/work-packages/${hoadhaWp.id}`)).json();
    expect(after.work_package.milestone_id).toBe(hoadhaWp.milestone_id);
    expect(hoadhaWp.milestone_id).toBe(hoadhaMs.id);
  });

  it('refuses to link a task to a work package from another project', async () => {
    const erpWp = (await (await api('GET', '/api/pm/work-packages?project_id=erp')).json()).work_packages[0];
    for (const project of ['command', 'hoadha']) {
      const r = await api('POST', '/api/pm/tasks', {
        project_id: project, title: `task borrowing an erp work package`, actor: ACTOR, work_package_id: erpWp.id,
      });
      expect(r.status, `${project} task on an erp work package`).toBe(422);
      expect((await r.json()).error).toBe('WORK_PACKAGE_CROSS_PROJECT');
    }
  });

  it.each(PROJECTS)('cycles $id work-package status with optimistic concurrency and updates the milestone rollup', async ({ id }) => {
    const wp = (await (await api('GET', `/api/pm/work-packages?project_id=${id}`)).json()).work_packages
      .find((w: any) => w.status === 'OPEN');
    expect(wp, `an OPEN work package on ${id}`).toBeDefined();

    const stale = await api('PATCH', `/api/pm/work-packages/${wp.id}`, {
      actor: ACTOR, expected_updated_at: '2020-01-01T00:00:00.000Z', title: 'renamed by a stale client',
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe('STALE_EDIT');

    const done = await api('PATCH', `/api/pm/work-packages/${wp.id}`, {
      actor: ACTOR, expected_updated_at: wp.updated_at, status: 'DONE',
    });
    expect(done.status).toBe(200);
    const updated = await done.json();
    expect(updated.status).toBe('DONE');
    expect(updated.project_id).toBe(id);
    expect(updated.closed_at).not.toBeNull();

    const ms = await (await api('GET', `/api/pm/milestones/${wp.milestone_id}`)).json();
    expect(ms.milestone.work_package_counts.DONE).toBe(1);
    expect(ms.milestone.work_package_counts.OPEN).toBe(0);

    // Cycle back to OPEN: closed_at must clear again.
    const reopened = await api('PATCH', `/api/pm/work-packages/${wp.id}`, {
      actor: ACTOR, expected_updated_at: updated.updated_at, status: 'OPEN',
    });
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).closed_at).toBeNull();
  });

  it('rejects an unknown field and a too-short title on both projects', async () => {
    for (const { id } of PROJECTS) {
      const unknown = await api('POST', '/api/pm/milestones', { project_id: id, title: 'valid title here', actor: ACTOR, sneaky: true });
      expect(unknown.status, `${id} unknown field`).toBe(400);
      const short = await api('POST', '/api/pm/milestones', { project_id: id, title: 'no', actor: ACTOR });
      expect(short.status, `${id} short title`).toBe(400);
    }
  });

  it('keeps the portfolio rollups per project, with no cross-project totals', async () => {
    const portfolio = await (await api('GET', '/api/pm/portfolio')).json();
    for (const { id } of PROJECTS) {
      const row = portfolio.projects.find((p: any) => p.id === id);
      expect(row, `portfolio row for ${id}`).toBeDefined();
      expect(row.milestones.total).toBeGreaterThanOrEqual(1);
      expect(row.work_packages.total).toBeGreaterThanOrEqual(1);
    }

    // Recount independently: the portfolio's per-project numbers must equal a
    // direct count of that project's rows, not a shared global count.
    for (const { id } of PROJECTS) {
      const ms = (await (await api('GET', `/api/pm/milestones?project_id=${id}`)).json()).milestones;
      const wp = (await (await api('GET', `/api/pm/work-packages?project_id=${id}`)).json()).work_packages;
      const row = portfolio.projects.find((p: any) => p.id === id);
      expect(row.milestones.total, `${id} milestone total`).toBe(ms.length);
      expect(row.work_packages.total, `${id} work package total`).toBe(wp.length);
      expect(row.milestones.open, `${id} open milestones`).toBe(ms.filter((m: any) => m.status !== 'ACHIEVED').length);
    }
  });

  // The work-package grouping must not have become a side door around the
  // normal task state machine. Progressing a task still needs the ordinary
  // sequence and the ordinary Room authorization reference - and the ERP hold
  // (DEC-100) still applies to erp tasks reached through a work package.
  it('does not let a linked work package bypass the task state machine or the ERP hold', async () => {
    for (const id of PROJECTS.map((p) => p.id)) {
      const wp = (await (await api('GET', `/api/pm/work-packages?project_id=${id}`)).json()).work_packages[0];
      const created = await (await api('POST', '/api/pm/tasks', {
        project_id: id, title: `state machine check on ${id}`, actor: ACTOR, work_package_id: wp.id,
      })).json();
      const task = created.task;
      expect(task.status).toBe('BACKLOG');

      const jump = await api('PATCH', `/api/pm/tasks/${task.id}`, {
        actor: ACTOR, expected_updated_at: task.updated_at, status: 'IN_PROGRESS',
      });
      expect(jump.status, `${id}: BACKLOG -> IN_PROGRESS`).toBe(409);
      expect((await jump.json()).error).toBe('TRANSITION_NOT_ALLOWED');

      // BACKLOG -> READY is always legal. Progressing past READY is where the
      // project gates bite, and they must bite identically whether the task was
      // reached through a work package or not: erp is ON_HOLD (DEC-100), so it
      // is refused by the hold; hoadha has no hold, so it is refused by the
      // missing verified Room authorization reference instead.
      const ready = await api('PATCH', `/api/pm/tasks/${task.id}`, {
        actor: ACTOR, expected_updated_at: task.updated_at, status: 'READY',
      });
      expect(ready.status, `${id}: BACKLOG -> READY`).toBe(200);
      const readyTask = (await ready.json()).task;
      expect(readyTask.status).toBe('READY');

      const start = await api('PATCH', `/api/pm/tasks/${task.id}`, {
        actor: ACTOR, expected_updated_at: readyTask.updated_at, status: 'IN_PROGRESS',
      });
      expect(start.status, `${id}: READY -> IN_PROGRESS`).toBe(409);
      const code = (await start.json()).error;
      expect(code, `${id}: expected the hold gate or the authorization gate`).toMatch(
        id === 'erp' ? /^PROJECT_ON_HOLD$/ : /^AUTHORIZATION_REQUIRED$/,
      );

      // Nothing was written past READY by the refusal.
      const after = await (await api('GET', `/api/pm/tasks/${task.id}`)).json();
      expect(after.task.status).toBe('READY');
    }
  });
});