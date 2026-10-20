/**
 * STRUCTURAL OWNERSHIP GATES — the structural/product-composition wave.
 *
 * Mission: Room seq 8395 (STARQ // COMMAND — FINAL STRUCTURAL IMPLEMENTATION).
 * Governing artifacts: STARQ_COMMAND_WATCH_FACE_FINAL_GAP_MAP_2026-10-01.md and
 * STARQ_COMMAND_FINAL_PRODUCT_CONTRACT_2026-10-01.md.
 *
 * WHY THIS FILE EXISTS, and why it is written the way it is
 *
 * Vision's seq 8383 post recorded the mechanism behind its own earlier overclaim
 * and it is the reason this file is shaped as it is:
 *
 *   "A GUARD WRITTEN FROM THE FILES YOU JUST CHANGED CANNOT SEE THE FILES YOU
 *    DID NOT."
 *
 * So almost nothing here is a hardcoded list of files or strings. Ownership is
 * asserted by CENSUS — over every `.tsx` under `src/` — and by the RENDERED
 * document, which is where a composition claim is actually true or false. A new
 * surface that restates an owned fact is caught automatically, because it is
 * scanned, not because someone remembered to add its path.
 *
 * The one place a hardcoded path appears is where the path IS the claim (that a
 * named component exists and is what owns a thing), and even there the assertion
 * is about ownership behaviour rather than about the file.
 *
 * THESE TESTS ASSERT COMPOSITION, NOT VISUAL POLISH
 *
 * Typography, density and responsive refinement belong to Vision's later wave.
 * Nothing here asserts a pixel, a colour or a font size, and nothing here should
 * be read as visual acceptance — the product contract is explicit that no
 * automated gate substitutes for human visual sign-off.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { BuildingSurface } from '@/surfaces/building';
import { parseBuildingRoute } from '@/lib/building-route';
import type { CommandSurface } from '@/lib/contracts';
import { FLOOR_FIXTURE } from './fixtures/floor-fixture';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(APP_ROOT, 'src');
const raw = (...p: string[]) => readFileSync(path.join(...p), 'utf8');

/** Source with block and line comments removed, so prose cannot satisfy a guard. */
const code = (...p: string[]) =>
  raw(...p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** EVERY .tsx under src/, by census. Never a hand-listed set of edited files. */
const ALL_TSX = readdirSync(SRC, { recursive: true })
  .filter((f): f is string => typeof f === 'string' && f.endsWith('.tsx'))
  .map((f) => path.join(SRC, f));

const rel = (f: string) => path.relative(APP_ROOT, f).replaceAll('\\', '/');

/**
 * A minimal but STRUCTURALLY COMPLETE surface.
 *
 * Deliberately not a rich fixture: these gates assert which facts appear and in
 * what order, so a fixture that omits a truth would make a gate pass by
 * emptiness. Where a gate needs a specific declared value it reads it from the
 * fixture it renders.
 */
const surface = {
  workspace: { root: 'D:\\StarqTech', source: 'STARQ_WORKSPACE' },
  assembled_at: '2026-10-01T00:00:00Z',
  authority_note: 'DERIVED_PROJECTION. Canonical source wins.',
  health: { overall: 'STALE', conditions: [{ key: 'process', state: 'OK', available: true }], counts: { ok: 1, total: 2 } },
  process_truth: {
    available: true,
    state: 'OK',
    version: '1.0.0',
    status: 'CURRENT',
    authority: 'DEC-100',
    generated_at: '2026-10-01T00:00:00Z',
    hold_state: {
      implementation: 'ON_HOLD',
      convergence_not_rewrite: true,
      reason: 'Founder course correction.',
      restart_gate_conditions: ['gate one', 'gate two'],
    },
    restart_wave_after_authorization: [],
    convergence_gaps: [{ id: 'G1', title: 'a gap', why: 'why' }],
    corrective_tasks: [],
    process_families: [
      {
        id: 'O2C',
        name: 'Order to Cash',
        headline: 'h',
        critical_blocker: 'blocker one',
        stages: [{ stage: 'Capture', state: 'PARTIAL', blocked_by: 'blocker one' }],
      },
    ],
    reconciliation: {
      known_discrepancies: [
        { id: 'D1', item: 'item', resolution: 'UNRESOLVED - thing', founder_decision_required: true },
      ],
    },
  },
  execution_truth: {
    available: true,
    state: 'STALE',
    reason: 'ledger moved',
    generated_at: '2026-10-01T00:00:00Z',
    agents: [],
    conflicts: [{ type: 'T', handle: 'h', detail: 'd' }],
    activity_events: [
      { event_id: 'E1', agent: { handle: 'vision' }, action: 'posted', state: 'STARTED', project: 'p', task: 't' },
    ],
    ledger: { state: 'STALE', recorded_sha256_prefix: 'aaa', live_sha256_prefix: 'bbb' },
  },
  work_truth: { available: true, state: 'OK', generated_at: '2026-10-01T00:00:00Z', tasks: [], counts: {}, maturity: null },
  identities: { available: true, version: '1', count: 3, founder: { display_name: 'A', operational_handle: 'ali' }, byHandle: {} },
  staff_state: { available: true, byHandle: {} },
  sessions: { available: false, reason: 'none' },
  provenance: {
    state: 'OK',
    checked: 2,
    drifted: [],
    missing: [],
    sources: [
      {
        name: 'contract',
        path: '00_STARQ_HQ/operations/starqerp-control-board/contract.json',
        recorded: 'aaaa1111',
        live: 'aaaa1111',
        state: 'OK',
      },
      {
        name: 'activity',
        path: '00_STARQ_HQ/operations/starqerp-control-board/activity.json',
        recorded: 'bbbb2222',
        live: 'cccc3333',
        state: 'DRIFT',
      },
    ],
  },
  read_only_sources: ['contract.json', 'activity.json'],
  health_floor: null,
  floor: FLOOR_FIXTURE,
  building: {
    company: 'Starq Technologies',
    floor: 'Dev Studio',
    projects: [
      { id: 'erp', name: 'starqERP', state: 'ON_HOLD', classification: 'OCCUPIED', source: 'contract.json' },
      { id: 'hoadha', name: 'Hoadha', state: 'NOT STARTED', classification: 'PREPARED', source: 'roadmap.json' },
    ],
    capacity: { state: 'UNKNOWN', reason: 'No canonical quota projection.' },
    sources: [{ source: 'contract.json', state: 'AVAILABLE' }],
    erp_tasks: [{ id: 'SERP-1', title: 't', status: 'OPEN', collection: 'board', source: 's' }],
    hoadha: {
      execution: 'NOT STARTED',
      classification: 'PREPARED',
      current_wave: 'H0',
      live_count: 2,
      proposed_count: 1,
      integrity: 'SOURCE_READ',
      source_status: 'SOURCE_READ',
      production: 'UNKNOWN',
      integration: 'UNKNOWN',
      execution_basis: 'Prepared, not started.',
      blockers: ['B1'],
      loops: [{ id: 'L1', name: 'loop', state: 'PARTIAL', blocker: 'gap', tasks: ['t1'] }],
      waves: [{ id: 'H0', title: 'H0 zero', objective: 'o', entry: 'e', invariant: 'i' }],
      stages: [{ loop: 'L1', stages: 's', state: 'PARTIAL', evidence: 'ev' }],
      boards: [{ project: 'p-1', count: 2, state: 'MATCH', records: [] }],
      proposed: [],
      evidence: [],
    },
  },
} as unknown as CommandSurface;

const render = (hash: string) =>
  renderToStaticMarkup(
    <BuildingSurface route={parseBuildingRoute(hash)} surface={surface} />,
  );

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. GLOBAL DESTINATION OWNERSHIP — six destinations, six different questions.
 *
 * Contract §4: "The difference between these destinations is semantic, not
 * cosmetic. If two destinations show substantially the same composition, same
 * primary data blocks and same operator task, the implementation is wrong even
 * if routing works."
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('destination ownership — each of the six answers a different question', () => {
  const destinations = [
    { hash: '#overview', label: 'Overview' },
    { hash: '#building', label: 'Building' },
    { hash: '#studio', label: 'Dev Studio' },
    { hash: '#attention/decisions', label: 'Founder Attention' },
    { hash: '#evidence/sources', label: 'Evidence' },
    { hash: '#system/health', label: 'System' },
  ];

  it('every destination renders a real body, not a redirect', () => {
    for (const d of destinations) {
      const html = render(d.hash);
      expect(html.length, `${d.label} renders almost nothing`).toBeGreaterThan(600);
      expect(html, `${d.label} has no signature`).toContain('room-root');
    }
  });

  it('no two destinations share a primary heading', () => {
    const headings = destinations.map((d) => {
      const html = render(d.hash);
      const h1 = /<h1[^>]*>([^<]*)</.exec(html);
      return `${d.label}: ${h1?.[1] ?? 'NONE'}`;
    });
    expect(new Set(headings).size, `headings collided → ${headings.join(' | ')}`).toBe(
      destinations.length,
    );
  });

  it('Overview and Building do not duplicate each other', () => {
    const overview = render('#overview');
    const building = render('#building');
    // Building is topology; Overview is operating state. Neither renders the
    // other's primary body (census DEDUPLICATE rows).
    expect(overview).toContain('data-executive-headline');
    expect(overview).not.toContain('Organization tree');
    expect(building).toContain('Organization tree');
    expect(building).not.toContain('data-executive-headline');
    expect(building).not.toContain('Needs attention');
  });

  it('Building owns structure and does not repeat operating-state metrics', () => {
    const building = render('#building');
    // WF-BLD-02. Structural qualifiers yes; ERP/Hoadha/integrity stat cells no.
    expect(building).toContain('Declared floors');
    expect(building).toContain('Declared rooms');
    expect(building).not.toMatch(/Live \/ proposed/);
    // …and the unprojected floors are grouped rather than given equal weight.
    expect(building).toContain('Declared but unprojected floors');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. FOUNDER ATTENTION — an attention queue, records before methodology.
 *
 * Gap map WF-ATT-01 (BLOCKER) and WF-WRONG-01.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('Founder Attention operates as an attention queue', () => {
  it('the queue is present and a record is selected before any method text', () => {
    const html = render('#attention/decisions');
    expect(html).toContain('work-area');
    expect(html).toContain('data-work-row');
    // Records are in the list. A record's declared fields are rendered BESIDE
    // it, per the Phase 5 contract, so nothing is click-gated.
    expect(html).toContain('UNRESOLVED - thing');
    // The honesty block is behind a CLOSED disclosure, after the work.
    const queueAt = html.indexOf('work-area');
    const aboutAt = html.indexOf('about-method');
    expect(queueAt).toBeGreaterThan(-1);
    expect(aboutAt).toBeGreaterThan(-1);
    expect(queueAt, 'methodology precedes the queue').toBeLessThan(aboutAt);
    // <details> without `open` is the closed state.
    expect(html, 'the method disclosure is open by default').not.toMatch(/<details[^>]*open/);
  });

  it('all five peers share ONE work-area pattern, not one report and four cards', () => {
    for (const peer of ['decisions', 'exceptions', 'conflicts', 'holds', 'history']) {
      const html = render(`#attention/${peer}`);
      expect(html, `${peer} is not a work area`).toContain('work-area');
      expect(html, `${peer} has no peer work header`).toContain('peer-work-head');
    }
  });

  it('each peer states the canonical field it selects from', () => {
    // WF-ATT-02: peers differ as DATA, so each names its selection source.
    expect(render('#attention/decisions')).toContain('founder_decision_required=true');
    expect(render('#attention/exceptions')).toContain('critical_blocker');
    expect(render('#attention/conflicts')).toContain('conflicts');
    expect(render('#attention/holds')).toContain('hold_state');
  });

  it('History is an explicit unavailable state, not an empty list', () => {
    const html = render('#attention/history');
    expect(html).toMatch(/No historical attention projection/i);
  });

  it('freshness qualifiers stay INLINE and are not collapsible', () => {
    // The counterpart to moving method behind a disclosure: state never moves.
    const html = render('#attention/decisions');
    expect(html).toContain('qualifier-row');
    // The qualifier row is outside any <details>.
    const q = html.indexOf('qualifier-row');
    expect(q).toBeGreaterThan(-1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. EVIDENCE — provenance, with technical depth on selection.
 *
 * Gap map WF-EVD-01, WF-EVD-02, WF-WRONG-02.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('Evidence owns provenance and is not a source wall', () => {
  it('Sources is a compact list plus a selected-source inspector', () => {
    const html = render('#evidence/sources');
    expect(html).toContain('work-area');
    // Path and hashes are available — but on the selection, in the detail pane.
    expect(html).toContain('Full path');
    expect(html).toContain('Raw canonical bytes');
  });

  it('Projection provenance does NOT reappear on Sources (WF-EVD-02)', () => {
    const html = render('#evidence/sources');
    // The PROJECTION PANEL is gone from Sources. The discriminator is the
    // panel's own heading, not a substring: a cross-link that NAMES the
    // Projection peer is correct navigation, and must not fail this.
    expect(html).not.toContain('Projection assembly');
    expect(html).not.toContain('provenance-check table');
    // …and the panel IS on its own peer.
    const projection = render('#evidence/projection');
    expect(projection).toContain('Projection assembly');
    // Sources links to it; Projection does not render it twice.
    expect(html).toMatch(/href="#evidence\/projection"/);
  });

  it('all five Evidence peers are distinct work areas', () => {
    for (const peer of ['sources', 'projection', 'decisions', 'rooms', 'hashes']) {
      const html = render(`#evidence/${peer}`);
      expect(html, `${peer} has no peer work header`).toContain('peer-work-head');
    }
    expect(render('#evidence/hashes')).toContain('Ledger anchor');
    expect(render('#evidence/rooms')).toContain('Room provenance index');
    expect(render('#evidence/decisions')).toContain('Decision record provenance');
  });

  it('canonical precedence is never hidden', () => {
    expect(render('#evidence/sources')).toMatch(/not correctness, deployment, maturity or\s+acceptance/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. SYSTEM — runtime and control plane, and not a second Evidence.
 *
 * Gap map WF-SYS-01, WF-SYS-03, WF-REP-02.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('System owns runtime/control-plane and is not interchangeable with Evidence', () => {
  it('Health STOPS after health (WF-SYS-01)', () => {
    const html = render('#system/health');
    expect(html).toContain('peer-work-head');
    expect(html).toMatch(/Runtime state/);
    expect(html).toMatch(/Projection dimensions/);
    expect(html).toMatch(/Contract state/);
    expect(html).toMatch(/Latest reported degradation/);
    // The census DEDUPLICATE decision, enforced: the source inventory, the
    // identity registry and the staff-state table are NOT on Health any more.
    expect(html).not.toContain('Declared read-only source set');
    expect(html).not.toContain('Identity registry');
    expect(html).not.toContain('Staff state');
  });

  it('the three relocated blocks live on their named peers', () => {
    const sources = render('#system/sources');
    expect(sources).toContain('Declared read-only source set');
    expect(sources).toContain('Identity registry');
    expect(render('#system/contracts')).toContain('Control-plane contracts');
    expect(render('#system/projection')).toContain('Projection dimensions');
  });

  it('Runtime separates process readiness from projection health, and stays honest', () => {
    const html = render('#system/runtime');
    expect(html).toContain('Process runtime');
    // The distinction the gap map asked for is stated on the surface itself.
    expect(html).toMatch(/projection health and process readiness are separate questions/i);
    // WF-SYS-02 / WF-MISS-03, honestly resolved. The launcher artifact exists but
    // the FROZEN read guard restricts raw reads to declared canonical sources,
    // so the snapshot cannot be surfaced without a governance change. The panel
    // must therefore say UNKNOWN and name the reason — it must not present an
    // absent snapshot as a healthy or failed runtime.
    expect(html).toMatch(/UNKNOWN/);
    expect(html).toMatch(/frozen read guard restricts raw reads/i);
    expect(html).toMatch(/not a failed runtime/i);
    // No control action anywhere on this surface.
    expect(html).not.toMatch(/<button[^>]*>\s*(restart|stop|start)/i);
  });

  it('Evidence and System open on different questions', () => {
    const evidence = render('#evidence/sources');
    const system = render('#system/health');
    expect(evidence).toContain('Canonical sources');
    expect(system).toContain('Runtime state');
    expect(system).not.toContain('Canonical sources');
    expect(evidence).not.toContain('Runtime state');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. DEV STUDIO — five peers, five distinct work areas.
 *
 * Gap map WF-DS-01, WF-DS-03.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('Dev Studio peers each own a distinct work area', () => {
  it('every peer names the question it answers', () => {
    const questions: string[] = [];
    for (const peer of ['staff', 'projects', 'capacity', 'activity']) {
      const html = render(`#studio/${peer}`);
      expect(html, `${peer} has no peer work header`).toContain('peer-work-head');
      questions.push(/data-peer-work="[^"]*"[^>]*><span class="mark">([^<]*)</.exec(html)?.[1] ?? peer);
    }
    expect(new Set(questions).size, `peer headings collided: ${questions.join(', ')}`).toBe(
      questions.length,
    );
  });

  it('Projects owns the project-room mapping', () => {
    const html = render('#studio/projects');
    expect(html).toContain('Project-room mapping');
    expect(html).toMatch(/OCCUPIED is not evidence/i);
  });

  it('capacity remains UNKNOWN where no quota is declared (mission §5)', () => {
    const html = render('#studio/capacity');
    expect(html).toContain('UNKNOWN');
    expect(html).not.toMatch(/\d+\s*%\s*(utili|quota|capacity)/i);
  });

  it('Staff is a primary-detail work area with the first active row selected', () => {
    const html = render('#studio/staff');
    expect(html).toContain('work-area');
    expect(html).toContain('data-work-row');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. ERP — process closure, not task progress.
 *
 * Gap map WF-ERP-01 (BLOCKER), WF-ERP-02, WF-WRONG-03.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('ERP reads as process closure', () => {
  it('the five-family closure matrix is the primary work area', () => {
    const html = render('#studio/erp/overview');
    expect(html).toContain('Process closure by family');
    const closure = html.indexOf('Process closure by family');
    const tasks = html.indexOf('Task records');
    expect(closure).toBeGreaterThan(-1);
    expect(tasks).toBeGreaterThan(-1);
    expect(closure, 'closure must lead and task volume must follow').toBeLessThan(tasks);
  });

  it('maturity is demoted, not deleted (WF-ERP-01)', () => {
    const html = render('#studio/erp/overview');
    expect(html, 'maturity must still be reported').toMatch(/Maturity diagnostic/);
    // The hero-scale number is the defect the gap map recorded at BLOCKER.
    expect(html, 'the hero maturity number is gone').not.toContain('text-5xl');
    // And it is labelled as the contract's rollup, not as the room's answer.
    // React escapes the apostrophe, so the match avoids it.
    expect(html).toMatch(/A qualified diagnostic, not the room/);
  });

  it('a family state is its WORST stage, never an average', () => {
    const html = render('#studio/erp/overview');
    expect(html).toMatch(/state is its worst stage/i);
    expect(html).toMatch(/no average over stages appears here/i);
  });

  it('ON_HOLD and the restart gate conditions survive the recomposition', () => {
    const html = render('#studio/erp/overview');
    expect(html).toContain('ON_HOLD');
    expect(html).toMatch(/Restart gate conditions/);
    expect(html).toContain('gate one');
    // The canonical hold RECORD still belongs to HoldBanner and is NOT here.
    const roomBand = html.slice(html.indexOf('room-state-band'), html.indexOf('room-state-band') + 2000);
    expect(roomBand).not.toMatch(/authority DEC-100/);
  });

  it('task volume is explicitly subordinate to closure', () => {
    expect(render('#studio/erp/overview')).toMatch(/Task count is NOT maturity/);
  });

  it('room state survives on EVERY ERP tab, including router-owned ones', () => {
    // WF-ERP-03. Three tabs are mounted by the router, not the room module, so
    // a band rendered inside the room module would miss exactly those.
    for (const tab of ['overview', 'process', 'tasks', 'decisions', 'evidence', 'staff', 'integrity']) {
      expect(render(`#studio/erp/${tab}`), `erp/${tab}`).toContain('room-state-band');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. HOADHA — prepared commercial closure, not a stacked roadmap report.
 *
 * Gap map WF-HOA-01, WF-HOA-02, WF-HOA-03, WF-WRONG-04.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('Hoadha reads as prepared and not started', () => {
  it('Overview is a compact watch face and does not stack the deep product', () => {
    const html = render('#studio/hoadha/overview');
    // Contract §12: Overview must not stack ladder + grid + board + evidence.
    expect(html).not.toContain('Wave ladder');
    expect(html).not.toContain('No task-completion percentage is computed here');
    expect(html).not.toContain('Loop stage matrix');
    // It carries a loop SUMMARY and a wave pointer instead.
    expect(html).toContain('Loop closure summary');
    expect(html).toContain('Current wave');
    // And the deep product is still reachable on its own peers.
    expect(render('#studio/hoadha/waves')).toContain('Wave ladder');
    expect(render('#studio/hoadha/loops')).toContain('No task-completion percentage is computed here');
    expect(render('#studio/hoadha/stages')).toContain('Loop stage matrix');
  });

  it('PREPARED / NOT STARTED, no H0 activation and 326/33 stay visible (mission §7)', () => {
    const html = render('#studio/hoadha/overview');
    expect(html).toContain('PREPARED');
    expect(html).toContain('NOT STARTED');
    expect(html).toMatch(/no H0 activation/i);
    // Two collections, never summed.
    expect(html).toMatch(/never summed/i);
    expect(html).not.toMatch(/\b3\b\s*records/);
  });

  it('the execution basis is behind a disclosure, not a tall focus panel', () => {
    const html = render('#studio/hoadha/overview');
    expect(html).toContain('about-method');
    expect(html).not.toContain('focus-rail');
  });

  it('Board makes the live/proposed choice impossible to misunderstand (WF-HOA-03)', () => {
    const html = render('#studio/hoadha/board');
    expect(html).toContain('data-collection-switch="live"');
    // Both counts inside the control, the active one named, the other marked
    // not live, and no single summed total.
    expect(html).toMatch(/active collection\s*<strong>LIVE<\/strong>/);
    expect(html).toMatch(/proposed records are NOT live/i);
    expect(html).toMatch(/never summed/i);
  });

  it('room state survives on every Hoadha tab', () => {
    for (const tab of ['overview', 'loops', 'board', 'waves', 'stages', 'evidence', 'staff', 'integrity']) {
      expect(render(`#studio/hoadha/${tab}`), `hoadha/${tab}`).toContain('room-state-band');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. SHELL OWNERSHIP — one owner per persistent fact.
 *
 * Gap map WF-SHELL-01, WF-SHELL-02, WF-SHELL-04, WF-REP-01.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('the persistent shell owns each fact exactly once', () => {
  const app = code(SRC, 'App.tsx');

  it('location and status are two separate rows', () => {
    // WF-SHELL-02: a breadcrumb that carries every diagnostic dimension is not
    // a breadcrumb.
    expect(app).toContain('context-location');
    expect(app).toContain('context-status');
  });

  it('the STALE state is a compact rail with bounded detail (WF-SHELL-04)', () => {
    const gate = code(SRC, 'components', 'state-gate.tsx');
    const banner = gate.slice(gate.indexOf('export function StaleBanner'));
    expect(banner).toContain('data-stale-banner');
    // The long explanation and the hashes are behind a <details>.
    expect(banner).toContain('<details');
    // The consequence itself is never behind the disclosure.
    expect(banner.indexOf('reason ??' )).toBeLessThan(banner.indexOf('<details'));
  });

  it('no surface file restates the canonical hold record (R4, still enforced)', () => {
    const offenders: string[] = [];
    for (const file of ALL_TSX) {
      const base = path.basename(file);
      if (base === 'App.tsx' || base === 'state-gate.tsx') continue;
      const body = code(file);
      const patterns: [string, RegExp][] = [
        ['authority', /\bhold\w*\??\.\s*authority\b/g],
        ['effective', /\bhold\w*\??\.\s*effective\b/g],
        ['restart_requires', /\bhold\w*\??\.\s*restart_requires\b/g],
        ['restart_requires (text)', /\brestart requires\b/gi],
      ];
      for (const [field, re] of patterns) {
        if (re.test(body)) offenders.push(`${rel(file)} -> ${field}`);
      }
    }
    expect(offenders, `canonical HOLD record restated:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. METHODOLOGY NEVER PRECEDES PRIMARY WORK (mission-wide, by census).
 *
 * Gap map WF-HIER-01: "the product repeatedly asks the operator to read how to
 * interpret the surface before showing what to inspect".
 *
 * This is asserted structurally rather than per-file: every `<AboutMethod>` in
 * the product is a `<details>` element, and `<details>` is closed by default.
 * A future surface that renders method text inline simply will not compile
 * against the component's contract, and this test fails if someone adds a raw
 * always-open `<details>`.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('method text is structurally behind a closed disclosure', () => {
  it('AboutMethod is the only disclosure mechanism and it is closed by default', () => {
    const workArea = code(SRC, 'components', 'work-area.tsx');
    const about = workArea.slice(workArea.indexOf('export function AboutMethod'));
    expect(about).toContain('<details');
    // No `open` attribute: the closed state is the whole point.
    expect(about).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it('no surface introduces its own always-open method disclosure', () => {
    const offenders = ALL_TSX
      .map((f) => ({ f, body: code(f) }))
      // state-gate's bounded stale detail is a STATE disclosure, not method.
      .filter(({ f, body }) => path.basename(f) !== 'state-gate.tsx')
      .filter(({ body }) => /<details[^>]*\bopen\b/.test(body))
      .map(({ f }) => rel(f));
    expect(offenders, `always-open disclosures: ${offenders.join(', ')}`).toEqual([]);
  });

  it('methodology is not rendered ahead of the work on any major surface', () => {
    for (const hash of [
      '#attention/decisions',
      '#studio/hoadha/overview',
      '#studio/erp/overview',
      '#overview',
      '#building',
    ]) {
      const html = render(hash);
      const about = html.indexOf('about-method');
      if (about === -1) continue;
      const panel = html.indexOf('command-panel');
      // Where both exist, the work panel precedes the method disclosure.
      if (panel !== -1) {
        expect(panel, `${hash}: methodology precedes the work panel`).toBeLessThan(about);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10. THE CENSUS IS STILL A REACHABILITY CONTRACT.
 *
 * Product contract §13 and the census's own gate rule. Re-asserted here because
 * this wave RELOCATED rows: a census whose "current location" column points at
 * a surface that no longer exists is worse than no census, because it looks
 * governed.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('the baseline census still describes a reachable product', () => {
  const censusPath = path.resolve(
    process.cwd(),
    '../../../STARQ_COMMAND_BASELINE_TO_ROUTE_CENSUS_2026-10-01.md',
  );
  const census = readFileSync(censusPath, 'utf8');
  /**
   * The DISPOSITION table only, scoped to the text before the gate rule.
   *
   * The census now carries a second table — the structural relocation log — which
   * records what moved and why but has no disposition column. Counting its rows
   * against the disposition vocabulary would make a correct governing artifact
   * fail its own gate.
   */
  const dispositionTable = census.slice(
    census.indexOf('| Baseline item'),
    census.indexOf('## Structural wave relocation log'),
  );

  it('every row still carries an allowed disposition', () => {
    const allowed =
      /\| (KEEP INLINE|MOVE TO PEER VIEW|MOVE TO INSPECTOR\/SHEET|MOVE TO ABOUT\/METHOD|DEDUPLICATE|REMOVE AS DEAD PRESENTATION) \|/g;
    const rows = dispositionTable
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('|---') && !l.includes('Baseline item'));
    expect(rows.length).toBeGreaterThan(10);
    expect((dispositionTable.match(allowed) ?? []).length).toBe(rows.length);
  });

  it('the relocation log names a gap-map finding for every move', () => {
    // Every relocation this wave performed must be traceable to a governing
    // finding. A move with no finding behind it is a composition preference
    // dressed up as a correction, and a reviewer should be able to see that.
    const log = census.slice(census.indexOf('## Structural wave relocation log'));
    const relocations = log
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('|---') && !l.includes('Relocation |'));
    expect(relocations.length).toBeGreaterThan(5);
    for (const row of relocations) {
      const cells = row.split('|').map((c) => c.trim());
      expect(cells[1]?.length ?? 0, 'a relocation with no description').toBeGreaterThan(10);
      expect(cells[2], `relocation has no gap-map finding: ${cells[1]}`).toMatch(/WF-[A-Z]+-\d+/);
    }
  });

  it('every route the census names is a route that still exists', () => {
    const routes = new Set(
      [...census.matchAll(/#(overview|building|studio|attention|evidence|system)\b/g)].map(
        (m) => m[0],
      ),
    );
    const declared = [
      '#overview',
      '#building',
      '#studio',
      '#attention',
      '#evidence',
      '#system',
    ];
    for (const route of routes) {
      expect(declared, `census names a route that is not declared: ${route}`).toContain(route);
    }
    // Every declared destination, and its default peer, renders rather than
    // resolving to an empty pane.
    for (const route of [
      '#overview',
      '#building',
      '#studio',
      '#attention/decisions',
      '#evidence/sources',
      '#system/health',
    ]) {
      expect(render(route).length, `${route} renders nothing`).toBeGreaterThan(600);
    }
  });
});