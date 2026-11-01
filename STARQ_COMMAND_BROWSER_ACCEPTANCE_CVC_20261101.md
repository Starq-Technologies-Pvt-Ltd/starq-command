# STARQ Command — Independent Real-Browser Acceptance (combined integration candidate)

**Reviewer:** @claude (Elder) — independent Claude Code browser harness
**Assignment:** Operations Room #17353 (Vision → @claude, ACTION_REQUIRED)
**Date:** 2026-11-01

## Candidate under test
- Branch: `integration/command-convergence-20261031`
- Candidate SHA (checked-out HEAD): `0e3b9aefb6d2a91907dd58582ed8dabf14c7bf48`
  (merge of AG `26f0410` + Cursor `b23ae10` + Claude `46bc971`)
- My isolated worktree: `D:\StarqTech\_worktrees\claude-command-browser-acceptance-20261101`
  on branch `claude/command-browser-acceptance-20261101` (cut from the candidate)

## Environment & isolation (canonical untouched)
- OS: Windows 11; Node v24.15.0; browser: Claude Code built-in browser pane (real Chromium).
- **Disposable PM database:** `...\_worktrees\claude-command-browser-acceptance-20261101\.command-runtime-local\browser-e2e\pm-operating.db`
  (pm health reports `scratch:true`, `integrity:ok`; canonical `data/pm-operating.db` never opened).
- Services launched directly on the product's real ports with the disposable DB:
  - pm-service `127.0.0.1:5176` — `PM_DB_PATH=<disposable>`, `PM_ROOM_POST=off` (no Room writes)
  - data-service `127.0.0.1:5177` — READ-ONLY projection (`COMMAND_PORT=5177`)
  - vite UI `127.0.0.1:5173`
- **Optional companions deliberately OFF:** Herdr/broker (5179/5188), building (5178), Room, WSL — none started.
- Canonical Command was not running before/after (ports verified free); no production service stopped.
- `node_modules` was a junction to the main checkout (deps identical between HEAD and candidate — only scripts differ); no dependency install.

### Why the product's real ports, not arbitrary scratch ports
`src/lib/pm-client.ts` pins the PM client to the **absolute** base `http://127.0.0.1:5176` (`pmPort()` always returns 5176) and pm-service CORS-pins origin `http://127.0.0.1:5173`. This is a deliberate safety design (a "disposable" UI tab cannot redirect writes elsewhere). Consequence: real-browser acceptance **requires** pm on 5176 / UI on 5173; isolation therefore comes from the **disposable DB** (`PM_DB_PATH`), not from alternate ports. First attempt on scratch ports 5192/5290 failed at the UI because the client ignored the proxy — recorded as an operational note, not a defect.

## Acceptance matrix

| # | Criterion | Verdict | Basis |
|---|-----------|---------|-------|
| 1 | Organization & org-unit creation, editing, persistence | **PASS** | Browser create+edit, server 201/200, survived restart |
| 2 | Human & AI workforce registration & management | **PASS** | Browser AI import (24) + human create (201); mgmt forms present |
| 3 | Project, milestone, task creation, assignment, ordinary start | **PARTIAL** | Task create/assign/start PASS; **project & milestone creation not exposed in the browser UI** |
| 4 | Founder dashboard, progress, activity, attention | **PASS** | Attention/Activity render live and reflect my changes |
| 5 | Operational digests & follow-ups | **FAIL** | `GET /api/pm/digests/latest` → 404; follow-ups client not wired |
| 6 | Persistent readback after restart | **PASS** | All browser-made records survived pm-service restart (API + UI) |
| 7 | Local backup, recovery, restoration | **PASS** | backup (VACUUM+integrity) → mutate → restore rolled back, verified in UI |
| 8 | Operation without Hermes/Herdr/Room/WSL | **PASS** | Core Founder journey fully usable with all optional companions offline |

## Per-criterion evidence (reproducible traces; origin 127.0.0.1:5173, pm 127.0.0.1:5176)

### #1 Organization — PASS
- `POST /api/pm/org/units` → **201** (created "Acceptance QA Cell"; Units 3→4, via "Create unit" form).
- `PATCH /api/pm/org/units/unit-acceptance-qa-cell` → **200** (renamed to "Acceptance QA Cell (edited)" via "Save unit").
- CORS preflight `OPTIONS …/units` → 204 (origin 5173 allowed).
- Persistence confirmed by #6 (survived restart; UI re-read it).

### #2 Workforce — PASS
- AI registration: `POST /api/pm/org/people/import-identities` → **200** ("Created 24, Skipped 4, Conflicts 0"); directory badge 8→25. UI note: "This did not authenticate anyone" (registration ≠ auth — good integrity).
- Human registration: `POST /api/pm/org/people` → **201** (handle `qa-founder-deputy`, kind HUMAN).
- Cross-surface propagation: `qa-founder-deputy` then appeared in the PM board owner dropdown.
- Management: per-person edit forms (display name, harness, capabilities, Save/Archive) present for every person.

### #3 Projects/tasks — PARTIAL
- Task create: `POST /api/pm/tasks` → **201** (ID `PM-SERP-001`), owner assigned to `qa-founder-deputy` (HUMAN) at creation ("New card" form on the ERP board).
- Ordinary start (no Room approval): `PATCH /api/pm/tasks/PM-SERP-001` → **200** (BACKLOG→READY) with no Room reference required.
- On the ERP board, READY→IN_PROGRESS is correctly blocked by a **project governance hold**: "PROJECT_ON_HOLD. starqERP is ON_HOLD (DEC-100); tasks cannot progress past READY until the Founder lifts the hold." (Guard preserved — not a defect.)
- Full start on an active board: `PATCH /api/pm/tasks/PM-CMD-001` → **200** (READY→**IN_PROGRESS**) on the active Starq Command board, no Room approval. UI note "Software factory execution: NO RECORD" (expected with Herdr offline).
- **Gap:** `pmCreateProject` and milestone-create are not imported by any surface. There is **no browser control to create a project or a milestone**; the portfolio only opens the 28 seeded boards, and task detail can only *assign* an existing milestone ("Milestone: No milestone"). Project/milestone creation is API-only in this candidate.

### #4 Dashboard / progress / attention — PASS
- Founder Home "Needs attention" renders seeded items; Activity "Attention" renders live and reflected my edits: `PM-CMD-001 … IN_PROGRESS`, `PM-SERP-001 … qa-founder-deputy`, counters "in progress 1".
- `GET /api/pm/attention` → 200, `GET /api/pm/milestones` → 200.

### #5 Digests & follow-ups — FAIL
- Founder Home "Today's digest" and "Completed in the latest digest" render **"UNAVAILABLE. No such route."**; Activity "Latest digest" → **"REJECTED NOT_FOUND: No such route."**
- Root cause (client/server contract mismatch): client `pm-client.ts` `pmLatestDigest()` calls `GET /api/pm/digests/latest`, but `server/pm-ops-routes.mjs` implements only `GET /api/pm/digests`, `POST /api/pm/digests/generate`, and `GET /api/pm/digests/<YYYY-MM-DD>` (regex `^/api/pm/digests/(\d{4}-\d{2}-\d{2})$`). `latest` has no handler → **404** (verified by direct curl).
- Follow-ups: Activity "Follow-ups" → **"UNAVAILABLE. No follow-ups client is available. Missing route GET /api/pm/followups."** `src/surfaces/daily-activity.tsx` hard-codes this UNAVAILABLE state (stale comment "no client and no route yet"); no `pmFollowups()` client exists, so the section can never populate even though a `pm_followups` table now exists in `ops-automation.mjs`.
- Net: the Founder's daily digest + follow-up workflow is non-functional in the browser.

### #6 Restart persistence — PASS
- Pre-restart: units 4, people 26, `PM-SERP-001` READY/owner=qa-founder-deputy, `PM-CMD-001` IN_PROGRESS.
- Stopped pm-service, relaunched on 5176 with the **same disposable DB** (health `state=OK scratch=true integrity=ok`).
- Post-restart (API + browser re-read): identical — units 4 incl. "Acceptance QA Cell (edited)", people 26, PM-SERP-001 READY, PM-CMD-001 IN_PROGRESS.

### #7 Backup / recovery / restoration — PASS
- `backup.mjs backup` → snapshot `pm-operating-2026-11-01T04-52-40-201Z.db` (364544 bytes, sha256 `e1553f…`, integrity ok; VACUUM INTO).
- Mutated: added unit "THROWAWAY to be rolled back" (units 4→5).
- Stopped pm (restore is stopped-state only), `backup.mjs restore --file <snap>` → restored; **pre-restore safety snapshot** auto-created (`…-prerestore.db`).
- Restarted pm: units back to **4** (THROWAWAY gone, verified in the browser — 0 matches), "Acceptance QA Cell (edited)" and PM-CMD-001 IN_PROGRESS preserved, integrity ok.

### #8 No Hermes/Herdr/Room/WSL — PASS
- Entire run had Room writes off (`PM_ROOM_POST=off`), Herdr/broker/building/WSL never started.
- Optional-dependency surfaces degrade **gracefully with clear status** rather than breaking the app: "BUILDING PROJECTION UNREACHABLE … building projection returned 500" banner; Dev Studio floor shows capacity/staff UNKNOWN; Herdr surface shows "broker OFFLINE".
- The core Founder operating journey (org, workforce, projects/tasks, attention, persistence, backup/restore) was fully usable with all optional companions offline. Safety guards (project hold, gated lifecycle, CORS/origin pin, write-client header) remained enforced — none were weakened to force success.

## Findings for Vision (source owner)
1. **[FAIL #5] Missing `GET /api/pm/digests/latest`** — add a handler in `server/pm-ops-routes.mjs` returning the most recent digest (e.g. `listDigests(db,{limit:1})[0]` or `{digest:null}`), matching the `pmLatestDigest()` contract. Low-risk, additive. Area overlaps Antigravity/ops ownership — flagged, not edited, pending Vision's assignment.
2. **[FAIL #5] Follow-ups never render** — `daily-activity.tsx` is hard-wired to UNAVAILABLE and no `pmFollowups()` client exists; wire a client to the existing `pm_followups` backing (or confirm the section should stay stubbed and relabel it as "not yet implemented").
3. **[PARTIAL #3] No browser path to create a project or milestone** — `pmCreateProject`/milestone-create are unused by any surface. If Founder project/milestone creation is in scope, a create control is needed; otherwise document that projects/milestones are provisioned out-of-band.
4. **[note] PM client is port-pinned (5176) and CORS origin-pinned (5173).** Correct as a safety stance, but it means the standalone app only runs on canonical ports; command-local/v1 already uses those, so this is consistent — just make it explicit in operator docs.

## Not claimed
- No acceptance asserted for untested paths. Project/milestone creation and the digest/follow-up workflows are **not** accepted.
- This is browser functional evidence only. Source reconciliation, failure classification, canonical integration and final QA remain Vision's.
- Cleanup: isolated pm-service stopped; disposable DB + backups remain under the worktree's `.command-runtime-local/` (gitignored) for Vision's inspection, to be discarded with the worktree.
