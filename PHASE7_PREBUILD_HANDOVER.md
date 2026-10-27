# Phase 7 isolated pre-build handover — 2026-09-30

Status: IMPLEMENTATION PREPARED FOR REVIEW. Formal Phase 7 has not begun. No acceptance is issued.

Branch: `codex/phase7-dual-room-prebuild`.
Workspace: `C:/Users/Ali Musthaq/.codex/worktrees/9de4/!starq`.
Base: `3cd094a6c74cb49540c5e19b2e91264c9eeb140c`.
Hoadha source HEAD verified read-only: `e9be5b863b1add79a1dce5900ebfb3a733b4ece9`.
B7 remains the external Deadpool gate supplied by the mission; this work neither polls Room nor changes that gate.

## Completed surface

Company-first STARQ // COMMAND: Overview / Building / Dev Studio / Founder Attention / Evidence / System. Project rooms nest under Dev Studio; POS stays within ERP. starqAI is framework-only, without a fabricated operational room.

Dev Studio: Overview / Staff / Projects / Capacity / Activity. Staff is a compact searchable table with independent identity, duty, execution assignment, task and capacity-note fields; detail opens the original projected record. The original floor projection remains in a collapsed section. Activity is a searchable/paginated table of canonical projection events. No provider quota is invented.

ERP: Overview / Process / Tasks / Decisions / Evidence / Staff / Integrity. Existing ERP maturity/process/attention/evidence/truth components remain unchanged. Five process families and process-stage closure remain authoritative. ON_HOLD and DEC-100 are source-derived. Decisions currently exposes the accepted declared Founder decision queue, rather than a generic decision editor. Staff is company assignment evidence with an explicit warning against inferred project membership.

Hoadha: Overview / Loops / Board / Waves / Stages / Evidence / Staff / Integrity. Prepared roadmap, stage assessments, loop blockers and wave invariants are actual project-room data. Production and connector state remain UNKNOWN/UNVERIFIED. H0 is roadmap context, not an activation. Room preparation does not start execution.

Canonical boards reconcile to 243 Hoadha + 56 Social + 27 Concierge = 326 original records. The 33 proposed HCD tasks remain a separate collection; there is no merged denominator or completion percentage. Board statuses are forwarded unchanged. Existing records without a wave retain UNKNOWN; the surface does not manufacture a wave mapping.

## Data boundary

`server/building.mjs` attaches a separate DERIVED_PROJECTION; existing health and floor contracts are not folded into it. All filesystem reads pass the existing containment/symlink guard and a fixed source allowlist. There are no writes or implicit reconciliation/ingestion operations.

| Surface | Sources |
|---|---|
| ERP process / overview / attention | Existing control-board contract, work model and activity projection |
| ERP task table | `starqNexus/data/starq-erp-tasks.json` |
| Staff / activity | Existing floor projection from identities, staff state, sessions and activity |
| Hoadha room identity / loops / blockers | `03_PROJECTS/hoadha/HOADHA_DEV_STUDIO/roadmap.machine.json` |
| Hoadha live board | `starqNexus/data/hoadha-tasks.json`, `hoadha-social-tasks.json`, `hoadha-concierge-tasks.json` |
| Proposed tasks | `HOADHA_DEV_STUDIO/TASK_RECONCILIATION.md` |
| Waves / stage assessments | `DEVELOPMENT_WAVES.md`, `LOOP_STAGE_MATRIX.md` |
| Evidence | `EVIDENCE_INDEX.md` plus existing ERP evidence surface |
| Capacity | UNKNOWN, with explicit absence of a declared quota source |

Per-source SHA256, modification time, reachability and read errors are visible. Source hashes attest file reads, not deployment or independent verification. Missing/malformed board sources do not become healthy empty boards. Count/wave/loop disagreement raises DRIFT. Prepared loop states and root blockers retain stale/unknown truth. Filters and search are display preferences only; browser session storage persists task search, not business state.

## Navigation and operator UX

URL hash routes: `#studio/erp/process`, `#studio/hoadha/board`, `#studio/staff`, and every other tab. Legacy `#process`, `#truth`, `#floor` resolve inside the new hierarchy. Browser Back and scroll restoration preserve route context. YOU ARE HERE / CURRENT FOCUS and room tabs remain sticky. Native dialog provides modal focus containment and Escape/restore. Tables use captions and labelled filters. Task lists paginate at 30 rows instead of mounting the whole corpus. Reduced motion and narrow layouts are supported.

Browser checks performed against the isolated app reading canonical files only:
- Company → Hoadha → Board → search → source drawer.
- Drawer opens with focus on Close; Escape removes it and restores focus to Inspect DHIV-S0-T1.
- Keyboard Enter on skip link focuses `command-main` without changing the route.
- Browser Back returns to Dev Studio context.
- 390 px responsive check identified sidebar overflow; corrected fixed rail bounds and wrapping. 625 px check: main clientWidth == scrollWidth == 559.
- ERP room shows source-derived ON_HOLD, DEC-100, unchanged maturity and restart gate.

Screenshots: `evidence/phase7/company-overview.jpg`, `hoadha-overview.jpg`, `erp-overview.jpg`, `dev-studio-staff.jpg`, `hoadha-mobile.jpg`. Screenshots are implementation evidence, not acceptance.

## Verification

Run from this worktree's `00_STARQ_HQ/operations/starq-command`, with `STARQ_WORKSPACE=D:/!starq` for live reads. The isolated checkout does not contain the full canonical fingerprint/data and correctly reports UNAVAILABLE without this explicit source root. Never silently redirect production sources.

| Check | Result | Evidence |
|---|---|---|
| Typecheck | PASS | `evidence/phase7/typecheck.txt` |
| Windows production build in isolated worktree | PASS, 1603 modules | `evidence/phase7/build.txt` |
| Read-side P1–P5 regressions + Phase 7 tests | 502/502 PASS, 15 files | `evidence/phase7/read-side-tests.txt` |
| Focused Phase 7 tests | 7 PASS, included above | Dual-room render, URL roundtrip, count isolation, original state preservation, no mutation, missing/malformed sources, source-derived ERP state |
| Existing real-tree capability mutation checks | PASS, M1–M16 included in full suite | Same read-side test log |
| Unmodified P6 control suite | 445/447 PASS; 2 freeze failures | `evidence/phase7/control-regression.txt` |
| Process / execution reconcilers | IN_SYNC / IN_SYNC, both exit 0 | `evidence/phase7/reconcilers.json` |
| Existing parity/path independence check | Outputs host-independent | `evidence/phase7/parity.txt` |
| Diff whitespace / mutation residue | PASS / no residue | `git diff --check`, final scoped status |

P6 failures are exactly PART F2 (old Phase 5 byte digest) and PART F4 (whole-source census). F2 rejects changes to `server/data-service.mjs`; F4 rejects the new `server/building.mjs`. The Phase 7 shell necessarily changes the old read surface. The Phase 6 implementation, contract, frozen digest manifest and tests were deliberately left unchanged. These two red gates require explicit review of the Phase 7 boundary; do not call the full P6 suite green or refresh its frozen digests to conceal the issue.

Older read-side source-level navigation/read-source assertions were updated for the six company entries and bounded Phase 7 sources. Runtime P5 behaviour and rendering tests remain active; no failures were skipped. No control contract was edited.

## Changed files

- `server/building.mjs`: bounded read projection, source metadata, board/proposed/wave/stage reconciliation.
- `server/data-service.mjs`: attach Building projection and declare its bounded read sources.
- `src/lib/building-route.ts`: company/floor/room/tab routes and legacy route compatibility.
- `src/lib/contracts.ts`: attached Building projection types.
- `src/surfaces/building.tsx`: shared room framework, compact floor surfaces, Hoadha native views, task tables and source drawer.
- `src/App.tsx`, `src/components/shell.tsx`: company navigation, sticky orientation, room-local hold, skip and scroll handling.
- `src/index.css`: dense graphite layout, responsive wrapping, focus, modal and reduced motion.
- `tests/phase7.test.tsx`: seven focused behavioural/projection checks.
- `tests/architecture.test.ts`, `phase3.test.ts`, `phase4.test.ts`, `phase5.test.ts`: updated source-level navigation/bounded-read assertions.
- This handover, implementation plan and `evidence/phase7/`.

## Remaining review/release work

1. B7 independent closure and formal Phase 7 entry remain external gates. No merge, release or restart authority is inferred.
2. Resolve the Phase 6 read-surface freeze boundary through explicit review; retain its control contracts.
3. Canonical-root Windows production build was not performed: it would put build artefacts in the canonical checkout. The Windows isolated build passed. Full cross-host regenerated parity is also deferred; the existing read-only path-independence check passed.
4. Hoadha has no declared room-specific staff assignment projection or live capacity provider; those views truthfully show UNKNOWN rather than assign workers or invent quota.
5. Existing board rows do not have authoritative individual H-wave mappings; the proposed HCD tasks do. A canonical mapping projection would enable deeper board/wave cross-links without UI inference.
6. Exhaustive keyboard cycling, focus trap edges, high-DPI/200% zoom, failure-state browser checks and a dedicated Phase 7 mutation battery still need independent UX/release review. Pagination replaces virtualization here.
7. Other floors are architectural context only. Global Evidence/System preserve the accepted ERP detail surfaces alongside the new Hoadha source health, rather than inventing data for unpopulated floors.
8. ERP process and Hoadha stage views expose existing canonical/prepared assessments. Runtime closure, production readiness and connector actuation remain unverified/outside this mission.

ERP REMAINS ON HOLD. HOADHA EXECUTION NOT STARTED BY THIS BUILD.
No Room, decision, ERP implementation or control-plane source changes were made. No canonical merge or restart occurred. No Phase 7 acceptance is claimed.
