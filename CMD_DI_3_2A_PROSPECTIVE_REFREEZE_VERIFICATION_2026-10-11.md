# CMD-DI-3-2a — PROSPECTIVE RE-FREEZE VERIFICATION RECORD

**Record type:** PROSPECTIVE VERIFICATION of the current contract candidate.
**This is NOT a reconstruction of historical evidence.**
**Date captured:** 2026-10-11T02:39:44.735+05:00 (2026-10-10T21:39:44.739Z)
**Verifier:** @opencode (independent contract verifier)
**Assignment:** CMD-DI-3-2a prospective re-freeze verification
**Builder of record:** @codex

---

## 0. PROVENANCE STATUS — READ FIRST

| Item | Status |
|---|---|
| Historical acceptance provenance for CMD-DI-3-2a | **UNKNOWN** |
| Independent freeze artifact from the original 3-2a | **NOT RECOVERABLE** |
| This record establishes | the identity and fitness of the **current** candidate only |

**No claim is made in this document that the current candidate is the same artifact that was
historically accepted.** The original freeze artifact could not be recovered, so the chain from
"accepted" to "current bytes" is **unbroken and unproven**. This record is a new, standalone
attestation of the present candidate. If the current bytes differ from the historically accepted
bytes, that difference is **not** detectable from anything available to this verification.

Any future comparison must treat this record as the **prospective baseline**, not as proof of
continuity.

---

## 1. ENVIRONMENT (recorded for reproducibility)

| Property | Value |
|---|---|
| Captured at (local) | `2026-10-11T02:39:44.735+05:00` |
| Captured at (UTC) | `2026-10-10T21:39:44.739Z` |
| PowerShell | `5.1.26100.9587` (Desktop) |
| CLR | `4.0.30319.42000` (.NET Framework, NLS collation) |
| Host executable | `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` |
| OS | Microsoft Windows 11 Home Insider Preview, build 26220 |
| Node | `v24.15.0` |
| Culture | `en-GB` |
| App root | `D:\StarqTech\00_STARQ_HQ\operations\starq-command` |

**Runtime pinning note.** The PowerShell identity above is recorded deliberately. Per the
established runtime-dependence finding, any digest computed on this host under
Windows PowerShell 5.1 is **not** reproducible under PowerShell 7, because `Sort-Object Name`
collates differently under .NET Framework NLS than under .NET/ICU. This record publishes no
aggregate listing digest; where a value is stated it is a per-file SHA-256, which is
runtime-independent.

---

## 2. MEASUREMENT RULE

Every byte count and SHA-256 in this record was produced by `Get-Item` and `Get-FileHash` in the
same verification sequence that reports it. No value is inferred, predicted, or carried forward.

---

## 3. SUBJECT FILE IDENTITY

| Path | Bytes | SHA-256 |
|---|---|---|
| `src/lib/contracts.ts` | 40,629 | `81f6e9f61ea2f9b9b045e7c4f03b3bfa2459405f1af1b12f0f3fcde33d29d99d` |
| `tests/work-package-contract.test.ts` | 1,889 | `f5f62c1d260a0385fac41b721bb97c93d73988cbd5218fc71f7e77520b9134c0` |
| `src/surfaces/work-packages.tsx` | 9,526 | `1db6c8526d1759b74ccf22e0ed476771be584b5eb79d2276e6d4931fb3f864a7` |
| `src/surfaces/building.tsx` | 69,866 | `48f8725999b2d9dbd7e28a5393bd4e77afffc63d4db2302929574056e94f89c0` |
| `src/surfaces/evidence.tsx` | 20,619 | `cc7857923fbb59a17e263ceb302a770941fb3240f9917221ed13649b31113456` |
| `server/data-service.mjs` | 41,793 | `77b8d71effe033f2b6fe2b44577d67ae68a6e36750cda865c1292ad19fccabd1` |
| `tsconfig.json` | 573 | `ee30af47cb66118c4b63589e401d3924d4d9af467599b43a50e71c4faa4bad12` |
| `package.json` | 2,299 | `466aa888cd1452e27464fc00ca7e7d3c481ce57283eefceba760c701fa6cfa2a` |

**Subject under verification — the contract candidate:**

```
src/lib/contracts.ts
bytes  = 40629
sha256 = 81f6e9f61ea2f9b9b045e7c4f03b3bfa2459405f1af1b12f0f3fcde33d29d99d
```

---

## 4. REQUIRED CHECKS

### 4.1 Exact eight `WorkPackageRow` fields — PASS

Independently extracted from the interface body; field count, names and types read from source:

| Field | Type |
|---|---|
| `id` | `string` |
| `project_id` | `string` |
| `title` | `string` |
| `current_stage` | `string \| null` |
| `owner` | `string \| null` |
| `verifier` | `string \| null` |
| `board_lane` | `string \| null` |
| `source` | `WorkPackageSource` |

Count = 8. Extra fields = **none**. Missing fields = **none**. Exact match to the required set:
**True**.

`WorkPackageSource` = `{ kind: WorkPackageSourceKind; reference: string }`, where
`WorkPackageSourceKind = 'ERP_TASK' | 'HOADHA_ITEM' | 'GENERAL_ASSIGNMENT'`.

### 4.2 ERP / Hoadha / general assignment mapping — PASS

All three documented verbatim in `contracts.ts`, each naming its own canonical source and each
bounded by an explicit non-derivation rule:

- **ERP tasks** — consume `building.erp_tasks`; declared ERP project mapping (`erp` /
  `starqERP`); stable task id/title; *"Copy a source stage, lane, owner, or verifier only when
  its source field declares that value; preserve stage tokens verbatim."*
- **Hoadha items** — *"consume only records in `building.hoadha.boards`"*; project id taken from
  the live board's `project` field; ids/titles and declared values preserved; **"`hoadha.proposed`
  records are not live board items and do not map here."**
- **General assignments** — normalize only a canonical assignment record with a stable id, explicit
  project id, title and source reference; **"An AssignmentRow or mention alone does not provide
  those package keys; do not derive them from a handle, task text, or mention."**

The `hoadha.proposed` exclusion is consistent with the accepted CMD-DI-2-2 behaviour, which
excludes `hoadha.proposed` from generic LIVE boards.

### 4.3 No-inference semantics — PASS

Stated once, across all sources, verbatim:

> "Across all sources, do not translate status synonyms or infer a lane. A missing or conflicting
> canonical stage/lane is unsupported and must not be filled by a fallback; `source.reference`
> identifies the record for review."

Each of the three mapping rules repeats the constraint locally ("only when its source field
declares", "only when explicitly declared", "do not derive them from"). No fallback mapping, no
status synonym table, and no lane inference is present anywhere in the contract.

### 4.4 Null vs empty availability — PASS ON CONTRACT

Declared response type:

```
WorkPackageRow[] | null
```

The union keeps the two states distinct, and the doc comment states the rule explicitly:

> "returns `WorkPackageRow[]` when sources are available, `[]` for a verified empty result, and
> `null` when source availability is unknown/unavailable."

TypeScript does not conflate `null` with `[]`. A verified-empty result and an unknown-availability
result are therefore not interchangeable in the type.

**Coverage gap (non-blocking, see §6 D1):** no test exercises this distinction.

### 4.5 Signature-only `/api/work-packages` proposal — PASS

| Probe | Result |
|---|---|
| `WorkPackagesEndpointSignature` occurrences in `contracts.ts` | 1 (declaration only) |
| `work-packages` / `work_packages` / `workPackage` / `WorkPackageRow` in `server/*.mjs` | **0 / 0 / 0 / 0** |
| Handler, route, or server-function symbols introduced by the block | none |
| Doc states | "Proposed signature only; no handler or route is implemented here." / "Server implementation requires separate authorization for Wave 4." |

**No endpoint implementation exists.** `/api/work-packages` remains a proposal.

### 4.6 Strict separation from Evidence → Rooms — PASS

| Probe | Result |
|---|---|
| `EvidenceRoomsPeer` still defined in `building.tsx` | **True** |
| Work-package tokens inside the `EvidenceRoomsPeer` body | **0** |
| Work-package tokens in `evidence.tsx` | **0** |
| `evidence.tsx` ownership map still declares `room_index` → Evidence → Rooms | **True** |
| Contract doc statement | "Work and Evidence → Rooms are distinct concepts: this row neither owns nor replaces, repurposes, or shares the `EvidenceRoomsPeer` surface." |

Work is carried by a **separate** surface, `src/surfaces/work-packages.tsx` (9,526 B). It does not
absorb, overwrite or displace the Rooms peer.

### 4.7 No unauthorized production mutations attributable to this verification — PASS

This verification made **no** production or test edits. It wrote one new evidence document in the
operations record and read everything else.

---

## 5. REPRODUCED CHECKS

| Check | Command | Result |
|---|---|---|
| Strict typecheck | `npm run typecheck` (`tsc --noEmit`) | **exit 0**, no diagnostics |
| Targeted contract check | `npx vitest run tests/work-package-contract.test.ts` | **2 / 2 passed** |
| Governance guards | `architecture` + `read-only-capability` + `structural-ownership` + `recovery-gates` | **177 / 177 passed**, 4 files |

No service, floor or observation process was started. `D:\!starq` was not accessed.

---

## 6. FINDINGS

**D1 (MEDIUM, non-blocking) — the null-vs-empty distinction is unguarded by any test.**
`tests/work-package-contract.test.ts` never constructs a `null` response or an empty-array
response. The only `null`s present in the fixture are **field-level** (`owner`, `verifier`,
`current_stage`, `board_lane`), which is a different concern from the **response-level** `null`
versus `[]`. A future edit that collapsed `WorkPackageRow[] | null` to `WorkPackageRow[]` would
pass every existing test and every guard.

**D2 (LOW) — the runtime assertions in the contract test are near-tautological.**
Both `it()` blocks compare local `const` values to themselves, e.g.
`expect(normalizedRows.map((row) => row.source.kind)).toEqual([...the same three literals...])`
and `expect(proposedEndpoint).toMatchObject({ ...its own fields })`. The only substantive
verification in the file is the `satisfies WorkPackageRow[]` operator, which `tsc` enforces. That
is real and it is what actually guards the field set against drift — but it is one mechanism, not
two independent tests.

**D3 (LOW) — the field set is not pinned as a set.**
`satisfies` would catch a fixture with excess properties and would catch the interface gaining a
**required** field. It would **not** catch `WorkPackageRow` gaining a ninth **optional** field.
This verification confirmed the field set independently (§4.1), but no test holds that line.

**D4 (INFORMATIONAL) — the tree has advanced beyond 3-2a.**
`src/surfaces/work-packages.tsx` now exists and `building.tsx` carries Work routing, i.e. the
3-2b surface work is present in the tree. That is outside this record's scope. It does not
affect any check in §4, and it confirms the contract is being consumed as declared. Flagged so a
reader does not attribute that surface to 3-2a.

---

## 7. SMALLEST NECESSARY CORRECTION (advisory — not applied)

Add **one** test to `tests/work-package-contract.test.ts`. No contract change, no production change,
no server change:

1. Construct both a `WorkPackagesEndpointSignature` whose `response` is `null` and one whose
   `response` is `[]`; assert both compile and that they remain distinguishable, so that collapsing
   the union breaks the build.
2. Assert `keyof WorkPackageRow` equals the exact eight-name set, which pins the field list against
   an added optional field.

This closes D1 and D3 at the cost of one file's worth of test lines.

---

## 8. DISPOSITION

# ACCEPT — for the CURRENT CONTRACT CANDIDATE ONLY

| Item | Status |
|---|---|
| Exact eight fields | **PASS** |
| ERP / Hoadha / general mapping | **PASS** |
| No-inference semantics | **PASS** |
| Null vs empty availability | **PASS on contract** |
| Signature-only `/api/work-packages` | **PASS** |
| Separation from Evidence → Rooms | **PASS** |
| Typecheck | **PASS** (exit 0) |
| Targeted contract checks | **PASS** (2/2) |
| Governance guards | **PASS** (177/177) |
| Historical acceptance provenance | **UNKNOWN — not established by this record** |
| Open findings | D1 (test gap), D2, D3, D4 |

**Accepted subject identity:**

```
src/lib/contracts.ts
bytes  = 40629
sha256 = 81f6e9f61ea2f9b9b045e7c4f03b3bfa2459405f1af1b12f0f3fcde33d29d99d
```

This acceptance binds **those bytes**. Any later change to `src/lib/contracts.ts` voids it.

**Historical acceptance provenance remains UNKNOWN.** This record must not be cited as evidence
that the current candidate is identical to the artifact originally accepted under CMD-DI-3-2a.

---

**Prepared by:** @opencode — independent contract verifier
**Scope honoured:** no production edits, no test modifications, no server starts, no managed-floor
activation, no observation-candidate change, no access to `D:\!starq`.