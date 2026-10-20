import { describe, expect, it } from 'vitest';
import type { WorkPackageRow, WorkPackagesEndpointSignature } from '@/lib/contracts';

const normalizedRows = [
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
    verifier: null,
    board_lane: null,
    source: { kind: 'GENERAL_ASSIGNMENT', reference: 'activity/assignment-record.json' },
  },
] satisfies WorkPackageRow[];

const proposedEndpoint: WorkPackagesEndpointSignature = {
  method: 'GET',
  path: '/api/work-packages',
  query: { project_id: 'erp' },
  response: normalizedRows,
};

describe('CMD-DI-3-2a · Design Integration Work-package contract', () => {
  it('requires the normalized fields and retains source kind/reference', () => {
    expect(normalizedRows.map((row) => row.source.kind)).toEqual([
      'ERP_TASK',
      'HOADHA_ITEM',
      'GENERAL_ASSIGNMENT',
    ]);
    expect(normalizedRows.every((row) => row.source.reference.length > 0)).toBe(true);
  });

  it('describes a GET signature only, with an explicit optional project filter', () => {
    expect(proposedEndpoint).toMatchObject({
      method: 'GET',
      path: '/api/work-packages',
      query: { project_id: 'erp' },
    });
    expect(proposedEndpoint.response).toBe(normalizedRows);
  });
});
