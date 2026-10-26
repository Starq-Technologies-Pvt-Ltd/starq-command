/**
 * Command health-preflight projection.
 *
 * Derives per-port STOPPED / HEALTHY / DEGRADED from the lifecycle owner's
 * inspection report (listeners, ownership, health contracts). Declared
 * external infrastructure that does not hold a Command control-plane port
 * never turns an idle port into DEGRADED.
 *
 * Pure: no sockets, no process signals, no PM database writes.
 */
export const HEALTH_PREFLIGHT_SCHEMA = 'starq.command.health_preflight/v1';

export const COMMAND_CONTROL_PLANE_PORTS = Object.freeze([5173, 5176, 5177, 5178, 5179, 5188]);

/** Founder organizational closure of PM-CMD-001; provenance only, not a DB mutation. */
export const PM_CMD_001_CLOSURE = Object.freeze({
  task: 'PM-CMD-001',
  depends_on_retained: true,
  gate: 'satisfied_by_closed_prerequisite',
  room_sequence: 11235,
  event_id: '61bebc76a1fc87173aeb3b2921028d00a34bb6f418ebec0b8bd6a9d228af482b',
  note: 'PM-CMD-002 keeps depends_on=[PM-CMD-001] as durable provenance; the dependency gate is satisfied because PM-CMD-001 is CLOSED.',
});

const IDLE_OWNERSHIP = new Set(['NOT_RECORDED', 'EXITED', 'GONE', 'FOREIGN']);

export function isCommandControlPlanePort(port) {
  return COMMAND_CONTROL_PLANE_PORTS.includes(Number(port));
}

export function classifyComponentPreflight(component) {
  if (!component) return { state: 'UNKNOWN', detail: 'component missing from inspection' };
  const port = Number(component.port);
  const ownership = component.ownership ?? 'UNKNOWN';
  const listener = component.listener;
  if (!listener) return { name: component.name ?? null, port, state: 'UNKNOWN', detail: 'listener inspection missing' };

  const present = listener.present === true;
  const ownedListener = listener.owned === true;
  const healthOk = component.health?.ok === true;

  if (ownership === 'OWNED' && healthOk && ownedListener) {
    return { name: component.name, port, state: 'HEALTHY', detail: 'owned listener and health contract satisfied' };
  }
  if (!present && IDLE_OWNERSHIP.has(ownership)) {
    return { name: component.name, port, state: 'STOPPED', detail: 'no control-plane listener (idle cooldown)' };
  }
  if (ownership === 'OWNED' && !present) {
    return { name: component.name, port, state: 'DEGRADED', detail: 'recorded as owned but no listener' };
  }
  if (present && !ownedListener) {
    const pids = Array.isArray(listener.pids) ? listener.pids.join(',') : '?';
    return { name: component.name, port, state: 'DEGRADED', detail: `non-owned listener pid(s) ${pids}` };
  }
  if (ownership === 'OWNED' && present && ownedListener && !healthOk) {
    return { name: component.name, port, state: 'DEGRADED', detail: `owned listener but health failed: ${component.health?.detail ?? 'unhealthy'}` };
  }
  return {
    name: component.name, port, state: 'DEGRADED',
    detail: `ownership=${ownership} listener=${present ? 'present' : 'absent'} health=${component.health ? (healthOk ? 'ok' : 'fail') : 'n/a'}`,
  };
}

function rollup(portRows, inspectionComplete) {
  if (!inspectionComplete) return 'UNKNOWN';
  if (!portRows.length) return 'UNKNOWN';
  if (portRows.some((p) => p.state === 'UNKNOWN')) return 'UNKNOWN';
  if (portRows.every((p) => p.state === 'HEALTHY')) return 'HEALTHY';
  if (portRows.every((p) => p.state === 'STOPPED')) return 'STOPPED';
  return 'DEGRADED';
}

/**
 * @param {object} report owner.status() report
 */
export function buildHealthPreflight(report = {}) {
  const components = Array.isArray(report.components) ? report.components : [];
  const ports = components.map(classifyComponentPreflight);
  const inspectionComplete = report.inspection?.complete !== false;
  const overall = rollup(ports, inspectionComplete);
  const live = Array.isArray(report.live_infrastructure) ? report.live_infrastructure : [];
  const infraOnCommandPort = live.some((row) => row.blocking_for_command === true);
  const idleCooldown = overall === 'STOPPED' && ports.every((p) => p.state === 'STOPPED');
  const gProfile = report.normal_profile?.standalone_herdr?.owner_gate ?? null;

  return {
    schema: HEALTH_PREFLIGHT_SCHEMA,
    overall,
    idle_cooldown: idleCooldown,
    command_ports: COMMAND_CONTROL_PLANE_PORTS.slice(),
    ports,
    declared_infrastructure: {
      observed: live.map((row) => ({
        pid: row.pid ?? null,
        id: row.id ?? null,
        kind: row.kind ?? null,
        blocking_for_command: row.blocking_for_command === true,
      })),
      blocking_for_command: infraOnCommandPort,
      note: 'Declared Starq infrastructure is not a Command-port false alarm unless blocking_for_command is true.',
    },
    gates: {
      'G-PROFILE': gProfile ? { resolved: gProfile.resolved === true, detail: gProfile.detail ?? null } : { resolved: null, detail: 'not present on this report' },
    },
    prerequisite: { ...PM_CMD_001_CLOSURE },
    inspection_complete: inspectionComplete,
  };
}
