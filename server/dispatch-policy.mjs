function list(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return list(parsed);
    if (parsed && typeof parsed === 'object') return list(parsed.required_capabilities ?? parsed.capabilities);
  } catch { return []; }
  return [];
}

export function requiredCapabilities(task) {
  const executionContract = task.execution?.contract;
  return list(task.sourceAttributes?.required_capabilities_json)
    .concat(list(task.sourceAttributes?.requirements_json))
    .concat(list(executionContract?.requiredCapabilities));
}

export function evaluateDispatch(task, workforce) {
  const blockers = [];
  if (task.provenance !== 'LIVE') blockers.push('HISTORICAL_TASK');
  if (task.stage !== 'READY') blockers.push('PM_STAGE_NOT_READY');
  if (!task.roomAuthorizationRef) blockers.push('ROOM_AUTHORIZATION_MISSING');
  if (task.owner === 'UNASSIGNED' || !task.owner) blockers.push('PM_OWNER_UNASSIGNED');
  if (task.verifier === 'UNASSIGNED' || !task.verifier) blockers.push('PM_VERIFIER_UNASSIGNED');
  if (task.owner === task.verifier) blockers.push('SELF_VERIFICATION');
  if (task.dependencies.some((dependency) => typeof dependency === 'object' && dependency.stage !== 'CLOSED')) {
    blockers.push('DEPENDENCY_OPEN');
  }
  if (Object.values(task.sourceAttributes?.dependencyStages ?? {}).some((stage) => stage !== 'CLOSED')) {
    blockers.push('DEPENDENCY_OPEN');
  }

  const needed = requiredCapabilities(task);
  if (!needed.length) blockers.push('TASK_CAPABILITIES_UNSPECIFIED');
  const seats = workforce?.seats ?? [];
  const owner = seats.find((seat) => seat.handle === task.owner);
  const verifier = seats.find((seat) => seat.handle === task.verifier);
  if (!owner) blockers.push('OWNER_NOT_IN_WORKFORCE');
  else {
    if (!owner.dispatch_eligible) blockers.push(owner.dispatch_blocker ?? 'WORKER_NOT_READY');
    if (!owner.runtime?.session_id) blockers.push('LIVE_SESSION_UNBOUND');
    if (owner.availability !== 'AVAILABLE') blockers.push('WORKER_NOT_AVAILABLE');
    const capabilities = new Set(owner.capabilities?.state === 'VERIFIED' ? owner.capabilities.values : []);
    const missing = needed.filter((capability) => !capabilities.has(capability));
    if (missing.length) blockers.push(`CAPABILITIES_MISSING:${missing.join(',')}`);
  }
  if (!verifier || !verifier.dispatch_eligible || verifier.availability !== 'AVAILABLE' || !verifier.runtime?.session_id) {
    blockers.push(verifier?.dispatch_blocker ?? 'VERIFIER_NOT_AVAILABLE');
  } else {
    const verifierCapabilities = new Set(verifier.capabilities?.state === 'VERIFIED' ? verifier.capabilities.values : []);
    const missing = [...new Set([...needed, 'verification'])].filter((capability) => !verifierCapabilities.has(capability));
    if (missing.length) blockers.push(`VERIFIER_CAPABILITIES_MISSING:${missing.join(',')}`);
  }
  return {
    eligible: blockers.length === 0,
    taskId: task.taskId,
    worker: owner?.handle ?? null,
    sessionId: owner?.runtime?.session_id ?? null,
    requiredCapabilities: needed,
    blockers: [...new Set(blockers)],
  };
}

export function planDispatch(tasks, workforce) {
  const candidates = tasks.map((task) => ({ task, decision: evaluateDispatch(task, workforce) }));
  return {
    state: candidates.some(({ decision }) => decision.eligible) ? 'READY' : 'NO_ELIGIBLE_WORK',
    eligible: candidates.filter(({ decision }) => decision.eligible).map(({ task, decision }) => ({
      taskId: task.taskId,
      projectId: task.projectId,
      title: task.title,
      owner: task.owner,
      worker: decision.worker,
      sessionId: decision.sessionId,
      requiredCapabilities: decision.requiredCapabilities,
    })),
    blocked: candidates.filter(({ decision }) => !decision.eligible).map(({ task, decision }) => ({
      taskId: task.taskId,
      blockers: decision.blockers,
    })),
  };
}
