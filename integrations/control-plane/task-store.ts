/**
 * Durable Task Store (SQLite backed with node:sqlite)
 * Starq Command Architecture Doctrine Section 7
 */

import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { type TaskState, TaskStateMachine } from './state-machine.ts';
import { type TaskContract, validateTaskContract } from '../../src/schemas/task-contract.ts';
import { type BuilderArtifact, validateBuilderArtifact } from '../../src/schemas/builder-artifact.ts';
import { type VerifierArtifact, validateVerifierArtifact } from '../../src/schemas/verifier-artifact.ts';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: any };

export interface TaskRecord {
  taskId: string;
  project: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  riskClass: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  objective: string;
  state: TaskState;
  builderSeat: string | null;
  verifierSeat: string | null;
  workspacePath: string | null;
  branch: string | null;
  baseSha: string | null;
  candidateSha: string | null;
  leaseId: string | null;
  retries: number;
  maxRetries: number;
  roomThreadRef: string | null;
  contractJson: string | null;
  builderArtifactJson: string | null;
  verifierArtifactJson: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskTransitionLog {
  id: number;
  taskId: string;
  fromState: TaskState;
  toState: TaskState;
  actor: string;
  reason: string | null;
  timestamp: string;
}

export class TaskStore {
  private db!: DatabaseSync;
  private pmBackend: any;

  constructor(dbPath: string = ':memory:', pmBackend?: any) {
    this.pmBackend = pmBackend;
    if (pmBackend) return;
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  /** Use the existing TaskStore API over PM-owned task rows and their execution extension. */
  public static forPmExecutionStore(pmBackend: any): TaskStore {
    return new TaskStore(':memory:', pmBackend);
  }

  private initSchema(): void {
    // Enable WAL mode for high concurrency if backed by file
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS tasks (
        taskId TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        priority TEXT NOT NULL,
        riskClass TEXT NOT NULL,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        state TEXT NOT NULL,
        builderSeat TEXT,
        verifierSeat TEXT,
        workspacePath TEXT,
        branch TEXT,
        baseSha TEXT,
        candidateSha TEXT,
        leaseId TEXT,
        retries INTEGER NOT NULL DEFAULT 0,
        maxRetries INTEGER NOT NULL DEFAULT 3,
        roomThreadRef TEXT,
        contractJson TEXT,
        builderArtifactJson TEXT,
        verifierArtifactJson TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS task_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taskId TEXT NOT NULL,
        fromState TEXT NOT NULL,
        toState TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (taskId) REFERENCES tasks(taskId) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
      CREATE INDEX IF NOT EXISTS idx_task_transitions_taskId ON task_transitions(taskId);
    `);
  }

  public createTask(contract: TaskContract): TaskRecord {
    if (this.pmBackend) throw new Error('PM owns task creation; create the task through the PM service.');
    const val = validateTaskContract(contract);
    if (!val.valid) {
      throw new Error(`Invalid TaskContract: ${val.errors.join('; ')}`);
    }

    const taskId = contract.task_id;
    const now = new Date().toISOString();
    const existing = this.getTask(taskId);
    if (existing) {
      throw new Error(`Task with id '${taskId}' already exists`);
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO tasks (
        taskId, project, priority, riskClass, title, objective, state,
        builderSeat, verifierSeat, workspacePath, branch, baseSha, candidateSha,
        leaseId, retries, maxRetries, roomThreadRef, contractJson,
        builderArtifactJson, verifierArtifactJson, createdAt, updatedAt, completedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    insertStmt.run(
      taskId,
      contract.project_id,
      contract.priority,
      contract.risk_level,
      contract.title,
      contract.objective,
      'CREATED',
      contract.builder_seat || null,
      contract.verifier_seat || null,
      null,
      null,
      null,
      null,
      null,
      0,
      3,
      null,
      JSON.stringify(contract),
      null,
      null,
      now,
      now,
      null
    );

    // Record creation in audit log
    this.recordTransition(taskId, 'CREATED', 'CREATED', 'system', 'Task created from contract');

    return this.getTask(taskId)!;
  }

  public getTask(taskId: string): TaskRecord | null {
    if (this.pmBackend) return this.pmBackend.getTask(taskId);
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE taskId = ?`);
    const row = stmt.get(taskId) as unknown;
    return row ? (row as TaskRecord) : null;
  }

  public listTasks(filter?: { state?: TaskState; project?: string; builder?: string }): TaskRecord[] {
    if (this.pmBackend) return this.pmBackend.listTasks(filter);
    let sql = `SELECT * FROM tasks WHERE 1=1`;
    const params: (string | number | bigint | null | Uint8Array)[] = [];

    if (filter?.state) {
      sql += ` AND state = ?`;
      params.push(filter.state);
    }
    if (filter?.project) {
      sql += ` AND project = ?`;
      params.push(filter.project);
    }
    if (filter?.builder) {
      sql += ` AND builderSeat = ?`;
      params.push(filter.builder);
    }

    sql += ` ORDER BY createdAt DESC`;
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as unknown as TaskRecord[];
  }

  public transitionTask(
    taskId: string,
    nextState: TaskState,
    actor: string,
    reason?: string,
    updates?: Partial<TaskRecord>
  ): TaskRecord {
    if (this.pmBackend) return this.pmBackend.transition(taskId, nextState, actor, { reason, ...(updates ?? {}) });
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Validate legal transition
    TaskStateMachine.validateTransition(taskId, task.state, nextState, actor, reason);

    const now = new Date().toISOString();
    let completedAt = task.completedAt;
    if (nextState === 'ACCEPTED' || nextState === 'CANCELLED') {
      completedAt = now;
    }

    const merged: TaskRecord = {
      ...task,
      ...(updates || {}),
      state: nextState,
      updatedAt: now,
      completedAt,
    };

    const updateStmt = this.db.prepare(`
      UPDATE tasks SET
        state = ?,
        builderSeat = ?,
        verifierSeat = ?,
        workspacePath = ?,
        branch = ?,
        baseSha = ?,
        candidateSha = ?,
        leaseId = ?,
        retries = ?,
        roomThreadRef = ?,
        updatedAt = ?,
        completedAt = ?
      WHERE taskId = ?
    `);

    updateStmt.run(
      merged.state,
      merged.builderSeat,
      merged.verifierSeat,
      merged.workspacePath,
      merged.branch,
      merged.baseSha,
      merged.candidateSha,
      merged.leaseId,
      merged.retries,
      merged.roomThreadRef,
      merged.updatedAt,
      merged.completedAt,
      taskId
    );

    this.recordTransition(taskId, task.state, nextState, actor, reason || null);

    return this.getTask(taskId)!;
  }

  public attachBuilderArtifact(taskId: string, artifact: BuilderArtifact): TaskRecord {
    if (this.pmBackend) return this.pmBackend.attachBuilderArtifact(taskId, artifact);
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const val = validateBuilderArtifact(artifact);
    if (!val.valid) {
      throw new Error(`Invalid BuilderArtifact: ${val.errors.join('; ')}`);
    }

    if (artifact.taskId !== taskId) {
      throw new Error(`Builder artifact taskId (${artifact.taskId}) does not match task ${taskId}`);
    }

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE tasks SET
        builderArtifactJson = ?,
        candidateSha = ?,
        baseSha = ?,
        updatedAt = ?
      WHERE taskId = ?
    `);

    stmt.run(
      JSON.stringify(artifact),
      artifact.candidateSha,
      artifact.baseSha,
      now,
      taskId
    );

    return this.getTask(taskId)!;
  }

  public attachVerifierArtifact(taskId: string, artifact: VerifierArtifact): TaskRecord {
    if (this.pmBackend) return this.pmBackend.attachVerifierArtifact(taskId, artifact);
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const val = validateVerifierArtifact(artifact);
    if (!val.valid) {
      throw new Error(`Invalid VerifierArtifact: ${val.errors.join('; ')}`);
    }

    if (artifact.taskId !== taskId) {
      throw new Error(`Verifier artifact taskId (${artifact.taskId}) does not match task ${taskId}`);
    }

    // Exact candidate SHA check
    if (task.candidateSha && artifact.evaluatedSha !== task.candidateSha) {
      throw new Error(
        `Verifier evaluated SHA (${artifact.evaluatedSha}) does not match task candidate SHA (${task.candidateSha})`
      );
    }

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE tasks SET
        verifierArtifactJson = ?,
        updatedAt = ?
      WHERE taskId = ?
    `);

    stmt.run(
      JSON.stringify(artifact),
      now,
      taskId
    );

    return this.getTask(taskId)!;
  }

  public getTransitionHistory(taskId: string): TaskTransitionLog[] {
    if (this.pmBackend) return this.pmBackend.getHistory(taskId);
    const stmt = this.db.prepare(
      `SELECT * FROM task_transitions WHERE taskId = ? ORDER BY id ASC`
    );
    return stmt.all(taskId) as unknown as TaskTransitionLog[];
  }

  private recordTransition(
    taskId: string,
    fromState: TaskState,
    toState: TaskState,
    actor: string,
    reason: string | null
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO task_transitions (taskId, fromState, toState, actor, reason, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(taskId, fromState, toState, actor, reason, new Date().toISOString());
  }

  public close(): void {
    if (this.pmBackend) return;
    this.db.close();
  }
}
