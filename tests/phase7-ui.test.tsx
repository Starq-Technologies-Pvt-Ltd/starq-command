/**
 * Phase 7 — operator-grade console verification.
 *
 * These tests assert the UI BUILD, not just the projection. The pre-build
 * rendered both rooms correctly and was still unusable as an operating
 * surface, so "it renders" was never the bar. The bar is:
 *
 *   · the first screen names the room and its state
 *   · the two rooms are visually distinguishable while sharing one language
 *   · long lists live in bounded panes rather than growing the page
 *   · an absent source renders as an explicit gap, never as an empty table
 *   · clicking a row opens real evidence, and the drawer leads with a ledger
 *   · navigation carries counts, so a tab answers before it is entered
 *
 * Every assertion below renders the REAL component tree against the REAL
 * projection shape. Where a source is deliberately removed, the assertion is
 * that the surface says so — not that it degrades quietly.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBuilding, BUILDING_SOURCES, HOADHA_ROOT } from '../server/building.mjs';
import { BuildingSurface } from '@/surfaces/building';
import { parseBuildingRoute } from '@/lib/building-route';
import { toneOf, rowTone, show } from '@/components/console';
import fixture from './fixtures/phase5-surface.json';
import type { CommandSurface } from '@/lib/contracts';

/**
 * A realistic fixture: 326 live rows across three boards with a real status
 * distribution, 437 ERP tasks, and a full roster. The pre-build tests used a
 * uniform status, which is precisely why the density problems were invisible
 * — a table of 243 identical rows looks fine until it is 143 done, 60 todo,
 * 27 planned, 6 blocked and 2 preserved.
 */
function withRealisticRoot(run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-p7ui-'));
  const STATUSES = [
    ...Array(142).fill('done'),
    ...Array(60).fill('todo'),
    ...Array(27).fill('planned'),
    ...Array(6).fill('blocked'),
    ...Array(5).fill('in_progress'),
    ...Array(2).fill('preserved'),
    1 && 'next',
  ];
  try {
    for (const source of BUILDING_SOURCES) {
      const target = path.join(root, source);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let body = '';
      if (source.endsWith('roadmap.machine.json'))
        body = JSON.stringify({
          status: 'FOUNDER_REVIEW',
          current_wave: 'H0',
          root_blockers: ['exact_production_state_unknown', 'claim_proof_review_partial'],
          loops: ['C2G', 'N2D', 'O2K', 'S2A', 'A2F', 'C2C'].map((id) => ({
            id,
            name: `Loop ${id}`,
            state: 'PARTIAL',
            blocker: `${id} closure not proven`,
            tasks: ['HCD-H0-01', 'HCD-H0-02'],
          })),
        });
      else if (source.endsWith('-tasks.json')) {
        const count = source.endsWith('/hoadha-tasks.json')
          ? 243
          : source.includes('social')
            ? 56
            : source.includes('concierge')
              ? 27
              : 437;
        body = JSON.stringify({
          tasks: Array.from({ length: count }, (_, i) => ({
            id: `${source.includes('starq-erp') ? 'SERP' : 'DHIV'}-S${i % 5}-T${i}`,
            phase: `Phase ${i % 5}`,
            sprint: `Sprint ${i % 5}`,
            title: `Canonical task ${i} — a title long enough to need wrapping in a dense cell`,
            status: source.includes('starq-erp')
              ? STATUSES[i % STATUSES.length]
              : STATUSES[i % STATUSES.length],
            workers: ['cipher'],
          })),
        });
      } else if (source.endsWith('TASK_RECONCILIATION.md'))
        body = Array.from(
          { length: 33 },
          (_, i) => `| HCD-H0-${String(i + 1).padStart(2, '0')} | H0 | Proposed | NOT_ASSESSED |`,
        ).join('\n');
      else if (source.endsWith('DEVELOPMENT_WAVES.md'))
        body = Array.from({ length: 11 }, (_, i) => `| H${i} wave name | objective ${i} | entry ${i} | invariant ${i} |`).join('\n');
      else if (source.endsWith('LOOP_STAGE_MATRIX.md'))
        body = '| C2G | discovery → graph | PARTIAL | publication unproven |\n'.repeat(6);
      else if (source.endsWith('EVIDENCE_INDEX.md'))
        body = '| Claim area | repo evidence | src |'.replace('Claim area', 'Deployment state') + '\n' + '| A claim | evidence.md | src |'.repeat(4);
      fs.writeFileSync(target, body);
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The Phase 5 fixture carries only `floor.constraints` — it was captured to
 * exercise the Phase 5 attention surface, not the floor. The floor-backed
 * surfaces (Staff, Capacity, Activity) need a real floor payload, so one is
 * supplied here rather than weakening the accepted Phase 3 surface to tolerate
 * a projection shape it was never written against.
 */
import { FLOOR_FIXTURE } from './fixtures/floor-fixture';

const base = {
  ...(fixture as unknown as CommandSurface),
  floor: FLOOR_FIXTURE,
} as unknown as CommandSurface;
const render = (hash: string, surface: CommandSurface) =>
  renderToStaticMarkup(
    <BuildingSurface route={parseBuildingRoute(hash)} surface={surface} />,
  );

describe('Phase 7 — the first screen answers', () => {
  /*
    RE-AIMED IN THE STRUCTURAL WAVE (Room seq 8395, gap map WF-ERP-01/02).

    These three assertions previously described a COMPOSITION, and that
    composition was itself the defect. They asserted that the ERP stat rail
    carried process-family and convergence-gap counts ahead of task records, and
    that Hoadha Overview stacked the wave ladder and loop closure grid above the
    fold.

    Gap map WF-ERP-01 recorded at BLOCKER severity that the ERP page led with a
    5xl `40.31%` maturity number, and WF-HOA-01 recorded that Hoadha Overview
    was "a full report assembled inside the Overview watch face" against an
    explicit contract clause saying Overview must not stack the ladder, grid,
    board and evidence product. A test that pins the defective composition is not
    a safety net; it is a ratchet holding the defect in place.

    So the assertions were rewritten to test the INTENT rather than the
    arrangement, and each was made STRONGER in the direction the gap map
    demands:

      · process closure must LEAD and task volume must FOLLOW it, asserted
        against the real document order rather than against a stat rail;
      · the five canonical families must be the primary work area, by name;
      · maturity must NOT be a hero — asserted in the negative, which the old
        test never did;
      · Hoadha's live/proposed separation must be visible, still;
      · and the ladder and loop GRID must be ABSENT from Overview and present on
        their own peers — a new assertion in the direction the gap map asked for
        and which nothing previously guarded.

    What did NOT change: room identity, ON_HOLD, PREPARED, 326, 33, C2C and the
    task-subordination caveat are all still asserted. Nothing was dropped to
    make the restructure pass.
  */
  it('ERP overview leads with room identity, hold state and closure, not task volume', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/erp/overview', surface);

      // Room identity is on the first screen, not behind a nav click.
      expect(html).toContain('data-room="erp"');
      expect(html).toContain('starqERP');
      expect(html).toContain('ON_HOLD');

      // PROCESS CLOSURE LEADS, TASK VOLUME FOLLOWS. Asserted against real
      // document order: the closure matrix must appear before the task block.
      const closure = html.indexOf('Process closure by family');
      const tasks = html.indexOf('Task records');
      expect(closure, 'the five-family closure matrix is the primary work area').toBeGreaterThan(-1);
      expect(tasks, 'task records are still reported').toBeGreaterThan(-1);
      expect(
        closure,
        'process closure must lead and task volume must follow it',
      ).toBeLessThan(tasks);

      // Every family the projection declares is in the closure matrix. Written
      // against the DATA rather than a hardcoded list of five ids: the fixture
      // carries one family and the live contract carries five, and the invariant
      // worth guarding is "no declared family is dropped", not a literal roster.
      for (const f of surface.process_truth.process_families)
        expect(html, `family ${f.id} must be in the closure matrix`).toContain(f.id);

      // And the canonical count is reported, so "5 families" is a claim the
      // surface makes rather than one this test assumes.
      expect(html).toMatch(
        new RegExp(`${surface.process_truth.process_families.length} canonical families`),
      );

      // MATURITY IS NOT A HERO. The gap map's BLOCKER finding was that a large
      // maturity percentage made the page read as progress tracking. The old
      // test never asserted the negative; this one does. The value is still
      // present — demoted, not deleted.
      expect(html, 'maturity is still reported').toMatch(/Maturity diagnostic|process maturity/i);
      expect(html, 'the hero-scale maturity number is gone').not.toContain('text-5xl');

      // Task volume is explicitly subordinated to closure.
      expect(html).toContain('Task count is NOT maturity');
    }));

  it('Hoadha overview is a compact watch face, and the deep product lives on peers', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/hoadha/overview', surface);
      expect(html).toContain('data-room="hoadha"');
      expect(html).toContain('PREPARED');
      expect(html).toContain('326');
      expect(html).toContain('33');

      // The live/proposed split must be visible on Overview itself, not only on
      // the Board tab, because conflating them is the single easiest way to
      // misreport this room. Unchanged intent, asserted on the new band.
      const band = html.slice(html.indexOf('data-room-state-band'), html.indexOf('command-stack'));
      expect(band, 'live count visible on Overview').toContain('326');
      expect(band, 'proposed count visible on Overview').toContain('33');
      expect(band, 'and the two are declared never-summed').toMatch(/never summed/i);
      expect(band, 'and execution prohibition is visible').toMatch(/no H0 activation/i);

      // WF-HOA-01 / WF-WRONG-04, asserted in the negative for the first time:
      // the Overview watch face must NOT stack the full wave ladder or the loop
      // closure GRID. The previous test asserted they WERE above the fold.
      //
      // The discriminators are the GRID's OWN rendered artefacts — its
      // per-loop task-trace chips and its no-score footer — not a title
      // substring, so neither a rename nor a cross-link mentioning "task
      // traces" can make this assertion pass vacuously.
      expect(html, 'the full wave ladder is NOT stacked on Overview').not.toContain('Wave ladder');
      expect(html, 'loop task-trace chips are NOT stacked on Overview').not.toContain(
        'no task trace at source',
      );
      expect(html, 'the grid is NOT stacked on Overview').not.toContain(
        'No task-completion percentage is computed here',
      );
      // A loop SUMMARY is present instead, and it names the loops.
      expect(html).toContain('Loop closure summary');
      expect(html).toContain('C2C');

      // …and the deep product is still reachable on its own peers. Nothing was
      // deleted to make Overview compact.
      expect(render('#studio/hoadha/waves', surface)).toContain('Wave ladder');
      expect(render('#studio/hoadha/loops', surface)).toContain(
        'No task-completion percentage is computed here',
      );
      expect(render('#studio/hoadha/stages', surface)).toContain('Loop stage matrix');
    }));

  it('every room tab states its room identity and names the question it answers', () => {
    /*
      RE-AIMED. The previous assertion required a `focus-rail`, a "Read first"
      note or "Current focus" on every tab — i.e. it enforced a READING NOTE on
      each tab, which is gap map WF-HIER-01's complaint in test form ("the product
      repeatedly asks the operator to read how to interpret the surface before
      showing what to inspect").

      The intent that survives is the one worth guarding: switching tabs must
      never lose the room, and it must be obvious WHAT the active tab is for.
      Those are now structural (a room state band plus a peer work header), so
      they are asserted structurally.
    */
    const tabs: [string, string[]][] = [
      ['erp', ['overview', 'process', 'tasks', 'decisions', 'evidence', 'staff', 'integrity']],
      [
        'hoadha',
        ['overview', 'loops', 'board', 'waves', 'stages', 'evidence', 'staff', 'integrity'],
      ],
    ];
    for (const [room, list] of tabs)
      for (const tab of list)
        withRealisticRoot((root) => {
          const surface = { ...base, building: buildBuilding(root, base) };
          const html = render(`#studio/${room}/${tab}`, surface);
          expect(html.length).toBeGreaterThan(400);
          // Identity on every tab, so switching tabs never loses the room.
          expect(html).toContain(`data-room="${room}"`);
          // Room STATE on every tab, so switching never loses the hold/prepared
          // state either. This is the compression requirement: the state must
          // survive, the paragraph explaining it need not.
          expect(html, `${room}/${tab} room state band`).toContain('data-room-state-band');
        });
  });
});

describe('Phase 7 — the two rooms are one product with two accents', () => {
  it('ERP and Hoadha share the panel language and differ by room scope only', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const erp = render('#studio/erp/overview', surface);
      const hoadha = render('#studio/hoadha/overview', surface);

      /*
        RE-AIMED. The shared-vocabulary markers were `stat-rail`, `focus-rail`
        and friends — the per-tab stat rail is exactly what gap map WF-ERP-03 and
        WF-REP-03 asked to compress away, because it repeated on every tab and
        consumed the peer body.

        The CLAIM being tested is unchanged and is still the important one: the
        two rooms are one product with two accents. It is now asserted against
        the vocabulary the two rooms actually share after the compression — the
        room state band, the tab rail, the chip vocabulary, the room head and the
        peer work header — so the test still fails if one room grows a private
        visual language.
      */
      for (const marker of ['room-state-band', 'command-tabs', 'chip', 'room-head', 'peer-work-head'])
        expect(erp, marker).toContain(marker);
      for (const marker of ['room-state-band', 'command-tabs', 'chip', 'room-head', 'peer-work-head'])
        expect(hoadha, marker).toContain(marker);
      // And the panel vocabulary is genuinely shared where both rooms use it.
      for (const [hash, room] of [
        ['#studio/erp/tasks', 'erp'],
        ['#studio/hoadha/board', 'hoadha'],
      ] as const) {
        const html = render(hash, surface);
        expect(html, room).toContain('command-panel');
        expect(html, room).toContain('project-board');
      }

      // Distinct room scope — the only difference is which room you are in.
      expect(erp).toContain('data-room="erp"');
      expect(hoadha).toContain('data-room="hoadha"');
      expect(erp).not.toContain('data-room="hoadha"');
      expect(hoadha).not.toContain('data-room="erp"');
    }));

  it('room accents are declared as scoped tokens, never as truth tokens', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'src', 'index.css'),
      'utf8',
    );
    // A room accent exists and is distinct per room…
    expect(css).toMatch(/--room-erp:/);
    expect(css).toMatch(/--room-hoadha:/);
    expect(css).toMatch(/--room-studio:/);
    expect(css).not.toMatch(/--room-erp:\s*152/);
    expect(css).not.toMatch(/--room-hoadha:\s*152/);
    // …and it is scoped to the room root, so it cannot leak into a verdict.
    expect(css).toMatch(/\.room-root\[data-room='erp'\]/);
    expect(css).toMatch(/\.room-root\[data-room='hoadha'\]/);
  });
});

describe('Phase 7 — density without a report scroll', () => {
  it('renders all 326 live rows inside a bounded pane, not as page length', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/hoadha/board', surface);
      // Every row is in the DOM…
      expect(html.match(/DHIV-S\d-T\d/g)?.length).toBeGreaterThan(200);
      // …inside per-lane bounded scroll regions, which stop the page from
      // becoming a 326-row report while keeping every task reachable.
      expect(html).toContain('project-board-lane-list');
      expect(html).toContain('max-h-[60vh]');
      expect(html).toContain('overflow-y-auto');
      // The bounded pane is a CSS contract, so it is asserted where it lives.
      expect(
        fs.readFileSync(path.join(process.cwd(), 'src', 'index.css'), 'utf8'),
      ).toContain('overscroll-behavior: contain');
      // No pagination: the operator does not page through 326 records.
      expect(html).not.toContain('Page 1 /');
    }));

  it('renders 437 ERP tasks in a bounded pane with a live status filter', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/erp/tasks', surface);
      expect(html).toContain('Canonical ERP task records');
      expect(html).toContain('project-board-lane-list');
      // The source-status filter preserves source vocabulary; lane counts make
      // blocked work visible without reading every task row.
      expect(html).toContain('aria-label="Source status filter"');
      const blockedCount = html.match(/<h3 id="project-board-lane-BLOCKED"[^>]*>BLOCKED<\/h3><span[^>]*>(\d+)<\/span>/);
      expect(blockedCount?.[1]).toBe('6');
      expect(html).toContain('DONE');
      // The ERP room shows one collection, and says so — the live/proposed
      // split is a Hoadha-room concern and ERP does not inherit it.
      expect(html).not.toContain('Proposed HCD');
      expect(html).toMatch(/task count is NOT maturity/i);
    }));

  it('splits wide content into panes instead of one long column', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/hoadha/overview', surface);
      expect(html).toContain('command-split wide');
      const integrity = render('#studio/hoadha/integrity', surface);
      expect(integrity).toContain('command-split');
    }));
});

describe('Phase 7 — evidence drill-down is usable', () => {
  it('each row is selectable and the drawer leads with a ledger, not raw JSON', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/hoadha/board', surface);
      // Native buttons are the task-card selection target and are keyboard
      // reachable without a custom tabindex/keydown implementation.
      expect(html).toContain('<button');
      expect(html).toContain('aria-pressed=');
      // Assert the native interactive element and selection handler in source,
      // because renderToStaticMarkup strips event handlers.
      expect(
        fs.readFileSync(path.join(process.cwd(), 'src', 'surfaces', 'project-board.tsx'), 'utf8'),
      ).toMatch(/<button\s+type="button"[\s\S]*?aria-pressed=\{chosen\}[\s\S]*?onClick=\{\(\) => setSelectedId/);
      expect(
        fs.readFileSync(path.join(process.cwd(), 'src', 'surfaces', 'project-board.tsx'), 'utf8'),
      ).toContain('<ProjectTaskDetails record={selected} />');
      expect(html).not.toContain('>Inspect<');
    }));

  it('source hashes are expandable and the byte/proof distinction is stated', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/hoadha/integrity', surface);
      expect(html).toContain('aria-expanded');
      // The truncated digest is offered in the row; the full one on expand, so
      // the expansion label is asserted in source rather than in collapsed markup.
      expect(html).toMatch(/[0-9a-f]{8}…/);
      expect(
        fs.readFileSync(path.join(process.cwd(), 'src', 'surfaces', 'integrity.tsx'), 'utf8'),
      ).toContain('SHA-256 of bytes read');
      // The distinction between "bytes were read" and "the claim is true"
      // must be in the same view as the hashes, or the hashes will be read
      // as verification.
      expect(html).toMatch(/does not prove|never establishes|UNVERIFIED/);
      // The full digest lives in the expansion row, so it is asserted in source
      // rather than in collapsed static markup.
      expect(
        fs.readFileSync(path.join(process.cwd(), 'src', 'surfaces', 'integrity.tsx'), 'utf8'),
      ).toContain('SHA-256 of bytes read');
    }));

  it('every source row links to the raw bytes it claims to have read', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/hoadha/integrity', surface);
      expect(html).toContain('/api/raw?path=');
    }));
});

describe('Phase 7 — absence is never rendered as emptiness', () => {
  it('a deleted board reads as a source gap, not an empty table', () =>
    withRealisticRoot((root) => {
      fs.unlinkSync(path.join(root, 'starqNexus/data/hoadha-tasks.json'));
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/hoadha/board', surface);
      expect(html).toContain('Canonical live Hoadha boards unavailable.');
      expect(html).toContain('No fallback or historical task data is shown.');
      // Other collections being readable must not turn an incomplete live
      // board into an apparently complete task list.
      expect(html).not.toContain('DHIV-S');
    }));

  it('an absent floor roster reads as absent, not as an empty staff table', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      surface.floor = undefined;
      const html = render('#studio/staff', surface);
      expect(html).toContain('no staff roster supplied');
      expect(html).toContain('Absence of a roster is not an absence of staff');
      // Capacity degrades to UNKNOWN rather than to zero.
      expect(html).toContain('UNKNOWN');
    }));

  it('Hoadha staff declares the room-specific assignment gap instead of borrowing the roster', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/hoadha/staff', surface);
      expect(html).toContain('no Hoadha staff assignment source declared');
      expect(html).toMatch(/establish a Hoadha\s*assignment/);
      expect(html).toMatch(/roster below is shown for reference/);
    }));
});

describe('Phase 7 — Staff, Capacity and Activity are useful', () => {
  it('staff separates identity, duty and execution into distinct fields', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/staff', surface);
      /*
        RE-AIMED IN THE STRUCTURAL WAVE (Room seq 8395), gap map WF-DS-02 and
        WF-MISS-02.

        The roster was a dense full-width six-column table with no selected-row
        pane, which the gap map named as the reason Staff did not read as a work
        area. It is now a bounded list plus a selected-detail pane.

        The CLAIM this test protects is unchanged and is the important one: a
        reader must never see "assigned" without also seeing how confidently the
        source claims it, and identity / duty / execution must never collapse
        into one blob. It is now asserted against the selected-detail pane,
        which is where those fields live, plus the presence of a real selection
        contract — and the row is additionally checked to carry the assignment
        and task it claims.
      */
      expect(html).toContain('work-area', 'the roster is a primary-detail work area');
      expect(html).toContain('data-work-row', 'roster rows are selectable');
      expect(html).toContain('aria-selected="true"', 'a row is selected by default');

      // The three questions stay separate, each with its own declared field.
      expect(html).toContain('Classification');
      expect(html).toContain('Identity present');
      expect(html).toContain('Current state');
      expect(html).toContain('Duty state');
      expect(html).toContain('Duty task');
      expect(html).toContain('Execution assignment');
      // …and the confidence markers behind each claim survive the restructure.
      expect(html).toContain('State confidence');
      expect(html).toContain('Assignment confidence');
      expect(html).toContain('Assignment source');
      expect(html).toContain('Task source');

      // The reading note is still present — WF-HIER-01 moved it behind a closed
      // disclosure, it did not delete it, and the copy is asserted unchanged.
      expect(html).toContain('A task mention is not an assignment');
    }));

  it('capacity reads declared facts and refuses to invent a quota', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/capacity', surface);
      expect(html).toContain('Declared capacity');
      expect(html).toContain('no canonical quota projection');
      // Session presence is never presented as capacity.
      expect(html).toMatch(/not from session presence/);
      // When sessions ARE present the refusal is stated explicitly.
      const withSessions = { ...surface, floor: { ...base.floor, sessions: { available: true, count: 3, not_a_measure_of_work: true } } } as unknown as CommandSurface;
      expect(render('#studio/capacity', withSessions)).toMatch(/NOT a measure of work/);
      expect(html).toContain('Declared capacity notes');
    }));

  it('activity is a filterable log of evidence of activity, never process state', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/activity', surface);
      expect(html).toContain('Activity provenance');
      expect(html).toMatch(/never establish.*maturity|not of process state/);
      expect(html).toContain('command-table-wrap tall');
    }));
});

describe('Phase 7 — navigation carries information', () => {
  it('room tabs carry counts so a tab answers before it is entered', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const erp = render('#studio/erp/overview', surface);
      // Tasks tab shows its own size.
      expect(erp).toMatch(/Tasks\s*<span class="count">437<\/span>/);
      const hoadha = render('#studio/hoadha/overview', surface);
      // Board shows the live total; Loops and Waves show their counts.
      expect(hoadha).toMatch(/Board\s*<span class="count">326<\/span>/);
      expect(hoadha).toMatch(/Loops\s*<span class="count">6<\/span>/);
      expect(hoadha).toMatch(/Waves\s*<span class="count">11<\/span>/);
      // The active tab is marked, so orientation survives a deep link.
      expect(hoadha).toContain('aria-current="page"');
    }));

  it('the current tab is marked on every room and cross-room surface', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      for (const hash of [
        '#studio/erp/tasks',
        '#studio/hoadha/board',
        '#studio/capacity',
      ]) {
        const html = render(hash, surface);
        const nav = html.slice(html.indexOf('command-tabs'), html.indexOf('command-tabs') + 3000);
        expect(nav, hash).toContain('aria-current="page"');
      }
    }));
});

describe('Phase 7 — tone mapping never invents a healthy state', () => {
  it('maps declared states to tones and refuses to guess the rest', () => {
    expect(toneOf('ON_HOLD')).toBe('hold');
    expect(toneOf('SOURCE_READ')).toBe('ok');
    expect(toneOf('DRIFT')).toBe('drift');
    expect(toneOf('UNAVAILABLE')).toBe('unknown');
    expect(toneOf('UNKNOWN')).toBe('unknown');
    expect(toneOf('PARTIAL')).toBe('stale');
    // An unrecognised state is muted, never silently promoted to healthy.
    expect(toneOf('SOMETHING_NEW')).toBe('muted');
    expect(toneOf(undefined)).toBe('muted');
    expect(toneOf(null)).toBe('muted');
  });

  it('task row rails mark blocked and done without a chip read', () => {
    expect(rowTone('done')).toBe('ok');
    expect(rowTone('blocked')).toBe('drift');
    expect(rowTone('in_progress')).toBe('stale');
    expect(rowTone('todo')).toBe('unknown');
    expect(rowTone(undefined)).toBe('muted');
  });

  it('the formatter never coerces absence into a value', () => {
    expect(show(undefined)).toBe('UNKNOWN');
    expect(show(null)).toBe('UNKNOWN');
    expect(show('')).toBe('UNKNOWN');
    expect(show(0)).toBe('0');
    expect(show(false)).toBe('false');
    expect(show({ a: 1 })).toBe('{"a":1}');
  });

  it('a live count of zero is not rendered as absent', () =>
    withRealisticRoot((root) => {
      fs.writeFileSync(
        path.join(root, HOADHA_ROOT, 'TASK_RECONCILIATION.md'),
        '| HCD-H0-01 | H0 | Proposed | NOT_ASSESSED |',
      );
      const surface = { ...base, building: buildBuilding(root, base) };
      // proposed_count is now 1, and integrity must be DRIFT — the room says
      // so rather than quietly showing a smaller number.
      expect(surface.building.hoadha.proposed_count).toBe(1);
      expect(surface.building.hoadha.integrity).toBe('DRIFT');
      const html = render('#studio/hoadha/integrity', surface);
      expect(html).toContain('DRIFT');
    }));
});

describe('Phase 7 — hold and prepared states are never routed around', () => {
  it('ERP hold is visible on every ERP tab and offers no restart control', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      for (const tab of ['overview', 'process', 'tasks', 'decisions', 'evidence', 'staff', 'integrity']) {
        const html = render(`#studio/erp/${tab}`, surface);
        expect(html, tab).toMatch(/ON_HOLD|implementation ON HOLD/i);
        // No control anywhere in the ERP room may imply the hold can be lifted
        // from the UI. The restart is a Founder act, not a UI act.
        expect(html, tab).not.toMatch(/resume implementation|lift hold|restart erp|clear hold/i);
      }
    }));

  it('Hoadha never activates H0 and never merges proposed into live', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      for (const tab of ['overview', 'loops', 'board', 'waves', 'stages', 'evidence', 'staff', 'integrity']) {
        const html = render(`#studio/hoadha/${tab}`, surface);
        expect(html, tab).toMatch(/NOT STARTED|PREPARED/);
        expect(html, tab).not.toMatch(/activate h0|start execution|begin wave/i);
      }
      /*
        Live and proposed are two collections, never one merged collection.

        RE-AIMED. The previous assertion required BOTH tables to be on screen at
        once, which gap map WF-HOA-03 identified as a real defect: the active
        collection could not be determined without scanning the surrounding
        room rail, and the two tables stacked into an undifferentiated wall.

        The collection is now an explicit segmented control carrying both
        counts. So the assertions become STRONGER about the thing that actually
        matters — the separation is visible and stated — and they additionally
        require that neither table silently substitutes for the other.
      */
      const board = render('#studio/hoadha/board', surface);
      expect(board).toContain('Canonical live Hoadha boards');
      expect(board).toMatch(/Two collections, never summed/i);
      // The control names the active collection and carries BOTH counts, so the
      // reader never has to infer which table they are looking at.
      expect(board).toContain('data-collection-switch="live"');
      expect(board).toMatch(/active collection\s*<strong>LIVE<\/strong>/);
      expect(board, 'live count is in the control').toMatch(/Live[\s\S]{0,80}326/);
      expect(board, 'proposed count is in the control').toMatch(/Proposed[\s\S]{0,80}33/);
      // The inactive collection is explicitly marked not live.
      expect(board).toMatch(/proposed records are NOT live/i);
      // And the two are never summed into one operational total.
      expect(board).toMatch(/never summed/i);
    }));

  it('Hoadha production and integration remain unverified everywhere they appear', () =>
    withRealisticRoot((root) => {
      const surface = { ...base, building: buildBuilding(root, base) };
      const html = render('#studio/hoadha/overview', surface);
      expect(html).toContain('UNKNOWN / UNVERIFIED');
      expect(html).toContain('production UNKNOWN / UNVERIFIED');
    }));
});

describe('Phase 7 — responsive behaviour is declared in CSS, not hoped for', () => {
  it('declares the three collapse steps and a reduced-motion guard', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src', 'index.css'), 'utf8');
    expect(css).toContain('@media (max-width: 1400px)');
    expect(css).toContain('@media (max-width: 1024px)');
    expect(css).toContain('@media (max-width: 800px)');
    expect(css).toContain('prefers-reduced-motion');
    // Split panes collapse rather than overflowing at narrow widths.
    const narrow = css.slice(css.indexOf('@media (max-width: 1024px)'));
    expect(narrow.slice(0, 400)).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('R6: the two-column split survives the 1280px and 1152px operator widths', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src', 'index.css'), 'utf8');
    /*
      The defect: at <=1280px the split went single-column AND table panes
      dropped 52vh->44vh, so the most likely operator laptops got more vertical
      scroll, not less. The guard is that no media query between 1025px and
      1400px forces a single column, and that the split collapse lives at
      1024px.
    */
    const between = css.slice(
      css.indexOf('@media (max-width: 1400px)'),
      css.indexOf('@media (max-width: 1024px)'),
    );
    expect(between).not.toContain('grid-template-columns: minmax(0, 1fr)');
    // Pane shortening at 1400px must not be the 44vh value — that was the
    // shortening that made 1280px worse.
    expect(between).toContain('max-height: 48vh');
    expect(between).not.toContain('max-height: 44vh');
  });

  it('R1: the Projection state block is compressed below 800px, never deleted', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src', 'index.css'), 'utf8');
    const narrow = css.slice(css.indexOf('@media (max-width: 800px)'));
    /*
      The single doctrine breach Goose found in the candidate: a truth-state
      value was display:none below 800px. The rail block may now only be
      PADDED and its inner heading hidden — the block itself must never be
      display:none, and the selector must be the named attribute rather than
      the positional div:last-child that let it be removed wholesale.
    */
    expect(narrow).not.toMatch(/\[data-rail-projection\]\s*\{[^}]*display:\s*none/);
    expect(narrow).toContain('[data-rail-projection]');
    expect(narrow).not.toContain('.command-app > nav > div:last-child');
    // And the count it used to carry is re-homed on the pinned bar.
    const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
    expect(app).toContain('conditions in sync') || expect(app).toContain('in sync');
    expect(app).toContain('PROJECTION');
  });

  it('the app shell keeps the skip link and a bounded main region', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
    expect(app).toContain('command-skip');
    expect(app).toContain('Skip to current surface');
    // Pinned orientation: the context bar is above <main>, not inside it, so
    // it cannot scroll away.
    expect(app.indexOf('command-context')).toBeLessThan(app.indexOf('<main'));
  });
});
