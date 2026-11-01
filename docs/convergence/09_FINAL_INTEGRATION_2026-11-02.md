# Final integration checkpoint - 2 Nov 2026

Base: PR #18 head `fcd9b50` (contains Cursor's PR #16 `1770261` and AG's PR #17 `9be6733` work; my lifecycle fixes `db9d620`, `7ddccf8` are ancestors).
Engineering SHA at the time of these results: `0b6a641` (this document is committed after it; code is unchanged).

## What was found and fixed on the real Windows path

| Defect | Evidence | Fix |
|---|---|---|
| Stop never completed for PM (`STOP_INCOMPLETE`) | PM log: "no supported server shutdown adapter"; PM exports no server | child host closes the servers the component bound (`72f7860`) |
| `local-status` never RUNNING / next start refused "5177<-pid 0" | OS TCP table lists live listeners as pid 0 and keeps LISTENING rows for dead sockets; bind() succeeds | status uses the child's authenticated bound proof, table is a veto only; pid-0 rows dropped (`fa71249`) |
| Local profile refused by release gate; data 503 in a non-Starq workspace | earlier in the session | tier-based gate, data health contract (`28cca3e`, `e159f89`) |
| Stop depended on the runtime probe | earlier | containment accessors split (`4831cda`) |

Each product fix has a test that fails when the fix is reverted.

## Acceptance (reproducible: `node scripts/acceptance/windows-lifecycle-acceptance.mjs full --ws <dir under _scratch> --seed <backup>`)

Run k at `0b6a641`: 64/64 checks. One-click `Start-Command.bat` -> RUNNING; data, pm, ui each proven bound by their own control pipe; UI HTTP 200; PM serves the disposable DB; stop leaves no owned process and frees ports; restart; PM killed by exact PID -> status not RUNNING -> supported stop settles -> clean restart -> final stop; no process names the workspace afterwards; project/task/history counts unchanged; startup appended no provenance rows (CV-C6 effective on the startup path the app uses); the Founder's live database byte-identical before and after.

## Suites on `0b6a641`, STARQ_WORKSPACE unset

typecheck 0; build 0; vitest 1211/1211; node 142 pass / 0 fail / 1 skip; lifecycle 167 pass / 0 fail / 4 skip (child-host tests need `STARQ_AUTHORIZED_LIVE_TESTS=1`, run separately: pass); functional acceptance 13/13.

## Incident disclosure

An earlier harness run (`33e13fa`) started a disposable stack whose workspace_root was the real workspace, so PM opened the Founder's live `pm-operating.db`. Nothing was lost: integrity ok, FK clean, every business table's original columns identical to the 1 Nov backup, CV-C6 refused to seed or import. Changed: `imported_at` re-stamped on 4 `pm_source_records` and 19 `pm_import_sources` rows; additive `legacy-seeded` marker, 4 tables, 22 columns; WAL checkpoint. Cause and fix: isolation is decided by `workspace_root` (the owner passes it as `STARQ_WORKSPACE`); harness fixed in `6447fa9` and verified (live hash `d9cafbefe6d95658...` unchanged across all later runs). Fresh restore point: `D:\StarqTech\Archives\starq-command\preservation-20261101\backups-after-live-open-20261102\`.

## Not claimed

- Independent acceptance: Copilot's retest of `1770261` (Room #17423) and final acceptance are outstanding. Builder does not self-accept.
- The daily driver runs at the development containment tier until an independent exact-build release proof exists.
- A real-browser walkthrough of the disposable stack was not repeated in this pass; HTTP checks only.
- Orphan PM pid 29812 (:5191, command-qa scratch DB) belongs to another session; untouched.
