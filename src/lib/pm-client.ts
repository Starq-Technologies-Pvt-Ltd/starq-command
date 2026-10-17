/**
 * Typed client for the human-operated PM service (server/pm-service.mjs, :5176).
 * Every failure is returned as a value; nothing here throws into a component.
 */
/**
 * Production PM service is always :5176. A disposable verification instance may be
 * addressed with `?pm_port=5190..5199` on the hash; it is labelled SCRATCH in the UI.
 */
export function pmPort(): number {
  try {
    const q = window.location.hash.split('?')[1] ?? '';
    const v = new URLSearchParams(q).get('pm_port');
    return v && /^519\d$/.test(v) ? Number(v) : 5176;
  } catch {
    return 5176;
  }
}
export const pmIsScratch = () => pmPort() !== 5176;
export const pmQuery = () => (pmIsScratch() ? `?pm_port=${pmPort()}` : '');
const pmBase = () => `http://127.0.0.1:${pmPort()}`;

export const PM_STATUSES = [
  'BACKLOG', 'READY', 'IN_PROGRESS', 'REVIEW', 'VERIFICATION',
  'ACCEPTANCE', 'CLOSED', 'BLOCKED', 'FOUNDER_GATE',
] as const;
export type PmStatus = (typeof PM_STATUSES)[number];
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
  work_package_id: string | null;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  allowed_next: PmStatus[];
  pending_room_sync: number;
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
}

export interface PmPortfolio {
  generated_at: string;
  pending_room_sync: number;
  statuses: PmStatus[];
  projects: PmPortfolioProject[];
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

export const MILESTONE_STATUSES = ['OPEN', 'AT_RISK', 'ACHIEVED', 'MISSED'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export const WORK_PACKAGE_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'] as const;
export type WorkPackageStatus = (typeof WORK_PACKAGE_STATUSES)[number];

export interface PmMilestone {
  id: string;
  project_id: string;
  title: string;
  description: string;
  target_date: string | null;
  status: MilestoneStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  work_package_counts: Record<WorkPackageStatus, number>;
  work_package_total: number;
}

export interface PmWorkPackage {
  id: string;
  project_id: string;
  milestone_id: string | null;
  title: string;
  description: string;
  owner: string;
  status: WorkPackageStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  task_counts: Record<PmStatus, number>;
  task_total: number;
}

export interface PmMilestoneDetail {
  milestone: PmMilestone;
  work_packages: PmWorkPackage[];
}

export interface PmWorkPackageDetail {
  work_package: PmWorkPackage;
  tasks: PmTask[];
}

export interface PmMeta {
  statuses: PmStatus[];
  priorities: PmPriority[];
  handles: string[];
  milestone_statuses?: MilestoneStatus[];
  work_package_statuses?: WorkPackageStatus[];
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
      code: String(payload?.error ?? 'ERROR'),
      message: String(payload?.message ?? `PM service returned ${res.status}`),
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

export const pmHealth = () => call<PmHealth>('GET', '/api/pm/health');
export const pmMeta = () => call<PmMeta>('GET', '/api/pm/meta');
export const pmProjects = () => call<{ projects: PmProject[] }>('GET', '/api/pm/projects');
export const pmTasks = (projectId: string) =>
  call<{ project_id: string; tasks: PmTask[] }>('GET', `/api/pm/tasks?project_id=${encodeURIComponent(projectId)}`);
export const pmTask = (id: string) => call<PmTaskDetail>('GET', `/api/pm/tasks/${encodeURIComponent(id)}`);
export const pmPortfolio = () => call<PmPortfolio>('GET', '/api/pm/portfolio');
export const pmCreateTask = (body: Record<string, unknown>) => call<PmTaskDetail>('POST', '/api/pm/tasks', body);
export const pmUpdateTask = (id: string, body: Record<string, unknown>) =>
  call<PmTaskDetail>('PATCH', `/api/pm/tasks/${encodeURIComponent(id)}`, body);
export const pmLinkRoom = (id: string, body: Record<string, unknown>) =>
  call<PmTaskDetail>('POST', `/api/pm/tasks/${encodeURIComponent(id)}/room-link`, body);
export const pmRetryRoomSync = () => call<{ queued: boolean; pending_room_sync: number }>('POST', '/api/pm/room-sync/retry', {});

export const pmMilestones = (projectId: string) =>
  call<{ project_id: string; milestones: PmMilestone[] }>('GET', `/api/pm/milestones?project_id=${encodeURIComponent(projectId)}`);
export const pmMilestone = (id: string) => call<PmMilestoneDetail>('GET', `/api/pm/milestones/${encodeURIComponent(id)}`);
export const pmCreateMilestone = (body: Record<string, unknown>) => call<PmMilestone>('POST', '/api/pm/milestones', body);
export const pmUpdateMilestone = (id: string, body: Record<string, unknown>) =>
  call<PmMilestone>('PATCH', `/api/pm/milestones/${encodeURIComponent(id)}`, body);

export const pmWorkPackages = (projectId: string, milestoneId?: string) =>
  call<{ project_id: string; milestone_id: string | null; work_packages: PmWorkPackage[] }>(
    'GET',
    `/api/pm/work-packages?project_id=${encodeURIComponent(projectId)}${milestoneId ? `&milestone_id=${encodeURIComponent(milestoneId)}` : ''}`,
  );
export const pmWorkPackage = (id: string) => call<PmWorkPackageDetail>('GET', `/api/pm/work-packages/${encodeURIComponent(id)}`);
export const pmCreateWorkPackage = (body: Record<string, unknown>) => call<PmWorkPackage>('POST', '/api/pm/work-packages', body);
export const pmUpdateWorkPackage = (id: string, body: Record<string, unknown>) =>
  call<PmWorkPackage>('PATCH', `/api/pm/work-packages/${encodeURIComponent(id)}`, body);

export const PM_BOARD_HREF: Record<string, string> = {
  command: '#studio/command',
  erp: '#studio/erp/tasks',
  hoadha: '#studio/hoadha/board',
};

/** Direct, read-only navigation to a PM task detail from a portfolio card. */
export function pmTaskHref(projectId: string, taskId: string): string {
  const route = PM_BOARD_HREF[projectId] ?? `#studio/${encodeURIComponent(projectId)}`;
  const params = new URLSearchParams({ task: taskId });
  if (pmIsScratch()) params.set('pm_port', String(pmPort()));
  return `${route}?${params.toString()}`;
}
