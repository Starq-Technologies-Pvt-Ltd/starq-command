/**
 * CMD-DI-3-2b — Design Integration Work surface.
 *
 * Read-only list of accepted `WorkPackageRow` values. Project and stage are
 * the only filters, and they only hide rows in this view. This module does
 * not assemble rows from ERP tasks, Hoadha boards, or assignments, and it
 * does not request a work-package endpoint. Evidence → Rooms is a different
 * surface and is not rendered here.
 *
 * `rows === null` means no contract response was supplied. That is UNKNOWN.
 * It is not rewritten into an empty list. `rows === []` is a verified empty
 * response and stays empty.
 */
import * as React from 'react';
import type { WorkPackageEvidenceRow as WorkPackageRow } from '@/lib/contracts';
import { KV, Panel } from '@/components/console';
import { UnknownValue } from '@/components/state-gate';
import { PeerWorkHeader, QualifierRow } from '@/components/work-area';

const ALL = '*';

export interface WorkPackageViewFilters {
  /** Null shows every project id. */
  project_id: string | null;
  /** Null shows every stage label. */
  stage: string | null;
}

export interface WorkPackageStagePresentation {
  label: string;
  origin: 'declared' | 'absent';
}

export interface WorkPackageSupportedText {
  text: string;
  support: 'declared' | 'unsupported';
}

/**
 * A missing stage is shown as UNKNOWN. Any other token is copied as supplied.
 * Blank text is missing. A declared token is not trimmed or translated.
 */
export function workPackageStagePresentation(stage: string | null): WorkPackageStagePresentation {
  if (stage === null || stage.trim() === '') return { label: 'UNKNOWN', origin: 'absent' };
  return { label: stage, origin: 'declared' };
}

/** A missing owner, verifier, or lane is unsupported. It is not given a substitute. */
export function workPackageSupportedText(value: string | null): WorkPackageSupportedText {
  if (value === null || value.trim() === '') return { text: 'unsupported', support: 'unsupported' };
  return { text: value, support: 'declared' };
}

export function workPackageProjectOptions(rows: readonly WorkPackageRow[]): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    if (!seen.includes(row.project_id)) seen.push(row.project_id);
  }
  return seen;
}

export function workPackageStageOptions(rows: readonly WorkPackageRow[]): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    const label = workPackageStagePresentation(row.current_stage).label;
    if (!seen.includes(label)) seen.push(label);
  }
  return seen;
}

export function filterWorkPackageRows(
  rows: readonly WorkPackageRow[],
  filters: WorkPackageViewFilters,
): WorkPackageRow[] {
  return rows.filter((row) => {
    if (filters.project_id !== null && row.project_id !== filters.project_id) return false;
    if (filters.stage !== null && workPackageStagePresentation(row.current_stage).label !== filters.stage) {
      return false;
    }
    return true;
  });
}

export function projectOptionValue(projectId: string): string {
  return `project:${encodeURIComponent(projectId)}`;
}

export function stageOptionValue(label: string): string {
  return `stage:${encodeURIComponent(label)}`;
}

function projectIdFromOption(value: string): string | null {
  if (value === ALL || !value.startsWith('project:')) return null;
  return decodeURIComponent(value.slice('project:'.length));
}

function stageFromOption(value: string): string | null {
  if (value === ALL || !value.startsWith('stage:')) return null;
  return decodeURIComponent(value.slice('stage:'.length));
}

function Field({
  field,
  value,
}: {
  field: string;
  value: WorkPackageSupportedText | WorkPackageStagePresentation;
}) {
  if ('origin' in value) {
    if (value.origin === 'absent') {
      return (
        <span data-contract-field={field} data-stage-origin="absent">
          <UnknownValue label="UNKNOWN" reason="current_stage was not supplied on this row" />
        </span>
      );
    }
    return (
      <span data-contract-field={field} data-stage-origin="declared">
        {value.label}
      </span>
    );
  }
  return (
    <span data-contract-field={field} data-support={value.support}>
      {value.text}
    </span>
  );
}

function WorkPackageFilters({
  rows,
  filters,
  onProject,
  onStage,
}: {
  rows: readonly WorkPackageRow[];
  filters: WorkPackageViewFilters;
  onProject: (projectId: string | null) => void;
  onStage: (stage: string | null) => void;
}) {
  return (
    <div className="qualifier-row" data-work-filters="">
      <label>
        Project
        <select
          aria-label="Project filter"
          value={filters.project_id === null ? ALL : projectOptionValue(filters.project_id)}
          onChange={(event) => onProject(projectIdFromOption(event.target.value))}
        >
          <option value={ALL}>All projects</option>
          {workPackageProjectOptions(rows).map((projectId) => (
            <option key={projectOptionValue(projectId)} value={projectOptionValue(projectId)}>
              {projectId === '' ? 'unsupported' : projectId}
            </option>
          ))}
        </select>
      </label>
      <label>
        Stage
        <select
          aria-label="Stage filter"
          value={filters.stage === null ? ALL : stageOptionValue(filters.stage)}
          onChange={(event) => onStage(stageFromOption(event.target.value))}
        >
          <option value={ALL}>All stages</option>
          {workPackageStageOptions(rows).map((label) => (
            <option key={stageOptionValue(label)} value={stageOptionValue(label)}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function WorkPackageCard({ row }: { row: WorkPackageRow }) {
  const stage = workPackageStagePresentation(row.current_stage);
  const title = workPackageSupportedText(row.title);
  const sourceKind = workPackageSupportedText(row.source.kind);
  const sourceReference = workPackageSupportedText(row.source.reference);
  return (
    <article data-work-package={row.id} data-project-id={row.project_id}>
      <Panel title={title.text}>
        <KV
          rows={[
            ['Id', <Field key="id" field="id" value={workPackageSupportedText(row.id)} />],
            ['Project', <Field key="project" field="project_id" value={workPackageSupportedText(row.project_id)} />],
            ['Title', <Field key="title" field="title" value={title} />],
            ['Stage', <Field key="stage" field="current_stage" value={stage} />],
            ['Owner', <Field key="owner" field="owner" value={workPackageSupportedText(row.owner)} />],
            ['Verifier', <Field key="verifier" field="verifier" value={workPackageSupportedText(row.verifier)} />],
            ['Board lane', <Field key="lane" field="board_lane" value={workPackageSupportedText(row.board_lane)} />],
            ['Source kind', <Field key="kind" field="source.kind" value={sourceKind} />],
            ['Source reference', <Field key="reference" field="source.reference" value={sourceReference} />],
          ]}
        />
      </Panel>
      {row.record ? (
        <Panel title="Recorded work evidence">
          <p>Recorded history. Reported progress does not establish current execution or accepted completion.</p>
          <KV rows={[
            ['Work reference', row.record.work_id], ['Record kind', row.record.kind],
            ['Recorded at', row.record.recorded_at ?? 'UNKNOWN'], ['Room sequence', String(row.record.sequence ?? 'UNKNOWN')],
            ['Reporter', row.record.reporter ?? 'UNKNOWN'], ['Reported action', row.record.reported_action ?? 'UNKNOWN'],
            ['Reported status', row.record.reported_status ?? 'UNKNOWN'], ['Blockers', row.record.blockers ?? 'UNKNOWN'],
            ['Reported verification', row.record.reported_verification ?? 'UNKNOWN'],
            ['Independent verification', row.record.independent_verification], ['Current execution', row.record.current_execution],
            ['Record integrity', row.record.integrity], ['Record hash', row.record.record_hash ?? 'UNKNOWN'],
            ['Ingestion freshness', row.record.projection_state ?? 'UNKNOWN'],
          ]} />
          <details><summary>Canonical evidence text</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{row.record.evidence}</pre></details>
        </Panel>
      ) : null}
    </article>
  );
}

function SuppliedWorkPackages({
  rows,
  filters,
  onProject,
  onStage,
}: {
  rows: readonly WorkPackageRow[];
  filters: WorkPackageViewFilters;
  onProject: (projectId: string | null) => void;
  onStage: (stage: string | null) => void;
}) {
  const visible = filterWorkPackageRows(rows, filters);
  const [pageState, setPageState] = React.useState({filter: '', page: 0});
  const pageSize = 20;
  const lastPage = Math.max(0, Math.ceil(visible.length / pageSize) - 1);
  const filterKey = JSON.stringify(filters);
  const currentPage = Math.min(pageState.filter === filterKey ? pageState.page : 0, lastPage);
  return (
    <Panel title="Work packages" count={`${visible.length} / ${rows.length}`}>
      <WorkPackageFilters rows={rows} filters={filters} onProject={onProject} onStage={onStage} />
      {rows.length === 0 ? (
        <p data-availability="empty">Verified empty. The supplied contract response contains no work packages.</p>
      ) : visible.length === 0 ? (
        <p data-filter-result="none">No work packages match the project and stage filters.</p>
      ) : (
        visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((row, index) => (
          <WorkPackageCard key={`${row.project_id}:${row.id}:${index}`} row={row} />
        ))
      )}
      {visible.length > pageSize ? <nav aria-label="Recorded work pages">
        <button type="button" disabled={currentPage === 0} onClick={() => setPageState({filter: filterKey, page: currentPage - 1})}>Previous records</button>
        <span> Page {currentPage + 1} of {lastPage + 1} · {pageSize} records per page </span>
        <button type="button" disabled={currentPage === lastPage} onClick={() => setPageState({filter: filterKey, page: currentPage + 1})}>Next records</button>
      </nav> : null}
    </Panel>
  );
}

export function WorkPackagesSurface({ rows }: { rows: WorkPackageRow[] | null }) {
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<string | null>(null);
  const filters = { project_id: projectId, stage };

  return (
    <section aria-label="Work packages" data-surface="work-packages" data-readonly="true">
      <PeerWorkHeader
        peer="Work"
        question="Which declared work packages exist, on which project, at which stage?"
      />
      <QualifierRow>
        <span>read-only</span>
        <span>project and stage filters only</span>
        <span>stage is copied from the contract row</span>
        <span>Room records describe recorded history; current execution requires separate evidence</span>
      </QualifierRow>
      {rows === null ? (
        <Panel title="Work packages">
          <p data-availability="UNKNOWN">
            Work package availability is <UnknownValue label="UNKNOWN" reason="No contract row list was supplied" />.
            No package list is shown. An empty list is not assumed.
          </p>
          <p data-filter="project">
            Project filter <UnknownValue label="UNKNOWN" reason="Project ids are not known until rows are supplied" />
          </p>
          <p data-filter="stage">
            Stage filter <UnknownValue label="UNKNOWN" reason="Stages are not known until rows are supplied" />
          </p>
        </Panel>
      ) : (
        <SuppliedWorkPackages rows={rows} filters={filters} onProject={setProjectId} onStage={setStage} />
      )}
    </section>
  );
}
