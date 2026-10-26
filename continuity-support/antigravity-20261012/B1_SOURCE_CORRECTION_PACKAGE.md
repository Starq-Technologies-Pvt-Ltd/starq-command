# CMD-MODS: B1 ORIGINAL-CONTRACT FIXTURE IMPLEMENTATION (REV 5 — POST-#9435)
**Governing Directives:** Founder Directive #9435 | Codex Disposition #9434 | Founder Directive #9433 | Broker Record #9432  
**Author / Implementer:** @antigravity (`antigravity-session-fixed`)  
**Target Reviewers:** @mustarq, @codex, @vision, @elder  
**Date:** 2026-10-13  
**Status:** IMPLEMENTED ORIGINAL-CONTRACT FIXTURE PACKAGE PER FOUNDER #9435 — SOURCE ONLY, ZERO NATIVE EXECUTION.

---

## 1. Executive Summary & Controlling Directives

Under **Founder Directive #9435** (incorporating controlling Codex original-contract disposition #9434 and Founder #9433), `@antigravity` has implemented ONE bounded fixture-only source package aligned to the **ORIGINAL B1 safety contract** (Elder takeover review §7, row 193):
- Cooked-terminal Ctrl+C and Ctrl+Break;
- Guardian survival and queryability;
- Workload isolation in its separate group;
- Truthful final job accounting.

Founder Directive #9435 instructed:
> *"Use Codex #9434's dedicated ConPTY launcher as the candidate architecture. Establish explicit launcher/process-group identity and independently reviewable event-delivery evidence without modifying production Guardian or Herdr. Distinguish generated signals, observed handling, survival, and final accounting. Do not invent a requirement for Guardian signal logging.*
> *Preserve unrelated-process protection and fail-closed behavior on unknown isolation or group identity. Include appropriate negative evidence and document all runtime-UNKNOWN assumptions. If source-level feasibility cannot be established, report BLOCKED rather than weaken the original safety objective.*
> *Preserve accepted B2/B3/B4/B5, corrected integrity bindings, unchanged production modules, U1 runtime-UNKNOWN, and the original 13/13 gate. Deliver complete changed-source hashes, focused non-signaling tests, rollback and ONE independent Codex source-review handoff.*
> *#9208 ALL-STOP remains. Source changes and non-signaling pure tests only. No native compilation, signaling, case execution, services, Herdr, N-1/N-2 grants or prohibited D:\!starq access."*

---

## 2. Technical Architecture & Four-Tier Separation

In accordance with Codex #9434 and Founder #9435, the implementation cleanly distinguishes four tiers of claims and evidence without inventing an unproven requirement for Guardian signal logging:

### 2.1 Tier 1: Signal Generation Evidence
- **Preceding Cooked CTRL_C:** Typed through ConPTY into the cooked fixture terminal (`f.child.write('\x03')`), recording generation timestamp and ConPTY write success.
- **Ordered Nonzero Group-Targeted CTRL_BREAK:** `fixture-tools break-console` generates two ordered, nonzero-group-targeted control events:
  - Stage 1: `GenerateConsoleCtrlEvent(1, gpid)` targeting JobGuardian's group.
  - Stage 2: `GenerateConsoleCtrlEvent(1, rpid)` targeting Workload root's group.
  - Explicit fixture-side generation evidence recorded: `guardian_group_sent: true`, `workload_group_sent: true`, `both_groups_sent: true`, `ctrl_break_generated: true`.
  - Group 0 broadcast is strictly eliminated and prohibited (`group_0_used: false`, `group_0_prohibited: true`).

### 2.2 Tier 2: Observed Handling & Isolation
- **Workload Handling Evidence:** Workload root (`child.mjs` in `interrupt` mode) handles `SIGBREAK` in user space and writes the authenticated on-disk marker `sigbreak-ignored`.
- **Fail-Closed Outsider Exclusion:** `fixture-tools break-console` inspects all console members via `GetConsoleProcessList`. Every member must be proven to be either the tool itself, verified Guardian, workload root, or an assigned member of `Local\StarqJob_<instance>`. If ANY unknown process is detected, the tool immediately aborts and fails closed (`unknown_process_detected: true`, `exclusive_console_verified: false`, `sent: false`). Nonzero group targeting structurally excludes unrelated processes that attach to the console.
- **Guardian Handler Statically Confirmed:** Production `JobGuardian.cs:21,100,112` registers an in-memory handler `IgnoreInterrupts = t => t == 0 || t == 1`. The original contract does not require a Guardian signal log.

### 2.3 Tier 3: Post-Event Survival & Queryability
- **Post-CTRL_C Survival & Query:** Following cooked `CTRL_C`, Guardian answers live job query `jobs.status(f.meta)` with `owned: true`, `guardian_gone: false`, `active >= 1`. Workload heartbeats continue beating (`beats_after_ctrl_c: true`), with no premature exit (`workload_exit_before_release: false`).
- **Post-CTRL_BREAK Survival & Query:** Following targeted break signals, Guardian answers live job query with `owned: true`, `guardian_gone: false`, `active >= 1`, with query timestamp `at > ctrl_break.sent_at_ms`. Workload heartbeats continue beating (`beats_after_ctrl_break: true`).

### 2.4 Tier 4: Truthful Final Accounting
- **Release by Marker File:** Family ends cleanly without signal-based termination via `release` marker file.
- **Truthful Final Closeout:** Family reaches truthful closed state (`final: closed`).
- **Authenticated HMAC Receipt:** Guardian's authenticated `closed.json` HMAC receipt is verified with `active === 0` and modification time strictly after break signaling (`closed_receipt_mtime_ms > ctrl_break.sent_at_ms`).
- **Zero Force Operations:** Zero force operations performed by harness (`no_force: true`).

---

## 3. Dedicated ConPTY Launcher Candidate Architecture

In `fixtures/fixture-tools.cs`, mode `conpty-launcher` is implemented as the candidate architecture:
```csharp
fixture-tools conpty-launcher <JobGuardian.exe> <guardianSha256> <launch.json> <expectedConfigSha> <out.json>
```
1. Reads descriptor and guardian binary into single immutable buffers; verifies SHA-256 against expected pins.
2. Creates wrapper process group using `CREATE_NEW_PROCESS_GROUP`.
3. Calls `SetConsoleCtrlHandler(null, false)` on the wrapper root to clear inherited `CTRL_C` ignore.
4. Spawns unchanged `JobGuardian.exe launch <configPath>` as its descendant process in that process group.
5. Emits verifiable launcher receipt recording `launcher_root_pid`, `process_group_creation`, and `ctrl_c_ignore_cleared: true`.

### Runtime-UNKNOWN Assumptions Documented
Because native execution is barred under #9208 ALL-STOP:
- The exact runtime behavior of ConPTY pseudoconsole group inheritance and console attachment remains runtime-UNKNOWN until an authorized build grant and native run are permitted.
- The source package establishes the complete structural architecture and fail-closed oracle contract without weakening any safety invariants or partial qualification waivers.

---

## 4. Live Modified Source Hashes (SHA-256)

```
9da9085f9fa2e9afbcb9d6cf2711d4471a53189b63e30bcaa4125614d22a2eb3  fixtures/fixture-tools.cs
60b1085ea03fc10be744fb22071922cd43108db57ac696e501c15f3fa2c836e6  harness.mjs
339559b3bd76eed4ee82bd91f9fce2a9cafb55dcbfd02f28ecca003f98ee6259  oracles.mjs
4fdce5d0da03a889c8a47097617974d51259d5b74c6c1ea89e39b3cb26178fbc  ORACLES.md
1f0438955f7889a6512074ad4fb27abd037ebb82de7f836cd110455c37909d9d  README.md
41a9a0e2d1d9778d31444e352dedebb2c4735d116573b16f7f69156f30f18512  tests/oracles.test.mjs
```

### Rollback Baseline Verification
Rollback copies in `_prior-20261012-pre9416/` match `_prior-20261012-pre9416/SHA256SUMS` (6/6 match):
```
5e861b5a022965cba294047fc7bb8ca9036a8e2c5068fcbfd2823ab803b65948  fixtures/fixture-tools.cs
71f1ea7be801a4c697d2ba8babfcf6063641eba4f05755cb280be19cab2d8a42  harness.mjs
5c58266b77df86f07b01b09d0611a10f2b9987311c5a2797396ae9c773f065e5  oracles.mjs
be71e98dd5d7d7dc79e71eab385644c2463ed8d49de0d7ad7198baedfd10a7da  ORACLES.md
54121d01d4610045e148f863e3f23db26f342c9611ca719861e95652295ede1d  README.md
aac9b67288152c7753b53267ce3a1788af16453bb460d9921c99e3003ea9c59a  tests/oracles.test.mjs
```

---

## 5. Verification & Test Evidence

### Pure-Node Test Suite Results
Command executed:
`node --test tests/*.test.mjs`
Result: **53/53 tests PASS (0 failures)**.

---

## 6. Review Handoff & Boundaries

- Handoff is made to `@codex` for single independent review under DEC-072.
- Room #9208 ALL-STOP preserved. Zero native compilation, zero console signals, zero native test cases executed.
