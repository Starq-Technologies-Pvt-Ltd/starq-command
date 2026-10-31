# Claude Code — independent architecture and reliability package

**Branch:** `claude/command-convergence` (worktree `.claude/worktrees/starq-command-review-dc6d5b`), based on `2746c90`. **Code commits for review (T1):** `2664894` test isolation · `9e7a829` lifecycle recovery · `6acde9e` ungated start + local-evidence fix · `4706b47` scratch-port fix. Review with `git log 2746c90..4706b47` and `git diff 2746c90 4706b47`. Isolated until independently reviewed and integrated by Vision (merge train T1/T3 in `06_INTEGRATION_AND_ACCEPTANCE.md`). Founder direction (31 Oct 2026): every local commit on this branch is pushed to GitHub (`origin/claude/command-convergence`, draft PR) so local and GitHub stay identical. Claude does not merge into `main` or any shared branch, and does not post in Room under any identity.

## Delivered in this candidate (train T1)

| Item | Change | Proof |
|---|---|---|
| Reboot recovery (C1) | `scripts/lifecycle/boot-closeout.mjs` (new). `owner.mjs` `treeClosed` consults it only after the kernel proof declines and journals the basis. Refuses on any unknown (no timestamp, unreadable uptime, live matching root, occupied port, failed inspection, skew margin). | 13 unit tests. A copy of the real pre-reboot STOP_INCOMPLETE state settled to STOPPED; `start` then proceeded (it later failed at `herdr`, see CV-C1b). |
| Founder-authority correction (C6) | `LOCAL_LEDGER` refs never attest (`gated-lifecycle.mjs`) and are never root (`pm-service.mjs` `localLedgerRef`). Unused `isFounderHandle` removed. | Regression test fails on the original gate and passes now. Live scratch probe: `actor=mustarq` → `root_authority:false`. |
| **Ungated task start (Founder D2)** | `evaluateStageTransition` no longer requires `room_authorization_ref` to enter IN_PROGRESS (dependency check kept). The requirement is preserved behind an explicit `startRequiresAuthorization` policy flag for enterprise mode. The audit event records `start_authorization: NOT_REQUIRED_LOCAL_POLICY` or `ROOM_AUTHORIZED`. Closure still requires Room authorization plus authenticated Founder evidence. | gated-lifecycle tests for both policies, plus a real-browser start on scratch (see the commit message). |
| Scratch-mode safety (C2/C12) | `pmPort()` keeps the scratch port per tab; captured at entry in `src/main.tsx`. | 6 tests; browser network log shows all PM calls on :5191 after navigation. |
| Reproducible verification (C12) | `tests/support/workspace.ts` + `@workspace` alias; `.gitattributes` for byte-pinned board assets; stale `phase2` assertions rewritten to the reporting contract; hermetic `recoverForce` test. | vitest 1,154/1,154 from an isolated worktree with no env vars. |

## Next (in priority order)

### CV-C1b — Ownership without the OS connection table (unblocks supported start)
*Finding:* on this laptop `netstat` and `Get-NetTCPConnection` report wrong PIDs and states for verified-serving services (e.g. data :5177 shown as `CLOSED 34084` plus `LISTENING 0`). The start-time rule "the listener must be owned by the launched PID per the OS table" therefore cannot pass. No parser change fixes it (my earlier attempt to do so was wrong and is reverted).
*Design:* the lifecycle child host already answers a MAC-authenticated identity challenge (`control.mjs proveInstance`: nonce, pid, instance_id, HMAC with the launch token). Extend that reply with the addresses the child's HTTP server actually bound (`server.address()`, captured in the child host). Readiness becomes: instance proven by MAC **and** child reports `127.0.0.1:<configured port>` **and** health on that port passes. The OS table stays a *negative* pre-flight signal only: a foreign listener seen before launch still refuses start.
*Risk:* the child host lives in the `starq-lifecycle` companion (external component). The change must be versioned there and declared in `COMPANION_COMPATIBILITY.md`.
*Accept:* J1 on the laptop. A negative test where a foreign process holds :5176 → refused. A fake child reporting a different port → refused.

### CV-C1c — `command-local/v1` profile + one-click launcher + backup on start
- Profile: required {pm, data, ui}; optional {building, herdrBroker, herdr} (started if available, never block READY). Herdr gates apply only when Herdr is enabled.
- `D:\StarqTech\Start-Command.bat`: idempotent start, then open the browser. If already running, just open it.
- On start: `PRAGMA integrity_check`, then `VACUUM INTO data/backups/pm-operating-<ts>.db` (keep 14), then start PM. A `restore` command (stopped state only).
- Accept: J1, J9, J10.

### CV-C2b — Identity-optional write boundary
`handleField`/`knownHandles` validate against `org_people` first. Room's `identities.json` becomes optional enrichment, so a missing file no longer 503s ordinary writes. Room-authenticated paths (`parseRoomRef`, attestation) still fail closed without it. Coordinated with CV-AG2 (registry data).

### CV-C2c — Founder presence via Windows Hello (only if the Founder approves F1)
WebAuthn platform passkey registered once for the Founder; the PM service verifies assertions (challenge bound to the task ID and target stage). It can satisfy acceptance and closure locally. The assertion is stored as authenticated evidence (`authority: 'WEBAUTHN_FOUNDER'`). Agents can't produce it headlessly.

### CV-C3b — Standalone fixture workspace + E2E harness
A fixture workspace (STARQ.md + 00_STARQ_HQ marker, no agent-comms, no Herdr) and a scripted scratch-instance launcher and teardown for real-browser journeys (Playwright, subject to F3). command-qa owns the journeys (CV-V1).

## Not mine (to avoid collisions)
Org, workforce, project and milestone APIs and automation (AG). Any `src/surfaces/**` work (Cursor). `pm-service.mjs` routes outside the authority and identity functions (AG through `pm-ops-routes.mjs`).
