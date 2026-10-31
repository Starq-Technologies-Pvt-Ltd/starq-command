# Integration and acceptance plan — under Vision's leadership

Companion to `00_MASTER_PLAN.md`. Vision owns this process. Claude, AG and Cursor deliver candidates into it, and nobody merges their own work.

## 1. Integration base and branches

1. **WP-V0 (Vision):** create `convergence/local-os` from `review/command-working-snapshot-20261031` @ `2746c90`. That commit equals canonical's current working source. Do **not** reset, clean or switch the canonical checkout. It stays as is until the final cut-over (§5).
2. Each harness works on its own branch from `2746c90`:
   - Claude: `claude/command-convergence` (this worktree)
   - AG: `ag/command-convergence`
   - Cursor: `cursor/command-convergence`
   - Hermes specialists: `starq-command/<card-id>-…`, created with **system Git** (`C:\Program Files\Git\cmd\git.exe`)
3. A candidate is ready when it has: commits on its branch, the command lines and output of `npx vitest run`, `npm run typecheck`, `npm run build`, `node scripts/run-node-tests.mjs` and `npm run test:lifecycle` from a clean worktree **without** `STARQ_WORKSPACE`, a list of changed files, known limitations, and the acceptance criteria it claims.

## 2. Merge train (order minimizes conflicts)

| Train | Candidates | Gate before merge | Reviewer |
|---|---|---|---|
| T1 | Claude: recovery, LOCAL_LEDGER fix, ungated start, test isolation, scratch-mode fix | Code review + suites green on the integration branch | command-qa (code), command-runtime (`scripts/lifecycle/**`) |
| T2 | AG0 API contract | Contract review | command-architect |
| T3 | Claude: local profile + pipe-reported ownership + launcher + backup | Real start/stop/recover on the laptop (§3 J1, J9) | command-runtime |
| T4 | AG1–AG5 | API tests + migration run on a `VACUUM INTO` copy of the live DB | command-data (migrations), command-qa |
| T5 | Cursor CU1–CU5 | Rendered-UI tests + real-browser journeys on scratch | command-ux, command-qa |
| T6 | E2E journeys (command-qa) | J1–J10 green on the integration branch | Vision |

Rules: rebase onto the integration branch before review, never merge with failing suites, and resolve conflicts hunk by hunk with the conflict rules in `00_MASTER_PLAN.md` §4. A defect found in review goes back to the **builder**; the reviewer does not fix it.

## 3. Daily-driver acceptance — the Founder's ten criteria

Each journey runs in a **real browser** against an isolated instance (`PM_DB_PATH` scratch copy, port 5191, `?pm_port=5191`), with **persisted readback**. That means both the UI and `GET /api/pm/...` after a service restart, not just the in-page state. The final run repeats J1–J10 on the laptop's real instance in a Founder session.

| J | Founder criterion | Journey | Pass condition |
|---|---|---|---|
| J1 | 1. Launch reliably with a straightforward action | Double-click `Start-Command`. Then repeat after killing all node processes and after a Windows restart. | UI opens; required services HEALTHY; no manual state edits ever needed |
| J2 | 2. Create and manage an organization | Create a department and team, a position reporting to another, rename and move the team, archive a unit | All changes read back after restart; org history lists each with actor and time |
| J3 | 3. Human and AI employees | Add a human employee; import an agent identity as DIGITAL with harness and capabilities; appoint both | Person pages show kind, harness and appointments; works with `agent-comms` absent |
| J4 | 4. Projects, milestones, tasks | Create a project, two dated milestones, five tasks with one dependency | Milestone progress computed; dependency blocks start until it is closed |
| J5 | 5. Assign and update status without Room ceremony | Assign owner and verifier; move BACKLOG → READY → IN_PROGRESS → REVIEW → VERIFICATION | No Room record requested; each move in the timeline; STALE_EDIT recovers without losing input |
| J6 | 6. Progress, activity, blockers, responsibilities | Block a task with a note; open the Founder Home and the owner's page | Blocked task, owner and reason visible within one refresh; person page lists open work |
| J7 | 7. History and records | Open the task and org timelines; export | Complete ordered timeline; export contains it |
| J8 | 8. Practical automation | Leave a task IN_PROGRESS for 3 days (injected clock in the test; real elapsed time in the Founder run) | One follow-up and one digest entry; no duplicates after restart |
| J9 | 9. Close, reopen, recover | Stop; restart; reboot Windows; start | Identical data; recovery automatic; a backup created on start |
| J10 | 10. Without the development infrastructure | Run J2–J9 with Hermes, Herdr, Room broker and WSL stopped | All pass. Optional surfaces show UNAVAILABLE, never errors |
| J5-neg | Security regression | Choose "mustarq" in "Acting as"; attach local evidence; try to accept and close | Refused (VERIFIER_ATTESTATION_REQUIRED / FOUNDER_CLOSURE_REQUIRED) |

Closure (VERIFICATION → ACCEPTANCE → CLOSED) is exercised with a Room fixture until the Founder decides **F1** (`00_MASTER_PLAN.md` §6).

## 4. Evidence to record per accepted candidate

Hermes card comment (by the reviewer, under their own identity): branch and commit SHA, reviewed range, suites run with counts, journeys run, defects raised, verdict. The builder posts its own result. The reviewer posts the verdict. Vision posts the integration record. No one posts under another identity.

## 5. Cut-over to canonical

After T6 and the Founder session:

1. Vision tags the integration branch `command-local-os-v1`.
2. Vision stops Command through the supported lifecycle.
3. Vision takes a backup of `data/pm-operating.db`.
4. Vision fast-forwards the canonical checkout to the tag. Canonical's working source already equals `2746c90`, so this is a clean fast-forward once its line-ending-only `.gitignore` difference is normalized.
5. Vision starts with `Start-Command` and runs J1 and J9 once more on the real DB.
6. Rollback = check out `2746c90` and restore the backup.
