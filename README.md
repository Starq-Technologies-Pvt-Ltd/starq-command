# STARQ Command

**An AI-native Organizational Operating System for human and AI workforces.**

Starq Command is the operating surface a company runs on when part of its
workforce is human and part of it is AI. It holds the organization — companies,
units, positions, people, and digital workers — alongside the projects, tasks,
communications, and activity those workers produce, and it governs the two very
differently: operating records are **written** through their owning services,
while views onto external canonical systems are **read-only projections** that
never pretend to be more authoritative than their source.

That separation is the product. A green dashboard is only trustworthy if it can
tell you *how* it knows — whether a number is a live operating record, a
projection that agrees with its source, a projection that has drifted, or a
source it simply could not reach. Command is built so that distinction is
structural, not cosmetic.

> **Status.** Starq Command is an internal product under active development. It
> is not a released or certified system, it ships no license grant (see
> [`NOTICE.md`](NOTICE.md)), and nothing here claims a completed security or
> acceptance audit. See [Operating status](#operating-status) for exactly what
> has and has not been independently accepted.

![Starq Command — Company Operating System overview](STARQ%20Command%20Centre%20Dashboard.png)

> **This screenshot contains real operating information.** The staff roster,
> provider/model mix, host details, and subscription-usage ratios in it are one
> operator's actual configuration, not synthetic demo data. It is retained
> unchanged pending a Founder decision; the standing recommendation is to replace
> it with a purpose-built, synthetic-data capture rather than treat it as a
> generic promotional image. See the
> [documentation audit](docs/DOCUMENTATION_AUDIT_2026-11-02.md).

---

## What it does

Command organizes the whole operating picture of a company into a small number
of operator-ordered surfaces:

| Area | What it holds |
|---|---|
| **Home / Overview** | The primary operating picture: staff, sessions, tasks in progress, health, and attention items. |
| **Organization** | Companies, business units, positions, appointments, and the seat / occupant / acting-capacity / delegation model that keeps a role change from silently becoming an authority change. |
| **Workforce** | Human and digital staff, their designations, harnesses, providers, and current duty state. |
| **Projects** | A project-management portfolio: projects, milestones, kanban boards, work packages, and tasks with optimistic-concurrency state transitions. |
| **Activity** | Attention items, daily digests, and follow-ups derived from live operating records. |
| **Records / Library / Cortex** | Source records, preserved historical documents, and the connected-work graph that links tasks to their evidence. |
| **Comms** | A room-based messenger for coordinating human and AI workers. |
| **Governance (Overview · Company · Building · Dev Studio · Founder Attention · Evidence · System)** | Read-only projections of canonical company truth, health, and integrity, each carrying an explicit honesty state. |

Digital workers (coding agents and model-backed assistants) are first-class
members of the workforce: they hold positions, take appointments, carry sessions,
and move work across the same boards human staff use.

---

## Design principles

These are enforced by tests, not just documented:

1. **Written records and read-only projections never blur together.** PM, org,
   task, and messaging data is written through its owning backend service.
   Projection surfaces over external canonical systems only read, and the read
   boundary lives in exactly one place per service so it is auditable.
2. **Every value carries an honesty state.** `OK`, `STALE`, `DRIFT`,
   `UNAVAILABLE`, and `UNKNOWN` are a deliberate vocabulary. `UNKNOWN` is never a
   pass; an unreachable source is never rendered as an empty-but-healthy one; the
   worst condition wins the aggregate so no summary can mask a failing part.
3. **Nothing is invented to look complete.** Where scope or acceptance evidence
   is missing, the surface shows `UNKNOWN` / source-gap rather than a plausible
   number. Historical imports are never presented as live completion.
4. **Authority is never manufactured in the interface.** A seat grants no
   authority, an acting capacity grants no authority, and no prose is treated as
   an executable permission.
5. **Safety guards fail closed.** Project holds, gated lifecycle, origin
   pinning, and a write-client header stay enforced; they are not relaxed to make
   a demo or a test pass.

---

## Architecture at a glance

Command is a React single-page app (Vite + TypeScript + Tailwind) in front of a
set of small, single-purpose Node services. Each service owns one concern and a
narrow read or write boundary.

| Service | Default port | Responsibility |
|---|---|---|
| Vite UI | `5173` | Desktop-first shell; proxies `/api/*` to the services below. |
| Data service (`server/data-service.mjs`) | `5177` | Read-only assembly of canonical projections, freshness/drift, health, snapshot. |
| PM service (`server/pm-service.mjs`) | `5176` | **Writable** operating records: org, projects, tasks, milestones, work packages, digests, comms sync. |
| Building service (`server/building-service.mjs`) | `5178` | Read-only projection of floors, project rooms, library, and the Cortex graph. |
| Herdr service (`integrations/herdr/herdr-service.mjs`) | `5179` | Optional integration surface for AI-worker floor state. |

The UI never reads a source file directly — it goes through `/api/*` — so each
data boundary is one place and is testable. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full map, including the
honesty-state machine, the read-only path guard, and the surface catalogue.

### Portability

Command is designed as a **standalone organizational product** — the operating
model (organization, workforce, projects, tasks, comms) is not specific to any
one company. In its current state, however, the canonical projection surfaces and
the operating lifecycle profiles still carry **Starq-specific workspace
integration**: they resolve a Starq workspace, read canonical Starq sources, and
assume a Windows-hosted layout. General, third-party, out-of-the-box installation
has **not** been built or accepted. The product direction is portable; the
present configuration is Starq-coupled.

---

## Quick start

A concise version is below. The full guide, including every verification
command, the runtime requirements, and the live-operation prerequisites, is in
[`docs/QUICKSTART.md`](docs/QUICKSTART.md).

> **Three distinct modes, not two.** *Verified isolated* operation runs the app's
> daily-driver self-test against a scratch database on an isolated port: its
> **writes** go only to the scratch DB, though it may still **read** canonical
> workspace inputs read-only when a Starq workspace is present. *Ordinary
> development* runs the services directly — and when a Starq workspace is present,
> those services resolve to canonical sources, so it is **not** inherently
> isolated. *Live* operation drives the real control plane and is **not yet
> independently accepted.** Know which one you are in.

> **Runtime.** The `package.json` `engines` field is permissive (`node >=20`),
> but it understates the real requirement: the PM service uses `node:sqlite`
> (`DatabaseSync`), which Node 20 does not provide. The verified operating
> runtime is **Node 24.15.0 on Windows**. Treat the permissive engines field as a
> floor for the pure UI build, not as verified operating support.

### Verified isolated operation (scratch-DB write isolation)

This is the only procedure that confines all **writes** to a scratch database.
It drives the real PM service against an **isolated scratch instance** — it sets
both a scratch `PM_DB_PATH` and an in-range `PM_PORT`, so it binds an unused
`5190–5199` port and writes only to the scratch DB — and exercises the full
Founder daily-driver cycle: create an org, a project, a task, transition it,
restart, recover, then back up, mutate, restore, and verify. It may still read
canonical workspace inputs read-only if a workspace is present; it never writes
to a canonical store.

```bash
npm install
npm run verify:local  # scratch PM server: writes only to the scratch DB
```

### Ordinary development (not inherently isolated)

```bash
npm run dev           # data service (:5177) + Vite UI (:5173)
npm run pm:start      # writable PM service (:5176)
```

Open **http://localhost:5173**. Be aware of the isolation boundary:

- `npm run pm:start` **without** `PM_DB_PATH` resolves to the **canonical**
  operating database (`data/pm-operating.db`) whenever a Starq workspace
  resolves. Its writes are isolated only when you set a scratch `PM_DB_PATH`
  **and** an in-range `PM_PORT` (5190–5199) — setting `PM_DB_PATH` alone still
  binds the production port 5176. `verify:local` sets both. Do not treat plain
  `pm:start` as disposable.
- The read-only data service may **read** canonical sources when a workspace is
  present. It never writes, but it is not reading from nothing.

Run ordinary development against the canonical workspace only with
authorization; otherwise use `verify:local` or run with a scratch `PM_DB_PATH`.

### Verification

```bash
npm run build         # tsc -b && vite build
npm run typecheck     # tsc --noEmit (the no-emit check to trust)
npm test              # Vitest suite (architecture guards + live contracts + render)
npm run test:node     # Node integration suites
```

A passing build is not acceptance. The Vitest suite includes architecture
guards that fail the build if the design principles above regress, and live
contract tests that fail if the canonical projections they read move or vanish.

### Live operation (not accepted — authorization required)

The `command:*` lifecycle scripts (`npm run command:start`,
`command:status`, `command:stop`, and the `local-*` / `observation-*` variants)
drive the real multi-service control plane described by `lifecycle.config.json`
and `lifecycle.command-local.config.json`. They target a Windows-hosted
canonical workspace, reject runtime port/URL overrides, and **must not be run**
as part of general development. Their independent acceptance is still open — see
below.

---

## Operating status

Command's offline and disposable behavior is exercised by the committed test
suites. Its **live Windows operation** is owned and accepted separately:

- The Windows operating owner's most recent full **contained Windows lifecycle
  smoke** passed **66 / 66** checks. This is the operating-acceptance smoke over
  the real multi-service control plane — distinct from, and much larger than, the
  `verify:local` daily-driver functional test described in the quick start.
- **Four lifecycle cases and live backup/restore acceptance remain open.**
- The core Founder operating journey (org, workforce, projects/tasks, attention,
  persistence, backup/restore) has been exercised with all optional companion
  services offline, with the safety guards left enforced
  ([acceptance report](artifacts/acceptance/ACCEPTANCE_REPORT.md)).

**Releases.** Historical archival Git tags exist (`archive/*` baselines from the
development history). None of them is an authorized public product release: there
is no release tag, no published package, and no release has been cut. Do not read
the archival tags as versioned product releases.

Execution is not acceptance. Command never marks its own work accepted; live use
waits on independent verification. Known gaps are tracked in
[`KNOWN_TEST_FAILURES_20261028.md`](KNOWN_TEST_FAILURES_20261028.md) and the
convergence records under [`docs/convergence/`](docs/convergence/).

---

## Documentation

Start at the [**documentation index**](docs/README.md). The most relevant entry
points:

- [Architecture overview](docs/ARCHITECTURE.md) — services, surfaces, data flow, honesty states.
- [Quick start](docs/QUICKSTART.md) — disposable vs. live operation, every verification command.
- [Documentation audit](docs/DOCUMENTATION_AUDIT_2026-11-02.md) — public-facing disclosure and accuracy review.
- [Repository presentation proposal](docs/REPOSITORY_METADATA.md) — proposed GitHub About text, topics, and navigation.
- [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [IP notice (draft)](NOTICE.md)

Dated files in the repository root and under `docs/convergence/` are **preserved
historical engineering records** — handovers, phase implementation records, and
audits. They document how the system reached its current state and are kept
verbatim as evidence; prefer this README and the `docs/` guides for the current
picture.

---

## License and ownership

No open-source or proprietary license is granted yet. The repository's ownership
and license language is pending Founder approval; see
[`NOTICE.md`](NOTICE.md). Until then, do not redistribute, sublicense, or publish
this material.

Copyright © 2026 Starq Technologies Pvt. Ltd. All rights reserved.
