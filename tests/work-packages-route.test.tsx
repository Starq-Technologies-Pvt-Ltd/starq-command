// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkPackageRow } from '@/lib/contracts';
import { WorkPackagesRoute } from '@/surfaces/work-packages-route';

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
  vi.useRealTimers();
});

async function renderRoute() {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  await act(async () => {
    root?.render(<WorkPackagesRoute />);
  });
  return host;
}

describe('Work route endpoint binding', () => {
  it('reads immediately with no-store and keeps an unknown response UNKNOWN', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => null });
    vi.stubGlobal('fetch', fetchMock);

    const host = await renderRoute();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/work-packages', { cache: 'no-store' });
    expect(host.querySelector('[data-availability="UNKNOWN"]')).not.toBeNull();
    expect(host.textContent).toContain('An empty list is not assumed');
  });

  it('renders source identifiers and declared values without changing provenance', async () => {
    const row: WorkPackageRow = {
      id: 'work-1',
      project_id: 'sample',
      title: 'Declared work',
      current_stage: 'IN REVIEW',
      owner: 'owner-1',
      verifier: null,
      board_lane: null,
      source: { kind: 'GENERAL_ASSIGNMENT', reference: 'assignments.json#/items/0' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [row] }));

    const host = await renderRoute();
    expect(host.querySelector('[data-work-package="work-1"]')).not.toBeNull();
    expect(host.textContent).toContain('IN REVIEW');
    expect(host.textContent).toContain('owner-1');
    expect(host.textContent).toContain('assignments.json#/items/0');
  });

  it('keeps network failure UNKNOWN rather than converting it to verified empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const host = await renderRoute();
    expect(host.querySelector('[data-availability="UNKNOWN"]')).not.toBeNull();
    expect(host.querySelector('[data-availability="empty"]')).toBeNull();
  });

  it('refreshes changed source values automatically and clears the timer on unmount', async () => {
    vi.useFakeTimers();
    const row: WorkPackageRow = {
      id: 'recorded-1', project_id: 'command', title: 'Source-backed assignment',
      current_stage: 'REVIEW', owner: 'recorded-owner', verifier: null, board_lane: null,
      source: { kind: 'GENERAL_ASSIGNMENT', reference: 'fixture/assignments.json#recorded-1' },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => null })
      .mockResolvedValueOnce({ ok: true, json: async () => [row] })
      .mockResolvedValue({ ok: true, json: async () => ({ unsupported: 'shape' }) });
    vi.stubGlobal('fetch', fetchMock);
    const host = await renderRoute();
    expect(host.querySelector('[data-availability="UNKNOWN"]')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(host.textContent).toContain(row.title);
    expect(host.textContent).toContain(row.owner);
    expect(host.textContent).toContain(row.source.reference);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(host.querySelector('[data-availability="UNKNOWN"]')).not.toBeNull();
    act(() => root?.unmount());
    root = null;
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[0]).toBe('/api/work-packages');
      expect(call[1]).toEqual({ cache: 'no-store' });
    }
  });

  it('does not overlap a slow feed read with the next interval', async () => {
    vi.useFakeTimers();
    let finish: ((value: { ok: boolean; json: () => Promise<null> }) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    await renderRoute();
    await act(async () => { await vi.advanceTimersByTimeAsync(45000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { finish?.({ ok: true, json: async () => null }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
