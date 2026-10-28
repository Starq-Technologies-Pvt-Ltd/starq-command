/**
 * Writable operating organization — talks only to the PM service (:5176).
 *
 * Canonical seats remain Company OS Structure / Seats. This surface is the
 * Founder-operated org graph (company, units, positions, people, appointments)
 * and does not read the company-os projection.
 */
import * as React from 'react';
import { Chip, GoLink, KV, Panel, RoomHead, SourceGap } from '@/components/console';
import { PeerWorkHeader } from '@/components/work-area';
import {
  PM_PERSON_KINDS,
  PM_UNIT_KINDS,
  pmCreateAppointment,
  pmCreateCompany,
  pmCreatePerson,
  pmCreatePosition,
  pmCreateUnit,
  pmIsScratch,
  pmMeta,
  pmOrg,
  pmOrgCompanies,
  pmPort,
  pmQuery,
  type PmOrg,
  type PmPersonKind,
  type PmResult,
  type PmUnitKind,
} from '@/lib/pm-client';

const ACTOR_KEY = 'starq.pm.actor';
const field = 'grid gap-1 text-2xs text-muted-foreground';

function readActor(): string {
  try { return window.localStorage.getItem(ACTOR_KEY) ?? ''; } catch { return ''; }
}
function storeActor(value: string) {
  try { window.localStorage.setItem(ACTOR_KEY, value); } catch { /* convenience only */ }
}

function failureLines(res: Extract<PmResult<unknown>, { ok: false }>): string[] {
  return [`${res.code}: ${res.message}`, ...(res.errors ?? [])];
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
  const [handles, setHandles] = React.useState<string[]>([]);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actor, setActorState] = React.useState(readActor);
  const [companyForm, setCompanyForm] = React.useState({ name: '', legal_name: '', notes: '' });
  const [unitForm, setUnitForm] = React.useState({ company_id: '', parent_id: '', kind: 'TEAM' as PmUnitKind, name: '', description: '' });
  const [positionForm, setPositionForm] = React.useState({ unit_id: '', title: '', job_description: '', reports_to_position_id: '' });
  const [personForm, setPersonForm] = React.useState({ handle: '', display_name: '', kind: 'HUMAN' as PmPersonKind });
  const [appointmentForm, setAppointmentForm] = React.useState({ position_id: '', person_id: '' });

  const setActor = (value: string) => { setActorState(value); storeActor(value); };

  const load = React.useCallback(async () => {
    const [orgRes, metaRes] = await Promise.all([pmOrg(), pmMeta()]);
    if (metaRes.ok) setHandles(metaRes.data.handles);
    if (!orgRes.ok) {
      setOrg(null);
      setProblem(`${orgRes.state}: ${orgRes.message}`);
      return;
    }
    if (!isOrgPayload(orgRes.data)) {
      setOrg(null);
      setProblem('PM org payload is not a recognized operating-org snapshot.');
      return;
    }
    setProblem(null);
    setOrg(orgRes.data);
    const companies = pmOrgCompanies(orgRes.data);
    setUnitForm((prev) => ({
      ...prev,
      company_id: prev.company_id || companies[0]?.id || '',
    }));
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const runWrite = async (okMessage: string, send: () => Promise<PmResult<unknown>>) => {
    if (!actor) {
      setErrors(['Choose who you are (Acting as) before writing. Attribution only.']);
      return false;
    }
    setBusy(true);
    setErrors([]);
    setFlash(null);
    const res = await send();
    setBusy(false);
    if (!res.ok) {
      setErrors(failureLines(res));
      return false;
    }
    setFlash(okMessage);
    await load();
    return true;
  };

  const companies = pmOrgCompanies(org);
  const unitName = new Map((org?.units ?? []).map((u) => [u.id, u.name]));
  const positionTitle = new Map((org?.positions ?? []).map((p) => [p.id, p.title]));
  const personName = new Map((org?.people ?? []).map((p) => [p.id, `${p.display_name} (@${p.handle})`]));

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
          Acting as
          {handles.length ? (
            <select aria-label="Acting as" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">— choose —</option>
              {handles.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          ) : (
            <input aria-label="Acting as" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="handle" />
          )}
        </label>
        <button type="button" className="go-link" onClick={() => void load()} disabled={busy}>Refresh</button>
      </div>
      {flash ? <p role="status" className="text-xs text-truth-ok">{flash}</p> : null}
      {errors.length ? <ul role="alert" className="text-xs text-truth-drift">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}

      {problem && !org ? (
        <SourceGap
          reason="PM operating org unavailable."
          detail={`${problem} This tab talks to 127.0.0.1:5176 only. Start the PM service; the company-os projection is not a fallback.`}
        />
      ) : null}

      {org ? (
        <div className="command-stack mt-2">
          <Panel title="Company" count={`${companies.length} recorded`}>
            <div className="body grid gap-3">
              {companies.length ? (
                <ul className="work-row-list">
                  {companies.map((c) => (
                    <li key={c.id} className="work-row" data-selected="false">
                      <span className="k">{c.id}</span>
                      <span className="r">{c.name}</span>
                      <span className="v">{c.legal_name || c.notes || 'no legal name / notes'}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="prose-note">No company recorded on the PM org yet.</p>
              )}
              <form
                className="grid gap-2 rounded border border-border p-2"
                aria-label="Create company"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = companyForm.name.trim();
                  if (name.length < 2) { setErrors(['Company name needs at least 2 characters.']); return; }
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
                  <label className={field}>Name<input aria-label="Company name" value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} /></label>
                  <label className={field}>Legal name<input aria-label="Company legal name" value={companyForm.legal_name} onChange={(e) => setCompanyForm({ ...companyForm, legal_name: e.target.value })} /></label>
                  <label className={field}>Notes<input aria-label="Company notes" value={companyForm.notes} onChange={(e) => setCompanyForm({ ...companyForm, notes: e.target.value })} /></label>
                </div>
                <div><button type="submit" className="go-link" disabled={busy || !actor}>Create company</button></div>
              </form>
            </div>
          </Panel>

          <Panel title="Units" count={`${org.units.length}`}>
            <div className="body grid gap-3">
              {org.units.length ? (
                <div className="command-table-wrap short scroll-hint">
                  <table>
                    <caption>Operating units</caption>
                    <thead>
                      <tr>
                        <th>Kind</th>
                        <th>Name</th>
                        <th>Parent</th>
                        <th>Company</th>
                      </tr>
                    </thead>
                    <tbody>
                      {org.units.map((u) => (
                        <tr key={u.id}>
                          <td><Chip value={u.kind} /></td>
                          <td>{u.name}<div className="font-mono text-3xs text-muted-foreground">{u.id}</div></td>
                          <td>{u.parent_id ? (unitName.get(u.parent_id) ?? u.parent_id) : '—'}</td>
                          <td className="font-mono text-3xs">{u.company_id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="prose-note">No units recorded.</p>
              )}
              <form
                className="grid gap-2 rounded border border-border p-2"
                aria-label="Create unit"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!unitForm.company_id) { setErrors(['Pick a company for the unit.']); return; }
                  if (unitForm.name.trim().length < 2) { setErrors(['Unit name needs at least 2 characters.']); return; }
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
                    <select aria-label="Unit company" value={unitForm.company_id} onChange={(e) => setUnitForm({ ...unitForm, company_id: e.target.value })}>
                      <option value="">—</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label className={field}>
                    Kind
                    <select aria-label="Unit kind" value={unitForm.kind} onChange={(e) => setUnitForm({ ...unitForm, kind: e.target.value as PmUnitKind })}>
                      {PM_UNIT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                  <label className={field}>Name<input aria-label="Unit name" value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })} /></label>
                  <label className={field}>
                    Parent
                    <select aria-label="Unit parent" value={unitForm.parent_id} onChange={(e) => setUnitForm({ ...unitForm, parent_id: e.target.value })}>
                      <option value="">none</option>
                      {org.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </label>
                  <label className={field}>Description<input aria-label="Unit description" value={unitForm.description} onChange={(e) => setUnitForm({ ...unitForm, description: e.target.value })} /></label>
                </div>
                <div><button type="submit" className="go-link" disabled={busy || !actor}>Create unit</button></div>
              </form>
            </div>
          </Panel>

          <Panel title="Positions" count={`${org.positions.length}`}>
            <div className="body grid gap-3">
              {org.positions.length ? (
                <div className="command-table-wrap short scroll-hint">
                  <table>
                    <caption>Positions</caption>
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Unit</th>
                        <th>Reports to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {org.positions.map((p) => (
                        <tr key={p.id}>
                          <td>{p.title}<div className="font-mono text-3xs text-muted-foreground">{p.id}</div></td>
                          <td>{unitName.get(p.unit_id) ?? p.unit_id}</td>
                          <td>{p.reports_to_position_id ? (positionTitle.get(p.reports_to_position_id) ?? p.reports_to_position_id) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="prose-note">No positions recorded.</p>
              )}
              <form
                className="grid gap-2 rounded border border-border p-2"
                aria-label="Create position"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!positionForm.unit_id) { setErrors(['Pick a unit for the position.']); return; }
                  if (positionForm.title.trim().length < 2) { setErrors(['Position title needs at least 2 characters.']); return; }
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
                    <select aria-label="Position unit" value={positionForm.unit_id} onChange={(e) => setPositionForm({ ...positionForm, unit_id: e.target.value })}>
                      <option value="">—</option>
                      {org.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </label>
                  <label className={field}>Title<input aria-label="Position title" value={positionForm.title} onChange={(e) => setPositionForm({ ...positionForm, title: e.target.value })} /></label>
                  <label className={field}>
                    Reports to
                    <select aria-label="Reports to position" value={positionForm.reports_to_position_id} onChange={(e) => setPositionForm({ ...positionForm, reports_to_position_id: e.target.value })}>
                      <option value="">none</option>
                      {org.positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </label>
                  <label className={field}>Job description<input aria-label="Job description" value={positionForm.job_description} onChange={(e) => setPositionForm({ ...positionForm, job_description: e.target.value })} /></label>
                </div>
                <div><button type="submit" className="go-link" disabled={busy || !actor}>Create position</button></div>
              </form>
            </div>
          </Panel>

          <Panel title="People" count={`${org.people.length}`}>
            <div className="body grid gap-3">
              {org.people.length ? (
                <ul className="work-row-list">
                  {org.people.map((p) => (
                    <li key={p.id} className="work-row" data-selected="false">
                      <span className="k">{p.kind}</span>
                      <span className="r">{p.display_name}</span>
                      <span className="v">@{p.handle}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="prose-note">No people recorded.</p>
              )}
              <form
                className="grid gap-2 rounded border border-border p-2"
                aria-label="Create person"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!personForm.handle.trim() || !personForm.display_name.trim()) {
                    setErrors(['Person needs a handle and a display name.']);
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
                  <label className={field}>Handle<input aria-label="Person handle" value={personForm.handle} onChange={(e) => setPersonForm({ ...personForm, handle: e.target.value })} /></label>
                  <label className={field}>Display name<input aria-label="Person display name" value={personForm.display_name} onChange={(e) => setPersonForm({ ...personForm, display_name: e.target.value })} /></label>
                  <label className={field}>
                    Kind
                    <select aria-label="Person kind" value={personForm.kind} onChange={(e) => setPersonForm({ ...personForm, kind: e.target.value as PmPersonKind })}>
                      {PM_PERSON_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                </div>
                <div><button type="submit" className="go-link" disabled={busy || !actor}>Create person</button></div>
              </form>
            </div>
          </Panel>

          <Panel title="Appointments" count={`${org.appointments.length}`}>
            <div className="body grid gap-3">
              {org.appointments.length ? (
                <ul className="work-row-list">
                  {org.appointments.map((a) => (
                    <li key={a.id} className="work-row" data-selected="false">
                      <span className="k">{positionTitle.get(a.position_id) ?? a.position_id}</span>
                      <span className="r">{personName.get(a.person_id) ?? a.person_id}</span>
                      <span className="v">{a.id}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="prose-note">No appointments recorded.</p>
              )}
              <form
                className="grid gap-2 rounded border border-border p-2"
                aria-label="Create appointment"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!appointmentForm.position_id || !appointmentForm.person_id) {
                    setErrors(['Appointment needs a position and a person.']);
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
                    <select aria-label="Appointment position" value={appointmentForm.position_id} onChange={(e) => setAppointmentForm({ ...appointmentForm, position_id: e.target.value })}>
                      <option value="">—</option>
                      {org.positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </label>
                  <label className={field}>
                    Person
                    <select aria-label="Appointment person" value={appointmentForm.person_id} onChange={(e) => setAppointmentForm({ ...appointmentForm, person_id: e.target.value })}>
                      <option value="">—</option>
                      {org.people.map((p) => <option key={p.id} value={p.id}>{p.display_name} (@{p.handle})</option>)}
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
      ) : !problem ? (
        <p className="prose-note">Reading the PM operating org…</p>
      ) : null}
    </div>
  );
}
