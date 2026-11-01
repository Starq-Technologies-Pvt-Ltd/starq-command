# Starq Command — independent engineering review

**31 Oct 2026 · Claude Code (independent reviewer) · worktree `claude/starq-command-review-dc6d5b` · base `4b40d69` + canonical's uncommitted working source**

## Verdict

Command is in better shape than its delivery record suggests. The application (React UI, PM service, projections) runs, holds the real 20-project / 1,349-task portfolio, and the core governance model is sound. The month of repeated failure comes mostly from **three things around the code, not missing features**:

1. **It can't start after an unclean shutdown.** One reboot permanently deadlocks the supported start path. *Fixed in this candidate.*
2. **It can only be verified from one folder on one machine.** Builders saw green while reviewers saw red, and both were right about their own setup. *Fixed: 1,154/1,154 now pass in an isolated worktree with no env vars.*
3. **It isn't being used.** Of 1,356 status changes, 1,344 are the one-off Nexus import. You have made 11 writes in total, and none since 28 Oct. `pm_task_execution` (evidence, verification, rework) has **0 rows**. Command's own board has 4 cards; the department runs its 50 in Hermes.

Point 3 is the important one. Several blocked packages are hardening a workflow that has never been used once on real data.

## What I found by using it, not just reading it

I ran an isolated instance (four plain `node` processes, up in 8 s) on a read-only snapshot of the live PM database, using the built-in scratch mode, and walked portfolio → board → task → write.

| # | Finding | Evidence | Status |
|---|---|---|---|
| 1 | **Reboot deadlock.** JobGuardian proves closeout from a `closed.json` receipt that an unclean exit never writes. "Can't tell" is reported as `closed:false`, the same value as "still running". `stop` → STOP_INCOMPLETE, `start` → REFUSED, and `recover --force` → refused (it needs an event only a live broker could write). | Real `.command-runtime/state.json`: launched 30 Oct 08:04Z, machine booted 31 Oct 12:24Z. A copy settled to STOPPED with each child's basis journalled. | **Fixed:** `boot-closeout.mjs`. A second, falsifiable proof ("the machine booted after this launch") consulted only after the kernel proof declines. It refuses on any unknown (13 tests). |
| 2 | **The machine's TCP table is incoherent.** Verified-serving services show as `CLOSED`, `FIN_WAIT_1`, `LISTENING pid 0`, or are missing. `Get-NetTCPConnection` agrees with netstat, so this is not a parser bug. Port-ownership-by-PID is therefore **unsatisfiable on this laptop**. This is the real cause of the PID-0 saga and of supervised start failing at `herdr`. | Table in the session log; data :5177 (pid 34084) shown as `CLOSED 34084` plus `LISTENING 0`. | **Not fixed. Recommendation below.** My first attempt (a stricter parser) was wrong because it would hide real listeners. I reverted it. |
| 3 | **Founder authority was forgeable.** With Room posting off (the lifecycle's default), "Attach evidence" mints a `LOCAL_LEDGER` record whose sender is the caller-chosen "Acting as" value. Choosing `mustarq` set `root_authority: true`, and the acceptance and closure gates accepted it. The code's own comments call such a token "exactly the thing the gate exists to refuse". | Reproduced with one `curl` on scratch data. The new test fails against the canonical gate and passes with the fix. | **Fixed:** local records never attest (`gated-lifecycle.mjs`) and are never root (`pm-service.mjs`). |
| 4 | **Scratch mode silently went live.** The router drops `?pm_port=5191` on the first click, so a "disposable" session's writes went to the **live** PM on :5176. | Network log in the browser: :5176 after one nav click. | **Fixed:** captured at app entry and kept per tab (`pm-client.ts`, `main.tsx`, 6 tests). Re-verified in the browser. |
| 5 | **Starting any task needs a Founder Room record.** Moving a card to In Progress → `AUTHORIZATION_REQUIRED`. You must post in Room, then copy the sequence and eventId into each task. | Seen in the UI on PM-CMD-004. | **Your decision (see below).** This is the most likely reason for the 11 writes. |
| 6 | **Test suite tied to one folder, one byte layout, one env.** (a) 5 files reached outside the repo by counting `../`. (b) `core.autocrlf=true` with no `.gitattributes`, so the same commit checks out as different bytes, and the board manifest pins 163 sha256 hashes. (c) Setting `STARQ_WORKSPACE`, as the handover advises, fails 3 lifecycle tests. (d) One test read real machine ports. | Worktree before: 1,043 pass, 7 fail, 4 files unloadable (98 tests silently missing). After: 1,154/1,154. | **Fixed** (a), (b), (d). (c) is documented, not changed. |

## Where previous conclusions were incomplete or wrong

- **PID-0 / FIN_WAIT / IPv6 bracket theory (t_362b1b84):** QA was right that FIN_WAIT isn't a listener. But the cause is the OS table itself, so no parser change can fix it. Stop that line of work.
- **"Founder identity/authority binding is unresolved" (t_6325ed52):** mostly not true. `parseRoomRef` already authenticates the Room sender (recomputed hash, chain link, broker decision, ROOT_GENESIS). The gap was the `LOCAL_LEDGER` back door, now closed. Drop the actor-string-comparison candidate entirely.
- **"Suite is 0 failed" (KNOWN_TEST_FAILURES, 28 Oct):** true only from the canonical folder, without `STARQ_WORKSPACE`. Canonical today: vitest has 2 genuine stale failures (fixed here), test:lifecycle is 119/0, and test:node has **3 genuine failures** (pm-live-progress file, legacy collision, relink) that I did not investigate.
- **Lost PM candidate (t_a5659d52, t_ff13652b):** `pm_tasks` already has `phase`, `epic`, `milestone`, `sprint`, `depends_on`, `release_track`. Before any more forensic reconstruction of lost bytes, diff what the schema and API already have against what is actually needed. I did not verify API/UI exposure of those fields.

## Simplifications I'd make

1. **Prove port ownership through the channel you already trust.** The lifecycle already has a MAC-authenticated control pipe per child. Have the child report its own bound address over that pipe, and drop the netstat dependency. That turns finding 2 from unsatisfiable into a few dozen lines.
2. **Authorise once, not per task.** One Founder Room record per project or sprint, plus a "link latest Founder authorisation" picker. Alternatively, let UI-originated *start* be ungated and keep the strong gates where they matter: verification, acceptance and closure.
3. **Run Command on Command.** Move the department's cards from Hermes into the Command board. Daily use will find the real defects faster than reviews will.
4. **One state machine per card in the UI.** The task panel offers both status (`To Do/In Progress/Blocked/Done`) and stage (`IN_PROGRESS/BACKLOG/BLOCKED/FOUNDER_GATE`) buttons side by side.
5. **Prune.** About 45 worktrees sit at the same base commit, many named after packages that never landed. Archive the ones with no unique commits.

## Decisions needed from you

- **Start-authorisation friction (finding 5):** batch authorisation, or ungated start? Everything else on the daily path depends on this.
- **Whether to keep the per-port PID-ownership requirement** on a single-user laptop once pipe-reported binding exists.

## Shortest credible route to a daily driver

1. QA and integrate this patch (below).
2. Make decision 5, then implement it (small).
3. Pipe-reported port ownership → the supported start works after a reboot.
4. Turn my manual browser walk into a scripted end-to-end test against scratch mode (this replaces t_e551808d and t_ff4a03d8 as written).
5. Dogfood: Command's own backlog lives in Command from then on.

I can take 3 and 4, and 2 once you've decided.

## The candidate

**Superseded packaging:** the original 18-file patch is now commits `2746c90..4706b47` on `claude/command-convergence` (base = canonical's working source as committed by Vision). The LF-filter parser change mentioned in the session was reverted and is not included. It touches `server/pm-service.mjs` and `src/lib/pm-client.ts`, which also carry other specialists' uncommitted hunks. My hunks are separate, but integrate hunk by hunk.

| Area | Files |
|---|---|
| Reboot deadlock | `scripts/lifecycle/boot-closeout.mjs` (new), `owner.mjs`, `tests/boot-closeout.test.mjs` (new) |
| Forgeable authority | `server/gated-lifecycle.mjs`, `server/pm-service.mjs`, `tests/gated-lifecycle.test.mjs` |
| Scratch mode | `src/lib/pm-client.ts`, `src/main.tsx`, `tests/pm-scratch-port.test.ts` (new) |
| Reproducible verification | `.gitattributes` (new), `vitest.config.ts`, `tests/support/workspace.ts` (new), `activity-producer`, `room-work`, `room-checkpoint-race`, `structural-ownership`, `phase2` tests, `development-readiness.test.mjs` |

**Results in the isolated worktree (no `STARQ_WORKSPACE`):** vitest **1,154/1,154**; typecheck clean; build clean; test:lifecycle **131 pass, 1 fail** (the observation config hard-codes the canonical absolute path, so it passes only in canonical; stable across two runs); test:node 92 pass, 5 fail (the 3 genuine canonical failures plus 2 that need the live DB, which a worktree doesn't have).

## Not done or not verified

- Supervised start was **not** demonstrated end to end. After the deadlock fix it gets as far as `herdr` and then fails on finding 2.
- The Room-link and authorisation path was not exercised (no scratch Room fixture).
- The task-detail panel is clipped at 1400×900 and the page doesn't scroll. Not fixed.
- At review time I did not post in Room. Later, on Founder instruction, I claimed my own stale `claude` identity and posted #17336–#17339. Routing this through Vision/QA is for you to direct.
- Housekeeping: the live-DB snapshot and the copied runtime state (which held launch tokens) were deleted from the worktree. Early test logs written to the harness scratchpad on `C:` (outside `D:\StarqTech`, contrary to AGENTS.md) were removed. The forged-evidence probe existed only in that deleted scratch DB.
