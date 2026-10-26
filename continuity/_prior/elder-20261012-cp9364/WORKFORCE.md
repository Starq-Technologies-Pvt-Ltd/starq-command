# WORKFORCE — people, AI seats, harnesses and authority limits

*Sources: `agent-comms/protocol/v1/identities.json` (sha256 `4b23e2dc…`), `operations/workforce/digital-workforce-hr-roster.json` (snapshot 2026-10-05 at Room #8779, sha256 `c527d5c3…`), and CMD-DI Room assignments #9258–#9362. The roster snapshot is **stale** relative to checkpoint #9362. Roster statuses (ACTIVE/IDLE/DORMANT) are as of 2026-10-05; live Herdr state was not inspected for this package.*

## 1. Authority

- **Founder: `@mustarq`** (aliases `@musthaq`), identity `ident_01J6MST0000000000000000009`, level **ROOT_GENESIS**. This is the only issuer of task authorization, gate approvals, waivers and commissioning. Room events have no detached signatures (signatureAlgorithm none); authority is the broker's `authorityDecision` metadata (#9290, #9295).
- **No delegate authority exists for the CMD-DI programme.** Workers and verifiers cannot approve gates, waive criteria or authorize each other. A verifier ACCEPT is not a Founder approval (#9309, #9310).
- **Documentation authority ≠ engineering/organizational authority** (#9359, #9361).

## 2. Seats active in the Command programme (Room #9258–#9362)

| Handle | Roster role (2026-10-05) | Harness / host (declared) | CMD-DI function observed in Room | Limits |
|---|---|---|---|---|
| `@claude` = **Elder** | Senior Engineer / Duty Operator | Claude Code CLI / WSL | Continuity package owner (#9361, #9362). Oversight role under Gate A prep with no execution assignment (#9258) | Sole writer of the canonical continuity package; documentation only |
| `@codex` | Security Remediation & Migrations | Codex CLI / Windows | Builder/investigator: 3-3 pins and manifest, 3-4 preflight, Wave 1–2 reconciliation; Gate A watcher builder (#9258); accountable owner of any authorized `server/floor.mjs` work (#9327); **independent reviewer of this package** (#9362) | Not eligible to review its own work |
| `@opencode` | Playwright E2E & Autonomous Testing | OpenCode CLI / Windows | Verifier (126 baseline, 3-3, P3A); builder of 3-2c; Wave 1 1-4/1-5 evidence | Must not self-accept; seat ≠ `opencode2` (#9262) |
| `@vision` | Founder-Facing Comms, Status & Handoffs | Hermes Agent (profile vision) / Windows | Primary independent verifier for Waves 0–1 and 3. **Appointed design/UX sign-off reviewer for CMD-DI-1-4** (#9344) | Must not implement or modify the work it reviews |
| `@cursor` | Pair Programming & Live Refactoring | Cursor IDE / Windows | Wave 1 engineering: 1-1 tests, 1-3 typography and 320px (#9348–#9355); current-state support report (#9362) | Approved UI/CSS scope only; no protected server files |
| `@antigravity` (AG) | Finance Kernel & Core Architecture | Antigravity / Windows | Evidence custody (#9266, #9268); 0-3 coordination memo and P3A matrix; historical support report (#9362) | Proposals are not decisions (#9327) |
| `@deadpool` (DP; alias `@hermes`) | WSL Hermes Operator | Hermes Agent (profile deadpool) / WSL | Gate A commissioning subject (#9258); author of the incomplete continuity draft (#9358) | Not a default implementer; no self-certification; Gate A inactive |
| `@goose` | Temporary Founder-Directed Engineering Agent | Goose / Windows | No CMD-DI role in #9258–#9362 | FOUNDER_DIRECT level |
| `@pi` | Lightweight Engineering Agent (restricted) | Pi CLI / Windows | Closure-era reviews; hit an OpenRouter free-tier 429 limit (#9231) | No blanket verifier eligibility |
| `@vscode` / Copilot | (Copilot identity missing from registry) | VS Code / Windows | Closure-era audit (#9202, #9203) | Identity mapping unresolved (roster conflicts) |

Other registry identities: `alfred`, `athena`, `bursar`, `openclaw`, `devin`, `opencode2`, `mastracode`, `qoder` and `format-watchdog` are active; `ali` and `nexus` are retired. None appears in the CMD-DI record since #9258.

## 3. Unresolved identity conflicts (from the roster)

- `@copilot` is a live Herdr seat but has no `identities.json` record.
- The Herdr agent name `hermes` on pane `w1:pC` is labelled Vision. Do not merge Vision and Deadpool even though they share the Hermes harness.
- The registry alias `@hermes` maps to Deadpool, but `scripts/room.mjs` has a legacy `hermes→hermes` override.
- Deadpool's Herdr binding to pane `w1:pF` was unverified at closure (`FLOOR-LEADER-START-HERE.md`).

## 4. Capacity and cost discipline

- Paid-seat conservation incident: #9206/#9207 (Elder's weekly usage was exhausted in four days; the Founder warned about exhausting L1 seats).
- Unknown or stale quota never authorizes paid-seat use (#9258).
- Usage reports: `operations/workforce/FLOOR-USAGE-AND-TEAM-STATUS-20261007-0139PKT.{md,json}` (stale).

## 5. Operating rules for any seat

1. Claim or renew a lease before posting: `node agent-comms/scripts/send.mjs --whoami <handle>`. Use a stable `--instance` (`ONBOARDING.md` step 9).
2. Use one owner per task, a distinct verifier and WIP=1 (`FLOOR-LEADER-START-HERE.md`).
3. Report only in Room, and go idle after reporting (#9348, #9362).
4. Avoid raw double quotes in bodies passed through Windows arguments; they truncated #9261 (OpenCode #9262). Confirm the body arrived intact after posting (a truncated #9357 was flagged at #9360).
