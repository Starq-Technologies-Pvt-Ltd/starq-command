// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pmTask, pmTaskHref } from '@/lib/pm-client';
import { commandWorkforce } from '@/lib/command-client';

vi.mock('@/lib/command-client', () => ({
  commandTasks: vi.fn(async () => ({ ok: true, data: { tasks: [] } })),
  commandDispatchPreview: vi.fn(async () => ({ ok: true, data: { eligible: [], blocked: [] } })),
  commandWorkforce: vi.fn(async () => ({
    ok: true,
    data: {
      seats: [
        {
          handle: 'codex',
          task_id: 'CMD-101',
          owner: 'codex',
          verifier: 'ali',
          provider_owner: 'starq',
          product_client: 'command',
          capacity_class: 'builder',
          workforce_function: 'builder',
          role_family: 'builder',
          runtime_session: 's1',
          runtime: { session_id: 'actual-session', observed: true, observed_at: '2026-10-28T00:00:00.000Z', session_match: 'MATCHED' },
          availability: 'AVAILABLE',
          availability_source: 'herdr',
          availability_observed_at: '2026-10-28T00:00:00.000Z',
          capabilities: { values: ['ts'], evidence: [] },
          dispatch_eligible: true,
          workload: { task_ids: ['CMD-101', 'CMD-202', 'CMD-202'] },
        },
      ],
    },
  })),
  commandCapacity: vi.fn(async () => ({ ok: true, data: { source: 'x', capacity: [] } })),
  commandStuck: vi.fn(async () => ({ ok: true, data: { stuckTasks: [] } })),
  commandRoomEvents: vi.fn(async () => ({ ok: true, data: { events: [] } })),
  commandRecover: vi.fn(),
  commandVerificationStart: vi.fn(),
  commandBuilderCompletion: vi.fn(),
  commandVerify: vi.fn(),
  commandPmClose: vi.fn(),
  commandStuckEscalate: vi.fn(),
  commandDispatchNext: vi.fn(),
}));

vi.mock('@/lib/pm-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pm-client')>('@/lib/pm-client');
  return {
    ...actual,
    pmTask: vi.fn(async (id: string) => ({ ok: true, data: { task: id === 'CMD-202' ? { project_id: 'erp', owner: 'other-owner', verifier: 'other-verifier' } : { project_id: 'command', owner: 'declared-owner', verifier: 'declared-verifier' } } })),
    pmRetryRoomSync: vi.fn(async () => ({ ok: true, data: { queued: true, pending_room_sync: 0 } })),
  };
});

import { SoftwareFactorySurface } from '@/surfaces/factory';

let dom: JSDOM | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) { act(() => root?.unmount()); root = null; }
  dom?.window.close(); dom = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Factory Workforce view', () => {
  it('loads workforce under React StrictMode', async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<React.StrictMode><SoftwareFactorySurface /></React.StrictMode>); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Workforce'))!;
    await act(async () => { button.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(host.textContent).toContain('declared-owner');
  });
  it('renders resolved task link anchor with exact href', async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<SoftwareFactorySurface />); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Workforce'))!;
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)); });
    const anchor = host.querySelector('a[href]') as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    expect(anchor.getAttribute('href')).toBe(pmTaskHref('command', 'CMD-101'));
    expect(anchor.textContent).toBe('CMD-101');
    const seat = Array.from(host.querySelectorAll('tbody tr')).find((row) => row.cells[0]?.textContent === 'codex');
    expect(seat?.cells[5]?.textContent).toContain('actual-session');
    expect(seat?.cells[7]?.textContent).toContain('Herdr · 2026-10-28T00:00:00.000Z');
    expect(seat?.cells[1]?.textContent).toContain('Owner: declared-owner · Verifier: declared-verifier (PM declared labels; identity links unavailable)');
    expect(seat?.cells[6]?.textContent).toContain('Source: UNKNOWN · Time: UNKNOWN');
    const second = Array.from(seat!.querySelectorAll('a')).find((link) => link.textContent === 'CMD-202')!;
    expect(second.getAttribute('href')).toBe(pmTaskHref('erp', 'CMD-202'));
    expect(second.parentElement?.textContent).toContain('Owner: other-owner · Verifier: other-verifier (PM declared labels; identity links unavailable)');
  });
  it('renders workforce CONFLICT state without implying verified identity', async () => {
    vi.mocked(commandWorkforce).mockResolvedValueOnce({ ok: true, data: { state: 'OBSERVED', observed_at: '2026-10-28T00:00:00.000Z', declared_seat_count: 1, seats: [{ handle: 'codex', task_id: 'CMD-101', owner: 'codex', verifier: 'ali', provider_owner: 'starq', product_client: 'command', capacity_class: 'builder', workforce_function: 'builder', role_family: 'builder', runtime_session: 's1', availability: 'AVAILABLE', availability_source: 'herdr', availability_observed_at: '2026-10-28T00:00:00.000Z', capabilities: { values: ['ts'], evidence: [] }, dispatch_eligible: false, workload: { task_ids: [] }, pane_binding: { state: 'CONFLICT', pane: null }, runtime: { session_match: 'CONFLICT' } }], fleet: [] } } as any);
    dom = new JSDOM('<!doctype html><html><body><div id=\"root\"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<SoftwareFactorySurface />); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Workforce'))!;
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const seat = Array.from(host.querySelectorAll('tbody tr')).find((row) => row.cells[0]?.textContent === 'codex');
    expect(seat).toBeDefined();
    expect(seat?.cells[5]?.textContent).toContain('CONFLICT');
    expect(seat?.cells[1]?.textContent).toContain('UNKNOWN');
  });
  it('renders unavailable workforce status (UNKNOWN/unavailable) without crashing', async () => {
    vi.mocked(commandWorkforce).mockResolvedValueOnce({ ok: true, data: { state: 'UNKNOWN', observed_at: '2026-10-28T00:00:00.000Z', declared_seat_count: 0, seats: [], fleet: [] } } as any);
    dom = new JSDOM('<!doctype html><html><body><div id=\"root\"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<SoftwareFactorySurface />); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Workforce'))!;
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    expect(btn.textContent).toContain('UNKNOWN');
  });
  it('renders unavailable text when pmTask rejects, no anchor', async () => {
    vi.mocked(pmTask).mockRejectedValueOnce(new Error('boom'));
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<SoftwareFactorySurface />); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Workforce'))!;
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    expect(host.textContent).toContain('CMD-101 (unavailable)');
    const anchors = Array.from(host.querySelectorAll('a')).filter((a) => a.textContent === 'CMD-101');
    expect(anchors.length).toBe(0);
  });
  it('renders lookup-failed when pmTask returns ok:false', async () => {
    vi.mocked(pmTask).mockResolvedValueOnce({ ok: false } as any);
    dom = new JSDOM('<!doctype html><html><body><div id=\"root\"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<SoftwareFactorySurface />); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Workforce'))!;
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    expect(host.textContent).toContain('CMD-101 (lookup failed)');
  });

  it('delayed prior lookup does not overwrite changed workload reload', async () => {
    let resolveFirst: (v: any) => void = () => {};
    const firstPromise = new Promise((res) => { resolveFirst = res; });
    vi.mocked(pmTask).mockReturnValueOnce(firstPromise as any);
    vi.mocked(commandWorkforce)
      .mockResolvedValueOnce({ ok: true, data: { state: 'OBSERVED', observed_at: '2026-10-28T00:00:00.000Z', declared_seat_count: 1, seats: [{ handle: 'codex', task_id: 'CMD-101', owner: 'codex', verifier: 'ali', provider_owner: 'starq', product_client: 'command', capacity_class: 'builder', workforce_function: 'builder', role_family: 'builder', runtime_session: 's1', availability: 'AVAILABLE', availability_source: 'herdr', availability_observed_at: '2026-10-28T00:00:00.000Z', capabilities: { values: ['ts'], evidence: [] }, dispatch_eligible: true, workload: { task_ids: ['CMD-101'] } }], fleet: [] } } as any)
      .mockResolvedValueOnce({ ok: true, data: { state: 'OBSERVED', observed_at: '2026-10-28T00:00:00.000Z', declared_seat_count: 1, seats: [{ handle: 'codex', task_id: 'CMD-101', owner: 'codex', verifier: 'ali', provider_owner: 'starq', product_client: 'command', capacity_class: 'builder', workforce_function: 'builder', role_family: 'builder', runtime_session: 's1', availability: 'AVAILABLE', availability_source: 'herdr', availability_observed_at: '2026-10-28T00:00:00.000Z', capabilities: { values: ['ts'], evidence: [] }, dispatch_eligible: true, workload: { task_ids: ['CMD-202'] } }], fleet: [] } } as any);
    dom = new JSDOM('<!doctype html><html><body><div id=\"root\"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<SoftwareFactorySurface />); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const initialWorkforce = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Workforce'))!;
    await act(async () => { initialWorkforce.click(); });
    expect(host.textContent).toContain('CMD-101 (lookup pending)');
    expect(host.textContent).not.toContain('CMD-101 (lookup failed)');
    const refresh = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Refresh'))!;
    await act(async () => { refresh.click(); await new Promise((r) => setTimeout(r, 0)); });
    const wfBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Workforce'))!;
    await act(async () => { wfBtn.click(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const beforeStale = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'CMD-202');
    expect(beforeStale?.getAttribute('href')).toBe(pmTaskHref('erp', 'CMD-202'));
    expect(vi.mocked(pmTask).mock.calls.map(([id]) => id)).toEqual(['CMD-101', 'CMD-202']);
    resolveFirst({ ok: true, data: { task: { project_id: 'stale-project' } } });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const anchors = Array.from(host.querySelectorAll('a'));
    expect(anchors.some((a) => a.textContent === 'CMD-202')).toBe(true);
    const latest = anchors.find((a) => a.textContent === 'CMD-202') as HTMLAnchorElement;
    expect(latest.getAttribute('href')).toBe(pmTaskHref('erp', 'CMD-202'));
    expect(anchors.some((a) => a.textContent === 'CMD-101')).toBe(false);
    expect(vi.mocked(pmTask).mock.calls.map(([id]) => id)).toEqual(['CMD-101', 'CMD-202']);
  });

  it('unavailable reload clears old links', async () => {
    vi.mocked(commandWorkforce)
      .mockResolvedValueOnce({ ok: true, data: { state: 'OBSERVED', observed_at: '2026-10-28T00:00:00.000Z', declared_seat_count: 1, seats: [{ handle: 'codex', task_id: 'CMD-101', owner: 'codex', verifier: 'ali', provider_owner: 'starq', product_client: 'command', capacity_class: 'builder', workforce_function: 'builder', role_family: 'builder', runtime_session: 's1', availability: 'AVAILABLE', availability_source: 'herdr', availability_observed_at: '2026-10-28T00:00:00.000Z', capabilities: { values: ['ts'], evidence: [] }, dispatch_eligible: true, workload: { task_ids: ['CMD-101'] } }], fleet: [] } } as any)
      .mockResolvedValueOnce({ ok: false } as any);
    dom = new JSDOM('<!doctype html><html><body><div id=\"root\"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<SoftwareFactorySurface />); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Workforce'))!; btn.click(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    expect(Array.from(host.querySelectorAll('a')).some((a) => a.textContent === 'CMD-101')).toBe(true);
    const refresh = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Refresh'))!;
    await act(async () => { refresh.click(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const anchors = Array.from(host.querySelectorAll('a')).filter((a) => a.textContent === 'CMD-101');
    expect(anchors.length).toBe(0);
    expect(host.textContent).toContain('Workforce data unavailable.');
    expect(host.querySelector('tbody')).toBeNull();
  });

  it('does not start task lookups when workforce resolves after unmount', async () => {
    let resolveWorkforce: (value: any) => void = () => {};
    vi.mocked(commandWorkforce).mockReturnValueOnce(new Promise((resolve) => { resolveWorkforce = resolve; }) as any);
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<SoftwareFactorySurface />); await new Promise((r) => setTimeout(r, 0)); });
    expect(commandWorkforce).toHaveBeenCalledTimes(1);
    expect(pmTask).not.toHaveBeenCalled();
    act(() => { root?.unmount(); root = null; });
    await act(async () => {
      resolveWorkforce({ ok: true, data: { seats: [{ handle: 'codex', workload: { task_ids: ['CMD-101'] } }] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(pmTask).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
  });

  it('unmount with pending lookup does not update state', async () => {
    let resolveFirst: (v: any) => void = () => {};
    const firstPromise = new Promise((res) => { resolveFirst = res; });
    vi.mocked(pmTask).mockReturnValueOnce(firstPromise as any);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<SoftwareFactorySurface />); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    act(() => { root?.unmount(); root = null; });
    resolveFirst({ ok: true, data: { task: { project_id: 'command' } } });
    await new Promise((r) => setTimeout(r, 0));
    const stateUpdateWarnings = errorSpy.mock.calls.flat().join(' ');
    expect(stateUpdateWarnings).not.toMatch(/state update/i);
    errorSpy.mockRestore();
  });

  it('duplicate-ID lookup/link counts are deduplicated', async () => {
    dom = new JSDOM('<!doctype html><html><body><div id=\"root\"></div></body></html>', { url: 'http://localhost/#studio/command' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<SoftwareFactorySurface />); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Workforce'))!;
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    const anchors = Array.from(host.querySelectorAll('a')).filter((a) => a.textContent === 'CMD-101' || a.textContent === 'CMD-202');
    expect(anchors.length).toBe(2);
    expect(vi.mocked(pmTask).mock.calls.filter(([id]) => id === 'CMD-101')).toHaveLength(1);
    expect(vi.mocked(pmTask).mock.calls.filter(([id]) => id === 'CMD-202')).toHaveLength(1);
  });
});