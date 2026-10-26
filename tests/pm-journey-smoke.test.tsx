// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBuildingRoute } from '@/lib/building-route';
import { PM_BOARD_HREF, PM_STATUSES, type PmTask } from '@/lib/pm-client';
import type { CommandSurface } from '@/lib/contracts';
import { BuildingSurface } from '@/surfaces/building';

let dom: JSDOM | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  dom?.window.close();
  dom = null;
  vi.unstubAllGlobals();
});

const hold = { state: null, authority: null, effective: null, source: 'pm_projects' };
const statuses = [...PM_STATUSES];
const emptyCounts = Object.fromEntries(statuses.map((lane) => [lane, 0]));

const authRef = {
  sequence: 13615,
  eventId: 'e'.repeat(64),
  recordHash: 'f'.repeat(64),
  senderHandle: 'codex',
  purpose: 'Authorize journey smoke fixture',
  kind: 'authorization' as const,
  verified_at: '2026-10-25T00:00:00.000Z',
  received_at: null,
  authority_level: 'CORE_AGENT',
  root_authority: false,
  mentions_task: true,
};

const journeyTask: PmTask = {
  id: 'PM-CMD-401',
  project_id: 'command',
  title: 'Founder journey fixture',
  description: '',
  priority: 'P1',
  status: 'READY',
  prior_status: null,
  owner: 'cursor',
  verifier: 'omp',
  room_authorization_ref: authRef,
  evidence_refs: [],
  depends_on: [],
  work_package_id: null,
  notes: '',
  created_by: 'cursor',
  created_at: '2026-10-25T00:00:00.000Z',
  updated_at: '2026-10-25T00:00:00.000Z',
  closed_at: null,
  allowed_next: ['IN_PROGRESS'],
  pending_room_sync: 0,
};

const commandProject = {
  id: 'command',
  name: 'Starq Command',
  prefix: 'CMD',
  description: 'Command PM board',
  source_gap: null,
  hold,
};

const portfolio = {
  generated_at: '2026-10-25T17:40:00.000Z',
  pending_room_sync: 0,
  statuses,
  projects: [{
    ...commandProject,
    total: 1,
    open: 1,
    counts: { ...emptyCounts, READY: 1 },
    founder_gate: 0,
    blocked: 0,
    unassigned: 0,
  }],
};

function stubPmFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/pm/portfolio')) return { ok: true, json: async () => portfolio };
    if (url.endsWith('/api/pm/meta')) {
      return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['cursor', 'omp'] }) };
    }
    if (url.endsWith('/api/pm/projects')) {
      return { ok: true, json: async () => ({ projects: [commandProject] }) };
    }
    if (url.includes('/api/pm/tasks?project_id=command')) {
      return { ok: true, json: async () => ({ project_id: 'command', tasks: [journeyTask] }) };
    }
    if (url.endsWith('/api/pm/tasks/PM-CMD-401')) {
      return { ok: true, json: async () => ({ task: journeyTask, history: [], hold }) };
    }
    if (url.includes('/api/pm/work-packages?project_id=command')) {
      return { ok: true, json: async () => ({ project_id: 'command', milestone_id: null, work_packages: [] }) };
    }
    if (url.includes('/api/pm/milestones?project_id=command')) {
      return { ok: true, json: async () => ({ project_id: 'command', milestones: [] }) };
    }
    return { ok: false, status: 404, json: async () => ({ message: 'unexpected route' }) };
  }));
}

async function renderHash(hash: string) {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  dom?.window.close();
  stubPmFetch();
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost/${hash}`,
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <BuildingSurface route={parseBuildingRoute(hash)} surface={{} as CommandSurface} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

describe('Founder PM journey smoke', () => {
  it('opens #studio/projects, follows Command to #studio/command, shows owner/verifier/Room authorization, and returns via Back to portfolio', async () => {
    const projects = await renderHash('#studio/projects');
    expect(parseBuildingRoute('#studio/projects')).toEqual({ view: 'studio', room: null, tab: 'Projects' });
    expect(projects.querySelector('[data-pm="portfolio"]')).not.toBeNull();

    const commandCard = projects.querySelector('[data-project="command"]');
    expect(commandCard).not.toBeNull();
    const commandHref = commandCard?.querySelector(`a[href="${PM_BOARD_HREF.command}"]`)?.getAttribute('href')
      ?? commandCard?.querySelector('a[href="#studio/command"]')?.getAttribute('href');
    if (!commandHref) {
      throw new Error('ABSENT: Command portfolio entry has no user-visible link to #studio/command');
    }
    expect(commandHref).toBe('#studio/command');

    const board = await renderHash(commandHref);
    expect(board.querySelector('[data-pm="board"][data-project="command"]')).not.toBeNull();

    const taskButton = board.querySelector('[data-lane="READY"] button[data-task="PM-CMD-401"]');
    expect(taskButton).not.toBeNull();
    await act(async () => {
      taskButton?.dispatchEvent(new board.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const detail = board.querySelector('[data-task-id="PM-CMD-401"]') ?? board.querySelector('[aria-label="Task PM-CMD-401"]');
    if (!detail) {
      throw new Error('ABSENT: rendered Command board did not open task PM-CMD-401 detail');
    }
    expect(detail.textContent).toContain('Owner');
    expect(detail.textContent).toContain('cursor');
    expect(detail.textContent).toContain('Independent verifier');
    expect(detail.textContent).toContain('omp');
    expect(detail.textContent).toContain('Room authorization');
    expect(detail.textContent).toContain('#13615');

    const back = board.querySelector('[data-board-backlink] a');
    if (!back) {
      throw new Error('ABSENT: Command board has no Back to portfolio link');
    }
    expect(back.textContent).toContain('Back to portfolio');
    expect(back.getAttribute('href')).toBe('#studio/projects');

    const returned = await renderHash(back.getAttribute('href')!);
    expect(returned.querySelector('[data-pm="portfolio"]')).not.toBeNull();
    expect(returned.querySelector('[data-project="command"]')).not.toBeNull();
  });
});
