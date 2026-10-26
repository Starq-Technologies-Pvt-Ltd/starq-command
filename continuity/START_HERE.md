# START HERE — Starq Command Continuity Package

**Package location:** `D:\StarqTech\00_STARQ_HQ\operations\starq-command\continuity\` (WSL: `/mnt/d/StarqTech/00_STARQ_HQ/operations/starq-command/continuity/`)
**Checkpoint:** canonical Room **#9367**, recordHash `1bd33bbdbb14adf557eb5a1063246d6b54b6bbfd186a16c65ffc7ff773acf9a1` (2026-10-12T10:57:45Z). Corrected under Founder #9367 after the Codex review #9366
**Latest independent verdict included:** Vision **#9360** (Wave 1 evidence)
**Author / authority:** Elder (Room identity `claude`, alias `@elder`), under Founder Room **#9361**, with integration terms from **#9362**. This is documentation authority only. It does not confer engineering or organizational authority.
**Package status:** Codex #9366 ACCEPTED the manifest/checkpoint integrity and REJECTED the cold-start procedure as written. This revision corrects that procedure under #9367 and is parked again for review. It is **not self-accepted**.

---

## 1. What this is

Starq Command is the Founder's operating surface for Starq Technologies, a read-only *derived projection* of canonical company truth (see `PROJECT_IDENTITY.md`). This package lets a new assistant recover the programme without conversation history, agent memory or the Founder's recollection.

**Golden rule:** the canonical Room (`D:\StarqTech\agent-comms\room.jsonl`) outranks this package. If a newer Room record disagrees with anything here, the Room wins and this package is stale.

## 2. Reading order

| # | File | Answers |
|---|---|---|
| 1 | `START_HERE.md` | How to validate, reconcile and act safely |
| 2 | `PROJECT_IDENTITY.md` | What Command is, its architecture and doctrine |
| 3 | `CURRENT_STATE.md` | What is accepted, rejected or blocked right now |
| 4 | `TASK_LEDGER.json` | Every task ID with state, owner, blockers, dependencies and sources |
| 5 | `OPEN_BLOCKERS.md` | What stands in the way, and how each blocker closes |
| 6 | `NEXT_EXECUTION.md` | What is (and is not) authorized next |
| 7 | `DECISION_LEDGER.md` | Founder decisions and supersession chains |
| 8 | `EVIDENCE_INDEX.json` | Artifact paths, sizes, SHA-256 values and test outcomes |
| 9 | `WORKFORCE.md` | Who is who, and the limits of their authority |
| 10 | `RUNTIME_AND_RECOVERY.md` | Services, stops, gates and recovery precautions |
| 11 | `HISTORY.md` | Chronology, failed attempts and lessons |
| 12 | `CONTINUITY_MANIFEST.json` | Inventory and hashes of these files |

## 3. Status vocabulary (used everywhere)

- **ACCEPTED**: an independent verifier said ACCEPT in Room, within exactly the scope stated. *Prospective* acceptance covers the current bytes/behaviour only; it never recovers historical dispatch, authorship or acceptance.
- **VERIFIED**: re-checked by the package author against disk/Room at the checkpoint. This is not an acceptance.
- **REJECTED**: the latest independent verdict is REJECT.
- **BLOCKED**: waiting on a named prerequisite or decision.
- **PROPOSED**: planned or mentioned, with no Founder execution authorization in Room.
- **UNKNOWN**: evidence absent, unlocated or contradictory. Do not infer.
- **SUPERSEDED**: replaced by a cited later record.
- **CLOSED**: closed by a Founder scope decision rather than by implementation acceptance.

"Implementation exists" (files present, hashes match) is **never** the same as "accepted".

## 4. Cold-start procedure

Steps 1–6 are **strictly read-only and report-only**. Run them in order. They never create, edit, move or delete any file in this package, the repository or the Room. Writing anything requires passing the separate **Step 7 write gate**.

**Step 1 — Validate the package.**
```bash
cd /mnt/d/StarqTech/00_STARQ_HQ/operations/starq-command/continuity
python3 -I -c "import json;[json.load(open(f)) for f in ('TASK_LEDGER.json','EVIDENCE_INDEX.json','CONTINUITY_MANIFEST.json')];print('JSON OK')"
python3 -I -c "
import json,hashlib
m=json.load(open('CONTINUITY_MANIFEST.json'))
for f in m['files']:
    if f['path']=='CONTINUITY_MANIFEST.json': continue
    b=open(f['path'],'rb').read()
    print(f['path'], 'OK' if hashlib.sha256(b).hexdigest()==f['sha256'] and len(b)==f['bytes'] else 'CHANGED')"
```
`CHANGED` means a file was edited after the manifest was generated. Treat that file as unverified until you reconcile it. Note that `CONTINUITY_MANIFEST.json` cannot contain its own hash; its hash is posted in the Room submission record.

**Step 2 — Check internal consistency.** Every `dependsOn` entry in `TASK_LEDGER.json` must name an existing task `id`. The manifest records the result of this check (`validation.taskDependencyCheck`).

**Step 3 — Reconcile against the Room.**
```bash
python3 -I -c "
import json
r=[json.loads(l) for l in open('/mnt/d/StarqTech/agent-comms/room.jsonl',encoding='utf-8') if l.strip().startswith('{')]
r=[x for x in r if x.get('brokerSequence')]
print('head',r[-1]['brokerSequence'],r[-1].get('recordHash'))
for x in r:
    if x['brokerSequence']>9367: print(x['brokerSequence'],x['event']['senderHandle'],x['event']['body'][:160].replace(chr(10),' | '))"
```
- If the head is still #9367 with the hash above, the package is current.
- If newer records exist, read them **in full**, starting with Founder (`mustarq`) records and then independent verdicts. **Do not modify any canonical file.** Instead, prepare a **checkpoint-difference report** containing:
  1. the package checkpoint (seq and hash) versus the current Room head (seq and hash);
  2. each newer record (seq, sender, one-line subject);
  3. the ledger rows and narrative sections each record would affect, with the **proposed** new value and the superseding seq;
  4. whether any newer record names an authorized package owner and scope.
- Until Step 7 passes, treat the package as stale wherever the difference report says it is affected, and use the Room records directly.
- Verify chain continuity: `recordHash(n) == previousRecordHash(n+1)`. Freeze and report a break; never repair the ledger.

**Step 4 — Re-verify the critical pins** listed in `EVIDENCE_INDEX.json` (`rehashedThisPackage: true` entries) with `sha256sum`. A mismatch means the repository changed after the checkpoint. Treat it as new, unaccepted state and find the Room record that explains it.

**Step 5 — Establish authority before acting.** Founder authority is `mustarq` at ROOT_GENESIS (`agent-comms/protocol/v1/identities.json`). A task is authorized only by an explicit Founder directive naming the task, the assignee and the scope. Earlier acceptance never authorizes a later task (the Room repeats this rule in #9277, #9289 and #9309).

**Step 6 — Find the next permitted action** in `NEXT_EXECUTION.md`, adjusted by the Step 3 difference report. If it says *awaiting Founder decision*, your only permitted action is to report (in Room, if you hold a Room identity) and stop.

**Step 7 — Write gate: before ANY change to canonical package files.** Proceed only if **all** of these hold. Otherwise report the difference and stop.
1. A Founder (`mustarq`, ROOT_GENESIS) Room directive explicitly names **you** as the package owner/writer, or authorizes you for a named bounded correction. Examples: #9361 and #9362 (Elder sole owner); #9367 (Elder bounded correction).
2. The change is inside that directive's stated scope.
3. No other writer currently holds the package (#9362: one writer only).
4. You have read every Room record newer than the package checkpoint.

After passing the gate, follow §6. The canonical-file write is the **last** action, followed by manifest regeneration and full validation.

## 5. Standing restrictions at the checkpoint

These are restated in nearly every Founder directive from #9258 through #9362:
- Room **#9208 ALL-STOP** remains in force for managed-floor operations (reaffirmed at #9339, #9344, #9348, #9354 and #9362).
- No access to or enumeration of `D:\!starq`. It is a separate path, read-only history, and not the canonical root.
- Do not modify the 126-file recovery baseline, the protected pins, frozen contracts or historical manifests. Do not fix or weaken the F3–F8 known-red tests.
- No CMD-DI-3-4, no Wave 2 implementation, no Wave 4, no Observation candidate acceptance, no runtime GO and no operational Studio commissioning.
- No watchers, scheduled jobs or background services (#9359).
- Builders never self-accept. Every deliverable is parked for a named independent verifier.

## 6. Maintaining this package incrementally

0. **Precondition:** the §4 Step 7 write gate has passed. A cold-start reader without that authorization must not use this section.
1. Do not rebuild from scratch. Append new facts and mark superseded ones with the superseding seq.
2. Before editing, copy the current files to `_prior/<author>-<YYYYMMDD>/` and write a `SHA256SUMS` there.
3. Update `TASK_LEDGER.json` and `EVIDENCE_INDEX.json` first, then the narrative files.
4. Update the `checkpoint` blocks (`latestRoomSeqObserved`, `latestRoomRecordHash`) in both JSON ledgers, and update this file's header.
5. Regenerate `CONTINUITY_MANIFEST.json` (file sizes and SHA-256 values) last. Re-run §4 Steps 1–4, re-hash every changed file, then post the new manifest hash to Room.
5a. Timestamps (`generatedAtUtc`) must be **measured** (system clock at write) or declared unverified. Never estimate them. The Room seq/hash checkpoint is the authoritative freshness marker.
6. Only one writer may work on the canonical package at a time (#9362). Support work goes to a separate, noncanonical location.

## 7. Known limitations of this checkpoint

- The pre-correction state (checkpoint #9364) is preserved at `_prior/elder-20261012-cp9364/` with SHA256SUMS.
- Support reports from Cursor (#9363) and AG (#9364) were hash-verified and integrated only where primary records confirmed them. Rejected claims are listed in `HISTORY.md` §8.
- Phase 6–7 status, the Minimum Operational Development Studio definition and the Aikido mission scope are not defined in any located record (see `OPEN_BLOCKERS.md`).
- The workforce roster snapshot is from 2026-10-05 (Room #8779), and live Herdr state was not inspected (that is outside the documentation scope).
- The prior Deadpool draft is preserved at `_prior/deadpool-draft-20261012/`. Its unsupported claims were corrected; `HISTORY.md` §7 lists them.
