import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BuildingRecord } from '@/lib/contracts';
import type { BuildingProjection, CommandSurface } from '@/lib/contracts';
import { parseBuildingRoute, projectIdFromRoute } from '@/lib/building-route';
import { BuildingSurface } from '@/surfaces/building';
import {
  filterProjectBoardRecords,
  mapTaskToProjectLane,
  ProjectBoard,
  ProjectTaskDetails,
  resolveProjectBoardRecords,
} from '@/surfaces/project-board';

const records: BuildingRecord[] = [
  { id: 'SERP-1', title: 'Explicit ready task', status: 'ready', collection: 'starqERP', source: 'starqNexus/data/starq-erp-tasks.json', owner: 'claude' },
  { id: 'SERP-2', title: 'Blocked task', status: 'blocked', collection: 'starqERP', source: 'starqNexus/data/starq-erp-tasks.json', blocked_reason: 'Waiting for evidence' },
  { id: 'SERP-3', title: 'Unknown state task', status: 'needs-triage', collection: 'starqERP', source: 'starqNexus/data/starq-erp-tasks.json' },
  { id: 'HCD-1', title: 'Review task', status: 'in_review', collection: 'hoadha-social', source: 'starqNexus/data/hoadha-social-tasks.json' },
];

describe('read-only project board', () => {
  it('maps recognized source statuses and leaves unknown states unmapped', () => {
    expect(records.map(mapTaskToProjectLane)).toEqual(['READY', 'BLOCKED', 'UNKNOWN', 'REVIEW']);
    expect(mapTaskToProjectLane({ ...records[0], status: 'future-state' })).toBe('UNKNOWN');
    expect(mapTaskToProjectLane({ ...records[0], status: 'blocked', requires_founder: true })).toBe('BLOCKED');
    expect(mapTaskToProjectLane({ ...records[0], status: 'ready', blocked: true })).toBe('READY');
    expect(mapTaskToProjectLane({ ...records[0], status: 'founder_gate' })).toBe('FOUNDER GATE');
    expect(mapTaskToProjectLane({ ...records[0], status: 'UNAVAILABLE_UNTIL_RESET' })).toBe('UNKNOWN');
    expect(mapTaskToProjectLane({ ...records[0], status: 'today' })).toBe('TODAY');
    expect(mapTaskToProjectLane({ ...records[0], status: 'in_progress' })).toBe('IN PROGRESS');
    expect(mapTaskToProjectLane({ ...records[0], status: 'done' })).toBe('DONE');
  });

  it('filters by source collection, lane, exact source status and search text', () => {
    expect(filterProjectBoardRecords(records, { project: 'starqERP' }).map((r) => r.id)).toEqual(['SERP-1', 'SERP-2', 'SERP-3']);
    expect(filterProjectBoardRecords(records, { lane: 'UNKNOWN' }).map((r) => r.id)).toEqual(['SERP-3']);
    expect(filterProjectBoardRecords(records, { status: 'in_review' }).map((r) => r.id)).toEqual(['HCD-1']);
    expect(filterProjectBoardRecords(records, { query: 'Waiting for evidence' }).map((r) => r.id)).toEqual(['SERP-2']);
    expect(filterProjectBoardRecords(records, { query: 'SERP-2' }).map((r) => r.id)).toEqual(['SERP-2']);
  });

  it('renders accessible controls, all lanes and source status without write affordances', () => {
    const html = renderToStaticMarkup(<ProjectBoard records={records} label="Task records" projectLabel="starqERP" />);
    expect(html).toContain('aria-label="Project filter"');
    expect(html).toContain('aria-label="Lane filter"');
    expect(html).toContain('aria-label="Source status filter"');
    expect(html).toContain('aria-label="Search project tasks"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('UNKNOWN');
    expect(html).toContain('4 / 4');
    expect(html).toContain('source: needs-triage');
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('md:grid-cols-2');
    expect(html).not.toContain('draggable=');
    expect(html).not.toContain('method="post"');
  });

  it('shows declared task details and projection provenance', () => {
    const html = renderToStaticMarkup(<ProjectTaskDetails record={records[0]} />);
    expect(html).toContain('Canonical source status');
    expect(html).toContain('Declared project id');
    expect(html).toContain('ready');
    expect(html).toContain('claude');
    expect(html).toContain('starqERP');
    expect(html).toContain('starqNexus/data/starq-erp-tasks.json');
    const blocked = renderToStaticMarkup(<ProjectTaskDetails record={records[1]} />);
    expect(blocked).toContain('Waiting for evidence');
  });

  it('preserves unavailable and empty source distinctions', () => {
    const unavailable = renderToStaticMarkup(<ProjectBoard records={null} label="ERP board" projectLabel="starqERP" />);
    expect(unavailable).toContain('ERP board unavailable.');
    expect(unavailable).toContain('No fallback or historical task data is shown.');
    const empty = renderToStaticMarkup(<ProjectBoard records={[]} label="ERP board" projectLabel="starqERP" />);
    expect(empty).toContain('Source read, zero task records.');
  });
});

describe('CMD-DI-2-2 project id from the route and the building projection', () => {
  const commerce = {
    id: 'COM-1',
    title: 'Commerce task',
    status: 'needs-triage',
    project_id: 'commerce',
    collection: 'commerce-ledger',
    source: 'building/commerce-tasks.json',
  };
  const building = {
    projects: [
      { id: 'erp', name: 'starqERP', classification: 'OCCUPIED', state: 'HOLD', source: 'contract.json' },
      { id: 'hoadha', name: 'Hoadha', classification: 'PREPARED', state: 'NOT STARTED', source: 'roadmap.json' },
      { id: 'ai', name: 'starqAI', classification: 'FRAMEWORK_ONLY', state: 'NO OPERATIONAL SOURCE', source: 'plan.md' },
      { id: 'commerce', name: 'Commerce', classification: 'OCCUPIED', state: 'UNKNOWN', source: 'commerce-tasks.json' },
    ],
    erp_tasks: [
      { id: 'SERP-9', title: 'ERP task', status: 'todo', collection: 'starqERP', source: 'starq-erp-tasks.json' },
      commerce,
    ],
    hoadha: {
      boards: [
        {
          project: 'hoadha',
          source: 'hoadha-tasks.json',
          state: 'MATCH',
          count: 1,
          expected: 1,
          records: [{ id: 'H-1', title: 'Live hoadha', status: 'todo', collection: 'hoadha', source: 'hoadha-tasks.json' }],
        },
        {
          project: 'hoadha-social',
          source: 'hoadha-social-tasks.json',
          state: 'MATCH',
          count: 1,
          expected: 1,
          records: [
            { id: 'HS-1', title: 'Social', status: 'in_review', project_id: 'hoadha-social', collection: 'hoadha-social', source: 'hoadha-social-tasks.json' },
            { id: 'H-LEAK', title: 'Hoadha record on the social board', status: 'todo', project_id: 'hoadha', collection: 'hoadha', source: 'hoadha-social-tasks.json' },
          ],
        },
        {
          project: 'mercury',
          source: 'mercury-tasks.json',
          state: 'MATCH',
          count: 3,
          expected: 3,
          records: [
            { id: 'MRC-1', title: 'Mercury task', status: 'ready', project_id: 'mercury', collection: 'mercury', source: 'mercury-tasks.json' },
            { id: 'H-ON-MERCURY', title: 'Hoadha record stored on the Mercury board', status: 'todo', project_id: 'hoadha', collection: 'hoadha', source: 'mercury-tasks.json' },
            { id: 'H-BARE', title: 'Board name is not a project id', status: 'todo', project: 'mercury', collection: 'hoadha', source: 'mercury-tasks.json' },
          ],
        },
      ],
      proposed: [{ id: 'HCD-9', title: 'Proposed only', status: 'proposed', collection: 'PROPOSED', source: 'TASK_RECONCILIATION.md' }],
      proposed_count: 1,
      live_count: 2,
      execution: 'NOT STARTED',
      execution_basis: 'prepared',
      integrity: 'SOURCE_READ',
      production: 'UNKNOWN / UNVERIFIED',
      integration: 'UNAVAILABLE / UNVERIFIED',
      current_wave: 'H0',
      blockers: [],
      loops: [],
      waves: [],
      stages: [],
      evidence: [],
    },
    capacity: { state: 'UNKNOWN', reason: 'none' },
    sources: [],
  } as unknown as BuildingProjection;

  it('reads any studio project segment and an explicit project_id query', () => {
    expect(projectIdFromRoute('#studio/erp/tasks')).toBe('erp');
    expect(projectIdFromRoute('#studio/hoadha/board')).toBe('hoadha');
    expect(projectIdFromRoute('#studio/commerce/board')).toBe('commerce');
    expect(projectIdFromRoute('#studio/projects')).toBeNull();
    expect(projectIdFromRoute('#studio/projects/board')).toBeNull();
    expect(projectIdFromRoute('#studio/projects/board/extra')).toBeNull();
    expect(projectIdFromRoute('#studio/staff')).toBeNull();
    expect(projectIdFromRoute('#studio/overview/board')).toBeNull();
    expect(projectIdFromRoute('#studio/commerce/board?project_id=projects')).toBe('commerce');
    expect(projectIdFromRoute('#studio/erp/tasks?project_id=commerce')).toBe('commerce');
  });

  it('keeps ERP and Hoadha slots and does not treat proposed as live', () => {
    const erp = resolveProjectBoardRecords(building, 'erp');
    expect(erp.records?.map((record) => record.id)).toEqual(['SERP-9', 'COM-1']);
    expect(erp.reason).toBeNull();
    const hoadha = resolveProjectBoardRecords(building, 'hoadha');
    expect(hoadha.records?.map((record) => record.id)).toEqual(['H-1', 'HS-1', 'H-LEAK', 'MRC-1', 'H-ON-MERCURY', 'H-BARE']);
    expect(hoadha.records?.map((record) => record.id)).not.toContain('HCD-9');
    const social = resolveProjectBoardRecords(building, 'hoadha-social');
    expect(social.records?.map((record) => record.id)).toEqual(['HS-1']);
    expect(social.records?.map((record) => record.id)).not.toContain('H-LEAK');
  });

  it('renders a non-room project from declared project_id and leaves its status in UNKNOWN', () => {
    const html = renderToStaticMarkup(
      <ProjectBoard building={building} projectId="commerce" label="Commerce board" projectLabel="Commerce" />,
    );
    expect(html).toContain('COM-1');
    expect(html).toContain('source: needs-triage');
    expect(html).toContain('>UNKNOWN<');
    expect(html).not.toContain('SERP-9');
    expect(html).not.toContain('HCD-9');
    expect(html).toContain('1 / 1');
    const flagged = renderToStaticMarkup(
      <ProjectTaskDetails record={{ ...records[1], requires_founder: true }} />,
    );
    expect(flagged).toContain('Founder gate flag');
    expect(flagged).toContain('lane follows canonical status');
  });

  it('does not invent task records for a declared project or an unknown project id', () => {
    const ai = renderToStaticMarkup(
      <ProjectBoard building={building} projectId="ai" label="AI board" projectLabel="starqAI" />,
    );
    expect(ai).toContain('starqAI is declared and has no task records');
    expect(ai).toContain('None were inferred.');
    expect(ai).not.toContain('Source read, zero task records.');
    const missing = renderToStaticMarkup(
      <ProjectBoard building={building} projectId="no-such-project" label="Missing" projectLabel="Missing" />,
    );
    expect(missing).toContain('Project no-such-project is not in the building projection.');
    expect(missing).not.toContain('Source read, zero task records.');
  });

  it('renders the studio route and query on the board, and does not treat projects/board as a project', () => {
    const surface = { building: { ...building, sources: [] } } as unknown as CommandSurface;
    const mercury = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#studio/mercury/board')} surface={surface} />,
    );
    expect(parseBuildingRoute('#studio/mercury/board').projectId).toBe('mercury');
    // Studio boards now use PM as the active task authority. Building's
    // historical projection remains covered by resolveProjectBoardRecords
    // above; it is not silently substituted for the writable PM board.
    expect(mercury).toContain('data-pm-route="mercury"');
    expect(mercury).toContain('Reading the board…');
    expect(mercury).not.toContain('H-ON-MERCURY');
    expect(mercury).not.toContain('H-BARE');
    expect(mercury).not.toContain('H-1');

    const fromQuery = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#studio/projects?project_id=mercury')} surface={surface} />,
    );
    expect(fromQuery).toContain('data-pm-route="mercury"');
    expect(fromQuery).toContain('Reading the board…');
    expect(fromQuery).not.toContain('H-ON-MERCURY');

    expect(parseBuildingRoute('#studio/projects/board')).toEqual({
      view: 'studio',
      room: null,
      tab: 'Projects',
    });
    const projectsTab = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#studio/projects/board')} surface={surface} />,
    );
    expect(projectsTab).not.toContain('data-project-id="projects"');
    expect(projectsTab).not.toContain('MRC-1');
    expect(projectsTab).toContain('data-pm="portfolio"');
    expect(projectsTab).toContain('Project boards');
    expect(projectsTab).toContain('Source records &amp; history');
  });

  it('keeps the ERP and Hoadha room routes on their existing boards', () => {
    expect(parseBuildingRoute('#studio/erp/tasks')).toEqual({
      view: 'studio',
      room: 'erp',
      tab: 'Tasks',
    });
    expect(parseBuildingRoute('#studio/hoadha/board')).toEqual({
      view: 'studio',
      room: 'hoadha',
      tab: 'Board',
    });
    const surface = { building: { ...building, sources: [] } } as unknown as CommandSurface;
    const erp = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#studio/erp/tasks')} surface={surface} />,
    );
    expect(erp).toContain('data-pm-route="erp"');
    expect(erp).toContain('Reading the board…');
    expect(erp).not.toContain('data-project-id="mercury"');
    const hoadha = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#studio/hoadha/board')} surface={surface} />,
    );
    expect(hoadha).toContain('data-pm-route="hoadha"');
    expect(hoadha).toContain('Reading the board…');
    expect(hoadha).not.toContain('data-project-id="mercury"');
  });

  it('keeps a proposed Mercury record off the live Mercury board', () => {
    const withProposed = {
      ...building,
      hoadha: {
        ...building.hoadha,
        proposed: [
          ...(building.hoadha?.proposed ?? []),
          {
            id: 'MRC-PROPOSED',
            title: 'Proposed mercury',
            status: 'proposed',
            project_id: 'mercury',
            collection: 'PROPOSED',
            source: 'TASK_RECONCILIATION.md',
          },
        ],
      },
    } as unknown as BuildingProjection;
    const live = resolveProjectBoardRecords(withProposed, 'mercury');
    expect(live.records?.map((record) => record.id)).toEqual(['MRC-1']);
    const html = renderToStaticMarkup(
      <ProjectBoard building={withProposed} projectId="mercury" label="Mercury board" projectLabel="Mercury" />,
    );
    expect(html).toContain('MRC-1');
    expect(html).not.toContain('MRC-PROPOSED');
  });

  it('falls back to the hash project when the query project_id is a reserved Studio token', () => {
    const route = '#studio/mercury/board?project_id=projects';
    expect(projectIdFromRoute(route)).toBe('mercury');
    expect(parseBuildingRoute(route)).toEqual({
      view: 'studio',
      room: null,
      tab: 'Overview',
      projectId: 'mercury',
    });
    const surface = { building: { ...building, sources: [] } } as unknown as CommandSurface;
    const html = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute(route)} surface={surface} />,
    );
    expect(html).toContain('data-pm-route="mercury"');
    expect(html).toContain('Reading the board…');
    expect(html).not.toContain('data-pm-route="projects"');
    expect(html).not.toContain('Project-room mapping');
    expect(html).not.toContain('Project id unavailable');
  });
});
