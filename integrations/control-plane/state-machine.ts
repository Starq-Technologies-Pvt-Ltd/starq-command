/**
 * Starq Command Task State Machine
 * Canonical 11-State Model with Branching and Terminal Protection
 * Starq Command Architecture Doctrine Section 7
 */

export type TaskState =
  | 'CREATED'
  | 'QUEUED'
  | 'ALLOCATED'
  | 'EXECUTING'
  | 'BUILDER_COMPLETE'
  | 'VERIFYING'
  | 'ACCEPTED'
  | 'BLOCKED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED';

export const CANONICAL_STATES: readonly TaskState[] = [
  'CREATED',
  'QUEUED',
  'ALLOCATED',
  'EXECUTING',
  'BUILDER_COMPLETE',
  'VERIFYING',
  'ACCEPTED',
  'BLOCKED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
] as const;

export const TERMINAL_STATES: readonly TaskState[] = ['ACCEPTED', 'CANCELLED'] as const;

/**
 * Transition Table defining legal target states from any source state
 */
export const LEGAL_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  CREATED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['ALLOCATED', 'CANCELLED', 'BLOCKED'],
  ALLOCATED: ['EXECUTING', 'QUEUED', 'CANCELLED', 'BLOCKED'],
  EXECUTING: ['BUILDER_COMPLETE', 'BLOCKED', 'FAILED', 'CANCELLED'],
  BUILDER_COMPLETE: ['VERIFYING', 'CANCELLED', 'BLOCKED', 'REJECTED'],
  VERIFYING: ['ACCEPTED', 'REJECTED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  REJECTED: ['QUEUED', 'ALLOCATED', 'FAILED', 'CANCELLED'],
  BLOCKED: ['QUEUED', 'ALLOCATED', 'EXECUTING', 'FAILED', 'CANCELLED'],
  FAILED: ['QUEUED', 'CANCELLED'],
  ACCEPTED: [], // terminal
  CANCELLED: [], // terminal
};

export interface StateTransitionEvent {
  taskId: string;
  fromState: TaskState;
  toState: TaskState;
  actor: string;
  reason?: string;
  timestamp: string; // ISO 8601
}

export class TaskStateMachine {
  /**
   * Check if a transition is legal under the state model
   */
  public static isTransitionLegal(from: TaskState, to: TaskState): boolean {
    const allowed = LEGAL_TRANSITIONS[from];
    return Array.isArray(allowed) && allowed.includes(to);
  }

  /**
   * Validate and execute transition; throws if illegal
   */
  public static validateTransition(
    taskId: string,
    current: TaskState,
    next: TaskState,
    actor: string,
    reason?: string
  ): StateTransitionEvent {
    if (current === next) {
      throw new Error(`Invalid self-transition for task ${taskId}: already in state ${current}`);
    }

    if (TERMINAL_STATES.includes(current)) {
      throw new Error(
        `Illegal transition from terminal state ${current} to ${next} for task ${taskId}`
      );
    }

    if (!this.isTransitionLegal(current, next)) {
      throw new Error(
        `Illegal transition for task ${taskId}: cannot transition from ${current} to ${next}. Allowed targets: ${LEGAL_TRANSITIONS[current].join(', ')}`
      );
    }

    return {
      taskId,
      fromState: current,
      toState: next,
      actor,
      reason,
      timestamp: new Date().toISOString(),
    };
  }
}
