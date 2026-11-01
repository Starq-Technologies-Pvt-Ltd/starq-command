/**
 * STARQ // COMMAND — Organization Import (CV-AG8).
 *
 * Implements optional organization snapshot import into a Command PM database.
 * Authority: Founder Directive (1 Nov 2026), Handover CV-AG8.
 *
 * Requirements:
 *  1. Versioned source: reject mismatched format_version / schema_version
 *  2. Validate before writing: schema, required columns, identity handles, referential integrity
 *  3. Preserve relationships and provenance: insert rows verbatim, no re-timestamping
 *  4. Detect duplicates: by natural / unique keys, report without merging
 *  5. Dry run: validate and return summary without touching database
 *  6. Reject incompatible data safely: refuse before transaction
 *  7. Never silently overwrite: insert-only; on_conflict 'abort' | 'skip'
 *  8. Summary and failure report: counts per table, rejections per error
 *  9. Atomic: single transaction BEGIN IMMEDIATE, commit all or rollback all
 * 10. Source preserved: snapshot opened read-only, never modified
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { hasOrganizationalData } from './pm-service.mjs';

export const SNAPSHOT_FORMAT = 'starq-command.organization-snapshot';
export const SNAPSHOT_FORMAT_VERSION = 1;
export const CURRENT_SCHEMA_VERSION = 3;

/** Topologically sorted insertion order (parents before children). */
export const TABLE_INSERTION_ORDER = [
  'org_companies',
  'org_units',
  'org_positions',
  'org_people',
  'org_appointments',
  'pm_projects',
  'pm_milestones',
  'pm_tasks',
  'pm_status_log',
  'pm_import_sources',
  'pm_import_source_versions',
  'pm_source_records',
  'pm_source_record_versions',
];

const TABLE_NATURAL_KEYS = {
  org_companies: ['id'],
  org_units: ['id'],
  org_positions: ['id'],
  org_people: ['id', 'handle'],
  org_appointments: ['id'],
  pm_projects: ['id', 'prefix'],
  pm_milestones: ['id'],
  pm_tasks: ['id'],
  pm_status_log: ['id'],
  pm_import_sources: ['source_file'],
  pm_import_source_versions: ['source_file'],
  pm_source_records: ['source_key'],
  pm_source_record_versions: ['source_key'],
};

const TABLE_REQUIRED_COLUMNS = {
  org_companies: ['id', 'name', 'created_at'],
  org_units: ['id', 'company_id', 'kind', 'name', 'created_at'],
  org_positions: ['id', 'unit_id', 'title', 'created_at'],
  org_people: ['id', 'handle', 'display_name', 'kind', 'created_at'],
  org_appointments: ['id', 'position_id', 'person_id', 'appointed_at'],
  pm_projects: ['id', 'name', 'prefix', 'created_at'],
  pm_milestones: ['id', 'project_id', 'title', 'created_at', 'updated_at'],
  pm_tasks: ['id', 'project_id', 'title', 'status', 'created_by', 'created_at', 'updated_at'],
  pm_status_log: ['task_id', 'event_type', 'actor', 'timestamp'],
  pm_import_sources: ['source_file', 'source_system', 'content_sha256', 'row_count', 'imported_at'],
  pm_import_source_versions: ['source_file', 'content_sha256', 'row_count', 'imported_at'],
  pm_source_records: ['source_key', 'source_system', 'source_file', 'source_row_index', 'resolution', 'payload_sha256', 'raw_payload', 'imported_at'],
  pm_source_record_versions: ['source_key', 'payload_sha256', 'source_system', 'source_file', 'source_row_index', 'resolution', 'raw_payload', 'imported_at'],
};

/** Canonical JSON stringification (keys sorted recursively). */
export function canonicalJsonString(val) {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(canonicalJsonString).join(',') + ']';
  }
  const keys = Object.keys(val).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJsonString(val[k])).join(',') + '}';
}

/** Compute sha256 of tables object canonically. */
export function computeTablesSha256(tables) {
  return createHash('sha256').update(canonicalJsonString(tables)).digest('hex');
}

/** Read snapshot safely from memory object or path. */
export function loadSnapshot(source) {
  if (typeof source === 'string') {
    let content;
    try {
      content = fs.readFileSync(source, { encoding: 'utf8', flag: 'r' });
    } catch (e) {
      throw new Error(`Failed to read snapshot file: ${e.message}`);
    }
    try {
      return JSON.parse(content);
    } catch (e) {
      throw new Error(`Snapshot JSON is malformed: ${e.message}`);
    }
  }
  if (source && typeof source === 'object') {
    return source;
  }
  throw new Error('Snapshot must be an object or a readable file path.');
}

/**
 * Validate a snapshot against schema and database state.
 */
export function validateSnapshot(snapshot, db, options = {}) {
  const errors = [];
  const rejections = [];
  const onConflict = options.on_conflict === 'skip' ? 'skip' : 'abort';

  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, errors: ['Snapshot must be a valid JSON object.'], rejections: ['MALFORMED_SNAPSHOT'], conflicts: [] };
  }

  // 1. Versioned source
  if (snapshot.format !== SNAPSHOT_FORMAT) {
    errors.push(`Invalid snapshot format: expected '${SNAPSHOT_FORMAT}', got '${snapshot.format}'.`);
    rejections.push('INVALID_FORMAT');
  }

  if (snapshot.format_version !== SNAPSHOT_FORMAT_VERSION) {
    errors.push(`Unsupported format_version: expected ${SNAPSHOT_FORMAT_VERSION}, got ${snapshot.format_version}.`);
    rejections.push('UNSUPPORTED_FORMAT_VERSION');
  }

  const expectedSchema = options.expected_schema_version ?? CURRENT_SCHEMA_VERSION;
  if (Number(snapshot.schema_version) !== expectedSchema) {
    errors.push(`Schema version mismatch: database requires schema_version ${expectedSchema}, snapshot declares ${snapshot.schema_version}.`);
    rejections.push('SCHEMA_VERSION_MISMATCH');
  }

  if (!snapshot.tables || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables)) {
    errors.push("Snapshot 'tables' must be an object containing table arrays.");
    rejections.push('INVALID_TABLES_OBJECT');
    return { ok: false, errors, rejections, conflicts: [] };
  }

  // Verify content_sha256 if present
  if (snapshot.content_sha256) {
    const computedCanonical = computeTablesSha256(snapshot.tables);
    const computedSimple = createHash('sha256').update(JSON.stringify(snapshot.tables)).digest('hex');
    if (snapshot.content_sha256 !== computedCanonical && snapshot.content_sha256 !== computedSimple) {
      errors.push(`Snapshot content_sha256 mismatch: declared ${snapshot.content_sha256}, computed ${computedCanonical}.`);
      rejections.push('CONTENT_HASH_MISMATCH');
    }
  }

  // Target empty check
  const isPopulated = hasOrganizationalData(db);
  if (isPopulated && onConflict !== 'skip') {
    errors.push("Target database already contains organizational data. Explicit on_conflict: 'skip' is required to import into a populated database.");
    rejections.push('TARGET_NOT_EMPTY');
  }

  // Table columns cache from database
  const dbTableCols = new Map();
  for (const table of TABLE_INSERTION_ORDER) {
    try {
      const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
      if (cols.length > 0) dbTableCols.set(table, new Set(cols));
    } catch {
      // Table absent from schema
    }
  }

  // Collect ID sets across snapshot + target db for relationship integrity
  const resolveIds = (table, col = 'id') => {
    const set = new Set();
    const rows = snapshot.tables[table];
    if (Array.isArray(rows)) {
      for (const r of rows) {
        if (r && r[col] !== undefined && r[col] !== null) set.add(String(r[col]));
      }
    }
    try {
      const inDb = db.prepare(`SELECT "${col}" AS val FROM "${table}" WHERE "${col}" IS NOT NULL`).all();
      for (const r of inDb) set.add(String(r.val));
    } catch {
      // Table does not exist in db
    }
    return set;
  };

  const companyIds = resolveIds('org_companies', 'id');
  const unitIds = resolveIds('org_units', 'id');
  const positionIds = resolveIds('org_positions', 'id');
  const peopleIds = resolveIds('org_people', 'id');
  const projectIds = resolveIds('pm_projects', 'id');
  const taskIds = resolveIds('pm_tasks', 'id');
  const milestoneIds = resolveIds('pm_milestones', 'id');
  const importSources = resolveIds('pm_import_sources', 'source_file');
  const sourceRecordKeys = resolveIds('pm_source_records', 'source_key');

  const counts = {};
  const conflicts = [];
  const validatedTables = {};
  let totalCreated = 0;
  let totalSkipped = 0;
  let totalConflicted = 0;

  for (const table of TABLE_INSERTION_ORDER) {
    const rows = snapshot.tables[table];
    if (!rows) continue;
    if (!Array.isArray(rows)) {
      errors.push(`Table '${table}' in snapshot must be an array of row objects.`);
      rejections.push(`INVALID_TABLE_ARRAY_${table}`);
      continue;
    }

    const tableCols = dbTableCols.get(table);
    if (!tableCols) {
      errors.push(`Table '${table}' does not exist in target database schema.`);
      rejections.push(`UNKNOWN_TABLE_${table}`);
      continue;
    }

    const requiredCols = TABLE_REQUIRED_COLUMNS[table] || [];
    const naturalKeys = TABLE_NATURAL_KEYS[table] || ['id'];
    const seenSnapshotKeys = new Set();
    const tableValidatedRows = [];
    let createdCount = 0;
    let skippedCount = 0;
    let conflictedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        errors.push(`Row ${i} in '${table}' is not a valid object.`);
        rejections.push(`INVALID_ROW_${table}_${i}`);
        continue;
      }

      // Check for unknown columns
      for (const col of Object.keys(row)) {
        if (!tableCols.has(col)) {
          errors.push(`Unknown column '${col}' on table '${table}' in row ${i}.`);
          rejections.push(`UNKNOWN_COLUMN_${table}_${col}`);
        }
      }

      // Check required columns
      for (const req of requiredCols) {
        if (row[req] === undefined || row[req] === null) {
          errors.push(`Missing required column '${req}' on table '${table}' in row ${i}.`);
          rejections.push(`MISSING_COLUMN_${table}_${req}`);
        }
      }

      // Referential integrity checks
      if (table === 'org_units') {
        if (row.company_id && !companyIds.has(String(row.company_id))) {
          errors.push(`org_units '${row.id}' references non-existent company_id '${row.company_id}'.`);
          rejections.push(`FK_ORPHAN_UNIT_COMPANY_${row.id}`);
        }
        if (row.parent_id && !unitIds.has(String(row.parent_id))) {
          errors.push(`org_units '${row.id}' references non-existent parent_id '${row.parent_id}'.`);
          rejections.push(`FK_ORPHAN_UNIT_PARENT_${row.id}`);
        }
      } else if (table === 'org_positions') {
        if (row.unit_id && !unitIds.has(String(row.unit_id))) {
          errors.push(`org_positions '${row.id}' references non-existent unit_id '${row.unit_id}'.`);
          rejections.push(`FK_ORPHAN_POSITION_UNIT_${row.id}`);
        }
        if (row.reports_to_position_id && !positionIds.has(String(row.reports_to_position_id))) {
          errors.push(`org_positions '${row.id}' references non-existent reports_to_position_id '${row.reports_to_position_id}'.`);
          rejections.push(`FK_ORPHAN_POSITION_PARENT_${row.id}`);
        }
      } else if (table === 'org_appointments') {
        if (row.position_id && !positionIds.has(String(row.position_id))) {
          errors.push(`org_appointments '${row.id}' references non-existent position_id '${row.position_id}'.`);
          rejections.push(`FK_ORPHAN_APPOINTMENT_POSITION_${row.id}`);
        }
        if (row.person_id && !peopleIds.has(String(row.person_id))) {
          errors.push(`org_appointments '${row.id}' references non-existent person_id '${row.person_id}'.`);
          rejections.push(`FK_ORPHAN_APPOINTMENT_PERSON_${row.id}`);
        }
      } else if (table === 'pm_tasks') {
        if (row.project_id && !projectIds.has(String(row.project_id))) {
          errors.push(`pm_tasks '${row.id}' references non-existent project_id '${row.project_id}'.`);
          rejections.push(`FK_ORPHAN_TASK_PROJECT_${row.id}`);
        }
        if (row.milestone_id && !milestoneIds.has(String(row.milestone_id))) {
          errors.push(`pm_tasks '${row.id}' references non-existent milestone_id '${row.milestone_id}'.`);
          rejections.push(`FK_ORPHAN_TASK_MILESTONE_${row.id}`);
        }
      } else if (table === 'pm_status_log') {
        if (row.task_id && !taskIds.has(String(row.task_id))) {
          errors.push(`pm_status_log row references non-existent task_id '${row.task_id}'.`);
          rejections.push(`FK_ORPHAN_STATUS_LOG_TASK_${row.task_id}`);
        }
      } else if (table === 'pm_source_records') {
        if (row.source_file && !importSources.has(String(row.source_file))) {
          errors.push(`pm_source_records '${row.source_key}' references non-existent source_file '${row.source_file}'.`);
          rejections.push(`FK_ORPHAN_SOURCE_RECORD_FILE_${row.source_key}`);
        }
        if (row.task_id && !taskIds.has(String(row.task_id))) {
          errors.push(`pm_source_records '${row.source_key}' references non-existent task_id '${row.task_id}'.`);
          rejections.push(`FK_ORPHAN_SOURCE_RECORD_TASK_${row.task_id}`);
        }
      } else if (table === 'pm_source_record_versions') {
        if (row.source_key && !sourceRecordKeys.has(String(row.source_key))) {
          errors.push(`pm_source_record_versions row references non-existent source_key '${row.source_key}'.`);
          rejections.push(`FK_ORPHAN_VERSION_SOURCE_KEY_${row.source_key}`);
        }
      } else if (table === 'pm_milestones') {
        if (row.project_id && !projectIds.has(String(row.project_id))) {
          errors.push(`pm_milestones '${row.id}' references non-existent project_id '${row.project_id}'.`);
          rejections.push(`FK_ORPHAN_MILESTONE_PROJECT_${row.id}`);
        }
      }

      // Natural key duplicate / conflict detection
      let isDuplicate = false;
      let duplicateKey = null;
      let duplicateValue = null;

      for (const k of naturalKeys) {
        const val = row[k];
        if (val === undefined || val === null) continue;
        const keyTag = `${k}:${val}`;

        // Check internal snapshot duplicate
        if (seenSnapshotKeys.has(keyTag)) {
          isDuplicate = true;
          duplicateKey = k;
          duplicateValue = val;
          break;
        }
        seenSnapshotKeys.add(keyTag);

        // Check target database duplicate
        try {
          const match = db.prepare(`SELECT 1 FROM "${table}" WHERE "${k}" = ? LIMIT 1`).get(val);
          if (match) {
            isDuplicate = true;
            duplicateKey = k;
            duplicateValue = val;
            break;
          }
        } catch {
          // Query failure
        }
      }

      if (isDuplicate) {
        if (onConflict === 'skip') {
          skippedCount += 1;
          totalSkipped += 1;
          tableValidatedRows.push({ ...row, _skip: true });
        } else {
          conflictedCount += 1;
          totalConflicted += 1;
          const conf = {
            table,
            key: duplicateKey,
            value: duplicateValue,
            row_index: i,
            reason: `Duplicate natural key '${duplicateKey}' = '${duplicateValue}' found in target or snapshot.`,
          };
          conflicts.push(conf);
          rejections.push(`CONFLICT_${table}_${duplicateKey}_${duplicateValue}`);
        }
      } else {
        createdCount += 1;
        totalCreated += 1;
        tableValidatedRows.push({ ...row, _skip: false });
      }
    }

    counts[table] = {
      created: createdCount,
      skipped: skippedCount,
      conflicted: conflictedCount,
    };
    validatedTables[table] = tableValidatedRows;
  }

  const ok = errors.length === 0 && (onConflict === 'skip' || conflicts.length === 0);
  return {
    ok,
    errors,
    rejections,
    conflicts,
    counts,
    total_created: totalCreated,
    total_skipped: totalSkipped,
    total_conflicted: totalConflicted,
    validatedTables,
  };
}

/**
 * Execute organization snapshot import.
 */
export function importOrganization(db, options = {}) {
  const snapshot = loadSnapshot(options.snapshot ?? options.snapshot_path);
  const dryRun = Boolean(options.dry_run);
  const onConflict = options.on_conflict === 'skip' ? 'skip' : 'abort';
  const injectFailure = options._injectFailure ?? null;

  const validation = validateSnapshot(snapshot, db, {
    on_conflict: onConflict,
    expected_schema_version: options.schema_version ?? CURRENT_SCHEMA_VERSION,
  });

  if (!validation.ok) {
    const errorType = validation.conflicts.length > 0 && onConflict !== 'skip'
      ? 'IMPORT_CONFLICT'
      : (validation.rejections.includes('TARGET_NOT_EMPTY') ? 'TARGET_NOT_EMPTY' : 'VALIDATION_FAILED');
    return {
      ok: false,
      error: errorType,
      message: validation.conflicts.length > 0
        ? `Import aborted due to ${validation.conflicts.length} conflicting record(s).`
        : (validation.errors[0] || 'Snapshot validation failed.'),
      errors: validation.errors,
      rejections: validation.rejections,
      conflicts: validation.conflicts,
      counts: validation.counts,
      total_created: 0,
      total_skipped: validation.total_skipped,
      total_conflicted: validation.total_conflicted,
      dry_run: dryRun,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      on_conflict: onConflict,
      source_db_id: snapshot.source_db_id ?? null,
      counts: validation.counts,
      total_created: validation.total_created,
      total_skipped: validation.total_skipped,
      total_conflicted: 0,
      rejections: [],
    };
  }

  // Atomically insert rows
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of TABLE_INSERTION_ORDER) {
      const rows = validation.validatedTables[table] || [];
      for (const row of rows) {
        if (row._skip) continue;

        if (injectFailure === 'mid_import' && table === 'pm_tasks') {
          throw new Error('INJECTED_MID_IMPORT_FAILURE');
        }

        const cols = Object.keys(row).filter((k) => !k.startsWith('_'));
        const placeholders = cols.map(() => '?').join(', ');
        const quotedCols = cols.map((c) => `"${c}"`).join(', ');
        const values = cols.map((c) => row[c]);

        const sql = `INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders})`;
        db.prepare(sql).run(...values);
      }
    }

    const fks = db.prepare('PRAGMA foreign_key_check').all();
    if (fks.length > 0) {
      throw new Error(`Foreign key check failed after import: ${JSON.stringify(fks)}`);
    }

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // rollback failed or not started
    }
    throw err;
  }

  return {
    ok: true,
    dry_run: false,
    on_conflict: onConflict,
    source_db_id: snapshot.source_db_id ?? null,
    counts: validation.counts,
    total_created: validation.total_created,
    total_skipped: validation.total_skipped,
    total_conflicted: 0,
    rejections: [],
  };
}
