#!/usr/bin/env node
/**
 * STARQ // COMMAND — Organization Import CLI (CV-AG8).
 *
 * Imports an organization snapshot JSON file into a target PM database.
 * Usage: node scripts/import-organization.mjs --snapshot <file> [--dry-run] [--on-conflict abort|skip] [--db <file>]
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importOrganization } from '../server/pm-import.mjs';
import { resolveWorkspace, abs } from '../server/paths.mjs';

function parseArgs() {
  const argv = process.argv.slice(2);
  let snapshot = null;
  let dbPath = null;
  let dryRun = false;
  let onConflict = 'abort';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--snapshot' && argv[i + 1]) {
      snapshot = path.resolve(argv[++i]);
    } else if (arg === '--db' && argv[i + 1]) {
      dbPath = path.resolve(argv[++i]);
    } else if (arg === '--on-conflict' && argv[i + 1]) {
      onConflict = argv[++i].toLowerCase();
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (!snapshot) {
    console.error('Error: --snapshot <file> is required.');
    console.error('Usage: node scripts/import-organization.mjs --snapshot <file> [--dry-run] [--on-conflict abort|skip] [--db <file>]');
    process.exit(2);
  }

  if (!dbPath) {
    if (process.env.PM_DB_PATH) {
      dbPath = path.resolve(process.env.PM_DB_PATH);
    } else {
      const workspace = resolveWorkspace();
      dbPath = workspace.root ? abs(workspace.root, 'data/pm-operating.db') : path.resolve('data/pm-operating.db');
    }
  }

  return { snapshot, dbPath, dryRun, onConflict };
}

function main() {
  const { snapshot, dbPath, dryRun, onConflict } = parseArgs();

  let db;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  } catch (e) {
    console.error(`Failed to open database at ${dbPath}: ${e.message}`);
    process.exit(3);
  }

  try {
    const result = importOrganization(db, {
      snapshot_path: snapshot,
      dry_run: dryRun,
      on_conflict: onConflict,
    });

    console.log(JSON.stringify(result, null, 2));

    if (!result.ok) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`Import failed: ${err.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isDirectRun) {
  main();
}
