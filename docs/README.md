# Starq Command — documentation index

This is the navigation hub for Starq Command's documentation. It separates
**current** product and engineering guides from **preserved historical records**.

## Start here

- [**Project README**](../README.md) — what Command is, its design principles,
  architecture at a glance, quick start, and operating status.

## Current guides

| Document | What it covers |
|---|---|
| [Architecture overview](ARCHITECTURE.md) | Services, the two data regimes (writable records vs. read-only projections), honesty states, front end, lifecycle, and testing — grounded in the code. |
| [Quick start](QUICKSTART.md) | Disposable vs. live operation, every verification command, and troubleshooting. |
| [Documentation audit (2026-11-02)](DOCUMENTATION_AUDIT_2026-11-02.md) | Public-facing disclosure, accuracy, and broken-link review, with recommendations for Founder decision. |
| [Repository presentation proposal](REPOSITORY_METADATA.md) | Proposed GitHub About text, topics, and navigation. |

## Governance and process (drafts)

| Document | Status |
|---|---|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Contribution process. Draft. |
| [SECURITY.md](../SECURITY.md) | Security reporting. Draft; no SLA claimed. |
| [NOTICE.md](../NOTICE.md) | IP notice. Draft; license and ownership pending Founder approval. |
| [AGENTS.md](../AGENTS.md) | Engineering rules for contributors (human and AI). |

## Preserved historical records

These are kept verbatim as engineering evidence of how the system reached its
current state. Prefer the current guides above for the present picture; consult
these for history, provenance, and acceptance lineage.

### Convergence and integration (`docs/convergence/`)

The multi-agent convergence effort that produced the current integrated system,
in sequence: `00_MASTER_PLAN` → `01`–`06` handover and acceptance packages →
`07_CONVERGENCE_ASSESSMENT_2026-11-01` → `08_EMPTY_START_PRESERVATION` →
`09_FINAL_INTEGRATION_2026-11-02`, plus the `API_CONTRACT_LOCAL_OS`,
`CLAUDE_INDEPENDENT_REVIEW_2026-10-31`, and the `HANDOVER_*` packages.

### Acceptance evidence

- [`artifacts/acceptance/ACCEPTANCE_REPORT.md`](../artifacts/acceptance/ACCEPTANCE_REPORT.md)
  — twelve-journey functional acceptance matrix and findings.
- [`STARQ_COMMAND_BROWSER_ACCEPTANCE_CVC_20261101.md`](../STARQ_COMMAND_BROWSER_ACCEPTANCE_CVC_20261101.md)
- [`KNOWN_TEST_FAILURES_20261028.md`](../KNOWN_TEST_FAILURES_20261028.md)

### Phase and design records (repository root)

Dated records including the `PHASE7_*`, `DESIGN_INTEGRATION_*`, `WAVE_*`,
`COMMAND_*` audit/feasibility, and handover documents are retained in the
repository root. They are historical; their dated status should be read in
context and cross-checked against the live code.

> Reorganizing these into a dedicated history tree is a possible future cleanup,
> but it would move files and is intentionally out of scope for this
> documentation pass, which preserves all historical records in place.
