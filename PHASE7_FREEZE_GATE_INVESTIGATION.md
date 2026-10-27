# Phase 7 — the two Phase 6 freeze failures, exactly

Authority: investigation only. **No freeze gate was modified, relaxed, re-baselined
or worked around.** Both gates still fail, exactly as they did before this round.
This document states what each gate is protecting, why it fires, and precisely
what an authorized refresh would have to change — so the refresh can be a Founder
decision rather than a side effect of a UI build.

## Verdict

| Gate | Status before this round | Status now | Changed by me |
|---|---|---|---|
| PART F2 — every frozen Phase 5 file is byte-for-byte unchanged | FAIL | FAIL | **No** |
| PART F6 control total | 445 / 447 | 445 / 447 | **No** |

Reproduce from `00_STARQ_HQ/operations/starq-command-control`:

```
node --test tests/*.test.mjs
# ℹ tests 447 · ℹ pass 445 · ℹ fail 2
# ✖ PART F2 — every frozen Phase 5 file is byte-for-byte unchanged
# ✖ PART F4 — the freeze covers the whole Phase 5 source surface
```

## PART F2 — a digest mismatch

```
AssertionError [ERR_ASSERTION]: server/data-service.mjs changed
  — Phase 5 behaviour must be identical
  expected 6c390d76246d8c65ce52337bb418407b55e6932de52b0fd7b97107c9f05b413b
  actual   8af9ad962280fef6b47d878f0a65555bf19bdc206ad5c40f7bb862bd099447eb
```

The freeze holds twelve SHA-256 digests captured before Phase 6 Batch 0/1 began,
so that a later phase cannot quietly change Phase 5 behaviour.

**Only one of the twelve actually differs in content.** That is the important
finding, because a naive reading of "8 files changed" would send the refresh in
the wrong direction. Of the twelve:

| Frozen file | Content status | Cause |
|---|---|---|
| `server/data-service.mjs` | **CONTENT CHANGED** | the real F2 failure |
| `server/floor.mjs` | identical | CRLF checkout artefact |
| `server/gates.mjs` | identical | CRLF checkout artefact |
| `server/health-floor.mjs` | identical | CRLF checkout artefact |
| `server/path-guard.mjs` | identical | CRLF checkout artefact |
| `server/paths.mjs` | identical | CRLF checkout artefact |
| `server/snapshot.mjs` | identical | CRLF checkout artefact |
| `src/surfaces/attention.tsx` | identical | CRLF checkout artefact |
| `tests/phase5.test.ts` | **CONTENT CHANGED** | read-path retarget, below |
| `tests/attention-render.test.tsx` | identical | CRLF checkout artefact |
| `tests/phase5-fixture.test.tsx` | identical | matches frozen digest |
| `tests/fixtures/phase5-surface.json` | identical | matches frozen digest |

`git diff 3cd094a -- 00_STARQ_HQ/operations/starq-command/server/` is **empty**.
The seven "identical" files above hash to their frozen values once CRLF is
normalised to LF — a Windows worktree checkout artefact, not an edit. They are
untouched by this round and by the pre-build.

### The two real content changes, and why they are not Phase 5 behaviour

**1. `server/data-service.mjs` — 4 added lines.** The pre-build attached the
Building read projection:

```js
import { buildBuilding, BUILDING_SOURCES } from './building.mjs';
// …
surface.building = buildBuilding(workspaceRoot, surface);
// …
read_only_sources: [
  ...BUILDING_SOURCES,   // ← added
  CANONICAL.controlBoard,
```

This widens the declared read-only surface to include the ten Hoadha sources.
It adds no write path, no route and no new HTTP method. It is a read-side
addition and is exactly the change the freeze is designed to force a human to
look at. **It has not been re-baselined.**

**2. `tests/phase5.test.ts` — 5 lines.** The pre-build retargeted two assertions
from `src/App.tsx` to `src/surfaces/building.tsx`, because the routing moved into
the Building router:

```diff
-const appSrc = readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
+const appSrc = readFileSync(path.join(SRC, 'surfaces', 'building.tsx'), 'utf8');
-    expect(appSrc).toMatch(/case 'attention':[\s\S]{0,80}?<AttentionSurface/);
+    expect(appSrc).toMatch(/<AttentionSurface surface=\{surface\}/);
```

The assertion's *intent* is unchanged and still enforced: attention must be
mounted through the real `AttentionSurface`. Only the file it is read from and
the shape of the match moved. Weakening it would have been easy and silent; it
was not done.

## PART F4 — an unfrozen file

```
AssertionError [ERR_ASSERTION]: server/building.mjs is not frozen
```

F4 walks every `.mjs` in `server/` and asserts each is named in the freeze. This
is the completeness guard on F2: without it, a new server module could be added
that no digest covers.

Phase 7 added exactly one server module:

```
server/building.mjs   sha256 4b6bf0ec3a7443f9188155369c755b94a39251caa339ad75493fcd4cca12ea9a
```

It is a read-only projection builder. It contains no write primitive, opens no
transport, and serves no route — it is called by the data service and its output
is attached to the surface. It is nonetheless **absent from the freeze**, which
is the correct and expected behaviour of this gate.

## What an authorized refresh would require

Two edits, both inside `starq-command-control/tests/capability-boundary.test.mjs`.
Neither is made here.

**1. `PHASE5_FROZEN_DIGESTS['server/data-service.mjs']`**
`6c390d76…f05b413b` → `8af9ad96…bd099447eb`

**2. add to `PHASE5_FROZEN_DIGESTS`**
`'server/building.mjs': '4b6bf0ec3a7443f9188155369c755b94a39251caa339ad75493fcd4cca12ea9a'`

**3. decide the two CRLF-artifact files.** On a Windows worktree checkout,
`tests/phase5.test.ts` and the seven server modules hash with CRLF while the
frozen digests were captured with LF. Only `data-service.mjs` and `phase5.test.ts`
carry real content changes; the other seven are byte-identical after
normalisation. If the refresh is taken on Windows, the digest should be computed
on the committed blob (`git show <sha>:<path>`) rather than on the working-tree
file, or both gates will keep reporting artefacts as edits. **This is a
methodology question for the refresh, not a licence to exclude files.**

## What is explicitly NOT being proposed

- Do not delete or skip F2 or F4.
- Do not widen the digest list to include files the change does not justify.
- Do not touch `tests/phase5.test.ts`, `src/surfaces/attention.tsx`, or any frozen
  digest as part of a UI build.
- Do not treat the 445/447 as a Phase 7 regression. The two failures are the
  freeze doing its job on a read-surface widening that has not been authorized.

## Residual blocker

Phase 7 cannot merge to canonical, and B7 acceptance cannot be issued, until a
Founder-authorized decision is recorded on this refresh. Until then 445/447 is
the correct, honest state of the control suite.