/**
 * Worktree Lease Lock Schema & Validator
 * Starq Command Architecture Doctrine Section 8
 */

export type LeaseRole = 'BUILDER' | 'VERIFIER';
export type LeaseStatus = 'ACTIVE' | 'EXPIRED' | 'RELEASED' | 'RECOVERED';

export interface WorktreeLease {
  leaseId: string;
  taskId: string;
  seat: string;
  role: LeaseRole;
  workspacePath: string;
  branch: string;
  baseSha: string;
  candidateSha?: string;
  pid: number;
  createTime: number;
  acquiredAt: string; // ISO 8601
  heartbeatAt: string; // ISO 8601
  ttlSeconds: number;
  releasedAt?: string;
  status: LeaseStatus;
}

export function isLeaseStale(lease: WorktreeLease, nowMs = Date.now()): boolean {
  if (lease.status !== 'ACTIVE') return false;
  const lastBeat = Date.parse(lease.heartbeatAt || lease.acquiredAt);
  if (isNaN(lastBeat)) return true;
  return nowMs - lastBeat > lease.ttlSeconds * 1000;
}
