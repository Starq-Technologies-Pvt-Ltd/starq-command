# Starq Command — Help Request and Engineering Handover

**Prepared:** 27 October 2026 (Asia/Karachi)  
**Prepared by:** Codex, acting floor lead  
**Audience:** Founder and the engineer(s) asked to help recover the Starq Command effort  
**Purpose:** Transfer the work, state plainly what succeeded and what failed, and ask for an independent path to operational continuity.

## Help requested

I need an experienced engineer or small team to take over the final operational recovery and repository handover for Starq Command. I have not delivered a stable daily driver that is verified as operational now. I accept that failure and the Founder’s assessment that this effort has not yet met its purpose.

The help needed is concrete:

1. Establish the actual state and ownership of every Command service and the Founder dashboard without disturbing unrelated workers or data.
2. Review the existing lifecycle owner and the narrowly scoped historical-broker exception described below. Determine whether a supported, non-forced recovery can safely restore Command.
3. If recovery is not quick and supportable, prepare the Founder-directed return to StarqNexus project-management and workforce workflows. Keep Command and its evidence as an inactive archive; do not import unfinished Command code or dependencies into Nexus.
4. Preserve and reconcile the source repository and worktrees without discarding any untracked or dirty work. Provide a short, evidence-based recommendation to the Founder.

This request does not authorize bypassing lifecycle safeguards, force-stopping workers, overwriting local work, changing governance, or extending the Founder’s deadline. The Founder’s final directive is Room #15832; the hard cutoff stated there is 28 October 2026 at 16:11 MVT.

## Honest outcome statement

Command **did** achieve a first successful Command-only activation on 27 October. Codex reported six services READY, six health contracts returning HTTP 200, six direct TCP probes succeeding, and the dashboard rendering at `127.0.0.1:5173` (#15796). The Founder then personally confirmed that the dashboard rendered and its projection showed **4/4 in sync** (#15799).

That activation was not sustained through the subsequent authorized lifecycle recovery. The recovery stopped at `STOP_INCOMPLETE` because the broker’s old registry contained six exited sessions without historical descendant-closeout proof. No replacement stack was started by that failed attempt. A one-time exception for those exact historical records was authorized, implemented, and independently accepted for its exception logic and tests. The live broker was still running pre-exception code, so a narrow non-forced handoff/reload path was prepared; that handoff candidate has **not** received its own independent review or runtime execution.

At the handover snapshot, a read-only listener check found port **5188** listening (PID 40480) and no listeners on the checked Command ports **5173, 5176, 5177, 5178, 5179, or 50300**. This is only a point-in-time listener observation; it does not establish process ownership or service health. Therefore the current dashboard and full stack are **not verified operational**. The earlier successful activation and Founder’s 4/4 confirmation remain valid historical evidence, but do not prove current availability.

I accept the current delivery failure. The request is for help to preserve what is useful and make a safe decision, not to relabel tests or the earlier activation as a current production result.

## Work completed by the floor

### Product and operating model

- Built the Starq Command application as a company operating surface and derived projection, with the canonical-source-wins boundary documented in the Command README.
- Accumulated work across the React/Vite Founder dashboard; Node data, PM and Herdr services; Building/project and workforce projections; Room visibility and sync; health/readiness reporting; lifecycle management and containment; and historical continuity. The source, tests, designs, records and evidence remain in the existing Command directory and its evidence folders.
- The Founder clarified that Starq Development Studio is the engineering factory and StarqERP is a product/project delivered through it. The ERP workspace is product-specific; it must not become a duplicate factory or governance structure.
- Aikido Pro trial/CLI/API recovery was ruled out by the Founder. The intended model is GitHub CI/internal checks plus Founder-operated browser assessments at significant milestones, with reports returned to the engineering team.
- The Founder’s operational workforce-readiness change was implemented in root `AGENTS.md` and independently accepted at #15807. It distinguishes one startup gate for a new or materially changed session from a concise ACK for later assignments in a verified session, while preserving identity, session-binding and reviewer-separation safeguards.

### Command runtime and lifecycle

- The supported Command-only startup succeeded once on 27 October, under lifecycle attempt `da6d9bc7f73f7940`. Room #15796 records the reported component ports and health results; #15799 records Founder confirmation of dashboard rendering and 4/4 projection sync.
- A later authorized recovery encountered a legacy broker-drain blocker. The relevant Room evidence is #15816, #15818 and #15820: six historical exited records lacked descendant-closeout proof; a lifecycle recovery stopped without starting a replacement stack; the dashboard at 5173 was unavailable during rechecks. Some point-in-time direct health results were mixed, and PM previously reported `room_post=OFF`.
- Founder #15821 authorized a one-time exception for exactly six 3 October 2026 exited registry records. It preserves their original bytes and keeps historical closeout status **UNKNOWN**, not VERIFIED. It does not relax current/future containment checks.
- The exception implementation and its focused regression suite were independently accepted by Claude at #15830, limited to the exception logic and test coverage. Claude did not accept a runtime recovery or the separate owner handoff.
- A separate owner handoff candidate was prepared to verify the exact quiescent broker and registry state, then use only non-forced contained shutdown of that obsolete broker before dependency-ordered recovery. It remains pending independent review; no runtime execution based on this candidate is recorded.

### Command test and evidence records

- Herdr historical exception suite: **17 passed, 0 failed, 0 skipped**. Log: `00_STARQ_HQ/operations/herdr-floor/evidence/2026-10-27/lifecycle-offline-test-output.txt`, SHA-256 `FD609D8A3B725D552B2314E7972F506B72A32C746C1C5A62433683AF0FFD46F5`.
- Command owner/handoff focused suite: **42 passed, 0 failed**. Log: `00_STARQ_HQ/operations/starq-command/evidence/2026-10-27/historical-closeout-handoff-test-output.txt`, SHA-256 `2A6B32F04667E75D56B506FAD9BB77F5EABE85B0AEFED7ACF886DB8D8B722221`.
- These are focused offline tests; they do not prove the live broker reload, service recovery, dashboard availability, current project/workforce visibility, or repository integration.
- Earlier Command Watcher F1 isolated regression evidence reported **3/3 PASS**; that was a bounded regression result, not evidence that the present Command stack is running.
- The repository contains extensive dated evidence, including lifecycle containment, Phase 7, PM/Room visibility, Room snapshot stability, data-listener proof, architecture/design integration, and Vision visual reviews. The directory names under `00_STARQ_HQ/operations/starq-command/evidence/` are the index; retain them intact during handover.

## Exact current repository preservation state

The live Command source directory is:

`D:\StarqTech\00_STARQ_HQ\operations\starq-command`

At the handover check, its Git status was **“No commits yet on master”**, with the application, scripts, tests, package files and historical documents reported as untracked. `git remote -v` returned no remote for this directory. This is not a finalized or synchronized repository. Do not run `git clean`, reset, overwrite, or assume that this working directory is backed up by GitHub.

An earlier Room audit assignment (#15809, subsequently canceled before Qoder did work) recorded a separate review worktree at `D:\StarqTech\_worktrees\command-studio-pm-dashboard-20261026`, associated with private GitHub PR #1, head `38534fce28e767ab310e4d9af91abb2a8d50915a`, base `2b06abe09a1b88c202ff4e8a8daa13913e35a12a`. Treat those as **historical audit values** and verify them before relying on them. The worktree and every other checkout must be inventoried read-only before reconciliation. Preserve dirty work separately; do not transplant unreviewed or unfinished Command implementation into Nexus.

Key recent exception artifacts and recorded hashes:

| Artifact | SHA-256 / record | Status |
|---|---|---|
| `00_STARQ_HQ/operations/herdr-floor/state/registry.pre-option-b-15821.json` | `7F44D8C8418DC1572C7B5417B3F231580EBDA86DAB40D557B26FC5C77974E042` | Byte-preserved original registry archive |
| `00_STARQ_HQ/operations/herdr-floor/state/historical-closeout-exception-20261027.json` | `097F0017D6B81F20885E82D8E1006AE1E1802BDB4D505A0049864903C566DDD8` | Founder-authorized six-record exception manifest |
| `00_STARQ_HQ/operations/herdr-floor/src/historical-closeout-exception.mjs` | `6A9EF099125B764044482E3878530EC9B87872190A43DE9FA47ED90DF0DF6A0D` | Accepted exception logic |
| `00_STARQ_HQ/operations/herdr-floor/src/broker.mjs` | `1F3168DA835C81F9FCD4ACCE2D9BAE9D02A19E6A50CE807081689BEC1B75E9E1` | Accepted exception integration; loaded process was pre-change |
| `00_STARQ_HQ/operations/herdr-floor/tests/lifecycle-offline.test.mjs` | `682F792318C5889C6529E8BA2C7D3D2A6B19250F88BBAE5D34C7B53EB3A38ED6` | Focused regression tests |
| `00_STARQ_HQ/operations/starq-command/scripts/lifecycle/owner.mjs` | `D5EEE046F7DA913A57802E5DFE2E9025531B8A5924D276A18683CFFEB68A5DDC` | Pending independent review; no runtime use recorded |
| `00_STARQ_HQ/operations/starq-command/scripts/lifecycle/historical-closeout-handoff.mjs` | `F468DA46C38FFD35D8F5B0071E13061D9CC3AB76F4EFA613BFE2C3E655CDA3A1` | Pending independent review; no runtime use recorded |
| `00_STARQ_HQ/operations/starq-command/scripts/lifecycle/tests/owner.test.mjs` | `D5C8813AF07F0BC20E24A00E94DE199F964979E07FD28A2CF1B54A28E6623C9D` | Focused suite input |
| `00_STARQ_HQ/operations/starq-command/scripts/lifecycle/tests/historical-closeout-handoff.test.mjs` | `46955DEC36524E5744E64DFF970BD3EBCED49D5042C0E78DE1EF5C81221111CB` | Focused suite input |

These hashes came from the preceding evidence record and should be recalculated before any review or execution. The original registry archive and live registry were last reported byte-identical at the registry hash above; verify again before relying on that statement.

## Workforce and authority boundaries

- Founder-authorized muscle/workforce: **Codex, Claude, Antigravity and Cursor**. Use only these unless the Founder changes direction.
- **Do not use Qoder or OpenCode** until the Founder explicitly asks. The Qoder baseline task was canceled at #15811–#15812 before substantive work.
- Claude’s accepted role was independent review of the exception logic/tests, not the handoff/runtime. Antigravity delivered and independently accepted the readiness-policy change. Cursor had not yet posted a review of the separate handoff candidate in the Room snapshot through #15832.
- Vision is a verifier; do not treat a builder’s own report as independent acceptance. Keep separate organizational positions and task-specific Builder/Verifier assignments distinct.
- Room is the durable authority. Use `readRoomSnapshot()` to read it and `send.mjs` under the canonical identity for Room updates. Never infer identity, current session binding, or readiness from a pane label or stale floor report.
- Do not stop, move, or restart unrelated live agent sessions. No agent should be assigned a task through an unverified lease or stale watcher route.

## Unresolved decisions and blockers

1. **Current service state:** only a single listener snapshot is available here; it showed 5188 only. Verify service ownership and health before acting.
2. **Legacy broker handoff:** pending independent review and fresh exact-state checks. The exception review does not substitute for this review.
3. **Dashboard and projections:** current 5173 availability and actual live project/workforce visibility are not proven. The prior 4/4 Founder confirmation was real but predates the failed recovery attempt.
4. **PM/Room integration:** previous checks included `room_post=OFF`; determine whether this is expected configuration or a remaining visibility/sync gap before claiming operational completeness.
5. **Repository custody:** primary Command directory has no commits or remote and extensive untracked content. Reconcile it with the correct existing remote/worktree without losing dirty files or importing unfinished code into Nexus.
6. **Fallback:** if the Founder chooses the pre-Command workflow, restore the canonical StarqNexus project-management and workforce visibility path and keep Command inactive. Do not treat a mirror under `D:\StarqTech\Projects` as historical Nexus SSOT; the prior authority is `D:\!starq\starqNexus\data` (read-only history unless separately authorized).

## Reference records

- Founder readiness-mode directive and independent acceptance: #15794–#15808.
- First successful Command-only activation: #15796; Founder’s dashboard and 4/4 projection confirmation: #15799.
- Founder authorization to restore/finalize in the existing directory: #15813.
- Failed lifecycle recovery and mixed health evidence: #15816, #15818, #15820.
- Founder authorization for the exact six historical broker records: #15821.
- Claude’s accepted exception review: #15827–#15831.
- Founder’s final deliver-or-restore directive and hard cutoff: #15832.

## Closing statement

The floor has produced substantial application code, operational policy, focused tests, design work and preserved evidence. It also achieved one confirmed successful activation. We did not carry that result through the subsequent recovery and repository-finalization work, and the current listener snapshot does not show a functioning dashboard. I accept responsibility for that shortfall and request experienced help to finish safely or restore the prior Nexus workflows. Please preserve the work, verify every live claim, and give the Founder a direct recommendation with the evidence and remaining decision clearly stated.
