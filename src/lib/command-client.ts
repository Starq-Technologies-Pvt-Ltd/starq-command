/**
 * Typed client for Starq Command Software Factory & Floor Endpoints.
 * Reaches the Command Herdr / Floor service (:5179) proxied at /api/command and /api/herdr.
 * All mutating actions obtain and pass the required X-CSRF-Token header.
 */

let cachedCsrfToken: string | null = null;

export async function obtainCommandCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/herdr/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    const token = data?.session?.csrfToken || data?.session?.csrf_token || null;
    cachedCsrfToken = token;
    return token;
  } catch {
    return null;
  }
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  isRetry = false,
): Promise<{ ok: boolean; status: number; data?: T; error?: string; code?: string; state?: string; raw?: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (method === 'POST') {
    if (!cachedCsrfToken) {
      await obtainCommandCsrfToken();
    }
    if (cachedCsrfToken) {
      headers['X-CSRF-Token'] = cachedCsrfToken;
    }
  }

  try {
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => null);

    if (res.status === 403 && json?.code === 'CSRF_INVALID' && !isRetry) {
      cachedCsrfToken = null;
      await obtainCommandCsrfToken();
      return request<T>(method, path, body, true);
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error || json?.reason || json?.message || `HTTP ${res.status}`,
        code: json?.code,
        state: json?.state,
        raw: json,
      };
    }

    return {
      ok: true,
      status: res.status,
      data: json as T,
      state: json?.state,
      raw: json,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      error: err?.message || String(err),
      state: 'UNAVAILABLE',
    };
  }
}

// ── Read-Only Endpoints ──────────────────────────────────────────────────────

export interface CommandHealth {
  ok: boolean;
  service: string;
  timestamp: string;
}

export interface CommandExecutionInfo {
  state: string;
  builderSeat?: string | null;
  verifierSeat?: string | null;
  herdrSessionId?: string | null;
  verifierSessionId?: string | null;
  workspacePath?: string | null;
  verifierWorkspacePath?: string | null;
  branch?: string | null;
  baseSha?: string | null;
  candidateSha?: string | null;
  leaseId?: string | null;
  retries?: number;
  [key: string]: unknown;
}

export interface CommandTaskItem {
  taskId: string;
  projectId: string;
  title: string;
  stage: string;
  status: string;
  execution?: CommandExecutionInfo | null;
  allowedNext?: string[];
  [key: string]: unknown;
}

export interface DispatchPlanCandidate {
  taskId: string;
  worker: string;
  sessionId: string;
  requiredCapabilities: string[];
  repository?: string | null;
  baseSha?: string | null;
  worktreeBranch?: string | null;
  worktreePath?: string | null;
}

export interface DispatchPreviewData {
  eligible: DispatchPlanCandidate[];
  blocked: Array<{ taskId: string; reason: string }>;
  workforceObservedAt: string | null;
  [key: string]: unknown;
}

export interface WorkforceSeat {
  handle: string;
  seat_label: string;
  herdr_seat_id: string | null;
  provider_owner: string;
  product_client: string;
  capacity_class: string;
  normal_host: string;
  role_family: string;
  availability: string;
  availability_reason?: string;
  dispatch_eligible: boolean;
  dispatch_blocker?: string | null;
  capabilities: {
    state: string;
    values: string[];
    evidence: string[];
  };
  workload: {
    active_count: number;
    task_ids: string[];
  };
  quota: {
    status: string;
    source: string;
    reason: string;
  };
}

export interface WorkforceData {
  ok: boolean;
  state: string;
  observed_at: string;
  declared_seat_count: number;
  seats: WorkforceSeat[];
  fleet: WorkforceSeat[];
}

export interface CapacityItem {
  seat: string;
  provider: string;
  capacityClass: string;
  telemetrySource: string;
  quotaStatus: string;
  availability: string;
  dispatchEligible: boolean;
  reason: string;
}

export interface CapacityData {
  ok: boolean;
  observed_at: string;
  source: string;
  capacity: CapacityItem[];
}

export interface StuckTaskItem {
  taskId: string;
  seat: string;
  stuckSince: string;
  signals: Array<{ type: string; timestamp: string; detail?: string }>;
  escalated?: boolean;
}

export interface RoomEventItem {
  eventId: string;
  sequence?: number;
  type: string;
  taskId?: string;
  sender: string;
  recipient?: string;
  timestamp: string;
  summary: string;
  payload?: Record<string, unknown>;
}

// ── Client Methods ──────────────────────────────────────────────────────────

export const commandHealth = () => request<CommandHealth>('GET', '/api/command/health');

export const commandTasks = (params?: { state?: string; project?: string; builder?: string }) => {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.project) qs.set('project', params.project);
  if (params?.builder) qs.set('builder', params.builder);
  const qStr = qs.toString();
  return request<{ ok: boolean; count: number; tasks: CommandTaskItem[] }>(
    'GET',
    `/api/command/tasks${qStr ? `?${qStr}` : ''}`,
  );
};

export const commandTask = (taskId: string) =>
  request<{ ok: boolean; task: CommandTaskItem; history: unknown[] }>(
    'GET',
    `/api/command/tasks/${encodeURIComponent(taskId)}`,
  );

export const commandDispatchPreview = () =>
  request<DispatchPreviewData>('GET', '/api/command/dispatch/preview');

export const commandDispatchNext = (requestedTaskId?: string) =>
  request<{ ok: boolean; state: string; taskId?: string; reason?: string }>(
    'POST',
    '/api/command/dispatch',
    requestedTaskId ? { requestedTaskId } : {},
  );

export const commandRecover = (taskId: string, reason: string) =>
  request<{ ok: boolean; state: string; message?: string }>(
    'POST',
    `/api/command/tasks/${encodeURIComponent(taskId)}/recover`,
    { reason },
  );

export const commandVerificationStart = (taskId: string) =>
  request<{ ok: boolean; task: unknown }>(
    'POST',
    `/api/command/tasks/${encodeURIComponent(taskId)}/verification-start`,
    {},
  );

export const commandBuilderCompletion = (
  taskId: string,
  artifact: {
    builderSeat: string;
    candidateSha: string;
    diffStat: { filesCount: number; insertions: number; deletions: number };
    testEvidence: string;
  },
) =>
  request<{ ok: boolean; task: unknown }>(
    'POST',
    `/api/command/tasks/${encodeURIComponent(taskId)}/builder-completion`,
    { artifact },
  );

export const commandVerify = (
  taskId: string,
  artifact: {
    verifierSeat: string;
    result: 'PASS' | 'FAIL';
    evaluatedSha: string;
    verdictNotes: string;
    findings: Array<{ severity: string; description: string }>;
  },
) =>
  request<{ ok: boolean; verdict: string; task: unknown }>(
    'POST',
    `/api/command/tasks/${encodeURIComponent(taskId)}/verify`,
    { artifact },
  );

export const commandPmClose = (taskId: string, actor: string) =>
  request<{ ok: boolean; task: unknown }>(
    'POST',
    `/api/command/tasks/${encodeURIComponent(taskId)}/pm-close`,
    { actor },
  );

export const commandWorkforce = () =>
  request<WorkforceData>('GET', '/api/command/workforce');

export const commandFleet = () =>
  request<WorkforceData>('GET', '/api/command/fleet');

export const commandCapacity = () =>
  request<CapacityData>('GET', '/api/command/capacity');

export const commandStuck = () =>
  request<{ ok: boolean; stuckTasks: StuckTaskItem[] }>('GET', '/api/command/stuck');

export const commandStuckEscalate = (taskId: string) =>
  request<{ ok: boolean; record: unknown }>(
    'POST',
    `/api/command/stuck/${encodeURIComponent(taskId)}/escalate`,
    {},
  );

export const commandRoomEvents = (params?: { taskId?: string; type?: string }) => {
  const qs = new URLSearchParams();
  if (params?.taskId) qs.set('taskId', params.taskId);
  if (params?.type) qs.set('type', params.type);
  const qStr = qs.toString();
  return request<{
    ok: boolean;
    state: string;
    events: RoomEventItem[];
    total_lines?: number;
    skipped_malformed?: number;
  }>('GET', `/api/command/room-events${qStr ? `?${qStr}` : ''}`);
};
