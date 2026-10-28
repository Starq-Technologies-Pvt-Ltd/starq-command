/**
 * Execution metadata for PM-owned tasks.
 *
 * `pm_tasks` remains the sole task authority. This store adds a one-to-one
 * execution extension row and append-only execution history; it never copies a
 * task into the legacy control-plane `tasks` table or mutates PM lifecycle
 * stages.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { TaskStateMachine, type TaskState } from './state-machine.ts';
import { validateBuilderArtifact, type BuilderArtifact } from '../../src/schemas/builder-artifact.ts';
import { validateVerifierArtifact, type VerifierArtifact } from '../../src/schemas/verifier-artifact.ts';
import { VerifierGuard } from './verifier-guard.ts';
import { evaluateStageTransition, nextPriorStage, PROVENANCE, stageToColumn } from '../../server/gated-lifecycle.mjs';
import { resolveWorkspace, CANONICAL, abs } from '../../server/paths.mjs';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: any };

export type PmDispatchTask = {
  taskId: string;
  projectId: string;
  project: string;
  title: string;
  objective: string;
  description: string;
  priority: string;
  owner: string;
  verifier: string;
  roomAuthorizationRef: Record<string, unknown> | null;
  acceptanceCriteria: unknown;
  dependencies: string[];
  provenance: string;
  stage: string;
  sourceAttributes: Record<string, unknown>;
  execution: Record<string, any> | null;
};

const ACTIVE_STATES = ['ALLOCATED', 'EXECUTING', 'BUILDER_COMPLETE', 'VERIFYING', 'BLOCKED'];

export class PmTaskExecutionStore {
  private db: any;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS pm_task_execution (
        task_id TEXT PRIMARY KEY REFERENCES pm_tasks(id),
        state TEXT NOT NULL,
        builder_seat TEXT,
        verifier_seat TEXT,
        herdr_session_id TEXT,
        verifier_session_id TEXT,
        workspace_path TEXT,
        verifier_workspace_path TEXT,
        branch TEXT,
        verifier_branch TEXT,
        base_sha TEXT,
        candidate_sha TEXT,
        lease_id TEXT,
        verifier_lease_id TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        room_assignment_ref TEXT,
        contract_json TEXT,
        builder_artifact_json TEXT,
        verifier_artifact_json TEXT,
        failure_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS pm_task_execution_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES pm_tasks(id),
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        actor TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pm_exec_state ON pm_task_execution(state);
      CREATE INDEX IF NOT EXISTS idx_pm_exec_events_task ON pm_task_execution_events(task_id, id);
      CREATE TRIGGER IF NOT EXISTS pm_exec_events_no_delete BEFORE DELETE ON pm_task_execution_events
        BEGIN SELECT RAISE(ABORT, 'pm_task_execution_events is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS pm_exec_events_no_update BEFORE UPDATE ON pm_task_execution_events
        BEGIN SELECT RAISE(ABORT, 'pm_task_execution_events is append-only'); END;
    `);
    const columns = new Set(this.db.prepare("SELECT name FROM pragma_table_info('pm_tasks')").all().map((r: any) => r.name));
    for (const required of ['stage', 'provenance', 'room_authorization_ref', 'depends_on', 'acceptance_json']) {
      if (!columns.has(required)) throw new Error(`PM database missing required column: ${required}`);
    }
  }

  listReadyTasks(): PmDispatchTask[] {
    const rows = this.db.prepare(`
      SELECT t.*, p.name AS project_name, e.state AS execution_state, e.builder_seat,
        e.verifier_seat, e.herdr_session_id, e.verifier_session_id, e.workspace_path,
        e.verifier_workspace_path, e.branch, e.verifier_branch, e.base_sha,
        e.candidate_sha, e.lease_id, e.verifier_lease_id, e.retry_count, e.room_assignment_ref,
        e.contract_json, e.builder_artifact_json, e.verifier_artifact_json,
        e.failure_json, e.created_at AS execution_created_at, e.updated_at AS execution_updated_at,
        e.completed_at AS execution_completed_at
      FROM pm_tasks t JOIN pm_projects p ON p.id = t.project_id
      LEFT JOIN pm_task_execution e ON e.task_id = t.id
      WHERE t.stage = 'READY'
      ORDER BY CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
        t.created_at, t.id
    `).all();
    return rows.map((row: any) => this.map(row)).map((task: PmDispatchTask) => ({
      ...task,
      sourceAttributes: {
        ...task.sourceAttributes,
        dependencyStages: Object.fromEntries(task.dependencies.map((id) => [id, this.getPmStage(id)])),
      },
    }));
  }

  listTasks(filter?: { state?: string; project?: string; builder?: string }): PmDispatchTask[] {
    const rows = this.db.prepare(`
      SELECT t.*, p.name AS project_name, e.state AS execution_state, e.builder_seat,
        e.verifier_seat, e.herdr_session_id, e.verifier_session_id, e.workspace_path,
        e.verifier_workspace_path, e.branch, e.verifier_branch, e.base_sha,
        e.candidate_sha, e.lease_id, e.verifier_lease_id, e.retry_count, e.room_assignment_ref,
        e.contract_json, e.builder_artifact_json, e.verifier_artifact_json,
        e.failure_json, e.created_at AS execution_created_at, e.updated_at AS execution_updated_at,
        e.completed_at AS execution_completed_at
      FROM pm_tasks t JOIN pm_projects p ON p.id = t.project_id
      LEFT JOIN pm_task_execution e ON e.task_id = t.id
      WHERE (? IS NULL OR t.project_id = ?) AND (? IS NULL OR e.builder_seat = ?)
      ORDER BY t.updated_at DESC, t.id
    `).all(filter?.project ?? null, filter?.project ?? null, filter?.builder ?? null, filter?.builder ?? null);
    const stageState: Record<string, string> = {
      BACKLOG: 'CREATED', READY: 'QUEUED', IN_PROGRESS: 'EXECUTING', REVIEW: 'BUILDER_COMPLETE',
      VERIFICATION: 'VERIFYING', ACCEPTANCE: 'ACCEPTED', CLOSED: 'ACCEPTED', BLOCKED: 'BLOCKED',
      FOUNDER_GATE: 'BLOCKED',
    };
    return rows.map((row: any) => this.map(row)).filter((task: PmDispatchTask) => {
      const state = task.execution?.state ?? stageState[task.stage] ?? 'CREATED';
      return !filter?.state || state === filter.state;
    });
  }

  getTask(taskId: string): PmDispatchTask | null {
    const row = this.db.prepare(`
      SELECT t.*, p.name AS project_name, e.state AS execution_state, e.builder_seat,
        e.verifier_seat, e.herdr_session_id, e.verifier_session_id, e.workspace_path,
        e.verifier_workspace_path, e.branch, e.verifier_branch, e.base_sha,
        e.candidate_sha, e.lease_id, e.verifier_lease_id, e.retry_count, e.room_assignment_ref,
        e.contract_json, e.builder_artifact_json, e.verifier_artifact_json,
        e.failure_json, e.created_at AS execution_created_at, e.updated_at AS execution_updated_at,
        e.completed_at AS execution_completed_at
      FROM pm_tasks t JOIN pm_projects p ON p.id = t.project_id
      LEFT JOIN pm_task_execution e ON e.task_id = t.id WHERE t.id = ?
    `).get(taskId);
    return row ? this.map(row) : null;
  }

  private map(row: any): PmDispatchTask {
    const sourceAttributes = Object.fromEntries(Object.entries(row).filter(([key]) =>
      !['project_name', 'execution_state', 'builder_seat', 'verifier_seat', 'herdr_session_id',
        'verifier_session_id', 'workspace_path', 'verifier_workspace_path', 'branch', 'verifier_branch',
        'base_sha', 'candidate_sha', 'lease_id', 'verifier_lease_id', 'retry_count',
        'room_assignment_ref', 'contract_json', 'builder_artifact_json', 'verifier_artifact_json',
        'failure_json', 'execution_created_at', 'execution_updated_at', 'execution_completed_at'].includes(key),
    ));
    const execution = row.execution_state ? {
      state: row.execution_state,
      builderSeat: row.builder_seat,
      verifierSeat: row.verifier_seat,
      herdrSessionId: row.herdr_session_id,
      verifierSessionId: row.verifier_session_id,
      workspacePath: row.workspace_path,
      verifierWorkspacePath: row.verifier_workspace_path,
      branch: row.branch,
      verifierBranch: row.verifier_branch,
      baseSha: row.base_sha,
      candidateSha: row.candidate_sha,
      leaseId: row.lease_id,
      verifierLeaseId: row.verifier_lease_id,
      retries: Number(row.retry_count ?? 0),
      roomAssignmentRef: row.room_assignment_ref ? JSON.parse(row.room_assignment_ref) : null,
      contract: row.contract_json ? JSON.parse(row.contract_json) : null,
      builderArtifact: row.builder_artifact_json ? JSON.parse(row.builder_artifact_json) : null,
      verifierArtifact: row.verifier_artifact_json ? JSON.parse(row.verifier_artifact_json) : null,
      failure: row.failure_json ? JSON.parse(row.failure_json) : null,
      createdAt: row.execution_created_at,
      updatedAt: row.execution_updated_at,
      completedAt: row.execution_completed_at,
    } : null;
    return {
      taskId: row.id,
      projectId: row.project_id,
      project: row.project_name,
      title: row.title,
      objective: row.description,
      description: row.description,
      priority: row.priority,
      owner: row.owner,
      verifier: row.verifier,
      roomAuthorizationRef: row.room_authorization_ref ? JSON.parse(row.room_authorization_ref) : null,
      acceptanceCriteria: row.acceptance_json ? JSON.parse(row.acceptance_json) : null,
      dependencies: row.depends_on ? JSON.parse(row.depends_on) : [],
      provenance: row.provenance ?? 'LIVE',
      stage: row.stage ?? 'BACKLOG',
      sourceAttributes,
      execution,
    };
  }

  private getPmStage(taskId: string): string | null {
    return this.db.prepare('SELECT stage FROM pm_tasks WHERE id = ?').get(taskId)?.stage ?? null;
  }

  allocate(params: {
    taskId: string; builderSeat: string; herdrSessionId: string; workspacePath: string;
    branch: string; baseSha: string; leaseId: string; contract: Record<string, unknown>;
    roomAssignmentRef: Record<string, unknown>;
  }): PmDispatchTask {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const task = this.getTask(params.taskId);
      if (!task) throw new Error(`PM task ${params.taskId} not found`);
      if (task.provenance !== 'LIVE' || task.stage !== 'READY' || !task.roomAuthorizationRef) {
        throw new Error('Task is not an authorized LIVE READY PM task');
      }
      if (task.dependencies.some((id) => this.getPmStage(id) !== 'CLOSED')) throw new Error('Task dependencies are not closed');
      if (task.owner !== params.builderSeat) throw new Error(`Selected worker ${params.builderSeat} does not match PM owner ${task.owner}`);
      if (task.owner === task.verifier) throw new Error('Builder and verifier must be different');
      if (task.execution && ACTIVE_STATES.includes(task.execution.state)) throw new Error('Task already has an active execution');
      if (task.execution?.state === 'ACCEPTED' || task.execution?.state === 'CANCELLED') throw new Error('Execution is terminal');
      const now = new Date().toISOString();
      let from = task.execution?.state ?? 'QUEUED';
      if (from !== 'QUEUED' && from !== 'FAILED' && from !== 'REJECTED' && from !== 'BLOCKED') {
        throw new Error(`Execution state ${from} cannot be allocated`);
      }
      if (from === 'FAILED' || from === 'REJECTED') {
        TaskStateMachine.validateTransition(task.taskId, from as TaskState, 'QUEUED', params.builderSeat, 'Retry after failed or rejected execution');
        this.recordEvent(task.taskId, from, 'QUEUED', params.builderSeat, { recovery: true });
        from = 'QUEUED';
      }
      if (from !== 'QUEUED') TaskStateMachine.validateTransition(task.taskId, from as TaskState, 'ALLOCATED', params.builderSeat);
      this.advancePmStage(task.taskId, 'IN_PROGRESS', params.builderSeat, 'Dispatcher allocated a verified worker and leased worktree.', false);
      this.db.prepare(`
        INSERT INTO pm_task_execution (task_id,state,builder_seat,verifier_seat,herdr_session_id,
          verifier_session_id,workspace_path,verifier_workspace_path,branch,verifier_branch,base_sha,lease_id,verifier_lease_id,retry_count,room_assignment_ref,contract_json,
          created_at,updated_at,completed_at)
        VALUES (?,?,?,?,?,NULL,?,NULL,?,NULL,?,?,NULL,?,?, ?,?,?,NULL)
        ON CONFLICT(task_id) DO UPDATE SET state=excluded.state,builder_seat=excluded.builder_seat,
          verifier_seat=excluded.verifier_seat,herdr_session_id=excluded.herdr_session_id,
          verifier_session_id=NULL,workspace_path=excluded.workspace_path,verifier_workspace_path=NULL,
          branch=excluded.branch,verifier_branch=NULL,base_sha=excluded.base_sha,
          candidate_sha=NULL,lease_id=excluded.lease_id,retry_count=excluded.retry_count,
          verifier_lease_id=NULL,
          room_assignment_ref=excluded.room_assignment_ref,contract_json=excluded.contract_json,
          builder_artifact_json=NULL,verifier_artifact_json=NULL,failure_json=NULL,
          updated_at=excluded.updated_at,completed_at=NULL
      `).run(params.taskId,'ALLOCATED',params.builderSeat,task.verifier,params.herdrSessionId,
        params.workspacePath,params.branch,params.baseSha,params.leaseId,task.execution?.retries ?? 0,
        JSON.stringify(params.roomAssignmentRef),JSON.stringify(params.contract),now,now);
      this.recordEvent(params.taskId,from,'ALLOCATED',params.builderSeat,
        {leaseId:params.leaseId,sessionId:params.herdrSessionId});
      this.db.exec('COMMIT');
      return this.getTask(params.taskId)!;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  transition(taskId: string, next: TaskState, actor: string, detail: Record<string, unknown> = {}): PmDispatchTask {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const task = this.getTask(taskId);
      if (!task?.execution) throw new Error(`No execution exists for PM task ${taskId}`);
      TaskStateMachine.validateTransition(taskId, task.execution.state as TaskState, next, actor);
      if (next === 'BUILDER_COMPLETE') {
        this.advancePmStage(taskId, 'REVIEW', actor, 'Builder artifact and test evidence submitted.', false);
      } else if (next === 'VERIFYING') {
        this.advancePmStage(taskId, 'VERIFICATION', actor, 'Independent verification started.', false);
      } else if (next === 'ACCEPTED') {
        this.advancePmStage(taskId, 'ACCEPTANCE', actor, 'Independent verifier evidence accepted.', false);
      } else if (next === 'BLOCKED') {
        this.advancePmStage(taskId, 'BLOCKED', actor, String(detail.reason ?? 'Execution blocked.'), true);
      } else if (next === 'FAILED') {
        this.advancePmStage(taskId, 'BLOCKED', actor, String(detail.reason ?? 'Execution failed and requires recovery.'), true);
      } else if (next === 'REJECTED') {
        this.advancePmStage(taskId, 'READY', actor, String(detail.reason ?? 'Verification rejected; return to READY for revision.'), false);
      } else if (next === 'QUEUED' && task.stage === 'BLOCKED') {
        const prior = this.db.prepare('SELECT prior_stage FROM pm_tasks WHERE id=?').get(taskId)?.prior_stage ?? 'READY';
        this.advancePmStage(taskId, prior, actor, String(detail.reason ?? 'Execution recovered and returned to queue.'), false);
        if (prior !== 'READY') {
          this.advancePmStage(taskId, 'READY', actor, String(detail.reason ?? 'Execution recovered and returned to queue.'), false);
        }
      }
      const now = new Date().toISOString();
      const isRecovery = next === 'QUEUED' && ['FAILED','REJECTED','BLOCKED'].includes(task.execution.state);
      const result = this.db.prepare('UPDATE pm_task_execution SET state=?,updated_at=?,completed_at=?,failure_json=?,retry_count=retry_count+? WHERE task_id=? AND state=?')
        .run(next,now,['ACCEPTED','CANCELLED'].includes(next)?now:null,
          detail.failure ? JSON.stringify(detail.failure) : (next === 'QUEUED' ? null : task.execution.failure ? JSON.stringify(task.execution.failure) : null),
          isRecovery ? 1 : 0,taskId,task.execution.state);
      if (Number(result.changes) !== 1) throw new Error(`Execution state changed concurrently for ${taskId}`);
      this.recordEvent(taskId,task.execution.state,next,actor,detail);
      this.db.exec('COMMIT');
      return this.getTask(taskId)!;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  setRoomAssignmentRef(taskId: string, ref: Record<string, unknown>): void {
    const result = this.db.prepare("UPDATE pm_task_execution SET room_assignment_ref=?,updated_at=? WHERE task_id=? AND state='ALLOCATED'")
      .run(JSON.stringify(ref),new Date().toISOString(),taskId);
    if (Number(result.changes) !== 1) throw new Error(`Could not persist Room assignment reference for ${taskId}`);
  }

  assignVerifier(params: { taskId: string; verifierSeat: string; herdrSessionId: string; workspacePath: string; branch: string; leaseId: string }): PmDispatchTask {
    const task = this.getTask(params.taskId);
    if (!task?.execution || task.execution.state !== 'BUILDER_COMPLETE') throw new Error('Verification can only be assigned after builder completion.');
    if (task.verifier !== params.verifierSeat || task.execution.builderSeat === params.verifierSeat) {
      throw new Error('Verifier must match the PM verifier assignment and differ from the builder.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare(`UPDATE pm_task_execution SET verifier_session_id=?,verifier_workspace_path=?,
        verifier_branch=?,verifier_lease_id=?,updated_at=? WHERE task_id=? AND state='BUILDER_COMPLETE'
        AND verifier_seat=? AND builder_seat<>?`).run(params.herdrSessionId,params.workspacePath,
          params.branch,params.leaseId,new Date().toISOString(),params.taskId,params.verifierSeat,params.verifierSeat);
      if (Number(result.changes) !== 1) throw new Error('Verifier assignment raced with another execution update.');
      this.db.exec('COMMIT');
      return this.getTask(params.taskId)!;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  submitBuilderArtifact(taskId: string, artifact: BuilderArtifact): PmDispatchTask {
    const task = this.getTask(taskId);
    if (!task?.execution) throw new Error(`No execution exists for PM task ${taskId}`);
    const guard: any = { taskId, state: task.execution.state, builderSeat: task.execution.builderSeat };
    const check = VerifierGuard.canSubmitBuilderCompletion(guard, artifact);
    if (!check.allowed) throw new Error(check.reason);
    this.attachBuilderArtifact(taskId, artifact);
    return this.transition(taskId,'BUILDER_COMPLETE',artifact.builderSeat,{
      candidateSha: artifact.candidateSha, evidenceReferences: artifact.evidenceReferences,
    });
  }

  submitVerifierArtifact(taskId: string, artifact: VerifierArtifact): PmDispatchTask {
    const task = this.getTask(taskId);
    if (!task?.execution) throw new Error(`No execution exists for PM task ${taskId}`);
    this.attachVerifierArtifact(taskId,artifact);
    return this.transition(taskId,artifact.result === 'PASS' ? 'ACCEPTED' : 'REJECTED',artifact.verifierSeat,{
      evaluatedSha: artifact.evaluatedSha, result: artifact.result, evidenceNotes: artifact.verdictNotes,
      reason: artifact.verdictNotes,
    });
  }

  closePmTask(taskId: string, actor: string): PmDispatchTask {
    const task = this.getTask(taskId);
    if (!task?.execution || task.execution.state !== 'ACCEPTED' || task.stage !== 'ACCEPTANCE') {
      throw new Error('PM closure requires accepted execution and PM ACCEPTANCE stage.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.advancePmStage(taskId,'CLOSED',actor,'Founder evidence accepted by the gated PM lifecycle.',false);
      this.db.exec('COMMIT');
      return this.getTask(taskId)!;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private advancePmStage(taskId: string, to: string, actor: string, note: string, holdBlocks: boolean): void {
    const row = this.db.prepare(`SELECT t.*, p.name AS project_name, p.hold_state FROM pm_tasks t
      JOIN pm_projects p ON p.id=t.project_id WHERE t.id=?`).get(taskId);
    if (!row) throw new Error(`PM task ${taskId} not found`);
    const task = {
      ...row,
      provenance: row.provenance ?? PROVENANCE.LIVE,
      stage: row.stage ?? 'BACKLOG',
      prior_stage: row.prior_stage ?? null,
      room_authorization_ref: row.room_authorization_ref ? JSON.parse(row.room_authorization_ref) : null,
      evidence_refs: row.evidence_refs ? JSON.parse(row.evidence_refs) : [],
      depends_on: row.depends_on ? JSON.parse(row.depends_on) : [],
    };
    const projectHold = this.effectiveHold(row);
    const blocks = holdBlocks || projectHold.state === 'ON_HOLD' || projectHold.state === 'UNKNOWN';
    const verdict = evaluateStageTransition({
      task, to, note,
      project: { name: row.project_name },
      hold: projectHold,
      holdBlocks: blocks,
      stageOf: (id: string) => this.getPmStage(id),
      enteredAt: (stage: string) => this.db.prepare('SELECT timestamp FROM pm_status_log WHERE task_id=? AND to_status=? ORDER BY id DESC LIMIT 1').get(taskId,stage)?.timestamp ?? null,
    });
    if (!verdict.ok) throw new Error(`${verdict.code}: ${verdict.message}`);
    const priorStage = nextPriorStage(task,to);
    const status = stageToColumn(to);
    const timestamp = new Date().toISOString();
    this.db.prepare(`UPDATE pm_tasks SET prior_stage=?,stage=?,prior_status=?,status=?,updated_at=?,closed_at=? WHERE id=?`)
      .run(priorStage,to,status === 'BLOCKED' ? row.status : null,status,timestamp,to === 'CLOSED' ? timestamp : null,taskId);
    this.db.prepare(`INSERT INTO pm_status_log(task_id,event_type,from_status,to_status,actor,detail,timestamp,room_sync)
      VALUES(?,?,?,?,?,?,?,'NOT_REQUIRED')`).run(taskId,'STAGE_CHANGED',task.stage,to,actor,
        JSON.stringify({note,board_column:status,execution_bridge:true}),timestamp);
  }

  private effectiveHold(project: any): { state: string | null; source: string } {
    if (project.id === 'erp') {
      const workspace = resolveWorkspace();
      if (!workspace.root) return { state: 'ON_HOLD', source: 'workspace unresolved; failing closed' };
      try {
        const contractPath = abs(workspace.root, `${CANONICAL.controlBoard}/contract.json`);
        const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
        const value = contract?.hold_state?.implementation;
        return { state: typeof value === 'string' ? value : 'UNKNOWN', source: 'starqerp-control-board/contract.json' };
      } catch { return { state: 'ON_HOLD', source: 'contract unreadable; failing closed' }; }
    }
    return { state: project.hold_state ?? null, source: 'pm_projects' };
  }

  private recordEvent(taskId: string, from: string, to: string, actor: string, detail: Record<string, unknown>): void {
    this.db.prepare(`INSERT INTO pm_task_execution_events(task_id,from_state,to_state,actor,detail,timestamp)
      VALUES(?,?,?,?,?,?)`).run(taskId,from,to,actor,JSON.stringify(detail),new Date().toISOString());
  }

  attachBuilderArtifact(taskId: string, artifact: BuilderArtifact): PmDispatchTask {
    const task = this.getTask(taskId);
    if (!task?.execution) throw new Error(`No execution exists for PM task ${taskId}`);
    const valid = validateBuilderArtifact(artifact);
    if (!valid.valid) throw new Error(valid.errors.join('; '));
    if (artifact.taskId !== taskId || artifact.builderSeat !== task.execution.builderSeat) throw new Error('Builder artifact identity mismatch');
    if (artifact.baseSha !== task.execution.baseSha) throw new Error('Builder artifact base SHA mismatch');
    this.db.prepare('UPDATE pm_task_execution SET candidate_sha=?,builder_artifact_json=?,updated_at=? WHERE task_id=?')
      .run(artifact.candidateSha,JSON.stringify(artifact),new Date().toISOString(),taskId);
    return this.getTask(taskId)!;
  }

  attachVerifierArtifact(taskId: string, artifact: VerifierArtifact): PmDispatchTask {
    const task = this.getTask(taskId);
    if (!task?.execution) throw new Error(`No execution exists for PM task ${taskId}`);
    if (artifact.verifierSeat !== task.execution.verifierSeat) throw new Error('Verifier artifact seat does not match the PM verifier assignment.');
    const guardRecord: any = {
      taskId, state: task.execution.state, builderSeat: task.execution.builderSeat,
      verifierSeat: task.execution.verifierSeat, candidateSha: task.execution.candidateSha,
    };
    const check = artifact.result === 'PASS'
      ? VerifierGuard.canAcceptTask(guardRecord, artifact)
      : VerifierGuard.canRejectTask(guardRecord, artifact);
    if (!check.allowed) throw new Error(check.reason);
    this.db.prepare('UPDATE pm_task_execution SET verifier_artifact_json=?,updated_at=? WHERE task_id=?')
      .run(JSON.stringify(artifact),new Date().toISOString(),taskId);
    return this.getTask(taskId)!;
  }

  listActiveWorkload(): Array<{ seat: string; taskId: string; state: string }> {
    return this.db.prepare(`
      SELECT builder_seat AS seat,task_id AS taskId,state FROM pm_task_execution
        WHERE builder_seat IS NOT NULL AND state IN (${ACTIVE_STATES.map(() => '?').join(',')})
      UNION ALL
      SELECT verifier_seat AS seat,task_id AS taskId,state FROM pm_task_execution
        WHERE verifier_seat IS NOT NULL AND state='VERIFYING'
    `).all(...ACTIVE_STATES);
  }

  getHistory(taskId: string): any[] {
    return this.db.prepare('SELECT * FROM pm_task_execution_events WHERE task_id=? ORDER BY id').all(taskId);
  }

  close(): void { this.db.close(); }
}
