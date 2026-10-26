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
    allowed_next: ['IN_PROGRESS'],
    pending_room_sync: 0,
    ...partial,
  };
}

async function renderBoard(tasks: PmTask[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/pm/meta')) {
      return { ok: true, json: async () => ({ statuses: PM_STATUSES, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['cursor'] }) };
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
  }));

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

describe('PM board lane priority order', () => {
  it('renders real rows across two priorities, orders P0 then P1 then missing last, and shows UNKNOWN for missing priority', async () => {
    const missing = {
      id: 'PM-CMD-300',
      project_id: 'command',
      title: 'No priority',
      description: '',
      status: 'READY',
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
      allowed_next: ['IN_PROGRESS'],
      pending_room_sync: 0,
    } as unknown as PmTask;
    const host = await renderBoard([
      task({ id: 'PM-CMD-302', title: 'P1 later id', status: 'READY', priority: 'P1' }),
      task({ id: 'PM-CMD-303', title: 'P0 later id', status: 'READY', priority: 'P0' }),
      missing,
      task({ id: 'PM-CMD-301', title: 'P0 earlier id', status: 'READY', priority: 'P0' }),
      task({ id: 'PM-CMD-310', title: 'Blocked P2', status: 'BLOCKED', priority: 'P2' }),
    ]);

    const readyIds = [...host.querySelectorAll('[data-lane="READY"] li[data-task]')].map((el) => el.getAttribute('data-task'));
    expect(readyIds).toEqual(['PM-CMD-301', 'PM-CMD-303', 'PM-CMD-302', 'PM-CMD-300']);
    const readyPriorities = [...host.querySelectorAll('[data-lane="READY"] li[data-task]')].map((el) => el.getAttribute('data-priority'));
    expect(readyPriorities).toEqual(['P0', 'P0', 'P1', 'UNKNOWN']);
    expect(host.querySelector('[data-lane="READY"] li[data-task="PM-CMD-300"]')?.textContent).toContain('UNKNOWN');
    expect(host.querySelector('[data-lane="BLOCKED"] li[data-task="PM-CMD-310"]')).not.toBeNull();
  });
});
