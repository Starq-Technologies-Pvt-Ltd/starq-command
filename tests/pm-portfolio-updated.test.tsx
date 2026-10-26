// @vitest-environment node
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PmPortfolio, PmPortfolioProject, PmTask } from '../src/lib/pm-client';

const pmPortfolioMock = vi.fn();
const pmProjectsMock = vi.fn();
const pmTasksMock = vi.fn();

vi.mock('@/lib/pm-client', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/pm-client')>('../src/lib/pm-client');
  return {
    ...actual,
    pmPortfolio: () => pmPortfolioMock(),
    pmProjects: () => pmProjectsMock(),
    pmTasks: (projectId: string) => pmTasksMock(projectId),
  };
});

import { PmPortfolioSurface } from '../src/surfaces/pm-portfolio';

const STATUSES = [
  'BACKLOG',
  'READY',
  'IN_PROGRESS',
  'REVIEW',
  'VERIFICATION',
  'ACCEPTANCE',
  'CLOSED',
  'BLOCKED',
  'FOUNDER_GATE',
] as const;

function emptyCounts() {
  return {
    BACKLOG: 0,
    READY: 0,
    IN_PROGRESS: 0,
    REVIEW: 0,
    VERIFICATION: 0,
    ACCEPTANCE: 0,
    CLOSED: 0,
    BLOCKED: 0,
    FOUNDER_GATE: 0,
  };
}

function project(id: string, name: string, prefix: string, overrides: Partial<PmPortfolioProject> = {}): PmPortfolioProject {
  return {
    id,
    name,
    prefix,
    total: 0,
    open: 0,
    blocked: 0,
    founder_gate: 0,
    unassigned: 0,
    counts: emptyCounts(),
    pending_room_sync: 0,
    hold: { state: null, source: 'PM project registry' },
    source_gap: null,
    ...overrides,
  };
}

function taskRow(id: string, projectId: string, updatedAt: string, overrides: Partial<PmTask> = {}): PmTask {
  return {
    id,
    project_id: projectId,
    title: `Task ${id}`,
    description: '',
    priority: 'P1',
    status: 'IN_PROGRESS',
    prior_status: null,
    owner: 'antigravity',
    verifier: 'mastracode',
    room_authorization_ref: null,
    evidence_refs: [],
    depends_on: [],
    work_package_id: null,
    notes: '',
    created_by: 'claude',
    created_at: '2026-10-25T10:00:00.000Z',
    updated_at: updatedAt,
    closed_at: null,
    allowed_next: [],
    pending_room_sync: 0,
    ...overrides,
  };
}

describe('PmPortfolioSurface project card last-updated timestamp', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:4173/#studio/projects' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(host);
    pmPortfolioMock.mockReset();
    pmProjectsMock.mockReset();
    pmTasksMock.mockReset();
    pmProjectsMock.mockResolvedValue({
      ok: true,
      data: {
        projects: [
          { id: 'command', name: 'Command', prefix: 'CMD', description: 'Internal operator console.' },
          { id: 'erp', name: 'ERP', prefix: 'ERP', description: 'Canonical ERP board.' },
          { id: 'hoadha', name: 'Hoadha', prefix: 'HDA', description: 'Hoadha board.' },
        ],
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('shows the most recent updated_at across loaded task rows on each project card, and UNKNOWN when no row has a timestamp', async () => {
    const data: PmPortfolio = {
      generated_at: '2026-10-25T14:25:00.000Z',
      statuses: STATUSES,
      pending_room_sync: 0,
      projects: [
        project('command', 'Command', 'CMD', {
          total: 3,
          open: 2,
          counts: { ...emptyCounts(), IN_PROGRESS: 2, CLOSED: 1 },
        }),
        project('erp', 'ERP', 'ERP', {
          total: 1,
          open: 1,
          counts: { ...emptyCounts(), BACKLOG: 1 },
        }),
        project('hoadha', 'Hoadha', 'HDA', {
          total: 0,
          open: 0,
        }),
      ],
    };
    pmPortfolioMock.mockResolvedValue({ ok: true, data });
    pmTasksMock.mockImplementation(async (projectId: string) => {
      if (projectId === 'command') {
        return {
          ok: true,
          data: {
            tasks: [
              taskRow('CMD-101', 'command', '2026-10-24T09:15:00.000Z'),
              taskRow('CMD-102', 'command', '2026-10-25T14:20:30.000Z'),
              taskRow('CMD-103', 'command', '2026-10-25T11:05:00.000Z'),
            ],
          },
        };
      }
      if (projectId === 'erp') {
        return {
          ok: true,
          data: {
            tasks: [
              taskRow('ERP-201', 'erp', ''),
              taskRow('ERP-202', 'erp', 'not-a-timestamp'),
            ],
          },
        };
      }
      return { ok: true, data: { tasks: [] } };
    });

    const root = createRoot(host);
    await act(async () => {
      root.render(<PmPortfolioSurface />);
    });

    const commandCard = host.querySelector('[data-project="command"]');
    const erpCard = host.querySelector('[data-project="erp"]');
    const hoadhaCard = host.querySelector('[data-project="hoadha"]');
    expect(commandCard).not.toBeNull();
    expect(erpCard).not.toBeNull();
    expect(hoadhaCard).not.toBeNull();

    const commandUpdated = commandCard?.querySelector('[data-project-last-updated="command"]');
    const erpUpdated = erpCard?.querySelector('[data-project-last-updated="erp"]');
    const hoadhaUpdated = hoadhaCard?.querySelector('[data-project-last-updated="hoadha"]');

    expect(commandUpdated?.textContent).toContain('Last updated');
    expect(commandUpdated?.textContent).toContain('2026-10-25T14:20:30.000Z');
    expect(erpUpdated?.textContent).toContain('Last updated');
    expect(erpUpdated?.textContent).toContain('UNKNOWN');
    expect(hoadhaUpdated?.textContent).toContain('Last updated');
    expect(hoadhaUpdated?.textContent).toContain('UNKNOWN');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows UNKNOWN when task loading for a project card fails', async () => {
    const data: PmPortfolio = {
      generated_at: '2026-10-25T14:25:00.000Z',
      statuses: STATUSES,
      pending_room_sync: 0,
      projects: [project('command', 'Command', 'CMD', { total: 1, open: 1 })],
    };
    pmPortfolioMock.mockResolvedValue({ ok: true, data });
    pmTasksMock.mockResolvedValue({ ok: false, message: 'PM task source unreachable' });

    const root = createRoot(host);
    await act(async () => {
      root.render(<PmPortfolioSurface />);
    });

    const commandUpdated = host.querySelector('[data-project-last-updated="command"]');
    expect(commandUpdated).not.toBeNull();
    expect(commandUpdated?.textContent).toContain('Last updated');
    expect(commandUpdated?.textContent).toContain('UNKNOWN');

    await act(async () => {
      root.unmount();
    });
  });
});
