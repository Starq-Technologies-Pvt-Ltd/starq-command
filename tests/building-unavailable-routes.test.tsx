import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { BuildingSurface } from '@/surfaces/building';
import { AttentionSurface } from '@/surfaces/attention';
import { EvidenceSurface } from '@/surfaces/evidence';
import { SystemSurface } from '@/surfaces/system';
import { ActivityPanel, CapacityPanel, StaffSurface } from '@/surfaces/staff';
import { HerdrSurface } from '@/surfaces/herdr';
import { PmPortfolioSurface } from '@/surfaces/pm-portfolio';
import {
  ATTENTION_TABS, EVIDENCE_TABS, STUDIO_TABS, SYSTEM_TABS,
  parseBuildingRoute, routeHash,
} from '@/lib/building-route';
import { useBuildingProjection, useCommandSurface } from '@/lib/use-command-surface';
import type { CommandSurface } from '@/lib/contracts';
import fixture from './fixtures/phase5-surface.json';
import { FLOOR_FIXTURE } from './fixtures/floor-fixture';

// App integration uses fixed hook results. Mounted child fetches are also
// stubbed below: these tests never contact PM, data, Building, or Herdr.
vi.mock('@/lib/use-command-surface', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/use-command-surface')>(),
  useBuildingProjection: vi.fn(),
  useCommandSurface: vi.fn(),
}));

const surface = {
  ...fixture,
  building: undefined,
  assembled_at: '2026-10-15T00:00:00Z',
  authority_note: 'DERIVED_PROJECTION',
  workspace: { root: 'D:\\StarqTech', source: 'STARQ_WORKSPACE' },
  process_truth: { ...fixture.process_truth, version: 'route-fixture-v1', authority: 'DEC-100' },
  health: {
    overall: 'DRIFT', counts: { total: 3, ok: 1 },
    conditions: [
      { key: 'process', state: 'OK', available: true },
      { key: 'execution', state: 'STALE', available: true },
      { key: 'provenance', state: 'DRIFT', available: true },
    ],
  },
  identities: { available: true, version: 'registry-fixture', count: 0, founder: null, byHandle: {} },
  staff_state: { available: true, byHandle: {} },
  sessions: { available: false },
  read_only_sources: ['contract.json', 'activity.json'],
  provenance: {
    state: 'DRIFT', checked: 1, drifted: ['contract'], missing: [],
    sources: [{ name: 'contract', path: 'contract.json', recorded: 'aaaa', live: 'bbbb', state: 'DRIFT' }],
  },
  floor: {
    ...FLOOR_FIXTURE,
    staff_glance_counts: { working: 1, idle: 0, blocked: null, unknown: 1 },
  },
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

function html(hash: string, data = surface) {
  return renderToStaticMarkup(<BuildingSurface route={parseBuildingRoute(hash)} surface={data} />);
}

function documentFor(hash: string, data = surface) {
  dom = new JSDOM(html(hash, data));
  return dom.window.document;
}

describe('Building absent: existing independent surfaces remain reachable', () => {
  it.each(ATTENTION_TABS)('renders the existing Attention %s queue and declared records', (tab) => {
    const markup = html(`#attention/${tab.toLowerCase()}`);
    expect(markup).toContain('<h1>Founder Attention</h1>');
    expect(markup).toContain(renderToStaticMarkup(<AttentionSurface surface={surface} peer={tab} />));
    expect(markup).toContain('Hoadha UNKNOWN');
    expect(markup).not.toContain('<h1>Building projection unavailable</h1>');
  });

  it('keeps Evidence Sources usable with provenance but no Building census', () => {
    const markup = html('#evidence/sources');
    expect(markup).toContain(renderToStaticMarkup(<EvidenceSurface surface={surface} />));
    expect(markup).toContain('contract.json');
    expect(markup).toContain('DRIFT');
  });

  it.each([
    ['projection', 'Projection assembly'],
    ['decisions', 'Decision record provenance'],
    ['hashes', 'Ledger anchor'],
  ])('renders existing Evidence %s content', (tab, content) => {
    const markup = html(`#evidence/${tab}`);
    expect(markup).toContain('<h1>Evidence</h1>');
    expect(markup).toContain(content);
    expect(markup).not.toContain('<h1>Building projection unavailable</h1>');
  });

  it('localizes the absent Rooms dependency while preserving peer navigation', () => {
    const doc = documentFor('#evidence/rooms');
    expect(doc.querySelector('h1')?.textContent).toBe('Evidence');
    expect(doc.body.textContent).toContain('Room provenance index UNAVAILABLE');
    expect(doc.body.textContent).not.toContain('0 declared rooms');
    for (const tab of EVIDENCE_TABS) {
      expect(doc.querySelector(`a[href="#evidence/${tab.toLowerCase()}"]`)).not.toBeNull();
    }
    expect(doc.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('#evidence/rooms');
  });

  it('renders the existing System health surface with its STALE/DRIFT dimensions', () => {
    const markup = html('#system/health');
    expect(markup).toContain(renderToStaticMarkup(<SystemSurface surface={surface} />));
    expect(markup).toContain('STALE');
    expect(markup).toContain('DRIFT');
    expect(markup).toContain('Command UI version');
    expect(markup).not.toContain('Runtime node');
    expect(markup).toContain('does not establish current');
  });

  it.each([
    ['runtime', 'Process runtime'],
    ['contracts', 'Control-plane contracts'],
    ['projection', 'Projection dimensions'],
  ])('renders existing System %s content', (tab, content) => {
    const markup = html(`#system/${tab}`);
    expect(markup).toContain('<h1>System</h1>');
    expect(markup).toContain(content);
    expect(markup).not.toContain('<h1>Building projection unavailable</h1>');
  });

  it('preserves the System allowlist and registry without claiming census reachability', () => {
    const markup = html('#system/sources');
    expect(markup).toContain('Declared read-only source set');
    expect(markup).toContain('contract.json');
    expect(markup).toContain('Identity registry');
    expect(markup).toContain('registry-fixture');
    expect(markup).toContain('Building source census UNAVAILABLE');
    expect(markup).not.toContain('all reachable');
    expect(markup).not.toContain('0/0');
  });

  it('renders Studio Overview with the supplied glance counts and local source gaps', () => {
    const doc = documentFor('#studio');
    expect(doc.querySelector('h1')?.textContent).toBe('Dev Studio');
    expect(doc.querySelector('[data-glance-state="WORKING"]')?.textContent).toContain('1');
    expect(doc.querySelector('[data-glance-state="BLOCKED"]')?.textContent).toContain('UNKNOWN');
    expect(doc.body.textContent).toContain('Project-room mapping is UNKNOWN');
    expect(doc.body.textContent).toContain('UNKNOWN capacity');
    expect(doc.querySelector('a[href="#studio/staff"]')).not.toBeNull();
  });

  it.each([
    ['staff', <StaffSurface surface={surface} />],
    ['activity', <ActivityPanel surface={surface} />],
    ['capacity', <CapacityPanel surface={surface} />],
    ['herdr', <HerdrSurface />],
  ])('renders the existing Studio %s component', (tab, component) => {
    const markup = html(`#studio/${tab}`);
    expect(markup).toContain('<h1>Dev Studio</h1>');
    expect(markup).toContain(renderToStaticMarkup(component));
    expect(markup).not.toContain('<h1>Building projection unavailable</h1>');
  });

  it('uses the existing Phase 3 floor declaration without claiming runtime capacity', () => {
    const markup = html('#studio/overview', {
      ...surface,
      phase3: { name: 'Dev Studio Floor', endpoint: '/api/floor', authority: 'DERIVED_PROJECTION', reads: [], writes: [], ingest_embedded: false },
    });
    expect(markup).toContain('Declared floor');
    expect(markup).toContain('Dev Studio Floor');
    expect(markup).toContain('runtime availability is separate');
    expect(markup).toContain('UNKNOWN capacity');
  });

  it('preserves the PM portfolio and source-history panel without Building', () => {
    const doc = documentFor('#studio/projects');
    expect(html('#studio/projects')).toContain(renderToStaticMarkup(<PmPortfolioSurface />));
    expect(doc.querySelector('[data-pm="portfolio"]')).not.toBeNull();
    expect(doc.body.textContent).toContain('Project boards');
    expect(doc.body.textContent).toContain('Original task payloads, relationships, histories and source hashes');
    for (const project of ['command', 'studio', 'erp', 'hoadha']) {
      expect(doc.querySelector(`a[href^="#studio/${project}"]`)).not.toBeNull();
    }
    expect(doc.querySelector('a[aria-current="page"]')?.getAttribute('href')).toContain('#studio/projects');
  });

  it.each([
    '#building', '#studio/erp/overview', '#studio/hoadha/loops',
    '#process', '#truth',
  ])('keeps the Building-dependent route %s guarded', (hash) => {
    const markup = html(hash);
    expect(markup).toContain('<h1>Building projection unavailable</h1>');
    expect(markup).not.toContain('Organization tree');
    expect(markup).not.toContain('PREPARED / NOT STARTED');
  });

  it('keeps active PM project routes independent from the Building projection', () => {
    const markup = html('#studio/mercury/board');
    expect(markup).toContain('data-pm-route="mercury"');
    expect(markup).toContain('Reading the board…');
    expect(markup).not.toContain('Building projection unavailable');
  });

  it('preserves the legacy Floor link and missing-data states within independent surfaces', () => {
    expect(parseBuildingRoute('#floor')).toEqual(parseBuildingRoute('#studio/staff'));
    expect(html('#floor')).toContain('Original floor projection');
    const unavailable = {
      ...surface, floor: undefined,
      process_truth: { available: false, reason: 'process input absent', state: 'UNAVAILABLE' },
      provenance: { state: 'UNAVAILABLE', reason: 'provenance input absent' },
    } as unknown as CommandSurface;
    expect(html('#attention/decisions', unavailable)).toContain('process input absent');
    expect(html('#evidence/sources', unavailable)).toContain('provenance input absent');
    expect(html('#studio/activity', unavailable)).toContain('Activity provenance');
  });

  it('links Studio to the existing read-only Work feed and back without Building', () => {
    const doc = documentFor('#studio/overview');
    expect(doc.querySelector('a[href="#work"]')?.textContent).toContain('Read-only work feed');
    const work = html('#work');
    expect(work).toContain('href="#studio/overview"');
    expect(work).toContain('data-availability="UNKNOWN"');
  });

  it.each([
    ['attention', ATTENTION_TABS], ['evidence', EVIDENCE_TABS], ['system', SYSTEM_TABS],
  ])('preserves direct links and current-peer navigation for every %s tab', (view, tabs) => {
    for (const tab of tabs) {
      const hash = `#${view}/${tab.toLowerCase()}`;
      const route = parseBuildingRoute(hash);
      expect(routeHash(route)).toBe(hash);
      dom?.window.close();
      const doc = documentFor(hash);
      expect(doc.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(hash);
      for (const peer of tabs) {
        expect(doc.querySelector(`a[href="#${view}/${peer.toLowerCase()}"]`)).not.toBeNull();
      }
    }
  });
});

it('keeps the App warning and hold visible while navigating real pages with Building absent', async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://command.test/#studio/staff' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchMock = vi.fn(async () => ({ ok: false, status: 503, text: async () => 'fixture source unavailable' }));
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(useCommandSurface).mockReturnValue({
    status: 'READY', surface, health: surface.health, error: null, lastFetchedAt: null,
    refresh: vi.fn(), refreshing: false,
  });
  vi.mocked(useBuildingProjection).mockReturnValue({
    building: null, buildingStatus: 'UNAVAILABLE', buildingError: 'fixture Building origin unavailable', buildingStale: false,
  });
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  await act(async () => { root?.render(<App />); });

  for (const [hash, content] of [
    ['#studio/activity', 'Activity provenance'],
    ['#studio/projects', 'Project boards'],
    ['#studio/staff', 'Original floor projection'],
  ]) {
    await act(async () => {
      const changed = new Promise<void>((resolve) => dom!.window.addEventListener('hashchange', () => resolve(), { once: true }));
      dom!.window.location.hash = hash;
      await changed;
    });
    expect(dom.window.location.hash).toBe(hash);
    expect(host.textContent).toContain(content);
    if (hash === '#studio/projects') {
      expect(host.querySelector('[data-pm="portfolio"]')).not.toBeNull();
      expect(host.textContent).toContain('PM service unavailable.');
      // The global Building health banner remains visible while PM owns this route.
      expect(host.textContent).toContain('Building projection unreachable');
    } else {
      expect(host.textContent).toContain('Building projection unreachable');
      expect(host.textContent).toContain('fixture Building origin unavailable');
    }
    expect(host.textContent).toContain('DEC-100');
  }

  for (const [label, hash, content] of [
    ['Founder Attention', '#attention/decisions', 'fixture decision'],
    ['Evidence', '#evidence/sources', 'Canonical sources'],
    ['System', '#system/health', 'Projection dimensions'],
  ]) {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button).not.toBeNull();
    await act(async () => {
      const changed = new Promise<void>((resolve) => dom!.window.addEventListener('hashchange', () => resolve(), { once: true }));
      button!.click();
      await changed;
    });
    expect(dom.window.location.hash).toBe(hash);
    expect(host.textContent).toContain(content);
    expect(host.textContent).toContain('Building projection unreachable');
    expect(host.querySelector('h1')?.textContent).toBe(label);
  }

  // Returning directly to the Founder Holds peer preserves its canonical hold.
  await act(async () => {
    const changed = new Promise<void>((resolve) => dom!.window.addEventListener('hashchange', () => resolve(), { once: true }));
    dom!.window.location.hash = '#attention/holds';
    await changed;
  });
  expect(host.textContent).toContain('ON_HOLD');
  expect(host.textContent).toContain('DEC-100');
  expect(host.textContent).toContain('Building projection unreachable');
  // All network work remains intercepted, including PM portfolio and staff
  // effects. Navigation must not initiate a mutation.
  expect(fetchMock).toHaveBeenCalled();
  for (const call of fetchMock.mock.calls as unknown as [unknown, RequestInit?][]) {
    expect(call[1]?.method ?? 'GET').toBe('GET');
  }
});
