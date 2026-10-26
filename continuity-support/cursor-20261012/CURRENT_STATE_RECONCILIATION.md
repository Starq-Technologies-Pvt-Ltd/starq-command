# Current-state reconciliation — supporting report

Authority: Founder Room #9362. Writer: @cursor. This file is not part of the canonical continuity package. Canonical files under `00_STARQ_HQ/operations/starq-command/continuity/` were read and were not edited.

Observed Room head: brokerSequence 9362, sender mustarq, receivedAt 2026-10-12T10:08:19.846Z, recordHash `ab25965121ed12a6577086b609701a2a7f4975e158aa12f6aa490285d0c830e3`. That hash matches `TASK_LEDGER.json` checkpoint `latestRoomRecordHash`. No later Founder decision than #9362 was in the ledger at this read.

## Programme readiness

The Minimum Operational Development Studio is not ready to commission.

Wave 1 is open. Vision #9360 rejects CMD-DI-1-3 and CMD-DI-1-4, and accepts CMD-DI-1-5 only for the Studio Overview mount and honest UNKNOWN presentation. Founder #9354 recorded CMD-DI-1-1 as independently accepted under Vision #9353, and kept CMD-DI-1-2 at its prior prospective static acceptance. #9360 asks the Founder to decide whether to authorize a targeted corrective or recapture round for 1-3 and 1-4. No such decision is recorded at #9362.

#9361 and #9362 authorize documentation only. Room #9208 ALL-STOP remains in effect for managed-floor operations. Dark-mode HSL and appearance parity stay deferred under #9354. No Wave 2, Wave 4, or runtime GO is authorized by these records.

## Wave 1 task states

States below are the Room verdicts. The canonical `TASK_LEDGER.json` (filesystem mtime 2026-10-12T10:10:47.493Z) agrees, with the bounds kept in `stateQualifier` rather than in `blockers`.

| Task | Room state | Bound that must travel with the state | Depends on |
| --- | --- | --- | --- |
| CMD-DI-1-1 | ACCEPTED | Founder #9354, citing Vision #9353. Six StaffGlance render tests. Not a claim of historical dispatch provenance. | none for the component |
| CMD-DI-1-2 | ACCEPTED, prospective and static | Vision #9353: three tests passed; no runtime PASS. Founder #9354 preserved that acceptance. | as ledger: CMD-DI-0-2 |
| CMD-DI-1-3 | REJECTED | #9355 passed the four #9341 routes at 320×720. #9360 still rejects the task: strict descendant overflow fails on 12 routes (company-founder, company-infrastructure, company-portfolio, company-seats, company-structure, erp-integrity, erp-process, hoadha-overview, hoadha-waves, studio-capacity, studio-staff, system-sources). Dark mode is deferred, not a remaining blocker. | Founder decision requested by #9360 |
| CMD-DI-1-4 | REJECTED | 328/328 single-theme captures are on disk and #9360 loaded all 41 headings without a Building-projection fallback. Rejection stands for the 12-route overflow, the Herdr HTTP 500, a manifest with no overflow or typography metrics, and the truncated #9357 Room body. No grouped visual sign-off. | healthy target surfaces; 1-3 overflow result; Vision sign-off |
| CMD-DI-1-5 | ACCEPTED, bounded | #9360: Studio Overview mount and honest UNKNOWN buckets only. `company.tsx` and `overview.tsx` match the recovery pins below. Historical residual scope and authorship of `company.tsx` remain UNKNOWN (#9335). | CMD-DI-1-1 |

The four-route pass in #9355 does not cancel the twelve-route rejection in #9360. Both statements are about different route sets.

## Repository hashes

Recovery baseline: `evidence/CMD-DI-PROSPECTIVE-RECOVERY-BASELINE-2026-10-11.json`. SHA-256 is over raw bytes.

Authorized differences, both matching the hashes posted in #9351 and repeated for CSS in #9355:

- `src/index.css` — 104127 bytes — `347002c87e7a4457f685eb1b3ba53e53f7cf057edafc95831fd8ccc51847a951`. Baseline remains 100842 / `71b4af69e069180c7803463b8d524f4b2417a53471d7cbe5c0ebb4004d0408cf`. The baseline file was not rewritten.
- `tests/design-integration.test.tsx` — 11715 bytes — `605ec38b359726aea867fdb1a17fdbe1be4c85f012ccff748fcb5c36afe9cb95`. Baseline remains 3124 / `b5c09778a8ac89b7b3d38dac63a3376730bc56038da0301894aee728bcb724ae`.

Matched the recovery pin on this read:

- `src/components/staff-glance.tsx` — 3498 — `f804fe01c3f64c17439abe37f6fd1311b70258c84f3580171c48b789cdcd5376`
- `src/components/sessions-board.tsx` — 5720 — `6b872d9cb8959a0762552c1ab9f3e47a77275d50b6d43db349cfe509dd5d124e`
- `src/components/shell.tsx` — 16158 — `5a84cedcca61af471b5fd1d78475129a68727db3684b6867951129b4387fba6d`
- `src/lib/building-route.ts` — 5051 — `15136434abcccae427e543cee4cf4d794aeb1b6a2bde4d70e23f10dd7724f615`
- `src/surfaces/company.tsx` — 37054 — `a62098ea3b15ce340660e200746289b5ec84ac8b93d3e9768d958138473ae24d`
- `src/surfaces/overview.tsx` — 26620 — `878e2b08eaef7a99a6128a872154873acafdebee86348ec8437584814577e05b`
- `src/surfaces/building.tsx` — 69866 — `48f8725999b2d9dbd7e28a5393bd4e77afffc63d4db2302929574056e94f89c0`

The eleven files directly under `server/` match the pins listed in #9341. Census is still those eleven names and no others.

`building-route.ts` matching the recovery pin does not close the older historical drift. #9338 left that pre-recovery history UNKNOWN and unwaived.

## Visual corpus

Path: `evidence/vision-visual-2026-10-12-recovery/`.

- `_manifest.json` has 328 rows, 41 routes, 8 viewports, 0 `placeholder: true`, 0 `loadOk: false`.
- 328 PNG files are in that directory.
- `SHA256SUMS.txt` has 328 lines, 34141 bytes, SHA-256 `3bd1675028f1aadcce20d125bad2722563a21777a256a3f1f82356d271a77fb0`. This pass did not re-hash each PNG against the sums file. #9360 reports that the 328 hashes agree across files, manifest, and SHA256SUMS.

HTTP arithmetic, counted from `rows[].httpErrors` on this read:

- 14 capture rows contain at least one HTTP error.
- 21 error occurrences: 15 times `500 http://127.0.0.1:5173/api/herdr/state`, 4 times a 403 for the starqERP convergence-doctrine raw path, 2 times a 403 for `.command-runtime/state.json`.
- Vision's phrase "21 HTTP-error entries" matches the occurrence count. It is not 21 failing captures.

A read of the already-listening proxy during this reconciliation returned HTTP 500 for `http://127.0.0.1:5173/api/herdr/state`. Vite on 5173 answered 200. The data service `/api/health` answered 503 with the previously observed DRIFT body. The building projection `/api/building/health` answered 200. No process was started for this read. Herdr was not started. The 500 is the same class of proxy failure #9355 recorded for a stopped building origin, now on the Herdr origin.

The manifest has load, heading, glance, and HTTP-error fields. It does not carry the #9341 overflow or typography measurements. #9360 already rejected 1-4 on that gap.

## Canonical package, as read

`TASK_LEDGER.json` is substantive. Its checkpoint hash matches Room #9362. Its `generatedAtUtc` field says `2026-10-12T10:40:00Z`. The file mtime observed here is `2026-10-12T10:10:47.493Z`. Those two clocks do not agree. Use the Room record hash, not `generatedAtUtc`, as the checkpoint.

Still stubs, mtime 2026-10-12T09:59:11Z: `CURRENT_STATE.md`, `OPEN_BLOCKERS.md`, `NEXT_EXECUTION.md`, `DECISION_LEDGER.md`, `HISTORY.md`, `WORKFORCE.md`, `RUNTIME_AND_RECOVERY.md`, `PROJECT_IDENTITY.md`, `CONTINUITY_MANIFEST.md`.

`EVIDENCE_INDEX.json` is Markdown stub text, not JSON. `START_HERE.md` still says the latest Room sequence observed is 9359, and it tells a cold start to validate `CONTINUITY_MANIFEST.json`. The file on disk is `CONTINUITY_MANIFEST.md`.

`WAVE_1_COORDINATION_STATE_2026-10-10.md` is not current. It still lists CMD-DI-1-2 and CMD-DI-1-3 as awaiting dispatch, and CMD-DI-1-4 and CMD-DI-1-5 as accepted without the #9360 bounds.

Wave 2, Wave 3, Wave 4, and the non-Command rows in `TASK_LEDGER.json` were not re-audited against their cited Room sequences in this pass. Their states in that file are Elder's integration, not a second verdict.

## Restrictions observed

No application source edit. No test run. No service launch. No baseline rewrite. No canonical continuity edit. No worker dispatch. No managed-floor activation. `D:\!starq` was not accessed.
