# External companion compatibility contract

`starq-command` intentionally does not vendor or merge the Room, lifecycle, or Herdr repositories. Their repositories, versions, and operational data are managed separately. The Command repo has no pinned companion SHAs or declared version constraints beyond the APIs below, so it cannot claim cross-version compatibility until the operator records and verifies the exact companion revisions used.

| Companion | Expected module/API surface | How Command behaves when absent |
|---|---|---|
| `agent-comms` | `scripts/room.mjs` (`readRoomSnapshot` and `ROOM_PATH`); `protocol/v1/hashChain.mjs` (`computeRecordHash`); `protocol/v1/envelope.mjs` (`computeEventId`); `scripts/send.mjs` for authenticated delivery. | Room projections return unavailable; hash verification and authenticated sends fail closed. PM scratch storage can initialize with Room posting disabled. |
| `starq-lifecycle` | `runtime-policy.mjs`: `checkWorkspaceRule0`, `checkObservationRule0`, `checkDevelopmentRule0`; lifecycle runtime/native fixture inputs used by the separate lifecycle test files. | Rule 0 gates are unresolved with the missing root/module reason. A missing policy module cannot satisfy startup. |
| `herdr-floor` | `src/containment-config.mjs`: compatibility/development gates and `containmentOptions`; `src/launcher.mjs`: native containment and process resolution; `src/herdr-status.mjs`: read-only status; registry and historical-closeout modules for recovery verification. | Containment gates are unresolved. Start/recovery operations that require native containment throw/refuse; historical records are not converted into closure evidence. |

## External revision manifest

Before a production or full-floor test, make an operator-controlled manifest outside this repository containing, for each companion:

- authorized repository URL and checkout path;
- exact `git rev-parse HEAD`, branch/tag, and `git status --short` output;
- runtime versions (Node, Herdr, JobGuardian and OS where applicable);
- hashes or verified snapshot identifiers for canonical Room, PM, Herdr and recovered Nexus inputs;
- the Command SHA tested against those inputs and the focused compatibility-test output.

For Git-backed checkouts, gather the source revision records with read-only commands:

```powershell
git -C $env:STARQ_AGENT_COMMS_ROOT rev-parse HEAD
git -C $env:STARQ_AGENT_COMMS_ROOT status --short
git -C $env:STARQ_LIFECYCLE_ROOT rev-parse HEAD
git -C $env:STARQ_LIFECYCLE_ROOT status --short
git -C $env:STARQ_HERDR_FLOOR_ROOT rev-parse HEAD
git -C $env:STARQ_HERDR_FLOOR_ROOT status --short
```

Do not use an unpinned or unverified external checkout for lifecycle actuation. Missing roots are a setup/compatibility gap, not a successful compatibility result.
