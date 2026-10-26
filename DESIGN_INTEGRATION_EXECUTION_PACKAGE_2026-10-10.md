# STARQ // COMMAND — Design Integration Execution Package

**Authorization**: Founder directive 2026-10-10
**Status**: Implementation-ready plan (no source changes)
**Approved decision**: Navigate via Claude Design IA; preserve guards and observation pin
**Execution: Phase**: Following Founder dispatch per section §F (Release Boundaries)

---

## A. Screen Integration Matrix

Mapping: Design screen → Existing Command surface → Reuse/Adapt/Add → Backend work needed

| Design Screen | Current Command | Type | Existing React | Adaptation | New Component | Backend |
|---|---|---|---|---|---|---|
| **COMMAND SURFACE (1/2)** | | | | | | |
| Overview + staff glance | `overview.tsx` | ADAPT | PeerWorkHeader, cards | Mount `staff-glance.tsx`; show duty+execution states | `staff-glance.tsx` (NEW) | Glance counts: `/api/floor` server-side if not present |
| My Desk (approvals queue) | `attention.tsx` (Decisions tab) | REUSE | QueueWorkArea | Collapse Exceptions/Conflicts/Holds into detail rows | None | No change; sources are decisions/holds only |
| **DELIVERY SURFACES (2/2)** | | | | | | |
| Projects portfolio | Studio → Projects tab, Company → Portfolio | ADAPT | ProjectCard, lanes | Generalize by `project_id` for future board joins; keep UNKNOWN lanes | None | None (boards come from building projection) |
| Project workspace | `erp-room.tsx`, `hoadha-room.tsx` | REUSE | BuildingRecord tabs, task lanes | Preserve same tab/lane structure; generalize | None | None |
| Work (cross-project packages) | Activity tab, ERP Tasks, AssignmentRow | ADD | AssignmentRow, KV table | Create unified view with filters/grouping | `src/surfaces/work-packages.tsx` (NEW) | Normalized `/api/work-packages` endpoint (requires schema design) |
| Planning (milestones/schedule) | None | DEFER | — | — | — | No canonical milestone or schedule source (BLOCKED) |
| **WORKFORCE SURFACES (2/2)** | | | | | | |
| Staff / Staff detail | `staff.tsx` | ADAPT | RosterCard, PrimaryDetail | Add card/grid view toggle; status grouping; truth-disagreement inline | Toggle button, KV layout | None |
| Organization | `company-os.tsx` → Structure & Seats | REUSE | CompanyNode, ReportingLine | Show advisory reporting mappings with disclaimer; keep sections/H-seats | Disclaimer badge | None (keep read-only) |
| Resources (harness/model/quota) | Capacity tab, seat profile | ADAPT | CapacityPanel, KV row | Show declared quota/reset; model as DECLARED/UNKNOWN; no inferred usage | State token (DECLARED/UNKNOWN) | None (no quota truth source) |
| **RUNTIME SURFACES (3/2)** | | | | | | |
| Development Floor | `herdr.tsx`, `herdr-terminal.tsx` | REUSE | HerdrAgentRow, HerdrTerminal | Keep broker POSTs (open/start/stop); distinguish declared launch facts from live state | Sessions board (NEW) | None; live state from broker only |
| Sessions + Herdr panes board | New | ADD | LeaseRow, HerdrPaneRow (read-only) | Sessions and panes as separate lists; live state UNAVAILABLE if broker unreachable | `src/components/sessions-board.tsx` (NEW) | None; read broker state only |
| Room (conversations) | `evidence.tsx` Rooms tab | REUSE | ConversationList, RoomTimeline | Read-only; no channel/thread field (no Room contract); no search (8 MB raw cap) | None | None; defer routing/threading |
| **GOVERNANCE SURFACES (2/2)** | | | | | | |
| Governance (decisions/gates) | `attention.tsx` (all 5 tabs) | REUSE | GateStatus, HoldBanner, DecisionRow | Preserve non-dismissible hold banner; gates as audit-only | None | None |
| Evidence & History | `evidence.tsx` | REUSE | SourceList, evidence-peek drill-down | Read-only; no search | None | None |
| **SYSTEM (1/1)** | | | | | | |
| Administration | `system.tsx` → Health, Runtime, Sources, Contracts | REUSE | HealthGrid, SourceStatus, ContractStatus | Remove UI preferences (not operational); keep read-only manifest | None | None |

**Count**: 16 design screens → 12 reuse, 7 adapt, 3 add = **22 total service assignments** (some tasks touch multiple surfaces).

---

## B. Ordered Implementation Tasks

**Task ID format**: `CMD-DI-{wave}-{sequence}` (DI = Design Integration)

### Wave 0: Setup & Validation (Prerequisite, serialized)

**TASK CMD-DI-0-1** — Source hash baseline (read-only)
- **Owner**: @codex (verification authority)
- **Input**: `src/` directory, `server/data-service.mjs`, `observation/` (excluded), `scripts/lifecycle/` (excluded)
- **Work**: Compute SHA-256 manifest of source files and save to `00_STARQ_HQ/operations/starq-command/.source-baseline-2026-10-10.json` (metadata, not build)
- **Output**: Manifest with 50+ file hashes, timestamp, scope notes
- **Acceptance**: Manifest validates against current tree; hashes reproducible; no circular dependencies
- **Verifier**: @opencode
- **Duration**: 1–2h
- **Dependency**: Founder approval (granted)

**TASK CMD-DI-0-2** — Navigation test audit
- **Owner**: @opencode
- **Input**: `tests/architecture.test.ts`, `tests/phase7-corrective.test.ts`, `tests/structural-ownership.test.tsx`
- **Work**: Document which tests enforce read-only, honesty-gate, Phase-5 limit, no-computation, nav-length=7, no-merged-health. Propose which tests may be updated for presentation changes (e.g., "Staff surface may add card/grid toggle without changing its test scope").
- **Output**: Test audit document (`00_STARQ_HQ/operations/starq-command/DESIGN_INTEGRATION_TEST_AUDIT_2026-10-10.md`)
- **Acceptance**: All load-bearing guards identified; proposed changes stated with rationale
- **Verifier**: @codex
- **Duration**: 2–3h
- **Dependency**: Task 0-1 complete

### Wave 1: Frontend-only, low risk (Parallel, 2–3 builders)

**TASK CMD-DI-1-1** — New component: staff-glance board
- **Owner**: @cursor
- **Files**: `src/components/staff-glance.tsx` (new), `src/index.css` (tier updates)
- **Work**:
  - Props-only component: `{ staff: RosterEntry[], counts: RosterCounts }`
  - Render 6 status groups: WORKING, IDLE, BLOCKED, AWAITING_REVIEW, UNAVAILABLE, UNKNOWN
  - Show count + status bar (no computation)
  - Apply tier-ladder: stat at 13px, micro label at 11px, muted footnote at 10px
- **Acceptance**: Component renders with no `useState`/`useEffect`; counts come from props only; all states render (UNKNOWN never blank); no color computation
- **Verifier**: @vision
- **Duration**: 3–4h
- **Dependency**: None
- **Test**: New render test in `tests/design-integration.test.tsx` (new file)

**TASK CMD-DI-1-2** — New component: sessions + Herdr panes board
- **Owner**: @copilot
- **Files**: `src/components/sessions-board.tsx` (new)
- **Work**:
  - Two-section layout: Sessions (leases) and Herdr panes
  - Sessions: id, handle, host, open-time (from `surface.sessions`)
  - Herdr panes: declared row from manifest + live state row (if broker reachable); show UNAVAILABLE if not
  - Read-only; no controls
- **Acceptance**: Clean separation of declared vs. live; UNAVAILABLE never shows live as zero; lease rows shown with source (staff registry)
- **Verifier**: @vision
- **Duration**: 3–4h
- **Dependency**: None
- **Test**: Render test with mock sessions/panes

**TASK CMD-DI-1-3** — CSS tier ladder and mobile reflow
- **Owner**: @copilot
- **Files**: `src/index.css` (update), `tailwind.config.js` (update)
- **Work**:
  - Define micro floor (10px), body (13px), body-strong (13/600), label (11px), label-mono (11/mono/tracked)
  - Apply to stat values, KV pairs, footnotes consistently
  - Remove nested scrollers in capacity/staff views; use `overflow-x-auto` at the panel level with `@media (max-width: 800px)`
  - Confirm Space Grotesk, JetBrains Mono fonts remain; no new imports
- **Acceptance**: All font sizes align to baseline grid; mobile viewport ≥320px no horizontal scroll; Dark mode HSL overrides for charcoal/paper tokens in place
- **Verifier**: @opencode
- **Duration**: 2–3h
- **Dependency**: Design system token values (from ZIP)

**TASK CMD-DI-1-4** — Building route extension (Studio IA)
- **Owner**: @cursor
- **Files**: `src/lib/building-route.ts` (update)
- **Work**:
  - Extend `STUDIO_TABS` array: [Overview, Staff, Projects, Capacity, Activity, Herdr]
  - Update `parseBuildingRoute()` to recognize all 6 tabs
  - Update `routeHash()` for Studio routes (already handles `#studio/{tab}`)
  - Preserve legacy routes (#floor, #process, #truth)
- **Acceptance**: All 6 tabs route correctly; legacy shortcuts still work; ERP/Hoadha room tabs unaffected
- **Verifier**: @codex (security: no new routes bypass guards)
- **Duration**: 1h
- **Dependency**: None

**TASK CMD-DI-1-5** — Overview surface: mount glance
- **Owner**: @cursor
- **Files**: `src/surfaces/overview.tsx` (update)
- **Work**:
  - Import `staff-glance.tsx`
  - Mount above the three-truths grid
  - Pass `surface.staff_roster.counts` (RosterCounts from `/api/floor`)
  - Keep footer and all existing layout intact
- **Acceptance**: Glance visible; counts match surface data; no re-render on prop change (pure component); rest of overview unchanged
- **Verifier**: @vision
- **Duration**: 1h
- **Dependency**: Task 1-1 (staff-glance)

### Wave 2: Roster and surface expansion (Serialized; gates Wave 3)

**TASK CMD-DI-2-1** — Staff surface: card/grid view + status grouping
- **Owner**: @cursor
- **Files**: `src/surfaces/staff.tsx` (major update)
- **Work**:
  - Add toggle button: "Card view / Grid view" (default: table)
  - Card view: 2-column grid; one RosterCard per staff entry with duty/execution side-by-side, status badge, capacity note
  - Grid view: existing table layout
  - Add status grouping filter: "All / Working / Awaiting review / Blocked / Unavailable" (read from current state)
  - Inline truth-disagreement display: flag icon + "Duty ≠ Execution" (don't merge)
- **Acceptance**: Both views render all roster data identically; filter works; no computed state (groups come from surface.staff_roster); toggling preserves scroll position
- **Verifier**: @vision
- **Duration**: 4–5h
- **Dependency**: Task 1-4 (routes); Task 0-2 (test audit)
- **Test**: Card/grid/filter render tests

**TASK CMD-DI-2-2** — Project board generalization
- **Owner**: @cursor
- **Files**: `src/surfaces/project-board.tsx` (update)
- **Work**:
  - Accept any `project_id` from the route query param (not just 'erp' or 'hoadha')
  - Map lane by `project_id` + canonical `status` field (existing logic)
  - Show UNKNOWN lane for unmapped statuses (existing)
  - Preserve task count, lane filtering, identity verification
  - Keep ERP/Hoadha as special cases (their own surfaces with tabs)
- **Acceptance**: Board renders for any project with a building projection; other projects show UNKNOWN; ERP/Hoadha routes unchanged
- **Verifier**: @codex
- **Duration**: 2–3h
- **Dependency**: Task 1-4 (routes)

**TASK CMD-DI-2-3** — Company OS: advisory reporting disclaimer
- **Owner**: @antigravity (Founder assigned; they own seat registry)
- **Files**: `src/surfaces/company-os.tsx` (update in Structure tab)
- **Work**:
  - In the reporting-line column, add disclaimer: "Proposed Accountability Mapping (Advisory). Ratified designations and standings per Chapter 22."
  - Keep read-only: no edit controls
  - Preserve H-seats, sections, all existing data
- **Acceptance**: Disclaimer visible; no change to data or mutation paths; Company surface still read-only
- **Verifier**: @vision
- **Duration**: 1h
- **Dependency**: None; coordination with @antigravity on Phases 2–3 ramifications

**TASK CMD-DI-2-4** — Room: read-only conversation experience
- **Owner**: @cursor
- **Files**: `src/surfaces/room.tsx` (update), contracts if needed (consult @opencode)
- **Work**:
  - Extend Room surface to show a read-only conversation list and selected-conversation detail
  - Pull channel ID from the URL (`route.room` in Company view; not per-project channels yet)
  - Show message list from `agent-comms/room.jsonl` (via `/api/raw?path=room.jsonl`, capped at 8 MB)
  - No search, no routing by project, no threading (no contract field)
  - Defer message composition, delivery confirmation, notifications
  - Show footer: "Read-only. Composition pending Room contract upgrade (Phase 6, not authorized)."
- **Acceptance**: Conversation list renders; detail shows messages in order; performance acceptable for 8 MB; no write path; composition deferred
- **Verifier**: @codex
- **Duration**: 3–4h
- **Dependency**: Room contract clarification from @opencode (brief API review)

### Wave 3: Server and contracts (Gated by Wave 2)

**TASK CMD-DI-3-1** — Staff glance counts (server side)
- **Owner**: @codex
- **Files**: `server/floor.mjs` (update), optionally `src/lib/contracts.ts` (glance type)
- **Work**:
  - If `/api/floor` already returns RosterCounts with status groupings, no change
  - If not: compute glance counts server-side (do NOT move to React)
  - Return: `{ working: N, idle: N, blocked: N, awaiting_review: N, unavailable: N, unknown: N }`
  - Counts derived from `roster_entry.duty_state` and `current_state` (not inferred)
- **Acceptance**: Counts match roster filtering on client; all values ≥ 0; UNKNOWN shows count, not blank; test on `/api/floor` GET
- **Verifier**: @opencode (computation guard)
- **Duration**: 1–2h
- **Dependency**: Task 2-1 (staff surface needs counts)

**TASK CMD-DI-3-2** — Work-package contract design (schema only)
- **Owner**: @codex
- **Files**: `src/lib/contracts.ts` (add WorkPackage interface), no server impl yet
- **Work**:
  - Define normalized WorkPackageRow: id, project_id, title, current_stage, owner, verifier, board_lane, source
  - Clarify how ERP tasks, Hoadha items, and general assignments map to this schema
  - Propose `/api/work-packages` endpoint signature (no implementation)
  - Document whether this is Wave 3 or deferred
- **Acceptance**: Interface is typed; mapping documented; ready for Founder decision on Phase 4 (if approved, separate task to implement server endpoint)
- **Verifier**: @opencode (contracts)
- **Duration**: 2–3h
- **Dependency**: Task 2-2 (generalized project board)
- **Note**: Endpoint implementation deferred pending Founder approval

**TASK CMD-DI-3-3** — Observation candidate pin management (verification only)
- **Owner**: @codex
- **Files**: Review only; no edits to `data-service.mjs`, `observation/*`, `scripts/lifecycle/*`
- **Work**:
  - Confirm that no changes in Wave 1–2 affect observation build inputs
  - If Wave 3 touches `server/floor.mjs`, verify observation candidate still applies
  - Generate new candidate manifest only if needed (separate authorization)
- **Acceptance**: Observation pin remains valid; no surprise cache invalidation
- **Verifier**: @opencode
- **Duration**: 0.5h per verification cycle (not per-task)
- **Dependency**: Each Wave 3 task that edits server

### Wave 4: Guards and presentation tests (Parallel with Wave 3)

**TASK CMD-DI-4-1** — Architecture guard updates (if needed)
- **Owner**: @opencode
- **Files**: Tests in `tests/architecture.test.ts`, etc.; update only per audit (Task 0-2)
- **Work**:
  - If Task 0-2 identified presentation-specific tests that need updates, implement them
  - Update: card/grid toggle doesn't trigger load-bearing maturity or computation tests
  - Preserve: read-only, no mutation, Phase-5 limit, no merged health, honesty gates
- **Acceptance**: All guard tests still pass; security/integrity guards untouched; only presentation logic modified
- **Verifier**: @vision (independent)
- **Duration**: 1–2h per guard change
- **Dependency**: Task 0-2 (audit identifies what to change)

**TASK CMD-DI-4-2** — New design-integration render tests
- **Owner**: @opencode
- **Files**: `tests/design-integration.test.tsx` (new)
- **Work**:
  - Test staff-glance with various RosterCounts; verify no computation
  - Test sessions board with mock data; verify separation of declared/live
  - Test staff card view; verify filter works; no state mutation
  - Test CSS tier ladder; font sizes, mobile reflow
  - Test Company advisory disclaimer renders
- **Acceptance**: All new components render correctly; no unexpected state changes; coverage ≥ 80% of new code paths
- **Verifier**: @vision
- **Duration**: 3–4h
- **Dependency**: Tasks 1-1, 1-2, 1-3, 2-1, 2-3 (components exist)

**TASK CMD-DI-4-3** — Production build verification
- **Owner**: @opencode
- **Files**: `vite.config.ts`, `tsconfig.json`, build output
- **Work**:
  - Run `npm run build` (production Vite build)
  - Verify no errors, no warnings
  - Confirm bundle size within acceptable bounds (no major regressions)
  - Test observation build separately (if touched)
- **Acceptance**: Build succeeds; all TypeScript strict mode; no console warnings; observation candidate still pins
- **Verifier**: @codex
- **Duration**: 1h (run time only)
- **Dependency**: Wave 1–3 tasks complete

---

## C. Navigation Migration

### Current (7-item nav)
```
Overview
Company
Building
Dev Studio
Founder Attention
Evidence
System
```

### Design intent (16-item nav in Dev Studio)
```
Studio:
  Overview
  My Desk
  Staff
  Projects
  Work
  Planning
  Organization
  Resources
Runtime:
  Development Floor
  Room
Governance:
  Decisions
  History
```

### Integration approach (Preserves 7-item rail)

**Keep the 7-item rail.** Move the design's IA inside Dev Studio:

1. **Dev Studio nav** (in-context tabs, not rail):
   - Overview (new: glance + three-truths)
   - Staff (new: card/grid + grouping)
   - Projects (existing generalized board)
   - Capacity (existing; moved from Herdr context)
   - Activity (existing; renamed from "Herdr" parent context)
   - Herdr (existing; operational panes)

2. **Company OS tabs** (Founder Attention context):
   - Structure (organization + reporting)
   - Seats (H-seat/staff profile; moved from Studio)
   - Portfolio (rooms + dormant)
   - Founder (Founder actions)
   - Infrastructure (shared systems)

3. **Evidence tabs** (unchanged):
   - Sources
   - Projection
   - Decisions
   - Rooms (new: read-only conversations)
   - Hashes

4. **System tabs** (unchanged):
   - Health
   - Runtime
   - Sources
   - Contracts
   - Projection

**Design IA mapping**:
- *COMMAND* (My Desk): → Attention rail item (existing)
- *DELIVERY* (Projects, Work, Planning): → Dev Studio (Projects, Activity, deferred Planning)
- *WORKFORCE* (Staff, Organization, Resources): → Dev Studio (Staff, Capacity) + Company (Structure, Seats)
- *RUNTIME* (Development Floor, Sessions, Room): → Dev Studio (Herdr) + Evidence (Rooms)
- *GOVERNANCE* (Governance, Evidence): → Attention + Evidence rail items (existing)
- *SYSTEM* (Administration): → System rail item (existing)

**Rationale**:
- The 7-item rail is load-bearing for Phase-5 authorization and guard tests. Changing it requires Founder override.
- The design's deeper IA fits natively within Dev Studio (the largest surface) and Company OS.
- No functionality is lost; surfaces are reorganized for discovery flow.
- This preserves the guard: `NAV.length === 7`, `NAV.map(i => i.id) === ['overview', 'company', 'building', 'studio', 'attention', 'evidence', 'system']`.

---

## D. Engineering Coordination

### Verified work in progress (file-based evidence, Oct 10)

| Worker | Package | Scope | Overlap with design integration | Status | Action |
|---|---|---|---|---|---|
| Antigravity | `starqerp-control-board/` | ERP process/work-model (Python, Sep 28–30) | **NONE**. AG's control board is input to Command; no UI changes. | Verified/complete | No action needed; design integration reads AG output. |
| Codex | `evidence/d2-r2-review/` | D2-P native fixture (not Command) | **NONE**. D2 is platform lifecycle; Command is not a target. | Verified/complete | No action needed. |
| Codex | `evidence/observation-*-hardening/` | Observation candidate pin (Oct 9) | **BLOCKS server changes**. Any task touching `data-service.mjs`, `server/floor.mjs` or lifecycle routes must verify pin still applies. | Verified/current | Task 3-3: pin verification per Wave 3. |
| Vision | No new Room posts (seq 9257 last) | — | — | Verified (quiet since Oct 8) | No action needed. |
| Deadpool | No new Room posts; no file evidence | — | — | Verified (quiet since Oct 8) | No action needed. |

### Terminal reports NOT available in workspace
- Earlier Antigravity/Vision/Codex reports from before Sep 9 are not accessible (outside root). Only current file evidence and Room seq 9257 are authoritative.

### Flag: potential overlaps (none identified)
- Design integration works at UI/contracts layer
- AG's work is data generation (control board)
- D2-P is separate lifecycle (not Command)
- Observation pin is orthogonal (blocks *server* changes only, which are minimal in Wave 1–2)

**Conclusion**: No competing edits identified. Parallel task execution is safe as specified in §B.

---

## E. Verification Strategy

### Phase 1: Offline static analysis (during implementation)

**TypeScript strict mode**
```bash
npm run typecheck
# Acceptance: zero errors, zero warnings
```

**Linting** (existing)
```bash
npm run lint
# Acceptance: passes existing rules
```

**Architecture guards** (subset, before build)
```bash
npm test -- tests/architecture.test.ts tests/read-only-capability.test.ts
# Acceptance: all pass; no exceptions for presentation
```

### Phase 2: Unit and render tests (after Wave 1–2)

**New component tests** (Task 4-2):
```bash
npm test -- tests/design-integration.test.tsx
# Acceptance: all new components tested; no computation in React; data flows from props only
```

**Staff surface tests**:
```bash
npm test -- tests/staff-board.test.tsx (if exists) or new render test
# Acceptance: card/grid/filter work; no state leakage
```

### Phase 3: Production build (Wave 4, Task 4-3)

```bash
npm run build
# Acceptance: zero errors; bundle size acceptable (< 5% change); observation candidate still valid
```

### Phase 4: Structural ownership guards (before merge)

```bash
npm test -- tests/structural-ownership.test.tsx
# Acceptance: each surface owns its question; no duplicated headings; honesty gate rendered first
```

### Phase 5: Independent review

**After Task 4-3 (build passes)**:
- **Builder**: the assigned task owner (per §B)
- **Verifier**: the assigned verifier (per §B)
- **Independent review**: @vision (designated independent reviewer for Command)
  - Checklist: read-only preserved, guards passing, no computation in React, honesty gate above data
  - Sign-off required before merge to any branch

### Phase 6: Visual acceptance (authorized later, requires G-CONTAINMENT gate)

- Deferred until Founder authorizes service startup
- When authorized: @vision and @mustarq review live UI against design mockups
- Acceptance: layout, typography, color, interactions match design intent
- **This phase is NOT part of the current implementation package**

---

## F. Release Boundaries

These gates are sequential and **mutually independent**. Each must be authorized separately.

### Gate 1: Design Integration Acceptance (current)
- **Requirements**: All tasks in §B (Waves 0–4) complete and verified
- **Acceptance criteria**: TypeScript strict, tests pass, no computation in React, observation pin valid
- **Decision**: Founder approves or requests changes
- **Blocks**: Nothing (this phase is isolated)
- **Enables**: Merge to a development branch for code review

### Gate 2: Independent Verification (code review)
- **Requirements**: Design integration merged to dev branch; @vision review complete
- **Acceptance criteria**: All verifiers signed off; no guard weaknesses; read-only enforced
- **Decision**: Founder or @codex approves merge to main/next release branch
- **Blocks**: Release or deployment
- **Enables**: Packaging for deployment

### Gate 3: G-CONTAINMENT Pass (platform, not Command)
- **Requirements**: D2-P native fixture evidence, Guardian acceptance, native runtime authorization (all separate)
- **Acceptance criteria**: 13/13 containment cases PASS (currently 0/13)
- **Decision**: Founder + independent auditor
- **Blocks**: Service startup (all workers, all projects)
- **Enables**: Authorized use of the managed floor

### Gate 4: Source hash baseline promotion
- **Requirements**: Baseline from Task 0-1; design integration merged; no drift
- **Acceptance criteria**: Current source hashes match baseline; development branch is clean
- **Decision**: Founder or @codex
- **Blocks**: Nothing immediate; enables future git-reset-to-baseline checks
- **Enables**: Automated source verification in CI

### Gate 5: Visual acceptance (deferred)
- **Requirements**: G-CONTAINMENT PASS; service startup authorized; @vision review
- **Acceptance criteria**: Live UI matches design mockups (layout, color, typography, interaction)
- **Decision**: Founder + @vision
- **Blocks**: Release to production / live environment
- **Enables**: Operator use of the new interface

### Boundary diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Design Integration (this package): Waves 0–4, §B             │
│ → TypeScript ✓, tests ✓, observation pin ✓                  │
└──────────────────┬──────────────────────────────────────────┘
                   ↓ (Founder approves Gate 1)
┌──────────────────────────────────────────────────────────────┐
│ Independent Code Review                                      │
│ → @vision, @codex sign-off                                   │
└──────────────────┬───────────────────────────────────────────┘
                   ↓ (Founder approves Gate 2)
┌──────────────────────────────────────────────────────────────┐
│ G-CONTAINMENT Platform Gate (D2-P + Guardian)                │
│ → All 13 cases PASS (separate authorization)                 │
└──────────────────┬───────────────────────────────────────────┘
                   ↓ (Founder approves Gates 3 & 4)
┌──────────────────────────────────────────────────────────────┐
│ Service Startup Authorization + Source Baseline Promotion    │
│ → Managed floor opened; Command live                         │
└──────────────────┬───────────────────────────────────────────┘
                   ↓ (Founder approves Gate 5, @vision signs off)
┌──────────────────────────────────────────────────────────────┐
│ Production Release                                           │
│ → Live interface with new IA                                │
└──────────────────────────────────────────────────────────────┘
```

---

## Summary & Next Steps

**This execution package is complete and ready for dispatch.**

- **Wave 0** (setup): 2 tasks, 1 owner, 3–5h
- **Wave 1** (frontend): 5 tasks, 3 builders (parallel), 12–14h wall time
- **Wave 2** (roster/surfaces): 4 tasks, 2 builders (serial), 10–12h
- **Wave 3** (server): 3 tasks, 1 builder, 3–5h
- **Wave 4** (guards/tests): 3 tasks, 2 builders (parallel), 5–7h

**Total**: 17 tasks, 6 builders + verifiers, ~40–45h estimated effort (accounting for parallel execution in Waves 1 & 4).

**Founder to dispatch** (per assigned builder/verifier roles in §B):
- Wave 0-1: @codex (setup), @cursor (new components), @copilot (CSS), @vision (verification)
- Wave 2: @cursor (staff), @antigravity (Company), @codex (board), @opencode (tests)
- Wave 3: @codex (server)
- Wave 4: @opencode (tests), @vision (independent review)

**Authorization gates**:
1. ✅ **Gate 1 (Design Integration)**: Conditional on Waves 0–4 complete → Founder approval
2. ✅ **Gate 2 (Code Review)**: Conditional on independent verification → Founder approval
3. ✅ **Gate 3 (G-CONTAINMENT)**: Separate; D2-P + Guardian work → Founder + auditor
4. ✅ **Gate 4 (Source baseline)**: Conditional on Gate 2 → Founder approval
5. ✅ **Gate 5 (Visual acceptance)**: Conditional on Gates 3 & 4 → Founder + @vision approval

**No implementation has been started. All tasks are ready for assignment.**

---

**Approved by**: Founder (2026-10-10)  
**Prepared by**: Claude Sonnet 5.5, Read-only reconnaissance and planning  
**Status**: Ready for worker dispatch
