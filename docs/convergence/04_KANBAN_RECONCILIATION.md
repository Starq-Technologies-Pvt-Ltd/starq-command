# Hermes Kanban reconciliation — `starq-command` board

**Source:** `hermes kanban --board starq-command list --json`, read 31 Oct 2026: 50 cards (35 done, 7 blocked, 6 todo, 2 triage, 0 running). Three archived cards were not re-read.
**Prepared by Claude for Vision.** Claude has **no authorized Kanban write identity**, so nothing below has been written to the board. Vision (or a specialist he designates) applies it under their own identity.

## Rules for applying this

1. **Nothing is deleted, and nothing unfinished is marked Done.** Superseded or deferred cards keep their status, body, runs and comments. Add one comment: `CONVERGENCE (Founder directive 2026-10-31): <disposition> — see docs/convergence/04_KANBAN_RECONCILIATION.md on claude/command-convergence; successor <CV-id>.` Archive only if Hermes archiving preserves comments (it did for t_774467ec, t_101a6e66, t_1232d204).
2. Every new `CV-*` card has **one accountable owner**, a deliverable, testable acceptance and an integration path (train). The bodies below are ready to paste.
3. Workers and reviewers stay separate. Each CV card names its reviewer.
4. Create worktrees with system Git (`C:\Program Files\Git\cmd\git.exe`). 6 of 7 blocked cards last failed on dispatcher or Git infrastructure, not engineering.

## A. Open cards — disposition

| Card | Status / owner | Disposition | Reason | Successor |
|---|---|---|---|---|
| t_a5659d52 Recover discarded PM candidate | blocked / architect | **Superseded** | Forensic recovery of lost bytes is no longer needed: the current schema already has phase/epic/milestone/sprint/depends_on/work-package columns. Close gaps forward instead. | CV-AG3 |
| t_ff13652b Complete PM persistence & WP contract | todo / backend | **Consolidated** | Same outcome as CV-AG3 (schema/API/UI gap diff + milestones). Backend specialist becomes **reviewer** of CV-AG3 migrations. | CV-AG3 |
| t_6325ed52 Persist M5 evidence lineage | blocked / frontend | **Split**: authority correctness → done in Claude candidate (CV-C2); full M5 lineage → **Deferred** (enterprise) | The actor-string approach is rejected (spoofable). The sound Room-authenticated model already exists. | CV-C2 (+ deferred) |
| t_f216bab0 Reversible historical import | blocked / history | **Deferred (enterprise)** | 1,344 historical records are already present and labelled HISTORICAL. Fail-closed containment stays. | — |
| t_98f066b6 Navigable development history | todo / frontend | **Deferred (enterprise)** | Depends on t_f216bab0. | — |
| t_362b1b84 Supported startup & recovery | blocked / runtime | **Superseded** | Root causes found: closeout receipt (fixed) and an unreliable OS TCP table (design in CV-C1b). command-runtime becomes **reviewer**. | CV-C1, CV-C1b, CV-C1c |
| t_fc2061f9 Workforce assignment & activity UI | blocked / ux | **Consolidated** | Same outcome as CV-CU4 + CV-AG2. command-ux becomes **reviewer** of CV-CU4. | CV-CU4, CV-AG2 |
| t_4a2f736d Org/workforce API integrity | blocked / data | **Consolidated** | Remaining scope (audit history, update paths) = CV-AG1. command-data reviews CV-AG1/AG2 migrations. | CV-AG1 |
| t_e551808d Daily-driver E2E baseline | blocked / qa | **Consolidated** | Into CV-V1 on Claude's harness. | CV-V1 |
| t_ff4a03d8 Automate daily-driver E2E | todo / qa | **Rescoped → CV-V1** | Journeys J1–J10 replace the old journey list (keeps evidence/review/acceptance as J5-neg + Room fixture). | CV-V1 |
| t_7bbc91d4 Board/WP readiness audit | todo / ux | **Superseded** | A read-only audit of old candidates is replaced by implementation (CV-CU3) plus E2E. | CV-CU3 |
| t_4a920190 Audit board/WP workflow | triage / ux | **Superseded** | Same as above. | CV-CU3 |
| t_055dd3ad Specialist sessions in Desktop | triage / integration | **Deferred** | Hermes Desktop tooling, not a Command runtime need (criterion 10). | — |
| t_4369465d Specialist activity surface | todo / integration | **Deferred** | Same. | — |
| t_69ff61c9 QA specialist activity surface | todo / vision | **Deferred** | Same. | — |

## B. Done cards — reused, but "Done" ≠ accepted

| Card(s) | Reused output | Note |
|---|---|---|
| t_7de3320e, t_5ce95bfd, t_ad544735, t_7bb72560, t_5dac6cc0 | Org schema/API hunk (in `2746c90`), workforce identity contract | Basis of CV-AG1/AG2 |
| t_cbb1954e, t_9e7dc66a, t_89e578ef, t_81e48af8 | Work-package contract, PM fidelity columns, board routes | Verified forward in CV-AG3/CU3, not reconstructed |
| t_3064484b + QA cards | Historical/live separation | Keep; J10 regression |
| t_1f0ac053, t_30978f14, t_731fdcdf, t_90a51048 | Lifecycle, status honesty, runbook | Basis of CV-C1 |
| t_2b323eb9, t_f1eab098, t_018789da | Test baseline work | Superseded in method by CV-C3 (location-independent suite) |
| t_11e49ff8, t_79aa8f50, t_8049d6a7, t_59ee39bc, t_aac44688 | Historical manifest, import safety | Kept for the deferred import |
| t_4ab41104 | Room delivery proof | Optional integration (digest delivery) |
| Others (WP-00x maps, QA reviews) | Evidence | No action |

## C. New convergence cards (paste-ready)

Format: **ID — title** · owner · reviewer · depends · train. Then Deliverable / Acceptance / Integration.

**CV-C1 — Integrate Claude reliability candidate (T1)** · Claude · command-qa + command-runtime · — · T1
Deliverable: branch `claude/command-convergence` commits (recovery, authority fix, ungated start, scratch mode, test isolation). Acceptance: all suites green on the integration branch from a clean worktree without `STARQ_WORKSPACE`; reviewers' notes. Integration: first merge into `convergence/local-os`.

**CV-C1b — Pipe-reported port ownership** · Claude · command-runtime · CV-C1 · T3
Deliverable: per `03_CLAUDE_PACKAGE.md`. Acceptance: J1 on the laptop + negative tests (foreign listener; wrong reported port). Integration: lifecycle companion version bump + Command.

**CV-C1c — `command-local/v1` profile, Start-Command launcher, backup on start** · Claude · command-runtime · CV-C1b · T3
Acceptance: J1, J9, J10.

**CV-C2b — Identity-optional write boundary** · Claude · command-architect · CV-AG0 · T3
Acceptance: writes succeed with `agent-comms` absent; Room-authenticated paths refuse.

**CV-C3b — Standalone fixture workspace + E2E harness** · Claude · command-qa · — · T3
Acceptance: harness starts and tears down an isolated instance; one smoke journey green.

**CV-AG0 — Local OS API contract** · Antigravity · command-architect · — · T2
**CV-AG1 — Organization completion + org audit** · Antigravity · command-data · AG0 · T4
**CV-AG2 — Unified workforce registry** · Antigravity · command-data · AG0, C2b · T4
**CV-AG3 — Projects, milestones, deliverables** · Antigravity · command-backend · AG0 · T4
**CV-AG4 — Operations automation (digest, stale, follow-ups)** · Antigravity · command-architect · AG0, AG3 · T4
**CV-AG5 — Projection dependency reduction** · Antigravity · command-qa · — · T4
(Deliverables and acceptance: `01_HANDOVER_ANTIGRAVITY.md`.)

**CV-CU1 — Founder Home** · Cursor · command-ux · AG0 · T5
**CV-CU2 — Organization management UI** · Cursor · command-ux · AG1 · T5
**CV-CU3 — Board & task detail (scroll, single move control, pickers, timeline, milestones)** · Cursor · command-frontend · AG0, AG3 · T5
**CV-CU4 — Workforce & person views** · Cursor · command-ux · AG2 · T5
**CV-CU5 — Persistence & interaction hardening** · Cursor · command-frontend · — · T5
(Deliverables and acceptance: `02_HANDOVER_CURSOR.md`.)

**CV-V0 — Integration branch `convergence/local-os` from 2746c90** · Vision · — · — · T0
**CV-V1 — Daily-driver E2E journeys J1–J10** · command-qa · Vision · C3b · T6
**CV-V2 — Merge train T1–T6 and Founder acceptance session** · Vision · Founder · all · T6
**CV-V3 — Hermes dispatcher Git path → system Git** · command-integration · Vision · — · infra
Deliverable: dispatcher uses `C:\Program Files\Git\cmd\git.exe`. Acceptance: one native run creates a worktree, executes and settles exactly once.

## D. Dependency map

```text
CV-V0 ─┬─► CV-C1 (T1) ─► CV-C1b ─► CV-C1c ─┐
       ├─► CV-AG0 (T2) ─┬─► AG1 ─► CU2       │
       │                ├─► AG2 ─► CU4       │
       │                ├─► AG3 ─► CU3, AG4 ─► CU1
       │                └─► C2b              │
       ├─► CV-C3b ─► CV-V1 ◄─────────────────┤
       └─► CU5, AG5 (independent)            │
                                   CV-V2 ◄───┘ (all trains)
```

## E. Open GitHub pull requests (added 31 Oct 2026, after the first version of this plan missed them)

Checked by a read-only test merge (`git merge-tree`) against both `main` and the snapshot branch. **All five carry work that is in neither**, so none is a duplicate to delete. They predate the convergence decision and must be brought into it.

| PR | Branch → base | Content | Disposition | Owner of the follow-up |
|---|---|---|---|---|
| #4 | `codex/pm-client-resilience-20261029` → `main` | `pm-client.ts` 5 s timeout, TIMEOUT state, capped GET retries (+206-line test) | **Keep.** Fold into CV-CU5. Rebase onto the convergence base; touches `pm-client.ts` below Claude's lines 1–40 | Cursor (CV-CU5), reviewer command-frontend |
| #5 | `pm-portfolio-convergence-20261028` → `main` | 19 files: repository status backend, ERP roadmap freshness, board/portfolio fixes, nexus-fidelity, **a JobGuardian empty-recovery change in `scripts/lifecycle/owner.mjs`** | **Keep, review before any merge.** Its recovery change overlaps CV-C1 (cross-boot closeout) and must be reconciled with it. Re-base onto the convergence base and re-target there, not `main` | Vision (split), command-runtime reviews the `owner.mjs` part with Claude |
| #6 | `deadpool/wsl-command-probe-20261030` → #5 | WSL-side health probe (2 files) | **Defer (archive).** The Founder's scope requires no WSL. Preserve as an archive tag plus bundle, then close | Vision / Founder |
| #7 | `ag/pm-task-artifacts-20261030` → #5 | Persists task repository artifacts (branch/commit/PR links) — useful for records. **Also tightens the start gate** to a ROOT_GENESIS Room record naming the task | **Split.** The gate hunk is superseded by Founder decision D2 (ungated start) and conflicts with `6acde9e`, so drop it. Keep the artifact persistence as part of CV-AG3 | Antigravity (CV-AG3), reviewer command-backend |
| #8 | `vision/pm-command-actions-20261030` → #5 | Daily action summary on the portfolio (2 files) | **Keep.** Input to the Founder Home (CV-CU1) | Vision → Cursor (CV-CU1) |
| #9 | `claude/command-convergence` → snapshot | Claude's T1 candidate + this plan | **Merged** into `review/command-working-snapshot-20261031` by the Founder's account on 31 Oct 2026 17:58 UTC (`2746c90` → `fb3cd4f`). Independent QA review of T1 is still required before anything reaches `main` | command-qa |

Note on the base: the snapshot branch now points at `fb3cd4f`, which includes Claude's T1 commits. New convergence branches should start from `fb3cd4f`. `2746c90` remains the pre-candidate reference point.

## F. GitHub cleanup applied (31 Oct 2026, at the Founder's direction)

The Founder wants open PRs and branches to show only active work. Nothing was lost; every unfinished line of work was preserved before removal.

**Archived, then removed** (9 branches with commits found nowhere else). Each is kept as a tag on GitHub and in a verified bundle at `D:\StarqTech\Archives\starq-command\branch-archive-20261031.bundle` (sha256 `6774b3b6e66b344e2bec2c0bcccf60d251a0ac3f6f36911f4843e147e51f56c4`):

| Tag | Commit | Was | Disposition (§E) |
|---|---|---|---|
| `archive/codex/pm-client-resilience-20261029` | d2c3ecf | PR #4 | Keep → CV-CU5 |
| `archive/pm-portfolio-convergence-20261028` | c3427aa | PR #5 | Keep, review; reconcile `owner.mjs` with CV-C1 |
| `archive/deadpool/wsl-command-probe-20261030` | a427743 | PR #6 | Deferred (no-WSL scope) |
| `archive/ag/pm-task-artifacts-20261030` | ccd2a6c | PR #7 | Split: artifacts → CV-AG3; drop the stricter start gate |
| `archive/vision/pm-command-actions-20261030` | f34a4aa | PR #8 | Keep → CV-CU1 |
| `archive/codex/erp-maturity-display-20261029` | 44e1e59 | branch, no PR | Review (ERP display; ERP is on hold under DEC-100) |
| `archive/codex/pm-provenance-accuracy-20261029` | 869f4aa | branch, no PR | Review with CV-AG3 |
| `archive/p0-reconcile-recovery-20261026` | d717d5c | branch, 13 commits | Review; pre-convergence recovery work |
| `archive/active-tree-baseline-20261026` | f2e05cf | branch, 1 commit | Review; pre-convergence baseline |

PRs #4–#8 were closed with a comment naming their tag and disposition.

**Removed with nothing to preserve** (already fully contained in `main`): `backup/pre-merge/pr-3-command-convergence-20261028-4622445`, `command-convergence-20261028`, `command-takeover-20261027`, `moc-pm-projection-recovery-20261026`.

**Remaining on GitHub:** `main` (the master copy the Founder's app is built from), `review/command-working-snapshot-20261031` (convergence base), `claude/command-convergence` (Claude's active work).

**To resume any archived line:** `git push origin refs/tags/archive/<name>:refs/heads/<name>`, then reopen its PR. Local worktrees for these branches on the laptop were not touched.

**Attribution note:** the repository's shared `.git/config` sets `user.name=Deadpool`, so commits made from this repository or its worktrees without an explicit author are labelled "Deadpool" regardless of who made them. Claude's commits `2664894`…`2ee3233` were made by Claude Code (on the Founder's behalf), not by Deadpool. Later Claude commits set the author explicitly. Fixing the shared config is Vision's call, because it affects every agent.
