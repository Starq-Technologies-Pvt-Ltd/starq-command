import { planDispatch, requiredCapabilities } from '../../server/dispatch-policy.mjs';
import type { PmTaskExecutionStore } from '../control-plane/pm-task-execution-store.ts';

type WorkforceProvider = () => Promise<any>;
type RepoResolver = (task: any) => { repoPath: string; baseSha: string; worktreesDir?: string } | null;

/**
 * Thin coordinator over the existing PM execution extension, WorktreeManager,
 * and RoomEventAdapter. It never launches or prompts a Herdr worker directly.
 */
export class Dispatcher {
  constructor(private options: {
    store: PmTaskExecutionStore;
    getWorkforce: WorkforceProvider;
    worktreeManager: any;
    repoResolver: RepoResolver;
    roomAdapter: any;
    sender: string;
  }) {}

  async preview() {
    const workforce = await this.options.getWorkforce();
    const plan = planDispatch(this.options.store.listReadyTasks(), workforce);
    return { ...plan, workforceObservedAt: workforce.observed_at ?? null };
  }

  async dispatchNext(requestedTaskId?: string) {
    if (!this.options.sender) {
      return { ok: false, state: 'BLOCKED', reason: 'DISPATCH_ROOM_WRITER_NOT_CONFIGURED' };
    }
    if (this.options.roomAdapter.requiredRoomDeliveryReady
      && !this.options.roomAdapter.requiredRoomDeliveryReady()) {
      return { ok: false, state: 'BLOCKED', reason: 'DISPATCH_ROOM_WRITER_NOT_CONFIGURED' };
    }
    const workforce = await this.options.getWorkforce();
    const plan = planDispatch(this.options.store.listReadyTasks(), workforce);
    const selected = requestedTaskId
      ? plan.eligible.find((candidate: any) => candidate.taskId === requestedTaskId)
      : plan.eligible[0];
    if (!selected) return { ok: false, state: 'NO_ELIGIBLE_WORK', plan };
    const task = this.options.store.getTask(selected.taskId);
    if (!task) throw new Error(`PM task ${selected.taskId} disappeared during dispatch.`);
    const repository = this.options.repoResolver(task);
    if (!repository?.repoPath || !repository?.baseSha) {
      return { ok: false, state: 'BLOCKED', taskId: task.taskId, reason: 'PROJECT_REPOSITORY_NOT_CONFIGURED' };
    }

    const worktree = await this.options.worktreeManager.provisionBuilderWorktree({
      repoPath: repository.repoPath,
      taskId: task.taskId,
      seat: selected.worker,
      baseSha: repository.baseSha,
      worktreesDir: repository.worktreesDir,
      branchName: task.execution?.retries
        ? `starq/task/${task.taskId}-retry-${task.execution.retries}`
        : undefined,
    });

    const contract = {
      taskId: task.taskId,
      projectId: task.projectId,
      project: task.project,
      title: task.title,
      objective: task.objective,
      acceptanceCriteria: task.acceptanceCriteria,
      dependencies: task.dependencies,
      priority: task.priority,
      owner: task.owner,
      verifier: task.verifier,
      roomAuthorizationRef: task.roomAuthorizationRef,
      sourceAttributes: task.sourceAttributes,
      requiredCapabilities: selected.requiredCapabilities,
    };
    const allocated = this.options.store.allocate({
      taskId: task.taskId,
      builderSeat: selected.worker,
      herdrSessionId: selected.sessionId,
      workspacePath: worktree.workspacePath,
      branch: worktree.branch,
      baseSha: worktree.sha,
      leaseId: worktree.lease.leaseId,
      contract,
      roomAssignmentRef: { status: 'PENDING' },
    });

    try {
      const event = await this.options.roomAdapter.emitEvent('TASK_ASSIGNED', {
        taskId: task.taskId,
        sender: this.options.sender,
        recipient: selected.worker,
        subject: `Command assignment ${task.taskId}: ${task.title}`,
        actionRequired: `Acknowledge ${task.taskId} in Room and begin the assigned work.`,
        requiredRoomDelivery: true,
        broadcastToRoom: true,
        summary: `${task.title} assigned to ${selected.worker}; execution workspace is leased.`,
        payload: {
          worker: selected.worker,
          herdrSessionId: selected.sessionId,
          project: task.project,
          workspacePath: worktree.workspacePath,
          branch: worktree.branch,
          baseSha: worktree.sha,
          leaseId: worktree.lease.leaseId,
          requiredCapabilities: selected.requiredCapabilities,
          acceptanceCriteria: task.acceptanceCriteria,
          dependencies: task.dependencies,
        },
      });
      if (event.room_ref?.status !== 'POSTED') throw new Error('Room assignment delivery was not confirmed.');
      this.options.store.setRoomAssignmentRef(task.taskId, event.room_ref);
      const executing = this.options.store.transition(task.taskId, 'EXECUTING', selected.worker, {
        roomAssignmentRef: event.room_ref,
      });
      return { ok: true, state: 'EXECUTING', task: executing, worktree, roomRef: event.room_ref };
    } catch (error) {
      this.options.store.transition(task.taskId, 'BLOCKED', this.options.sender, {
        failure: 'ASSIGNMENT_DELIVERY_FAILED', reason: error instanceof Error ? error.message : String(error),
        workspacePath: worktree.workspacePath, leaseId: worktree.lease.leaseId,
      });
      return { ok: false, state: 'BLOCKED', taskId: task.taskId, reason: 'ASSIGNMENT_DELIVERY_FAILED', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async startVerification(taskId: string) {
    if (!this.options.sender) return { ok: false, state: 'BLOCKED', reason: 'DISPATCH_ROOM_WRITER_NOT_CONFIGURED' };
    if (this.options.roomAdapter.requiredRoomDeliveryReady
      && !this.options.roomAdapter.requiredRoomDeliveryReady()) {
      return { ok: false, state: 'BLOCKED', reason: 'DISPATCH_ROOM_WRITER_NOT_CONFIGURED' };
    }
    const task = this.options.store.getTask(taskId);
    if (!task?.execution || task.execution.state !== 'BUILDER_COMPLETE') {
      throw new Error('Verification requires a completed builder artifact.');
    }
    const workforce = await this.options.getWorkforce();
    const verifier = workforce.seats.find((seat: any) => seat.handle === task.verifier);
    const required = [...new Set([...requiredCapabilities(task), 'verification'])];
    const capabilities = new Set(verifier?.capabilities?.state === 'VERIFIED' ? verifier.capabilities.values : []);
    if (!verifier?.dispatch_eligible || verifier.availability !== 'AVAILABLE' || !verifier.runtime?.session_id
      || required.some((capability) => !capabilities.has(capability))) {
      return {
        ok: false, state: 'WAITING_FOR_VERIFIER', taskId,
        reason: 'VERIFIER_NOT_READY_OR_CAPABLE',
        verifier: task.verifier,
        blockers: [verifier?.dispatch_blocker ?? 'VERIFIER_NOT_JOINED', ...required.filter((capability) => !capabilities.has(capability)).map((capability) => `CAPABILITY_MISSING:${capability}`)],
      };
    }
    if (verifier.handle === task.execution.builderSeat) throw new Error('Builder cannot verify its own task.');
    const repository = this.options.repoResolver(task);
    if (!repository) throw new Error('Project repository is not configured for verification.');
    const worktree = await this.options.worktreeManager.provisionVerifierWorktree({
      repoPath: repository.repoPath,
      taskId,
      verifierSeat: verifier.handle,
      candidateSha: task.execution.candidateSha,
      worktreesDir: repository.worktreesDir,
    });
    this.options.store.assignVerifier({
      taskId, verifierSeat: verifier.handle, herdrSessionId: verifier.runtime.session_id,
      workspacePath: worktree.workspacePath, branch: worktree.branch, leaseId: worktree.lease.leaseId,
    });
    try {
      const event = await this.options.roomAdapter.emitEvent('TASK_ASSIGNED', {
        taskId, sender: this.options.sender, recipient: verifier.handle,
        subject: `Independent verification ${taskId}: ${task.title}`,
        actionRequired: `Verify candidate ${task.execution.candidateSha} independently and report evidence for ${taskId}.`,
        requiredRoomDelivery: true, broadcastToRoom: true,
        summary: `Independent verification assigned to ${verifier.handle}.`,
        payload: { role: 'VERIFIER', worker: verifier.handle, herdrSessionId: verifier.runtime.session_id,
          workspacePath: worktree.workspacePath, branch: worktree.branch, candidateSha: task.execution.candidateSha,
          leaseId: worktree.lease.leaseId, requiredCapabilities: required },
      });
      if (event.room_ref?.status !== 'POSTED') throw new Error('Room verifier assignment delivery was not confirmed.');
      const verifying = this.options.store.transition(taskId,'VERIFYING',verifier.handle,{roomAssignmentRef:event.room_ref});
      return { ok: true, state: 'VERIFYING', task: verifying, worktree, roomRef: event.room_ref };
    } catch (error) {
      this.options.store.transition(taskId,'BLOCKED',this.options.sender,{
        reason: `Verifier assignment delivery failed: ${error instanceof Error ? error.message : String(error)}`,
        failure: 'VERIFIER_DELIVERY_FAILED',
      });
      return { ok: false,state:'BLOCKED',taskId,reason:'VERIFIER_DELIVERY_FAILED' };
    }
  }

  async recover(taskId: string, reason: string) {
    const task = this.options.store.getTask(taskId);
    if (!task?.execution || !['BLOCKED', 'FAILED'].includes(task.execution.state)) {
      throw new Error('Only a blocked or failed execution can enter recovery.');
    }
    const previous = task.execution.state;
    if (task.execution.workspacePath || task.execution.verifierWorkspacePath) {
      const repo = this.options.repoResolver(task);
      if (!repo) throw new Error('Cannot recover without the task repository mapping.');
      for (const workspacePath of [task.execution.verifierWorkspacePath, task.execution.workspacePath].filter(Boolean)) {
        const cleanup = await this.options.worktreeManager.removeWorktreeSafe(repo.repoPath, workspacePath, taskId);
        if (!cleanup.cleaned) throw new Error(`Worktree recovery failed: ${cleanup.message}`);
        if (cleanup.savedRescueSha) reason = `${reason}; preserved unfinished work at ${cleanup.savedRescueSha}`;
      }
    }
    this.options.store.transition(taskId, 'QUEUED', this.options.sender, { recovery: true, reason, previousState: previous });
    return this.dispatchNext(taskId);
  }
}
