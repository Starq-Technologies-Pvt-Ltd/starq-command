/**
 * Verifier Guard & Anti-Self-Acceptance Enforcer
 * Starq Command Architecture Doctrine Section 11 & Requirements 5D, 5E
 */

import { type TaskRecord } from './task-store.ts';
import { type BuilderArtifact, validateBuilderArtifact } from '../../src/schemas/builder-artifact.ts';
import { type VerifierArtifact, validateVerifierArtifact } from '../../src/schemas/verifier-artifact.ts';

export interface GuardEvaluationResult {
  allowed: boolean;
  reason?: string;
}

export class VerifierGuard {
  /**
   * Check if an actor can initiate builder completion for a task.
   */
  public static canSubmitBuilderCompletion(
    task: TaskRecord,
    artifact: BuilderArtifact
  ): GuardEvaluationResult {
    const val = validateBuilderArtifact(artifact);
    if (!val.valid) {
      return { allowed: false, reason: `Invalid builder artifact: ${val.errors.join('; ')}` };
    }

    if (task.state !== 'EXECUTING') {
      return {
        allowed: false,
        reason: `Task ${task.taskId} must be in EXECUTING state to submit builder completion (current: ${task.state})`,
      };
    }

    if (task.builderSeat && artifact.builderSeat !== task.builderSeat) {
      return {
        allowed: false,
        reason: `Artifact builder seat (${artifact.builderSeat}) does not match assigned builder (${task.builderSeat})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Anti-Self-Acceptance & Exact-SHA Guard.
   * Strictly verifies that:
   * 1. Builder and Verifier are NOT the same seat (No self-acceptance).
   * 2. Evaluated SHA exactly matches candidate SHA.
   * 3. Task is in VERIFYING state.
   * 4. Artifact is valid.
   */
  public static canAcceptTask(
    task: TaskRecord,
    verifierArtifact: VerifierArtifact
  ): GuardEvaluationResult {
    const val = validateVerifierArtifact(verifierArtifact);
    if (!val.valid) {
      return { allowed: false, reason: `Invalid verifier artifact: ${val.errors.join('; ')}` };
    }

    if (task.state !== 'VERIFYING') {
      return {
        allowed: false,
        reason: `Task ${task.taskId} must be in VERIFYING state to accept (current: ${task.state})`,
      };
    }

    // 1. Strict Anti-Self-Acceptance: Builder CANNOT self-accept
    const effectiveBuilder = task.builderSeat;
    if (
      effectiveBuilder &&
      verifierArtifact.verifierSeat.toLowerCase().trim() ===
        effectiveBuilder.toLowerCase().trim()
    ) {
      return {
        allowed: false,
        reason: `ANTI-SELF-ACCEPTANCE VIOLATION: Builder seat '${effectiveBuilder}' cannot act as Verifier for task ${task.taskId}`,
      };
    }

    // 2. Exact Candidate SHA Match
    if (!task.candidateSha) {
      return {
        allowed: false,
        reason: `Task ${task.taskId} has no candidate SHA registered`,
      };
    }

    if (
      verifierArtifact.evaluatedSha.toLowerCase() !== task.candidateSha.toLowerCase()
    ) {
      return {
        allowed: false,
        reason: `EXACT-SHA MISMATCH: Verifier evaluated SHA (${verifierArtifact.evaluatedSha}) does not match candidate SHA (${task.candidateSha})`,
      };
    }

    // 3. Verdict Result Must Be PASS
    if (verifierArtifact.result !== 'PASS') {
      return {
        allowed: false,
        reason: `Cannot accept task with verifier verdict '${verifierArtifact.result}' (must be PASS)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if verifier verdict triggers remediation loop (REJECTED state)
   */
  public static canRejectTask(
    task: TaskRecord,
    verifierArtifact: VerifierArtifact
  ): GuardEvaluationResult {
    const val = validateVerifierArtifact(verifierArtifact);
    if (!val.valid) {
      return { allowed: false, reason: `Invalid verifier artifact: ${val.errors.join('; ')}` };
    }

    if (task.state !== 'VERIFYING') {
      return {
        allowed: false,
        reason: `Task ${task.taskId} must be in VERIFYING state to reject (current: ${task.state})`,
      };
    }

    if (verifierArtifact.result === 'PASS') {
      return {
        allowed: false,
        reason: `Cannot reject task when verifier verdict is PASS`,
      };
    }

    return { allowed: true };
  }
}
