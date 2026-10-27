# Starq Development Environment — Governance & Runtime Overhead Audit

**Date:** 27 October 2026
**Machine:** Acer Nitro ANV15-41 · 12 logical CPUs · 15.3 GB RAM · D: 686 GB free
**Companion to:** `COMMAND_SOFTWARE_FACTORY_FEASIBILITY_2026-10-27.md`
**Method:** live measurement of running processes, services and the Room ledger, plus source inspection. Inspect-and-report only — no file was modified, no service started or stopped, no Room cycle initiated.

**Measurement caveat:** the working tree changed *during* this audit. Between 21:55 and 23:21 a Nexus recovery run added `server/nexus-cortex.mjs`, `server/nexus-library.mjs`, `src/surfaces/cortex.tsx`, `src/surfaces/library.tsx`, imported 1,308 tasks into `data/pm-operating.db`, and created a 1.63 GB `recovered/` tree. Numbers below carry their timestamps.

---

## Executive verdict

**The premise is half right, and the wrong half matters.**

The Starq runtime is **not** resource-intensive. Measured: all 14 Starq runtime processes together hold **157 MB of RAM (1.0% of the machine)** and consume **~0.3% of one core at idle**. Herdr itself is 14 MB. The application is one of the lightest things on this laptop.

What is actually expensive falls into three categories, in descending order of cost:

1. **One un-cached, O(whole-ledger) projection, polled on a timer.** `GET /api/surface` takes **2.1–2.8 seconds** and returns **2.0 MB**, with `cache-control: no-store` and no memoisation. The UI polls it every **15 seconds** and `/api/building` (2.4 s, 1.5 MB) every 30 s. One open browser tab therefore costs roughly **18% of a core, continuously and indefinitely**, to re-derive facts that change a few times an hour. This is the single largest measurable waste in the environment, and it is also *the cause of a user-visible defect*: the client aborts at **4,000 ms** (`FETCH_TIMEOUT_MS`), so a 2.7 s baseline under any load tips into the "DATA SERVICE UNREACHABLE" banner that is on screen right now. The dashboard is declaring its own backend dead because its own projection is too slow.

2. **Coordination traffic that has outgrown the work it coordinates.** Room volume rose from ~50–100 events/day in mid-October to **1,137 / 1,002 / 1,169 on 24–26 October**. Of the last 2,000 events, **824 (41%) are pure coordination by subject alone** — ACKs, readiness records, identity/lease confirmations, "received", "verified", corrections. On the looser body-inclusive measure it is 1,177 of the last 1,500 (78%). The whole ledger holds **19.1 M characters ≈ 4.8 M tokens** of message text; the last 2,000 events alone are **~533 k tokens**. Over the same period the PM board produced **4 tasks** and the control plane **0**. The organisation is spending most of its words on establishing that it is ready to work.

3. **Duplication and ambiguity, which cost attention rather than cycles.** Nine `starq-command` directories exist across the two workspace roots; 31 git repositories under `D:\StarqTech` alone; five worktrees; three PM databases, of which the running service uses the one with 4 rows while the one with 1,308 rows sits unused; two 1,000-line communications SOPs that are both explicitly *not in force*. Disk is not the constraint (686 GB free) — **finding the right copy is**.

**The headline number:** the governance and runtime machinery is lean in code (the whole Room protocol is **2,816 lines**; `AGENTS.md` is **103 lines**). The overhead is not in the mechanisms. It is in **how often they are re-executed, how much they are re-read, and how many copies of everything there are.** That distinction determines every recommendation below: almost nothing should be deleted, and almost everything should be made *incremental* rather than *repeated*.

---

## Measured baseline

| Measurement | Value | How obtained |
|---|---|---|
| Starq runtime RAM (14 node/herdr processes) | **157 MB** | `Get-Process` grouped, 27 Oct 23:0x |
| Starq runtime CPU, 10 s sample, idle | **0.3% of one core** (herdr 0.34 s/10 s; every node process 0.00) | CPU delta sample |
| Agent harnesses (22 processes: claude ×13, codex, opencode, …) | **1,445 MB** | same |
| Everything else on the laptop | other-Windows 6,705 MB · browser 2,037 MB · WSL 934 MB | same |
| Free RAM at audit time | **2.0 GB of 15.3 GB**; Memory Compression at 1.9 GB | `Win32_OperatingSystem` |
| `GET /api/surface` | **2.15–2.82 s**, 1,997,629 B, no cache | 3 consecutive `curl` runs |
| `GET /api/building` | **2.40 s**, 1,529,831 B | `curl` |
| `GET /api/health` (a *health check*) | **1.93 s**, 1,110 B | `curl` |
| `GET /api/work-packages` | 1.06 s, **13,369,506 B** | `curl` |
| `GET /api/pm/portfolio` (SQLite) | **0.0175 s**, 2,036 B | `curl` |
| UI poll intervals | surface **15 s**, building **30 s**; client abort **4,000 ms** | `use-command-surface.ts:30,52,150` |
| One `readRoomSnapshot()` | **458 ms**, **+168 MB RSS**, 15,841 records | instrumented node run |
| Room ledger | 35.8 MB live + **62.7 MB in three `.bak` copies** | file sizes |
| Room events/day, 24–26 Oct | 1,137 / 1,002 / 1,169 | ledger scan |
| Pure-coordination share, last 2,000 events | **41.2%** (subject-only); 78% (body-inclusive) | ledger scan |
| Room text volume | 19.1 M chars ≈ **4.8 M tokens** total; 533 k tokens in last 2,000 | ledger scan |
| Sender concentration, last 2,000 | codex 1,056 (53%), claude 495, antigravity 236 | ledger scan |
| Watcher poll | 2,000 ms, short-circuits on unchanged file size | `room-watch-codex.mjs:12,438-452` |
| Active watchers | **1** (codex offset current 22:54; antigravity/claude stale since 25 Oct) | offset file mtimes |
| Governance code | protocol 2,816 lines · `AGENTS.md` 103 lines / 2,114 words | `wc` |
| Non-binding SOPs | 1,005 + 1,028 lines, both marked not-in-force | `wc`, doc headers |
| Lifecycle stack | `.bat` → `.ps1` → `command-lifecycle.mjs` → `owner.mjs` (820 lines) → `lifecycle-child.mjs` → JobGuardian → service | file tree |
| Databases | `pm-board.db` 4 tasks (**in use**) · `pm-operating.db` 1,308 tasks / 18 projects (**not in use**) · `control-plane.db` 0 tasks | SQLite row counts |
| Duplicate app trees | **9** `starq-command` directories | `find` |
| Git repositories under `D:\StarqTech` (depth 4) | **31** | `find` |
| Untracked bulk in product dir | `recovered/` **1.63 GB / 23,509 files**, created 23:14, **not gitignored** | `git status`, size scan |
| Scratch debris | **38** `_tmp-*` files in `agent-comms/` root | `ls` |

---

## Findings

### 1. Governance

**1.1 `AGENTS.md` — KEEP, with one trim.** 103 lines / ~3 k tokens loaded per session. For a studio where agents genuinely do lose continuity, this is cheap and it works. The one excess: it carries both the *startup gate* and the *per-assignment ACK* rule in full prose, and the §"Session startup and task readiness" rewrite (#15794) already exists precisely because the earlier version caused per-task re-verification. Keep the rule, cut the restatement — roughly 25 lines are a second telling of the first telling.

**1.2 Two 1,000-line communications SOPs that are not in force — REMOVE (archive).** `STARQ_COMMUNICATIONS_SOP_v1.0.md` is headed *"Proposed Final Standard — Founder approval required before enforcement"*, v1.1 is a Founder-review proposal, and `AGENTS.md` separately records that neither is adopted. Two thousand lines of authoritative-looking, non-authoritative procedure sit beside the 103 lines that actually bind. Cost: every agent that reads the directory must work out which document governs — and `AGENTS.md` has to spend lines telling them. Move both to `Archives/`; lose nothing, because nothing depends on them.

**1.3 Identity leases and hash-chained envelopes — KEEP, unchanged.** 111 + 73 + 302 lines. This is the mechanism that makes "who said this" and "was this tampered with" answerable, and it is the foundation the acceptance gates in Command rest on. At 2,816 lines for the entire protocol it is not where the weight is. Removing it would cost the one property this organisation has that most don't.

**1.4 Structured metadata enforcement — KEEP the requirement, FIX the ergonomics.** `--subject` mandatory, `--action-required` when addressing someone, `--task`/`--action` to close tasks: all sound, and `AGENTS.md` records that getting `--task`/`--action` wrong previously left a completed task open. But the enforcement is a **throw at send time with no defaults and no discovery**. `room-structured-metadata.mjs:36` rejects a post with no subject; nothing suggests one. The canonical consumer of this contract inside Command — `postToRoom()` at `pm-service.mjs:718` — **does not pass `--subject` at all** and would fail on every call; it has never been caught because the feature is pinned off. A contract that the organisation's own service violates, undetected, is being enforced in the wrong place. Validate at compose time, default the subject from the first line, and make `send.mjs --dry-run` print the envelope.

**1.5 Acknowledgement protocol — SIMPLIFY. This is the largest governance cost.** 41% of recent Room traffic is coordination about coordination. `AGENTS.md` already forbids ack-of-ack, and the ledger contains `#15875 "Review ACK verified"` — an acknowledgement of an acknowledgement — two events after the ACK it acknowledges. The rule exists; it is not holding. The structural reason is that ACKs are *prose messages in the same stream as work*, so they are indistinguishable from content, they are reasonable to reply to, and they accumulate. **An acknowledgement is a state transition, not a message.** `--action started` already sets In Progress; that is the entire informational content of a Task ACK. Make readiness/ACK a metadata-only event that the Room renders as a status change on the task rather than a line in the feed, and roughly 800 of every 2,000 events stop being things a human or an agent has to read.

**1.6 Repeated verification of already-verified facts — SIMPLIFY.** The startup gate requires resolving the canonical handle, inspecting the lease, binding the process/pane/session, reading the Room tail through `readRoomSnapshot()`, and posting a startup record — before substantive work. Each of those is individually justified by a real past failure. Together, on a session that is *continuing*, they re-establish facts that have not changed. #15794 already narrowed this to "once per session, not per task", which was the right correction; the remaining excess is that **nothing caches the result**, so each agent re-derives the binding from scratch rather than reading a machine-readable session record it or a peer wrote an hour ago. A `sessions.json` holding `{handle, sessionId, pid, pane, cwd, boundAt}` would turn a five-step gate into one read plus one confirmation.

### 2. Runtime

**2.1 Herdr broker — KEEP.** 14 MB, 0.34 s CPU per 10 s. It is the only component that can see live panes at all. Cost is negligible; the honest limitation (it reports `label: null`, `broker_owned: false`, *"Herdr actuation is not reachable from this broker"*) is a capability gap, not overhead.

**2.2 The lifecycle stack — SIMPLIFY (one layer, not six).** To start six local node processes the chain is `Start-Starq.bat` → `Start-Starq.ps1` → `command-lifecycle.mjs` → `owner.mjs` (820 lines) → `lifecycle-child.mjs` → JobGuardian job objects. Each layer was added for a real reason — pinned ports, dependency order, health contracts, fail-closed start, containment — and 42 offline tests cover it. But the measured consequence of the depth is that **it cannot reliably recycle itself**: the takeover report records `STOP_INCOMPLETE` and "Access is denied", and I independently confirmed the root cause — `Win32_Process.CommandLine` is **empty** for exactly the long-lived node PIDs (11252, 43240, 50300, 12828, 40480, 49300), so the owner cannot identify its own children by command line. A supervisor that cannot stop what it started is a liability on a single laptop, where the recovery is "reboot". **Keep the config-driven health contracts and dependency order; replace command-line-based child identification with a PID file written at spawn** (the information the supervisor already has, recorded instead of re-derived). This is a small change that removes the environment's most operationally painful failure.

**2.3 JobGuardian containment — MEASURE FIRST, then likely SIMPLIFY.** Containment is protecting against runaway agent processes, which is a real risk on a shared laptop. But it is currently the thing that *blocks* recovery, and I could not establish from the repository how often it has actually prevented a runaway versus how often it has prevented a restart. The ledger would answer it. Do not remove it before that count exists.

**2.4 Six separate HTTP origins for one single-user dashboard — MERGE.** data :5177, building :5178, herdr :5179, pm :5176, broker :5188, ui :5173. The split is architecturally motivated (the data service is frozen read-only, so every new capability became a new origin) — see the companion assessment. The runtime cost is small; the *operational* cost is not: six health contracts, six failure modes, a Vite proxy table, CORS and Host allowlists per origin, and a lifecycle owner that must sequence them. Three origins — one read projection, one write/domain service, one agent runtime — would carry the same guarantees with half the surface.

### 3. Architecture

**3.1 The uncached projection — SIMPLIFY. Highest-value single change in this audit.** `/api/surface` re-parses the 35.8 MB ledger and the canonical files on every request, 2.1–2.8 s, 2.0 MB, `no-store`, every 15 s. `/api/health` costs **1.93 s** because it builds the entire Phase-2 surface to report one `overall` field — and the lifecycle supervisor polls it. Meanwhile `/api/pm/portfolio`, backed by SQLite, answers in **17 ms**: the same application already demonstrates the alternative, **120× faster**. The fix is cheap and preserves every honesty guarantee: cache the assembled surface keyed on the source files' `(size, mtime)`, serve an ETag, return 304 when nothing changed, and give `/api/health` its own cheap path. Nothing about derivation, provenance or drift detection changes — only how often the derivation runs. Expect the dashboard's steady-state cost to drop from ~18% of a core to near zero, and the spurious UNREACHABLE banner to disappear.

**3.2 Cost that grows with history — SIMPLIFY (the same change, at scale).** Every full read is **O(entire ledger)**: 458 ms and 168 MB RSS today, linearly worse forever. At 1,100 events/day the ledger will double in roughly two months, at which point a single surface build exceeds the client's own 4 s abort budget outright. The watcher already does the right thing (it short-circuits on unchanged file size and keeps a byte offset) — the projection services do not. Give them the same offset-plus-incremental treatment.

**3.3 `/api/work-packages` returning 13.4 MB — SIMPLIFY.** A single endpoint serialising 13 MB of Room-derived records, on a loopback dashboard, with no pagination. Per the companion assessment it is not a work-package system at all; as overhead it is 13 MB of allocation and JSON per call.

**3.4 Three PM databases, the wrong one in use — MERGE, urgently.** `pm-board.db` (4 tasks) is what the running service reads; `pm-operating.db` (**1,308 tasks, 18 projects**, written 21:55 today) is what the working tree points at; `control-plane.db` (0 tasks) is a third store for the same concept with an incompatible schema. Plus a 14 Oct backup. This is not a performance problem; it is a **truth problem**, and it is already visible: the live UI shows `4 cards · To do 0 · Next 0 · In progress 0 · Blocked 0 · Done 0` and `PM attention unavailable — REJECTED: No such route`, because the UI is the new build and the service is the old one.

**3.5 Nine `starq-command` trees, 31 git repositories, 5 worktrees, and a 1.63 GB `recovered/` inside the product directory — REMOVE / relocate.** Disk is free; attention is not. `recovered/nexus` (23,509 files, created 23:14) is **untracked and not gitignored**, so a `git add -A` would commit 1.6 GB of a copied workspace into the application repository. Recovery and staging material belongs beside the repo, not inside it. Also: **38 `_tmp-*` files** in `agent-comms/` root, and **62.7 MB of `room.jsonl.bak` copies** next to the live 35.8 MB ledger.

### 4. Agent operations — why drafting one Room message cost so much

You asked specifically about this, and it is the clearest illustration in the audit, so here is the honest trace of what I did and why.

To draft **one message**, I ran: a lease check (`--whoami claude` → *"no live lease… open to claim"*), a Room tail read (`readRoomSnapshot()` — 458 ms, 168 MB, all 15,841 records, to see the last twelve), a second read because the record field names were not what I assumed, a third read of two specific event bodies to check whether a prior review had already covered my finding, and a hash computation over four files. Five tool calls and roughly 170 MB of parsing before a single word was drafted.

Each step was individually correct under the rules in force:

- **The lease check** is required because the startup gate says identity must be established before posting — and `claude` had no live lease, which is real information.
- **The Room tail read** is required because `AGENTS.md` says to read current state through `readRoomSnapshot()` and never the file directly, and because `--task` and `--action` must match the real assignment — I cannot invent a task ID, and the only place task IDs exist is the ledger.
- **The body reads** were my own judgement, and I would do them again: `#15876` showed that a session posting as `claude` had already accepted a PM-writer review, and I needed to know whether my finding contradicted it. (It did not — that review's scope was the fail-closed gate, not the send arguments.)
- **The hashes** are the house evidence convention.

So the procedure is not irrational. The cost is **structural**, and it has three specific causes:

1. **There is no cheap read.** The only sanctioned way to see the Room is to parse all of it. Wanting twelve recent subjects costs the same as wanting everything. A `room.mjs --tail 20` that seeks from the end of the file would turn 458 ms and 168 MB into milliseconds, and it is a small change to a module that already tracks byte offsets elsewhere.
2. **Addressing information is not queryable.** To post correctly an agent needs: its own handle, its lease state, the open task IDs, who is working on what, and the sequence it is replying to. Five facts, each currently obtained by reading and re-deriving the entire history. One small `room-state.json` — open tasks, current assignees, live leases, head sequence — rewritten on each append would collapse the whole preamble into one file read.
3. **The ledger is both the archive and the working set.** Every question about *now* is answered by traversing *everything that ever happened*. That is why the cost of every operation rises with the organisation's age.

The deeper point: **this overhead is paid by every agent, on every message, and it is paid in context as well as time.** My preamble was ~170 MB of parsing and several thousand tokens of transcript for a message that had not been written yet. Multiply by 1,100 messages a day.

**Recommendation — SIMPLIFY:** add a tail-read API and a derived `room-state.json`. Keep every rule about what a message must contain. Change only how expensive it is to find out.

### 5. Performance

**5.1 Idle consumption — no action.** Measured at 0.3% of one core for the entire Starq runtime. There is no idle-burn problem; the large accumulated CPU totals on some node PIDs (3,382 s, 2,374 s, 1,710 s) are lifetime figures from long-lived processes, not current spin — the 10-second delta was 0.00 for every one.

**5.2 Memory pressure is real but not Starq's.** 2.0 GB free of 15.3 GB with Memory Compression at 1.9 GB means the machine is swapping. The consumers are 22 agent-harness processes (1.4 GB), browsers (2.0 GB), WSL (0.9 GB) and general Windows (6.7 GB). **Starq's own runtime is 157 MB.** The lever here is *how many agent harnesses are open at once*, not the architecture. Thirteen `claude` processes are running.

**5.3 Transient spikes — SIMPLIFY (covered by 3.1/3.2).** Each full snapshot read allocates 168 MB. On a machine with 2 GB free, several of those concurrently — one per service per request — is the one way this architecture can actually hurt the laptop today.

**5.4 Polling — SIMPLIFY.** The watcher's 2 s poll is correctly cheap (a `statSync` short-circuit). The *UI's* 15 s/30 s polls are not — they trigger the full rebuild unconditionally. Fix the server side (3.1) and the poll interval stops mattering.

### 6. Development workflow

**6.1 Five worktrees, two of them stale since 17 October — REMOVE.** `migration-review-ab055e7` and `room-dispatcher` have not been touched in ten days. Each carries its own `node_modules`. `_worktrees` totals 539 MB / 37,384 files.

**6.2 Test suite — SIMPLIFY (it is currently a liability, not a net).** Stored evidence: **21 of 63 test files failed, 4 of 496 tests failed**, mostly on hard-coded absolute paths such as `D:\STARQ_COMMAND_BASELINE_TO_ROUTE_CENSUS_2026-10-01.md`. `tsconfig.json` includes `src` only, so a green typecheck covers no `server/*.mjs`. Separately, `vitest run` cannot be run safely at all right now: `tests/real-tree-capability-mutation.test.ts` writes mutants into the real `src/`, and the control-plane tests open the live `control-plane.db` while the service holds it. A suite that cannot be run on demand provides no protection, whatever its pass rate. Making `npm test` safe and path-independent is worth more than any new test.

**6.3 Evidence collection — SIMPLIFY.** 219 MB / 1,208 files under `evidence/`, plus hash tables repeated in Room posts, plus `_tmp-*` drafts in `agent-comms/`, plus `_staging` (247 MB). The hashes are genuinely valuable — the takeover report's independent re-verification of twelve claimed hashes is exactly the kind of check that catches a false completion. What is excessive is that the *same* evidence is written in three places (a file, a Room body, and a report) by hand. One `evidence/<date>/<task-id>/` convention with a manifest, referenced by path from Room, removes the duplication without removing a single hash.

---

## Prioritised assessment

### KEEP — essential, cost already proportionate
- Hash-chained Room ledger, identity leases, authority policy, reviewer separation (2,816 lines total)
- `AGENTS.md` as the single binding instruction file
- Structured-metadata *requirements* (subject / action-required / task / action)
- Herdr broker (14 MB, 0.3% CPU)
- Config-driven lifecycle health contracts and dependency order (`lifecycle.config.json`)
- Append-only PM history with immutability triggers; the gated review/verification/acceptance chain
- Honesty states (OK/STALE/DRIFT/UNAVAILABLE) — they cost nothing and caught the current outage correctly

### SIMPLIFY — valuable control, excessive execution
| | Change | Measured basis |
|---|---|---|
| S1 | Cache `/api/surface` + `/api/building` on source `(size, mtime)`; ETag/304; cheap `/api/health` | 2.1–2.8 s × 4/min → ~0; removes the false UNREACHABLE banner (4,000 ms abort vs 2.7 s build) |
| S2 | Incremental/offset ledger reads; `room.mjs --tail N` | 458 ms / 168 MB per full read, growing linearly |
| S3 | ACK/readiness as metadata state transitions, not feed messages | 824 of last 2,000 events (41%) |
| S4 | Derived `room-state.json` (open tasks, assignees, live leases, head seq) | collapses the 5-step pre-message preamble |
| S5 | Session binding recorded once in `sessions.json`, not re-derived | startup gate re-runs per session |
| S6 | PID file at spawn instead of command-line child identification | `CommandLine` empty for 6 live node PIDs → `STOP_INCOMPLETE` |
| S7 | Paginate `/api/work-packages` | 13.4 MB per call |
| S8 | Make `npm test` safe and path-independent | 21/63 files failing; suite unrunnable today |
| S9 | One evidence convention, referenced not re-typed | 219 MB + 38 `_tmp-*` + duplicated hash tables |

### MERGE — overlapping responsibilities
- **M1.** Three PM stores → one. `pm-board.db` (4 rows, in use) / `pm-operating.db` (1,308 rows, not in use) / `control-plane.db` (0 rows, incompatible schema).
- **M2.** Six HTTP origins → three (read projection · write/domain · agent runtime).
- **M3.** Six-layer start chain → `.bat` → one owner process.
- **M4.** Nine `starq-command` trees → one canonical plus an archive root.

### REMOVE — redundant or obsolete
- **R1.** The two non-binding 1,000-line SOPs → `Archives/`.
- **R2.** `recovered/` (1.63 GB, untracked, **not gitignored**) → outside the product directory; gitignore it meanwhile.
- **R3.** Two stale worktrees (`migration-review-ab055e7`, `room-dispatcher`, idle since 17 Oct).
- **R4.** 62.7 MB of `room.jsonl.*.bak` beside the live ledger → archive root.
- **R5.** 38 `_tmp-*` files in `agent-comms/` root.
- **R6.** `Interface version discrepancy.zip` (2.9 MB), `dist-observation*/`, duplicate baselines in the product directory.
- *Note:* every R item is file hygiene. **No governance mechanism is recommended for removal.**

### MEASURE FIRST — suspected, not demonstrated
- **F1.** JobGuardian: count prevented runaways vs blocked restarts before touching it.
- **F2.** Agent-harness memory: 13 `claude` processes at 1.4 GB total, on a machine with 2 GB free — is that concurrency intentional?
- **F3.** Watcher multiplication: 1 active today, 3 types supported. Measure before adding more; at 3 watchers the per-message re-parse triples.
- **F4.** Whether the 2 s watcher poll ever misses an append between `statSync` ticks under load.
- **F5.** Actual human time per ACK cycle — the token cost is measured, the wall-clock cost is not.

---

## Lean architecture for this laptop

Preserving every guarantee, removing the repetition:

```
ONE instruction file          AGENTS.md (binding) · everything else archived
ONE ledger, two faces         room.jsonl (archive, append-only, hash-chained)
                              room-state.json (derived working set: open tasks,
                              assignees, live leases, head sequence)
ONE domain database           command.db — projects, tasks, org, control-plane,
                              one schema, append-only history preserved
THREE services                :5177 read projection (cached, ETag)
                              :5176 domain/write
                              :5179 agent runtime (herdr + control plane)
ONE supervisor layer          Start-Starq.bat -> owner.mjs, PID files at spawn
ACKs                          metadata transitions, not feed messages
EVIDENCE                      evidence/<date>/<task-id>/ + manifest, referenced
```

Expected effect, from the measured figures: dashboard steady-state cost **~18% of a core → near zero**; message-drafting preamble **5 tool calls / 170 MB → 1 file read**; Room feed volume **−40%** at identical governance; services **6 → 3**; stores **3 → 1**; the spurious UNREACHABLE banner gone; and lifecycle recycle that actually works. None of this weakens a control — S1–S9 change *frequency and representation*, not *rules*.

### Laptop now vs enterprise later

| | This laptop | Future company superapp |
|---|---|---|
| Ledger | single JSONL + derived state file | append-only store with a real index; JSONL as export |
| Identity | lease file, handle-level, no auth | per-user auth; lease becomes a session claim |
| Services | 3 loopback node processes | same boundaries, containerised and separately scalable |
| Projection | cached in-process | materialised views, invalidated by event |
| Watchers | 1, offset-based | event bus |
| Containment | PID files + job objects | orchestrator-level |
| Evidence | directory + manifest | content-addressed store |

The boundaries that matter for scale — read projection vs domain writes vs agent runtime, append-only history, verifier separation, evidence by hash — are **the same in both columns**. Nothing recommended here forecloses the enterprise shape; the merges move *toward* it, because three well-separated services scale and six accidental ones do not.

---

## The five highest-value changes

1. **Cache the projections.** `/api/surface` and `/api/building` keyed on source `(size, mtime)`, with ETag/304 and a cheap `/api/health`. Removes ~18% of a core of continuous waste **and** the false "DATA SERVICE UNREACHABLE" banner currently on screen. Smallest change, largest measured effect.
2. **Give the Room a cheap read: `--tail N` plus a derived `room-state.json`.** Turns a 458 ms / 168 MB full parse into a file read, for every agent, on every message. This is the direct answer to why drafting one message cost five tool calls.
3. **Make acknowledgement a state transition rather than a message.** Removes ~41% of Room traffic — and the matching context cost on every agent — while *strengthening* task-state accuracy, because the status becomes structural instead of narrated.
4. **Collapse to one domain database and make the running service match the working tree.** Right now the data is in `pm-operating.db` (1,308 tasks) and the service is reading `pm-board.db` (4 tasks). This is a correctness problem today, not an efficiency one.
5. **Fix child identification with PID files, then get one clean six-service recycle.** `Win32_Process.CommandLine` is empty for the live node PIDs; that single fact is why stop fails, why recovery needs elevation, and why "reboot" is the current remedy.

**What is deliberately not on this list:** removing a governance mechanism. The measurement does not support it. The protocol is 2,816 lines, the instruction file is 103, and together they consume a fraction of a percent of this machine. The overhead is in **repetition, duplication and uncached derivation** — and all five changes above attack exactly that, leaving every rule intact.
