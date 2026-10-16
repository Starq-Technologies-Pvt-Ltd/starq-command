/**
 * Verifier Verdict Artifact Schema & Validator
 * Starq Command Architecture Doctrine Section 11
 */

export type VerificationResult = 'PASS' | 'FAIL' | 'CONDITIONAL';
export type IndependenceClass = 'STRICT_INDEPENDENT' | 'FOUNDER_SUPERVISED' | 'RE_VERIFIED';

export interface VerifierExecutionRecord {
  command: string;
  exitCode: number;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  durationMs?: number;
}

export interface VerificationFinding {
  severity: 'BLOCKER' | 'MAJOR' | 'MINOR' | 'OBSERVATION';
  description: string;
  remediationAdvice?: string;
}

export interface VerifierArtifact {
  schemaVersion: '1.0.0';
  taskId: string;
  verifierSeat: string;
  evaluatedSha: string;
  verificationWorkspace: string;
  independenceClass: IndependenceClass;
  commandsExecuted: VerifierExecutionRecord[];
  result: VerificationResult;
  findings: VerificationFinding[];
  remainingRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  verdictNotes: string;
  verifiedAt: string; // ISO 8601
}

export interface VerifierArtifactValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateVerifierArtifact(data: unknown): VerifierArtifactValidationResult {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Verifier artifact must be an object'] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.schemaVersion !== '1.0.0') {
    errors.push('Invalid or missing schemaVersion: must be 1.0.0');
  }

  if (typeof obj.taskId !== 'string' || !obj.taskId.trim()) {
    errors.push('taskId is required and must be non-empty string');
  }

  if (typeof obj.verifierSeat !== 'string' || !obj.verifierSeat.trim()) {
    errors.push('verifierSeat is required and must be non-empty string');
  }

  if (typeof obj.evaluatedSha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(obj.evaluatedSha)) {
    errors.push('evaluatedSha must be a valid git commit hash (7-40 hex chars)');
  }

  if (typeof obj.verificationWorkspace !== 'string' || !obj.verificationWorkspace.trim()) {
    errors.push('verificationWorkspace is required');
  }

  const validClasses = ['STRICT_INDEPENDENT', 'FOUNDER_SUPERVISED', 'RE_VERIFIED'];
  if (!validClasses.includes(obj.independenceClass as string)) {
    errors.push(`independenceClass must be one of: ${validClasses.join(', ')}`);
  }

  const validResults = ['PASS', 'FAIL', 'CONDITIONAL'];
  if (!validResults.includes(obj.result as string)) {
    errors.push(`result must be one of: ${validResults.join(', ')}`);
  }

  if (!Array.isArray(obj.commandsExecuted) || obj.commandsExecuted.length === 0) {
    errors.push('commandsExecuted must be a non-empty array of test execution records');
  } else {
    for (const [idx, c] of (obj.commandsExecuted as unknown[]).entries()) {
      if (!c || typeof c !== 'object') {
        errors.push(`commandsExecuted[${idx}] is not an object`);
        continue;
      }
      const rec = c as Record<string, unknown>;
      if (typeof rec.command !== 'string') errors.push(`commandsExecuted[${idx}].command is required`);
      if (typeof rec.exitCode !== 'number') errors.push(`commandsExecuted[${idx}].exitCode is required`);
    }
  }

  if (!Array.isArray(obj.findings)) {
    errors.push('findings must be an array');
  }

  const validRisks = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  if (!validRisks.includes(obj.remainingRisk as string)) {
    errors.push(`remainingRisk must be one of: ${validRisks.join(', ')}`);
  }

  if (typeof obj.verdictNotes !== 'string' || !obj.verdictNotes.trim()) {
    errors.push('verdictNotes is required');
  }

  if (typeof obj.verifiedAt !== 'string' || isNaN(Date.parse(obj.verifiedAt))) {
    errors.push('verifiedAt must be a valid ISO 8601 timestamp');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
