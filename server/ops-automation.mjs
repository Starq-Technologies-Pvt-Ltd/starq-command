/**
 * STARQ // COMMAND — Local Operations Automation & Project/Milestone/Deliverable Store (CV-AG3 & CV-AG4).
 *
 * Runs inside the PM service with an injectable clock (`nowFn`), zero external
 * network dependencies, and append-only audit records in `org_audit`.
 */
import crypto from 'node:crypto';
import { recordOrgAudit } from './operating-org.mjs';

const PROJECT_STATUSES = new Set(['active', 'on_hold', 'completed', 'archived']);
const MILESTONE_STATUSES = new Set(['planned', 'active', 'done', 'missed']);
const DELIVERABLE_KINDS = new Set(['document', 'code', 'release', 'decision', 'report', 'other']);
const FOLLOWUP_STATUSES = new Set(['open', 'acknowledged', 'snoozed', 'resolved']);

function ensureColumn(handle, table, col, def) {
  const existing = new Set(
    handle.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name),
  );
  if (!existing.has(col)) {
    handle.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

export function initOpsAutomationSchema(handle) {
  // CV-AG3: Project columns
  ensureColumn(handle, 'pm_projects', 'status', "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(handle, 'pm_projects', 'owner', "TEXT NOT NULL DEFAULT 'UNASSIGNED'");
  ensureColumn(handle, 'pm_projects', 'updated_at', 'TEXT');
  ensureColumn(handle, 'pm_projects', 'archived_at', 'TEXT');

  // CV-AG3: Task milestone / deliverable / work_package columns
  ensureColumn(handle, 'pm_tasks', 'milestone_id', 'TEXT');
  ensureColumn(handle, 'pm_tasks', 'work_package', 'TEXT');
  ensureColumn(handle, 'pm_tasks', 'is_deliverable', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(handle, 'pm_tasks', 'deliverable_kind', 'TEXT');

  // CV-AG3 & CV-AG4: Milestones, Digests, Followups tables
  handle.exec(`
    CREATE TABLE IF NOT EXISTS pm_milestones (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES pm_projects(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','done','missed')),
      ordinal INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pm_milestones_project ON pm_milestones(project_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_pm_tasks_milestone_id ON pm_tasks(milestone_id);
    CREATE INDEX IF NOT EXISTS idx_pm_tasks_work_package ON pm_tasks(work_package);
    CREATE TRIGGER IF NOT EXISTS pm_milestones_no_delete BEFORE DELETE ON pm_milestones
      BEGIN SELECT RAISE(ABORT, 'milestones are never deleted; archive or mark done'); END;

    CREATE TABLE IF NOT EXISTS pm_digests (
      id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'auto',
      summary_json TEXT NOT NULL,
      delivery_state TEXT NOT NULL DEFAULT 'OFF' CHECK (delivery_state IN ('OFF','SENT','FAILED')),
      delivery_detail TEXT
    );
    CREATE TRIGGER IF NOT EXISTS pm_digests_no_delete BEFORE DELETE ON pm_digests
      BEGIN SELECT RAISE(ABORT, 'pm_digests are never deleted'); END;

    CREATE TABLE IF NOT EXISTS pm_followups (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES pm_tasks(id),
      episode_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'stale_in_progress',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','snoozed','resolved')),
      stale_days INTEGER NOT NULL,
      last_activity_at TEXT NOT NULL,
      snoozed_until TEXT,
      acknowledged_by TEXT,
      acknowledged_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pm_followups_status ON pm_followups(status, snoozed_until);
    CREATE INDEX IF NOT EXISTS idx_pm_followups_task ON pm_followups(task_id);
    CREATE TRIGGER IF NOT EXISTS pm_followups_no_delete BEFORE DELETE ON pm_followups
      BEGIN SELECT RAISE(ABORT, 'pm_followups are never deleted'); END;
  `);
}

function slug(prefix, name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'item';
  return `${prefix}-${base}`.slice(0, 64);
}

// ── CV-AG3: Projects ─────────────────────────────────────────────────────────

export function updateProjectRecord(handle, id, {
  name,
  description,
  status,
  owner,
  hold_state,
  archived,
  actor = 'system',
  channel = 'api',
  nowIso = () => new Date().toISOString(),
  effectiveHold = () => null,
}) {
  const existing = handle.prepare('SELECT * FROM pm_projects WHERE id = ?').get(id);
  if (!existing) {
    throw Object.assign(new Error(`Unknown project: ${id}.`), { code: 'PROJECT_NOT_FOUND' });
  }
  let nextStatus = existing.status ?? 'active';
  if (status !== undefined) {
    const s = String(status).toLowerCase();
    if (!PROJECT_STATUSES.has(s)) {
      throw Object.assign(new Error('Project status must be active, on_hold, completed, or archived.'), { code: 'VALIDATION' });
    }
    nextStatus = s;
  }
  const ts = nowIso();
  const nextName = name !== undefined ? name : existing.name;
  const nextDesc = description !== undefined ? description : existing.description;
  const nextOwner = owner !== undefined ? owner : (existing.owner ?? 'UNASSIGNED');
  let nextHoldState = hold_state !== undefined ? hold_state : existing.hold_state;
  if (status === 'on_hold' && hold_state === undefined) nextHoldState = 'ON_HOLD';
  if (status === 'active' && hold_state === undefined && existing.hold_state === 'ON_HOLD') nextHoldState = null;

  let nextArchivedAt = existing.archived_at ?? null;
  if (archived === true || nextStatus === 'archived') {
    if (!nextArchivedAt) nextArchivedAt = ts;
    nextStatus = 'archived';
  } else if (archived === false) {
    nextArchivedAt = null;
    if (nextStatus === 'archived') nextStatus = 'active';
  }

  handle.prepare(
    `UPDATE pm_projects
        SET name = ?, description = ?, status = ?, owner = ?, hold_state = ?, updated_at = ?, archived_at = ?
      WHERE id = ?`,
  ).run(nextName, nextDesc, nextStatus, nextOwner, nextHoldState ?? null, ts, nextArchivedAt, id);

  const updated = handle.prepare('SELECT * FROM pm_projects WHERE id = ?').get(id);
  recordOrgAudit(handle, {
    entity: 'project',
    entity_id: id,
    action: archived === true && !existing.archived_at
      ? 'ARCHIVE'
      : archived === false && existing.archived_at
        ? 'UNARCHIVE'
        : 'UPDATE',
    actor,
    channel,
    before: existing,
    after: updated,
    nowIso: () => ts,
  });
  return { ...updated, hold: effectiveHold(updated) };
}

// ── CV-AG3: Milestones ───────────────────────────────────────────────────────

export function computeMilestoneProgress(handle, milestoneRow, { now = () => new Date() } = {}) {
  if (!milestoneRow) return null;
  const tasks = handle.prepare(
    `SELECT id, status, stage
       FROM pm_tasks
      WHERE milestone_id = ?
         OR (milestone_id IS NULL AND project_id = ? AND milestone = ?)`,
  ).all(milestoneRow.id, milestoneRow.project_id, milestoneRow.title);

  const total = tasks.length;
  const byStatus = { TODO: 0, NEXT: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 };
  const byStage = {};
  let doneTasks = 0;

  for (const t of tasks) {
    const st = t.status || 'TODO';
    byStatus[st] = (byStatus[st] || 0) + 1;
    const stg = t.stage || 'BACKLOG';
    byStage[stg] = (byStage[stg] || 0) + 1;
    if (st === 'DONE' || stg === 'CLOSED' || stg === 'ACCEPTANCE') {
      doneTasks += 1;
    }
  }

  const openTasks = total - doneTasks;
  const percent = total > 0 ? Math.round((doneTasks / total) * 100) : (milestoneRow.status === 'done' ? 100 : 0);

  let overdue = false;
  let atRisk = false;
  if (milestoneRow.due_date && milestoneRow.status !== 'done' && openTasks > 0) {
    const nowTime = now().getTime();
    // Interpret YYYY-MM-DD as end of that UTC day or full ISO timestamp
    const dueStr = String(milestoneRow.due_date).trim();
    const dueTime = dueStr.length === 10
      ? Date.parse(`${dueStr}T23:59:59.999Z`)
      : Date.parse(dueStr);
    if (!Number.isNaN(dueTime)) {
      const diffMs = dueTime - nowTime;
      overdue = diffMs < 0;
      atRisk = diffMs <= 7 * 86_400_000;
    }
  }

  return {
    ...milestoneRow,
    progress: {
      total_tasks: total,
      done_tasks: doneTasks,
      open_tasks: openTasks,
      percent,
      by_status: byStatus,
      by_stage: byStage,
    },
    at_risk: atRisk,
    overdue,
  };
}

export function listMilestones(handle, {
  projectId = null,
  includeArchived = false,
  now = () => new Date(),
} = {}) {
  const clauses = [];
  const args = [];
  if (projectId) {
    clauses.push('project_id = ?');
    args.push(projectId);
  }
  if (!includeArchived) {
    clauses.push('archived_at IS NULL');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = handle.prepare(
    `SELECT * FROM pm_milestones ${where} ORDER BY project_id, ordinal ASC, created_at ASC`,
  ).all(...args);
  return rows.map((r) => computeMilestoneProgress(handle, r, { now }));
}

export function getMilestoneDetail(handle, id, {
  hydrateTask = (r) => r,
  now = () => new Date(),
} = {}) {
  const row = handle.prepare('SELECT * FROM pm_milestones WHERE id = ?').get(id);
  if (!row) {
    throw Object.assign(new Error(`Unknown milestone: ${id}.`), { code: 'MILESTONE_NOT_FOUND' });
  }
  const milestone = computeMilestoneProgress(handle, row, { now });
  const taskRows = handle.prepare(
    `SELECT * FROM pm_tasks
      WHERE milestone_id = ?
         OR (milestone_id IS NULL AND project_id = ? AND milestone = ?)
      ORDER BY id ASC`,
  ).all(row.id, row.project_id, row.title);
  return {
    milestone,
    tasks: taskRows.map((t) => hydrateTask(t)),
  };
}

export function createMilestone(handle, {
  id,
  project_id,
  title,
  description = '',
  due_date = null,
  status = 'planned',
  ordinal = null,
  actor = 'system',
  channel = 'api',
  nowIso = () => new Date().toISOString(),
  now = () => new Date(),
}) {
  const project = handle.prepare('SELECT * FROM pm_projects WHERE id = ?').get(project_id);
  if (!project) {
    throw Object.assign(new Error(`Unknown project: ${project_id}.`), { code: 'PROJECT_NOT_FOUND' });
  }
  if (project.archived_at) {
    throw Object.assign(new Error(`Project is archived: ${project_id}.`), { code: 'ARCHIVED_TARGET' });
  }
  const normStatus = String(status || 'planned').toLowerCase();
  if (!MILESTONE_STATUSES.has(normStatus)) {
    throw Object.assign(new Error('Milestone status must be planned, active, done, or missed.'), { code: 'VALIDATION' });
  }
  const baseId = id || slug(`ms-${project_id}`, title);
  if (handle.prepare('SELECT id FROM pm_milestones WHERE id = ?').get(baseId)) {
    throw Object.assign(new Error(`Milestone already exists: ${baseId}.`), { code: 'MILESTONE_EXISTS' });
  }
  let nextOrdinal = ordinal;
  if (nextOrdinal === null || nextOrdinal === undefined) {
    const maxRow = handle.prepare('SELECT COALESCE(MAX(ordinal), 0) AS m FROM pm_milestones WHERE project_id = ?').get(project_id);
    nextOrdinal = Number(maxRow?.m || 0) + 1;
  }
  const ts = nowIso();
  handle.prepare(
    `INSERT INTO pm_milestones (id, project_id, title, description, due_date, status, ordinal, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(baseId, project_id, title, description ?? '', due_date ?? null, normStatus, Number(nextOrdinal), ts, ts);

  const row = handle.prepare('SELECT * FROM pm_milestones WHERE id = ?').get(baseId);
  recordOrgAudit(handle, {
    entity: 'milestone',
    entity_id: baseId,
    action: 'CREATE',
    actor,
    channel,
    before: null,
    after: row,
    nowIso: () => ts,
  });
  return computeMilestoneProgress(handle, row, { now });
}

export function updateMilestone(handle, id, {
  title,
  description,
  due_date,
  status,
  ordinal,
  archived,
  actor = 'system',
  channel = 'api',
  nowIso = () => new Date().toISOString(),
  now = () => new Date(),
}) {
  const existing = handle.prepare('SELECT * FROM pm_milestones WHERE id = ?').get(id);
  if (!existing) {
    throw Object.assign(new Error(`Unknown milestone: ${id}.`), { code: 'MILESTONE_NOT_FOUND' });
  }
  let nextStatus = existing.status;
  if (status !== undefined) {
    const s = String(status).toLowerCase();
    if (!MILESTONE_STATUSES.has(s)) {
      throw Object.assign(new Error('Milestone status must be planned, active, done, or missed.'), { code: 'VALIDATION' });
    }
    nextStatus = s;
  }
  const ts = nowIso();
  const nextTitle = title !== undefined ? title : existing.title;
  const nextDesc = description !== undefined ? description : existing.description;
  const nextDue = due_date !== undefined ? due_date : existing.due_date;
  const nextOrd = ordinal !== undefined ? Number(ordinal) : existing.ordinal;
  let nextArchivedAt = existing.archived_at ?? null;
  if (archived === true && !nextArchivedAt) nextArchivedAt = ts;
  if (archived === false) nextArchivedAt = null;

  handle.prepare(
    `UPDATE pm_milestones
        SET title = ?, description = ?, due_date = ?, status = ?, ordinal = ?, updated_at = ?, archived_at = ?
      WHERE id = ?`,
  ).run(nextTitle, nextDesc ?? '', nextDue ?? null, nextStatus, nextOrd, ts, nextArchivedAt, id);

  const updated = handle.prepare('SELECT * FROM pm_milestones WHERE id = ?').get(id);
  recordOrgAudit(handle, {
    entity: 'milestone',
    entity_id: id,
    action: archived === true && !existing.archived_at ? 'ARCHIVE' : 'UPDATE',
    actor,
    channel,
    before: existing,
    after: updated,
    nowIso: () => ts,
  });
  return computeMilestoneProgress(handle, updated, { now });
}

// ── CV-AG3: Work Packages & Deliverables ─────────────────────────────────────

export function validateDeliverableKind(kind) {
  if (kind === null || kind === undefined || kind === '') return null;
  const k = String(kind).toLowerCase();
  if (!DELIVERABLE_KINDS.has(k)) {
    throw Object.assign(new Error('deliverable_kind must be document, code, release, decision, report, or other.'), { code: 'VALIDATION' });
  }
  return k;
}

export function listWorkPackages(handle, { projectId = null } = {}) {
  const clauses = [];
  const args = [];
  if (projectId) {
    clauses.push('project_id = ?');
    args.push(projectId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = handle.prepare(
    `SELECT id, project_id, title, status, stage, owner, verifier,
            work_package, epic, task_group, is_deliverable, deliverable_kind,
            branch, commit_sha, pr_ref, pr_url
       FROM pm_tasks
       ${where}
      ORDER BY project_id, id`,
  ).all(...args);

  const groups = new Map();
  for (const r of rows) {
    const wp = (r.work_package && r.work_package.trim())
      || (r.epic && r.epic.trim())
      || (r.task_group && r.task_group.trim())
      || null;
    if (!wp) continue;
    const key = `${r.project_id}::${wp}`;
    let entry = groups.get(key);
    if (!entry) {
      entry = {
        project_id: r.project_id,
        work_package: wp,
        total_tasks: 0,
        done_tasks: 0,
        open_tasks: 0,
        blocked_tasks: 0,
        deliverables: [],
      };
      groups.set(key, entry);
    }
    entry.total_tasks += 1;
    const isDone = r.status === 'DONE' || r.stage === 'CLOSED' || r.stage === 'ACCEPTANCE';
    if (isDone) entry.done_tasks += 1;
    else entry.open_tasks += 1;
    if (r.status === 'BLOCKED' || r.stage === 'BLOCKED') entry.blocked_tasks += 1;
    if (Number(r.is_deliverable) === 1 || r.deliverable_kind || r.commit_sha || r.pr_ref) {
      entry.deliverables.push({
        task_id: r.id,
        title: r.title,
        status: r.status,
        stage: r.stage,
        deliverable_kind: r.deliverable_kind ?? null,
        branch: r.branch ?? null,
        commit_sha: r.commit_sha ?? null,
        pr_ref: r.pr_ref ?? null,
        pr_url: r.pr_url ?? null,
      });
    }
  }

  return [...groups.values()];
}

// ── CV-AG4: Daily Digest & Stale Task Follow-ups ─────────────────────────────

function hydrateDigestRow(row) {
  if (!row) return null;
  let summary = {};
  try { summary = JSON.parse(row.summary_json || '{}'); } catch { summary = {}; }
  return {
    id: row.id,
    generated_at: row.generated_at,
    trigger: row.trigger,
    delivery_state: row.delivery_state,
    delivery_detail: row.delivery_detail ?? null,
    summary,
  };
}

export function listDigests(handle, { limit = 30 } = {}) {
  const capped = Math.min(365, Math.max(1, Number(limit) || 30));
  return handle.prepare(
    'SELECT * FROM pm_digests ORDER BY id DESC LIMIT ?',
  ).all(capped).map(hydrateDigestRow);
}

export function getDigest(handle, id) {
  const row = handle.prepare('SELECT * FROM pm_digests WHERE id = ?').get(id);
  if (!row) {
    throw Object.assign(new Error(`Unknown digest: ${id}.`), { code: 'DIGEST_NOT_FOUND' });
  }
  return hydrateDigestRow(row);
}

export async function generateDigest(handle, {
  now = () => new Date(),
  trigger = 'auto',
  actor = 'automation',
  channel = 'automation',
  force = false,
  deliver = null,
} = {}) {
  const currentNow = now();
  const nowIsoStr = currentNow.toISOString();
  const dateId = nowIsoStr.slice(0, 10);

  const existing = handle.prepare('SELECT * FROM pm_digests WHERE id = ?').get(dateId);
  if (existing && !force) {
    return { created: false, digest: hydrateDigestRow(existing) };
  }

  const cutoff24h = new Date(currentNow.getTime() - 86_400_000).toISOString();

  // Completed in last 24h
  const completedRows = handle.prepare(
    `SELECT id, project_id, title, owner, verifier, closed_at, updated_at
       FROM pm_tasks
      WHERE (status = 'DONE' OR stage = 'CLOSED')
        AND COALESCE(closed_at, updated_at) >= ?
      ORDER BY COALESCE(closed_at, updated_at) DESC`,
  ).all(cutoff24h);

  // Started in last 24h (from pm_status_log or updated_at for LIVE IN_PROGRESS tasks)
  const startedRows = handle.prepare(
    `SELECT DISTINCT t.id, t.project_id, t.title, t.owner, t.stage, t.updated_at
       FROM pm_tasks t
       LEFT JOIN pm_status_log l ON l.task_id = t.id
      WHERE (l.to_status = 'IN_PROGRESS' AND l.timestamp >= ?)
         OR (t.provenance = 'LIVE' AND t.status = 'IN_PROGRESS' AND t.created_at >= ?)
      ORDER BY t.updated_at DESC`,
  ).all(cutoff24h, cutoff24h);

  // Blocked open tasks with age
  const blockedRaw = handle.prepare(
    `SELECT id, project_id, title, owner, priority, updated_at, created_at
       FROM pm_tasks
      WHERE (status = 'BLOCKED' OR stage = 'BLOCKED' OR stage = 'FOUNDER_GATE')
        AND status <> 'DONE'
        AND COALESCE(stage, 'BACKLOG') <> 'CLOSED'
      ORDER BY updated_at ASC`,
  ).all();
  const blockedTasks = blockedRaw.map((b) => {
    const refTime = Date.parse(b.updated_at || b.created_at || nowIsoStr);
    const ageDays = Number.isNaN(refTime) ? 0 : Math.max(0, Math.floor((currentNow.getTime() - refTime) / 86_400_000));
    return {
      id: b.id,
      project_id: b.project_id,
      title: b.title,
      owner: b.owner,
      priority: b.priority,
      age_days: ageDays,
    };
  });

  // Unassigned open tasks (prioritizing LIVE work, plus total count)
  const unassignedRows = handle.prepare(
    `SELECT id, project_id, title, priority, status, stage, provenance
       FROM pm_tasks
      WHERE owner = 'UNASSIGNED'
        AND status <> 'DONE'
        AND COALESCE(stage, 'BACKLOG') <> 'CLOSED'
      ORDER BY CASE WHEN provenance = 'LIVE' THEN 0 ELSE 1 END, id ASC
      LIMIT 50`,
  ).all();

  // At-risk milestones
  const allMilestones = listMilestones(handle, { includeArchived: false, now: () => currentNow });
  const atRiskMilestones = allMilestones
    .filter((m) => m.at_risk)
    .map((m) => ({
      id: m.id,
      project_id: m.project_id,
      title: m.title,
      due_date: m.due_date,
      overdue: m.overdue,
      open_tasks: m.progress.open_tasks,
      percent: m.progress.percent,
    }));

  // Per-person load across active org_people
  const people = handle.prepare(
    "SELECT id, handle, display_name, kind, harness FROM org_people WHERE archived_at IS NULL AND status = 'active' ORDER BY handle ASC",
  ).all();
  const openTasks = handle.prepare(
    "SELECT owner, verifier, status, stage FROM pm_tasks WHERE status <> 'DONE' AND COALESCE(stage, 'BACKLOG') <> 'CLOSED'",
  ).all();

  const personLoad = people.map((p) => {
    const owned = openTasks.filter((t) => t.owner === p.handle);
    const verifying = openTasks.filter((t) => t.verifier === p.handle);
    return {
      handle: p.handle,
      display_name: p.display_name,
      kind: p.kind,
      harness: p.harness ?? null,
      owned_open: owned.length,
      in_progress: owned.filter((t) => t.status === 'IN_PROGRESS' || t.stage === 'IN_PROGRESS').length,
      blocked: owned.filter((t) => t.status === 'BLOCKED' || t.stage === 'BLOCKED').length,
      verifying_open: verifying.length,
    };
  });

  const summary = {
    date: dateId,
    generated_at: nowIsoStr,
    completed_last_24h: completedRows,
    started_last_24h: startedRows,
    blocked_tasks: blockedTasks,
    unassigned_open_tasks: unassignedRows,
    at_risk_milestones: atRiskMilestones,
    person_load: personLoad,
  };

  let deliveryState = 'OFF';
  let deliveryDetail = null;
  const deliveryMode = String(process.env.PM_DIGEST_DELIVERY || 'off').toLowerCase();
  if (deliveryMode === 'on' && typeof deliver === 'function') {
    try {
      const res = await deliver(summary);
      deliveryState = 'SENT';
      deliveryDetail = res ? String(res).slice(0, 300) : 'sent';
    } catch (e) {
      deliveryState = 'FAILED';
      deliveryDetail = String(e?.message || e || 'delivery failed').slice(0, 300);
    }
  }

  if (existing) {
    handle.prepare(
      `UPDATE pm_digests
          SET generated_at = ?, trigger = ?, summary_json = ?, delivery_state = ?, delivery_detail = ?
        WHERE id = ?`,
    ).run(nowIsoStr, trigger, JSON.stringify(summary), deliveryState, deliveryDetail, dateId);
  } else {
    handle.prepare(
      `INSERT INTO pm_digests (id, generated_at, trigger, summary_json, delivery_state, delivery_detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(dateId, nowIsoStr, trigger, JSON.stringify(summary), deliveryState, deliveryDetail);
  }

  const saved = hydrateDigestRow(handle.prepare('SELECT * FROM pm_digests WHERE id = ?').get(dateId));
  recordOrgAudit(handle, {
    entity: 'digest',
    entity_id: dateId,
    action: existing ? 'REGENERATE' : 'GENERATE',
    actor,
    channel,
    before: existing ? hydrateDigestRow(existing) : null,
    after: saved,
    nowIso: () => nowIsoStr,
  });

  return { created: !existing, digest: saved };
}

export function detectStaleTasks(handle, {
  now = () => new Date(),
  staleDays = Number(process.env.PM_STALE_DAYS || 3),
  actor = 'automation',
  channel = 'automation',
} = {}) {
  const currentNow = now();
  const nowIsoStr = currentNow.toISOString();
  const thresholdMs = Math.max(1, Number(staleDays) || 3) * 86_400_000;

  // 1. Auto-resolve open/snoozed followups whose task is no longer IN_PROGRESS or has newer activity
  const activeFollowups = handle.prepare(
    "SELECT * FROM pm_followups WHERE status IN ('open', 'snoozed')",
  ).all();
  for (const fu of activeFollowups) {
    const task = handle.prepare('SELECT id, status, stage, updated_at, created_at FROM pm_tasks WHERE id = ?').get(fu.task_id);
    if (!task) continue;
    const latestLog = handle.prepare(
      'SELECT MAX(timestamp) AS ts FROM pm_status_log WHERE task_id = ?',
    ).get(fu.task_id);
    const lastActivity = latestLog?.ts || task.updated_at || task.created_at;
    const stillInProgress = task.status === 'IN_PROGRESS' || task.stage === 'IN_PROGRESS';
    if (!stillInProgress || (lastActivity && lastActivity > fu.last_activity_at)) {
      handle.prepare(
        "UPDATE pm_followups SET status = 'resolved', updated_at = ? WHERE id = ?",
      ).run(nowIsoStr, fu.id);
      recordOrgAudit(handle, {
        entity: 'followup',
        entity_id: fu.id,
        action: 'RESOLVE',
        actor,
        channel,
        before: fu,
        after: { ...fu, status: 'resolved', updated_at: nowIsoStr },
        nowIso: () => nowIsoStr,
      });
    } else if (fu.status === 'snoozed' && fu.snoozed_until && Date.parse(fu.snoozed_until) <= currentNow.getTime()) {
      handle.prepare(
        "UPDATE pm_followups SET status = 'open', updated_at = ? WHERE id = ?",
      ).run(nowIsoStr, fu.id);
    }
  }

  // 2. Scan IN_PROGRESS tasks for staleness
  const inProgressTasks = handle.prepare(
    `SELECT id, project_id, title, owner, status, stage, provenance, updated_at, created_at
       FROM pm_tasks
      WHERE (status = 'IN_PROGRESS' OR stage = 'IN_PROGRESS')
        AND status <> 'DONE'
        AND COALESCE(stage, 'BACKLOG') <> 'CLOSED'`,
  ).all();

  const created = [];
  for (const t of inProgressTasks) {
    const latestLog = handle.prepare(
      'SELECT MAX(timestamp) AS ts FROM pm_status_log WHERE task_id = ?',
    ).get(t.id);
    const lastActivityAt = latestLog?.ts || t.updated_at || t.created_at;
    if (!lastActivityAt) continue;
    const lastTime = Date.parse(lastActivityAt);
    if (Number.isNaN(lastTime)) continue;

    const elapsedMs = currentNow.getTime() - lastTime;
    if (elapsedMs < thresholdMs) continue;

    const episodeKey = `${t.id}@${lastActivityAt}`;
    const existing = handle.prepare(
      'SELECT id FROM pm_followups WHERE episode_key = ?',
    ).get(episodeKey);
    if (existing) continue;

    const shortHash = crypto.createHash('sha256').update(episodeKey).digest('hex').slice(0, 8);
    const fuId = `fu_${t.id.replace(/[^A-Za-z0-9_-]/g, '_')}_${shortHash}`;
    const computedDays = Math.max(1, Math.floor(elapsedMs / 86_400_000));

    handle.prepare(
      `INSERT INTO pm_followups (
         id, task_id, episode_key, kind, status, stale_days, last_activity_at,
         snoozed_until, acknowledged_by, acknowledged_at, note, created_at, updated_at
       ) VALUES (?, ?, ?, 'stale_in_progress', 'open', ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    ).run(fuId, t.id, episodeKey, computedDays, lastActivityAt, nowIsoStr, nowIsoStr);

    const row = handle.prepare('SELECT * FROM pm_followups WHERE id = ?').get(fuId);
    recordOrgAudit(handle, {
      entity: 'followup',
      entity_id: fuId,
      action: 'CREATE',
      actor,
      channel,
      before: null,
      after: row,
      nowIso: () => nowIsoStr,
    });
    created.push(row);
  }

  return { checked: inProgressTasks.length, created };
}

export function listFollowups(handle, {
  status = null,
  includeSnoozed = false,
  now = () => new Date(),
} = {}) {
  const currentIso = now().toISOString();
  const rows = handle.prepare(
    `SELECT f.*, t.title AS task_title, t.project_id, t.owner, t.verifier, t.priority, t.stage, t.status AS task_status
       FROM pm_followups f
       LEFT JOIN pm_tasks t ON t.id = f.task_id
      ORDER BY f.created_at DESC`,
  ).all();

  return rows.filter((r) => {
    if (status) {
      if (r.status !== status) return false;
      if (status === 'open' && !includeSnoozed && r.snoozed_until && r.snoozed_until > currentIso) {
        return false;
      }
      return true;
    }
    if (!includeSnoozed && r.status === 'snoozed' && r.snoozed_until && r.snoozed_until > currentIso) {
      return false;
    }
    return true;
  });
}

export function acknowledgeFollowup(handle, id, {
  actor,
  note = null,
  channel = 'api',
  nowIso = () => new Date().toISOString(),
}) {
  const existing = handle.prepare('SELECT * FROM pm_followups WHERE id = ?').get(id);
  if (!existing) {
    throw Object.assign(new Error(`Unknown follow-up: ${id}.`), { code: 'FOLLOWUP_NOT_FOUND' });
  }
  const ts = nowIso();
  handle.prepare(
    `UPDATE pm_followups
        SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ?, note = ?, updated_at = ?
      WHERE id = ?`,
  ).run(actor, ts, note ?? existing.note ?? null, ts, id);
  const updated = handle.prepare('SELECT * FROM pm_followups WHERE id = ?').get(id);
  recordOrgAudit(handle, {
    entity: 'followup',
    entity_id: id,
    action: 'ACKNOWLEDGE',
    actor,
    channel,
    before: existing,
    after: updated,
    nowIso: () => ts,
  });
  return updated;
}

export function snoozeFollowup(handle, id, {
  actor,
  until = null,
  days = null,
  note = null,
  channel = 'api',
  now = () => new Date(),
}) {
  const existing = handle.prepare('SELECT * FROM pm_followups WHERE id = ?').get(id);
  if (!existing) {
    throw Object.assign(new Error(`Unknown follow-up: ${id}.`), { code: 'FOLLOWUP_NOT_FOUND' });
  }
  const currentNow = now();
  const ts = currentNow.toISOString();
  let snoozedUntil = null;
  if (until) {
    const parsed = Date.parse(until);
    if (Number.isNaN(parsed)) {
      throw Object.assign(new Error('until must be a valid ISO timestamp.'), { code: 'VALIDATION' });
    }
    snoozedUntil = new Date(parsed).toISOString();
  } else if (days !== null && days !== undefined) {
    const d = Number(days);
    if (!Number.isFinite(d) || d <= 0 || d > 90) {
      throw Object.assign(new Error('days must be a number between 1 and 90.'), { code: 'VALIDATION' });
    }
    snoozedUntil = new Date(currentNow.getTime() + d * 86_400_000).toISOString();
  } else {
    throw Object.assign(new Error('Provide either until (ISO timestamp) or days (1-90) to snooze.'), { code: 'VALIDATION' });
  }

  handle.prepare(
    `UPDATE pm_followups
        SET status = 'snoozed', snoozed_until = ?, note = ?, updated_at = ?
      WHERE id = ?`,
  ).run(snoozedUntil, note ?? existing.note ?? null, ts, id);
  const updated = handle.prepare('SELECT * FROM pm_followups WHERE id = ?').get(id);
  recordOrgAudit(handle, {
    entity: 'followup',
    entity_id: id,
    action: 'SNOOZE',
    actor,
    channel,
    before: existing,
    after: updated,
    nowIso: () => ts,
  });
  return updated;
}

export async function runAutomationTick(handle, {
  now = () => new Date(),
  staleDays = Number(process.env.PM_STALE_DAYS || 3),
  deliver = null,
} = {}) {
  const stale = detectStaleTasks(handle, { now, staleDays });
  const digest = await generateDigest(handle, { now, trigger: 'auto', force: false, deliver });
  return { stale, digest };
}

export function startOpsAutomation(getDb, {
  now = () => new Date(),
  intervalMs = 15 * 60 * 1000,
  deliver = null,
} = {}) {
  const tick = async () => {
    const d = typeof getDb === 'function' ? getDb() : getDb;
    if (!d) return null;
    try {
      return await runAutomationTick(d, { now, deliver });
    } catch (e) {
      console.error('[pm:ops-automation] tick error:', e.message);
      return null;
    }
  };

  // Run initial tick asynchronously on startup
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    tick,
    stop: () => clearInterval(timer),
  };
}
