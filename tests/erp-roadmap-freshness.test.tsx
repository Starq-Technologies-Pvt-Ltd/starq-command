// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErpRoadmapSurface } from '@/surfaces/erp-roadmap';
import type { PmRoadmapsData } from '@/lib/pm-client';

// Mock pm-client
vi.mock('@/lib/pm-client', () => ({
  pmGetRoadmaps: vi.fn(),
}));

const { pmGetRoadmaps } = await import('@/lib/pm-client');

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

describe('ErpRoadmapSurface - Live Freshness', () => {
  it('displays live PM database source with last fetch time on successful load', async () => {
    const mockData: PmRoadmapsData = {
      chains_count: 5,
      stages_count: 49,
      gaps_count: 3,
      milestones: [],
      plan_generations: [
        { id: 'GEN-3', title: 'Generation 3', status: 'CURRENT', card_count: 8, description: 'Current plan' },
      ],
      current_approved_plan: {
        generation_id: 'GEN-3',
        approved_date: '2026-10-26',
        authority: 'Founder #14394',
        cards: ['SERP-460', 'SERP-461'],
        description: 'Approved plan',
      },
      stage_bindings: [],
    };

    vi.mocked(pmGetRoadmaps).mockResolvedValue({ ok: true, data: mockData });

    dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
    global.window = dom.window as any;
    global.document = dom.window.document;

    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => {
      root?.render(<ErpRoadmapSurface />);
    });

    // Wait for async load to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    const html = dom.window.document.getElementById('root')?.innerHTML || '';
    expect(html).toContain('LIVE PM DATABASE');
    expect(html).toContain('Last updated:');
    expect(html).toContain('Data source:');
    expect(html).toContain('Live PM service database (/api/pm/roadmaps)');
    expect(html).toContain('not the historical starq-erp-tasks.json Nexus projection');
  });

  it('shows error state when PM service fails', async () => {
    vi.mocked(pmGetRoadmaps).mockResolvedValue({ ok: false, message: 'PM service unavailable' });

    dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
    global.window = dom.window as any;
    global.document = dom.window.document;

    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => {
      root?.render(<ErpRoadmapSurface />);
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const html = dom.window.document.getElementById('root')?.innerHTML || '';
    expect(html).toContain('PM service unavailable');
  });

  it('shows error state when fetch throws', async () => {
    vi.mocked(pmGetRoadmaps).mockRejectedValue(new Error('Network error'));

    dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
    global.window = dom.window as any;
    global.document = dom.window.document;

    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => {
      root?.render(<ErpRoadmapSurface />);
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const html = dom.window.document.getElementById('root')?.innerHTML || '';
    expect(html).toContain('Network error');
  });

  it('clearly distinguishes historical Nexus JSON from live PM database', async () => {
    const mockData: PmRoadmapsData = {
      chains_count: 5,
      stages_count: 49,
      gaps_count: 3,
      milestones: [],
      plan_generations: [],
      current_approved_plan: undefined,
      stage_bindings: [],
    };

    vi.mocked(pmGetRoadmaps).mockResolvedValue({ ok: true, data: mockData });

    dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
    global.window = dom.window as any;
    global.document = dom.window.document;

    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => {
      root?.render(<ErpRoadmapSurface />);
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const html = dom.window.document.getElementById('root')?.innerHTML || '';
    expect(html).toContain('LIVE PM DATABASE');
    expect(html).toContain('historical starq-erp-tasks.json Nexus projection');
    expect(html).toContain('static');
    expect(html).toContain('2026-09-19');
  });

  it('includes refresh button in the rendered output', async () => {
    const mockData: PmRoadmapsData = {
      chains_count: 5,
      stages_count: 49,
      gaps_count: 3,
      milestones: [],
      plan_generations: [{ id: 'GEN-3', title: 'Generation 3', status: 'CURRENT', card_count: 8, description: 'Current plan' }],
      current_approved_plan: {
        generation_id: 'GEN-3',
        approved_date: '2026-10-26',
        authority: 'Founder #14394',
        cards: ['SERP-460'],
        description: 'Approved plan',
      },
      stage_bindings: [],
    };

    vi.mocked(pmGetRoadmaps).mockResolvedValue({ ok: true, data: mockData });

    dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
    global.window = dom.window as any;
    global.document = dom.window.document;

    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => {
      root?.render(<ErpRoadmapSurface />);
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const html = dom.window.document.getElementById('root')?.innerHTML || '';
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Refresh roadmap data"');
  });
});
