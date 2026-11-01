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

/** Content fingerprint: every row of every table, in a stable order. */
function fingerprint(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all().map((r) => r.name);

    const perTable = {};
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => `"${c.name}"`);
      if (!cols.length) { perTable[t] = { rows: 0, sha256: 'empty' }; continue; }
      const order = cols.join(', ');
      const rows = db.prepare(`SELECT ${cols.join(', ')} FROM "${t}" ORDER BY ${order}`).all();
      const h = createHash('sha256');
      for (const row of rows) h.update(JSON.stringify(row, Object.keys(row).sort()));
      perTable[t] = { rows: rows.length, sha256: h.digest('hex') };
    }
    return perTable;
  } finally {
    db.close();
  }
}

const a = fingerprint(SOURCE);
const b = fingerprint(RESTORED);
const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

let failures = 0;
for (const t of names) {
  const x = a[t]; const y = b[t];
  if (!x || !y) { console.log(`MISSING  ${t.padEnd(32)} source=${!!x} restored=${!!y}`); failures += 1; continue; }
  const same = x.rows === y.rows && x.sha256 === y.sha256;
  if (!same) failures += 1;
  console.log(`${same ? 'MATCH ' : 'DIFFER'}   ${t.padEnd(32)} rows ${String(x.rows).padStart(6)} -> ${String(y.rows).padStart(6)}`);
}

console.log(`\n${names.length} tables compared, ${failures} mismatch(es)`);
if (failures) { console.error('RESTORE VERIFICATION FAILED'); process.exit(1); }
console.log('RESTORE VERIFIED: restored copy is content-identical to the source');
