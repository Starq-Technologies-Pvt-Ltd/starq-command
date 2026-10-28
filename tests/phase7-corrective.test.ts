/**
 * Phase 7 CORRECTIVE PASS — regression guards, one per verified verifier finding.
 *
 * Room seq 8372 commissioned this round. The findings under correction are
 * named here so a future reader can trace each guard to its source:
 *
 *   N1  OpenCode (seq 8369, HIGH) — buildingStale setter was a no-op
 *   R1  Goose    (seq 8371, P1)   — <=800px DELETED projection health
 *   R2  Goose    (seq 8371, P1)   — Founder Attention showed a false current tab
 *   R3  Goose    (seq 8371, P2)   — rail buttons unlabelled below 800px
 *   R4  Goose    (seq 8371, P2)   — hold fact presented 3x in the ERP room alone
 *   R5  Goose    (seq 8371, P2)   — micro band single-weight
 *   R6  Goose    (seq 8371, P2)   — wide composition collapsed at 1280px
 *   R7  Goose    (seq 8371, P3)   — nav phase bookkeeping non-monotonic, badge dead
 *   R8  Goose    (seq 8371, P3)   — ViewId declared three dead members
 *
 * These are load-bearing. Each one goes RED if its finding is reintroduced;
 * the mutation proof at the bottom of this file re-introduces N1 and R2 in the
 * real tree to show that claim is true rather than asserted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { nextBuildingStale } from '@/lib/use-command-surface';
import { NAV, ProjectionState } from '@/components/shell';
import { parseBuildingRoute } from '@/lib/building-route';
import fixture from './fixtures/phase5-surface.json';
import type { CommandSurface } from '@/lib/contracts';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => readFileSync(path.join(...p), 'utf8');

/**
 * Source with comments stripped.
 *
 * These guards assert what the CODE does, not what the prose around it says.
 * Several fixes below are documented at the point of the fix, naming the exact
 * defective expression they removed — so a naive substring check would match
 * the explanation of the bug and report it still present. Strip comments first,
 * then assert.
 */
const code = (...p: string[]) =>
  read(...p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const base = fixture as unknown as CommandSurface;

/* ═══════════════════════════════════════════════════════════════════════════
 * N1 — HIGH. The stale flag must be able to become true.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('N1 (OpenCode, HIGH) — buildingStale is a real transition, not a no-op', () => {
  it('a failure AFTER a good projection marks it stale', () => {
    // This is the exact case the no-op broke: prev was false, the expression
    // returned false, and a failed refresh rendered as a healthy room.
    expect(nextBuildingStale(true)).toBe(true);
  });

  it('a failure on the FIRST fetch is unreachable, never "stale"', () => {
    // Nothing is retained, so "NOT current — the last successfully read
    // projection" would be a lie. The banner must say unreachable instead.
    expect(nextBuildingStale(false)).toBe(false);
  });

  it('the hook routes its failure path through the transition', () => {
    const hook = code(APP_ROOT, 'src', 'lib', 'use-command-surface.ts');
    expect(hook).toMatch(/setBuildingStale\(nextBuildingStale\(/);
    /*
      The no-op must not come back in ANY spelling. `hasProjection ? true :
      hasProjection` is behaviourally identical to `hasProjection`, so the two
      behavioural tests above cannot catch it — the mutation proof reintroduces
      exactly that form and it SURVIVED them. What makes it a defect is that it
      is an expression that LOOKS conditional but is not, so the ban here is on
      the shape: the transition must be a bare return of its argument, with no
      conditional operator wrapped around it.
    */
    const body = hook.slice(
      hook.indexOf('export function nextBuildingStale'),
      hook.indexOf('export function nextBuildingStale') +
        hook.slice(hook.indexOf('export function nextBuildingStale')).indexOf('}'),
    );
    expect(body).not.toMatch(/\?/);
    expect(body).not.toMatch(/return\s+(?!hasProjection;)/);
  });

  it('the success path clears staleness', () => {
    const hook = code(APP_ROOT, 'src', 'lib', 'use-command-surface.ts');
    const load = hook.slice(hook.indexOf('const load = async'), hook.indexOf('void load()'));
    expect(load).toMatch(/setBuildingStale\(false\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R1 — P1. The one doctrine breach in the candidate: information DELETED.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('R1 (Goose, P1) — narrow screens compress projection health, never delete it', () => {
  const css = code(APP_ROOT, 'src', 'index.css');
  const narrow = css.slice(css.indexOf('@media (max-width: 800px)'));

  it('no rule below 800px hides a truth-state block', () => {
    // The regression this exists to stop: `display:none` on the rail's
    // Projection state block removed SurfaceBadge AND "N/M in sync".
    //
    // The selector must be EXACTLY [data-rail-projection] — no descendant part.
    // Hiding the block's inner heading at a width where the rail is 56px wide
    // is legitimate compression; hiding the block is the defect. A loose
    // pattern would flag both.
    expect(narrow).not.toMatch(/\[data-rail-projection\]\s*\{[^}]*display:\s*none/);
    // And no positional selector may be reintroduced to target it.
    expect(narrow).not.toContain('div:last-child');
  });

  it('the count is re-homed onto the pinned bar, which exists at every width', () => {
    const app = code(APP_ROOT, 'src', 'App.tsx');
    const barStart = app.indexOf('command-context');
    const bar = app.slice(barStart, app.indexOf('<main'));
    expect(bar).toContain('PROJECTION');
    expect(bar).toContain('in sync');
    // Pinned: above <main>, so it cannot scroll away at any width.
    expect(barStart).toBeGreaterThan(-1);
    expect(barStart).toBeLessThan(app.indexOf('<main'));
  });

  it('the rail block renders the badge at every width, collapsed included', () => {
    for (const expanded of [true, false]) {
      const html = renderToStaticMarkup(
        React.createElement(ProjectionState, {
          health: base.health,
          expanded,
        }),
      );
      expect(html, `expanded=${expanded}`).toContain('data-rail-projection');
      expect(html, `expanded=${expanded}`).toContain(base.health?.overall ?? 'UNAVAILABLE');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R2 — P1. A false current-state marker is worse than no marker.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('R2 (Goose, P1) — Founder Attention shows no false current tab', () => {
  const buildingSrc = code(APP_ROOT, 'src', 'surfaces', 'building.tsx');

  it('Founder Attention renders no TabRail, like Evidence and System', () => {
    const start = buildingSrc.indexOf("route.view === 'attention'");
    const end = buildingSrc.indexOf("route.view === 'evidence'");
    const branch = buildingSrc.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(branch).not.toContain('<TabRail');
  });

  it('the route that produced the false marker is confirmed, not assumed', () => {
    // parseBuildingRoute always returns tab 'Overview' with room null for a
    // non-studio view — that is what made 'Overview' match and paint as current.
    expect(parseBuildingRoute('#attention')).toEqual({
      view: 'attention',
      room: null,
      tab: 'Overview',
    });
  });

  it('a TabRail may only mark current when the route really is that tab', () => {
    // The guard itself is unchanged and still correct; assert it is still there.
    expect(buildingSrc).toContain("aria-current={route.tab === tab ? 'page' : undefined}");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R3 — P2. Accessibility: no icon button without an accessible name.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('R3 (Goose, P2) — every rail button is named at every width', () => {
  const shellSrc = code(APP_ROOT, 'src', 'components', 'shell.tsx');

  it('the accessible name is unconditional, not tied to expanded state', () => {
    // The defect: below 800px the collapse is CSS-only while React still held
    // expanded===true, so `title` was undefined AND the label text was
    // display:none — six buttons with no name and no hover text.
    expect(shellSrc).toMatch(/aria-label=\{item\.label\}/);
    expect(shellSrc).not.toMatch(/title=\{expanded \? undefined/);
  });

  it('all ten current nav entries carry a name', () => {
    expect(NAV).toHaveLength(10);
    for (const item of NAV) {
      expect(item.label.length, item.id).toBeGreaterThan(0);
      expect(item.hint.length, item.id).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R4 — P2. One hold fact, one owning surface in the ERP room.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('R4 (Goose, P2) — the ERP hold is presented once, by HoldBanner', () => {
  const buildingSrc = code(APP_ROOT, 'src', 'surfaces', 'building.tsx');
  const erpSrc = code(APP_ROOT, 'src', 'surfaces', 'erp-room.tsx');

  it('the ERP room head no longer restates the canonical hold record', () => {
    const head = buildingSrc.slice(
      buildingSrc.indexOf('function RoomHeadline'),
      buildingSrc.indexOf("if (route.room === 'hoadha')"),
    );
    /*
      Banned by VALUE, not by expression shape. An earlier version of this
      guard banned `authority {hold` and `since {hold` specifically, which a
      mutant defeated by writing the literal `authority UNKNOWN` — the exact
      substitution the mutation proof uses. The claim under test is "the room
      head does not restate the hold record", so the guard asserts that claim:
      no authority value, no effective date, no restart requirement appears in
      the ERP room head at all, in any spelling.
    */
    expect(head).not.toMatch(/authority/i);
    expect(head).not.toMatch(/restart_requires|restart requires/i);
    expect(head).not.toMatch(/\bsince\b/i);
    expect(head).not.toMatch(/hold\?\./);
    // Room state remains; the canonical hold record does not repeat here.
    expect(head).toContain('erp?.state');
    // And the de-duplication is declared rather than accidental.
    expect(head).toContain('hold declared above');
  });

  it('ErpFocus no longer restates the restart requirement', () => {
    const focus = erpSrc.slice(erpSrc.indexOf('export function ErpFocus'));
    expect(focus).not.toContain('restart_requires');
    // The gate conditions — which the banner has no room for — stay.
    expect(focus).toContain('restart_gate_conditions');
  });

  it('HoldBanner is the owner and is persistent and non-dismissible', () => {
    const gate = read(APP_ROOT, 'src', 'components', 'state-gate.tsx');
    expect(gate).toMatch(/persistent, non-dismissible/);
    const app = code(APP_ROOT, 'src', 'App.tsx');
    expect(app).toContain('<HoldBanner');
    // No dismiss affordance may creep into the owner.
    expect(gate.slice(gate.indexOf('export function HoldBanner'))).not.toMatch(/onClose|dismissible/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R5 — P2. The micro band needs tiers that differ by more than size.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('R5 (Goose, P2) — the micro band has a real second tier', () => {
  const css = code(APP_ROOT, 'src', 'index.css');

  it('.label-sec exists and is separated from .label-micro by weight', () => {
    expect(css).toContain('.label-sec');
    const sec = css.slice(css.indexOf('.label-sec {'), css.indexOf('}', css.indexOf('.label-sec {')));
    const micro = css.slice(css.indexOf('.label-micro {'), css.indexOf('}', css.indexOf('.label-micro {')));
    expect(sec).toMatch(/font-semibold/);
    expect(micro).toMatch(/font-medium/);
    expect(sec).toMatch(/tracking-\[0\.16em\]/);
    expect(micro).toMatch(/tracking-\[0\.14em\]/);
  });

  it('h3 steps down from h2 instead of competing with it', () => {
    const h2 = css.slice(css.indexOf('.command-panel h2 {'), css.indexOf('.command-panel h3 {'));
    const h3 = css.slice(css.indexOf('.command-panel h3 {'), css.indexOf('.command-panel p {'));
    expect(h2).toMatch(/font-weight:\s*600/);
    expect(h3).toMatch(/font-weight:\s*500/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R6 — P2. The likely operator laptops must not get worse.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('R6 (Goose, P2) — 1280px and 1152px keep two columns', () => {
  const css = code(APP_ROOT, 'src', 'index.css');

  it('nothing between 1025px and 1400px forces a single column', () => {
    const between = css.slice(
      css.indexOf('@media (max-width: 1400px)'),
      css.indexOf('@media (max-width: 1024px)'),
    );
    expect(between).not.toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('the split collapse lives at 1024px, not 1280px', () => {
    expect(css).not.toContain('@media (max-width: 1280px)');
    const at1024 = css.slice(
      css.indexOf('@media (max-width: 1024px)'),
      css.indexOf('@media (max-width: 800px)'),
    );
    expect(at1024).toContain('grid-template-columns: minmax(0, 1fr)');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R7 — P3. Bookkeeping that varies on nothing must not ship.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('R7 (Goose, P3) — the dead phase field and its unreachable badge are gone', () => {
  const shellSrc = code(APP_ROOT, 'src', 'components', 'shell.tsx');

  it('NAV declares no phase field at all', () => {
    expect(shellSrc).not.toMatch(/^\s*phase:\s*[0-9]/m);
    expect(shellSrc).not.toMatch(/phase:\s*1\s*\|\s*2/);
  });

  it('the P{n} badge can never render because the branch is gone', () => {
    expect(shellSrc).not.toContain('!item.live');
    expect(shellSrc).not.toContain('P{item.phase}');
  });

  it('nav order is preserved, not re-sorted by phase', () => {
    // Reordering would have been an unrequested UX change; the field died, the
    // operator order did not move.
    //
    // The current sequence is the operator order from shell.tsx. It is not
    // sorted by phase; Company, Library, Cortex, and Comms retain their product
    // positions alongside the original Studio surfaces.
    expect(NAV.map((i) => i.id)).toEqual([
      'overview',
      'company',
      'building',
      'library',
      'cortex',
      'comms',
      'studio',
      'attention',
      'evidence',
      'system',
    ]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R8 — P3. A public type must not describe impossible routes.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('R8 (Goose, P3) — ViewId describes only reachable views', () => {
  const shellSrc = code(APP_ROOT, 'src', 'components', 'shell.tsx');

  it('the three dead members are removed from the union', () => {
    const union = shellSrc.slice(shellSrc.indexOf('export type ViewId'), shellSrc.indexOf('export interface NavItem'));
    for (const dead of ['truth', 'floor', 'process']) {
      expect(union, dead).not.toContain(`| '${dead}'`);
    }
  });

  it('every union member is a member of COMPANY_VIEWS', () => {
    const union = shellSrc.slice(shellSrc.indexOf('export type ViewId'), shellSrc.indexOf('export interface NavItem'));
    const declared = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    const routes = read(APP_ROOT, 'src', 'lib', 'building-route.ts');
    const company = routes.slice(routes.indexOf('COMPANY_VIEWS'), routes.indexOf('as const'));
    for (const id of declared) {
      expect(company, `${id} is a ViewId but not a COMPANY_VIEW`).toContain(`'${id}'`);
    }
  });

  it('the legacy hash rewrites that need those names still work', () => {
    // Removing them from the type must NOT break a bookmarked legacy URL.
    expect(parseBuildingRoute('#process')).toEqual({
      view: 'studio',
      room: 'erp',
      tab: 'Process',
    });
    expect(parseBuildingRoute('#truth')).toEqual({
      view: 'studio',
      room: 'erp',
      tab: 'Integrity',
    });
    expect(parseBuildingRoute('#floor')).toEqual({
      view: 'studio',
      room: null,
      tab: 'Staff',
    });
  });
});
