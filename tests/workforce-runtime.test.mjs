import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWorkforce } from '../server/workforce-runtime.mjs';

const observed = (overrides = {}) => ({
  timestamp: '2026-10-28T06:00:00.000Z',
  broker: { online: true, boot_id: 'boot-test' },
  herdr: { state: 'AVAILABLE' },
  agents: [],
  sessions: [],
  standalone: { bindings_state: 'OK', panes: [] },
  ...overrides,
});

test('projects exactly the canonical staff profile and leaves missing seats unjoined', () => {
  const result = projectWorkforce(observed());
  assert.equal(result.state, 'OBSERVED');
  assert.equal(result.declared_seat_count, 10);
  assert.equal(result.seats.length, 10);
  assert.equal(result.seats.find((seat) => seat.handle === 'claude').herdr_seat_id, 'elder');
  assert.equal(result.seats.find((seat) => seat.handle === 'copilot').availability, 'NOT_MAPPED');
  assert.equal(result.seats.find((seat) => seat.handle === 'codex').availability, 'UNJOINED');
  assert.equal(result.seats.every((seat) => seat.dispatch_eligible === false), true);
});

test('uses explicit Herdr seat ids and never binds panes by cwd or title', () => {
  const result = projectWorkforce(observed({
    agents: [{ id: 'elder', state: 'EXITED', pid: null, session_id: null, cwd: 'D:\\StarqTech' }],
    standalone: {
      bindings_state: 'OK',
      panes: [
        { attribution: 'UNATTRIBUTED', pane: { pane_id: 'w1:p4', cwd: 'D:\\StarqTech' } },
        { attribution: 'BOUND', binding_state: 'STALE', seat_id: 'elder', pane: null },
      ],
    },
  }));
  const elder = result.seats.find((seat) => seat.handle === 'claude');
  assert.equal(elder.identity_binding.state, 'BOUND');
  assert.equal(elder.availability, 'OFFLINE');
  assert.equal(elder.pane_binding.state, 'STALE');
  assert.equal(elder.pane_binding.pane, null);
  assert.equal(result.standalone_panes.unattributed_count, 1);
});

test('reports a running matching session as active with unknown load, never available', () => {
  const result = projectWorkforce(observed({
    agents: [{ id: 'codex', state: 'RUNNING', pid: 123, session_id: 's-1', cwd: 'D:\\StarqTech' }],
    sessions: [{ agent_id: 'codex', session_id: 's-1', pid: 123 }],
  }));
  const codex = result.seats.find((seat) => seat.handle === 'codex');
  assert.equal(codex.availability, 'ACTIVE_UNKNOWN_LOAD');
  assert.equal(codex.runtime.session_match, 'MATCHED');
  assert.equal(codex.dispatch_eligible, false);
  assert.equal(codex.dispatch_blocker, 'CAPABILITY_OR_LOAD_UNKNOWN');
});

test('makes a worker dispatchable only with verified capabilities and explicit live idle readiness', () => {
  const result = projectWorkforce(observed({
    agents: [{ id: 'codex', state: 'RUNNING', pid: 123, session_id: 's-1', broker_owned: true,
      workload_state: 'IDLE', execution_ready: true }],
    sessions: [{ agent_id: 'codex', session_id: 's-1', pid: 123 }],
  }), {
    capabilities: { codex: { status: 'VERIFIED', capabilities: ['typescript'], evidence: ['review:codex'] } },
    activeWorkload: [],
  });
  const codex = result.seats.find((seat) => seat.handle === 'codex');
  assert.equal(codex.availability, 'AVAILABLE');
  assert.equal(codex.dispatch_eligible, true);
  assert.equal(codex.provider.model_state, 'UNKNOWN');
});

test('marks an execution-loaded seat busy and preserves unattributed panes separately', () => {
  const result = projectWorkforce(observed({
    agents: [{ id: 'codex', state: 'RUNNING', pid: 123, session_id: 's-1', broker_owned: true,
      workload_state: 'IDLE', execution_ready: true }],
    sessions: [{ agent_id: 'codex', session_id: 's-1', pid: 123 }],
    standalone: { bindings_state: 'OK', panes: [{ attribution: 'UNATTRIBUTED', pane: { pane_id: 'w1:p9' } }] },
  }), {
    capabilities: { codex: { status: 'VERIFIED', capabilities: ['typescript'], evidence: ['review:codex'] } },
    activeWorkload: [{ seat: 'codex', taskId: 'PM-CMD-9', state: 'EXECUTING' }],
  });
  const codex = result.seats.find((seat) => seat.handle === 'codex');
  assert.equal(codex.availability, 'BUSY');
  assert.equal(codex.dispatch_eligible, false);
  assert.equal(codex.workload.active_count, 1);
  assert.equal(result.standalone_panes.unattributed_count, 1);
});

test('flags conflicting explicit bindings and mismatched runtime sessions', () => {
  const result = projectWorkforce(observed({
    agents: [{ id: 'vision', state: 'RUNNING', pid: 123, session_id: 's-1' }],
    sessions: [{ agent_id: 'vision', session_id: 's-other', pid: 123 }],
    standalone: {
      bindings_state: 'OK',
      panes: [
        { attribution: 'BOUND', binding_state: 'BOUND', seat_id: 'vision', pane: { pane_id: 'w1:p3' } },
        { attribution: 'BOUND', binding_state: 'BOUND', seat_id: 'vision', pane: { pane_id: 'w1:p8' } },
      ],
    },
  }));
  const vision = result.seats.find((seat) => seat.handle === 'vision');
  assert.equal(vision.runtime.session_match, 'CONFLICT');
  assert.equal(vision.pane_binding.state, 'CONFLICT');
  assert.equal(vision.dispatch_eligible, false);
});

test('keeps provider usage unknown and treats an unreachable broker as unknown', () => {
  const result = projectWorkforce(observed({ broker: { online: false }, agents: [] }));
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.seats.every((seat) => seat.availability === 'UNKNOWN' || seat.availability === 'NOT_MAPPED'), true);
  assert.equal(result.seats.every((seat) => seat.quota.status === 'UNKNOWN'), true);
});
