import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import path from 'node:path';
import { resolveWorkspace } from '../server/paths.mjs';
import { buildBuilding, BUILDING_SOURCES } from '../server/building.mjs';
import { BuildingSurface } from '@/surfaces/building';
import { ProjectBoard } from '@/surfaces/project-board';
import { parseBuildingRoute } from '@/lib/building-route';
import fixture from './fixtures/phase5-surface.json';
import type { CommandSurface } from '@/lib/contracts';

/**
 * Phase 7 — BOTH real Dev Studio project rooms, rendered from the REAL payload.
 *
 * This is the acceptance-shaped test for Room seq 8358:
 *
 *   "The final visible Phase 7 state must instantiate both real Dev Studio
 *    project rooms: starqERP, Hoadha."
 *
 * It reads the actual canonical workspace rather than a fixture, so it fails if
 * the Hoadha room is only structurally present but not actually projectable —
 * which is exactly the gap Goose (#7) and OpenCode (F2) both reported.
 *
 * ERP truth still comes from the frozen Phase 5 fixture surface, because that is
 * the accepted contract; Hoadha comes from the separate Building projection.
 * The two are attached, never merged.
 */

const root = resolveWorkspace().root;
const erpSurface = fixture as unknown as CommandSurface;
const building = buildBuilding(root, erpSurface);
const surface: CommandSurface = { ...erpSurface, building };

const render = (hash: string) =>
  renderToStaticMarkup(
    React.createElement(BuildingSurface, { route: parseBuildingRoute(hash), surface }),
  );

describe('Phase 7 — both real project rooms instantiate (Room seq 8358)', () => {
  it('the Building origin actually projects the real Hoadha sources', () => {
    // If this fails, the Hoadha room is a shell with nothing behind it.
    expect(BUILDING_SOURCES.length).toBeGreaterThan(0);
    expect(building.hoadha.integrity).toMatch(/SOURCE_READ|DRIFT/);
    expect(building.hoadha.live_count).toBe(326);
    expect(building.hoadha.proposed_count).toBe(33);
    // Every board reconciles to its declared count, or says DRIFT honestly.
    for (const b of building.hoadha.boards) {
      expect(['MATCH', 'DRIFT', 'UNREADABLE', 'UNAVAILABLE']).toContain(b.state);
    }
  });

  it('the ERP room renders its source-derived ON_HOLD state', () => {
    const html = render('#studio/erp/overview');
    expect(html).toMatch(/starqERP/);
    expect(html).toMatch(/ON_HOLD/);
  });

  it('the Hoadha room renders and is reachable by route', () => {
    const html = render('#studio/hoadha/overview');
    expect(html).toMatch(/Hoadha/);
    // PREPARED / NOT STARTED — never a fabricated activation.
    expect(html).toMatch(/NOT STARTED|PREPARED/);
  });

  it('both rooms carry every declared Hoadha tab', () => {
    for (const tab of ['loops', 'board', 'waves', 'stages', 'evidence', 'staff', 'integrity']) {
      const html = render(`#studio/hoadha/${tab}`);
      expect(html.length, `hoadha/${tab} rendered empty`).toBeGreaterThan(200);
    }
  });

  it('the PM board route stays distinct from the Building historical corpus', () => {
    const html = render('#studio/hoadha/board');
    expect(html).toContain('data-pm-route="hoadha"');
    expect(html).toContain('Reading the board…');
    const historical = renderToStaticMarkup(
      React.createElement(ProjectBoard, {
        building,
        projectId: 'hoadha',
        label: 'Historical task records',
        projectLabel: 'Hoadha',
      }),
    );
    expect(historical).toContain('HISTORICAL_SNAPSHOT');
    expect(historical).toMatch(/DHIV-/);
    expect(building.hoadha.live_count).toBe(326);
    expect(building.hoadha.proposed_count).toBe(33);
    expect(historical).not.toMatch(/100%\s*complete/i);
  });

  it('the Hoadha room never claims execution or production readiness', () => {
    const html = render('#studio/hoadha/overview');
    expect(html).not.toMatch(/\bH0 activated\b/i);
    expect(html).not.toMatch(/production ready/i);
  });

  it('unknown hashes resolve to a real view instead of silently ignoring', () => {
    // OpenCode F3: an unrecognised hash used to leave the previous view
    // rendered with nothing indicating the link was not honoured.
    const route = parseBuildingRoute('#not-a-real-view');
    expect(route.view).toBe('home');
    expect(route.room).toBeNull();
  });
});
