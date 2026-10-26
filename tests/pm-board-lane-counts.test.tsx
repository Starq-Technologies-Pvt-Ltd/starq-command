// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PM_STATUSES, type PmTask } from '@/lib/pm-client';
import { PmBoardSurface } from '@/surfaces/pm-board';

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
const commandProject = {
  id: 'command', name: 'Starq Command', prefix: 'CMD', description: '', source_gap: null, hold,
};

function task(partial: Partial<PmTask> & Pick<PmTask, 'id' | 'title' | 'status'>): PmTask {
  return {
    project_id: 'command',
    description: '',
    priority: 'P2',
    prior_status: null,
    owner: 'cursor',
    verifier: 'claude',
    room_authorization_ref: null,
    evidence_refs: [],
    depends_on: [],
    work_package_id: null,
    notes: '',
    created_by: 'cursor',
    created_at: '2026-10-25T00:00:00.000Z',
    updated_at: '2026-10-25T00:00:00.000Z',
    closed_at: null,
    allowed_next: ['READY'],
    pending_room_sync: 0,
    ...partial,
  };
}

async function renderBoard(tasks: PmTask[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/pm/meta')) {
      return { ok: true, json: async () => ({ statuses: PM_STATUSES, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['cursor', 'claude'] }) };
    }
    if (url.endsWith('/api/pm/projects')) {
      return { ok: true, json: async () => ({ projects: [commandProject] }) };
    }
    if (url.includes('/api/pm/tasks?project_id=command')) {
      return { ok: true, json: async () => ({ project_id: 'command', tasks }) };
    }
    if (url.includes('/api/pm/work-packages?project_id=command')) {
      return { ok: true, json: async () => ({ project_id: 'command', milestone_id: null, work_packages: [] }) };
    }
    if (url.includes('/api/pm/milestones?project_id=command')) {
      return { ok: true, json: async () => ({ project_id: 'command', milestones: [] }) };
    }
    return { ok: false, status: 404, json: async () => ({ message: 'unexpected route' }) };
  });
  vi.stubGlobal('fetch', fetchMock);

  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/#studio/command',
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  await act(async () => {
    root?.render(<PmBoardSurface projectId="command" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

describe('PM board lane counts header', () => {
  it('renders real rows across at least two lanes and shows matching header counts, with empty lanes as 0', async () => {
    const rows = [
      task({ id: 'PM-CMD-101', title: 'Ready work', status: 'READY' }),
      task({ id: 'PM-CMD-102', title: 'Also ready', status: 'READY' }),
      task({ id: 'PM-CMD-103', title: 'Blocked work', status: 'BLOCKED' }),
    ];
    const host = await renderBoard(rows);

    const header = host.querySelector('[data-board-lane-counts]');
    expect(header).not.toBeNull();
    expect(header?.querySelector('[data-lane-count="READY"]')?.textContent).toContain('READY: 2');
    expect(header?.querySelector('[data-lane-count="BLOCKED"]')?.textContent).toContain('BLOCKED: 1');
    expect(header?.querySelector('[data-lane-count="BACKLOG"]')?.textContent).toContain('BACKLOG: 0');
    expect(header?.querySelector('[data-lane-count="IN_PROGRESS"]')?.textContent).toContain('IN PROGRESS: 0');

    const readyRows = host.querySelectorAll('[data-lane="READY"] li[data-task]');
    const blockedRows = host.querySelectorAll('[data-lane="BLOCKED"] li[data-task]');
    const backlogRows = host.querySelectorAll('[data-lane="BACKLOG"] li[data-task]');
    expect(readyRows.length).toBe(2);
    expect(blockedRows.length).toBe(1);
    expect(backlogRows.length).toBe(0);
    expect([...readyRows].map((el) => el.getAttribute('data-task')).sort()).toEqual(['PM-CMD-101', 'PM-CMD-102']);
    expect(blockedRows[0]?.getAttribute('data-task')).toBe('PM-CMD-103');

    for (const status of PM_STATUSES) {
      const rendered = host.querySelectorAll(`[data-lane="${status}"] li[data-task]`).length;
      const label = header?.querySelector(`[data-lane-count="${status}"]`)?.textContent ?? '';
      expect(label.endsWith(`: ${rendered}`)).toBe(true);
    }
  });

  it('shows UNKNOWN for every lane when a loaded row is missing status, never 0', async () => {
    const incomplete = {
      id: 'PM-CMD-110',
      project_id: 'command',
      title: 'Missing status',
      description: '',
      priority: 'P2',
      prior_status: null,
      owner: 'cursor',
      verifier: 'claude',
      room_authorization_ref: null,
      evidence_refs: [],
      depends_on: [],
      work_package_id: null,
      notes: '',
      created_by: 'cursor',
      created_at: '2026-10-25T00:00:00.000Z',
      updated_at: '2026-10-25T00:00:00.000Z',
      closed_at: null,
      allowed_next: ['READY'],
      pending_room_sync: 0,
    } as unknown as PmTask;
    const host = await renderBoard([
      task({ id: 'PM-CMD-111', title: 'Known ready', status: 'READY' }),
      incomplete,
    ]);

    const header = host.querySelector('[data-board-lane-counts]');
    expect(header).not.toBeNull();
    for (const status of PM_STATUSES) {
      expect(header?.querySelector(`[data-lane-count="${status}"]`)?.textContent).toMatch(/: UNKNOWN$/);
    }
    expect(host.querySelector('[data-task="PM-CMD-111"]')).not.toBeNull();
  });
});
