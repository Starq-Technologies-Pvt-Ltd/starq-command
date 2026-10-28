// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBuildingRoute } from '@/lib/building-route';
import { pmTaskHref } from '@/lib/pm-client';
import type { CommandSurface } from '@/lib/contracts';
import { BuildingSurface } from '@/surfaces/building';
import { PmBoardSurface } from '@/surfaces/pm-board';
import { PmPortfolioSnapshot, PmPortfolioSurface } from '@/surfaces/pm-portfolio';
import { renderToStaticMarkup } from 'react-dom/server';

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

const statuses = ['TODO', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;

function project(id: string, name: string, prefix: string, status?: 'BLOCKED') {
  const counts = Object.fromEntries(statuses.map((lane) => [lane, lane === status ? 1 : 0]));
  return {
    id, name, prefix, hold: { state: null, authority: null, effective: null, source: 'pm_projects' },
    source_gap: null, total: status ? 1 : 0, open: status ? 1 : 0, counts,
    founder_gate: 0, blocked: status === 'BLOCKED' ? 1 : 0, pending_room_sync: 0, unassigned: 0,
  };
}

const blockedTask = {
  id: 'PM-CMD-001', project_id: 'command', title: 'Recorded blocker', description: 'Waiting on a person.',
  priority: 'P1', status: 'BLOCKED', prior_status: 'IN_PROGRESS', owner: 'claude', verifier: 'UNASSIGNED',
  room_authorization_ref: null, evidence_refs: [], depends_on: [], notes: '', created_by: 'claude',
  created_at: '2026-10-14T00:00:00.000Z', updated_at: '2026-10-14T01:00:00.000Z', closed_at: null,
  allowed_next: ['TODO', 'NEXT', 'IN_PROGRESS', 'DONE'], pending_room_sync: 0,
};

describe('Command project boards', () => {
  it('keeps the project register on Overview when Building projection is absent', () => {
    const html = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#overview')} surface={{} as CommandSurface} />,
    );
    expect(html).toContain('Project register available');
    expect(html).toContain('Building projection unavailable');
    expect(html).toContain('data-pm-portfolio-snapshot');
  });

  it('shows board counts on the compact overview', async () => {
    const registered = [project('command', 'Starq Command', 'CMD', 'BLOCKED'), project('erp', 'starqERP', 'SERP')];
    const portfolio = { generated_at: '2026-10-15T00:00:00.000Z', pending_room_sync: 0, statuses, projects: registered };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => portfolio })));
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => {
      root?.render(<PmPortfolioSnapshot />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('Starq Command');
    expect(host.textContent).toContain('starqERP');
    expect(host.textContent).toContain('Blocked 1');
    expect(host.querySelector('[data-project-snapshot="command"] a')?.getAttribute('href')).toContain('#studio/command');
  });

  it('lists live boards on the Projects surface', async () => {
    const registered = [
      project('command', 'Starq Command', 'CMD', 'BLOCKED'),
      project('erp', 'starqERP', 'SERP'),
      project('hoadha', 'Hoadha', 'DHIV'),
    ];
    const portfolio = { generated_at: '2026-10-15T00:00:00.000Z', pending_room_sync: 0, statuses, projects: registered };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => portfolio })));
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/#studio/projects' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => {
      root?.render(<PmPortfolioSurface />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelectorAll('[data-project]').length).toBe(3);
    expect(host.textContent).toContain('Starq Command');
    expect(host.textContent).toContain('starqERP');
    expect(host.textContent).toContain('Hoadha');
    expect(host.textContent).toContain('To Do');
  });

  it('opens the linked task detail only when it belongs to the selected PM board', async () => {
    const command = project('command', 'Starq Command', 'CMD');
    const taskDetail = { task: blockedTask, history: [], hold: command.hold };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['claude', 'ali'] }) };
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [{ id: command.id, name: command.name, prefix: command.prefix, description: '', source_gap: null, hold: command.hold }] }) };
      if (url.endsWith('/api/pm/tasks/PM-CMD-001')) return { ok: true, json: async () => taskDetail };
      if (url.includes('/api/pm/tasks?project_id=command')) return { ok: true, json: async () => ({ project_id: 'command', tasks: [blockedTask] }) };
      return { ok: false, status: 404, json: async () => ({ message: 'unexpected route' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: `http://localhost/${pmTaskHref('command', 'PM-CMD-001')}`,
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

    expect(host.querySelector('[data-project="command"]')).not.toBeNull();
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toContain('PM-CMD-001');
    expect(host.textContent).toContain('To Do');
    expect(host.textContent).toContain('Next Up');
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain('http://127.0.0.1:5176/api/pm/tasks/PM-CMD-001');
  });

  it('does not fetch or display a task from another project when a deep link is mismatched', async () => {
    const erp = project('erp', 'starqERP', 'SERP');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: [] }) };
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [{ id: erp.id, name: erp.name, prefix: erp.prefix, description: '', source_gap: null, hold: erp.hold }] }) };
      if (url.includes('/api/pm/tasks?project_id=erp')) return { ok: true, json: async () => ({ project_id: 'erp', tasks: [] }) };
      return { ok: false, status: 404, json: async () => ({ message: 'unexpected route' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: `http://localhost/${pmTaskHref('erp', 'PM-CMD-001')}`,
    });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => {
      root?.render(<PmBoardSurface projectId="erp" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain('Task PM-CMD-001 is not recorded on the erp board.');
    expect(host.textContent).not.toContain('Recorded blocker');
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/api/pm/tasks/PM-CMD-001'))).toBe(false);
  });
});
