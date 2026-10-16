/**
 * Worktree Lease Service
 * Starq Command Architecture Doctrine Section 8
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type WorktreeLease, type LeaseRole, isLeaseStale } from '../../src/schemas/lease.ts';

export class LeaseService {
  private static readonly LEASE_FILENAME = '.worktree-lease';

  /**
   * Acquire a lease on a workspace directory.
   */
  public static acquireLease(params: {
    taskId: string;
    seat: string;
    role: LeaseRole;
    workspacePath: string;
    branch: string;
    baseSha: string;
    candidateSha?: string;
    ttlSeconds?: number;
  }): WorktreeLease {
    const leaseFile = path.join(params.workspacePath, this.LEASE_FILENAME);
    const ttl = params.ttlSeconds ?? 3600;
    const nowIso = new Date().toISOString();

    if (fs.existsSync(leaseFile)) {
      try {
        const raw = fs.readFileSync(leaseFile, 'utf8');
        const existing: WorktreeLease = JSON.parse(raw);
        if (existing.status === 'ACTIVE' && !isLeaseStale(existing)) {
          // Verify if PID is actually alive
          if (this.isProcessAlive(existing.pid)) {
            throw new Error(
              `Workspace ${params.workspacePath} is actively leased by seat '${existing.seat}' (task: ${existing.taskId}, pid: ${existing.pid})`
            );
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('actively leased')) {
          throw err;
        }
        // If file was corrupted or lease was expired, we overwrite
      }
    }

    const lease: WorktreeLease = {
      leaseId: `lease-${params.taskId}-${Date.now()}`,
      taskId: params.taskId,
      seat: params.seat,
      role: params.role,
      workspacePath: params.workspacePath,
      branch: params.branch,
      baseSha: params.baseSha,
      candidateSha: params.candidateSha,
      pid: process.pid,
      createTime: Date.now(),
      acquiredAt: nowIso,
      heartbeatAt: nowIso,
      ttlSeconds: ttl,
      status: 'ACTIVE',
    };

    if (!fs.existsSync(params.workspacePath)) {
      fs.mkdirSync(params.workspacePath, { recursive: true });
    }

    fs.writeFileSync(leaseFile, JSON.stringify(lease, null, 2), 'utf8');
    return lease;
  }

  /**
   * Heartbeat to extend lease validity
   */
  public static heartbeat(workspacePath: string): WorktreeLease {
    const leaseFile = path.join(workspacePath, this.LEASE_FILENAME);
    if (!fs.existsSync(leaseFile)) {
      throw new Error(`No lease file found at ${workspacePath}`);
    }

    const lease: WorktreeLease = JSON.parse(fs.readFileSync(leaseFile, 'utf8'));
    if (lease.status !== 'ACTIVE') {
      throw new Error(`Cannot heartbeat non-active lease (status: ${lease.status})`);
    }

    lease.heartbeatAt = new Date().toISOString();
    fs.writeFileSync(leaseFile, JSON.stringify(lease, null, 2), 'utf8');
    return lease;
  }

  /**
   * Release lease gracefully
   */
  public static releaseLease(workspacePath: string): WorktreeLease | null {
    const leaseFile = path.join(workspacePath, this.LEASE_FILENAME);
    if (!fs.existsSync(leaseFile)) return null;

    try {
      const lease: WorktreeLease = JSON.parse(fs.readFileSync(leaseFile, 'utf8'));
      lease.status = 'RELEASED';
      lease.releasedAt = new Date().toISOString();
      fs.writeFileSync(leaseFile, JSON.stringify(lease, null, 2), 'utf8');
      return lease;
    } catch {
      return null;
    }
  }

  /**
   * Read current lease status
   */
  public static readLease(workspacePath: string): WorktreeLease | null {
    const leaseFile = path.join(workspacePath, this.LEASE_FILENAME);
    if (!fs.existsSync(leaseFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(leaseFile, 'utf8')) as WorktreeLease;
    } catch {
      return null;
    }
  }

  /**
   * Safe PID liveness check
   */
  public static isProcessAlive(pid: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      return code === 'EPERM'; // Process exists but lack permission
    }
  }
}
