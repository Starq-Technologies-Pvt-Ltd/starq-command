# Starq Command Development Resume Handover

Checkpoint date: 2026-10-28 (UTC). This is a development preservation checkpoint, not a production release or commissioning acceptance.

## Git and GitHub

- Private repository: `Starq-Technologies-Pvt-Ltd/starq-command`; GitHub reports organization ownership and my repository permission was `ADMIN`.
- PR #3 was merged normally at `2026-10-28T07:31:36Z`. Merge commit: `469897391cc84c5bbb702253c8b0550fcf551a00` (`main` and `origin/main`). It preserves the six individual convergence commits; no squash or admin bypass was used.
- Convergence head: `4622445a3797c2c36ab047a0e9fc312e835d338f` (`command-convergence-20261028`, local and remote). Permanent remote pre-merge ref: `backup/pre-merge/pr-3-command-convergence-20261028-4622445` at the same SHA.
- `main` was fetched and fast-forwarded locally. No Command working-tree changes existed before this handover document and test log.
- The accepted source history includes Nexus fidelity (`ad7e4de`), Messenger (`d18565b`), PM/workforce dispatch (`45953c7`), and lifecycle recovery (`ee0d5bc`, `4622445`), preceded by `e1a1831`.
- Command bundle captures all 16 repository refs (branches and remote refs); the repo has no tags. Nexus bundle captures all 105 refs, including tags, stash and worktree refs. The dirty Nexus checkout remains separate and was not integrated into Command.
- GitHub’s billing API returned only `usageItems` and no plan field. The Founder reports the Enterprise trial is expired and directs use of GitHub Free; no billing change was made. GitHub’s documentation says an expired Enterprise trial account is deleted 90 days after expiry if not converted, and trial-created organizations remain accessible in a downgraded state before deletion. Confirm the organization’s relationship to the Enterprise account during the next billing review. [Trial expiry](https://docs.github.com/en/enterprise-cloud/admin/overview/setting-up-a-trial-of-github-enterprise-cloud) · [Free plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)

## Verification

Commands and outcomes from the merged source:

- `npm test -- --no-file-parallelism --maxWorkers=1 --minWorkers=1 --reporter=dot` — **1,048 passed, 53 failed, 1,101 total; 14 of 51 test files failed**. Exact output is retained at `D:\STARQ_BACKUPS\STARQ_COMMAND_DEV_20261028T0734Z\verification\vitest-serial.log` (also included in the state archive). Do not suppress or reclassify these as passing. Failures span Phase 3/7 route and navigation expectations, read-only/write-capability scanning, real-tree mutation checks, project-board/PM projections, floor API, structural ownership, and provenance evidence.
- `npm run typecheck` — pass.
- `npm run build` — pass (TypeScript and Vite production build).
- `node --test scripts/lifecycle/tests/*.test.mjs` — 119 pass, 0 fail, 2 skipped.
- `npm run test:lifecycle` — fails on this Windows/Node 24 setup because the package script passes the directory `scripts/lifecycle/tests/` to `node --test`. Use the explicit glob above.
- `npx vitest run --no-file-parallelism --maxWorkers=1 --minWorkers=1 --reporter=dot tests/dispatch-integration.test.ts` — 5 pass. Covers exclusive lease, task identity through review/acceptance/closure, unavailable worker evidence, contention, delivery failure, worker failure and retry.

The dispatch loop is deterministically tested but has not been demonstrated with a live Herdr worker. The merged checkpoint is **not production-ready**.

## PM and recovered Nexus data

- `data/pm-operating.db` is the active PM store in the code configuration: 1,309 tasks, 18 projects, 1,316 status rows, 1,309 source records, 18 imports, and no execution rows/events at snapshot time.
- Legacy `pm-board.db`: 4 tasks, 3 projects, 37 status rows. `control-plane.db`: 0 tasks and 0 transitions. All six `.db` files passed `PRAGMA quick_check` and were copied with SQLite’s backup API into `sqlite-consistent/`; original `.db`, `-wal`, and `-shm` files are retained in the tree snapshot.
- Recovered Nexus `COPY-MANIFEST.json` reports 23,505 files / 1,698,108,813 bytes, all manifest hashes verified, zero issues at copy time. Current tree census is 23,509 files / 1,712,546,849 bytes. Four additional files are present beyond the manifest entries: `README.md`, `starqNexus/workspace-documents/_backups/devops-control-tasks.2026-09-26.bak.json`, and the two `snapshots-daily/2026-08-26*.json` files. The manifest itself is an additional fifth filesystem file and is not one of its own entries. The source and migration evidence are preserved in the D: state archive.

## Runtime, containment, and workforce

- Last official recovery attempt remains `STOP_INCOMPLETE` at `job-recovery`; the `.command-runtime/state.json` records `STOP_INCOMPLETE`. Current `command-lifecycle status` reports DEGRADED with saved old children GONE/EXITED, no service listeners, preflight STOPPED/idle cooldown. No Command services are running on 5173/5176/5177/5178/5179/5188. Preview ports 5181/5182/5190 and 4173 were also clear at checkpoint.
- Five historical job families remain `UNKNOWN`, with no authenticated `closed.json` for data `a591cbe1bf7419477e572095f8bb97bd`, Building `0bef096e0ff7ba4644b7f1bc2a47a5f2`, Herdr broker `03e418018d6abcd7d424a18a2fcc749e`, Herdr adapter `448cf3c97a34b1462081c64ebce43759`, and PM `340d8a765af84972ac5d206f93bc7c66`. The UI receipt is authenticated and closed. Missing root PIDs and clear ports do not prove descendant containment. No JobGuardian process is running. The verified binary is `D:\StarqTech\00_STARQ_HQ\operations\starq-lifecycle\native\JobGuardian.exe`, SHA-256 `5eb82b7ed4a0ac1caf03ba6b27f70071bfe599fe7088a046aeee073c0f0a3f58`.
- Founder decision is still pending: recover trusted original receipts for the exact five instances, or authorize a separately contained new generation while retaining those historical families as `UNKNOWN`. Room #15896 contains the A/B choice. Do not start Command or fabricate closure evidence.
- Standalone Herdr is pinned to 0.9.5 (`C:\Users\Ali Musthaq\.herdr\packages\standalone\releases\0.9.5-x86_64-pc-windows-msvc\herdr.exe`, SHA-256 `cd877c8744296f4a38a2703bf13cf11728973649ec54959959c4587ffe5368b2`). DEC-102 says OPERATOR_INTERACTIVE and `command_actuation: NONE`; Herdr was observed stopped/unavailable. The pinned binary is in the state archive and the readable `.herdr`/roaming profile is in `herdr-runtime-profile.tar.gz`. Windows ACLs denied reading 50 Herdr session snapshot/backup files; their exact paths/errors are in `herdr-runtime-profile.tar.skips.json`. The `.herdr\packages\standalone\current` reparse point was skipped; its pinned 0.9.5 target was archived.
- Live worker/seat readiness is not established while Herdr is unavailable. Workforce capability and dispatch code are present; deterministic dispatch tests pass, but no live worker allocation or pilot was completed.

## Existing Command capabilities and outstanding work

- PM data fidelity, restored SPOS-008 POS source row, source-record provenance, Room Messenger, Library, Cortex, workforce projections, and deterministic dispatch are present in the merged source. Runtime API and live service availability were not demonstrated at this checkpoint because Command and Herdr are stopped.
- Outstanding: reconcile the 53 full-suite failures without weakening criteria; resolve the historical containment disposition with the Founder; restore standalone Herdr through its operator-owned procedure; then restore Command through the supported lifecycle; verify live PM, Messenger, Library/Cortex and workforce APIs; run one low-risk READY task end-to-end with a live worker, lease, Room assignment/evidence, independent review, PM acceptance and lease release.

## Backup location and restore

Founder-selected destination: `D:\STARQ_BACKUPS\STARQ_COMMAND_DEV_20261028T0734Z` on a separate physical 2 TB NVMe disk. The Founder directed that this checkpoint remain unencrypted. D: is not BitLocker-protected. Keep the disk in Founder custody.

The checkpoint contains:

- `git/starq-command-final-allrefs.bundle` — all Command history and refs after this handover commit.
- `git/starqNexus-allrefs.bundle` — all Nexus refs, including the dirty checkout’s branch history.
- `starq-command-state.tar.gz` — Command repository working state, lifecycle/JobGuardian files, canonical Room and communications files, Nexus checkout and active linked worktrees (with their dirty/index state), and pinned Herdr binary. Regular files and directories from `node_modules` are included; 537 Windows reparse-point entries (junctions/symlinks) were not traversed. Reinstall dependencies from the included lockfiles when restoring.
- `herdr-runtime-profile.tar.gz` and `herdr-runtime-profile.tar.skips.json` — readable Herdr package/configuration and roaming state, plus the exact list of inaccessible session files and the skipped `current` reparse point.
- `sqlite-consistent/` — consistent SQLite backups of all six database files.
- `room-ledger-final.jsonl` — verbatim Room ledger captured after the final Room report.
- `verification/` — exact full-test output, all test/build/typecheck logs and exit codes.
- `SHA256SUMS.txt` and `backup-manifest.json` — file sizes and SHA-256 digests for the backup artifacts.

Verify before restore:

```powershell
$root='D:\STARQ_BACKUPS\STARQ_COMMAND_DEV_20261028T0734Z'; Get-Content (Join-Path $root 'SHA256SUMS.txt') | ForEach-Object { $expected,$relative = $_ -split '  ',2; $file=Join-Path $root $relative; if ((Get-FileHash $file -Algorithm SHA256).Hash -ne $expected) { throw "Hash mismatch: $relative" } }
git bundle verify D:\STARQ_BACKUPS\STARQ_COMMAND_DEV_20261028T0734Z\git\starq-command-final-allrefs.bundle
git bundle verify D:\STARQ_BACKUPS\STARQ_COMMAND_DEV_20261028T0734Z\git\starqNexus-allrefs.bundle
tar -tzf D:\STARQ_BACKUPS\STARQ_COMMAND_DEV_20261028T0734Z\starq-command-state.tar.gz > $null
tar -tzf D:\STARQ_BACKUPS\STARQ_COMMAND_DEV_20261028T0734Z\herdr-runtime-profile.tar.gz > $null
```

Restore Git history to a new path with `git clone <bundle-path> <checkout-path>`. Restore the state tar to D: with `tar -xzf <archive> -C D:\`; extract the Herdr profile archive to C: with `tar -xzf <archive> -C C:\`. The 50 files listed in the skip manifest are not present in the backup and require access through the owning Windows account/service. Restore SQLite snapshots only after preserving the destination DB directory and verifying each with `PRAGMA quick_check`.

## Cold-start sequence

1. Verify every listed file checksum and both Git bundles; extract the state archive and restore the SQLite snapshots.
2. Read `D:\StarqTech\AGENTS.md`, establish the Codex/worker identity and Room route, and refresh Room via `readRoomSnapshot()`.
3. Verify the Herdr 0.9.5 pin and status. Herdr is operator-owned; do not start/stop it from Command.
4. Inspect the five exact historical JobGuardian instance directories. Keep their disposition `UNKNOWN`. Do not copy receipts across instances. Obtain authentic receipts or the pending Founder incident disposition.
5. Run `node scripts/command-lifecycle.mjs status`. Use only the supported lifecycle recovery/start procedure once its gates are satisfied; verify ownership, listeners, API health and database bindings before enabling workers.
6. Verify workforce identity/session/pane bindings and actual readiness, then validate Command PM, Messenger, Library, Cortex and dispatch APIs.
7. Resume the single low-risk READY task pilot; capture Room assignment, worktree lease, execution/evidence, independent verification, acceptance, completion and lease release. Reconcile all records before claiming commissioning.

## Room records

Handover and backup status will be posted in Room after the final checks. Previous recovery report is #15896 and verification addendum #15897.

