# STARQ COMMAND — FUNCTIONAL ACCEPTANCE REPORT
**Execution Date:** 2026-11-01T15:38:43.470Z  
**Integration candidate:** `cursor/final-integration-20261102`  
**Suite origin:** Antigravity functional acceptance suite, preserved and re-run on this candidate  
**Worktree:** `D:/StarqTech/_worktrees/cursor-final-integration`  
**Lifecycle commits included:** `db9d620`, `7ddccf8`  

---

## 1. Executive Summary

The preserved twelve-journey acceptance suite was re-run on the integration candidate after the milestone form and organization-import probe were added.

- **Browser Acceptance Suite (Vitest / JSDOM):** 12 / 12 PASS (7.66s)
- **Live Node E2E Suite (Scratch PM Server :5190–:5199 / os.tmpdir()):** 12 / 12 PASS (3.44s)
- **HTML Visual Audit Artifacts:** 12 DOM snapshots captured in `artifacts/acceptance/html/`
- **Provenance correction:** `1770261` is included. Copilot's focused retest requested in Room #17423 was still pending when this report was generated, so this run does not record that correction as accepted.
- **Isolation Boundary:** Scratch PM only. No writes to canonical `data/*.db`.

---

## 2. Twelve User Journeys Acceptance Matrix

| # | User Journey | Browser Surface | Live E2E API | Overall Status | Observed Reality & Evidence |
|---|---|:---:|:---:|:---:|---|
| 1 | Fresh empty installation & first org creation | PASS | PASS | **PASS** | FirstRun surface detects empty DB, prompts company creation, stores company in SQLite. |
| 2 | First-person registration & onboarding | PASS | PASS | **PASS** | Validates handle, registers first person (`HUMAN`), sets claimed actor in session. |
| 3 | Department & workforce creation | PASS | PASS | **PASS** | Department created, Lead position created, digital worker registered (`AGY`), appointed. |
| 4 | Project & milestone creation | PASS | PASS | **PASS** | Project creation form is on the portfolio. The project board has a Create milestone form that posts to the milestone API. |
| 5 | Board & work-package creation | PASS | PASS | **PASS** | Kanban lanes (TODO, NEXT, IN_PROGRESS, BLOCKED, DONE) render task cards and work packages. |
| 6 | Task assignment & state transitions | PASS | PASS | **PASS** | Reassignment to digital worker and status transition (`NEXT`) enforce optimistic concurrency (`expected_updated_at`). |
| 7 | Workforce activity & operational visibility | PASS | PASS | **PASS** | DailyActivity surface renders live `next_actions`, daily digest summary, and follow-ups. |
| 8 | Communication, evidence & review workflows | PASS | PASS | **PASS** | Comms surface renders channel directory and messages; task evidence attachment verified in task details. |
| 9 | Org archive/revival & dependency rules | PASS | PASS | **PASS** | `HAS_DEPENDENTS` (409) strictly refuses archiving units with active positions and positions with active appointments. |
| 10 | Restart persistence without record resurrection | PASS | PASS | **PASS** | PM service terminated and restarted against the same database; all entities and task states persist truthfully. |
| 11 | Optional org snapshot import on clean database | PASS | PASS | **PASS** | Canonical import succeeds on a clean database and a non-empty target is still refused. GET /api/pm/import/organization returns available:true. |
| 12 | Founder dashboard navigation & daily workflows | PASS | PASS | **PASS** | FounderHome displays primary operational picture, claimed actor badge, attention items, health OK. |

---

## 3. Discovered Realities & Actionable Findings

1. **Milestone creation form:** the project board now has a Create milestone form. It posts the title, an optional due date, the project id, and the claimed actor to the existing milestone API.
2. **Organization import probe:** GET /api/pm/import/organization returns available:true. FirstRun offers import when that probe is present. POST still refuses a non-empty target.

3. **[Hierarchy Integrity Confirmed] Dependency Rules Enforced (Journey 9):**
   - **Severity:** Verified Invariant
   - **Observed Behavior:** Unit archive is blocked while positions exist; position archive is blocked while appointments exist. Both return HTTP 409 with code `HAS_DEPENDENTS`.

---

## 4. Verification Evidence & Artifacts

- **Browser DOM Snapshots:**
  - `artifacts/acceptance/html/workflow-01-first-run.html`
  - `artifacts/acceptance/html/workflow-02-onboarding.html`
  - `artifacts/acceptance/html/workflow-03-workforce.html`
  - `artifacts/acceptance/html/workflow-04-project-creation.html`
  - `artifacts/acceptance/html/workflow-05-pm-board.html`
  - `artifacts/acceptance/html/workflow-06-task-transitions.html`
  - `artifacts/acceptance/html/workflow-07-activity-visibility.html`
  - `artifacts/acceptance/html/workflow-08-comms-evidence.html`
  - `artifacts/acceptance/html/workflow-09-org-archive.html`
  - `artifacts/acceptance/html/workflow-10-persistence.html`
  - `artifacts/acceptance/html/workflow-11-snapshot-import.html`
  - `artifacts/acceptance/html/workflow-12-founder-home.html`

- **Automated Test Suites:**
  - `tests/functional-browser-acceptance.test.tsx` (Vitest / React 18 / JSDOM)
  - `tests/functional-e2e-acceptance.test.mjs` (Node test runner / Live PM :5190–:5199)
  - `scripts/run-functional-acceptance.mjs` (Single command acceptance runner)
