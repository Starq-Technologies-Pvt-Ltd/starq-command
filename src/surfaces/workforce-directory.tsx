/**
 * Operating-registry workforce directory and person page.
 *
 * People, appointments, and work come from the PM org and workforce summary.
 * This surface does not read identities.json and does not show observed
 * Herdr/Hermes runtime presence.
 */
import * as React from 'react';
import { Chip, Panel } from '@/components/console';
import { PmEmpty, PmLoading, PmRejected, PmSaved, PmUnavailable } from '@/components/pm-feedback';
import { readClaimedActor } from '@/lib/acting-as';
import {
  pmImportIdentities,
  pmOrg,
  pmTaskHref,
  pmWorkforceSummary,
  type PmOrg,
  type PmOrgAppointment,
  type PmOrgPerson,
  type PmOrgPosition,
  type PmWorkforceSummary,
} from '@/lib/pm-client';

const PRESENCE_LINE = 'Observed Herdr/Hermes presence is a separate optional overlay. It is UNKNOWN on this page.';
const EMPTY_DIRECTORY = 'No people in the operating registry.';
const NO_ACTIONS = 'No recorded actions.';

type AppointmentRow = PmOrgAppointment & {
  title?: string | null;
  position_title?: string | null;
  status?: string | null;
};

type ImportNotice =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'rejected'; code: string; message: string }
  | { kind: 'saved'; created: number | null; skipped: number | null; conflicts: number | null };

function hashParts(): { path: string; params: URLSearchParams } {
  const raw = (typeof window === 'undefined' ? '' : window.location.hash).replace(/^#/, '');
  const queryAt = raw.indexOf('?');
  const path = (queryAt === -1 ? raw : raw.slice(0, queryAt)) || 'workforce';
  const params = new URLSearchParams(queryAt === -1 ? '' : raw.slice(queryAt + 1));
  return { path, params };
}

function readPersonQuery(): string | null {
  const person = hashParts().params.get('person')?.trim() ?? '';
  return person || null;
}

function writePersonQuery(person: string) {
  const { path, params } = hashParts();
  params.set('person', person);
  const next = `#${path}?${params.toString()}`;
  if (window.location.hash !== next) window.location.hash = next;
}

function recorded(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return 'UNKNOWN';
}

function stringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function isArchived(person: PmOrgPerson): boolean {
  return typeof person.archived_at === 'string' && person.archived_at.trim().length > 0;
}

function capabilityLabel(capabilities: PmOrgPerson['capabilities']): string {
  if (!Array.isArray(capabilities)) return 'UNKNOWN';
  const values = capabilities.map((item) => String(item).trim()).filter(Boolean);
  return values.length ? values.join(', ') : 'none recorded';
}

function findPerson(people: PmOrgPerson[], token: string): PmOrgPerson | undefined {
  return people.find((person) => person.id === token) ?? people.find((person) => person.handle === token);
}

function appointmentLabel(appointment: AppointmentRow, positions: PmOrgPosition[]): string {
  if (typeof appointment.position_title === 'string' && appointment.position_title.trim()) return appointment.position_title.trim();
  if (typeof appointment.title === 'string' && appointment.title.trim()) return appointment.title.trim();
  const position = positions.find((item) => item.id === appointment.position_id);
  if (position?.title) return position.title;
  return appointment.position_id || 'UNKNOWN';
}

function joinedAppointments(personId: string, org: PmOrg, ended: boolean): string[] {
  const source = ended ? org.ended_appointments ?? [] : org.appointments ?? [];
  return source
    .filter((appointment) => appointment.person_id === personId)
    .map((appointment) => appointmentLabel(appointment, org.positions ?? []));
}

function countOf(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function countLabel(value: number | null): string {
  return value === null ? 'UNKNOWN' : String(value);
}

function taskRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
}

function TaskList({ tasks, showReason }: { tasks: Record<string, unknown>[]; showReason?: boolean }) {
  return (
    <ul className="work-row-list">
      {tasks.map((task, index) => {
        const id = stringField(task, ['id', 'task_id']);
        const projectId = stringField(task, ['project_id']);
        const title = stringField(task, ['title']);
        const reason = stringField(task, ['reason']);
        const owner = stringField(task, ['owner']);
        const href = id && projectId ? pmTaskHref(projectId, id) : null;
        return (
          <li key={id ?? `task-${index}`} className="work-row">
            {href ? <a href={href}>{id}</a> : <span>{id ?? 'UNKNOWN'}</span>}
            {title ? <span>{title}</span> : null}
            {owner ? <span>Owner: {owner}</span> : null}
            {showReason && reason ? <span>Reason: {reason}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function AppointmentList({ appointments, positions }: { appointments: AppointmentRow[]; positions: PmOrgPosition[] }) {
  if (appointments.length === 0) return <PmEmpty label="None recorded." />;
  return (
    <ul className="work-row-list">
      {appointments.map((appointment, index) => (
        <li key={appointment.id || `${appointment.position_id}-${index}`} className="work-row">
          <span>{appointmentLabel(appointment, positions)}</span>
          {appointment.status ? <span>{appointment.status}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function ownedRows(summary: PmWorkforceSummary): Record<string, unknown>[] {
  return taskRows(summary.tasks?.owned_open);
}

function verifyingRows(summary: PmWorkforceSummary): Record<string, unknown>[] {
  return taskRows(summary.tasks?.verifying_open);
}

function blockedRows(summary: PmWorkforceSummary): Record<string, unknown>[] {
  return taskRows(summary.tasks?.blocked);
}

function activityRows(summary: PmWorkforceSummary | null): Record<string, unknown>[] | null {
  if (!summary || !Object.prototype.hasOwnProperty.call(summary, 'recent_activity')) return null;
  return taskRows(summary.recent_activity);
}

export function WorkforceDirectory() {
  const [org, setOrg] = React.useState<PmOrg | null>(null);
  const [orgProblem, setOrgProblem] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [personQuery, setPersonQuery] = React.useState<string | null>(() => readPersonQuery());
  const [summary, setSummary] = React.useState<PmWorkforceSummary | null>(null);
  const [summaryProblem, setSummaryProblem] = React.useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importNotice, setImportNotice] = React.useState<ImportNotice | null>(null);
  const actor = readClaimedActor();

  React.useEffect(() => {
    const onHash = () => setPersonQuery(readPersonQuery());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    void pmOrg(includeArchived ? { includeArchived: true } : undefined).then((res) => {
      if (!active) return;
      setLoading(false);
      if (!res.ok) {
        setOrg(null);
        setOrgProblem(res.message);
        return;
      }
      setOrgProblem(null);
      setOrg(res.data);
    });
    return () => {
      active = false;
    };
  }, [includeArchived, reloadToken]);

  const people = org?.people ?? [];
  const visiblePeople = people.filter((person) => includeArchived || !isArchived(person));
  const selected = personQuery ? findPerson(people, personQuery) : undefined;

  React.useEffect(() => {
    if (!personQuery || !org) {
      setSummary(null);
      setSummaryProblem(null);
      setSummaryLoading(false);
      return;
    }
    const id = findPerson(org.people ?? [], personQuery)?.id ?? personQuery;
    let active = true;
    setSummary(null);
    setSummaryProblem(null);
    setSummaryLoading(true);
    void pmWorkforceSummary(id).then((res) => {
      if (!active) return;
      setSummaryLoading(false);
      const payload = res.ok ? res.data as (PmWorkforceSummary & { reason?: string }) | null : null;
      if (!res.ok || !payload || String(payload.state ?? '').toUpperCase() === 'UNAVAILABLE') {
        setSummary(null);
        const stated = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
        setSummaryProblem(!res.ok ? res.message : stated || 'Workforce summary is unavailable.');
        return;
      }
      setSummary(payload);
    });
    return () => {
      active = false;
    };
  }, [personQuery, org]);

  const selectPerson = (person: PmOrgPerson) => {
    const token = person.handle || person.id;
    writePersonQuery(token);
    setPersonQuery(token);
  };

  const importIdentities = async () => {
    setImporting(true);
    setImportNotice(null);
    const res = await pmImportIdentities({ actor: readClaimedActor(), channel: 'ui' });
    if (!res.ok) {
      setImporting(false);
      if (res.state === 'UNAVAILABLE') setImportNotice({ kind: 'unavailable', reason: res.message });
      else setImportNotice({ kind: 'rejected', code: res.code, message: res.message });
      return;
    }
    if (String(res.data?.state ?? '').toUpperCase() === 'UNAVAILABLE') {
      setImporting(false);
      const reason = typeof res.data?.reason === 'string' && res.data.reason.trim()
        ? res.data.reason.trim()
        : 'Agent identity import is unavailable.';
      setImportNotice({ kind: 'unavailable', reason });
      return;
    }
    setImportNotice({
      kind: 'saved',
      created: countOf(res.data?.created),
      skipped: countOf(res.data?.skipped),
      conflicts: countOf(res.data?.conflicts),
    });
    setImporting(false);
    setReloadToken((token) => token + 1);
  };

  const profile = summary?.person ?? selected ?? null;
  const positions = org?.positions ?? [];
  const activity = activityRows(summary);

  return (
    <div data-surface="workforce-directory" className="command-stack">
      <p className="prose-note" data-presence="unknown">{PRESENCE_LINE}</p>
      <Panel
        title="Workforce directory"
        count={org && !orgProblem ? visiblePeople.length : undefined}
        toolbar={(
          <label className="text-2xs">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            {' '}
            Show archived
          </label>
        )}
      >
        <div className="body grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p data-claimed-actor="">
              Claimed actor — not authentication
              {' '}
              <strong>{actor}</strong>
            </p>
            <button type="button" className="go-link" onClick={() => void importIdentities()} disabled={importing}>
              Import agent identities
            </button>
          </div>
          <p className="prose-note">Import records DIGITAL people through the PM registry. It does not authenticate anyone.</p>
          {importNotice?.kind === 'unavailable' ? <PmUnavailable reason={importNotice.reason} /> : null}
          {importNotice?.kind === 'rejected' ? <PmRejected code={importNotice.code} message={importNotice.message} /> : null}
          {importNotice?.kind === 'saved' ? (
            <PmSaved
              label={`Created ${countLabel(importNotice.created)}. Skipped ${countLabel(importNotice.skipped)}. Conflicts ${countLabel(importNotice.conflicts)}. This did not authenticate anyone.`}
            />
          ) : null}
          {loading && !org && !orgProblem ? <PmLoading label="Loading workforce directory" /> : null}
          {orgProblem ? <PmUnavailable reason={orgProblem} /> : null}
          {org && !orgProblem && visiblePeople.length === 0 ? <PmEmpty label={EMPTY_DIRECTORY} /> : null}
          {org && !orgProblem && visiblePeople.length > 0 ? (
            <ul className="work-row-list">
              {visiblePeople.map((person) => {
                const active = joinedAppointments(person.id, org, false);
                const ended = joinedAppointments(person.id, org, true);
                const appointmentText = [
                  ...active,
                  ...ended.map((label) => `ended: ${label}`),
                ].join(' · ') || 'none recorded';
                const selectedRow = personQuery === person.id || personQuery === person.handle;
                return (
                  <li key={person.id}>
                    <button
                      type="button"
                      className="work-row"
                      data-person-id={person.id}
                      data-person-handle={person.handle}
                      data-kind={person.kind}
                      aria-pressed={selectedRow}
                      onClick={() => selectPerson(person)}
                    >
                      <Chip value={person.kind} />
                      <span>{person.display_name}</span>
                      <span>@{person.handle}</span>
                      <span>Harness: {recorded(person.harness)}</span>
                      <span>Capabilities: {capabilityLabel(person.capabilities)}</span>
                      <span>Status: {recorded(person.status)}</span>
                      <span>Appointments: {appointmentText}</span>
                      {isArchived(person) ? <span>archived</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </Panel>

      {personQuery ? (
        <Panel title="Person">
          <div className="body grid gap-3" data-person-page="">
            {summaryLoading ? <PmLoading label="Loading person" /> : null}
            {summaryProblem ? <PmUnavailable reason={summaryProblem} /> : null}
            {profile ? (
              <p>
                <Chip value={profile.kind} />
                {' '}
                {profile.display_name}
                {' '}
                @{profile.handle}
              </p>
            ) : null}
            {summary && profile && !summaryProblem ? (
              <>
                <p>Harness: {recorded(profile.harness)}</p>
                <p>Capabilities: {capabilityLabel(profile.capabilities)}</p>
                <p>Status: {recorded(profile.status)}</p>
                <p>Source: {recorded(profile.source)}</p>
                <section aria-label="Active appointments">
                  <h3>Active appointments</h3>
                  {summary.appointments && Array.isArray(summary.appointments.active)
                    ? <AppointmentList appointments={summary.appointments.active as AppointmentRow[]} positions={positions} />
                    : <p>Not included in this summary.</p>}
                </section>
                <section aria-label="Ended appointments">
                  <h3>Ended appointments</h3>
                  {summary.appointments && Array.isArray(summary.appointments.ended)
                    ? <AppointmentList appointments={summary.appointments.ended as AppointmentRow[]} positions={positions} />
                    : <p>Not included in this summary.</p>}
                </section>
                <section aria-label="Owned open tasks">
                  <h3>Owned open tasks</h3>
                  {Array.isArray(summary.tasks?.owned_open)
                    ? (ownedRows(summary).length ? <TaskList tasks={ownedRows(summary)} /> : <PmEmpty label="No owned open tasks." />)
                    : <p>Not included in this summary.</p>}
                </section>
                <section aria-label="Verifying open tasks">
                  <h3>Verifying open tasks</h3>
                  {Array.isArray(summary.tasks?.verifying_open)
                    ? (verifyingRows(summary).length ? <TaskList tasks={verifyingRows(summary)} /> : <PmEmpty label="No verifying open tasks." />)
                    : <p>Not included in this summary.</p>}
                </section>
                <section aria-label="Blocked tasks">
                  <h3>Blocked tasks</h3>
                  <p>Blocked tasks owned by this person.</p>
                  {Array.isArray(summary.tasks?.blocked)
                    ? (blockedRows(summary).length ? <TaskList tasks={blockedRows(summary)} showReason /> : <PmEmpty label="No blocked tasks." />)
                    : <p>Not included in this summary.</p>}
                </section>
                <section aria-label="Recent activity">
                  <h3>Recent activity</h3>
                  {activity && activity.length > 0 ? (
                    <ul className="work-row-list">
                      {activity.map((row, index) => (
                        <li key={`${stringField(row, ['timestamp']) ?? 'activity'}-${index}`} className="work-row">
                          <span>Actor: {recorded(row.actor)}</span>
                          <span>Action: {recorded(row.action)}</span>
                          <span>Timestamp: {recorded(row.timestamp)}</span>
                          <span>Source: {recorded(row.source ?? row.channel)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{NO_ACTIONS}</p>
                  )}
                </section>
              </>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
