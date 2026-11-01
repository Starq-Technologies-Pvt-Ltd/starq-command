# Starq Command — consolidated convergence assessment

**1 November 2026 · Claude Code, accountable Development Lead (Founder directive, 1 Nov 2026) · supersedes the status sections of `00_MASTER_PLAN.md`**

Everything below was verified on this machine today. Where I could not verify something, it says so.

## Headline

The software is in far better shape than the integration record suggests. **AG and Cursor delivered their packages in full and they are already merged** into `integration/command-convergence-20261031`. Vision's team then found three real problems and stalled on a fourth — not through poor engineering, but because two of their verification harnesses depended on `netstat`, which is unreliable on this laptop.

Today I closed the blocked item: the project-creation atomicity defect is **reproduced and fixed, with red/green proof**, and the integration branch now runs **1194/1194 vitest, typecheck clean, build clean**.

The product is close. What stands between here and a daily driver is one runtime defect (supervised start), the end-to-end proof, and the Founder-facing gaps in §6.

## 1. Original roadmap versus actual delivery

| Package | Planned | Delivered | State |
|---|---|---|---|
| CV-C1 recovery, authority, test isolation, scratch mode | Claude | 4 commits | **Merged** (PR #9) |
| CV-C1c local profile, launcher, backup-on-start | Claude | `957adec`, `46bc971` | **Merged** into integration |
| CV-C (browser acceptance) digests route, follow-ups client | Claude (2nd session) | `3daded2`, `34cb865` | **Merged** into integration |
| CV-AG0 API contract | AG | `API_CONTRACT_LOCAL_OS.md`, 515 lines | **Merged** |
| CV-AG1–AG5 org, workforce, milestones, automation, degradation | AG | `26f0410`: +4,415 lines over 12 files, incl. `ops-automation.mjs` (876), `pm-ops-routes.mjs` (821), `operating-org.mjs` (+1,078), 4 test files | **Merged**, PR #10 still open against a stale base |
| CV-CU1–CU5 Founder Home, org UI, board, workforce, hardening | Cursor | `b23ae10`: +4,695/−700 over 22 files, incl. `founder-home.tsx` (608), `workforce-directory.tsx` (433), `org-operate.tsx` (+1,165), `pm-board.tsx` rework, 6 test files | **Merged**, PR #11 still open against a stale base |
| CV-C1b pipe-reported port ownership | Claude | not started | **Outstanding — now the top blocker** |
| CV-V1 E2E journeys J1–J10 | command-qa | not delivered | **Outstanding** |

The roadmap was followed. The claim that needed correcting was never AG's or Cursor's scope — it was that "merged into the integration branch" meant "verified".

## 2. Pull requests

| PR | Branch → base | State | Reality |
|---|---|---|---|
| #9 | `claude/command-convergence` | **MERGED** 31 Oct | In the base and in integration |
| #10 | `ag/command-convergence` → snapshot | OPEN DRAFT | **Already merged into integration** via `639e876`. The PR is stale, not pending |
| #11 | `cursor/command-convergence` → snapshot | OPEN DRAFT | **Already merged into integration** via `9563530`. Same |
| #12 (new) | `claude/integration-verification-20261101` | to open | Today's verification + the missing test |

PRs #10 and #11 target `review/command-working-snapshot-20261031`, but the real integration happened on `integration/command-convergence-20261031`. They should be retargeted or closed with a pointer, so the PR list stops showing finished work as pending.

## 3. Git state (verified today)

```
origin/main                                 4b40d69   ← untouched, 22 behind integration
origin/review/...snapshot-20261031          fb3cd4f   ← PR #9 merged here
origin/integration/command-convergence-...  3b09b95   ← AG + Cursor + Claude merged
LOCAL  integration/command-convergence-...  8c4ede6   ← unreviewed commit, NOT pushed
origin/claude/integration-verification-...  cd53451   ← today's verified candidate
```

- **`8c4ede6` is still the local integration HEAD**, exactly as Vision reported, and still unpushed. I did not reset it. My branch builds on it so the work and its attribution are preserved.
- **No Git object is missing.** Every SHA in Vision's records resolves, including `02a05af3…` and `cd0453b`. The worker-reported `02a05af512a2…` was simply a wrong SHA, as Vision found.
- **All 29 dirty worktrees are preserved** as patches plus untracked files at `D:\StarqTech\Archives\starq-command\dirty-worktrees-20261101`. That includes the two Vision flagged: the uncommitted improved containment test in `t_438f5b2a-containment-fix` (31 added lines) and an uncommitted `config.mjs` change in `t_438f5b2a` (50 added lines).

## 4. Verified defects and what is now closed

### Closed today — project-create atomicity (#17402–#17404)
**Defect confirmed, not just hypothesised.** `POST /api/pm/projects` inserted and committed the project in one transaction, then validated `status` in a second. An invalid status answered 400 *after* the insert committed, leaving a project the Founder never created and could not re-create (retry → 409 PROJECT_EXISTS).

`8c4ede6` fixes it correctly by threading one transaction handle through both steps (`runDomain` → `tx` → `BEGIN IMMEDIATE`/`ROLLBACK`). It shipped with no test, so it was rightly unaccepted. I added `tests/project-create-atomicity.test.mjs` and ran it both ways:

| | parent `3b09b95` | head `8c4ede6` |
|---|---|---|
| atomicity test | **FAIL** — "a refused create committed a partial project" | **PASS** |
| persistence-across-restart test | PASS | PASS |
| node suite | 102 pass / 5 fail | 102 pass / 5 fail — *identical set* |

So the fix is behaviourally proven and introduces no regression. The five failures are pre-existing at the parent (`pm-live-progress`, provenance assertions, WP-0 convergence, legacy collision, relink) — they need the live database or are genuine older failures, and I have not yet investigated them.

### Closed today — navigation census
Cursor's six Founder surfaces (home, organization, workforce, projects, activity, records) broke the exact-list census in `architecture.test.ts` and `phase3.test.ts`, which still asserted the older ten. Both guards exist to admit surfaces as they integrate; these six are integrated, routed and live. Updated, with the liveness invariant unchanged. **Integration vitest is now 1194/1194.**

### Root-caused, fix designed, not yet built — listener attribution (#17405, #17406)
Vision's probes stopped twice because they could not confirm which process owned a port. This is the defect I root-caused on 31 Oct: **this laptop's TCP table does not reliably report loopback listeners**, even for a service that is demonstrably answering HTTP — confirmed against `Get-NetTCPConnection`, so it is not a parser bug. The root cause Vision recorded as unknown is known.

Two consequences, and they are different:
- **For tests, it is solved.** Asking the OS who owns a port is the wrong question. My test asks the service which database it has open: each run uses a unique temporary path and requires `/api/pm/health` to report exactly that path back. That is unforgeable by any other process and needs no `netstat`. This is why the atomicity proof succeeded where two earlier attempts stalled.
- **For the supervised lifecycle, it is not.** `start` still fails at `herdr` because readiness requires an OS-reported listener owned by the launched PID. That is **CV-C1b**, now the top blocker for one-click start.

### Open, correctly withheld — lifecycle containment (#17398–#17401)
Vision declined to accept `cd0453b` on specific, legitimate grounds: junction rejection inferred rather than demonstrated, realpath exceptions swallowed, no disposable fixture across runtime/data/locks/backups. The chain has since advanced (`cd0453b` → `cae730d` "close containment gaps for owner_record realpath and realpath errors" → `02a05af`), so the follow-ups address his findings, plus an **uncommitted** improved test. I have preserved all of it but **not re-verified it** — treat containment as UNVERIFIED until CV-C1b work lands, since both touch lifecycle.

### Open — frontend validation parity (#17397)
Cursor's `CreateProjectControl` checks only non-emptiness while the server enforces id/prefix/name/description rules. Source-level finding, not yet behaviourally tested. Low severity (the server still enforces), but it produces avoidable round-trips and poor messages.

### Process finding — unsafe cleanup (#17402)
One QA transcript used broad process matching plus `kill -9`. My test binds teardown to the spawned PID and waits for exit. Any future probe must do the same; this is now demonstrated, not just asked for.

### Task supervision (#17398)
`t_413137a9` overlaps blocked parent `t_0d473134`; an uncommitted PM-authority candidate sits in `_worktrees/pm-authority-candidate-20261101`. Preserved, not yet reconciled.

## 5. What works end to end, and what does not

**Works (verified by me, on real data or a real browser):** project boards over the real 20-project / 1,349-task portfolio; task create, edit, status and stage moves with optimistic concurrency; ungated task start with audit (Founder decision); organization and workforce records; the authority model (a claimed actor cannot accept or close); scratch isolation; data persistence across restart; backup-on-start; test suite reproducible from any checkout.

**Delivered but not yet verified by me end to end:** Founder Home, workforce directory, org management UI, milestones, deliverables, operations automation (digests, stale follow-ups), degradation without Herdr/Room. These have unit and render tests from AG and Cursor; what is missing is the real-browser journey proof (J1–J10).

**Does not work yet:** one-click supervised start on this laptop (CV-C1b); acceptance and closure without Room (Founder decision F1 still open); the five pre-existing node failures.

## 6. Against the Founder's product requirements

| Requirement | State |
|---|---|
| Organization and department management | Delivered (AG + Cursor), needs journey proof |
| Staff, roles, assignments (human + AI) | Delivered, needs journey proof |
| Project portfolios, milestones, boards | Delivered, needs journey proof |
| Work packages, lifecycle, evidence | Works; closure still needs Room (F1) |
| Communication, reviews, accountability | Partial — reviews work; Room optional path open |
| Operational visibility, Founder management | Founder Home delivered, needs journey proof |
| Create/edit/**remove** organizational data | **Gap: deletion.** AG implemented soft archive; true removal of user-created data is not confirmed |
| Genuinely empty-organization starting state | **Gap, not yet addressed.** Today's database carries Starq's own seeded org and 1,344 imported Nexus rows. A fresh install must start empty |
| No hardcoded Starq/agent dependencies | **Partially addressed.** AG's CV-AG5 degrades projections; seeded Starq data and `identities.json` coupling remain |
| Windows startup, shutdown, persistence, recovery | Persistence and recovery done; **supervised start blocked (CV-C1b)** |
| Real end-to-end workflows | **Not proven** (CV-V1) |

The last four rows are the honest remaining product gap. The empty-start and deletion requirements are new relative to my 31 Oct plan and are not covered by any existing card.

## 7. Remaining work and allocation

Provider capacity, not scope, is the constraint. The division below keeps builder and reviewer separate.

| ID | Work | Owner | Reviewer |
|---|---|---|---|
| **CV-C1b** | Port ownership via the MAC-authenticated control pipe; unblocks one-click start | **Claude** | Cursor |
| **CV-C4** | Empty-organization first-run: ship with no seeded Starq data; a real first-run path | **Claude** (contract) → Cursor (UI) | AG |
| **CV-V1** | J1–J10 real-browser journeys on the harness proven today | **Claude** (harness) → Cursor (journeys) | AG |
| **CV-CU6** | Destructive operations: delete org entities and projects, with confirmation and audit | **Cursor** | AG |
| **CV-CU7** | Frontend validation parity with the server (#17397) | **Cursor** | AG |
| **CV-AG6** | Investigate the 5 pre-existing node failures; fix or document each | **AG** | Claude |
| **CV-AG7** | De-seed Starq-specific data behind an optional demo import | **AG** | Cursor |
| **CV-C5** | Verify or rework the containment chain incl. the uncommitted test (#17398–#17401) | **Claude** | AG |
| **CV-V2** | Retarget/close PRs #10, #11; push verified integration; final acceptance | **Claude** | Founder |

No new Kanban board. These map onto existing cards where they exist (`t_438f5b2a`/`t_48d6933b` → CV-C5; `t_037834f5` → closed by today's evidence; `t_317f24f9` → CV-CU7).

## 8. Shortest safe route to a daily driver

1. **Merge today's verification** (PR #12) — unblocks `t_037834f5` and makes integration green. *Ready now.*
2. **CV-C1b** — one-click start begins working on this laptop. *Largest single win.*
3. **CV-C4 + CV-AG7** — the app starts empty and is genuinely portable, not a Starq-shaped fixture.
4. **CV-CU6 + CV-CU7** — full create/edit/remove.
5. **CV-V1** — J1–J10 prove it, in a browser, with readback.
6. **Founder acceptance session**, then fast-forward `main`.

Steps 2–4 are independent and can run in parallel.

## 9. Decisions I need from the Founder

| # | Question | My recommendation |
|---|---|---|
| **F1** (still open) | Acceptance and closure require Room online. Approve Windows Hello (WebAuthn) as a local authenticated Founder presence? | Approve — it is genuinely authenticated and needs no infrastructure |
| **F4** (new) | Should the shipped app start with **no** organization data, with Starq's current data as an optional import? | Yes — this is what makes it a product rather than a Starq fixture |
| **F5** (new) | PRs #10 and #11 are already merged into integration. Close them with a pointer? | Yes — keeps the PR list honest |

## 10. What I have not done

- Not pushed or reset the local integration branch; `8c4ede6` is preserved as-is and my work builds on it.
- Not re-verified the lifecycle containment chain (CV-C5).
- Not investigated the 5 pre-existing node failures (CV-AG6).
- Not run the J1–J10 journeys; no end-to-end claim is made here.
- Not touched canonical data, services, Room files or any other worker's worktree.
