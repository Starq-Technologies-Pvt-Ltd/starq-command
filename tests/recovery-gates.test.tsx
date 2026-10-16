import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanyOverview, ExecutiveOverview } from '@/surfaces/company';
import { parseBuildingRoute, routeHash } from '@/lib/building-route';
import type { BuildingProjection, CommandSurface } from '@/lib/contracts';
import fs from 'node:fs';
import path from 'node:path';

const building = {
  company: 'Starq Technologies',
  floor: 'Dev Studio',
  projects: [
    { id: 'erp', name: 'starqERP', state: 'ON_HOLD', classification: 'OCCUPIED', source: 'contract.json' },
    { id: 'hoadha', name: 'Hoadha', state: 'NOT STARTED', classification: 'PREPARED', source: 'roadmap.machine.json' },
  ],
  capacity: { state: 'UNKNOWN', reason: 'No canonical quota projection.' },
  sources: [{ source: 'contract.json', state: 'AVAILABLE' }],
  hoadha: {
    execution: 'NOT STARTED',
    classification: 'PREPARED',
    current_wave: 'H0',
    live_count: 326,
    proposed_count: 33,
    integrity: 'SOURCE_READ',
    blockers: [],
  },
} as unknown as BuildingProjection;

const surface = {
  building,
  workspace: { root: 'D:\\StarqTech', source: 'STARQ_WORKSPACE' },
  assembled_at: '2026-10-01T00:00:00Z',
  health: { overall: 'STALE', conditions: [], counts: { ok: 3, total: 4 } },
  process_truth: { process_families: [], hold_state: { implementation: 'ON_HOLD' } },
  execution_truth: { activity_events: [] },
} as unknown as CommandSurface;

describe('Phase 7 recovery gates', () => {
  it('keeps Overview and Building on different semantic bodies', () => {
    const overview = renderToStaticMarkup(<ExecutiveOverview surface={surface} />);
    const buildingBody = renderToStaticMarkup(<CompanyOverview building={building} />);

    expect(overview).toContain('data-surface-signature="company-executive-overview"');
    expect(buildingBody).toContain('data-surface-signature="building-topology"');

    /*
      RE-AIMED IN THE STRUCTURAL WAVE (Room seq 8395).

      This previously pinned the literal heading "Recent meaningful activity" on
      Overview. Two things changed, and both are corrections rather than
      relaxations:

        · The panel is now "Recent activity" plus a short executive headline
          band. Gap map WF-OV-01 recorded that Overview gave no item identified
          as the most material current concern, which is why a headline band
          exists; and the word "meaningful" was the gap map's complaint about
          presenting raw event presence as operating significance, so the heading
          no longer claims more than it delivers.
        · Building no longer repeats the operating-state stat rail at all
          (gap map WF-BLD-02), so asserting its absence here is now stronger
          than it was: previously Building could have carried an activity feed
          and still passed.

      The CLAIM — the two surfaces perform different jobs — is unchanged and is
      now asserted through the structural signatures, the topology body, the
      executive headline, and the mutual absence in both directions.
    */
    expect(overview, 'Overview owns the executive headline').toContain('data-executive-headline');
    expect(overview, 'Overview reports recent activity').toMatch(/Recent activity/i);
    expect(overview, 'Overview carries room state cards').toContain('Room state');
    expect(overview, 'Overview carries the declared attention work pane').toContain('Needs attention');

    expect(buildingBody, 'Building owns the organization tree').toContain('Organization tree');
    expect(buildingBody, 'Building owns topology, not activity').not.toMatch(/Recent activity/i);
    expect(buildingBody, 'Building does not re-render the executive headline').not.toContain(
      'data-executive-headline',
    );
    // WF-BLD-02: Building's rail is structural only. Operating-state metrics
    // belong to Overview, and their return here is the wrong-owner duplication
    // the gap map named.
    expect(buildingBody).not.toContain('Needs attention');
    expect(buildingBody).toContain('Declared floors');
    expect(buildingBody).not.toContain('starqERP</span><span'); // node metadata, not a stat rail
  });

  it('round-trips global peer destinations', () => {
    for (const hash of ['#attention/decisions', '#evidence/hashes', '#system/runtime']) {
      const route = parseBuildingRoute(hash);
      expect(routeHash(route)).toBe(hash);
    }
  });

  it('requires every census row to have an allowed disposition and destination', () => {
    const censusPath = path.resolve(process.cwd(), '../../../STARQ_COMMAND_BASELINE_TO_ROUTE_CENSUS_2026-10-01.md');
    const census = fs.readFileSync(censusPath, 'utf8');

    /*
      SCOPED TO THE DISPOSITION TABLE, and scoped deliberately.

      The census gained a second table in the structural wave (Room seq 8395): the
      relocation log, which records what moved between surfaces and which
      gap-map finding caused it. That log has no disposition column, so counting
      its rows against the disposition vocabulary would fail a correct census.

      The scope is the text BEFORE the gate rule, which is where the disposition
      table lives. A naive "every table row in the file" parse was exactly the
      kind of guard that would have made a future, legitimate addition to a
      governing artifact look like a contract violation.
    */
    const dispositionTable = census.slice(
      census.indexOf('| Baseline item'),
      census.indexOf('## Structural wave relocation log'),
    );

    const allowed = /\| (KEEP INLINE|MOVE TO PEER VIEW|MOVE TO INSPECTOR\/SHEET|MOVE TO ABOUT\/METHOD|DEDUPLICATE|REMOVE AS DEAD PRESENTATION) \|/g;
    const outcomes = dispositionTable.match(allowed) ?? [];
    const rows = dispositionTable
      .split('\n')
      .filter((line) => line.startsWith('| ') && !line.startsWith('|---') && !line.includes('Baseline item'));
    expect(rows.length).toBeGreaterThan(10);
    expect(outcomes.length).toBe(rows.length);
    expect(rows.every((row) => row.split('|')[4]?.trim().length > 0 && row.split('|')[3]?.trim().length > 0)).toBe(true);
  });
});
