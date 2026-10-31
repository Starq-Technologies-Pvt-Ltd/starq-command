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
