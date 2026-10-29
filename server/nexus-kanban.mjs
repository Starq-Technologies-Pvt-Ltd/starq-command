/**
 * Nexus → Command kanban seed.
 *
 * Copies every StarqNexus `*-tasks.json` board into the Command PM database as
 * writable tasks, preserving original ids and mapping original statuses onto
 * the five Nexus columns. It never writes back to StarqNexus.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const RECOVERED_DATA_ROOT = path.resolve(fileURLToPath(new URL('../recovered/nexus/starqNexus/data', import.meta.url)));
const DEFAULT_NEXUS_WORKSPACE = process.env.STARQ_NEXUS_WORKSPACE_ROOT
  || (fs.existsSync(RECOVERED_DATA_ROOT) ? path.dirname(path.dirname(RECOVERED_DATA_ROOT)) : path.resolve('recovered', 'nexus'));
export const NEXUS_DATA_ROOT = path.resolve(
  process.env.STARQ_NEXUS_DATA_ROOT
    || (fs.existsSync(RECOVERED_DATA_ROOT) ? RECOVERED_DATA_ROOT : path.join(DEFAULT_NEXUS_WORKSPACE, 'starqNexus', 'data')),
);

export const KANBAN_STATUSES = Object.freeze([
  'TODO', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'DONE',
]);

export const KANBAN_LABELS = Object.freeze({
  TODO: 'To Do',
  NEXT: 'Next Up',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  DONE: 'Done',
});

const LEGACY_STATUS = Object.freeze({
  BACKLOG: 'TODO',
  READY: 'NEXT',
  IN_PROGRESS: 'IN_PROGRESS',
  REVIEW: 'IN_PROGRESS',
  VERIFICATION: 'IN_PROGRESS',
  ACCEPTANCE: 'IN_PROGRESS',
  CLOSED: 'DONE',
  BLOCKED: 'BLOCKED',
  FOUNDER_GATE: 'BLOCKED',
  TODO: 'TODO',
  NEXT: 'NEXT',
  DONE: 'DONE',
});

/** Same five columns the Founder used in Nexus. `planned` lived in To Do. */
const NEXUS_STATUS = Object.freeze({
  todo: 'TODO',
  planned: 'TODO',
  backlog: 'TODO',
  pending: 'TODO',
  preserved: 'TODO',
  ready: 'NEXT',
  next: 'NEXT',
  in_progress: 'IN_PROGRESS',
  wip: 'IN_PROGRESS',
  active: 'IN_PROGRESS',
  doing: 'IN_PROGRESS',
  blocked: 'BLOCKED',
  hold: 'BLOCKED',
  done: 'DONE',
  closed: 'DONE',
  completed: 'DONE',
  complete: 'DONE',
});

export const NEXUS_BOARDS = Object.freeze([
  { id: 'command', name: 'Starq Command', prefix: 'CMD', file: null, group: 'Operating', description: 'Command itself — current operating work.' },
  { id: 'studio', name: 'Starq Studio', prefix: 'STU', file: 'starq-studio-tasks.json', group: 'Studio', description: 'AI-native coding studio capability.' },
  { id: 'web', name: 'Starq Web', prefix: 'SQW', file: 'starq-web-tasks.json', group: 'Public web', description: 'Enterprise website and commercial launch.' },
  { id: 'erp', name: 'starqERP', prefix: 'SERP', file: 'starq-erp-tasks.json', group: 'Products', description: 'AI-native multi-tenant SME ERP. Implementation remains on hold (DEC-100); the board is still the working record.' },
  { id: 'hoadha', name: 'Hoadha', prefix: 'DHIV', file: 'hoadha-tasks.json', group: 'Products', description: 'Hoadha core marketplace board.' },
  { id: 'hoadha-social', name: 'Hoadha Social', prefix: 'HSOC', file: 'hoadha-social-tasks.json', group: 'Products', description: 'Hoadha commercial social standard.' },
  { id: 'hoadha-concierge', name: 'Hoadha HIE', prefix: 'HIE', file: 'hoadha-concierge-tasks.json', group: 'Products', description: 'Hoadha intelligence engine / concierge.' },
  { id: 'academy', name: 'Starq Academy', prefix: 'ACA', file: 'starq-academy-tasks.json', group: 'Future companies', description: 'Company #3 — education formation board.' },
  { id: 'pay', name: 'starqPay', prefix: 'PAY', file: 'starq-pay-tasks.json', group: 'Future companies', description: 'Company #4 — payments formation board.' },
  { id: 'dynamics', name: 'Starq Dynamics', prefix: 'SD', file: 'starq-dynamics-tasks.json', group: 'Services', description: 'Client-facing solutions and services arm.' },
  { id: 'foundation', name: 'Starq Foundation', prefix: 'SF', file: 'starq-foundation-tasks.json', group: 'Governance', description: 'Registrations, resolutions and controls.' },
  { id: 'founder-decisions', name: 'Founder Decisions', prefix: 'FD', file: 'founder-decisions-tasks.json', group: 'Governance', description: 'Questions waiting on Ali — the Nexus decisions board.' },
  { id: 'portal', name: 'Starq Portal', prefix: 'SP', file: 'starq-portal-tasks.json', group: 'Historical products', description: 'Nexus-era portal board. Preserved, writable.' },
  { id: 'pos', name: 'STARQ POS', prefix: 'SPOS', file: 'starq-pos-tasks.json', group: 'Historical products', description: 'Nexus-era POS board. Capability now sits inside starqERP; cards kept.' },
  { id: 'antrac-erp', name: 'Antrac ERP', prefix: 'AERP', file: 'antrac-erp-tasks.json', group: 'Personal', description: 'Personal Antrac ERP board.' },
  { id: 'orgsync', name: 'OrgSync', prefix: 'ORG', file: 'orgsync-tasks.json', group: 'Personal', description: 'Personal OrgSync board.' },
  { id: 'biography', name: 'Biography', prefix: 'BIO', file: 'biography-tasks.json', group: 'Personal', description: 'Personal biography board.' },
  { id: 'devops', name: 'DevOps Control', prefix: 'DVC', file: 'devops-control-tasks.json', group: 'Studio', description: 'DevOps control board.' },
  { id: 'starqbooks', name: 'starqBooks', prefix: 'SBK', file: 'starqbooks-tasks.json', group: 'Historical products', description: 'Historical starqBooks board (40 tasks). Superseded into starqERP per August 2026 supersession; retained as historical implementation evidence.' },
]);

export function mapKanbanStatus(raw) {
  if (raw == null) return 'TODO';
  const key = String(raw).trim();
  if (LEGACY_STATUS[key]) return LEGACY_STATUS[key];
  return NEXUS_STATUS[key.toLowerCase()] || 'TODO';
}

export function allowedKanbanNext(status) {
  return KANBAN_STATUSES.filter((s) => s !== status);
}

function clip(value, max) {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : text.slice(0, max);
}

function ownerFrom(task) {
  const workers = Array.isArray(task.workers) ? task.workers : [];
  const first = workers.find((w) => typeof w === 'string' && w.trim());
  if (first) return clip(String(first).trim().toLowerCase(), 40);
  if (typeof task.owner === 'string' && task.owner.trim()) return clip(task.owner.trim().toLowerCase(), 40);
  return 'UNASSIGNED';
}

function priorityFrom(task) {
  const p = String(task.priority ?? '').toUpperCase();
  return ['P0', 'P1', 'P2', 'P3'].includes(p) ? p : 'P2';
}

function notesFrom(task, board) {
  const bits = [
    `Nexus origin: ${board.file} · original status: ${task.status ?? 'UNKNOWN'}`,
    task.phase ? `phase: ${task.phase}` : null,
    task.sprint ? `sprint: ${task.sprint}` : null,
    task.notes ? String(task.notes) : null,
  ].filter(Boolean);
  return clip(bits.join('\n'), 8000);
}

export function nexusTaskToRow(task, board, ts) {
  const id = clip(task.id, 40);
  if (!id) return null;
  return {
    id,
    project_id: board.id,
    title: clip(task.title || id, 800) || id,
    description: clip(task.description || '', 20000),
    priority: priorityFrom(task),
    status: mapKanbanStatus(task.status),
    owner: ownerFrom(task),
    verifier: 'UNASSIGNED',
    depends_on: Array.isArray(task.depends_on)
      ? task.depends_on.filter((x) => typeof x === 'string' && x.trim()).map((x) => clip(x.trim(), 40))
      : [],
    notes: notesFrom(task, board),
    created_by: 'nexus-import',
    created_at: typeof task.dispatched_at === 'string' ? task.dispatched_at : ts,
    updated_at: typeof task.completed_at === 'string' ? task.completed_at : ts,
    closed_at: mapKanbanStatus(task.status) === 'DONE' ? (task.completed_at || ts) : null,
  };
}

function readBoardFile(file, dataRoot = NEXUS_DATA_ROOT) {
  let full = path.join(dataRoot, file);
  if (!fs.existsSync(full)) {
    const fallback = path.join(RECOVERED_DATA_ROOT, file);
    if (fs.existsSync(fallback)) full = fallback;
  }
  const bytes = fs.readFileSync(full);
  const parsed = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(parsed.tasks)) throw new Error(`${file}: tasks is not an array`);
  return { file, full, tasks: parsed.tasks, project: parsed.project ?? file };
}

export function importNexusBoards(handle, { nowIso, json, dataRoot = NEXUS_DATA_ROOT }) {
  const ts = nowIso();
  const summary = { imported: 0, preserved: 0, skipped: 0, boards: [], errors: [] };
  const getProject = handle.prepare('SELECT * FROM pm_projects WHERE id = ?');
  const insProject = handle.prepare(
    'INSERT INTO pm_projects (id, name, prefix, description, hold_state, source_gap, next_seq, created_at) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)',
  );
  const updProject = handle.prepare(
    'UPDATE pm_projects SET name = ?, prefix = ?, description = ?, source_gap = ? WHERE id = ?',
  );
  const getTask = handle.prepare('SELECT id, project_id, created_by FROM pm_tasks WHERE id = ?');
  const seenTaskIds = new Set();
  const putSource = handle.prepare(
    `INSERT INTO pm_source_records (source_key, source_system, source_file, source_row_index, task_id, resolution, raw_status, payload_sha256, raw_payload, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET
       task_id = excluded.task_id,
       resolution = excluded.resolution,
       raw_status = excluded.raw_status,
       payload_sha256 = excluded.payload_sha256,
       raw_payload = excluded.raw_payload`,
  );
  const putFile = handle.prepare(
    `INSERT INTO pm_import_sources (source_file, source_system, content_sha256, row_count, imported_at)
     VALUES (?, 'starqNexus', ?, ?, ?)
     ON CONFLICT(source_file) DO UPDATE SET
       content_sha256 = excluded.content_sha256,
       row_count = excluded.row_count,
       imported_at = excluded.imported_at`,
  );
  const putFileVersion = handle.prepare(
    `INSERT OR IGNORE INTO pm_import_source_versions (source_file, content_sha256, row_count, imported_at)
     VALUES (?, ?, ?, ?)`,
  );
  const putSourceVersion = handle.prepare(
    `INSERT OR IGNORE INTO pm_source_record_versions (source_key, payload_sha256, source_system, source_file, source_row_index, task_id, resolution, raw_status, raw_payload, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const taskCols = new Set(handle.prepare("SELECT name FROM pragma_table_info('pm_tasks')").all().map((r) => r.name));
  const hasGated = taskCols.has('stage') && taskCols.has('provenance');
  const insTask = hasGated
    ? handle.prepare(
        `INSERT INTO pm_tasks (id, project_id, title, description, priority, status, stage, provenance, owner, verifier, room_authorization_ref, evidence_refs, depends_on, notes, created_by, created_at, updated_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'HISTORICAL_NEXUS', ?, 'UNASSIGNED', NULL, '[]', ?, ?, 'nexus-import', ?, ?, ?)`,
      )
    : handle.prepare(
        `INSERT INTO pm_tasks (id, project_id, title, description, priority, status, owner, verifier, room_authorization_ref, evidence_refs, depends_on, notes, created_by, created_at, updated_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'UNASSIGNED', NULL, '[]', ?, ?, 'nexus-import', ?, ?, ?)`,
      );
  const insLog = handle.prepare(
    `INSERT INTO pm_status_log (task_id, event_type, from_status, to_status, actor, detail, timestamp, room_sync)
     VALUES (?, 'IMPORTED', NULL, ?, 'nexus-import', ?, ?, 'NOT_REQUIRED')`,
  );
  const sourceNote = 'Writable Command board seeded from Nexus JSON. Original ids and column status preserved. StarqNexus files were not modified.';

  for (const board of NEXUS_BOARDS) {
    const existing = getProject.get(board.id);
    if (!existing) {
      insProject.run(board.id, board.name, board.prefix, board.description, board.file ? sourceNote : null, ts);
    } else {
      try {
        updProject.run(board.name, board.prefix, board.description, board.file ? sourceNote : existing.source_gap, board.id);
      } catch {
        updProject.run(board.name, existing.prefix, board.description, board.file ? sourceNote : existing.source_gap, board.id);
      }
    }
    if (!board.file) {
      summary.boards.push({ id: board.id, imported: 0, skipped: 0, source: 'native' });
      continue;
    }
    let payload;
    try {
      payload = readBoardFile(board.file, dataRoot);
    } catch (error) {
      summary.errors.push(`${board.id}: ${error.message}`);
      summary.boards.push({ id: board.id, imported: 0, skipped: 0, source: board.file, error: error.message });
      continue;
    }
    const sourceBytes = fs.readFileSync(payload.full);
    const fileHash = createHash('sha256').update(sourceBytes).digest('hex');
    putFile.run(board.file, fileHash, payload.tasks.length, ts);
    putFileVersion.run(board.file, fileHash, payload.tasks.length, ts);
    let imported = 0;
    let skipped = 0;
    let preserved = 0;
    for (let rowIndex = 0; rowIndex < payload.tasks.length; rowIndex += 1) {
      const task = payload.tasks[rowIndex];
      const row = nexusTaskToRow(task, board, ts);
      const rawPayload = json(task);
      const payloadHash = createHash('sha256').update(rawPayload).digest('hex');
      const sourceKey = `${board.file}#${rowIndex}`;
      let resolution = 'IMPORTED';
      let linkedTaskId = row?.id ?? null;
      if (!row) {
        resolution = 'INVALID_ID';
        skipped += 1;
        linkedTaskId = null;
      } else if (seenTaskIds.has(row.id)) {
        const disambiguatedKey = `${row.id}:${board.id}`;
        const existingRestored = getTask.get(disambiguatedKey);
        if (existingRestored) {
          resolution = 'IMPORTED';
          linkedTaskId = disambiguatedKey;
          preserved += 1;
        } else {
          resolution = 'DUPLICATE_TASK_ID';
          skipped += 1;
          linkedTaskId = null;
        }
      } else {
        seenTaskIds.add(row.id);
        const existingTask = getTask.get(row.id);
        if (existingTask) {
          if (existingTask.project_id === board.id && existingTask.created_by === 'nexus-import') {
            resolution = 'IMPORTED';
            preserved += 1;
          } else {
            resolution = 'DUPLICATE_TASK_ID';
            skipped += 1;
            linkedTaskId = null;
          }
        } else {
          if (hasGated) {
            const stage = { TODO: 'BACKLOG', NEXT: 'READY', IN_PROGRESS: 'IN_PROGRESS', BLOCKED: 'BLOCKED', DONE: 'CLOSED' }[row.status] ?? 'BACKLOG';
            insTask.run(
              row.id, row.project_id, row.title, row.description, row.priority, row.status, stage, row.owner,
              json(row.depends_on), row.notes, row.created_at, row.updated_at, row.closed_at,
            );
          } else {
            insTask.run(
              row.id, row.project_id, row.title, row.description, row.priority, row.status, row.owner,
              json(row.depends_on), row.notes, row.created_at, row.updated_at, row.closed_at,
            );
          }
          insLog.run(row.id, row.status, json({ nexus_file: board.file, original_status: task.status ?? null, source_row_index: rowIndex }), ts);
          imported += 1;
        }
      }
      putSourceVersion.run(
        sourceKey, payloadHash, 'starqNexus', board.file, rowIndex, linkedTaskId, resolution,
        task.status == null ? null : String(task.status), rawPayload, ts,
      );
      putSource.run(
        sourceKey, 'starqNexus', board.file, rowIndex, linkedTaskId, resolution,
        task.status == null ? null : String(task.status), payloadHash, rawPayload, ts,
      );
    }
    const count = Number(handle.prepare('SELECT COUNT(*) AS n FROM pm_tasks WHERE project_id = ?').get(board.id).n);
    handle.prepare('UPDATE pm_projects SET next_seq = ? WHERE id = ?').run(Math.max(count + 1, 1), board.id);
    summary.imported += imported;
    summary.skipped += skipped;
    summary.preserved += preserved;
    summary.boards.push({ id: board.id, imported, preserved, skipped, source: board.file, total: payload.tasks.length });
  }
  handle.prepare("INSERT OR REPLACE INTO pm_meta (key, value) VALUES ('nexus_kanban_import', ?)").run(ts);
  handle.prepare("INSERT OR REPLACE INTO pm_meta (key, value) VALUES ('nexus_kanban_import_summary', ?)").run(json(summary));
  return summary;
}

/** Preserve the pre-takeover PM database as queryable archive records. */
export function importLegacyPmSnapshot(handle, { dbPath, nowIso, json }) {
  const summary = { preserved: 0, source_file: 'command-pm-v1/pm-board.db', errors: [] };
  if (!dbPath || !fs.existsSync(dbPath)) {
    summary.errors.push(`Legacy Command PM database unavailable: ${dbPath || 'path unresolved'}`);
    return summary;
  }
  const legacy = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const meta = legacy.prepare('SELECT key, value FROM pm_meta ORDER BY key').all();
    const projects = legacy.prepare('SELECT * FROM pm_projects ORDER BY rowid').all();
    const tasks = legacy.prepare('SELECT * FROM pm_tasks ORDER BY id').all();
    const histories = legacy.prepare('SELECT * FROM pm_status_log ORDER BY id').all();
    const historyByTask = new Map();
    for (const row of histories) {
      const list = historyByTask.get(row.task_id) ?? [];
      list.push(row);
      historyByTask.set(row.task_id, list);
    }
    const snapshot = { format: 'starq-command-pm-snapshot/v1', meta, projects, tasks, histories };
    const contentHash = createHash('sha256').update(json(snapshot)).digest('hex');
    const ts = nowIso();
    handle.prepare(
      `INSERT INTO pm_import_sources (source_file, source_system, content_sha256, row_count, imported_at)
       VALUES (?, 'starqCommand-pm-board-v1', ?, ?, ?)
       ON CONFLICT(source_file) DO UPDATE SET content_sha256 = excluded.content_sha256, row_count = excluded.row_count, imported_at = excluded.imported_at`,
    ).run(summary.source_file, contentHash, tasks.length, ts);
    handle.prepare(
      'INSERT OR IGNORE INTO pm_import_source_versions (source_file, content_sha256, row_count, imported_at) VALUES (?, ?, ?, ?)',
    ).run(summary.source_file, contentHash, tasks.length, ts);
    const putVersion = handle.prepare(
      `INSERT INTO pm_source_record_versions (source_key, payload_sha256, source_system, source_file, source_row_index, task_id, resolution, raw_status, raw_payload, imported_at)
       VALUES (?, ?, 'starqCommand-pm-board-v1', ?, ?, ?, ?, ?, ?, ?)`,
    );
    const putRecord = handle.prepare(
      `INSERT INTO pm_source_records (source_key, source_system, source_file, source_row_index, task_id, resolution, raw_status, payload_sha256, raw_payload, imported_at)
       VALUES (?, 'starqCommand-pm-board-v1', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET
         task_id = excluded.task_id,
         resolution = excluded.resolution,
         raw_status = excluded.raw_status,
         payload_sha256 = excluded.payload_sha256,
         raw_payload = excluded.raw_payload,
         imported_at = excluded.imported_at`,
    );
    tasks.forEach((task, rowIndex) => {
      const sourceKey = `command-pm-v1:${task.id}`;
      const rawPayload = json({ task, history: historyByTask.get(task.id) ?? [] });
      const payloadHash = createHash('sha256').update(rawPayload).digest('hex');
      // P-1: The four legacy Command tasks PM-CMD-001..004 are archived early work items,
      // not identical to the live native Command tasks. They must be preserved as ARCHIVED_ID_COLLISION.
      const resolution = 'ARCHIVED_ID_COLLISION';
      const linkedTaskId = null;
      const lastVer = handle.prepare(
        'SELECT resolution, task_id, payload_sha256 FROM pm_source_record_versions WHERE source_key = ? ORDER BY rowid DESC LIMIT 1'
      ).get(sourceKey);
      if (!lastVer || lastVer.resolution !== resolution || lastVer.task_id !== linkedTaskId || lastVer.payload_sha256 !== payloadHash) {
        putVersion.run(sourceKey, payloadHash, summary.source_file, rowIndex, linkedTaskId, resolution, String(task.status ?? ''), rawPayload, ts);
      }
      putRecord.run(sourceKey, summary.source_file, rowIndex, linkedTaskId, resolution, String(task.status ?? ''), payloadHash, rawPayload, ts);
      summary.preserved += 1;
    });
    summary.content_sha256 = contentHash;
    summary.history_rows = histories.length;
    summary.projects = projects.length;
    return summary;
  } finally {
    legacy.close();
  }
}
