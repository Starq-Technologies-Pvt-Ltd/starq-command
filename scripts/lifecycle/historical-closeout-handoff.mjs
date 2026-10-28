import { importExternalComponent } from '../../server/external-components.mjs';

const [registryComponent, exceptionComponent] = await Promise.all([
  importExternalComponent('herdr-floor', 'src/registry.mjs'),
  importExternalComponent('herdr-floor', 'src/historical-closeout-exception.mjs'),
]);
const Registry = registryComponent.module?.Registry;
const HISTORICAL_CLOSEOUT_EXCEPTION = exceptionComponent.module?.HISTORICAL_CLOSEOUT_EXCEPTION ?? { sessionIds: [], decision: null };
const evaluateHistoricalCloseoutException = exceptionComponent.module?.evaluateHistoricalCloseoutException
  ?? (() => ({ applied: false, reason: exceptionComponent.reason ?? 'herdr-floor module does not export evaluateHistoricalCloseoutException' }));

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

/**
 * Resume only the exact Founder-authorized recovery after the broker that
 * witnessed its quiescent handoff has itself gone away. The durable owner
 * event must name the pinned decision, all six exact sessions, and UNKNOWN;
 * the current broker registry must still match the preserved archive. This
 * does not mark historical trees closed and cannot authorize any new session.
 */
export function evaluateRecordedHistoricalCloseoutRecovery({ stateDir, events }) {
  const fail = (reason) => ({ applied: false, reason, session_ids: [] });
  try {
    if (typeof stateDir !== 'string' || !Array.isArray(events)) return fail('missing durable recovery evidence');
    const audit = [...events].reverse().find((event) => event?.event === 'recover.historical_closeout_exception_verified');
    if (!audit) return fail('no prior broker-verified historical closeout exception event');
    const expectedIds = [...HISTORICAL_CLOSEOUT_EXCEPTION.sessionIds].sort();
    const actualIds = Array.isArray(audit.session_ids) ? [...audit.session_ids].sort() : [];
    if (JSON.stringify(audit.decision) !== JSON.stringify(HISTORICAL_CLOSEOUT_EXCEPTION.decision)
      || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)
      || audit.historical_closeout !== 'UNKNOWN'
      || typeof audit.broker_boot_id !== 'string' || !audit.broker_boot_id) {
      return fail('prior recovery event does not match the exact Founder decision and six UNKNOWN records');
    }

    const registry = new Registry({ stateDir });
    const loaded = registry.load();
    if (loaded.corrupt || loaded.orphaned !== 0 || registry.inspectionUnresolved) return fail('current registry is not resolved evidence');
    const records = registry.all();
    if (records.length !== expectedIds.length) return fail('current registry contains records outside the six-session exception scope');
    const exception = evaluateHistoricalCloseoutException({ stateDir, records });
    if (!exception.applied
      || JSON.stringify([...exception.session_ids].sort()) !== JSON.stringify(expectedIds)
      || exception.historical_closeout !== 'UNKNOWN') {
      return fail(`pinned historical exception no longer validates: ${exception.reason ?? 'scope mismatch'}`);
    }
    return {
      applied: true,
      reason: 'prior broker-verified handoff and exact six-record exception revalidated; historical closeout remains UNKNOWN',
      decision: exception.decision,
      session_ids: expectedIds,
      historical_closeout: 'UNKNOWN',
      broker_boot_id: audit.broker_boot_id,
    };
  } catch (err) {
    return fail(`recorded historical recovery validation failed: ${err.message}`);
  }
}
