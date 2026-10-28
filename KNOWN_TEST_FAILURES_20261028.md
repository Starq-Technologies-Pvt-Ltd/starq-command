# Full-suite remediation record — 2026-10-28

## Current verification

The 32 failures below were the inherited suite state before this remediation pass; they are no longer current failures. On 2026-10-28, the canonical command `npx vitest run --no-file-parallelism --maxWorkers=1 --minWorkers=1 --reporter=dot` completed with **53 files passed, 1,118 tests passed, 0 failed** in 126.35 seconds. Focused reruns passed for all changed test groups. This is test evidence, not production acceptance.

The remediation corrected the AST capability guard to follow variable aliases and resolve fetch options before applying the method allowlist; updated stale surface census/order expectations; made phase metadata checks non-vacuous; aligned floor/provenance assertions with their dimension-level states; and redirected historical Nexus assertions to the read-only Building snapshot owner while active Studio boards remain PM-owned. Test fixtures now return the PM source shape expected by the UI.

## Historical starting failures

The initial canonical run was 1,083 passed, 32 failed, 1,115 total across 53 files. The following list records that starting point for traceability; it must not be read as the current result:

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

The machine-readable focused rerun is retained outside the repo at `D:\StarqTech\verification\command-audit-20261028\slice3-full-suite-failures.json`. Re-run the command above to refresh it. Full Vitest is not currently part of the portable CI matrix; that workflow runs typecheck, production build, Node tests, and focused external-component/production-entrypoint checks.

## Lifecycle prerequisite verification

`npm run test:lifecycle` now prints the Node executable, OS, and canonical workspace before running suites. Its per-suite preflight checks configured companion roots, required files/fixtures, and expected module exports; the native development-readiness suite additionally checks the workspace fingerprint, Windows OS, pinned Node executable, JobGuardian binary/build pin, and lifecycle launch inputs. Companion imports and fixture directories resolve through the existing `STARQ_LIFECYCLE_ROOT` / `STARQ_HERDR_FLOOR_ROOT` mechanism instead of assuming adjacent checkouts. A missing-companion rehearsal (`STARQ_LIFECYCLE_ROOT` pointed at a nonexistent directory) ran 8 independent suites and explicitly skipped only 4 companion-dependent suites; 71 passed, 0 failed, with the same 2 independently gated child-host tests. The canonical workstation run had 12 suites runnable, 119 passed, 0 failed; its two skipped child-host cases now each state that they require explicit `STARQ_AUTHORIZED_LIVE_TESTS=1` because they launch a real child process (Windows named-pipe requirements are also reported on non-Windows hosts).

## GitHub-hosted runner admission

The current active workflow `.github/workflows/portable-checks.yml` (workflow ID `399290537`) was manually dispatched against `main` at `4f5f59a9b67f7184e415a53df72b9600c3a10b25`; run `40683995098` ended `startup_failure` in one second, with `jobs: []`. The job-list endpoint returned zero jobs and the log endpoint returned 404, so neither Linux nor Windows runner began. This failure is distinct from the older three `BuildFailed` runs attached to a deleted workflow ID.

Repository Actions permissions currently report `enabled: true` and `allowed_actions: all`. The organization API reports the Free plan. Reading organization Actions policy requires org-admin / Actions-policy authority and returned 403 for the connected identity; the legacy billing endpoint returned 410. Therefore the specific admission cause is **unresolved**, not attributed to workflow YAML, billing, or org policy without evidence. Founder/org-admin follow-up: inspect Organization Settings → Actions → General and repository Actions settings, then ask GitHub Support to inspect run `40683995098` if policy permits. Re-run the active workflow after the platform-side cause is identified. Local Windows verification above is complete; hosted Linux/Windows verification is not.
