# Handover — Cursor · CV-CU6 and CV-CU8: data lifecycle and first-run experience

**Issued by:** Claude Code (`claude`), Development Lead, under Founder directive 1 Nov 2026. **Room:** #17410 (assignment), #17411 (dispatch).
**This file is self-contained.** It assumes no prior conversation.

You are the preferred primary implementation engineer for this package.

## 1. Mission and exact scope

Make Command usable by an organization that is **not** Starq: a real first-run experience from an empty installation, and a genuine data lifecycle where records can be created, edited and **removed** and stay removed.

**CV-CU8 — first run.** Onboarding from a genuinely empty database: create your first organization, departments, workforce, projects.
**CV-CU6 — data lifecycle.** Delete organizational records and projects, with dependency checks, confirmation and audit; restart persistence; remove the remaining dependence on hardcoded Starq fixtures in the UI.

**Out of scope:** the provisioning guard (CV-C6, done), snapshot export (CV-C7, Claude), the import mechanism (CV-AG8, AG). Do not modify `startDatabase()` or `resolveProvisioning()`.

## 2. Verified baseline

| | |
|---|---|
| Branch | `claude/integration-verification-20261101` |
| Head at handover | **`f846484`** (CV-C6) |
| PR | **#12** (draft) → `integration/command-convergence-20261031` |
| Your previous work | `b23ae10`, already merged into integration and present here |

```bash
"C:/Program Files/Git/cmd/git.exe" worktree add D:/StarqTech/_worktrees/cursor-cv-cu6 -b cursor/cv-cu6-lifecycle f846484
```

Use **system Git** at that exact path; the bundled Hermes Git fails with "not inside a git repo".

Baseline at `f846484`: vitest **1194/1194**, typecheck clean, build clean, `test:node` 110 pass / 5 fail (pre-existing, not yours).

## 3. What already exists — inspect before changing

Your own CV-CU1–CU5 work is in the tree and must be preserved and extended, not rewritten:

- `src/surfaces/founder-home.tsx` (608 lines), `src/surfaces/workforce-directory.tsx` (433), `src/surfaces/org-operate.tsx` (+1,165), `src/surfaces/pm-board.tsx` (reworked), `src/surfaces/daily-activity.tsx`
- `src/components/shell.tsx` — the 16-entry navigation. **The census is asserted** in `tests/architecture.test.ts` and `tests/phase3.test.ts`; adding a nav entry means updating both, and every entry must be `live: true`.
- `src/lib/pm-client.ts` — **do not edit lines 1–40** (scratch-port handling; `src/main.tsx` captures it at entry). Append new typed calls at the end.
- AG's API: `server/pm-ops-routes.mjs`, contract in `docs/convergence/API_CONTRACT_LOCAL_OS.md`. AG implemented **soft archive** (`archived_at`) and `org_audit`; `?include=archived` returns archived rows.
- `server/gated-lifecycle.mjs` — stage rules. Note `pm_tasks` has a **no-delete trigger**: "tasks are never deleted; move them to DONE". Task deletion is therefore a deliberate product decision, not an oversight — see §5.

## 4. The two findings that define this package

**(a) Deletion did not stick.** Until CV-C6 (`f846484`), `startDatabase()` re-seeded on every start, so a deleted project returned on the next restart. That is now fixed at the data layer, and `tests/provisioning-guard.test.mjs` case E guards it. **Your deletion work now has a foundation that holds** — it did not before.

**(b) A brand new organization must create its first person before anything else.** `createProject` validates `actor` against known handles, which are the identity registry plus `org_people`. A fresh database has neither, so project creation fails with *"actor is not a known active identity"* and the user has no way forward. This is pinned in `tests/provisioning-guard.test.mjs` case F. **Onboarding must therefore register the first person before offering project creation.** This is the single most important thing to get right in CV-CU8.

## 5. Authorized implementation

### CV-CU8 — first run
Detect an empty installation (no company and no projects) and present a guided first run: create organization → create first person (**required before anything else**, per §4b) → optional departments → first project. Every step writes through the real API and reads back. No placeholder or demo data may be invented to fill the screen. Offer the Starq import (CV-AG8) as an explicit, clearly-labelled option when available; never automatic.

### CV-CU6 — lifecycle
Delete/archive controls for companies, units, positions, people, appointments and projects, with a dependency check before the action (for example, a unit holding positions, a project holding tasks), a confirmation naming exactly what will be removed and what will be kept, and an audit entry. Surface archived records and allow restore. Respect AG's soft-archive semantics; do not add hard deletes at the API layer without agreeing the contract with AG first.

**Tasks are protected by a database trigger.** Do not remove or work around it. If the product needs task deletion, raise it in Room as a contract change and wait — that is a Founder-level decision, not a UI fix.

## 6. Data-preservation constraints (non-negotiable)

- **Never touch** `…\starq-command\data\*.db`. Work on disposable copies only.
- Run a scratch instance: `PM_DB_PATH=<temp copy>`, `PM_PORT` in 5190–5199, and open `http://127.0.0.1:5173/#...?pm_port=<port>`. The scratch port is captured at app entry and persists for the tab.
- To test against realistic data, copy the live database with `VACUUM INTO` from a **read-only** handle (see `scripts/backup-data-stores.mjs`), never by opening it for writing.
- Teardown signals only PIDs you spawned. Never confirm a service by `netstat`; assert `/api/pm/health` reports your database path (Room #17405, #17406).

## 7. Executable acceptance

| | Case | Must show |
|---|---|---|
| **A** | Fresh install onboarding | From an empty database, complete first-run end to end; all records read back after reload |
| **E1** | Create → edit → delete → recreate | Through real UI/API; the same id is reusable after deletion |
| **E2** | **Delete survives restart** | Delete a record, restart the service, confirm it is still gone (the original defect) |
| **E3** | Dependency refusal | Deleting a parent with children is refused with a clear reason, and nothing is removed |
| **E4** | Audit | Every deletion appears in `org_audit` with actor and timestamp |
| **F** | Restart persistence | User-created records survive stop/start |
| **G** | Independence | The full journey works with Hermes, Herdr, Room and WSL stopped |

Real browser plus API readback — not mocked UI assertions alone. Add rendered tests beside your existing `tests/founder-home.test.tsx`, `tests/org-manage.test.tsx`, `tests/workforce-directory.test.tsx`.

Run and report: `npx vitest run`, `npm run typecheck`, `npm run build`, `node scripts/run-node-tests.mjs`.

## 8. Deliverables

Branch `cursor/cv-cu6-lifecycle` from `f846484`; draft PR into `claude/integration-verification-20261101` (or the integration branch if PR #12 has merged). Commit under **your own identity** (`-c user.name=... -c user.email=...`); the shared `.git/config` otherwise labels commits `Deadpool`.

Report: commit SHA, files changed, output of the four commands, the acceptance table with real results, screenshots for A/E1/E2, known limitations.

## 9. Reporting and review

Post to Room as `@cursor` with `--action-required`, referencing #17410 and this file. **Resolve `--reply-to` ids from `readRoomSnapshot()`**; never retype a short id (#17338, #17409 are corrections for exactly that).

Request review from **`@antigravity`** (who did not build this). Do not approve your own work.

## 10. Interface contract with AG (CV-AG8)

You and AG both touch organization data from opposite ends. The boundary:

- **AG owns** `server/pm-import.mjs`, the import route in `pm-ops-routes.mjs`, `scripts/import-organization.mjs`.
- **You own** `src/**` and your UI tests.
- **Shared, change only by agreement in Room:** `docs/convergence/API_CONTRACT_LOCAL_OS.md` and the deletion/archive semantics in `pm-ops-routes.mjs`. If you need an API that does not exist, raise it on CV-AG8 rather than adding a server route yourself.
- Your first-run screen should **offer** AG's import when present and degrade cleanly to "no import available" when it is not. Do not block CV-CU8 waiting for CV-AG8.
