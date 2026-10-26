/**
 * Stuck & Failure Detection Schema
 * Starq Command Architecture Doctrine Section 13
 */

export type StuckState = 'RUNNING' | 'SUSPECTED_STUCK' | 'STUCK' | 'PAUSED' | 'ESCALATED' | 'RECOVERED';

export type StuckSignalType =
  | 'REPEATED_COMMAND_LOOP'
  | 'NO_STATE_PROGRESS'
  | 'INACTIVITY_TIMEOUT'
  | 'PROCESS_HEALTH'
  | 'RESOURCE_PRESSURE';

export interface StuckEvidence {
  signalType: StuckSignalType;
  description: string;
  observedAt: string;
  metadata?: Record<string, unknown>;
}

export interface StuckRecord {
  taskId: string;
  seat: string;
  currentState: StuckState;
  firstSuspectedAt?: string;
  confirmedStuckAt?: string;
  lastProgressAt: string;
  consecutiveNoProgressCount: number;
  signals: StuckEvidence[];
  remediationAction?: 'PAUSE' | 'ESCALATE' | 'RESTART' | 'KILL' | 'NONE';
  remediationAppliedAt?: string;
}
