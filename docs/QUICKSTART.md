# Starq Command — Quick start

This guide separates the two ways Command can be run, because they carry very
different risk.

- **Disposable operation** runs the application and its self-tests against
  scratch or read-only data. It never writes to a canonical operating database
  and is safe to run on any machine.
- **Live operation** drives the real, multi-service control plane against a
  separately managed canonical workspace. Its independent acceptance is still
  open, and it must not be run without explicit Founder authorization.

If you are evaluating, developing, or reviewing Command, you want disposable
operation only.

---

## Prerequisites

- **Node.js 20 or newer** (`"engines": { "node": ">=20" }`).
- A POSIX or Windows shell. Disposable operation has no OS-specific
  requirement; live operation is Windows-hosted.
- No credentials or private workspace are needed for disposable operation.
  Command does not auto-load `.env`; `.env.example` is reference only and must
  never hold credentials or private paths.

---

## Disposable operation

### 1. Install

```bash
npm install
```

### 2. Run the app

```bash
npm run dev
```

This starts two processes:

| Process | Port | Role |
|---|---|---|
| Data service (`server/data-service.mjs`) | `5177` | Read-only canonical projection (`GET`/`HEAD` only). |
| Vite UI | `5173` | Desktop-first shell; proxies `/api/*` to the services. |

Open **http://localhost:5173**.

The writable PM service is a separate process (the `dev` script does not start
it). To use the Organization, Projects, and Tasks surfaces with live writes to a
local database, also run:

```bash
npm run pm:start      # writable operating records on :5176
```

### 3. Exercise the full operating cycle, safely

`verify:local` drives the real PM service against an **isolated scratch
instance** — its own database and an unused port in `5190–5199` — and proves the
Founder cycle end to end: start, read org/projects, create a project and task,
update status, persist and read back, restart, recover, then back up, mutate,
restore, and verify. It never touches the canonical operating database.

```bash
npm run verify:local
```

Add `--keep` to leave the scratch instance running for inspection, or
`--port 519X` to choose the port.

### 4. Verify the build and guards

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
