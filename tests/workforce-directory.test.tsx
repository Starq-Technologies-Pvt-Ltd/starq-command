// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pmTaskHref } from '@/lib/pm-client';
import { WorkforceDirectory } from '@/surfaces/workforce-directory';

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

const ali = {
  id: 'person-ali',
  handle: 'ali',
  display_name: 'Ali Mushthaq',
  kind: 'HUMAN',
  harness: null,
  capabilities: [],
  status: 'active',
  source: 'manual',
};

const cursor = {
  id: 'person-cursor',
  handle: 'cursor',
  display_name: 'Cursor',
  kind: 'DIGITAL',
  harness: 'cursor',
  capabilities: ['typescript', 'review'],
  status: 'active',
  source: 'manual',
};

const archived = {
  id: 'person-old',
  handle: 'old-agent',
  display_name: 'Old Agent',
  kind: 'DIGITAL',
  harness: 'retired-harness',
  capabilities: ['legacy'],
  status: 'inactive',
  source: 'manual',
  archived_at: '2026-10-01T00:00:00.000Z',
};

function orgPayload(people: Array<Record<string, unknown>>) {
  return {
    company: null,
    units: [],
    positions: [
      { id: 'pos-md', unit_id: 'starq-corporate', title: 'Managing Director' },
      { id: 'pos-engineer', unit_id: 'starq-dev-studio', title: 'Lead Engineer' },
    ],
    people,
    appointments: [
      { id: 'appt-md', position_id: 'pos-md', person_id: 'person-ali' },
      { id: 'appt-engineer', position_id: 'pos-engineer', person_id: 'person-cursor' },
    ],
    ended_appointments: [],
    generated_at: '2026-10-31T00:00:00.000Z',
  };
}

function summaryPayload(recentActivity?: Array<Record<string, unknown>>) {
  const body: Record<string, unknown> = {
    state: 'OK',
    person: cursor,
    appointments: {
      active: [{ id: 'appt-engineer', position_id: 'pos-engineer', person_id: 'person-cursor', status: 'ACTIVE' }],
      ended: [{ id: 'appt-old', position_id: 'pos-md', person_id: 'person-cursor', status: 'ENDED' }],
    },
    tasks: {
      owned_open: [{ id: 'CMD-101', project_id: 'command', title: 'Implement directory', status: 'IN_PROGRESS', owner: 'cursor' }],
      verifying_open: [{ id: 'CMD-202', project_id: 'erp', title: 'Verify milestone', status: 'IN_PROGRESS', owner: 'ali', verifier: 'cursor' }],
      blocked: [{ id: 'CMD-303', project_id: 'command', title: 'Waiting review', status: 'BLOCKED', owner: 'cursor', reason: 'Verifier has not attested' }],
    },
  };
  if (recentActivity) body.recent_activity = recentActivity;
  return body;
}

function jsonResult(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(url: string, fetchMock: ReturnType<typeof vi.fn>) {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dom.window.localStorage.setItem('starq.pm.actor', 'ali');
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  await act(async () => {
    root?.render(<WorkforceDirectory />);
  });
  await settle();
  await settle();
  return host;
}

describe('CV-CU4 workforce directory', () => {
  it('renders a HUMAN and a DIGITAL person with kind, harness, capabilities, and appointments', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/pm/org')) return jsonResult(orgPayload([ali, cursor, archived]));
      return jsonResult({ message: 'not found' }, 404);
    });
    const host = await mount('http://localhost/#workforce', fetchMock);

    const human = host.querySelector('[data-person-handle="ali"]');
    const digital = host.querySelector('[data-person-handle="cursor"]');
    expect(human?.getAttribute('data-kind')).toBe('HUMAN');
    expect(human?.textContent).toContain('HUMAN');
    expect(human?.textContent).toContain('Ali Mushthaq');
    expect(human?.textContent).toContain('@ali');
    expect(human?.textContent).toContain('Harness: UNKNOWN');
    expect(human?.textContent).toContain('Capabilities: none recorded');
    expect(human?.textContent).toContain('Status: active');
    expect(human?.textContent).toContain('Managing Director');
    expect(digital?.getAttribute('data-kind')).toBe('DIGITAL');
    expect(digital?.textContent).toContain('DIGITAL');
    expect(digital?.textContent).toContain('Cursor');
    expect(digital?.textContent).toContain('Harness: cursor');
    expect(digital?.textContent).toContain('typescript, review');
    expect(digital?.textContent).toContain('Lead Engineer');
    expect(host.textContent).not.toContain('Old Agent');
    expect(host.textContent).toContain('Observed Herdr/Hermes presence is a separate optional overlay. It is UNKNOWN on this page.');
    expect(host.textContent).toContain('Claimed actor — not authentication');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('include=archived');
  });

  it('hides archived people until Show archived requests them', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/pm/org')) return jsonResult(orgPayload([ali, cursor, archived]));
      return jsonResult({ message: 'not found' }, 404);
    });
    const host = await mount('http://localhost/#workforce', fetchMock);
    expect(host.querySelector('[data-person-handle="old-agent"]')).toBeNull();

    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      box.click();
    });
    await settle();

    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('include=archived'))).toBe(true);
    expect(host.querySelector('[data-person-handle="old-agent"]')?.textContent).toContain('Old Agent');
    expect(host.textContent).toContain('archived');
  });

  it('shows the empty registry sentence when no people are recorded', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => jsonResult(orgPayload([])));
    const host = await mount('http://localhost/#workforce', fetchMock);
    expect(host.textContent).toContain('No people in the operating registry.');
    expect(host.querySelector('[data-pm-state="empty"]')?.textContent).toContain('No people in the operating registry.');
  });

  it('shows UNAVAILABLE when the org registry cannot be read', async () => {
    const fetchMock = vi.fn(async () => jsonResult({ message: 'PM org is down' }, 503));
    const host = await mount('http://localhost/#workforce', fetchMock);
    expect(host.querySelector('[data-pm-state="unavailable"]')?.textContent).toContain('UNAVAILABLE');
    expect(host.textContent).toContain('PM org is down');
    expect(host.textContent).not.toContain('No people in the operating registry.');
  });

  it('choosing a person renders owned work from the summary and preserves pm_port', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/pm/workforce/') && url.endsWith('/summary')) return jsonResult(summaryPayload([]));
      if (url.includes('/api/pm/org')) return jsonResult(orgPayload([ali, cursor]));
      return jsonResult({ message: 'not found' }, 404);
    });
    const host = await mount('http://localhost/#workforce?pm_port=5191', fetchMock);
    const button = host.querySelector('[data-person-handle="cursor"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    await settle();
    await settle();

    expect(dom?.window.location.hash).toContain('pm_port=5191');
    expect(dom?.window.location.hash).toContain('person=cursor');
    expect(dom?.window.location.hash.startsWith('#workforce?')).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/pm/workforce/person-cursor/summary'))).toBe(true);

    const page = host.querySelector('[data-person-page]')!;
    expect(page.textContent).toContain('DIGITAL');
    expect(page.textContent).toContain('Harness: cursor');
    expect(page.textContent).toContain('Source: manual');
    expect(page.textContent).toContain('Implement directory');
    expect(page.textContent).toContain('Verify milestone');
    expect(page.textContent).toContain('Blocked tasks owned by this person.');
    expect(page.textContent).toContain('Reason: Verifier has not attested');
    expect(page.textContent).toContain('Owner: cursor');
    expect(page.textContent).toContain('Lead Engineer');
    expect(page.textContent).toContain('Managing Director');
    expect(page.textContent).toContain('No recorded actions.');
    const owned = page.querySelector('a[href*="CMD-101"]');
    expect(owned?.getAttribute('href')).toBe(pmTaskHref('command', 'CMD-101'));
    expect(page.querySelector('a[href*="CMD-202"]')?.getAttribute('href')).toBe(pmTaskHref('erp', 'CMD-202'));
    expect(host.querySelector('[data-person-handle="ali"]')).not.toBeNull();
  });

  it('opens #workforce?person=cursor and shows recorded actions', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/pm/workforce/') && url.endsWith('/summary')) {
        return jsonResult(summaryPayload([
          { actor: 'cursor', action: 'task.updated', timestamp: '2026-10-31T12:00:00.000Z', source: 'pm' },
        ]));
      }
      if (url.includes('/api/pm/org')) return jsonResult(orgPayload([ali, cursor]));
      return jsonResult({ message: 'not found' }, 404);
    });
    const host = await mount('http://localhost/#workforce?person=cursor', fetchMock);
    const page = host.querySelector('[data-person-page]');
    expect(page).not.toBeNull();
    expect(page?.textContent).toContain('Implement directory');
    expect(page?.textContent).toContain('Actor: cursor');
    expect(page?.textContent).toContain('Action: task.updated');
    expect(page?.textContent).toContain('Timestamp: 2026-10-31T12:00:00.000Z');
    expect(page?.textContent).toContain('Source: pm');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/pm/workforce/person-cursor/summary'))).toBe(true);
  });

  it('shows No recorded actions when recent_activity is missing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/pm/workforce/') && url.endsWith('/summary')) return jsonResult(summaryPayload());
      if (url.includes('/api/pm/org')) return jsonResult(orgPayload([ali, cursor]));
      return jsonResult({ message: 'not found' }, 404);
    });
    const host = await mount('http://localhost/#workforce?person=cursor', fetchMock);
    expect(host.querySelector('[data-person-page]')?.textContent).toContain('No recorded actions.');
  });

  it('a failed summary shows UNAVAILABLE and leaves the directory visible', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/pm/workforce/') && url.endsWith('/summary')) {
        return jsonResult({ message: 'Workforce summary is unavailable.' }, 503);
      }
      if (url.includes('/api/pm/org')) return jsonResult(orgPayload([ali, cursor]));
      return jsonResult({ message: 'not found' }, 404);
    });
    const host = await mount('http://localhost/#workforce?person=cursor', fetchMock);
    const page = host.querySelector('[data-person-page]')!;
    expect(page.querySelector('[data-pm-state="unavailable"]')?.textContent).toContain('UNAVAILABLE');
    expect(page.textContent).toContain('Workforce summary is unavailable.');
    expect(page.textContent).not.toContain('Implement directory');
    expect(page.textContent).not.toContain('No recorded actions.');
    expect(host.querySelector('[data-person-handle="ali"]')).not.toBeNull();
    expect(host.querySelector('[data-person-handle="cursor"]')).not.toBeNull();
  });

  it('import identities UNAVAILABLE shows the reason and does not add fake people', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/import-identities')) {
        expect(String(init?.method)).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ actor: 'ali', channel: 'ui' });
        return jsonResult({
          state: 'UNAVAILABLE',
          reason: 'Agent identity source is absent.',
          created: [{ handle: 'phantom', display_name: 'Phantom Agent' }],
          skipped: [],
          conflicts: [],
        });
      }
      if (url.includes('/api/pm/org')) return jsonResult(orgPayload([ali, cursor]));
      return jsonResult({ message: 'not found' }, 404);
    });
    const host = await mount('http://localhost/#workforce', fetchMock);
    const orgCallsBefore = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/pm/org') && !String(call[0]).includes('import-identities')).length;
    const button = Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.includes('Import agent identities'));
    await act(async () => {
      button?.click();
    });
    await settle();

    expect(host.textContent).toContain('UNAVAILABLE');
    expect(host.textContent).toContain('Agent identity source is absent.');
    expect(host.textContent).not.toContain('Phantom Agent');
    expect(host.textContent).not.toContain('phantom');
    expect(host.querySelector('[data-person-handle="ali"]')).not.toBeNull();
    expect(host.querySelector('[data-person-handle="cursor"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-person-handle]')).toHaveLength(2);
    const orgCallsAfter = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/pm/org') && !String(call[0]).includes('import-identities')).length;
    expect(orgCallsAfter).toBe(orgCallsBefore);
    expect(host.textContent).not.toContain('authenticated successfully');
  });

  it('a recorded import shows created, skipped, and conflict counts, then reloads the registry', async () => {
    let imported = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/import-identities')) {
        imported = true;
        return jsonResult({
          state: 'IMPORTED',
          created: [{ handle: 'new-agent' }],
          skipped: [{ handle: 'cursor' }, { handle: 'ali' }],
          conflicts: [{ handle: 'codex' }],
        });
      }
      if (url.includes('/api/pm/org')) {
        const people = imported
          ? [ali, cursor, { id: 'person-new', handle: 'new-agent', display_name: 'New Agent', kind: 'DIGITAL', harness: 'codex', capabilities: ['planning'], status: 'active', source: 'identities-import' }]
          : [ali, cursor];
        return jsonResult(orgPayload(people));
      }
      return jsonResult({ message: 'not found' }, 404);
    });
    const host = await mount('http://localhost/#workforce', fetchMock);
    const button = Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.includes('Import agent identities'));
    await act(async () => {
      button?.click();
    });
    await settle();
    await settle();

    expect(host.querySelector('[data-pm-state="saved"]')?.textContent).toContain('Created 1. Skipped 2. Conflicts 1.');
    expect(host.textContent).toContain('This did not authenticate anyone.');
    expect(host.querySelector('[data-person-handle="new-agent"]')?.textContent).toContain('New Agent');
    expect(host.querySelector('[data-person-handle="new-agent"]')?.textContent).toContain('DIGITAL');
  });
});
