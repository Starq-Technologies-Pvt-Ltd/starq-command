# Empty-by-default installation — preservation baseline and design

**1 November 2026 · Claude Code, Development Lead · Founder directive "empty organization for every fresh installation, zero data loss"**

This is the §5 evidence that must exist *before* any persistence change, plus the design that satisfies both halves of the requirement. **No existing data has been modified.** Everything below was produced read-only or against disposable copies.

## Part 1 — Preservation baseline (complete)

### 1.1 Inventory of real data stores

`D:\StarqTech\00_STARQ_HQ\operations\starq-command\data`

| Store | Size | Role |
|---|---|---|
| **`pm-operating.db`** | **70.1 MB** | **The live operating record.** Everything the Founder owns |
| `pm-board.db` | 0.1 MB | Legacy board, still imported at startup |
| `pm-board-backup-2026-10-14…db` | 0.1 MB | Historical backup |
| `pm-board-backup-2026-10-28…db` | 9.8 MB | Historical backup |
| `pm-operating-backup-pre-fidelity-2026-10-28.db` | 6.6 MB | Historical backup |
| `pm-operating-backup-pre-gates-2026-10-28.db` | 1.5 MB | Historical backup |
| `control-plane.db` | 0.0 MB | Control-plane state |
| 4 JSON stores | small | ERP label/stage maps, workforce capabilities |

Also persisted outside `data/`: `board/*.json` (seed inputs and byte-pinned board assets), `.command-runtime/` (runtime state, containment descriptors, journal).

### 1.2 Live store contents and integrity

`pm-operating.db`, sha256 `0ce52edf…e089`, `PRAGMA integrity_check` = **ok**, 15 tables.

| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| `pm_tasks` | 1,349 | | `org_companies` | 1 |
| `pm_status_log` | 1,356 | | `org_units` | 4 |
| `pm_projects` | 20 | | `org_positions` | 3 |
| `pm_source_records` | 1,349 | | `org_people` | 4 |
| `pm_source_record_versions` | 34,979 | | `org_appointments` | 2 |
| `pm_import_sources` / `_versions` | 19 / 19 | | `pm_meta` | 5 |
| `pm_task_execution` / `_events` | 0 / 0 | | | |

Task provenance: **1,345 HISTORICAL_NEXUS, 4 LIVE**. Status-log actors: `nexus-import` 1,344, `ali` 11, `cursor` 1.

**Relationship integrity — all nine checks return 0:** tasks without project, status log without task, units without company, positions without unit, appointments without person, appointments without position, source versions without record, source records without task, tasks with a missing dependency.

Reproduce with `node scripts/preservation-baseline.mjs --data <dir>`. Before-image: `D:\StarqTech\Archives\starq-command\preservation-20261101\baseline-before.json`.

### 1.3 Verified backups

`node scripts/backup-data-stores.mjs` → `…\preservation-20261101\backups\` — **11 stores, all verified.** Each SQLite store is written with `VACUUM INTO` (a consistent snapshot including the write-ahead log) from a read-only handle, then re-opened and integrity-checked. `-wal`/`-shm` are deliberately not copied: their contents are already folded in, and a stale WAL beside a restored database is a hazard. `backup-manifest.json` records source and backup sha256 plus each integrity verdict.

### 1.4 Restoration demonstrated on an isolated copy

`node scripts/verify-restore.mjs` compares **content, not file bytes** — `VACUUM INTO` rewrites page layout, so byte equality would be the wrong test. Every table is hashed row-by-row in a deterministic order.

> **15 tables compared, 0 mismatches. RESTORE VERIFIED.**

The restored copy was then served through the real application on an isolated port: health `OK`, **20 projects / 1,349 tasks / 1,356 history rows**, `/api/pm/portfolio` returned 20 projects, `/api/pm/org` returned 1 company and 4 people. So the backup is not merely structurally intact, it is *usable*. (This is Test H, met in advance.)

## Part 2 — The defect that blocks both requirements

`startDatabase()` runs, unconditionally, on **every service start**:

```
initSchema → seedProjects → seedOperatingOrg → seedCurrentCommandWork
           → importNexusBoards → importLegacyPmSnapshot
```

`seedProjects` inserts any project from `board/pm-projects.json` that is not present. `seedOperatingOrg` does the same for Starq's company, units, positions and people. These are not first-run seeds; they re-apply forever.

**Demonstrated on a disposable copy of the live database:** deleted project `buzzlab` (20 → 19 projects), started the service once, and it came back — `projects=20`, `buzzlab` present with its original name.

Two consequences, and they are the whole problem:

1. **Deletion does not stick.** Any Founder deletion of a seeded project or org record is silently undone at the next restart. This blocks the deletion requirement outright, and no UI work can fix it.
2. **Every fresh installation is a Starq installation.** Starq's org and projects are reconstructed from code and repo files into any new database.

Fixing (1) fixes (2). They are the same defect.

## Part 3 — Design

### 3.1 Principle

> Seeding is a **first-run provisioning choice**, never a startup repair. An existing database is never re-seeded, for any reason.

This is what makes the change safe for the Founder's data: the live database already has content, so under the new rule **no seed path can ever touch it again**. Preservation comes from the guard, not from careful seeding.

### 3.2 Provisioning state

Add one `pm_meta` row, `provisioning` — written once, at creation:

| Value | Meaning |
|---|---|
| `empty` | Created empty. Never seeded |
| `starq-snapshot@<version>` | Provisioned from a named Starq snapshot |
| `legacy-seeded` | **Back-fill for the existing database.** Records that it predates provisioning |

Startup becomes:

```
initSchema (always — additive and idempotent)
if pm_meta.provisioning is absent:
      if the database has any org/project/task rows  -> set 'legacy-seeded'   (the Founder's DB lands here)
      else if COMMAND_PROVISION is set              -> provision, then record it
      else                                          -> set 'empty'
else: do nothing. Never seed, never import, never repair.
```

`COMMAND_PROVISION` is explicit and off by default. Nothing provisions silently.

### 3.3 Starq data becomes a snapshot, not code

Export the Starq organization to a versioned snapshot file (schema version, export time, row counts, per-table content hashes, source db_id). The `seed*` functions and `board/pm-projects.json` stop being a startup input and become the *source for producing that snapshot*. Nothing is deleted; the fixtures move from "applied forever" to "available on request".

### 3.4 Import mechanism (Founder's ten requirements)

`POST /api/pm/import/organization` plus a CLI, satisfying each point:

1. versioned snapshot with embedded schema version; 2. schema/identity/dependency validation before any write; 3. relationships and provenance preserved verbatim, historical rows stay `HISTORICAL_NEXUS`; 4. duplicate detection by natural key with an explicit report; 5. `?dry_run=1` validates and reports, writing nothing; 6. incompatible schema version rejected before the transaction opens; 7. never overwrites an existing record — conflicts are reported, not merged; 8. summary of created/skipped/conflicted plus a failure report; 9. one transaction, so it commits whole or rolls back whole; 10. the snapshot file is opened read-only and is never modified by the outcome.

**A failed import cannot destroy an existing organization** because it never updates or deletes — it only inserts, inside one transaction, and refuses outright when the target is non-empty unless `merge` is explicitly requested.

### 3.5 Deletion (the other half)

With the seed guard in place, deletion becomes meaningful. Ordinary user records get real removal with dependency checks and an audit trail; historical audit evidence keeps its integrity under retention rules rather than being deletable by accident.

## Part 4 — Allocation

Builder and reviewer are always different.

| ID | Work | Owner | Reviewer |
|---|---|---|---|
| **CV-C6** | Provisioning guard + `pm_meta.provisioning` + `legacy-seeded` back-fill. The safety-critical piece | **Claude** | AG |
| **CV-C7** | Snapshot exporter; produce and verify the versioned Starq snapshot | **Claude** | AG |
| **CV-AG8** | Import mechanism to the ten requirements, incl. dry-run, conflict report, atomicity | **AG** | Claude |
| **CV-CU6** | Deletion of org entities and projects: dependency checks, confirmation, audit | **Cursor** | AG |
| **CV-CU8** | First-run experience: create your first organization from empty | **Cursor** | AG |
| **CV-V3** | Acceptance tests A–H against real persistence and the real API | **Claude** (harness) + Cursor (journeys) | AG |

**Order:** CV-C6 first — it stops the data loss and unblocks CV-CU6. Then CV-C7, which CV-AG8 consumes. CV-CU6/CU8 proceed in parallel once C6 lands.

## Part 5 — Acceptance tests A–H

| Test | How it will be proven |
|---|---|
| **A** Fresh install | New database, no `COMMAND_PROVISION` → 0 projects, 0 orgs, service healthy; create an organization through the API and read it back |
| **B** Existing install intact | `preservation-baseline.mjs` before and after; counts and all nine relationship checks identical |
| **C** Optional import | Clean instance + Starq snapshot → counts and relationships match the snapshot manifest |
| **D** Failed import | Corrupted/incompatible snapshot into a populated instance → rejected, target byte-for-byte unchanged |
| **E** Data lifecycle | Create → edit → delete → recreate through real API/browser, including **delete survives restart** (today's defect, as a regression test) |
| **F** Restart and recovery | Data identical across stop/start and after an unclean shutdown |
| **G** Independence | Full journey with Hermes, Herdr, Room and WSL stopped |
| **H** Backup restoration | **Already met** (§1.4) — will be re-run as an automated test |

## Part 6 — Status and risk

Done: inventory, counts, integrity, verified backups of 11 stores, restoration demonstrated and served through the API, root-cause of the fixture/deletion defect reproduced on a disposable copy.

Not started: every code change. No persistence, schema-init, seed or installation behaviour has been modified.

**Risk I am escalating now (§5):** the live database currently depends on the seed path to re-assert 20 projects and the Starq org. Once CV-C6 lands, that crutch is gone — correctly, but it means the live database must be verified to *already contain* every record it needs rather than being topped up at startup. Its `seed_drift` field already reports differences between `pm-projects.json` and stored rows. CV-C6 will therefore run against a restored copy first and compare with `verify-restore.mjs` before any change reaches the live store.
