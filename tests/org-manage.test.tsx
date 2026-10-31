// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLAIMED_ACTOR_KEY, FOUNDER_HANDLE } from '@/lib/acting-as';
import type { PmOrg, PmOrgHistoryEntry } from '@/lib/pm-client';
import { OrgOperateSurface } from '@/surfaces/org-operate';

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
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function orgFixture(patch?: Partial<PmOrg>): PmOrg {
  return {
    company: { id: 'co-starq', name: 'Starq Technologies', legal_name: null, notes: null },
    units: [
      { id: 'unit-eng', company_id: 'co-starq', parent_id: null, kind: 'DIVISION', name: 'Engineering', description: null },
      { id: 'unit-platform', company_id: 'co-starq', parent_id: 'unit-eng', kind: 'TEAM', name: 'Platform', description: null },
    ],
    positions: [],
    people: [
      { id: 'person-ali', handle: 'ali', display_name: 'Ali Mushthaq', kind: 'HUMAN' },
      { id: 'person-mustarq', handle: 'mustarq', display_name: 'Mustarq', kind: 'HUMAN' },
    ],
    appointments: [],
    generated_at: '2026-10-31T00:00:00.000Z',
    ...patch,
  };
}

function historyRow(patch?: Partial<PmOrgHistoryEntry>): PmOrgHistoryEntry {
  return {
    id: 7,
    entity: 'unit',
    entity_id: 'unit-eng',
    action: 'unit.update',
    actor: 'mustarq',
    channel: 'ui',
    timestamp: '2026-10-31T18:04:00.000Z',
    ...patch,
  };
}

function setup(seed?: (view: Window) => void) {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:5173/',
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('localStorage', dom.window.localStorage);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // react-dom decides at import time that the input event is unsupported in
  // this Node runner, and falls back to the focus/keyup change path. That
  // path calls attachEvent, which JSDOM does not implement.
  const elementProto = dom.window.HTMLElement.prototype as HTMLElement & {
    attachEvent?: (name: string, handler: () => void) => void;
    detachEvent?: (name: string, handler: () => void) => void;
  };
  elementProto.attachEvent = () => {};
  elementProto.detachEvent = () => {};
  dom.window.localStorage.clear();
  seed?.(dom.window);
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  return host;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function setNativeInput(input: HTMLInputElement, value: string) {
  const view = input.ownerDocument.defaultView!;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
  input.focus();
  input.dispatchEvent(new view.FocusEvent('focusin', { bubbles: true }));
  setter?.call(input, value);
  input.dispatchEvent(new view.KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
}

function installFetch(handler: (url: string, init?: RequestInit) => Promise<unknown> | unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('CV-CU2 organization management', () => {
  it('nests a company, division, and child team, and keeps a missing parent under Unplaced', async () => {
    const org = orgFixture({
      units: [
        { id: 'unit-eng', company_id: 'co-starq', parent_id: null, kind: 'DIVISION', name: 'Engineering', description: null },
        { id: 'unit-platform', company_id: 'co-starq', parent_id: 'unit-eng', kind: 'TEAM', name: 'Platform', description: null },
        { id: 'unit-floating', company_id: 'co-starq', parent_id: 'gone-parent', kind: 'TEAM', name: 'Floating', description: null },
      ],
    });
    installFetch((url) => {
      if (url.includes('/api/pm/org/history')) return jsonResponse(200, { history: [] });
      if (url.endsWith('/api/pm/org')) return jsonResponse(200, org);
      return jsonResponse(404, { code: 'NOT_FOUND', message: 'not found' });
    });
    const host = setup();
    await act(async () => {
      root?.render(<OrgOperateSurface />);
    });
    await flush();

    expect(host.querySelector('form[aria-label="Create company"]')).not.toBeNull();
    expect(host.querySelector('form[aria-label="Create unit"]')).not.toBeNull();
    expect(host.querySelector('form[aria-label="Create position"]')).not.toBeNull();
    expect(host.querySelector('form[aria-label="Create person"]')).not.toBeNull();
    expect(host.querySelector('form[aria-label="Create appointment"]')).not.toBeNull();

    const company = host.querySelector('[data-company-id="co-starq"]');
    const division = company?.querySelector('[data-unit-id="unit-eng"]');
    const team = division?.querySelector('[data-unit-id="unit-platform"]');
    expect(company?.querySelector('h3')?.textContent).toBe('Starq Technologies');
    expect(division?.getAttribute('data-unit-kind')).toBe('DIVISION');
    expect(team?.getAttribute('data-unit-kind')).toBe('TEAM');
    expect(division?.contains(team as Node)).toBe(true);
    expect(team?.parentElement?.closest('[data-unit-id="unit-eng"]')).toBe(division);

    const unplaced = host.querySelector('[data-org-unplaced]');
    expect(unplaced?.querySelector('h3')?.textContent).toBe('Unplaced');
    expect(unplaced?.querySelector('[data-unit-id="unit-floating"]')).not.toBeNull();
    expect(company?.querySelector('[data-unit-id="unit-floating"]')).toBeNull();
  });

  it('shows the claimed actor before people load, then offers org handles', async () => {
    let releaseOrg: () => void = () => {};
    const orgGate = new Promise<void>((resolve) => { releaseOrg = resolve; });
    try {
      installFetch(async (url) => {
        if (url.includes('/api/pm/org/history')) return jsonResponse(200, { history: [] });
        if (url.endsWith('/api/pm/org')) {
          await orgGate;
          return jsonResponse(200, orgFixture());
        }
        return jsonResponse(404, { code: 'NOT_FOUND', message: 'not found' });
      });
      const host = setup();
      await act(async () => {
        root?.render(<OrgOperateSurface />);
      });

      const select = host.querySelector('select[aria-label="Claimed actor — not authentication"]') as HTMLSelectElement;
      expect(select).not.toBeNull();
      expect(host.textContent).toContain('Claimed actor — not authentication');
      expect(select.value).toBe(FOUNDER_HANDLE);
      expect(Array.from(select.options).map((option) => option.value)).toEqual([FOUNDER_HANDLE]);

      releaseOrg();
      await flush();
      const loaded = host.querySelector('select[aria-label="Claimed actor — not authentication"]') as HTMLSelectElement;
      expect(Array.from(loaded.options).map((option) => option.value)).toEqual(['mustarq', 'ali']);
    } finally {
      releaseOrg();
    }
  });

  it('keeps a stored claimed actor that is not in the people list', async () => {
    installFetch((url) => {
      if (url.includes('/api/pm/org/history')) return jsonResponse(200, { history: [] });
      if (url.endsWith('/api/pm/org')) return jsonResponse(200, orgFixture());
      return jsonResponse(404, { code: 'NOT_FOUND', message: 'not found' });
    });
    const host = setup((view) => {
      view.localStorage.setItem(CLAIMED_ACTOR_KEY, 'kept-handle');
    });
    await act(async () => {
      root?.render(<OrgOperateSurface />);
    });
    await flush();
    const select = host.querySelector('select[aria-label="Claimed actor — not authentication"]') as HTMLSelectElement;
    expect(select.value).toBe('kept-handle');
    expect(Array.from(select.options).map((option) => option.value)).toContain('kept-handle');
  });

  it('shows a position reporting line, the appointee, and an ended appointment', async () => {
    const org = orgFixture({
      positions: [
        { id: 'pos-md', unit_id: 'unit-eng', title: 'Managing Director', job_description: null, reports_to_position_id: null },
        { id: 'pos-lead', unit_id: 'unit-platform', title: 'Lead Engineer', job_description: null, reports_to_position_id: 'pos-md' },
        { id: 'pos-gap', unit_id: 'unit-eng', title: 'Open Seat', job_description: null, reports_to_position_id: 'missing-pos' },
      ],
      people: [
        { id: 'person-ali', handle: 'mustarq', display_name: 'Ali Mushthaq', kind: 'HUMAN' },
        { id: 'person-old', handle: 'oldhand', display_name: 'Former Engineer', kind: 'HUMAN' },
      ],
      appointments: [{ id: 'appt-1', position_id: 'pos-lead', person_id: 'person-ali' }],
      ended_appointments: [{ id: 'appt-old', position_id: 'pos-lead', person_id: 'person-old' }],
    });
    installFetch((url) => {
      if (url.includes('/api/pm/org/history')) return jsonResponse(200, { history: [] });
      if (url.endsWith('/api/pm/org')) return jsonResponse(200, org);
      return jsonResponse(404, { code: 'NOT_FOUND', message: 'not found' });
    });
    const host = setup();
    await act(async () => {
      root?.render(<OrgOperateSurface />);
    });
    await flush();

    const division = host.querySelector('[data-unit-id="unit-eng"]');
    const lead = division?.querySelector('[data-position-id="pos-lead"]');
    expect(lead).not.toBeNull();
    expect(lead?.textContent).toContain('reports to Managing Director');
    const active = lead?.querySelector('[data-appointment-state="active"]');
    const ended = lead?.querySelector('[data-appointment-state="ended"]');
    expect(active?.textContent).toContain('Ali Mushthaq');
    expect(active?.textContent).not.toContain('ENDED');
    expect(ended?.textContent).toContain('ENDED');
    expect(ended?.textContent).toContain('Former Engineer');
    expect(host.querySelector('[data-reports-to="missing-pos"]')?.textContent).toContain('UNKNOWN');
  });

  it('patches a unit rename, then shows the reloaded name only after the write succeeds', async () => {
    let org = orgFixture();
    let releasePatch: () => void = () => {};
    const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
    try {
      const fetchMock = installFetch(async (url, init) => {
        const method = init?.method ?? 'GET';
        if (url.includes('/api/pm/org/history')) return jsonResponse(200, { history: [] });
        if (url.endsWith('/api/pm/org') && method === 'GET') return jsonResponse(200, org);
        if (url.includes('/api/pm/org/units/unit-eng') && method === 'PATCH') {
          await patchGate;
          const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string };
          org = {
            ...org,
            units: org.units.map((unit) => unit.id === 'unit-eng' ? { ...unit, name: String(body.name) } : unit),
          };
          return jsonResponse(200, { unit: org.units.find((unit) => unit.id === 'unit-eng') });
        }
        return jsonResponse(404, { code: 'NOT_FOUND', message: `${method} ${url}` });
      });
      const host = setup();
      await act(async () => {
        root?.render(<OrgOperateSurface />);
      });
      await flush();

      const input = host.querySelector('input[aria-label="Unit unit-eng name"]') as HTMLInputElement;
      const save = host.querySelector('button[aria-label="Save unit unit-eng"]') as HTMLButtonElement;
      expect(input.value).toBe('Engineering');
      await act(async () => {
        setNativeInput(input, 'Platform Group');
      });
      expect(input.value).toBe('Platform Group');

      await act(async () => {
        save.click();
      });
      expect(host.querySelector('[data-pm-state="saved"]')).toBeNull();
      expect(host.querySelector('[data-unit-name="unit-eng"]')?.textContent).toBe('Engineering');

      releasePatch();
      await flush();

      const patchCalls = fetchMock.mock.calls.filter((call) => {
        const method = (call[1] as RequestInit | undefined)?.method ?? 'GET';
        return method === 'PATCH' && String(call[0]).includes('/api/pm/org/units/unit-eng');
      });
      expect(patchCalls).toHaveLength(1);
      const body = JSON.parse(String((patchCalls[0][1] as RequestInit).body));
      expect(body).toMatchObject({ actor: 'mustarq', name: 'Platform Group', kind: 'DIVISION', parent_id: null });
      expect(body.archived).toBeUndefined();
      const patchAt = fetchMock.mock.calls.findIndex((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH');
      const reread = fetchMock.mock.calls.slice(patchAt + 1).some((call) => {
        const method = (call[1] as RequestInit | undefined)?.method ?? 'GET';
        return method === 'GET' && String(call[0]).endsWith('/api/pm/org');
      });
      expect(reread).toBe(true);
      expect(host.querySelector('[data-pm-state="saved"]')?.textContent).toContain('Unit saved.');
      expect(host.querySelector('[data-unit-name="unit-eng"]')?.textContent).toBe('Platform Group');
      expect((host.querySelector('input[aria-label="Unit unit-eng name"]') as HTMLInputElement).value).toBe('Platform Group');
    } finally {
      releasePatch();
    }
  });

  it('shows the error code on a failed patch and leaves the typed name in place', async () => {
    const org = orgFixture();
    installFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/api/pm/org/history')) return jsonResponse(200, { history: [] });
      if (url.endsWith('/api/pm/org') && method === 'GET') return jsonResponse(200, org);
      if (url.includes('/api/pm/org/units/unit-eng') && method === 'PATCH') {
        return jsonResponse(409, { code: 'STALE_WRITE', message: 'Record changed since you opened it.' });
      }
      return jsonResponse(404, { code: 'NOT_FOUND', message: `${method} ${url}` });
    });
    const host = setup();
    await act(async () => {
      root?.render(<OrgOperateSurface />);
    });
    await flush();

    const input = host.querySelector('input[aria-label="Unit unit-eng name"]') as HTMLInputElement;
    const save = host.querySelector('button[aria-label="Save unit unit-eng"]') as HTMLButtonElement;
    await act(async () => {
      setNativeInput(input, 'Keep This Name');
    });
    expect(input.value).toBe('Keep This Name');
    await act(async () => {
      save.click();
    });
    await flush();

    expect(host.querySelector('[data-pm-state="error"]')?.textContent).toContain('STALE_WRITE');
    expect(host.querySelector('[data-pm-state="error"]')?.textContent).toContain('Record changed since you opened it.');
    expect(host.querySelector('[data-pm-state="saved"]')).toBeNull();
    expect((host.querySelector('input[aria-label="Unit unit-eng name"]') as HTMLInputElement).value).toBe('Keep This Name');
    expect(host.querySelector('[data-unit-name="unit-eng"]')?.textContent).toBe('Engineering');
  });

  it('renders org history actor, action, entity, and timestamp', async () => {
    installFetch((url) => {
      if (url.includes('/api/pm/org/history')) return jsonResponse(200, { history: [historyRow()] });
      if (url.endsWith('/api/pm/org')) return jsonResponse(200, orgFixture());
      return jsonResponse(404, { code: 'NOT_FOUND', message: 'not found' });
    });
    const host = setup();
    await act(async () => {
      root?.render(<OrgOperateSurface />);
    });
    await flush();

    const panel = host.querySelector('[data-org-history]');
    const row = panel?.querySelector('[data-history-id="7"]');
    expect(row?.querySelector('[data-history-actor]')?.textContent).toBe('mustarq');
    expect(row?.querySelector('[data-history-action]')?.textContent).toBe('unit.update');
    expect(row?.querySelector('[data-history-entity]')?.textContent).toContain('unit');
    expect(row?.textContent).toContain('2026-10-31T18:04:00.000Z');
  });

  it('says there is no org history when the list is empty', async () => {
    installFetch((url) => {
      if (url.includes('/api/pm/org/history')) return jsonResponse(200, { history: [] });
      if (url.endsWith('/api/pm/org')) return jsonResponse(200, orgFixture());
      return jsonResponse(404, { code: 'NOT_FOUND', message: 'not found' });
    });
    const host = setup();
    await act(async () => {
      root?.render(<OrgOperateSurface />);
    });
    await flush();
    const panel = host.querySelector('[data-org-history]');
    expect(panel?.querySelector('[data-pm-state="empty"]')?.textContent).toBe('No org history.');
  });

  it('shows UNAVAILABLE when org history cannot be read', async () => {
    installFetch((url) => {
      if (url.includes('/api/pm/org/history')) return jsonResponse(503, { code: 'UNAVAILABLE', message: 'history down' });
      if (url.endsWith('/api/pm/org')) return jsonResponse(200, orgFixture());
      return jsonResponse(404, { code: 'NOT_FOUND', message: 'not found' });
    });
    const host = setup();
    await act(async () => {
      root?.render(<OrgOperateSurface />);
    });
    await flush();
    const panel = host.querySelector('[data-org-history]');
    expect(panel?.querySelector('[data-pm-state="unavailable"]')?.textContent).toContain('UNAVAILABLE');
    expect(panel?.textContent).not.toContain('No org history.');
    expect(host.querySelector('[data-company-id="co-starq"]')).not.toBeNull();
  });
});
