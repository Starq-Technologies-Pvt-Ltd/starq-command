# Known full-suite failures — 2026-10-28

Reproduced after the portability/audit remediation edits on the canonical workstation. This is a record of current red tests, not a waiver or a claim that the product is accepted. Command: `npx vitest run --no-file-parallelism --maxWorkers=1 --minWorkers=1 --reporter=dot`. Full suite result: 1,083 passed, 32 failed, 1,115 total across 53 files. A focused rerun of the 11 affected files produced the same 32 failures.

- `building-unavailable-routes.test.tsx` — Building absent: existing independent surfaces remain reachable preserves the portfolio and historical board in Projects with the Studio tab rail
- `building-unavailable-routes.test.tsx` — Building absent: existing independent surfaces remain reachable keeps the Building-dependent route #studio/mercury/board guarded
- `building-unavailable-routes.test.tsx` — keeps the App warning and hold visible while navigating real pages with Building absent
- `contracts.test.ts` — execution truth and honesty states reports the ledger hash comparison honestly
- `floor-api.test.ts` — CMD-DI-3-1 · GET /api/floor staff glance counts publishes populated non-negative buckets matching exact roster filters
- `floor-api.test.ts` — CMD-DI-3-1 · GET /api/floor staff glance counts does not publish measured-zero buckets when activity.json omits agents
- `floor-api.test.ts` — CMD-DI-3-1 · GET /api/floor staff glance counts does not publish measured-zero buckets when activity.json agents is not an array
- `floor-api.test.ts` — CMD-DI-3-1 · GET /api/floor staff glance counts keeps numeric zeroes for a source-confirmed empty roster
- `phase3.test.ts` — Phase 3 — GUARD: Phase 5 is live and no phase beyond it is authorised declares exactly the seven company surfaces in this pre-build
- `phase3.test.ts` — Phase 3 — GUARD: the ERP hold is untouched declares no ERP repo path as a Phase 3 source and opens none for writing
- `phase7-corrective.test.ts` — R3 (Goose, P2) — every rail button is named at every width all seven nav entries carry a name
- `phase7-corrective.test.ts` — R7 (Goose, P3) — the dead phase field and its unreachable badge are gone nav order is preserved, not re-sorted by phase
- `phase7-dual-room.test.tsx` — Phase 7 — both real project rooms instantiate (Room seq 8358) the Hoadha board renders the real reconciled corpus
- `phase7-ui.test.tsx` — Phase 7 — the first screen answers every room tab states its room identity and names the question it answers
- `phase7-ui.test.tsx` — Phase 7 — the two rooms are one product with two accents ERP and Hoadha share the panel language and differ by room scope only
- `phase7-ui.test.tsx` — Phase 7 — density without a report scroll renders all 326 live rows inside a bounded pane, not as page length
- `phase7-ui.test.tsx` — Phase 7 — density without a report scroll renders 437 ERP tasks in a bounded pane with a live status filter
- `phase7-ui.test.tsx` — Phase 7 — evidence drill-down is usable each row is selectable and the drawer leads with a ledger, not raw JSON
- `phase7-ui.test.tsx` — Phase 7 — absence is never rendered as emptiness a deleted board reads as a source gap, not an empty table
- `phase7-ui.test.tsx` — Phase 7 — navigation carries information the current tab is marked on every room and cross-room surface
- `phase7-ui.test.tsx` — Phase 7 — hold and prepared states are never routed around ERP hold is visible on every ERP tab and offers no restart control
- `phase7-ui.test.tsx` — Phase 7 — hold and prepared states are never routed around Hoadha never activates H0 and never merges proposed into live
- `pm-portfolio.test.tsx` — Command project boards lists live boards on the Projects surface
- `project-board.test.tsx` — CMD-DI-2-2 project id from the route and the building projection renders the studio route and query on the board, and does not treat projects/board as a project
- `project-board.test.tsx` — CMD-DI-2-2 project id from the route and the building projection keeps the ERP and Hoadha room routes on their existing boards
- `project-board.test.tsx` — CMD-DI-2-2 project id from the route and the building projection falls back to the hash project when the query project_id is a reserved Studio token
- `projection-failure-evidence.test.ts` — source failures stay explicit without a live service or regenerated projection does not classify an unreadable provenance input as OK
- `structural-ownership.test.tsx` — Dev Studio peers each own a distinct work area every peer names the question it answers
- `structural-ownership.test.tsx` — Dev Studio peers each own a distinct work area Projects owns the project-room mapping
- `structural-ownership.test.tsx` — ERP reads as process closure room state survives on EVERY ERP tab, including router-owned ones
- `structural-ownership.test.tsx` — Hoadha reads as prepared and not started Board makes the live/proposed choice impossible to misunderstand (WF-HOA-03)
- `structural-ownership.test.tsx` — Hoadha reads as prepared and not started room state survives on every Hoadha tab

The machine-readable focused rerun is retained outside the repo at `D:\StarqTech\verification\command-audit-20261028\slice3-full-suite-failures.json`. Re-run the command above to refresh it. These failures are not suppressed in the portable CI job, which presently runs only the independent clone checks.
