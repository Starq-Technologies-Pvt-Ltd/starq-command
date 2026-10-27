# WAVE 0 DISPATCH SUMMARY

**Founder Authorization**: 2026-10-10  
**Phase**: Setup, validation, and coordination (prerequisite for Wave 1)  
**Workers**: @codex (2 tasks), @opencode (1 task)  
**Deliverables**: 3 documents for Founder review before Wave 1 dispatch  

---

## Three Wave 0 Deliverables

### **Deliverable 1: Pre-Change Source Hash Baseline**

**Task**: CMD-DI-0-1 (@codex)  
**Output file**: `.source-baseline-2026-10-10-pre.json`  
**Contents**:
```json
{
  "timestamp": "2026-10-10T<HH:MM:SS>Z",
  "scope": "src/, server/data-service.mjs, server/floor.mjs (pre-change state)",
  "files": [
    { "path": "src/App.tsx", "sha256": "...", "bytes": 12345 },
    { "path": "src/index.css", "sha256": "...", "bytes": 67890 },
    ...
  ],
  "summary": "50+ files, exact as of this timestamp"
}
```

**Acceptance criteria**:
- ✅ Baseline captures exact state before any Wave 1 changes — **VERIFIED 52/52 hash and byte-exact, 0 missing, 0 extra**
- ✅ All file hashes reproducible — **VERIFIED; digest `456b845c…9885`, stable on recompute**
- ✅ Scope excludes observation/ and scripts/lifecycle/ (orthogonal)
- ✅ File list is authoritative; later compared against post-change manifest
- ⬜ **B7 BASELINE EXTENSION — OPEN AND BLOCKING.** The accepted 52-file manifest does not cover files that planned tasks modify or consume. `tailwind.config.js` (CMD-DI-1-3) is the material omission: it is an explicit update target with **no pre-change hash**, so Gate 1's pre/post reconciliation is unverifiable for it.
  - Full per-file hash list: `DESIGN_INTEGRATION_TEST_AUDIT_2026-10-10.md` §5.1–§5.7
  - **Rule: no task in any wave may modify a listed file until the extension is closed.**

**Verifier**: @opencode — **core baseline accepted**  
**Review gate**: Founder confirms baseline **and B7 extension** before Wave 1 starts

---

### **Deliverable 2: Test Audit & Architecture Guard Inventory**

**Task**: CMD-DI-0-2 (@opencode)  
**Output file**: `DESIGN_INTEGRATION_TEST_AUDIT_2026-10-10.md`  
**Contents**:

#### **A. Core/Load-Bearing Guards (NO CHANGES)**

Tests that enforce non-negotiable safety, integrity, and authorization:
- `tests/architecture.test.ts`: 
  - Read-only enforcement (no POST/PATCH/DELETE in UI)
  - No business maturity computation in React layer
  - No hardcoded fixture data in source
- `tests/read-only-capability.test.ts`:
  - GET/HEAD only; no other HTTP methods
- `tests/structural-ownership.test.tsx`:
  - Each surface owns one primary question
  - Honesty gate (state-gate) rendered before data
  - No merged health states
  - No re-derived metrics

**Status**: **PRESERVE UNCHANGED**

#### **B. Presentation-Specific Tests (CANDIDATES FOR UPDATE)**

Tests that enforce current layout/IA but may need revision for grouped navigation:
- `tests/phase7-corrective.test.ts:189`:
  - `NAV.length === 7` (rail size assertion)
  - `NAV[3].id === 'studio'` (position assertion)
  - **Status**: Unchanged IF grouped tabs are inside Studio context (per Design Integration). Requires Founder approval to modify if needed.
- `tests/phase7-ui.test.tsx` (if exists):
  - Surface layout, component tree assertions
  - May need updates for card/grid toggle, status grouping
  - **Status**: Candidates for Task 4-1 (architecture guard updates)

#### **C. Phase-5 Authorization Boundary**

- **Immutable**: "Phase 6 and beyond remain unauthorized; no Phase 6 surface or nav entry"
  - This test remains unchanged and prevents accidental feature creep
- **Grouped navigation inside Studio**: Does NOT violate Phase-5 (rail still 7 items, Studio tabs increase discovery)
  - Requires test audit confirmation, not test modification

**Acceptance criteria**:
- ✅ Core guards clearly categorized; no ambiguity
- ✅ Presentation candidates listed with specific test locations
- ✅ Grouped navigation feasibility assessed — **result: NO governance-guard change required; CMD-DI-1-4 rescoped presentation-only**
- ✅ Founder approval requests stated explicitly — **only `tests/phase7-corrective.test.ts:189` (`NAV.length === 7`) is a census; `:319` is load-bearing governance and is NOT modifiable under CMD-DI-1-4**
- ✅ Clear guidance for Task 4-1 (which tests CAN be updated, which must not)

#### **D. Accepted known-red baseline (B5) — replaces blanket "all tests pass"**

**31 test files · 821 tests collected · 815 passed · 6 known-red · zero newly exposed failures.**

Known-red identities, preserved individually:

| ID | File | Test |
|---|---|---|
| F3 | `tests/phase2.test.ts` | read-only gates are explicit and allowlisted |
| F4 | `tests/phase2.test.ts` | redacts a whole-value absolute path |
| F5 | `tests/phase2.test.ts` | redacts every one of several embedded paths in a single value |
| F6 | `tests/phase7-dual-room.test.tsx` | the Building origin actually projects the real Hoadha sources |
| F7 | `tests/phase7-dual-room.test.tsx` | the Hoadha board renders the real reconciled corpus |
| F8 | `tests/staff-board.test.tsx` | never calls the Founder a ghost, a retired seat or a machine |

- **No new failure is allowable merely because the baseline is red.**
- **Rewriting an expectation solely to produce a green test is prohibited.** F3–F8 are investigated as live-data drift under separate authorization.

#### **E. Approved guard strengthening (B6)**

`tests/structural-ownership.test.tsx:402` currently iterates a hardcoded `['staff','projects','capacity','activity']` — **4 of the 6 canonical Studio peers**, leaving `Overview` and `Herdr` outside the distinct-work-area guard. Founder-approved: derive the list from canonical `STUDIO_TABS` (`src/lib/building-route.ts:31`) under **CMD-DI-4-1**. This is an **explicit governance/test modification — not cleanup, not relaxation** — and must appear in the post-change manifest diff as a guard change.

**Verifier**: @vision (independent review) — **PENDING**  
**Review gate**: Founder approves the audit and the B5/B6 changes before Wave 1

---

### **Deliverable 3: Antigravity Remediation Coordination Memo**

**Task**: CMD-DI-0-3 (@codex)  
**Output file**: `DESIGN_INTEGRATION_AG_COORDINATION_2026-10-10.md`  
**Contents**:

**Case A: Recent AG work found**
```markdown
## AG Remediation Plan Located

**Path(s)**: [file paths or Room references]

**Scope**: [description of work, components/features affected, ownership claims]

**Overlap Assessment**:
- Files conflict with CMD-DI tasks: [list]
- Ownership conflict: [if @cursor and AG both claim src/surfaces/staff.tsx, etc.]
- Coordination required before Wave 1: [specific actions]

**Recommendation**: [update Wave 1–2 ownership, resolve conflicts, or sequence tasks]
```

**Case B: Recent AG work not found**
```markdown
## AG Remediation Plan Status: UNKNOWN

**Search performed**: [files checked, Room search cutoff (seq 9257, Oct 8), workspace root limits]

**Result**: No recent Command UI remediation work visible

**Possible explanations**:
- Work exists outside D:\StarqTech (not visible)
- Work is in Room seq > 9257 (not accessible)
- Work planned but not yet started
- Work is in D:\!starq (prohibited access)

**Founder clarification required**:
- Is there an AG remediation plan the integration should coordinate with?
- If yes: provide location or brief scope
- If no: confirm this integration may proceed with Wave 1 ownership as stated

**Awaiting**: Founder input before Wave 1 dispatch
```

**Acceptance criteria**:
- ✅ Honest report: work found OR UNKNOWN (not "no overlap")
- ✅ If found: specific overlaps and ownership conflicts identified
- ✅ If UNKNOWN: clear statement of why, no fabricated assumptions
- ✅ Actionable: either coordination steps or explicit Founder request for clarification

**Verifier**: @vision  
**Review gate**: Founder provides AG clarification OR confirms no overlap before Wave 1

---

## Corrected Task Inventory

**The authoritative task census is `DESIGN_INTEGRATION_EXECUTION_PACKAGE_CORRECTED_2026-10-10.md` §Summary.** This summary restates it and must not diverge from it.

| Wave | Tasks | Count |
|---|---|---|
| Wave 0 | CMD-DI-0-1, 0-2, 0-3 | 3 |
| Wave 1 | CMD-DI-1-1, 1-2, 1-3, 1-4, 1-5 | 5 |
| Wave 2 | CMD-DI-2-1, 2-2, 2-3, 2-4 | 4 |
| Wave 3 | CMD-DI-3-1, **3-2a, 3-2b, 3-2c**, 3-3, 3-4 | 6 |
| Wave 4 | CMD-DI-4-1, 4-2, **4-3** | 3 |
| | **Total dispatched** | **21 (FINAL)** |

**Not dispatched, retained in the record:**

| ID | Status | Reason |
|---|---|---|
| CMD-DI-2-5 | **CLOSED** | Founder decision B3: Work is IN SCOPE. Its outcome is realized by CMD-DI-3-2a/b/c. |
| CMD-DI-3-2 | **SUPERSEDED** | Folded into CMD-DI-3-2a, which strictly subsumes its scope. |

**Changes applied by Founder decisions (B2–B7):**

- **B2** — Programme normalized to a single authoritative census across **5 waves**. **CMD-DI-4-3 production-build verification is MANDATORY, reinstated and retained everywhere**; this summary previously dropped it without stating so. **Production build verification may not be removed from any wave configuration.** All contradictory counts removed from both documents.
- **B3** — **Work is IN SCOPE.** §A:22 and §C:388 of the package, and Task 2-5, are reconciled to this position. CMD-DI-3-2a, 3-2b and 3-2c are retained consistently. **Scope boundary: Design Integration Work surface only — this does not silently expand into the full future Command WorkPackage architecture.** The `/api/work-packages` server endpoint implementation remains unauthorized.
- **B4** — Task 2-4 is re-anchored to the existing Rooms implementation. **Superseded by ruling 3**: the target is `EvidenceRoomsPeer` in `src/surfaces/building.tsx`, **not** `evidence.tsx`. **No duplicate Room surface is created**, and Rooms ownership is not falsely reassigned to `evidence.tsx`.
- **B5** — Accepted test baseline recorded below; blanket "all tests pass" language removed.
- **B6** — Studio peer-list derivation from canonical `STUDIO_TABS` approved as **guard strengthening**, scheduled in CMD-DI-4-1.
- **B7** — Baseline extension is a **blocking dependency** on any modification of an affected file.
- **CMD-DI-1-4 rescope** — presentation-only. The six canonical Studio tabs already exist byte-for-byte at `src/lib/building-route.ts:31`. **No NAV or STUDIO_TABS census modification is authorized for that task.**

**Census is FINAL at 21 dispatched tasks / 5 waves** (Founder ruling, 2026-10-10). No earlier figure of 17 or 20 is required or implied. **CMD-DI-3-3 is not folded into CMD-DI-4-3**; both are dispatched in full with separate verifiers, dependencies and durations.

### Second correction pass — Founder rulings (from Cursor cold-start reconnaissance)

| Ruling | Effect |
|---|---|
| **1 — Census** | 21 / 5 FINAL. 3-3 not folded into 4-3. |
| **2 — CMD-DI-1-5** | Target is **`src/surfaces/company.tsx` → `DevStudio`** (line 599). **`src/surfaces/overview.tsx` is the ERP process Overview and is out of scope.** 1-1 stays props-only; counts are never fabricated; unavailable buckets render honestly UNKNOWN until CMD-DI-3-1; no server work in Wave 1. |
| **3 — CMD-DI-2-4** | Target is **`EvidenceRoomsPeer` in `src/surfaces/building.tsx`** (line 278, dispatched line 132). No `room.tsx`; Rooms is **not** owned by `evidence.tsx`; no silent migration. **3-2b Work must not overwrite or repurpose Evidence → Rooms.** |
| **4 — CMD-DI-1-4** | **`src/surfaces/building.tsx` added to blast radius** for Studio TabRail presentation. `STUDIO_TABS` values/order immutable; `NAV` identity/order immutable; `building-route.ts` read-only; `#floor`/`#process`/`#truth` preserved. |
| **5 — Vision** | CMD-DI-0-2 remains **PENDING** until Vision independently accepts. |
| **6 — Historical reports** | Old audit and AG evidence are **not** rewritten to match current state. |
| **7 — P3A** | P3A-4 / P3A-6 ownership remains **unresolved**, pending the dedicated reconciliation lane. |

Both target corrections were **verified against source before being written down**, not taken on assertion.

---

## Hash Diff Expectations

**Baseline (Task 0-1) vs. Post-Change (Task 3-4): EXPLAINED DIFF, NOT EQUALITY**

When Task 3-4 creates `.source-baseline-2026-10-10-post.json`, the diff will show:

```
## Changed Files

| File | Pre-change SHA | Post-change SHA | Change reason |
|------|---|---|---|
| src/components/staff-glance.tsx | (new) | <hash> | Task 1-1: new component |
| src/components/sessions-board.tsx | (new) | <hash> | Task 1-2: new component |
| src/index.css | <hash> | <hash2> | Task 1-3: tier ladder, mobile reflow |
| **tailwind.config.js** | <hash> | <hash2> | **Task 1-3 — requires B7 baseline extension to be provable** |
| src/components/shell.tsx | <hash> | <hash2> | Task 1-4: rail presentation (**NAV and STUDIO_TABS unchanged**) |
| **src/surfaces/building.tsx** | <hash> | <hash2> | **Task 1-4: Studio TabRail presentation (added to blast radius). ALSO Task 2-4: `EvidenceRoomsPeer` Rooms list** |
| **src/surfaces/company.tsx** | <hash> | <hash2> | **Task 1-5: mount `staff-glance` in `DevStudio` (Studio Overview)** |
| **src/surfaces/overview.tsx** | <hash> | **unchanged** | **ERP process Overview — explicitly OUT of blast radius for Task 1-5** |
| src/surfaces/overview.tsx | <hash> | <hash2> | Task 1-5: mount glance |
| src/surfaces/staff.tsx | <hash> | <hash2> | Task 2-1: card/grid toggle + grouping |
| src/surfaces/project-board.tsx | <hash> | <hash2> | Task 2-2: project_id generalization |
| src/surfaces/company-os.tsx | <hash> | <hash2> | Task 2-3: advisory disclaimer |
| **src/surfaces/evidence.tsx** | <hash> | <hash2> | **Task 2-4: Rooms experience (re-anchored from the non-existent `room.tsx`)** |
| **src/lib/contracts.ts** | <hash> | <hash2> | **Task 3-2a: WorkPackageRow contract** |
| server/floor.mjs | <hash> | <hash2> | Task 3-1: glance counts |
| **tests/structural-ownership.test.tsx** | `41ddaa10…8177cd` | <hash2> | **Task 4-1 B6: STUDIO_TABS derivation — GUARD CHANGE, must be flagged as such** |
| tests/design-integration.test.tsx | (new) | <hash> | Tasks 4-2, 3-2c |
| ... | ... | ... | ... |

**`src/lib/building-route.ts` is deliberately absent from this table.** CMD-DI-1-4 is rescoped presentation-only; the six canonical Studio tabs already exist there and are **not modified**. It is **READ-ONLY** for that task. Any change to that file is a change of scope and returns to the Founder.

**`src/surfaces/overview.tsx` is recorded as UNCHANGED.** It is the ERP process Overview and is explicitly outside CMD-DI-1-5's blast radius.

**`src/surfaces/building.tsx` carries two tasks** (1-4 Studio TabRail presentation, 2-4 `EvidenceRoomsPeer` Rooms list). CMD-DI-1-4 and CMD-DI-2-4 are **serialized** — 2-4 is Wave 2, 1-4 is Wave 1 — so no concurrent edit.

## Unchanged Files
[list of files with same pre/post hash]

## Authorization Notes
- Observation candidate pin remains valid (Task 3-3 verification)
- No drift from expected changes
- All modifications account for and approved
```

**Acceptance criteria**:
- ✅ Every file change is explained (which task, which feature)
- ✅ Hash diffs show exactly which files changed, **and which did not** — `building-route.ts`, `NAV` and `STUDIO_TABS` are recorded as **unchanged**
- ✅ Guard changes flagged distinctly (B6) rather than folded into presentation changes
- ✅ Observation pin verification confirms no surprise edits
- ✅ Diff is auditable: Founder can trace any change to its task
- ⬜ Every file in the B7 extension scope appears in both pre- and post-manifests, so no change is unprovable

**Verifier**: @codex (Task 3-4 output)  
**Review gate**: Founder accepts diffs as expected before production promotion

---

## Wave 0 Completion Checklist

**Before Wave 1 dispatch**:

- [ ] **Deliverable 1**: Baseline captured; reproducible — **CORE ACCEPTED (52/52)**
  - Accepted by: @opencode — **done**
  - Approved by: Founder — **done**
  - ⬜ **B7 baseline extension (§5.1–§5.6) closed — BLOCKING**

- [ ] **Deliverable 2**: Test audit complete; core/presentation guards categorized — **DELIVERED**
  - `DESIGN_INTEGRATION_TEST_AUDIT_2026-10-10.md` sha256 `84afe4d9…aba7a` (as amended with the B1 recovery record)
  - Accepted by: @vision (verifier) — **PENDING until Vision independently accepts (ruling 5)**
  - Approved by: Founder — **pending**
  - B5 (no-regression acceptance) and B6 (guard strengthening) — **recorded, scheduled into CMD-DI-4-1**

- [ ] **Deliverable 3**: AG coordination resolved
  - Memo present; asserted hashes independently verified
  - P3A-2 census fixture fallback — **REJECTED by the audit as guard weakening; do not accept**
  - P3A-4 / P3A-6 ownership — **UNRESOLVED, pending the dedicated reconciliation lane (ruling 7)**

- [x] **Deliverable 4**: Task inventory reconciled — **DONE, 21 dispatched / 5 waves FINAL**
  - CMD-DI-2-5 CLOSED; CMD-DI-3-2 SUPERSEDED; CMD-DI-3-3 retained in full, not folded
  - Work screen IN SCOPE, reconciled across §A, §C, Task 2-5 and 3-2a/b/c — **done**
  - CMD-DI-1-5 → `company.tsx` `DevStudio` — **done**
  - CMD-DI-2-4 → `building.tsx` `EvidenceRoomsPeer` — **done**
  - CMD-DI-1-4 blast radius incl. `building.tsx` — **done**
  - CMD-DI-4-3 reinstated everywhere — **done**

**Founder sign-off**: "Wave 0 complete; Wave 1 dispatch authorized"

---

## No Source Implementation

**Wave 0 scope**: Capture state, audit tests, resolve coordination. **NO CODE CHANGES.**

- ❌ No source edits
- ❌ No npm install/build
- ❌ No service startup
- ❌ No managed-floor activation
- ❌ No observation candidate modification
- ❌ No access to D:\!starq

**Wave 0 output**: Three documents + task inventory update for Founder review.

---

**Ready for**: Founder review of three deliverables before Wave 1 dispatch

**Workers assigned**:
- @codex: Tasks 0-1, 0-3
- @opencode: Task 0-2

**Wave 1 status**: **NOT DISPATCHED.** Blocking: B7 baseline extension; CMD-DI-0-2 Vision acceptance; P3A-4/P3A-6 reconciliation lane.

**Recommended for immediate dispatch once B7 closes** — no governance guard in blast radius: CMD-DI-1-1, CMD-DI-1-2, and CMD-DI-1-4 **as rescoped to presentation-only**.

**Note (ruling 6)**: this summary and `DESIGN_INTEGRATION_EXECUTION_PACKAGE_CORRECTED_2026-10-10.md` carry present state. Historical audit and AG evidence are intentionally **not** rewritten to match.
