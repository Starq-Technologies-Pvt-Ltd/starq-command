// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MilestonesPanel } from '@/components/milestones-panel';

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

function mount(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  return host;
}

const milestone = {
  id: 'MS-CMD-001', project_id: 'command', title: 'Project boards v1', description: '', target_date: '2026-12-01',
  status: 'OPEN', created_by: 'claude', created_at: '2026-10-17T00:00:00.000Z', updated_at: '2026-10-17T00:00:00.000Z',
  work_package_counts: { OPEN: 1, IN_PROGRESS: 0, DONE: 0 }, work_package_total: 1,
};
const workPackage = {
  id: 'WP-CMD-001', project_id: 'command', milestone_id: 'MS-CMD-001', title: 'PM API extensions', description: '',
  owner: 'claude', status: 'OPEN', created_by: 'claude', created_at: '2026-10-17T00:00:00.000Z', updated_at: '2026-10-17T00:00:00.000Z',
  closed_at: null,
  task_counts: { BACKLOG: 1, READY: 0, IN_PROGRESS: 0, REVIEW: 0, VERIFICATION: 0, ACCEPTANCE: 0, CLOSED: 0, BLOCKED: 0, FOUNDER_GATE: 0 },
  task_total: 1,
};

describe('MilestonesPanel', () => {
  it('renders milestones and work packages from the PM service, with their rollups', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/pm/milestones')) return { ok: true, json: async () => ({ project_id: 'command', milestones: [milestone] }) };
      if (url.includes('/api/pm/work-packages')) return { ok: true, json: async () => ({ project_id: 'command', milestone_id: null, work_packages: [workPackage] }) };
      throw new Error(`unexpected fetch: ${url}`);
    });
    const host = mount(fetchMock);
    await act(async () => {
      root?.render(<MilestonesPanel projectId="command" actor="claude" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.querySelector('[data-milestone-id="MS-CMD-001"]')?.textContent).toContain('Project boards v1');
    expect(host.querySelector('[data-milestone-id="MS-CMD-001"]')?.textContent).toContain('1 work package');
    expect(host.querySelector('[data-wp-id="WP-CMD-001"]')?.textContent).toContain('PM API extensions');
    expect(host.querySelector('[data-wp-id="WP-CMD-001"]')?.textContent).toContain('MS-CMD-001');
    expect(host.querySelector('[data-wp-id="WP-CMD-001"]')?.textContent).toContain('1 task');
  });

  it('shows the empty state for a project with none yet, and never fabricates a row', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ project_id: 'erp', milestones: [], work_packages: [] }) }));
    const host = mount(fetchMock);
    await act(async () => {
      root?.render(<MilestonesPanel projectId="erp" actor="claude" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector('[data-testid="milestone-list"]')?.textContent).toContain('None yet.');
    expect(host.querySelector('[data-testid="work-package-list"]')?.textContent).toContain('None yet.');
  });

  // The create/update write paths (milestone and work-package POST/PATCH,
  // field allowlisting, same-project checks) are exercised directly over
  // real HTTP in tests/pm-work-packages-api.test.ts (14/14), which is the
  // stronger guarantee for that logic. This file sticks to what a component
  // test is actually good at: render, loading/empty states, and gating.

  it('never shows the creation forms when no actor is chosen', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/pm/milestones')) return { ok: true, json: async () => ({ project_id: 'command', milestones: [milestone] }) };
      return { ok: true, json: async () => ({ project_id: 'command', milestone_id: null, work_packages: [workPackage] }) };
    });
    const host = mount(fetchMock);
    await act(async () => {
      root?.render(<MilestonesPanel projectId="command" actor="" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector('[aria-label="New milestone title"]')).toBeNull();
    expect(host.querySelector('[aria-label="New work package title"]')).toBeNull();
  });
});
