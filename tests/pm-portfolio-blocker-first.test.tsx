// @vitest-environment node
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PmPortfolio, PmPortfolioProject, PmStatus, PmTask } from '../src/lib/pm-client';

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

function taskRow(id: string, projectId: string, status: PmStatus, title: string, overrides: Partial<PmTask> = {}): PmTask {
  return {
    id,
    project_id: projectId,
    title,
    description: '',
    priority: 'P1',
    status,
    prior_status: null,
    owner: 'antigravity',
    verifier: 'cursor',
    room_authorization_ref: null,
    evidence_refs: [],
    depends_on: [],
    work_package_id: null,
    notes: '',
    created_by: 'claude',
    created_at: '2026-10-25T10:00:00.000Z',
    updated_at: '2026-10-25T16:30:00.000Z',
    closed_at: null,
    allowed_next: [],
    pending_room_sync: 0,
    ...overrides,
  };
}

describe('PmPortfolioSurface recorded blockers and Founder gates ordering', () => {
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
        ],
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('lists BLOCKED rows before FOUNDER_GATE rows in the recorded blockers and Founder gates section even when FOUNDER_GATE arrives first', async () => {
    const data: PmPortfolio = {
      generated_at: '2026-10-25T16:30:00.000Z',
      statuses: STATUSES,
      pending_room_sync: 0,
      projects: [
        project('command', 'Command', 'CMD', {
          total: 2,
          open: 2,
          blocked: 1,
          founder_gate: 1,
          counts: { ...emptyCounts(), BLOCKED: 1, FOUNDER_GATE: 1 },
        }),
      ],
    };
    pmPortfolioMock.mockResolvedValue({ ok: true, data });
    pmTasksMock.mockResolvedValue({
      ok: true,
      data: {
        tasks: [
          taskRow('CMD-010', 'command', 'FOUNDER_GATE', 'Founder approval gate for release'),
          taskRow('CMD-020', 'command', 'BLOCKED', 'Blocked on upstream schema lock'),
        ],
      },
    });

    const root = createRoot(host);
    await act(async () => {
      root.render(<PmPortfolioSurface />);
    });

    const card = host.querySelector('[data-project="command"]');
    expect(card).not.toBeNull();

    const section = card?.querySelector('[data-blockers-and-gates="command"]');
    expect(section).not.toBeNull();

    const rows = Array.from(section?.querySelectorAll('[data-blocker-or-gate]') ?? []);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-blocker-or-gate')).toBe('CMD-020');
    expect(rows[0]?.getAttribute('data-blocker-or-gate-status')).toBe('BLOCKED');
    expect(rows[0]?.textContent).toContain('CMD-020 · Blocked on upstream schema lock');
    expect(rows[1]?.getAttribute('data-blocker-or-gate')).toBe('CMD-010');
    expect(rows[1]?.getAttribute('data-blocker-or-gate-status')).toBe('FOUNDER_GATE');
    expect(rows[1]?.textContent).toContain('CMD-010 · Founder approval gate for release');

    await act(async () => {
      root.unmount();
    });
  });
});
