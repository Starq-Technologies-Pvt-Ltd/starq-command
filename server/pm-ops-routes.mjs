/**
 * STARQ // COMMAND — Extended PM Operations Routes (CV-AG1 through CV-AG4).
 *
 * Dispatched from server/pm-service.mjs after loopback/Host/Origin/X-PM-Client
 * guards have been verified.
 */
import {
  readOrg,
  readOrgHistory,
  createCompany as orgCreateCompany,
  updateCompany as orgUpdateCompany,
  createUnit as orgCreateUnit,
  updateUnit as orgUpdateUnit,
  createPosition as orgCreatePosition,
  updatePosition as orgUpdatePosition,
  createPerson as orgCreatePerson,
  updatePerson as orgUpdatePerson,
  createAppointment as orgCreateAppointment,
  endAppointment as orgEndAppointment,
  importIdentitiesToOrg,
  workforcePersonSummary,
  recordOrgAudit,
} from './operating-org.mjs';
import {
  updateProjectRecord,
  listMilestones,
  getMilestoneDetail,
  createMilestone,
  updateMilestone,
  validateDeliverableKind,
  listWorkPackages,
  listDigests,
  getDigest,
  generateDigest,
  listFollowups,
  acknowledgeFollowup,
  snoozeFollowup,
} from './ops-automation.mjs';

const EXTENDED_TASK_KEYS = [
  'milestone_id',
  'milestone',
  'work_package',
  'is_deliverable',
  'deliverable_kind',
  'epic',
  'sprint',
  'phase',
  'release_track',
  'branch',
  'commit_sha',
  'pr_ref',
  'pr_url',
];

function mapDomainError(e, HttpError) {
  if (e instanceof HttpError) throw e;
  const code = e.code || 'VALIDATION';
  let status = 400;
  if (code.endsWith('NOT_FOUND')) status = 404;
  else if (
    code.endsWith('EXISTS')
    || code.endsWith('CYCLE')
    || code === 'POSITION_OCCUPIED'
    || code === 'ARCHIVED_TARGET'
    || code === 'UNMET_DEPENDENCY'
    || code === 'DEPENDENCY_OPEN'
  ) {
    status = 409;
  }
  throw new HttpError(status, code, e.message, e.extra);
}

function boolField(body, key, bad) {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw bad(`${key} must be a boolean.`, [`${key} must be boolean`]);
  return v;
}

function nullableStr(body, key, { max = 400 } = {}, bad) {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw bad(`${key} must be a string or null.`, [`${key} must be string or null`]);
  const t = v.trim();
  if (t.length > max) throw bad(`${key} length invalid.`, [`${key} max length is ${max}`]);
  return t === '' ? null : t;
}

function extractExtendedTaskFields(body, { d, projectId, bad, HttpError }) {
  const ext = {};
  if (body.milestone_id !== undefined) {
    const mid = nullableStr(body, 'milestone_id', { max: 64 }, bad);
    if (mid !== null) {
      const ms = d.prepare('SELECT * FROM pm_milestones WHERE id = ?').get(mid);
      if (!ms) throw new HttpError(404, 'MILESTONE_NOT_FOUND', `Unknown milestone: ${mid}.`);
      if (projectId && ms.project_id !== projectId) {
        throw new HttpError(422, 'MILESTONE_CROSS_PROJECT', `Milestone ${mid} belongs to project ${ms.project_id}, not ${projectId}.`);
      }
      ext.milestone_id = mid;
      if (body.milestone === undefined) {
        ext.milestone = ms.title;
      }
    } else {
      ext.milestone_id = null;
    }
  }
  if (body.milestone !== undefined) {
    ext.milestone = nullableStr(body, 'milestone', { max: 120 }, bad);
  }
  if (body.work_package !== undefined) {
    ext.work_package = nullableStr(body, 'work_package', { max: 80 }, bad);
  }
  if (body.is_deliverable !== undefined) {
    const b = boolField(body, 'is_deliverable', bad);
    ext.is_deliverable = b ? 1 : 0;
  }
  if (body.deliverable_kind !== undefined) {
    const k = nullableStr(body, 'deliverable_kind', { max: 40 }, bad);
    try {
      ext.deliverable_kind = validateDeliverableKind(k);
    } catch (e) {
      mapDomainError(e, HttpError);
    }
    if (ext.deliverable_kind && ext.is_deliverable === undefined) {
      ext.is_deliverable = 1;
    }
  }
  for (const field of ['epic', 'sprint', 'phase', 'release_track', 'branch', 'commit_sha', 'pr_ref', 'pr_url']) {
    if (body[field] !== undefined) {
      ext[field] = nullableStr(body, field, { max: 300 }, bad);
    }
  }
  return ext;
}

function applyExtendedTaskColumns(d, taskId, ext, nowIso) {
  const keys = Object.keys(ext);
  if (!keys.length) return null;
  const sets = keys.map((k) => `${k} = ?`);
  const vals = keys.map((k) => ext[k]);
  const ts = nowIso();
  sets.push('updated_at = ?');
  vals.push(ts, taskId);
  d.prepare(`UPDATE pm_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return ts;
}

export async function handleOpsRoutes(req, res, ctx) {
  const {
    url,
    p,
    origin,
    db,
    tx,
    send,
    readBody,
    HttpError,
    bad,
    only,
    str,
    handleField,
    createProject,
    createTask,
    updateTask,
    listProjects,
    taskDetail,
    portfolio,
    hydrate,
    getProjectRow,
    getTaskRow,
    effectiveHold,
    logEvent,
    nowIso,
    ROOT,
    ROOM_POST,
    deliverDigest,
  } = ctx;

  const method = String(req.method || '').toLowerCase();
  const isGet = method === 'get';
  const isPost = method === 'post';
  const isPatch = method === 'patch';

  const runDomain = (fn) => {
    try {
      return tx((d) => fn(d));
    } catch (e) {
      mapDomainError(e, HttpError);
    }
  };

  // ── CV-AG1: Organization Read, Create, Update, Archive, Appointments, Audit ──

  if (isGet && p === '/api/pm/org') {
    const includeParam = String(url.searchParams.get('include') || '').toLowerCase();
    const includeArchived = includeParam === 'archived' || includeParam === 'all' || url.searchParams.get('include_archived') === '1';
    return (send(res, 200, readOrg(db(), {
      generatedAt: nowIso(),
      roomPost: ROOM_POST ? 'ON' : 'OFF',
      includeArchived,
    }), origin), true);
  }

  if (isGet && p === '/api/pm/org/history') {
    const entity = url.searchParams.get('entity') || null;
    const id = url.searchParams.get('id') || null;
    const limit = Number(url.searchParams.get('limit') || 100);
    return (send(res, 200, {
      entity,
      id,
      history: readOrgHistory(db(), { entity, id, limit }),
    }, origin), true);
  }

  if (isPost && p === '/api/pm/org/companies') {
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'id', 'name', 'legal_name', 'notes']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const created = runDomain((d) => orgCreateCompany(d, {
      id: str(body, 'id', { max: 64 }),
      name: str(body, 'name', { min: 2, max: 80, required: true }),
      legal_name: nullableStr(body, 'legal_name', { max: 120 }, bad),
      notes: nullableStr(body, 'notes', { max: 400 }, bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 201, created, origin), true);
  }

  let m = /^\/api\/pm\/org\/companies\/([A-Za-z0-9._:-]{2,64})$/.exec(p);
  if (m && isPatch) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'name', 'legal_name', 'notes']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const updated = runDomain((d) => orgUpdateCompany(d, id, {
      name: str(body, 'name', { min: 2, max: 80 }),
      legal_name: nullableStr(body, 'legal_name', { max: 120 }, bad),
      notes: nullableStr(body, 'notes', { max: 400 }, bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 200, updated, origin), true);
  }

  if (isPost && p === '/api/pm/org/units') {
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'id', 'company_id', 'parent_id', 'kind', 'name', 'description']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const rawKind = str(body, 'kind', { min: 4, max: 20, required: true });
    const created = runDomain((d) => orgCreateUnit(d, {
      id: str(body, 'id', { max: 64 }),
      company_id: str(body, 'company_id', { min: 2, max: 64, required: true }),
      parent_id: nullableStr(body, 'parent_id', { max: 64 }, bad),
      kind: rawKind.toUpperCase(),
      name: str(body, 'name', { min: 2, max: 80, required: true }),
      description: nullableStr(body, 'description', { max: 400 }, bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 201, created, origin), true);
  }

  m = /^\/api\/pm\/org\/units\/([A-Za-z0-9._:-]{2,64})$/.exec(p);
  if (m && isPatch) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'name', 'description', 'kind', 'parent_id', 'archived']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const rawKind = str(body, 'kind', { min: 4, max: 20 });
    const updated = runDomain((d) => orgUpdateUnit(d, id, {
      name: str(body, 'name', { min: 2, max: 80 }),
      description: nullableStr(body, 'description', { max: 400 }, bad),
      kind: rawKind ? rawKind.toUpperCase() : undefined,
      parent_id: nullableStr(body, 'parent_id', { max: 64 }, bad),
      archived: boolField(body, 'archived', bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 200, updated, origin), true);
  }

  if (isPost && p === '/api/pm/org/positions') {
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'id', 'unit_id', 'title', 'job_description', 'reports_to_position_id']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const created = runDomain((d) => orgCreatePosition(d, {
      id: str(body, 'id', { max: 64 }),
      unit_id: str(body, 'unit_id', { min: 2, max: 64, required: true }),
      title: str(body, 'title', { min: 2, max: 80, required: true }),
      job_description: nullableStr(body, 'job_description', { max: 400 }, bad),
      reports_to_position_id: nullableStr(body, 'reports_to_position_id', { max: 64 }, bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 201, created, origin), true);
  }

  m = /^\/api\/pm\/org\/positions\/([A-Za-z0-9._:-]{2,64})$/.exec(p);
  if (m && isPatch) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'title', 'job_description', 'unit_id', 'reports_to_position_id', 'archived']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const updated = runDomain((d) => orgUpdatePosition(d, id, {
      title: str(body, 'title', { min: 2, max: 80 }),
      job_description: nullableStr(body, 'job_description', { max: 400 }, bad),
      unit_id: str(body, 'unit_id', { min: 2, max: 64 }),
      reports_to_position_id: nullableStr(body, 'reports_to_position_id', { max: 64 }, bad),
      archived: boolField(body, 'archived', bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 200, updated, origin), true);
  }

  // ── CV-AG2: Workforce Registry & Import ──────────────────────────────────────

  if (isPost && p === '/api/pm/org/people/import-identities') {
    const body = await readBody(req);
    only(body, ['actor', 'channel']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const result = runDomain((d) => importIdentitiesToOrg(d, {
      workspaceRoot: ROOT,
      identitiesPath: process.env.PM_IDENTITIES_PATH || null,
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 200, result, origin), true);
  }

  if (isPost && p === '/api/pm/org/people') {
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'id', 'handle', 'display_name', 'kind', 'role_note', 'harness', 'capabilities', 'status', 'room_handle']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const rawKind = str(body, 'kind', { min: 5, max: 10, required: true });
    const created = runDomain((d) => orgCreatePerson(d, {
      id: str(body, 'id', { max: 64 }),
      handle: str(body, 'handle', { min: 2, max: 40, required: true }),
      display_name: str(body, 'display_name', { min: 2, max: 80, required: true }),
      kind: rawKind.toUpperCase(),
      role_note: nullableStr(body, 'role_note', { max: 400 }, bad),
      harness: nullableStr(body, 'harness', { max: 80 }, bad),
      capabilities: body.capabilities,
      status: str(body, 'status', { max: 20 }) ?? 'active',
      room_handle: nullableStr(body, 'room_handle', { max: 40 }, bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 201, created, origin), true);
  }

  m = /^\/api\/pm\/org\/people\/([A-Za-z0-9._:-]{2,64})$/.exec(p);
  if (m && isPatch) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'display_name', 'kind', 'status', 'role_note', 'harness', 'capabilities', 'room_handle', 'archived']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const rawKind = str(body, 'kind', { min: 5, max: 10 });
    const updated = runDomain((d) => orgUpdatePerson(d, id, {
      display_name: str(body, 'display_name', { min: 2, max: 80 }),
      kind: rawKind ? rawKind.toUpperCase() : undefined,
      status: str(body, 'status', { max: 20 }),
      role_note: nullableStr(body, 'role_note', { max: 400 }, bad),
      harness: nullableStr(body, 'harness', { max: 80 }, bad),
      capabilities: body.capabilities,
      room_handle: nullableStr(body, 'room_handle', { max: 40 }, bad),
      archived: boolField(body, 'archived', bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 200, updated, origin), true);
  }

  if (isPost && p === '/api/pm/org/appointments') {
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'id', 'position_id', 'person_id', 'notes']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const created = runDomain((d) => orgCreateAppointment(d, {
      id: str(body, 'id', { max: 64 }),
      position_id: str(body, 'position_id', { min: 2, max: 64, required: true }),
      person_id: str(body, 'person_id', { min: 2, max: 64, required: true }),
      notes: nullableStr(body, 'notes', { max: 400 }, bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 201, created, origin), true);
  }

  m = /^\/api\/pm\/org\/appointments\/([A-Za-z0-9._:-]{2,64})\/end$/.exec(p);
  if (m && isPost) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'notes', 'reassign_to_person_id', 'reassign_notes']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const result = runDomain((d) => orgEndAppointment(d, id, {
      notes: nullableStr(body, 'notes', { max: 400 }, bad),
      reassign_to_person_id: nullableStr(body, 'reassign_to_person_id', { max: 64 }, bad),
      reassign_notes: nullableStr(body, 'reassign_notes', { max: 400 }, bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 200, result, origin), true);
  }

  m = /^\/api\/pm\/org\/appointments\/([A-Za-z0-9._:-]{2,64})$/.exec(p);
  if (m && isPatch) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'status', 'notes', 'reassign_to_person_id', 'reassign_notes']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const result = runDomain((d) => orgEndAppointment(d, id, {
      notes: nullableStr(body, 'notes', { max: 400 }, bad),
      reassign_to_person_id: nullableStr(body, 'reassign_to_person_id', { max: 64 }, bad),
      reassign_notes: nullableStr(body, 'reassign_notes', { max: 400 }, bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 200, result, origin), true);
  }

  m = /^\/api\/pm\/workforce\/([A-Za-z0-9._:-]{2,64})\/summary$/.exec(p);
  if (m && isGet) {
    const personId = decodeURIComponent(m[1]);
    try {
      const summary = workforcePersonSummary(db(), personId, { hydrateTask: (r) => hydrate(r) });
      return (send(res, 200, summary, origin), true);
    } catch (e) {
      mapDomainError(e, HttpError);
    }
  }

  // ── CV-AG3: Projects, Milestones, Deliverables, Work Packages ────────────────

  if (isGet && p === '/api/pm/projects') {
    const includeParam = String(url.searchParams.get('include') || '').toLowerCase();
    const includeArchived = includeParam === 'archived' || includeParam === 'all';
    const all = listProjects();
    const filtered = includeArchived ? all : all.filter((pr) => !pr.archived_at && pr.status !== 'archived');
    return (send(res, 200, { projects: filtered, include_archived: includeArchived }, origin), true);
  }

  if (isPost && p === '/api/pm/projects') {
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'id', 'name', 'prefix', 'description', 'owner', 'status']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const owner = handleField(body, 'owner', { freeform: true }) ?? 'UNASSIGNED';
    const status = str(body, 'status', { max: 20 }) ?? 'active';
    const baseBody = {
      actor: body.actor,
      id: body.id,
      name: body.name,
      prefix: body.prefix,
      description: body.description,
    };
    const updated = runDomain((d) => {
      const created = createProject(baseBody, d);
      return updateProjectRecord(d, created.id, {
        owner,
        status,
        actor,
        channel,
        nowIso,
        effectiveHold,
      });
    });
    return (send(res, 201, updated, origin), true);
  }

  m = /^\/api\/pm\/projects\/([A-Za-z0-9._:-]{2,40})$/.exec(p);
  if (m && isPatch) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'name', 'description', 'status', 'owner', 'hold_state', 'archived']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const owner = handleField(body, 'owner', { freeform: true });
    const updated = runDomain((d) => updateProjectRecord(d, id, {
      name: str(body, 'name', { min: 2, max: 80 }),
      description: str(body, 'description', { max: 400 }),
      status: str(body, 'status', { max: 20 }),
      owner,
      hold_state: nullableStr(body, 'hold_state', { max: 40 }, bad),
      archived: boolField(body, 'archived', bad),
      actor,
      channel,
      nowIso,
      effectiveHold,
    }));
    return (send(res, 200, updated, origin), true);
  }

  if (isGet && p === '/api/pm/portfolio') {
    const includeParam = String(url.searchParams.get('include') || '').toLowerCase();
    const includeArchived = includeParam === 'archived' || includeParam === 'all';
    const port = portfolio();
    if (!includeArchived) {
      const archivedIds = new Set(
        listProjects()
          .filter((pr) => pr.archived_at || pr.status === 'archived')
          .map((pr) => pr.id),
      );
      port.projects = port.projects.filter((pr) => !archivedIds.has(pr.id));
    }
    return (send(res, 200, port, origin), true);
  }

  if (isGet && p === '/api/pm/milestones') {
    const projectId = url.searchParams.get('project_id') || null;
    if (projectId && !getProjectRow(projectId)) {
      throw new HttpError(404, 'PROJECT_NOT_FOUND', `Unknown project: ${projectId}.`);
    }
    const includeParam = String(url.searchParams.get('include') || '').toLowerCase();
    const includeArchived = includeParam === 'archived' || includeParam === 'all';
    return (send(res, 200, {
      project_id: projectId,
      milestones: listMilestones(db(), { projectId, includeArchived }),
    }, origin), true);
  }

  if (isPost && p === '/api/pm/milestones') {
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'id', 'project_id', 'title', 'description', 'due_date', 'status', 'ordinal']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const created = runDomain((d) => createMilestone(d, {
      id: str(body, 'id', { max: 64 }),
      project_id: str(body, 'project_id', { min: 2, max: 40, required: true }),
      title: str(body, 'title', { min: 2, max: 120, required: true }),
      description: str(body, 'description', { max: 1000 }) ?? '',
      due_date: nullableStr(body, 'due_date', { max: 40 }, bad),
      status: str(body, 'status', { max: 20 }) ?? 'planned',
      ordinal: body.ordinal !== undefined ? Number(body.ordinal) : null,
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 201, created, origin), true);
  }

  m = /^\/api\/pm\/milestones\/([A-Za-z0-9._:-]{2,64})$/.exec(p);
  if (m && isGet) {
    const id = decodeURIComponent(m[1]);
    try {
      const detail = getMilestoneDetail(db(), id, { hydrateTask: (r) => hydrate(r) });
      return (send(res, 200, detail, origin), true);
    } catch (e) {
      mapDomainError(e, HttpError);
    }
  }
  if (m && isPatch) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'title', 'description', 'due_date', 'status', 'ordinal', 'archived']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const updated = runDomain((d) => updateMilestone(d, id, {
      title: str(body, 'title', { min: 2, max: 120 }),
      description: str(body, 'description', { max: 1000 }),
      due_date: nullableStr(body, 'due_date', { max: 40 }, bad),
      status: str(body, 'status', { max: 20 }),
      ordinal: body.ordinal !== undefined ? Number(body.ordinal) : undefined,
      archived: boolField(body, 'archived', bad),
      actor,
      channel,
      nowIso,
    }));
    return (send(res, 200, updated, origin), true);
  }

  if (isGet && p === '/api/pm/work-packages') {
    const projectId = url.searchParams.get('project_id') || null;
    if (projectId && !getProjectRow(projectId)) {
      throw new HttpError(404, 'PROJECT_NOT_FOUND', `Unknown project: ${projectId}.`);
    }
    return (send(res, 200, {
      project_id: projectId,
      work_packages: listWorkPackages(db(), { projectId }),
    }, origin), true);
  }

  // Extended POST /api/pm/tasks supporting milestone_id, work_package, deliverables, artifacts
  if (isPost && p === '/api/pm/tasks') {
    const body = await readBody(req);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw bad('Body must be a JSON object.');
    }
    const baseAllowed = ['project_id', 'title', 'description', 'priority', 'owner', 'verifier', 'notes', 'depends_on', 'actor', 'status', 'stage'];
    only(body, [...baseAllowed, ...EXTENDED_TASK_KEYS]);

    const projectId = str(body, 'project_id', { min: 2, max: 40, required: true });
    const ext = extractExtendedTaskFields(body, { d: db(), projectId, bad, HttpError });

    const baseBody = {};
    for (const k of baseAllowed) {
      if (body[k] !== undefined) baseBody[k] = body[k];
    }
    const createdDetail = createTask(baseBody);
    if (Object.keys(ext).length > 0) {
      tx((d) => {
        applyExtendedTaskColumns(d, createdDetail.task.id, ext, nowIso);
      });
      return (send(res, 201, taskDetail(createdDetail.task.id), origin), true);
    }
    return (send(res, 201, createdDetail, origin), true);
  }

  // Extended PATCH /api/pm/tasks/:id supporting milestone_id, work_package, deliverables, artifacts
  m = /^\/api\/pm\/tasks\/([A-Za-z0-9._:-]{2,40})$/.exec(p);
  if (m && isPatch) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw bad('Body must be a JSON object.');
    }
    const baseAllowed = ['expected_updated_at', 'actor', 'title', 'description', 'priority', 'owner', 'verifier', 'notes', 'depends_on', 'status', 'stage', 'note'];
    only(body, [...baseAllowed, ...EXTENDED_TASK_KEYS]);

    const row = getTaskRow(id);
    if (!row) throw new HttpError(404, 'TASK_NOT_FOUND', `Unknown task: ${id}.`);

    const ext = extractExtendedTaskFields(body, { d: db(), projectId: row.project_id, bad, HttpError });
    const hasBaseChange = ['title', 'description', 'priority', 'owner', 'verifier', 'notes', 'depends_on', 'status', 'stage'].some(
      (k) => body[k] !== undefined,
    );

    if (hasBaseChange || Object.keys(ext).length === 0) {
      const baseBody = {};
      for (const k of baseAllowed) {
        if (body[k] !== undefined) baseBody[k] = body[k];
      }
      const updatedDetail = updateTask(id, baseBody);
      if (Object.keys(ext).length > 0) {
        tx((d) => {
          applyExtendedTaskColumns(d, id, ext, nowIso);
        });
        return (send(res, 200, taskDetail(id), origin), true);
      }
      return (send(res, 200, updatedDetail, origin), true);
    }

    // Only extended fields were changed
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const expected = str(body, 'expected_updated_at', { min: 10, max: 40, required: true });
    if (row.updated_at !== expected) {
      throw new HttpError(409, 'STALE_EDIT', 'Task changed since you loaded it; reload before editing. Nothing was saved.', {
        current_updated_at: row.updated_at,
      });
    }
    tx((d) => {
      applyExtendedTaskColumns(d, id, ext, nowIso);
      logEvent(d, {
        taskId: id,
        type: 'FIELDS_UPDATED',
        actor,
        detail: ext,
        post: false,
      });
    });
    return (send(res, 200, taskDetail(id), origin), true);
  }

  m = /^\/api\/pm\/tasks\/([A-Za-z0-9._:-]{2,40})\/artifacts$/.exec(p);
  if (m && isPost) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'expected_updated_at', 'branch', 'commit_sha', 'pr_ref', 'pr_url', 'deliverable_kind', 'is_deliverable', 'note']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const expected = str(body, 'expected_updated_at', { min: 10, max: 40 });
    const note = str(body, 'note', { max: 1000 });
    const row = getTaskRow(id);
    if (!row) throw new HttpError(404, 'TASK_NOT_FOUND', `Unknown task: ${id}.`);
    if (expected && row.updated_at !== expected) {
      throw new HttpError(409, 'STALE_EDIT', 'Task changed since you loaded it; reload before editing. Nothing was saved.', {
        current_updated_at: row.updated_at,
      });
    }
    const ext = extractExtendedTaskFields(body, { d: db(), projectId: row.project_id, bad, HttpError });
    if (!Object.keys(ext).length) {
      throw bad('Provide at least one artifact field (branch, commit_sha, pr_ref, pr_url, deliverable_kind, is_deliverable).', ['no artifact fields']);
    }
    tx((d) => {
      applyExtendedTaskColumns(d, id, ext, nowIso);
      logEvent(d, {
        taskId: id,
        type: 'ARTIFACTS_LINKED',
        actor,
        detail: { ...ext, ...(note ? { note } : {}) },
        post: false,
      });
      recordOrgAudit(d, {
        entity: 'task_artifact',
        entity_id: id,
        action: 'LINK_ARTIFACT',
        actor,
        channel: 'api',
        before: {
          branch: row.branch ?? null,
          commit_sha: row.commit_sha ?? null,
          pr_ref: row.pr_ref ?? null,
          pr_url: row.pr_url ?? null,
          deliverable_kind: row.deliverable_kind ?? null,
          is_deliverable: Boolean(row.is_deliverable),
        },
        after: ext,
        nowIso,
      });
    });
    return (send(res, 200, taskDetail(id), origin), true);
  }

  // ── CV-AG4: Operations Automation Routes (Digests & Follow-ups) ──────────────

  if (isGet && p === '/api/pm/digests') {
    const limit = Number(url.searchParams.get('limit') || 30);
    return (send(res, 200, { digests: listDigests(db(), { limit }) }, origin), true);
  }

  // The Founder Home and Activity "latest digest" panels read the single most
  // recent digest. listDigests already orders newest-first, so take its head.
  // Returns { digest: null } (200) when none has been generated yet, which the
  // client renders as "no digest recorded" rather than an error.
  if (isGet && p === '/api/pm/digests/latest') {
    const [latest] = listDigests(db(), { limit: 1 });
    return (send(res, 200, { digest: latest ?? null }, origin), true);
  }

  if (isPost && p === '/api/pm/digests/generate') {
    const body = (await readBody(req)) ?? {};
    only(body, ['actor', 'channel', 'force', 'date']);
    const actor = handleField(body, 'actor', { required: false, allowUnassigned: false, freeform: true }) ?? 'automation';
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const force = body.force === undefined ? true : Boolean(body.force);
    const customDate = str(body, 'date', { min: 10, max: 30 });
    const nowFn = customDate
      ? () => new Date(customDate.length === 10 ? `${customDate}T12:00:00.000Z` : customDate)
      : () => new Date();
    const resDigest = await generateDigest(db(), {
      now: nowFn,
      trigger: 'manual',
      actor,
      channel,
      force,
      deliver: deliverDigest,
    });
    return (send(res, resDigest.created ? 201 : 200, resDigest, origin), true);
  }

  m = /^\/api\/pm\/digests\/([0-9]{4}-[0-9]{2}-[0-9]{2})$/.exec(p);
  if (m && isGet) {
    const id = decodeURIComponent(m[1]);
    try {
      return (send(res, 200, { digest: getDigest(db(), id) }, origin), true);
    } catch (e) {
      mapDomainError(e, HttpError);
    }
  }

  if (isGet && p === '/api/pm/followups') {
    const status = url.searchParams.get('status') || null;
    const includeSnoozed = url.searchParams.get('include_snoozed') === '1' || url.searchParams.get('include') === 'snoozed';
    return (send(res, 200, {
      followups: listFollowups(db(), { status, includeSnoozed }),
    }, origin), true);
  }

  m = /^\/api\/pm\/followups\/([A-Za-z0-9._:-]{2,80})\/acknowledge$/.exec(p);
  if (m && isPost) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'note']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const note = nullableStr(body, 'note', { max: 400 }, bad);
    const updated = runDomain((d) => acknowledgeFollowup(d, id, {
      actor,
      note,
      channel,
      nowIso,
    }));
    return (send(res, 200, { followup: updated }, origin), true);
  }

  m = /^\/api\/pm\/followups\/([A-Za-z0-9._:-]{2,80})\/snooze$/.exec(p);
  if (m && isPost) {
    const id = decodeURIComponent(m[1]);
    const body = await readBody(req);
    only(body, ['actor', 'channel', 'until', 'days', 'note']);
    const actor = handleField(body, 'actor', { required: true, allowUnassigned: false, freeform: true });
    const channel = str(body, 'channel', { max: 20 }) ?? 'api';
    const until = nullableStr(body, 'until', { max: 40 }, bad);
    const days = body.days !== undefined ? Number(body.days) : null;
    const note = nullableStr(body, 'note', { max: 400 }, bad);
    const updated = runDomain((d) => snoozeFollowup(d, id, {
      actor,
      until,
      days,
      note,
      channel,
    }));
    return (send(res, 200, { followup: updated }, origin), true);
  }

  return false;
}
