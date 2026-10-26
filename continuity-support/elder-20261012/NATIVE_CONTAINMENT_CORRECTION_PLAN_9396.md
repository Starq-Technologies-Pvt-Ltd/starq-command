# G-CONTAINMENT: converged correction plan (Founder #9396)

**Author:** Elder (`claude`), who is also the original builder of the harness. **Type:** READ-ONLY plan. No source edits, native execution, services or authorization changes.
**Read against:** Room head #9396 (`a98733dd…684456`), Codex #9390/#9392, Vision #9394 and the controlling #9395.
**Status:** PROPOSED. This plan closes nothing. G-CONTAINMENT remains OPEN, and Room #9208 ALL-STOP remains.

## 0. Sources inspected (SHA-256 prefix)

| File | sha256 |
|---|---|
| starq-lifecycle/native-fixtures/harness.mjs | d552151c3c6d0d0d |
| starq-lifecycle/native-fixtures/README.md | 6d2d398c7414e880 |
| native-fixtures/fixtures/breakaway.cs / .exe | 2fa0a1b07c8d696d / 6208cd33fb1a9009 |
| native-fixtures/fixtures/child.mjs / parent.mjs | 9bae6f898179fad3 / 1094197c56bcd85c |
| starq-lifecycle/native/JobGuardian.cs / .exe | b199182a47dc91ff / 5eb82b7ed4a0ac1c |
| native/guardian-build.json / windows-job-compatibility.json | b72b21a8902b841c / 1b6d950d6811371c |
| herdr-floor/src/windows-containment.mjs | ef63f3d0ac00d6ec |
| herdr-floor/src/containment-config.mjs | a3d583ad107cd66e |
| herdr-floor/src/registry.mjs | 869b8ea6ff6758a2 |
| herdr-floor/src/rule0.mjs (imported by containment-config) | 1a99334c2a5baf29 |
| herdr-floor/src/pty-pool.mjs | 2873774c29bd0825 |
| starq-command/scripts/lifecycle/inspect.mjs | c25573a9a55b950b |
| starq-lifecycle/Capture-WindowsBaseline.ps1 | ca159ed764d2609b |

### Facts established from source

- **F1. Gate.** `compatibilityGate()` (containment-config.mjs:14–26) requires all 13 cases to be exactly PASS. It also requires an independent verifier distinct from the builder, plus exact guardian, source and dependency pins. **This plan does not change the gate.**
- **F2. Import closure.** The harness imports windows-containment, containment-config (which imports **rule0.mjs**), registry and starq-command/scripts/lifecycle/inspect.mjs, and it dynamically imports pty-pool. None of these is in `REVIEWED`. `REVIEWED` paths are relative to `starq-lifecycle`, so they cannot name these files.
- **F3. Missing files.** `currentPins()` silently skips missing reviewed files (harness.mjs:88). `breakaway_refused` then returns NOT_DEMONSTRATED instead of refusing.
- **F4. Unbound authority.** `fixture-review.json`, `N1.json` and `N2.json` are trusted on editable string fields (harness.mjs:98–112). Nothing binds them to Room.
- **F5. CTRL_BREAK sender.** The guardian's own `graceful` operation already sends CTRL_BREAK the reviewed way: it attaches to the guardian console and calls `GenerateConsoleCtrlEvent(1, rootGroup)` (JobGuardian.cs:143–151). So a console-attached sender already exists in the reviewed binary. What's missing is a broadcast that also reaches the guardian, and an oracle that proves the guardian survives it.
- **F6. Fail-closed launch.** JobGuardian `Launch` creates the child suspended, then assigns and verifies membership. On any failure before resume, it cancels the suspended child by handle (JobGuardian.cs:112–124). The `assignment_denied_no_resume` behaviour therefore exists in code; only a deterministic way to induce it is missing.
- **F7. Breakaway case.** The breakaway fixture records `suspended_child_cancelled`, but the harness never asserts it. The harness also accepts `breakaway_created === true`. Since the job sets no BREAKAWAY_OK limit, a created breakaway child means the limits are wrong, so that path must be a FAIL.
- **F8. Nested case.** `nested_job` inner phase returns PASS whenever there is no started receipt (harness.mjs:288–290), so any generic launch failure counts as a PASS.
- **F9. Detached case.** `detached_bootstrap_console_close` relies on the operator's attestation that the window was closed (harness.mjs:329).
- **F10. N-2 cases.** `terminal_close` and `broker_crash_recovery` can only emit OBSERVED or N2_NOT_GRANTED (harness.mjs:351, 386).
- **F11. Baseline.** Capture-WindowsBaseline.ps1:56–59 hashes `D:\!starq\agent-comms\room.jsonl`.
- **F12. D2-P.** `native-fixtures/d2p/` is a separately blocked prototype. Its README states it cannot pass or change the 13-case gate, so this plan excludes it.

## 1. Slices (three, dependency-ordered)

Slices A and B are built together and reviewed **once** as a single exact-bytes fixture review. Slice C contains no code. Splitting further would add review gates without adding safety.

```
A  Trust closure ──┐
                   ├─► single independent fixture review (Codex) ─► Founder N-1 ─► C  Execute + seal ─► Vision verifies ─► gate
B  Oracle closure ─┘                                                  (N-2 per printed instance, inside C)
                                         G-RULE0 fresh inventory: separate authorization, parallel to C
```

No production module changes in A or B: `herdr-floor/src/*`, `JobGuardian.*` and `containment-config.mjs` are **pinned and untouched**. The guardian build and its exact-build identity are therefore preserved.

---

### SLICE A: Trust closure (pins, Room-bound authority, StarqTech-only baseline, sealing)

**Builder:** Elder. **Reviewer:** Codex, as part of the single A+B review. **Files** (all under `starq-lifecycle/native-fixtures/` unless noted):

| File | Change |
|---|---|
| harness.mjs | modify: pin closure, fail on a missing reviewed file, Room-bound authority, baseline precondition |
| README.md | modify: runbook and authority format |
| room-authority.mjs | NEW: read-only Room verifier |
| Capture-FixtureBaseline.ps1 | NEW: StarqTech-only, read-only baseline (pre and post) |
| seal-run.mjs | NEW: run-directory SHA-256 seal |
| tests/room-authority.test.mjs, tests/pins.test.mjs | NEW: pure-Node tests with synthetic Room ledgers; no process creation |

**A1. Pin closure.** `REVIEWED` becomes workspace-relative and covers the whole executed closure:
- the harness itself, room-authority, seal-run, the baseline script, the README and ORACLES.md;
- all fixtures, including the new ones from Slice B;
- native/JobGuardian.cs, JobGuardian.exe and guardian-build.json;
- herdr-floor/src/windows-containment.mjs, containment-config.mjs, registry.mjs, rule0.mjs and pty-pool.mjs;
- starq-command/scripts/lifecycle/inspect.mjs;
- the node.exe and node-pty dependency pins that are already listed.

The harness also checks the import closure statically: it parses the static and dynamic import specifiers of every reviewed `.mjs` and refuses if a relative import resolves to a file outside `REVIEWED`. A missing reviewed file is a refusal, never a skip, and the breakaway "not compiled" branch is removed.

**A2. Room-bound authority.** Each authorization is a Room record. The files only point at it.
- `authorization/<stage>.json` = `{ "room_seq": n, "room_record_hash": "<64 hex>" }`.
- `room-authority.mjs` reads `D:\StarqTech\agent-comms\room.jsonl` read-only and opens it once. It verifies:
  - the record at `room_seq` exists and has exactly that recordHash;
  - its previousRecordHash equals the recordHash of seq−1, and the chain to the head is contiguous;
  - the sender and authority are correct: the review must come from a handle other than the builder (`claude`); N-1 and N-2 must come from `mustarq` with `authorityDecision.senderAuthorityLevel = ROOT_GENESIS` and `allowed = true`;
  - the body carries an exact machine line:
    - review: `STARQ-FIXTURE-REVIEW accepted_sha256=<sha256 of the canonical accepted-pins JSON>`; the pins JSON sits in RUN and is the reviewer's list;
    - N-1: `STARQ-N1 review_seq=<n> cases=<comma list>`;
    - N-2: `STARQ-N2 n1_seq=<n> grant=<32-hex instance>:<force|terminal_close|broker_crash>`.

  N-2 must be later than N-1, and the instance must have been printed by this RUN; the harness checks it against `RUN/descriptors`.
- **Residual (U2):** Room records are hash-chained but unsigned (`signatureAlgorithm: none`). The binding is therefore to the canonical broker chain and the broker's authority decision, not to a cryptographic signature. The Founder must accept this as the authority basis, which is consistent with "Room as authority".

**A3. StarqTech-only baseline.**
- `Capture-FixtureBaseline.ps1` is derived from Capture-WindowsBaseline.ps1 with the `D:\!starq` ledger entry removed; it hashes only `D:\StarqTech\agent-comms\room.jsonl`.
- It captures:
  - processes: JobGuardian, the herdr-floor runtime node, herdr, OpenConsole/conhost;
  - listeners on 5173, 5177, 5178, 5179 and 5188;
  - the fixture residue candidates.
- It writes only `RUN\baseline\pre.json` or `post.json`.
- The harness refuses unless `pre.json` exists, shows all five ports dark, and shows no JobGuardian or herdr process.
- The post baseline is a report-only residue diff.

**A4. Seal.** `seal-run.mjs` writes `RUN\SEAL.sha256.json` covering every file in RUN. It refuses if any of the 13 case records, the authorization pointers, the pins or a baseline is missing. It never writes `windows-job-compatibility.json`.

**Acceptance A (static plus pure-Node):**
- Reviewer confirms the import-closure equality, that a missing file refuses, and that no `D:\!starq` reference remains: `grep` finds nothing across the reviewed set.
- `node --test native-fixtures/tests/` passes. The tests must show that each of these refuses: a tampered recordHash, a broken chain, the wrong sender, a body line mismatch, N-2 before N-1, an instance not printed, and a builder acting as reviewer.
- No process-creating test is included.

---

### SLICE B: Oracle closure (a genuine, pre-declared PASS route for all 13 cases)

**Builder:** Elder. **Reviewer:** Codex, in the same review as A. **Files:**

| File | Change |
|---|---|
| native-fixtures/ORACLES.md | NEW: the pre-declared PASS predicate per case; reviewed bytes, and the harness asserts exactly these |
| harness.mjs | modify: case runners |
| fixtures/fixture-tools.cs, .exe | NEW: one inert native helper with three modes (below) |
| fixtures/breakaway.cs, .exe | modify: verify cancellation by wait and record the exit code |
| fixtures/child.mjs | modify only if needed to add a `breakable` mode (graceful on CTRL_BREAK, which already exists) |

**`fixture-tools.exe` modes.** No PID-addressed termination, no network, and it exits immediately.
- `identify-console <out>`: records its own pid and creation filetime, and the console window owner (GetConsoleWindow → GetWindowThreadProcessId).
- `break-console <guardian_pid>`: FreeConsole, then AttachConsole(guardian), then `GenerateConsoleCtrlEvent(CTRL_BREAK, 0)`. Group 0 broadcasts to every process on that console, *including the guardian*.
- `restricted-query <guardian.exe> <config>`: CreateRestrictedToken over the caller's token, with the user and Administrators SIDs set deny-only plus DISABLE_MAX_PRIVILEGE. It runs `JobGuardian.exe query <config>` under that token and records the guardian's stdout, stderr and exit code.

**Per-case oracle.** PASS only when every predicate holds; anything else is FAIL. The outcomes PARTIAL, OBSERVED and NOT_DEMONSTRATED are removed from the PASS vocabulary.

| # | Case | Change | PASS predicate (summary; ORACLES.md is authoritative) |
|---|---|---|---|
| 1 | pre_resume_assignment | none | unchanged: receipt assigned_before_resume, receipt ≤ first heartbeat, root exe = pinned node, graceful GONE |
| 2 | parent_exit_live_descendants | none | unchanged |
| 3 | graceful_no_force | none | unchanged |
| 4 | terminal_release_handle_only | none | unchanged |
| 5 | nested_job | remove the "no receipt ⇒ PASS" branch | the inner receipt is authenticated with assigned_before_resume; inner fixture start pid = receipt root; outer status `active ≥ 2` while the inner family runs; inner graceful GONE, then outer closed. Any refusal is FAIL, with guardian stderr captured |
| 6 | breakaway_refused | assert cancellation; created child ⇒ FAIL | self_in_job, `breakaway_created=false`, `win32_error=5`, outer job closed. If created: FAIL, plus `suspended_child_cancelled=true` and a verified wait with exit 125 recorded as residue proof |
| 7 | explicit_force_empty_family | none (N-2 `force`) | unchanged |
| 8 | detached_bootstrap_console_close | replace attestation with identity proof | launch phase runs in a **conhost** window and records `identify-console` (launcher plus console host pid and creation time). Verify phase: both exact identities are absent (inspect, pid+creation), heartbeats continue ≥ 5 s past that point, the family is owned, then graceful GONE. Shared or unknown host identity (for example Windows Terminal) is FAIL |
| 9 | console_interrupt_guardian_survives | add CTRL_BREAK broadcast | the CTRL_C sub-check stays as now. Then `break-console` targets the guardian with the workload in graceful/breakable mode. PASS requires an authenticated `closed` receipt written *after* the break timestamp by the guardian identity in the started receipt. This proves the guardian survived the broadcast and completed job accounting. Workload `graceful` marker present, and no force op |
| 10 | query_denied_unknown | add real ACL denial | tampered descriptor and forged receipt sub-checks stay. `restricted-query` must produce guardian `owned:false` from **OpenJobObject Win32 error 5**, with the exact error captured, and the adapter must map it to `UNKNOWN`. Failure at descriptor file-read or at any other point is FAIL, not PASS |
| 11 | assignment_denied_no_resume | **see U1** | PASS requires a reviewed deterministic induction. Then `AssignProcessToJobObject` fails, there is no started receipt, the fixture `start` marker is absent, and the guardian error is recorded. Without an accepted induction, it stays NOT_DEMONSTRATED and the gate stays open |
| 12 | terminal_close | define the PASS oracle (N-2 `terminal_close`) | after the live pseudoconsole is released: never `closed` while active > 0; final closed **only** through an authenticated `closed` receipt (active 0, guardian_gone); exact root and guardian identities absent afterwards; no force op; post-baseline shows no family residue. Any UNKNOWN is FAIL |
| 13 | broker_crash_recovery | define the PASS oracle (N-2 `broker_crash`) | the host exits with code 9 and the pseudoconsole open. A fresh recovery process holding only the persisted descriptor reads `owned=true, active ≥ 1`, proving ownership survives broker death. Then: never closed without proof; final authenticated `closed` receipt; identities absent; no force op |

For 12 and 13, PASS means *truthful accounting*, not workload survival. That matches the doctrine at JobGuardian.cs:117: "Parent exit, broker death and PTY closure never substitute for job accounting."

**Build step inside B.** Compiling `fixture-tools.exe` and `breakaway.exe` with the pinned `csc.exe` arguments from guardian-build.json is a Windows build. It needs its own build-only authorization (U5). The guardian is **not** rebuilt.

**Acceptance A+B (single review):** the reviewer (Codex) records the exact bytes of every REVIEWED file in the accepted-pins JSON and verifies:
- each ORACLES.md predicate is implemented exactly in harness.mjs;
- no outcome path can return PASS outside its predicate;
- no process.kill, taskkill or PID-addressed signal exists anywhere;
- every fixture is self-bounded;
- there is no `D:\!starq` reference.

The reviewer then posts the `STARQ-FIXTURE-REVIEW` Room line.

**Rollback A/B:** before editing, the current native-fixtures tree is copied to `native-fixtures/_prior-<date>/` with SHA256SUMS. Revert means restoring those bytes. No production module is touched, so no runtime rollback is needed.

---

### SLICE C: Execution, seal and independent acceptance (no code)

| Step | Owner | Content |
|---|---|---|
| C0 | Founder | N-1 Room record (`STARQ-N1 review_seq=… cases=…`), naming the **Windows operator** (U4) |
| C1 | Operator | create `starq-lifecycle\evidence\native-fixture-YYYYMMDD-HHMMSS`; write the authorization pointers; `Capture-FixtureBaseline.ps1 -Phase pre` |
| C2 | Operator | one case per invocation with the pinned node, in the README order; the detached case runs in a conhost window |
| C3 | Founder | N-2 Room records, each for one printed instance and action (force, terminal_close, broker_crash) |
| C4 | Operator | post baseline; `seal-run.mjs`; post the seal hash to Room; report residue, never clean it |
| C5 | Vision | independent verification: re-hash the sealed pins against the review; check each case's raw data against ORACLES.md; check the baselines. Then author `windows-job-compatibility.json` (builder Elder, verifier @vision, all 13 PASS, evidence = sealed files) and run `compatibilityGate()` read-only. Expected result: `resolved: true` |
| C-R0 | Separate | fresh G-RULE0 inventory (`Capture-RuntimeInventory.mjs`) under its own authorization, in parallel. It does not depend on and cannot prove G-CONTAINMENT |

**Abort and recovery** (unchanged from #9392): stop on any unexpected process, live port, unknown job state, receipt error or missing proof. Never use taskkill, wildcards or PID signals. Report residue; cleanup needs its own exact authorization. A FAIL that reveals a guardian defect means a guardian fix, a rebuild, a new A+B review and a **full 13-case rerun** (exact-build rule, U9).

## 2. Unresolved or unsafe prerequisites

| ID | Item | Why it matters | Who resolves |
|---|---|---|---|
| **U1** | **No deterministic induction for `AssignProcessToJobObject` failure has been identified** without modifying the guardian. Job-name squatting fails earlier, at CreateJobObject 183, never-adopt. An active-process limit fails CreateProcess, not assignment. | This is the critical path. The case cannot PASS without it, and the gate needs 13/13. | Bounded research inside B, plus review. If no documented, reproducible method is accepted, the gate remains OPEN. Any substitute, such as a separately pinned fault-injection build, would **change the gate** (containment-config.mjs). That is a Founder decision with independent review; it is not a waiver, and this plan does not propose it |
| U2 | Room records are unsigned | A2 binds authority to the chain and broker decision, not a signature | Founder accepts this as the basis |
| U3 | A restricted token as the "second principal" | It avoids creating a local account (a machine mutation) | Reviewer accepts it, or rejects and the Founder authorizes an account separately |
| U4 | Execution needs an interactive Windows operator | In this session, Windows-side execution was refused by the local permission layer (#9381) | Founder names the operator in N-1 |
| U5 | csc build of fixture-tools.exe and breakaway.exe | A native build | Founder build-only authorization within B |
| U6 | Console host identity under Windows Terminal | Case 8 proof | Runbook requires conhost; ambiguity is FAIL |
| U7 | D2-P prototype | Off the path; cannot affect the gate (its own README) | Excluded |
| U8 | Fresh G-RULE0 inventory | Dated evidence only (DEC-104, 2026-10-04) | C-R0, separately |
| U9 | Exact-build rule on FAIL | A guardian change invalidates every case | Full rerun |

## 3. MODS alignment (#9386)

G-CONTAINMENT is the remaining code-level prerequisite before **Founder-authorized Herdr floor activation** (MODS criteria 2–3). After the gate resolves, the next steps are fresh Command health, the Founder lifting #9208 for the floor, and then the first bounded mission. The roles follow the assembly line: builder (Elder), independent reviewer (Codex), operator (named), independent verifier (Vision), Founder authority through Room. Containment acceptance is not diluted: 13/13 exact PASS on the exact build, with no waiver.
