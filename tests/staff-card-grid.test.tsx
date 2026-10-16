/**
 * @vitest-environment jsdom
 */
/**
 * CMD-DI-2-1 — card / grid / status filter render coverage, plus the view-switch
 * scroll check. Static markup cannot click a control or read scrollTop.
 * The scroll test zeros the scroller during the view commit, then requires a
 * later write of the captured position. Passive preservation fails that check.
 *
 * These tests do not rewrite staff-board known-red expectations. They use a
 * stub roster so a live-data drift cannot be papered over by a looser assertion.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CommandSurface, RosterEntry, TruthDisagreement } from '@/lib/contracts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import {
  StaffRosterCards,
  StaffRosterGrid,
  StaffSurface,
  matchesDeclaredStaffStatus,
} from '@/surfaces/staff';

function disagreement(duty: string, execution: string): TruthDisagreement {
  return {
    values_differ: duty !== execution,
    execution_side: { source: 'activity.json', value: execution },
    duty_side: { source: 'staff-state.json', value: duty },
    resolution: 'NOT RESOLVED BY COMMAND — both canonical values are rendered as recorded',
  };
}

function seat(partial: Partial<RosterEntry> & Pick<RosterEntry, 'handle'>): RosterEntry {
  return {
    identity_present: true,
    identity_status: 'active',
    display_name: partial.handle,
    role: 'UNKNOWN',
    authority_level: 'UNKNOWN',
    is_legacy: false,
    is_revoked: false,
    staff_classification: 'STAFF',
    counts_as_active_staff: true,
    is_retired: false,
    is_system: false,
    is_active_staff: true,
    is_canonical_seat: true,
    staff_profile: null,
    suppression_reason: null,
    suppressed_from_main_staff_surface: false,
    herdr: null,
    herdr_host_conflict: false,
    current_state: 'UNKNOWN',
    current_state_confidence: 'UNKNOWN',
    activity_freshness: 'UNKNOWN',
    last_activity_at: null,
    last_meaningful_seq: null,
    lifetime_events: 0,
    hours_since_last_activity_at_ingest: null,
    mentioned_task_count: 0,
    execution_current_task: null,
    execution_task_confidence: 'UNKNOWN',
    execution_task_source: null,
    execution_current_assignment: null,
    execution_assignment_confidence: 'UNKNOWN',
    execution_assignment_source: null,
    duty_state: 'UNKNOWN',
    duty_current_task: null,
    duty_capacity_note: null,
    duty_capacity_reset_at: null,
    duty_restrictions: null,
    duty_last_updated_at: null,
    duty_last_updated_by: null,
    duty_evidence_count: 0,
    truth_disagreement: null,
    has_session: false,
    session: null,
    has_duty_record: false,
    conflict_types: [],
    has_conflict: false,
    ...partial,
  };
}

const working = seat({
  handle: 'seat-working',
  duty_state: 'WORKING',
  current_state: 'UNKNOWN',
  duty_current_task: 'DUTY-TASK-1',
  execution_current_task: 'EXEC-TASK-9',
  duty_capacity_note: 'declared capacity note',
  truth_disagreement: disagreement('DUTY-TASK-1', 'EXEC-TASK-9'),
});

const offline = seat({
  handle: 'seat-offline',
  duty_state: 'OFFLINE',
  current_state: 'active',
  is_active_staff: false,
});

const blocked = seat({
  handle: 'seat-blocked',
  duty_state: 'OFFLINE',
  current_state: 'BLOCKED',
});

describe('CMD-DI-2-1 status filter uses declared tokens only', () => {
  it('matches Working only when duty or current state is already that token', () => {
    expect(matchesDeclaredStaffStatus(working, 'WORKING')).toBe(true);
    expect(matchesDeclaredStaffStatus(offline, 'WORKING')).toBe(false);
    expect(matchesDeclaredStaffStatus(blocked, 'BLOCKED')).toBe(true);
    expect(matchesDeclaredStaffStatus(offline, 'UNAVAILABLE')).toBe(false);
    expect(matchesDeclaredStaffStatus(seat({ handle: 'blank', duty_state: '', current_state: '' }), 'UNAVAILABLE')).toBe(
      false,
    );
    expect(matchesDeclaredStaffStatus(seat({ handle: 'unk', duty_state: 'UNKNOWN' }), 'UNAVAILABLE')).toBe(false);
    expect(
      matchesDeclaredStaffStatus(
        seat({ handle: 'review', duty_state: 'Awaiting review' }),
        'AWAITING_REVIEW',
      ),
    ).toBe(true);
    expect(matchesDeclaredStaffStatus(offline, 'ALL')).toBe(true);
  });

  it('does not treat a longer source token as Unavailable', () => {
    expect(
      matchesDeclaredStaffStatus(
        seat({ handle: 'long', duty_state: 'UNAVAILABLE_UNTIL_RESET' }),
        'UNAVAILABLE',
      ),
    ).toBe(false);
  });
});

describe('CMD-DI-2-1 card and grid render the same declared roster facts', () => {
  it('card view is a two-column roster and keeps duty apart from execution', () => {
    const html = renderToStaticMarkup(
      <StaffRosterCards entries={[working, offline]} selectedHandle={working.handle} onSelect={() => undefined} />,
    );
    expect(html).toContain('data-staff-cards=""');
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('data-staff-card="seat-working"');
    expect(html).toContain('data-staff-card="seat-offline"');
    expect(html).toContain('data-lane="duty"');
    expect(html).toContain('data-lane="execution"');
    expect(html).toContain('declared capacity note');
    expect(html).toContain('WORKING');
    expect(html).toContain('OFFLINE');
    expect(html).toContain('data-truth-disagreement="duty-ne-execution"');
    expect(html).toContain('Duty ≠ Execution');
    expect(html).toContain('DUTY-TASK-1');
    expect(html).toContain('EXEC-TASK-9');
    expect(html).not.toContain('DUTY-TASK-1 / EXEC-TASK-9');
  });

  it('grid view renders the same handles, status, capacity note and disagreement', () => {
    const html = renderToStaticMarkup(<StaffRosterGrid entries={[working]} />);
    expect(html).toContain('data-staff-grid=""');
    expect(html).toContain('data-staff-grid-row="seat-working"');
    expect(html).toContain('declared capacity note');
    expect(html).toContain('Duty ≠ Execution');
    expect(html).toContain('DUTY-TASK-1');
    expect(html).toContain('EXEC-TASK-9');
  });

  it('a Working filter does not pull an OFFLINE seat into the grid', () => {
    const shown = [working, offline, blocked].filter((entry) => matchesDeclaredStaffStatus(entry, 'WORKING'));
    const html = renderToStaticMarkup(<StaffRosterGrid entries={shown} />);
    expect(html).toContain('seat-working');
    expect(html).not.toContain('seat-offline');
    expect(html).not.toContain('seat-blocked');
  });
});

describe('CMD-DI-2-1 Staff surface defaults to the existing roster', () => {
  const surface = {
    floor: {
      staff: {
        canonical_seats: [working, offline],
        suppressed_count: 0,
        suppressed: [],
        accounting: 'COMPLETE',
        session_leases: { holders_count: 0 },
      },
      roster: { entries: [working, offline], counts: { observed: 2 } },
      constraints: [],
    },
  } as unknown as CommandSurface;

  it('opens on the table work area with card, grid and status controls present', () => {
    const html = renderToStaticMarkup(<StaffSurface surface={surface} />);
    expect(html).toMatch(/data-staff-view="table"[^>]*aria-pressed="true"/);
    expect(html).toContain('Card view');
    expect(html).toContain('Grid view');
    expect(html).toContain('data-staff-status="ALL"');
    expect(html).toContain('data-staff-status="WORKING"');
    expect(html).toContain('data-staff-status="AWAITING_REVIEW"');
    expect(html).toContain('data-staff-status="BLOCKED"');
    expect(html).toContain('data-staff-status="UNAVAILABLE"');
    expect(html).toContain('Awaiting review');
    expect(html).toContain('work-area');
    expect(html).toContain('data-work-row');
    expect(html).not.toContain('data-staff-cards');
    expect(html).not.toContain('data-staff-grid');
    expect(html).toContain('not reclassified');
  });
});

describe('CMD-DI-2-1 view switch keeps the main scroller position', () => {
  const surface = {
    floor: {
      staff: {
        canonical_seats: [working, offline],
        suppressed_count: 0,
        suppressed: [],
        accounting: 'COMPLETE',
        session_leases: { holders_count: 0 },
      },
      roster: { entries: [working, offline], counts: { observed: 2 } },
      constraints: [],
    },
  } as unknown as CommandSurface;

  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      const mounted = root;
      root = null;
      act(() => {
        mounted.unmount();
      });
    }
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('restores #command-main scrollTop after the view commit disturbs it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    const main = document.createElement('main');
    main.id = 'command-main';
    document.body.appendChild(main);
    root = createRoot(main);

    await act(async () => {
      root?.render(<StaffSurface surface={surface} />);
    });

    const captured = 480;
    let position = captured;
    const writes: number[] = [];
    let armed = false;
    let disturbCursor = -1;
    Object.defineProperty(main, 'scrollTop', {
      configurable: true,
      get() {
        return position;
      },
      set(value: number) {
        position = Number(value);
        writes.push(position);
      },
    });
    main.scrollTop = captured;
    expect(main.scrollTop).toBe(captured);
    writes.length = 0;

    const proto = Node.prototype;
    const originalAppend = proto.appendChild;
    const originalInsert = proto.insertBefore;
    const originalRemove = proto.removeChild;
    const disturb = (parent: Node) => {
      if (!armed || !(parent instanceof Element) || !main.contains(parent)) return;
      position = 0;
      disturbCursor = writes.length;
    };
    proto.appendChild = function <T extends Node>(this: Node, node: T): T {
      const result = originalAppend.call(this, node) as T;
      disturb(this);
      return result;
    };
    proto.insertBefore = function <T extends Node>(this: Node, node: T, child: Node | null): T {
      const result = originalInsert.call(this, node, child) as T;
      disturb(this);
      return result;
    };
    proto.removeChild = function <T extends Node>(this: Node, child: T): T {
      const result = originalRemove.call(this, child) as T;
      disturb(this);
      return result;
    };

    const card = main.querySelector('button[data-staff-view="card"]');
    expect(card).toBeInstanceOf(HTMLButtonElement);
    expect(main.querySelector('[data-staff-view="table"]')?.getAttribute('aria-pressed')).toBe('true');
    armed = true;

    try {
      await act(async () => {
        card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    } finally {
      proto.appendChild = originalAppend;
      proto.insertBefore = originalInsert;
      proto.removeChild = originalRemove;
    }

    expect(main.querySelector('[data-staff-view="card"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(main.querySelector('[data-staff-cards]')).not.toBeNull();
    expect(main.querySelector('[data-staff-view="table"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(disturbCursor).toBeGreaterThanOrEqual(0);
    expect(writes.slice(disturbCursor)).toContain(captured);
    expect(main.scrollTop).toBe(captured);
  });
});
