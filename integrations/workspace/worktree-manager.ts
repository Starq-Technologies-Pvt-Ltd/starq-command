/**
 * Git Worktree Manager with Safe Non-Destructive Recovery
 * Starq Command Architecture Doctrine Section 8 & Requirement 5B
 */

import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { LeaseService } from './lease-service.ts';
import { type WorktreeLease } from '../../src/schemas/lease.ts';

export interface WorktreeProvisionResult {
  workspacePath: string;
  branch: string;
  sha: string;
  lease: WorktreeLease;
}

export interface WorktreeCleanupResult {
  cleaned: boolean;
  savedRescueSha?: string;
  message: string;
}

export class WorktreeManager {
  private static execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Git command failed [git ${args.join(' ')}]: ${stderr || error.message}`));
        } else {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        }
      });
    });
  }

  /**
   * Provision an isolated builder workspace on a new task branch from baseSha
   */
  public static async provisionBuilderWorktree(params: {
    repoPath: string;
    taskId: string;
    seat: string;
    baseSha: string;
    worktreesDir?: string;
    branchName?: string;
  }): Promise<WorktreeProvisionResult> {
    const parentDir = params.worktreesDir || path.join(params.repoPath, '.worktrees');
    const workspacePath = path.join(parentDir, `${params.taskId}-builder`);
    const branch = params.branchName || `starq/task/${params.taskId}`;

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Git worktree add -b <branch> <workspacePath> <baseSha>
    await this.execGit(['worktree', 'add', '-b', branch, workspacePath, params.baseSha], params.repoPath);

    // Acquire lease
    const lease = LeaseService.acquireLease({
      taskId: params.taskId,
      seat: params.seat,
      role: 'BUILDER',
      workspacePath,
      branch,
      baseSha: params.baseSha,
    });

    return {
      workspacePath,
      branch,
      sha: params.baseSha,
      lease,
    };
  }

  /**
   * Provision a clean, detached verifier workspace pinned to candidateSha
   */
  public static async provisionVerifierWorktree(params: {
    repoPath: string;
    taskId: string;
    verifierSeat: string;
    candidateSha: string;
    worktreesDir?: string;
  }): Promise<WorktreeProvisionResult> {
    const parentDir = params.worktreesDir || path.join(params.repoPath, '.worktrees');
    const workspacePath = path.join(parentDir, `${params.taskId}-verifier`);
    const branch = `detached-at-${params.candidateSha.slice(0, 8)}`;

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Git worktree add --detach <workspacePath> <candidateSha>
    await this.execGit(['worktree', 'add', '--detach', workspacePath, params.candidateSha], params.repoPath);

    // Acquire lease
    const lease = LeaseService.acquireLease({
      taskId: params.taskId,
      seat: params.verifierSeat,
      role: 'VERIFIER',
      workspacePath,
      branch,
      baseSha: params.candidateSha,
      candidateSha: params.candidateSha,
    });

    return {
      workspacePath,
      branch,
      sha: params.candidateSha,
      lease,
    };
  }

  /**
   * Safe non-destructive worktree removal.
   * If workspace has uncommitted changes, safe recovery commits or stashes them to a rescue ref
   * before removing the worktree.
   */
  public static async removeWorktreeSafe(
    repoPath: string,
    workspacePath: string,
    taskId?: string
  ): Promise<WorktreeCleanupResult> {
    if (!fs.existsSync(workspacePath)) {
      return { cleaned: true, message: 'Workspace does not exist' };
    }

    let savedRescueSha: string | undefined;

    try {
      // 1. Check for uncommitted work
      const { stdout: status } = await this.execGit(['status', '--porcelain'], workspacePath);
      if (status.length > 0) {
        // Workspace is dirty! Do NOT destroy uncommitted work.
        // Create rescue stash commit
        const timestamp = Date.now();
        const rescueMsg = `rescue-recovery-${taskId || 'unknown'}-${timestamp}`;
        try {
          await this.execGit(['add', '-A'], workspacePath);
          await this.execGit(['commit', '-m', rescueMsg, '--no-verify'], workspacePath);
          const { stdout: sha } = await this.execGit(['rev-parse', 'HEAD'], workspacePath);
          savedRescueSha = sha;
          // Create rescue branch so commit is reachable
          await this.execGit(['branch', `rescue/${taskId || 'uncommitted'}-${timestamp}`, sha], workspacePath);
        } catch {
          // Fallback: git stash create
          const { stdout: stashSha } = await this.execGit(['stash', 'create', rescueMsg], workspacePath);
          if (stashSha) {
            savedRescueSha = stashSha;
          }
        }
      }

      // 2. Remove git worktree
      await this.execGit(['worktree', 'remove', '--force', workspacePath], repoPath);

      // 3. Release lease
      LeaseService.releaseLease(workspacePath);

      return {
        cleaned: true,
        savedRescueSha,
        message: savedRescueSha
          ? `Worktree cleaned safely. Uncommitted work rescued to ${savedRescueSha}`
          : 'Worktree cleaned cleanly without uncommitted changes',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { cleaned: false, message: `Failed to remove worktree: ${msg}` };
    }
  }
}
