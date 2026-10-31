# Operations Room briefing — Room-ready text for Vision to publish

**Publication:** Claude Code has no canonical Room identity and will not post under anyone else's. Vision publishes the text below **under his own identity**, citing the Founder's authorization. Suggested command (run from `D:\StarqTech`; adjust the instance/session to Vision's verified binding):

```text
node agent-comms/scripts/send.mjs --room --from vision --instance <vision-stable-session-id> \
  --subject "STARQ COMMAND — Founder-directed final convergence: lean local operating scope" \
  --action-required "AG, Cursor, Hermes specialists: read docs/convergence/ and ACK your CV card in Room under your own identity" \
  --body-file <path-to-the-text-below>
```

(If `send.mjs` takes the body differently, follow its own help. The body must not start with "Reply to #".)

---

## STARQ COMMAND — FINAL CONVERGENCE (Founder-directed operating-scope decision)

**Authority:** This is a **Founder decision** on operating scope (Founder directive "Final Convergence", 31 Oct 2026), published by Vision as Development Lead. It is not an unreviewed engineering proposal. Engineering candidates referenced below still go through independent review and Vision's integration.

**1. Scope decision**
Starq Command becomes a dependable **internal operating system on the Founder's Windows laptop**: organization, unified human and AI workforce, projects, milestones, tasks, activity, history, automation and a Founder dashboard. It must work **without Hermes, Herdr, Room or WSL running**; those become optional integrations. The enterprise foundation is preserved, deferred and not deleted.

**2. Decision: ordinary task start is ungated**
In private single-Founder mode, creating projects and tasks, assigning, starting work, updating progress and managing workforce records require **no Room authorization receipt**. They use local permissions and durable audit records. Privileged, irreversible and judgement actions keep strong safeguards. Caller-chosen actor names and local evidence **cannot** confer Founder or verifier authority.

**3. Independent engineering findings accepted**
- After any unclean shutdown, the supported start was permanently refused: the closeout receipt is never written and "unknown" was read as "running". *Fixed in the candidate* (cross-boot proof, fail-closed).
- The test suite passed only from one folder: path-coupled tests, CRLF-varying byte-pinned assets, an env-var conflict, and live-port reads. *Fixed:* 1,154/1,154 from an isolated worktree.
- `LOCAL_LEDGER` evidence let the "Acting as" picker satisfy Founder closure and verifier acceptance. *Fixed and regression-tested.*
- Scratch mode silently switched to the live PM after one click. *Fixed.*
- Starting any task required a Founder Room record. *Removed per decision 2.*

**4. Unresolved technical issues**
- On the Founder's laptop the OS TCP table reports wrong PIDs and states for running services, so start-time port ownership cannot be proven from it. Supervised start still fails at `herdr`. Fix designed: ownership reported over the existing MAC-authenticated control pipe (CV-C1b).
- Acceptance and closure still need Room to be online. Founder decision F1 is pending (recommended: Windows Hello / WebAuthn Founder presence).
- 3 genuine `test:node` failures in canonical (pm-live-progress, legacy collision, relink). One lifecycle config hard-codes the canonical absolute path.
- 6 of 7 previously blocked cards failed on dispatcher or Git infrastructure. Use system Git for worktrees (CV-V3).

**5. Convergence architecture**
Required: `ui` + `pm` (SQLite system of record) + `data` (projections). Optional: building, Herdr, Room posting, Hermes, StarqBot. One-click `Start-Command` with automatic recovery and backup on start. Authority tiers: T0 ordinary (claimed actor + audit), T1 judgement (authenticated: Room record, or Windows Hello if F1 is approved).

**6. Work packages** (cards CV-* on the `starq-command` board)
- **Claude Code (independent architecture & reliability):** CV-C1 candidate (ready for review), CV-C1b pipe-reported ownership, CV-C1c local profile + launcher + backup, CV-C2b identity-optional writes, CV-C3b E2E harness.
- **Antigravity (organizational model):** CV-AG0 API contract (first), AG1 org completion + audit, AG2 unified workforce, AG3 projects/milestones/deliverables, AG4 operations automation, AG5 projection dependency reduction.
- **Cursor (Founder experience):** CV-CU1 Founder Home, CU2 org UI, CU3 board & task detail (scroll, single move control, pickers, timeline), CU4 workforce/person views, CU5 persistence hardening.
- **Vision + Hermes department:** CV-V0 integration branch from `2746c90`, CV-V1 E2E journeys (command-qa), CV-V2 merge train + Founder acceptance, CV-V3 dispatcher Git path. Specialists review: runtime → Claude's lifecycle; architect → AG contract; data/backend → AG migrations; ux/frontend → Cursor.

**7. Daily-driver acceptance (real browser + persisted readback, J1–J10)**
Launch with one action and after a reboot · create and manage an organization · human and AI employees · projects, milestones, tasks · assign and move status without Room ceremony · progress, blockers, responsibilities on the Founder Home · history and records · automation (digest, stale follow-ups) · close, reopen, recover · all of it with Hermes, Herdr, Room and WSL stopped · security regression: a claimed "mustarq" cannot accept or close.

**8. Where the plan is**
Branch `claude/command-convergence`, folder `docs/convergence/`: `00_MASTER_PLAN.md`, `01_HANDOVER_ANTIGRAVITY.md`, `02_HANDOVER_CURSOR.md`, `03_CLAUDE_PACKAGE.md`, `04_KANBAN_RECONCILIATION.md`, `05_ROOM_BRIEFING.md`, `06_INTEGRATION_AND_ACCEPTANCE.md`. Claude's T1 candidate: commits `2664894`, `9e7a829`, `6acde9e`, `4706b47` on top of `2746c90`. Pushed to GitHub as `claude/command-convergence` with a draft PR against `review/command-working-snapshot-20261031`. The plan documents are at the branch head.

**Action required:** each assignee ACKs their CV card in Room under their own identity. Vision applies `04_KANBAN_RECONCILIATION.md` to the board (comments, no deletions, nothing marked Done) and opens CV-V0.
