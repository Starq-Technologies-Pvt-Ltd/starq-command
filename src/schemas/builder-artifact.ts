/**
 * Builder Completion Artifact Schema & Validator
 * Starq Command Architecture Doctrine Section 10
 */

export interface TestExecutionRecord {
  command: string;
  exitCode: number;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  durationMs?: number;
}

export interface SubagentUsageRecord {
  role: string;
  conversationId?: string;
  purpose: string;
}

export interface BuilderArtifact {
  schemaVersion: '1.0.0';
  taskId: string;
  builderSeat: string;
  harnessMetadata?: {
    provider?: string;
    model?: string;
    harness?: string;
    cliVersion?: string;
  };
  baseSha: string;
  candidateSha: string;
  workspacePath: string;
  filesChanged: string[];
  diffStat: {
    insertions: number;
    deletions: number;
    filesCount: number;
  };
  implementationSummary: string;
  testsExecuted: TestExecutionRecord[];
  knownLimitations: string[];
  evidenceReferences: string[];
  subagentsUsed?: SubagentUsageRecord[];
  completedAt: string; // ISO 8601
}

export interface BuilderArtifactValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBuilderArtifact(data: unknown): BuilderArtifactValidationResult {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Builder artifact must be an object'] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.schemaVersion !== '1.0.0') {
    errors.push('Invalid or missing schemaVersion: must be 1.0.0');
  }

  if (typeof obj.taskId !== 'string' || !obj.taskId.trim()) {
    errors.push('taskId is required and must be non-empty string');
  }

  if (typeof obj.builderSeat !== 'string' || !obj.builderSeat.trim()) {
    errors.push('builderSeat is required and must be non-empty string');
  }

  if (typeof obj.baseSha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(obj.baseSha)) {
    errors.push('baseSha must be a valid git commit hash (7-40 hex chars)');
  }

  if (typeof obj.candidateSha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(obj.candidateSha)) {
    errors.push('candidateSha must be a valid git commit hash (7-40 hex chars)');
  }

  if (typeof obj.workspacePath !== 'string' || !obj.workspacePath.trim()) {
    errors.push('workspacePath is required');
  }

  if (!Array.isArray(obj.filesChanged) || obj.filesChanged.length === 0) {
    errors.push('filesChanged must be a non-empty array of file paths');
  }

  if (!obj.diffStat || typeof obj.diffStat !== 'object') {
    errors.push('diffStat is required');
  } else {
    const ds = obj.diffStat as Record<string, unknown>;
    if (typeof ds.insertions !== 'number' || typeof ds.deletions !== 'number' || typeof ds.filesCount !== 'number') {
      errors.push('diffStat must include insertions, deletions, and filesCount numbers');
    }
  }

  if (typeof obj.implementationSummary !== 'string' || obj.implementationSummary.trim().length < 10) {
    errors.push('implementationSummary must be at least 10 characters');
  }

  if (!Array.isArray(obj.testsExecuted)) {
    errors.push('testsExecuted must be an array of test execution records');
  } else {
    for (const [idx, t] of (obj.testsExecuted as unknown[]).entries()) {
      if (!t || typeof t !== 'object') {
        errors.push(`testsExecuted[${idx}] is not an object`);
        continue;
      }
      const rec = t as Record<string, unknown>;
      if (typeof rec.command !== 'string') errors.push(`testsExecuted[${idx}].command is required`);
      if (typeof rec.exitCode !== 'number') errors.push(`testsExecuted[${idx}].exitCode is required`);
    }
  }

  if (!Array.isArray(obj.knownLimitations)) {
    errors.push('knownLimitations must be an array (can be empty)');
  }

  if (!Array.isArray(obj.evidenceReferences)) {
    errors.push('evidenceReferences must be an array');
  }

  if (typeof obj.completedAt !== 'string' || isNaN(Date.parse(obj.completedAt))) {
    errors.push('completedAt must be a valid ISO 8601 timestamp');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
