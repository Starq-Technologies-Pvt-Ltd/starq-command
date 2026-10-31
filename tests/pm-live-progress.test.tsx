// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PmPortfolioSurface } from '@/surfaces/pm-portfolio';

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

describe('Historical/live PM progress separation', () => {
  it('does not let a LIVE-wide claimed percent override historical counts or imply live completion', async () => {
    const portfolio = {
      generated_at: '2026-10-15T00:00:00.000Z',
      pending_room_sync: 0,
      statuses: ['TODO', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'DONE'],
      projects: [{
        id: 'command', name: 'Starq Command', prefix: 'CMD',
        hold: { state: null, authority: null, effective: null, source: 'pm_projects' },
        source_gap: null, total: 449, open: 216, counts: { TODO: 100, NEXT: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 233 },
        founder_gate: 0, blocked: 0, pending_room_sync: 0, unassigned: 0,
        done_historical: 233, historical_total: 437,
        metrics: { claimed: { done: 233, total: 449, percent: 999 }, committed: { count: 0, total: 233, percent: 0 }, proven: { count: 0, total: 233, percent: 0 }, capability: null },
      }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/portfolio')) return { ok: true, json: async () => portfolio };
      if (url.endsWith('/api/pm/nexus/sources')) return { ok: true, json: async () => ({ sources: [] }) };
      return { ok: false, status: 404, json: async () => ({ message: `unexpected route: ${url}` }) };
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
    expect(host.textContent).toContain('233 / 437');
    expect(host.textContent).toContain('SOURCE GAP');
    expect(host.textContent).not.toContain('999%');
  });

  it('renders UNKNOWN/SOURCE GAP when historical_total is absent (no mixed total fallback)', async () => {
    const portfolio = {
      generated_at: '2026-10-15T00:00:00.000Z',
      pending_room_sync: 0,
      statuses: ['TODO', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'DONE'],
      projects: [{
        id: 'command', name: 'Starq Command', prefix: 'CMD',
        hold: { state: null, authority: null, effective: null, source: 'pm_projects' },
        source_gap: null, total: 449, open: 216, counts: { TODO: 100, NEXT: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 233 },
        founder_gate: 0, blocked: 0, pending_room_sync: 0, unassigned: 0,
        done_historical: 233,
        metrics: { claimed: { done: 233, total: 449, percent: 999 }, committed: { count: 0, total: 233, percent: 0 }, proven: { count: 0, total: 233, percent: 0 }, capability: null },
      }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/portfolio')) return { ok: true, json: async () => portfolio };
      if (url.endsWith('/api/pm/nexus/sources')) return { ok: true, json: async () => ({ sources: [] }) };
      return { ok: false, status: 404, json: async () => ({ message: `unexpected route: ${url}` }) };
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
    expect(host.textContent).toContain('UNKNOWN/SOURCE GAP');
    expect(host.textContent).not.toContain('233 / 449');
  });
});
