# Fresh Clone Setup and Portability Report

> The clean-clone measurements below are pinned to the earlier `02402fbf7ab3eb73e00879ed0cf11a60bc632122` checkpoint. See **Current portability remediation** at the end for subsequent loader, configuration, lifecycle, and CI changes. Do not apply an earlier failure statement to later commits without rerunning it.

**Historical clone SHA:** GitHub `main` at `02402fbf7ab3eb73e00879ed0cf11a60bc632122` on 2026-10-28.

## Compatibility result

| Capability | Result | Evidence / limit |
|---|---|---|
| Cloneable | **Yes, with private-repository access** | Fresh HTTPS clone fetched 17 commits and exact SHA `02402fbf7ab3eb73e00879ed0cf11a60bc632122`. |
| Dependency install | **Yes** | `npm ci` installed 260 packages from the tracked `package-lock.json`; no local/file package dependencies were needed. |
| Buildable | **Yes** | `npm run typecheck` and `npm run build` both passed in the isolated clone. |
| Testable | **Partially** | Dispatch integration passed 5/5. The lifecycle suite and full Vitest run require files outside this repository and have existing test failures; exact results are below. |
| Runnable | **UI shell only** | Vite served the UI with HTTP 200. The API proxy failed because the backend cannot import the external Room package. Data and PM services and lifecycle status were not startable from this clone alone. |
| Operational Software Factory | **No, repository alone is insufficient** | Requires the canonical workspace, Room/identity state, Herdr and JobGuardian runtimes, PM database, Nexus historical data and worker/worktree infrastructure. |

The verification used a new C: directory outside the existing Starq workspaces on the same Windows laptop. It is an isolated clean-clone result, **not proof from a second physical computer**. `STARQ_WORKSPACE` and `NODE_PATH` were unset, `server/paths.mjs` resolved the workspace as `UNRESOLVED`, and React/Vitest resolved from this clone's own `node_modules`. The clone did not load source files from the original D: checkouts.

## System requirements

- Windows x64 for the native Command lifecycle and JobGuardian path. The repository has no formal CPU or RAM minimum. Allow at least 1 GB free for the dependency install/build; more is needed for databases and historical datasets.
- Git for Windows and a GitHub identity with read access to the private repository. Git Credential Manager or `gh auth login` can provide HTTPS authentication; do not put a token in a URL or this repository.
- Node.js 24 LTS is recommended; Node 22 LTS is also a maintained choice. `package.json` currently declares `node >=20`, but Node 20 is end-of-life. Use an actively supported LTS release ([Node release status](https://nodejs.org/en/about/previous-releases), [Windows downloads](https://nodejs.org/en/download)). The verified host used Node `v24.15.0` and npm `11.12.1`.
- The verified host used Git `2.54.0.windows.1`; use a current maintained Git for Windows ([official installer](https://git-scm.com/install/windows)).
- Python 3 is needed by some read-only gates. The verified host had Python 3.13.0; set `COMMAND_PYTHON=python` where `python3` is not available.
- Network access to GitHub and `registry.npmjs.org` is needed for clone and install. `npm ci` audited 261 packages and reported 10 advisories (4 moderate, 2 high, 4 critical); `npm audit --omit=dev` reported zero production dependency advisories on the verification date. Advisory counts can change as the registry changes.

## Clone, install, build, and test

Run these commands in PowerShell from a new destination:

```powershell
$repo = "$env:USERPROFILE\src\starq-command"
git clone --branch main https://github.com/Starq-Technologies-Pvt-Ltd/starq-command.git $repo
Set-Location $repo
git rev-parse HEAD
npm ci
npm run typecheck
npm run build
npm run test:lifecycle
npm run test:node
npx vitest run --no-file-parallelism --maxWorkers=1 --minWorkers=1 --reporter=dot tests/dispatch-integration.test.ts
npm test -- --no-file-parallelism --maxWorkers=1 --minWorkers=1 --reporter=dot
```

Use the exact returned SHA in the report when testing a later `main`. `npm ci` is intentional: it removes/recreates `node_modules` from `package-lock.json` and does not rewrite the lockfile. The `test:lifecycle` script now passes a quoted Node test-runner glob so it works through npm's Windows shell; Node documents glob arguments for `node --test` ([Node test runner](https://nodejs.org/download/release/v24.22.1/docs/api/test.html)).

### Clean-clone results

Environment: Windows 11 Home Insider Preview x64, Node `v24.15.0`, npm `11.12.1`, Git `2.54.0.windows.1`.

- `npm ci` — passed; 260 packages installed from the lockfile. npm reported 10 total advisories (4 moderate, 2 high, 4 critical); production-only audit was 0.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- Lifecycle tests — the original package script at the tested upstream SHA failed because it passed the tests directory to `node --test`. This follow-up changes the script to a quoted glob. With the corrected script, 20 tests pass and 8 fail during module loading because `starq-lifecycle` and `herdr-floor` are absent. This does not prove the full lifecycle suite passes.
- Dispatch integration — 5/5 passed with the command above.
- Full Vitest at the upstream SHA — **513 passed, 43 failed, 556 total; 26 files passed, 25 failed (51 files discovered)**. The 43 failures do not exactly reproduce the previous 53-failure run: the clean clone cannot load external workspace modules and fixtures, so fewer tests execute. Failures include missing `agent-comms`, `starq-lifecycle`, and `herdr-floor` modules, an absent absolute-path census fixture, and failing existing architecture, route, and UI assertions. Do not compare the count as a reduction in defects or mark the suite green.
- `npm run command:status` — failed before status evaluation because `starq-lifecycle/runtime-policy.mjs` is not in the repository.
- `node server/data-service.mjs` and `node server/pm-service.mjs` — each exited before binding because their static imports resolve `agent-comms` outside the clone and that package is absent.
- UI-only smoke test — `npm exec -- vite --host 127.0.0.1 --port 15173 --strictPort` served the shell with HTTP 200 and title `STARQ // COMMAND`. `/api/health` returned HTTP 500 through the Vite proxy because the data service could not start. The Vite process was stopped after the smoke test.

The run also created ignored test data under this clone's `data/` directory only. No production database, Room ledger, live Command listener, Herdr process or JobGuardian incident state was opened or changed.

## External components and data needed beyond the clone

These are not Git submodules or tracked files in `starq-command`; the repository does not pin their remotes or revisions. A developer needs separately authorized, versioned copies and the appropriate data before attempting full operation:

- **Canonical workspace and Room:** a workspace root containing `STARQ.md` and `00_STARQ_HQ`, plus the `agent-comms` protocol package, Room ledger, identities, leases, project registry and send scripts. Configure `STARQ_AGENT_COMMS_ROOT` if it is outside the inferred workspace. Room ledger and identity/lease files are private operational state, not source fixtures. Without them, Command reports communications/identity evidence unavailable and refuses Room-backed writes.
- **Lifecycle and containment:** the sibling `starq-lifecycle` and `herdr-floor` source modules, lifecycle configuration/state, and the native JobGuardian binary/records. Set `STARQ_LIFECYCLE_ROOT` and `STARQ_HERDR_FLOOR_ROOT` when those components are elsewhere. Lifecycle gates report absent components as unresolved; they cannot satisfy startup. The JobGuardian executable is not tracked here. The canonical lifecycle expects the full workspace and native containment evidence; do not run `command:start` on an arbitrary clone.
- **Herdr workforce:** the operator-owned standalone Herdr installation and its pinned version/configuration, the Herdr floor broker, registered workers, live sessions/panes and capability mappings. The Command Herdr integration is not a replacement for the standalone operator-owned runtime.
- **PM and control-plane state:** the active `data/pm-operating.db`, control-plane/task store, evidence and lease state are not tracked. A new clone has no production tasks; initialize an isolated scratch database only with the documented PM scratch settings. Do not copy or point at another machine's production DB without authorization.
- **Nexus, Library and Cortex:** historical PM and recovered Nexus source data/indexes are absent (`recovered/nexus` has no tracked files). Library and Cortex code has `STARQ_COMMAND_NEXUS_LIBRARY_ROOT` and `STARQ_COMMAND_NEXUS_GRAPH` overrides. Kanban has `STARQ_NEXUS_DATA_ROOT`, but defaults to `D:\!starq\starqNexus\data`.
- **Building/Hoadha and control-board inputs:** `server/building.mjs`, historical PM projection code, and `src/lib/command-board.ts` contain machine-specific `D:\!starq\...` / `D:\StarqTech\...` paths. Some defaults are configurable; several are fixed. The relevant historical data, Hoadha sources and control-board workspace are not bundled.

See [.env.example](.env.example) for non-secret settings. It is a reference file and is not auto-loaded. `STARQ_WORKSPACE` must point to a real, authorized workspace; pointing it at the repository alone is invalid. Use separate component and data roots. An invalid explicit component root remains unavailable rather than falling back.

## Inspecting the UI without external state

The React shell can be served for visual inspection without starting backend services:

```powershell
npm exec -- vite --host 127.0.0.1 --port 15173 --strictPort
```

Open `http://127.0.0.1:15173/`. API-backed surfaces will be unavailable until the real data, Room and other services are configured. Do not present the shell as a working Command installation.

## Portability defects found

1. The lifecycle npm script targeted a directory that Node 24 on Windows rejected; this commit changes it to an explicit quoted `.test.mjs` glob. Its remaining eight failures are external-module resolution failures, not hidden passes.
2. Static relative imports assume sibling `agent-comms`, `starq-lifecycle` and `herdr-floor` directories at the original workspace depth. They are neither declared as submodules nor installable dependencies.
3. Historical Building, Kanban, PM, and Command-board paths contain fixed D: locations. Some Nexus services have environment overrides; fixed consumers remain non-portable.
4. Several tests require an external census document and canonical historical data, and test results depend on that ambient workspace. The clean clone exposed missing fixtures and test-contract failures.
5. No setup document or `.env.example` previously described these prerequisites. This file documents what is clone-local versus external; it does not fabricate or copy canonical operational state.

## Current portability remediation

The following work updates selected findings from the historical `02402fb` clone report while preserving the separate ownership of external components. The current source SHA is recorded in the corresponding commit and Room report.

- `server/external-components.mjs` resolves `agent-comms`, `starq-lifecycle`, and `herdr-floor` from `STARQ_AGENT_COMMS_ROOT`, `STARQ_LIFECYCLE_ROOT`, and `STARQ_HERDR_FLOOR_ROOT`, or from the verified workspace layout. Missing or invalid components return explicit unavailable/unresolved results. No external component version is pinned by this repository. Record each component's authorized remote URL and commit SHA locally before commissioning.
- The external module/export contract and the exact revision manifest fields to retain are listed in [COMPANION_COMPATIBILITY.md](COMPANION_COMPATIBILITY.md). This documents the required interfaces; it does not claim an unrecorded version is compatible.
- Lifecycle status/gates and the historical closeout evaluator now load external modules through that resolver. Missing dependencies cannot satisfy lifecycle gates. `npm run test:lifecycle` lists and skips only companion-dependent test files when their component is absent; a skip is not a pass. The hard-coded Room script path in the lifecycle infrastructure test is now resolved from the workspace.
- Nexus roots accept `STARQ_NEXUS_WORKSPACE_ROOT`, `STARQ_NEXUS_DATA_ROOT`, `STARQ_NEXUS_FORBIDDEN_MIRROR_ROOT`, and `STARQ_HOADHA_SOURCE_ROOT`. The Command board fetches assets relative to the repository and retains the exact accepted manifest and artifact hashes; its historical absolute manifest paths are provenance, not runtime clone paths.
- PM scratch bootstrap, schema version 3, backup, read-only verification, and migration steps are documented in [PM_DATABASE_SETUP.md](PM_DATABASE_SETUP.md). Current implementation and missing capabilities are classified in [COMMAND_CAPABILITY_GAP_INVENTORY.md](COMMAND_CAPABILITY_GAP_INVENTORY.md).
- [`.env.example`](.env.example) provides non-secret reference settings. [`.github/workflows/portable-checks.yml`](.github/workflows/portable-checks.yml) runs Node 22 and 24 on Windows and Linux with `npm ci`, typecheck, build, resolver regressions, and real production entrypoint probes. It does not start the pinned production lifecycle.

### Remediation verification on the current workstation

- `npm run typecheck` — passed.
- `npm run build` — passed.
- Focused resolver, board integrity, and actual production-entrypoint tests — **19/19 passed**. The data, Building, PM scratch DB, and Herdr entrypoints each started and answered their health route.
- `npm run test:node` — **69 passed, 0 failed** across the 12 Node built-in `.mjs` test files. This command brings the historical PM, Building, Room snapshot, Kanban, Library, Cortex, and PM fidelity tests into the documented test workflow; the prior default Vitest include did not discover those `.mjs` files.
- `npm run test:lifecycle` — **119 passed, 0 failed, 2 skipped**. The two skips are pre-existing child-host platform-conditional tests. Companion-dependent lifecycle suites ran because the companions were available on this workstation.
- Full Vitest — **1,083 passed, 32 failed, 1,115 total across 53 files**. Eleven files retain failures in legacy Phase 3/Phase 7 UI and surface expectations, Building/route fixture behavior, external floor fixture evidence, PM portfolio archive fixture handling, and projection contract states. The suite remains red and is not marked accepted. See [KNOWN_TEST_FAILURES_20261028.md](KNOWN_TEST_FAILURES_20261028.md) for the exact 32 test names.
- Dispatch integration — **5/5 passed** in the full run: exclusive lease, worker/session evidence, contention, Room delivery failure, dirty-work recovery, fresh worktree retry, evidence, review, acceptance, and closure.

The measurements above are from the local canonical-workspace checkout, not a second computer or a clean clone of the resulting SHA. The earlier independent clone result remains separately identified at the top of this file.

## Readiness

An authorized developer can clone the private repository, install dependencies, typecheck, build, run the passing dispatch test, and inspect the static UI from the repository alone. They cannot reproduce the full test baseline or operate the PM/Room/Herdr/JobGuardian Software Factory from this repository alone. Full operation requires the separately versioned Starq workspace, external component repositories and canonical data described above. This clone test ran on the Founder's laptop; repeat it on a second Windows computer before claiming hardware-independent verification.
