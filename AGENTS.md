# Starq Command engineering instructions

This repository is the Starq Command application. Before substantive work, read `D:\StarqTech\STARQ.md` and follow its current source-of-truth, lifecycle, preservation, and ERP rules. The canonical workspace is `D:\StarqTech`; `D:\!starq` is read-only history.

Product references:
- `D:\StarqTech\Starq_Development_Studio_Operating_Model_and_SOPs_v1.docx` is the Founder-supplied product baseline (proposed operating model; not a Hermes-team instruction manual).
- `D:\StarqTech\00_STARQ_HQ\corporate-library\STARQ_CANONICAL_CORPORATE_LIBRARY_2026-10-03\05_COMMAND_OS_CANONICAL_DEFINITION.md`
- `D:\StarqTech\00_STARQ_HQ\corporate-library\STARQ_CANONICAL_CORPORATE_LIBRARY_2026-10-03\20_CURRENT_STATE_AND_NEXT_SEQUENCE.md`
- `README.md` contains historical material; use its dated status cautiously and prefer live source/code evidence.

Engineering rules:
- Command is a derived projection, not an SSOT. Keep canonical source provenance visible; never invent current project scope, accepted work, worker availability, activity, or progress.
- Keep historical imports and current authoritative task progress separate. A historical ratio is not live completion. Show UNKNOWN/SOURCE GAP rather than a plausible number when scope or acceptance evidence is missing.
- Work only in the assigned Hermes Kanban package and its isolated Git worktree. Inspect repo instructions, task scope, exact baseline, status, and relevant tests first. Preserve all inherited/uncommitted work and other agents' worktrees.
- No StarqERP feature work, migrations, or behavior changes unless an explicit current Founder authorization permits them. Do not edit Hoadhaa. Do not directly edit canonical Room files, credentials, or databases.
- Do not start, stop, or restart Command/StarqBot/Herdr services or change machine configuration. Current workspace authority allows static/offline work only until a live lifecycle authorization is verified. Do not install dependencies without authorization.
- Avoid commits, pushes, merges, and destructive cleanup unless the assigned package explicitly authorizes them. Never claim your own work accepted; request independent review and report exact evidence.
- Use established APIs and persistence paths; do not bypass data-integrity or authorization checks for test convenience.

Offline verification commands (dependencies already installed): `npm test`, `npm run typecheck`, `npm run build`, `npm run test:node`, `npm run test:lifecycle`. Verify the task's required scope; a passing build alone is not acceptance. Do not run lifecycle commands that start/stop services during static/offline work.

Discovery tools: JevGrep (`jg`) is available in Ubuntu WSL for bounded semantic discovery; it is a lead generator, not a source of truth. Verified access: `wsl.exe -d Ubuntu -- bash -lc 'export PATH="$HOME/.npm-global/bin:$PATH"; jg doctor'`. The Windows `D:\StarqTech\agent-comms\scripts\jev.ps1` Query path currently fails with a PowerShell-to-WSL quoting SyntaxError; until that wrapper is fixed and retested, call `jg` directly through WSL. Use `jg files <narrow-root>` for zero-request inventory, then semantic queries with explicit small ceilings (usually `--max-requests 1-3 --max-source-bytes 100000 --max-output-bytes 10000 --concurrency 1`). Use `rg` for exhaustive exact matches, Git for history, approved Room readers for communications, and direct source/API evidence for validation. Jev may miss files or return only locations; an incomplete/empty result is never proof of absence. Do not search Room JSONL through Jev; its per-file retrieval limit makes it unsuitable. Never enable `--include-sensitive` or transmit credentials. Share concise query/results and cited paths so other workers reuse discovery instead of repeating broad searches.