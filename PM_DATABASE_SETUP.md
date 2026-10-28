# Command PM database setup and recovery

The PM service owns a SQLite database separate from Herdr's `control-plane.db`, the Room ledger, and Nexus source files. `server/pm-service.mjs` currently declares schema version 3. Startup creates missing tables and indexes, applies the guarded-column and Kanban migrations, runs the Nexus fidelity backfill, and checks SQLite and foreign-key integrity. Migrations can update an existing database, so take a consistent backup before upgrading a real installation.

## Isolated development database

Run from the Command repository in PowerShell. The scratch path is explicit, uses the permitted development port range, and turns Room posting off. Do not set `PM_ROOM_LEDGER` for a normal scratch run; if a test needs a Room file, use an isolated fixture under the OS temporary directory and pass that path explicitly.

```powershell
$scratch = Join-Path $PWD '.local\pm-scratch.db'
New-Item -ItemType Directory -Force (Split-Path $scratch) | Out-Null
$env:PM_DB_PATH = $scratch
$env:PM_PORT = '5190'
$env:PM_ROOM_POST = 'off'
node server/pm-service.mjs
```

The service binds loopback. Check `http://127.0.0.1:5190/api/pm/health`; `scratch` must be true, `state` must be `OK`, and Room posting must report `OFF`. Stop the process with Ctrl+C. These settings are for disposable development only. Do not point them at the production database or canonical Room ledger.

## Backup and verification

With the target DB configured using `PM_DB_PATH`, run `node server/pm-service.mjs --backup`. It starts the PM initializer, uses SQLite `VACUUM INTO` to make a consistent snapshot, runs integrity checks on the copy, and prints the path, byte count, and SHA-256. Store the output outside the repository and retain its checksum.

Verify any existing database without opening it for writes:

```powershell
node server/pm-service.mjs --verify 'C:\path\to\pm-operating.db'
```

The command opens read-only and reports integrity, project, task, and history-row counts. A successful SQLite integrity check is not evidence that the database belongs to the intended environment; verify provenance and the file path separately.

## Migration rules

- Schema initialization runs on service start. Migration code is in `server/pm-service.mjs`; record the old and new repository SHAs before a real upgrade.
- Copy the database plus any SQLite `-wal` and `-shm` files only after stopping the owning PM process, or use `--backup` while it is running to obtain a consistent snapshot.
- Keep `pm-operating.db` separate from legacy `pm-board.db`. The importer reads the declared legacy file and recovered Nexus board JSON when those sources exist; it does not make the source files writable.
- Missing historical source data is reported as source drift/unavailability. It is not recreated by this setup procedure.
- Never use Command's PM database path for `control-plane.db`, Room, or Herdr TaskStore data.
