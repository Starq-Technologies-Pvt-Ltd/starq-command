// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PmPortfolioSurface, PmNav, getOperationalQualifier, PROJECT_GROUPS } from '@/surfaces/pm-portfolio';
import { PmBoardSurface } from '@/surfaces/pm-board';
import { SoftwareFactorySurface } from '@/surfaces/factory';
import { UnavailableState } from '@/components/state-gate';

const scratchDir = 'D:/AgentRuntimes/Hermes/profiles/command-qa/cache/scratch';

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

function setupHost(html = '<!doctype html><html><body><div id="root"></div></body></html>', url = 'http://localhost/#studio/projects') {
  dom = new JSDOM(html, { url });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  return host;
}

function writeHtml(name: string, html: string) {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = path.join(scratchDir, name);
  fs.mkdirSync(scratchDir, { recursive: true });
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

describe('E2E readback baseline (disposable fixtures, no Room access)', () => {
  it('portfolio: renders project boards, qualifiers, governance notice, source archive unavailable', async () => {
    const portfolio = {
      generated_at: '2026-10-28T00:00:00.000Z',
      pending_room_sync: 0,
      statuses: ['TODO', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'DONE'],
      projects: [
        {
          id: 'erp', name: 'starqERP', prefix: 'SERP',
          hold: { state: 'ON_HOLD', authority: 'CP2 #12690', effective: '2026-10-15', source: 'pm_projects' },
          source_gap: null, total: 437, open: 204,
          counts: { TODO: 100, NEXT: 50, IN_PROGRESS: 54, BLOCKED: 10, DONE: 233 },
          done_historical: 233, historical_total: 437,
          founder_gate: 0, blocked: 10, pending_room_sync: 0, unassigned: 20,
          metrics: { claimed: { done: 233, total: 437, percent: 53 }, committed: { count: 0, total: 233, percent: 0 }, proven: { count: 0, total: 233, percent: 0 }, capability: null },
          execution_qualifier: null,
        },
        {
          id: 'hoadha', name: 'Hoadha', prefix: 'HAD',
          hold: { state: null, authority: null, effective: null, source: 'pm_projects' },
          source_gap: null, total: 12, open: 3,
          counts: { TODO: 2, NEXT: 1, IN_PROGRESS: 0, BLOCKED: 0, DONE: 9 },
          done_historical: 9, historical_total: 12,
          founder_gate: 0, blocked: 0, pending_room_sync: 0, unassigned: 1,
          metrics: { claimed: { done: 9, total: 12, percent: 75 }, committed: { count: 0, total: 9, percent: 0 }, proven: { count: 0, total: 9, percent: 0 }, capability: null },
          execution_qualifier: 'PRE-ACTIVATION',
        },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/portfolio')) return { ok: true, json: async () => portfolio } as Response;
      if (url.endsWith('/api/pm/nexus/sources')) return { ok: true, json: async () => ({ sources: [] }) } as Response;
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [] }) } as Response;
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<PmPortfolioSurface />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const text = host.textContent || '';
    expect(text).toContain('Project boards');
    expect(text).toContain('starqERP');
    expect(text).toContain('Hoadha');
    expect(text).toContain('ACTIVE (CP2 #12690 HOLD)');
    expect(text).toContain('PRE-ACTIVATION');
    expect(text).toContain('Truthful Progress & Operational Readiness');
    expect(text).toContain('Historical tasks closed:');
    expect(text).toContain('233 / 437');
    expect(text).toContain('Tasks with commit:');
    expect(text).toContain('Verified acceptance:');
    expect(text).toContain('Plan capability:');
    expect(text).toContain('NO CURRENT PLAN');
    expect(text).toContain('Source records & history');
    writeHtml('e2e-portfolio.html', `<html><body><pre>${host.innerHTML}</pre></body></html>`);
  });

  it('project board: renders kanban lanes, filters, detail, workers, stages, evidence', async () => {
    const project = { id: 'command', name: 'Starq Command', prefix: 'CMD', description: '', source_gap: null, hold: { state: null, authority: null, effective: null, source: 'pm_projects' } };
    const taskDetail = {
      task: {
        id: 'CMD-101', project_id: 'command', title: 'Implement WP-1 Kanban Fidelity', description: '...', priority: 'P0', priority_raw: 'urgent',
        status: 'IN_PROGRESS', prior_status: 'NEXT', stage: 'REVIEW', prior_stage: 'IN_PROGRESS', provenance: 'LIVE', gated: true,
        owner: 'codex', verifier: 'ali', workers: ['codex', 'claude'], epic: 'BOARD-UX', milestone: 'M1-MVP', release_track: 'ALPHA',
        acceptance_json: JSON.stringify(['- [x] Priority chip rendered with P0 red tone', '- [ ] Multi-agent badges displayed', { text: 'Structured acceptance checklist verified', done: true }]),
        evidence_refs: [], room_authorization_ref: { sequence: 10663, eventId: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', recordHash: null, senderHandle: 'ali', purpose: 'Authorization', kind: 'authorization', verified_at: '2026-10-28T00:00:00.000Z', received_at: '2026-10-28T00:00:00.000Z', authority_level: 'ROOT', root_authority: true, mentions_task: true },
        depends_on: [], notes: '', created_by: 'ali', created_at: '2026-10-28T00:00:00.000Z', updated_at: '2026-10-28T01:00:00.000Z', closed_at: null,
        allowed_next: ['TODO', 'NEXT', 'IN_PROGRESS', 'DONE'], allowed_stage_next: ['VERIFICATION', 'READY'], pending_room_sync: 0,
      },
      history: [], hold: project.hold, source_record: null,
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses: ['TODO','NEXT','IN_PROGRESS','BLOCKED','DONE'], priorities: ['P0','P1','P2','P3'], handles: ['codex','claude','ali','antigravity'] }) } as Response;
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [project] }) } as Response;
      if (url.includes('/api/pm/tasks?project_id=command')) return { ok: true, json: async () => ({ project_id: 'command', tasks: [taskDetail.task] }) } as Response;
      if (url.endsWith('/api/pm/tasks/CMD-101')) return { ok: true, json: async () => taskDetail } as Response;
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost('<!doctype html><html><body><div id="root"></div></body></html>', 'http://localhost/#studio/command/tasks?task=CMD-101');
    await act(async () => {
      root?.render(<PmBoardSurface projectId="command" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const text = host.textContent || '';
    expect(text).toContain('Starq Command');
    expect(text).toContain('CMD-101');
    expect(text).toContain('Implement WP-1 Kanban Fidelity');
    expect(text).toContain('P0 (urgent)');
    expect(text).toContain('LIVE');
    expect(text).toContain('[REVIEW]');
    expect(text).toContain('codex');
    expect(text).toContain('claude');
    expect(text).toContain('Structured Acceptance Criteria');
    expect(text).toContain('Priority chip rendered with P0 red tone');
    expect(text).toContain('Multi-agent badges displayed');
    expect(text).toContain('Link Room Authorization');
    expect(text).toContain('Attach Evidence');
    expect(text).toContain('GATED LIFECYCLE (ENFORCED)');
    expect(text).toContain('Room Auth: #10663');
    expect(text).not.toContain('→ Done');
    expect(text).not.toContain('→ Next Up');
    expect(text).toContain('Column: In Progress');
    expect(text).toContain('VERIFICATION');
    expect(text).toContain('READY');
    expect(text).toContain('NO EXECUTION RECORD');

    writeHtml('e2e-board.html', `<html><body><pre>${host.innerHTML}</pre></body></html>`);
  });

  it('workforce: renders available workforce with UNKNOWN when data missing', async () => {
    const workforce = {
      generated_at: '2026-10-28T00:00:00.000Z',
      state: 'READY',
      seats: [
        { handle: 'codex', provider_owner: 'openai', product_client: 'codex', capacity_class: 'BUILDER', workforce_function: 'builder', role_family: 'engineering', availability: 'AVAILABLE', dispatch_eligible: true, capabilities: { values: ['coding','typescript'], evidence: ['sha:abc'] }, runtime: { session_id: 'sess-1', observed: true, observed_at: '2026-10-28T00:00:01.000Z' }, workload: { task_ids: ['CMD-101'] }, pane_binding: { state: 'BOUND' } },
        { handle: 'claude', provider_owner: 'anthropic', product_client: 'claude', capacity_class: 'VERIFIER', workforce_function: 'verifier', role_family: 'engineering', availability: 'OFFLINE', dispatch_eligible: false, capabilities: { values: [], evidence: [] }, runtime: { session_id: null, observed: false, observed_at: null }, workload: { task_ids: [] }, pane_binding: { state: 'CONFLICT' } },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/command/workforce')) return { ok: true, json: async () => workforce } as Response;
      if (url.includes('/api/pm/tasks?project=')) return { ok: true, json: async () => ({ project_id: 'command', tasks: [] }) } as Response;
      if (url.includes('/api/pm/tasks/CMD-101')) return { ok: true, json: async () => ({ task: { project_id: 'command', owner: 'codex', verifier: 'ali' } }) } as Response;
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<SoftwareFactorySurface />);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const workforceBtn = Array.from(host.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Workforce'));
    if (!workforceBtn) throw new Error('Workforce tab button not found');
    await act(async () => {
      (workforceBtn as HTMLElement).dispatchEvent(new dom!.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const text = host.textContent || '';
    expect(text).toContain('Software Factory');
    expect(text).toContain('Workforce (2) READY');
    expect(text).toContain('codex');
    expect(text).toContain('claude');
    expect(text).toContain('AVAILABLE');
    expect(text).toContain('OFFLINE');
    expect(text).toContain('coding, typescript');
    expect(text).toContain('NO VERIFIED CAPABILITY');
    expect(text).toContain('Herdr');
    expect(text).toContain('UNKNOWN');

    writeHtml('e2e-factory-workforce.html', `<html><body><pre>${host.innerHTML}</pre></body></html>`);
  });

  it('unavailable/unknown: surfaces render truthful empty states without Room access', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/portfolio')) return { ok: false, status: 503, json: async () => ({ message: 'PM service unavailable', code: 'UNAVAILABLE' }) } as Response;
      if (url.endsWith('/api/pm/nexus/sources')) return { ok: true, json: async () => ({ sources: [] }) } as Response;
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [] }) } as Response;
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<PmPortfolioSurface />);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const text = host.textContent || '';
    expect(text).toContain('PM service unavailable');
    expect(text).toContain('Start it with');
    expect(text).toContain('npm run os:start');
    expect(text).toContain('PM service unavailable.');

    writeHtml('e2e-unavailable.html', `<html><body><pre>${host.innerHTML}</pre></body></html>`);
  });
});
