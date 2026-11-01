# Handover — Cursor · final stitch: Copilot findings + remaining Node failures

**Issued by:** Claude Code (`claude`), Development Lead, under Founder directive 1 Nov 2026 ("Final stitch and acceptance"). **Room:** #17416.
**Self-contained.** Assumes no prior conversation.

## 1. Baseline

| | |
|---|---|
| Branch | `claude/combined-integration-20261101` |
| Head | **`3e60328`** |
| PR | **#15** (draft) → `integration/command-convergence-20261031` |
| Contents | PR #12 (Claude CV-C6) + PR #13 (your CV-CU6/CU8) + PR #14 (AG CV-AG8), merged with no conflicts |

```bash
"C:/Program Files/Git/cmd/git.exe" worktree add D:/StarqTech/_worktrees/cursor-final-stitch -b cursor/final-stitch-20261102 3e60328
```

Use system Git at that exact path. **PR #15 stays open as the review checkpoint** — branch from it, do not rewrite it.

Verified at `3e60328`: vitest **1199/1199**, typecheck clean, build clean, `test:node` 119 pass / 4 fail / 1 skipped, plus the 5 new red tests described below.

## 2. Task A — make the Copilot regression tests green

`tests/copilot-findings-regression.test.mjs` is committed and **currently red by design**. It states the correct behaviour for each finding. Your job is to make it pass without weakening the tests.

I verified each finding against the real 17-table schema, so these are confirmed, not reported:

| | Finding | Status | Where |
|---|---|---|---|
| **F1a** | A unit can be created under an **archived company**. `createUnit` checks the company exists and checks an archived parent *unit*, but never the company's own `archived_at`. | **CONFIRMED** | `server/operating-org.mjs` `createUnit` (~516) |
| **F1b** | An archived position can be **revived under an archived unit**. Reviving without naming a unit keeps `existing.unit_id` and runs no archived check on it. | **CONFIRMED** | `server/operating-org.mjs` `updatePosition` (~692) |
| **F1c** | Moving a unit under an archived company | **ALREADY CORRECT** — do not "fix" it; the test guards against regression | — |
| **F2** | With `on_conflict:'skip'`, a duplicate company is skipped but its children still insert, attaching them to an existing but **different** organization of the same id. | **CONFIRMED** | `server/pm-import.mjs` `validateSnapshot` (~357) |
| **F3** | A snapshot table the importer cannot insert (e.g. `org_audit`) is **silently ignored**: the import reports success while audit/historical rows are discarded. | **CONFIRMED** | `server/pm-import.mjs` `validateSnapshot` |
| **F4** | CLI dry-run changes the target's journal mode `delete` → `wal`. `journal_mode` is **persistent**, so a dry run mutates the database it promised not to touch. | **CONFIRMED** | `scripts/import-organization.mjs:58` |

**Required behaviour**

- **F1** — enforce active-parent invariants consistently across create, revive and move for units, positions and appointments. Refuse with code `ARCHIVED_TARGET`, change nothing, and record nothing in `org_audit` for a refused operation. Extend the existing checks; do not invent a new validation layer.
- **F2** — a skipped parent must either block its children or be reported as a conflict. Imported children must never attach to a target record that merely shares an id. Compare enough of the parent (at minimum `name`) to tell "same organization" from "same id".
- **F3** — define the snapshot contract explicitly. Any table in `snapshot.tables` that is not in `TABLE_INSERTION_ORDER` must be **rejected by name**, before the transaction opens. Silent discard is the defect; an explicit refusal is the fix. If a table genuinely should be importable (`org_audit` is a strong candidate, since audit history is exactly what must survive an import), add it to the contract and to the insertion order in dependency position — that is a contract change, so state it clearly in your PR.
- **F4** — dry-run must leave the target byte-for-byte unchanged, including persistent PRAGMA state. Do not set `journal_mode` on a dry run at all; if a write path needs WAL, set it only inside the real import.

## 3. Task B — the four remaining Node failures

I diagnosed each. They are **not** environmental.

**B1 · `tests/pm-live-progress.test.mjs` — the file has never run, anywhere.**
It uses vitest globals (`describe`/`it`/`expect`) with no imports, in a `.mjs` file. `vitest.config.ts` includes only `tests/**/*.test.ts|tsx`, so vitest never collects it; `node --test` does collect it and dies with `ReferenceError: describe is not defined`.
Worse, its body imports no product code — it divides 233/437 in-line. That is arithmetic, not a capability proof, which is precisely what Vision rejected in Room #17395.
**Do not simply add imports to turn it green** — that would convert a visible failure into a false pass. Replace it with a real regression test against the actual projection code, asserting that adding LIVE rows does not change the historical denominator, and name it `.test.ts` so vitest runs it. If the behaviour it gestures at is already covered elsewhere, say so with the covering test named, and delete this file.

**B2/B3/B4 · the Nexus/legacy collision cluster** — one likely root cause:
- `tests/nexus-kanban.test.mjs` "legacy Command PM database is preserved…" → expected `'PM-CMD-001'`, actual `null`
- `tests/pm-portfolio-convergence.test.mjs` WP-0 → "Exactly one collision (SPOS-008:pos) restored", `0 !== 1`
- "relinks an already-restored collided task source row on importer restart"

All three concern `restoreCollidedRecords` / `importLegacyPmSnapshot` in `server/pm-service.mjs`. **These predate CV-C6** — I measured the same five failures at `3b09b95` and `8c4ede6` on 1 Nov, before the provisioning guard existed, so the guard did not cause them. Determine whether the importer stopped restoring collisions (a product defect in historical preservation, which matters for the Founder's provenance requirement) or whether the fixtures/expectations moved. Fix the defect; change an expectation only with independent justification stated in the PR.

## 4. Constraints

- Never touch `…\starq-command\data\*.db`. Disposable copies only, via `VACUUM INTO` from a read-only handle (`scripts/backup-data-stores.mjs`).
- Scratch services only: `PM_DB_PATH`, `PM_PORT` in 5190–5199. Teardown signals only PIDs you spawned and waits for exit.
- Never confirm service identity via `netstat` on this machine — assert `/api/pm/health` reports your own database path.
- Do not modify `startDatabase()` or `resolveProvisioning()` (CV-C6, approved).
- `scripts/init-schema-probe.mjs` materializes the full schema into a disposable file; use it rather than hand-writing DDL.
- Commit under your own identity (`-c user.name=... -c user.email=...`); the shared `.git/config` otherwise labels commits `Deadpool`.

## 5. Deliverables

Draft PR from `cursor/final-stitch-20261102` into `claude/combined-integration-20261101`. Report: commit SHA, files changed, full output of `npx vitest run`, `npm run typecheck`, `npm run build`, `node scripts/run-node-tests.mjs`, and `node --test tests/copilot-findings-regression.test.mjs` (must be 6/6), plus any contract change you made for F3 and your justification for any expectation you altered in Task B.

## 6. Review

**Copilot independently verifies these corrections** — it raised the findings and did not build the fix. Request it in Room referencing #17416. Do not accept your own work. Post as `@cursor`, resolving `--reply-to` ids from `readRoomSnapshot()` rather than retyping a short id.
