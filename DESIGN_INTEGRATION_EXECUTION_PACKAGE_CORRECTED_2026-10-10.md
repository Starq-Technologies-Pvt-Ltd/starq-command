# STARQ // COMMAND — Design Integration Execution Package (Corrected)

**Authorization**: Founder directive 2026-10-10  
**Status**: Implementation-ready plan (no source changes)  
**Approved decision**: Implement Claude Design navigation intent; identify and gate presentation-specific test changes  
**Execution phase**: Following Founder dispatch per section §F (Release Boundaries)

> ## RECONCILED — Wave 0 authoritative package reconciliation, 2026-10-10
>
> This revision incorporates Founder decisions B2–B7 from the CMD-DI-0-2 audit
> (`DESIGN_INTEGRATION_TEST_AUDIT_2026-10-10.md`, sha256 `84afe4d9…aba7a`, 521 lines, as amended
> with the B1 recovery record at §9). B1 is closed and is not revisited.
>
> | Decision | Effect on this package |
> |---|---|
> | **B2** | Programme normalized to a single authoritative task/wave census in §Summary. CMD-DI-4-3 (production-build verification) reinstated and retained. All contradictory counts removed. |
> | **B3** | **Work screen is IN SCOPE.** §A, §C and Task 2-5 reconciled. CMD-DI-3-2a/b/c added. Scope is the Design Integration Work surface only — **not** the full future Command WorkPackage architecture. |
> | **B4** | Task 2-4 re-anchored to the existing Rooms implementation. **Superseded by ruling 3**: the target is `EvidenceRoomsPeer` in `src/surfaces/building.tsx`, **not** `evidence.tsx`. No duplicate Room surface is created. |
> | **B5** | Blanket "all tests pass" acceptance replaced by explicit **no-regression against the accepted known-red baseline**. |
> | **B6** | Studio peer list derivation from canonical `STUDIO_TABS` approved as **guard strengthening** and scheduled in CMD-DI-4-1. Not cleanup, not relaxation. |
> | **B7** | Baseline extension (§5.1–§5.6 of the audit) **must close before any affected file is modified**. Enforced as a dependency on CMD-DI-0-1. |
> | **1-4 rescope** | CMD-DI-1-4 is **presentation-only**. The six canonical Studio tabs already exist byte-for-byte at `src/lib/building-route.ts:31`. **No NAV or STUDIO_TABS census modification is authorized for this task.** |
>
> **Second correction pass — Founder rulings 2026-10-10 (from Cursor cold-start reconnaissance):**
>
> | Ruling | Effect |
> |---|---|
> | **1 — Census FINAL** | **21 dispatched tasks / 5 waves is FINAL.** CMD-DI-3-3 is **not** folded into CMD-DI-4-3. No wording implying 20 (or 17) remains. |
> | **2 — CMD-DI-1-5** | Staff Glance mounts in **`src/surfaces/company.tsx` → `DevStudio`** (line 599), the Studio Overview / DevStudio path. **`src/surfaces/overview.tsx` is the ERP process Overview and is out of scope.** CMD-DI-1-1 remains props-only; **counts are never fabricated**; unavailable buckets render honestly UNKNOWN until CMD-DI-3-1. **No server work in Wave 1.** |
> | **3 — CMD-DI-2-4** | The `#evidence/rooms` implementation is **`EvidenceRoomsPeer` in `src/surfaces/building.tsx` (line 278)**. That is the target. No `room.tsx`; Rooms ownership is **not** `evidence.tsx`; no silent migration. **CMD-DI-3-2b Work must not overwrite or repurpose Evidence → Rooms.** Later extraction requires separate authorization. |
> | **4 — CMD-DI-1-4** | Presentation changes may include the existing Studio TabRail. **`src/surfaces/building.tsx` is added explicitly to the blast radius** (presentation only). `STUDIO_TABS` values/order immutable; `NAV` identity/order immutable; `building-route.ts` **read-only**; `#floor`/`#process`/`#truth` preserved. |
> | **5 — Vision** | CMD-DI-0-2 remains **PENDING** until Vision independently accepts. |
> | **6 — Historical reports** | Old audit and AG evidence are **not** rewritten to match current state. Only this package and the dispatch summary carry present state. |
> | **7 — P3A** | P3A-4 / P3A-6 ownership remains **unresolved**, pending the dedicated reconciliation lane. |
>
> Both target corrections above were **verified against source before being written down**: `overview.tsx` exports `OverviewSurface` (ERP process closure, WF-ERP-01/02/03); `company.tsx:599` exports `DevStudio`; `building.tsx:278` defines `EvidenceRoomsPeer` and `:132` dispatches it; `building.tsx:1105-1110` resolves `STUDIO_TABS` for the Studio tab rail.
>
> **Accepted test baseline for all no-regression gates:** 31 test files · **821 tests collected · 815 passed · 6 known-red (F3–F8)** · zero newly exposed failures. Individual known-red identities are preserved; see CMD-DI-4-1.

---

## A. Screen Integration Matrix

Mapping: Design screen → Existing Command surface → Reuse/Adapt/Add → Backend work needed

| Design Screen | Current Command | Type | Existing React | Adaptation | New Component | Backend |
|---|---|---|---|---|---|---|
| **COMMAND SURFACE** | | | | | | |
| Overview + staff glance | **`company.tsx` → `DevStudio` (line 599)** — the Studio Overview path. **NOT `overview.tsx`**, which is ERP process Overview | ADAPT | PeerWorkHeader, cards | Mount `staff-glance.tsx`; show duty+execution states | `staff-glance.tsx` (NEW) | `/api/floor` server-side via CMD-DI-3-1. **Until then unavailable buckets render honestly UNKNOWN — never 0, never fabricated.** |
| My Desk (approvals queue) | `attention.tsx` (Decisions tab) | REUSE | QueueWorkArea | Collapse Exceptions/Conflicts/Holds into detail rows | None | No change; sources are decisions/holds only |
| **DELIVERY SURFACES** | | | | | | |
| Projects portfolio | Existing Studio → Projects tab | ADAPT | ProjectCard, lanes | Generalize by `project_id` for future board joins; keep UNKNOWN lanes | None | None (boards come from building projection) |
| Project workspace | `erp-room.tsx`, `hoadha-room.tsx` | REUSE | BuildingRecord tabs, task lanes | Preserve same tab/lane structure; generalize | None | None |
| Work (cross-project packages) | Activity tab, ERP Tasks, AssignmentRow | **IN SCOPE** | QueueWorkArea, AssignmentRow | Read-only package list driven by the CMD-DI-3-2a contract; filters only; no write path | None — Wave 2 surface structure lands with CMD-DI-3-2b | Contract schema designed in CMD-DI-3-2a. **No server implementation is authorized by this package.** |
| Planning (milestones/schedule) | None | **DEFERRED** | — | — | — | No canonical milestone or schedule source (BLOCKED). Sole remaining deferred screen. |
| **WORKFORCE SURFACES** | | | | | | |
| Staff / Staff detail | `staff.tsx` | ADAPT | RosterCard, PrimaryDetail | Add card/grid view toggle; status grouping; truth-disagreement inline | Toggle UI | None |
| Organization | `company-os.tsx` Structure tab | REUSE | CompanyNode, ReportingLine | Show advisory reporting mappings with disclaimer; keep sections/H-seats | Disclaimer badge | None (keep read-only) |
| Resources (harness/model/quota) | Capacity tab, seat profile | ADAPT | CapacityPanel, KV row | Show declared quota/reset; model as DECLARED/UNKNOWN; no inferred usage | State token | None (no quota truth source) |
| **RUNTIME SURFACES** | | | | | | |
| Development Floor | `herdr.tsx`, `herdr-terminal.tsx` | REUSE | HerdrAgentRow, HerdrTerminal | Keep broker POSTs (open/start/stop); distinguish declared launch facts from live state | Sessions board (NEW) | None; live state from broker only |
| Sessions + Herdr panes board | New | ADD | LeaseRow, HerdrPaneRow (read-only) | Sessions and panes as separate lists; live state UNAVAILABLE if broker unreachable | `src/components/sessions-board.tsx` (NEW) | None; read broker state only |
| Room (conversations) | **`building.tsx` → `EvidenceRoomsPeer` (line 278)**, dispatched at line 132 for `tab === 'Rooms'` | ADAPT | ConversationList, RoomTimeline | Chronological read-only view from `room.jsonl`; visibly mark unsupported features | Unavailability notices | None; no new contract field support. **Distinct from Work (CMD-DI-3-2b) — must not be overwritten or repurposed.** |
| **GOVERNANCE SURFACES** | | | | | | |
| Governance (decisions/gates) | `attention.tsx` (all 5 tabs) | REUSE | GateStatus, HoldBanner, DecisionRow | Preserve non-dismissible hold banner; gates as audit-only | None | None |
| Evidence & History | `evidence.tsx` | REUSE | SourceList, evidence-peek drill-down | Read-only; no search | None | None |
| **SYSTEM** | | | | | | |
| Administration | `system.tsx` Health/Runtime/Sources | REUSE | HealthGrid, SourceStatus, ContractStatus | Keep read-only manifest; remove inoperable UI preferences | None | None |

**Count**: 16 design screens → 12 reuse, 7 adapt, 3 add, 1 deferred = **23 total service assignments**. Work moved from deferred to in scope per B3; Planning is the sole remaining deferred screen.

---

## B. Ordered Implementation Tasks

**Task ID format**: `CMD-DI-{wave}-{sequence}` (DI = Design Integration)

### Wave 0: Setup & Validation (Prerequisite, serialized)

**TASK CMD-DI-0-1** — Pre-change source hash baseline
- **Owner**: @codex (verification authority)
- **Input**: Current `src/`, `server/data-service.mjs`, `server/floor.mjs` (pre-change state)
- **Work**: Compute SHA-256 manifest of all source files; save to `00_STARQ_HQ/operations/starq-command/.source-baseline-2026-10-10-pre.json` (metadata, not build)
- **Output**: Manifest with 52 file hashes, timestamp, exact scope
- **Acceptance**: Manifest validates against current tree; hashes reproducible; no changes since capture
- **Verifier**: @opencode
- **Duration**: 1–2h
- **Dependency**: Founder approval (granted)
- **STATUS**: **CORE ACCEPTED.** Independently verified by @opencode — 52/52 hash and byte-exact, 0 missing, 0 extra, digest `456b845c…9885`, timestamps coherent, Codex's asserted package hashes reproduced.
- **B7 — BASELINE EXTENSION (REQUIRED, OPEN)**: The accepted manifest covers `src/**` + `server/data-service.mjs` + `server/floor.mjs` only. The files below are modified or consumed by planned tasks and carry **no pre-change hash**. They must be added to the manifest **before any of them is modified**:
  - **§5.1 (mandatory, CMD-DI-1-3)**: `tailwind.config.js` `ece2b068…6143`, `postcss.config.js` `e32657ba…80bc`
  - **§5.2 (mandatory, CMD-DI-4-3)**: `vite.config.ts` `cf823fc5…3c91`, `tsconfig.json` `ee30af47…ad12`, `index.html` `2dab9886…7257`
  - **§5.3 (mandatory, test/build gates)**: `vitest.config.ts` `f848fb9d…aa93`, `package.json` `f77b8a88…9259`, `package-lock.json` `621d5518…c5f6`
  - **§5.4 (mandatory, AG P3A-1 lane)**: `integrations/herdr/herdr-client.mjs` `d80ecd6f…f46b`, `integrations/herdr/herdr-service.mjs` `7eb89306…ba8c`
  - **§5.5 (mandatory, AG P3A-4 / P3A-6)**: `server/building.mjs`, `server/staff-profile.mjs`, `server/snapshot.mjs`, `server/company-os.mjs`, `server/health-floor.mjs`, `server/paths.mjs`, `server/path-guard.mjs`, `server/gates.mjs`
  - **§5.6 (strongly recommended, CMD-DI-4-1)**: `tests/**` guard-change baseline — 31 files, aggregate digest `41ddaa10…8177cd`
  - **§5.7 (mandatory)**: the restored governing census artifact, hashed so the baseline no longer carries an unpinned external dependency
  - Full per-file hashes: `DESIGN_INTEGRATION_TEST_AUDIT_2026-10-10.md` §5
- **Blocking rule**: **No task in any wave may modify a file listed above until the extension is closed.**

**TASK CMD-DI-0-2** — Navigation test audit & presentation guard identification
- **Owner**: @opencode
- **Input**: `tests/architecture.test.ts`, `tests/phase7-corrective.test.ts`, `tests/structural-ownership.test.tsx`
- **Work**: Identify all load-bearing guards (read-only, honesty-gate, Phase-5, no-computation, nav-structure, no-merged-health). Identify presentation-specific tests that may be updated vs. core guards that must not change. Propose which tests block the design's grouped navigation and what Founder approval is required to modify them.
- **Output**: `DESIGN_INTEGRATION_TEST_AUDIT_2026-10-10.md` (sha256 `84afe4d9…aba7a`) — delivered, with categories A–E, every classification carrying file:line evidence
- **Acceptance**: Met. All guards categorized; update rationale stated per file:line; no vague recommendations
- **Verifier**: @vision (independent) — **PENDING**
- **Duration**: 2–3h
- **Dependency**: Task 0-1 complete
- **Key audit finding**: `NAV.length === 7` (`tests/phase7-corrective.test.ts:189`) is a **census**; the load-bearing guard is `tests/phase7-corrective.test.ts:319`, which pins exact identity **and** order, grounded in Founder Room seq 8486/8487. The dispatch summary's characterisation of these as a single "position assertion" understates the guard.
- **Founder decisions B5, B6 and the CMD-DI-1-4 rescope are recorded in this package** and are implemented in CMD-DI-4-1 and CMD-DI-1-4 respectively.

**TASK CMD-DI-0-3** — AG coordination reconciliation
- **Owner**: @codex
- **Input**: Recent workspace file evidence (git-status Oct 10), Room seq 9257 cap, Task CMD-DI-0-2 output
- **Work**: Search for AG's recent Command remediation plan or UI integration work beyond the Sep 28–30 control-board files. If found, document scope and overlaps with CMD-DI tasks. If not found, mark as unresolved and request Founder/AG clarification before Wave 1 execution.
- **Output**: AG coordination memo (`DESIGN_INTEGRATION_AG_COORDINATION_2026-10-10.md`)
- **Acceptance**: Clear statement: "AG work found at [paths]" or "AG recent plans not located; awaiting clarification"
- **Verifier**: @vision
- **Duration**: 1–2h
- **Dependency**: Task 0-1 complete
- **Blocker**: If AG work found, update Wave 1–2 ownership before dispatch

### Wave 1: Frontend-only, low risk (Parallel, 3 builders, **after 0-2 approval**)

**TASK CMD-DI-1-1** — New component: staff-glance board
- **Owner**: @cursor
- **Files**: `src/components/staff-glance.tsx` (new only)
- **Work**:
  - Props-only component: `{ staff: RosterEntry[], counts: RosterCounts }`
  - Render 6 status groups: WORKING, IDLE, BLOCKED, AWAITING_REVIEW, UNAVAILABLE, UNKNOWN
  - Show count + status bar (no computation)
  - CSS: use existing variables only; do not edit `src/index.css`
- **Acceptance**: Component renders with no `useState`/`useEffect`; counts from props only; all states render (UNKNOWN never blank); no color computation
- **Verifier**: @vision
- **Duration**: 3–4h
- **Dependency**: None
- **Test**: New render test in `tests/design-integration.test.tsx` (new file, @opencode creates)

**TASK CMD-DI-1-2** — New component: sessions + Herdr panes board
- **Owner**: @copilot
- **Files**: `src/components/sessions-board.tsx` (new only)
- **Work**:
  - Two-section layout: Sessions (leases) and Herdr panes
  - Sessions: id, handle, host, open-time (from `surface.sessions`)
  - Herdr panes: declared row from manifest + live state row (if broker reachable); show UNAVAILABLE if not
  - Read-only; no controls
- **Acceptance**: Clean separation of declared vs. live; UNAVAILABLE never shows live as zero; lease rows shown with source
- **Verifier**: @vision
- **Duration**: 3–4h
- **Dependency**: None
- **Test**: Render test (new)

**TASK CMD-DI-1-3** — CSS tier ladder and mobile reflow
- **Owner**: @copilot (exclusive owner of index.css)
- **Files**: `src/index.css` (update), `tailwind.config.js` (update)
- **Work**:
  - Define micro floor (10px), body (13px), body-strong (13/600), label (11px), label-mono (11/mono/tracked)
  - Apply to stat values, KV pairs, footnotes
  - Remove nested scrollers in responsive panels; use `overflow-x-auto` at panel level for `@media (max-width: 800px)`
  - Confirm Space Grotesk, JetBrains Mono fonts; no new imports
- **Acceptance**: All font sizes align to baseline grid; mobile viewport ≥320px no horizontal scroll; dark mode HSL overrides in place
- **Verifier**: @opencode
- **Duration**: 2–3h
- **Dependency**: None
- **Coordination**: Task 1-1 must not edit `index.css`; coordinate with @cursor on timeline

**TASK CMD-DI-1-4** — Studio presentation grouping — **RESCOPED: PRESENTATION ONLY** (Founder ruling 2026-10-10)
- **Owner**: @cursor
- **Blast radius (presentation only)**:
  - `src/components/shell.tsx` — rail presentation within the Studio context
  - `src/surfaces/building.tsx` — **the Studio TabRail**, where `const tabs = … : STUDIO_TABS` is resolved (lines 1105–1110) and the Studio tab rail renders. Added explicitly per Founder ruling; **presentation only**.
  - `src/lib/building-route.ts` — **READ-ONLY. Not modified.**
- **RESCOPE (Founder, 2026-10-10)**: The six canonical Studio tabs **already exist byte-for-byte** at `src/lib/building-route.ts:31`:
  `export const STUDIO_TABS = ['Overview', 'Staff', 'Projects', 'Capacity', 'Activity', 'Herdr'];`
  `COMPANY_VIEWS` (`building-route.ts:1-9`) already holds the seven rail ids. The package's former claim that this task "is NOT just listing existing tabs" is incorrect as to the tab list.
- **Work** (presentation only):
  - Apply Claude Design grouping and visual treatment to the existing Studio tab rail, including grouping/visual changes in the existing Studio TabRail presentation where required
  - Optional tertiary breadcrumb showing current grouping (design guidance)
  - Preserve ERP/Hoadha room tab structures (their own structure)
  - Preserve legacy route behaviour: `#floor` → studio/staff, `#process` → studio/erp/process, `#truth` → studio/erp/integrity
- **IMMUTABLE UNDER THIS TASK (Founder, binding)**:
  - `STUDIO_TABS` **values and order** — immutable
  - `NAV` **identity and order** — immutable
  - `src/lib/building-route.ts` — **read-only, must not be edited**
  - Legacy `#floor` / `#process` / `#truth` behaviour — must be preserved
- **Acceptance**: Studio tabs render with grouped presentation; all 6 tabs route correctly; **legacy-route guards still pass** (`tests/phase7-corrective.test.ts:354` asserts the exact `parseBuildingRoute` results for `#process`, `#truth`, `#floor`); rail remains 7 items; **`NAV` and `STUDIO_TABS` values and order unchanged**; `building-route.ts` byte-unchanged; Founder Attention renders **no** tab rail (Goose R2 guard, `tests/phase7-corrective.test.ts:146`)
- **NOT AUTHORIZED under this task**: any modification to `NAV`, `NAV.length === 7` (`tests/phase7-corrective.test.ts:189`), the ordered-id assertion (`:319`), `STUDIO_TABS` values or order, or `src/lib/building-route.ts`. **No Founder test-modification approval is required for this task**, because no governance guard is in its blast radius.
- **Verifier**: @vision (UX) + @codex (guard verification)
- **Duration**: 2–3h
- **Dependency**: CMD-DI-0-1 baseline extension closed (B7) — `shell.tsx` and `building.tsx` are both in accepted scope; no extension gate unless `building-route.ts` is later edited
- **Note**: Structural constraint from `tests/architecture.test.ts:343-358` — the nav-id census is the guard against an unauthorised surface, and a surface cannot be reached without a nav entry. **Adding rail entries is therefore structurally prohibited.** Grouped navigation inside the Studio context is the only admissible approach.

**TASK CMD-DI-1-5** — Studio Overview: mount glance — **TARGET CORRECTED (Founder ruling 2026-10-10)**
- **Owner**: @cursor
- **Files**: `src/surfaces/company.tsx` — **the `DevStudio` component (line 599)** and its Studio Overview branch
- **TARGET CORRECTION**: The former target `src/surfaces/overview.tsx` is **wrong**. That file exports `OverviewSurface` — *"ERP Overview - which business processes remain unclosed"*, gap map **WF-ERP-01/02/03**, rendering `data-room-state-band="erp"`. **It is the ERP process Overview, not the Studio Overview.** The Studio Overview / Dev Studio path is `DevStudio` in `src/surfaces/company.tsx`, dispatched from `src/surfaces/building.tsx:1049` (`<DevStudio tab={route.tab} surface={surface} />`).
- **Blast radius**: `src/surfaces/company.tsx` only. `src/surfaces/overview.tsx` is **explicitly out of scope and must not be modified**.
- **Work**:
  - Import `staff-glance.tsx` (from CMD-DI-1-1) into `company.tsx`
  - Mount it in the **Studio Overview** position, above the existing Studio content
  - Keep existing layout and footer intact
- **Acceptance**: Glance visible on the Studio Overview; **no modification to `src/surfaces/overview.tsx`**; ERP Overview byte-unchanged and its WF-ERP guards still passing; no re-render on prop change; rest of Studio Overview unchanged
- **HONESTY CONSTRAINT (Founder, binding)**: **CMD-DI-1-1 remains props-only. Counts are NEVER fabricated.** Until CMD-DI-3-1 publishes authoritative server-side buckets, **any unavailable bucket (WORKING / IDLE / BLOCKED / AWAITING_REVIEW) must render as honestly `UNKNOWN` / unavailable — never as `0`, never blank, never inferred client-side.**
- **NO SERVER WORK IN WAVE 1**: this task consumes whatever the existing surface supplies. It must not add, modify or stub a server bucket. Server-side counts arrive only via CMD-DI-3-1 in Wave 3.
- **Verifier**: @vision
- **Duration**: 1h
- **Dependency**: Task 1-1 (staff-glance component)
- **B7**: `src/surfaces/company.tsx` is in accepted baseline scope (`89cf…` recorded in `.source-baseline-2026-10-10-pre.json`)

### Wave 2: Roster and surface expansion (Serialized, **after Wave 1 approved**)

**TASK CMD-DI-2-1** — Staff surface: card/grid view + status grouping
- **Owner**: @cursor (exclusive)
- **Files**: `src/surfaces/staff.tsx` (major update)
- **Work**:
  - Add toggle button: "Card view / Grid view" (default: table)
  - Card view: 2-column grid; RosterCard with duty/execution side-by-side, status badge, capacity note
  - Grid view: existing table layout
  - Add status grouping filter: "All / Working / Awaiting review / Blocked / Unavailable"
  - Inline truth-disagreement display: flag icon + label (don't merge)
- **Acceptance**: Both views render all roster data identically; filter works; no computed state; toggling preserves scroll
- **Verifier**: @vision
- **Duration**: 4–5h
- **Dependency**: Task 1-4 (routes); Task 0-2 (test audit approval)
- **Test**: Card/grid/filter render tests

**TASK CMD-DI-2-2** — Project board generalization
- **Owner**: @cursor (continued from Task 2-1 on same file scope)
- **Files**: `src/surfaces/project-board.tsx` (update)
- **Work**:
  - Accept any `project_id` from route query param (not just 'erp' or 'hoadha')
  - Map lane by canonical `status` field
  - Show UNKNOWN lane for unmapped statuses
  - Preserve task count, lane filtering, identity verification
  - Keep ERP/Hoadha as special cases
- **Acceptance**: Board renders for any project with a building projection; other projects show UNKNOWN; ERP/Hoadha unchanged
- **Verifier**: @codex
- **Duration**: 2–3h
- **Dependency**: Task 1-4 (routes); must not conflict with Task 2-1 (same owner, serialized)

**TASK CMD-DI-2-3** — Company OS: advisory reporting disclaimer
- **Owner**: @antigravity (Founder-assigned; seat registry owner)
- **Files**: `src/surfaces/company-os.tsx` (Structure tab update)
- **Work**:
  - Add disclaimer in reporting-line column: "Proposed Accountability Mapping (Advisory). Ratified designations and standings per Chapter 22."
  - Keep read-only; no edit controls
  - Preserve H-seats, sections, all existing data
- **Acceptance**: Disclaimer visible; no data change; Company surface still read-only
- **Verifier**: @vision
- **Duration**: 1h
- **Dependency**: None (independent of other Wave 2 tasks); coordination with @antigravity on Phases 2–3

**TASK CMD-DI-2-4** — Rooms: read-only chronological conversation view — **TARGET CORRECTED (Founder ruling 2026-10-10)**
- **Owner**: @opencode
- **Files**: `src/surfaces/building.tsx` — the **`EvidenceRoomsPeer`** component (line 278), dispatched at line 132 (`if (tab === 'Rooms') return <EvidenceRoomsPeer building={building} />;`)
- **TARGET CORRECTION — FINAL**: The `#evidence/rooms` implementation is `EvidenceRoomsPeer` in **`src/surfaces/building.tsx`**. That is this task's target.
  - **Do NOT create `src/surfaces/room.tsx`.** No duplicate Room surface.
  - **Do NOT assign Rooms ownership to `src/surfaces/evidence.tsx`.** Rooms is not owned there; assigning it so would be false.
  - **Do NOT silently migrate ownership** merely to satisfy the package. `EvidenceRoomsPeer` stays in `building.tsx`.
- **Work**:
  - Extend `EvidenceRoomsPeer` with a read-only message list from `room.jsonl` (via `/api/raw?path=room.jsonl`, capped at 8 MB)
  - Chronological order; no search
  - No channel/thread field support; mark as unsupported with notice:
    - "🔒 Messaging composition pending Room contract (Phase 6, not authorized)"
    - "🔒 Per-project conversations require channel contract (not defined)"
    - "🔒 Search deferred (data size limit: 8 MB)"
  - Show exactly what is available: archived message history, read-only
- **Acceptance**: Conversation list renders inside the existing `EvidenceRoomsPeer`; messages ordered by timestamp; all unavailable features visibly marked with reason; no write path; **no new surface file created**; Rooms structural-ownership guards still pass
- **SEPARATION REQUIREMENT (Founder, binding)**: **CMD-DI-3-2b Work must NOT overwrite, repurpose or displace `Evidence → Rooms`.** Work is a **distinct Design Integration concept** and must be presented separately from Evidence Rooms. **Any later extraction or migration of Rooms out of `building.tsx` requires separate, explicit Founder authorization** and is not part of this package.
- **Verifier**: @vision (UX clarity) + @codex (contract compliance)
- **Duration**: 2–3h
- **Dependency**: CMD-DI-0-1 baseline extension closed (B7) — `building.tsx` is in accepted baseline scope

**TASK CMD-DI-2-5** — Work interface scope decision — **CLOSED by Founder decision B3**
- **Owner**: @codex (decision point, not implementation)
- **Decision (Founder, 2026-10-10)**: **Work is IN SCOPE.**
- **Resolution**: The decision task is closed and is **no longer dispatched**. Its outcome is realized by the three Wave 3 tasks that split it, exactly as the task itself anticipated ("split into contract design and surface implementation"):
  - **CMD-DI-3-2a** — Work-package contract design (schema, data model, proposed `/api/work-packages`)
  - **CMD-DI-3-2b** — Work-package surface implementation (UI structure, filters, read-only)
  - **CMD-DI-3-2c** — Explicit contract-fulfilment test
- **Scope boundary (Founder, binding)**: This authorizes the **Design Integration Work surface only**. It does **not** silently expand into the full future Command WorkPackage architecture. The `/api/work-packages` **server endpoint implementation remains unauthorized** and is not in this package.
- **Planning screen**: remains **DEFERRED** (no canonical milestone or schedule source — BLOCKED).
- **Status**: CLOSED — no further dispatch

### Wave 3: Server and contracts (Gated by Wave 2, **after approval**)

**TASK CMD-DI-3-1** — Staff glance counts (server side)
- **Owner**: @codex
- **Files**: `server/floor.mjs` (update)
- **Work**:
  - If `/api/floor` already returns RosterCounts with status groupings, no change
  - If not: compute glance counts server-side (React does NOT compute)
  - Return: `{ working: N, idle: N, blocked: N, awaiting_review: N, unavailable: N, unknown: N }`
  - Counts derived from `roster_entry.duty_state` and `current_state` (not inferred)
- **Acceptance**: Counts match roster filtering; all values ≥ 0; UNKNOWN shows count; test on GET `/api/floor`
- **Verifier**: @opencode (computation guard)
- **Duration**: 1–2h
- **Dependency**: Task 2-1 (staff surface); observation pin verification (Task 3-3) before merge
- **B7**: `server/floor.mjs` is in accepted baseline scope

**TASK CMD-DI-3-2** — Work-package contract design — **SUPERSEDED BY CMD-DI-3-2a**
- The original single task is folded into CMD-DI-3-2a, which strictly subsumes its scope (typed `WorkPackageRow` interface in `src/lib/contracts.ts`, documented ERP/Hoadha/general mapping, proposed `/api/work-packages` signature, no implementation). Retained here only to record the supersession. **Not separately dispatched.**

**TASK CMD-DI-3-2a** — Work-package contract design (schema, data model, endpoint signature) — **NEW (B3)**
- **Owner**: @codex
- **Files**: `src/lib/contracts.ts` (add WorkPackageRow interface)
- **Work**:
  - Define normalized `WorkPackageRow`: id, project_id, title, current_stage, owner, verifier, board_lane, source
  - Document how ERP tasks, Hoadha items, and general assignments map onto it
  - Propose the `/api/work-packages` endpoint signature (**signature only — no implementation**)
  - Mark explicitly: *"requires separate authorization for Wave 4 server implementation"*
- **Acceptance**: Interface is typed; mapping documented; endpoint signature proposed but **not implemented**; ready for the Founder gate decision
- **Verifier**: @opencode (contracts)
- **Duration**: 2–3h
- **Dependency**: Task 2-2 (generalized project board); CMD-DI-2-5 (closed — Work is in scope)
- **B7**: `src/lib/contracts.ts` is in accepted baseline scope
- **Scope boundary**: Design Integration Work surface contract **only**. This does not define the full future Command WorkPackage architecture.

**TASK CMD-DI-3-2b** — Work-package surface implementation (UI structure, filters, read-only) — **NEW (B3)**
- **Owner**: @cursor
- **Files**: the distinct Work surface agreed under CMD-DI-3-2a. **No new surface file may repurpose or overwrite `Evidence → Rooms`.**
- **SEPARATION REQUIREMENT (Founder, binding)**: **Work must NOT overwrite or repurpose `Evidence → Rooms` (`EvidenceRoomsPeer`, `src/surfaces/building.tsx:278`).** Work is a **distinct Design Integration concept** and is presented separately from Evidence Rooms. If CMD-DI-3-2a's contract implies that Rooms and Work share one surface, that implication is **rejected** — the contract must model them separately.
- **Work**:
  - Render the read-only Work-package list defined by CMD-DI-3-2a
  - Filters only (project, stage); **no write path, no controls that mutate state**
  - UNKNOWN stages render as UNKNOWN; never blank, never inferred
- **Acceptance**: Package list renders from the 3-2a contract; filters operate on contract fields only; no computed stage; no state mutation; read-only; **`Evidence → Rooms` continues to render independently and is unchanged by this task**
- **Verifier**: @vision
- **Duration**: 3–4h
- **Dependency**: CMD-DI-3-2a (contract) complete

**TASK CMD-DI-3-2c** — Explicit contract-fulfilment test — **NEW (B3)**
- **Owner**: @opencode
- **Files**: `tests/design-integration.test.tsx` (new, created under CMD-DI-4-2) or a dedicated contract test
- **Work**: Confirm the Work screen integrates with the CMD-DI-3-2a contract — field-for-field, with no invented fields and no inferred states
- **Acceptance**: Every `WorkPackageRow` field is either rendered from contract data or explicitly marked unsupported; no field is computed in React; no write path
- **Verifier**: @vision
- **Duration**: 1–2h
- **Dependency**: CMD-DI-3-2a, CMD-DI-3-2b
- **B5**: Acceptance is no-regression against the accepted known-red baseline (821 collected / 815 passed / 6 known-red F3–F8) plus zero new failures from this task.

**TASK CMD-DI-3-3** — Observation candidate pin verification
- **Owner**: @codex
- **Files**: Review only; no edits to `data-service.mjs`, `observation/*`, `scripts/lifecycle/*`
- **Work**:
  - Confirm no changes in Wave 1–2 affect observation build inputs
  - If Wave 3 touches `server/floor.mjs`, verify observation candidate still applies
  - Compute post-change hashes; compare to pre-change baseline
  - Document: "Observation pin [valid/requires regeneration]"
- **Acceptance**: Pre-change baseline (Task 0-1) and post-change hashes documented; discrepancies flagged
- **Verifier**: @opencode
- **Duration**: 0.5h per verification cycle (not per-task)
- **Dependency**: Each Wave 3 task that edits server; Task 0-1 (baseline)

**TASK CMD-DI-3-4** — Post-change source hash manifest
- **Owner**: @codex
- **Files**: `src/`, `server/data-service.mjs`, `server/floor.mjs` (post-change state)
- **Work**: Compute SHA-256 manifest after all Wave 1–3 changes complete; save to `00_STARQ_HQ/operations/starq-command/.source-baseline-2026-10-10-post.json`
- **Output**: Manifest with same scope as Task 0-1; diff record (Task 0-1 vs. Task 3-4)
- **Acceptance**: Hashes computed exactly as pre-change; no drift from observation pin or test expectations
- **Verifier**: @opencode
- **Duration**: 1–2h
- **Dependency**: All Wave 1–3 tasks complete

### Wave 4: Guards and tests (Parallel with Wave 3 **after approval**)

**TASK CMD-DI-4-1** — Architecture guard updates (per audit)
- **Owner**: @opencode
- **Files**: Tests per the CMD-DI-0-2 audit, categories B and D
- **Work**:
  1. **B6 — GUARD STRENGTHENING (Founder-approved, explicit governance change)**: at `tests/structural-ownership.test.tsx:402`, derive the Dev Studio peer list from canonical `STUDIO_TABS` (`src/lib/building-route.ts:31`) instead of the hardcoded `['staff','projects','capacity','activity']`. This brings **`Overview` and `Herdr` under the executing distinct-work-area guard** (`tests/structural-ownership.test.tsx:400`). This is a **governance/test modification — explicitly NOT cleanup and NOT relaxation.** It must be recorded as a guard change in the post-change manifest diff.
  2. Per CMD-DI-0-2 approval, update presentation-specific tests for CMD-DI-1-3 / 2-1 / 2-2 outcomes: `tests/phase7-ui.test.tsx:356` (`overflow-y-auto` vs nested-scroller removal), `tests/phase7-corrective.test.ts:251`,`:261` (`.label-sec` / `.label-micro` vs the new type-tier ladder), and any CMD-DI-2-2 project-board assertion at `tests/phase7-ui.test.tsx:405`,`:408`.
  3. **Preserve without change (Category A)**: `tests/architecture.test.ts` (24 tests — read-only, no-computation, maturity, Nexus independence, identity, honest-state vocabulary, no-hidden-truth), `tests/read-only-capability.test.ts` (45), `tests/phase5.test.ts` (62).
  4. **Preserve without change (Category C governance)**: `tests/phase7-corrective.test.ts:190-193` (NAV label/hint loop), **`:319` (ordered NAV id assertion — load-bearing, not a census)**, `:299`, `:304`, `:337`, `:344`, `:354` (ViewId and legacy-route integrity), `:176` (accessibility).
- **B5 — ACCEPTANCE: NO-REGRESSION AGAINST THE ACCEPTED KNOWN-RED BASELINE** (replaces all blanket "all tests pass" language):
  - **Accepted baseline: 31 test files · 821 tests collected · 815 passed · 6 known-red · zero newly exposed failures.**
  - The 6 known-red failures are **F3–F8** (live-data drift): `phase2.test.ts` ×3, `phase7-dual-room.test.tsx` ×2, `staff-board.test.tsx` ×1.
  - **Individual known-red identities are preserved** and must be reported by name in every verification run.
  - **No new failure is allowable merely because the baseline is red.** Any failure outside F3–F8 is a regression and blocks the task.
  - **Explicitly forbidden**: rewriting an expectation solely to turn a test green. F3–F8 are to be investigated as live-data drift under separate authorization, not edited to pass.
- **Acceptance**: Zero regressions against the accepted known-red baseline; Category A and Category C governance guards byte-unchanged except for the B6 derivation; only presentation logic modified otherwise; every guard change traceable in the post-change manifest diff
- **Verifier**: @vision (independent)
- **Duration**: 1–2h per guard change
- **Dependency**: CMD-DI-0-1 baseline extension (§5.6 `tests/**`) closed — **B7**
- **B7**: `tests/**` must be in the pre-change baseline before any test file is edited, so that the guard changes are provable rather than asserted.

**TASK CMD-DI-4-2** — New design-integration render tests
- **Owner**: @opencode
- **Files**: `tests/design-integration.test.tsx` (new)
- **Work**:
  - Test staff-glance with various RosterCounts; verify no computation
  - Test sessions board; verify declared/live separation
  - Test staff card/grid/filter; verify no state mutation
  - Test CSS tier ladder, mobile reflow
  - Test Company advisory disclaimer rendering
- **Acceptance**: All new components tested; no computation in React; no unexpected state changes. **Plus B5**: zero regressions against the accepted known-red baseline (821 / 815 / 6 known-red F3–F8)
- **Verifier**: @vision
- **Duration**: 3–4h
- **Dependency**: Tasks 1-1, 1-2, 1-3, 2-1, 2-3 (components exist)
- **B7**: new file; recorded as new in the post-change manifest

**TASK CMD-DI-4-3** — Production build verification — **MANDATORY (B2, reinstated and retained)**
- **Owner**: @opencode
- **Files**: `vite.config.ts`, `tsconfig.json` (review only)
- **Work**:
  - Run `npm run build` (production Vite build)
  - Verify no errors, no warnings
  - Check bundle size (no major regressions)
  - Verify observation build separate (if touched)
- **Acceptance**: Build succeeds; TypeScript strict clean; no warnings; observation candidate valid
- **Verifier**: @codex
- **Duration**: 1h (run time only)
- **Dependency**: Wave 1–3 tasks complete
- **B2**: This task is **mandatory and is not optional in any wave configuration.** It is the sole build gate for Gate 1 and must not be dropped from any restatement of the programme.
- **B7**: `vite.config.ts`, `tsconfig.json`, `index.html`, `package.json`, `package-lock.json` must be in the pre-change baseline before the build is run and any of them is modified.

---

## C. Navigation Migration: Grouped IA as Target

### Current (7-item rail, legacy inner tabs)
```
Rail:
  Overview
  Company
  Building
  Dev Studio
  Founder Attention
  Evidence
  System
```

### Design intent: Grouped navigation (16-item IA)
```
Grouped tabs in context:
  COMMAND: My Desk
  DELIVERY: Projects, Work, Planning
  WORKFORCE: Staff, Organization, Resources
  RUNTIME: Development Floor, Room
  GOVERNANCE: Governance, Evidence & History
  SYSTEM: Administration
```

### Integration approach: Grouped IA within rail constraints

**Constraint**: The 7-item rail is enforced by `NAV.length === 7` (`tests/phase7-corrective.test.ts:189`). Separately, `tests/phase7-corrective.test.ts:319` pins the **exact ordered list of rail ids** and is the **load-bearing** guard, grounded in Founder Room seq 8486/8487 (*"No existing entry moved relative to another"*).

**No modification to either assertion is authorized by CMD-DI-1-4.** The task is rescoped to presentation-only (see §B). A future Founder decision to alter the rail would require explicit approval of **both** assertions, with `:319` treated as governance rather than as a census.

**Proposed solution**: Implement the design's grouped navigation INSIDE the Studio context, preserving the rail.

1. **Dev Studio tab structure** (grouped, replaces single linear tab list):
   - Overview (new: staff glance + three-truths)
   - Staff (new: card/grid + grouping)
   - Projects (existing, generalized board)
   - Capacity (existing; consolidated view)
   - Activity (existing, renamed from Herdr parent context)
   - Herdr (existing; operational panes + sessions)

2. **Company OS structure** (unchanged, but advisory labels added):
   - Structure (organization, reporting, advisory disclaimer added)
   - Seats (H-seats, staff profile)
   - Portfolio (rooms)
   - Founder (actions)
   - Infrastructure (shared systems)

3. **Evidence tabs** (unchanged, Room expanded):
   - Sources
   - Projection
   - Decisions
   - Rooms (extended: read-only message list)
   - Hashes

4. **System tabs** (unchanged):
   - Health
   - Runtime
   - Sources
   - Contracts
   - Projection

5. **Founder Attention tabs** (unchanged):
   - Decisions
   - Exceptions
   - Conflicts
   - Holds
   - History

**Design IA mapping into Command structure**:

| Design Group | Design Screens | Command Path | Implementation |
|---|---|---|---|
| COMMAND | My Desk | Attention rail (Decisions tab) | Existing; no change |
| DELIVERY | Projects, Work, Planning | Dev Studio tabs | Projects (adapt), **Work (IN SCOPE — CMD-DI-3-2a/b/c)**, Planning (deferred) |
| WORKFORCE | Staff, Organization, Resources | Dev Studio + Company | Staff (adapt), Company Structure (advisory disclaimer), Capacity (existing) |
| RUNTIME | Development Floor, Sessions, Room | Dev Studio + Evidence | Herdr (existing), Sessions board (new), Room (extend) |
| GOVERNANCE | Governance, Evidence | Attention + Evidence | Existing; structure unchanged |
| SYSTEM | Administration | System rail | Existing; remove UI preferences |

**Rationale**:
- The 7-item rail is Phase-5 authorized and guarded by tests. Changing it is a Founder decision.
- The design's deeper IA fits naturally within the existing surface hierarchy (Dev Studio, Company OS, Evidence, System).
- No functionality is lost; surfaces are reorganized for discovery flow.
- This preserves the guard: `NAV.length === 7` and `NAV[3].id === 'studio'`.
- The grouped tabs are implemented at the Studio context level (Task 1-4), visible to users, without breaking the rail structure.

**Test gate**:
- The CMD-DI-0-2 audit (`DESIGN_INTEGRATION_TEST_AUDIT_2026-10-10.md`) has completed and categorized every guard with file:line evidence.
- **Result: grouped navigation inside the Studio context requires NO governance-guard modification.** The six canonical tabs already exist at `src/lib/building-route.ts:31`; only presentation is missing.
- CMD-DI-1-4 is therefore rescoped to presentation-only and is **not gated on Founder test-modification approval**.
- If any later task proposes altering `NAV`, `STUDIO_TABS` values, or the ordered-id assertion at `tests/phase7-corrective.test.ts:319`, that proposal returns to the Founder as a governance change, not a presentation change.
- **B6**: `tests/structural-ownership.test.ts:402` derives its Studio peer list from canonical `STUDIO_TABS` under CMD-DI-4-1, extending the distinct-work-area guard to `Overview` and `Herdr`. Guard strengthening, separately authorized.

---

## D. Engineering Coordination

### Verified work in progress (Oct 10 workspace evidence)

| Worker | Package | Scope | Overlap risk | Status | Action |
|---|---|---|---|---|---|
| Codex | `starqerp-control-board/` | ERP work model (Python, Sep 28–30) | **NONE**. AG's control board is input to Command UI; no competition. | Verified (older files) | No action; Task 3-2 consumes AG's output. |
| Codex | D2-P fixtures | Separate platform lifecycle | **NONE**. Not Command UI. | Verified | No action. |
| Codex | Observation candidate (Oct 9) | Pin on server/build inputs | **BLOCKS Wave 3 tasks touching server**. | Current | Task 3-3 verification per each server edit. |
| Vision | Room seq 9257 (Oct 8 cap) | No recent posts | — | Verified (quiet) | No action. |
| Deadpool | No recent evidence | — | — | Verified (quiet) | No action. |
| **Antigravity** | **UNRESOLVED** | **Recent Command remediation plan unknown** | **Cannot estimate without plan visibility** | **Awaiting clarification** | **Task 0-3 must locate AG recent work before Wave 1 dispatch. If found, update Wave 1–2 ownership and resolve conflicts. If not found, Founder must clarify.** |

### Key coordination issue: AG recent work

The workspace contains only AG's older control-board files (Sep 28–30). Recent work is not visible in:
- Room (no posts after seq 9257, Oct 8)
- File-based evidence (git-status, operations/ directory, Oct 10)
- This workspace (authorized root D:\StarqTech only)

**Action**: Task 0-3 (AG coordination memo) must either:
1. **Locate AG's recent Command remediation plan** and document scope/overlaps, OR
2. **Confirm no recent work found** and request Founder/AG clarification before Wave 1 dispatch.

**Blocker**: If AG work is found in Task 0-3 and overlaps with CMD-DI tasks, Wave 1 ownership must be revised before dispatch.

---

## E. Verification Strategy

### Phase 1: Pre-implementation baseline (Task 0-1)

**Pre-change source hash manifest**:
```bash
cat .source-baseline-2026-10-10-pre.json
# 52 files, verified 52/52 hash and byte-exact; digest 456b845c…9885
```

**B7 — BASELINE EXTENSION (blocking)**: the accepted manifest must additionally cover the files in audit §5.1–§5.7 before any of them is modified. Minimum mandatory set: `tailwind.config.js`, `postcss.config.js`, `vite.config.ts`, `tsconfig.json`, `index.html`, `vitest.config.ts`, `package.json`, `package-lock.json`, `integrations/herdr/herdr-client.mjs`, `integrations/herdr/herdr-service.mjs`, the eight named `server/*.mjs` modules, and `tests/**`.

### Phase 2: Offline static analysis (during Waves 1–3)

**TypeScript strict mode**:
```bash
npm run typecheck
# Acceptance: zero errors, zero warnings
```

**Linting**:
```bash
npm run lint
# Acceptance: passes existing rules
```

**Architecture guards (subset, before each wave merge)**:
```bash
npm test -- tests/architecture.test.ts tests/read-only-capability.test.ts
# Acceptance (B5): no-regression against the accepted known-red baseline.
# These two files must be fully green — they contain zero known-red failures.
```

### Phase 2b — Accepted known-red baseline (B5)

**Authoritative baseline: 31 test files · 821 tests collected · 815 passed · 6 known-red · zero newly exposed failures.**

The 6 known-red failures are **F3–F8**, all live-data drift:

| ID | File | Test |
|---|---|---|
| F3 | `tests/phase2.test.ts` | read-only gates are explicit and allowlisted |
| F4 | `tests/phase2.test.ts` | redacts a whole-value absolute path |
| F5 | `tests/phase2.test.ts` | redacts every one of several embedded paths in a single value |
| F6 | `tests/phase7-dual-room.test.tsx` | the Building origin actually projects the real Hoadha sources |
| F7 | `tests/phase7-dual-room.test.tsx` | the Hoadha board renders the real reconciled corpus |
| F8 | `tests/staff-board.test.tsx` | never calls the Founder a ghost, a retired seat or a machine |

Rules:
- **Individual known-red identities are preserved.** Every verification run reports F3–F8 by name.
- **No new failure is allowable merely because the baseline is red.**
- **Rewriting an expectation solely to produce a green test is prohibited.** F3–F8 are investigated as live-data drift under separate authorization.

### Phase 3: Unit and render tests (after Waves 1–2)

**New tests** (Task 4-2):
```bash
npm test -- tests/design-integration.test.tsx
# Acceptance: all new components tested; no computation in React
```

**Presentation guards** (Task 4-1):
```bash
npm test -- tests/structural-ownership.test.tsx
# Acceptance: each surface owns its question; honesty gate first
```

### Phase 4: Production build (Wave 4, Task 4-3)

```bash
npm run build
# Acceptance: zero errors; bundle size < 5% change; observation candidate valid
```

### Phase 5: Post-change verification (Task 3-4)

**Post-change source hash manifest**:
```bash
cat .source-baseline-2026-10-10-post.json
# Diff against Task 0-1 output; verify no drift
```

### Phase 6: Independent review (after Task 4-3)

- **Builder**: Task owner (per §B)
- **Verifier**: Task verifier (per §B)
- **Independent**: @vision (command UX/guard specialist)
- **Checklist**: read-only preserved, guards passing, no computation in React, honesty gate above data
- **Sign-off required** before merge

### Phase 7: Isolated UI preview (Founder-authorized separately, NOT gated by G-CONTAINMENT)

**Decoupled from managed-floor startup**:
- G-CONTAINMENT gates the managed floor (Herdr, workers, Room ledger write path)
- **UI preview does NOT require G-CONTAINMENT PASS**
- Preview can use offline test fixtures, mock projections, read-only Room snapshot
- **Separate gate**: "Founder approves isolated UI preview with test data" (independent of D2-P and containment)
- When authorized: @vision reviews live UI against design mockups; no real data or workers required

---

## F. Release Boundaries

These gates are sequential and **mutually independent**. Each requires separate Founder authorization.

### Gate 1: Design Integration Implementation (current)
- **Requirements**: All tasks in §B (Waves 0–4) complete; Phase 2–7 verification passed; **CMD-DI-4-3 production-build verification passed (mandatory)**
- **Acceptance criteria**: TypeScript strict ✓ · **no-regression against the accepted known-red baseline (821 collected / 815 passed / 6 known-red F3–F8, zero new failures) — not "all tests pass" (B5)** · no computation in React ✓ · observation pin valid ✓ · pre-change and post-change hashes reconciled against the extended baseline ✓
- **Decision**: Founder approves or requests changes
- **Blocks**: Merge to any branch
- **Enables**: Code review branch creation

### Gate 2: Independent Verification (code review)
- **Requirements**: Design integration merged to dev branch; @vision review complete
- **Acceptance criteria**: All verifiers signed off; no guard weaknesses; read-only enforced
- **Decision**: Founder or @codex approves merge to main/next release
- **Blocks**: Release or deployment
- **Enables**: Packaging for deployment

### Gate 3: Isolated UI Preview (deferred, separate Founder authorization, NOT gated by G-CONTAINMENT)
- **Requirements**: Gate 2 complete; Founder approves preview with test data
- **Acceptance criteria**: @vision confirms live UI matches design mockups (layout, color, typography, interaction); no real managed-floor workers required
- **Decision**: Founder approves visual acceptance
- **Blocks**: Nothing (preview is independent)
- **Enables**: Confidence before full platform startup

### Gate 4: G-CONTAINMENT Pass (platform, NOT Command-specific)
- **Requirements**: D2-P native fixture evidence, Guardian acceptance, native runtime authorization (all separate)
- **Acceptance criteria**: 13/13 containment cases PASS (currently 0/13)
- **Decision**: Founder + independent auditor
- **Blocks**: Managed-floor service startup (all workers, all projects)
- **Enables**: Authorized use of the floor; command integration goes live

### Gate 5: Source baseline promotion
- **Requirements**: Gate 2 complete; source diffs reconciled; no drift from baseline
- **Acceptance criteria**: Post-change hashes (Task 3-4) match expectations; no unexpected edits
- **Decision**: Founder or @codex
- **Blocks**: Nothing immediate; enables future git-reset-to-baseline checks
- **Enables**: Automated source verification in CI

### Boundary diagram

```
┌────────────────────────────────────────────────────────────────┐
│ Gate 1: Design Integration Implementation (Waves 0–4)         │
│ → TypeScript ✓, tests ✓, observation pin ✓, hashes match ✓  │
└────────────────────┬─────────────────────────────────────────┘
                     ↓ (Founder approves)
┌────────────────────────────────────────────────────────────────┐
│ Gate 2: Independent Code Review (@vision + verifiers)         │
│ → No guard weaknesses, read-only enforced                     │
└────────────────────┬─────────────────────────────────────────┘
                     ↓ (Founder approves)
┌────────────────────────────────────────────────────────────────┐
│ INDEPENDENT TRACKS (can proceed in parallel)                   │
│                                                                │
│ Gate 3: Isolated UI Preview                                   │
│ (separate Founder auth; test data only; no G-CONTAINMENT)    │
│ → @vision confirms live UI vs. design                         │
│                                                                │
│ Gate 4: G-CONTAINMENT Pass (D2-P + Guardian)                  │
│ (separate authorization; 13/13 cases PASS)                    │
│                                                                │
│ Gate 5: Source Baseline Promotion                             │
│ (Founder/codex approves; no drift)                            │
└────────────────────┬─────────────────────────────────────────┘
                     ↓ (all above complete)
┌────────────────────────────────────────────────────────────────┐
│ Production Release                                             │
│ → Live Command with grouped navigation + design IA            │
└────────────────────────────────────────────────────────────────┘
```

---

## Summary

**Authoritative task census — 5 waves.** This table is the single source of truth. Any other restatement of the programme (including `WAVE_0_DISPATCH_SUMMARY_2026-10-10.md`) must match it.

| Wave | Tasks | Count |
|---|---|---|
| **Wave 0** — Setup & validation | CMD-DI-0-1, 0-2, 0-3 | 3 |
| **Wave 1** — Frontend components | CMD-DI-1-1, 1-2, 1-3, 1-4, 1-5 | 5 |
| **Wave 2** — Roster & surfaces | CMD-DI-2-1, 2-2, 2-3, 2-4 | 4 |
| **Wave 3** — Server & contracts | CMD-DI-3-1, **3-2a, 3-2b, 3-2c**, 3-3, 3-4 | 6 |
| **Wave 4** — Guards & build | CMD-DI-4-1, 4-2, **4-3** | 3 |
| | **Total dispatched tasks** | **21 (FINAL)** |

**Task-status reconciliation** (these IDs are retained in the record but are **not** dispatched):

| ID | Status | Reason |
|---|---|---|
| CMD-DI-2-5 | **CLOSED** | Decision made by Founder (B3): Work is IN SCOPE. Outcome realized by 3-2a/b/c. |
| CMD-DI-3-2 | **SUPERSEDED** | Folded into CMD-DI-3-2a, which strictly subsumes its scope. |

**Task census is FINAL at 21 dispatched tasks across 5 waves** (Founder ruling, 2026-10-10). No earlier figure of 17 or 20 is required, permitted or implied anywhere in this package. CMD-DI-3-3 is **not** folded into CMD-DI-4-3; both are dispatched in full and carry separate verifiers, dependencies and durations.

**Wave 0 status (2026-10-10)**

| Task | State |
|---|---|
| CMD-DI-0-1 | **Core baseline ACCEPTED** (52/52 verified). **B7 extension OPEN — blocking all affected tasks.** |
| CMD-DI-0-2 | **DELIVERED** — `DESIGN_INTEGRATION_TEST_AUDIT_2026-10-10.md`. Vision verification pending. |
| CMD-DI-0-3 | Memo delivered; asserted hashes verified. P3A-2 fixture fallback **rejected** by the audit. |

**Builders**: @cursor, @copilot, @codex, @opencode, @vision, @antigravity (6 total)

**Key gating decisions**
1. **B7 baseline extension (§5.1–§5.6) — OPEN, blocking any modification of an affected file**
2. CMD-DI-0-2 Vision verification — pending
3. B2 arithmetic: 21 vs 20 — one confirmation needed
4. Founder approval: isolated UI preview as a separate gate from G-CONTAINMENT

**No implementation has started. All source files unchanged.**

---

**Approved by**: Founder (corrections 2026-10-10; Wave 0 reconciliation B2–B7 2026-10-10)  
**Prepared by**: Claude Sonnet 5.5, Read-only reconnaissance and planning  
**Reconciled by**: @opencode (CMD-DI-0-2 audit; B1 closed by independent recovery verification)  
**Status**: **Document reconciliation complete. Wave 1 NOT dispatched.** Blocking: B7 baseline extension; CMD-DI-0-2 Vision verification; B2 arithmetic confirmation.
