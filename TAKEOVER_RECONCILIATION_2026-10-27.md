# Starq Command — Independent Takeover Report

**Date:** 27 October 2026  
**Authority:** Founder independent engineering takeover  
**Canonical application:** `D:\StarqTech\00_STARQ_HQ\operations\starq-command`  
**GitHub:** `Starq-Technologies-Pvt-Ltd/starq-command`  
**Local/remote commit:** `5f5dabb6fa12c152d7af832e2e39888d288f9cdc` (branch `command-takeover-20261027`, PR #2)  
**Follow-up commit:** see git log on that branch for the fetch-timeout / recover-path patch

This report is the lead integration result. Parallel investigation notes (architecture, git, Nexus gap, tests, Room chronology) are under `evidence/2026-10-27/independent-takeover/` (gitignored evidence, kept on disk).

---

## 1. Discovery and reconciliation

`STARQ.md` still says `D:\!starq` and `D:\StarqTech` are the same directory. **They are not.** Both are ordinary NTFS directories. Command, Herdr, Room, and GitHub worktrees live under `D:\StarqTech`. `D:\!starq` is the historical starqos / Nexus workspace.

| Location | What it is | Disposition |
|---|---|---|
| `D:\StarqTech\00_STARQ_HQ\operations\starq-command` | Live application (PM, Building, lifecycle owner, seven-need). **Canonical.** | Connected to GitHub on `command-takeover-20261027` |
| `D:\!starq\00_STARQ_HQ\operations\starq-command` | Older Phase 1–5 shell inside the starqos repo (`pi/company-os-seed-draft`). No PM, no lifecycle owner. | Frozen history. Do not start. |
| `D:\!starq\starqNexus` | Predecessor OS. 437 ERP + 243/56/27 Hoadha task JSON. | Historical SSOT for board *records*. Not imported into Command PM. |
| `_worktrees/command-studio-pm-dashboard-20261026` | PR #1 head `38534fc` (dirty at takeover). | Absorbed historical snapshot into canonical tree. |
| `_worktrees/command-pm-convergence-10626` | GitHub `main` `2b06abe` plus dirty overlay. | History only. |
| `_worktrees/command-projects` | Local `p0-reconcile` `d717d5c`, no origin. | Ancestor of GitHub `main`. Preserve, do not run. |
| `_staging/github-starq-command-source` | Local clone of GitHub `main`. | Object store. Not the operating directory. |
| `00_STARQ_HQ/operations/herdr-floor` | Broker child of Command lifecycle. | Shared runtime, not a second Command app. |
| `D:\StarqTech\agent-comms` | Live Room ledger (head through #15880 at takeover). | Canonical Room. Bang copy is stale (16 Oct). |

GitHub at takeover: private repo, `main` = `2b06abe` (orphan curated baseline), PR #1 OPEN at `38534fc`. That SHA still exists. #15849 called the PR worktree CLEAN; at takeover it was **dirty** (12 porcelain files). Treat Room audits as evidence, not current truth.

**What was consolidated into the canonical folder**

- Live unique work: lifecycle owner + historical-closeout handoff, seven-need overview, room ledger relation, `board/` fixtures (#9462 hashes), continuity tests.
- PR #1 unique work: `historical-pm-snapshot.mjs`, `historical-pm.tsx`, milestones panel, wired onto `#building`.
- Git history adopted in-place (empty unborn `master` backed up to `_staging/command-takeover-20261027/live-unborn.git`) so this directory is the GitHub working tree, not a second copy.

**What was not merged (still in PR worktree / remaining defect)**

- PR #1’s larger `pm-service.mjs` (milestones / work-package tables and the tests that require them). Live PM already has a work-packages *surface*; the DB schema was not overwritten.
- PR #1 PM-board UX tests that targeted that unmerged service.

---

## 2. Canonical Command project

Path: `D:\StarqTech\00_STARQ_HQ\operations\starq-command`

Startup (supported):

```bat
D:\StarqTech\Start-Starq.bat -CommandOnly
```

That delegates to `scripts/command-lifecycle.mjs` → `scripts/lifecycle/owner.mjs` using `lifecycle.config.json`. Ports are pinned: UI 5173, PM 5176, data 5177, building 5178, herdr 5179, broker 5188.

Dashboard: `http://127.0.0.1:5173`  
Native PM: `http://127.0.0.1:5176` (UI talks to it directly; Vite does not proxy `/api/pm`)  
Historical Nexus: `#building` (`HISTORICAL_SNAPSHOT`, not native tasks)

---

## 3. GitHub synchronization

| Item | Value |
|---|---|
| Repo | https://github.com/Starq-Technologies-Pvt-Ltd/starq-command |
| Branch | `command-takeover-20261027` |
| Commit | `5f5dabb6fa12c152d7af832e2e39888d288f9cdc` |
| Parent lineage | `2b06abe` → `ba9a3fb` → `38534fc` → `5f5dabb` |
| PR | https://github.com/Starq-Technologies-Pvt-Ltd/starq-command/pull/2 |
| Author | Mustarq `<a.musthaq@gmail.com>` |
| Local == remote | verified `git ls-remote` match at push |

PR #1 remains open at `38534fc` (subset). PR #2 is the reconciled canonical tree. Do not merge PR #1 on top of PR #2 without another diff; PR #2 already contains the historical snapshot.

Auth note: `GH_CONFIG_DIR=D:\StarqTech\gh-almstq` works for `gh`. Git HTTPS required `gh auth git-credential`; a raw bearer extraheader was rejected.

---

## 4. Architecture and why the previous construction failed

Command is a **derived projection** of company/Room/control-board/Nexus-history truth, plus a separate writable PM store that is forbidden from importing Nexus rows. Runtime is six owned processes plus JobGuardian containment, not `npm run dev`.

The previous workforce did build a real application. They did not fail from lack of code. They failed from **source fragmentation + an unstoppable lifecycle**:

1. **Two workspaces.** STARQ.md’s symlink claim was false. Agents and docs kept mixing `D:\!starq` (Nexus, old Command) with `D:\StarqTech` (live Command). Building still *must* read Nexus JSON from `D:\!starq\starqNexus\data`.
2. **Git never owned the live directory.** GitHub received a curated orphan `main` and PR #1. The operating folder stayed an empty nested repo with the entire app untracked. Finalization could not `commit` the thing that actually ran.
3. **Lifecycle over-constraint.** Start `da6d9bc7f73f7940` at 12:09Z **did** reach six READY children (Founder confirmed 4/4 at #15799). Stop then hit six 3 Oct EXITED broker registry rows without descendant-closeout proof (`STOP_INCOMPLETE`). Option B exception (#15821) was implemented and tested offline; the **running** broker was still pre-exception code. Recover also required WMI inspect of executable paths. Green owner tests mock that world. They never proved a live recycle.
4. **Review theater.** 17+42 focused tests pass and still pass. They do not start ports, render the dashboard, or post to Room. `room_post=OFF` is an explicit lifecycle env for PM (`PM_ROOM_POST=off`), not an accidental outage.
5. **Containment vs this session.** Leftover children from `da6d9bc7` are still held by JobGuardian (PIDs 50300/43240/40480/12828/49300). `taskkill` and JobGuardian `force` from this Cursor session return **Access is denied**. The owner therefore cannot finish STOP or START a replacement stack until those jobs are closed from an elevated/interactive Founder session (or a reboot).

That is the construction failure in one line: **the product was split across folders, the repo was not the running tree, and the process that starts Command cannot recycle Command once containment and historical broker rows disagree.**

---

## 5. Functional gap vs the intended Founder dashboard and StarqNexus

### 437 vs empty native board

This is real, and it is **policy plus two surfaces on one tab**, not a missing file.

- Native PM (`pm-board.db`): command **4 closed** tasks (`PM-CMD-001`–`004`); ERP **0**; Hoadha **0**. `pm-service.mjs` never imports Nexus rows. `board/pm-projects.json` records that gap.
- Historical Nexus: `D:\!starq\starqNexus\data\starq-erp-tasks.json` has **437** tasks (done 232, planned 192, in_progress 12, closed 1). Hoadha 243 + 56 + 27. Adapter total **763/763**, `count_match=true` (verified independently). `#building` now renders `HistoricalPmSurface`. Until building-service is recycled onto the new code, the live UI may show `0/763` from a stale last projection.

Nexus predecessor capabilities vs Command:

| Nexus capability | Command now |
|---|---|
| Multi-board kanban (ERP, Hoadha family) | Historical read-only snapshot + empty native ERP/Hoadha PM boards |
| Writable task workflow | Native PM exists; Room post disabled; ERP hold blocks progress past READY |
| Founder Decisions board | Partial: discrepancies / attention surface, not a full DEC-* board from `decisions.json` |
| Project groups / SUB_NAV | Company OS + Building rooms + seven-need index |
| Workforce / duty | Staff projection (21 identities; duty buckets currently UNKNOWN) |
| Room ledger | Projected through data-service / room-work; PM writer `room_post=OFF` |
| Live execution | Activity window (351 events in last-good projection) |

Command uniquely added: honesty states (OK/STALE/DRIFT/UNAVAILABLE), Building topology, Company OS seats, Herdr runtime face, lifecycle containment, seven-need scan. Those are real. They are not a substitute for a populated native task system.

---

## 6. Verified startup procedure and operational results

### What actually works (verified this session)

- Historical snapshot loader: **9/9 tests pass**; live Nexus files **437/243/56/27 = 763**.
- PM service on **5176**: HTTP 200, `state=OK`, 3 projects, 4 tasks, `room_post=OFF`.
- Herdr integration **5179** and broker **5188**: HTTP 200 (leftover from `da6d9bc7`).
- Vite UI started independently on **5173** (this session; lifecycle could not recycle the old UI job). Title `STARQ // COMMAND`.
- Browser: Overview seven-need index, company/project cards, Dev Studio staff/activity, Building topology, Historical Nexus panel mounted. Founder identity `Mustarq · @mustarq`. Last-good projection showed **4/4 in sync** with a **DATA SERVICE UNREACHABLE** honesty banner (hung 5177).

### What is implemented but disconnected

- Native ERP/Hoadha PM boards (schema + UI, zero rows).
- Historical Nexus on `#building` until building-service runs the new adapter (stale projection = 0/763 in UI; node loader = 763).
- PM Room posting (`room_post=OFF` by config).
- PR #1 work-package/milestone DB vs live work-packages surface.
- `hashChain.mjs` static import `../../../../agent-comms/...` works only when Command sits at `00_STARQ_HQ/operations/starq-command`, not in `_worktrees`.

### What is broken

- Lifecycle recycle of attempt `da6d9bc7`: `STOP_INCOMPLETE`; leftover JobGuardian jobs; **Access is denied** from this session.
- Data **5177** and building **5188/5178** hung (TCP timeout). UI now fails closed in 4s instead of spinning forever.
- `Start-Starq.bat -CommandOnly` cannot start a replacement stack while those jobs hold the pinned ports.

### How to get a full six-service READY (Founder action)

From an **interactive / elevated** terminal on this machine (the session that can signal JobGuardian):

```powershell
D:\StarqTech\00_STARQ_HQ\operations\starq-lifecycle\Recover-Starq.ps1 -Force
D:\StarqTech\Start-Starq.bat -CommandOnly
```

Then open `http://127.0.0.1:5173` and `#building`. If Recover still reports drain blocked, reboot, then Start only. Do not `git clean` the Command directory.

A Vite UI from this takeover is currently on 5173 for inspection. Stop it before Start-Starq if 5173 conflicts.

---

## 7. Completed work and remaining defects

### Completed in this takeover

1. Independent discovery of every Command tree, GitHub refs, Room #15796–#15832 / #15849 / #15877 / #15880.
2. Preservation of live unborn git + worktree diffs under `_staging/command-takeover-20261027/`.
3. Consolidation of live + PR #1 historical snapshot into one canonical folder.
4. Git history adopted in that folder; commit pushed; PR #2 opened; local SHA = remote SHA.
5. Historical Nexus adapter verified at 763 records.
6. UI fetch timeout so a hung data service cannot hide PM/seven-need behind infinite LOADING.
7. Recover path taught the same historical-closeout exception as stop (still cannot override Windows Access-denied on another session’s jobs).

### Remaining defects (ranked)

1. **Blocker:** leftover JobGuardian-owned Command processes from 12:09Z. This agent cannot kill them. Full six-service READY needs Founder Recover/Start or reboot.
2. **Blocker for native PM as daily driver:** ERP/Hoadha boards empty by policy; Nexus history is not current work. Import remains a Founder decision (per-task Room authorization).
3. **Reliability:** lifecycle cannot recycle when WMI command lines are unreadable *and* JobGuardian access is denied. Offline tests do not cover that.
4. **Portability:** protocol imports and `HISTORICAL_NEXUS_WORKSPACE_ROOT = D:\!starq` hard-code layout. A clone of `starq-command` alone is not a working OS.
5. **Functional:** no full Nexus-class writable multi-board; decisions board incomplete; `room_post=OFF`; PR work-package schema not merged.
6. **Docs:** README still contains stale “Phases 6–7 are not authorised” text below the takeover launch note.

### What this is not

This is not a claim that Command is a clean six-service daily driver right now. It **is** one coherent application in one folder, with GitHub history, with Nexus history attached as history, with a running Founder dashboard that tells the truth about unreachable services instead of spinning.

The previous workforce’s successful 12:09Z activation was real. The failure was carrying that result through recycle and repository custody. Those two are now the remaining operational steps, and they require the session that owns the Job Objects.
