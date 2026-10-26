# RUNTIME AND RECOVERY

*Freshness: documents and Room through #9367. **No runtime was started, probed or inspected for this package** (the directive forbids it). Every runtime statement below comes from the cited records; current live state is UNKNOWN until an authorized observer checks it.*

## 1. Operational status at checkpoint

| Item | Status | Source |
|---|---|---|
| Managed floor | **ALL-STOP in force** (#9208). Closure audit SAFE_TO_CLOSE_CURRENT_FLOOR | #9208, #9251/#9252, reaffirmed #9362 |
| Runtime GO | **Not authorized** | every CMD-DI directive #9280–#9354 |
| G-CONTAINMENT (platform gate 4) | **Unresolved**; the 13-case native matrix is not accepted PASS evidence | #9278, #9280, #9288 |
| G-RULE0-OBS | Oct 8 inventory (11,691 entries, zero unresolved) is time-specific and **not a current readiness certificate** | #9278, #9280 |
| Command lifecycle (`Start-Starq.bat` → `scripts/command-lifecycle.mjs`) | Review candidate; **not independently accepted; live use not authorized** | README; `operations/starq-lifecycle/STARQ_LIFECYCLE.md` |
| Observation candidate | Prospective 27-entry manifest consistent; **candidate not accepted** | #9288 |
| Gate A (DP Room watcher) | Preparation only; not armed; expires about 2026-10-17T22:46Z | #9258/#9259 |
| Dual watch (Room + Herdr) | **NOT ARMED.** Earlier bounded observers expired (#9228–#9237) | `FLOOR-LEADER-START-HERE.md` |
| Room writer/gateway | Canonical writer is `agent-comms/scripts/send.mjs` → `room.jsonl`. Do not stop it before evidence is captured | `FLOOR-LEADER-START-HERE.md`; `ONBOARDING.md` |
| Telegram relay | Verbatim forwarding; ~4,000-character truncation open | #9305 |
| `/api/herdr/state` | Returned HTTP 500 during the Wave 1 recovery captures (Vision reproduced it). Cursor reports an already-listening proxy still returning 500 at 10:12Z; a listener therefore appears to be running, but its owner and authorization are UNKNOWN to this package | #9360, #9363 |

## 2. Service dependencies (the Engineering Lesson #001 context)

- Visual evidence for Wave 1 depends on a running local data service (`server/data-service.mjs`) and UI build. Building projection data flows from `server/building.mjs`/`server/building-service.mjs` to `/api/surface` and is consumed by `src/surfaces/project-board.tsx` and Studio surfaces (#9282, #9326).
- **The failure (#9351–#9356):** Cursor completed its tests and safely stopped the temporary services. OpenCode continued capturing against the stopped projection, so 210 captures showed "Building projection unavailable". Vision correctly rejected them. Every worker followed its rules, yet the system failed because nobody owned the shared dependency across the handoff (#9356).
- **Required practice from now on:** a named owner for any temporary service; an explicit handoff before stop; a target-load check (real content, not a 500 or placeholder) before every capture; and the verifier checks what was actually tested (#9354, #9356).
- Ports (historical README): data service 5177, Vite 5173, preview 4173. Port overrides are refused by the canonical lifecycle owner. These may be stale.

## 3. Lifecycle controls and gates

1. The **#9208 ALL-STOP** remains until the Founder lifts it explicitly. Bounded authorizations lift it only for their own named scope.
2. **Local dev services** for verification are permitted only when a directive authorizes them (for example #9348 "only the specified local development services, browser verification…"). Workers must return to idle and leave no stray listeners.
3. **Gates before Studio operation** (corrected package §F): Gate 1 DI implementation (all Waves 0–4, plus mandatory 4-3 build) → Gate 2 independent review → Gate 3 isolated UI preview (separate Founder authorization; not gated by G-CONTAINMENT) → Gate 4 G-CONTAINMENT → Gate 5 source baseline promotion.
4. Commissioning, watcher arming and Herdr control each need a separate Founder directive (#9258, #9259).

## 4. Recovery precautions

- **Paths:** `D:\StarqTech` is canonical. `D:\!starq` is a separate Git repository (branch `pi/company-os-seed-draft`) and **must not be accessed or enumerated**. There is no Git root at `D:\StarqTech`, so there is no git history to recover from. Use the hash manifests (`FLOOR-LEADER-START-HERE.md`; #9282 "git_revision null").
- **Never** clean, reset, stash, rebaseline or "repair" files to make state look consistent. Freeze and report instead.
- **Before a test run:** record the pre-hashes of side-effect files. `data/control-plane.db-shm` changed during a full-suite run, and its pre-state was not captured (#9276).
- **Room integrity:** verify the hash chain from the last checkpoint. Never edit or linearize the ledger; correct by appending (#9262).
- **Evidence custody:** the baseline custody copy is local and NTFS ReadOnly only. It is not WORM and not host-independent (#9267). Active append logs (for example, AG `transcript_full.jsonl`) cannot be hash-anchored (#9326).
- **Cold-start a runtime only after:** (1) a Founder directive for that scope; (2) the pins in `EVIDENCE_INDEX.json` re-verified; (3) the dependency owner named; (4) Herdr checked read-only with `status`, `agent list` and `pane list`, and the result reconciled with the Room (`FLOOR-LEADER-START-HERE.md` dual-watch).
