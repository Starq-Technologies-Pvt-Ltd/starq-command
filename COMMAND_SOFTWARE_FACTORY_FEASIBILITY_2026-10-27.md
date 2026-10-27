# Starq Command — Software Factory & Company OS Feasibility Assessment

**Date:** 27 October 2026
**Subject application:** `D:\StarqTech\00_STARQ_HQ\operations\starq-command`
**Evidence basis:** repository source at working-tree state (branch `main`, HEAD `95c3903`, 16 modified + 5 untracked files), the six live loopback services, the live UI at `http://127.0.0.1:5173`, stored test evidence under `evidence/`, and `TAKEOVER_RECONCILIATION_2026-10-27.md`.
**Scope:** investigation and architecture planning only. No implementation was performed. No service was started, stopped or mutated. `vitest` was deliberately **not** run (`tests/real-tree-capability-mutation.test.ts` writes mutants into real `src/`, and `tests/control-plane-*.test.ts` touch the live `data/control-plane.db`, which is currently open by the running service on :5179).

---

## A. Executive verdict

**YES — WITH SIGNIFICANT CHANGES.**

The current Starq Command can become the intended Software Factory and Company Operating System. It should be evolved, not replaced. That verdict rests on two findings that pull in opposite directions, and both are evidenced below.

**Why YES.** Command already contains the parts that are normally the *hardest* and most expensive to build, and they are built to an unusually high standard of epistemic discipline:

- A hash-chained, append-only organisational event ledger with identity leases, authority policy and reviewer-separation enforcement — 15,853 events, 37.5 MB (`agent-comms/room.jsonl`, `agent-comms/protocol/v1/`).
- A **working builder/verifier lifecycle with anti-self-acceptance**: an 11-state machine, typed builder and verifier artifacts, a verifier guard, worktree leases and non-destructive worktree recovery (`integrations/control-plane/`, `integrations/workspace/`). It is live right now on :5179 and answers `GET /api/command/tasks` with `200 {ok:true,count:0}`.
- A writable, append-only, optimistically-concurrent PM store with Room-attested gating (`server/pm-service.mjs`, SQLite, immutability triggers).
- A genuinely configurable company model: 7 floors, 41 seats, 14 rooms, Seat / Occupant / Acting-Capacity / Delegation kept as four distinct objects (`server/company-os.mjs`, 25 KB, registry-driven).
- 22,643 lines of production React across 27 surfaces with a disciplined honesty-state model (OK / STALE / DRIFT / UNAVAILABLE / UNREADABLE) that is enforced by tests, not convention.
- A real process supervisor with pinned ports, dependency ordering, health contracts and containment (`lifecycle.config.json`, `scripts/lifecycle/`).

A team starting fresh would need the better part of a year to reach that substrate. It exists and it runs.

**Why SIGNIFICANT CHANGES.** Command is not one application. It is **three disjoint systems sharing a UI shell**, and they share no identifier space:

| System | Process | Store | Can write? | Knows about the others? |
|---|---|---|---|---|
| **A — Projection stack** | data :5177, building :5178 | canonical files (read-only) | **No, structurally.** `server/data-service.mjs:913` returns `405` to every non-GET | reads everything, writes nothing |
| **B — PM board** | pm :5176 | `data/pm-board.db` → `pm-operating.db` | Yes | *forbidden* from touching A or C by its own header contract |
| **C — Agent control plane** | herdr :5179 | `data/control-plane.db` | Yes | not reachable from any UI surface |

`server/pm-service.mjs:1-24` states the boundary explicitly: *"This is NOT agent orchestration. It never touches Herdr, B1, ConPTY or the Herdr TaskStore (control-plane.db)."* And `README.md` records the projection doctrine: *"Phase 6 Controlled actions — no control plane, no writes, by design."*

So a task created on the PM board **cannot become** a task the control plane executes, and a task the control plane accepts **cannot close** a PM card. The factory conveyor is cut in exactly the place where the factory happens. Closing that cut is the core of the remaining work — and it is a *Founder authority decision* before it is an engineering one, because the separation was deliberately authorised (#9493/#9494/#9497), not accidental.

**One finding needs a decision before anything else.** The uncommitted working-tree change to `server/pm-service.mjs` (+614 lines changed) **deletes the gated software-production lifecycle that already exists**. The committed and currently-running service implements:

`BACKLOG → READY → IN_PROGRESS → REVIEW → VERIFICATION → ACCEPTANCE → CLOSED`, plus `BLOCKED` and `FOUNDER_GATE`, with server-enforced rules: an owner is required before `REVIEW`; `VERIFICATION` requires a verifier who is **not** the owner; `ACCEPTANCE` requires a linked Room record *sent by the assigned verifier, after the task entered VERIFICATION* (`VERIFIER_ATTESTATION_REQUIRED`); `CLOSED` requires an authenticated ROOT_GENESIS (Founder) Room record (`FOUNDER_CLOSURE_REQUIRED`); and owner/verifier are locked once in verification (`ASSIGNMENT_LOCKED`).

The working tree replaces all of that with a five-column Nexus kanban whose own header reads *"any column to any column; no review/accept/gate lifecycle"* (`server/nexus-kanban.mjs`, `server/pm-service.mjs:17-18`). This is the single most valuable existing asset for the Software Factory target, and it is being removed in uncommitted work. If Nexus parity is what the Founder wants for day-to-day use, that is legitimate — but the gated lifecycle should be preserved as the factory path, not deleted.

---

## B. Current capability matrix

Classification key: **Functional** (implemented, running, observed working) · **Partial** (real implementation, material gaps) · **Unverified** (implemented, never exercised or not provable here) · **Missing** (no implementation) · **Blocked** (architecture prevents it as built).

### A. Software Factory pipeline

| Pipeline stage | Status | Evidence |
|---|---|---|
| Project intake | **Partial** | `POST /api/pm/projects` creates projects. No intake form, no classification, no ownership model beyond `prefix`. |
| Requirements | **Missing** | No requirement entity anywhere. `src/schemas/task-contract.ts` has an `objective` string; that is the whole of it. |
| Specifications | **Missing** | No spec entity, no spec→task derivation. |
| Planning / roadmaps | **Partial, read-only** | Hoadha roadmap is *read* from `03_PROJECTS/hoadha/.../roadmap.machine.json`. Command cannot author a roadmap. Milestones exist only in PR #1's unmerged schema. |
| Work packages | **Blocked as named** | `/api/work-packages` is **not** a work-package system. Live probe returns Room messages re-shaped as assignment records with `current_stage: null, owner: null, verifier: null`. It is a Room read-model (`server/room-work.mjs:1` — *"read adapters over canonical Room; no writer"*). |
| Workforce assignment | **Partial** | PM tasks carry `owner`/`verifier` handles. The control plane carries `builderSeat`/`verifierSeat`. Nothing **assigns**: there is no allocator. Live seven-need overview: *"21 assignment row(s) projected · **0 row(s) declare current_assignment**"*. |
| Implementation by connected agents | **Blocked** | **No dispatcher exists.** `ALLOCATED` is a state the machine can reach, but nothing transitions a task into it, provisions a worktree, or delivers an assignment to a seat. `WorktreeManager` and `LeaseService` are imported only by `tests/`. The Herdr client is explicitly bounded to start/stop/restart named agents — *"NO arbitrary shell, exec, pane command, send-text"* (`integrations/herdr/herdr-client.mjs:26-31`). There is no mechanism to hand a task to an agent. |
| Testing | **Partial** | `BuilderArtifact` requires test evidence and a `candidateSha`; `VerifierGuard` validates it. Command neither runs tests nor reads CI. |
| Independent review | **Functional (API), Unverified (use)** | `POST /api/command/tasks/:id/verify` with `VerifierGuard.canAcceptTask`; reviewer separation also enforced in `agent-comms/protocol/v1/reviewer-separation.mjs`. Zero tasks have ever passed through it (`count: 0`). |
| Rework | **Partial** | `REJECTED → QUEUED/ALLOCATED` exists in the state machine. No rework-task generation from findings. |
| Integration | **Missing** | No branch/PR/merge model. `grep -rliE "github\|pull.request"` across `server/ src/ integrations/` matches two files: `staff-profile.mjs` (unrelated) and `worktree-manager.ts` (local git only). Command does not know what a pull request is. |
| Acceptance | **Functional, at risk** | The strongest asset in the repo — and the thing the uncommitted diff deletes (see A above). |
| Delivery | **Missing** | README: *"Release and deployment state. No canonical release artefact exists."* |

### B. Project portfolio and execution management

| Requirement | Status | Evidence |
|---|---|---|
| Multiple products/projects | **Functional** | 3 projects live (`command`, `erp`, `hoadha`). |
| Project creation / ownership / classification | **Partial** | Creation yes; ownership and classification no. Building classification (`OCCUPIED`/`PREPARED`/`FRAMEWORK_ONLY`) is read from files, not editable. |
| Roadmaps, milestones, deliverables | **Partial** | Read-only roadmap projection; milestones unmerged; no deliverable entity. |
| Project-specific Kanban | **Functional** | `#studio/erp/Tasks` renders a 5-column board with an "Acting as" identity picker and `New card`. |
| Activities / tasks / subtasks / work packages | **Partial** | One flat task table. **No subtasks, no hierarchy, no work-package entity.** `grep -i subtask src/` → zero matches. |
| Priorities | **Functional** | `P0`–`P3`, CHECK-constrained. |
| Dependencies | **Partial** | `pm_tasks.depends_on` is a JSON array column. No referential integrity, no cycle detection, no blocking semantics. |
| Blockers | **Functional** | `BLOCKED` status + `prior_status` restore + mandatory note. |
| Progress measurement / critical path | **Missing** | No schedule model, therefore no critical path. "Critical path" appears in prose only. |
| Review / verification / acceptance | **Functional (committed), deleted in working tree** | See A. |
| History and evidence-based completion | **Functional** | `pm_status_log` is append-only and immutable by SQLite trigger; tasks cannot be deleted. |

**Live defect, visible now.** The Overview reports *"Starq Command — 4 cards · To do 0 · Next 0 · In progress 0 · Blocked 0 · Done 0"*. The four cards are real and `CLOSED`, but the UI is the working tree (5 columns) while the running service is the committed build (9 statuses), so `CLOSED` maps to no column. The stack is currently running **two incompatible versions of its own PM contract**. `GET /api/pm/org` returns `404 NOT_FOUND` for the same reason, and the UI shows *"PM attention unavailable. REJECTED: No such route."*

### C. Workforce management and dispatcher

| Requirement | Status | Evidence |
|---|---|---|
| Workforce roster | **Functional** | 21 identities projected from `identities.json` + `staff-state.json`; rich `RosterEntry` contract with confidence and provenance per field. |
| Positions / roles / reporting lines | **Partial, uncommitted** | `server/operating-org.mjs` (225 lines, **untracked**) adds `org_companies/units/positions/people/appointments` with `reports_to_position_id` and HUMAN/DIGITAL kinds. Not in the running service. The committed path has seats and floors but no reporting graph. |
| Agent Desk / worker profiles | **Functional** | `server/staff-profile.mjs`, `src/surfaces/staff.tsx` (62 KB). |
| Live worker/session visibility | **Partial** | Broker is live and reports panes with real terminal ids and cwd — but `label: null`, `broker_owned: false`, and Herdr itself reports *"read-only status; Herdr actuation is not reachable from this broker"*. Pane ≠ seat: the binding from a live process to a canonical identity is not established. |
| Capabilities and availability | **Partial** | Declared in `src/schemas/seat-registry.ts` (10 seats, `canBuild`/`canVerify`/`capabilities`). Availability is not observed. |
| Assignment and workload tracking | **Missing** | No assignment entity; 0 rows declare `current_assignment`. |
| **Dispatcher / task routing** | **Missing** | No allocator, no queue consumer, no routing policy. This is the single largest missing component. |
| Execution status and recovery | **Partial** | `src/detector/stuck-detector.ts` + `GET /api/command/stuck` + escalation to Room exist; `WorktreeManager.cleanup` does non-destructive rescue. Never exercised against a live task. |
| Provider / model / quota visibility | **Unverified by design** | `GET /api/command/capacity` returns every seat as `quotaStatus: UNKNOWN, telemetrySource: UNKNOWN`. `src/capacity/quota-tracker.ts:29-56` documents this deliberately: *"this method has observed nothing… nothing in the package ever called `updateSeatStatus` or `updateTelemetry`."* The honesty is exemplary; the capability is absent. |
| Worker history / performance | **Partial** | Lifetime event counts and activity freshness are projected. No performance model. |

### D. Founder Tower

**Partial — and the best-developed surface in the application.** The seven-need Overview delivers portfolio, production activity (351 events), workforce, delivery progress, evidence, and declared attention (3 decisions / 4 blockers), each chip carrying its own origin, honesty state and as-of timestamp. `src/surfaces/attention.tsx` is 68 KB.

What it cannot show, per README's own deferrals: pending **reviews** (no review queue exists), delivery readiness (no release artefact), resource utilisation (no telemetry), critical-path work (no schedule), and decision *age* (no canonical open-decision timestamp, and React-side age arithmetic is explicitly forbidden).

### E. Cortex Graph

**Missing.** `grep -ri cortex src/` → zero matches. No graph store, no edge model, no visualisation.

The underlying relations are real but scattered across four stores with **no shared identifier**: Room event ids and record hashes; `pm_tasks.id` / `evidence_refs` / `room_authorization_ref`; control-plane `taskId` / `candidateSha` / `branch`; and company-registry seat ids. Nothing joins a PM task to a control-plane task to a commit to a Room event. A graph is feasible — the evidence chain already exists in the data — but it requires an indexer and a canonical entity-id scheme that do not exist today.

### F. Communications

**Partial, read-only.** Room itself is excellent: hash-chained envelopes, epoch anchoring, identity leases, authority routing, structured metadata, project classification.

Command's side of it is read-only and has **no messaging UI at all**. There is no composer, no channel list, no DM, no thread view, no message search. `erp-room.tsx` / `hoadha-room.tsx` are *project rooms* (dashboards), not conversations. The only write path from Command to Room — PM event sync — is:

1. **disabled in production** (`lifecycle.config.json` pins `room_post: OFF`), and
2. **broken as written**: `postToRoom()` (`server/pm-service.mjs:718`) invokes `send.mjs --room --body …` with no `--subject`, `--task` or `--action`. `room-structured-metadata.mjs:36` throws *"Structured Room metadata requires --subject"*. Every post would fail. Because the feature is off, this has never surfaced.

### G. Library and Vault

**Partial, and weaker than it appears.** `src/surfaces/evidence.tsx` reports **source readability only** — live: *"checked 6 · missing 0 · drifted 0"*. It is a provenance monitor, not a library. `/api/raw` streams a whitelisted canonical file under an 8 MB cap (README notes the 17 MB ledger already exceeded it; it is now 37.5 MB).

Missing entirely: a document store, upload, full-text search, version history, document↔project/task/worker linkage, contracts and statutory records, approvals. The corporate library exists on disk (`corporate-library/STARQ_CANONICAL_CORPORATE_LIBRARY_2026-10-03/`) but Command does not index it.

### H. Calendar Map

**Missing.** `grep -ri calendar src/` → zero matches. There is no date model, no milestone dates, no deadlines. README records the blocking precondition: *"A day boundary or timezone convention. No daily digest is possible until one is declared."* Every timestamp in the system is an event time, never a planned time. This capability has no foundation to build on.

### I. Companies and organisational management

**Partial — strong read model, writable model uncommitted.**

Functional today: company profile, 7 floors, 14 rooms (11 active / 3 dormant), 41 seats, 17 portfolio entries, Founder acting-capacity, and the four-object separation that prevents a seat from manufacturing authority (`server/company-os.mjs`). Structure is registry-driven, so **a different company structure needs no source change** — this part of requirement I is already satisfied architecturally.

Not functional: departments/divisions/teams as first-class records, appointments, delegated authority and statutory/compliance records exist **only** in the untracked `server/operating-org.mjs` + `src/surfaces/org-operate.tsx` (516 lines) written today and not yet in the running service.

### J. Contexts, settings, integrations

| Requirement | Status |
|---|---|
| HQ / Studio contexts | **Partial** — Company and Dev Studio surfaces exist; they are views, not switchable contexts |
| Personal context | **Missing** |
| Organisation/project configuration UI | **Missing** — all configuration is hand-edited JSON |
| Workforce/provider configuration | **Missing** — the seat registry is source code (`src/schemas/seat-registry.ts`) |
| Git repository integration | **Missing** — local worktrees only; no remote, no PR, no CI |
| Service and runtime settings | **Functional (file)** — `lifecycle.config.json` is the single source of runtime truth and explicitly **rejects** env overrides |
| User preferences / access boundaries | **Blocked** — see below |

**There is no authentication and no user model.** README limitation 1: *"No authentication on `/api/*`. Any local process or browser page on this machine can read the declared surface without proving who it is."* `pm-service.mjs:19-23` is blunter: *"identity here is the Room's identity. Anyone who can post to the Room as a handle can produce that handle's evidence. The `actor` field is attribution only."* The board's "Acting as" dropdown is self-declared. For a **Software Factory** this is survivable; for a **Company Operating System** with delegated authority, approvals and statutory records, it is the hard blocker. It is recorded as a Founder decision, not a defect.

---

## C. Existing assets worth keeping

Ranked by what they would cost to rebuild:

1. **The Room ledger and protocol** (`agent-comms/`) — hash chain, epochs, identity leases, authority policy, reviewer separation, structured metadata. 15,853 events of real organisational history.
2. **The verifier/acceptance machinery** — 11-state machine, builder/verifier artifacts, `VerifierGuard` anti-self-acceptance, *and* the committed PM gate chain requiring verifier-sent and Founder-sent Room attestations. Independent review with cryptographic evidence is the defining feature of a software factory, and Command has it twice over.
3. **The honesty-state discipline** — OK/STALE/DRIFT/UNAVAILABLE/UNREADABLE declared above every value, enforced by `tests/architecture.test.ts` and the census guard. This is why the system is trustworthy enough to automate on. Observed live: with the data service timing out, the UI showed last-known data under a *"NOT current"* banner instead of blanking or inventing.
4. **The Company OS registry model** — four distinct objects, registry-driven, 7 floors / 41 seats, authority claims refused and reported rather than honoured.
5. **The lifecycle supervisor** — pinned ports, dependency order, health contracts, fail-closed start, JobGuardian containment, 42 passing offline tests.
6. **The UI shell** — 27 surfaces, 22.6 k LOC, hash routing, scroll restoration, accessible rail, ownership matrix for persistent facts. `tsc --noEmit` over `src/` is clean.
7. **The PM store's integrity engineering** — WAL + `synchronous=FULL`, optimistic concurrency via `expected_updated_at`, append-only history triggers, delete-refusing triggers, loopback + Host + Origin + custom-header defence, 64 KB body cap, migration path with source-record versioning.

---

## D. Architectural gaps

1. **Three stores, no shared identity (the conveyor cut).** PM, control plane and projection stack cannot reference each other's records. Everything else in this list is downstream of this.
2. **The read-only doctrine is load-bearing.** `data-service.mjs` refuses writes structurally, and `tests/read-only-capability.test.ts` plus `real-tree-capability-mutation.test.ts` actively police that guarantee. Writes were therefore added as *separate origins* (:5176, :5178, :5179), which is why the system fragmented. A unified platform needs one authority boundary, decided deliberately — not a fourth origin.
3. **No dispatcher.** The gap between "a task exists" and "an agent is working on it" is unbridged. Herdr is bounded to lifecycle verbs by design; nothing may send a task to a seat.
4. **Declaration is not observation, and nothing closes the loop.** The codebase is scrupulous about marking unobserved facts UNKNOWN — and then never observes them. No telemetry writer, no heartbeat, no pane↔seat binding.
5. **No planning dimension.** No requirement, spec, milestone, date or schedule entity. Roadmap, calendar, critical path and delivery readiness all fail on this one missing axis.
6. **No source-control model.** Branch, commit, PR, CI and merge are absent, so "integration" and "evidence-linked delivery" cannot be expressed.
7. **No identity/authorisation layer.** Blocks per-user boundaries, real delegated authority, and any multi-human use.
8. **Portability.** `HISTORICAL_NEXUS_WORKSPACE_ROOT = D:\!starq`, and `../../../../agent-comms/protocol/v1/hashChain.mjs` is a static relative import that only resolves when the app sits at `00_STARQ_HQ/operations/starq-command`. A clone of `starq-command` alone is not a working system.
9. **Scale.** A 37.5 MB JSONL ledger is parsed in-process per projection; `/api/raw` is capped at 8 MB. Projections are synchronous full-rebuilds. Fine for one Founder on loopback; it is the wall for a company OS.
10. **Verification credibility.** Stored evidence: **21 of 63 test files failed, 4 of 496 tests failed** at PR #1 head — mostly hard-coded absolute paths (`D:\STARQ_COMMAND_BASELINE_TO_ROUTE_CENSUS_2026-10-01.md`). `tsconfig.json` includes `src` only, so a green typecheck covers no `server/*.mjs`. The takeover report names this honestly: *"Review theater… They do not start ports, render the dashboard, or post to Room."*

---

## E. End-to-end production feasibility

Against the scenario in the brief, step by step:

| Step | Today | Why |
|---|---|---|
| New project created | **Can do** | `POST /api/pm/projects`, live |
| Requirements documented | **Cannot** | no requirement entity |
| Requirements → activities / work packages | **Cannot** | no derivation, no work-package entity |
| Dependencies identified | **Partial** | `depends_on` is stored, never analysed |
| Suitable workers assigned | **Partial** | handles can be typed into `owner`/`verifier`; no capability matching, no availability check |
| Multiple agents implement features via connected tools | **Cannot** | no dispatcher; Herdr is bounded to start/stop/restart |
| Assignments / source changes / progress / evidence tracked | **Partial** | evidence refs and Room links yes; source changes no |
| Implementations enter testing | **Cannot** | Command runs no tests and reads no CI |
| Independent review | **Can do (API only)** | `/api/command/tasks/:id/verify` + `VerifierGuard`; no UI, never used |
| Findings generate corrective work | **Cannot** | `REJECTED` is a state; no rework-task generation |
| Integration | **Cannot** | no branch/PR/merge model |
| Acceptance | **Can do — strongest capability** | verifier-attested + Founder-attested Room gates (committed build) |
| Portfolio / workforce / comms / graph / calendar / Tower reflect the result | **Partial → Missing** | Tower and portfolio partially; comms read-only; graph and calendar absent |

**Verdict on the scenario:** a complete cycle **cannot be executed today**, and the break is not diffuse — it is two specific absences: *requirements→work-packages* at the front and *dispatch→execution* in the middle. The back end of the pipeline (review → acceptance → evidence) is the part that already works.

**The honest counter-evidence**, and it matters: the live board holds **4 tasks across 3 projects, all closed**; ERP and Hoadha boards are empty by policy; the control plane has processed **zero** tasks in its lifetime. Nothing in this application has yet produced software. The factory floor is built and wired; it has never run a shift.

---

## F. Recommended implementation sequence

Each phase is gated: do not start the next until the previous phase's verification passes. Complexity is relative (S/M/L/XL), not calendar time.

### Phase 0 — Stop the regression and unify the running stack · **S** · *do first*

- **Preserve the gated lifecycle.** Decide before committing the working tree: keep `BACKLOG…ACCEPTANCE…CLOSED` as the factory lifecycle, and add the 5-column Nexus board as a *view* or a second project type — do not delete the gates. This is a Founder decision with a one-way door.
- Resolve the live version split: the UI serves the working tree while :5176 runs the committed build (`/api/pm/org` → 404, board shows `4 cards / all columns 0`).
- Commit the untracked org model (`operating-org.mjs`, `org-operate.tsx`, `nexus-kanban.mjs`) or park it on a branch; `data/` now holds three PM databases.
- Fix `postToRoom()` to pass `--subject`/`--task`/`--action`, then prove one real post with `PM_ROOM_POST=on` in a scratch instance.
- *Verification:* six services READY from one `Start-Starq.bat -CommandOnly`; one PM event visible in Room by sequence number.
- *Unlocks:* a trustworthy baseline. Every later phase measures against it.

### Phase 1 — One identity spine · **M**

- Define a canonical entity-id scheme spanning project, requirement, work package, task, worker, seat, document, evidence, commit and Room event.
- Add a cross-reference table (or one shared SQLite file with attached schemas) so a PM task, a control-plane task and a Room event can name each other.
- Reuse: Room `eventId`/`record_hash` as the evidence primitive; `pm_status_log` as the history primitive.
- *Verification:* given any PM task id, resolve its control-plane task, its Room authorisation, its evidence records and its worker — in one query.
- *Unlocks:* the Cortex Graph, cross-module Tower rollups, and Phase 2.

### Phase 2 — Join the PM board to the control plane · **L** · *the conveyor*

- Make `READY → IN_PROGRESS` on a PM task create (or bind) a control-plane task, and `ACCEPTED` in the control plane satisfy the PM `ACCEPTANCE` gate.
- Requires a Founder authority decision: the current separation is authorised (#9493/#9494/#9497), so lifting it is a governance act.
- Reuse: both state machines and both gate sets as they stand — this is a binding layer, not a rewrite.
- *Verification:* one task driven from `BACKLOG` to `CLOSED` through both systems, with verifier and Founder Room attestations, and no manual DB edits.
- *Unlocks:* an end-to-end production record. **This is the first phase after which Command is a factory at all.**

### Phase 3 — The dispatcher · **XL** · *the largest single build*

- An allocator: queue → capability match (`canBuild`/`canVerify`/`capabilities`) → availability → seat → `ALLOCATED`.
- Worktree provisioning on allocation — `WorktreeManager`/`LeaseService` already exist and are tested; promote them from tests to runtime.
- An assignment-delivery channel to a seat. Herdr is bounded to lifecycle verbs by explicit design; the Room-first pattern already in use by the floor (post the assignment to Room, nudge the pane) is the lower-risk route and preserves the existing authority model.
- Real seat telemetry: call `updateSeatStatus`/`updateTelemetry`; bind live panes to canonical identities so `observed` and `runtimeState` stop being UNKNOWN.
- *Verification:* a task allocated, a worktree leased, an agent acknowledging in Room under its own identity, a builder artifact submitted with a candidate SHA — without a human typing a handle.
- *Unlocks:* autonomous multi-agent production; real workload and capacity management; Tower resource utilisation.

### Phase 4 — The planning dimension · **L**

- Requirement and specification entities; spec→work-package→task derivation; work packages as first-class records (reuse PR #1's unmerged milestone/work-package schema rather than reinventing it); task hierarchy/subtasks; dependency integrity and cycle detection.
- Dates: declare the day-boundary and timezone convention README has been waiting on, then milestones, deadlines and critical path.
- *Verification:* a requirement decomposed into work packages, scheduled, with a computed critical path and a dependency-driven blocker.
- *Unlocks:* Calendar Map, roadmaps, delivery readiness, progress measurement, Tower critical-path view.

### Phase 5 — Source control and integration · **L**

- Repository registration; branch/commit/PR entities; CI result ingestion; merge/integration gates tied to acceptance.
- Reuse: `BuilderArtifact.candidateSha` and `baseSha` already carry the hook.
- *Verification:* an accepted task traced to a merged PR with green CI, all linked by id.
- *Unlocks:* true delivery tracking and evidence-linked releases.

### Phase 6 — Communications · **M**

- A Room-backed messaging UI: composer, channels, project conversations, DMs, people directory, search, task-linked threads.
- Reuse: `send.mjs`, the ingress/envelope protocol and `readRoomSnapshot()` — the transport is done; this is a UI and a search index.
- *Verification:* a Founder posts a decision from Command, a worker replies, both appear in the canonical ledger with correct identities and metadata.

### Phase 7 — Library/Vault and Cortex Graph · **L**

- Document store with versioning and provenance; index the existing corporate library; link documents to projects, tasks, workers and decisions.
- Graph index and viewer over the Phase 1 id spine.
- *Verification:* from any node, traverse to its requirements, tasks, workers, commits, reviews, evidence and decisions.

### Phase 8 — Identity, contexts and multi-user · **XL** · *required for "Company OS", not for "Software Factory"*

- Authentication, per-user authority, access boundaries; HQ/Studio/Personal contexts; configuration UI replacing hand-edited JSON.
- Portability: remove `D:\!starq` and the `../../../../agent-comms` static imports; make the workspace root injectable.
- Scale: incremental ledger indexing instead of full in-process parse.
- *Verification:* a second human operates Command with their own authority and cannot produce another handle's evidence.

**Sequencing rationale:** Phases 0–3 deliver a working end-to-end software production process, as the brief asks. Phases 4–7 broaden it into the organisational platform. Phase 8 is what turns it from the Founder's instrument into a company's operating system, and it is the one phase that is pure precondition — nothing above depends on it, and everything multi-user does.

---

## G. Risks and dependencies

| # | Risk | Evidence | Mitigation |
|---|---|---|---|
| 1 | **The gated lifecycle is deleted before it is used** | uncommitted `pm-service.mjs` diff removes `REVIEW/VERIFICATION/ACCEPTANCE/FOUNDER_GATE` and all four gate guards | Founder decision in Phase 0; keep gates, add the kanban as a view |
| 2 | **The PM↔control-plane separation is authorised, not accidental** | `pm-service.mjs:1-24`; Room #9493/#9494/#9497 | Phase 2 needs an explicit Founder authority change first |
| 3 | **The read-only doctrine is test-enforced** | `read-only-capability.test.ts`, `real-tree-capability-mutation.test.ts`, the 405 handler | Decide the new authority boundary deliberately; do not add a fourth write origin |
| 4 | **Test suite is not a safety net** | 21/63 files failed at PR #1 head; `tsconfig` covers `src` only; offline suites never open a port | Phase 0 should repair path-dependent tests and add one real end-to-end test before Phase 2 |
| 5 | **Lifecycle cannot always recycle itself** | `STOP_INCOMPLETE`, JobGuardian "Access is denied", takeover §6 | Keep the elevated Recover path; do not build automation on top of an unstoppable stack |
| 6 | **Two workspaces, hard-coded** | `D:\!starq` vs `D:\StarqTech`; STARQ.md's symlink claim is false | Phase 8 portability; until then, pin the path and document it |
| 7 | **No auth** | README limitation 1; `actor` is attribution only | Acceptable for a single-Founder factory; blocking for Company OS |
| 8 | **Nexus import is a per-task Founder decision** | `board/pm-projects.json`; 437 ERP + 326 Hoadha rows withheld | The factory can be proven on new work; do not block Phase 2 on the import |
| 9 | **Scale ceiling** | 37.5 MB ledger, in-process parse, 8 MB raw cap, synchronous rebuilds | Phase 8 indexing; watch projection latency (already observed: the data service timing out in the live UI) |
| 10 | **Dispatcher may collide with Herdr's bounded-client doctrine** | `herdr-client.mjs:26-31` forbids send-text/exec | Prefer the Room-first assignment pattern over widening the Herdr contract |

**Open questions requiring a Founder answer, not an engineering one:** (a) keep or delete the gated lifecycle; (b) may PM and the control plane be joined; (c) what authority boundary replaces "read-only by construction"; (d) is Command single-user or multi-user; (e) may an agent be dispatched work automatically, or must every assignment carry a Room authorisation.

---

## H. Final recommendation

**Continue evolving the existing Starq Command. Do not rebuild.**

The application contains more of the intended product than it appears to, and almost none of what it has would be cheap to recreate: a cryptographically verifiable organisational ledger, an anti-self-acceptance review chain, a configurable company model, and a UI that refuses to show a value without its honesty state. The gap to the target is real and large, but it is a gap of **connection and planning**, not of foundation. Three systems need one identity spine and one conveyor; one planning dimension needs to be invented. That is additive work on a sound base.

Two things should happen next, in this order:

1. **Decide the lifecycle question before committing the working tree.** The uncommitted diff removes the single most valuable Software Factory asset in the repository. Everything else can wait a day; this cannot, because it is sitting uncommitted right now.
2. **Then do Phase 0** — one coherent running stack, one PM contract, one proven Room post — and only then open the authority question for Phase 2.

The fastest credible proof that this architecture can be the factory is narrow and achievable: **drive one real task from intake to Founder-attested acceptance, through both the PM board and the control plane, with a live agent doing the implementation.** Nothing in the current code makes that impossible. It has simply never been done — and until it is, every other judgement about this application, including this one, remains an architectural inference rather than an operational fact.
