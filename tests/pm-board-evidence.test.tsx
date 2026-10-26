// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PmBoardSurface } from '@/surfaces/pm-board';
import type { PmTask } from '@/lib/pm-client';

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

const statuses = ['BACKLOG', 'READY', 'IN_PROGRESS', 'REVIEW', 'VERIFICATION', 'ACCEPTANCE', 'CLOSED', 'BLOCKED', 'FOUNDER_GATE'];

const hold = { state: null, authority: null, effective: null, source: 'pm_projects' };
const commandProject = {
  id: 'command', name: 'Starq Command', prefix: 'CMD', description: '', source_gap: null, hold,
};

const authRef = {
  sequence: 13300,
  eventId: 'b'.repeat(64),
  recordHash: 'c'.repeat(64),
  senderHandle: 'mustarq',
  purpose: 'Authorize board work',
  kind: 'authorization' as const,
  verified_at: '2026-10-25T00:00:00.000Z',
  received_at: null,
  authority_level: 'ROOT_GENESIS',
  root_authority: true,
  mentions_task: true,
};

const evidenceRef = {
  sequence: 13301,
  eventId: 'd'.repeat(64),
  recordHash: null,
  senderHandle: 'claude',
  purpose: 'Review evidence',
  kind: 'evidence' as const,
  verified_at: '2026-10-25T00:00:00.000Z',
  received_at: null,
  authority_level: 'CORE_AGENT',
  root_authority: false,
  mentions_task: true,
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
      return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['cursor', 'claude'] }) };
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
  return { host, fetchMock };
}

describe('PM board Room authorization and evidence header', () => {
  it('renders real task rows with and without references and counts them in the header', async () => {
    const rows = [
      task({ id: 'PM-CMD-010', title: 'Has authorization', status: 'READY', room_authorization_ref: authRef, evidence_refs: [] }),
      task({ id: 'PM-CMD-011', title: 'Has evidence', status: 'BLOCKED', room_authorization_ref: null, evidence_refs: [evidenceRef] }),
      task({ id: 'PM-CMD-012', title: 'Has both', status: 'IN_PROGRESS', room_authorization_ref: authRef, evidence_refs: [evidenceRef] }),
      task({ id: 'PM-CMD-013', title: 'Has neither', status: 'BACKLOG', room_authorization_ref: null, evidence_refs: [] }),
    ];
    const { host, fetchMock } = await renderBoard(rows);

    const header = host.querySelector('[data-board-evidence]');
    expect(header).not.toBeNull();
    expect(header?.getAttribute('data-board-auth-count')).toBe('2');
    expect(header?.getAttribute('data-board-evidence-count')).toBe('2');
    expect(header?.textContent).toContain('Room authorization refs: 2');
    expect(header?.textContent).toContain('Evidence refs: 2');

    expect(host.querySelector('[data-task="PM-CMD-010"]')).not.toBeNull();
    expect(host.querySelector('[data-task="PM-CMD-011"]')).not.toBeNull();
    expect(host.querySelector('[data-task="PM-CMD-012"]')).not.toBeNull();
    expect(host.querySelector('[data-task="PM-CMD-013"]')).not.toBeNull();

    const renderedIds = [...host.querySelectorAll('[data-lane] li[data-task]')].map((el) => el.getAttribute('data-task'));
    expect(renderedIds.filter(Boolean).sort()).toEqual(['PM-CMD-010', 'PM-CMD-011', 'PM-CMD-012', 'PM-CMD-013']);

    expect(fetchMock.mock.calls.every(([input, init]) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/pm/tasks') && !url.includes('project_id=')) return true;
      return method === 'GET';
    })).toBe(true);
  });

  it('shows 0 when no loaded rows have references', async () => {
    const rows = [
      task({ id: 'PM-CMD-020', title: 'Empty refs', status: 'BACKLOG', room_authorization_ref: null, evidence_refs: [] }),
    ];
    const { host } = await renderBoard(rows);
    const header = host.querySelector('[data-board-evidence]');
    expect(header?.getAttribute('data-board-auth-count')).toBe('0');
    expect(header?.getAttribute('data-board-evidence-count')).toBe('0');
    expect(header?.textContent).toContain('Room authorization refs: 0');
    expect(header?.textContent).toContain('Evidence refs: 0');
    expect(host.querySelector('[data-task="PM-CMD-020"]')).not.toBeNull();
  });

  it('shows UNKNOWN when a loaded row omits the reference fields, not zero', async () => {
    const incomplete = {
      id: 'PM-CMD-030',
      project_id: 'command',
      title: 'Missing ref fields',
      description: '',
      priority: 'P2',
      status: 'BACKLOG',
      prior_status: null,
      owner: 'cursor',
      verifier: 'claude',
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
    const { host } = await renderBoard([incomplete]);
    const header = host.querySelector('[data-board-evidence]');
    expect(header?.getAttribute('data-board-auth-count')).toBe('UNKNOWN');
    expect(header?.getAttribute('data-board-evidence-count')).toBe('UNKNOWN');
    expect(header?.textContent).toContain('Room authorization refs: UNKNOWN');
    expect(header?.textContent).toContain('Evidence refs: UNKNOWN');
    expect(host.querySelector('[data-task="PM-CMD-030"]')).not.toBeNull();
  });
});
