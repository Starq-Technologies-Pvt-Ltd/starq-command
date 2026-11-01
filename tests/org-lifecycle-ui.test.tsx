// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PmOrg } from '@/lib/pm-client';
import { OrgOperateSurface } from '@/surfaces/org-operate';

let dom: JSDOM | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const org: PmOrg = {
  company: { id: 'co-north', name: 'Northwind', legal_name: null, notes: null },
  companies: [{ id: 'co-north', name: 'Northwind', legal_name: null, notes: null }],
  units: [
    { id: 'unit-parent', company_id: 'co-north', parent_id: null, kind: 'DEPARTMENT', name: 'Operations', description: null },
    { id: 'unit-leaf', company_id: 'co-north', parent_id: null, kind: 'TEAM', name: 'Desk', description: null },
  ],
  positions: [
    { id: 'pos-lead', unit_id: 'unit-parent', title: 'Lead', job_description: null, reports_to_position_id: null },
  ],
  people: [{ id: 'person-founder', handle: 'founder', display_name: 'Founder', kind: 'HUMAN' }],
  appointments: [],
  generated_at: '2026-11-01T00:00:00.000Z',
};

describe('CV-CU6 archive confirmation', () => {
  it('refuses a unit that holds a position and confirms a leaf archive', async () => {
    const patches: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse(200, { unit: { id: 'unit-leaf', archived_at: '2026-11-01T00:00:00.000Z' } });
      }
      if (url.includes('/api/pm/org/history')) return jsonResponse(200, { history: [] });
      if (url.includes('/api/pm/org')) return jsonResponse(200, org);
      return jsonResponse(404, { message: 'missing' });
    }));
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5173/' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('localStorage', dom.window.localStorage);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const elementProto = dom.window.HTMLElement.prototype as HTMLElement & { attachEvent?: () => void; detachEvent?: () => void };
    elementProto.attachEvent = () => {};
    elementProto.detachEvent = () => {};
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => {
      root?.render(<OrgOperateSurface />);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const parentArchive = host.querySelector('[aria-label="Archive unit unit-parent"]') as HTMLButtonElement;
    await act(async () => { parentArchive.click(); });
    expect(host.textContent).toContain('Nothing was removed');
    expect(host.querySelector('[data-lifecycle-confirm]')).toBeNull();
    expect(patches).toHaveLength(0);

    const leafArchive = host.querySelector('[aria-label="Archive unit unit-leaf"]') as HTMLButtonElement;
    await act(async () => { leafArchive.click(); });
    const confirm = host.querySelector('[data-lifecycle-confirm]');
    expect(confirm?.querySelector('[data-lifecycle-effect]')?.textContent).toContain('unit-leaf');
    expect(confirm?.querySelector('[data-lifecycle-kept]')?.textContent).toContain('Audit history is kept');
    await act(async () => {
      (confirm?.querySelector('button') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(patches[0]).toMatchObject({ archived: true });
  });
});
