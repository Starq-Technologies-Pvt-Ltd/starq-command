/**
 * Core-status changes must not remount the operating surface.
 * PM fetches are stubbed. No service is contacted.
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { useBuildingProjection, useCommandSurface } from '@/lib/use-command-surface';
import type { CommandSurface } from '@/lib/contracts';
import fixture from './fixtures/phase5-surface.json';

vi.mock('@/lib/use-command-surface', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/use-command-surface')>(),
  useBuildingProjection: vi.fn(),
  useCommandSurface: vi.fn(),
}));

const surface = {
  ...fixture,
  assembled_at: '2026-10-15T00:00:00Z',
  authority_note: 'DERIVED_PROJECTION',
  workspace: { root: 'D:\\StarqTech', source: 'STARQ_WORKSPACE' },
  identities: { available: true, version: 'registry-fixture', count: 0, founder: null, byHandle: {} },
  provenance: { state: 'OK', checked: 0, drifted: [], missing: [], sources: [] },
  floor: { staff_glance_counts: { working: 0, idle: 0, blocked: null, unknown: 0 } },
} as unknown as CommandSurface;

let dom: JSDOM | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/pm/org/history')) return jsonResponse({ history: [] });
    if (url.includes('/api/pm/org')) {
      return jsonResponse({
        company: null,
        units: [],
        positions: [],
        people: [],
        appointments: [],
        generated_at: '2026-11-02T00:00:00.000Z',
      });
    }
    if (url.includes('/api/pm/portfolio')) return jsonResponse({ projects: [], generated_at: '2026-11-02T00:00:00.000Z' });
    if (url.includes('/api/pm/projects')) return jsonResponse({ projects: [] });
    if (url.includes('/api/pm/nexus')) return jsonResponse({ sources: [] });
    return jsonResponse({});
  }));
}

function setNativeInput(input: HTMLInputElement, value: string) {
  const view = input.ownerDocument.defaultView!;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
  input.focus();
  input.dispatchEvent(new view.FocusEvent('focusin', { bubbles: true }));
  setter?.call(input, value);
  input.dispatchEvent(new view.KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
}

function mount(hash: string) {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: `http://command.test/${hash}` });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('localStorage', dom.window.localStorage);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const elementProto = dom.window.HTMLElement.prototype as HTMLElement & {
    attachEvent?: () => void;
    detachEvent?: () => void;
  };
  elementProto.attachEvent = () => {};
  elementProto.detachEvent = () => {};
  installFetch();
  vi.mocked(useBuildingProjection).mockReturnValue({
    building: null, buildingStatus: 'UNAVAILABLE', buildingError: null, buildingStale: false,
  });
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  return host;
}

function core(status: 'READY' | 'UNAVAILABLE' | 'LOADING', withSurface: boolean) {
  vi.mocked(useCommandSurface).mockReturnValue({
    status,
    surface: withSurface ? surface : null,
    health: withSurface ? surface.health : null,
    error: status === 'UNAVAILABLE' ? 'core poll failed' : null,
    lastFetchedAt: null,
    refresh: vi.fn(),
    refreshing: false,
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe('operating input survives core status changes', () => {
  it('keeps an unsaved company name when the core projection drops and recovers', async () => {
    const host = mount('#organization');
    core('READY', true);
    await act(async () => { root?.render(<App />); });
    await flush();
    const name = () => host.querySelector('input[aria-label="Company name"]') as HTMLInputElement;
    expect(name()).not.toBeNull();
    await act(async () => { setNativeInput(name(), 'Unsaved Northwind'); });
    expect(name().value).toBe('Unsaved Northwind');

    core('UNAVAILABLE', true);
    await act(async () => { root?.render(<App />); });
    await flush();
    expect(host.textContent).toContain('Data service unreachable');
    expect(name().value).toBe('Unsaved Northwind');

    core('READY', true);
    await act(async () => { root?.render(<App />); });
    await flush();
    expect(host.textContent).not.toContain('Data service unreachable');
    expect(name().value).toBe('Unsaved Northwind');
  });

  it('keeps an unsaved project name when the core projection drops and recovers', async () => {
    const host = mount('#projects');
    core('READY', true);
    await act(async () => { root?.render(<App />); });
    await flush();
    const name = () => host.querySelector('input[aria-label="New project name"]') as HTMLInputElement;
    expect(name()).not.toBeNull();
    await act(async () => { setNativeInput(name(), 'Unsaved canal'); });
    expect(name().value).toBe('Unsaved canal');

    core('UNAVAILABLE', true);
    await act(async () => { root?.render(<App />); });
    await flush();
    expect(name().value).toBe('Unsaved canal');

    core('READY', true);
    await act(async () => { root?.render(<App />); });
    await flush();
    expect(name().value).toBe('Unsaved canal');
  });
});
