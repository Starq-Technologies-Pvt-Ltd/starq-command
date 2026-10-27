/**
 * Read-only Kanban presentation of records supplied by the Building projection.
 *
 * Lanes are a display mapping over each source record's declared status. This
 * surface never changes status, writes a task source, or infers dependencies.
 */
import * as React from 'react';
import type { BuildingProjection, BuildingRecord } from '@/lib/contracts';
import { projectIdFromRoute } from '@/lib/building-route';
import { Chip, SourceGap, show } from '@/components/console';

export { projectIdFromRoute };

export const PROJECT_BOARD_LANES = [
  'TODAY',
  'READY',
  'IN PROGRESS',
  'REVIEW',
  'FOUNDER GATE',
  'BLOCKED',
  'DONE',
  'UNKNOWN',
] as const;

export type ProjectBoardLane = (typeof PROJECT_BOARD_LANES)[number];

export function canonicalTaskStatus(record: BuildingRecord): string {
  return show(record.status ?? record.state);
}

function normalizedStatus(record: BuildingRecord): string {
  return canonicalTaskStatus(record)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Lane is the canonical status token only.
 * A founder-gate flag or a blocked boolean does not move a record.
 * A status that is not one of these tokens stays UNKNOWN.
 */
export function mapTaskToProjectLane(record: BuildingRecord): ProjectBoardLane {
  const status = normalizedStatus(record);

  if (status === 'founder_gate' || status === 'gate') return 'FOUNDER GATE';
  if (status === 'blocked') return 'BLOCKED';
  if (status === 'today') return 'TODAY';
  if (status === 'in_progress' || status === 'active' || status === 'wip') return 'IN PROGRESS';
  if (status === 'review' || status === 'in_review') return 'REVIEW';
  if (status === 'done' || status === 'complete' || status === 'completed' || status === 'closed') return 'DONE';
  if (
    status === 'ready' ||
    status === 'todo' ||
    status === 'next' ||
    status === 'planned' ||
    status === 'backlog' ||
    status === 'pending'
  ) {
    return 'READY';
  }
  return 'UNKNOWN';
}

/** Explicit project_id only. `project` and `collection` are not a project id. */
function explicitProjectId(record: BuildingRecord): string | null {
  const value = record.project_id ?? record.projectId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isErpProject(building: BuildingProjection, projectId: string): boolean {
  const key = projectId.trim().toLowerCase();
  if (key === 'erp' || key === 'starqerp' || key === 'starq_erp' || key === 'starq-erp') return true;
  const declared = building.projects.find((project) => project.id === 'erp');
  return declared != null && (key === declared.id.toLowerCase() || key === declared.name.toLowerCase());
}

function isHoadhaRoom(building: BuildingProjection, projectId: string): boolean {
  const key = projectId.trim().toLowerCase();
  if (key === 'hoadha') return true;
  const declared = building.projects.find((project) => project.id === 'hoadha');
  return declared != null && key === declared.name.toLowerCase();
}

function hoadhaLiveRecords(building: BuildingProjection): BuildingRecord[] | null {
  const boards = building.hoadha?.boards ?? [];
  if (boards.length === 0 || boards.some((board) => board.count === null)) return null;
  return boards.flatMap((board) => board.records);
}

export interface ResolvedProjectBoard {
  records: BuildingRecord[] | null;
  projectLabel: string;
  reason: string | null;
}

/**
 * ERP and Hoadha keep their projection slots.
 * Any other project_id renders only live records that already declare that id.
 * `hoadha.proposed` is not a live pool, even when a proposed record declares the id.
 */
export function resolveProjectBoardRecords(
  building: BuildingProjection | null | undefined,
  projectId: string | null | undefined,
): ResolvedProjectBoard {
  const id = projectId?.trim() ?? '';
  if (!building) {
    return {
      records: null,
      projectLabel: id || 'UNKNOWN',
      reason: 'Building projection unavailable.',
    };
  }
  if (!id) {
    return { records: null, projectLabel: 'UNKNOWN', reason: 'Project id unavailable.' };
  }
  const declared = building.projects.find(
    (project) => project.id === id || project.name === id || project.id.toLowerCase() === id.toLowerCase(),
  );
  const projectLabel = declared?.name ?? id;

  if (isErpProject(building, id)) {
    const erp = building.projects.find((project) => project.id === 'erp');
    return {
      records: building.erp_tasks,
      projectLabel: erp?.name ?? 'starqERP',
      reason: building.erp_tasks === null ? 'Historical Nexus ERP task records unavailable in the Building projection (HISTORICAL_SNAPSHOT; not a Command board).' : null,
    };
  }

  if (isHoadhaRoom(building, id)) {
    const records = hoadhaLiveRecords(building);
    return {
      records,
      projectLabel: building.projects.find((project) => project.id === 'hoadha')?.name ?? 'Hoadha',
      reason: records === null ? 'Historical Nexus Hoadha board records unavailable in the Building projection (HISTORICAL_SNAPSHOT; not a Command board).' : null,
    };
  }

  const pools: BuildingRecord[][] = [];
  if (Array.isArray(building.erp_tasks)) pools.push(building.erp_tasks);
  for (const item of building.hoadha?.boards ?? []) {
    if (Array.isArray(item.records)) pools.push(item.records);
  }
  const matched = pools.flat().filter((record) => explicitProjectId(record) === id);
  if (matched.length > 0) {
    return { records: matched, projectLabel, reason: null };
  }
  if (declared) {
    return {
      records: null,
      projectLabel,
      reason: `${projectLabel} is declared and has no task records in the building projection. None were inferred.`,
    };
  }
  return {
    records: null,
    projectLabel,
    reason: `Project ${id} is not in the building projection.`,
  };
}

function projectOf(record: BuildingRecord): string {
  const value = record.project_id ?? record.projectId ?? record.project ?? record.collection;
  return typeof value === 'string' && value.trim() ? value.trim() : 'UNKNOWN';
}

function textField(record: BuildingRecord, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(show).join(', ');
  return show(value);
}

export function filterProjectBoardRecords(
  records: BuildingRecord[],
  options: { project?: string; lane?: ProjectBoardLane | 'ALL'; status?: string; query?: string },
): BuildingRecord[] {
  const query = options.query?.trim().toLowerCase() ?? '';
  return records.filter((record) => {
    if (options.project && options.project !== 'ALL' && projectOf(record) !== options.project) return false;
    if (options.lane && options.lane !== 'ALL' && mapTaskToProjectLane(record) !== options.lane) return false;
    if (options.status && options.status !== 'ALL' && canonicalTaskStatus(record) !== options.status) return false;
    if (!query) return true;
    const owner = textField(record, ['owner', 'ownerLabel', 'assignee', 'assigned_to', 'seat', 'workers']);
    const blocker = textField(record, ['blocker', 'blocked_reason', 'blocked_by', 'blockedBy']);
    return `${record.id} ${show(record.title)} ${canonicalTaskStatus(record)} ${projectOf(record)} ${show(record.collection)} ${valueText(owner)} ${valueText(blocker)} ${show(record.phase)} ${show(record.wave)} ${show(record.sprint)}`
      .toLowerCase()
      .includes(query);
  });
}

export function ProjectTaskDetails({ record }: { record: BuildingRecord }) {
  const owner = textField(record, ['owner', 'ownerLabel', 'assignee', 'assigned_to', 'seat', 'workers']);
  const blocker = textField(record, ['blocker', 'blocked_reason', 'blocked_by', 'blockedBy']);
  const fields: [string, unknown][] = [
    ['Canonical source status', canonicalTaskStatus(record)],
    ['Declared project id', explicitProjectId(record) ?? 'UNKNOWN'],
    ['Collection', record.collection],
    ['Owner', owner],
    ['Blocker', blocker],
    ['Source', record.source],
  ];
  if (record.requires_founder === true || record.requiresFounder === true || record.isFounderGate === true || record.is_gate === true) {
    fields.push(['Founder gate flag', 'declared on the record; lane follows canonical status']);
  }
  return (
    <section className="command-panel" aria-labelledby="project-board-task-details">
      <div className="head"><h3 id="project-board-task-details">{show(record.id)} · {show(record.title)}</h3></div>
      <dl className="kv">
        {fields.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt><dd>{valueText(value)}</dd>
          </React.Fragment>
        ))}
        {Object.entries(record)
          .filter(([key]) => /sha256|source_hash|modified_at|generated_at/i.test(key))
          .map(([key, value]) => (
            <React.Fragment key={key}><dt>{key}</dt><dd>{valueText(value)}</dd></React.Fragment>
          ))}
      </dl>
    </section>
  );
}

export function ProjectBoard({
  records,
  label,
  projectLabel,
  projectId,
  building,
}: {
  records?: BuildingRecord[] | null;
  label: string;
  projectLabel: string;
  projectId?: string | null;
  building?: BuildingProjection | null;
}) {
  const [project, setProject] = React.useState('ALL');
  const [lane, setLane] = React.useState<ProjectBoardLane | 'ALL'>('ALL');
  const [status, setStatus] = React.useState('ALL');
  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const resolved = records !== undefined ? null : resolveProjectBoardRecords(building, projectId);
  const supplied = records !== undefined ? records : resolved?.records ?? null;
  const all = supplied ?? [];

  const projects = React.useMemo(
    () => [...new Set(all.map(projectOf))].sort((a, b) => a.localeCompare(b)),
    [all],
  );
  const statuses = React.useMemo(
    () => [...new Set(all.map(canonicalTaskStatus))].sort((a, b) => a.localeCompare(b)),
    [all],
  );
  const filtered = React.useMemo(
    () => filterProjectBoardRecords(all, { project, lane, status, query }),
    [all, project, lane, status, query],
  );
  const selected = filtered.find((record) => record.id === selectedId) ?? null;

  if (supplied === null) {
    return (
      <SourceGap
        reason={records !== undefined ? `${label} unavailable.` : resolved?.reason ?? `${label} unavailable.`}
        detail="The Building projection supplied no task records. No fallback or historical task data is shown."
      />
    );
  }

  return (
    <section className="command-panel project-board" aria-label={`${projectLabel} project board`}>
      <div className="head">
        <h2>{label}</h2>
        <span className="chip" data-tone="muted">{filtered.length} / {all.length}</span>
        <span className="spacer" />
        <Chip value="READ ONLY" />
        <Chip value="HISTORICAL_SNAPSHOT" />
      </div>

      <div className="flex flex-wrap items-end gap-2 border-b border-border p-2.5">
        <label className="grid min-w-36 flex-1 gap-1 text-2xs text-muted-foreground">
          Project
          <select aria-label="Project filter" value={project} onChange={(event) => setProject(event.target.value)}>
            <option value="ALL">All projects</option>
            {projects.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="grid min-w-36 flex-1 gap-1 text-2xs text-muted-foreground">
          Lane
          <select aria-label="Lane filter" value={lane} onChange={(event) => setLane(event.target.value as ProjectBoardLane | 'ALL')}>
            <option value="ALL">All lanes</option>
            {PROJECT_BOARD_LANES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="grid min-w-36 flex-1 gap-1 text-2xs text-muted-foreground">
          Source status
          <select aria-label="Source status filter" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">All source statuses</option>
            {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="grid min-w-44 flex-[2] gap-1 text-2xs text-muted-foreground">
          Search
          <input aria-label="Search project tasks" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, title, status or project" />
        </label>
      </div>

      {all.length === 0 ? (
        <SourceGap reason="Source read, zero task records." detail={`${label} has no records in the current projection.`} />
      ) : (
        <div className="grid grid-cols-1 gap-2 p-2 md:grid-cols-2 2xl:grid-cols-4">
          {PROJECT_BOARD_LANES.map((laneName) => {
            const laneRecords = filtered.filter((record) => mapTaskToProjectLane(record) === laneName);
            return (
              <section key={laneName} className="min-w-0 rounded border border-border bg-background/40" aria-labelledby={`project-board-lane-${laneName.replaceAll(' ', '-')}`}>
                <header className="sticky top-0 z-[1] flex items-center justify-between border-b border-border bg-card px-2.5 py-2">
                  <h3 id={`project-board-lane-${laneName.replaceAll(' ', '-')}`} className="font-mono text-[10px] font-semibold tracking-wide">{laneName}</h3>
                  <span className="chip" data-tone="muted">{laneRecords.length}</span>
                </header>
                <ul className="project-board-lane-list grid max-h-[60vh] content-start gap-1.5 overflow-y-auto overscroll-contain p-1.5">
                  {laneRecords.map((record, index) => {
                    const chosen = selectedId === record.id;
                    return (
                      <li key={`${record.collection}:${record.id}:${index}`}>
                        <button
                          type="button"
                          aria-pressed={chosen}
                          onClick={() => setSelectedId(chosen ? null : record.id)}
                          className={`w-full rounded border p-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${chosen ? 'border-[hsl(var(--room))] bg-[hsl(var(--room-soft))]' : 'border-border bg-card hover:border-[hsl(var(--room)/.6)]'}`}
                        >
                          <span className="flex flex-wrap items-start justify-between gap-1">
                            <span className="font-mono text-[10px] text-[hsl(var(--room))]">{show(record.id)}</span>
                            <span className="text-[9px] text-muted-foreground">{projectOf(record)}</span>
                          </span>
                          <span className="mt-1 block text-xs font-medium leading-5">{show(record.title)}</span>
                          <span className="mt-1 flex flex-wrap items-center justify-between gap-1 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
                            <span>{valueText(textField(record, ['owner', 'ownerLabel', 'assignee', 'assigned_to', 'seat', 'workers']))}</span>
                            <span>source: {canonicalTaskStatus(record)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {all.length > 0 && filtered.length === 0 ? <p className="px-3 pb-3 text-xs text-muted-foreground">No task records match these filters.</p> : null}
      {selected ? <div className="border-t border-border p-2.5"><ProjectTaskDetails record={selected} /></div> : null}
      <p className="px-3 pb-2 text-[10px] text-muted-foreground">Lanes are a presentation mapping of canonical source status. Statuses that do not map stay in the UNKNOWN lane. This board does not change task state.</p>
    </section>
  );
}
