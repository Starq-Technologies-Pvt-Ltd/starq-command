# Starq Command — Quick start

This guide separates the ways Command can be run, because they carry very
different risk. There are three distinct modes, not two:

- **Verified isolated operation** (`verify:local`) drives the real PM service
  against a scratch database (`PM_DB_PATH`) on an in-range scratch `PM_PORT`
  (5190–5199). All **writes** go to the scratch DB only; it may still **read**
  canonical workspace inputs read-only when a workspace is present, and it never
  writes to a canonical store.
- **Ordinary development** (`npm run dev` + `npm run pm:start`) runs the services
  directly. It is **not inherently isolated**: when a Starq workspace resolves,
  `pm:start` writes to the canonical operating database and the data service reads
  canonical sources. Isolate its writes by setting **both** a scratch `PM_DB_PATH`
  and an in-range `PM_PORT`.
- **Live operation** drives the real, multi-service control plane against a
  separately managed canonical workspace. Its independent acceptance is still
  open, and it must not be run without explicit Founder authorization.

If you are reviewing Command and do not intend to **write** to canonical data,
use verified isolated operation, or set both a scratch `PM_DB_PATH` and an
in-range `PM_PORT` before any write. Be aware the projection surfaces may still
read canonical inputs read-only when a workspace is present.

---

## Prerequisites

- **Node runtime.** The `package.json` `engines` field says `node >=20`, but
  that is a permissive floor for the pure UI build, **not** the operating
  requirement. The PM service uses `node:sqlite` (`DatabaseSync`), which Node 20
  does not provide, so Node 20 is **not sufficient** to run the writable service
  or `verify:local`. The **verified operating runtime is Node 24.15.0 on
  Windows**. Use that for anything beyond building the UI. (This is a
  documentation note; the `engines` field is not changed under this
  documentation-only commission.)
- A POSIX or Windows shell. The UI build has no OS-specific requirement; the
  verified operating runtime and live operation are Windows-hosted.
- No credentials or private workspace are needed to build the UI or run the
  verified isolated self-test. Command does not auto-load `.env`; `.env.example`
  is reference only and must never hold credentials or private paths.

---

## Verified isolated operation (scratch-DB write isolation)

This is the only run procedure that confines all PM **writes** to a scratch
database. It may still read canonical workspace inputs read-only when a workspace
is present; it never writes to a canonical store.

### 1. Install

```bash
npm install
```

### 2. Exercise the full operating cycle, isolated

`verify:local` drives the real PM service against an **isolated scratch
instance** — it sets both its own scratch `PM_DB_PATH` database and an in-range
`PM_PORT` (an unused `5190–5199`) — and proves the Founder daily-driver cycle end
to end: start, read org/projects, create a project and task, update status,
persist and read back, restart, recover, then back up, mutate, restore, and
verify. Its writes go only to the scratch DB; it never writes to the canonical
operating database.

```bash
npm run verify:local
```

Forward script flags through npm with `--`:

```bash
npm run verify:local -- --keep        # preserve the scratch files after the run
npm run verify:local -- --port 5193   # choose the scratch port (5190–5199)
```

`--keep` preserves the scratch directory for inspection; it does **not** leave
the service running — the script always stops the service on completion
(`stopService()`), then skips deleting the scratch files. This procedure needs
the verified operating runtime (Node 24.15.0) because it starts the
`node:sqlite`-backed PM service.

---

## Ordinary development (not inherently isolated)

```bash
npm run dev           # data service (:5177) + Vite UI (:5173)
```

| Process | Port | Role |
|---|---|---|
| Data service (`server/data-service.mjs`) | `5177` | Read-only canonical projection (`GET`/`HEAD` only). May **read** canonical sources when a Starq workspace resolves. |
| Vite UI | `5173` | Desktop-first shell; proxies `/api/*` to the services. |

Open **http://localhost:5173**. The writable PM service is a separate process
(the `dev` script does not start it):

```bash
npm run pm:start      # writable PM service on :5176
```

> **Isolation boundary — read before running `pm:start`.** With **no**
> `PM_DB_PATH` set, `pm:start` resolves to the **canonical** operating database
> (`data/pm-operating.db`) whenever a Starq workspace resolves, and writes to it.
> Its writes are isolated only when you set **both** a scratch `PM_DB_PATH` (an
> absolute `*.db` path that is not a protected store) **and** an in-range
> `PM_PORT` (5190–5199). Setting `PM_DB_PATH` alone does **not** move the service
> off the production port 5176 — the scratch `5190–5199` binding requires the
> in-range `PM_PORT` too. `verify:local` sets both. Plain `pm:start` is **not**
> disposable. Likewise, the data service reads canonical sources when a workspace
> is present; it never writes, but it is not reading from nothing.

Run ordinary development against the canonical workspace only with authorization.

## Verify the build and guards

```bash
npm run build         # tsc -b && vite build
npm run typecheck     # tsc --noEmit  — the pure no-emit check, the one to trust
npm test              # Vitest: architecture guards + live contract tests + render
npm run test:node     # Node integration suites
```

> **A passing build is not acceptance.** The Vitest suite includes architecture
> guards that fail if a design principle regresses, and live contract tests that
> fail if the canonical projections they read move or vanish. Report the exact
> command and result; distinguish local, simulated, and independently verified
> behavior (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

---

## Live operation (authorization required — not accepted)

Live operation is driven by the `command:*` lifecycle scripts and the
declarative profiles `lifecycle.config.json` (full online profile) and
`lifecycle.command-local.config.json` (standalone local-driver profile). These:

- target a **Windows-hosted, separately managed canonical workspace**,
- start, health-check, gate, and stop multiple services in dependency order,
- **reject** runtime port/URL overrides — the config file is the single source
  of control-plane truth.

```text
npm run command:start / command:status / command:stop / command:restart
npm run command:local-start / local-status / local-stop / local-restart
npm run command:observation-start / observation-status / observation-stop
npm run pm:backup / pm:backup-list / pm:restore
npm run test:lifecycle
```

**Do not run these as part of general development or review.** They operate the
real control plane.

### Acceptance state

- The Windows operating owner's most recent full **contained Windows lifecycle
  smoke** reported **66 / 66** checks passing. This is the operating-acceptance
  smoke over the real multi-service control plane — a much larger and different
  test from the `verify:local` daily-driver functional check in the sections
  above. Do not equate the two.
- **Four lifecycle cases and live backup/restore acceptance remain open.**
- These are reported figures from the operating owner, not an independent
  acceptance by this documentation work.

Until those are closed and independently verified, treat live operation as
unaccepted. Execution is not acceptance.

---

## Troubleshooting

- **Ports already in use.** The UI (`5173`) and preview (`4173`) use
  `strictPort` and will fail rather than silently move. Free the port or stop
  the other process.
- **Writes are refused.** The PM service enforces origin pinning and a
  write-client header; writes must originate from the proxied UI. In scratch mode
  (`PM_DB_PATH` set), an **explicit** `PM_PORT` outside `5190–5199` is rejected
  (the service exits); with no `PM_PORT`, scratch still binds the production port
  5176, so set an in-range `PM_PORT` to get a scratch port.
- **Projection surfaces show `UNAVAILABLE` / `STALE` / `UNKNOWN`.** That is
  working as designed when the canonical workspace is not present. Disposable
  operation does not require it; the honesty state is telling you the truth about
  reachability, not reporting a bug.
