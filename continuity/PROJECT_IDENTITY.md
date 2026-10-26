# PROJECT IDENTITY — Starq Command

*Freshness: sources read 2026-10-12, checkpoint Room #9362. This section is stable; it changes only through a Founder decision or a corporate-library revision.*

## 1. What Command is

- **Command OS** is "Starq Technologies' local Company/Agent operating system. Its purpose is to run the organization, not merely the DevOps floor." *(corporate library `05_COMMAND_OS_CANONICAL_DEFINITION.md`, sha256 `1c7d0882…ced06`)*
- **STARQ // COMMAND** is "the permanent Founder operating surface for Starq Dev Studio". It is a **DERIVED_PROJECTION** of canonical Starq truth and **not an SSOT**: "Where Command disagrees with a canonical source, the canonical source wins and Command is drift." The product footer, the data contract and the API headers all state this. *(starq-command `README.md`)*
- The README (status 03 Oct 2026) calls Command OS "the sole active engineering project".

Command is meant to represent: company, floors, rooms, seats, humans, agents, runtimes, accountability, authority grants, projects, boards, workflows, tasks, evidence, decisions, Founder Attention, startup/shutdown/recovery, and health. *(Command OS definition)*

**Command is not** a Hoadhaa backend, an ERP module, an sCG UI, a developer-only dashboard, a replacement for Herdr runtime truth, or an AI model. *(Command OS definition)*

## 2. Relationship to other systems

| System | Role | Relationship to Command | Source |
|---|---|---|---|
| **Room** (`D:\StarqTech\agent-comms\room.jsonl`) | Durable, append-only, hash-chained communication and evidence ledger; carries Founder directives, assignments, ACK/RESULT and verdicts | Canonical authority for *who decided what*. Command projects it but never overrides it | Command OS definition; `FLOOR-LEADER-START-HERE.md` dual-watch table |
| **Herdr** | Managed runtime/process truth (panes, agents, sessions) | Command reads runtime truth; Herdr idle is never a result, and `unknown` is never idle | Command OS definition; `FLOOR-LEADER-START-HERE.md` |
| **StarqERP** (board = StarqNexus SSOT, read-only) | The company's ERP product (process families O2C, P2P, I2GL, C2B, R2R) | Command's ERP Process/Integrity floors are read-only projections of the board (`operations/starqerp-control-board/`) | `command_work_model.json`; Room #8328 |
| **Hoadhaa / Nexus roots** | Source corpora projected by the Building surface | Currently absent from the canonical workspace. The policy is truthful UNKNOWN/unavailable, never fabricated fixtures | Founder #9327 |
| **Telegram relay (Starq bot)** | Notification relay of Room messages | Forwards bodies verbatim; truncates at about 4,000 characters (open issue) | #9305 |
| **`D:\!starq`** | A separate Git repository holding read-only history | **Off limits.** Not the canonical root; no access or enumeration | `FLOOR-LEADER-START-HERE.md` path warning; every Founder directive since #9258 |

Historical evolution, per the Command OS definition: manual terminals → early coordination → Nexus → Room/evidence → runtime control → early Command → real operating stress → reusable Command OS.

## 3. Architecture (as built)

The authoritative operating note is the README plus current source. The figures below come from files and are not a runtime observation.
- **Data service** `server/data-service.mjs` provides read-only canonical source access. It imports `server/floor.mjs` (`buildFloor`), and `/api/surface` and `/api/floor` are served through it (#9282, #9272). The data service is historically on port 5177 and the Vite UI on 5173 (README; the launch section is historical).
- **UI** is React + Vite + Tailwind in `src/`. Navigation is defined in `src/lib/building-route.ts` (NAV, STUDIO_TABS). The canonical route classes counted at #9347 are Attention 5, Evidence 5, System 5, Company OS 5, ERP 7 and Hoadha 8, plus six Studio tabs.
- **Contracts** live in `src/lib/contracts.ts` (frozen CMD-DI-3-2a pin `81f6e9f6…`), including `WorkPackageRow` and `BuildingProjection`.
- **Building projection producers:** `server/building.mjs` (root sources) and `server/building-service.mjs` (carries `BuildingProjection`). Both are read-only boundaries (#9327).
- **Lifecycle:** the supported start/stop path is `D:\StarqTech\Start-Starq.bat` / `Stop-Starq.bat` → `scripts/command-lifecycle.mjs`. It is a **review candidate, not independently accepted; live use not authorized** (README). An Observation (read-only) mode also exists (`lifecycle.observation.config.json`, `Start-Command-Observation.bat`); its candidate is **not accepted** (#9288).

## 4. Organizational doctrine (observed in the Room record)

These principles are restated in Founder directives; the citations are representative.
1. **Room is authority.** Conversation, memory and handovers are subordinate (#9358, `FLOOR-LEADER-START-HERE.md`).
2. **Builder ≠ verifier.** No self-acceptance. Every deliverable is "PARKED FOR INDEPENDENT VERIFICATION" (#9258, #9270, #9274 and later).
3. **Prospective, not retroactive.** Acceptance applies to current bytes and behaviour. Historical provenance gaps stay UNKNOWN and are never manufactured (#9263, #9291, #9328).
4. **Explicit authorization per task.** Acceptance of a prior task never authorizes the next (#9277, #9289).
5. **Honesty over completeness.** UNKNOWN is never shown as zero, and unavailable sources are never faked (CMD-DI-1-1 honesty constraint; #9327 fixture policy).
6. **Human-first, conservative operations.** Paid seats are conserved (incident #9206/#9207). An ALL-STOP holds until it is lifted explicitly (#9208).
7. **Engineering Lesson #001 — "Safety is not coordination."** A safe shutdown is not necessarily a successful handoff. Before stopping a service, know who depends on it; before testing, verify the environment; before accepting evidence, verify what was actually tested. *"AUTHORIZED. COORDINATED. VERIFIED."* (#9356)

## 5. Programme structure

- **Phases 1–5** (Building Shell, Truth & Health, Dev Studio, ERP Process, Founder Attention): recorded complete, Founder-authorised 29 Sep 2026 (README). Phase 6–7 status is UNKNOWN; see the TASK_LEDGER entry `CMD-PHASE-6-7`.
- **CMD-DI — Design Integration** (the current programme): 21 dispatched tasks across 5 waves (Waves 0–4), specified in `DESIGN_INTEGRATION_EXECUTION_PACKAGE_CORRECTED_2026-10-10.md` (sha256 `40acb877…`). It integrates a redesigned interface (`Starq Command interface redesign.zip`, `starq-command-concept.html`) into the existing surfaces under strict source boundaries.
- **Goal:** the **Minimum Operational Development Studio** (Founder #9354, #9358, #9361). No document located defines it beyond these references (status PROPOSED).
- **Release gates (corrected package §F):** Gate 1 Design Integration implementation → Gate 2 independent code review → Gate 3 isolated UI preview (separate Founder authorization) → Gate 4 G-CONTAINMENT pass (platform-level) → Gate 5 source baseline promotion.
