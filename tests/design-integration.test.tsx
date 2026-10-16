import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { SessionsBoard, type HerdrPaneRow } from '@/components/sessions-board';
import { StaffGlance } from '@/components/staff-glance';
import type { RosterCounts, Sessions } from '@/lib/contracts';

const declaredSessions: Sessions = {
  available: true,
  state: 'OK',
  count: 1,
  source: 'agent-comms/session-leases.json',
  byHandle: {
    copilot: {
      handle: 'copilot',
      instance_id: 'lease-copilot-01',
      hostname: 'command-host',
      pid: null,
      label: null,
      claimed_at: '2026-10-10T12:00:00Z',
      last_seen_at: '2026-10-10T12:05:00Z',
    },
  },
};

const paneRows: readonly HerdrPaneRow[] = [
  {
    declared: {
      id: 'pane-copilot',
      handle: 'copilot',
      source: 'herdr-floor.manifest.json',
    },
    live: {
      state: 'OBSERVED',
      source: '/api/herdr/state',
      detail: 'broker reported this pane',
    },
  },
];

function render(sessions: Sessions, panes: readonly HerdrPaneRow[]) {
  return renderToStaticMarkup(<SessionsBoard sessions={sessions} panes={panes} />);
}

describe('CMD-DI-1-2 — SessionsBoard', () => {
  it('renders declared lease fields with their source', () => {
    const html = render(declaredSessions, paneRows);

    expect(html).toContain('Sessions');
    expect(html).toContain('lease-copilot-01');
    expect(html).toContain('copilot');
    expect(html).toContain('command-host');
    expect(html).toContain('2026-10-10T12:00:00Z');
    expect(html).toContain('agent-comms/session-leases.json');
  });

  it('renders manifest declarations and live observations as separate pane fields', () => {
    const html = render(declaredSessions, paneRows);

    expect(html).toContain('Herdr panes');
    expect(html).toContain('DECLARED PANE');
    expect(html).toContain('pane-copilot');
    expect(html).toContain('herdr-floor.manifest.json');
    expect(html).toContain('LIVE STATE');
    expect(html).toContain('OBSERVED');
    expect(html).toContain('/api/herdr/state');
    expect(html).toContain('broker reported this pane');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<input');
  });

  it('renders unavailable session and live-pane evidence without a zero default', () => {
    const unavailable: Sessions = {
      available: false,
      state: 'UNAVAILABLE',
      reason: 'lease source was not reachable',
      count: 0,
      source: 'agent-comms/session-leases.json',
      byHandle: {},
    };
    const html = render(unavailable, [
      {
        declared: {
          id: 'pane-without-live-observation',
          handle: null,
          source: 'herdr-floor.manifest.json',
        },
        live: null,
      },
    ]);

    expect(html).toContain('lease source was not reachable');
    expect(html).toContain('data-sessions-availability="UNAVAILABLE"');
    expect(html).toContain('data-pane-live-state="UNAVAILABLE"');
    expect(html).toContain('UNAVAILABLE');
    expect(html).not.toContain('>0<');
  });
});

const censusWithActiveStaff: RosterCounts = {
  observed: 4,
  active_staff: 4,
  retired: 0,
  system: 0,
  unknown_identity: 0,
  conflicted: 0,
  with_duty_record: 0,
  with_session: 0,
  execution_and_duty_both_present: 0,
  truth_disagreements: 0,
  canonical_seats: 0,
  canonical_observed: 0,
  canonical_not_observed: 0,
  suppressed: 0,
  herdr_host_conflicts: 0,
  herdr_seats_without_manifest_row: 0,
};

function glanceCells(html: string) {
  const cells: { state: string; availability: string; count: string }[] = [];
  const re = /<li\b([^>]*)>([\s\S]*?)<\/li>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const state = /data-glance-state="([^"]+)"/.exec(match[1])?.[1];
    const availability = /data-glance-availability="([^"]+)"/.exec(match[1])?.[1];
    if (!state || !availability) continue;
    const count = /<span class="mt-1[^"]*">([^<]*)<\/span>/.exec(match[2])?.[1] ?? '';
    cells.push({ state, availability, count });
  }
  return cells;
}

describe('CMD-DI-1-1 — StaffGlance', () => {
  it('renders all six states, the status bar, and UNKNOWN when buckets are omitted', () => {
    const html = renderToStaticMarkup(<StaffGlance staff={[]} counts={null} />);
    const cells = glanceCells(html);

    expect(cells.map((cell) => cell.state)).toEqual([
      'WORKING',
      'IDLE',
      'BLOCKED',
      'AWAITING_REVIEW',
      'UNAVAILABLE',
      'UNKNOWN',
    ]);
    expect(cells.every((cell) => cell.availability === 'UNAVAILABLE')).toBe(true);
    expect(cells.every((cell) => cell.count === 'UNKNOWN')).toBe(true);
    expect(html.match(/data-glance-bar="/g)?.length).toBe(6);
    expect(cells.some((cell) => cell.availability === 'declared')).toBe(false);
    expect(cells.some((cell) => cell.count === '0')).toBe(false);
  });

  it('renders an explicit zero as a declared WORKING count', () => {
    const html = renderToStaticMarkup(
      <StaffGlance staff={[]} counts={null} buckets={{ working: 0 }} />,
    );
    const cells = glanceCells(html);
    const working = cells.find((cell) => cell.state === 'WORKING');

    expect(working).toEqual({ state: 'WORKING', availability: 'declared', count: '0' });
    expect(cells.filter((cell) => cell.state !== 'WORKING').every((cell) => cell.count === 'UNKNOWN')).toBe(true);
    expect(cells.filter((cell) => cell.state !== 'WORKING').every((cell) => cell.availability === 'UNAVAILABLE')).toBe(true);
  });

  it('rejects null, negative, NaN, and absent buckets', () => {
    const html = renderToStaticMarkup(
      <StaffGlance
        staff={[]}
        counts={null}
        buckets={{ working: 2, idle: null, blocked: -1, awaiting_review: Number.NaN }}
      />,
    );
    const cells = glanceCells(html);

    expect(cells.find((cell) => cell.state === 'WORKING')).toEqual({
      state: 'WORKING',
      availability: 'declared',
      count: '2',
    });
    for (const state of ['IDLE', 'BLOCKED', 'AWAITING_REVIEW', 'UNAVAILABLE', 'UNKNOWN']) {
      expect(cells.find((cell) => cell.state === state)).toMatchObject({
        availability: 'UNAVAILABLE',
        count: 'UNKNOWN',
      });
    }
  });

  it('does not copy RosterCounts onto glance labels', () => {
    const html = renderToStaticMarkup(
      <StaffGlance staff={[]} counts={censusWithActiveStaff} buckets={null} />,
    );
    const cells = glanceCells(html);

    expect(html).toContain('Duty buckets are UNAVAILABLE');
    expect(html).toContain('census forwarded');
    expect(html).toContain('This view does not classify identities.');
    expect(cells.every((cell) => cell.count === 'UNKNOWN')).toBe(true);
    expect(cells.some((cell) => cell.count === '4')).toBe(false);
    expect(html).not.toContain('active_staff');
  });

  it('states roster forwarded and census UNAVAILABLE', () => {
    const html = renderToStaticMarkup(<StaffGlance staff={[]} counts={null} />);

    expect(html).toContain('Roster forwarded');
    expect(html).toContain('census UNAVAILABLE');
  });

  it('stays props-only with no computed color literals', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/staff-glance.tsx'),
      'utf8',
    );

    expect(source).not.toMatch(/\buseState\b/);
    expect(source).not.toMatch(/\buseEffect\b/);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/rgb\s*\(/);
    expect(source).not.toMatch(/hsl\s*\(/);
  });
});

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)[ \\t]*${escaped} \\{`).exec(css);
  expect(match, selector).not.toBeNull();
  const start = match!.index;
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

describe('CMD-DI-1-3 — typography selectors', () => {
  it('names the ladder and applies it to the measured stat, KV, and footnote selectors', () => {
    expect(cssBlock('.tier-micro')).toContain('font-size: 10px');
    expect(cssBlock('.tier-micro')).toContain('font-weight: 500');
    expect(cssBlock('.tier-body')).toContain('font-size: 13px');
    expect(cssBlock('.tier-body')).toContain('font-weight: 400');
    expect(cssBlock('.tier-body-strong')).toContain('font-size: 13px');
    expect(cssBlock('.tier-body-strong')).toContain('font-weight: 600');
    expect(cssBlock('.tier-label')).toContain('font-size: 11px');
    expect(cssBlock('.tier-label-mono')).toContain('font-size: 11px');
    expect(cssBlock('.tier-label-mono')).toContain("theme('fontFamily.mono')");
    expect(cssBlock('.tier-label-mono')).toContain('letter-spacing: 0.02em');
    expect(cssBlock('.tier-answer')).toContain('font-size: 21px');
    expect(cssBlock('.tier-title')).toContain('font-size: 25px');

    expect(cssBlock('.stat .v')).toContain('font-size: 13px');
    expect(cssBlock('.stat .v')).toContain('font-weight: 600');
    const primary = cssBlock(".stat[data-rank='primary'] .v");
    expect(primary).toContain('font-size: 13px');
    expect(primary).not.toContain('18px');
    expect(primary).not.toContain('font-weight:');
    const unknown = cssBlock('.stat .v.unknown');
    expect(unknown).toContain('font-size: 11px');
    expect(unknown).toContain('hsl(var(--truth-unknown))');
    expect(unknown).not.toContain('11.5px');
    expect(cssBlock('.stat .k')).toContain('font-size: 11px');
    expect(cssBlock('.stat .s')).toContain('font-size: 10px');
    expect(cssBlock('.kv dt')).toContain('font-size: 11px');
    const kvValue = cssBlock('.kv dd');
    expect(kvValue).toContain('font-size: 11px');
    expect(kvValue).toContain("theme('fontFamily.mono')");
    expect(kvValue).toContain('letter-spacing: 0.02em');
    const drawerTerm = cssBlock('.command-drawer .kv dt');
    expect(drawerTerm).toContain('font-size: 11px');
    expect(drawerTerm).not.toContain('9.5px');
    const drawerValue = cssBlock('.command-drawer .kv dd');
    expect(drawerValue).toContain('font-size: 11px');
    expect(drawerValue).toContain("theme('fontFamily.mono')");
    expect(drawerValue).toContain('letter-spacing: 0.02em');
    expect(cssBlock('.command-panel caption')).toContain('font-size: 10px');
  });

  it('keeps the Phase 7 micro band and drops the 600px stat-size overrides', () => {
    expect(cssBlock('.label-micro')).toContain('text-micro');
    expect(cssBlock('.label-micro')).toContain('font-medium');
    expect(cssBlock('.label-micro')).toContain('tracking-[0.14em]');
    expect(cssBlock('.label-sec')).toContain('font-semibold');
    expect(cssBlock('.label-sec')).toContain('tracking-[0.16em]');

    const phone = css.indexOf('PHONE PORTRAIT');
    const narrow = css.slice(css.indexOf('@media (max-width: 600px)', phone));
    expect(narrow).toContain('repeat(2, minmax(0, 1fr))');
    expect(narrow).not.toContain('.stat .v');
    expect(narrow).not.toContain(".stat[data-rank='primary'] .v");
    expect(css).toContain('@media (max-width: 800px)');
    const panel = css.slice(css.indexOf('@media (max-width: 800px)'));
    expect(panel).toContain('.command-panel .command-table-wrap');
    expect(panel).toContain('overflow-x: auto');
  });
});
