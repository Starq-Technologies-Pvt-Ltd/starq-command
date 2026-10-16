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

const statuses = ['BACKLOG', 'READY', 'IN_PROGRESS', 'REVIEW', 'VERIFICATION', 'ACCEPTANCE', 'CLOSED', 'BLOCKED', 'FOUNDER_GATE'];

function project(id: string, name: string, prefix: string, status?: 'BLOCKED') {
  const counts = Object.fromEntries(statuses.map((lane) => [lane, lane === status ? 1 : 0]));
  return {
    id, name, prefix, hold: { state: null, authority: null, effective: null, source: 'pm_projects' },
    source_gap: null, total: status ? 1 : 0, open: status ? 1 : 0, counts,
    founder_gate: 0, blocked: status === 'BLOCKED' ? 1 : 0, pending_room_sync: 0, unassigned: 0,
  };
}

const blockedTask = {
  id: 'PM-CMD-001', project_id: 'command', title: 'Recorded blocker', description: 'Waiting for independent review.',
  priority: 'P1', status: 'BLOCKED', prior_status: 'IN_PROGRESS', owner: 'claude', verifier: 'vision',
  room_authorization_ref: null,
  evidence_refs: [{ sequence: 9540, eventId: 'a'.repeat(64), recordHash: null, senderHandle: 'mustarq', purpose: 'Review evidence', kind: 'evidence', verified_at: '2026-10-15T00:00:00.000Z', received_at: null, authority_level: 'ROOT_GENESIS', root_authority: true, mentions_task: true }],
  depends_on: ['PM-CMD-002'], notes: 'No release until review.', created_by: 'claude', created_at: '2026-10-14T00:00:00.000Z',
  updated_at: '2026-10-14T01:00:00.000Z', closed_at: null, allowed_next: [], pending_room_sync: 0,
};

describe('Command project portfolio', () => {
  it('keeps the project register on Overview when Building projection is absent', () => {
    const html = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#overview')} surface={{} as CommandSurface} />,
    );
    expect(html).toContain('Project register available');
    expect(html).toContain('Building projection unavailable');
    expect(html).toContain('data-pm-portfolio-snapshot');
    expect(html).toContain('data-project-snapshot="command"');
    expect(html).toContain('data-project-snapshot="movement-logistics"');
    expect(html).toContain('Starq Web · Nexus-era label');
    expect(html).toContain('Current work, ownership, progress, and project health are UNKNOWN');
    expect(html).not.toContain('Building projection unavailable" />');
  });

  it('shows real PM lane counts in the compact overview and preserves UNKNOWN elsewhere', async () => {
    const registered = [project('command', 'Starq Command', 'CMD', 'BLOCKED')];
    const portfolio = {
      generated_at: '2026-10-15T00:00:00.000Z', pending_room_sync: 0, statuses,
      projects: registered,
    };
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
    expect(host.textContent).toContain('Open 1/1 · In progress 0 · Blocked 1');
    expect(host.textContent).toContain('Current work, ownership, progress, and project health are UNKNOWN');
    expect(host.querySelector('[data-project-snapshot="command"] a')?.getAttribute('href')).toContain('#studio/command');
    expect(host.textContent).toContain('PM summary generated 2026-10-15T00:00:00.000Z');
  });

  it('renders canonical project domains, live PM records, and explicit UNKNOWNs without historical task imports', async () => {
    const registered = [
      project('command', 'Starq Command', 'CMD', 'BLOCKED'),
      project('erp', 'starqERP', 'ERP'),
      project('hoadha', 'Hoadhaa', 'HOA'),
    ];
    const portfolio = {
      generated_at: '2026-10-15T00:00:00.000Z', pending_room_sync: 0, statuses, projects: registered,
    };
    const metadata = {
      projects: registered.map((row) => ({
        id: row.id, name: row.name, prefix: row.prefix, description: `${row.name} PM programme`,
        source_gap: row.source_gap, hold: row.hold,
      })),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/portfolio')) return { ok: true, json: async () => portfolio };
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => metadata };
      const projectId = new URL(url).searchParams.get('project_id');
      return { ok: true, json: async () => ({ project_id: projectId, tasks: projectId === 'command' ? [blockedTask] : [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

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
    expect(host.querySelectorAll('[data-project-catalog]').length).toBe(9);
    [
      'Command OS', 'Starq User Account', 'Hoadhaa', 'starqERP',
      'Starq Commercial Graph (sCG)', 'Commerce Intelligence / starqAI',
      'StarqPay', 'Starq Academy', 'Movement / Logistics',
      'Starq Studio / Dev Studio', 'Starq Dynamics', 'Starq Web · Nexus-era label',
    ].forEach((name) => expect(host.textContent).toContain(name));
    expect(host.textContent).toContain('CURRENT · current active project');
    expect(host.textContent).toContain('FUTURE / GATED');
    expect(host.textContent).toContain('GroupPermanent project');
    expect(host.textContent).toContain('Where can people discover and act on what is commercially possible?');
    expect(host.textContent).toContain('3 of 5 · first board redefinition wave after Command');
    expect(host.textContent).toContain('UNKNOWN · no current PM target field');
    expect(host.textContent).toContain('Operating capability · not a product project');
    expect(host.textContent).toContain('Commercial operating arm · not a product project');
    expect(host.textContent).toContain('Historical Nexus label · canonical mapping UNKNOWN');
    expect(host.textContent).toContain('current activity UNKNOWN');
    expect(host.textContent).toContain('No task state or progress was imported from Nexus.');
    expect(host.textContent).toContain('UNKNOWN');
    expect(host.textContent).toContain('PM-CMD-001 · Recorded blocker');
    expect(host.textContent).toContain('Owner: claude · Verifier: vision');
    expect(host.textContent).toContain('#9540 [evidence] Review evidence');
    expect(host.textContent).toContain('Recorded dependencies: PM-CMD-002');
    const blockerLink = host.querySelector<HTMLAnchorElement>('[data-project="command"] a[href*="task=PM-CMD-001"]');
    expect(blockerLink).not.toBeNull();
    expect(blockerLink!.getAttribute('href')).toBe(pmTaskHref('command', 'PM-CMD-001'));
    expect(parseBuildingRoute(blockerLink!.getAttribute('href')!)).toEqual({ view: 'studio', room: null, tab: 'Overview', projectId: 'command' });
    expect(host.textContent).not.toContain('Supplier CREATE PR #129');
    expect(fetchMock.mock.calls.every(([input, init]) => {
      const url = String(input);
      return url.includes('/api/pm/') && (init?.method === undefined || init.method === 'GET');
    })).toBe(true);
  });

  it('opens the linked task detail only when it belongs to the selected PM board', async () => {
    const command = project('command', 'Starq Command', 'CMD');
    const taskDetail = { task: blockedTask, history: [], hold: command.hold };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['claude', 'vision'] }) };
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
    expect(host.textContent).toContain('PM-CMD-001 · Recorded blocker');
    expect(host.textContent).toContain('#9540 Review evidence');
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain('http://127.0.0.1:5176/api/pm/tasks/PM-CMD-001');
  });

  it('does not fetch or display a task from another project when a deep link is mismatched', async () => {
    const erp = project('erp', 'starqERP', 'ERP');
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
