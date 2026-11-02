# Starq Command — Local Operating System Convergence Plan

**Status:** Founder-directed (Founder directive "Final Convergence", 31 Oct 2026). Prepared by Claude Code, independent architecture & reliability. Vision remains Development Lead and final integrator.
**Base for all candidates:** `review/command-working-snapshot-20261031`, now @ `fb3cd4f` (the Founder merged Claude's PR #9 into it on 31 Oct 2026). `2746c90f538b7fdbe8fb374562964b956325223e` is the pre-candidate reference point. Its tree is byte-for-byte canonical's current working source (verified by blob compare; `.gitignore` differs only in line endings).
**Evidence:** `CLAUDE_INDEPENDENT_REVIEW_2026-10-31.md` (this folder). **Claude's T1 candidate:** `2746c90..4706b47` on `claude/command-convergence`.
**Companion documents (this folder):** `01_HANDOVER_ANTIGRAVITY.md` · `02_HANDOVER_CURSOR.md` · `03_CLAUDE_PACKAGE.md` · `04_KANBAN_RECONCILIATION.md` · `05_ROOM_BRIEFING.md` · `06_INTEGRATION_AND_ACCEPTANCE.md`

---

## 1. Scope decision (Founder)

Command becomes a **dependable internal operating system on the Founder's Windows laptop.** It is a *reduction in operating footprint*, not a rewrite. The enterprise foundations (gated lifecycle, Room-authenticated authority, provenance, historical import, Herdr/Hermes integration) stay in the codebase. They become **optional or deferred**, not deleted.

Decisions already taken by the Founder:

| # | Decision | Effect |
|---|---|---|
| D1 | Lean local operating scope | Ordinary management must work with **no** Hermes, Herdr, Room broker or WSL running. Integrations are optional capabilities. |
| D2 | **Ungate task start** in private single-Founder mode | Creating projects/tasks, assigning, starting work, updating progress and workforce records need no Room authorization receipt. They use normal local permissions plus durable audit records. |
| D3 | Keep strong safeguards for privileged and irreversible actions | Caller-supplied actor names and local evidence must never confer authenticated Founder or verifier authority (Claude's correction stays). |

Decisions still needed from the Founder are in §6.

## 2. Target architecture — "Local Operating Mode"

```text
 Start-Command (one action)  ─►  lifecycle profile command-local/v1
                                   │  recovery: kernel proof, else cross-boot proof (Claude)
                                   │  ownership: child reports its bound port over the
                                   │             MAC-authenticated control pipe (Claude)
      ┌────────────────────────────┼──────────────────────────────┐
  REQUIRED                     REQUIRED                       REQUIRED
  ui :5173 (built UI)          pm :5176 — SYSTEM OF RECORD    data :5177 — projections
  React app                    SQLite data/pm-operating.db    (degrades to UNAVAILABLE
                               org · workforce · projects ·    per source; never blocks
                               milestones · tasks · audit ·    PM)
                               automation digests
      └──────────────── OPTIONAL (start if present, never required) ───────────────┐
        building :5178 · herdrBroker/herdr :5188/:5179 · Room posting · Hermes Kanban ·
        StarqBot/Telegram delivery · WSL agents
```

Principles:

1. **PM is the system of record.** Everything the Founder manages day to day — org, workforce, projects, milestones, tasks, history, digests — lives in the PM SQLite database and its API. Projections (data, building) are read-only views; absent sources show UNAVAILABLE and never block PM.
2. **Authority tiers instead of one gate for everything.**
   - **T0 Ordinary** (create, assign, start, progress, block, workforce edits): actor is *claimed*, recorded with timestamp and channel in the audit log, no ceremony. This is D2.
   - **T1 Judgement** (verifier acceptance, Founder closure, irreversible operations): need an *authenticated* principal. Today that means a hash-verified Room record (sound, already implemented). A local, infrastructure-free alternative is proposed as decision **F1**.
   - **Never:** a caller-chosen name or a `LOCAL_LEDGER` record confers T1 authority. (Fixed and tested.)
3. **The workforce registry is `org_people`** (HUMAN | DIGITAL). Room's `identities.json` becomes an *optional enrichment* (Room handle, authority level), not a precondition for saving anything.
4. **One way to start, one way to recover.** A single launcher. The supervised lifecycle stays, but proves ownership through the channel it already authenticates instead of the unreliable OS connection table. Recovery after a reboot is automatic.
5. **Verification runs anywhere.** Tests resolve the workspace and never depend on the checkout path, line endings, env vars or live machine ports. E2E runs against an isolated scratch instance.

## 3. Capability plan

Legend: **Exists** = in source · **Works** = observed working on 31 Oct · **Gap** = unfinished · **Reuse** = keep unmodified · **Simplify/optional** · **Implement** · **Risk** · **Accept** = acceptance criteria · **Route** = shortest path · **Owner**.

### C1 — Launch, shutdown and recovery on Windows

- **Exists:** `Start-Starq.bat` → `starq-lifecycle/Start-Starq.ps1` → `scripts/command-lifecycle.mjs` (owner.mjs, about 55 KB). It has a JobGuardian containment, a MAC-authenticated control pipe (`control.mjs proveInstance`), health checks, rollback, a journal and status. Required components: data, building, herdrBroker, herdr, pm, ui.
- **Works:** status and inspection are honest. Rollback on failed start unwinds cleanly. The four core services start in about 8 s as plain node processes.
- **Gap:** (a) after any unclean shutdown, `start` is refused forever (closeout receipt never written). **Fixed in Claude's candidate.** (b) Port ownership is judged from the OS TCP table, which on this laptop reports wrong PIDs and states (verified against `Get-NetTCPConnection`). Supervised start fails at `herdr` and can never pass here. (c) herdr and herdrBroker are hard-required.
- **Reuse:** containment, control pipe, journal, rollback, status, health contracts.
- **Simplify/optional:** new profile `command-local/v1` with required {pm, data, ui} and optional {building, herdrBroker, herdr}. Herdr gates apply only when Herdr is enabled.
- **Implement:** pipe-reported bound address replaces netstat ownership. Add the local profile. Add `Start-Command.bat` (one click; idempotent; opens browser). Add backup-on-start (see C2).
- **Risk:** owner.mjs is safety-critical and was the object of six cards. It needs an independent runtime review (command-runtime) before integration.
- **Accept:** (1) cold start from a clean state → all required services HEALTHY, UI opens. (2) Copy of a pre-reboot STOP_INCOMPLETE state → `start` settles and starts, with no manual state edits. (3) Start with Herdr absent → READY (local profile), Herdr shown as optional or unavailable. (4) A foreign listener on :5176 → start refused (negative test kept). (5) `stop` → all required ports free, no orphan node processes.
- **Route:** WP-C1 (Claude), reviewed by command-runtime.

### C2 — Persistence, backup and data safety

- **Exists:** SQLite `data/pm-operating.db` (73 MB: 20 projects, 1,349 tasks, 1,356 log rows, org tables). There are idempotent schema migrations (`ensureGatedColumns`, `initOrgSchema`, fidelity columns), CAS via `expected_updated_at` (`STALE_EDIT`), `GET /api/pm/export`, and ad-hoc backups in `data/`.
- **Works:** writes persist and read back, and the CAS refusal works (observed). The scratch mode (`PM_DB_PATH`, :5190–5199) works and is now navigation-safe.
- **Gap:** backups are manual. There is no documented restore, and no integrity check on start.
- **Reuse:** all schema, CAS and export.
- **Implement:** on each start, run `PRAGMA integrity_check` plus `VACUUM INTO data/backups/pm-operating-<ts>.db` (keep N=14), and a documented `restore` command (stopped state only).
- **Accept:** close and reopen the app (and reboot Windows) → identical portfolio and task readback. A corrupt-copy test → start refuses with a clear message and names the latest good backup.
- **Route:** WP-C1 (Claude) adds backup and integrity; AG's migrations must stay idempotent (§4 rules).

### C3 — Organization structure

- **Exists:** `server/operating-org.mjs`: companies; units with kinds COMPANY/DIVISION/DEPARTMENT/TEAM and parent hierarchy; positions with job description and `reports_to`; people; appointments. API: `GET /api/pm/org` and POST for companies, units, positions, people, appointments. UI: `src/surfaces/org-operate.tsx` with create forms. Seeded: 1 company, 4 units, 3 positions, 4 people, 2 appointments.
- **Works:** create and read (t_7de3320e candidate hunk QA'd 23/23, now in the snapshot).
- **Gap:** **no update, rename, move, archive or end-appointment**, and no audit history for org changes (this is the open part of t_4a2f736d).
- **Reuse:** schema, validation, stable IDs, `readOrg`.
- **Implement:** PATCH for company, unit, position and person. End and reassign appointments. Soft archive (`archived_at`) instead of delete. An `org_audit` table recording every change with actor, channel, before/after and timestamp.
- **Accept:** create a department under a division, add a position reporting to another, appoint a person, move the department, end the appointment. Each step reads back after a service restart and appears in the org history.
- **Route:** WP-AG1 (AG, API) + WP-CU2 (Cursor, UI).

### C4 — Unified workforce (human employees and AI agent harnesses)

- **Exists:** `org_people.kind` ∈ {HUMAN, DIGITAL}. `identities.json` holds 24 agent identities with authority levels. Workforce UI (`factory.tsx`, `staff.tsx`) shows observed agents from Herdr/Room with UNKNOWN when absent. There are workforce identity contracts (t_5ce95bfd, t_ad544735).
- **Works:** read-only directory; honest UNKNOWN states.
- **Gap:** only 4 people are in the registry of record. The agents exist only in Room's file. There are no capability or harness fields, and no responsibilities view. PM writes fail entirely (503) if `identities.json` is unreadable.
- **Reuse:** the identity contract (distinct identity ≠ seat ≠ session ≠ person), the UNKNOWN discipline, the existing observed-activity adapters (optional).
- **Simplify/optional:** observed runtime presence (Herdr/Hermes sessions) becomes an *optional overlay*. The registry and assignments must work without it.
- **Implement:** `org_people` extensions: `harness` (e.g. claude-code, codex, cursor, antigravity, hermes-profile), `capabilities_json`, `status` (active/inactive), `source` (manual | identities.json@hash). An on-demand "import agent identities" action that creates DIGITAL people with provenance and never overwrites manual edits. Handle validation reads `org_people` first; `identities.json` is optional (Claude owns the fail-closed boundary, AG the registry).
- **Accept:** add a human employee and an AI agent (with harness and capabilities). Appoint both to positions and assign each a task. Remove `agent-comms` from a fixture workspace → assignments and edits still save. The Room-only authority paths fail closed.
- **Route:** WP-AG2 (AG) + WP-CU4 (Cursor) + WP-C2 (Claude, identity-optional boundary).

### C5 — Projects, milestones, tasks, dependencies, deliverables

- **Exists:** `pm_projects` (20) with create (POST) and portfolio, roadmaps from data files. `pm_tasks` has a rich schema: stage and status, owner, verifier, `depends_on`, phase/epic/sprint/**milestone (free text)**/release_track, work-package fields, evidence and provenance. Task create, read and PATCH work with CAS. Work-package contract (t_cbb1954e) and board UI (`pm-board.tsx`) exist.
- **Works:** board, task create and detail, status moves, dependency check on start, historical (Nexus) tasks ungated.
- **Gap:** no project update or archive. Milestones are a free-text label, with no dates, status or progress. "Deliverables" are not distinguishable from tasks. Whether all work-package fields are exposed in API and UI is unverified (t_ff13652b).
- **Reuse:** the task model, the gate engine, the work-package contract, `nexus-fidelity` columns.
- **Simplify/optional:** stop the forensic recovery of lost bytes (t_a5659d52). Diff the current schema and API against the needed fields instead.
- **Implement:** PATCH and archive for projects. A `pm_milestones` table (id, project_id, title, due_date, status, ordinal) with task linkage (`milestone_id`, keeping the legacy text) and computed progress. Deliverable = a work package flag or kind on the task (reuse the t_cbb1954e contract).
- **Accept:** create a project and two milestones with dates, create tasks under each with a dependency, complete them, and see milestone progress update. All of it survives a restart.
- **Route:** WP-AG3 (AG) + WP-CU3 (Cursor).

### C6 — Assignment, status and authority tiers

- **Exists:** `gated-lifecycle.mjs` with 9 stages projected onto 5 columns. Owner ≠ verifier (DEC-072). Room-authenticated attestation via `parseRoomRef` (hash, chain link, broker decision, ROOT_GENESIS). Historical rows are ungated.
- **Works:** gates, and the CAS and stale-edit refusal.
- **Gap:** start required a Founder Room record per task (**removed by D2; Claude's candidate**). The `LOCAL_LEDGER` back door made the actor dropdown equal to Founder authority (**fixed**). Acceptance and closure still need Room to be online (decision F1). The UI shows two parallel control sets (status and stage).
- **Reuse:** the whole gate engine and the Room authentication.
- **Implement:** D2 (done in candidate). Audit detail `start_authorization: NOT_REQUIRED_LOCAL_POLICY`. A single "move" control in the UI (Cursor). F1 local authenticated Founder presence (if approved).
- **Accept:** a LIVE task goes BACKLOG → READY → IN_PROGRESS → REVIEW → VERIFICATION with no Room record, and every move is in the audit log with actor and time. Picking "mustarq" in "Acting as" cannot satisfy acceptance or closure (regression tests).
- **Route:** WP-C2 (Claude) + WP-CU3 (Cursor UI).

### C7 — Activity, progress, blockers and accountability

- **Exists:** `GET /api/pm/attention` (ranked next actions: blocked → in progress → next, with deep links). Portfolio counts. `pm_status_log` per actor. The workforce activity surfaces (observed) are optional.
- **Works:** attention and portfolio APIs.
- **Gap:** no per-person view (owned, verifying, blocked, last activity), no "stale" detection, no "completed this week".
- **Implement:** `GET /api/pm/workforce/:id/summary` (AG). A stale and overdue classifier shared with automation (AG). UI on the Founder Home and person pages (Cursor).
- **Accept:** a blocked task appears on the Founder Home with owner and reason within one refresh. A person page lists that person's open work and last 10 actions read from the audit log.
- **Route:** WP-AG2/AG4 + WP-CU1/CU4.

### C8 — History, records and evidence

- **Exists:** `pm_status_log` (every change with actor), `evidence_refs`, Room links, Nexus history (1,344 imported records, ungated, labelled HISTORICAL), `historical-import.mjs` candidate (fail-closed containment), export.
- **Works:** status log and history labelling.
- **Gap:** no task timeline UI. The reversible historical-import capability (t_f216bab0) is unfinished and enterprise-grade.
- **Defer (not delete):** the reversible bulk historical import with rollback (t_f216bab0) and the navigable development-history board (t_98f066b6). The 1,344 historical records are already present and labelled.
- **Implement:** a task timeline (status log + evidence + comments) and an org history, both read from audit tables (Cursor UI, AG API). Local evidence remains a *record*, never an attestation.
- **Accept:** open any task → full ordered timeline with actor and time. Export reproduces it.
- **Route:** WP-CU3 + WP-AG1.

### C9 — Automation and operational summaries

- **Exists:** nothing scheduled server-side. Building blocks: `attention()`, the status log, the Room/Telegram (StarqBot) delivery paths (optional, external).
- **Implement (new, bounded):** `server/ops-automation.mjs` inside PM (in-process timer, idempotent, all output persisted in `pm_digests` and `pm_followups`):
  - **Daily digest** (on start and at a configurable hour): completed yesterday, started, blocked (with age), unassigned, overdue milestones, per-person load.
  - **Stale detector:** IN_PROGRESS with no event for N days → follow-up record.
  - **Follow-ups:** a task-scoped reminder list the Founder can acknowledge.
  - **Optional delivery:** if Room or StarqBot is available, post the digest (off by default). Delivery failure never affects the record.
- **Accept:** with the clock injected in tests, a task untouched for 3 days produces exactly one follow-up. Restarting doesn't duplicate digests. The digest appears on the Founder Home with no external services running.
- **Route:** WP-AG4 (AG) + WP-CU1 (Cursor display).

### C10 — Founder dashboard and navigation

- **Exists:** about 30 surfaces. The default landing page (`seven-need-overview`) is governance-oriented. The project board (Kanban) works. The task detail panel is clipped at 1400×900 with no scroll.
- **Gap:** no "what needs me today" home. Navigation is organized by governance domains rather than by daily work.
- **Reuse:** all surfaces stay reachable (enterprise views move under "System/Governance").
- **Implement:** Founder Home (attention, digest, blockers, in progress by person, recently completed, milestones at risk). Primary nav: Home · Organization · Workforce · Projects · Activity · Records. Task-detail scroll fix. A single status/stage control. Assignment pickers fed by the workforce registry.
- **Accept:** see `06_INTEGRATION_AND_ACCEPTANCE.md` §3 (journeys J1–J10, real browser, persisted readback).
- **Route:** WP-CU1…CU5 (Cursor).

### C11 — Optional integrations

| Integration | Current role | Local mode |
|---|---|---|
| Room (agent-comms) | Authenticated authority; message log; identities | Optional. Authenticated T1 path; identities enrichment. PM must save without it. |
| Herdr / herdrBroker | Agent floor, terminals | Optional components in `command-local/v1`. |
| Hermes Kanban | Engineering execution record | Stays the **engineering** board during convergence (Founder). Not a runtime dependency of Command. |
| StarqBot / Telegram | Notifications | Optional digest delivery. |
| WSL agents | Development workforce | Not required by Command. |
| building :5178 | Hoadha/ERP read-only rooms | Optional; UI shows UNAVAILABLE. |

### C12 — Verification and test isolation

- **Done in Claude's candidate:** workspace resolution via `@workspace` and `server/paths.mjs`. `.gitattributes` for byte-pinned board assets. Stale phase2 assertions. A hermetic `recoverForce` test. Navigation-safe scratch mode. Results: vitest 1,154/1,154 from an isolated worktree with no env vars.
- **Open:** 3 genuine `test:node` failures in canonical (`pm-live-progress.test.mjs`, legacy collision, relink). `lifecycle.observation.config.json` hard-codes the canonical absolute path. `STARQ_WORKSPACE` breaks 3 lifecycle tests by design (`findEnvOverrides`), so the documentation must say "don't set it".
- **Implement:** a standalone fixture workspace (no agent-comms, no Herdr) plus a real-browser E2E harness (Playwright, dev dependency; QA decides) against a scratch instance (Claude provides the harness; command-qa owns the journeys).

## 4. Work packages and parallelism

| WP | Owner | Deliverable | Depends on | Files (write) |
|---|---|---|---|---|
| **WP-C1** Local runtime & recovery | Claude | `command-local/v1`, pipe-reported ownership, `Start-Command.bat`, backup/integrity on start, cross-boot recovery (done) | — | `scripts/lifecycle/**`, `lifecycle.local.config.json`, launcher |
| **WP-C2** Authority tiers | Claude | Ungated start (done in candidate), LOCAL_LEDGER fix (done), identity-optional write boundary, F1 if approved | — | `server/gated-lifecycle.mjs`, small hunks in `server/pm-service.mjs` (authority functions only) |
| **WP-C3** Reproducible verification | Claude | Test isolation (done), scratch mode (done), standalone fixture workspace + E2E harness | — | `tests/support/**`, `vitest.config.ts`, `e2e/**` harness |
| **WP-AG0** API contract | AG (review: command-architect) | `docs/convergence/API_CONTRACT_LOCAL_OS.md`: routes, payloads, errors, migrations for AG1–AG4 | — | docs only |
| **WP-AG1** Organization completion | AG | Update/archive/end-appointment + `org_audit` | AG0 | `server/operating-org.mjs`, `server/pm-ops-routes.mjs` (new) |
| **WP-AG2** Unified workforce | AG | Registry extensions, identity import, person summary | AG0, C2 boundary | same + new module |
| **WP-AG3** Projects & milestones | AG | Project PATCH/archive, `pm_milestones`, deliverable kind | AG0 | new module + migrations |
| **WP-AG4** Operations automation | AG | `ops-automation.mjs`, digests, follow-ups | AG0, AG3 | new module |
| **WP-AG5** Projection dependency reduction | AG | data-service sources degrade without Room/Herdr; no PM dependency on projections | — | `server/data-service.mjs` (narrow) |
| **WP-CU1** Founder Home | Cursor | New landing page | AG0 (mock until AG4 lands) | `src/surfaces/home.tsx` (new), nav |
| **WP-CU2** Organization UI | Cursor | Edit/move/archive/appointments + history | AG0/AG1 | `src/surfaces/org-operate.tsx` |
| **WP-CU3** Board & task detail | Cursor | Scroll fix, single move control, pickers, timeline, milestones | AG0/AG3 | `src/surfaces/pm-board.tsx`, `pm-portfolio.tsx` |
| **WP-CU4** Workforce & person views | Cursor | Human/agent directory, person page | AG0/AG2 | `src/surfaces/staff.tsx`, new person page |
| **WP-CU5** Persistence UX hardening | Cursor | STALE_EDIT recovery, error/empty states, readback tests | — | `src/lib/pm-client.ts` (additions only, below Claude's hunk) |
| **WP-V0** Integration base | Vision | Branch `convergence/local-os` from `2746c90` | — | git only |
| **WP-V1** Daily-driver E2E | command-qa | Journeys J1–J10 on the C3 harness | C3 | `e2e/journeys/**` |
| **WP-V2** Independent reviews | command-qa, command-runtime, command-architect | Review every candidate before merge | candidates | — |
| **WP-V3** Integration train & Founder acceptance | Vision | Merge in order, run E2E, Founder session | all | integration branch |

**Parallel now:** C1, C2, C3, AG0, CU5, V0 (no shared files). **After AG0 is reviewed (target: day 2):** AG1–AG5 and CU1–CU4 in parallel. Cursor builds against the contract with typed mocks, then switches to live.

**Conflict rules (binding for convergence):**
1. `server/pm-service.mjs` is the hot file. AG adds routes **only** in a new `server/pm-ops-routes.mjs`, registered by one dispatch line in pm-service. Claude touches only the authority and identity functions. Nobody else edits pm-service.
2. `src/lib/pm-client.ts`: Claude owns lines 1–40 (port and scratch). Cursor appends typed calls at the end. AG publishes types in the contract and does not edit the client.
3. Migrations must be additive and idempotent (`ALTER … ADD COLUMN` guarded, `CREATE TABLE IF NOT EXISTS`), tested on a copy of the live DB taken with `VACUUM INTO` (read-only).
4. No candidate writes to the live DB, Room, or the canonical checkout. Scratch instances only (`PM_DB_PATH`, port 5190–5199).
5. Every candidate is a branch on top of `2746c90` with commits, test output, and a short integration note.

## 5. Plan of record — the shortest route

| Day | Milestone | Exit evidence |
|---|---|---|
| 0–1 | V0 integration branch. Claude candidate (C1 recovery, C2 D2 + LOCAL_LEDGER, C3 isolation) reviewed and merged first. | QA review note; full suites green on the integration branch from a clean worktree |
| 1–2 | AG0 contract reviewed. C1 pipe ownership + local profile. CU5 started. | Contract signed off by command-architect; `start` works with Herdr off |
| 2–6 | AG1–AG4, CU1–CU4 in parallel. C3 E2E harness ready. | Per-WP candidates with tests |
| 6–8 | Integration train (Claude → AG → Cursor). E2E J1–J10 on the integration branch. | E2E report with persisted readback; reboot test |
| 8–9 | Founder acceptance session on the laptop. | Founder walks J1–J10. Defects become cards. |

## 6. Decisions still needed from the Founder

| # | Question | Recommendation |
|---|---|---|
| **F1** | How should **acceptance and closure** work when Room is offline? Today they need a Room-authenticated record, so a task cannot reach Done without Room. | Add **Founder presence via Windows Hello (WebAuthn passkey)** in the browser, verified by the PM service. It is genuinely authenticated (human presence plus PIN or biometric) and needs no infrastructure. A headless agent running as the same Windows user cannot produce it. Keep Room records as an equal alternative. Until approved, closure keeps needing Room. |
| **F2** | Should verifier attestation by an **agent** in local mode accept a Room record only (status quo)? | Yes for agents. The Founder's F1 presence may stand in for any verifier. |
| **F3** | Approve **Playwright** as a dev dependency for real-browser E2E? | Yes. The jsdom tests don't exercise real navigation, which is where the scratch-mode defect hid. |

## 7. Explicitly deferred (kept, not deleted)

Reversible bulk historical import with rollback (t_f216bab0) · navigable development-history board (t_98f066b6) · full M5 evidence-lineage enterprise flow (t_6325ed52, beyond the authority fixes) · Hermes Desktop specialist sessions (t_055dd3ad, t_4369465d, t_69ff61c9) · release-tier lifecycle gates · Room-posting mode as the default. Each card keeps its comments and evidence and gets a `DEFERRED (local OS convergence)` comment linking here (see `04_KANBAN_RECONCILIATION.md`).

## 8. Known risks

- **Execution reliability:** 6 of the 7 blocked cards last failed on infrastructure, not on engineering: "not inside a git repo" from the bundled Hermes Git (t_6325ed52, t_362b1b84); "gateway disconnected; turn outcome unknown" (t_a5659d52, t_4a2f736d, t_e551808d); "Kanban execution unknown" (t_fc2061f9). Until the Hermes Git path uses `C:\Program Files\Git\cmd\git.exe`, run assignments as recorded manual sessions on worktrees created with system Git.
- **Hot-file collisions** in `pm-service.mjs` and `pm-client.ts` (mitigated by the rules in §4).
- **Migration on a 73 MB live DB:** test on a `VACUUM INTO` copy first. Backup-on-start (C2) lands before AG migrations.
- **Scope creep back into governance:** every new card must name which Founder criterion (1–10) it serves.
