/**
 * Materialize the full Command schema into a disposable database file.
 *
 * Used by tests that must validate against the REAL schema rather than a
 * hand-written subset. It runs the service's own startup path with an empty
 * provisioning choice, so the schema is whatever the product actually creates,
 * then exits without listening.
 *
 * Usage: node scripts/init-schema-probe.mjs <db-path>
 */
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/init-schema-probe.mjs <db-path>');
  process.exit(2);
}

process.env.PM_DB_PATH = path.resolve(target);
process.env.PM_ROOM_POST = 'off';
delete process.env.COMMAND_PROVISION; // empty: schema only, no fixtures
process.env.COMMAND_SCHEMA_PROBE = '1';

const mod = await import('../server/pm-service.mjs');
if (typeof mod.startDatabase === 'function') mod.startDatabase();
process.exit(0);
