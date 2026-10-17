// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskForm, emptyTaskForm, taskToForm, type TaskFormValues } from '@/components/task-form';
import { PmBoardSurface } from '@/surfaces/pm-board';
import type { PmTask, PmWorkPackage } from '@/lib/pm-client';

const workPackage: Pick<PmWorkPackage, 'id' | 'title'> = { id: 'WP-CMD-001', title: 'PM API extensions' };

const task = {
  id: 'PM-CMD-001', project_id: 'command', title: 'Recorded blocker', description: '',
  priority: 'P1' as const, status: 'BLOCKED' as const, prior_status: 'IN_PROGRESS' as const,
  owner: 'claude', verifier: 'vision', room_authorization_ref: null, evidence_refs: [],
  depends_on: [], work_package_id: 'WP-CMD-001', notes: '', created_by: 'claude',
  created_at: '2026-10-14T00:00:00.000Z', updated_at: '2026-10-14T01:00:00.000Z',
  closed_at: null, allowed_next: [], pending_room_sync: 0,
} satisfies PmTask;

function submitStub(_values: TaskFormValues) { /* test form only */ }

describe('TaskForm work-package field', () => {
  it('treats work_package_id as optional on create and maps it on edit', () => {
    expect(emptyTaskForm().workPackageId).toBe('');
    expect(taskToForm(task).workPackageId).toBe('WP-CMD-001');
    expect(taskToForm({ ...task, work_package_id: null }).workPackageId).toBe('');
  });

  it('renders a None option plus project work packages', () => {
    const html = renderToStaticMarkup(
      <TaskForm
        mode="create"
        initial={emptyTaskForm()}
        handles={['claude']}
        workPackages={[workPackage]}
        busy={false}
        errors={[]}
        onSubmit={submitStub}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Task work package"');
    expect(html).toContain('Work package (optional)');
    expect(html).toContain('None');
    expect(html).toContain('WP-CMD-001 · PM API extensions');
  });
});

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

describe('PmBoardSurface create/edit wiring for work_package_id', () => {
  it('loads project work packages into the create form dropdown', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => ({ statuses: ['BACKLOG'], priorities: ['P2'], handles: ['cursor'] }) };
      if (url.endsWith('/api/pm/projects')) {
        return {
          ok: true,
          json: async () => ({
            projects: [{ id: 'command', name: 'Starq Command', prefix: 'CMD', description: '', source_gap: null, hold: { state: null, authority: null, effective: null, source: 'pm_projects' } }],
          }),
        };
      }
      if (url.includes('/api/pm/tasks?project_id=command')) return { ok: true, json: async () => ({ project_id: 'command', tasks: [] }) };
      if (url.includes('/api/pm/work-packages')) {
        return {
          ok: true,
          json: async () => ({
            project_id: 'command',
            milestone_id: null,
            work_packages: [{
              ...workPackage, project_id: 'command', milestone_id: null, description: '', owner: 'UNASSIGNED',
              status: 'OPEN', created_by: 'claude', created_at: '', updated_at: '', closed_at: null, task_counts: {}, task_total: 0,
            }],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ message: `unexpected ${url}` }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
    dom.window.localStorage.setItem('starq.pm.actor', 'cursor');
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

    const newTask = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'New task');
    expect(newTask).toBeTruthy();
    await act(async () => {
      newTask!.dispatchEvent(new dom!.window.MouseEvent('click', { bubbles: true }));
    });

    const select = host.querySelector('select[aria-label="Task work package"]') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select!.options[0].value).toBe('');
    expect(Array.from(select!.options).map((o) => o.value)).toContain('WP-CMD-001');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/pm/work-packages?project_id=command'))).toBe(true);
  });
});
