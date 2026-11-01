/**
 * Writable operating organization — talks only to the PM service (:5176).
 *
 * Canonical seats remain Company OS Structure / Seats. This surface is the
 * Founder-operated org graph (company, units, positions, people, appointments)
 * and does not read the company-os projection. Edits, moves, archives, and
 * history go through the PM client and read back with pmOrg.
 */
import * as React from 'react';
import { Chip, GoLink, KV, Panel, RoomHead, SourceGap, show } from '@/components/console';
import { PmEmpty, PmLoading, PmRejected, PmSaved, PmUnavailable } from '@/components/pm-feedback';
import { PeerWorkHeader } from '@/components/work-area';
import { readClaimedActor, storeClaimedActor } from '@/lib/acting-as';
import {
  PM_PERSON_KINDS,
  PM_UNIT_KINDS,
  pmCreateAppointment,
  pmCreateCompany,
  pmCreatePerson,
  pmCreatePosition,
  pmCreateUnit,
  pmEndAppointment,
  pmIsScratch,
  pmOrg,
  pmOrgCompanies,
  pmOrgHistory,
  pmPatchCompany,
  pmPatchPerson,
  pmPatchPosition,
  pmPatchUnit,
  pmPort,
  pmQuery,
  type PmOrg,
  type PmOrgAppointment,
  type PmOrgCompany,
  type PmOrgHistoryEntry,
  type PmOrgPerson,
  type PmOrgPosition,
  type PmOrgUnit,
  type PmPersonKind,
  type PmResult,
  type PmUnitKind,
} from '@/lib/pm-client';
import { refusalFix } from '@/lib/stage-refusal';

const field = 'grid gap-1 text-2xs text-muted-foreground';
const PERSON_STATUSES = ['active', 'inactive'] as const;
const KIND_ORDER = ['COMPANY', 'DIVISION', 'DEPARTMENT', 'TEAM'];

type WriteRejection = { code: string; message: string; fix?: string | null };
type UnitDraft = { name: string; kind: string; parent_id: string; description: string };
type PositionDraft = { title: string; job_description: string; unit_id: string; reports_to_position_id: string };
type PersonDraft = { display_name: string; kind: string; status: string; harness: string; capabilities: string };
type CompanyDraft = { name: string; legal_name: string; notes: string };

interface UnitNode {
  unit: PmOrgUnit;
  children: UnitNode[];
}

interface OrgModel {
  busy: boolean;
  people: PmOrgPerson[];
  units: PmOrgUnit[];
  positions: PmOrgPosition[];
  appointments: PmOrgAppointment[];
  endedAppointments: PmOrgAppointment[] | null;
  unitDraft: (unit: PmOrgUnit) => UnitDraft;
  changeUnit: (unit: PmOrgUnit, patch: Partial<UnitDraft>) => void;
  saveUnit: (unit: PmOrgUnit) => void;
  archiveUnit: (id: string) => void;
  restoreUnit: (id: string) => void;
  positionDraft: (position: PmOrgPosition) => PositionDraft;
  changePosition: (position: PmOrgPosition, patch: Partial<PositionDraft>) => void;
  savePosition: (position: PmOrgPosition) => void;
  archivePosition: (id: string) => void;
  restorePosition: (id: string) => void;
  endNotes: (appointmentId: string) => string;
  changeEndNotes: (appointmentId: string, notes: string) => void;
  endAppointment: (appointmentId: string) => void;
  companyDraft: (company: PmOrgCompany) => CompanyDraft;
  changeCompany: (company: PmOrgCompany, patch: Partial<CompanyDraft>) => void;
  saveCompany: (company: PmOrgCompany) => void;
  archiveCompany: (id: string) => void;
  restoreCompany: (id: string) => void;
  personDraft: (person: PmOrgPerson) => PersonDraft;
  changePerson: (person: PmOrgPerson, patch: Partial<PersonDraft>) => void;
  savePerson: (person: PmOrgPerson) => void;
  archivePerson: (id: string) => void;
  restorePerson: (id: string) => void;
}

function isOrgPayload(data: unknown): data is PmOrg {
  if (!data || typeof data !== 'object') return false;
  const row = data as PmOrg;
  return (
    Array.isArray(row.units) &&
    Array.isArray(row.positions) &&
    Array.isArray(row.people) &&
    Array.isArray(row.appointments)
  );
}

function HonestyLine() {
  return (
    <p className="prose-note" data-org-honesty="">
      Canonical seats remain the Company OS Structure/Seats tabs; this Operate tab is the writable
      operating org. It reads and writes the PM service only — not the company-os projection.
    </p>
  );
}

function kindRank(kind: string): number {
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

function compareUnits(a: PmOrgUnit, b: PmOrgUnit): number {
  const rank = kindRank(String(a.kind)) - kindRank(String(b.kind));
  if (rank !== 0) return rank;
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function parentKey(unit: PmOrgUnit): string {
  return typeof unit.parent_id === 'string' ? unit.parent_id.trim() : '';
}

/**
 * Nest units by parent_id. A parent id that is not in the loaded set is
 * unplaced — the unit stays visible. Cycles are listed once under Unplaced
 * rather than walked forever.
 */
function buildUnitForest(units: PmOrgUnit[]): { roots: UnitNode[]; unplaced: UnitNode[] } {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const childrenOf = new Map<string, PmOrgUnit[]>();
  const roots: PmOrgUnit[] = [];
  const unplacedUnits: PmOrgUnit[] = [];

  for (const unit of units) {
    const parentId = parentKey(unit);
    if (!parentId) {
      roots.push(unit);
      continue;
    }
    if (!byId.has(parentId)) {
      unplacedUnits.push(unit);
      continue;
    }
    const list = childrenOf.get(parentId) ?? [];
    list.push(unit);
    childrenOf.set(parentId, list);
  }

  const seen = new Set<string>();
  const toNode = (unit: PmOrgUnit, stack: Set<string>): UnitNode => {
    seen.add(unit.id);
    const nextStack = new Set(stack);
    nextStack.add(unit.id);
    const children = (childrenOf.get(unit.id) ?? [])
      .filter((child) => !nextStack.has(child.id))
      .sort(compareUnits)
      .map((child) => toNode(child, nextStack));
    return { unit, children };
  };

  const rootNodes = [...roots].sort(compareUnits).map((unit) => toNode(unit, new Set()));
  const unplacedNodes = [...unplacedUnits].sort(compareUnits).map((unit) => toNode(unit, new Set()));
  const cyclic = units.filter((unit) => !seen.has(unit.id)).sort(compareUnits);
  for (const unit of cyclic) {
    if (seen.has(unit.id)) continue;
    unplacedNodes.push(toNode(unit, new Set()));
  }
  return { roots: rootNodes, unplaced: unplacedNodes };
}

function blockedParentIds(unitId: string, units: PmOrgUnit[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const unit of units) {
    const parentId = parentKey(unit);
    if (!parentId) continue;
    const list = children.get(parentId) ?? [];
    list.push(unit.id);
    children.set(parentId, list);
  }
  const blocked = new Set<string>([unitId]);
  const walk = (id: string) => {
    for (const childId of children.get(id) ?? []) {
      if (blocked.has(childId)) continue;
      blocked.add(childId);
      walk(childId);
    }
  };
  walk(unitId);
  return blocked;
}

function withCurrent(options: readonly string[], current: string): string[] {
  if (!current || options.includes(current)) return [...options];
  return [...options, current];
}

function personDisplay(people: PmOrgPerson[], personId: string): string {
  const person = people.find((row) => row.id === personId);
  const name = person?.display_name?.trim();
  return name ? person!.display_name : 'UNKNOWN';
}

function blankUnitDraft(unit: PmOrgUnit): UnitDraft {
  return {
    name: unit.name,
    kind: String(unit.kind),
    parent_id: parentKey(unit),
    description: unit.description ?? '',
  };
}

function blankPositionDraft(position: PmOrgPosition): PositionDraft {
  return {
    title: position.title,
    job_description: position.job_description ?? '',
    unit_id: position.unit_id,
    reports_to_position_id: position.reports_to_position_id ?? '',
  };
}

function blankPersonDraft(person: PmOrgPerson): PersonDraft {
  return {
    display_name: person.display_name,
    kind: String(person.kind),
    status: person.status ?? '',
    harness: person.harness ?? '',
    capabilities: (person.capabilities ?? []).join(', '),
  };
}

function blankCompanyDraft(company: PmOrgCompany): CompanyDraft {
  return {
    name: company.name,
    legal_name: company.legal_name ?? '',
    notes: company.notes ?? '',
  };
}

function omitKey<T>(prev: Record<string, T>, id: string): Record<string, T> {
  if (!(id in prev)) return prev;
  const next = { ...prev };
  delete next[id];
  return next;
}

function HistoryPanel({
  tried,
  error,
  rows,
}: {
  tried: boolean;
  error: string | null;
  rows: PmOrgHistoryEntry[] | null;
}) {
  return (
    <section aria-label="Org history" data-org-history="" className="mt-2">
      <Panel title="Org history" count={rows ? String(rows.length) : tried ? 'UNAVAILABLE' : 'LOADING'}>
        <div className="body grid gap-2">
          {!tried ? <PmLoading label="Reading org history…" /> : null}
          {tried && error ? <PmUnavailable reason={error} /> : null}
          {tried && !error && rows && rows.length === 0 ? <PmEmpty label="No org history." /> : null}
          {rows && rows.length > 0 ? (
            <ul className="work-row-list">
              {rows.map((row) => (
                <li key={String(row.id)} className="work-row" data-history-id={String(row.id)} data-selected="false">
                  <span className="k" data-history-actor="">{show(row.actor)}</span>
                  <span className="r" data-history-action="">{show(row.action)}</span>
                  <span className="v" data-history-entity="">{show(row.entity)} {show(row.entity_id)}</span>
                  <time className="font-mono text-3xs text-muted-foreground" dateTime={typeof row.timestamp === 'string' ? row.timestamp : undefined}>
                    {show(row.timestamp)}
                  </time>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Panel>
    </section>
  );
}

function EndedAppointment({ appointment, model }: { appointment: PmOrgAppointment; model: OrgModel }) {
  return (
    <div data-appointment-id={appointment.id} data-appointment-state="ended" className="flex flex-wrap items-center gap-2 text-2xs">
      <strong>ENDED</strong>
      <span>{personDisplay(model.people, appointment.person_id)}</span>
      <span className="font-mono text-3xs text-muted-foreground">{appointment.id}</span>
    </div>
  );
}

function ActiveAppointment({ appointment, model }: { appointment: PmOrgAppointment; model: OrgModel }) {
  return (
    <div data-appointment-id={appointment.id} data-appointment-state="active" className="flex flex-wrap items-end gap-2">
      <span>{personDisplay(model.people, appointment.person_id)}</span>
      <span className="font-mono text-3xs text-muted-foreground">{appointment.id}</span>
      <label className={field}>
        End notes
        <input
          aria-label={`Appointment ${appointment.id} notes`}
          value={model.endNotes(appointment.id)}
          onChange={(event) => model.changeEndNotes(appointment.id, event.target.value)}
        />
      </label>
      <button
        type="button"
        className="go-link"
        aria-label={`End appointment ${appointment.id}`}
        disabled={model.busy}
        onClick={() => model.endAppointment(appointment.id)}
      >
        End appointment
      </button>
    </div>
  );
}

function PositionCard({ position, model }: { position: PmOrgPosition; model: OrgModel }) {
  const draft = model.positionDraft(position);
  const reportsToId = position.reports_to_position_id?.trim() || '';
  const reportsTo = reportsToId ? model.positions.find((row) => row.id === reportsToId) : undefined;
  const active = model.appointments.filter((row) => row.position_id === position.id);
  const ended = (model.endedAppointments ?? []).filter((row) => row.position_id === position.id);
  const unitKnown = model.units.some((unit) => unit.id === draft.unit_id);
  const reportsKnown = !draft.reports_to_position_id || model.positions.some((row) => row.id === draft.reports_to_position_id);

  return (
    <div data-position-id={position.id} className="grid gap-2 rounded border border-border p-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <strong data-position-title={position.id}>{position.title}</strong>
        {reportsToId ? (
          <span data-reports-to={reportsToId}>reports to {reportsTo?.title ?? 'UNKNOWN'}</span>
        ) : null}
        <span className="font-mono text-3xs text-muted-foreground">{position.id}</span>
      </div>
      {position.job_description ? <p className="prose-note">{position.job_description}</p> : null}
      {active.length || ended.length ? (
        <div className="grid gap-1">
          {active.map((appointment) => <ActiveAppointment key={appointment.id} appointment={appointment} model={model} />)}
          {model.endedAppointments ? ended.map((appointment) => (
            <EndedAppointment key={appointment.id} appointment={appointment} model={model} />
          )) : null}
        </div>
      ) : null}
      <form
        aria-label={`Edit position ${position.id}`}
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          model.savePosition(position);
        }}
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <label className={field}>
            Title
            <input
              aria-label={`Position ${position.id} title`}
              value={draft.title}
              onChange={(event) => model.changePosition(position, { title: event.target.value })}
            />
          </label>
          <label className={field}>
            Move to unit
            <select
              aria-label={`Move position ${position.id}`}
              value={draft.unit_id}
              onChange={(event) => model.changePosition(position, { unit_id: event.target.value })}
            >
              {!unitKnown && draft.unit_id ? <option value={draft.unit_id}>{draft.unit_id} (missing)</option> : null}
              {model.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
          <label className={field}>
            Reports to
            <select
              aria-label={`Position ${position.id} reports to`}
              value={draft.reports_to_position_id}
              onChange={(event) => model.changePosition(position, { reports_to_position_id: event.target.value })}
            >
              <option value="">none</option>
              {!reportsKnown ? <option value={draft.reports_to_position_id}>{draft.reports_to_position_id} (missing)</option> : null}
              {model.positions.filter((row) => row.id !== position.id).map((row) => (
                <option key={row.id} value={row.id}>{row.title}</option>
              ))}
            </select>
          </label>
          <label className={field}>
            Job description
            <input
              aria-label={`Position ${position.id} job description`}
              value={draft.job_description}
              onChange={(event) => model.changePosition(position, { job_description: event.target.value })}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="go-link"
            aria-label={`Save position ${position.id}`}
            disabled={model.busy}
            onClick={() => model.savePosition(position)}
          >
            Save position
          </button>
          {position.archived_at ? (
            <button type="button" className="go-link" aria-label={`Restore position ${position.id}`} disabled={model.busy} onClick={() => model.restorePosition(position.id)}>
              Restore
            </button>
          ) : (
            <button type="button" className="go-link" aria-label={`Archive position ${position.id}`} disabled={model.busy} onClick={() => model.archivePosition(position.id)}>
              Archive
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function UnitBranch({ node, model }: { node: UnitNode; model: OrgModel }) {
  const { unit } = node;
  const draft = model.unitDraft(unit);
  const positions = model.positions.filter((position) => position.unit_id === unit.id);
  const blocked = blockedParentIds(unit.id, model.units);
  const parentOptions = model.units.filter((row) => !blocked.has(row.id));
  const missingParent = Boolean(draft.parent_id) && !model.units.some((row) => row.id === draft.parent_id);
  const kinds = withCurrent(PM_UNIT_KINDS, draft.kind);

  return (
    <li data-unit-id={unit.id} data-unit-kind={unit.kind} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Chip value={unit.kind} />
        <span data-unit-name={unit.id}>{unit.name}</span>
        <span className="font-mono text-3xs text-muted-foreground">{unit.id}</span>
      </div>
      {unit.description ? <p className="prose-note">{unit.description}</p> : null}
      {positions.length ? (
        <ul className="grid gap-2" data-unit-positions={unit.id}>
          {positions.map((position) => (
            <li key={position.id}>
              <PositionCard position={position} model={model} />
            </li>
          ))}
        </ul>
      ) : null}
      <form
        aria-label={`Edit unit ${unit.id}`}
        className="grid gap-2 rounded border border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          model.saveUnit(unit);
        }}
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <label className={field}>
            Name
            <input
              aria-label={`Unit ${unit.id} name`}
              value={draft.name}
              onChange={(event) => model.changeUnit(unit, { name: event.target.value })}
            />
          </label>
          <label className={field}>
            Kind
            <select
              aria-label={`Unit ${unit.id} kind`}
              value={draft.kind}
              onChange={(event) => model.changeUnit(unit, { kind: event.target.value })}
            >
              {kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
            </select>
          </label>
          <label className={field}>
            Move under
            <select
              aria-label={`Move unit ${unit.id}`}
              value={draft.parent_id}
              onChange={(event) => model.changeUnit(unit, { parent_id: event.target.value })}
            >
              <option value="">Top level</option>
              {missingParent ? <option value={draft.parent_id}>{draft.parent_id} (missing)</option> : null}
              {parentOptions.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.kind})</option>)}
            </select>
          </label>
          <label className={field}>
            Description
            <input
              aria-label={`Unit ${unit.id} description`}
              value={draft.description}
              onChange={(event) => model.changeUnit(unit, { description: event.target.value })}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="go-link"
            aria-label={`Save unit ${unit.id}`}
            disabled={model.busy}
            onClick={() => model.saveUnit(unit)}
          >
            Save unit
          </button>
          {unit.archived_at ? (
            <button
              type="button"
              className="go-link"
              aria-label={`Restore unit ${unit.id}`}
              disabled={model.busy}
              onClick={() => model.restoreUnit(unit.id)}
            >
              Restore
            </button>
          ) : (
            <button
              type="button"
              className="go-link"
              aria-label={`Archive unit ${unit.id}`}
              disabled={model.busy}
              onClick={() => model.archiveUnit(unit.id)}
            >
              Archive
            </button>
          )}
        </div>
      </form>
      {node.children.length ? (
        <ul className="ms-3 grid gap-2 border-s border-border ps-3">
          {node.children.map((child) => <UnitBranch key={child.unit.id} node={child} model={model} />)}
        </ul>
      ) : null}
    </li>
  );
}

function CompanySection({
  company,
  nodes,
  model,
}: {
  company: PmOrgCompany;
  nodes: UnitNode[];
  model: OrgModel;
}) {
  const draft = model.companyDraft(company);
  return (
    <section data-company-id={company.id} data-org-company="" className="grid gap-2">
      <h3>{company.name}</h3>
      <form
        aria-label={`Edit company ${company.id}`}
        className="grid gap-2 rounded border border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          model.saveCompany(company);
        }}
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <label className={field}>
            Name
            <input
              aria-label={`Company ${company.id} name`}
              value={draft.name}
              onChange={(event) => model.changeCompany(company, { name: event.target.value })}
            />
          </label>
          <label className={field}>
            Legal name
            <input
              aria-label={`Company ${company.id} legal name`}
              value={draft.legal_name}
              onChange={(event) => model.changeCompany(company, { legal_name: event.target.value })}
            />
          </label>
          <label className={field}>
            Notes
            <input
              aria-label={`Company ${company.id} notes`}
              value={draft.notes}
              onChange={(event) => model.changeCompany(company, { notes: event.target.value })}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="go-link"
            aria-label={`Save company ${company.id}`}
            disabled={model.busy}
            onClick={() => model.saveCompany(company)}
          >
            Save company
          </button>
          {company.archived_at ? (
            <button type="button" className="go-link" aria-label={`Restore company ${company.id}`} disabled={model.busy} onClick={() => model.restoreCompany(company.id)}>
              Restore
            </button>
          ) : (
            <button type="button" className="go-link" aria-label={`Archive company ${company.id}`} disabled={model.busy} onClick={() => model.archiveCompany(company.id)}>
              Archive
            </button>
          )}
        </div>
      </form>
      {nodes.length ? (
        <ul className="grid gap-3">
          {nodes.map((node) => <UnitBranch key={node.unit.id} node={node} model={model} />)}
        </ul>
      ) : (
        <PmEmpty label="No units recorded under this company." />
      )}
    </section>
  );
}

function OrganizationTree({ org, model }: { org: PmOrg; model: OrgModel }) {
  const companies = pmOrgCompanies(org);
  const { roots, unplaced } = React.useMemo(() => buildUnitForest(org.units), [org.units]);
  const companyIds = new Set(companies.map((company) => company.id));
  const byCompany = new Map<string, UnitNode[]>(companies.map((company) => [company.id, []]));
  const loose: UnitNode[] = [];
  for (const node of roots) {
    if (companyIds.has(node.unit.company_id)) byCompany.get(node.unit.company_id)?.push(node);
    else loose.push(node);
  }
  const unitIds = new Set(org.units.map((unit) => unit.id));
  const positionIds = new Set(org.positions.map((position) => position.id));
  const orphanPositions = org.positions.filter((position) => !unitIds.has(position.unit_id));
  const orphanActive = org.appointments.filter((appointment) => !positionIds.has(appointment.position_id));
  const orphanEnded = (org.ended_appointments ?? []).filter((appointment) => !positionIds.has(appointment.position_id));
  const showUnplaced = unplaced.length > 0 || orphanPositions.length > 0 || orphanActive.length > 0 || orphanEnded.length > 0;

  return (
    <div data-org-tree="" className="grid gap-4" aria-label="Organization tree">
      {companies.length === 0 && loose.length === 0 && !showUnplaced ? <PmEmpty label="No company recorded." /> : null}
      {companies.map((company) => (
        <CompanySection key={company.id} company={company} nodes={byCompany.get(company.id) ?? []} model={model} />
      ))}
      {loose.length ? (
        <section data-org-company-gap="" className="grid gap-2">
          <h3>Company not recorded</h3>
          <ul className="grid gap-3">
            {loose.map((node) => <UnitBranch key={node.unit.id} node={node} model={model} />)}
          </ul>
        </section>
      ) : null}
      {showUnplaced ? (
        <section data-org-unplaced="" className="grid gap-2">
          <h3>Unplaced</h3>
          {unplaced.length ? (
            <ul className="grid gap-3">
              {unplaced.map((node) => <UnitBranch key={node.unit.id} node={node} model={model} />)}
            </ul>
          ) : null}
          {orphanPositions.length ? (
            <ul className="grid gap-2">
              {orphanPositions.map((position) => (
                <li key={position.id}>
                  <PositionCard position={position} model={model} />
                </li>
              ))}
            </ul>
          ) : null}
          {orphanActive.map((appointment) => <ActiveAppointment key={appointment.id} appointment={appointment} model={model} />)}
          {org.ended_appointments ? orphanEnded.map((appointment) => (
            <EndedAppointment key={appointment.id} appointment={appointment} model={model} />
          )) : null}
        </section>
      ) : null}
    </div>
  );
}

function PersonCard({ person, model }: { person: PmOrgPerson; model: OrgModel }) {
  const draft = model.personDraft(person);
  const kinds = withCurrent(PM_PERSON_KINDS, draft.kind);
  const statuses = withCurrent(PERSON_STATUSES, draft.status);
  return (
    <li className="grid gap-2 rounded border border-border p-2" data-person-id={person.id}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span data-person-name={person.id}>{person.display_name}</span>
        <span>@{person.handle}</span>
        <Chip value={person.kind} />
        <span>{person.status?.trim() ? person.status : 'UNKNOWN'}</span>
        {person.harness ? <span>{person.harness}</span> : null}
      </div>
      <form
        aria-label={`Edit person ${person.id}`}
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          model.savePerson(person);
        }}
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
          <label className={field}>
            Display name
            <input
              aria-label={`Person ${person.id} display name`}
              value={draft.display_name}
              onChange={(event) => model.changePerson(person, { display_name: event.target.value })}
            />
          </label>
          <label className={field}>
            Kind
            <select
              aria-label={`Person ${person.id} kind`}
              value={draft.kind}
              onChange={(event) => model.changePerson(person, { kind: event.target.value })}
            >
              {kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
            </select>
          </label>
          <label className={field}>
            Status
            <select
              aria-label={`Person ${person.id} status`}
              value={draft.status}
              onChange={(event) => model.changePerson(person, { status: event.target.value })}
            >
              <option value="">—</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className={field}>
            Harness
            <input
              aria-label={`Person ${person.id} harness`}
              value={draft.harness}
              onChange={(event) => model.changePerson(person, { harness: event.target.value })}
            />
          </label>
          <label className={field}>
            Capabilities
            <input
              aria-label={`Person ${person.id} capabilities`}
              value={draft.capabilities}
              placeholder="comma-separated"
              onChange={(event) => model.changePerson(person, { capabilities: event.target.value })}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="go-link"
            aria-label={`Save person ${person.id}`}
            disabled={model.busy}
            onClick={() => model.savePerson(person)}
          >
            Save person
          </button>
          {person.archived_at ? (
            <button type="button" className="go-link" aria-label={`Restore person ${person.id}`} disabled={model.busy} onClick={() => model.restorePerson(person.id)}>
              Restore
            </button>
          ) : (
            <button type="button" className="go-link" aria-label={`Archive person ${person.id}`} disabled={model.busy} onClick={() => model.archivePerson(person.id)}>
              Archive
            </button>
          )}
        </div>
      </form>
    </li>
  );
}

export function OrgOperateSnapshot() {
  const [org, setOrg] = React.useState<PmOrg | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void pmOrg().then((res) => {
      if (!active) return;
      setTried(true);
      if (res.ok && isOrgPayload(res.data)) {
        setOrg(res.data);
        setProblem(null);
      } else {
        setOrg(null);
        setProblem(res.ok ? 'PM org payload is not a recognized operating-org snapshot.' : `${res.state}: ${res.message}`);
      }
    });
    return () => { active = false; };
  }, []);

  const companies = pmOrgCompanies(org);
  const href = `#company/operate${pmQuery()}`;

  return (
    <Panel
      title="Operating organization"
      count={org ? `${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} · ${org.units.length} units` : tried ? 'UNAVAILABLE' : 'LOADING'}
      toolbar={<GoLink href={href}>Manage organization →</GoLink>}
    >
      <div className="body grid gap-2">
        <HonestyLine />
        {problem ? <SourceGap reason="Operating org unavailable from :5176." detail={problem} /> : null}
        {org ? (
          <KV
            rows={[
              ['Company', companies.map((c) => c.name).join(' · ') || 'none recorded'],
              ['Units', String(org.units.length)],
              ['Positions', String(org.positions.length)],
              ['People', String(org.people.length)],
              ['Appointments', String(org.appointments.length)],
              ['Room post', org.room_post || 'UNKNOWN'],
              ['As of', org.generated_at || 'UNKNOWN'],
            ]}
          />
        ) : !tried ? (
          <p className="text-2xs text-muted-foreground">Reading PM org…</p>
        ) : null}
      </div>
    </Panel>
  );
}

export function OrgOperateSurface() {
  const [org, setOrg] = React.useState<PmOrg | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [rejected, setRejected] = React.useState<WriteRejection | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actor, setActorState] = React.useState(readClaimedActor);
  const [history, setHistory] = React.useState<PmOrgHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const [historyTried, setHistoryTried] = React.useState(false);
  const [companyForm, setCompanyForm] = React.useState({ name: '', legal_name: '', notes: '' });
  const [unitForm, setUnitForm] = React.useState({ company_id: '', parent_id: '', kind: 'TEAM' as PmUnitKind, name: '', description: '' });
  const [positionForm, setPositionForm] = React.useState({ unit_id: '', title: '', job_description: '', reports_to_position_id: '' });
  const [personForm, setPersonForm] = React.useState({ handle: '', display_name: '', kind: 'HUMAN' as PmPersonKind });
  const [appointmentForm, setAppointmentForm] = React.useState({ position_id: '', person_id: '' });
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [pending, setPending] = React.useState<null | {
    effect: string;
    kept: string;
    confirmLabel: string;
    okMessage: string;
    send: () => Promise<PmResult<unknown>>;
  }>(null);
  const [unitDrafts, setUnitDrafts] = React.useState<Record<string, UnitDraft>>({});
  const [positionDrafts, setPositionDrafts] = React.useState<Record<string, PositionDraft>>({});
  const [personDrafts, setPersonDrafts] = React.useState<Record<string, PersonDraft>>({});
  const [companyDrafts, setCompanyDrafts] = React.useState<Record<string, CompanyDraft>>({});
  const [endDrafts, setEndDrafts] = React.useState<Record<string, string>>({});
  const mountedRef = React.useRef(true);

  const setActor = (value: string) => {
    setActorState(value);
    storeClaimedActor(value);
  };

  const refuse = (code: string, message: string) => {
    setSaved(null);
    setRejected({ code, message, fix: refusalFix(code) });
  };

  const applyHistory = (res: PmResult<{ history: PmOrgHistoryEntry[] }>) => {
    setHistoryTried(true);
    if (!res.ok) {
      setHistory(null);
      setHistoryError(res.message || 'Org history could not be read.');
      return;
    }
    if (!res.data || !Array.isArray(res.data.history)) {
      setHistory(null);
      setHistoryError('Org history payload is not a recognized list.');
      return;
    }
    setHistoryError(null);
    setHistory(res.data.history);
  };

  const load = React.useCallback(async () => {
    const [orgRes, historyRes] = await Promise.all([
      pmOrg(includeArchived ? { includeArchived: true } : undefined),
      pmOrgHistory(),
    ]);
    if (!mountedRef.current) return false;
    applyHistory(historyRes);
    if (!orgRes.ok) {
      setOrg(null);
      setProblem(`${orgRes.state}: ${orgRes.message}`);
      return false;
    }
    if (!isOrgPayload(orgRes.data)) {
      setOrg(null);
      setProblem('PM org payload is not a recognized operating-org snapshot.');
      return false;
    }
    setProblem(null);
    setOrg(orgRes.data);
    const companies = pmOrgCompanies(orgRes.data);
    setUnitForm((prev) => ({
      ...prev,
      company_id: prev.company_id || companies[0]?.id || '',
    }));
    return true;
  }, [includeArchived]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const runWrite = async (okMessage: string, send: () => Promise<PmResult<unknown>>) => {
    if (!actor.trim()) {
      refuse('ACTOR_REQUIRED', 'Choose a claimed actor before writing. This is attribution, not authentication.');
      return false;
    }
    setBusy(true);
    setRejected(null);
    setSaved(null);
    try {
      const res = await send();
      if (!mountedRef.current) return false;
      if (!res.ok) {
        const extra = (res.errors ?? []).filter(Boolean);
        setRejected({
          code: res.code,
          message: [res.message, ...extra].filter(Boolean).join(' ') || 'The PM service rejected the write.',
          fix: refusalFix(res.code),
        });
        return false;
      }
      setSaved(okMessage);
      await load();
      return true;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const clearUnit = (id: string) => setUnitDrafts((prev) => omitKey(prev, id));
  const clearPosition = (id: string) => setPositionDrafts((prev) => omitKey(prev, id));
  const clearPerson = (id: string) => setPersonDrafts((prev) => omitKey(prev, id));
  const clearCompany = (id: string) => setCompanyDrafts((prev) => omitKey(prev, id));

  const stage = (spec: NonNullable<typeof pending>) => {
    setSaved(null);
    setRejected(null);
    setPending(spec);
  };

  const model: OrgModel = {
    busy,
    people: org?.people ?? [],
    units: org?.units ?? [],
    positions: org?.positions ?? [],
    appointments: org?.appointments ?? [],
    endedAppointments: org && Array.isArray(org.ended_appointments) ? org.ended_appointments : null,
    unitDraft: (unit) => unitDrafts[unit.id] ?? blankUnitDraft(unit),
    changeUnit: (unit, patch) => setUnitDrafts((prev) => ({
      ...prev,
      [unit.id]: { ...(prev[unit.id] ?? blankUnitDraft(unit)), ...patch },
    })),
    saveUnit: (unit) => {
      const draft = unitDrafts[unit.id] ?? blankUnitDraft(unit);
      const name = draft.name.trim();
      if (name.length < 2) {
        refuse('VALIDATION', 'Unit name needs at least 2 characters.');
        return;
      }
      void runWrite('Unit saved.', () => pmPatchUnit(unit.id, {
        actor,
        name,
        kind: draft.kind,
        parent_id: draft.parent_id.trim() ? draft.parent_id.trim() : null,
        description: draft.description.trim() ? draft.description.trim() : null,
      })).then((ok) => { if (ok) clearUnit(unit.id); });
    },
    archiveUnit: (id) => {
      const unit = (org?.units ?? []).find((row) => row.id === id);
      const children = (org?.units ?? []).filter((row) => row.parent_id === id && !row.archived_at);
      const positions = (org?.positions ?? []).filter((row) => row.unit_id === id && !row.archived_at);
      if (children.length || positions.length) {
        refuse('HAS_DEPENDENTS', `Unit ${unit?.name ?? id} still holds ${children.length} child unit(s) and ${positions.length} position(s). Nothing was removed.`);
        return;
      }
      stage({
        effect: `Archive unit ${unit?.name ?? id} (${id}). It leaves the active organization.`,
        kept: 'Audit history is kept. This unit has no active child units or positions, so none are removed. Restore is available from archived records.',
        confirmLabel: 'Confirm archive',
        okMessage: 'Unit archived.',
        send: () => pmPatchUnit(id, { actor, archived: true }),
      });
    },
    restoreUnit: (id) => {
      const unit = (org?.units ?? []).find((row) => row.id === id);
      stage({
        effect: `Restore unit ${unit?.name ?? id} (${id}) to the active organization.`,
        kept: 'Archived children stay archived until they are restored on their own. Audit history is kept.',
        confirmLabel: 'Confirm restore',
        okMessage: 'Unit restored.',
        send: () => pmPatchUnit(id, { actor, archived: false }),
      });
    },
    positionDraft: (position) => positionDrafts[position.id] ?? blankPositionDraft(position),
    changePosition: (position, patch) => setPositionDrafts((prev) => ({
      ...prev,
      [position.id]: { ...(prev[position.id] ?? blankPositionDraft(position)), ...patch },
    })),
    savePosition: (position) => {
      const draft = positionDrafts[position.id] ?? blankPositionDraft(position);
      const title = draft.title.trim();
      if (title.length < 2) {
        refuse('VALIDATION', 'Position title needs at least 2 characters.');
        return;
      }
      if (!draft.unit_id) {
        refuse('VALIDATION', 'Pick a unit for the position.');
        return;
      }
      void runWrite('Position saved.', () => pmPatchPosition(position.id, {
        actor,
        title,
        job_description: draft.job_description.trim() ? draft.job_description.trim() : null,
        unit_id: draft.unit_id,
        reports_to_position_id: draft.reports_to_position_id.trim() ? draft.reports_to_position_id.trim() : null,
      })).then((ok) => { if (ok) clearPosition(position.id); });
    },
    archivePosition: (id) => {
      const position = (org?.positions ?? []).find((row) => row.id === id);
      const reports = (org?.positions ?? []).filter((row) => row.reports_to_position_id === id && !row.archived_at);
      const appointments = (org?.appointments ?? []).filter((row) => row.position_id === id);
      if (reports.length || appointments.length) {
        refuse('HAS_DEPENDENTS', `Position ${position?.title ?? id} still holds ${reports.length} reporting position(s) and ${appointments.length} active appointment(s). Nothing was removed.`);
        return;
      }
      stage({
        effect: `Archive position ${position?.title ?? id} (${id}). It leaves the active organization.`,
        kept: 'Audit history is kept. This position has no reporting positions or active appointments, so none are removed.',
        confirmLabel: 'Confirm archive',
        okMessage: 'Position archived.',
        send: () => pmPatchPosition(id, { actor, archived: true }),
      });
    },
    restorePosition: (id) => {
      const position = (org?.positions ?? []).find((row) => row.id === id);
      stage({
        effect: `Restore position ${position?.title ?? id} (${id}).`,
        kept: 'The position returns to its unit. Audit history is kept.',
        confirmLabel: 'Confirm restore',
        okMessage: 'Position restored.',
        send: () => pmPatchPosition(id, { actor, archived: false }),
      });
    },
    endNotes: (appointmentId) => endDrafts[appointmentId] ?? '',
    changeEndNotes: (appointmentId, notes) => setEndDrafts((prev) => ({ ...prev, [appointmentId]: notes })),
    endAppointment: (appointmentId) => {
      const notes = (endDrafts[appointmentId] ?? '').trim();
      stage({
        effect: `End appointment ${appointmentId}. It leaves the active appointment list.`,
        kept: 'The appointment row is kept as ended. The position and the person are kept.',
        confirmLabel: 'Confirm end appointment',
        okMessage: 'Appointment ended.',
        send: () => pmEndAppointment(appointmentId, notes ? { actor, notes } : { actor }),
      });
    },
    companyDraft: (company) => companyDrafts[company.id] ?? blankCompanyDraft(company),
    changeCompany: (company, patch) => setCompanyDrafts((prev) => ({
      ...prev,
      [company.id]: { ...(prev[company.id] ?? blankCompanyDraft(company)), ...patch },
    })),
    saveCompany: (company) => {
      const draft = companyDrafts[company.id] ?? blankCompanyDraft(company);
      const name = draft.name.trim();
      if (name.length < 2) {
        refuse('VALIDATION', 'Company name needs at least 2 characters.');
        return;
      }
      void runWrite('Company saved.', () => pmPatchCompany(company.id, {
        actor,
        name,
        legal_name: draft.legal_name.trim() ? draft.legal_name.trim() : null,
        notes: draft.notes.trim() ? draft.notes.trim() : null,
      })).then((ok) => { if (ok) clearCompany(company.id); });
    },
    archiveCompany: (id) => {
      const company = pmOrgCompanies(org).find((row) => row.id === id);
      const units = (org?.units ?? []).filter((row) => row.company_id === id && !row.archived_at);
      if (units.length) {
        refuse('HAS_DEPENDENTS', `Company ${company?.name ?? id} still holds ${units.length} active unit(s). Nothing was removed.`);
        return;
      }
      stage({
        effect: `Archive company ${company?.name ?? id} (${id}). It leaves the active organization.`,
        kept: 'Audit history is kept. This company has no active units, so none are removed. Restore is available from archived records.',
        confirmLabel: 'Confirm archive',
        okMessage: 'Company archived.',
        send: () => pmPatchCompany(id, { actor, archived: true }),
      });
    },
    restoreCompany: (id) => {
      const company = pmOrgCompanies(org).find((row) => row.id === id);
      stage({
        effect: `Restore company ${company?.name ?? id} (${id}).`,
        kept: 'Archived units stay archived until restored on their own. Audit history is kept.',
        confirmLabel: 'Confirm restore',
        okMessage: 'Company restored.',
        send: () => pmPatchCompany(id, { actor, archived: false }),
      });
    },
    personDraft: (person) => personDrafts[person.id] ?? blankPersonDraft(person),
    changePerson: (person, patch) => setPersonDrafts((prev) => ({
      ...prev,
      [person.id]: { ...(prev[person.id] ?? blankPersonDraft(person)), ...patch },
    })),
    savePerson: (person) => {
      const draft = personDrafts[person.id] ?? blankPersonDraft(person);
      const displayName = draft.display_name.trim();
      if (!displayName) {
        refuse('VALIDATION', 'Person needs a display name.');
        return;
      }
      const capabilities = draft.capabilities.split(',').map((part) => part.trim()).filter(Boolean);
      void runWrite('Person saved.', () => pmPatchPerson(person.id, {
        actor,
        display_name: displayName,
        kind: draft.kind,
        status: draft.status.trim() ? draft.status.trim() : null,
        harness: draft.harness.trim() ? draft.harness.trim() : null,
        capabilities,
      })).then((ok) => { if (ok) clearPerson(person.id); });
    },
    archivePerson: (id) => {
      const person = (org?.people ?? []).find((row) => row.id === id);
      const appointments = (org?.appointments ?? []).filter((row) => row.person_id === id);
      if (appointments.length) {
        refuse('HAS_DEPENDENTS', `Person ${person?.display_name ?? id} still holds ${appointments.length} active appointment(s). Nothing was removed.`);
        return;
      }
      stage({
        effect: `Archive person ${person?.display_name ?? id} (${person?.handle ?? id}). They leave the active workforce.`,
        kept: 'Audit history is kept. This person has no active appointments, so none are removed. Their handle can be registered again after archive.',
        confirmLabel: 'Confirm archive',
        okMessage: 'Person archived.',
        send: () => pmPatchPerson(id, { actor, archived: true }),
      });
    },
    restorePerson: (id) => {
      const person = (org?.people ?? []).find((row) => row.id === id);
      stage({
        effect: `Restore person ${person?.display_name ?? id} (${person?.handle ?? id}).`,
        kept: 'The person returns to the active workforce. Audit history is kept.',
        confirmLabel: 'Confirm restore',
        okMessage: 'Person restored.',
        send: () => pmPatchPerson(id, { actor, archived: false }),
      });
    },
  };

  const companies = pmOrgCompanies(org);
  const actorOptions = React.useMemo(() => {
    const options: string[] = [];
    const seen = new Set<string>();
    const add = (value: string | null | undefined) => {
      const handle = value?.trim();
      if (!handle || seen.has(handle)) return;
      seen.add(handle);
      options.push(handle);
    };
    add(actor);
    for (const person of org?.people ?? []) add(person.handle);
    return options;
  }, [actor, org]);
  const appointmentCount = (org?.appointments.length ?? 0) + (Array.isArray(org?.ended_appointments) ? org.ended_appointments.length : 0);

  return (
    <div data-surface-signature="company-os-operate" className="room-root" data-room="company" data-org-operate="">
      <RoomHead
        mark="CO"
        title="Operating organization"
        sub="Writable org on the PM service · not the company-os seat registry"
        right={pmIsScratch() ? <Chip value={`SCRATCH INSTANCE :${pmPort()}`} tone="drift" /> : undefined}
      />
      <PeerWorkHeader
        peer="Operate"
        question="Who belongs to this company as an operating org, and which position do they hold?"
        links={<GoLink href={`#company/seats${pmQuery()}`}>Canonical seats →</GoLink>}
      />
      <HonestyLine />

      <div className="flex flex-wrap items-end gap-2 py-2">
        <label className={`min-w-36 ${field}`}>
          Claimed actor — not authentication
          <select
            aria-label="Claimed actor — not authentication"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
          >
            {actorOptions.map((handle) => <option key={handle} value={handle}>{handle}</option>)}
          </select>
        </label>
        <button type="button" className="go-link" onClick={() => void load()} disabled={busy}>Refresh</button>
        <label className="flex items-center gap-2 text-2xs">
          <input
            type="checkbox"
            aria-label="Show archived records"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Show archived
        </label>
      </div>
      {pending ? (
        <div data-lifecycle-confirm="" role="region" aria-label="Confirm record change" className="grid gap-2 rounded border border-border p-2">
          <p data-lifecycle-effect="">{pending.effect}</p>
          <p data-lifecycle-kept="">{pending.kept}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="go-link"
              onClick={() => {
                const spec = pending;
                setPending(null);
                void runWrite(spec.okMessage, spec.send);
              }}
            >
              {pending.confirmLabel}
            </button>
            <button type="button" className="go-link" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
      <div data-org-feedback="">
        {saved ? <PmSaved label={saved} /> : null}
        {rejected ? <PmRejected code={rejected.code} message={rejected.message} fix={rejected.fix} /> : null}
      </div>

      {problem && !org ? (
        <PmUnavailable
          reason={`${problem} This tab talks to 127.0.0.1:5176 only. The company-os projection is not a fallback.`}
        />
      ) : null}
      {!org && !problem ? <PmLoading label="Reading the PM operating org…" /> : null}

      {org ? (
        <div className="command-stack mt-2">
          <Panel title="Organization" count={`${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} · ${org.units.length} units`}>
            <div className="body">
              <OrganizationTree org={org} model={model} />
            </div>
          </Panel>

          <Panel title="Company" count={`${companies.length} recorded`}>
            <div className="body grid gap-3">
              <form
                className="grid gap-2 rounded border border-border p-2"
                aria-label="Create company"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = companyForm.name.trim();
                  if (name.length < 2) {
                    refuse('VALIDATION', 'Company name needs at least 2 characters.');
                    return;
                  }
                  void runWrite('Company recorded.', () => pmCreateCompany({
                    actor,
                    name,
                    ...(companyForm.legal_name.trim() ? { legal_name: companyForm.legal_name.trim() } : {}),
                    ...(companyForm.notes.trim() ? { notes: companyForm.notes.trim() } : {}),
                  })).then((ok) => { if (ok) setCompanyForm({ name: '', legal_name: '', notes: '' }); });
                }}
              >
                <p className="text-2xs text-muted-foreground">Add a company to the operating org.</p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <label className={field}>Name<input aria-label="Company name" value={companyForm.name} onChange={(event) => setCompanyForm({ ...companyForm, name: event.target.value })} /></label>
                  <label className={field}>Legal name<input aria-label="Company legal name" value={companyForm.legal_name} onChange={(event) => setCompanyForm({ ...companyForm, legal_name: event.target.value })} /></label>
                  <label className={field}>Notes<input aria-label="Company notes" value={companyForm.notes} onChange={(event) => setCompanyForm({ ...companyForm, notes: event.target.value })} /></label>
                </div>
                <div><button type="submit" className="go-link" disabled={busy || !actor}>Create company</button></div>
              </form>
            </div>
          </Panel>

          <Panel title="Units" count={`${org.units.length}`}>
            <div className="body grid gap-3">
              <form
                className="grid gap-2 rounded border border-border p-2"
                aria-label="Create unit"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!unitForm.company_id) {
                    refuse('VALIDATION', 'Pick a company for the unit.');
                    return;
                  }
                  if (unitForm.name.trim().length < 2) {
                    refuse('VALIDATION', 'Unit name needs at least 2 characters.');
                    return;
                  }
                  void runWrite('Unit recorded.', () => pmCreateUnit({
                    actor,
                    company_id: unitForm.company_id,
                    kind: unitForm.kind,
                    name: unitForm.name.trim(),
                    ...(unitForm.parent_id ? { parent_id: unitForm.parent_id } : {}),
                    ...(unitForm.description.trim() ? { description: unitForm.description.trim() } : {}),
                  })).then((ok) => { if (ok) setUnitForm((prev) => ({ ...prev, name: '', description: '', parent_id: '' })); });
                }}
              >
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                  <label className={field}>
                    Company
                    <select aria-label="Unit company" value={unitForm.company_id} onChange={(event) => setUnitForm({ ...unitForm, company_id: event.target.value })}>
                      <option value="">—</option>
                      {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                    </select>
                  </label>
                  <label className={field}>
                    Kind
                    <select aria-label="Unit kind" value={unitForm.kind} onChange={(event) => setUnitForm({ ...unitForm, kind: event.target.value as PmUnitKind })}>
                      {PM_UNIT_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                    </select>
                  </label>
                  <label className={field}>Name<input aria-label="Unit name" value={unitForm.name} onChange={(event) => setUnitForm({ ...unitForm, name: event.target.value })} /></label>
                  <label className={field}>
                    Parent
                    <select aria-label="Unit parent" value={unitForm.parent_id} onChange={(event) => setUnitForm({ ...unitForm, parent_id: event.target.value })}>
                      <option value="">none</option>
                      {org.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                    </select>
                  </label>
                  <label className={field}>Description<input aria-label="Unit description" value={unitForm.description} onChange={(event) => setUnitForm({ ...unitForm, description: event.target.value })} /></label>
                </div>
                <div><button type="submit" className="go-link" disabled={busy || !actor}>Create unit</button></div>
              </form>
            </div>
          </Panel>

          <Panel title="Positions" count={`${org.positions.length}`}>
            <div className="body grid gap-3">
              {org.positions.length === 0 ? <PmEmpty label="No positions recorded." /> : null}
              <form
                className="grid gap-2 rounded border border-border p-2"
                aria-label="Create position"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!positionForm.unit_id) {
                    refuse('VALIDATION', 'Pick a unit for the position.');
                    return;
                  }
                  if (positionForm.title.trim().length < 2) {
                    refuse('VALIDATION', 'Position title needs at least 2 characters.');
                    return;
                  }
                  void runWrite('Position recorded.', () => pmCreatePosition({
                    actor,
                    unit_id: positionForm.unit_id,
                    title: positionForm.title.trim(),
                    ...(positionForm.job_description.trim() ? { job_description: positionForm.job_description.trim() } : {}),
                    ...(positionForm.reports_to_position_id ? { reports_to_position_id: positionForm.reports_to_position_id } : {}),
                  })).then((ok) => { if (ok) setPositionForm((prev) => ({ ...prev, title: '', job_description: '', reports_to_position_id: '' })); });
                }}
              >
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <label className={field}>
                    Unit
                    <select aria-label="Position unit" value={positionForm.unit_id} onChange={(event) => setPositionForm({ ...positionForm, unit_id: event.target.value })}>
                      <option value="">—</option>
                      {org.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                    </select>
                  </label>
                  <label className={field}>Title<input aria-label="Position title" value={positionForm.title} onChange={(event) => setPositionForm({ ...positionForm, title: event.target.value })} /></label>
                  <label className={field}>
                    Reports to
                    <select aria-label="Reports to position" value={positionForm.reports_to_position_id} onChange={(event) => setPositionForm({ ...positionForm, reports_to_position_id: event.target.value })}>
                      <option value="">none</option>
                      {org.positions.map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}
                    </select>
                  </label>
                  <label className={field}>Job description<input aria-label="Job description" value={positionForm.job_description} onChange={(event) => setPositionForm({ ...positionForm, job_description: event.target.value })} /></label>
                </div>
                <div><button type="submit" className="go-link" disabled={busy || !actor}>Create position</button></div>
              </form>
            </div>
          </Panel>

          <Panel title="People" count={`${org.people.length}`}>
            <div className="body grid gap-3">
              {org.people.length ? (
                <ul className="grid gap-2">
                  {org.people.map((person) => <PersonCard key={person.id} person={person} model={model} />)}
                </ul>
              ) : (
                <PmEmpty label="No people recorded." />
              )}
              <form
                className="grid gap-2 rounded border border-border p-2"
                aria-label="Create person"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!personForm.handle.trim() || !personForm.display_name.trim()) {
                    refuse('VALIDATION', 'Person needs a handle and a display name.');
                    return;
                  }
                  void runWrite('Person recorded.', () => pmCreatePerson({
                    actor,
                    handle: personForm.handle.trim(),
                    display_name: personForm.display_name.trim(),
                    kind: personForm.kind,
                  })).then((ok) => { if (ok) setPersonForm({ handle: '', display_name: '', kind: 'HUMAN' }); });
                }}
              >
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <label className={field}>Handle<input aria-label="Person handle" value={personForm.handle} onChange={(event) => setPersonForm({ ...personForm, handle: event.target.value })} /></label>
                  <label className={field}>Display name<input aria-label="Person display name" value={personForm.display_name} onChange={(event) => setPersonForm({ ...personForm, display_name: event.target.value })} /></label>
                  <label className={field}>
                    Kind
                    <select aria-label="Person kind" value={personForm.kind} onChange={(event) => setPersonForm({ ...personForm, kind: event.target.value as PmPersonKind })}>
                      {PM_PERSON_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                    </select>
                  </label>
                </div>
                <div><button type="submit" className="go-link" disabled={busy || !actor}>Create person</button></div>
              </form>
            </div>
          </Panel>

          <Panel title="Appointments" count={`${org.appointments.length} active`}>
            <div className="body grid gap-3">
              {appointmentCount === 0 ? <PmEmpty label="No appointments recorded." /> : (
                <p className="prose-note">Appointments are listed on each position.</p>
              )}
              <form
                className="grid gap-2 rounded border border-border p-2"
                aria-label="Create appointment"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!appointmentForm.position_id || !appointmentForm.person_id) {
                    refuse('VALIDATION', 'Appointment needs a position and a person.');
                    return;
                  }
                  void runWrite('Appointment recorded.', () => pmCreateAppointment({
                    actor,
                    position_id: appointmentForm.position_id,
                    person_id: appointmentForm.person_id,
                  })).then((ok) => { if (ok) setAppointmentForm({ position_id: '', person_id: '' }); });
                }}
              >
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className={field}>
                    Position
                    <select aria-label="Appointment position" value={appointmentForm.position_id} onChange={(event) => setAppointmentForm({ ...appointmentForm, position_id: event.target.value })}>
                      <option value="">—</option>
                      {org.positions.map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}
                    </select>
                  </label>
                  <label className={field}>
                    Person
                    <select aria-label="Appointment person" value={appointmentForm.person_id} onChange={(event) => setAppointmentForm({ ...appointmentForm, person_id: event.target.value })}>
                      <option value="">—</option>
                      {org.people.map((person) => <option key={person.id} value={person.id}>{person.display_name} (@{person.handle})</option>)}
                    </select>
                  </label>
                </div>
                <div><button type="submit" className="go-link" disabled={busy || !actor}>Create appointment</button></div>
              </form>
            </div>
          </Panel>

          {org.generated_at ? (
            <p className="text-3xs text-muted-foreground">
              PM org generated {org.generated_at}
              {org.room_post ? ` · room_post ${org.room_post}` : ''}.
            </p>
          ) : null}
        </div>
      ) : null}

      <HistoryPanel tried={historyTried} error={historyError} rows={history} />
    </div>
  );
}
