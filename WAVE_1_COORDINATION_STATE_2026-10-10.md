# WAVE 1 COORDINATION STATE

**Date**: 2026-10-10  
**Coordination checkpoint**: Cursor tranche acceptance + Wave 0 prerequisite status  
**Authority**: Founder directive; Vision independent acceptance (Cursor only)

---

## A. WAVE 1 TASKS ACCEPTED BY VISION (CURSOR TRANCHE)

Vision has independently returned:

**WAVE 1 CURSOR TRANCHE — ACCEPT**

| Task ID | Component | Owner | Type | Status | Verifier |
|---|---|---|---|---|---|
| **CMD-DI-1-1** | staff-glance.tsx | @cursor | NEW component | ✅ **ACCEPTED** | Vision |
| **CMD-DI-1-4** | Studio presentation grouping | @cursor | Presentation (rescoped) | ✅ **ACCEPTED** | Vision |
| **CMD-DI-1-5** | Mount glance in DevStudio | @cursor | Integration | ✅ **ACCEPTED** | Vision |

**Acceptance evidence**: Vision specifically confirms:
- 1-1 (staff-glance component) is ready for implementation as specified
- 1-4 (Studio presentation grouping) may be released for implementation; **presentation-only rescope authorized**
- 1-5 (mount glance in company.tsx line 599, the DevStudio path, **NOT overview.tsx**) target is correct and ready

**Timeline**: These tasks are independently ACCEPTED and may execute once Wave 0-2 approval is granted.

---

## B. WAVE 1 TASKS NOT YET DISPATCHED

| Task ID | Component | Owner | Type | Status | Blocker |
|---|---|---|---|---|---|
| **CMD-DI-1-2** | sessions-board.tsx | @copilot | NEW component | ⏳ Awaiting dispatch | Wave 0-2 approval |
| **CMD-DI-1-3** | CSS tier ladder + mobile reflow | @copilot | CSS/Tailwind update | ⏳ Awaiting dispatch | Wave 0-2 approval |

**Reason**: Wave 1 tasks depend on Wave 0-2 (test audit) approval per the execution package architecture. Dispatch is ready but awaits that gate.

---

## C. WAVE 0 PREREQUISITE STATUS

### Task CMD-DI-0-1: Pre-change source hash baseline

**Status**: ✅ **COMPLETE AND VERIFIED**

| Evidence | Result |
|---|---|
| **Baseline file** | `.source-baseline-2026-10-10-pre.json` ✅ Exists and verified |
| **File count** | 52 files captured (exact scope: `src/`, `server/data-service.mjs`, `server/floor.mjs`) |
| **Hash verification** | By @opencode: 52/52 exact, 0 missing, 0 drift. Digest: `456b845cd…488985` |
| **Timestamp** | Coherent; timestamps match Room seq 9257 context |
| **B7 Extension** | ✅ **CLOSED** — `.baseline-extension-2026-10-10-pre.json` captures 54 additional files (test aggregate + test fixtures + config files + server modules), 606 lines, all hashes reproduced |

**Verdict**: Ready. No further action required. Wave 1 may proceed once Wave 0-2 approval is granted.

---

### Task CMD-DI-0-2: Navigation test audit & presentation guard identification

**Status**: ✅ **DELIVERED** — ⏳ **Awaiting independent verification by @vision**

| Evidence | Result |
|---|---|
| **Deliverable** | `DESIGN_INTEGRATION_TEST_AUDIT_2026-10-10.md` (sha256 `84afe4d9…aba7a`) ✅ Exists |
| **Scope** | `tests/architecture.test.ts`, `tests/phase7-corrective.test.ts`, `tests/structural-ownership.test.tsx` — all guards categorized |
| **Guard categories** | A (Core guards: no changes), B (Presentation candidates), C (Phase-5 boundary) — every classification carries file:line evidence |
| **Founder decisions** | B5, B6, B7 and CMD-DI-1-4 rescope recorded in the audit and in the corrected execution package |
| **Verifier assignment** | @vision (independent) |
| **Verification status** | **PENDING** — awaiting @vision independent review |

**Blocking rule**: Wave 0-2 must be approved by @vision before Wave 1 dispatch is authorized.

**Next step**: @vision must independently review the audit, confirm categories, and approve or request clarification.

---

### Task CMD-DI-0-3: AG remediation coordination

**Status**: ✅ **DELIVERED** — ⏳ **Awaiting independent verification by @vision**

| Evidence | Result |
|---|---|
| **Deliverable** | `DESIGN_INTEGRATION_AG_COORDINATION_2026-10-10.md` (prepared for Vision review) ✅ Exists |
| **Finding** | **Status: PLAN LOCATED; no implementation evidenced by the artifact.** |
| **AG work discovered** | Antigravity's recent P3A plan (P3A-1, P3A-4, P3A-6) documented at specific locations in the memo |
| **Overlap assessment** | Documented: overlaps with CMD-DI-0-1 (herdr-client.mjs, herdr-service.mjs baseline extension) and potential CMD-DI-3-1 (server/floor.mjs, server/staff-profile.mjs) |
| **Blockers identified** | Vision must independently assess overlap severity and integration sequencing before Wave 1 proceeds |
| **Verifier assignment** | @vision (independent) |
| **Verification status** | **PENDING** — awaiting @vision independent review |

**AG overlap detail** (from memo, subject to Vision verification):
- **P3A-1 (Herdr integration)**: herdr-client.mjs, herdr-service.mjs — overlaps with B7 baseline extension (already captured)
- **P3A-4, P3A-6 (ownership unresolved)**: server/building.mjs, server/staff-profile.mjs, server/snapshot.mjs, server/company-os.mjs, server/health-floor.mjs — noted in package as unresolved; ownership to be determined by separate reconciliation lane
- **No implementation conflict**: Memo finds "no implementation evidenced", so no active code conflict yet; timing of Wave 1 vs. AG P3A dispatch is the coordination issue

**Next step**: @vision must independently review the memo, assess AG overlap calls, confirm P3A blockers, and approve Wave 1 dispatch or request AG sequencing adjustment.

---

### B7 Baseline Extension (Mandatory)

**Status**: ✅ **COMPLETE AND VALIDATED**

| Evidence | Result |
|---|---|
| **Manifest** | `.baseline-extension-2026-10-10-pre.json` ✅ Exists, 606 lines, 54 files |
| **Test aggregate** | Accepted digest: `41ddaa10…8177cd` ✅ Reproduced exactly (4 determinism runs matching) |
| **Test files** | 31 test specifications (34 files including fixtures) — all individually pinned in manifest |
| **Config files** | vite.config.ts, tsconfig.json, index.html, package.json, package-lock.json — hashes captured |
| **CSS files** | tailwind.config.js, postcss.config.js — hashes captured (for CMD-DI-1-3) |
| **Server modules** | integrations/herdr/*, server/building.mjs, server/staff-profile.mjs, etc. — hashes captured |
| **Blocking rule (B7)** | **No task in any wave may modify a B7-listed file until this extension is closed.** ✅ **Extension is closed; blocking rule is satisfied.** |

**Verdict**: Ready. The mandatory baseline extension is complete and reproducible. Wave 1 may modify its target files without re-extending the baseline.

---

## D. COLLISION & DEPENDENCY STATE (WAVE 1)

### File Ownership (Accepted & Dispatched)

| File | Task | Owner | Status | Dependencies |
|---|---|---|---|---|
| `src/components/staff-glance.tsx` | 1-1 | @cursor | ✅ ACCEPTED | None |
| `src/surfaces/company.tsx` (line 599 / DevStudio) | 1-5 | @cursor | ✅ ACCEPTED | Task 1-1 (component exists) |
| `src/components/shell.tsx` | 1-4 | @cursor | ✅ ACCEPTED | None (presentation only) |
| `src/surfaces/building.tsx` (Studio TabRail, lines 1105–1110) | 1-4 | @cursor | ✅ ACCEPTED | None (presentation only) |

**Collision state**: NO FILE COLLISIONS. All @cursor tasks own distinct files or non-overlapping scopes.

### File Ownership (Not Yet Dispatched)

| File | Task | Owner | Status | Dependencies |
|---|---|---|---|---|
| `src/index.css` | 1-3 | @copilot | ⏳ Pending | None |
| `tailwind.config.js` | 1-3 | @copilot | ⏳ Pending | None |
| `src/components/sessions-board.tsx` | 1-2 | @copilot | ⏳ Pending | None |

**Collision state**: NO FILE COLLISIONS. @copilot tasks own distinct files.

**Cross-owner collision check**: @cursor and @copilot tasks have **zero file overlap**. Parallel execution is safe.

---

### Concurrent Execution Feasibility

**Wave 1 tasks after 0-2 approval** can execute concurrently in two tranches:

**Tranche A (Cursor, immediately after 0-2 approval)**:
- CMD-DI-1-1: staff-glance.tsx (no dependencies)
- CMD-DI-1-4: Studio presentation grouping (no dependencies; presentation-only)
- CMD-DI-1-5: Mount glance in DevStudio (depends on 1-1 completion)

**Execution plan for Tranche A**:
1. Tasks 1-1 and 1-4 can execute **in parallel** (no file overlap)
2. Task 1-5 waits for 1-1 completion (consumes staff-glance.tsx component)
3. **Timeline**: 1-1 + 1-4 parallel (3–4h), then 1-5 (1h) = **4–5h total for Tranche A**

**Tranche B (Copilot, immediately after 0-2 approval)**:
- CMD-DI-1-2: sessions-board.tsx (no dependencies)
- CMD-DI-1-3: CSS tier ladder (no dependencies)

**Execution plan for Tranche B**:
1. Tasks 1-2 and 1-3 can execute **in parallel** (no file overlap)
2. **Timeline**: 1-2 + 1-3 parallel (3–4h) = **3–4h total for Tranche B**

**Wave 1 total duration** (A and B in parallel): **4–5h** (Tranche A is the critical path).

---

## E. EXACT NEXT WORKER DISPATCHES

### Prerequisites Met?

- ✅ Wave 0-1 (baseline) complete and verified
- ✅ B7 baseline extension complete
- ❌ Wave 0-2 (test audit) awaiting @vision approval
- ❌ Wave 0-3 (AG coordination) awaiting @vision approval

**Action**: Dispatch cannot proceed until @vision independently approves Wave 0-2 (test audit).

### Immediate Dispatch (Upon Wave 0-2 Approval)

**Dispatch A** — To @cursor (3 tasks, concurrent with Dispatch B):

```
TASK: CMD-DI-1-1 — Staff Glance Component
Owner: @cursor
Files: src/components/staff-glance.tsx (NEW)
Work: Props-only component rendering RosterCounts; 6 status groups; honest UNKNOWN until server counts available
Acceptance: No useState/useEffect; counts from props only; all states render
Verifier: @vision
Duration: 3–4h
Dependencies: None
Dispatch upon: Wave 0-2 approval

TASK: CMD-DI-1-4 — Studio Presentation Grouping (PRESENTATION ONLY, RESCOPED)
Owner: @cursor
Files: src/components/shell.tsx, src/surfaces/building.tsx (presentation only)
Immutable: src/lib/building-route.ts (READ-ONLY), STUDIO_TABS values/order (immutable), NAV identity/order (immutable)
Work: Apply Claude Design grouped visual treatment to existing Studio TabRail; optional tertiary breadcrumb
Acceptance: Studio tabs render with grouped presentation; all 6 tabs route correctly; legacy-route guards pass
Verifier: @vision (UX) + @codex (guard verification)
Duration: 2–3h
Dependencies: B7 baseline extension closed (✅ DONE)
Dispatch upon: Wave 0-2 approval

TASK: CMD-DI-1-5 — Studio Overview: Mount Glance (TARGET CORRECTED)
Owner: @cursor
Files: src/surfaces/company.tsx — DevStudio component (line 599)
Work: Mount staff-glance component in Studio Overview position; keep existing layout intact
Acceptance: Glance visible in Studio Overview; no modification to overview.tsx (ERP); no fabricated counts (UNKNOWN until 3-1)
Verifier: @vision
Duration: 1h
Dependency: Task 1-1 (staff-glance component exists)
Dispatch upon: Task 1-1 completion + Wave 0-2 approval
```

**Dispatch B** — To @copilot (2 tasks, concurrent with Dispatch A):

```
TASK: CMD-DI-1-2 — Sessions + Herdr Panes Board
Owner: @copilot
Files: src/components/sessions-board.tsx (NEW)
Work: Two-section layout: Sessions (leases) and Herdr panes; read-only; declared vs. live separation
Acceptance: Clean separation; UNAVAILABLE never shows live as zero; lease rows show source
Verifier: @vision
Duration: 3–4h
Dependencies: None
Dispatch upon: Wave 0-2 approval

TASK: CMD-DI-1-3 — CSS Tier Ladder and Mobile Reflow
Owner: @copilot (exclusive owner of index.css)
Files: src/index.css (update), tailwind.config.js (update)
Work: Micro floor (10px), body (13px), label (11px) tiers; remove nested scrollers; responsive mobile viewport ≥320px
Acceptance: Font sizes align to baseline grid; mobile viewport no horizontal scroll; dark mode HSL overrides
Verifier: @opencode
Duration: 2–3h
Coordination: Task 1-1 must not edit index.css; coordinate with @cursor on timeline
Dependencies: None
Dispatch upon: Wave 0-2 approval
```

---

## F. WAVE 1 CLOSURE CRITERIA

Wave 1 is **CLOSABLE** when:

1. ✅ Wave 0-1 (baseline) — **DONE**
2. ✅ B7 baseline extension — **DONE**
3. ❌ Wave 0-2 (test audit) approval by @vision — **PENDING**
4. ❌ Wave 0-3 (AG coordination) approval by @vision — **PENDING**
5. ⏳ All 5 Wave 1 tasks (1-1, 1-2, 1-3, 1-4, 1-5) completed and verified — **AWAITING DISPATCH** (gated by items 3 & 4)
6. ⏳ No regressions against accepted known-red baseline (821 / 815 / 6 known-red F3–F8) — **AWAITING VERIFICATION** after all tasks complete

**Current state**: Wave 1 is **BLOCKED on Wave 0-2 approval**. Once @vision approves both 0-2 and 0-3, Wave 1 may dispatch immediately (all 5 tasks are ready).

**Remaining work before Wave 1 closure**:
- @vision independent review of CMD-DI-0-2 (test audit) → APPROVE or REQUEST CLARIFICATION
- @vision independent review of CMD-DI-0-3 (AG coordination) → APPROVE or REQUEST CLARIFICATION
- Upon approval: Dispatch CMD-DI-1-1/1-2/1-3/1-4 concurrently
- Upon 1-1 completion: Dispatch CMD-DI-1-5
- Verify all 5 tasks; confirm zero regressions against baseline
- **Wave 1 CLOSED**

**Timeline to Wave 1 closure** (best case, assuming no clarification requests):
- @vision review: 1–2h
- Dispatch + execution: 4–5h (Cursor and Copilot tranches in parallel)
- Verification + regression check: 1–2h
- **Total: 6–9h from Wave 0-2 approval**

---

## NEXT ACTION

**Immediate**: Await @vision independent approval of Wave 0-2 (test audit) and Wave 0-3 (AG coordination).

**Upon approval**: Dispatch CMD-DI-1-1/1-2/1-3/1-4 concurrently to @cursor and @copilot.

**Not authorized**:
- Wave 2 dispatch (serialized, gated by Wave 1 closure)
- Any modification to files listed in B7 baseline extension (extension is closed; files are covered)
- Any change to test guards in Category A or Category C (immutable per audit)

**Coordination complete**. Awaiting Founder decision on @vision approval and Wave 1 dispatch authorization.
