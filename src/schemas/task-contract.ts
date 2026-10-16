/**
 * src/schemas/task-contract.ts
 *
 * Structured Task Contract schema and TypeScript types per Doctrine Section 9.
 */

export type StarqProject =
  | 'STARQ_ERP'
  | 'STARQ_POS'
  | 'HOADHA'
  | 'COMMERCE_INTEL'
  | 'STARQ_AI'
  | 'STARQ_PAY'
  | 'STARQ_LOGISTICS'
  | 'STARQ_ACADEMY'
  | 'CORE_INFRA';

export type TaskType = 'FEATURE' | 'BUGFIX' | 'REFACTOR' | 'SECURITY' | 'INFRA' | 'AUDIT';

export type TaskPriority = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW';

export type TaskRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL_FOUNDER_GATED';

export type IndependenceLevel =
  | 'BUILDER_SELF_TEST'
  | 'INDEPENDENT_INTERNAL_WEAK'
  | 'INDEPENDENT_INTERNAL_STRONG'
  | 'EXTERNAL_VALIDATION';

export interface TaskBoundaryRules {
  allowed_paths: string[];
  forbidden_paths: string[];
  prohibited_actions: string[];
  allowed_network_access?: boolean;
}

export interface VerificationRequirements {
  required_test_commands: string[];
  minimum_independence_level: IndependenceLevel;
  required_coverage_percent?: number;
}

export interface TaskContract {
  task_id: string; // e.g. T-2026-0001 or SERP-354
  title: string;
  project_id: StarqProject;
  repository_url: string;
  base_sha: string;
  task_type: TaskType;
  priority: TaskPriority;
  objective: string;
  boundary_rules: TaskBoundaryRules;
  acceptance_criteria: string[];
  verification_requirements: VerificationRequirements;
  risk_level: TaskRiskLevel;
  timeout_seconds: number;
  founder_approval_required: boolean;
  builder_seat?: string;
  verifier_seat?: string;
  parent_task_id?: string;
  dependencies?: string[];
  created_at?: string;
}

export function validateTaskContract(contract: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!contract || typeof contract !== 'object') {
    return { valid: false, errors: ['Contract must be an object'] };
  }
  const c = contract as Record<string, any>;

  if (!c.task_id || typeof c.task_id !== 'string') errors.push('task_id is required and must be a string');
  if (!c.title || typeof c.title !== 'string') errors.push('title is required and must be a string');
  if (!c.project_id || typeof c.project_id !== 'string') errors.push('project_id is required');
  if (!c.base_sha || typeof c.base_sha !== 'string') errors.push('base_sha is required');
  if (!c.objective || typeof c.objective !== 'string') errors.push('objective is required');
  if (!Array.isArray(c.acceptance_criteria) || c.acceptance_criteria.length === 0) {
    errors.push('acceptance_criteria must be a non-empty array of strings');
  }
  if (!c.boundary_rules || typeof c.boundary_rules !== 'object') {
    errors.push('boundary_rules must be an object');
  } else {
    if (!Array.isArray(c.boundary_rules.allowed_paths)) errors.push('boundary_rules.allowed_paths must be an array');
    if (!Array.isArray(c.boundary_rules.forbidden_paths)) errors.push('boundary_rules.forbidden_paths must be an array');
  }
  if (!c.verification_requirements || typeof c.verification_requirements !== 'object') {
    errors.push('verification_requirements must be an object');
  } else {
    if (!Array.isArray(c.verification_requirements.required_test_commands)) {
      errors.push('verification_requirements.required_test_commands must be an array');
    }
  }

  return { valid: errors.length === 0, errors };
}
