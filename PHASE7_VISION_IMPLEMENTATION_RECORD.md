# Phase 7 — implementation record, @vision, 2026-09-30

Branch: `vision/phase7-completion`
Base: `78166ab` (`codex/phase7-ux-wave-a` tip) — the preserved Wave A work.
Worktree: `D:/!starq/worktrees/vision-phase7-completion`
Mission: Room seq 8362. Governing decisions: seq 8358, seq 8361.

## What this round actually changed, and why

The preserved Wave A work violated a governing decision.

Commit `62ee760` attached the Building/Hoadha projection to the frozen Phase 5
data service with four added lines:

```js
import { buildBuilding, BUILDING_SOURCES } from './building.mjs';
surface.building = buildBuilding(workspaceRoot, surface);
read_only_sources: [ ...BUILDING_SOURCES, ... ]
```

Room seq 8361 (Founder) is explicit:

> "do not add Hoadha assembly directly into frozen server/data-service.mjs.
>  Hoadha must be exposed through the separate read-only Building/project
>  projection path already established for Phase 7.
>  data-service.mjs remains protected tonight."

So Hoadha was moved onto its own read-only origin, and `data-service.mjs` was
restored byte-for-byte to its frozen digest.

## The separate origin

| File | Role |
|---|---|
| `server/building-service.mjs` | NEW. Own HTTP origin, own port (5178), GET-only, 405 before dispatch, DERIVED_PROJECTION + READ_ONLY stamps. |
| `server/building.mjs` | Unchanged from Wave A. The projection builder. |
| `vite.config.ts` | Routes `/api/building` to 5178; every other `/api` path still goes to the frozen data service. |
| `src/lib/use-command-surface.ts` | `useBuildingProjection()` — a separate, independently-failing fetch. |
| `src/App.tsx` | Attaches the payload to the surface; adds `BuildingOriginBanner`. |

The Building payload is *attached* to the surface rather than replacing it, so a
dead Building origin degrades the two project rooms and nothing else. The last
good projection is retained and marked NOT current, never blanked.

## One real bug found and fixed during verification

`resolveWorkspace()` returns `{ root, source }`, not a string. The first version
of the origin passed the descriptor to the read guard, so every source read
failed. The projection reported this as `UNREADABLE` across all 11 sources
rather than as a healthy empty board — the honesty doctrine working as intended.
Fixed in `buildBuildingProjection()`.

## Verification actually performed

All from the isolated worktree, never the canonical checkout.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS, no diagnostics |
| `npm run build` | PASS, 1610 modules |
| `npx vitest run` | **555 passed / 555**, 18 files, 0 failed |
| P6 control suite (worktree) | **445 / 447** — exactly PART F2 and PART F4 |
| `reconcile_control_board.py` | IN_SYNC, exit 0 |
| `reconcile_activity.py` | IN_SYNC, exit 0 |
| `data-service.mjs` sha256 | `6c390d76…f05b413b` = frozen digest, EXACT |

### Live origin proof (real stack, ports 5277 / 5178 / 4273)

```
/api/surface   has building key : false        <-- frozen service untouched
               read_only_sources: [ 6 Phase 1 sources, no Hoadha ]
               hold              : ON_HOLD
/api/building  origin            : building-projection
               integrity         : SOURCE_READ
               erp               : ON_HOLD
               hoadha            : NOT STARTED / PREPARED
               live / proposed   : 326 / 33
POST /api/surface   -> 405
POST /api/building  -> 405
```

Boards reconcile: hoadha 243/243, hoadha-social 56/56, hoadha-concierge 27/27.

### Mutation proof — the new guards are load-bearing

Re-applying the exact Wave A violation (re-adding the import and
`...BUILDING_SOURCES` to `data-service.mjs`) turns **3 tests red**:

- `phase7-separate-origin` — "data-service.mjs contains no Building or Hoadha assembly"
- `phase3` — "does not widen the declared read-only source list"
- `phase3` — "keeps the Hoadha/Building sources out of the frozen data service entirely"

Reverted, digest re-verified `6c390d76…`, suite back to 555/555.

## Freeze-gate accounting — what F2 and F4 are actually complaining about

`server/data-service.mjs` is now an **exact** working-tree digest match to the
frozen value (`6c390d76…f05b413b`), and its committed blob is git-identical to
`3cd094a`.

Of the twelve frozen Phase 5 files, eleven are content-unchanged:

- **5 exact match on a CRLF checkout**
- **6 differ only by line endings**, and are git-blob-identical to `3cd094a`
- **1 real content change**: `tests/phase5.test.ts`, from Wave A — two
  assertions retargeted from `src/App.tsx` to `src/surfaces/building.tsx`
  because routing moved into the Building router. Intent unchanged, still
  enforced.

F4 fires on the new `server/building.mjs` and `server/building-service.mjs`,
neither of which is in the frozen digest list. That is the gate doing its job.

### ROOT CAUSE FOUND — the freeze manifest is internally inconsistent

This is the part that matters for the authorized refresh, and it is not what the
earlier Wave A investigation concluded. It attributed the mismatch to "a Windows
worktree checkout artefact". That is only half of it.

Each frozen digest was captured in EITHER its LF or its CRLF form, and the
manifest mixes the two:

| Captured as | Files |
|---|---|
| CRLF-form | `server/data-service.mjs`, `server/snapshot.mjs`, `src/surfaces/attention.tsx`, `tests/phase5-fixture.test.tsx`, `tests/fixtures/phase5-surface.json` |
| LF-form | `server/floor.mjs`, `server/gates.mjs`, `server/health-floor.mjs`, `server/path-guard.mjs`, `server/paths.mjs`, `tests/attention-render.test.tsx` |
| neither | `tests/phase5.test.ts` (the real content change) |

**Consequence: PART F2 cannot pass on any machine, in any checkout state, for
the eleven untouched files.** A CRLF checkout satisfies the 5 CRLF-captured
digests and fails the 6 LF-captured ones. An LF checkout does the exact
reverse. There is no third option.

This is a pre-existing defect in the Phase 6 freeze manifest, not a Phase 7
regression and not something this round introduced. It is also why "445/447 until
a later authorized freeze refresh" is the only reachable state: the refresh has
to normalize line endings across the manifest, and until it does, F2 stays red
no matter what Phase 7 does.

I did not touch the manifest. Re-baselining it is a Founder-authorized act and
is explicitly out of scope here.

**No gate was weakened, re-baselined, skipped or refreshed.** Both failures are
left standing exactly as seq 8362 requires.

## Residuals — reported, not hidden

1. **OpenCode F1 (`/api/gates` is a GET that runs scripts) — NOT fixed.** The
   route lives in the frozen `data-service.mjs`. Correcting its semantics would
   mean editing the protected file, which seq 8361 forbids and seq 8362 lists as
   a hard boundary. It cannot be closed without widening scope, so it is
   persisted here as a corrective item for an authorized freeze refresh. The
   existing defences (closed allowlist, explicit button, never on poll,
   structural 405 on non-GET) are unchanged.

2. **Goose #1 (hold-state triple rendered in three surfaces) — not fixed, and
   now in five.** `restart_requires` appears in `attention.tsx`, `erp-room.tsx`,
   `overview.tsx`, `process.tsx` and `truth.tsx`. Wave A added two. This is
   duplicate presentation of one fact and remains a real finding. Fixing it
   means choosing one owner and having the others reference it — a behavioural
   change to accepted surfaces, larger than this round's scope.

3. **Goose #3 (single-weight section labels) — only partly addressed.**
   `label-micro` 62, `text-xs` 60, `text-[10px]` 6, `text-[9px]` 3. A second and
   third tier now exist, but the dominant heading type is unchanged.

4. **`tests/phase5.test.ts` content change** — inherited from Wave A, still the
   only genuine F2 content failure. An authorized freeze refresh must decide it.

5. **The Phase 6 freeze manifest is internally inconsistent** (mixed LF/CRLF
   digest capture — see above). PART F2 is therefore unsatisfiable for the
   eleven untouched files on any machine, in any checkout state, until an
   authorized refresh normalizes line endings across the manifest. This is a
   pre-existing Phase 6 defect, not a Phase 7 regression, and it is the single
   most important input to the refresh decision.

6. **Canonical-root production build not performed.** It would write build
   artefacts into the canonical checkout. The isolated Windows build passed.

7. **No Hoadha room-specific staff assignment or capacity provider exists.**
   Those views truthfully show UNKNOWN rather than inventing quota or assigning
   workers.

8. **Pre-existing data service on 127.0.0.1:5177** (PID 36120) is a stale Wave A
   process, not this work. It was left running and untouched; this round's proof
   ran on 5277/5178/4273 to avoid it. **Flagging it: that stale process still
   serves a `building` key from the frozen service and should be stopped by
   whoever owns it.**

## Not touched

No ERP restart. No Hoadha execution. No Hoadha board mutation. No Phase 6
control change. No freeze refresh. No Codex worktree. No canonical write. No
self-acceptance.
