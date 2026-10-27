# Nexus → Command PM Gap Map
**Prepared by:** @pi (Pi, EXTERNAL_AGENT, restricted lane)  
**Directive:** Founder #10596  
**Date:** 2026-10-21  
**Method:** Strictly read-only. No source/database mutations.  
**Status:** For Founder review; post to canonical Room under @pi

---

## 1. Executive Summary

| Item | Nexus (historical) | Command (current PM) |
|---|---|---|
| Board count | 4 (ERP, Hoadhaa Core, Hoadhaa Social, Hoadhaa Concierge) | 1 board candidate (STARQ-COMMAND-MODS) + 3 DB project rows |
| Task records | 761 (437 ERP + 241 Hoadhaa Core + 56 Hoadhaa Social + 27 Hoadhaa Concierge) | 0 in DB; 33 board candidates (CANDIDATE_NOT_ACCEPTED, stale at Room #9455) |
| Task storage | JSON files with generated-TS UI pipeline | SQLite `pm-board.db` (pm_tasks, pm_status_log, pm_projects, pm_meta) |
| Tasks imported into Command DB | — | None (all 3 project rows: next_seq=1, 0 tasks) |
| Board status | — | CANDIDATE_NOT_ACCEPTED |

**Core finding:** Nexus carried 761 historical board records with a rich task schema (phase, sprint, epic, priority, lane, depends_on, workers, dispatch/audit fields, acceptance/evidence, and ~70+ optional fields on ERP tasks). Command's PM database is empty (0 tasks, 3 project shells) and its board candidate holds 33 pinned, non-imported rows with a minimal, Room-anchored schema. Every Nexus task would require translation; none map 1:1 without field reduction or addition.

---

## 2. Nexus Board Inventory (evidence)

| Board | File | Task count | Status distribution | Key fields |
|---|---|---|---|---|
| Starq ERP | `Projects/StarqNexus/data/starq-erp-tasks.json` | 437 | done 232, planned 192, in_progress 12, closed 1 | id, phase, sprint, epic, title, workers, status, depends_on, priority, lane, dispatched_at, dispatched_by, description, acceptance, milestone, release_track, evidence, + ~60 more |
| Hoadhaa Core | `Projects/Hoadhaa/boards/hoadha-tasks.json` | 241 | done 142, planned 27, blocked 6, next 1, todo 58, preserved 2, in_progress 5 | id, phase, sprint, title, workers, status, depends_on, dispatched_at, dispatched_by, completed_at, acceptance, epic, evidence, gate_evaluation, priority, verification |
| Hoadhaa Social | `Projects/Hoadhaa/boards/hoadha-social-tasks.json` | 56 | done 42, in_progress 6, todo 8 | id, phase, sprint, title, workers, status, depends_on, completed_at, verification |
| Hoadhaa Concierge | `Projects/Hoadhaa/boards/hoadha-concierge-tasks.json` | 27 | in_progress 4, todo 23 | id, phase, sprint, title, workers, status, depends_on, dispatched_at, dispatched_by, note_status, is_gate |

**Total:** 761 task records. (Task directive cited 763; the two-difference may reflect the legacy baseline snapshot at 388 tasks vs current 437, or records in `board2/operating-state.json` tasks array.)

**Nexus status model:** `done | planned | in_progress | closed | blocked | next | todo | preserved` — 8 values, no REVIEW/VERIFICATION/ACCEPTANCE/FOUNDER_GATE stages.

**Nexus workflow:** Phase → Sprint → Epic → Task hierarchy; `depends_on` arrays; `dispatched_by`/`workers` assignment; `lane` (ERP only); Kanban columns computed in generated-TS (`_col`, `_blockers`, `_actionable`, `_unblocks`); board2 `operating-state.json` tracks supplierLane, packets, missions, criticalPath.

---

## 3. Command PM Contract (evidence)

### 3a. SQLite schema (`00_STARQ_HQ/operations/starq-command/data/pm-board.db`)

**pm_tasks:**
```
id TEXT PK, project_id TEXT FK, title TEXT, description TEXT, priority TEXT (P0-P3, default P2),
status TEXT (BACKLOG|READY|IN_PROGRESS|REVIEW|VERIFICATION|ACCEPTANCE|CLOSED|BLOCKED|FOUNDER_GATE),
prior_status TEXT, owner TEXT (default UNASSIGNED), verifier TEXT (default UNASSIGNED),
room_authorization_ref TEXT, evidence_refs TEXT (JSON '[]'), depends_on TEXT (JSON '[]'),
notes TEXT, created_by TEXT, created_at TEXT, updated_at TEXT, closed_at TEXT
```

**pm_status_log:**
```
id AI PK, task_id TEXT FK, event_type TEXT, from_status TEXT, to_status TEXT, actor TEXT,
detail TEXT JSON, timestamp TEXT, room_sync TEXT (NOT_REQUIRED|DISABLED|PENDING|POSTED),
room_ref TEXT, room_error TEXT, room_attempts INT
```

**pm_projects:** 3 rows — `command` (CMD), `erp` (ERP), `hoadha` (HOA); all `next_seq=1`, 0 tasks.

**pm_meta:** schema_version=1, db_id=uuid, created_at=2026-10-13T17:31:08.346Z.

### 3b. Board candidate (`board/command-board.json`, schema `board-schema.json`)

- Board ID: `STARQ-COMMAND-MODS`, schema 1.0.0, revision 1, status `CANDIDATE_NOT_ACCEPTED`
- Last reconciled Room head: #9455
- Exactly 33 tasks (schema-enforced minItems/maxItems 33)
- All tasks: `workflow_stage="unknown"`, `current_owner="UNKNOWN"`, `current_verifier="UNKNOWN"`, `current_authorization_status="not_authorized_for_new_task_execution"`
- Task disposition breakdown: accepted_scoped (14), rejected (2: CMD-DI-1-3, CMD-DI-1-4), closed_scope (2), superseded (2), undecided (4), unknown (9)
- Task fields (17 required): id, title, programme, source_qualifier, source_state, source_owner_at_checkpoint, source_record, current_owner, current_verifier, workflow_stage, disposition, disposition_basis, current_authorization_status, authorization_refs (roomRef[]), independent_verdict_refs (roomRef[]), blocker, evidence_refs (evidenceRef[]), room_overlay_refs (overlayRef[]), supersedes, superseded_by
- `roomRef`: {sequence, eventId, recordHash, previousRecordHash, senderHandle, purpose} — Room-anchored
- `evidenceRef`: {kind, path, sha256, source_row_index}

### 3c. PM projects (`board/pm-projects.json`)

- ERP source_gap: `starqNexus/data/starq-erp-tasks.json` absent from workspace; 437-vs-407 discrepancy (D2) unresolved; no ERP tasks imported
- Hoadhaa source_gap: `starqNexus/data/hoadha-*.json` and `03_PROJECTS/hoadha/HOADHA_DEV_STUDIO/` absent; no Hoadhaa tasks imported
- All projects: human-operated, insert-only, tasks added only with Room authorization reference

---

## 4. Field-by-Field Mapping

### 4a. Direct mappings (Nexus → Command)

| Nexus field | Command field | Notes |
|---|---|---|
| `id` | `id` | Direct; ID prefix conventions differ (SERP-/DHIV-/HSOC-/HIE- vs CMD-/ERP-/HOA-) |
| `title` | `title` | Direct |
| `depends_on` | `depends_on` | Both JSON arrays of task IDs |
| `workers[]` | `owner` + `verifier` | Nexus has multiple workers; Command has single owner + single verifier |
| `status` | `status` | Requires translation (see 4b) |
| `dispatched_at` / `completed_at` | `created_at` / `updated_at` / `closed_at` | Partial; Command lacks `dispatched_at` |
| `dispatched_by` | `created_by` | Partial semantic match |
| `description` | `description` | Direct |
| `notes` | `notes` | Direct |
| `evidence` | `evidence_refs` | Nexus evidence is free-form; Command requires structured {kind, path, sha256, source_row_index} |

### 4b. Status model translation (Nexus → Command)

| Nexus status | Count (all boards) | Command status | Translation |
|---|---|---|---|
| done | 232+142+42 = 416 | CLOSED or ACCEPTANCE | Depends on independent verification |
| planned | 192+27+8 = 227 | BACKLOG or READY | Depends on room_authorization_ref |
| in_progress | 12+5+6+4 = 27 | IN_PROGRESS | Direct |
| blocked | 6+6 = 12 | BLOCKED | Direct |
| todo | 58+8+23 = 89 | BACKLOG | Likely mapping |
| next | 1 | READY | Likely mapping |
| preserved | 2 | CLOSED | Likely mapping |
| closed | 1 | CLOSED | Direct |

**Command-only statuses with no Nexus equivalent:** REVIEW, VERIFICATION, ACCEPTANCE, FOUNDER_GATE.

### 4c. Fields in Nexus with no Command equivalent (would be lost on import)

`phase`, `sprint`, `epic`, `priority` (Nexus P0-P3 exists but Command has it — partial match), `lane`, `release_track`, `phase_mapping`, `blueprint_phase`, `is_ci_pilot`, `primary_contributor`, `contributors`, `acceptance_criteria`, `acceptance_evidence`, `accepted_at`, `accepted_by`, `gate_evaluation`, `verification`, `review_gate`, `reviewer`, `milestone`, `project`, `commit`, `merge_commit`, `vault_ref`, `worktree`, `children`, `parent`, `related`, `blocked_by`, `blocks`, `gate_landed`, `work_log`, `work_queue`, plus ~50 more ERP-specific fields.

### 4d. Fields in Command with no Nexus equivalent (would need to be added)

`room_authorization_ref` (mandatory Room anchor — no Nexus equivalent), `prior_status` (status-transition audit), `room_sync` (Room sync state machine), `room_ref` / `room_error` / `room_attempts` (in pm_status_log), `closed_at`, `created_by` (Nexus has dispatched_by but not created_by).

### 4e. Authorization model gap

- **Nexus:** Authorization via `dispatched_by` (agent name), `workers[]`, Founder rulings recorded in board changelog and evidence memos. No per-task Room sequence anchor in task records.
- **Command:** `room_authorization_ref` required per task; `authorization_refs` and `independent_verdict_refs` are arrays of `roomRef` (sequence, eventId, recordHash, previousRecordHash, senderHandle, purpose). All 33 board tasks are `not_authorized_for_new_task_execution`. No task may execute without a per-task Founder authorization carrying a Room reference.

---

## 5. Gap Map

### 5a. Maps directly (no translation needed)

| # | Element | Mapping |
|---|---|---|
| G-01 | Task `id` | Direct string match |
| G-02 | Task `title` | Direct string match |
| G-03 | Task `description` | Direct string match |
| G-04 | Task `notes` | Direct string match |
| G-05 | `depends_on` arrays | Direct (JSON array of task IDs) |
| G-06 | `status: in_progress` → `IN_PROGRESS` | Direct value match |
| G-07 | `status: blocked` → `BLOCKED` | Direct value match |
| G-08 | `status: closed` → `CLOSED` | Direct value match |
| G-09 | `dispatched_by` → `created_by` | Partial semantic match |
| G-10 | Project prefix convention | ERP→ERP, Hoadhaa→HOA (Command lacks dedicated Hoadhaa Social/Concierge projects) |

### 5b. Requires translation

| # | Element | Translation needed |
|---|---|---|
| T-01 | Nexus `status` (8 values) → Command `status` (9 values) | 416 "done" → CLOSED/ACCEPTANCE; 227 "planned" → BACKLOG/READY; 89 "todo" → BACKLOG; 1 "next" → READY; 2 "preserved" → CLOSED |
| T-02 | Nexus `workers[]` (multi-assignee) → Command `owner` + `verifier` (single each) | Must pick primary owner; verifier has no Nexus equivalent |
| T-03 | Nexus `dispatched_at` → Command `created_at` / `updated_at` | No `dispatched_at` column in Command |
| T-04 | Nexus `evidence` (free-form) → Command `evidence_refs` (structured {kind,path,sha256,source_row_index}) | Requires SHA-256 hashing and row indexing |
| T-05 | Nexus `priority` (P0-P3 on ERP tasks) → Command `priority` (P0-P3) | Direct where present; most Hoadhaa tasks lack priority |
| T-06 | Nexus Kanban columns (`_col`: done/wip/todo/blocked) → Command workflow stages | Command has REVIEW/VERIFICATION/ACCEPTANCE/FOUNDER_GATE stages Nexus lacks |

### 5c. Missing in Command (Nexus has, Command lacks)

| # | Element | Nexus presence | Command absence |
|---|---|---|---|
| M-01 | `phase` / `sprint` / `epic` hierarchy | All 4 boards | No phase/sprint/epic columns in pm_tasks |
| M-02 | `lane` (Kanban swimlane) | ERP tasks | Not in Command schema |
| M-03 | `release_track` / `blueprint_phase` | ERP tasks | Not in Command schema |
| M-04 | `acceptance_criteria` / `acceptance_evidence` | ERP tasks | Not in Command schema |
| M-05 | `gate_evaluation` / `review_gate` / `reviewer` | Hoadhaa Core | Not in Command schema |
| M-06 | `milestone` | ERP tasks | Not in Command schema |
| M-07 | `commit` / `merge_commit` / `vault_ref` / `worktree` | ERP tasks (git-anchored) | Not in Command schema |
| M-08 | `blocked_by` / `blocks` (reverse deps) | ERP/Hoadhaa | Only `depends_on` (forward) in Command |
| M-09 | `children` / `parent` / `related` (task graph) | ERP tasks | Not in Command schema |
| M-10 | `work_log` / `work_queue` | ERP tasks | Not in Command schema |
| M-11 | Kanban board UI with computed columns (`_col`, `_blockers`, `_actionable`, `_unblocks`) | Nexus build pipeline | Command has no board UI; board candidate is JSON-only |
| M-12 | `board2/operating-state.json` (supplierLane, packets, missions, criticalPath) | Nexus operational surface | No Command equivalent |

### 5d. Missing in Nexus (Command has, Nexus lacks)

| # | Element | Command presence | Nexus absence |
|---|---|---|---|
| N-01 | `room_authorization_ref` per task | Required in pm_tasks | No Room anchor in Nexus tasks |
| N-02 | `prior_status` transition audit | pm_tasks column | No status history in Nexus |
| N-03 | `room_sync` state machine (NOT_REQUIRED/DISABLED/PENDING/POSTED) | pm_status_log | No Room sync in Nexus |
| N-04 | `roomRef` authorization + independent verdict refs | Board task schema | No Room event references in Nexus tasks |
| N-05 | `closed_at` timestamp | pm_tasks column | Nexus has `completed_at` but not `closed_at` |
| N-06 | `created_by` (distinct from `dispatched_by`) | pm_tasks column | Nexus has `dispatched_by` only |
| N-07 | `evidence_refs` with SHA-256 + source_row_index | Structured array | Nexus evidence is unstructured |

### 5e. Structural gaps

| # | Element | Detail |
|---|---|---|
| S-01 | Zero tasks in Command DB | pm_tasks = 0 rows; pm_status_log = 0 rows; all 3 projects at next_seq=1 |
| S-02 | Board candidate not imported | 33 board rows are CANDIDATE_NOT_ACCEPTED, stale at Room #9455; not in pm-board.db |
| S-03 | No Hoadhaa Social / Concierge project | Command has only command/erp/hoadha projects |
| S-04 | 437-vs-407 ERP discrepancy (D2) | Unresolved per pm-projects.json source_gap |
| S-05 | No import path | pm-projects.json: "No ERP/Hoadhaa tasks were imported or invented. Tasks may be added by a human with a Room authorization reference." |

---

## 6. Recommendation

**Do not auto-import Nexus tasks into Command.** The Command PM contract requires per-task `room_authorization_ref` with a Room reference, and all 33 existing board candidates are `not_authorized_for_new_task_execution`. Auto-import would violate the authorization model.

**If import is authorized:** a per-task Founder authorization (Room-referenced) is required for each task. The field translation layer (T-01 through T-06) and the missing-field decisions (M-01 through M-12) must be resolved per-project before any row is written.

**Evidence base:** All file paths, counts, status distributions, and schemas above were read directly from disk; no database or source mutations were performed.

---

*End of gap map. Posted to Room under @pi per Founder Directive #10596.*
