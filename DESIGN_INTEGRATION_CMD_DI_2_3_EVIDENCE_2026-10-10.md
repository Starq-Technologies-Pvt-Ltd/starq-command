# DESIGN INTEGRATION — CMD-DI-2-3 EVIDENCE PACKAGE

**Task ID:** `CMD-DI-2-3`  
**Worker:** `@antigravity`  
**Verifier:** `@vision`  
**Timestamp:** `2026-10-10T18:15:00Z`  
**Workspace:** `D:\StarqTech`  
**Application Root:** `D:\StarqTech\00_STARQ_HQ\operations\starq-command`  
**Status:** FROZEN FOR INDEPENDENT VERIFICATION

---

## 1. Scope and Mutation Census

Only **one file** was modified under task CMD-DI-2-3. No other file in `src/`, `server/`, `tests/`, or configuration was modified, added, or deleted by Antigravity in this session.

| File Path | Action | Pre-Change SHA-256 | Current SHA-256 | Pre Bytes | Current Bytes |
|---|---|---|---|---|---|
| `src/surfaces/company-os.tsx` | Modified | `333160f62183532593e867bc2b5587e444a6d337b6d87e8c478f7759327dea9f` | `f724c23471ee970837df933d705541190d5042f67a3c753c8a7a72a264456045` | 36,384 | 36,827 |

Session transcript audit confirms exactly one write operation (`replace_file_content` at step 390) targeting `src/surfaces/company-os.tsx`.

---

## 2. Exact Attributable Diff (Unified Format)

The single modification made by CMD-DI-2-3 is the addition of the advisory reporting disclaimer FocusRail to `StructureTab`:

```diff
--- a/src/surfaces/company-os.tsx
+++ b/src/surfaces/company-os.tsx
@@ -211,6 +211,14 @@ function StructureTab({ company }: { company: CompanyOsProjection }) {
           organisational statement, not an omission.
         </p>
       </FocusRail>
+      <FocusRail label="Reporting line">
+        <p className="prose-note" data-testid="advisory-reporting-disclaimer">
+          <span className="inline-block px-1.5 py-0.5 mr-2 font-mono text-3xs border bg-truth-stale-soft text-truth-stale border-truth-stale/30">
+            ADVISORY
+          </span>
+          Proposed Accountability Mapping (Advisory). Ratified designations and standings per Chapter 22.
+        </p>
+      </FocusRail>
       {ordered.map((floor) => {
         const rooms = [...(roomsByFloor.get(floor.id) ?? [])].sort(
           (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0),
```

---

## 3. Pre-CMD-DI-2-3 Snapshot Provenance and Invertibility Proof

The exact pre-change content and hash of `src/surfaces/company-os.tsx` are independently proven by three converging facts:

1. **Pre-Change Baseline Record:**  
   `.source-baseline-2026-10-10-pre.json` records:
   - Path: `src/surfaces/company-os.tsx`
   - Bytes: `36384`
   - SHA-256: `333160f62183532593e867bc2b5587e444a6d337b6d87e8c478f7759327dea9f`
2. **Prior-Task Non-Interference:**  
   No Wave 1 task (CMD-DI-1-1 through 1-5) or earlier Wave 2 task (CMD-DI-2-1, 2-2) targeted `src/surfaces/company-os.tsx`. The file remained in its original pre-change state until CMD-DI-2-3 was dispatched.
3. **In-Memory Invertibility Check:**  
   Reverting the 8 inserted lines from current `src/surfaces/company-os.tsx` yields a buffer of exactly 36,384 bytes with SHA-256 `333160f62183532593e867bc2b5587e444a6d337b6d87e8c478f7759327dea9f` (100% byte-for-byte match).

---

## 4. Protected Surfaces Non-Modification Verification

### 4.1 Server Files (`server/` directory)
All 11 server files are verified identical to their pre-change baseline and B7 extension hashes:

| Server Module | Bytes | SHA-256 | Baseline Match |
|---|---|---|---|
| `server/data-service.mjs` | 41,793 | `77b8d71effe033f2b6fe2b44577d67ae68a6e36750cda865c1292ad19fccabd1` | MATCH |
| `server/floor.mjs` | 47,752 | `8eb1d3f32c00e112b35abc0493b4234b51d50d34af247ba58437c713cf54cfdb` | MATCH |
| `server/building.mjs` | 7,233 | `4b6bf0ec3a7443f9188155369c755b94a39251caa339ad75493fcd4cca12ea9a` | MATCH (§5.5) |
| `server/staff-profile.mjs` | 12,080 | `b03b42252e2a71b06ab3bd1966c95acdcada1c14b9b758ba75a4153432d5a5e8` | MATCH (§5.5) |
| `server/company-os.mjs` | 25,287 | `ff09f977e57a95f6d47888cfddaeee7812d8cda3769b3251d018953c8bb458a3` | MATCH (§5.5) |
| `server/health-floor.mjs` | 30,709 | `78ee00e4c4992b82601f083f8330edf200a03a981e2939ab9f62759f800efe73` | MATCH (§5.5) |
| `server/paths.mjs` | 4,214 | `03cdfe15eda5b5a10e7f3efc7858c9fe52e808e9aeb13981d3b7ea9069e598d4` | MATCH (§5.5) |
| `server/path-guard.mjs` | 6,944 | `2968ee9fba9ca679fd46443e20fd74ded2d406d585b700bd451c5f0e1b42cfd3` | MATCH (§5.5) |
| `server/gates.mjs` | 6,508 | `7b4c8cb472df73c2696a92e1c031135a0d6c1a6f093e9c1881b82ec40382d9e8` | MATCH (§5.5) |
| `server/snapshot.mjs` | 14,617 | `d12b9fb39ea4ba0bb6478e7067d3a4eb61fdbec70b2498d80e8c1488438dbf05` | MATCH (§5.5) |
| `server/building-service.mjs` | 6,463 | `f93395c62d769a6382422d5f1c99f085799c6b6c8bdaca336d598c672f200ed1` | MATCH |

### 4.2 Governance and Architecture Tests
Zero test files were modified by Antigravity under CMD-DI-2-3.
- `tests/company-os.test.tsx`: 47 passed (47)
- `tests/architecture.test.ts`: 24 passed (24)
- `tests/read-only-capability.test.ts`: 108 passed (108)
- `tests/structural-ownership.test.tsx`: 41 passed (41)

### 4.3 Known-Red Drift Invariant (B5)
Full Vitest run across 33 test files:
- **Total tests:** 837
- **Passed:** 831
- **Failed:** 6 (exactly F3–F8 preserved; zero newly exposed failures)

---

## 5. Summary for Independent Verifier (@vision)

1. **Exact File Modified:** `src/surfaces/company-os.tsx` ONLY.
2. **Pre-Change SHA-256:** `333160f62183532593e867bc2b5587e444a6d337b6d87e8c478f7759327dea9f` (36,384 bytes).
3. **Current SHA-256:** `f724c23471ee970837df933d705541190d5042f67a3c753c8a7a72a264456045` (36,827 bytes).
4. **Net Modification:** Exactly 8 inserted lines defining `<FocusRail label="Reporting line">` with the verbatim required disclaimer text.
5. **Server / Governance Boundary:** 100% intact and verified.
