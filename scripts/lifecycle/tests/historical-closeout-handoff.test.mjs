import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { evaluateHistoricalCloseoutHandoff, evaluateRecordedHistoricalCloseoutRecovery } from '../historical-closeout-handoff.mjs';
import { HISTORICAL_CLOSEOUT_EXCEPTION } from '../../../../herdr-floor/src/historical-closeout-exception.mjs';

const FIXTURE_DIR = fileURLToPath(new URL('../../../../herdr-floor/state/', import.meta.url));
const MANIFEST = 'historical-closeout-exception-20261027.json';
const ARCHIVE = 'registry.pre-option-b-15821.json';

function fixture() {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'starq-closeout-handoff-'));
  copyFileSync(path.join(FIXTURE_DIR, MANIFEST), path.join(stateDir, MANIFEST));
  copyFileSync(path.join(FIXTURE_DIR, ARCHIVE), path.join(stateDir, ARCHIVE));
  copyFileSync(path.join(stateDir, ARCHIVE), path.join(stateDir, 'registry.json'));
  const original = JSON.parse(readFileSync(path.join(stateDir, ARCHIVE), 'utf8'));
  const registryProjection = original.records.map((r) => ({
    session_id: r.session_id,
    agent_id: r.agent_id,
    pid: r.pid,
    state: r.state,
    started_at: r.started_at,
    exit_at: r.exit_at,
    create_time_source: r.create_time_source,
  }));
  const lifecycleView = {
    admission: 'DRAINING', boot_id: 'old-broker-boot', running: [], open_terminals: 0,
    pending_launches: 0, unresolved_launches: 0, orphaned_sessions: 0,
    historical_closeout_unverified: 6, drained: false,
  };
  const events = [{
    event: 'recover.historical_closeout_exception_verified',
    decision: HISTORICAL_CLOSEOUT_EXCEPTION.decision,
    session_ids: [...HISTORICAL_CLOSEOUT_EXCEPTION.sessionIds],
    historical_closeout: 'UNKNOWN',
    broker_boot_id: 'boot-after-handoff',
  }];
  return { stateDir, registryProjection, lifecycleView, events, cleanup: () => rmSync(stateDir, { recursive: true, force: true }) };
}

test('historical handoff accepts only the exact quiescent legacy broker projection', () => {
  const f = fixture();
  try {
    const result = evaluateHistoricalCloseoutHandoff(f);
    assert.equal(result.applied, true);
    assert.equal(result.historical_closeout, 'UNKNOWN');
    assert.equal(result.session_ids.length, 6);
    assert.equal(result.broker_boot_id, 'old-broker-boot');
  } finally { f.cleanup(); }
});

test('historical handoff refuses every non-historical live blocker', () => {
  const cases = [
    ['admission is open', (f) => { f.lifecycleView.admission = 'OPEN'; }],
    ['running session', (f) => { f.lifecycleView.running = [{ agent_id: 'live', session_id: 'live', pid: 11 }]; }],
    ['open terminal', (f) => { f.lifecycleView.open_terminals = 1; }],
    ['pending launch', (f) => { f.lifecycleView.pending_launches = 1; }],
    ['unresolved launch', (f) => { f.lifecycleView.unresolved_launches = 1; }],
    ['orphaned session', (f) => { f.lifecycleView.orphaned_sessions = 1; }],
    ['historical count differs', (f) => { f.lifecycleView.historical_closeout_unverified = 7; }],
    ['broker already reports drained', (f) => { f.lifecycleView.drained = true; }],
  ];
  for (const [name, mutate] of cases) {
    const f = fixture();
    try {
      mutate(f);
      assert.equal(evaluateHistoricalCloseoutHandoff(f).applied, false, name);
    } finally { f.cleanup(); }
  }
});

test('historical handoff refuses a broker registry projection that differs from current disk state', () => {
  const f = fixture();
  try {
    f.registryProjection[0].pid += 1;
    assert.equal(evaluateHistoricalCloseoutHandoff(f).applied, false);
  } finally { f.cleanup(); }
});

test('historical handoff refuses current registry drift and a corrupted preserved archive', () => {
  for (const target of ['registry.json', ARCHIVE]) {
    const f = fixture();
    try {
      writeFileSync(path.join(f.stateDir, target), '{broken');
      assert.equal(evaluateHistoricalCloseoutHandoff(f).applied, false, target);
    } finally { f.cleanup(); }
  }
});

test('recorded closeout recovery resumes only the prior exact broker-verified six-session exception', () => {
  const f = fixture();
  try {
    const result = evaluateRecordedHistoricalCloseoutRecovery(f);
    assert.equal(result.applied, true);
    assert.equal(result.historical_closeout, 'UNKNOWN');
    assert.equal(result.broker_boot_id, 'boot-after-handoff');
    assert.deepEqual(result.session_ids, [...HISTORICAL_CLOSEOUT_EXCEPTION.sessionIds].sort());
  } finally { f.cleanup(); }
});

test('recorded closeout recovery refuses missing, altered, or expanded exception evidence', () => {
  const mutations = [
    (f) => { f.events = []; },
    (f) => { f.events[0].decision = { ...f.events[0].decision, roomSequence: 15822 }; },
    (f) => { f.events[0].session_ids.pop(); },
    (f) => { f.events[0].historical_closeout = 'VERIFIED'; },
    (f) => { f.events[0].broker_boot_id = null; },
    (f) => {
      const registry = JSON.parse(readFileSync(path.join(f.stateDir, 'registry.json'), 'utf8'));
      registry.records.push({ session_id: 'hrd-unrelated-live-session', state: 'RUNNING' });
      writeFileSync(path.join(f.stateDir, 'registry.json'), JSON.stringify(registry));
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    try { mutate(f); assert.equal(evaluateRecordedHistoricalCloseoutRecovery(f).applied, false); }
    finally { f.cleanup(); }
  }
});
