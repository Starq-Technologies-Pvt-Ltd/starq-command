# Starq Command — Quick start

This guide separates the ways Command can be run, because they carry very
different risk. There are three distinct modes, not two:

- **Isolated verification attempt** (`verify:local`) configures the real PM
  service with a scratch database (`PM_DB_PATH`) and in-range scratch `PM_PORT`
  (5190–5199), so its writes stay in the scratch DB. At this baseline, the runner
  is blocked on a fresh database: it creates a project before registering anyone,
  which `createProject()` rejects. No scratch bootstrap procedure has been
  validated; do not treat this command as a passing end-to-end verification.
  The service may still **read** canonical workspace inputs when a workspace is
  present.
- **Ordinary development** (`npm run dev` + `npm run pm:start`) runs the services
  directly. It is **not inherently isolated**: when a Starq workspace resolves,
  `pm:start` writes to the canonical operating database and the data service reads
  canonical sources. Isolate its writes by setting **both** a scratch `PM_DB_PATH`
  and an in-range `PM_PORT`.
- **Live operation** drives the real, multi-service control plane against a
  separately managed canonical workspace. Its independent acceptance is still
  open, and it must not be run without explicit Founder authorization.

If you are reviewing Command and do not intend to **write** to canonical data,
set both a scratch `PM_DB_PATH` and an in-range `PM_PORT` before any write.
Be aware the projection surfaces may still read canonical inputs read-only when
a workspace is present.

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
  `verify:local` attempt described below. Command does not auto-load `.env`;
  `.env.example` is reference only and must never hold credentials or private
  paths.

---

## Isolated verification (scratch-DB writes; blocked at this baseline)

This procedure confines PM **writes** to a scratch database. It may still read
canonical workspace inputs read-only when a workspace is present; it never writes
to a canonical store.

### 1. Install

```bash
npm install
```

### 2. Current baseline limitation

`verify:local` sets its own scratch `PM_DB_PATH` database and an in-range
`PM_PORT` (an unused `5190–5199`), confining its writes to the scratch DB rather
than the canonical operating database. However, the current runner is blocked
on a fresh database: default provisioning is empty, and it attempts to create a
project before registering anyone, which `createProject()` rejects. No
safeguard-preserving scratch bootstrap has been validated, so this command does
not currently verify the advertised end-to-end cycle.

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

Open **http://localhost:5173** in a fresh tab only for an authorized PM instance
on port 5176. For a scratch server on `PM_PORT=5193`, open
**http://localhost:5173/#home?pm_port=5193** before editing; substitute your
actual scratch port. The writable PM service is a separate process
(the `dev` script does not start it):

```bash
# PowerShell alternative: $env:PM_ROOM_POST = 'off'; npm run pm:start
PM_ROOM_POST=off npm run pm:start  # POSIX shell; Room posting disabled
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
  test from the `verify:local` attempt above, which is currently blocked on a
  fresh database. Do not equate the reported smoke with a completed scratch cycle.
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
- **Writes are refused.** The PM service uses loopback Host/Origin checks and a
  public write-client header as browser-request guards; they are not authentication
  or exclusive UI access, and a local client can send the header directly. In
  scratch mode (`PM_DB_PATH` set), an **explicit** `PM_PORT` outside `5190–5199` is rejected
  (the service exits); with no `PM_PORT`, scratch still binds the production port
  5176, so set an in-range `PM_PORT` to get a scratch port.
- **Projection surfaces show `UNAVAILABLE` / `STALE` / `UNKNOWN`.** That is
  working as designed when the canonical workspace is not present. Disposable
  operation does not require it; the honesty state is telling you the truth about
  reachability, not reporting a bug.
