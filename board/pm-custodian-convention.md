# PM board — custodian and operations convention

Authority: Founder Room #9497 (scope #9493, controls #9494). Human-operated only.
No Herdr, B1, ConPTY or autonomous dispatch is involved or permitted.

## What it is

- Three separate boards: **Command** (`#studio/command`), **starqERP** (`#studio/erp/tasks`), **Hoadhaa** (`#studio/hoadha/board`).
- Portfolio: `#studio/projects` (one row per project, never summed across projects).
- Store: `data/pm-board.db` (SQLite, WAL). Separate from `data/control-plane.db`, which this service never opens.
- Service: `server/pm-service.mjs` on `127.0.0.1:5176` only.

## Who may do what

- "Acting as" is chosen on the board and must be an active identity in `agent-comms/protocol/v1/identities.json`. **It is attribution only. It is never proof.**
- Proof is the Room. Every Room reference is checked against `room.jsonl`: the record hash is recomputed with the Room's own `computeRecordHash`, the link to the previous record is checked, and the broker's `authorityDecision` must be allowed.
- R1: an **authorization** reference must resolve to an authenticated `ROOT_GENESIS` (Founder) record. A worker event cannot authorize a task. Work starts (`IN_PROGRESS`) only with such a reference.
- R2: **ACCEPTANCE** needs a linked evidence record sent by the assigned verifier (who must differ from the owner, DEC-072), that names the task id, and that was received after the task entered VERIFICATION. **CLOSED** needs a linked evidence record from a `ROOT_GENESIS` identity that names the task id and was received after the task entered ACCEPTANCE. Owner and verifier are locked once a task is in VERIFICATION or ACCEPTANCE.
- R3: a history row is **POSTED** only when its Room eventId and record hash are resolved from the ledger. Otherwise it stays **PENDING** with the reason. A retry first looks for the event's `pm-event-id` in the ledger, so a lost receipt never causes a duplicate post.
- **Residual limitation (recorded per #9503):** identity here is the Room's identity. Anyone who can post to the Room as a handle (the `send.mjs` identity lease on this machine) can produce that handle's evidence. This is the Room's trust level, not stronger. A per-user login would be a separate Founder decision.
- T4 (acceptance walk) runs on a non-held project. ERP stays `ON_HOLD` (DEC-100) and cannot pass READY.
- starqERP follows the live hold in `starqerp-control-board/contract.json` (DEC-100). While `ON_HOLD`, ERP tasks can be planned but cannot pass READY. If the contract is unreadable the service fails closed.

## Progression

BACKLOG → READY → IN_PROGRESS → REVIEW → VERIFICATION → ACCEPTANCE → CLOSED.
Any open state may go to BLOCKED or FOUNDER_GATE (note required) and resumes to its prior state.
REVIEW / VERIFICATION / ACCEPTANCE may be rejected back to READY (note required; recorded as REJECTED).
Closed tasks are immutable. Tasks are never deleted.

## Source tasks and gaps

No task is imported or invented. Gaps are shown on each board and in the portfolio:

- Command: 33 historical CMD-DI rows stay in `board/command-board.json` (pinned, read-only). Moving any of them needs per-task Founder authorization with a Room reference, entered by hand.
- starqERP: `starqNexus/data/starq-erp-tasks.json` is absent; D2 (437 vs 407) is unresolved.
- Hoadhaa: `starqNexus/data/hoadha-*.json` and `03_PROJECTS/hoadha/` are absent.

## Room traceability

Every create, status change, assignment and Room link posts a `PM TASK EVENT` record to Room (as the configured posting identity) and stores the returned Room sequence on the history row.
If a post fails, the row stays **PENDING** and visible on the board (banner, card marker, history chip). Use **Retry Room sync** on the board, or `POST /api/pm/room-sync/retry`. Pending posts are also retried at service start. Nothing is silently dropped. A PM Room record reports an event; it never authorizes work.

## Start / stop (local, supervised)

```
node server/data-service.mjs     # :5177
node server/pm-service.mjs       # :5176  (npm run pm:start)
npx vite                         # :5173
```

Stop with Ctrl+C in each window or by ending those three processes. Herdr (:5179/:5188) and Building (:5178) are not started.

## Disposable verification instance

For independent verification without touching production: set `PM_DB_PATH` (absolute `*.db`, disposable) and optionally `PM_PORT` (5190-5199 only; refused without `PM_DB_PATH`), and `PM_ROOM_POST=off` to stop Room posts. Example: `PM_DB_PATH=<abs>\x.db PM_PORT=5191 PM_ROOM_POST=off node server/pm-service.mjs`. `PM_ROOM_LEDGER` (scratch only) points the instance at a copy of the ledger for tests that need records from other identities. The UI addresses it with `?pm_port=5191` on the hash (for example `#studio/command?pm_port=5191`) and shows a SCRATCH INSTANCE chip. Production stays on :5176 and is never interrupted.

## Preservation and recovery

- Backup (service may be running): `node server/pm-service.mjs --backup` writes `data/pm-board-backup-<timestamp>.db` and prints its SHA-256 and integrity result.
- Verify any copy: `node server/pm-service.mjs --verify <file>` (read-only).
- Restore: stop the service, run `--verify` on the chosen backup, keep the current `pm-board.db*` files aside (rename, do not delete), copy the verified backup to `data/pm-board.db`, delete stale `pm-board.db-wal` / `-shm` only after the rename, start the service, check `GET /api/pm/health` (`integrity: ok`) and compare `GET /api/pm/export` `sha256`.
- Off-drive copy of `_backup/` and the `data/pm-board-backup-*.db` files is a Founder-authorized action, not performed by this service.
- The service refuses to serve if `PRAGMA integrity_check` fails (state UNAVAILABLE).

## Protected, never touched

`board/command-board.json`, `board-manifest.json`, `board-schema.json`, `board/snapshots/`, `continuity/TASK_LEDGER.json`, `data/control-plane.db*`, `agent-comms/room.jsonl` (append only, through `send.mjs`), `evidence/`, `contract.json`, `activity.json`, `server/data-service.mjs`, `vite.config.ts`.
