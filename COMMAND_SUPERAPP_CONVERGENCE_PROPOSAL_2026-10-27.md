# Final Starq Command Superapp Convergence Proposal

**Date:** 27 October 2026, ~23:45 MVT
**Hard stop:** 28 October 2026, 16:11 MVT — **≈16.5 hours remain**
**Canonical application:** `D:\StarqTech\00_STARQ_HQ\operations\starq-command`
**Recovery under audit:** `recovered\nexus` — 23,509 files / 1.63 GB (my count, 27 Oct 23:21)
**Builds on:** `COMMAND_SOFTWARE_FACTORY_FEASIBILITY_2026-10-27.md`, `COMMAND_OVERHEAD_AUDIT_2026-10-27.md`
**Scope:** architecture and planning only. No code altered, no service touched, no Room cycle started.

Evidence labels used throughout: **[V]** verified by direct measurement this session · **[P]** preliminary integration present but not functional · **[E]** proposed engineering.

---

## 0. Three findings that change the plan

Before the architecture, three things the new evidence establishes — each of which moves the target closer, not further.

**0.1 The recovery contains Nexus's data and records, not Nexus's application. [V]**
`recovered/nexus/starqNexus/` holds 653 files: `data/`, `docs/`, `src/data/` (generated TypeScript only), `workspace-documents/`. The Nexus **application source lives at `D:\!starq\starqNexus\src`** — 112 files, **30,963 lines** of app code (excluding 4.1 M lines of generated data), organised into twelve feature modules. This is good news: it means the UI we are matching is a known, finite quantity, and we can read exactly what it did. But the recovery is not a port — nothing executable came across.

**0.2 Command is already the larger and deeper application. [V]**

| | Nexus | Command |
|---|---|---|
| App source | 30,963 LOC / 112 files | **22,643 LOC `src` + ~8,000 LOC `server`/`integrations`** |
| Comms | **6,936 LOC real messenger** (`CommsMessenger.tsx` 82 KB, `CommsChatView.tsx` 56 KB) | none |
| Tower | 1,364 LOC | 68 KB attention + 26 KB overview + seven-need |
| Board | 1,053 LOC | 16 KB board + 12 KB portfolio + gated service |
| Cortex | 440 LOC | none |
| Calendar | 165 LOC | none |
| Library | 301 LOC | 22 KB evidence (readability only) |
| Dispatcher | **33 LOC — a read-only feed** | none |
| Data layer | **generated `.ts` compiled into the bundle**; writes via `server.mjs` (491 LOC) for comms/send, comms/claim, comms/ack, sync/note, sync/task, grade, rebuild, calendar CRUD | SQLite with WAL, `synchronous=FULL`, optimistic concurrency, append-only triggers |
| Verification | none | 11-state machine, builder/verifier artifacts, anti-self-acceptance, Room-attested acceptance gates |

Nexus was **breadth with shallow write depth over build-time generated data**. Command is **depth with no breadth**. The convergence is therefore not a rewrite in either direction: it is *porting twelve known UI modules onto a store that is already better than the one they came from*.

**0.3 Two Nexus capabilities were never actually functional, and one Command gate has already been hollowed. [V]**

- **Nexus's dispatcher never dispatched.** 33 lines, reading `/api/index/handoffs`, with its own UI text reading *"CONFLICTS UNMONITORED"* and *"Resolve lease is not wired until a conflict data source exists."* Parity on "dispatch" therefore costs nothing — and anything Command builds here **exceeds** Nexus by definition.
- **Nexus's calendar held exactly one record**, and that record is a test: `{"id":"no-ls-1","title":"No localStorage Event",...}` in `00_STARQ_HQ/operations/calendar/calendar-events.jsonl`. The CRUD API and view existed; the data did not. This is consistent with your note that the only unresolved source is browser-held Personal records — the real calendar was in `localStorage`, and that one event is literally the test proving localStorage was abandoned. **Treat the calendar as a feature to build, not a dataset to restore.**
- **The import synthesised its own authorisation.** Rows in `pm-operating.db` carry `room_authorization_ref` = `{"authority":"LOCAL_LEDGER","sequence":0,"recordHash":null,"purpose":"Command local authorization (Room posting OFF)"}`. That is a self-issued token that satisfies the acceptance gate's *shape* without a Room attestation behind it. Defensible for 1,308 rows of **history**; fatal if the same pattern is used for live work. §4.4 fixes this by separating historical provenance from live gating.

---

## 1. Executive architectural recommendation

**Build one application, three processes, one database, one ledger with a derived working set, and an archive that is indexed but never loaded.**

```
                    ┌──────────────────────────────────────────┐
                    │  COMMAND UI  (one React app, :5173)      │
                    │  Tower · Projects · Board · Factory ·     │
                    │  Workforce · Comms · Library · Cortex ·   │
                    │  Calendar · Company · Settings           │
                    └───────────────┬──────────────────────────┘
                                    │  one client, three origins
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
┌────────▼─────────┐   ┌────────────▼──────────┐   ┌───────────▼──────────┐
│ READ PROJECTION  │   │   DOMAIN SERVICE      │   │   AGENT RUNTIME      │
│ :5177            │   │   :5176               │   │   :5179              │
│ cached, ETag/304 │   │   the only writer     │   │   herdr + control    │
│ invalidated by   │   │                       │   │   plane + dispatcher │
│ (size, mtime)    │   │   command.db          │   │                      │
└────────┬─────────┘   └───────────┬───────────┘   └───────────┬──────────┘
         │                         │                           │
         │                 ┌───────▼────────┐                  │
         └────────────────►│   command.db   │◄─────────────────┘
                           │  ONE SQLite    │
                           │  projects      │
                           │  tasks (gated) │
                           │  org/company   │
                           │  workers/seats │
                           │  documents     │
                           │  calendar      │
                           │  graph_edges   │
                           │  history (A/O) │
                           └───────┬────────┘
                                   │ reads
         ┌─────────────────────────┼──────────────────────────┐
         │                         │                          │
┌────────▼──────────┐   ┌──────────▼─────────┐   ┌────────────▼─────────┐
│ room.jsonl        │   │ room-state.json    │   │ ARCHIVE (on disk)    │
│ append-only       │   │ derived working    │   │ recovered/ 1.63 GB   │
│ hash-chained      │   │ set: open tasks,   │   │ library/ 11,226 md   │
│ ARCHIVE ONLY      │──►│ assignees, leases, │   │ indexed into         │
│ never full-parsed │   │ head seq (small)   │   │ command.db, content   │
└───────────────────┘   └────────────────────┘   │ read on demand only  │
                                                  └──────────────────────┘
```

### What is retained, consolidated, redesigned, replaced

| Component | Disposition | Why |
|---|---|---|
| `src/` UI shell, 27 surfaces, honesty states | **Retain whole** | 22.6 k LOC, `tsc` clean, the discipline that makes the app trustworthy |
| `server/pm-service.mjs` gated lifecycle | **Retain as the authoritative lifecycle** (see §6.3) | the one asset no other system in either codebase has |
| `server/company-os.mjs` four-object seat model | **Retain, make registry path configurable** | already data-driven; only the *path* is hard-coded |
| `server/operating-org.mjs` (untracked) | **Retain, commit, promote to the domain service** | the configurable company model you require |
| `integrations/control-plane/*` 11-state machine | **Retain, move behind the agent runtime** | builder/verifier artifacts + anti-self-acceptance |
| `integrations/workspace/*` worktree + lease | **Promote from tests to runtime** | currently imported only by `tests/` **[V]** |
| `server/data-service.mjs` | **Redesign: add caching, keep read-only** | 2.15–2.82 s uncached × 4/min **[V]** |
| `server/building-service.mjs` (:5178) | **Merge into read projection** | 2.40 s, 1.5 MB, same doctrine, separate port for historical reasons |
| `integrations/herdr/herdr-service.mjs` (:5179) | **Retain, becomes the agent runtime** | already hosts broker client + control plane |
| `pm-board.db` / `pm-operating.db` / `control-plane.db` | **Merge into `command.db`** | 4 / 1,308 / 0 rows, three schemas, one concept **[V]** |
| `/api/work-packages` (13.4 MB response) | **Replace** with a real work-package table | not a work-package system; a Room read-model **[V]** |
| Nexus 12 feature modules | **Port the UI, replace the data layer** | 30,963 LOC of known-good UX over generated TS → re-home on `command.db` |
| Nexus `server.mjs` + `scripts/*.generate` | **Replace** | build-time generation is the pattern we are removing |
| Nexus Supabase functions / schema | **Drop** | local-first requirement; nothing depends on it |
| Two non-binding 1,000-line SOPs | **Archive** | neither is in force; both cost orientation **[V]** |

### How the three disconnected systems become one

The cut identified in the feasibility report — projection / PM / control plane sharing no identifier space — closes with **one change, not an integration layer**: all three write to and read from `command.db`, and every record carries the same id vocabulary (§5.1). Concretely:

- The **projection service** stops being a separate truth. It becomes a *cache over `command.db` plus the canonical files*, with provenance and honesty states preserved exactly as today. It still never writes.
- The **PM board** stops owning its own database. `pm_tasks` becomes `tasks` in `command.db`, with the gated lifecycle intact.
- The **control plane** stops owning `control-plane.db`. A control-plane task becomes a **row in the same `tasks` table** with an `execution` sub-record (`builder_seat`, `verifier_seat`, `branch`, `base_sha`, `candidate_sha`, `workspace_path`). The 11-state machine becomes the `execution_state` column; the 9-state gated lifecycle stays as `stage`. They are two axes of one task, not two tasks in two databases.

That last sentence is the whole convergence. There is no binding layer, no sync job, no cross-reference table — because there is nothing to cross-reference once there is one row.

---

## 2. Nexus → Command capability reconciliation

Columns: **Nexus actual** (what it really did, from source) · **Command now** · **Recovered** (what Codex's import delivered) · **Gap** · **How it becomes operational** · **Beyond Nexus**.

### 2.1 Project & portfolio management

| | |
|---|---|
| **Nexus actual [V]** | 17 boards / ~1,305 tasks as generated TS; `ExecutionBoardView` + `ReconciliationView` (1,053 LOC); task schema carried `epic`, `sprint`, `phase`, `lane`, `workers[]`, `depends_on`, `dispatched_at`, `dispatched_by`, `priority`, `status`. Writes limited to `POST /api/sync/task` and `/api/sync/note`. |
| **Command now [V]** | 5-column board UI + gated 9-stage service; flat `pm_tasks`; no epic/sprint/phase/lane/workers. |
| **Recovered [V]** | **18 projects, 1,308 tasks in `pm-operating.db`** — a faithful *row* import (437 ERP + 243 Hoadha + 150 Portal + 101 Decisions + 72 Web + 56 Social + 54 OrgSync + 54 Antrac + 30 Pay + 27 Concierge + 20 Foundation + 13 DevOps + 12 POS + 12 Biography + 11 Studio + 7 Academy + 6 Dynamics ≈ 1,305). |
| **Gap** | **Schema loss.** The import dropped `epic`, `sprint`, `phase`, `lane`, `workers[]`, `dispatched_at`, `dispatched_by`, and collapsed Nexus `phase`/`status` into 5 columns (TODO 631 / DONE 559 / IN_PROGRESS 49 / NEXT 38 / BLOCKED 31). Also: the running service still reads `pm-board.db` (4 rows), so **none of this is on screen**. |
| **Operational via** | Extend `tasks` with the dropped columns (they exist in the source JSON — re-import is lossless, not reconstructive); repoint the service; §6.3 dual-axis lifecycle. |
| **Beyond Nexus** | Dependency integrity + cycle detection; critical path; gated acceptance Nexus never had; append-only history per task. |

### 2.2 Communications — the largest real gap

| | |
|---|---|
| **Nexus actual [V]** | A working messenger: `CommsMessenger.tsx` (82 KB), `CommsChatView.tsx` (56 KB), `CommsBusView`, `OperationsRoomView`, `IndexedCommsView`, roster, themes, `messengerModel.ts` (28 KB) — **6,936 LOC**. Writes: `POST /api/comms/send`, `/claim`, `/ack`. People directory, project conversations, threads. |
| **Command now [V]** | **No messaging UI at all.** Room is read-only projection; the single write path (`postToRoom`) omits `--subject` and would throw; pinned `room_post: OFF`. |
| **Recovered** | `agent-comms/` history (1,619 files) + the live 35.8 MB ledger with 15,841 events. |
| **Gap** | Composer, channels, DMs, threads, people directory, search. |
| **Operational via** | Port `CommsMessenger` onto `send.mjs` + `room-state.json` (§5.3). This is the highest-value port: the UI exists and is proven, the transport exists and is better than Nexus's. |
| **Beyond Nexus** | Hash-chained provenance per message; authority routing; reviewer separation; task-linked threads; **ACK as a state transition rather than a message** (§4), which Nexus could not do because it had no task state to transition. |

### 2.3 Library & Vault

| | |
|---|---|
| **Nexus actual [V]** | `CardLibraryView` + `IndexedLibraryView` (301 LOC) over `data/index/docs.json` — **199 documents indexed**. |
| **Command now [V]** | `evidence.tsx` reports source *readability* only (6 checked). `/api/raw` capped at 8 MB. No document store. |
| **Recovered [V]** | **11,226 markdown files** under a 9-category taxonomy (`00_INBOX`, `01_LIFE`, `02_CAREER`, `02_WORK`, `03_IDENTITY`, `03_PRIVATE_PROJECTS`, `04_STARQ`, `05_ACADEMIA`, `06_PEOPLE`, `99_SYSTEM`) + prebuilt `docs.json` (199), `manifest.json`, `reconciliation.json`. Plus `library/99_SYSTEM/work-entity-registry-v1/v2`. |
| **Gap** | The index covers **199 of 11,226 files — 1.8%**. Nexus never indexed its own library. No full-text search, no versioning, no doc↔task linkage. |
| **Operational via** | Index all 11,226 files into `documents` + SQLite **FTS5** (built in to `node:sqlite`, no dependency); store path + hash + title + frontmatter, **not content**; read content from disk on open. |
| **Beyond Nexus** | 56× the index coverage; real full-text search; documents linked to projects, tasks, decisions and evidence; version history by content hash. |

### 2.4 Cortex graph

| | |
|---|---|
| **Nexus actual [V]** | `CortexGraphView.tsx` (440 LOC) over `data/index/graph.json`: **757 nodes / 1,147 edges**, node types including `document`, with `canonicalPath`. |
| **Command now** | None. |
| **Recovered [V]** | `graph.json` as above — real, prebuilt, loadable. |
| **Gap** | 757 nodes against 11,226 documents + 1,308 tasks + 21 workers + 15,841 Room events: the graph covers a few percent of what exists, and nothing joins tasks↔commits↔evidence↔decisions. |
| **Operational via** | `graph_edges(src_id, src_type, rel, dst_id, dst_type, source)` in `command.db`, generated by an indexer from records the app already holds. Seed with the 1,147 recovered edges; derive the rest. |
| **Beyond Nexus** | Edges over *live* records rather than a build-time snapshot; task→commit→review→evidence→decision traversal; graph stays current because it is derived from the same tables the app writes. |

### 2.5 Calendar

| | |
|---|---|
| **Nexus actual [V]** | `IndexedCalendarView` (165 LOC) + full CRUD (`GET/POST/PUT/DELETE /api/calendar`). Event shape: `id, title, happenedAt, kind, category, project, tags[], notes, creator, createdAt, updatedAt, source, supersedes`. |
| **Command now** | None — no date model at all. |
| **Recovered [V]** | `calendar-events.jsonl`: **1 event, and it is a test record** (`"No localStorage Event"`). |
| **Gap** | Everything. Including the precondition Command's own README has been waiting on: *"A day boundary or timezone convention. No daily digest is possible until one is declared."* |
| **Operational via** | Adopt the Nexus event shape verbatim (it is good, and `supersedes` is better than most), add `calendar_events` to `command.db`, declare **MVT (UTC+5)** as the company day boundary, and derive entries from milestones, task due dates and reviews rather than only hand entry. |
| **Beyond Nexus** | Project milestones and review deadlines appear automatically; three contexts (Company/Studio/Personal) on one timeline; historical operational timeline from the Room ledger. |

### 2.6 Founder Tower & executive operations

| | |
|---|---|
| **Nexus actual [V]** | `FounderTowerView`, `FactoryControlView`, `TaskDetailView` (1,364 LOC) over generated data. |
| **Command now [V]** | Stronger already: seven-need overview with per-chip origin, honesty state and as-of timestamp; 68 KB attention surface; 351-event activity window; declared attention (3 decisions / 4 blockers). |
| **Recovered** | `founder-decisions-tasks.json` — **101 decision records** with `phase`, `sprint`, `epic`, `lane`, `workers`, `dispatched_by`. |
| **Gap** | Pending-review queue, delivery readiness, resource utilisation, critical path, decision age. |
| **Operational via** | All five follow from §5 (one store) + §2.1 (planning fields) + §2.8 (telemetry); the Decisions board is a project in `command.db` today. |
| **Beyond Nexus** | Honesty states, evidence drill-down, real review queue. |

### 2.7 Software Factory lifecycle

| | |
|---|---|
| **Nexus actual** | None. `FactoryControlView` was a view; there was no review, verification or acceptance machinery. |
| **Command now [V]** | Committed service enforces `BACKLOG→READY→IN_PROGRESS→REVIEW→VERIFICATION→ACCEPTANCE→CLOSED` + `BLOCKED` + `FOUNDER_GATE`, with owner-before-review, verifier≠owner, verifier-attested acceptance, Founder-attested closure, assignment lock. Control plane adds the 11-state builder/verifier model with artifacts. |
| **Gap** | No dispatcher; no requirements/specs; no CI or PR model; working-tree diff **deletes the gates**. |
| **Operational via** | §4 and §6. |
| **Beyond Nexus** | Everything here is beyond Nexus. |

### 2.8 Workforce, agents, assignment, dispatch

| | |
|---|---|
| **Nexus actual [V]** | `fleet` (428 LOC) + `dispatcher` (**33 LOC, read-only feed, self-described as unwired**) + `duty-roster.json` (15) + `work-logs.json`. |
| **Command now [V]** | 21-identity roster with per-field confidence and provenance; 10-seat capability registry (`canBuild`/`canVerify`); live broker reporting panes; stuck detector + escalation; worktree lease machinery (tested, not wired). All runtime fields honestly `UNKNOWN` — `updateSeatStatus`/`updateTelemetry` are never called. |
| **Gap** | Dispatch, telemetry, pane↔seat binding, assignment entity. |
| **Operational via** | §4.2. |
| **Beyond Nexus** | A dispatcher that actually dispatches is net-new to the whole organisation. |

### 2.9 Companies, organisation, governance

| | |
|---|---|
| **Nexus actual [V]** | `/api/sync/orgs`, `/api/sync/people`, `orgsync-tasks.json` (54), supervisor forms, `profile.json`. |
| **Command now [V]** | 7 floors / 41 seats / 14 rooms / 17 portfolio entries, Seat–Occupant–Acting Capacity–Delegation kept distinct, authority claims refused and reported. Plus untracked `operating-org.mjs`: companies/units/positions/people/appointments with reporting lines and HUMAN/DIGITAL kinds. |
| **Gap** | The registry **path** is fixed, and the seat roster is **source code** (`src/schemas/seat-registry.ts`) — your "must not permanently encode Starq's workforce" requirement is violated here specifically, and nowhere else significant. |
| **Operational via** | Move `CANONICAL_STARQ_FLEET` out of TypeScript into `config/seats.json`; make the company-registry path a setting; ship Starq's structure as *seed data*, not defaults. |
| **Beyond Nexus** | Multi-company, delegated authority, statutory records. |

### 2.10 Contexts (HQ Main / Studio / Personal)

| | |
|---|---|
| **Nexus actual [V]** | Library taxonomy encoded them (`01_LIFE`, `02_WORK`, `03_PRIVATE_PROJECTS`, `04_STARQ`, `05_ACADEMIA`); `galaxy` (363 LOC) and `home` (472 LOC) were the HQ faces. |
| **Command now** | Company and Dev Studio are *views*, not contexts. No Personal. |
| **Gap** | A context selector and per-context scoping. |
| **Operational via** | `context` column on documents, projects, calendar events and tasks; one selector in the shell. The taxonomy already tells us the values. |
| **Beyond Nexus** | Context as a first-class filter across every module, not a folder convention. |

### 2.11 Summary scoreboard

| Capability | Nexus did it? | Command does it? | After convergence |
|---|---|---|---|
| Multi-board kanban (17 boards) | ✅ | ⚠️ rows imported, not served | ✅ + gated lifecycle |
| Messenger / channels / DMs | ✅ (6,936 LOC) | ❌ | ✅ + hash-chained provenance |
| Library browse | ⚠️ 199 docs | ❌ | ✅ 11,226 + FTS |
| Cortex graph | ⚠️ 757 nodes, static | ❌ | ✅ live, derived |
| Calendar | ⚠️ API only, 1 test row | ❌ | ✅ with derived milestones |
| Founder Tower | ✅ | ✅ stronger | ✅ + review queue |
| Decisions board | ✅ 101 records | ⚠️ partial | ✅ |
| Fleet / workforce | ✅ declared | ✅ richer, honest | ✅ + telemetry |
| **Dispatcher** | ❌ (33 LOC stub) | ❌ | ✅ **net-new** |
| **Review / verification / acceptance** | ❌ | ✅ | ✅ **preserved** |
| **Evidence & provenance** | ❌ | ✅ | ✅ |
| **Honesty states** | ❌ | ✅ | ✅ |
| Org / companies / governance | ⚠️ sync endpoints | ✅ strong | ✅ configurable |
| Contexts | ⚠️ folder convention | ❌ | ✅ first-class |

**Full parity is reachable because three of Nexus's twelve modules were not functional, and Command already exceeds Nexus on five axes.** The genuine build is: messenger, library index, cortex, calendar, planning fields, dispatcher.

---

## 3. Module and data architecture

### 3.1 UI modules (one app, one router)

```
Tower        executive snapshot, attention, review queue, delivery readiness
Projects     portfolio, roadmaps, milestones, dependencies, critical path
Board        per-project kanban (Nexus parity) + gated stage view (Command depth)
Factory      requirements → specs → work packages → assignments → review → acceptance
Workforce    roster, seats, capabilities, live sessions, dispatch queue, telemetry
Comms        messenger: common room, project rooms, groups, DMs, directory, search
Library      11,226 docs, FTS, versions, provenance, doc↔record links
Cortex       live relationship graph over every entity
Calendar     milestones, deadlines, reviews, events — Company/Studio/Personal
Company      floors, rooms, seats, units, positions, appointments, authority
Settings     contexts, repos, providers, paths, seats-as-config
```

Eleven modules against Nexus's twelve, with `galaxy`/`home` folded into Tower and `hoadha` becoming an ordinary project.

### 3.2 `command.db` — one schema

```sql
-- identity spine: every id is '<type>:<slug>' and unique across the database
companies, org_units, org_positions, org_people, org_appointments   -- from operating-org.mjs, retained
projects(id, name, prefix, context, governance, classification, owner_position_id, …)
requirements(id, project_id, title, body, source_doc_id, status)
work_packages(id, project_id, requirement_id, title, epic, sprint, lane, …)
tasks(
  id, project_id, work_package_id, parent_task_id,        -- hierarchy: subtasks
  title, description, priority, context,
  stage,            -- GATED AXIS: BACKLOG..REVIEW..VERIFICATION..ACCEPTANCE..CLOSED
  execution_state,  -- RUNTIME AXIS: CREATED..ALLOCATED..EXECUTING..ACCEPTED (11-state)
  board_column,     -- DERIVED view column for Nexus-parity kanban
  epic, sprint, phase, lane, workers_json,                -- restored from Nexus
  owner, verifier, builder_seat, verifier_seat,
  branch, base_sha, candidate_sha, workspace_path,
  depends_on_json, evidence_refs_json,
  provenance,       -- LIVE | HISTORICAL_NEXUS  ← decides whether gates apply
  room_authorization_ref, created_by, created_at, updated_at, closed_at
)
task_history(...)         -- append-only, immutable triggers (retained from pm_status_log)
assignments(id, task_id, seat_id, role, assigned_at, lease_path, state)
documents(id, path, title, hash, context, category, frontmatter_json, indexed_at)
documents_fts                                      -- FTS5 over title + frontmatter + body
document_versions(document_id, hash, seen_at)
calendar_events(id, title, happened_at, kind, category, project_id, context, tags_json,
                notes, creator, source, supersedes, created_at, updated_at)
decisions(id, title, status, authority, decided_at, evidence_refs_json)
graph_edges(src_id, src_type, rel, dst_id, dst_type, source, generated_at)
evidence(id, kind, path, sha256, task_id, room_event_id, created_at)
seats(id, name, role, tier, provider, model, harness, can_build, can_verify,
      capabilities_json, launch_policy)              -- was source code, now data
seat_telemetry(seat_id, observed_at, runtime_state, health, quota_status, source)
```

Three design decisions worth stating:

1. **Two lifecycle axes on one row.** `stage` is governance; `execution_state` is runtime. They are independent and both real — a task can be `stage=VERIFICATION, execution_state=ACCEPTED`. This is what joins PM and control plane without a bridge.
2. **`provenance` decides gating.** `HISTORICAL_NEXUS` rows are history: they display, they search, they graph, and **the gates do not apply to them**. `LIVE` rows are governed. This removes the need for the synthetic `LOCAL_LEDGER` authorisation token entirely.
3. **`documents` stores paths and hashes, never content.** 11,226 files stay on disk. The database holds ~2–3 MB of metadata and an FTS index; opening a document reads one file.

### 3.3 Archive strategy — available, never loaded

| Asset | Where it lives | How the app uses it |
|---|---|---|
| `recovered/nexus` 1.63 GB | **moved out of the product directory** to `D:\StarqTech\_archive\nexus-recovery-20261027\` | indexed once; never traversed at runtime |
| `library/` 11,226 md | archive root | `documents` + FTS5; content read per-file on open |
| `room.jsonl` 35.8 MB | `agent-comms/` | append-only archive; **never fully parsed** — `room-state.json` + byte-offset tail reads |
| Nexus `data/*.json` | archive root | one-time lossless import into `tasks`; source files kept for provenance |
| `graph.json` 757/1,147 | archive root | seeds `graph_edges` |
| 62.7 MB `room.jsonl.*.bak` | archive root | out of the working directory |

**This is your "available without continuously processing" requirement, met structurally:** the only things the running app reads are `command.db` (a few MB), `room-state.json` (small), and whatever single file the user opens.

---

## 4. Software Factory execution architecture

### 4.1 The production flow

```
INTAKE      Founder creates a project (context, governance mode, owner position)
REQUIREMENT A requirement is written, or imported from a Library document
            → requirements row, linked to its source doc
SPEC        Requirement decomposed into work packages (epic/sprint/lane)
PLAN        Tasks created under work packages; depends_on validated (no cycles);
            dates set → calendar entries appear automatically
ASSIGN      Dispatcher matches task → seat by capability + availability:
            creates assignments row, provisions a git worktree, takes a lease,
            sets stage=IN_PROGRESS, execution_state=ALLOCATED,
            and posts ONE Room assignment event
IMPLEMENT   The agent works in its worktree. Progress is observed from the
            worktree and the seat, not narrated in Room.
BUILD DONE  Agent submits a BuilderArtifact (candidate_sha, diffstat, test output)
            → execution_state=BUILDER_COMPLETE, stage=REVIEW
TEST        Test results attach as evidence rows (hash + path)
REVIEW      An independent verifier seat (verifier ≠ owner, enforced) is assigned
            → execution_state=VERIFYING, stage=VERIFICATION
VERDICT     PASS → execution_state=ACCEPTED; stage advances to ACCEPTANCE
            FAIL → execution_state=REJECTED; findings generate rework tasks
            linked to the original (parent_task_id)
INTEGRATE   Branch merged; commit/PR recorded; stage=ACCEPTANCE satisfied
ACCEPT      Founder acceptance → stage=CLOSED
DELIVER     Release record; evidence chain complete and traversable in Cortex
```

Every transition writes one `task_history` row. **No transition requires a human to write a message.**

### 4.2 The dispatcher — the one genuinely new component

Nexus never had one; Command has every part except the loop. Design:

- **Input:** tasks with `stage=READY` and no live assignment.
- **Match:** `seats.can_build` / `can_verify` + `capabilities_json` ∩ task requirements, filtered by `seat_telemetry.runtime_state`.
- **Allocate:** create `assignments`; `WorktreeManager.provision()` + `LeaseService.acquire()` — **both already written and tested, just not wired** [V].
- **Deliver:** post one structured Room assignment event (`--task`, `--action started`, `--subject`) and nudge the pane. This keeps Herdr's bounded-client doctrine intact — Command never gains a shell.
- **Observe:** `stuck-detector` already exists; feed it real timestamps.
- **Close:** builder artifact arrives → state advances automatically.

**Telemetry is the precondition.** `updateSeatStatus`/`updateTelemetry` exist and are never called [V]; the broker reports panes with `label: null` [V]. Binding pane→seat is the smallest piece of work that turns the entire workforce surface from `UNKNOWN` to live.

### 4.3 How workers interact

| Worker | Reads | Writes | Via |
|---|---|---|---|
| Founder | Tower, Board, Factory, Comms | create, prioritise, accept, decide | UI |
| Human staff | Board, Comms, Library | task updates, messages, evidence | UI |
| AI agent (builder) | its assignment + Room pointer | progress, builder artifact, evidence | `send.mjs` + domain API |
| AI agent (verifier) | task + candidate SHA + evidence | verdict artifact, findings | same |
| Herdr | — | pane/session facts | broker → agent runtime |
| Command | everything | nothing outside `command.db` | — |

### 4.4 State accuracy without coordination messages

The audit measured **824 of the last 2,000 Room events (41%) as pure coordination** [V]. The factory removes that at the source:

- **ACK = state transition.** `--action started` already sets In Progress. Render it as a status change on the task, not a line in the feed.
- **Progress = observed.** Worktree commits and the seat's own artifacts are evidence; a "still working" message adds nothing.
- **Assignment = one event, not a thread.** The assignment is a record; the Room event is its notification.
- **Readiness = a session record.** Written once to `sessions.json`, read by anyone, not re-derived per task.
- **Acceptance stays a message**, because a Founder attestation *should* be a signed, hash-chained statement.

Expected: Room volume drops ~40% at identical governance strength, because the governance moves from prose into the schema.

---

## 5. Data architecture specifics

### 5.1 Identity

`<type>:<slug>` — `project:erp`, `task:SERP-354`, `doc:04_STARQ/...md`, `seat:codex`, `person:ali`, `room:15881`, `commit:a4b881a`. One namespace, so `graph_edges` needs no type resolution and any record can reference any other. Nexus task ids (`FD-001`, `SERP-354`) are preserved verbatim as `task:` slugs — provenance and continuity for free.

### 5.2 Authoritative records

`command.db` is the SSOT for operating records. Canonical files (`identities.json`, the control-board contract, `company-seats.json`) remain authoritative for what they own, and Command keeps projecting them read-only with drift detection — the honesty doctrine survives intact. What changes is that Command's *own* records stop being scattered across three databases.

### 5.3 Room

`room.jsonl` remains the append-only hash-chained archive. Add:
- `room-state.json` — derived working set: open tasks, assignees, live leases, head sequence. Rewritten on append.
- `room.mjs --tail N` — seek from EOF. Today the only sanctioned read parses all 15,841 records: **458 ms, +168 MB RSS** [V].

Both are small changes to a module that already maintains byte offsets for watchers.

### 5.4 Documents, search, versioning

FTS5 via `node:sqlite` — no new dependency. `documents` holds path/hash/title/frontmatter; `document_versions` tracks content hashes over time; content is read from disk. 11,226 files indexed once (~minutes), then incremental by mtime.

### 5.5 Live status & incremental projections

- Cache the assembled surface on source `(size, mtime)`; ETag + 304. Today: **2.15–2.82 s, 2.0 MB, `no-store`, polled every 15 s, client aborts at 4,000 ms** [V] — which is why the dashboard currently shows "DATA SERVICE UNREACHABLE" while the service is healthy.
- `/api/health` gets its own cheap path; it currently costs **1.93 s** to report one field [V].
- Reference point in the same codebase: `/api/pm/portfolio` on SQLite answers in **17 ms** [V].

### 5.6 Backup, recovery, integrity

Retain WAL + `synchronous=FULL` + append-only triggers + `VACUUM INTO` backups + integrity check (all already implemented in `pm-service.mjs`). Add: nightly `command.db` snapshot to the archive root, and keep the Nexus source JSON permanently so any import can be re-derived rather than trusted.

---

## 6. Implementation roadmap

### 6.1 The smallest change set that unlocks the most

Ranked by functionality-per-hour, from the measurements:

| # | Change | Unlocks | Effort |
|---|---|---|---|
| 1 | **Repoint the service to `pm-operating.db`** | 1,308 tasks / 18 boards become visible. The single highest ratio in the entire plan. | **minutes** |
| 2 | **Cache projections + cheap `/api/health`** | Removes ~18% of a core and the false UNREACHABLE banner | 1–2 h |
| 3 | **Dual-axis lifecycle + `provenance`** | Nexus kanban **and** gated factory on one table | 3–5 h |
| 4 | **Index the library into FTS5** | Library + Vault + search over 11,226 docs | 3–4 h |
| 5 | **`room-state.json` + `--tail N`** | Kills the per-message 458 ms/168 MB tax | 2–3 h |
| 6 | **Seats to config** | Removes the hard-coded workforce | 1 h |
| 7 | **Pane↔seat binding + telemetry** | Workforce goes from UNKNOWN to live; dispatcher precondition | 4–6 h |
| 8 | **Dispatcher loop** | End-to-end factory | 1–2 days |
| 9 | **Messenger port** | Full comms parity | 2–3 days |

### 6.2 What is actually achievable before 28 Oct 16:11 (≈16.5 h)

I will not pretend the full target fits. Items **1, 2, 3, 6** and the commit hygiene fit, and together they produce *a visibly different application*: 1,308 tasks across 18 boards, a dashboard that stops declaring itself dead, both lifecycles coexisting, and a workforce that is configuration rather than source code.

**Pre-deadline sequence (dependency-ordered):**

| Slot | Work | Verification |
|---|---|---|
| **A (0.5 h)** | `.gitignore` `recovered/`; move the 1.63 GB tree to the archive root; commit the untracked modules (`nexus-kanban`, `nexus-cortex`, `nexus-library`, `operating-org`, `org-operate`, `cortex.tsx`, `library.tsx`) and both reports | `git status` clean; no 1.6 GB in the repo |
| **B (0.5 h)** | Point `paths.mjs` at `pm-operating.db`; migrate the 4 `pm-board.db` rows + 37 history rows; restart the pm service only | `/api/pm/portfolio` shows 18 projects / 1,308 tasks; board columns populate |
| **C (2 h)** | Cache `/api/surface` + `/api/building` on `(size, mtime)`; ETag/304; cheap `/api/health`; raise `FETCH_TIMEOUT_MS` to 8,000 as a belt | second `/api/surface` < 50 ms; UNREACHABLE banner gone |
| **D (4 h)** | Dual-axis schema: add `stage`, `provenance`, `epic`, `sprint`, `phase`, `lane`, `workers_json`, `dispatched_at/by`; re-import from the source JSON (lossless); restore the 9 gated stages for `provenance=LIVE`; keep the 5-column board as a derived view | one historical card drags freely; one live card refuses `ACCEPTANCE` without verifier attestation |
| **E (1 h)** | `CANONICAL_STARQ_FLEET` → `config/seats.json`; company-registry path becomes a setting | app starts with a different seats file |
| **F (2 h)** | Library index: `documents` + FTS5 over the 11,226 files; mount `library.tsx` | search returns hits from `04_STARQ` and `05_ACADEMIA` |
| **G (1.5 h)** | Seed `graph_edges` from `graph.json` (757/1,147); mount `cortex.tsx` read-only | graph renders; nodes link to real records |
| **H (1 h)** | Make `npm test` safe: remove absolute-path dependencies, isolate the mutation test, point control-plane tests at a temp DB | `npm test` runs to completion on demand |
| **I (1 h)** | One end-to-end smoke: create a live task → READY → IN_PROGRESS → REVIEW → VERIFICATION, confirm the verifier gate refuses self-acceptance | recorded in `evidence/2026-10-28/` |
| **Reserve (2 h)** | contingency | — |

**Explicitly after the deadline:** dispatcher, messenger, requirements/specs, calendar, CI/PR model, telemetry, contexts, multi-user auth.

### 6.3 Preserving the gates while gaining the Nexus kanban

This is the decision the whole proposal turns on, so here it is precisely.

**Do not choose between them. Put them on different axes of the same row.**

- `stage` — the **authoritative governance field**, carrying the full committed set: `BACKLOG, READY, IN_PROGRESS, REVIEW, VERIFICATION, ACCEPTANCE, CLOSED, BLOCKED, FOUNDER_GATE`, with every existing guard intact (owner-before-review; verifier ≠ owner; verifier-attested acceptance; Founder-attested closure; assignment lock).
- `board_column` — a **derived 5-column projection** for the Nexus-parity board:
  `BACKLOG→To Do · READY→Next Up · IN_PROGRESS/REVIEW/VERIFICATION→In Progress · BLOCKED/FOUNDER_GATE→Blocked · ACCEPTANCE/CLOSED→Done`.
- `provenance` — `HISTORICAL_NEXUS` rows (all 1,308) are **history**: they drag freely, exactly as in Nexus, because gating imported history is meaningless. `LIVE` rows are governed.
- `governance` on the project — `KANBAN` or `GATED`, so a tracking board and a production board can coexist. A `KANBAN` move that would skip a gate still records `UNGATED_MOVE` with its reason in `task_history`: nothing is hidden, nothing is blocked.

This preserves **every** guard for the work that matters, restores **every** Nexus affordance for the work that is history, and — unlike the current uncommitted diff — deletes nothing.

### 6.4 The `pm-operating.db` / `pm-board.db` mismatch

**Measured state** [V]: `pm-board.db` — 3 projects, 4 tasks, 37 history rows, **read by the running service**. `pm-operating.db` — 18 projects, 1,308 tasks, 1,316 history rows, 4 org tables populated, **written by the working tree, served to nobody**. The live UI consequently shows `4 cards · To do 0 · Next 0 · In progress 0 · Blocked 0 · Done 0` and `PM attention unavailable — REJECTED: No such route`.

**Resolution:** `pm-operating.db` becomes canonical (it is a superset — `PM-CMD-001` is already present). Migrate the few `pm-board.db` rows that are not in it, repoint `paths.mjs`, restart **only** the pm service, keep `pm-board.db` as a dated backup, then rename to `command.db` when §3.2 lands. This is slot **B** above: half an hour, and the largest visible change in the plan.

### 6.5 No new framework

Nothing above adds a dependency. SQLite is `node:sqlite` (built in); FTS5 ships with it; the graph is two tables; the UI is the React app that exists. Services go **6 → 3**. The only new runtime component in the whole proposal is the dispatcher loop, and it is net-new capability, not scaffolding.

---

## 7. Governance and communications simplification

Essential, retained unchanged: hash-chained ledger, identity leases, authority policy, reviewer separation (2,816 lines total [V]), append-only history, verifier-attested acceptance, honesty states.

Historical restrictions that no longer serve the objective:

| Mechanism | Why it existed | Recommendation |
|---|---|---|
| Read-only-by-construction data service | Phase 6 "no control plane, no writes, by design" | **Amend deliberately.** Keep read-only for the *projection*; the domain service is the writer. One boundary, stated once. |
| Writes added as new origins | consequence of the above | **Merge to 3 services** |
| Per-task identity ceremony | real continuity failures | **Once per session, cached in `sessions.json`** — #15794 already narrowed this; caching finishes it |
| ACK/readiness as prose messages | made readiness visible | **State transitions, rendered as status** (41% of traffic [V]) |
| Ack-of-ack | — | already forbidden, not holding (`#15875 "Review ACK verified"` [V]); the schema change makes it impossible rather than discouraged |
| `--subject` throw with no default | metadata discipline | **Keep the requirement, default from the first line, add `--dry-run`.** Command's own `postToRoom()` violates it undetected [V] |
| Two non-binding 1,000-line SOPs | drafts | **Archive** |
| 6-layer start chain | containment, pinned ports | **One owner + PID files.** `Win32_Process.CommandLine` is empty for the six live node PIDs [V] — that is why stop fails |
| Loopback + Host + Origin + header per origin | defence in depth | **Keep loopback; drop the rest to one origin check.** Local trusted environment; the ceremony protects against nothing demonstrated |
| Nexus Supabase | cloud experiment | **Drop** — local-first |

**What is not weakened:** who said it, whether it was tampered with, whether the reviewer was independent, whether the Founder accepted it. Those four properties are the governance. Everything else listed above is procedure around them.

---

## 8. Performance and resource strategy

Measured baseline [V]: entire Starq runtime **157 MB / 14 processes**, **0.3% of one core at idle**. The laptop is not the constraint — and nothing in this proposal increases the footprint.

| Change | Measured today | Expected |
|---|---|---|
| Cached projections | 2.15–2.82 s × 4/min, 2.0 MB each | < 50 ms on hit; ~18% of a core → ~0 |
| `/api/health` | 1.93 s for one field | < 10 ms |
| `/api/work-packages` | 13.4 MB/call | paginated, replaced by `work_packages` |
| Room read | 458 ms / +168 MB per full parse | tail read: ms |
| Services | 6 origins | 3 |
| Databases | 3 (+1 backup) | 1 |
| Room traffic | 1,000–1,170 events/day, 41% coordination | ~40% reduction |
| Library | not indexed | 11,226 docs, metadata-only in DB, content on disk |
| Archive | 1.63 GB inside the product dir, untracked, **not gitignored** | outside the repo, indexed, never loaded |
| Product directory | 2,044 MB | ~250 MB |

Scaling note that matters more than any of the above: every full ledger read is **O(entire history)**. At the current 1,000+ events/day the ledger doubles in roughly two months, and a single surface build then exceeds the client's own abort budget outright. Caching and tail-reads are not optimisations; they are what stops the system degrading as the company accumulates history.

---

## 9. Acceptance criteria

**A. Full Nexus functional parity**
1. All 18 boards and 1,308 tasks render and are editable, with Nexus ids preserved.
2. `epic`, `sprint`, `phase`, `lane`, `workers[]`, `dispatched_at/by` are present and displayed.
3. Messenger sends and receives: common room, project rooms, groups, DMs, directory, search.
4. Library browses and searches all **11,226** documents (Nexus indexed 199).
5. Cortex renders the graph with live nodes, not a build-time snapshot.
6. Calendar supports create/read/update/delete with Nexus's event shape.
7. Decisions board shows all 101 records with their status and authority.
8. Fleet/workforce shows every seat with its declared capabilities.
9. No capability regression: a Nexus→Command checklist signed off module by module.

**B. Beyond Nexus**
10. Gated review/verification/acceptance enforced on live work; self-acceptance structurally refused.
11. Evidence chains traversable: task → commit → review → evidence → decision.
12. Honesty states on every projected value.
13. Configurable companies/units/positions/appointments; seats as config, not source.
14. Full-text search across the library (Nexus had none).
15. Live graph (Nexus's was generated at build time).

**C. End-to-end Software Factory**
16. One task driven intake → requirement → work package → assignment → implementation → test → independent review → rework → integration → Founder acceptance, **with no manual DB edits**.
17. The dispatcher allocates a seat, provisions a worktree and takes a lease without a human typing a handle.
18. A rejected review generates linked rework.
19. Every transition appears in `task_history`; acceptance carries a Room attestation.

**D. Lean local operation**
20. Six services → three; three databases → one.
21. Cached `/api/surface` under 50 ms on a cache hit; no spurious UNREACHABLE banner.
22. Starq runtime RAM stays under ~250 MB.
23. No cloud dependency anywhere in the core application.
24. The 1.63 GB archive is indexed and never loaded at runtime.

**E. Governance and comms**
25. Pure-coordination Room events below 15% of volume (from 41%).
26. One session record replaces the per-task identity ceremony.
27. Acceptance and Founder decisions remain signed, hash-chained Room records.

**F. Reliable daily use**
28. `Start-Starq.bat -CommandOnly` reaches three READY services, and **stop actually stops**.
29. `npm test` runs to completion on demand without mutating the working tree or live databases.
30. The Founder uses Command — not Nexus, not the Room CLI — for a full working day.

---

## 10. Unresolved decisions and risks

**Decisions only you can make**

| # | Decision | Why it blocks |
|---|---|---|
| D1 | **Keep the gated lifecycle** (§6.3) — or confirm deletion | The uncommitted diff removes it. One-way door. Everything in §4 assumes it survives. |
| D2 | Authorise joining PM and the control plane | The separation is authorised by #9493/#9494/#9497; lifting it is a governance act, not an engineering one. |
| D3 | The authority boundary that replaces "read-only by construction" | Needed before the domain service becomes the writer. |
| D4 | Single-user or multi-user | There is no auth at all today; `actor` is attribution only. Factory: survivable. Company OS: not. |
| D5 | May an agent be dispatched automatically, or must every assignment carry a Room authorisation? | Determines whether §4.2 is a loop or a queue awaiting approval. |
| D6 | Declare the day boundary / timezone (MVT proposed) | Calendar, deadlines and any digest are blocked on it. |

**Technical risks**

| # | Risk | Evidence | Mitigation |
|---|---|---|---|
| R1 | 16.5 h is not enough for the full target | — | §6.2 scopes to slots A–I; everything else is explicitly after |
| R2 | The synthetic `LOCAL_LEDGER` authorisation pattern leaks into live work | present on imported rows [V] | `provenance` column; gates apply only to `LIVE` |
| R3 | Re-import loses more than it restores | the first import already dropped 7 fields [V] | re-import from source JSON, which is lossless and repeatable; keep source files permanently |
| R4 | Test suite cannot protect the migration | 21/63 files failed; `vitest` unsafe to run now [V] | slot H precedes slot I |
| R5 | Lifecycle cannot recycle onto the new config | `STOP_INCOMPLETE`, empty `CommandLine` on 6 PIDs [V] | restart only the pm service in slot B; PID files later |
| R6 | Library indexing is slower than estimated | 11,226 files, untested | metadata-only; measure on 500 files first |
| R7 | Cortex coverage disappoints | 757 nodes vs ~13,000 entities [V] | seed from `graph.json`, derive the rest from tables already held |
| R8 | Personal/browser records are genuinely lost | calendar holds 1 test row [V] | assess separately as instructed; do not block the calendar build on it |
| R9 | Messenger port is larger than it looks | 6,936 LOC over a different data layer [V] | port the view, replace the model; after the deadline |
| R10 | The working tree keeps changing under the plan | 4 new files + 1.63 GB appeared during this audit [V] | slot A commits and gitignores first |

---

## Closing judgement

**Command can become a better superapp than Nexus, and the distance is shorter than it appears.**

Nexus was twelve modules of good UX over build-time generated data, with shallow writes, no dispatcher, a one-record calendar and a library it never indexed. Command is a smaller feature surface over genuinely better foundations: real transactional storage, cryptographic provenance, independent verification, honest state. **The convergence is porting known UI onto a better store — not building a platform.**

Three things decide whether it happens:

1. **Keep the gates.** They are the one thing neither system has elsewhere, and they are sitting in an uncommitted diff that deletes them. §6.3 shows you do not have to trade them for the Nexus board.
2. **Point the service at the data you already imported.** Thirty minutes of work stands between 1,308 recovered tasks and a Founder looking at them.
3. **Cache the projection.** It removes the environment's largest measured waste and the defect currently on your screen.

Do those three before 16:11 tomorrow and Command stops being three disconnected systems and starts being the application. The dispatcher and the messenger — the two genuinely new builds — then have something coherent to land on.
