// @vitest-environment node
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PmPortfolio, PmPortfolioProject } from '../src/lib/pm-client';

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

describe('PmPortfolioSurface portfolio-wide totals row', () => {
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
    pmTasksMock.mockResolvedValue({ ok: true, data: { tasks: [] } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('renders a portfolio totals row above the project grid that equals the sum of per-project cards', async () => {
    const data: PmPortfolio = {
      generated_at: '2026-10-25T13:55:00.000Z',
      statuses: STATUSES,
      pending_room_sync: 0,
      projects: [
        project('command', 'Command', 'CMD', {
          total: 6,
          open: 4,
          blocked: 1,
          founder_gate: 2,
          unassigned: 3,
          counts: { ...emptyCounts(), IN_PROGRESS: 1, BLOCKED: 1, FOUNDER_GATE: 2, CLOSED: 2 },
        }),
        project('erp', 'ERP', 'ERP', {
          total: 5,
          open: 3,
          blocked: 2,
          founder_gate: 0,
          unassigned: 1,
          counts: { ...emptyCounts(), READY: 1, BLOCKED: 2, CLOSED: 2 },
        }),
        project('hoadha', 'Hoadha', 'HDA', {
          total: 2,
          open: 2,
          blocked: 0,
          founder_gate: 1,
          unassigned: 2,
          counts: { ...emptyCounts(), BACKLOG: 1, FOUNDER_GATE: 1 },
        }),
      ],
    };
    pmPortfolioMock.mockResolvedValue({ ok: true, data });

    const root = createRoot(host);
    await act(async () => {
      root.render(<PmPortfolioSurface />);
    });

    const totalsRow = host.querySelector('[data-portfolio-totals="pm-portfolio"]');
    const projectGrid = host.querySelector('[data-project-grid="pm-portfolio"]');
    expect(totalsRow).not.toBeNull();
    expect(projectGrid).not.toBeNull();
    expect(totalsRow?.nextElementSibling).toBe(projectGrid);

    const commandCard = host.querySelector('[data-project="command"]');
    const erpCard = host.querySelector('[data-project="erp"]');
    const hoadhaCard = host.querySelector('[data-project="hoadha"]');
    expect(commandCard?.textContent).toContain('4 / 6');
    expect(erpCard?.textContent).toContain('3 / 5');
    expect(hoadhaCard?.textContent).toContain('2 / 2');

    expect(totalsRow?.textContent).toContain('Registered PM board totals (3)');
    expect(totalsRow?.textContent).toContain('Open: 9');
    expect(totalsRow?.textContent).toContain('Blocked: 3');
    expect(totalsRow?.textContent).toContain('Founder gate: 3');
    expect(totalsRow?.textContent).toContain('Unassigned: 6');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows UNKNOWN in the total (not zero) when any project has UNKNOWN or missing counts', async () => {
    const data: PmPortfolio = {
      generated_at: '2026-10-25T13:55:00.000Z',
      statuses: STATUSES,
      pending_room_sync: 0,
      projects: [
        project('command', 'Command', 'CMD', {
          total: 4,
          open: 3,
          blocked: 1,
          founder_gate: 2,
          unassigned: 4,
        }),
        project('erp', 'ERP', 'ERP', {
          total: 2,
          open: undefined as unknown as number,
          blocked: 'UNKNOWN' as unknown as number,
          founder_gate: Number.NaN,
          unassigned: 1,
        }),
        project('hoadha', 'Hoadha', 'HDA', {
          total: 1,
          open: 1,
          blocked: 0,
          founder_gate: 0,
          unassigned: 2,
        }),
      ],
    };
    pmPortfolioMock.mockResolvedValue({ ok: true, data });

    const root = createRoot(host);
    await act(async () => {
      root.render(<PmPortfolioSurface />);
    });

    const totalsRow = host.querySelector('[data-portfolio-totals="pm-portfolio"]');
    expect(totalsRow).not.toBeNull();
    expect(totalsRow?.textContent).toContain('Open: UNKNOWN');
    expect(totalsRow?.textContent).toContain('Blocked: UNKNOWN');
    expect(totalsRow?.textContent).toContain('Founder gate: UNKNOWN');
    expect(totalsRow?.textContent).toContain('Unassigned: 7');

    const erpCard = host.querySelector('[data-project="erp"]');
    expect(erpCard?.textContent).toContain('UNKNOWN / 2');

    await act(async () => {
      root.unmount();
    });
  });
});
