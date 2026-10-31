# Handover — Antigravity (AG): organizational operating model and application convergence

**Assigned by:** Founder directive "Final Convergence" (31 Oct 2026). Assignment is issued and tracked by Vision on the `starq-command` Hermes board (cards CV-AG0…CV-AG5, see `04_KANBAN_RECONCILIATION.md`).
**Read first:** `00_MASTER_PLAN.md` (§2 architecture, §3 C3–C5, C7, C9, C11, §4 conflict rules) and `06_INTEGRATION_AND_ACCEPTANCE.md`.
**Your role:** make Command's *existing* organization, workforce, project and automation model complete enough for daily operation. **Extend what exists.** Do not create a second org-management architecture, a second database, or a parallel service.

## Starting point (verified 31 Oct 2026)

| Area | What exists — reuse it | File |
|---|---|---|
| Org schema + create | companies; units (COMPANY/DIVISION/DEPARTMENT/TEAM, parent hierarchy); positions (`reports_to_position_id`); people (`kind` HUMAN/DIGITAL); appointments (status, appointed_at, ended_at). Create functions with validation and stable IDs. | `server/operating-org.mjs` |
| Org API | `GET /api/pm/org`; `POST /api/pm/org/{companies,units,positions,people,appointments}` | `server/pm-service.mjs` ~L1482–1541 |
| Projects | `pm_projects`; `GET/POST /api/pm/projects`; `GET /api/pm/portfolio`; `GET /api/pm/roadmaps` | `server/pm-service.mjs` |
| Tasks | Rich `pm_tasks` (stage/status, owner, verifier, depends_on, milestone *text*, work-package fields, provenance); create/read/PATCH with CAS (`expected_updated_at` → 409 STALE_EDIT) | `server/pm-service.mjs`, `server/gated-lifecycle.mjs` |
| Attention | `attention()` ranked next actions with deep links | `server/pm-service.mjs` ~L1131 |
| Audit | `pm_status_log` (task events, actor, detail, timestamp) | `server/pm-service.mjs` `logEvent` |
| Identities | 24 agent identities + authority levels in Room's file | `D:\StarqTech\agent-comms\protocol\v1\identities.json` (read-only) |
| Live data | 1 company, 4 units, 3 positions, 4 people (ali HUMAN; cursor, codex, claude DIGITAL), 2 appointments, 20 projects, 1,349 tasks | `data/pm-operating.db` — never touch it; use a `VACUUM INTO` copy |

## Work packages

### CV-AG0 — API contract (first; reviewed by command-architect before any implementation)

Deliverable: `docs/convergence/API_CONTRACT_LOCAL_OS.md` covering every route, request/response type, error code, migration and audit record for AG1–AG4. Cursor builds against it. **Acceptance:** command-architect review note on the card; Cursor confirms the types are sufficient for CU1–CU4.

### CV-AG1 — Organization completion

- PATCH company, unit (rename, move parent with cycle check, change kind), position (title, JD, reports_to with cycle check), person (display name, kind, status).
- End and reassign appointments (set `ended_at`; never delete).
- Soft archive (`archived_at`) for unit, position and person. Archived records are excluded by default and included with `?include=archived`.
- `org_audit` table: one row per change (entity, entity_id, action, actor, channel `ui|api|automation`, before_json, after_json, timestamp). `GET /api/pm/org/history?entity=&id=`.
- **Absorbs** the open part of t_4a2f736d (audit history), which the command-data specialist did not finish because of dispatcher failures. Start from the QA'd hunk already in `2746c90` and its tests `tests/org-api-integrity.test.mjs` and `tests/org-record-integrity.test.mjs`.
- **Acceptance:** API tests for every mutation (positive, invalid reference, cycle, duplicate, archived target), restart readback, and an audit row per change.

### CV-AG2 — Unified workforce

- `org_people` additive columns: `harness` (e.g. `claude-code`, `codex`, `cursor`, `antigravity`, `hermes:<profile>`), `capabilities_json`, `status` (`active|inactive`), `source` (`manual` | `identities.json@<sha256>`), `room_handle` (nullable).
- `POST /api/pm/org/people/import-identities`: for each identity not yet present, create a DIGITAL person with `source` provenance. **Never overwrite** existing manual fields. Report created, skipped and conflicts. If the file is absent, return a clear UNAVAILABLE result, not an error.
- `GET /api/pm/workforce/:personId/summary`: open tasks owned and verifying, blocked, last 10 audit events by this handle, appointments.
- Coordinate with Claude (CV-C2): handle validation must accept `org_people` handles when `identities.json` is unreadable. Claude owns that boundary in `pm-service.mjs`; you own the registry data.
- **Acceptance:** add a human and an agent, import identities twice (the second run creates nothing), the summary reflects assignments, and everything works with `agent-comms` absent from a fixture workspace.

### CV-AG3 — Projects, milestones, deliverables

- `PATCH /api/pm/projects/:id` (name, description, status, owner) and archive (soft).
- `pm_milestones` (id, project_id, title, description, due_date, status `planned|active|done|missed`, ordinal, created/updated) plus CRUD routes. Tasks get `milestone_id` (nullable). Keep the legacy `milestone` text column untouched.
- Computed progress per milestone (tasks by stage) and an "at risk" flag (due within 7 days with open tasks, or overdue).
- Deliverables: reuse the work-package contract from t_cbb1954e (already in base). Verify which fields exist in schema, API and UI and close the gaps instead of reconstructing lost candidate bytes. This replaces t_ff13652b and t_a5659d52.
- **Acceptance:** J4 in `06_INTEGRATION_AND_ACCEPTANCE.md`. Migration is idempotent on a copy of the live DB (run twice, identical schema and row counts).

### CV-AG4 — Operations automation

- New `server/ops-automation.mjs`, started by the PM service. It uses an in-process timer with an injectable clock and **no external service**.
- **Daily digest** (on start if none today, and at a configurable hour): completed, started, blocked (with age), unassigned, at-risk milestones, per-person load → `pm_digests` row (id = date, so idempotent).
- **Stale detector:** IN_PROGRESS with no event for N days (default 3) → one `pm_followups` row per task per staleness episode.
- **Follow-ups:** list, acknowledge and snooze routes, each audited.
- **Optional delivery:** if enabled *and* Room/StarqBot is reachable, post the digest. Off by default. Failures are recorded and never block.
- **Acceptance:** J8 with an injected clock, no duplicates across restarts, and a test proving no network call when delivery is off.

### CV-AG5 — Projection dependency reduction

- Ensure `server/data-service.mjs` sources that read Room or Herdr degrade to UNAVAILABLE per source, never fail the whole surface, and never block PM.
- Keep this to the narrowest change. data-service is described as "frozen" in several tests, so change only what J10 needs and update those tests explicitly.
- **Acceptance:** J10 with Room, Herdr and Hermes stopped.

## Constraints (binding)

- Routes go in a **new `server/pm-ops-routes.mjs`**, registered by one dispatch line in `pm-service.mjs`. Don't edit other parts of `pm-service.mjs`. Claude owns the authority and identity functions there.
- Migrations are additive and idempotent. No destructive change to existing tables. Never touch the live DB or Room. Use scratch instances (`PM_DB_PATH`, port 5190–5199).
- Keep authority tiers: everything in AG1–AG4 is **T0 (ordinary)**: claimed actor plus audit row. Nothing you build may set `root_authority`, satisfy a verifier attestation, or treat a name as authentication.
- Don't edit `src/**`. Cursor owns the UI and consumes your contract.
- Branch `ag/command-convergence` from `2746c90`. Deliver commits, test output, limitations and integration notes on each CV card.
- Post readiness, progress and results under **your own canonical identity**, following `D:\StarqTech\AGENTS.md`.
