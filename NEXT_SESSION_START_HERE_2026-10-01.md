# NEXT SESSION START HERE — STARQ // COMMAND

Written by Vision, 2026-10-01, from Room seq 8410→8424. Read this before touching Command.

## 1. Where the code is

- Repo: `D:\!starq` (git). Command package: `D:\!starq\00_STARQ_HQ\operations\starq-command`
- HEAD: `a67853be14262e28dbc4fa93b35d9f7e84f9c3e5`
  `fix(starq-command): post-8416 Founder corrective pass — footer, Evidence, dedup`
  Parent: `6633f59` Founder acceptance polish wave. Grandparent: `1e993b2` final visual/responsive wave.
- Working tree: **clean for Command.** The only entry under the Command path is untracked:
  `evidence/vision-visual/` — 261 PNG/JSON files, 37 MB, from earlier probe sweeps. Not gitignored.
  My probes this session were written to scratch, NOT into the repo.
- `npx tsc --noEmit` → clean (exit 0).
- `npx vitest run` → **639/639 pass, 22 files, ~17 s.**

## 2. How to actually start it (this is the trap)

`npm run command:start` reaches READY and then **its children die with the invoking shell.**
Reproduced three times: readiness passes, ports 5173/5177/5178 refuse connections seconds later.
The state file still says `state: READY, ready_at: <ts>` with three dead PIDs, so
`command:status` reports a stale-but-confident READY. This is a real gap, not an artefact of
my probe. See gap G3.

What works right now — three separate background processes:

```
cd D:\!starq\00_STARQ_HQ\operations\starq-command
node server/data-service.mjs            # 5177  READ-ONLY data service
node server/building-service.mjs        # 5178  READ-ONLY building projection
npx vite --host 127.0.0.1 --port 5173   # 5173  UI
```

Verify before trusting anything:
```
curl -s http://127.0.0.1:5177/api/health        # 200
curl -s http://127.0.0.1:5178/api/building/health  # 200
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/   # 200
```

**Workspace:** `STARQ_WORKSPACE` unset resolves via `app-ancestry` to `D:\!starq` — correct.
The launcher's own default is `D:\StarqTech`, which is the *same directory* (verified with
`os.path.samefile` → True, identical STARQ.md sha256). Not a mismatch. Do not "fix" it.

## 3. What the surface is

Hash routes (`src/lib/building-route.ts` is the single source of route truth):

| Founder surface | route | peer tabs |
|---|---|---|
| Overview | `#overview` | — |
| Founder Attention | `#attention/<tab>` | decisions, exceptions, conflicts, holds, history |
| Evidence | `#evidence/<tab>` | sources, projection, decisions, rooms, hashes |
| System | `#system/<tab>` | health, runtime, sources, contracts, projection |
| Building | `#building` | — |
| Rooms | `#studio/erp/<tab>` · `#studio/hoadha/<tab>` | 7 tabs each |

## 4. Verified baseline — this is the state a new session can trust

Sweep: 7 routes × 7 viewports (1440x900, 1280x800, 1024x768, 1023x768, 1025x768, 768x1024, 430x932)
= 49 cases. Chrome over CDP, cache disabled, root `#command-main`.

- **notRendered = 0** — every case asserted real content, so none of this is a dead-server artefact.
- **pageOverflowX = 0, elements past viewport edge = 0, nested horizontal scrollers = 0**
  at every viewport including 430. No horizontal overflow anywhere.
- pageErrors = 0. Heading hierarchy consistent. H1 25px desktop / 15px at 430 — the only
  type-scale change, and it is inside a media query, so the breakpoint series is even.
- Narrow-width nav works: `Expand navigation` → 8–9 visible links → `Collapse navigation`.
- Fold position: first real content at 32–40% of fold on desktop, 46–54% at 430. No surface
  reports clean overflow while burying its first record.

Evidence source viewer, measured by clicking each of the 6 rows:

| source | renders | note |
|---|---|---|
| onboarding | YES | Markdown rendered 8,266 chars; raw toggle → 8,487-char `<pre>` → toggles back. **Works.** |
| decisions | YES | Structured, 200,000 chars in viewer |
| doctrine | no | 403 from read guard |
| roadmap | no | 403 from read guard |
| supersession | no | 403 from read guard |
| task_board | no | 403 from read guard |

- **Copy works.** With clipboard permission granted and the page focused, Copy on onboarding
  yielded 8,661 bytes to `navigator.clipboard.readText()`. Verified, not assumed.
- The 403s are the frozen read guard working. `read_only_sources` is 6 paths
  (`data-service.mjs:569`); the 4 refused sources are outside it. The refusal text on the
  surface says exactly this and is honest. **Not a defect. Do not widen the allowlist.**

## 5. Genuine remaining gaps — ranked by cost to the Founder

**G1 — Overview "Recent activity" shows the OLDEST 4 events, not the newest.**
`src/surfaces/company.tsx:87`
```ts
const activity = (surface.execution_truth.activity_events ?? []).slice(0, 4);
```
`activity_events` is ascending by `broker_sequence` (7941…8344, 400 records, no dup seqs).
`.slice(0,4)` therefore returns seq 7941–7944 (2026-09-28) under a heading that says
*Recent activity*. Correct output is `.slice(-4)` or a descending sort: seq 8341–8344,
2026-09-29, all `vision`. One-line fix. **This is the highest-value defect on the surface —
the Founder's activity panel is three days stale and labelled as current.**
Pre-existing: identical line at `a67853b~1`. Not introduced by the corrective pass.

**G2 — Evidence viewer silently truncates at 200,000 chars with no disclosure, and Copy copies the truncated bytes.**
`src/surfaces/evidence.tsx:137` slices `res.body.slice(0, 200_000)`. Measured on
`decisions.json`: true file 267,887 bytes; viewer showed 200,000; the header read
`Structured · 200,000 chars` — presenting the cap as the file's size. **Copy returned
201,455 bytes of a 267,887-byte file.** The disclosure pattern already exists in this codebase:
`src/components/evidence-peek.tsx:111-117` renders "Display truncated at X of Y characters
for display only — the file on disk is unmodified and complete." EvidencePeek does it right;
SourceViewer does not. Reuse that pattern.
Pre-existing: identical at `a67853b~1`.

**G3 — `command:start` reports READY, then every child dies with the invoking shell.**
`scripts/command-lifecycle.mjs`. `spawnOwned` (line 49) does not set `detached: true`, so
children are bound to the launcher's job and die with it. `saveState` at line 159 persists
`READY` + `ready_at` before that happens, and nothing ever re-checks liveness, so
`command:status` serves a confident stale READY with three dead PIDs. The surface's own
System → Runtime does NOT read this file (the read guard correctly refuses it — it is not a
declared canonical source), so System → Runtime honestly reports
`Launcher state: UNKNOWN — launcher has not run`. The launcher lying is invisible from the UI.
Fixing G3 is a launcher-lifetime change, not a UI change — flagging, not fixing.

**G4 — Founder Attention / Decisions repeats section headers per record: 286 lines, 46 records.**
`C. Declared process blockers` ×18, `D. Integrity and conflict exceptions` ×17,
`B. Hold and restart gate` ×8, `state planned` ×8, `NOT AUTHORISED` ×7, each on its own
`span.v`. This is a per-record category label, not a duplicated narrative — I checked the
element shape and it is one leaf span per record, so it is arguably by design. Ranked last
precisely because it is the one finding I am least sure is a defect. Judge it before touching it.

## 6. Duplicated-state check — clean

Token census per route, and repeated-line detection on `innerText`:
no route returns two competing narratives for the same fact. The repeats that exist are
(a) hash prefixes shown twice on purpose (Recorded hash / Live hash),
(b) `executionTruth` named once as a dimension and once in the degradation drill-down,
(c) G4's per-record labels. The `STALE` banner is stated once and its reason once, on
`system/health`, as a drill-down — that is disclosure, not duplication.

## 7. Current truth the surface is reporting (and it is correct)

- Projection **STALE**, 3/4 dimensions in sync. `executionTruth` STALE because
  `room.jsonl` live sha `a262c7edfc016137` ≠ recorded `8c6836b3ed017aca`. I re-hashed the
  ledger independently: 8,629 physical lines, 8,350 broker envelopes, max seq **8344 recorded
  by the ingest** vs **8424 live**. The surface is telling the truth: the projection has not
  been regenerated since 2026-09-30T06:18:50Z. **The staleness is real and is the single most
  material fact about Command right now.**
- `Building sources 11/11`, all AVAILABLE. ERP `ON_HOLD`, Hoadha `PREPARED / NOT STARTED`,
  capacity `UNKNOWN` with a declared reason (correct — session presence is not quota).
- Authority `DERIVED_PROJECTION`, access `READ_ONLY`, contract `2.0.0`,
  status `PERMANENT_OPERATING_SURFACE`. Authority/projection status was readable on every
  surface checked, including a collapsed `DERIVED_PROJECTION` disclosure in the shell.

## 8. Exact first recommended next action after reset

Fix **G1** — one line, `company.tsx:87`, `.slice(0, 4)` → take the newest four by
`broker_sequence`. Then re-run the Overview probe and confirm the panel shows
seq 8341–8344 / 2026-09-29. That is the only change on this list that is both unambiguous
and immediately Founder-visible.

Then, in order: **G2** (reuse the EvidencePeek disclosure, and fix the header so the char
count is not the cap wearing a file's name) → **G4** (decide whether it is a defect) →
**G3** (launcher lifetime; needs a Founder call because it touches process ownership).

Do not start Phase 8. Do not touch ERP or Hoadha.

## 9. Discipline notes

- Probe output goes to scratch (`D:\AgentRuntimes\Hermes\profiles\vision\cache\scratch`),
  never into `evidence/` inside the repo. The 37 MB untracked `evidence/vision-visual/` is
  from earlier sessions and should probably be gitignored or deleted — but that is a
  Founder call, not mine.
- `python3` is not on PATH on this box. Use `node -e`, `node script.mjs`, or `uv run python`.
- `/d/!starq/` breaks Node `require()` of paths containing `!`. `cd` first, then run.
- Chrome path for CDP: `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- Clipboard verification needs BOTH `Browser.grantPermissions` AND `Page.bringToFront`,
  otherwise `readText` returns `NotAllowedError: Document is not focused` and a working
  Copy looks broken.
