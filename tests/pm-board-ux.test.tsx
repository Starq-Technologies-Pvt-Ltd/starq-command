// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pmTaskHref, type PmTask } from '@/lib/pm-client';
import { PmBoardSurface } from '@/surfaces/pm-board';
import { PmNav, PmPortfolioSurface, getOperationalQualifier, PROJECT_GROUPS } from '@/surfaces/pm-portfolio';

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

const testTask1: PmTask = {
  id: 'CMD-101',
  project_id: 'command',
  title: 'Implement WP-1 Kanban Fidelity',
  description: 'Detailed description for WP-1',
  priority: 'P0',
  priority_raw: 'urgent',
  status: 'IN_PROGRESS',
  prior_status: 'NEXT',
  stage: 'REVIEW',
  prior_stage: 'IN_PROGRESS',
  provenance: 'LIVE',
  gated: true,
  owner: 'codex',
  verifier: 'ali',
  workers: ['codex', 'claude'],
  epic: 'BOARD-UX',
  milestone: 'M1-MVP',
  release_track: 'ALPHA',
  acceptance_json: JSON.stringify([
    '- [x] Priority chip rendered with P0 red tone',
    '- [ ] Multi-agent badges displayed',
    { text: 'Structured acceptance checklist verified', done: true },
  ]),
  evidence_refs: [],
  room_authorization_ref: {
    sequence: 10663,
    eventId: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    recordHash: null,
    senderHandle: 'ali',
    purpose: 'Authorization',
    kind: 'authorization',
    verified_at: '2026-10-28T00:00:00.000Z',
    received_at: '2026-10-28T00:00:00.000Z',
    authority_level: 'ROOT',
    root_authority: true,
    mentions_task: true,
  },
  depends_on: [],
  notes: '',
  created_by: 'ali',
  created_at: '2026-10-28T00:00:00.000Z',
  updated_at: '2026-10-28T01:00:00.000Z',
  closed_at: null,
  allowed_next: ['TODO', 'NEXT', 'IN_PROGRESS', 'DONE'],
  allowed_stage_next: ['VERIFICATION', 'READY'],
  pending_room_sync: 0,
};

const testTask2: PmTask = {
  id: 'CMD-102',
  project_id: 'command',
  title: 'Historical Nexus Task',
  description: 'Imported from nexus',
  priority: 'P2',
  priority_raw: null,
  status: 'DONE',
  prior_status: 'IN_PROGRESS',
  stage: 'CLOSED',
  provenance: 'HISTORICAL_NEXUS',
  gated: false,
  owner: 'claude',
  verifier: 'UNASSIGNED',
  workers: ['claude'],
  epic: null,
  milestone: null,
  release_track: null,
  acceptance_json: null,
  evidence_refs: [],
  room_authorization_ref: null,
  depends_on: [],
  notes: '',
  created_by: 'nexus-import',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-02T00:00:00.000Z',
  closed_at: '2026-06-02T00:00:00.000Z',
  allowed_next: [],
  allowed_stage_next: [],
  pending_room_sync: 0,
};

describe('WP-4 / WP-5 Truthful Progress & Operational Qualifiers', () => {
  it('correctly maps projects to truthful operational qualifiers', () => {
    expect(getOperationalQualifier('erp').label).toBe('ACTIVE (CP2 #12690 HOLD)');
    expect(getOperationalQualifier('erp').tone).toBe('hold');

    expect(getOperationalQualifier('hoadha').label).toBe('PRE-ACTIVATION');
    expect(getOperationalQualifier('hoadha').tone).toBe('stale');

    expect(getOperationalQualifier('portal').label).toBe('HISTORICAL');
    expect(getOperationalQualifier('portal').tone).toBe('muted');

    expect(getOperationalQualifier('pos').label).toBe('HISTORICAL');
    expect(getOperationalQualifier('starqbooks').label).toBe('HISTORICAL');

    expect(getOperationalQualifier('command').label).toBe('ACTIVE');
    expect(getOperationalQualifier('command').tone).toBe('room');
  });

  it('renders governance notice banner and truthful progress on portfolio', async () => {
    const portfolio = {
      generated_at: '2026-10-28T00:00:00.000Z',
      pending_room_sync: 0,
      statuses,
      projects: [
        {
          id: 'erp',
          name: 'starqERP',
          prefix: 'SERP',
          hold: { state: 'ON_HOLD', authority: 'CP2 #12690', effective: '2026-10-15', source: 'pm_projects' },
          source_gap: null,
          total: 437,
          open: 204,
          counts: { TODO: 100, NEXT: 50, IN_PROGRESS: 54, BLOCKED: 10, DONE: 233 },
          done_historical: 233,
          historical_total: 437,
          founder_gate: 0,
          blocked: 10,
          pending_room_sync: 0,
          unassigned: 20,
          dec072_progress: {
            claimed: 233,
            committed: 0,
            proven: 0,
            capability: null,
          },
        },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/portfolio')) return { ok: true, json: async () => portfolio };
      if (url.endsWith('/api/pm/nexus/sources')) return { ok: true, json: async () => ({ sources: [] }) };
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [] }) };
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
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

    expect(host.textContent).toContain('Truthful Progress & Operational Readiness');
    expect(host.textContent).toContain('Historical ticket status does not indicate operational software readiness');
    expect(host.textContent).toContain('Historical tasks closed:');
    expect(host.textContent).toContain('233 / 437');
    expect(host.textContent).toContain('ACTIVE (CP2 #12690 HOLD)');
    // DEC-072 Rule 1: No progress bar with width based on done/total
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    // 4 Honest Tiers
    expect(host.textContent).toContain('Historical tasks closed:');
    expect(host.textContent).toContain('Tasks with commit:');
    expect(host.textContent).toContain('Verified acceptance:');
    expect(host.textContent).toContain('Plan capability:');
    expect(host.textContent).toContain('NO CURRENT PLAN');
  });
});

describe('Dynamic Project Switcher (PmNav)', () => {
  it('defines the required project groups', () => {
    const groupNames = PROJECT_GROUPS.map((g) => g.name);
    expect(groupNames).toContain('Products');
    expect(groupNames).toContain('Studio');
    expect(groupNames).toContain('Governance');
    expect(groupNames).toContain('Services');
    expect(groupNames).toContain('Future Companies');
    expect(groupNames).toContain('Personal');
    expect(groupNames).toContain('Historical Products');
  });

  it('renders category switcher and links in PmNav', async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => {
      root?.render(<PmNav current="command" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain('All boards');
    expect(host.textContent).toContain('Studio');
    expect(host.textContent).toContain('Command');
  });
});

describe('WP-1 / WP-2 Kanban Board & Task Details', () => {
  it('renders high fidelity Kanban cards with priority, provenance, workers, and governance stages', async () => {
    const project = { id: 'command', name: 'Starq Command', prefix: 'CMD', description: '', source_gap: null, hold: { state: null, authority: null, effective: null, source: 'pm_projects' } };
    const taskDetail = { task: testTask1, history: [], hold: project.hold, source_record: null };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['codex', 'claude', 'ali'] }) };
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [project] }) };
      if (url.includes('/api/pm/tasks?project_id=command')) return { ok: true, json: async () => ({ project_id: 'command', tasks: [testTask1, testTask2] }) };
      if (url.endsWith('/api/pm/tasks/CMD-101')) return { ok: true, json: async () => taskDetail };
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: `http://localhost/${pmTaskHref('command', 'CMD-101')}`,
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

    // Check Kanban Card Fidelity
    expect(host.textContent).toContain('CMD-101');
    expect(host.textContent).toContain('P0 (urgent)');
    expect(host.textContent).toContain('LIVE');
    expect(host.textContent).toContain('Epic: BOARD-UX');
    expect(host.textContent).toContain('M: M1-MVP');
    expect(host.textContent).toContain('[REVIEW]');
    expect(host.textContent).toContain('codex');
    expect(host.textContent).toContain('claude');

    // Check Task 2 (Historical)
    expect(host.textContent).toContain('CMD-102');
    expect(host.textContent).toContain('HISTORICAL');
    expect(host.textContent).toContain('[CLOSED]');

    // Check Filter & Sort Controls
    expect(host.querySelector('select[aria-label="Filter Priority"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="Filter Provenance"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="Filter Stage"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="Filter Worker"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="Sort cards"]')).not.toBeNull();

    // Check Task Detail Panel
    expect(host.textContent).toContain('Structured Acceptance Criteria');
    expect(host.textContent).toContain('Priority chip rendered with P0 red tone');
    expect(host.textContent).toContain('Multi-agent badges displayed');
    expect(host.textContent).toContain('Structured acceptance checklist verified');

    // Check Gated Lifecycle Operability Controls (WP-2)
    expect(host.textContent).toContain('Link Room Authorization');
    expect(host.textContent).toContain('Attach Evidence');
    expect(host.querySelector('input[aria-label="Independent Verifier"]')).not.toBeNull();
    expect(host.textContent).toContain('GATED LIFECYCLE (ENFORCED)');

    // Check X-3: In-progress task without execution record displays NO EXECUTION RECORD
    expect(host.textContent).toContain('NO EXECUTION RECORD');

    // Check R-4: Retired handles filtered from Acting as
    const actingAsSelect = host.querySelector('select[aria-label="Acting as"]') as HTMLSelectElement;
    expect(actingAsSelect).not.toBeNull();
    const options = Array.from(actingAsSelect.options).map((o) => o.value);
    expect(options).toContain('codex');
    expect(options).toContain('claude');
    expect(options).not.toContain('ali');
    expect(options).not.toContain('nexus');
  });
});
