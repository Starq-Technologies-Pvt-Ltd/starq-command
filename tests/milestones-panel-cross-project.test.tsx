// @vitest-environment node
// WP-3 (#9631): does MilestonesPanel behave for projects other than 'command'?
//
// The panel takes projectId as a prop and looks generic, but "generic" was an
// assumption: a command-scoped hardcode anywhere in the render path would show
// up as a panel that quietly reports the wrong project's milestones. These
// tests mount the real component over JSDOM with a fetch mock and assert three
// things per project: the requests it issues are scoped to that project, it
// renders that project's rows, and switching projects clears the previous
// project's rows instead of blending them.
//
// Write-path HTTP behaviour for erp/hoadha lives in
// tests/pm-work-packages-cross-project.test.ts; this file is about the component.
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

function row(projectId: string, prefix: string, n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `MS-${prefix}-00${n}`, project_id: projectId, title: `${projectId} milestone ${n}`, description: '',
    target_date: '2026-12-01', status: 'OPEN', created_by: 'claude',
    created_at: '2026-10-17T00:00:00.000Z', updated_at: '2026-10-17T00:00:00.000Z',
    work_package_counts: { OPEN: 1, IN_PROGRESS: 0, DONE: 0 }, work_package_total: 1,
    ...overrides,
  };
}

function wp(projectId: string, prefix: string, n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `WP-${prefix}-00${n}`, project_id: projectId, milestone_id: `MS-${prefix}-00${n}`,
    title: `${projectId} work package ${n}`, description: '', owner: 'claude', status: 'OPEN',
    created_by: 'claude', created_at: '2026-10-17T00:00:00.000Z', updated_at: '2026-10-17T00:00:00.000Z',
    closed_at: null,
    task_counts: { BACKLOG: 1, READY: 0, IN_PROGRESS: 0, REVIEW: 0, VERIFICATION: 0, ACCEPTANCE: 0, CLOSED: 0, BLOCKED: 0, FOUNDER_GATE: 0 },
    task_total: 1,
    ...overrides,
  };
}

const PROJECTS = [
  { id: 'erp', prefix: 'ERP' },
  { id: 'hoadha', prefix: 'HOA' },
] as const;

function fixtureFetch(perProject: Record<string, { milestones: any[]; work_packages: any[] }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const projectId = url.searchParams.get('project_id');
    const data = projectId ? perProject[projectId] : undefined;
    if (!data) throw new Error(`unexpected project scope in fetch: ${url}`);
    const payload = url.pathname.endsWith('/milestones')
      ? { project_id: projectId, milestones: data.milestones }
      : { project_id: projectId, milestone_id: url.searchParams.get('milestone_id'), work_packages: data.work_packages };
    return { ok: true, json: async () => payload };
  });
}

async function render(projectId: string, fetchMock: ReturnType<typeof vi.fn>) {
  const host = mount(fetchMock);
  await act(async () => {
    root?.render(<MilestonesPanel projectId={projectId} actor="claude" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

describe('MilestonesPanel on erp and hoadha', () => {
  it.each(PROJECTS)('scopes every request to $id and renders only $id rows', async ({ id, prefix }) => {
    const fetchMock = fixtureFetch({
      [id]: { milestones: [row(id, prefix, 1)], work_packages: [wp(id, prefix, 1)] },
      // A second project's rows exist server-side. If the component ever asked
      // unscoped, or the fixture leaked, these would render here.
      command: { milestones: [row('command', 'CMD', 9)], work_packages: [wp('command', 'CMD', 9)] },
    });
    const host = await render(id, fetchMock);

    for (const call of fetchMock.mock.calls) {
      const url = new URL(String(call[0]), 'http://localhost');
      expect(url.searchParams.get('project_id'), `${id} request scope`).toBe(id);
    }
    expect(host.querySelector(`[data-milestone-id="MS-${prefix}-001"]`)?.textContent).toContain(`${id} milestone 1`);
    expect(host.querySelector(`[data-wp-id="WP-${prefix}-001"]`)?.textContent).toContain(`${id} work package 1`);
    expect(host.querySelector(`[data-wp-id="WP-${prefix}-001"]`)?.textContent).toContain('1 task');
    expect(host.textContent).not.toContain('command milestone');
    expect(host.textContent).not.toContain('WP-CMD-');
  });

  it.each(PROJECTS)('shows the empty state for $id with no milestones and never fabricates a row', async ({ id }) => {
    const fetchMock = fixtureFetch({ [id]: { milestones: [], work_packages: [] } });
    const host = await render(id, fetchMock);
    expect(host.querySelector('[data-testid="milestone-list"]')?.textContent).toContain('None yet.');
    expect(host.querySelector('[data-testid="work-package-list"]')?.textContent).toContain('None yet.');
    expect(host.querySelectorAll('[data-milestone-id]').length).toBe(0);
    expect(host.querySelectorAll('[data-wp-id]').length).toBe(0);
  });

  // The real UI leak risk: a board that is re-pointed at another project while
  // mounted. Stale rows from the previous project must not survive, or the
  // panel would show erp's milestones under the hoadha heading.
  it('clears the previous project rows when the board is re-pointed at another project', async () => {
    const fixture: Record<string, { milestones: any[]; work_packages: any[] }> = {
      erp: { milestones: [row('erp', 'ERP', 1)], work_packages: [wp('erp', 'ERP', 1)] },
      hoadha: { milestones: [row('hoadha', 'HOA', 1)], work_packages: [wp('hoadha', 'HOA', 1)] },
    };
    const fetchMock = fixtureFetch(fixture);
    const host = mount(fetchMock);

    await act(async () => {
      root?.render(<MilestonesPanel projectId="erp" actor="claude" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('erp milestone 1');

    await act(async () => {
      root?.render(<MilestonesPanel projectId="hoadha" actor="claude" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('hoadha milestone 1');
    expect(host.textContent).not.toContain('erp milestone 1');
    expect(host.textContent).not.toContain('WP-ERP-001');
    expect(host.querySelectorAll('[data-milestone-id]').length).toBe(1);
  });

  it.each(PROJECTS)('offers only $id milestones in the work-package milestone picker', async ({ id, prefix }) => {
    const fixture: Record<string, { milestones: any[]; work_packages: any[] }> = {
      erp: { milestones: [row('erp', 'ERP', 7)], work_packages: [] },
      hoadha: { milestones: [row('hoadha', 'HOA', 7)], work_packages: [] },
    };
    // The mounted project's own rows win; the other projects' rows exist only
    // to catch an unscoped or blended request.
    fixture[id] = { milestones: [row(id, prefix, 1), row(id, prefix, 2)], work_packages: [] };
    const fetchMock = fixtureFetch(fixture);
    const host = await render(id, fetchMock);
    const select = host.querySelector('select[aria-label="Milestone for new work package"]') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values).toEqual([`MS-${prefix}-001`, `MS-${prefix}-002`]);
    expect(values.some((v) => v.endsWith('-007'))).toBe(false);
  });
});