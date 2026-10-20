# Starq Command

Starq Command is an organizational operating surface in development at Starq Technologies Pvt. Ltd. It is designed for human, AI-assisted, and hybrid work, with project, work, evidence, staff, process, and operations views.

## Current status

This is private company software under active development. It is not a public service, and publication to a private company repository would not mean production acceptance or general availability. The code presents projections from Starq's canonical workspace. It does not replace those sources of truth.

## Laptop development environment

The working environment is a Windows laptop. The current lifecycle profile expects this checkout at `D:\StarqTech\00_STARQ_HQ\operations\starq-command` and uses the Node runtime pinned in `lifecycle.config.json` under `D:\StarqTech\00_STARQ_HQ\operations\herdr-floor\runtime\nodejs`. Node 20 or later and npm are required by the package manifest.

Command reads its canonical inputs from the sibling `D:\StarqTech` workspace, including `STARQ.md`, `00_STARQ_HQ`, `agent-comms`, the StarqERP control-board projections, and the Herdr Floor manifest/runtime. The lifecycle profile runs the local data service (5177), building service (5178), Command's Herdr integration (5179), the Herdr broker (5188), and the Vite interface (5173); standalone Herdr is opened and owned separately by the Founder. The observation profile runs only the data service, building service, and reduced observation UI.

Use the existing laptop lifecycle and its pinned configuration for normal operation. `npm run dev` is a limited two-process development shortcut and does not start the full normal profile. Do not aim a local instance at live operational sources outside the established laptop workflow and authorization.

## Architecture and source layout

- `src/` React shell, product surfaces, schemas, and client-side state presentation
- `server/` workspace projections, health/reporting, PM and building services, and APIs. Canonical workspace projections are read-only; the PM service has its own local database and Room writer path.
- `integrations/` Room event handling, Herdr service integration, and workspace management
- `observation/` reduced observation-only interface and HTTP boundary
- `scripts/` lifecycle owner, gates, status, and shutdown tooling
- `tests/` source tests and fixtures

The lifecycle configuration and source code intentionally describe the current Windows workspace and its Room/Herdr companion systems. This package does not replace or remove those dependencies. Portability is a separate future engineering decision.

## Install and checks

The pinned laptop environment is the supported development baseline. From the Command directory, the source-defined checks are:

```sh
npm ci
npm test
npm run typecheck
npm run build
```

These commands were not run while preparing this candidate. Consult the Founder-authorized laptop workflow before starting services or tests.

Dependencies and integrity metadata are recorded in `package-lock.json`. Review dependency advisories against that exact lockfile before the first push. See `SECURITY.md`, `CONTRIBUTING.md`, and `NOTICE.md`.
