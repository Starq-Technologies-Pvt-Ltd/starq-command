import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBuilding, BUILDING_SOURCES, HOADHA_ROOT } from '../server/building.mjs';
import { BuildingSurface } from '@/surfaces/building';
import { parseBuildingRoute, routeHash } from '@/lib/building-route';
import fixture from './fixtures/phase5-surface.json';
import type { CommandSurface } from '@/lib/contracts';

function withRoot(run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-p7-'));
  try {
    for (const source of BUILDING_SOURCES) {
      const target = path.join(root, source);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let body = '';
      if (source.endsWith('roadmap.machine.json'))
        body = JSON.stringify({
          status: 'FOUNDER_REVIEW',
          current_wave: 'H0',
          loops: ['C2G', 'N2D', 'O2K', 'S2A', 'A2F', 'C2C'].map((id) => ({
            id,
            name: id,
            state: 'STALE',
            blocker: 'UNKNOWN',
            tasks: [],
          })),
        });
      else if (source.endsWith('-tasks.json')) {
        const count = source.endsWith('/hoadha-tasks.json')
          ? 243
          : source.includes('social')
            ? 56
            : source.includes('concierge')
              ? 27
              : 2;
        body = JSON.stringify({
          tasks: Array.from({ length: count }, (_, i) => ({
            id: `TASK-${i}`,
            title: 'Original',
            status: i === 0 ? 'DRIFT' : 'done',
            evidence: ['source-proof'],
          })),
        });
      } else if (source.endsWith('TASK_RECONCILIATION.md'))
        body = Array.from(
          { length: 33 },
          (_, i) => `| HCD-H0-${String(i + 1).padStart(2, '0')} | H0 | Proposed | NOT_ASSESSED |`,
        ).join('\n');
      else if (source.endsWith('DEVELOPMENT_WAVES.md'))
        body = Array.from(
          { length: 11 },
          (_, i) => `| H${i} wave | objective | entry | invariant |`,
        ).join('\n');
      fs.writeFileSync(target, body);
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const base = fixture as unknown as CommandSurface;
describe('Phase 7 projection and navigation', () => {
  it('keeps all live rows distinct from proposed and preserves uncertainty without mutation', () =>
    withRoot((root) => {
      const before = BUILDING_SOURCES.map((s) => fs.readFileSync(path.join(root, s), 'utf8'));
      const b = buildBuilding(root, base);
      expect(b.hoadha.live_count).toBe(326);
      expect(b.hoadha.proposed_count).toBe(33);
      expect(b.hoadha.boards.map((b) => b.count)).toEqual([243, 56, 27]);
      expect(b.hoadha.loops[0].state).toBe('STALE');
      expect(b.hoadha.boards[0].records[0].status).toBe('DRIFT');
      expect(b.hoadha.execution).toBe('NOT STARTED');
      expect(b.hoadha.integrity).toBe('SOURCE_READ');
      expect(BUILDING_SOURCES.map((s) => fs.readFileSync(path.join(root, s), 'utf8'))).toEqual(
        before,
      );
    }));
  it('detects count drift, and proposed changes never change live count', () =>
    withRoot((root) => {
      fs.writeFileSync(path.join(root, HOADHA_ROOT, 'TASK_RECONCILIATION.md'), '');
      const b = buildBuilding(root, base);
      expect(b.hoadha.integrity).toBe('DRIFT');
      expect(b.hoadha.live_count).toBe(326);
      fs.writeFileSync(
        path.join(root, 'starqNexus/data/hoadha-tasks.json'),
        JSON.stringify({ tasks: [] }),
      );
      expect(buildBuilding(root, base).hoadha.boards[0].state).toBe('DRIFT');
    }));
  it('missing or malformed boards stay unavailable rather than healthy empty', () =>
    withRoot((root) => {
      fs.unlinkSync(path.join(root, 'starqNexus/data/hoadha-tasks.json'));
      expect(buildBuilding(root, base).hoadha.live_count).toBeNull();
      fs.writeFileSync(path.join(root, 'starqNexus/data/hoadha-tasks.json'), '{');
      expect(buildBuilding(root, base).hoadha.boards[0].state).toBe('UNREADABLE');
    }));
  it('renders both real rooms and company identity with hold/prepared distinctions', () =>
    withRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = renderToStaticMarkup(
        <BuildingSurface route={parseBuildingRoute('#overview')} surface={surface} />,
      );
      expect(html).toContain('Starq Technologies');
      expect(html).toContain('#studio/erp/overview');
      expect(html).toContain('#studio/hoadha/overview');
      expect(html).toContain('ON_HOLD');
      const room = renderToStaticMarkup(
        <BuildingSurface route={parseBuildingRoute('#studio/hoadha/overview')} surface={surface} />,
      );
      expect(room).toContain('PREPARED / NOT STARTED');
      expect(room).toContain('326');
      expect(room).toContain('33');
      for (const tab of ['loops', 'board', 'waves', 'stages', 'evidence', 'staff', 'integrity'])
        expect(
          renderToStaticMarkup(
            <BuildingSurface
              route={parseBuildingRoute(`#studio/hoadha/${tab}`)}
              surface={surface}
            />,
          ),
        ).toBeTruthy();
    }));
  it('rejects a malformed roadmap instead of inventing six healthy loops', () => withRoot(root => {
    fs.writeFileSync(path.join(root, HOADHA_ROOT, 'roadmap.machine.json'), JSON.stringify({loops: [null]}));
    const b = buildBuilding(root, base);
    expect(b.hoadha.loops).toEqual([]);
    expect(b.hoadha.integrity).toBe('DRIFT');
    expect(b.projects.find(p => p.id === 'hoadha')?.classification).toBe('UNAVAILABLE');
  }));
  it('ERP state comes from the source even when absent or changed', () => withRoot(root => {
    const unknown = buildBuilding(root, {...base, process_truth: {}} as CommandSurface);
    expect(unknown.projects.find(p => p.id === 'erp')?.state).toBe('UNKNOWN');
    const held = buildBuilding(root, {...base, process_truth: {hold_state: {implementation:'STALE'}}} as CommandSurface);
    expect(held.projects.find(p => p.id === 'erp')?.state).toBe('STALE');
  }));
  it('round trips all room tabs and preserves old ERP deep links', () => {
    for (const hash of ['#studio/hoadha/board', '#studio/erp/process', '#studio/capacity'])
      expect(parseBuildingRoute(routeHash(parseBuildingRoute(hash)))).toEqual(
        parseBuildingRoute(hash),
      );
    expect(parseBuildingRoute('#process')).toEqual({ view: 'studio', room: 'erp', tab: 'Process' });
    expect(parseBuildingRoute('#studio/hoadha/decisions').tab).toBe('Overview');
  });
});
