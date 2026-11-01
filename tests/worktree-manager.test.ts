/**
 * Worktree Isolation & Non-Destructive Recovery Test Suite
 * Starq Command Architecture Doctrine Section 8 & Requirement 5B
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { WorktreeManager } from '../integrations/workspace/worktree-manager.ts';
import { LeaseService } from '../integrations/workspace/lease-service.ts';

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

describe('Worktree Manager Isolation & Safe Recovery', () => {
  let tempRepo: string;
  let baseCommitSha: string;

  beforeEach(async () => {
    tempRepo = path.join(os.tmpdir(), `starq-git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempRepo, { recursive: true });

    // Initialize temporary git repo
    await execGit(['init'], tempRepo);
    await execGit(['config', 'user.name', 'StarqTest'], tempRepo);
    await execGit(['config', 'user.email', 'test@starq.local'], tempRepo);

    fs.writeFileSync(path.join(tempRepo, 'README.md'), '# Starq Test Repo\n', 'utf8');
    await execGit(['add', 'README.md'], tempRepo);
    await execGit(['commit', '-m', 'Initial commit'], tempRepo);
    baseCommitSha = await execGit(['rev-parse', 'HEAD'], tempRepo);
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(tempRepo)) {
        fs.rmSync(tempRepo, { recursive: true, force: true });
      }
    } catch {}
  });

  it('provisions builder worktree with dedicated task branch and lease lock', async () => {
    const res = await WorktreeManager.provisionBuilderWorktree({
      repoPath: tempRepo,
      taskId: 'T-WORK-1',
      seat: 'codex',
      baseSha: baseCommitSha,
    });

    expect(fs.existsSync(res.workspacePath)).toBe(true);
    expect(res.branch).toBe('starq/task/T-WORK-1');
    expect(res.lease.status).toBe('ACTIVE');
    expect(res.lease.role).toBe('BUILDER');

    const leaseOnDisk = LeaseService.readLease(res.workspacePath);
    expect(leaseOnDisk?.taskId).toBe('T-WORK-1');
    expect(leaseOnDisk?.seat).toBe('codex');

    // Clean up
    const cleanup = await WorktreeManager.removeWorktreeSafe(tempRepo, res.workspacePath, 'T-WORK-1');
    expect(cleanup.cleaned).toBe(true);
  });

  it('provisions verifier worktree detached at candidateSha', async () => {
    // Create candidate commit
    fs.writeFileSync(path.join(tempRepo, 'feature.ts'), 'export const x = 1;\n', 'utf8');
    await execGit(['add', 'feature.ts'], tempRepo);
    await execGit(['commit', '-m', 'Candidate feature commit'], tempRepo);
    const candidateSha = await execGit(['rev-parse', 'HEAD'], tempRepo);

    const res = await WorktreeManager.provisionVerifierWorktree({
      repoPath: tempRepo,
      taskId: 'T-WORK-2',
      verifierSeat: 'vision',
      candidateSha,
    });

    expect(fs.existsSync(res.workspacePath)).toBe(true);
    expect(res.sha).toBe(candidateSha);
    expect(res.lease.role).toBe('VERIFIER');

    // Verify git HEAD in worktree is detached candidateSha
    const worktreeHead = await execGit(['rev-parse', 'HEAD'], res.workspacePath);
    expect(worktreeHead).toBe(candidateSha);

    // Clean up
    const cleanup = await WorktreeManager.removeWorktreeSafe(tempRepo, res.workspacePath, 'T-WORK-2');
    expect(cleanup.cleaned).toBe(true);
  });

  it('NON-DESTRUCTIVE RECOVERY: safely rescues uncommitted work before removing worktree', async () => {
    const res = await WorktreeManager.provisionBuilderWorktree({
      repoPath: tempRepo,
      taskId: 'T-DIRTY-1',
      seat: 'antigravity',
      baseSha: baseCommitSha,
    });

    // Make uncommitted changes in builder workspace
    fs.writeFileSync(path.join(res.workspacePath, 'uncommitted-draft.ts'), '// Important draft work\n', 'utf8');

    // Safe removal must detect uncommitted changes and save them to rescue ref!
    const cleanup = await WorktreeManager.removeWorktreeSafe(tempRepo, res.workspacePath, 'T-DIRTY-1');
    expect(cleanup.cleaned).toBe(true);
    expect(cleanup.savedRescueSha).toBeDefined();
    expect(cleanup.message).toMatch(/rescued to/i);

    // Verify rescue commit exists in repo
    const rescueLog = await execGit(['log', '-1', cleanup.savedRescueSha!], tempRepo);
    expect(rescueLog).toMatch(/rescue-recovery-T-DIRTY-1/i);
  });

  it('rejects a taskId that would escape the worktree parent', async () => {
    const parent = path.join(tempRepo, '.worktrees');
    const escaped = path.join(tempRepo, 'outside-builder');
    await expect(WorktreeManager.provisionBuilderWorktree({
      repoPath: tempRepo,
      taskId: '../outside',
      seat: 'codex',
      baseSha: baseCommitSha,
      worktreesDir: parent,
    })).rejects.toThrow(/taskId rejected/);
    await expect(WorktreeManager.provisionVerifierWorktree({
      repoPath: tempRepo,
      taskId: '..\\outside',
      verifierSeat: 'vision',
      candidateSha: baseCommitSha,
      worktreesDir: parent,
    })).rejects.toThrow(/taskId rejected/);
    expect(fs.existsSync(parent)).toBe(false);
    expect(fs.existsSync(escaped)).toBe(false);
    const branches = await execGit(['branch', '--list'], tempRepo);
    expect(branches).not.toMatch(/outside/);
  });

  it('rejects a dotted taskId at the lease boundary before writing a lease', () => {
    const workspace = path.join(tempRepo, 'leased');
    fs.mkdirSync(workspace);
    expect(() => LeaseService.acquireLease({
      taskId: '..',
      seat: 'codex',
      role: 'BUILDER',
      workspacePath: workspace,
      branch: 'starq/task/bad',
      baseSha: baseCommitSha,
    })).toThrow(/taskId rejected/);
    expect(fs.existsSync(path.join(workspace, '.worktree-lease'))).toBe(false);
  });

  it('rejects a taskId with ".." before a rescue ref is created', async () => {
    await expect(WorktreeManager.removeWorktreeSafe(tempRepo, path.join(tempRepo, 'missing'), 'a..b'))
      .rejects.toThrow(/taskId rejected/);
    const branches = await execGit(['branch', '--list'], tempRepo);
    expect(branches).not.toMatch(/rescue/);
  });
});
