# CURRENT STATE — Starq Command

*Room head observed: **#9367** (2026-10-12T10:58Z; Founder cold-start correction directive after Codex review #9366). No engineering disposition changed in #9365–#9367. Latest independent verdict: **Vision #9360** (2026-10-12T09:49Z). Latest Founder engineering disposition: **#9354** (Wave 1). No Founder response to #9360 exists at the checkpoint.*
*Integrated support: Cursor #9363 and AG #9364 (claims verified against primary records before use).*
*The canonical detail is in `TASK_LEDGER.json`. If this file and the ledger disagree, the ledger wins; if the ledger and the Room disagree, the Room wins.*

## 1. One-paragraph summary

Wave 0 (the CMD-DI governance gates) is **fully approved**. Wave 3 server/contract work 3-1, 3-2a, 3-2b and 3-2c is **prospectively accepted**. 3-3 is accepted only as verification work and as an internally consistent manifest; the Observation candidate is not accepted. Wave 1 is **partly accepted**: 1-1, 1-2 and 1-5 (bounded) are accepted, while 1-3 and 1-4 are **rejected** at #9360, pending a Founder decision on a targeted corrective/recapture round. Wave 2 is **blocked** behind Wave 1. 3-4 and Wave 4 are **locked**. The managed floor stays under ALL-STOP #9208, and runtime GO, G-CONTAINMENT and Studio commissioning are all unresolved.

## 2. Task-level state

| Task | State | Latest evidence | Scope / qualification |
|---|---|---|---|
| CMD-DI-0-1 | ACCEPTED | pkg:745, #9317 | Core 52 baseline; B7 evidence-closed only; 41/52 current pins match, 11 drifted (covered by the 126 baseline) |
| CMD-DI-0-2 | ACCEPTED | Vision #9310, Founder #9311 | Test-audit evidence gate; no raw log; stale §8 wording |
| CMD-DI-0-3 | ACCEPTED | Vision #9320, OpenCode #9326, Founder #9327 | Coordination evidence, with P3A dispositions; transcript custody UNKNOWN |
| CMD-DI-1-1 | ACCEPTED | Vision #9353, Founder #9354 | Six StaffGlance render tests pass |
| CMD-DI-1-2 | ACCEPTED | Vision #9330, Founder #9331; tests pass #9353 | Static/prospective |
| CMD-DI-1-3 | **REJECTED** | Vision #9360 | Strict descendant overflow on 12 routes; dark mode deferred (#9354) |
| CMD-DI-1-4 | **REJECTED** | Vision #9360 | 21 HTTP-error capture entries incl. `/api/herdr/state` 500; no metrics; #9357 truncated; no visual sign-off |
| CMD-DI-1-5 | ACCEPTED (bounded) | Vision #9360 | Studio Overview mount plus honest UNKNOWN buckets only; not yet acknowledged by the Founder |
| CMD-DI-2-1, 2-2, 2-4 | BLOCKED | #9295, #9307/#9308 | Serialized after Wave 1; 2-4 lacks a message contract |
| CMD-DI-2-3 | UNKNOWN | #9295 | Worker report only |
| CMD-DI-2-5 | CLOSED | pkg:736 (B3) | Scope decision |
| CMD-DI-3-1 | ACCEPTED | Vision #9269, #9272 | Prospective; historical rejection retained |
| CMD-DI-3-2 | SUPERSEDED | pkg:737 | Folded into 3-2a |
| CMD-DI-3-2a | ACCEPTED | refreeze record; #9261 | Current contract only; frozen |
| CMD-DI-3-2b | ACCEPTED | Vision #9269 | Read-only UI; route supplies null → UNKNOWN |
| CMD-DI-3-2c | ACCEPTED | Vision #9276 | After REJECT #9273; provenance exception #9270 |
| CMD-DI-3-3 | ACCEPTED (work + manifest) | OpenCode #9282, #9288 | **Candidate NOT accepted** |
| CMD-DI-3-4 | BLOCKED | Codex #9290 | Not authorized |
| CMD-DI-4-1/4-2/4-3 | PROPOSED | pkg Wave 4 | Unauthorized |

## 3. Wave 1 detail at #9360 (the current front)

- **Evidence corpus:** `starq-command/evidence/vision-visual-2026-10-12-recovery/` contains 328 PNGs (41 routes × 8 viewports, single theme), hash-consistent across files, manifest and SHA256SUMS (#9360). The earlier 210-capture corpus is wholly invalid because it shows the Building-projection placeholder (#9353, #9357).
- **What passed (Vision's independent 320×720 Chrome sweep):** all 41 target headings loaded; every page root was 310/310 with no horizontal movement and no Building-projection fallback; all six Studio tabs carry `aria-current=page`; `#floor`/`#process`/`#truth` route to Staff/ERP Process/ERP Integrity; Studio Overview shows StaffGlance with all six buckets UNKNOWN.
- **What failed:** strict descendant overflow on company-founder, company-infrastructure, company-portfolio, company-seats, company-structure, erp-integrity, erp-process, hoadha-overview, hoadha-waves, studio-capacity, studio-staff and system-sources. The manifest records 21 HTTP errors across 14 rows: 15 × `/api/herdr/state` 500 (independently reproduced by Vision) and 6 × 403 (4 raw-path, 2 runtime-state). Cursor #9363 reports the already-listening proxy still returning 500; that is not observed by Elder. The #9355 four-route 320px pass does not cancel the #9360 twelve-route rejection (#9363). The #9357 body ends mid-sentence at 1,843 characters. The manifest has no overflow/typography metrics. The 403 raw-path refusals are recorded but not classified as visual defects.
- **Founder dispositions in force (#9354):** dark-mode HSL and appearance parity are revised to single-theme verification and **deferred** (not claimed complete). The following are preserved: the typography ladder, the 320px no-horizontal-scroll criterion, grouped-navigation correctness, V5 (no legend on non-Studio routes) and independent visual approval.
- **Outstanding:** Vision #9360 asks the Founder to decide whether to authorize a targeted corrective/recapture round for 1-3/1-4. No such decision exists at the checkpoint.

## 4. Protected baselines and pins (do not modify)

- **126-file prospective recovery baseline:** `evidence/CMD-DI-PROSPECTIVE-RECOVERY-BASELINE-2026-10-11.json` (43,745 B, `9a10d439…17cb9eb`; inventory digest `a48fd727…e155495`). Custody copy in `00_STARQ_HQ/governance/evidence/` is byte-identical (re-verified at this checkpoint).
- **Ten separately protected pins**, per Founder references #9280, #9289 and #9291. The pins re-verified at the checkpoint are: `contracts.ts 81f6e9f6`, `floor.mjs c9288c12`, `data-service.mjs 8c019a49` and the 3-2c test `a5e72855`. OpenCode #9288 lists `work-packages.tsx 1db6c852`, `work-packages-surface.test.tsx f8826ead`, the 3-2a contract test `f5f62c1d` and `building-service.mjs f93395c6`. A single authoritative enumeration of all ten was not located (UNKNOWN; see OPEN_BLOCKERS B-09).
- **Historical manifests:** core 52 (`456b845c…`), Observation historical (`06616f50…`) and predecessor (`a41713cc…`). Preserve them unchanged.
- **Known-red F3–F8:** six failures, all live-data drift (phase2 ×3, phase7-dual-room ×2, staff-board ×1). The latest full-suite figure is 924/918/6 (#9276).
- **Historical UNKNOWN register:** 9 entries inside the 126 baseline (`historical_unknown_register`), counted exactly at #9326.

## 5. Operational state

- **Managed floor:** ALL-STOP #9208 is in force. There is no runtime GO. G-CONTAINMENT is unresolved. The Oct 8 G-RULE0-OBS inventory is not a current readiness certificate (#9278, #9280).
- **Gate A (Deadpool Room watcher):** preparation was authorized only (#9258). No result was found, and the authorization expires around 2026-10-17T22:46Z.
- **Communications:** the Room formatting investigation is closed (#9305); Telegram truncation is open and unauthorized.
- **This continuity package:** Codex #9366 accepted the integrity check and rejected the cold-start procedure; corrected under Founder #9367 and re-parked for review.

## 6. Strategy items (intentions, not authorizations)

| Item | State | Source |
|---|---|---|
| Minimum Operational Development Studio (accelerated) | PROPOSED; definition not located | #9354, #9358, #9361 |
| First product mission: StarqERP baseline assessment using Aikido | PROPOSED; no directive | #9358 |
| SERP-354 (C2B capture/refund/settlement) | BLOCKED: board `in_progress`, work_state PRESERVED (Founder-stopped); StarqERP implementation ON HOLD per DEC-100 | `command_work_model.json`; `decisions.json`; #9358 |
