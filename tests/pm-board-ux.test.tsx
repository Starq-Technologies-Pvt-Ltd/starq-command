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

const orgPeople = [
  { id: 'p-codex', handle: 'codex', display_name: 'Codex', kind: 'DIGITAL' },
  { id: 'p-claude', handle: 'claude', display_name: 'Claude', kind: 'HUMAN' },
];

const project = {
  id: 'command',
  name: 'Starq Command',
  prefix: 'CMD',
  description: '',
  source_gap: null,
  hold: { state: null, authority: null, effective: null, source: 'pm_projects' },
};

function installWindow(url: string) {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dom.window.localStorage.clear();
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  return host;
}

async function setControlValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const propsKey = Object.keys(el).find((key) => key.startsWith('__reactProps'));
  const props = propsKey
    ? (el as unknown as Record<string, { onChange?: (event: { target: { value: string } }) => void }>)[propsKey]
    : null;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  await act(async () => {
    if (setter) setter.call(el, value);
    else el.value = value;
    props?.onChange?.({ target: el, currentTarget: el });
  });
}

async function clickNamed(host: HTMLElement, label: string) {
  const win = dom!.window;
  const button = [...host.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === label) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`button not found: ${label}`);
  await act(async () => {
    button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

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
    const taskDetail = {
      task: {
        ...testTask1,
        evidence_refs: [{
          sequence: 10670,
          eventId: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          recordHash: null,
          senderHandle: 'codex',
          purpose: 'Build log',
          kind: 'evidence' as const,
          verified_at: '2026-10-28T01:00:00.000Z',
          received_at: '2026-10-28T01:00:00.000Z',
          authority_level: 'ROOT',
          root_authority: true,
          mentions_task: true,
        }],
      },
      history: [{
        id: 1,
        task_id: 'CMD-101',
        event_type: 'STAGE_CHANGED',
        from_status: 'IN_PROGRESS',
        to_status: 'REVIEW',
        actor: 'codex',
        detail: {},
        timestamp: '2026-10-28T01:00:00.000Z',
        room_sync: 'NOT_REQUIRED' as const,
        room_ref: { sequence: 10664, eventId: null, recordHash: null },
        room_error: null,
        room_attempts: 0,
      }],
      hold: project.hold,
      source_record: null,
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['codex', 'claude', 'ali'] }) };
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [project] }) };
      if (url.includes('/api/pm/org')) return { ok: true, json: async () => ({ people: orgPeople }) };
      if (url.includes('/api/pm/milestones')) return { ok: true, json: async () => ({ milestones: [{ id: 'ms-1', project_id: 'command', title: 'MVP', status: 'active' }] }) };
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
    const milestoneFilter = host.querySelector('select[aria-label="Filter milestone"]') as HTMLSelectElement;
    expect(milestoneFilter).not.toBeNull();
    expect([...milestoneFilter.options].map((option) => option.textContent).join(' ')).toContain('legacy text');

    const drawer = host.querySelector('[data-task-drawer]') as HTMLElement;
    expect(drawer).not.toBeNull();
    expect(drawer.style.position).toBe('fixed');
    expect(drawer.style.top).toBe('0px');
    expect(drawer.style.right).toBe('0px');
    expect(drawer.style.height).toBe('100vh');
    expect(drawer.style.width).toBe('min(36rem, 100vw)');
    expect(drawer.style.overflowY).toBe('auto');
    expect(Number(drawer.style.zIndex)).toBeGreaterThan(0);
    const board = host.querySelector('[data-pm="board"]') as HTMLElement;
    expect(board.className).not.toContain('h-screen');
    expect(board.className).not.toContain('overflow-hidden');
    expect(board.style.height).not.toBe('100vh');
    expect(host.querySelector('[draggable="true"]')).toBeNull();

    const stageButtons = [...drawer.querySelectorAll('[aria-label="Stage"] button')].map((button) => button.textContent);
    expect(stageButtons).toEqual(['BACKLOG', 'READY', 'IN_PROGRESS', 'REVIEW', 'VERIFICATION', 'ACCEPTANCE', 'CLOSED', 'BLOCKED', 'FOUNDER_GATE']);
    expect((drawer.querySelector('button[aria-label="Move to VERIFICATION"]') as HTMLButtonElement).disabled).toBe(false);
    expect((drawer.querySelector('button[aria-label="Move to READY"]') as HTMLButtonElement).disabled).toBe(false);
    expect((drawer.querySelector('button[aria-label="Move to CLOSED"]') as HTMLButtonElement).disabled).toBe(true);
    expect(drawer.querySelector('[data-derived-column]')?.textContent).toBe('Column: In Progress');
    expect(host.textContent).not.toContain('→ To Do');
    expect(host.textContent).not.toContain('→ Next Up');
    expect(host.textContent).not.toContain('→ Done');
    expect(host.textContent).not.toContain('Advance Stage');

    // Check Task Detail Panel
    expect(host.textContent).toContain('Structured Acceptance Criteria');
    expect(host.textContent).toContain('Priority chip rendered with P0 red tone');
    expect(host.textContent).toContain('Multi-agent badges displayed');
    expect(host.textContent).toContain('Structured acceptance checklist verified');
    expect(host.textContent).toContain('STAGE_CHANGED');
    expect(host.textContent).toContain('2026-10-28T01:00:00.000Z');
    expect(host.textContent).toContain('Room #10664');
    expect(host.textContent).toContain('Build log');
    expect(host.textContent).toContain('Room #10670');
    expect(drawer.querySelector('[data-legacy-milestone]')?.textContent).toBe('M1-MVP');
    expect(drawer.querySelector('[data-person-kind="DIGITAL"]')?.textContent).toBe('DIGITAL');

    // Link Room stays under Advanced / Room and is not a stage-move control.
    expect(host.textContent).toContain('Advanced / Room');
    const linkRoom = [...host.querySelectorAll('button')].find((button) => (button.textContent || '').includes('Link Room Authorization'));
    expect(linkRoom?.closest('details')?.querySelector('summary')?.textContent).toContain('Advanced / Room');
    const attachEvidence = [...host.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === 'Attach Evidence');
    expect(attachEvidence?.closest('[data-advanced-room]')).toBeNull();
    expect(host.querySelector('select[aria-label="Independent Verifier"]')).not.toBeNull();
    expect(host.querySelector('input[aria-label="Independent Verifier"]')).toBeNull();
    expect(host.textContent).toContain('GATED LIFECYCLE (ENFORCED)');

    // Check X-3: In-progress task without execution record displays NO EXECUTION RECORD
    expect(host.textContent).toContain('NO EXECUTION RECORD');

    const actingAsSelect = host.querySelector('select[aria-label="Claimed actor — not authentication"]') as HTMLSelectElement;
    expect(host.textContent).toContain('Claimed actor — not authentication');
    expect(actingAsSelect).not.toBeNull();
    const options = Array.from(actingAsSelect.options).map((o) => o.value);
    expect(options).toContain('codex');
    expect(options).toContain('claude');
    expect(options).toContain('mustarq');
    expect(options).not.toContain('ali');
    expect(options).not.toContain('nexus');
    expect(options).not.toContain('');
    expect(actingAsSelect.value).toBe('mustarq');

    await clickNamed(host, 'Close');
    expect(host.querySelector('[data-task-drawer]')).toBeNull();
    expect(host.querySelector('[data-pm="board"]')).not.toBeNull();
  });

  it('shows a server refusal inline and does not send a status field', async () => {
    let patchBody: Record<string, unknown> | null = null;
    let prompted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['codex', 'claude', 'ali'] }) };
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [project] }) };
      if (url.includes('/api/pm/org')) return { ok: true, json: async () => ({ people: orgPeople }) };
      if (url.includes('/api/pm/milestones')) return { ok: true, json: async () => ({ milestones: [] }) };
      if (url.includes('/api/pm/tasks?project_id=command')) return { ok: true, json: async () => ({ project_id: 'command', tasks: [testTask1] }) };
      if (method === 'PATCH' && url.endsWith('/api/pm/tasks/CMD-101')) {
        patchBody = JSON.parse(String(init?.body ?? '{}'));
        return { ok: false, status: 409, json: async () => ({ code: 'NOTE_REQUIRED', message: 'A note of at least 5 characters is required for a rejection.' }) };
      }
      if (method === 'GET' && url.endsWith('/api/pm/tasks/CMD-101')) {
        return { ok: true, json: async () => ({ task: testTask1, history: [], hold: project.hold, source_record: null }) };
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const host = installWindow(`http://localhost/${pmTaskHref('command', 'CMD-101')}`);
    dom!.window.prompt = () => { prompted = true; return null; };
    await act(async () => {
      root?.render(<PmBoardSurface projectId="command" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await clickNamed(host, 'VERIFICATION');
    expect(prompted).toBe(false);
    expect(patchBody).toMatchObject({ actor: 'mustarq', stage: 'VERIFICATION', expected_updated_at: testTask1.updated_at });
    expect(patchBody?.status).toBeUndefined();
    expect(patchBody?.note).toBeUndefined();
    expect(host.querySelector('[data-pm-state="saved"]')).toBeNull();
    expect(host.textContent).toContain('NOTE_REQUIRED');
    expect(host.textContent).toContain('A note of at least 5 characters is required for a rejection.');
    expect(host.textContent).toContain('Add a note explaining this move, then try again.');
  });

  it('keeps the typed title on STALE_EDIT and reloads only the record version', async () => {
    const patches: Array<Record<string, unknown>> = [];
    let reloading = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['codex'] }) };
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [project] }) };
      if (url.includes('/api/pm/org')) return { ok: true, json: async () => ({ people: orgPeople }) };
      if (url.includes('/api/pm/milestones')) return { ok: false, status: 503, json: async () => ({ code: 'UNAVAILABLE', message: 'Milestone service is down.' }) };
      if (url.includes('/api/pm/tasks?project_id=command')) return { ok: true, json: async () => ({ project_id: 'command', tasks: [testTask1] }) };
      if (method === 'PATCH' && url.endsWith('/api/pm/tasks/CMD-101')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        patches.push(body);
        if (patches.length === 1) {
          return { ok: false, status: 409, json: async () => ({ code: 'STALE_EDIT', message: 'Task changed since you loaded it; reload before editing. Nothing was saved.' }) };
        }
        return { ok: true, json: async () => ({ task: { ...testTask1, title: body.title, updated_at: '2026-10-29T00:00:00.000Z' }, history: [], hold: project.hold, source_record: null }) };
      }
      if (method === 'GET' && url.endsWith('/api/pm/tasks/CMD-101')) {
        return {
          ok: true,
          json: async () => ({
            task: { ...testTask1, updated_at: reloading ? '2026-10-29T00:00:00.000Z' : testTask1.updated_at },
            history: [],
            hold: project.hold,
            source_record: null,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const host = installWindow(`http://localhost/${pmTaskHref('command', 'CMD-101')}`);
    await act(async () => {
      root?.render(<PmBoardSurface projectId="command" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const drawer = host.querySelector('[data-task-drawer]') as HTMLElement;
    expect(drawer.querySelector('select[aria-label="Milestone"]')).toBeNull();
    expect(drawer.textContent).toContain('UNAVAILABLE');
    expect(drawer.textContent).toContain('Milestone service is down.');
    expect(drawer.querySelector('[data-legacy-milestone]')?.textContent).toBe('M1-MVP');
    expect(drawer.textContent).toContain('No timeline on this record.');

    const title = drawer.querySelector('input[aria-label="Task title"]') as HTMLInputElement;
    const description = drawer.querySelector('textarea[aria-label="Description"]') as HTMLTextAreaElement;
    await setControlValue(title, 'Unsaved title');
    await setControlValue(description, 'Unsaved description');
    await clickNamed(host, 'Save Changes');

    const titleAfter = drawer.querySelector('input[aria-label="Task title"]') as HTMLInputElement;
    const descriptionAfter = drawer.querySelector('textarea[aria-label="Description"]') as HTMLTextAreaElement;
    expect(titleAfter.value).toBe('Unsaved title');
    expect(descriptionAfter.value).toBe('Unsaved description');
    expect(host.querySelector('[data-pm-state="saved"]')).toBeNull();
    expect(host.textContent).toContain('STALE_EDIT');
    expect(host.textContent).toContain('Task changed since you loaded it; reload before editing. Nothing was saved.');
    expect(host.textContent).toContain('This record changed after you opened it. Your unsaved edits are still here.');

    reloading = true;
    await clickNamed(host, 'Reload and reapply');
    expect((drawer.querySelector('input[aria-label="Task title"]') as HTMLInputElement).value).toBe('Unsaved title');
    expect((drawer.querySelector('textarea[aria-label="Description"]') as HTMLTextAreaElement).value).toBe('Unsaved description');

    await clickNamed(host, 'Save Changes');
    expect(patches[1]?.title).toBe('Unsaved title');
    expect(patches[1]?.description).toBe('Unsaved description');
    expect(patches[1]?.expected_updated_at).toBe('2026-10-29T00:00:00.000Z');
    expect(patches[1]?.status).toBeUndefined();
  });

  it('saves the edited title and shows the following read', async () => {
    let patchBody: Record<string, unknown> | null = null;
    let readback = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['codex'] }) };
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [project] }) };
      if (url.includes('/api/pm/org')) return { ok: true, json: async () => ({ people: orgPeople }) };
      if (url.includes('/api/pm/milestones')) return { ok: true, json: async () => ({ milestones: [] }) };
      if (url.includes('/api/pm/tasks?project_id=command')) return { ok: true, json: async () => ({ project_id: 'command', tasks: [testTask1] }) };
      if (method === 'PATCH' && url.endsWith('/api/pm/tasks/CMD-101')) {
        patchBody = JSON.parse(String(init?.body ?? '{}'));
        readback = true;
        return { ok: true, json: async () => ({ task: { ...testTask1, title: 'PATCH_BODY_TITLE', stage: 'BACKLOG' }, history: [], hold: project.hold, source_record: null }) };
      }
      if (method === 'GET' && url.endsWith('/api/pm/tasks/CMD-101')) {
        const task = readback
          ? { ...testTask1, title: 'Edited title', stage: 'VERIFICATION', updated_at: '2026-10-28T02:00:00.000Z' }
          : testTask1;
        return { ok: true, json: async () => ({ task, history: [], hold: project.hold, source_record: null }) };
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const host = installWindow(`http://localhost/${pmTaskHref('command', 'CMD-101')}`);
    await act(async () => {
      root?.render(<PmBoardSurface projectId="command" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const title = host.querySelector('[data-task-drawer] input[aria-label="Task title"]') as HTMLInputElement;
    await setControlValue(title, 'Edited title');
    await clickNamed(host, 'Save Changes');

    expect(patchBody?.title).toBe('Edited title');
    expect(patchBody?.actor).toBe('mustarq');
    expect(patchBody?.expected_updated_at).toBe(testTask1.updated_at);
    expect(patchBody?.status).toBeUndefined();
    expect(patchBody?.milestone_id).toBeUndefined();
    expect(host.querySelector('[data-task-title]')?.textContent).toBe('Edited title');
    expect(host.querySelector('[data-task-stage]')?.textContent).toBe('Stage: VERIFICATION');
    expect((host.querySelector('[data-task-drawer] input[aria-label="Task title"]') as HTMLInputElement).value).toBe('Edited title');
    expect(host.textContent).not.toContain('PATCH_BODY_TITLE');
    expect(host.querySelector('[data-pm-state="saved"]')?.textContent).toContain('Saved.');
  });

  it('creates a card and shows the following read', async () => {
    let postBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['codex'] }) };
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [project] }) };
      if (url.includes('/api/pm/org')) return { ok: true, json: async () => ({ people: orgPeople }) };
      if (url.includes('/api/pm/milestones')) return { ok: true, json: async () => ({ milestones: [] }) };
      if (url.includes('/api/pm/tasks?project_id=command')) return { ok: true, json: async () => ({ project_id: 'command', tasks: [testTask1] }) };
      if (method === 'POST' && url.endsWith('/api/pm/tasks')) {
        postBody = JSON.parse(String(init?.body ?? '{}'));
        return { ok: true, json: async () => ({ task: { ...testTask1, id: 'CMD-201', title: 'FROM_POST', stage: 'REVIEW' }, history: [], hold: project.hold, source_record: null }) };
      }
      if (method === 'GET' && url.endsWith('/api/pm/tasks/CMD-201')) {
        return { ok: true, json: async () => ({ task: { ...testTask1, id: 'CMD-201', title: 'Created card', stage: 'BACKLOG', status: 'TODO' }, history: [], hold: project.hold, source_record: null }) };
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const host = installWindow('http://localhost/#studio/command');
    await act(async () => {
      root?.render(<PmBoardSurface projectId="command" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await clickNamed(host, 'New card');
    const title = host.querySelector('form[aria-label="New task"] input[aria-label="Task title"]') as HTMLInputElement;
    await setControlValue(title, 'Created card');
    const form = host.querySelector('form[aria-label="New task"]') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new dom!.window.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(postBody?.title).toBe('Created card');
    expect(postBody?.actor).toBe('mustarq');
    expect(postBody?.project_id).toBe('command');
    expect(postBody?.status).toBeUndefined();
    expect(host.querySelector('[data-task-title]')?.textContent).toBe('Created card');
    expect(host.querySelector('[data-task-stage]')?.textContent).toBe('Stage: BACKLOG');
    expect(host.textContent).not.toContain('FROM_POST');
    expect(host.querySelector('[data-pm-state="saved"]')?.textContent).toContain('Task added.');
  });
});
