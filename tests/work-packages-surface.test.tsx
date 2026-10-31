import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CommandSurface, WorkPackageRow } from '@/lib/contracts';
import { parseBuildingRoute, routeHash, EVIDENCE_TABS, STUDIO_TABS } from '@/lib/building-route';
import { BuildingSurface } from '@/surfaces/building';
import {
  filterWorkPackageRows,
  WorkPackagesSurface,
  workPackageStagePresentation,
} from '@/surfaces/work-packages';

const rows = [
  {
    id: 'erp-123',
    project_id: 'erp',
    title: 'ERP task title from source',
    current_stage: 'BLOCKED',
    owner: null,
    verifier: null,
    board_lane: null,
    source: { kind: 'ERP_TASK', reference: 'starqNexus/data/starq-erp-tasks.json' },
  },
  {
    id: 'hoadha-456',
    project_id: 'hoadha',
    title: 'Live Hoadha item title',
    current_stage: 'H2',
    owner: 'declared-owner',
    verifier: null,
    board_lane: 'UNKNOWN',
    source: { kind: 'HOADHA_ITEM', reference: '03_PROJECTS/hoadha/board-source.json' },
  },
  {
    id: 'assignment-789',
    project_id: 'mercury',
    title: 'Source assignment text',
    current_stage: null,
    owner: 'declared-owner',
    verifier: 'vision',
    board_lane: null,
    source: { kind: 'GENERAL_ASSIGNMENT', reference: 'activity/assignment-record.json' },
  },
  {
    id: 'declared-unknown-stage',
    project_id: 'erp',
    title: 'Declared unknown stage token',
    current_stage: 'UNKNOWN',
    owner: null,
    verifier: null,
    board_lane: 'REVIEW',
    source: { kind: 'GENERAL_ASSIGNMENT', reference: 'activity/declared-unknown.json' },
  },
] satisfies WorkPackageRow[];

function surfaceSource(): string {
  return readFileSync(path.join(process.cwd(), 'src', 'surfaces', 'work-packages.tsx'), 'utf8');
}

describe('CMD-DI-3-2b · Work-package surface', () => {
  it('copies a declared stage and renders a missing stage as UNKNOWN', () => {
    expect(workPackageStagePresentation('BLOCKED')).toEqual({ label: 'BLOCKED', origin: 'declared' });
    expect(workPackageStagePresentation('H2')).toEqual({ label: 'H2', origin: 'declared' });
    expect(workPackageStagePresentation('UNKNOWN')).toEqual({ label: 'UNKNOWN', origin: 'declared' });
    expect(workPackageStagePresentation('UNAVAILABLE')).toEqual({ label: 'UNAVAILABLE', origin: 'declared' });
    expect(workPackageStagePresentation(null)).toEqual({ label: 'UNKNOWN', origin: 'absent' });
    expect(workPackageStagePresentation('')).toEqual({ label: 'UNKNOWN', origin: 'absent' });
    expect(workPackageStagePresentation(' blocked ')).toEqual({ label: ' blocked ', origin: 'declared' });

    const html = renderToStaticMarkup(<WorkPackagesSurface rows={rows} />);
    expect(html).toContain('BLOCKED');
    expect(html).toContain('data-stage-origin="declared">H2</span>');
    expect(html).toContain('data-stage-origin="absent"');
    expect(html).toContain('data-stage-origin="declared"');
    expect(html).toContain('UNKNOWN');
    expect(html).not.toContain('UNAVAILABLE');
    expect(html).not.toContain('>blocked<');
  });

  it('marks missing owner, verifier, and lane unsupported and keeps declared values', () => {
    const html = renderToStaticMarkup(<WorkPackagesSurface rows={rows} />);
    expect(html).toContain('data-contract-field="owner" data-support="unsupported"');
    expect(html).toContain('data-contract-field="owner" data-support="declared"');
    expect(html).toContain('declared-owner');
    expect(html).toContain('data-contract-field="verifier" data-support="declared"');
    expect(html).toContain('vision');
    expect(html).toContain('data-contract-field="board_lane" data-support="declared"');
    expect(html).toContain('REVIEW');
    expect(html).toContain('data-contract-field="source.kind"');
    expect(html).toContain('ERP_TASK');
    expect(html).toContain('HOADHA_ITEM');
    expect(html).toContain('GENERAL_ASSIGNMENT');
    expect(html).toContain('starqNexus/data/starq-erp-tasks.json');
  });

  it('filters only by exact project id and displayed stage', () => {
    expect(filterWorkPackageRows(rows, { project_id: 'erp', stage: null }).map((row) => row.id)).toEqual([
      'erp-123',
      'declared-unknown-stage',
    ]);
    expect(filterWorkPackageRows(rows, { project_id: 'ERP', stage: null })).toEqual([]);
    expect(filterWorkPackageRows(rows, { project_id: null, stage: 'BLOCKED' }).map((row) => row.id)).toEqual([
      'erp-123',
    ]);
    expect(filterWorkPackageRows(rows, { project_id: null, stage: 'blocked' })).toEqual([]);
    expect(filterWorkPackageRows(rows, { project_id: null, stage: 'UNKNOWN' }).map((row) => row.id)).toEqual([
      'assignment-789',
      'declared-unknown-stage',
    ]);
    expect(filterWorkPackageRows(rows, { project_id: 'hoadha', stage: 'UNKNOWN' })).toEqual([]);
    expect(filterWorkPackageRows(rows, { project_id: null, stage: null }).map((row) => row.id)).toEqual(
      rows.map((row) => row.id),
    );

    const html = renderToStaticMarkup(<WorkPackagesSurface rows={rows} />);
    expect(html).toContain('aria-label="Project filter"');
    expect(html).toContain('aria-label="Stage filter"');
    expect(html).toContain('value="project:erp"');
    expect(html).toContain('value="project:hoadha"');
    expect(html).toContain('value="project:mercury"');
    expect(html).toContain('value="stage:BLOCKED"');
    expect(html).toContain('value="stage:H2"');
    expect(html).toContain('value="stage:UNKNOWN"');
    expect(html).not.toContain('aria-label="Owner filter"');
    expect(html).not.toContain('aria-label="Lane filter"');
    expect(html).not.toContain('aria-label="Search');
    expect(html.match(/<select/g)).toHaveLength(2);
  });

  it('keeps a missing list UNKNOWN and a supplied empty list empty', () => {
    const unknown = renderToStaticMarkup(<WorkPackagesSurface rows={null} />);
    expect(unknown).toContain('data-availability="UNKNOWN"');
    expect(unknown).toContain('UNKNOWN');
    expect(unknown).toContain('An empty list is not assumed');
    expect(unknown).not.toContain('UNAVAILABLE');
    expect(unknown).not.toContain('Verified empty');
    expect(unknown).not.toContain('<select');
    expect(unknown).not.toContain('erp-123');

    const empty = renderToStaticMarkup(<WorkPackagesSurface rows={[]} />);
    expect(empty).toContain('data-availability="empty"');
    expect(empty).toContain('Verified empty');
    expect(empty).not.toContain('data-availability="UNKNOWN"');
    expect(empty).not.toContain('UNAVAILABLE');
    expect(empty).toContain('0 / 0');
  });

  it('renders a declared UNAVAILABLE stage token without using it as list availability', () => {
    const declared: WorkPackageRow = {
      ...rows[0],
      id: 'declared-unavailable',
      current_stage: 'UNAVAILABLE',
    };
    const html = renderToStaticMarkup(<WorkPackagesSurface rows={[declared]} />);
    expect(html).toContain('data-stage-origin="declared"');
    expect(html).toContain('UNAVAILABLE');
    expect(html).not.toContain('data-availability="UNKNOWN"');
    expect(html).not.toContain('data-availability="empty"');
    expect(html).toContain('1 / 1');
  });

  it('has no write path and does not call a work-package endpoint', () => {
    const html = renderToStaticMarkup(<WorkPackagesSurface rows={rows} />);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/<button/i);
    expect(html).not.toMatch(/method="post"/i);
    expect(html).not.toMatch(/contenteditable/i);

    const src = surfaceSource();
    expect(src).not.toMatch(/fetch\s*\(/);
    expect(src).not.toMatch(/useEffect/);
    expect(src).not.toMatch(/XMLHttpRequest|sendBeacon|EventSource|WebSocket/);
    expect(src).not.toMatch(/method\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    expect(src).not.toContain('/api/work-packages');
    expect(src).not.toContain('EvidenceRoomsPeer');
    expect(src).not.toContain('localStorage');
    expect(src).not.toMatch(/\.sort\s*\(/);
    expect(src).not.toContain('UNAVAILABLE');
  });
});

describe('CMD-DI-3-2b · Work stays off Evidence → Rooms', () => {
  it('routes #work to the Work surface and leaves Rooms on the Evidence peer', () => {
    expect(parseBuildingRoute('#work')).toEqual({ view: 'work', room: null, tab: 'Overview' });
    expect(routeHash(parseBuildingRoute('#work'))).toBe('#work');
    expect(parseBuildingRoute('#work/rooms')).toEqual({ view: 'work', room: null, tab: 'Overview' });
    expect(parseBuildingRoute('#evidence/rooms')).toEqual({ view: 'evidence', room: null, tab: 'Rooms' });
    expect(parseBuildingRoute('#evidence/work')).toEqual({ view: 'evidence', room: null, tab: 'Sources' });
    expect(parseBuildingRoute('#studio/work').projectId).toBe('work');
    expect(parseBuildingRoute('#not-a-real-view').view).toBe('home');
    expect(STUDIO_TABS).toEqual(['Overview', 'Staff', 'Projects', 'Capacity', 'Activity', 'Herdr']);
    expect(EVIDENCE_TABS).toEqual(['Sources', 'Projection', 'Decisions', 'Rooms', 'Hashes']);
    expect(existsSync(path.join(process.cwd(), 'src', 'surfaces', 'room.tsx'))).toBe(false);
  });

  it('renders #work as UNKNOWN availability and does not enter the Rooms peer', () => {
    const html = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#work')} surface={{} as CommandSurface} />,
    );
    expect(html).toContain('data-surface="work-packages"');
    expect(html).toContain('data-availability="UNKNOWN"');
    expect(html).not.toContain('Building projection unavailable');
    expect(html).not.toContain('Conversation record');
    expect(html).not.toContain('EvidenceRoomsPeer');

    const roomsRoute = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#work/rooms')} surface={{} as CommandSurface} />,
    );
    expect(roomsRoute).toContain('data-surface="work-packages"');
    expect(roomsRoute).not.toContain('Conversation record');
  });

  it('does not place Work inside EvidenceRoomsPeer', () => {
    const src = readFileSync(path.join(process.cwd(), 'src', 'surfaces', 'building.tsx'), 'utf8');
    const start = src.indexOf('function EvidenceRoomsPeer');
    const end = src.indexOf('\nfunction ', start + 1);
    const peer = src.slice(start, end);
    expect(peer.length).toBeGreaterThan(0);
    expect(peer).not.toContain('WorkPackage');
    expect(peer).not.toContain('work-packages');
    expect(peer).not.toContain('WorkPackagesSurface');
    expect(src).toContain("if (route.view === 'work')");
    expect(src).toContain('<WorkPackagesRoute />');
    expect(src).toContain("if (tab === 'Rooms') {");
    expect(src).toContain('<EvidenceRoomsPeer building={building} surface={surface} />');
  });
});
