# STARQ // COMMAND

**The permanent Founder operating surface for Starq Dev Studio.**

> A **DERIVED_PROJECTION** of canonical Starq truth. It is not an SSOT. Where
> Command disagrees with a canonical source, the canonical source wins and
> Command is drift. This is stated in the product footer, in the data
> contract, and in the API response headers — not just in this file.

> **Documentation status (03 Oct 2026).** Command OS is Starq's company/agent operating
> system and the sole active engineering project. It runs the organization, not merely the
> DevOps floor (corporate library
> [`05_COMMAND_OS_CANONICAL_DEFINITION.md`](../../corporate-library/STARQ_CANONICAL_CORPORATE_LIBRARY_2026-10-03/05_COMMAND_OS_CANONICAL_DEFINITION.md)).
> The phase list below is the record as of 29 Sep 2026; for Phase 7 see the `PHASE7_*.md`
> records. The **Launch** section further down is historical, and the supported start/stop
> path is described there. See [`00_STARQ_HQ/DOCUMENTATION_INDEX.md`](../../DOCUMENTATION_INDEX.md).

**Phase 1 — BUILDING SHELL. Complete.**
**Phase 2 — TRUTH & HEALTH FLOOR. Complete.**
**Phase 3 — DEV STUDIO FLOOR. Complete.** (Founder-authorised 29 Sep 2026)
**Phase 4 — ERP PROCESS FLOOR. Complete.** (Founder-authorised 29 Sep 2026, base `3487fd7`)
**Phase 5 — FOUNDER ATTENTION. Complete.** (Founder-authorised 29 Sep 2026, base `38037d5`; declared exceptions only)

Phases 6–7 are not authorised and are not implemented. The not-yet-authorised
shell registry is therefore **empty** rather than populated with a Phase 6
placeholder: there is no later surface to describe, and an empty registry is what
makes "no phase beyond 5" a structural guarantee rather than a convention. The
`PhaseShell` component is retained so a future phase has something to render
into.

---

## Launch

> **Current supported path (03 Oct 2026):** `D:\StarqTech\Start-Starq.bat` and
> `Stop-Starq.bat`, which call `scripts/command-lifecycle.mjs`. They are documented in
> [`STARQ_LIFECYCLE.md`](../starq-lifecycle/STARQ_LIFECYCLE.md). That lifecycle is a **review
> candidate, not yet independently accepted**, and live use is not yet authorized.
>
> **The instructions below are historical (pre-root-cutover) and preserved verbatim.**
> - They `cd` into `D:\!starq`, which is now read-only history.
> - They start only two processes.
> - They describe port overrides (`COMMAND_PORT`, `COMMAND_DATA_SERVICE`), which the canonical
>   lifecycle owner now refuses.
>
> Do not use them to run the canonical workspace.

```bash
cd D:\!starq\00_STARQ_HQ\operations\starq-command
npm install
npm run dev
```

Then open **http://localhost:5173** (or `#truth` to land straight on the floor).

Production build:

```bash
npm run build     # tsc -b && vite build
npm start         # data service + vite preview on :4173
```

`npm run dev` starts two local processes:

| Process | Port | Role |
|---|---|---|
| data service (`server/data-service.mjs`) | 5177 | read-only canonical source access |
| Vite UI | 5173 | desktop-first shell, proxies `/api` → 5177 |

Ports are overridable via `COMMAND_PORT` and `COMMAND_DATA_SERVICE`.

## Verify

```bash
npm test          # 381 tests across 11 files
npm run typecheck # tsc --noEmit
npm run build
```

The test count above is the **measured** figure from `npm test` on this tree, not
a remembered one. It was 138 at the accepted Phase 2 commit; Phase 3 added
`tests/phase3.test.ts` and `tests/floor-render.test.tsx` (226 at base `3487fd7`);
Phase 4 added `tests/phase4.test.ts` (37) and `tests/process-render.test.tsx`
(17) and inverted two Phase 3 guards, giving 280; Phase 5 added
`tests/phase5.test.ts` and `tests/attention-render.test.tsx` and inverted the
Phase 5 guards in three earlier files, giving 381. Three earlier revisions of
this file claimed 130, then 222, then 280-when-the-suite-said-288; all were
wrong at the time they were written — the number had drifted from the suite
every time.

`npm run typecheck` is the pure no-emit check and is the one to trust. It was
previously `tsc -b --noEmit false --emitDeclarationOnly false`, which
contradicted its own tsconfig and exited 1 with TS5096. Fixed in Phase 2.

---

## What it consumes

Read-only. Every value below is forwarded verbatim from a canonical projection.

| Truth | Source | Consumed for |
|---|---|---|
| **Process truth** | `00_STARQ_HQ/operations/starqerp-control-board/contract.json` | 5 families, 49 stage classifications, gaps G1–G8, hold state, discrepancies D1–D3 |
| **Execution truth** | `.../activity.json` + `agent-comms/room.jsonl` | agents, events, conflicts, ledger freshness |
| **Work truth** | `.../command_work_model.json` | L1–L4 maturity, work-state counts, corrective lineage |
| **Ledger integrity** | `agent-comms/protocol/v1/ledger-epoch.json` + `ledger-epoch.mjs` | current-epoch verdict, frozen historical epochs |
| **Control-plane health** | `agent-comms/protocol/v1/health.mjs` | reachability of the canonical health model |
| **Identity** | `agent-comms/protocol/v1/identities.json` | canonical identity presentation |
| **Staff** | `agent-comms/protocol/v1/staff-state.json` | evidence-cited duty state |

The Building origin has a deliberately narrow continuity bridge to the preserved
company corpus: four task JSON files under `D:\!starq\starqNexus\data` and seven
Hoadha operating documents under `D:\!starq\03_PROJECTS\hoadha\HOADHA_DEV_STUDIO`.
It reads those named files only, emits their hashes and availability state, and
never imports Nexus code, redirects the Command workspace, writes to the source,
or imports tasks into the PM database. The bridge is served only by the separate
read-only Building origin, including `/api/building/raw?path=` for the same closed
allowlist; frozen `data-service.mjs` remains untouched.

---

# Phase 2 — the Truth & Health floor

## The question it answers

Phase 1 proved the data is real. Phase 2 asks the question Phase 1 deliberately
did not: **is the system serving that data healthy?**

> **A green projection is NOT a green control plane.**

A projection can be perfectly in sync with its source while the runtime serving
it cannot verify the ledger, cannot run its own gates, and cannot reach half of
its declared inputs. `health` (Phase 1) reports whether data matches source.
`health_floor` (Phase 2) reports whether the machine can be trusted to have read
it. They are attached side by side and **never merged** — folding them together
would change a proven Phase 1 contract and destroy the distinction.

## Seven states, one vocabulary

`OK · FAIL · STALE · DRIFT · UNAVAILABLE · UNREADABLE · UNKNOWN`

These are **control-plane** states, deliberately a different vocabulary from the
process-stage states. An ERP stage can be `absent` while the ledger is `OK`;
both are true, and they get different chips.

| State | Means | What it does **not** mean |
|---|---|---|
| `UNAVAILABLE` | could not be reached | says nothing about whether it would have agreed |
| `UNKNOWN` | never assessed | **not a pass, and not a failure** — nobody checked |
| `STALE` | read, source has moved since | not wrong, just old |
| `DRIFT` | disagrees with declared provenance | not the same as unreachable |

The aggregate orders `UNAVAILABLE > UNREADABLE > FAIL > DRIFT > STALE > UNKNOWN > OK`,
so an unreadable source outranks a drifted one (you cannot judge truth against
something you cannot read) and `UNKNOWN` can never be ranked as healthy.

The floor also renders a permanent **state legend**, so a state that happens not
to occur today is still legible when it does. A vocabulary the Founder can only
decode at the moment it fires will be misread at exactly the moment it matters.

## Four separations the floor enforces

1. **Current health vs preserved history.** Two separate arrays.
   `preserved_historical` holds frozen epochs that are `immutable: true` and
   `affects_current_verdict: false`. Epoch-1's integrity failure (seq 8304)
   stays visible forever and never reddens the present — and a green present
   never reads as having forgiven it.

2. **A blocked tool is not an unavailable truth.** `health.mjs` cannot execute
   on native Windows Node (bare absolute dynamic import at lines 64 and 90 →
   `ERR_UNSUPPORTED_ESM_URL_SCHEME`). The floor reports the **tool** as
   `UNAVAILABLE` and separately reports that the integrity **truth** beneath it
   is reachable and verified, because Command imports `ledger-epoch.mjs` itself
   via a `file://` URL and reports what *it* concludes.

3. **Source-fixed ≠ runtime-fixed.** Every carried issue declares a `locus` and
   cites the canonical file that proves it:

   | Issue | Locus | Meaning |
   |---|---|---|
   | `health.mjs` Windows ESM | `SOURCE` | defect is in canonical code; fixing this machine changes nothing |
   | Epoch-1 seq 8304 | `SOURCE_FIXED_RECORD_PRESERVED` | cause was fixed; the failed record is preserved on purpose |
   | `on-behalf-of` lease bypass | `NONE` | open — no source fix, no runtime compensation |
   | destructive guard | `RUNTIME` | canonical code is sound; Command declines to probe it |

4. **Unknown ≠ unassessed-and-therefore-fine.** The header shows
   `dimensions_healthy` beside `dimensions_assessed`, so a floor of mostly
   `UNKNOWN` cannot be mistaken for a healthy one.

## Evidence drill-down

Every dimension carries `evidence[]` — workspace-relative canonical paths
openable in place through `/api/raw` (guarded by `path-guard.mjs`). Content is
fetched on demand, never preloaded.

A source too large to inline is reported as **too large, with its real byte
size**. A viewer that quietly served the first 200 KB of a 17 MB ledger would be
worse than one that refuses, because the Founder would read a fragment as the
file.

## Read-only gates

The control board's reconcilers are the canonical gates ("must exit 0").
Command reports their verdict and enforces three rules:

- **Never implicitly.** A gate runs only from an explicit button. An unrun gate
  is `UNKNOWN`, never `PASS`.
- **Closed allowlist only.** `server/gates.mjs` exports exactly two runnable
  scripts. `ingest_room_activity.py` is on a `REFUSED` list with the reason
  recorded: it writes to the control board, and Command is read-only. No code
  path runs a caller-supplied script path.
- **A tool that cannot run is not a failing truth.** If the interpreter cannot
  launch, the result is `UNAVAILABLE` with the interpreter's own error — never
  `DRIFT`, and never a verdict about the company.

## The portable snapshot (architecture only)

`GET /api/snapshot[?scope=full|summary]`

A versioned, self-describing envelope for a future phone client. **No remote
access, no sync, no cloud, no auth changes, no mobile UI.** The local Command
remains authoritative.

| Field | Why it is there |
|---|---|
| `schema_version` | a future client refuses a shape it does not understand rather than guessing |
| `projection_version` | the client can tell *which* truth it is holding |
| `generated_at` | when the local surface was assembled |
| `provenance` | every declared source, with recorded and live digests |
| `freshness` | per-source age and reachability, so no client reimplements a rule |
| `state` | the explicit vocabulary and the aggregate — never a boolean |
| `transport.mode` | `local`, declared in the payload itself |

**Absolute host paths are stripped.** `D:\!starq\...` is a fact about one host,
is useless on another, and leaks local directory structure. Paths under the
workspace are rewritten relative; anything absolute outside it is replaced with
an explicit marker. Enforced by test, not by intention.

`scope=summary` drops only the verbatim event feed — the largest part of the
payload and a scrolling view, not state — and **declares the omission in the
payload** rather than leaving a client to infer it from a missing key.

## Routes

| Route | What it is |
|---|---|
| `GET /api/surface` | the full read-only surface, Phase 1 + Phase 2 |
| `GET /api/health` | projection health + floor summary |
| `GET /api/health-floor` | the health floor alone |
| `GET /api/snapshot?scope=` | the versioned portable envelope |
| `GET /api/gates` | runs the two read-only gates, on request only |
| `GET /api/identity` | resolved identity registry |
| `GET /api/raw?path=` | guarded read of a declared canonical source |

GET and HEAD only. Everything else is refused structurally, not by policy text.

---

# Phase 3 — the Dev Studio Floor

## The question it answers

Phase 1 proved the data is real. Phase 2 asked whether the runtime serving it is
healthy. Phase 3 asks the operational question: **who is on the floor, what does
canonical source say each of them is doing, and what is the evidence that
anything moved at all.**

## Seven separations it enforces

1. **Being is not doing.** `nexus` is `RETIRED` in canonical source and its
   execution state can read `active`. Both are canonical facts. They render in
   separate columns with separate chips, and neither collapses into the other.

2. **The two current-task truths are never merged.** `activity.json` and
   `staff-state.json` both record a current task and they disagree on all 14
   handles carrying both. Command renders both with provenance and raises a
   `TRUTH_DISAGREEMENT` per handle. It does not choose — no algorithm here is
   entitled to adjudicate two canonical sources.

3. **A mention is never an assignment.** The canonical mention index runs to
   186 entries per agent. It is forwarded as a **count**, sits in its own
   column under its own heading, and the id list is never forwarded at all.

4. **No age is recomputed.** `hours_since_last_activity` is frozen at ingest and
   is wrong by exactly the projection's age. The floor renders `last_activity_at`
   beside the projection's own `generated_at`. There is no `Date.now()`,
   `new Date()` or `formatAge` call in the component — asserted by test.

5. **A lease is presence, not activity.** Session state and execution state are
   separate panels, and the lease count is labelled *not a work count*.

6. **Activity is not maturity.** The feed carries `process_family_context` and
   deliberately does **not** carry `process_stage` — it is null on every event in
   the live window, and forwarding it would invite exactly the confusion the
   surface exists to prevent.

7. **Unknown identity stays unknown.** `hermes` appears in the execution ledger
   with no entry in the identity registry. It renders `CONFLICT · UNKNOWN
   IDENTITY`, never a borrowed name.

## The signal filter, measured

An event is shown when it carries at least one of `has_evidence`, `is_blocker`,
`is_handoff`, `needs_founder`. The payload carries its own arithmetic —
`window_total`, `signal_total`, `shown`, `filtered_out`, and **`signal_loss`** —
and the surface renders all five. On the live window `signal_loss` is **0**: the
filter drops chatter and loses no evidence. A machine-generated post carrying
real evidence is never dropped as noise.

## Where the judgement lives

Every count, grouping and filter is applied in `server/floor.mjs` and arrives at
the component as a fact. The React layer renders and computes nothing — no
scoring, no weighting, no percentage, no clock. That is the Phase 1 architecture
guard doing its job: a component one refactor away from *scoring* something is
how a roster silently becomes a maturity board.

## Routes

| Route | What it is |
|---|---|
| `GET /api/surface` | the full read-only surface, Phase 1 + 2 + 3 |
| `GET /api/floor` | the Phase 3 floor payload alone |
| `GET /api/snapshot` | the Phase 2 portable envelope (unchanged) |

---

# Phase 4 — the ERP Process Floor

## The question it answers

What does canonical process truth say about the five business-process families,
stage by stage, and what is the declared blocker on each. That is the
convergence question, and it is different from Phase 2's "is the control plane
healthy" and Phase 3's "who is working on what".

## Zero server changes

Phase 4 needed **no** new server module, route or data contract. Process truth
was already forwarded verbatim by the Phase 1 data service
(`server/data-service.mjs`, `readProcessTruth`), and `/api/surface` already
carries it. The surface is a renderer over a contract that was already proven.

## Seven separations it enforces

1. **Activity is not maturity, and the join key is absent by design.**
   `activity.json` carries a `process_stage` field and it is null on every event
   in the live window. The process surface therefore has no agent column, no
   event count and no work attribution. The absence is the guarantee: nothing
   on the Dev Studio Floor can advance or explain a stage here.

2. **Declared family maturity is prose, not a score.** Canonical source writes
   `critical-path`, `least-complete`, `working-ledger-missing-spine`. These are
   rendered as the words they are — never scored, ranked, sorted on or turned
   into a percentage. A test asserts `maturity` never appears in a comparison
   or a comparator.

3. **Family state is the worst stage, never an average.** One chip per family,
   chosen by the declared severity order that already existed in
   `lib/states.ts` for the Phase 1 overview strip. No arithmetic is performed
   on the states. A mutation test proves that worsening one stage moves exactly
   one family and leaves the other four byte-identical.

4. **`stage.evidence` is not rendered as evidence.** Canonical `evidence[]` is
   generated by regex-scraping backtick spans out of roadmap prose, so its
   entries are a mix of Room sequence numbers with a stray trailing backtick,
   bare filenames, prose fragments and truncated strings. Measured at the
   accepted base: 0 of 37 resolve as a ledger event id, 22 of 49 stages carry
   one, and 20 are the same pointer listed twice.

   **A finding that shaped the tests:** because `evidence[]` is scraped *out of*
   the note, every evidence string is a literal substring of the note on the
   same stage — 26 of 26 distinctive entries. An assertion that those strings
   are absent from the page is therefore unsatisfiable. The guard is
   **positional** instead: the stage table has a note column and no evidence
   column, the note is column-labelled "Canonical note (prose, not proof)", and
   no evidence entry carries a citation affordance. The surface does report
   how many stages carry an entry at all, because that is an honesty
   disclosure, not a citation.

5. **No per-stage reconciliation is rendered.** The five control invariants are
   `not executable - documented intent only` (G3 / SERP-461, planned). The
   surface says so once in the constraints rail rather than drawing a column
   that would imply a reconciled control relationship nobody has executed.

6. **No 13-dimension matrix.** The process-level definition of done names
   thirteen evidence dimensions, but no canonical field records whether any of
   them was proven for any stage. A 49×13 grid would be 637 cells of nothing
   rendered as assurance.

7. **UNKNOWN is not coerced.** No stages, no blocker, an unrecorded state — each
   renders as `UNKNOWN` rather than defaulting to a healthy-looking value. The
   classification legend renders all six declared states including `test-only`
   and `UNKNOWN`, which occur on 0 of 49 stages today, so the vocabulary stays
   legible on the day one of them does.

## What it renders

| Section | Content |
|---|---|
| Honesty rail | the six constraints above, in Founder-readable prose |
| Classification legend | all six declared states with their canonical meanings |
| Five family cards | id, name, headline, declared maturity prose, critical blocker, worst-stage chip, and every stage as a row |
| Stage rows | stage name, canonical state, SERP ref (metadata only), blocked_by, canonical note |
| ERP implementation state | DEC-100 hold, authority, effective date, restart gate conditions, and the 6-entry restart wave stamped NOT AUTHORISED |
| Carried discrepancies | D1/D2/D3 surfaced unresolved, each flagged FOUNDER DECISION |

## Routes

Unchanged. Phase 4 added no route. The process floor renders from
`GET /api/surface` like every other surface.

## What it deliberately does not show

No percentage, no family score, no `n of m` completion figure, no progress bar,
no trend, no agent-to-stage attribution, no per-stage reconciliation, no
13-dimension matrix, and no evidence drill-down. Two of the promises the Phase 4
placeholder shell used to make — "evidence and reconciliation state" — were
narrowed to explicit unavailability statements rather than filled with inferred
or empty data.

---

# Phase 5 — the Founder Attention exceptions board

**Founder-authorised 29 Sep 2026 on base `38037d5`, bounded by the architecture
checkpoint at Room seq 8334.** Declared exceptions only.

## The question it answers

> What explicitly declared conditions currently require Founder awareness or a
> Founder decision?

It does **not** answer "what does the system think the Founder should care
about?" That distinction is the whole design, and it is enforced structurally
rather than by copy.

## Zero server changes

Phase 5 added **no** server module, no route, no data contract and no read-boundary
change. Every field it renders was already forwarded by the Phase 1 assembly. If
a Phase 5 change had needed a server edit, that was the signal the scope had
drifted — the survey established the field set before authorisation.

## Five panels

| Panel | Source of every value |
|---|---|
| Truth-health header | `execution_truth.ledger` hashes, `provenance`, `health_floor` gate states |
| A. Founder decisions required | `reconciliation.known_discrepancies` where `founder_decision_required === true` |
| B. Hold and restart gate | `hold_state`, `work_truth.global_blocker`, `restart_wave_after_authorization` |
| C. Declared process blockers | `families[].critical_blocker`, `stages[].blocked_by`, `corrective_tasks` |
| D. Integrity and conflict exceptions | `floor.constraints`, `execution_truth.conflicts`, `provenance` |

The header is **context, not an item**: it declares the STALE execution state
and the NOT-ASSESSED gate verdicts above the data, and it never adds, removes or
ranks a row.

## The measurement that decided this phase

At the `38037d5` base, `needs_founder` is `true` on **228 of the 400** events in
the live window. All 228 bodies were retrieved from the append-only ledger by
`event_id`; only **37 (16.2%)** contain any decision-request shape, and **191**
are STATUS / ACK / SITREP posts that merely carry the Founder on a Cc line. The
flag is a regex over message text, not a decision channel.

So the surface never reads `activity_events`, `needs_founder`, `is_blocker`,
`is_handoff`, `has_evidence` or any event count. A test floods execution truth
with 400 additional `needs_founder=true` events and asserts every declared-exception
row is byte-identical.

## What the B1–B5 rulings removed from the original shell

| Original promise | Ruling | What replaced it |
|---|---|---|
| "What changed since the Founder last looked" | B2 | Dropped. No trustworthy canonical viewed watermark exists; `cursors/ali.json` is stale and outside the read-only surface. |
| "An evidence drawer with provenance" | B1 | Dropped. The ledger is 17 MB against an 8 MB `/api/raw` cap. No route was added or widened. |
| "Release and verification state" | — | Dropped. No canonical release artefact exists. Gate and provenance state is already live on Truth & Health. |
| "A concise daily operational picture" | B5 | Dropped. This is a current snapshot, not a digest. |
| "A decision waiting days is a different problem from one waiting hours" | B4 | Dropped. No canonical open-decision timestamp exists, so an age would be arithmetic against an invented baseline. |

## What it deliberately does not show

No ranking, no priority, no urgency, no score, no percentage, no progress bar,
no agent vote or consensus, no "since you last looked", no daily framing, no age
buckets, no ledger-body drill-down, and no attention derived from message text,
event volume or activity frequency. Groups are ordered by declaration, never by
importance, and `family.maturity` is never read — it is prose, and reading it
would be one step away from sorting on it.

`activity.process_stage` is null on 400 of 400 events. That absence is the
maturity firewall, and Phase 5 preserves it by never reading the field. Two
canonical sources disagree on the current task of 14 handles; both values render
with their source named and the disagreement is itself the finding.

## Non-vacuity

Every acceptance proof is mutation-tested. Reintroducing the defect makes named
assertions fail while the rest of the suite stays green:

| Mutation | Tests that fired |
|---|---|
| `needs_founder` wired into the decision panel | 10 (371 unaffected passed) |
| `live: false` + shell entry restored | 8, across three guard files independently |
| truthy filter instead of `=== true` | 3 |
| stage blocker inferred from execution activity | 3 |
| Phase 6 nav entry + route added | 4, across three guard files independently |

---

## The four honesty states

These are structural, not cosmetic. Every surface renders through them.

| State | Meaning | What Command does |
|---|---|---|
| `OK` | projection agrees with its canonical sources | render |
| `STALE` | reachable, but older than its source | **render, loudly labelled** — hiding it would be worse |
| `DRIFT` | the projection disagrees with its provenance | render with a DRIFT banner; canonical source wins |
| `UNAVAILABLE` | canonical truth cannot be reached | say so; **never** render an empty-but-healthy surface |

All four are behaviourally verified, not asserted. UNKNOWN is a fifth value,
distinct from all of them: it means *the source itself records no value*.

The worst condition wins the aggregate verdict — unreachable outranks drifted,
because you cannot judge truth against something you cannot read. There is
deliberately no aggregate that can mask a failing dimension.

---

## Architectural rules, enforced by tests

`tests/architecture.test.ts` and `tests/phase2.test.ts` fail the build if any of
these regress:

**Phase 1**

1. **No writes.** No `writeFileSync` / `unlink` / `mkdir` / `rm` anywhere in
   `server/`. Only `GET`/`HEAD` are served.
2. **No maturity computation in React.** No stage caps, stage weights, family
   weights or control gates in the UI layer. L1–L4 are forwarded verbatim.
3. **No averaging of stage states.** Colour by worst stage, never by mean.
4. **No task-count maturity.** L1 is always labelled informational-only.
5. **No Nexus import or dependency.**
6. **Identity resolved from the registry**, never hardcoded. `mustarq` is
   canonical; `ali` is flagged legacy. No fresh `@ali` presentation.
7. **No hidden truth in UI state.** No hardcoded operational fixture data.
8. **Hold banner is non-dismissible** and present on every surface.

**Phase 2**

9.  **The floor is never merged into `health`.** Phase 1's four-condition
    contract is unchanged, and `buildSurface()` stays synchronous.
10. **No unassessed dimension counted as healthy.**
11. **No frozen epoch in the current verdict.**
12. **Every carried issue cites a canonical source.**
13. **No secret material and no absolute path in the snapshot.**
14. **Snapshot is JSON round-trip stable** and versioned.
15. **No outbound transport, no auth header, no write** in the Phase 2 server.
16. **The floor actually renders** — `tests/render.test.tsx` server-renders the
    real assembled payload and asserts the states, the fences and the cited
    numbers reach the screen.

**Phase 5** — `tests/phase5.test.ts` and `tests/attention-render.test.tsx`

17. **No attention is derived from activity.** The surface reads neither
    `activity_events` nor `needs_founder`, `is_blocker`, `is_handoff` or
    `has_evidence`, and counts no event. A 400-event `needs_founder` flood leaves
    every declared-exception row byte-identical.
18. **Only `founder_decision_required === true` reaches the decision panel** —
    a strict comparison, so the string `"false"` cannot qualify. Removing the
    flag from an item removes its row.
19. **No clock and no age.** No `Date.now()`, no `new Date()`, no timestamp
    subtraction. No Founder cursor or viewed watermark is read.
20. **No ranking, score or percentage.** No `.sort()`, no `priority`/`urgency`/
    `weight` identifier, no `family.maturity` read.
21. **No evidence drill-down.** No `/api/raw` reference, no `EvidencePeek`, no
    ledger body, and `stage.evidence[]` is never read.
22. **Zero server and read-boundary change.** No Phase 5 server module, no new
    route, `read_only_sources` and the 8 MB cap untouched.
23. **No phase beyond 5.** The not-yet-authorised registry is empty, no Phase 6
    file exists, and the nav cannot declare a phase that does not exist.

`tests/contracts.test.ts` and `tests/phase2.test.ts` run against the **live**
workspace, so if canonical projections move or vanish, the suite fails. That is
the point.

---

## Layout

```
server/
  paths.mjs              canonical source resolution (STARQ_WORKSPACE → app ancestry)
  path-guard.mjs         read-only path containment (the seq-8316 corrective)
  data-service.mjs       read-only assembly, freshness/drift, HTTP
  health-floor.mjs       Phase 2 — reachability, ledger integrity, tool health
  gates.mjs              Phase 2 — allowlisted read-only gate runner
  snapshot.mjs           Phase 2 — versioned portable envelope, path redaction
  floor.mjs              Phase 3 — roster/feed assembly (pure; no filesystem)
  (no Phase 4 or Phase 5 server module — both phases' fields were already forwarded)
src/
  lib/contracts.ts       types mirroring canonical shapes (loose where source says UNKNOWN)
  lib/use-command-surface.ts   the single read boundary; carries honesty states
  lib/states.ts          one vocabulary per layer: surface · stage · dimension · fix locus · staff class
  components/state-gate.tsx    the honesty boundary (load/unavailable/stale/drift/hold)
  components/evidence-peek.tsx Phase 2 — on-demand canonical evidence drill-down
  components/shell.tsx   rail + top bar + navigation architecture
  components/ui/         shadcn-based primitives on Starq tokens
  surfaces/              overview · truth (Phase 2) · floor (Phase 3) · process (Phase 4) ·
                         attention (Phase 5) · evidence · system · phase shell component
tests/                   architecture guards · live contract tests · Phases 2-5 · render
```

The data service is the **only** code that touches the filesystem. React never
reads a canonical file directly, so the read-only boundary is one place, and it
is testable.

---

## Known limitations, stated honestly

1. **No authentication on `/api/*`.** Any local process or browser page on this
   machine can read the declared surface without proving who it is. Carried
   forward from Phase 1, unchanged, and explicitly out of Phase 2's scope. It is
   a Founder authorisation decision, not a defect.

2. **`health.mjs` cannot execute on native Windows Node.** Lines 64 and 90
   dynamic-import a bare absolute path, which the ESM loader rejects. The health
   *tool* is environment-blocked; the health *truth* is sound and is reported
   independently by importing the module the tool itself depends on. **Command
   did not modify the canonical tool** — the fix belongs in the protocol module,
   and the floor says so with a citation.

3. **The destructive-action guard is installed but unproven here.** Proving it
   works means attempting `git reset --hard`. Command reports install state and
   refuses to claim a pass it did not observe.

4. **Execution truth is STALE until regenerated.** `room.jsonl` has moved past
   the last ingest. Command says so and names the regeneration step. It does not
   re-ingest, because the ingester writes to the control board.

---

## What is intentionally deferred

- **Phase 6** Controlled actions — no control plane, no writes, by design
- **Phase 7** Hardening, accessibility, performance, release evidence

And, per the Phase 2, Phase 3, Phase 4 and Phase 5 authorisations: no mobile UI,
no remote sync, no remote writes, no cloud access, no authentication redesign,
no avatar-serving, no provider health (no canonical field carries one), no
handoff ledger (canonical source records an `is_handoff` flag only). The snapshot
**shape** is ready; the transport is not built and is not authorised.

Deferred from Phase 4 specifically, by Founder ruling: evidence drill-down
(`stage.evidence` is generator-derived metadata, not a citation contract),
repair of `generate_control_board.py`, any widening of `/api/raw` or
`read_only_sources` to `starqERP`/`starqNexus`, any join between process
stages and execution activity, per-stage reconciliation state, and the
13-dimension per-stage evidence matrix.

Deferred from Phase 5 specifically, by Founder ruling B1–B5:

- **A Founder-viewed watermark.** No "since you last looked" until a canonical
  one exists. Adding it is a canonical-source decision, not a UI decision.
- **A ledger-body evidence route.** No slice endpoint, no cap raise, no
  `read_only_sources` widening. The ledger is 17 MB against an 8 MB cap.
- **A canonical decision-request record type.** Until one exists, attention is
  limited to discrepancies that already carry `founder_decision_required=true`.
  The `needs_founder` regex is explicitly not a substitute.
- **Age or waiting-time on a decision.** Requires a canonical open-decision
  timestamp. No React-side age arithmetic is permitted.
- **A day boundary or timezone convention.** No daily digest is possible until
  one is declared.
- **Release and deployment state.** No canonical release artefact exists.
- **A repair of the `needs_founder` ingester rule.** The defect is in
  `ingest_room_activity.py`; fixing it is a canonical write, out of scope here.
