# Handover — Antigravity · CV-AG8: optional organization import

**Issued by:** Claude Code (`claude`), Development Lead, under Founder directive 1 Nov 2026. **Room:** #17410 (assignment), #17411 (dispatch).
**This file is self-contained.** It assumes no prior conversation. Everything you need is in the repository, Room and Git.

## 1. Mission and exact scope

Build the **optional import** that loads a preserved Starq organizational snapshot into a Command installation, on explicit request only.

**In scope:** the import endpoint and CLI, snapshot validation, dry-run, duplicate/conflict detection, transactional insert, summary and failure reporting.
**Out of scope:** the provisioning guard (done, CV-C6), the snapshot *exporter* (CV-C7, Claude — see §5), deletion and first-run UI (Cursor, CV-CU6/CU8), any change to `startDatabase()`.

You are also the **independent reviewer** for Claude's CV-C6 and CV-C7. You did not build them, so you may review them. You may not review your own CV-AG8.

## 2. Verified baseline

| | |
|---|---|
| Branch | `claude/integration-verification-20261101` |
| Head at handover | **`f846484`** (CV-C6) |
| PR | **#12** (draft) → `integration/command-convergence-20261031` |
| Integration branch (origin) | `3b09b95`; local head `8c4ede6`, carried inside PR #12 |

Branch from `f846484` into your own worktree:

```bash
"C:/Program Files/Git/cmd/git.exe" worktree add D:/StarqTech/_worktrees/ag-cv-ag8 -b ag/cv-ag8-import f846484
```

Use **system Git** at that exact path. The bundled Hermes Git fails with "not inside a git repo" and caused several blocked cards.

Verification baseline at `f846484`: vitest **1194/1194**, typecheck clean, build clean, `test:node` **110 pass / 5 fail**. Those five are pre-existing (`pm-live-progress`, provenance assertions, WP-0 convergence, legacy collision, relink) and are **not yours** — do not "fix" them silently; they are CV-AG6.

## 3. Prior work you must inspect before writing anything

- `server/pm-service.mjs` — `startDatabase()`, `resolveProvisioning()`, `PROVISIONING`, `initSchema()`, `tx()`, `seedProjects`, `seedOperatingOrg`, `importNexusBoards`, `importLegacyPmSnapshot`. **Read `resolveProvisioning` first**: it defines what an "empty" vs "legacy-seeded" database is, and your import must respect that contract.
- `server/pm-ops-routes.mjs` — your own CV-AG1–AG5 routes and `runDomain`; add the import route here, not in `pm-service.mjs`.
- `server/operating-org.mjs` — org creation functions and validation you will reuse.
- `scripts/preservation-baseline.mjs`, `scripts/backup-data-stores.mjs`, `scripts/verify-restore.mjs` — the preservation tooling. `verify-restore.mjs` is how acceptance is proven; read it before designing, because it decides what "preserved" means.
- `tests/provisioning-guard.test.mjs` — the service-spawn and identity pattern to copy.
- `docs/convergence/08_EMPTY_START_PRESERVATION.md` §3.4 — the ten requirements, restated below.

## 4. Dependency and integration boundary

**You depend on CV-C7** (Claude): the snapshot format and exporter. If CV-C7 has not landed when you start, build against the contract in §5 and a hand-written fixture snapshot; do not invent a second format.

**File ownership, to avoid collisions:**

| You own | Do not touch |
|---|---|
| `server/pm-import.mjs` (new) | `server/pm-service.mjs` except `export`ing an existing helper you need |
| the import route in `server/pm-ops-routes.mjs` | `startDatabase()` / `resolveProvisioning()` (Claude) |
| `tests/organization-import.test.mjs` (new) | `src/**` (Cursor) |
| `scripts/import-organization.mjs` (new CLI) | `tests/provisioning-guard.test.mjs` (Claude) |

## 5. Snapshot contract (CV-C7 produces this; you consume it)

A single JSON file. Treat it as untrusted input.

```jsonc
{
  "format": "starq-command.organization-snapshot",
  "format_version": 1,
  "schema_version": 3,            // must match pm_meta.schema_version
  "exported_at": "2026-11-01T...Z",
  "source_db_id": "<pm_meta.db_id>",
  "counts": { "pm_projects": 20, "pm_tasks": 1349, "...": 0 },
  "content_sha256": "<hash of `tables`, canonically serialized>",
  "tables": {
    "org_companies": [ { /* full row, original column names */ } ],
    "pm_projects":   [ { /* ... */ } ]
    // insertion order is the dependency order below
  }
}
```

**Dependency order for insertion** (parents first): `org_companies` → `org_units` → `org_positions` → `org_people` → `org_appointments` → `pm_projects` → `pm_tasks` → `pm_status_log` → `pm_source_records` → `pm_source_record_versions` → `pm_import_sources` → `pm_import_source_versions` → `pm_milestones`.

## 6. Authorized implementation

`POST /api/pm/import/organization` with `{ snapshot_path | snapshot, dry_run?, on_conflict? }`, plus `node scripts/import-organization.mjs --snapshot <file> [--dry-run]`.

The Founder's ten requirements, each of which must be demonstrable:

1. **Versioned source** — reject a `format_version`/`schema_version` that does not match; never guess.
2. **Validate before writing** — schema, required columns, identity handles, and that every referenced parent exists in the snapshot or the target.
3. **Preserve relationships and provenance** — insert rows verbatim; `HISTORICAL_NEXUS` stays historical; never re-timestamp.
4. **Detect duplicates** — by natural key (`pm_projects.id`, `pm_tasks.id`, `org_people.handle`, …). Report, do not merge.
5. **Dry run** — `dry_run: true` validates and returns the full summary, writing nothing. Prove this by hashing the database before and after.
6. **Reject incompatible data safely** — refuse before opening the transaction.
7. **Never silently overwrite** — insert-only. A conflict is reported; `on_conflict: 'abort' | 'skip'`, default `abort`. No `UPDATE`, no `DELETE`, ever.
8. **Summary and failure report** — created / skipped / conflicted per table, plus a reason per rejection.
9. **Atomic** — one `BEGIN IMMEDIATE`, commit whole or roll back whole.
10. **Source preserved** — open the snapshot read-only; never write to it, whatever the outcome.

**Refuse by default when the target is not empty.** A populated database requires explicit `on_conflict: 'skip'` and still never overwrites.

## 7. Data-preservation constraints (non-negotiable)

- **Never touch** `D:\StarqTech\00_STARQ_HQ\operations\starq-command\data\*.db`. All work uses disposable copies made with `VACUUM INTO` from a read-only handle.
- Scratch services only: `PM_DB_PATH=<temp>` and `PM_PORT` in 5190–5199.
- Teardown signals **only the PID you spawned**, and waits for exit. No process-name matching, no `kill -9` of anything you did not start. (Room #17402 records why.)
- Never confirm service identity from `netstat`: on this machine it does not reliably report loopback listeners. Assert that `/api/pm/health` reports **your** unique database path. (Room #17405, #17406.)
- No destructive migrations, no truncate, no reset-on-start.

## 8. Executable acceptance

Write `tests/organization-import.test.mjs` in the style of `tests/provisioning-guard.test.mjs`. Required cases:

| | Case | Must show |
|---|---|---|
| **C** | Import into a clean instance | Row counts and all nine relationship checks match the snapshot manifest |
| **C2** | Relationships preserved | Tasks resolve to projects, appointments to people and positions |
| **C3** | Provenance preserved | `HISTORICAL_NEXUS` count unchanged; no row silently becomes `LIVE` |
| **D** | Invalid snapshot | Rejected; target database **content-identical** before and after (`verify-restore.mjs` exits 0) |
| **D2** | Mid-import failure | Injected failure rolls back entirely; no partial organization |
| **D3** | Duplicate import | Second run creates nothing and reports every row as duplicate |
| **Dry** | `dry_run` | Full summary returned; database content-identical afterwards |

Also run and report: `npx vitest run`, `npm run typecheck`, `npm run build`, `node scripts/run-node-tests.mjs`.

## 9. Deliverables

Branch `ag/cv-ag8-import` from `f846484`; draft PR into `claude/integration-verification-20261101` (or the integration branch if PR #12 has merged). Commit as **your own identity** — the repository's shared `.git/config` says `Deadpool`, so pass `-c user.name=... -c user.email=...`.

Report: commit SHA, files changed, the full output of the five commands above, the acceptance table with actual numbers, known limitations.

## 10. Reporting and review

Post to Room as `@antigravity` with `--action-required`, referencing #17410 and this file. **Resolve `--reply-to` event ids from `readRoomSnapshot()`** — never retype a short id (that error happened twice: #17338, #17409).

Request review from **`@cursor` or `command-qa`** — not from yourself, and not from Claude if Claude is occupied with CV-C7. State plainly that your own tests are not acceptance.

**If you are blocked:** post the exact blocker in Room rather than working around it, and do not relax a preservation constraint to make a test pass.
