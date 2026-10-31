# Starq Command — Local Operating System API Contract (CV-AG0)

**Version:** 1.0.0  
**Date:** 31 October 2026  
**Workstream:** Antigravity (`CV-AG0` through `CV-AG5`)  
**Service:** PM Operating Service (`server/pm-service.mjs` + `server/pm-ops-routes.mjs`, default `http://127.0.0.1:5176`)

---

## 1. Authority, Security & Transport Envelope

### 1.1 Transport Guards
- **Host binding:** `127.0.0.1` only (loopback-enforced).
- **Mutating methods (`POST`, `PATCH`):**
  - Require header `X-PM-Client: starq-command`.
  - Require header `Content-Type: application/json` (empty body allowed on parameterless triggers when header is present).
  - If `Origin` header is present, it must match an allowed loopback origin (`http://127.0.0.1:5173`, `http://localhost:5173`, `http://127.0.0.1:5176`, `http://localhost:5176`, or `COMMAND_UI_ORIGIN`).
  - `GET` and `HEAD` never mutate state.

### 1.2 Authority Tiering (`T0` vs `T1`)
Per `00_MASTER_PLAN.md` §4 and `03_CLAUDE_PACKAGE.md` (`CV-C2`):
- **All endpoints in `CV-AG1` through `CV-AG4` are Tier 0 (`T0` — Ordinary Local Operations).**
- Caller supplies a claimed `actor` handle (e.g. `mustarq`, `antigravity-command`, `cursor`) and optional `channel` (`'ui' | 'api' | 'automation'`, defaulting to `'ui'` when `Origin` is present and `'api'` otherwise).
- Every mutation writes a durable audit record (`org_audit` for organization/workforce/follow-up/digest actions, `pm_status_log` for project/milestone/task actions) with `root_authority: false` (claimed actor, not broker-verified `T1` attestation).
- Nothing in `CV-AG1`–`CV-AG4` satisfies a `T1` gate (independent verifier `DONE` acceptance or Founder `ON_HOLD` override).

### 1.3 Standard Error Shape
All error responses return HTTP `400`, `403`, `404`, `405`, `409`, `413`, `415`, or `503` with JSON:
```json
{
  "error": "HUMAN_READABLE_MESSAGE",
  "code": "MACHINE_ERROR_CODE"
}
```

| HTTP Status | Error Code | Meaning |
|---|---|---|
| `400` | `BAD_REQUEST` | Missing/invalid field, unknown field, invalid enum, or malformed JSON |
| `400` | `INVALID_TRANSITION` | Illegal stage/status transition |
| `403` | `FORBIDDEN_ORIGIN` / `CSRF_HEADER_REQUIRED` | Missing `X-PM-Client: starq-command` or untrusted `Origin` |
| `404` | `NOT_FOUND` | Target entity (`company`, `unit`, `position`, `person`, `appointment`, `project`, `milestone`, `task`, `followup`, `digest`) does not exist |
| `405` | `METHOD_NOT_ALLOWED` | Unsupported HTTP verb |
| `409` | `DUPLICATE_ID` / `DUPLICATE_HANDLE` | Entity ID or person handle already exists |
| `409` | `INVALID_REFERENCE` | Referenced `company_id`, `unit_id`, `parent_id`, `position_id`, `reports_to_position_id`, `person_id`, `project_id`, or `milestone_id` does not exist or mismatches parent scope |
| `409` | `ARCHIVED_TARGET` | Referenced target is archived (`archived_at IS NOT NULL`) and cannot receive new children or appointments |
| `409` | `UNIT_CYCLE` | Moving unit `parent_id` would create a cycle in `org_units` |
| `409` | `POSITION_CYCLE` | Setting `reports_to_position_id` would create a reporting cycle in `org_positions` |
| `409` | `APPOINTMENT_ALREADY_ENDED` | Appointment is already in `ENDED` status |
| `409` | `STALE_WRITE` | `expected_updated_at` does not match current row `updated_at` |

---

## 2. CV-AG1 — Organization Completion & Audit History

### 2.1 Schema Migrations (`server/operating-org.mjs`)
All migrations are idempotent (`CREATE TABLE IF NOT EXISTS` and `PRAGMA table_info` column checks):

1. **Additive columns on existing tables:**
   - `org_units`: `archived_at TEXT`, `updated_at TEXT`
   - `org_positions`: `archived_at TEXT`, `updated_at TEXT`
   - `org_people`: `harness TEXT`, `capabilities_json TEXT NOT NULL DEFAULT '[]'`, `status TEXT NOT NULL DEFAULT 'active'`, `source TEXT NOT NULL DEFAULT 'manual'`, `room_handle TEXT`, `archived_at TEXT`, `updated_at TEXT`

2. **New table `org_audit`:**
   ```sql
   CREATE TABLE IF NOT EXISTS org_audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     entity TEXT NOT NULL,
     entity_id TEXT NOT NULL,
     action TEXT NOT NULL,
     actor TEXT NOT NULL,
     channel TEXT NOT NULL DEFAULT 'api' CHECK (channel IN ('ui', 'api', 'automation')),
     before_json TEXT,
     after_json TEXT,
     timestamp TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_org_audit_entity ON org_audit(entity, entity_id, id DESC);
   CREATE INDEX IF NOT EXISTS idx_org_audit_actor ON org_audit(actor, id DESC);
   ```
   Protected by append-only triggers `org_audit_no_update` and `org_audit_no_delete`.

### 2.2 Routes

#### `GET /api/pm/org`
- **Query params:**
  - `include=archived` (optional): when omitted, filters out rows where `archived_at IS NOT NULL` from `units`, `positions`, and `people`, and returns active appointments in `appointments` (plus `ended_appointments` array for historical record visibility). When `include=archived` is passed, archived units, positions, and people are included in `units`, `positions`, and `people` alongside `archived_units`, `archived_positions`, `archived_people`, and `ended_appointments`.
- **Response (`200 OK`):**
  ```json
  {
    "state": "OK",
    "authority": "PM_OPERATING_RECORD",
    "generated_at": "2026-10-31T18:00:00.000Z",
    "include_archived": false,
    "companies": [ ... ],
    "units": [ ... ],
    "positions": [ ... ],
    "people": [ ... ],
    "appointments": [ ... ],
    "ended_appointments": [ ... ],
    "counts": {
      "companies": 1,
      "units": 5,
      "positions": 11,
      "people": 13,
      "active_appointments": 11,
      "ended_appointments": 0,
      "vacant_positions": 0
    }
  }
  ```

#### `PATCH /api/pm/org/companies/:id`
- **Request body:** `{ "actor": "mustarq", "channel"?: "ui"|"api"|"automation", "name"?: string, "legal_name"?: string|null, "notes"?: string|null }`
- **Behavior:** Updates company fields and `updated_at`, writes `org_audit` (`entity: 'company'`, `action: 'UPDATE'`).
- **Response (`200 OK`):** `{ "state": "OK", "company": { ... } }`

#### `PATCH /api/pm/org/units/:id`
- **Request body:**
  ```json
  {
    "actor": "mustarq",
    "channel": "ui",
    "name": "Platform & Core Engineering",
    "description": "Updated charter",
    "kind": "DEPARTMENT",
    "parent_id": "unit_exec",
    "archived": false
  }
  ```
- **Validations:**
  - `kind` in `'DEPARTMENT' | 'TEAM' | 'OFFICE'`.
  - If `parent_id` is non-null: must exist in `org_units`, belong to the same `company_id`, not be archived (`ARCHIVED_TARGET`), and not be `id` or a descendant of `id` (`409 UNIT_CYCLE`).
  - `archived: true` sets `archived_at = nowIso()`; `archived: false` sets `archived_at = null`.
- **Audit:** Writes `org_audit` (`entity: 'unit'`, `action: 'UPDATE' | 'ARCHIVE' | 'UNARCHIVE'`).
- **Response (`200 OK`):** `{ "state": "OK", "unit": { ... } }`

#### `PATCH /api/pm/org/positions/:id`
- **Request body:**
  ```json
  {
    "actor": "mustarq",
    "channel": "ui",
    "title": "Principal Architect",
    "job_description": "Updated JD",
    "unit_id": "unit_engineering",
    "reports_to_position_id": "pos_founder_md",
    "archived": false
  }
  ```
- **Validations:**
  - If `unit_id` changed: must exist in same `company_id` and not be archived (`ARCHIVED_TARGET`).
  - If `reports_to_position_id` is non-null: must exist in same `company_id`, not be archived (`ARCHIVED_TARGET`), and not be `id` or a subordinate in `id`'s reporting chain (`409 POSITION_CYCLE`).
- **Audit:** Writes `org_audit` (`entity: 'position'`, `action: 'UPDATE' | 'ARCHIVE' | 'UNARCHIVE'`).
- **Response (`200 OK`):** `{ "state": "OK", "position": { ... } }`

#### `PATCH /api/pm/org/people/:id`
- **Request body:**
  ```json
  {
    "actor": "mustarq",
    "channel": "ui",
    "display_name": "Antigravity (AG)",
    "kind": "DIGITAL",
    "status": "active",
    "harness": "antigravity",
    "capabilities": ["architecture", "org-ops", "sqlite"],
    "room_handle": "antigravity-command",
    "role_note": "Updated note",
    "archived": false
  }
  ```
- **Lookup:** `:id` matches `org_people.id` or `org_people.handle`.
- **Validations:**
  - `kind` in `'HUMAN' | 'DIGITAL'`.
  - `status` in `'active' | 'inactive'`.
  - `capabilities` (array of strings) serialized to `capabilities_json`.
- **Audit:** Writes `org_audit` (`entity: 'person'`, `action: 'UPDATE' | 'ARCHIVE' | 'UNARCHIVE'`).
- **Response (`200 OK`):** `{ "state": "OK", "person": { ... } }`

#### `POST /api/pm/org/appointments/:id/end` (also aliased as `PATCH /api/pm/org/appointments/:id`)
- **Request body:**
  ```json
  {
    "actor": "mustarq",
    "channel": "ui",
    "notes": "Handover complete",
    "reassign_to_person_id": "person_vision",
    "reassign_notes": "Appointed as successor"
  }
  ```
- **Behavior:**
  - Sets `status = 'ENDED'`, `ended_at = nowIso()`, and updates `notes` if provided on appointment `:id`. Never deletes rows.
  - If `reassign_to_person_id` is provided: validates the target person exists and is not archived (`ARCHIVED_TARGET`), and atomically creates a new `ACTIVE` appointment for the same `position_id`.
  - Writes `org_audit` (`entity: 'appointment'`, `action: 'END'` and, if reassigned, `action: 'CREATE'` for the new appointment).
- **Response (`200 OK`):** `{ "state": "OK", "ended_appointment": { ... }, "new_appointment": { ... } | null }`

#### `GET /api/pm/org/history`
- **Query params:** `entity` (optional: `company|unit|position|person|appointment|followup|digest`), `id` (optional: `entity_id`), `limit` (optional, default `100`, max `500`).
- **Response (`200 OK`):**
  ```json
  {
    "state": "OK",
    "count": 2,
    "history": [
      {
        "id": 12,
        "entity": "unit",
        "entity_id": "unit_engineering",
        "action": "UPDATE",
        "actor": "mustarq",
        "channel": "ui",
        "before": { ... },
        "after": { ... },
        "timestamp": "2026-10-31T18:05:00.000Z"
      }
    ]
  }
  ```

---

## 3. CV-AG2 — Unified Human + Agent Workforce

### 3.1 `org_people` Record Shape
Every person object returned by `GET /api/pm/org`, `POST /api/pm/org/people`, `PATCH /api/pm/org/people/:id`, and `GET /api/pm/workforce/:personId/summary` includes:
```json
{
  "id": "person_antigravity",
  "handle": "antigravity",
  "display_name": "Antigravity (AG)",
  "kind": "DIGITAL",
  "role_note": "Finance Kernel & Core Architecture",
  "harness": "antigravity",
  "capabilities": ["architecture", "typescript", "sqlite"],
  "capabilities_json": "[\"architecture\",\"typescript\",\"sqlite\"]",
  "status": "active",
  "source": "manual",
  "room_handle": "antigravity",
  "created_at": "2026-10-31T12:00:00.000Z",
  "updated_at": "2026-10-31T12:00:00.000Z",
  "archived_at": null
}
```
- **Honesty invariant:** `room_handle` is a nullable reference to `agent-comms/protocol/v1/identities.json` (`canonicalHandle`). No live PID, PTY session, or provider quota is stored in `org_people` or fabricated when Herdr/Room are offline.

### 3.2 Routes

#### `POST /api/pm/org/people/import-identities`
- **Request body:** `{ "actor": "mustarq", "channel"?: "ui"|"api"|"automation" }`
- **Behavior:**
  - Resolves `agent-comms/protocol/v1/identities.json` from workspace root.
  - If `identities.json` is absent or unreadable, returns `200 OK` with `{ "state": "UNAVAILABLE", "reason": "...", "source": null, "created": [], "skipped": [], "conflicts": [] }` (never an unhandled 500 error).
  - Computes file SHA-256 prefix (`identities.json@<sha16>`).
  - For each identity in `identities.json`:
    - If `canonicalHandle` is not yet in `org_people` (by `handle` or `id = person_<handle>`), creates a row (`kind: 'HUMAN'` only if `authorityIdentityId === 'founder'`, otherwise `'DIGITAL'`, `status: identity.status === 'retired' ? 'inactive' : 'active'`, `source: 'identities.json@<sha16>'`, `room_handle: identity.canonicalHandle`, `harness` from known staff profile or null) and writes an `org_audit` row (`action: 'IMPORT'`).
    - If a row already exists in `org_people`: **never overwrites existing manual fields**. Records the handle in `skipped` (or `conflicts` if existing `kind` disagrees with identity authority class).
- **Response (`200 OK`):**
  ```json
  {
    "state": "OK",
    "source": "identities.json@a1b2c3d4e5f60123",
    "created": [ ... ],
    "skipped": [ ... ],
    "conflicts": [ ... ]
  }
  ```

#### `GET /api/pm/workforce/:personId/summary`
- **Lookup:** `:personId` matches `org_people.id` or `org_people.handle`.
- **Response (`200 OK`):**
  ```json
  {
    "state": "OK",
    "person": { ... },
    "appointments": {
      "active": [ ... ],
      "ended": [ ... ]
    },
    "tasks": {
      "owned_open": [ ... ],
      "verifying_open": [ ... ],
      "blocked": [ ... ],
      "counts": {
        "owned_open": 2,
        "verifying_open": 1,
        "blocked": 0
      }
    },
    "recent_activity": [
      {
        "source": "pm_status_log",
        "id": 42,
        "entity": "task",
        "entity_id": "PM-CMD-001",
        "action": "STAGE_CHANGE",
        "actor": "antigravity",
        "timestamp": "2026-10-31T17:00:00.000Z",
        "detail": { "from_status": "BACKLOG", "to_status": "IN_PROGRESS" }
      }
    ]
  }
  ```

---

## 4. CV-AG3 — Projects, Milestones, Deliverables & Dependencies

### 4.1 Schema Migrations
1. **`pm_projects` additive columns:**
   - `status TEXT NOT NULL DEFAULT 'active'` (`'active' | 'on_hold' | 'completed' | 'archived'`)
   - `owner TEXT NOT NULL DEFAULT 'UNASSIGNED'`
   - `updated_at TEXT`
   - `archived_at TEXT`
2. **New table `pm_milestones`:**
   ```sql
   CREATE TABLE IF NOT EXISTS pm_milestones (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES pm_projects(id),
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     due_date TEXT,
     status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'done', 'missed')),
     ordinal INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_pm_milestones_project ON pm_milestones(project_id, ordinal, id);
   ```
   Protected by `pm_milestones_no_delete` trigger.
3. **`pm_tasks` additive columns:**
   - `milestone_id TEXT REFERENCES pm_milestones(id)` (nullable; legacy `milestone TEXT` column remains untouched)
   - `work_package TEXT`
   - `is_deliverable INTEGER NOT NULL DEFAULT 0`
   - `deliverable_kind TEXT`

### 4.2 Routes

#### `PATCH /api/pm/projects/:id`
- **Request body:**
  ```json
  {
    "actor": "mustarq",
    "name": "Starq Command",
    "description": "Local organizational operating system",
    "status": "active",
    "owner": "mustarq",
    "archived": false
  }
  ```
- **Behavior:** Updates project fields, sets `archived_at` when `archived` is boolean or `status === 'archived'`, records `org_audit` (`entity: 'project'`, `action: 'UPDATE' | 'ARCHIVE' | 'UNARCHIVE'`).
- **Filtering:** `GET /api/pm/projects` and `GET /api/pm/portfolio` exclude archived projects (`archived_at IS NOT NULL`) by default unless `?include=archived` is passed.
- **Response (`200 OK`):** `{ "state": "OK", "project": { ... } }`

#### `GET /api/pm/milestones`
- **Query params:** `project_id` (optional).
- **Computed Progress & Risk:**
  For each milestone, computes from `pm_tasks WHERE milestone_id = m.id`:
  - `total_tasks`, `done_tasks`, `open_tasks`, `blocked_tasks`
  - `by_stage`: `{ BACKLOG, IN_PROGRESS, REVIEW, BLOCKED, DONE }`
  - `percent_complete`: integer `0..100` (`total_tasks === 0 ? (m.status === 'done' ? 100 : 0) : Math.round((done_tasks / total_tasks) * 100)`)
  - `overdue`: boolean (`due_date != null && open_tasks > 0 && due_date < todayYmd`)
  - `at_risk`: boolean (`m.status !== 'done' && due_date != null && open_tasks > 0 && due_date <= plus7DaysYmd`)
- **Response (`200 OK`):** `{ "state": "OK", "count": 2, "milestones": [ ... ] }`

#### `POST /api/pm/milestones`
- **Request body:**
  ```json
  {
    "actor": "mustarq",
    "id": "ms_cmd_conv",
    "project_id": "command",
    "title": "Convergence Release",
    "description": "All AG/Cursor/Claude packages integrated",
    "due_date": "2026-11-03",
    "status": "active",
    "ordinal": 1
  }
  ```
- **Validations:** `project_id` must exist in `pm_projects` and not be archived (`ARCHIVED_TARGET`). `status` in `'planned' | 'active' | 'done' | 'missed'`.
- **Response (`201 Created`):** `{ "state": "OK", "milestone": { ... } }`

#### `GET /api/pm/milestones/:id`
- **Response (`200 OK`):** `{ "state": "OK", "milestone": { ... }, "tasks": [ ... ] }`

#### `PATCH /api/pm/milestones/:id`
- **Request body:** `{ "actor": "mustarq", "title"?: string, "description"?: string, "due_date"?: string|null, "status"?: "planned"|"active"|"done"|"missed", "ordinal"?: number }`
- **Response (`200 OK`):** `{ "state": "OK", "milestone": { ... } }`

#### Task Extensions (`POST /api/pm/tasks`, `PATCH /api/pm/tasks/:id`, `POST /api/pm/tasks/:id/artifacts`)
- `POST /api/pm/tasks` and `PATCH /api/pm/tasks/:id` accept optional:
  - `milestone_id` (nullable string; validated to exist in `pm_milestones` with matching `project_id`)
  - `milestone` (legacy text string)
  - `work_package` (string | null)
  - `is_deliverable` (boolean)
  - `deliverable_kind` (string | null, e.g. `'PR' | 'DOCUMENT' | 'RELEASE' | 'MIGRATION' | 'TEST_SUITE'`)
  - `epic`, `sprint`, `phase`, `release_track` (strings | null)
  - `branch`, `commit_sha`, `pr_ref`, `pr_url` (repository artifact fields)
- `POST /api/pm/tasks/:id/artifacts`:
  - Request body: `{ "actor": string, "expected_updated_at": string, "branch"?: string|null, "commit_sha"?: string|null, "pr_ref"?: string|null, "pr_url"?: string|null }`
  - Updates repository artifacts on the task and appends `ARTIFACTS_UPDATED` to `pm_status_log`.
- **Dependency Guard (existing + verified):**
  - Moving a task to `IN_PROGRESS` or `DONE` when any task in `depends_on` is not in stage `DONE` fails with `409 UNMET_DEPENDENCY` naming the blocking task IDs.

#### `GET /api/pm/work-packages`
- **Query params:** `project_id` (optional), `deliverables_only` (`1` or `true`, optional), `milestone_id` (optional).
- **Response (`200 OK`):**
  ```json
  {
    "state": "OK",
    "source": "pm",
    "project_id": "command",
    "count": 4,
    "work_packages": [ ...hydrated tasks... ]
  }
  ```

---

## 5. CV-AG4 — Operations Automation (Digests, Stale Detection, Follow-Ups)

### 5.1 Schema Migrations (`server/ops-automation.mjs`)
```sql
CREATE TABLE IF NOT EXISTS pm_digests (
  id TEXT PRIMARY KEY, -- YYYY-MM-DD
  generated_at TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'auto',
  summary_json TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'OFF',
  delivery_detail TEXT
);

CREATE TABLE IF NOT EXISTS pm_followups (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES pm_tasks(id),
  project_id TEXT NOT NULL REFERENCES pm_projects(id),
  owner TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'STALE_TASK',
  episode_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  stale_days INTEGER NOT NULL,
  last_activity_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'snoozed', 'resolved')),
  snoozed_until TEXT,
  note TEXT,
  actor TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pm_followups_status ON pm_followups(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_followups_task ON pm_followups(task_id);
```

### 5.2 In-Process Automation Engine (`server/ops-automation.mjs`)
- **No external dependency:** Runs inside the PM service process using an injectable clock (`nowFn = () => new Date()`).
- **Daily Digest (`id = YYYY-MM-DD`):**
  - Generated on startup if no row for today (`YYYY-MM-DD` in local/UTC date of `nowFn()`) exists, and checked on periodic tick or explicit `POST /api/pm/digests/generate`.
  - `summary_json` structure:
    ```json
    {
      "date": "2026-10-31",
      "generated_at": "2026-10-31T18:00:00.000Z",
      "completed_last_24h": [ { "id": "...", "title": "...", "project_id": "...", "owner": "...", "updated_at": "..." } ],
      "started_last_24h": [ { "id": "...", "title": "...", "project_id": "...", "owner": "...", "updated_at": "..." } ],
      "blocked_tasks": [ { "id": "...", "title": "...", "project_id": "...", "owner": "...", "blocked_reason": "...", "age_days": 2 } ],
      "unassigned_open_tasks": [ { "id": "...", "title": "...", "project_id": "...", "stage": "BACKLOG" } ],
      "at_risk_milestones": [ { "id": "...", "title": "...", "project_id": "...", "due_date": "...", "open_tasks": 3, "overdue": false } ],
      "person_load": [ { "handle": "antigravity", "owned_open": 2, "in_progress": 1, "blocked": 0, "verifying_open": 1 } ],
      "counts": {
        "completed_last_24h": 1,
        "started_last_24h": 2,
        "blocked_tasks": 1,
        "unassigned_open_tasks": 3,
        "at_risk_milestones": 1,
        "open_followups": 1
      }
    }
    ```
- **Stale Task Detector:**
  - Scans tasks where `stage = 'IN_PROGRESS'` (or `status = 'IN_PROGRESS'`) and `provenance = 'LIVE'`.
  - Determines `last_activity_at` as `MAX(pm_status_log.changed_at)` for that `task_id` (falling back to `pm_tasks.updated_at`).
  - If `nowMs - Date.parse(last_activity_at) >= staleDays * 86_400_000` (default `staleDays = 3`, configurable via `PM_STALE_DAYS`):
    - Computes deterministic `episode_key = "${task.id}@${last_activity_at}"`.
    - Inserts one `pm_followups` row (`INSERT OR IGNORE` on `episode_key`) and writes an `org_audit` record (`entity: 'followup'`, `action: 'CREATE'`, `channel: 'automation'`).
  - If an open follow-up exists for a task that has since moved out of `IN_PROGRESS` or recorded a newer `last_activity_at`, transitions that follow-up to `status = 'resolved'`.
- **Optional Delivery (`PM_DIGEST_DELIVERY=off` by default):**
  - When `PM_DIGEST_DELIVERY !== 'on'`, zero network/subprocess calls are made and `delivery_state = 'OFF'`.
  - When `PM_DIGEST_DELIVERY === 'on'`, attempts best-effort delivery via configured sender; any failure is caught and recorded in `delivery_state = 'FAILED'` and `delivery_detail`, never throwing or blocking PM.

### 5.3 Routes

#### `GET /api/pm/digests`
- **Query params:** `limit` (default `30`).
- **Response (`200 OK`):** `{ "state": "OK", "count": 1, "digests": [ { "id": "2026-10-31", "generated_at": "...", "trigger": "auto", "summary": { ... }, "delivery_state": "OFF", "delivery_detail": null } ] }`

#### `GET /api/pm/digests/:id`
- `:id` may be `'latest'` or `'YYYY-MM-DD'`.
- **Response (`200 OK`):** `{ "state": "OK", "digest": { ... } }`

#### `POST /api/pm/digests/generate`
- **Request body:** `{ "actor"?: string, "date"?: "YYYY-MM-DD", "force"?: boolean }`
- **Behavior:** Generates or refreshes the digest for `date` (default today), audits in `org_audit`, and returns `{ "state": "OK", "created": boolean, "digest": { ... } }`.

#### `GET /api/pm/followups`
- **Query params:** `status` (`open|acknowledged|snoozed|resolved|all`, default `'open'`), `project_id` (optional), `owner` (optional), `include_snoozed` (optional boolean).
- **Behavior:** When `status=open` and `include_snoozed` is not `1`, returns `open` follow-ups plus any `snoozed` follow-ups whose `snoozed_until <= nowIso()`.
- **Response (`200 OK`):** `{ "state": "OK", "count": 1, "followups": [ ... ] }`

#### `POST /api/pm/followups/:id/acknowledge`
- **Request body:** `{ "actor": "mustarq", "note"?: string, "channel"?: "ui"|"api"|"automation" }`
- **Behavior:** Sets `status = 'acknowledged'`, `actor`, `note`, `updated_at = nowIso()`, and writes `org_audit` (`entity: 'followup'`, `action: 'ACKNOWLEDGE'`).
- **Response (`200 OK`):** `{ "state": "OK", "followup": { ... } }`

#### `POST /api/pm/followups/:id/snooze`
- **Request body:** `{ "actor": "mustarq", "until"?: string, "days"?: number, "note"?: string, "channel"?: "ui"|"api"|"automation" }`
- **Behavior:** Sets `status = 'snoozed'`, `snoozed_until` (ISO timestamp computed from `until` or `now + (days || 1) * 86400s`), `actor`, `note`, `updated_at = nowIso()`, and writes `org_audit` (`entity: 'followup'`, `action: 'SNOOZE'`).
- **Response (`200 OK`):** `{ "state": "OK", "followup": { ... } }`
