/**
 * Verified backup of every Command data store — READ-ONLY on the source.
 *
 * Founder directive (1 Nov 2026) §5: establish verified backups of every
 * affected data store and validate their integrity before any persistence
 * change. `VACUUM INTO` is used rather than a file copy because it writes a
 * consistent snapshot of the committed state, including anything still in the
 * write-ahead log, while the source is opened read-only and never modified.
 *
 * Usage: node scripts/backup-data-stores.mjs --data <dir> --out <dir>
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SRC = path.resolve(arg('--data'));
const OUT = path.resolve(arg('--out'));
fs.mkdirSync(OUT, { recursive: true });

const sha256 = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const manifest = { created_at: new Date().toISOString(), source: SRC, files: {} };

for (const name of fs.readdirSync(SRC).sort()) {
  const src = path.join(SRC, name);
  if (!fs.statSync(src).isFile()) continue;

  if (name.endsWith('.db')) {
    const out = path.join(OUT, name);
    if (fs.existsSync(out)) fs.rmSync(out);
    const db = new DatabaseSync(src, { readOnly: true });
    try {
      // SQLite requires forward slashes inside the SQL string literal.
      db.exec(`VACUUM INTO '${out.split(path.sep).join('/')}'`);
    } finally {
      db.close();
    }
    // Verify the copy opens and passes its own integrity check.
    const check = new DatabaseSync(out, { readOnly: true });
    let verdict;
    try {
      const row = check.prepare('PRAGMA integrity_check').get();
      verdict = row.integrity_check ?? Object.values(row)[0];
    } finally {
      check.close();
    }
    manifest.files[name] = {
      kind: 'sqlite',
      source_bytes: fs.statSync(src).size,
      source_sha256: sha256(src),
      backup_bytes: fs.statSync(out).size,
      backup_sha256: sha256(out),
      backup_integrity_check: verdict,
    };
    console.log(`${verdict === 'ok' ? 'OK  ' : 'FAIL'} ${name} -> ${(fs.statSync(out).size / 1048576).toFixed(1)}MB (${verdict})`);
  } else if (!name.endsWith('-wal') && !name.endsWith('-shm')) {
    // WAL/SHM are not copied: VACUUM INTO already folded their contents in,
    // and a stale WAL beside a restored database is a hazard, not a backup.
    const out = path.join(OUT, name);
    fs.copyFileSync(src, out);
    manifest.files[name] = { kind: 'file', source_sha256: sha256(src), backup_sha256: sha256(out) };
    console.log(`OK   ${name} (copied)`);
  }
}

const manifestPath = path.join(OUT, 'backup-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nmanifest: ${manifestPath}`);
const bad = Object.entries(manifest.files).filter(([, f]) => f.kind === 'sqlite' && f.backup_integrity_check !== 'ok');
if (bad.length) {
  console.error(`FAILED integrity: ${bad.map(([n]) => n).join(', ')}`);
  process.exit(1);
}
console.log(`all ${Object.keys(manifest.files).length} stores backed up and verified`);
