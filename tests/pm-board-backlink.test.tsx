// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PM_STATUSES, type PmTask } from '@/lib/pm-client';
import { PmBoardSurface } from '@/surfaces/pm-board';

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

const hold = { state: null, authority: null, effective: null, source: 'pm_projects' };
const commandProject = {
  id: 'command', name: 'Starq Command', prefix: 'CMD', description: '', source_gap: null, hold,
};

const sampleTask: PmTask = {
  id: 'PM-CMD-201',
  project_id: 'command',
  title: 'Board row',
  description: '',
  priority: 'P2',
  status: 'READY',
  prior_status: null,
  owner: 'cursor',
  verifier: 'claude',
  room_authorization_ref: null,
  evidence_refs: [],
  depends_on: [],
  work_package_id: null,
  notes: '',
  created_by: 'cursor',
  created_at: '2026-10-25T00:00:00.000Z',
  updated_at: '2026-10-25T00:00:00.000Z',
  closed_at: null,
  allowed_next: ['IN_PROGRESS'],
  pending_room_sync: 0,
};

describe('PM board back-to-portfolio link', () => {
  it('renders a visible Back to portfolio link whose href is the portfolio route', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/meta')) {
        return { ok: true, json: async () => ({ statuses: PM_STATUSES, priorities: ['P0', 'P1', 'P2', 'P3'], handles: ['cursor'] }) };
      }
      if (url.endsWith('/api/pm/projects')) {
        return { ok: true, json: async () => ({ projects: [commandProject] }) };
      }
      if (url.includes('/api/pm/tasks?project_id=command')) {
        return { ok: true, json: async () => ({ project_id: 'command', tasks: [sampleTask] }) };
      }
      if (url.includes('/api/pm/work-packages?project_id=command')) {
        return { ok: true, json: async () => ({ project_id: 'command', milestone_id: null, work_packages: [] }) };
      }
      if (url.includes('/api/pm/milestones?project_id=command')) {
        return { ok: true, json: async () => ({ project_id: 'command', milestones: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({ message: 'unexpected route' }) };
    }));

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost/#studio/command',
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

    expect(host.querySelector('[data-pm="board"]')).not.toBeNull();
    const back = host.querySelector('[data-board-backlink] a');
    expect(back).not.toBeNull();
    expect(back?.textContent).toContain('Back to portfolio');
    expect(back?.getAttribute('href')).toBe('#studio/projects');
  });
});
