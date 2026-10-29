// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPOSITORY_STATUS_POLL_MS, REPOSITORY_STATUS_SCHEMA } from '@/lib/pm-client';
import { RepositoryStatusPanel } from '@/surfaces/pm-portfolio';

let dom: JSDOM | null = null;
let root: ReturnType<typeof createRoot> | null = null;
const pollers: Array<() => void> = [];
const originalSetInterval = globalThis.setInterval.bind(globalThis);

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  dom?.window.close();
  dom = null;
  pollers.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function statusPayload(repositories: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return {
    schema: REPOSITORY_STATUS_SCHEMA,
    generated_at: '2026-10-29T09:00:00.000Z',
    repositories,
    ...extra,
  };
}

async function renderWith(fetchMock: ReturnType<typeof vi.fn>): Promise<HTMLElement> {
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: TimerHandler, ms?: number) => {
    if (typeof fn === 'function' && ms === REPOSITORY_STATUS_POLL_MS) {
      pollers.push(fn as () => void);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }
    return originalSetInterval(fn as () => void, ms);
  }) as typeof setInterval);
  vi.stubGlobal('fetch', fetchMock);
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/#studio/projects' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  await act(async () => {
    root?.render(<RepositoryStatusPanel />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

describe('portfolio repository sync', () => {
  it('shows each repo sync fact and does not treat Git as task completion', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => statusPayload([
        {
          project_id: 'command',
          branch: 'pm-portfolio-convergence-20261028',
          upstream: 'origin/pm-portfolio-convergence-20261028',
          head: '4b40d698',
          commit_time: '2026-10-28T12:00:00.000Z',
          ahead: 0,
          behind: 1,
          dirty_file_count: 3,
          last_origin_fetch: '2026-10-29T08:00:00.000Z',
          state: 'CURRENT',
        },
        {
          project_id: 'erp',
          branch: 'main',
          upstream: 'https://user:secret@github.com/almstq/starqERP.git',
          head: 'aaaa111',
          ahead: null,
          behind: null,
          dirty_file_count: null,
          last_origin_fetch: null,
          state: 'STALE',
          reason: 'Origin fetch is older than the bound.',
        },
      ]),
    }));
    const host = await renderWith(fetchMock);
    const command = host.querySelector('[data-repository="command"]');
    const erp = host.querySelector('[data-repository="erp"]');
    expect(command?.getAttribute('data-sync-state')).toBe('CURRENT');
    expect(command?.textContent).toContain('pm-portfolio-convergence-20261028');
    expect(command?.textContent).toContain('4b40d698');
    expect(command?.textContent).toContain('0 ahead / 1 behind');
    expect(command?.textContent).toContain('3');
    expect(command?.textContent).toContain('2026-10-29T08:00:00.000Z');
    expect(erp?.getAttribute('data-sync-state')).toBe('STALE');
    expect(erp?.textContent).toContain('REDACTED');
    expect(erp?.textContent).not.toContain('secret');
    expect(erp?.textContent).toContain('UNKNOWN');
    expect(host.textContent).toContain('They do not mark a task done, verified, or ready.');
    expect(host.querySelector('[data-repository-status] button')).toBeNull();
    expect(host.textContent).not.toMatch(/\b(push|dispatch)\b/i);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:5176/api/pm/repositories/status');
  });

  it('polls the same GET feed every 30 seconds', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => statusPayload([{ project_id: 'command', branch: 'main', head: 'abc', ahead: 0, behind: 0, dirty_file_count: 0, last_origin_fetch: '2026-10-29T08:00:00.000Z', state: 'CURRENT' }]),
    }));
    await renderWith(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pollers).toHaveLength(1);
    await act(async () => {
      pollers[0]();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows an unreachable feed as unavailable', async () => {
    const down = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ message: 'PM down' }) }));
    const host = await renderWith(down);
    expect(host.querySelector('[data-sync-state]')).toBeNull();
    expect(host.textContent).toContain('Repository status unavailable.');
    expect(host.textContent).toContain('PM down');
  });

  it('rejects the preflight schema instead of treating RESOLVED as current', async () => {
    const mismatch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ schema: 'starq.command.repository_preflight/v1', projects: { command: { state: 'RESOLVED' } } }),
    }));
    const host = await renderWith(mismatch);
    expect(host.textContent).toContain('Expected starq.command.repository_status/v1');
    expect(host.querySelector('[data-sync-state="CURRENT"]')).toBeNull();
  });

  it('shows UNRESOLVED for an unrecognized state and reads the camelCase field names', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        schema: REPOSITORY_STATUS_SCHEMA,
        generatedAt: '2026-10-29T09:15:00.000Z',
        repositories: [
          { projectId: 'command', state: 'RESOLVED', branch: 'main', head: 'abc', ahead: 0, behind: 0, dirtyFileCount: 1, lastOriginFetch: '2026-10-29T08:00:00.000Z' },
          { project_id: 'erp', state: 'UNAVAILABLE', branch: null, head: null, ahead: null, behind: null, dirty_file_count: null, last_origin_fetch: null, reason: 'Origin auth failed.' },
        ],
      }),
    }));
    const host = await renderWith(fetchMock);
    expect(host.querySelector('[data-repository="command"]')?.getAttribute('data-sync-state')).toBe('UNRESOLVED');
    expect(host.querySelector('[data-repository="command"]')?.textContent).toContain('Unrecognized sync state RESOLVED.');
    expect(host.querySelector('[data-repository="erp"]')?.getAttribute('data-sync-state')).toBe('UNAVAILABLE');
    expect(host.querySelector('[data-repository="erp"]')?.textContent).toContain('Origin auth failed.');
    expect(host.textContent).toContain('2026-10-29T09:15:00.000Z');
  });
});
