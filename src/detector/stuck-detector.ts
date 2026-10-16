/**
 * Stuck & Failure Detector
 * Starq Command Architecture Doctrine Section 13 & Requirement 5F
 */

import { type StuckRecord, type StuckEvidence } from '../schemas/stuck-event.ts';

export interface StuckDetectionConfig {
  inactivityThresholdMs: number; // default: 15 mins (900,000ms)
  repeatedCommandThreshold: number; // default: 3 consecutive identical commands
  consecutiveNoProgressLimit: number; // default: 5 checks
}

export const DEFAULT_STUCK_CONFIG: StuckDetectionConfig = {
  inactivityThresholdMs: 15 * 60 * 1000,
  repeatedCommandThreshold: 3,
  consecutiveNoProgressLimit: 5,
};

export class StuckDetector {
  private records: Map<string, StuckRecord> = new Map();
  private commandHistories: Map<string, string[]> = new Map();
  private config: StuckDetectionConfig;

  constructor(config: Partial<StuckDetectionConfig> = {}) {
    this.config = { ...DEFAULT_STUCK_CONFIG, ...config };
  }

  public registerTask(taskId: string, seat: string): StuckRecord {
    const now = new Date().toISOString();
    const record: StuckRecord = {
      taskId,
      seat,
      currentState: 'RUNNING',
      lastProgressAt: now,
      consecutiveNoProgressCount: 0,
      signals: [],
    };
    this.records.set(taskId, record);
    this.commandHistories.set(taskId, []);
    return record;
  }

  public recordProgress(taskId: string): void {
    const record = this.records.get(taskId);
    if (!record) return;

    record.lastProgressAt = new Date().toISOString();
    record.consecutiveNoProgressCount = 0;
    if (record.currentState === 'SUSPECTED_STUCK') {
      record.currentState = 'RUNNING';
    }
  }

  public recordCommand(taskId: string, commandStr: string): StuckEvidence | null {
    const history = this.commandHistories.get(taskId) || [];
    history.push(commandStr.trim());
    if (history.length > 20) history.shift();
    this.commandHistories.set(taskId, history);

    // Check for repeated identical commands at tail
    if (history.length >= this.config.repeatedCommandThreshold) {
      const slice = history.slice(-this.config.repeatedCommandThreshold);
      const allSame = slice.every((cmd) => cmd === slice[0]);
      if (allSame) {
        const evidence: StuckEvidence = {
          signalType: 'REPEATED_COMMAND_LOOP',
          description: `Command '${slice[0]}' repeated ${this.config.repeatedCommandThreshold} times consecutively`,
          observedAt: new Date().toISOString(),
          metadata: { repeatedCommand: slice[0], count: this.config.repeatedCommandThreshold },
        };
        this.addEvidence(taskId, evidence);
        return evidence;
      }
    }
    return null;
  }

  public evaluateInactivity(taskId: string, nowMs = Date.now()): StuckEvidence | null {
    const record = this.records.get(taskId);
    if (!record || record.currentState === 'PAUSED' || record.currentState === 'RECOVERED') {
      return null;
    }

    const lastProgressMs = Date.parse(record.lastProgressAt);
    const elapsed = nowMs - lastProgressMs;

    if (elapsed > this.config.inactivityThresholdMs) {
      const evidence: StuckEvidence = {
        signalType: 'INACTIVITY_TIMEOUT',
        description: `No progress observed for ${(elapsed / 1000 / 60).toFixed(1)} minutes (threshold: ${this.config.inactivityThresholdMs / 1000 / 60}m)`,
        observedAt: new Date().toISOString(),
        metadata: { elapsedMs: elapsed },
      };
      this.addEvidence(taskId, evidence);
      return evidence;
    }

    return null;
  }

  public addEvidence(taskId: string, evidence: StuckEvidence): StuckRecord {
    let record = this.records.get(taskId);
    if (!record) {
      record = this.registerTask(taskId, 'unknown');
    }

    record.signals.push(evidence);
    record.consecutiveNoProgressCount += 1;

    // Transition state machine: RUNNING -> SUSPECTED_STUCK -> STUCK -> PAUSED / ESCALATED
    const now = new Date().toISOString();
    if (record.currentState === 'RUNNING') {
      record.currentState = 'SUSPECTED_STUCK';
      record.firstSuspectedAt = now;
    } else if (
      record.currentState === 'SUSPECTED_STUCK' &&
      record.consecutiveNoProgressCount >= 2
    ) {
      record.currentState = 'STUCK';
      record.confirmedStuckAt = now;
      // Canonical Rule: Pause before kill!
      record.remediationAction = 'PAUSE';
      record.remediationAppliedAt = now;
    }

    return record;
  }

  public escalate(taskId: string): StuckRecord | null {
    const record = this.records.get(taskId);
    if (!record) return null;

    record.currentState = 'ESCALATED';
    record.remediationAction = 'ESCALATE';
    record.remediationAppliedAt = new Date().toISOString();
    return record;
  }

  public getRecord(taskId: string): StuckRecord | null {
    return this.records.get(taskId) || null;
  }

  public listStuckTasks(): StuckRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.currentState === 'SUSPECTED_STUCK' || r.currentState === 'STUCK' || r.currentState === 'PAUSED' || r.currentState === 'ESCALATED'
    );
  }
}
