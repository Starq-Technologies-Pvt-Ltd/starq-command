/**
 * Typed client for the human-operated PM service (server/pm-service.mjs, :5176).
 * Every failure is returned as a value; nothing here throws into a component.
 */
/**
 * The supported Command lifecycle pins PM at :5176. Disposable verification
 * instances can use :5190–:5199 and must always use a separate PM_DB_PATH.
 *
 * A scratch port, once seen in the hash, is kept for the life of the tab.
 * The router rebuilds the hash on every navigation (`routeHash`) and drops the
 * query, so reading the hash alone meant one click silently switched a
 * "disposable" session back to the LIVE PM on :5176 — every later write would
 * land in the real database. A new tab starts on :5176 again.
 */
const SCRATCH_PORT_KEY = 'starq.command.pm_port';
const isScratchPort = (v: string | null): v is string => Boolean(v && /^519\d$/.test(v));

export function pmPort(): number {
  try {
    const q = window.location.hash.split('?')[1] ?? '';
    const v = new URLSearchParams(q).get('pm_port');
    if (isScratchPort(v)) {
      try { window.sessionStorage.setItem(SCRATCH_PORT_KEY, v); } catch { /* unpersisted, still scratch now */ }
      return Number(v);
    }
    const kept = window.sessionStorage.getItem(SCRATCH_PORT_KEY);
    if (isScratchPort(kept)) return Number(kept);
  } catch {
    /* default */
  }
  return 5176;
}
export const pmIsScratch = () => {
  const port = pmPort();
  return port >= 5190 && port <= 5199;
};
export const pmQuery = () => (pmIsScratch() ? `?pm_port=${pmPort()}` : '');
const pmBase = () => `http://127.0.0.1:${pmPort()}`;

export const PM_STATUSES = [
  'TODO', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'DONE',
] as const;
export type PmStatus = (typeof PM_STATUSES)[number];

export const PM_STATUS_LABELS: Record<PmStatus, string> = {
  TODO: 'To Do',
  NEXT: 'Next Up',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  DONE: 'Done',
};
export type PmPriority = 'P0' | 'P1' | 'P2' | 'P3';
export const PM_PRIORITIES: PmPriority[] = ['P0', 'P1', 'P2', 'P3'];

export interface PmRoomRef {
  sequence: number;
  eventId: string;
  recordHash: string | null;
  senderHandle: string | null;
  purpose: string;
  kind: 'authorization' | 'evidence';
  verified_at: string;
  received_at: string | null;
  authority_level: string;
  root_authority: boolean;
  mentions_task: boolean;
}

export interface PmHold {
  state: string | null;
  authority: string | null;
  effective: string | null;
  source: string;
}

export interface PmProject {
  id: string;
  name: string;
  prefix: string;
  description: string;
  source_gap: string | null;
  hold: PmHold;
  done_historical?: number;
  open?: number;
  stages?: Record<string, number>;
  provenance?: { HISTORICAL_NEXUS: number; LIVE: number };
  provenance_counts?: { live: number; historical: number } | Record<string, number>;
  execution_qualifier?: string | null;
  metrics?: {
    claimed: { done: number; total: number; percent: number };
    committed: { count: number; total: number; percent: number };
    proven: { count: number; total: number; percent: number };
    capability: { implemented: number; total: number; percent: number } | null;
  };
}

export interface PmTask {
  id: string;
  project_id: string;
  title: string;
  description: string;
  priority: PmPriority;
  status: PmStatus;
  prior_status: PmStatus | null;
  owner: string;
  verifier: string;
  room_authorization_ref: PmRoomRef | null;
  evidence_refs: PmRoomRef[];
  depends_on: string[];
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  allowed_next: PmStatus[];
  pending_room_sync: number;
  stage: string;
  prior_stage?: string | null;
  provenance: string;
  epic?: string | null;
  sprint?: string | null;
  milestone?: string | null;
  release_track?: string | null;
  workers: string[];
  priority_raw?: string | null;
  acceptance_json?: string | null;
  evidence_json?: string | null;
  verification_json?: string | null;
  gated: boolean;
  allowed_stage_next: string[];
  nexus_attributes?: Record<string, unknown> | null;
  board_column?: PmStatus;
}

export interface PmHistoryRow {
  id: number;
  task_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor: string;
  detail: Record<string, unknown>;
  timestamp: string;
  room_sync: 'NOT_REQUIRED' | 'DISABLED' | 'PENDING' | 'POSTED';
  room_ref: { sequence: number; eventId: string | null; recordHash: string | null } | null;
  room_error: string | null;
  room_attempts: number;
}

export interface PmTaskDetail {
  task: PmTask;
  history: PmHistoryRow[];
  hold: PmHold;
  source_record: {
    source_system: string;
    source_file: string;
    source_row_index: number;
    resolution: 'IMPORTED';
    raw_status: string | null;
    payload_sha256: string;
    source_file_sha256: string;
    raw_payload: Record<string, unknown>;
  } | null;
}

export interface PmNexusSource {
  source_file: string;
  source_system: string;
  content_sha256: string;
  row_count: number;
  imported_at: string;
  preserved_rows: number;
  duplicate_rows: number;
  invalid_rows: number;
  archived_rows: number;
}

export interface PmNexusSourceRecord {
  source_row_index: number;
  task_id: string | null;
  resolution: 'IMPORTED' | 'DUPLICATE_TASK_ID' | 'INVALID_ID' | 'ARCHIVED_ID_COLLISION';
  raw_status: string | null;
  payload_sha256: string;
  raw_payload: Record<string, unknown>;
}

export interface PmPortfolioProject {
  id: string;
  name: string;
  prefix: string;
  hold: PmHold;
  source_gap: string | null;
  total: number;
  open: number;
  counts: Record<PmStatus, number>;
  founder_gate: number;
  blocked: number;
  pending_room_sync: number;
  unassigned: number;
  done_historical?: number;
  historical_total?: number;
  stages?: Record<string, number>;
  provenance?: { HISTORICAL_NEXUS: number; LIVE: number };
  provenance_counts?: { live: number; historical: number } | Record<string, number>;
  execution_qualifier?: string | null;
  metrics?: {
    claimed: { done: number; total: number; percent: number };
    committed: { count: number; total: number; percent: number };
    proven: { count: number; total: number; percent: number };
    capability: { implemented: number; total: number; percent: number } | null;
  };
}

export interface PmPortfolio {
  generated_at: string;
  pending_room_sync: number;
  statuses: PmStatus[];
  projects: PmPortfolioProject[];
  done_historical?: number;
  open?: number;
  stages?: Record<string, number>;
  provenance?: { HISTORICAL_NEXUS: number; LIVE: number };
  provenance_counts?: { live: number; historical: number } | Record<string, number>;
  execution_qualifier?: string | null;
  hold?: PmHold;
}

export interface PmHealth {
  state: string;
  reason: string | null;
  tasks?: number;
  history_rows?: number;
  pending_room_sync?: number;
  room_post: string;
  db: string | null;
}

export interface PmMeta {
  statuses: PmStatus[];
  priorities: PmPriority[];
  handles: string[];
}

export type PmResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      state: 'UNAVAILABLE' | 'REJECTED';
      status: number;
      code: string;
      message: string;
      errors?: string[];
      current_updated_at?: string;
    };

async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<PmResult<T>> {
  try {
    const res = await fetch(`${pmBase()}${path}`, {
      method,
      cache: 'no-store',
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json', 'X-PM-Client': 'starq-command' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok) return { ok: true, data: payload as T };
    return {
      ok: false,
      state: res.status === 503 ? 'UNAVAILABLE' : 'REJECTED',
      status: res.status,
      code: String(payload?.code ?? payload?.error ?? 'ERROR'),
      message: String(payload?.message ?? payload?.error ?? `PM service returned ${res.status}`),
      errors: Array.isArray(payload?.errors) ? (payload?.errors as string[]) : undefined,
      current_updated_at: typeof payload?.current_updated_at === 'string' ? payload.current_updated_at : undefined,
    };
  } catch {
    return {
      ok: false,
      state: 'UNAVAILABLE',
      status: 0,
      code: 'UNREACHABLE',
      message: 'The PM service (127.0.0.1:5176) is not reachable. Nothing was saved.',
    };
  }
}

export type PmUnitKind = 'COMPANY' | 'DIVISION' | 'DEPARTMENT' | 'TEAM';
export const PM_UNIT_KINDS: PmUnitKind[] = ['COMPANY', 'DIVISION', 'DEPARTMENT', 'TEAM'];
export type PmPersonKind = 'HUMAN' | 'DIGITAL';
export const PM_PERSON_KINDS: PmPersonKind[] = ['HUMAN', 'DIGITAL'];

export interface PmOrgCompany {
  id: string;
  name: string;
  legal_name?: string | null;
  notes?: string | null;
  archived_at?: string | null;
}

export interface PmOrgUnit {
  id: string;
  company_id: string;
  parent_id?: string | null;
  kind: PmUnitKind | string;
  name: string;
  description?: string | null;
  archived_at?: string | null;
}

export interface PmOrgPosition {
  id: string;
  unit_id: string;
  title: string;
  job_description?: string | null;
  reports_to_position_id?: string | null;
  archived_at?: string | null;
}

export interface PmOrgPerson {
  id: string;
  handle: string;
  display_name: string;
  kind: PmPersonKind | string;
  role_note?: string | null;
  harness?: string | null;
  capabilities?: string[];
  status?: 'active' | 'inactive' | string;
  source?: string | null;
  room_handle?: string | null;
  archived_at?: string | null;
  updated_at?: string | null;
}

export interface PmOrgAppointment {
  id: string;
  position_id: string;
  person_id: string;
}

export interface PmOrg {
  company: PmOrgCompany | PmOrgCompany[] | null;
  companies?: PmOrgCompany[];
  units: PmOrgUnit[];
  positions: PmOrgPosition[];
  people: PmOrgPerson[];
  appointments: PmOrgAppointment[];
  ended_appointments?: PmOrgAppointment[];
  generated_at: string;
  room_post?: string;
  state?: string;
}

export interface PmAttentionAction {
  task_id: string;
  project_id: string;
  title: string;
  status: string;
  /** Governance stage from the source task record; optional for older services. */
  stage?: string;
  owner: string;
  verifier: string;
  priority: string;
  reason: string;
  href: string;
}

export interface PmAttention {
  generated_at: string;
  room_post: string;
  next_actions: PmAttentionAction[];
  /** Current LIVE tasks explicitly marked FOUNDER_GATE, separate from attention. */
  founder_gate_actions?: PmAttentionAction[];
  blocked: number;
  founder_gate: number;
  unassigned: number;
  in_progress: number;
}

export interface PmCreateCompanyBody {
  actor: string;
  name: string;
  legal_name?: string;
  notes?: string;
}

export interface PmCreateUnitBody {
  actor: string;
  company_id: string;
  parent_id?: string;
  kind: PmUnitKind;
  name: string;
  description?: string;
}

export interface PmCreatePositionBody {
  actor: string;
  unit_id: string;
  title: string;
  job_description?: string;
  reports_to_position_id?: string;
}

export interface PmCreatePersonBody {
  actor: string;
  handle: string;
  display_name: string;
  kind: PmPersonKind;
}

export interface PmCreateAppointmentBody {
  actor: string;
  position_id: string;
  person_id: string;
}

export interface PmCreateProjectBody {
  actor: string;
  id: string;
  name: string;
  prefix: string;
  description?: string;
}

export interface PmLocalEvidenceBody {
  actor: string;
  expected_updated_at: string;
  note: string;
}

/** Normalize GET /api/pm/org `company` which may be one row or a list. */
export function pmOrgCompanies(org: PmOrg | null | undefined): PmOrgCompany[] {
  if (!org) return [];
  if (Array.isArray(org.companies) && org.companies.length > 0) return org.companies;
  if (!org.company) return [];
  return Array.isArray(org.company) ? org.company : [org.company];
}

export const pmHealth = () => call<PmHealth>('GET', '/api/pm/health');
export const pmMeta = () => call<PmMeta>('GET', '/api/pm/meta');
export const pmProjects = (opts?: { includeArchived?: boolean }) =>
  call<{ projects: PmProject[] }>('GET', `/api/pm/projects${opts?.includeArchived ? '?include=archived' : ''}`);
export const pmTasks = (projectId: string) =>
  call<{ project_id: string; tasks: PmTask[] }>('GET', `/api/pm/tasks?project_id=${encodeURIComponent(projectId)}`);
export const pmTask = (id: string) => call<PmTaskDetail>('GET', `/api/pm/tasks/${encodeURIComponent(id)}`);
export const pmNexusSources = (file?: string) => call<{ sources: PmNexusSource[]; records?: PmNexusSourceRecord[] }>(
  'GET', `/api/pm/nexus/sources${file ? `?file=${encodeURIComponent(file)}` : ''}`,
);
export const pmPortfolio = () => call<PmPortfolio>('GET', '/api/pm/portfolio');
export const pmOrg = (opts?: { includeArchived?: boolean }) =>
  call<PmOrg>('GET', `/api/pm/org${opts?.includeArchived ? '?include=archived' : ''}`);
export const pmAttention = () => call<PmAttention>('GET', '/api/pm/attention');
export const pmCreateCompany = (body: PmCreateCompanyBody) =>
  call<PmOrgCompany>('POST', '/api/pm/org/companies', body);
export const pmCreateUnit = (body: PmCreateUnitBody) => call<PmOrgUnit>('POST', '/api/pm/org/units', body);
export const pmCreatePosition = (body: PmCreatePositionBody) =>
  call<PmOrgPosition>('POST', '/api/pm/org/positions', body);
export const pmCreatePerson = (body: PmCreatePersonBody) => call<PmOrgPerson>('POST', '/api/pm/org/people', body);
export const pmCreateAppointment = (body: PmCreateAppointmentBody) =>
  call<PmOrgAppointment>('POST', '/api/pm/org/appointments', body);
export const pmCreateProject = (body: PmCreateProjectBody) => call<PmProject>('POST', '/api/pm/projects', body);
export interface PmLinkRoomInput {
  token?: string;
  sequence: number;
  event_id?: string;
  eventId?: string;
  purpose?: string;
  kind?: 'authorization' | 'evidence';
  actor?: string;
  expected_updated_at?: string;
}

export interface PmAddEvidenceInput {
  path?: string;
  sha256?: string;
  description?: string;
  actor?: string;
  expected_updated_at?: string;
  note?: string;
}

export const pmCreateTask = (body: Record<string, unknown>) => call<PmTaskDetail>('POST', '/api/pm/tasks', body);
export const pmUpdateTask = (id: string, body: Record<string, unknown>) =>
  call<PmTaskDetail>('PATCH', `/api/pm/tasks/${encodeURIComponent(id)}`, body);
export const pmLinkRoom = (id: string, body: PmLinkRoomInput | Record<string, unknown>) => {
  const b = body as Record<string, unknown>;
  const eventId = String(b.eventId || b.event_id || b.token || '');
  const payload: Record<string, unknown> = {
    actor: String(b.actor || ''),
    expected_updated_at: (b.expected_updated_at as string) || '',
    sequence: Number(b.sequence),
    eventId,
    purpose: String(b.purpose || 'Room authorization linked'),
    kind: (b.kind as string) || 'authorization',
  };
  return call<PmTaskDetail>('POST', `/api/pm/tasks/${encodeURIComponent(id)}/room-link`, payload);
};
export const pmAddEvidence = (id: string, body: PmAddEvidenceInput | Record<string, unknown>) => {
  const b = body as Record<string, unknown>;
  const parts = [
    b.description,
    b.path ? `path: ${b.path}` : '',
    b.sha256 ? `sha256: ${b.sha256}` : '',
    b.note,
  ].filter(Boolean);
  const note = parts.join(' · ') || 'Evidence attached';
  return call<PmTaskDetail>('POST', `/api/pm/tasks/${encodeURIComponent(id)}/evidence`, {
    actor: String(b.actor || ''),
    expected_updated_at: (b.expected_updated_at as string) || '',
    note,
    path: b.path ? String(b.path) : undefined,
    sha256: b.sha256 ? String(b.sha256) : undefined,
    description: b.description ? String(b.description) : undefined,
  });
};
export const pmLocalEvidence = (id: string, body: PmLocalEvidenceBody) =>
  call<PmTaskDetail>('POST', `/api/pm/tasks/${encodeURIComponent(id)}/evidence`, body);
export const pmRetryRoomSync = () => call<{ queued: boolean; pending_room_sync: number }>('POST', '/api/pm/room-sync/retry', {});

export interface PmRoadmapMilestone {
  id: string;
  chain: string;
  name: string;
  status: string;
  target_date?: string;
  actual_date?: string;
  notes?: string;
}

export interface PmPlanGeneration {
  id: string;
  title: string;
  status: string;
  card_count: number;
  description: string;
}

export interface PmApprovedPlan {
  generation_id: string;
  approved_date: string;
  authority: string;
  cards: string[];
  description: string;
}

export interface PmStageBinding {
  stage: string;
  chain: string;
  bound_cards: string[];
  bound_status: 'BOUND' | 'NO CARDS BOUND';
}

export interface PmRoadmapsData {
  chains_count: number;
  stages_count: number;
  gaps_count: number;
  milestones: PmRoadmapMilestone[];
  plan_generations?: PmPlanGeneration[];
  current_approved_plan?: PmApprovedPlan;
  phase_label_map?: Record<string, string>;
  stage_bindings?: PmStageBinding[];
}

export const pmGetRoadmaps = () => call<PmRoadmapsData>('GET', '/api/pm/roadmaps');


export const PM_BOARD_HREF: Record<string, string> = {
  command: '#studio/command',
  erp: '#studio/erp/tasks',
  hoadha: '#studio/hoadha/board',
};

export function pmBoardHref(projectId: string): string {
  return PM_BOARD_HREF[projectId] ?? `#studio/${encodeURIComponent(projectId)}`;
}

/** Direct navigation to a PM task detail from a portfolio card. */
export function pmTaskHref(projectId: string, taskId: string): string {
  const route = pmBoardHref(projectId);
  const params = new URLSearchParams({ task: taskId });
  if (pmIsScratch()) params.set('pm_port', String(pmPort()));
  return `${route}?${params.toString()}`;
}

export interface PmActorBody {
  actor: string;
  channel?: 'ui' | 'api' | 'automation';
}

export interface PmOrgHistoryEntry {
  id: number;
  entity: string;
  entity_id: string;
  action: string;
  actor: string;
  channel: string;
  before?: unknown;
  after?: unknown;
  timestamp: string;
}

export interface PmMilestone {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  due_date?: string | null;
  status: 'planned' | 'active' | 'done' | 'missed' | string;
  ordinal?: number;
  total_tasks?: number;
  done_tasks?: number;
  open_tasks?: number;
  blocked_tasks?: number;
  percent_complete?: number;
  overdue?: boolean;
  at_risk?: boolean;
  updated_at?: string;
}

export interface PmDigestSummary {
  date?: string;
  generated_at?: string;
  completed_last_24h?: Array<Record<string, unknown>>;
  started_last_24h?: Array<Record<string, unknown>>;
  blocked_tasks?: Array<Record<string, unknown>>;
  unassigned_open_tasks?: Array<Record<string, unknown>>;
  at_risk_milestones?: Array<Record<string, unknown>>;
  person_load?: Array<Record<string, unknown>>;
  counts?: Record<string, number>;
}

export interface PmDigest {
  id: string;
  generated_at: string;
  trigger?: string;
  summary?: PmDigestSummary;
  delivery_state?: string;
  delivery_detail?: string | null;
}

/**
 * A follow-up episode from the ops-automation backend (pm_followups joined
 * with its task). Served by GET /api/pm/followups.
 */
export interface PmFollowup {
  id: string;
  task_id: string;
  kind?: string;
  status: 'open' | 'acknowledged' | 'snoozed' | 'resolved';
  stale_days?: number;
  last_activity_at?: string;
  snoozed_until?: string | null;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
  // Joined task context (LEFT JOIN pm_tasks).
  task_title?: string | null;
  project_id?: string | null;
  owner?: string | null;
  priority?: string | null;
  stage?: string | null;
  task_status?: string | null;
}

export interface PmWorkforceSummary {
  state?: string;
  person: PmOrgPerson;
  appointments?: { active?: PmOrgAppointment[]; ended?: PmOrgAppointment[] };
  tasks?: {
    owned_open?: Array<Record<string, unknown>>;
    verifying_open?: Array<Record<string, unknown>>;
    blocked?: Array<Record<string, unknown>>;
    counts?: Record<string, number>;
  };
  recent_activity?: Array<Record<string, unknown>>;
}

export const pmOrgHistory = (query?: { entity?: string; id?: string; limit?: number }) => {
  const params = new URLSearchParams();
  if (query?.entity) params.set('entity', query.entity);
  if (query?.id) params.set('id', query.id);
  if (query?.limit) params.set('limit', String(query.limit));
  const q = params.toString();
  return call<{ state?: string; count?: number; history: PmOrgHistoryEntry[] }>('GET', `/api/pm/org/history${q ? `?${q}` : ''}`);
};

export const pmPatchCompany = (id: string, body: PmActorBody & Record<string, unknown>) =>
  call<{ company: PmOrgCompany }>('PATCH', `/api/pm/org/companies/${encodeURIComponent(id)}`, body);
export const pmPatchUnit = (id: string, body: PmActorBody & Record<string, unknown>) =>
  call<{ unit: PmOrgUnit }>('PATCH', `/api/pm/org/units/${encodeURIComponent(id)}`, body);
export const pmPatchPosition = (id: string, body: PmActorBody & Record<string, unknown>) =>
  call<{ position: PmOrgPosition }>('PATCH', `/api/pm/org/positions/${encodeURIComponent(id)}`, body);
export const pmPatchPerson = (id: string, body: PmActorBody & Record<string, unknown>) =>
  call<{ person: PmOrgPerson }>('PATCH', `/api/pm/org/people/${encodeURIComponent(id)}`, body);
export const pmEndAppointment = (id: string, body: PmActorBody & Record<string, unknown>) =>
  call<{ ended_appointment: PmOrgAppointment; new_appointment?: PmOrgAppointment | null }>(
    'POST',
    `/api/pm/org/appointments/${encodeURIComponent(id)}/end`,
    body,
  );
export const pmImportIdentities = (body: PmActorBody) =>
  call<{ state: string; reason?: string; source?: string | null; created?: unknown[]; skipped?: unknown[]; conflicts?: unknown[] }>(
    'POST',
    '/api/pm/org/people/import-identities',
    body,
  );
export const pmWorkforceSummary = (personId: string) =>
  call<PmWorkforceSummary>('GET', `/api/pm/workforce/${encodeURIComponent(personId)}/summary`);
export const pmMilestones = (projectId?: string) =>
  call<{ milestones: PmMilestone[] }>('GET', `/api/pm/milestones${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`);
export const pmCreateMilestone = (body: PmActorBody & Record<string, unknown>) =>
  call<{ milestone: PmMilestone }>('POST', '/api/pm/milestones', body);
export const pmPatchMilestone = (id: string, body: PmActorBody & Record<string, unknown>) =>
  call<{ milestone: PmMilestone }>('PATCH', `/api/pm/milestones/${encodeURIComponent(id)}`, body);
export const pmPatchProject = (id: string, body: PmActorBody & Record<string, unknown>) =>
  call<{ project: PmProject }>('PATCH', `/api/pm/projects/${encodeURIComponent(id)}`, body);
export const pmLatestDigest = () => call<{ digest: PmDigest | null }>('GET', '/api/pm/digests/latest');
export const pmDigests = () => call<{ digests: PmDigest[] }>('GET', '/api/pm/digests');
/** AG's organization import, when that route is present. A 404 means it is not available. */
export function pmOrganizationImportStatus(): Promise<'available' | 'absent'> {
  return fetch(`${pmBase()}/api/pm/import/organization`, { method: 'GET' })
    .then((res) => (res.status === 404 ? 'absent' : 'available'))
    .catch(() => 'absent');
}

export const pmFollowups = (opts?: { status?: string; includeSnoozed?: boolean }) => {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.includeSnoozed) params.set('include_snoozed', '1');
  const qs = params.toString();
  return call<{ followups: PmFollowup[] }>('GET', `/api/pm/followups${qs ? `?${qs}` : ''}`);
};
