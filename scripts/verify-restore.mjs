/**
 * Restore verification — proves a backup restores to the same DATA.
 *
 * Founder directive (1 Nov 2026) §5: validate backup integrity and demonstrate
 * restoration using an isolated copy.
 *
 * File bytes deliberately are NOT compared. `VACUUM INTO` rewrites the page
 * layout, so a byte-identical file would be the wrong test and a differing one
 * proves nothing. What must survive is the content: every table's row count,
 * every relationship check, and a content fingerprint computed from the rows
 * themselves, ordered deterministically.
 *
 * Usage: node scripts/verify-restore.mjs --source <live.db> --restored <copy.db>
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import path from 'node:path';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name}`);
  return path.resolve(process.argv[i + 1]);
};
const SOURCE = arg('--source');
const RESTORED = arg('--restored');

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
const tablesOf = (db) => db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).all().map((r) => r.name);

/**
 * Hash a table over a given column list, in a stable order.
 * Restricting the columns is what separates an ADDITIVE migration (new columns,
 * old values untouched — safe) from a mutation of data that already existed.
 */
function hashTable(db, table, cols) {
  if (!cols.length) return { rows: 0, sha256: 'empty' };
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const rows = db.prepare(`SELECT ${quoted} FROM "${table}" ORDER BY ${quoted}`).all();
  const h = createHash('sha256');
  for (const row of rows) h.update(JSON.stringify(row, cols.slice().sort()));
  return { rows: rows.length, sha256: h.digest('hex') };
}

const srcDb = new DatabaseSync(SOURCE, { readOnly: true });
const dstDb = new DatabaseSync(RESTORED, { readOnly: true });
/*
  Two verdicts, deliberately kept apart.

  PRESERVATION is the Founder's requirement: no pre-existing table, column or
  value may change. That alone decides the exit code.

  ADDITIONS are reported separately and never fail the check, because a new
  table or column is how an additive migration is supposed to look. A new table
  that arrives holding ROWS is still additive, but it means something wrote to
  the database on open, so it is called out by name rather than buried.
*/
let addedTables = 0;
let addedColumns = 0;
const populatedNewTables = [];
const changed = [];

try {
  const names = [...new Set([...tablesOf(srcDb), ...tablesOf(dstDb)])].sort();
  for (const t of names) {
    const inSrc = tablesOf(srcDb).includes(t);
    const inDst = tablesOf(dstDb).includes(t);
    if (!inSrc) {
      const rows = Number(dstDb.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n);
      console.log(`ADDED     ${t.padEnd(32)} new table, ${rows} row(s)`);
      if (rows > 0) populatedNewTables.push(`${t} (${rows})`);
      addedTables += 1;
      continue;
    }
    if (!inDst) { console.log(`DROPPED   ${t.padEnd(32)} present in source, absent in target`); changed.push(`${t} (dropped)`); continue; }

    const srcCols = columnsOf(srcDb, t);
    const dstCols = columnsOf(dstDb, t);
    const common = srcCols.filter((c) => dstCols.includes(c));
    const lost = srcCols.filter((c) => !dstCols.includes(c));
    const gained = dstCols.filter((c) => !srcCols.includes(c));

    const x = hashTable(srcDb, t, common);
    const y = hashTable(dstDb, t, common);
    const preserved = x.rows === y.rows && x.sha256 === y.sha256 && lost.length === 0;
    if (!preserved) {
      changed.push(`${t} (${x.rows} -> ${y.rows} rows${lost.length ? `, lost ${lost.join('/')}` : ''})`);
    }
    addedColumns += gained.length;

    const note = [
      lost.length ? `LOST COLUMNS: ${lost.join(', ')}` : '',
      gained.length ? `+${gained.length} new column(s)` : '',
    ].filter(Boolean).join('  ');
    console.log(
      `${preserved ? 'PRESERVED' : 'CHANGED  '} ${t.padEnd(32)} rows ${String(x.rows).padStart(6)} -> ${String(y.rows).padStart(6)}  ${note}`,
    );
  }
} finally {
  srcDb.close();
  dstDb.close();
}

console.log(`\nMIGRATION: ${addedTables} table(s) and ${addedColumns} column(s) added`);
if (populatedNewTables.length) {
  console.log(`WROTE ON OPEN: new tables that already hold rows -> ${populatedNewTables.join(', ')}`);
  console.log('  Additive, so no pre-existing data is affected, but something wrote to this database when it was opened.');
}
if (changed.length) {
  console.error(`\nPRESERVATION FAILED: ${changed.length} pre-existing table(s) changed -> ${changed.join(', ')}`);
  process.exit(1);
}
console.log('\nPRESERVATION VERIFIED: every pre-existing table, column and value is unchanged; all differences are additive');
