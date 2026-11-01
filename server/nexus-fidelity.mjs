/**
 * STARQ // COMMAND — Nexus record fidelity.
 *
 * Authority: Founder, 28 Oct 2026 — "Resolve the SPOS-008 collision and
 * restore all original task attributes from pm_source_records.raw_payload,
 * including workers, priorities, milestones, acceptance, dispatch, commits,
 * branches and history. Reconcile all 1,305 source records without losing
 * their identities or provenance."
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 *
 * The first import mapped 9 of the 218 distinct keys the Nexus boards carry.
 * `epic`, `lane`, `milestone`, `release_track`, `acceptance`, `evidence`,
 * `verification`, `dispatched_by`, `completed_by`, `parent`, `commit`,
 * `branch`, `pr` and the rest were dropped from the row; `phase` and `sprint`
 * survived only as prose inside `notes`; `workers[]` collapsed to its first
 * element; and 31 non-P0-P3 priorities were coerced to P2.
 *
 * None of it was destroyed — `pm_source_records.raw_payload` holds the entire
 * original JSON object per record — but none of it was queryable either. This
 * module promotes it back into columns, reading from raw_payload so the Nexus
 * source files are never re-read and the import cannot drift.
 *
 * ── LOSSLESS BY CONSTRUCTION ────────────────────────────────────────────────
 *
 * Two layers:
 *   1. NAMED COLUMNS for everything an operator would filter or group by.
 *   2. `nexus_attributes` — the COMPLETE original record, verbatim.
 *
 * So a field nobody thought to columnise is still there, and a future column
 * can be derived from it without another migration of the source.
 *
 * ── IDENTITY IS (BOARD, TASK ID), NOT TASK ID ───────────────────────────────
 *
 * `SPOS-008` exists in BOTH starq-erp-tasks.json and starq-pos-tasks.json, and
 * they are DIFFERENT WORK: the ERP row is a closed Phase 9 record under epic
 * SERP-M6, the POS row is an open Phase 1 card under epic SPOS-E01. The
 * importer's global `seenTaskIds` guard discarded the second one, so 1,304 of
 * 1,305 records imported and the POS card vanished silently.
 *
 * The fix is not to rename history. Every row now carries `nexus_task_id` (the
 * original, collisions and all) and `nexus_source_file`, and only the DATABASE
 * KEY is disambiguated, as `<id>:<project>`. The original identity is intact
 * and the provenance says exactly which board it came from.
 */

import { createHash } from 'node:crypto';

/** Named columns: type is TEXT throughout — Nexus values are type-unstable
 *  (priority is string|number, acceptance array|string, pr number|string), and
 *  coercing them to a typed column is how fidelity gets lost. */
const FIDELITY_COLUMNS = [
  'nexus_task_id', 'nexus_source_file', 'nexus_source_key', 'nexus_status',
  'nexus_project', 'nexus_attributes',
  'phase', 'sprint', 'epic', 'lane', 'milestone', 'release_track', 'module', 'task_group', 'work_package',
  'workers_json', 'priority_raw',
  'dispatched_at', 'dispatched_by', 'started_at', 'claimed_at',
  'completed_at', 'completed_by', 'done_at', 'accepted_at', 'accepted_by',
  'parent_task', 'children_json', 'related_json', 'blocked_by_json',
  'requirements_json', 'from_decision_json', 'dependencies_json',
  'acceptance_json', 'evidence_json', 'verification_json',
  'branch', 'commit_sha', 'commits_json', 'merge_commit', 'pr_ref', 'pr_url', 'worktree',
  'reviewed_by', 'review_note', 'independent_reviewer', 'review_pending',
  'primary_contributor', 'contributors_json',
  'blocked_reason', 'blockers', 'notes_raw',
];

export function ensureFidelityColumns(handle) {
  const existing = new Set(
    handle.prepare("SELECT name FROM pragma_table_info('pm_tasks')").all().map((r) => r.name),
  );
  let added = 0;
  for (const col of FIDELITY_COLUMNS) {
    if (!existing.has(col)) {
      handle.exec(`ALTER TABLE pm_tasks ADD COLUMN ${col} TEXT`);
      added += 1;
    }
  }
  handle.exec('CREATE INDEX IF NOT EXISTS idx_pm_tasks_epic ON pm_tasks(epic)');
  handle.exec('CREATE INDEX IF NOT EXISTS idx_pm_tasks_sprint ON pm_tasks(sprint)');
  handle.exec('CREATE INDEX IF NOT EXISTS idx_pm_tasks_milestone ON pm_tasks(milestone)');
  handle.exec('CREATE INDEX IF NOT EXISTS idx_pm_tasks_nexus_id ON pm_tasks(nexus_task_id)');
  return added;
}

const text = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
};
/** Structured values keep their shape as JSON rather than being flattened. */
const pack = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
const first = (p, ...keys) => {
  for (const k of keys) {
    const t = text(p[k]);
    if (t !== null) return t;
  }
  return null;
};

/**
 * Map one original Nexus record onto the fidelity columns.
 * Every value here comes from raw_payload. Nothing is inferred.
 */
export function fidelityFromPayload(payload, { sourceFile, sourceKey }) {
  const p = payload ?? {};
  return {
    nexus_task_id: text(p.id),
    nexus_source_file: sourceFile ?? null,
    nexus_source_key: sourceKey ?? null,
    nexus_status: text(p.status),
    nexus_project: text(p.project),
    // The complete original record. This is what makes the migration lossless
    // regardless of which columns exist today.
    nexus_attributes: JSON.stringify(p),

    phase: text(p.phase),
    sprint: text(p.sprint),
    epic: text(p.epic),
    lane: text(p.lane),
    milestone: text(p.milestone),
    release_track: text(p.release_track),
    module: text(p.module),
    task_group: text(p.group),

    // workers[] is preserved WHOLE. The import kept only its first element,
    // which silently un-assigned every multi-agent task.
    workers_json: Array.isArray(p.workers) ? JSON.stringify(p.workers) : pack(p.workers),
    // The original priority verbatim, including the 31 values (1-9, 'critical',
    // 'high', 'medium', 'low') that were coerced to P2.
    priority_raw: text(p.priority),

    dispatched_at: text(p.dispatched_at),
    dispatched_by: text(p.dispatched_by),
    started_at: text(p.started_at),
    claimed_at: text(p.claimed_at),
    completed_at: text(p.completed_at),
    completed_by: text(p.completed_by),
    done_at: text(p.done_at),
    accepted_at: text(p.accepted_at),
    accepted_by: text(p.accepted_by),

    parent_task: first(p, 'parent'),
    children_json: pack(p.children),
    related_json: pack(p.related),
    blocked_by_json: pack(p.blocked_by),
    requirements_json: pack(p.requirements),
    from_decision_json: pack(p.from_decision),
    dependencies_json: pack(p.dependencies),

    acceptance_json: pack(p.acceptance ?? p.acceptance_criteria ?? null),
    evidence_json: pack(p.evidence ?? p.evidence_required ?? null),
    verification_json: pack(p.verification ?? null),

    branch: text(p.branch),
    commit_sha: first(p, 'commit', 'completion_commit', 'implementation_commit'),
    commits_json: pack(p.commits),
    merge_commit: first(p, 'merge_commit', 'merged_commit'),
    pr_ref: text(p.pr),
    pr_url: text(p.pr_url),
    worktree: text(p.worktree),

    reviewed_by: first(p, 'reviewed_by', 'review_completed_by', 'reviewer', 'reviewer_of_record'),
    review_note: first(p, 'review_note', 'qa_note'),
    independent_reviewer: text(p.independent_reviewer),
    review_pending: p.review_pending === undefined ? null : String(p.review_pending),

    primary_contributor: text(p.primary_contributor),
    contributors_json: pack(p.contributors),

    blocked_reason: text(p.blocked_reason),
    blockers: text(p.blockers),
    notes_raw: typeof p.notes === 'string' ? p.notes : pack(p.notes),
  };
}

/**
 * Restore every record whose task id collided with one already taken.
 *
 * The database key is disambiguated as `<id>:<project>`; the original id is
 * kept in `nexus_task_id`, so nothing about the record's identity is rewritten
 * — only the key it is stored under.
 */
export function restoreCollidedRecords(handle, { nowIso, boardsById }) {
  const collided = handle.prepare(
    "SELECT source_key, source_file, source_row_index, raw_payload, resolution, task_id FROM pm_source_records WHERE resolution = 'DUPLICATE_TASK_ID' OR task_id LIKE '%:%'",
  ).all();

  const restored = [];
  for (const row of collided) {
    let p;
    try { p = JSON.parse(row.raw_payload); } catch { continue; }
    const originalId = typeof p.id === 'string' ? p.id.trim() : '';
    if (!originalId) continue;

    const projectId = boardsById?.[row.source_file] ?? null;
    if (!projectId) continue;

    const key = `${originalId}:${projectId}`;
    if (handle.prepare('SELECT 1 FROM pm_tasks WHERE id = ?').get(key)) {
      // The import rebuilds source rows on every start.
      // If an earlier start already restored the task, relink provenance here.
      if (row.task_id !== key || row.resolution !== 'IMPORTED') {
        handle.prepare("UPDATE pm_source_records SET task_id = ?, resolution = 'IMPORTED' WHERE source_key = ?")
          .run(key, row.source_key);
      }
      const lastVer = handle.prepare(
        'SELECT resolution, task_id FROM pm_source_record_versions WHERE source_key = ? ORDER BY rowid DESC LIMIT 1',
      ).get(row.source_key);
      if (!lastVer || lastVer.resolution !== 'IMPORTED' || lastVer.task_id !== key) {
        const payloadHash = createHash('sha256').update(row.raw_payload).digest('hex');
        handle.prepare(`
          INSERT INTO pm_source_record_versions (source_key, payload_sha256, source_system, source_file, source_row_index, task_id, resolution, raw_status, raw_payload, imported_at)
          VALUES (?, ?, 'starqNexus', ?, ?, ?, 'IMPORTED', ?, ?, ?)
        `).run(row.source_key, payloadHash, row.source_file, row.source_row_index, key, p.status ? String(p.status) : null, row.raw_payload, nowIso());
      }
      continue;
    }

    if (row.resolution !== 'DUPLICATE_TASK_ID') continue;

    const ts = nowIso();
    const f = fidelityFromPayload(p, { sourceFile: row.source_file, sourceKey: row.source_key });
    const status = mapStatus(p.status);
    const stage = statusToStage(status);

    handle.prepare(`
      INSERT INTO pm_tasks (
        id, project_id, title, description, priority, status, stage, provenance,
        owner, verifier, room_authorization_ref, evidence_refs, depends_on, notes,
        created_by, created_at, updated_at, closed_at,
        nexus_task_id, nexus_source_file, nexus_source_key, nexus_status, nexus_project, nexus_attributes,
        phase, sprint, epic, lane, milestone, release_track, module, task_group,
        workers_json, priority_raw, dispatched_at, dispatched_by, started_at, claimed_at,
        completed_at, completed_by, done_at, accepted_at, accepted_by,
        parent_task, children_json, related_json, blocked_by_json,
        requirements_json, from_decision_json, dependencies_json,
        acceptance_json, evidence_json, verification_json,
        branch, commit_sha, commits_json, merge_commit, pr_ref, pr_url, worktree,
        reviewed_by, review_note, independent_reviewer, review_pending,
        primary_contributor, contributors_json,
        blocked_reason, blockers, notes_raw
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'HISTORICAL_NEXUS', ?, 'UNASSIGNED', NULL, '[]', ?, ?, 'nexus-import-collision-restore', ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?)
    `).run(
      key, projectId,
      String(p.title ?? originalId).slice(0, 800),
      String(p.description ?? '').slice(0, 20000),
      normalisePriority(p.priority), status, stage,
      ownerFrom(p),
      JSON.stringify(Array.isArray(p.depends_on) ? p.depends_on.filter((x) => typeof x === 'string') : []),
      `Nexus origin: ${row.source_file} (id collision with an existing ${originalId}; stored as ${key}) · original status: ${p.status ?? 'UNKNOWN'}`,
      typeof p.dispatched_at === 'string' ? p.dispatched_at : ts,
      ts,
      status === 'DONE' ? (typeof p.completed_at === 'string' ? p.completed_at : ts) : null,
      f.nexus_task_id, f.nexus_source_file, f.nexus_source_key, f.nexus_status, f.nexus_project, f.nexus_attributes,
      f.phase, f.sprint, f.epic, f.lane, f.milestone, f.release_track, f.module, f.task_group,
      f.workers_json, f.priority_raw, f.dispatched_at, f.dispatched_by, f.started_at, f.claimed_at,
      f.completed_at, f.completed_by, f.done_at, f.accepted_at, f.accepted_by,
      f.parent_task, f.children_json, f.related_json, f.blocked_by_json,
      f.requirements_json, f.from_decision_json, f.dependencies_json,
      f.acceptance_json, f.evidence_json, f.verification_json,
      f.branch, f.commit_sha, f.commits_json, f.merge_commit, f.pr_ref, f.pr_url, f.worktree,
      f.reviewed_by, f.review_note, f.independent_reviewer, f.review_pending,
      f.primary_contributor, f.contributors_json,
      f.blocked_reason, f.blockers, f.notes_raw,
    );

    handle.prepare("UPDATE pm_source_records SET task_id = ?, resolution = 'IMPORTED' WHERE source_key = ?")
      .run(key, row.source_key);
    try {
      handle.prepare("UPDATE pm_source_record_versions SET task_id = ?, resolution = 'IMPORTED' WHERE source_key = ?")
        .run(key, row.source_key);
    } catch {}

    restored.push({ source_key: row.source_key, original_id: originalId, stored_as: key, project_id: projectId });
  }
  return restored;
}

function mapStatus(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'done' || s === 'closed' || s === 'preserved') return 'DONE';
  if (s === 'in_progress') return 'IN_PROGRESS';
  if (s === 'next') return 'NEXT';
  if (s === 'blocked') return 'BLOCKED';
  return 'TODO';
}
function statusToStage(status) {
  return { TODO: 'BACKLOG', NEXT: 'READY', IN_PROGRESS: 'IN_PROGRESS', BLOCKED: 'BLOCKED', DONE: 'CLOSED' }[status] ?? 'BACKLOG';
}
function normalisePriority(raw) {
  const p = String(raw ?? '').toUpperCase();
  if (['P0', 'P1', 'P2', 'P3'].includes(p)) return p;
  // Word scales map onto the P scale; numeric scales do NOT, because Nexus
  // used 1-9 with no declared meaning. Those keep P2 here and their true
  // value in `priority_raw`, which is the honest place for an unmappable value.
  if (p === 'CRITICAL') return 'P0';
  if (p === 'HIGH') return 'P1';
  if (p === 'MEDIUM') return 'P2';
  if (p === 'LOW') return 'P3';
  return 'P2';
}
function ownerFrom(p) {
  const workers = Array.isArray(p.workers) ? p.workers : [];
  const firstWorker = workers.find((w) => typeof w === 'string' && w.trim());
  if (firstWorker) return firstWorker.trim().toLowerCase().slice(0, 40);
  if (typeof p.owner === 'string' && p.owner.trim()) return p.owner.trim().toLowerCase().slice(0, 40);
  return 'UNASSIGNED';
}

/**
 * Promote raw_payload into the fidelity columns for every imported row.
 *
 * Idempotent: a row whose `nexus_attributes` already matches its source
 * payload is skipped, so this is safe to run on every start.
 */
export function backfillNexusAttributes(handle) {
  const rows = handle.prepare(`
    SELECT s.task_id AS id, s.source_file, s.source_key, s.raw_payload,
           t.nexus_attributes, t.acceptance_json, t.phase, t.sprint, t.epic, t.lane, t.milestone, t.workers_json
      FROM pm_source_records s
      JOIN pm_tasks t ON t.id = s.task_id
     WHERE s.resolution = 'IMPORTED' AND t.provenance <> 'LIVE'
  `).all();

  const update = handle.prepare(`
    UPDATE pm_tasks SET
      nexus_task_id = ?, nexus_source_file = ?, nexus_source_key = ?, nexus_status = ?,
      nexus_project = ?, nexus_attributes = ?,
      phase = ?, sprint = ?, epic = ?, lane = ?, milestone = ?, release_track = ?, module = ?, task_group = ?,
      workers_json = ?, priority_raw = ?,
      dispatched_at = ?, dispatched_by = ?, started_at = ?, claimed_at = ?,
      completed_at = ?, completed_by = ?, done_at = ?, accepted_at = ?, accepted_by = ?,
      parent_task = ?, children_json = ?, related_json = ?, blocked_by_json = ?,
      requirements_json = ?, from_decision_json = ?, dependencies_json = ?,
      acceptance_json = ?, evidence_json = ?, verification_json = ?,
      branch = ?, commit_sha = ?, commits_json = ?, merge_commit = ?, pr_ref = ?, pr_url = ?, worktree = ?,
      reviewed_by = ?, review_note = ?, independent_reviewer = ?, review_pending = ?,
      primary_contributor = ?, contributors_json = ?,
      blocked_reason = ?, blockers = ?, notes_raw = ?
    WHERE id = ?
  `);

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    let payload;
    try { payload = JSON.parse(row.raw_payload); } catch { continue; }
    const f = fidelityFromPayload(payload, { sourceFile: row.source_file, sourceKey: row.source_key });
    const needsUpdate = (
      row.nexus_attributes !== f.nexus_attributes ||
      row.acceptance_json !== f.acceptance_json ||
      row.phase !== f.phase ||
      row.sprint !== f.sprint ||
      row.epic !== f.epic ||
      row.lane !== f.lane ||
      row.milestone !== f.milestone ||
      row.workers_json !== f.workers_json
    );
    if (!needsUpdate) { skipped += 1; continue; }
    update.run(
      f.nexus_task_id, f.nexus_source_file, f.nexus_source_key, f.nexus_status,
      f.nexus_project, f.nexus_attributes,
      f.phase, f.sprint, f.epic, f.lane, f.milestone, f.release_track, f.module, f.task_group,
      f.workers_json, f.priority_raw,
      f.dispatched_at, f.dispatched_by, f.started_at, f.claimed_at,
      f.completed_at, f.completed_by, f.done_at, f.accepted_at, f.accepted_by,
      f.parent_task, f.children_json, f.related_json, f.blocked_by_json,
      f.requirements_json, f.from_decision_json, f.dependencies_json,
      f.acceptance_json, f.evidence_json, f.verification_json,
      f.branch, f.commit_sha, f.commits_json, f.merge_commit, f.pr_ref, f.pr_url, f.worktree,
      f.reviewed_by, f.review_note, f.independent_reviewer, f.review_pending,
      f.primary_contributor, f.contributors_json,
      f.blocked_reason, f.blockers, f.notes_raw,
      row.id,
    );
    updated += 1;
  }
  return { updated, skipped, considered: rows.length };
}

/** Restore the multi-worker assignment the first import flattened. */
export function workersOf(task) {
  if (!task?.workers_json) return task?.owner && task.owner !== 'UNASSIGNED' ? [task.owner] : [];
  try {
    const w = JSON.parse(task.workers_json);
    return Array.isArray(w) ? w.filter((x) => typeof x === 'string' && x.trim()) : [];
  } catch { return []; }
}
