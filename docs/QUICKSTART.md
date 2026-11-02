# Starq Command — Quick start

This guide separates the ways Command can be run, because they carry very
different risk. There are three distinct modes, not two:

- **Verified isolated operation** (`verify:local`) drives the real PM service
  against a scratch database (`PM_DB_PATH`) on an isolated `5190–5199` port. It is
  the only procedure guaranteed never to touch a canonical store. Safe anywhere.
- **Ordinary development** (`npm run dev` + `npm run pm:start`) runs the services
  directly. It is **not inherently isolated**: when a Starq workspace resolves,
  `pm:start` writes to the canonical operating database and the data service reads
  canonical sources. Isolate it by setting a scratch `PM_DB_PATH`.
- **Live operation** drives the real, multi-service control plane against a
  separately managed canonical workspace. Its independent acceptance is still
  open, and it must not be run without explicit Founder authorization.

If you are evaluating or reviewing Command and do not intend to touch canonical
data, use verified isolated operation, or set a scratch `PM_DB_PATH` before any
write.

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

## Verified isolated operation (safe anywhere)

This is the only run procedure guaranteed not to touch a canonical database.

### 1. Install

```bash
npm install
```

### 2. Exercise the full operating cycle, isolated

`verify:local` drives the real PM service against an **isolated scratch
instance** — its own `PM_DB_PATH` database and an unused port in `5190–5199` —
and proves the Founder cycle end to end: start, read org/projects, create a
project and task, update status, persist and read back, restart, recover, then
back up, mutate, restore, and verify. Because it sets a scratch `PM_DB_PATH`, it
never touches the canonical operating database.

```bash
npm run verify:local
```

Add `--keep` to leave the scratch instance running for inspection, or
`--port 519X` to choose the port. This procedure needs the verified operating
runtime (Node 24.15.0) because it starts the `node:sqlite`-backed PM service.

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
> (`data/pm-board.db`) whenever a Starq workspace resolves, and writes to it. It
> is isolated only when you set a scratch `PM_DB_PATH` (an absolute `*.db` path
> that is not a protected store) — which is exactly what `verify:local` does.
> Plain `pm:start` is **not** disposable. Likewise, the data service reads
> canonical sources when a workspace is present; it never writes, but it is not
> reading from nothing.

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

- The Windows operating owner's most recent full **disposable smoke** reported
  **66 / 66** checks passing.
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
  write-client header; writes must originate from the proxied UI. Scratch mode
  additionally refuses any port outside `5190–5199`.
- **Projection surfaces show `UNAVAILABLE` / `STALE` / `UNKNOWN`.** That is
  working as designed when the canonical workspace is not present. Disposable
  operation does not require it; the honesty state is telling you the truth about
  reachability, not reporting a bug.
