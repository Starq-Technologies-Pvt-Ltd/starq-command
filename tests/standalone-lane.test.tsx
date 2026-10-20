import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ObservedStandaloneLane, type HerdrSessionState } from '../src/surfaces/herdr';

type Standalone = HerdrSessionState['standalone'];

const boundRow = {
  attribution: 'BOUND' as const,
  binding_state: 'BOUND' as const,
  seat_id: 'elder',
  binding: { bound_by: 'mustarq', authority: 'OPERATOR_INTERACTIVE', bound_at: '2026-10-04T00:00:00.000Z' },
  observed_by_herdr: true,
  broker_owned: false as const,
  floor_launched: false as const,
  broker_session: null,
  broker_pid: null,
  authority_effect: 'NONE' as const,
  pane: {
    pane_id: 'w2:p1', workspace_id: 'w2', terminal_id: 'term_65cf506a821161',
    terminal_title_stripped: 'Boot context audit', cwd: 'D:\\starqtech', agent_status: 'unknown',
  },
};

const anonRow = {
  ...boundRow,
  attribution: 'UNATTRIBUTED' as const,
  binding_state: null,
  seat_id: null,
  binding: null,
};

const render = (standalone: Standalone) =>
  renderToStaticMarkup(<ObservedStandaloneLane standalone={standalone} />);

describe('ObservedStandaloneLane', () => {
  it('renders a bound pane as seat elder, observed and NOT broker-owned', () => {
    const html = render({ herdr_state: 'AVAILABLE', bindings_state: 'OK', panes: [boundRow] });
    expect(html).toContain('elder');
    expect(html).toContain('BOUND');
    expect(html).toContain('not broker-owned');
    expect(html).toContain('OPERATOR_INTERACTIVE');
    // never surfaces a PID or PTY session for a standalone pane
    expect(html).not.toContain('session_id');
    expect(html).toContain('authority NONE');
  });

  it('renders an unbound pane as anonymous, never guessed into a seat', () => {
    const html = render({ herdr_state: 'AVAILABLE', bindings_state: 'OK', panes: [anonRow] });
    expect(html).toContain('UNATTRIBUTED');
    expect(html).toContain('anonymous');
  });

  it('fails closed when Herdr is not AVAILABLE (panes null)', () => {
    const html = render({ herdr_state: 'ERROR', bindings_state: 'OK', panes: null });
    expect(html).toContain('fails closed');
  });

  it('shows the invariant banner', () => {
    const html = render({ herdr_state: 'AVAILABLE', bindings_state: 'OK', panes: [] });
    expect(html).toContain('Observation');
    expect(html).toContain('No standalone panes observed');
  });
});
