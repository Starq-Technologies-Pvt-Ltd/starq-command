import { STAFF_PROFILE, STAFF_PROFILE_AUTHORITY } from './staff-profile.mjs';

function upper(value) {
  return typeof value === 'string' ? value.toUpperCase() : 'UNKNOWN';
}

function exactPaneBinding(standalonePanes, seatId) {
  if (!seatId) return { state: 'NOT_MAPPED', pane: null };
  const bindings = standalonePanes.filter((entry) =>
    entry?.attribution === 'BOUND' && entry?.seat_id === seatId,
  );
  if (bindings.length > 1) return { state: 'CONFLICT', pane: null };
  const binding = bindings[0];
  if (!binding) return { state: 'UNBOUND', pane: null };
  if (binding.binding_state !== 'BOUND' || !binding.pane) {
    return { state: binding.binding_state ?? 'UNKNOWN', pane: null };
  }
  return {
    state: 'BOUND',
    pane: {
      workspace_id: binding.pane.workspace_id ?? null,
      pane_id: binding.pane.pane_id ?? null,
      terminal_id: binding.pane.terminal_id ?? null,
      cwd: binding.pane.cwd ?? null,
      agent_status: binding.pane.agent_status ?? null,
      bound_by: binding.binding?.bound_by ?? null,
      authority: binding.binding?.authority ?? null,
      bound_at: binding.binding?.bound_at ?? null,
      broker_owned: false,
    },
  };
}

/** Join declared staff identity to observed Herdr seats without guessing. */
export function projectWorkforce(herdrState, {
  observedAt = herdrState?.timestamp ?? null,
  capabilities = {},
  activeWorkload = [],
} = {}) {
  const brokerReachable = herdrState?.broker?.online === true;
  const agents = Array.isArray(herdrState?.agents) ? herdrState.agents : [];
  const sessions = Array.isArray(herdrState?.sessions) ? herdrState.sessions : [];
  const standalonePanes = Array.isArray(herdrState?.standalone?.panes)
    ? herdrState.standalone.panes
    : [];
  const byAgentId = new Map(agents.map((agent) => [agent.id, agent]));

  const seats = STAFF_PROFILE.map((profile) => {
    const herdrId = profile.herdr_seat_id;
    const agent = herdrId ? byAgentId.get(herdrId) ?? null : null;
    const paneBinding = exactPaneBinding(standalonePanes, herdrId);
    const agentState = brokerReachable && agent ? upper(agent.state) : 'UNKNOWN';
    const matchingSessions = agent?.session_id
      ? sessions.filter((session) => session.session_id === agent.session_id && session.agent_id === herdrId)
      : [];
    const sessionConflict = Boolean(agent?.session_id) && matchingSessions.length !== 1;
    const workerCapabilities = capabilities[profile.handle] ?? null;
    const assignedTasks = activeWorkload.filter((item) => item.seat === profile.handle);
    const runtimeIdle = agent?.workload_state === 'IDLE' && agent?.execution_ready === true;

    let availability = 'UNKNOWN';
    let availabilityReason = 'No trustworthy availability signal is present.';
    if (!herdrId) {
      availability = 'NOT_MAPPED';
      availabilityReason = 'The canonical staff profile declares no Herdr seat id.';
    } else if (!brokerReachable) {
      availabilityReason = 'Herdr broker was not reachable at observation time.';
    } else if (!agent) {
      availability = 'UNJOINED';
      availabilityReason = `No Herdr agent row matched declared seat id ${herdrId}.`;
    } else if (agentState === 'EXITED') {
      availability = 'OFFLINE';
      availabilityReason = 'Herdr observed the declared seat process as EXITED.';
    } else if (agentState === 'RUNNING' && matchingSessions.length === 1 && !sessionConflict) {
      if (assignedTasks.length > 0) {
        availability = 'BUSY';
        availabilityReason = `${assignedTasks.length} active Command execution(s) are assigned to this worker.`;
      } else if (runtimeIdle && workerCapabilities?.status === 'VERIFIED' && Array.isArray(workerCapabilities.capabilities)) {
        availability = 'AVAILABLE';
        availabilityReason = 'One matching live broker session, Herdr reports idle and execution-ready, no active Command execution, and verified capabilities.';
      } else {
        availability = 'ACTIVE_UNKNOWN_LOAD';
        availabilityReason = runtimeIdle
          ? 'Herdr reports idle; verified capabilities are missing.'
          : 'A broker session is active, but Herdr has not proved idle workload and execution readiness.';
      }
    } else if (agentState === 'RUNNING') {
      availabilityReason = 'Herdr reports RUNNING without one matching broker session.';
    } else {
      availabilityReason = `Herdr state ${agentState} does not establish dispatch availability.`;
    }

    return {
      handle: profile.handle,
      seat_label: profile.seat_label,
      herdr_seat_id: herdrId,
      provider_owner: profile.provider_owner,
      provider: { owner: profile.provider_owner, model: agent?.model ?? null, model_state: agent?.model ? 'OBSERVED' : 'UNKNOWN' },
      capacity_class: profile.capacity_class,
      role_family: profile.role_family,
      capabilities: workerCapabilities?.status === 'VERIFIED'
        ? { state: 'VERIFIED', values: workerCapabilities.capabilities, evidence: workerCapabilities.evidence ?? [] }
        : { state: 'UNKNOWN', values: [], reason: 'No verified workforce capability record is configured.' },
      workload: { active_count: assignedTasks.length, task_ids: assignedTasks.map((item) => item.taskId) },
      identity_binding: herdrId && agent
        ? { state: 'BOUND', source: 'STAFF_PROFILE.herdr_seat_id = Herdr agent.id' }
        : { state: herdrId ? (brokerReachable ? 'UNJOINED' : 'UNKNOWN') : 'NOT_MAPPED', source: 'STAFF_PROFILE' },
      runtime: {
        state: agentState,
        pid: agent?.pid ?? null,
        cwd: agent?.cwd ?? null,
        terminal: agent?.terminal ?? null,
        session_id: matchingSessions.length === 1 ? matchingSessions[0].session_id : null,
        workload_state: agent?.workload_state ?? 'UNKNOWN',
        execution_ready: agent?.execution_ready === true,
        active_task_id: agent?.active_task_id ?? null,
        session_match: agent?.session_id ? (sessionConflict ? 'CONFLICT' : 'MATCHED') : 'NO_SESSION',
        observed: Boolean(brokerReachable && agent),
        observed_at: observedAt,
      },
      pane_binding: paneBinding,
      availability,
      availability_reason: availabilityReason,
      dispatch_eligible: availability === 'AVAILABLE'
        && Boolean(workerCapabilities?.evidence?.length)
        && matchingSessions.length === 1
        && runtimeIdle
        && agent?.broker_owned === true,
      dispatch_blocker: availability === 'AVAILABLE' && (!workerCapabilities?.evidence?.length || agent?.broker_owned !== true || !runtimeIdle)
        ? 'VERIFIED_CAPABILITY_OR_BROKER_READINESS_REQUIRED'
        : availability === 'OFFLINE'
        ? 'SEAT_OFFLINE'
        : availability === 'BUSY'
          ? 'ACTIVE_WORKLOAD'
        : availability === 'ACTIVE_UNKNOWN_LOAD'
          ? 'CAPABILITY_OR_LOAD_UNKNOWN'
          : availability === 'NOT_MAPPED'
            ? 'NO_HERDR_SEAT'
            : availability === 'UNJOINED'
              ? 'HERDR_SEAT_UNJOINED'
              : 'AVAILABILITY_UNPROVEN',
      quota: {
        status: 'UNKNOWN',
        source: null,
        reason: 'No uniform provider quota telemetry is available for this seat.',
      },
    };
  });

  const standaloneCounts = standalonePanes.reduce((counts, pane) => {
    const key = pane?.attribution === 'BOUND' ? 'bound' : 'unattributed';
    counts[key] += 1;
    return counts;
  }, { bound: 0, unattributed: 0 });

  return {
    state: brokerReachable ? 'OBSERVED' : 'UNKNOWN',
    observed_at: observedAt,
    authority: STAFF_PROFILE_AUTHORITY,
    sources: ['server/staff-profile.mjs', 'Herdr broker GET /api/herdr/state'],
    broker: herdrState?.broker ?? { online: false },
    floor: herdrState?.floor ?? null,
    herdr_state: herdrState?.herdr?.state ?? 'UNKNOWN',
    declared_seat_count: STAFF_PROFILE.length,
    seats,
    standalone_panes: {
      state: herdrState?.standalone?.bindings_state ?? 'UNKNOWN',
      observed_count: standalonePanes.length,
      explicit_binding_count: standaloneCounts.bound,
      unattributed_count: standaloneCounts.unattributed,
      note: 'Standalone panes are read-only observations and never count as broker-owned sessions or dispatch availability.',
    },
    limitations: [
      'Provider quota is UNKNOWN because no uniform provider usage API is connected.',
      'RUNNING establishes process presence; dispatch requires one matching live session, no active Command work, and a verified capability record.',
      'Pane identity is accepted only from an explicit Herdr binding; cwd, title, and pane labels are not identity evidence.',
    ],
  };
}
