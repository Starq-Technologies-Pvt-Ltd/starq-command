# Starq Command — Architecture overview

This document describes the system as it exists in the code on this branch. It
is grounded in the actual services, routes, and surfaces, not in a roadmap.

## Shape

Starq Command is a desktop-first React single-page application in front of a set
of small, single-purpose Node.js services. There is no monolith: each service
owns one concern and one narrow boundary, and the UI reaches all of them through
one proxied `/api/*` namespace.

```
Browser ── Vite UI (:5173)
             │  proxies /api/* by prefix
             ├── /api/pm/*        → PM service (:5176)         WRITABLE operating records
             ├── /api/building/*  → Building service (:5178)   read-only projection
             ├── /api/herdr/*     → Herdr service (:5179)      optional AI-floor integration
             ├── /api/command/*   → Herdr service (:5179)
             └── /api/*           → Data service (:5177)       read-only canonical projection
```

The proxy map lives in [`vite.config.ts`](../vite.config.ts). Prefix order
matters: the writable and projection namespaces are routed to their owning
services before the catch-all `/api` falls through to the read-only data
service.

**Runtime note.** The PM service persists through `node:sqlite` (`DatabaseSync`),
a built-in that Node 20 does not provide. The `package.json` `engines` field
(`node >=20`) is therefore a floor for the UI build only; the verified operating
runtime is **Node 24.15.0 on Windows**. Anything that starts the PM service —
including `verify:local` — needs that runtime, not Node 20.

## The two data regimes

The single most important architectural fact is that Command holds two kinds of
data and never lets them blur.

### 1. Writable operating records

Organization, projects, tasks, milestones, work packages, follow-ups, digests,
and room-sync state are **owned** by Command and written through the PM service
(`server/pm-service.mjs`, with `server/pm-ops-routes.mjs` and
`server/pm-import.mjs`). These are real operating records with:

- optimistic concurrency on state transitions (`expected_updated_at`),
- dependency rules that fail closed (archiving a unit with active positions, or
  a position with active appointments, is refused with HTTP 409
  `HAS_DEPENDENTS`),
- a write-client header and origin pinning so only the intended UI can write,
- isolation controls: scratch mode (set `PM_DB_PATH` to an absolute `*.db` path
  that is not a protected store) writes to a separate database; to also move off
  the production port you must set an in-range `PM_PORT` (5190–5199) — `PM_DB_PATH`
  alone still binds `5176`, and an explicit out-of-range `PM_PORT` is rejected.
  **Without** `PM_DB_PATH`, the service resolves to the **canonical** operating
  database (`data/pm-operating.db`, i.e. `CANONICAL.pmBoardDb`; `data/pm-board.db`
  is the legacy `pmBoardLegacyDb`) whenever a Starq workspace resolves — so plain
  `npm run pm:start` is not isolated. `verify:local` sets both `PM_DB_PATH` and an
  in-range `PM_PORT`.

Representative routes: `/api/pm/org/{companies,units,positions,people,appointments}`,
`/api/pm/projects`, `/api/pm/tasks`, `/api/pm/milestones`,
`/api/pm/work-packages`, `/api/pm/portfolio`, `/api/pm/attention`,
`/api/pm/digests`, `/api/pm/followups`, `/api/pm/import/organization`.

### 2. Read-only projections

Views onto external canonical systems are **read-only** and carry their source's
provenance. The data service (`server/data-service.mjs`) assembles the canonical
surface and computes freshness, drift, and health; the building service
(`server/building-service.mjs`) projects floors, project rooms, the document
library, and the Cortex connected-work graph.

Representative routes: `/api/surface`, `/api/health`, `/api/health-floor`,
`/api/floor`, `/api/snapshot`, `/api/identity`, `/api/raw` (guarded),
`/api/work-packages`, `/api/comms/*`, and the `/api/building/*` family
(`/api/building/health`, `/api/building/library/*`, `/api/building/cortex/*`,
`/api/building/raw`).

Read-only is a structural property: the projection services serve only `GET` and
`HEAD`, and path access is contained by `server/path-guard.mjs` (every raw read
is validated against an allowlist and a size cap, so a 17 MB ledger is reported
as "too large, with its byte size" rather than silently truncated).

## Honesty states

Every projected value is rendered through an explicit honesty state, defined in
`src/lib/states.ts` and enforced at the read boundary
(`src/lib/use-command-surface.ts`) and the UI gate
(`src/components/state-gate.tsx`):

| State | Meaning | Behavior |
|---|---|---|
| `OK` | Projection agrees with its canonical source. | Render normally. |
| `STALE` | Reachable, but older than its source. | Render, loudly labelled — hiding it would be worse. |
| `DRIFT` | Projection disagrees with its declared provenance. | Render behind a DRIFT banner; canonical source wins. |
| `UNAVAILABLE` | Canonical source could not be reached. | Say so; never render an empty-but-healthy surface. |
| `UNKNOWN` | The source itself records no value. | Not a pass and not a failure — nobody checked. |

The aggregate orders the conditions so the worst one wins
(`UNAVAILABLE > UNREADABLE > FAIL > DRIFT > STALE > UNKNOWN > OK`): you cannot
judge truth against something you cannot read, and no summary can mask a failing
dimension. A persistent, non-dismissible hold banner renders above every surface
whenever canonical state declares a hold.

## Front end

- **Entry:** `index.html` → `src/main.tsx` → `src/App.tsx`.
- **Shell and navigation:** `src/components/shell.tsx` defines the operator-ordered
  navigation (Home, Organization, Workforce, Projects, Activity, Records, then the
  governance surfaces). There is deliberately no "phase" field in the nav — every
  entry is live.
- **Surfaces:** `src/surfaces/*` — one module per view (for example
  `founder-home`, `org-operate`, `workforce-directory`, `pm-portfolio`,
  `pm-board`, `daily-activity`, `comms`, `company-os`, `building`, `cortex`,
  `evidence`, `system`). Surfaces render facts; they do not score, weight, or
  recompute maturity.
- **Read boundary:** `src/lib/use-command-surface.ts` is the single hook that
  fetches the assembled surface and carries its honesty state. Client modules
  under `src/lib/` (`command-client`, `pm-client`, `command-board`) wrap the
  service APIs.
- **Schemas:** `src/schemas/*` mirror the canonical shapes (tasks, leases,
  seats, room events, artifacts) so the UI validates what it receives.
- **UI primitives:** `src/components/ui/*` are shadcn-style primitives on the
  Starq design tokens (`tailwind.config.js`).

## Organization model

The company model (`server/company-os.mjs`, `server/operating-org.mjs`) keeps
four concepts distinct and never merges them: **Seat**, **Occupant**, **Acting
Capacity**, and **Delegation**. Collapsing any pair is the specific failure the
model exists to prevent — it is what would let a company look like one person, a
role change look like an identity change, or delegated execution look like a
corporate officer. A seat grants no authority; an acting capacity grants no
authority; nothing in governance prose is executed as a permission.

## Lifecycle and operations

The control plane is described declaratively by `lifecycle.config.json` (full
online profile) and `lifecycle.command-local.config.json` (the standalone
local-driver profile). `scripts/command-lifecycle.mjs` and the scripts under
`scripts/lifecycle/` read these to start, health-check, gate, back up, and stop
components in dependency order. Runtime port/URL overrides are **rejected, not
merged** — the config file is the single source of control-plane truth.

There are **two distinct backup mechanisms**, and they must not be conflated:

- **Operational startup backup/restore** — `scripts/lifecycle/backup.mjs`. The
  local daily-driver path: a `VACUUM INTO` backup-on-start and a stopped-state
  restore, written beside the DB as `backups/pm-operating-<timestamp>.db`,
  integrity-checked, sha256-stamped, and **pruned to the most recent N** (default
  14). Restore refuses while Command is serving and first takes a pre-restore
  safety snapshot.
- **Immutable versioned backup architecture** — `scripts/backup-data-stores.mjs`.
  Reads every Command data store read-only and publishes each run as a **new
  immutable version**; previous version files and manifests are never rewritten
  or deleted, and the latest manifest is the longest history whose recorded
  digests still match. `scripts/verify-restore.mjs` checks restore integrity.

Live backup/restore acceptance on Windows is still open (see
[the operating status](../README.md#operating-status)).

> These lifecycle commands drive the real, Windows-hosted canonical workspace
> and are not part of disposable development. Do not run them without explicit
> authorization.

## Testing and guards

The Vitest suite (`tests/`) is not only functional coverage — it encodes the
architecture:

- **Architecture guards** fail the build if a design principle regresses: no
  writes in the read-only projection services, no maturity computation or stage
  averaging in React, identity resolved from the registry rather than hardcoded,
  the hold banner always present, no secret material or absolute host path in the
  portable snapshot.
- **Live contract tests** run against the real workspace, so if a canonical
  projection moves or disappears the suite fails rather than rendering stale
  shapes.
- **Render tests** server-render the assembled payload and assert that the
  honesty states and cited numbers actually reach the screen.

Node integration suites (`npm run test:node`) and the on-demand daily-driver
(`npm run verify:local`) exercise the writable PM service against isolated
scratch instances.
