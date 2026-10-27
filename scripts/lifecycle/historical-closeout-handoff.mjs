import { Registry } from '../../../herdr-floor/src/registry.mjs';
import { evaluateHistoricalCloseoutException } from '../../../herdr-floor/src/historical-closeout-exception.mjs';

const EXPECTED_UNVERIFIED_COUNT = 6;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const projection = (rows) => rows.map((row) => ({
  session_id: row.session_id,
  agent_id: row.agent_id,
  pid: row.pid,
  state: row.state,
  started_at: row.started_at,
  exit_at: row.exit_at ?? null,
})).sort((a, b) => a.session_id.localeCompare(b.session_id));

/**
 * Verify the exact old broker state that permits a one-time graceful handoff
 * to the Founder-authorized exception-aware broker. This is read-only and is
 * used only when the live broker still reports the six UNKNOWN rows as an
 * undrained blocker.
 */
export function evaluateHistoricalCloseoutHandoff({ stateDir, lifecycleView, registryProjection }) {
  const fail = (reason) => ({ applied: false, reason, session_ids: [] });
  try {
    if (typeof stateDir !== 'string' || !lifecycleView || !Array.isArray(registryProjection)) return fail('missing live handoff evidence');
    if (lifecycleView.admission !== 'DRAINING' || lifecycleView.drained !== false
      || !Array.isArray(lifecycleView.running) || lifecycleView.running.length !== 0
      || lifecycleView.open_terminals !== 0
      || lifecycleView.pending_launches !== 0
      || lifecycleView.unresolved_launches !== 0
      || lifecycleView.orphaned_sessions !== 0
      || lifecycleView.historical_closeout_unverified !== EXPECTED_UNVERIFIED_COUNT) {
      return fail('live broker is not quiescent with exactly six historical blockers');
    }

    const registry = new Registry({ stateDir });
    const loaded = registry.load();
    if (loaded.corrupt || loaded.orphaned !== 0 || registry.inspectionUnresolved) return fail('current registry cannot be read as resolved evidence');
    const records = registry.all();
    const exception = evaluateHistoricalCloseoutException({ stateDir, records });
    if (!exception.applied) return fail(`pinned historical exception did not validate: ${exception.reason}`);
    if (!same(projection(registryProjection), projection(records))) return fail('live broker registry projection differs from the preserved current registry');

    return {
      applied: true,
      reason: 'live broker is quiescent and its exact six UNKNOWN rows match the pinned archive',
      decision: exception.decision,
      session_ids: exception.session_ids,
      historical_closeout: 'UNKNOWN',
      broker_boot_id: lifecycleView.boot_id ?? null,
    };
  } catch (err) {
    return fail(`historical broker handoff validation failed: ${err.message}`);
  }
}
