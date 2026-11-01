/**
 * Preservation baseline — READ-ONLY.
 *
 * Founder directive (1 Nov 2026) §5: before any change to persistence, schema
 * initialization, seed behaviour or installation workflow, inventory the real
 * data stores, record counts and relationship integrity, and establish
 * verified backups.
 *
 * This script only reads. It opens every SQLite store read-only, hashes every
 * file, counts every table, and runs the relationship checks that would reveal
 * a later migration having silently dropped or orphaned rows. Its JSON output
 * is the before-image that Test B compares against.
 *
 * Usage: node scripts/preservation-baseline.mjs [--data <dir>] [--out <file>]
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DATA = path.resolve(arg('--data', path.join(ROOT, 'data')));
const OUT = arg('--out', null);

const sha256 = (file) => {
  const h = createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
};

/**
 * Relationship checks. Each returns a count that MUST stay 0, so a regression
 * is visible as a number rather than needing interpretation.
 */
const INTEGRITY = [
  ['tasks_without_project', "SELECT COUNT(*) n FROM pm_tasks t LEFT JOIN pm_projects p ON p.id = t.project_id WHERE p.id IS NULL"],
  ['status_log_without_task', "SELECT COUNT(*) n FROM pm_status_log s LEFT JOIN pm_tasks t ON t.id = s.task_id WHERE t.id IS NULL"],
  ['units_without_company', "SELECT COUNT(*) n FROM org_units u LEFT JOIN org_companies c ON c.id = u.company_id WHERE c.id IS NULL"],
  ['positions_without_unit', "SELECT COUNT(*) n FROM org_positions p LEFT JOIN org_units u ON u.id = p.unit_id WHERE u.id IS NULL"],
  ['appointments_without_person', "SELECT COUNT(*) n FROM org_appointments a LEFT JOIN org_people pe ON pe.id = a.person_id WHERE pe.id IS NULL"],
  ['appointments_without_position', "SELECT COUNT(*) n FROM org_appointments a LEFT JOIN org_positions po ON po.id = a.position_id WHERE po.id IS NULL"],
  // Source records join by source_key, not by a surrogate id.
  ['source_versions_without_record', "SELECT COUNT(*) n FROM pm_source_record_versions v LEFT JOIN pm_source_records r ON r.source_key = v.source_key WHERE r.source_key IS NULL"],
  ['source_records_without_task', "SELECT COUNT(*) n FROM pm_source_records r WHERE r.task_id IS NOT NULL AND r.task_id NOT IN (SELECT id FROM pm_tasks)"],
  ['tasks_with_missing_dependency', "SELECT COUNT(*) n FROM pm_tasks t, json_each(COALESCE(NULLIF(t.depends_on,''),'[]')) d WHERE json_valid(COALESCE(NULLIF(t.depends_on,''),'[]')) AND d.value NOT IN (SELECT id FROM pm_tasks)"],
];

function inspectDatabase(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all().map((r) => r.name);

    const counts = {};
    for (const t of tables) {
      counts[t] = Number(db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n);
    }

    const integrity = {};
    for (const [name, sql] of INTEGRITY) {
      try { integrity[name] = Number(db.prepare(sql).get().n); }
      catch { integrity[name] = 'N/A'; } // table absent in this store
    }

    // Provenance mix matters: historical rows must stay distinguishable.
    let provenance = 'N/A';
    try {
      provenance = Object.fromEntries(
        db.prepare('SELECT provenance, COUNT(*) n FROM pm_tasks GROUP BY provenance').all().map((r) => [r.provenance ?? 'NULL', Number(r.n)]),
      );
    } catch { /* not a PM store */ }

    let actors = 'N/A';
    try {
      actors = Object.fromEntries(
        db.prepare('SELECT actor, COUNT(*) n FROM pm_status_log GROUP BY actor ORDER BY n DESC').all().map((r) => [r.actor ?? 'NULL', Number(r.n)]),
      );
    } catch { /* not a PM store */ }

    const pragma = db.prepare('PRAGMA integrity_check').get();
    return {
      sqlite_integrity_check: pragma.integrity_check ?? Object.values(pragma)[0],
      tables: tables.length,
      counts,
      relationship_integrity: integrity,
      task_provenance: provenance,
      status_log_actors: actors,
    };
  } finally {
    db.close();
  }
}

const report = { generated_at: new Date().toISOString(), data_dir: DATA, stores: {} };

for (const name of fs.readdirSync(DATA).sort()) {
  const file = path.join(DATA, name);
  if (!fs.statSync(file).isFile()) continue;
  const entry = { bytes: fs.statSync(file).size, sha256: sha256(file) };
  if (name.endsWith('.db')) {
    try { Object.assign(entry, inspectDatabase(file)); }
    catch (e) { entry.error = e.message; }
  }
  report.stores[name] = entry;
}

const text = JSON.stringify(report, null, 2);
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
}
console.log(text);
