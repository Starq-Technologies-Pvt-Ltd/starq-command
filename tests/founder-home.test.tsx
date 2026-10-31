// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pmBoardHref, pmTaskHref } from '@/lib/pm-client';
import { FounderHome } from '@/surfaces/founder-home';

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

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 503) {
  return { ok, status, json: async () => body };
}

function fetchRoutes(routes: Record<string, { ok?: boolean; status?: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const route = routes[path];
    if (!route) return jsonResponse({ message: `not found: ${path}` }, false, 404);
    const ok = route.ok !== false;
    return jsonResponse(route.body, ok, route.status ?? (ok ? 200 : 503));
  });
}

const emptyDigest = {
  digest: {
    id: '2026-10-31',
    generated_at: '2026-10-31T12:00:00.000Z',
    summary: {
      counts: { blocked: 0 },
      blocked_tasks: [],
      at_risk_milestones: [],
      completed_last_24h: [],
      person_load: [],
    },
  },
};

const quietMilestones = { milestones: [] };

async function renderHome(
  routes: Record<string, { ok?: boolean; status?: number; body: unknown }>,
  setup?: (window: Window) => void,
) {
  vi.stubGlobal('fetch', fetchRoutes(routes));
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setup?.(dom.window as unknown as Window);

  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  await act(async () => {
    root?.render(<FounderHome />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

function section(host: HTMLElement, name: string) {
  return host.querySelector(`[data-founder-section="${name}"]`);
}

describe('Founder Home', () => {
  it('renders owner and reason for a blocked attention task', async () => {
    const host = await renderHome({
      '/api/pm/attention': {
        body: {
          generated_at: '2026-10-31T12:00:00.000Z',
          room_post: 'OFF',
          next_actions: [
            {
              task_id: 'CMD-9',
              project_id: 'command',
              title: 'Fix the gate',
              status: 'BLOCKED',
              owner: 'codex',
              verifier: 'ali',
              priority: 'P0',
              reason: 'Waiting on a verifier',
              href: '#somewhere-else',
            },
          ],
          blocked: 1,
          founder_gate: 0,
          unassigned: 0,
          in_progress: 0,
        },
      },
      '/api/pm/digests/latest': { body: emptyDigest },
      '/api/pm/milestones': { body: quietMilestones },
    });

    const blocked = section(host, 'blocked');
    expect(blocked?.textContent).toContain('codex');
    expect(blocked?.textContent).toContain('Waiting on a verifier');
    expect(blocked?.textContent).toContain('UNKNOWN');
    const hrefs = [...host.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));
    expect(hrefs).toContain(pmTaskHref('command', 'CMD-9'));
    expect(hrefs).toContain('#workforce?person=codex');
    expect(host.textContent).toContain('Founder Home');
    expect(host.textContent).toContain('Claimed actor — not authentication');
  });

  it('renders the empty sentence when attention has no next actions', async () => {
    const host = await renderHome({
      '/api/pm/attention': {
        body: {
          generated_at: '2026-10-31T12:00:00.000Z',
          room_post: 'OFF',
          next_actions: [],
          blocked: 0,
          founder_gate: 0,
          unassigned: 0,
          in_progress: 0,
        },
      },
      '/api/pm/digests/latest': { body: emptyDigest },
      '/api/pm/milestones': { body: quietMilestones },
    }, (window) => {
      window.localStorage.setItem('starq.pm.actor', 'night-watch');
    });

    expect(section(host, 'attention')?.textContent).toContain('Nothing needs attention.');
    expect(section(host, 'completed')?.textContent).toContain('Completed in the latest digest');
    expect(section(host, 'completed')?.textContent).toContain('Nothing completed in the latest digest.');
    expect(host.textContent).not.toContain('7 days');
    expect(host.textContent).toContain('Claimed actor — not authentication');
    expect(host.querySelector('[data-claimed-actor]')?.textContent).toBe('night-watch');
  });

  it('renders UNAVAILABLE when the digest call fails', async () => {
    const host = await renderHome({
      '/api/pm/attention': {
        body: {
          generated_at: '2026-10-31T12:00:00.000Z',
          room_post: 'OFF',
          next_actions: [],
          blocked: 0,
          founder_gate: 0,
          unassigned: 0,
          in_progress: 0,
        },
      },
      '/api/pm/digests/latest': {
        ok: false,
        status: 503,
        body: { message: 'Digest service is down.' },
      },
      '/api/pm/milestones': { body: quietMilestones },
    });

    const digest = section(host, 'digest');
    expect(digest?.textContent).toContain('UNAVAILABLE');
    expect(digest?.textContent).toContain('Digest service is down.');
    expect(section(host, 'completed')?.textContent).toContain('UNAVAILABLE');
  });

  it('renders an at-risk milestone and links it to the project board', async () => {
    const host = await renderHome({
      '/api/pm/attention': {
        body: {
          generated_at: '2026-10-31T12:00:00.000Z',
          room_post: 'OFF',
          next_actions: [],
          blocked: 0,
          founder_gate: 0,
          unassigned: 0,
          in_progress: 0,
        },
      },
      '/api/pm/digests/latest': { body: emptyDigest },
      '/api/pm/milestones': {
        body: {
          milestones: [
            {
              id: 'm-risk',
              project_id: 'command',
              title: 'Local OS alpha',
              status: 'active',
              at_risk: true,
              overdue: false,
            },
            {
              id: 'm-ok',
              project_id: 'erp',
              title: 'Quiet milestone',
              status: 'planned',
              at_risk: false,
              overdue: false,
            },
          ],
        },
      },
    });

    const milestones = section(host, 'milestones');
    expect(milestones?.textContent).toContain('Local OS alpha');
    expect(milestones?.textContent).not.toContain('Quiet milestone');
    const hrefs = [...(milestones?.querySelectorAll('a') ?? [])].map((anchor) => anchor.getAttribute('href'));
    expect(hrefs).toContain(pmBoardHref('command'));
    expect(milestones?.textContent).not.toContain('No milestones at risk.');
  });
});
