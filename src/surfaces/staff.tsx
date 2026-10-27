/**
 * Staff, Capacity and Activity — the Dev Studio floor.
 *
 * THE QUESTION THIS SURFACE ANSWERS
 *
 * "Who is on the floor, and what are they actually assigned to?" The pre-build
 * answered this with a five-column <br/>-separated table that mixed identity,
 * duty and execution into one visual block, and a Capacity tab that rendered a
 * single sentence of prose. Neither was usable.
 *
 * THE SEPARATION THIS SURFACE ENFORCES
 *
 * Identity, duty and execution are three different questions with three
 * different sources, and a task mention is none of them. Each is rendered in
 * its own column with its own confidence marker, so a reader can never see
 * "assigned" without also seeing how confidently the source claims it.
 *
 * Capacity is derived HERE from canonical roster facts — counts of staff,
 * assignments with a declared task, and declared capacity notes. It is an
 * order-of-magnitude reading aid over declared values, and it says so. It does
 * not invent a quota, and where the source declares none, it says UNKNOWN.
 *
 * THE CANONICAL TEN (Founder seq 8475, from Elder's seq 8474 recon)
 *
 * This surface is the MAIN STAFF SURFACE, and it now renders the declared
 * Dev Studio ten rather than every handle the ledger happens to observe. The
 * registry carries 22 handles, of which a dozen are ghosts (nexus, qoder,
 * vscode, alfred, athena, bursar, openclaw, devin, opencode2, mastracode,
 * format-watchdog), and a board that lists them beside working seats cannot be
 * read as a roster.
 *
 * Three joins land here, and each is kept in its own lane:
 *
 *   · DECLARED metadata (provider/owner, product/client, capacity class, normal
 *     host, role family) — arrives already joined on `floor.staff.canonical_seats`
 *     from `server/staff-profile.mjs`. It is a declaration, not a measurement,
 *     and the renderer treats it as text.
 *   · LIVE state (PID, RUNNING/EXITED, broker reachability) — read at render
 *     time from the Herdr broker projection. Deliberately NOT on the server
 *     payload: a PID in a canonical read-only projection would be a hard-coded
 *     live value that is wrong the moment a seat restarts.
 *   · ACTIVITY (freshness, last meaningful Room seq, duty, assignment) — already
 *     forwarded verbatim by the floor and rendered as recorded.
 *
 * Suppression is STATED, never silent. The count of handles left off the board,
 * and the reason for each, ship in the payload and are rendered — because a
 * board that quietly hides twelve people is indistinguishable from one that has
 * correctly decided they are not staff.
 */
import * as React from 'react';
import { flushSync } from 'react-dom';
import type { CommandSurface, RosterEntry } from '@/lib/contracts';
import {
  Chip,
  Drawer,
  FocusRail,
  KV,
  Panel,
  SourceGap,
  Stat,
  StatRail,
  show,
} from '@/components/console';
import {
  CAPACITY_CLASS_TONE,
  ROLE_FAMILY_TONE,
} from '@/lib/states';
import {
  AboutMethod,
  PeerWorkHeader,
  WorkArea,
  WorkRow,
} from '@/components/work-area';

/*
 * `STAFF_CLASS_TONE` is deliberately NOT imported here any more.
 *
 * The roster table used it to colour a classification chip. In the list/detail
 * shell each row's classification travels as text and the shared `Chip`
 * derives its own tone from the declared state via `toneOf`, so the local
 * mapping had no call site and an unused import is dead weight. If a future
 * peer needs that chip treatment it should use the shared mapping in
 * `@/lib/states` rather than re-deriving it here.
 */

// ── Live Herdr join ─────────────────────────────────────────────────────────
//
// The Herdr broker projection, read at render time through the same proxied
// read-only endpoint the Herdr surface already uses. There is no second broker
// client and no second source: this reads the same authoritative projection the
// Herdr surface renders, and holds nothing itself.
//
// Nothing here decides liveness. If the broker is unreachable the join is
// UNKNOWN, and UNKNOWN is rendered as UNKNOWN — never collapsed to "offline",
// because "we could not ask" and "it is not running" are different facts and the
// operator needs to tell them apart before pressing stop on something.

type LiveSeat = {
  id: string;
  state: string;
  pid: number | null;
  session_id: string | null;
  availability: string;
  availability_reason: string;
  dispatch_eligible: boolean;
  dispatch_blocker: string;
  pane_binding: {
    state: string;
    pane: { workspace_id: string | null; pane_id: string | null; terminal_id: string | null } | null;
  };
  observed_at: string | null;
};

type HerdrLiveJoin = {
  state: 'LIVE' | 'UNREACHABLE' | 'UNJOINED';
  reason: string;
  liveStateSource: string;
  bySeatId: Record<string, LiveSeat>;
};

const HERDR_LIVE_UNREACHABLE: HerdrLiveJoin = {
  state: 'UNREACHABLE',
  reason: 'BROKER NOT REACHABLE — live PID and process state were not read.',
  liveStateSource: 'GET /api/herdr/state (Herdr broker, read-only)',
  bySeatId: {},
};

function useHerdrLive(): HerdrLiveJoin {
  const [join, setJoin] = React.useState<HerdrLiveJoin>({
    state: 'UNREACHABLE',
    reason: 'NOT YET READ — the broker projection has not been fetched.',
    liveStateSource: 'GET /api/herdr/state (Herdr broker, read-only)',
    bySeatId: {},
  });

  React.useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const res = await fetch('/api/herdr/state');
        if (!res.ok) {
          if (live) {
            setJoin({
              ...HERDR_LIVE_UNREACHABLE,
              reason: `BROKER PROJECTION REFUSED — HTTP ${res.status}. Live PID and process state were not read.`,
            });
          }
          return;
        }
        const data = (await res.json()) as {
          timestamp?: string | null;
          broker?: { online?: boolean };
          agents?: Array<{ id: string; state?: string; pid?: number | null; session_id?: string | null }>;
          sessions?: Array<{ agent_id: string; session_id: string }>;
          standalone?: { panes?: Array<{
            attribution: string;
            binding_state?: string | null;
            seat_id?: string | null;
            binding?: { bound_by?: string | null; authority?: string | null; bound_at?: string | null } | null;
            pane?: { workspace_id?: string | null; pane_id?: string | null; terminal_id?: string | null } | null;
          }> };
        };
        const bySeatId: Record<string, LiveSeat> = {};
        for (const agent of data.agents ?? []) {
          const state = agent.state ?? 'UNKNOWN';
          const matchingSessions = (data.sessions ?? []).filter((session) =>
            session.agent_id === agent.id && session.session_id === agent.session_id,
          );
          const bindings = (data.standalone?.panes ?? []).filter((pane) =>
            pane.attribution === 'BOUND' && pane.seat_id === agent.id,
          );
          let paneBinding: LiveSeat['pane_binding'] = { state: 'UNBOUND', pane: null };
          if (bindings.length > 1) paneBinding = { state: 'CONFLICT', pane: null };
          else if (bindings.length === 1) {
            const binding = bindings[0];
            paneBinding = binding.binding_state === 'BOUND' && binding.pane
              ? {
                  state: 'BOUND',
                  pane: {
                    workspace_id: binding.pane.workspace_id ?? null,
                    pane_id: binding.pane.pane_id ?? null,
                    terminal_id: binding.pane.terminal_id ?? null,
                  },
                }
              : { state: binding.binding_state ?? 'UNKNOWN', pane: null };
          }
          const availability = state === 'EXITED'
            ? 'OFFLINE'
            : state === 'RUNNING' && matchingSessions.length === 1
              ? 'ACTIVE_UNKNOWN_LOAD'
              : 'UNKNOWN';
          bySeatId[agent.id] = {
            id: agent.id,
            state,
            pid: agent.pid ?? null,
            session_id: matchingSessions.length === 1 ? matchingSessions[0].session_id : null,
            availability,
            availability_reason: availability === 'OFFLINE'
              ? 'Herdr observed the declared seat process as EXITED.'
              : availability === 'ACTIVE_UNKNOWN_LOAD'
                ? 'A broker session is active; task load and free capacity are not established.'
                : 'A live read did not establish dispatch availability.',
            dispatch_eligible: false,
            dispatch_blocker: availability === 'OFFLINE' ? 'SEAT_OFFLINE' : 'AVAILABILITY_UNPROVEN',
            pane_binding: paneBinding,
            observed_at: data.timestamp ?? null,
          };
        }
        if (live) {
          setJoin({
            state: data.broker?.online === true ? 'LIVE' : 'UNREACHABLE',
            reason: data.broker?.online === true
              ? 'Herdr seat observations refresh every 5 seconds; standalone pane bindings remain a separate fact.'
              : 'Herdr broker state is UNKNOWN; no seat is treated as dispatchable.',
            liveStateSource: 'GET /api/herdr/state (Herdr broker, read-only)',
            bySeatId,
          });
        }
      } catch {
        if (live) setJoin(HERDR_LIVE_UNREACHABLE);
      } finally {
        if (live) timer = window.setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      live = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return join;
}

/**
 * Roster overview counts. Every count is a filter over canonical entries.
 *
 * The identity/capacity counts are over the CURATED board — the declared ten —
 * because that is what an operator is looking at. `total` remains the full
 * observed roster so the two populations can never be confused for each other.
 */
function rosterCounts(entries: RosterEntry[]) {
  const active = entries.filter((e) => e.is_active_staff);
  const retired = entries.filter((e) => e.is_retired);
  const system = entries.filter((e) => e.is_system);
  const withAssignment = entries.filter((e) => !!e.execution_current_assignment);
  const withTask = entries.filter((e) => !!e.execution_current_task);
  const withDutyTask = entries.filter((e) => !!e.duty_current_task);
  const withCapacityNote = entries.filter((e) => !!e.duty_capacity_note);
  const stale = entries.filter((e) => e.activity_freshness === 'STALE');
  const paidL1 = entries.filter((e) => e.staff_profile?.capacity_class === 'PAID_L1');
  const freeSupport = entries.filter((e) => e.staff_profile?.capacity_class === 'FREE_SUPPORT');
  const notObserved = entries.filter((e) => e.observed_in_ledger === false);
  const hostConflicts = entries.filter((e) => e.herdr_host_conflict);
  return {
    total: entries.length,
    active: active.length,
    retired: retired.length,
    system: system.length,
    withAssignment: withAssignment.length,
    withTask: withTask.length,
    withDutyTask: withDutyTask.length,
    withCapacityNote: withCapacityNote.length,
    stale: stale.length,
    paidL1: paidL1.length,
    freeSupport: freeSupport.length,
    notObserved: notObserved.length,
    hostConflicts: hostConflicts.length,
    activePct: entries.length ? active.length / entries.length : null,
  };
}

function StaffRail({ surface }: { surface: CommandSurface }) {
  const staff = surface.floor?.staff;
  // The board counts over the curated ten when a staff block is present, and
  // over the raw roster when it is not. Falling back keeps this peer rendering
  // on older payloads instead of showing a row of zeroes, which would read as
  // "the floor is empty" rather than "this projection predates the board".
  const entries = staff?.canonical_seats ?? surface.floor?.roster?.entries ?? [];
  const c = rosterCounts(entries);
  const observed = surface.floor?.roster?.counts?.observed ?? null;
  if (!entries.length)
    return (
      <StatRail>
        <Stat k="Roster" v={null} sub="floor projection unavailable" />
      </StatRail>
    );
  return (
    <StatRail>
      <Stat
        k="Dev Studio seats"
        v={c.total}
        tone={c.total ? 'ok' : 'unknown'}
        sub={
          staff
            ? `${c.active} counted active staff · ${c.notObserved} declared but unobserved`
            : 'from canonical identities + floor'
        }
      />
      {/*
        PAID vs FREE is the question the Founder actually asks before burning an
        L1 quota, so it leads as its own stat rather than hiding in a column.
        Both numbers are DECLARED classes, and the stat says so — there is no
        usage meter behind either, and presenting a count here as if it measured
        consumption would be the exact fiction this surface refuses.
      */}
      <Stat
        k="Paid L1 / Free"
        v={`${c.paidL1} / ${c.freeSupport}`}
        tone={c.paidL1 ? 'founder' : 'unknown'}
        sub="declared capacity class · no live usage meter exists"
      />
      <Stat
        k="Suppressed"
        v={staff ? staff.suppressed_count : 0}
        tone="unknown"
        sub={
          staff
            ? `non-seat handles kept off this board · ${observed ?? '—'} observed in total`
            : 'no curation block in this projection'
        }
      />
      {c.hostConflicts ? (
        <Stat
          k="Host conflicts"
          v={c.hostConflicts}
          tone="stale"
          sub="declared normal host vs Herdr manifest runtime — unresolved"
        />
      ) : null}
      <Stat
        k="With assignment"
        v={c.withAssignment}
        tone={c.withAssignment ? 'room' : 'unknown'}
        sub={`${c.withTask} also declare a task`}
      />
      <Stat
        k="Duty tasks"
        v={c.withDutyTask}
        tone={c.withDutyTask ? 'room' : 'unknown'}
        sub={`${c.withCapacityNote} carry a capacity note`}
      />
      <Stat
        k="Stale activity"
        v={c.stale}
        tone={c.stale ? 'stale' : 'ok'}
        sub="activity freshness, not duty"
      />
      <Stat
        k="Session leases"
        v={staff ? staff.session_leases.holders_count : null}
        tone="unknown"
        sub={staff ? 'presence, not the turn' : 'not a measure of work'}
      />
    </StatRail>
  );
}

/** Capacity: a reading aid over declared roster facts, not an invented quota. */
export function CapacityPanel({
  surface,
  buildingCapacity,
}: {
  surface: CommandSurface;
  buildingCapacity?: { state: string; reason: string };
}) {
  // The declared seats, not the raw roster: a capacity panel counting ghosts is
  // how a floor ends up reporting ten paid seats when it has five.
  const staff = surface.floor?.staff;
  const entries = staff?.canonical_seats ?? surface.floor?.roster?.entries ?? [];
  const c = rosterCounts(entries);
  const notes = entries.filter((e) => !!e.duty_capacity_note);
  return (
    <>
      <PeerWorkHeader
        peer="Capacity"
        question="What capacity does canonical source declare, and what does it refuse to declare?"
      />
      <FocusRail label="Capacity">
        <p>
          Capacity is read from what the floor declares, not from session presence and not from a
          provider quota. {buildingCapacity ? buildingCapacity.reason : ''}
        </p>
      </FocusRail>
      <StatRail>
        {/*
          PAID vs FREE, declared.

          This is the panel where the Founder's actual question lives — whether a
          cheaper seat can absorb a task before an L1 quota is burned — so the
          split is a stat in its own right rather than a column to be found.

          It is a DECLARED class, and the sub-line says so. No usage, quota or
          reset figure is shown because none exists: there is no uniform provider
          billing API behind these seats, and `quota-capacity.ts`'s hourly/daily
          windows have no feed. Usage stays where the Founder puts it, in
          staff-state.json, and it is forwarded verbatim below.
        */}
        <Stat
          k="Paid L1 seats"
          v={c.paidL1}
          tone={c.paidL1 ? 'founder' : 'unknown'}
          sub="declared — burn these last"
        />
        <Stat
          k="Free / offload seats"
          v={c.freeSupport}
          tone={c.freeSupport ? 'ok' : 'unknown'}
          sub="declared — prefer these where they can absorb the task"
        />
        <Stat
          k="Declared capacity"
          v={buildingCapacity?.state ?? 'UNKNOWN'}
          tone="unknown"
          sub={buildingCapacity ? 'no canonical quota projection' : 'no projection declared'}
        />
        <Stat
          k="Staff with duty task"
          v={c.total ? c.withDutyTask : null}
          tone={c.withDutyTask ? 'room' : 'unknown'}
          sub={`of ${c.total} seats`}
        />
        <Stat
          k="Capacity notes"
          v={c.total ? c.withCapacityNote : null}
          tone={c.withCapacityNote ? 'room' : 'unknown'}
          sub="declared by source, listed below"
        />
        <Stat
          k="Sessions"
          v={staff ? staff.session_leases.holders_count : surface.floor?.sessions?.available ? surface.floor.sessions.count : null}
          tone="unknown"
          sub={staff ? 'NOT the turn and NOT work' : 'NOT a measure of work'}
        />
      </StatRail>
      <div className="command-split">
              <Panel title="Declared capacity notes" count={`${notes.length} entries`}>
                {notes.length ? (
                  /*
                    CAPACITY: STATE FIRST, PROSE SECOND (seq 8411).

                    Founder QA seq 8410 measured this peer rendering 300-character
                    duty capacity notes as the dominant content of the table, set in
                    10.5px monospace. The Founder instruction was explicit: "summarize
                    state/count/reason first; long duty/blocker prose second."

                    So each row now leads with what an operator scans for — the
                    declared availability verdict, and the first sentence of the note
                    as its summary — and the FULL note is one disclosure away in the
                    row. The prose is not shortened or paraphrased anywhere: the
                    detail body renders `duty_capacity_note` verbatim, because it is
                    canonical declared text and any summarising of it would be
                    Command interpreting a source it does not own.

                    The summary line is the note's own leading sentence, cut at the
                    first full stop. That is a truncation of declared text, not an
                    interpretation of it, and the complete text is always present.
                  */
                  <div className="command-table-wrap scroll-hint">
                    <table>
                      <caption>Duty capacity notes · declared at source, never inferred</caption>
                      <thead>
                        <tr>
                          <th style={{ width: '7rem' }}>Staff</th>
                                                    <th style={{ width: '8rem' }}>Declared duty state</th>
                                                    <th>Summary · full note on demand</th>
                        </tr>
                      </thead>
                      <tbody>
                        {notes.map((e) => {
                          const note = e.duty_capacity_note ?? '';
                          const cut = note.indexOf('. ');
                          const summary = cut > 0 ? note.slice(0, cut + 1) : note;
                          return (
                            <tr key={e.handle}>
                                                          <td className="mono">{e.handle}</td>
                                                          <td>
                                                            {/* Availability comes from the DECLARED duty_state
                                                                field, never from reading the note's prose. A
                                                                verdict inferred from sentence text would be
                                                                Command interpreting a source it does not own,
                                                                which is the one thing this product may not do. */}
                                                            <span className="duty-verdict" data-duty-state={e.duty_state}>
                                                              {e.duty_state || 'UNKNOWN'}
                                                            </span>
                                                          </td>
                                                          <td className="prose">
                                                            <span>{summary}</span>{' '}
                                                            {note.length > summary.length ? (
                                                              <details className="inline-note">
                                                                <summary>full note</summary>
                                                                <p className="tier-prose mt-1">{note}</p>
                                                                {e.duty_current_task ? (
                                                                  <p className="mt-2">
                                                                    <span className="label-micro">Duty task</span>
                                                                    <span className="mt-0.5 block font-mono text-2xs text-muted-foreground">
                                                                      {show(e.duty_current_task)}
                                                                    </span>
                                                                  </p>
                                                                ) : null}
                                                              </details>
                                                            ) : null}
                                                          </td>
                                                        </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <SourceGap
                    reason="No capacity note is declared at source."
                    detail="This is an absence in canonical floor data, not a finding that capacity is unlimited."
                  />
                )}
              </Panel>
        <Panel title="Review and session state">
          <div className="body">
            <div className="command-split" style={{ gap: '0.6rem' }}>
              <div>
                <div className="label-micro mb-1">Sessions</div>
                <p>
                  {surface.floor?.sessions?.available
                    ? `${surface.floor.sessions.count} lease(s) observed. ${surface.floor.sessions.meaning}`
                    : (surface.floor?.sessions?.reason ?? 'SESSION PROJECTION UNAVAILABLE')}
                </p>
              </div>
              <div>
                <div className="label-micro mb-1">Runtime</div>
                <p>
                  {surface.floor?.runtime?.state ?? 'UNKNOWN'} ·{' '}
                  {surface.floor?.runtime?.detail ?? 'UNKNOWN'}
                </p>
              </div>
            </div>
            <p className="mt-2 prose-note">
              Review states must be read in their project evidence. No reviewer completion is
              inferred from presence on the floor.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}

/** Activity: the canonical event feed, as a filterable log. */
export function ActivityPanel({ surface }: { surface: CommandSurface }) {
  const floor = surface.floor;
  const events = floor?.activity?.events ?? [];
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<unknown>(null);
  /*
    DECLARED-ACTION FILTER (seq 8411).

    Founder QA seq 8410 measured this peer at 635 literal UNKNOWN tokens
    across 334 rows, concentrated in the Action and Task columns, and no way
    for an operator to isolate the minority of rows that DO carry a declared
    action. The feed was honest and unreadable at the same time.

    This filter is a DECLARED-PREDICATE filter over the projection — "has this
    event a declared action" — exactly like the existing text search beside it.
    It is not a ranking, not a score, and not an inference: an event with no
    declared action is filtered out, and the count of what was filtered out is
    shown rather than silently dropped. The honest UNKNOWN is still rendered
    on every row that remains, and the full feed is one click away.
  */
  const [declaredOnly, setDeclaredOnly] = React.useState(false);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .filter(
        (e) =>
          (!declaredOnly ||
            (!!e.action && e.action !== 'UNKNOWN' && e.action !== '')) &&
          (!q ||
            `${e.handle} ${e.action ?? ''} ${e.task ?? ''} ${e.project ?? ''}`
              .toLowerCase()
              .includes(q)),
      )
      .map((e) => ({
        event_id: e.event_id,
        broker_sequence: e.broker_sequence,
        handle: e.handle,
        action: e.action,
        task: e.task,
        project: e.project,
        state: e.state,
        created_at: e.created_at,
        has_evidence: e.has_evidence,
        needs_founder: e.needs_founder,
        record_hash: e.record_hash,
      }));
  }, [events, query, declaredOnly]);

  if (!floor)
    return (
      <Panel title="Activity provenance">
        <SourceGap reason="Floor projection unavailable." detail="No activity feed was read." />
      </Panel>
    );

  return (
    <>
      <PeerWorkHeader
        peer="Activity"
        question="What has the ledger recorded recently, and what is the window it was read from?"
      />
      <FocusRail label="Reading note">
        <p>
          {floor.execution_projection.state} · projection generated{' '}
          {floor.execution_projection.generated_at ?? 'UNKNOWN'}. Events are evidence of activity;
          they never establish process or loop maturity.
        </p>
      </FocusRail>
      <Panel
              title="Activity provenance"
              count={`${rows.length} / ${events.length} events`}
              toolbar={
                <>
                  <button
                    type="button"
                    className="cmd-btn filter-toggle"
                    data-variant={declaredOnly ? 'active' : undefined}
                    aria-pressed={declaredOnly}
                    onClick={() => setDeclaredOnly((v) => !v)}
                  >
                    Declared action only
                  </button>
                  <input
                    value={query}
                    placeholder="Search handle, action, task…"
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search activity"
                    style={{ width: '13rem' }}
                  />
                </>
              }
            >
              <div className="border-b border-border px-2.5 py-1.5">
                <span className="prose-note">
                  window {floor.activity.window.size} · seq{' '}
                  {show(floor.activity.window.broker_sequence_min)}–
                  {show(floor.activity.window.broker_sequence_max)} ·{' '}
                  {floor.activity.window.source}
                </span>
                {/*
                  What the filter removed is stated, never silently dropped — an
                  operator must be able to tell "no events" from "events I filtered".
                */}
                {declaredOnly && events.length - rows.length > 0 ? (
                  <span className="prose-note ml-3">
                    {events.length - rows.length} event(s) without a declared action are hidden by this
                    filter.
                  </span>
                ) : null}
              </div>
              {rows.length ? (
                <div className="command-table-wrap tall scroll-hint">
            <table>
              <caption>Room ledger events · evidence of activity, not of process state</caption>
              <thead>
                <tr>
                  <th style={{ width: '4.5rem' }}>Seq</th>
                  <th style={{ width: '8rem' }}>Handle</th>
                  <th style={{ width: '7rem' }}>Action</th>
                  <th>Task</th>
                  <th style={{ width: '7rem' }}>Project</th>
                  <th style={{ width: '6rem' }}>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`${r.event_id}-${i}`}
                    className="clickable"
                    tabIndex={0}
                    onClick={() => setSelected(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setSelected(r);
                    }}
                  >
                    <td className="num">{show(r.broker_sequence)}</td>
                    <td className="mono">{r.handle}</td>
                    <td className="mono">{show(r.action)}</td>
                    <td className="row-rail" data-tone="room">
                      {show(r.task)}
                    </td>
                    <td className="mono">{show(r.project)}</td>
                    <td>
                      <Chip value={r.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <SourceGap
            reason={events.length ? 'No matching events.' : 'Floor projection recorded zero events.'}
          />
        )}
      </Panel>
      {selected !== null ? (
        <Drawer
          title="Ledger event"
          crumb="Starq Technologies → Dev Studio → Activity"
          record={selected}
          close={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}

/**
 * StaffSurface — the roster, split so identity / duty / execution never share
 * a visual block, AND split again into list / selected detail.
 *
 * GAP MAP WF-DS-02, WF-MISS-02, WF-MOB-02.
 *
 * WHAT WAS WRONG
 *
 * "The main watch face is a dense full-width roster table with tiny text and no
 * selected row/detail pane visible by default. A long 'Reading note' precedes
 * the roster." The intended outcome was a scanable row list plus a selected
 * identity you can inspect without losing scan context.
 *
 * THE RECOMPOSITION
 *
 *   · the reading note moves behind a closed disclosure BELOW the roster, so it
 *     no longer precedes the work (WF-HIER-01);
 *   · the roster becomes the bounded list pane of a `WorkArea`, with the first
 *     declared ACTIVE row selected so the peer opens with a real inspector
 *     rather than an empty right-hand pane;
 *   · selection is a row state, not a modal — the drawer is no longer the only
 *     way to see a person;
 *   · the inspector carries identity, duty, execution and provenance for the
 *     selected person, including the fields that do not fit a comparison row.
 *
 * PRESERVED
 *
 * Identity, duty and execution stay in separate columns with separate confidence
 * markers, because a task mention is none of them. A row that says "assigned"
 * still shows how confidently the source claims it.
 */
/**
 * CMD-DI-2-1 status groups.
 *
 * A group matches only when `duty_state` or `current_state` is already that
 * token. OFFLINE, ACTIVE_READY, AVAILABLE and the other source strings are
 * not rewritten into Working / Blocked / Unavailable. An empty or UNKNOWN
 * field matches nothing except All.
 */
export const STAFF_STATUS_FILTERS = [
  { id: 'ALL', label: 'All' },
  { id: 'WORKING', label: 'Working' },
  { id: 'AWAITING_REVIEW', label: 'Awaiting review' },
  { id: 'BLOCKED', label: 'Blocked' },
  { id: 'UNAVAILABLE', label: 'Unavailable' },
] as const;

export type StaffStatusFilter = (typeof STAFF_STATUS_FILTERS)[number]['id'];
export type StaffViewMode = 'table' | 'card' | 'grid';

const DECLARED_STATUS_TOKENS: Record<Exclude<StaffStatusFilter, 'ALL'>, readonly string[]> = {
  WORKING: ['WORKING', 'Working'],
  AWAITING_REVIEW: ['AWAITING_REVIEW', 'Awaiting review', 'AWAITING REVIEW'],
  BLOCKED: ['BLOCKED', 'Blocked'],
  UNAVAILABLE: ['UNAVAILABLE', 'Unavailable'],
};

export function matchesDeclaredStaffStatus(entry: RosterEntry, filter: StaffStatusFilter): boolean {
  if (filter === 'ALL') return true;
  const tokens = DECLARED_STATUS_TOKENS[filter];
  const duty = entry.duty_state?.trim() ?? '';
  const current = entry.current_state?.trim() ?? '';
  if (!duty && !current) return false;
  return tokens.includes(duty) || tokens.includes(current);
}

function DutyExecutionPair({ entry }: { entry: RosterEntry }) {
  const disagreement = entry.truth_disagreement;
  return (
    <div data-duty-execution="">
      <div className="grid grid-cols-2 gap-2">
        <div data-lane="duty">
          <span className="label-micro">Duty</span>
          <span className="mt-0.5 block font-mono text-2xs">{entry.duty_state || 'UNKNOWN'}</span>
          <span className="mt-0.5 block text-2xs text-muted-foreground">{show(entry.duty_current_task)}</span>
        </div>
        <div data-lane="execution">
          <span className="label-micro">Execution</span>
          <span className="mt-0.5 block font-mono text-2xs">{entry.current_state || 'UNKNOWN'}</span>
          <span className="mt-0.5 block text-2xs text-muted-foreground">
            {show(entry.execution_current_task)}
          </span>
        </div>
      </div>
      {disagreement?.values_differ ? (
        <p className="mt-1 text-2xs" data-truth-disagreement="duty-ne-execution">
          Duty ≠ Execution
          <span className="mt-0.5 block font-mono" data-duty-side="">
            {disagreement.duty_side.value}
          </span>
          <span className="block font-mono" data-execution-side="">
            {disagreement.execution_side.value}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function StaffRosterCards({
  entries,
  selectedHandle,
  onSelect,
}: {
  entries: readonly RosterEntry[];
  selectedHandle: string | null;
  onSelect: (handle: string) => void;
}) {
  if (!entries.length) {
    return (
      <SourceGap
        reason="No staff match this filter or search."
        detail="Declared duty_state and current_state were not reclassified to fill this group."
      />
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-2" data-staff-cards="" aria-label="Staff card view">
      {entries.map((entry) => (
        <li key={entry.handle}>
          <button
            type="button"
            className="command-panel w-full px-2.5 py-2 text-left"
            data-staff-card={entry.handle}
            aria-pressed={entry.handle === selectedHandle}
            onClick={() => onSelect(entry.handle)}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs">{entry.handle}</span>
              <Chip value={entry.duty_state || 'UNKNOWN'} />
            </span>
            <span className="mt-1 block text-2xs text-muted-foreground">
              {entry.duty_capacity_note ?? 'no capacity note'}
            </span>
            <div className="mt-2">
              <DutyExecutionPair entry={entry} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function StaffRosterGrid({ entries }: { entries: readonly RosterEntry[] }) {
  if (!entries.length) {
    return (
      <SourceGap
        reason="No staff match this filter or search."
        detail="Declared duty_state and current_state were not reclassified to fill this group."
      />
    );
  }
  return (
    <div className="command-table-wrap scroll-hint" data-staff-grid="">
      <table>
        <caption>Dev Studio seats · duty and execution kept apart</caption>
        <thead>
          <tr>
            <th style={{ width: '7rem' }}>Staff</th>
            <th style={{ width: '8rem' }}>Status</th>
            <th>Duty</th>
            <th>Execution</th>
            <th>Capacity note</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.handle} data-staff-grid-row={entry.handle}>
              <td className="mono">{entry.handle}</td>
              <td>
                <Chip value={entry.duty_state || 'UNKNOWN'} />
              </td>
              <td>
                <span className="duty-verdict" data-duty-state={entry.duty_state || 'UNKNOWN'}>
                  {entry.duty_state || 'UNKNOWN'}
                </span>
                <span className="mt-0.5 block text-2xs text-muted-foreground">
                  {show(entry.duty_current_task)}
                </span>
              </td>
              <td>
                <span className="block font-mono text-2xs">{entry.current_state || 'UNKNOWN'}</span>
                <span className="mt-0.5 block text-2xs text-muted-foreground">
                  {show(entry.execution_current_task)}
                </span>
                {entry.truth_disagreement?.values_differ ? (
                  <span className="mt-1 block text-2xs" data-truth-disagreement="duty-ne-execution">
                    Duty ≠ Execution
                    <span className="mt-0.5 block font-mono" data-duty-side="">
                      {entry.truth_disagreement.duty_side.value}
                    </span>
                    <span className="block font-mono" data-execution-side="">
                      {entry.truth_disagreement.execution_side.value}
                    </span>
                  </span>
                ) : null}
              </td>
              <td className="prose">{entry.duty_capacity_note ?? 'no capacity note'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StaffSurface({ surface }: { surface: CommandSurface }) {
  const floor = surface.floor;
  const staff = floor?.staff;
  // THE MAIN STAFF SURFACE SHOWS THE DECLARED TEN. `floor.roster.entries` is
  // untouched and still complete — the curation happens here, at the point of
  // presentation, so the full observed roster remains auditable underneath.
  const entries = staff?.canonical_seats ?? floor?.roster?.entries ?? [];
  const herdrLive = useHerdrLive();
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<'ALL' | 'PAID' | 'FREE'>('ALL');
  const [statusFilter, setStatusFilter] = React.useState<StaffStatusFilter>('ALL');
  const [view, setView] = React.useState<StaffViewMode>('table');
  const [selectedHandle, setSelectedHandle] = React.useState<string | null>(null);
  const rosterAnchor = React.useRef<HTMLDivElement>(null);
  const c = rosterCounts(entries);

  const chooseView = (next: StaffViewMode) => {
    const scroller = rosterAnchor.current?.closest('main');
    const top = scroller instanceof HTMLElement ? scroller.scrollTop : null;
    // Commit the view before restoring. A microtask runs before React applies
    // this update, so it cannot put back a position the commit itself drops.
    flushSync(() => {
      setView(next);
    });
    if (top !== null && scroller instanceof HTMLElement) {
      scroller.scrollTop = top;
    }
  };

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!matchesDeclaredStaffStatus(e, statusFilter)) return false;
      if (filter === 'PAID' && e.staff_profile?.capacity_class !== 'PAID_L1') return false;
      if (filter === 'FREE' && e.staff_profile?.capacity_class !== 'FREE_SUPPORT') return false;
      if (!q) return true;
      return `${e.handle} ${e.display_name ?? ''} ${e.role ?? ''} ${e.staff_profile?.seat_label ?? ''} ${
        e.staff_profile?.provider_owner ?? ''
      } ${e.staff_profile?.product_client ?? ''} ${e.staff_profile?.role_family ?? ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [entries, query, filter, statusFilter]);

  /*
    DEFAULT SELECTION: the first declared ACTIVE row.

    Gap map WF-DS-02 asked for exactly this ("select the first declared active
    row when appropriate"), and the reason is not convenience: with the detail
    pane empty, an operator has to know what to select before they learn
    anything, which is the opposite of a work area. Where no active row exists
    the first row is selected instead, and where there is no roster at all the
    detail pane says so rather than rendering nothing.

    This is selection, not inference. It does not claim the selected person is
    working, available or assigned — it claims only that their row exists.
  */
  const selected =
    rows.find((e) => e.handle === selectedHandle) ??
    rows.find((e) => e.is_active_staff) ??
    rows[0] ??
    null;

  const onSelect = React.useCallback((handle: string) => setSelectedHandle(handle), []);

  return (
    <>
      <StaffRail surface={surface} />
      <div className="command-stack" ref={rosterAnchor}>
        <PeerWorkHeader
          peer="Staff"
          question="Who are the ten Dev Studio seats, what does each cost and run on, and what does canonical source declare they are assigned to?"
        />
        <div className="flex flex-wrap items-center gap-2 px-1" data-staff-controls="">
          <div role="group" aria-label="Staff view">
            <button
              type="button"
              data-staff-view="table"
              aria-pressed={view === 'table'}
              data-variant={view === 'table' ? 'active' : undefined}
              onClick={() => chooseView('table')}
            >
              Table
            </button>
            <button
              type="button"
              data-staff-view="card"
              aria-pressed={view === 'card'}
              data-variant={view === 'card' ? 'active' : undefined}
              onClick={() => chooseView('card')}
            >
              Card view
            </button>
            <button
              type="button"
              data-staff-view="grid"
              aria-pressed={view === 'grid'}
              data-variant={view === 'grid' ? 'active' : undefined}
              onClick={() => chooseView('grid')}
            >
              Grid view
            </button>
          </div>
          <div role="group" aria-label="Staff status">
            {STAFF_STATUS_FILTERS.map((group) => (
              <button
                key={group.id}
                type="button"
                data-staff-status={group.id}
                aria-pressed={statusFilter === group.id}
                data-variant={statusFilter === group.id ? 'active' : undefined}
                onClick={() => setStatusFilter(group.id)}
              >
                {group.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            placeholder="Search seat, provider, product…"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search staff"
            style={{ width: '13rem' }}
          />
          <button
            type="button"
            data-variant={filter === 'PAID' ? 'active' : undefined}
            onClick={() => setFilter(filter === 'PAID' ? 'ALL' : 'PAID')}
          >
            Paid L1 ({c.paidL1})
          </button>
          <button
            type="button"
            data-variant={filter === 'FREE' ? 'active' : undefined}
            onClick={() => setFilter(filter === 'FREE' ? 'ALL' : 'FREE')}
          >
            Free / offload ({c.freeSupport})
          </button>
          <p className="prose-note">
            Status groups match a declared duty_state or current_state exactly. Other source tokens are
            not reclassified.
          </p>
        </div>
        {view === 'card' ? (
          <StaffRosterCards
            entries={rows}
            selectedHandle={selected?.handle ?? null}
            onSelect={onSelect}
          />
        ) : null}
        {view === 'grid' ? <StaffRosterGrid entries={rows} /> : null}
        {view === 'table' ? (
        <WorkArea
          label="Dev Studio staff"
          rows={rows.map((e) => e.handle)}
          selectedId={selected?.handle ?? null}
          onSelect={onSelect}
          count={`${rows.length} / ${entries.length}`}
          list={
            entries.length ? (
              rows.length ? (
                <ul className="work-row-list" role="listbox" aria-label="Dev Studio staff roster">
                  {rows.map((e) => {
                    const profile = e.staff_profile;
                    const live = profile?.herdr_seat_id
                      ? herdrLive.bySeatId[profile.herdr_seat_id]
                      : undefined;
                    return (
                      <WorkRow
                        key={e.handle}
                        id={e.handle}
                        selected={e.handle === selected?.handle}
                        onSelect={onSelect}
                        tone={e.is_active_staff ? 'ok' : 'unknown'}
                      >
                        <span className="k">{e.handle}</span>
                        {/* WF-DS-02: the roster read as a database dump because
                            every field wore the same 10px muted weight. The
                            person's identity is the row's comparable value. */}
                        <span className="r">
                          {profile?.seat_label ?? e.display_name ?? e.role ?? 'UNKNOWN'}
                        </span>
                        <span className="v">
                          {profile?.capacity_class ?? 'NO PROFILE'} ·{' '}
                          {profile?.provider_owner ?? 'UNKNOWN'} ·{' '}
                          {e.observed_in_ledger === false
                            ? 'DECLARED, NOT OBSERVED'
                            : `host ${profile?.normal_host ?? 'UNKNOWN'}`}{' '}
                          · live{' '}
                          {e.herdr?.declared === false
                            ? 'NO MANIFEST ROW'
                            : live
                              ? `${live.state} · ${live.availability}${live.pid ? ` pid ${live.pid}` : ''}`
                              : herdrLive.state === 'LIVE'
                                ? 'EXITED'
                                : 'UNKNOWN'}
                          {' · seq '}
                          {show(e.last_meaningful_seq)}
                        </span>
                      </WorkRow>
                    );
                  })}
                </ul>
              ) : (
                <div className="work-area-empty">
                  <SourceGap reason="No staff match this filter or search." />
                </div>
              )
            ) : (
              <SourceGap
                reason="SOURCE UNAVAILABLE — no staff roster supplied."
                detail="The floor projection carries no roster entries. Absence of a roster is not an absence of staff."
              />
            )
          }
          detailTitle={selected ? selected.handle : 'Staff detail'}
          detail={
            selected ? <StaffDetail entry={selected} herdrLive={herdrLive} /> : null
          }
        />
        ) : null}
        {view !== 'table' && selected ? (
          <StaffDetail entry={selected} herdrLive={herdrLive} />
        ) : null}

        {/*
          SUPPRESSION IS STATED, NEVER SILENT.

          A board that quietly hides twelve handles is indistinguishable from one
          that has correctly decided those handles are not staff. So the count is
          on screen without being expanded, and the reason for each sits one
          disclosure away — while `floor.roster.entries` underneath keeps every
          one of them, so this is a presentation ruling and not a deletion.
        */}
        {staff && staff.suppressed_count > 0 ? (
          <Panel title="Not on the main staff surface" count={`${staff.suppressed_count} handles`}>
            <div className="body">
              <p className="prose-note">
                {staff.suppressed_count} observed handle(s) are kept off this board because they are
                not one of the declared Dev Studio seats. They remain in the floor roster, unchanged
                and complete — this is a curation of the main surface, not a deletion.{' '}
                {staff.accounting}
              </p>
              <div className="command-table-wrap short scroll-hint mt-2">
                <table>
                  <caption>Suppressed handles · every observed handle accounted for</caption>
                  <thead>
                    <tr>
                      <th style={{ width: '7rem' }}>Handle</th>
                      <th style={{ width: '7rem' }}>Class</th>
                      <th>Reason</th>
                      <th style={{ width: '5rem' }}>Last seq</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.suppressed.map((s) => (
                      <tr key={s.handle}>
                        <td className="mono">{s.handle}</td>
                        <td>
                          <Chip value={s.staff_classification} />
                        </td>
                        <td className="prose">{s.reason}</td>
                        <td className="num">{show(s.last_meaningful_seq)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>
        ) : null}

        {floor?.constraints?.length ? (
                  <Panel title="Floor constraints" count={`${floor.constraints.length} declared`}>
                    {/*
                      scroll-hint (seq 8411): Founder QA seq 8410 measured three stacked
                      horizontal scroll regions on this peer at 430x932 — ratios 1.68,
                      1.93 and 1.82 — with nothing indicating a second region existed
                      below the first. The contained scrolling is legitimate and is NOT
                      removed; the hint makes it discoverable. Detail is a free-text
                      declared field, so it is prose, not a token.
                    */}
                    <div className="command-table-wrap short scroll-hint">
                      <table>
                        <caption>Declared disagreement and staleness · never tidied into one answer</caption>
                        <thead>
                          <tr>
                            <th style={{ width: '9rem' }}>Kind</th>
                            <th style={{ width: '8rem' }}>Subject</th>
                            <th>Detail</th>
                            <th style={{ width: '10rem' }}>Canonical source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {floor.constraints.map((k, i) => (
                            <tr key={`${k.kind}-${i}`}>
                              <td>
                                <Chip value={k.kind} />
                              </td>
                              <td className="mono">{k.subject}</td>
                              <td className="prose">{k.detail}</td>
                              <td className="mono">{k.canonical_source}</td>
                            </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}

        {/*
          WF-HIER-01: the reading note moves BELOW the work and behind a closed
          disclosure. It used to be a full-width focus rail above the roster on
          every render, which is the composition the gap map named as the reason
          an operator could not get to the first useful row.
        */}
        <AboutMethod title="How to read the roster">
          <p>
            This board shows the declared Dev Studio seats only. The identity registry carries more
            handles than there are seats; the ones left off are counted and listed under &ldquo;Not
            on the main staff surface&rdquo; with a reason each, and they remain in the floor roster
            in full. Nothing was deleted to make this board look right.
          </p>
          <p className="mt-2">
            Three kinds of value sit here and they are not interchangeable. Declared seat metadata —
            provider, product, capacity class, normal host, role family — is a Founder declaration,
            not a measurement, and it is labelled as such. Live process state comes from the Herdr
            broker when this page rendered, and an unreachable broker reads as UNKNOWN rather than
            as offline. Duty and execution are forwarded from canonical source and stay separate.
          </p>
          <p className="mt-2">
            Canonical identity, duty and execution remain separate. A task mention is not an
            assignment, and presence on the floor is not capacity. Assignment is read from the
            declared assignment field only; an identity with no assignment source carries UNKNOWN
            rather than an inferred one. Nothing on this surface infers project membership from a
            mention, and nothing infers a provider, a host or a live PID.
          </p>
        </AboutMethod>
      </div>
    </>
  );
}

/**
 * The selected person's full declared detail.
 *
 * This is where the census disposition MOVE TO INSPECTOR/SHEET is satisfied:
 * duty, assignment, provenance and the confidence markers behind each are one
 * selection away rather than spread across a wide row.
 *
 * THE THREE LANES, LABELLED
 *
 * Declared, live and forwarded each sit under their own heading, because they
 * have different reliability and mixing them is how a declared normal host ends
 * up reading as an observed one. The host conflict — Elder's declared WSL
 * against a manifest that launches Windows — is printed as a conflict with both
 * values and no verdict, because resolving it is a Founder decision.
 */
function StaffDetail({
  entry,
  herdrLive,
}: {
  entry: RosterEntry;
  herdrLive: HerdrLiveJoin;
}) {
  const profile = entry.staff_profile;
  const declared = entry.herdr;
  const live = profile?.herdr_seat_id ? herdrLive.bySeatId[profile.herdr_seat_id] : undefined;
  const capacityTone = CAPACITY_CLASS_TONE[profile?.capacity_class ?? 'UNKNOWN'];
  const roleTone = ROLE_FAMILY_TONE[profile?.role_family ?? 'UNKNOWN'];

  return (
    <>
      <PeerWorkHeader
        peer={entry.handle}
        question={
          profile?.seat_label
            ? `${profile.seat_label} — ${profile.provider_owner} · ${profile.product_client}`
            : (entry.display_name ?? entry.role ?? 'UNKNOWN')
        }
      />
      <div className="mt-2">
        <KV
          rows={[
            ['Classification', entry.staff_classification],
            ['Identity present', String(entry.identity_present)],
            ['Identity status', entry.identity_status],
            ['Authority level', entry.authority_level],
            ['Role', entry.role ?? 'UNKNOWN'],
            ['Duty state', entry.duty_state],
            ['Current state', entry.current_state],
            ['State confidence', entry.current_state_confidence],
          ]}
        />
        <div className="mt-2">
          <DutyExecutionPair entry={entry} />
        </div>
      </div>

      {/*
        DECLARED SEAT METADATA.

        Rendered as text under a heading that says it is declared. No value here
        is measured, and none of it is a live reading — `provider_owner` may
        literally read `VARIES BY SESSION`, which is the honest answer for a
        seat whose provider is not fixed and is preferable to a constant that
        would go stale silently.
      */}
      <div className="mt-3">
        <div className="label-micro mb-1">Declared seat profile · not measured</div>
        {profile ? (
          <>
            <p className="mb-1">
              <span
                className={`inline-block px-1.5 py-0.5 mr-1.5 font-mono text-3xs border ${capacityTone?.chip ?? ''}`}
                title={capacityTone?.meaning}
              >
                {capacityTone?.label ?? profile.capacity_class}
              </span>
              <span className="font-mono text-3xs text-muted-foreground" title={roleTone?.meaning}>
                {roleTone?.label ?? profile.role_family}
              </span>
            </p>
            <KV
              rows={[
                ['Seat label', profile.seat_label],
                ['Provider / owner', profile.provider_owner],
                ['Product / client', profile.product_client],
                ['Harness', profile.harness],
                ['Capacity class', profile.capacity_class],
                ['Normal host', profile.normal_host],
                ['Role family', profile.role_family],
              ]}
            />
            <p className="mt-1 prose-note">
              Capacity class is a declared commercial fact, not a measurement: no signal on this
              floor distinguishes a paid seat from a free one. No live usage or quota meter exists
              for any seat, so none is shown.
            </p>
          </>
        ) : (
          <SourceGap
            reason="NO DECLARED SEAT PROFILE FOR THIS HANDLE."
            detail="This handle is not one of the canonical Dev Studio seats, so it carries no provider, product, capacity class, normal host or role family. None is inferred."
          />
        )}
      </div>

      {/*
        HERDR — DECLARED LAUNCH FACTS AND LIVE PROCESS STATE, SEPARATED.

        The left column is what the manifest declares and it is static. The right
        column is what the broker reports right now and it was fetched at render
        time. When the broker cannot be reached the live column says UNREACHABLE
        and never falls back to the declared values, because "the manifest says
        this seat launches on Windows" is not the same claim as "this seat is
        running on Windows".
      */}
      <div className="mt-3">
        <div className="label-micro mb-1">Herdr · declared launch vs live process</div>
        {declared?.declared ? (
          <KV
            rows={[
              ['Manifest seat id', declared.seat_id ?? 'UNKNOWN'],
              ['Declared launch runtime', declared.declared_runtime ?? 'UNKNOWN'],
              ['Startup policy', declared.startup_policy ?? 'UNKNOWN'],
              [
                'Launchable',
                declared.launchable === null ? 'UNKNOWN' : declared.launchable ? 'YES' : 'NO',
              ],
              ['Terminal PTY', declared.terminal === null ? 'UNKNOWN' : declared.terminal ? 'YES' : 'NO'],
              ['Live process state', live ? live.state : herdrLive.state === 'LIVE' ? 'EXITED' : 'UNKNOWN'],
              ['Live PID', live?.pid ? String(live.pid) : 'NONE RECORDED'],
              ['Live PTY session', live?.session_id ?? 'NONE RECORDED'],
              ['Dispatch eligibility', live?.dispatch_eligible ? 'YES' : live?.dispatch_blocker ?? 'UNKNOWN'],
              ['Explicit pane binding', live?.pane_binding.state ?? 'UNKNOWN'],
              ['Pane / terminal', live?.pane_binding.pane
                ? `${live.pane_binding.pane.workspace_id ?? '?'} / ${live.pane_binding.pane.pane_id ?? '?'} / ${live.pane_binding.pane.terminal_id ?? '?'}`
                : 'NONE CONFIRMED'],
              ['Availability reason', live?.availability_reason ?? 'No live seat observation.'],
              ['Observed at', live?.observed_at ?? 'UNKNOWN'],
              ['Live state source', herdrLive.liveStateSource],
            ]}
          />
        ) : (
          <SourceGap
            reason={
              declared?.absent_reason
                ? `NO HERDR MANIFEST ROW — ${declared.absent_reason}.`
                : entry.herdr_host_conflict
                  ? 'HERDR MANIFEST UNAVAILABLE — launchability is unknown for every seat.'
                  : 'NO HERDR JOIN — this handle declares no Herdr seat id.'
            }
            detail={
              herdrLive.state === 'UNREACHABLE'
                ? `Live process state was not read. ${herdrLive.reason}`
                : 'Absence of a manifest row is not a refusal to launch. No seat id, launch policy or launchability is invented for it.'
            }
          />
        )}
        {/*
          THE LIVE COLUMN'S OWN HONESTY.

          Rendered whenever no live value was obtained, INCLUDING for a seat that
          has a perfectly good declared manifest row. Without this, a seat with a
          manifest row shows declared facts and an empty live PID with nothing
          saying why — and the reader cannot tell "not running" from "we have not
          asked yet". Those are different facts, and only one of them is a reason
          to press stop.
        */}
        {herdrLive.state !== 'LIVE' ? (
          <p className="mt-2 prose-note">
            Live process state was NOT read for any seat on this render. {herdrLive.reason}{' '}
            Declared launch facts above still stand — they are a different claim from a live
            reading, and are not a substitute for one.
          </p>
        ) : null}
        {entry.herdr_host_conflict && declared?.declared ? (
          <p className="mt-2 duty-verdict" data-duty-state="CONFLICT">
            CONFLICT — declared normal host {profile?.normal_host} vs manifest launch runtime{' '}
            {declared.declared_runtime}. BOTH VALUES RENDERED WITH PROVENANCE. NOT RESOLVED BY
            COMMAND: which is canonical is a Founder decision.
          </p>
        ) : null}
        {entry.observed_in_ledger === false ? (
          <p className="mt-2 prose-note">
            {entry.absence_reason} This seat is DECLARED, not absent — it stays on the board with
            UNKNOWN everywhere rather than being read as a retirement.
          </p>
        ) : null}
      </div>

      {/*
        ROOM ACTIVITY AND FORWARDED EXECUTION STATE.

        `last_meaningful_seq` is the last Room sequence this handle is recorded
        in, forwarded from the activity projection. It is not recomputed here and
        not read back out of the live ledger, because a projection that has
        fallen behind the ledger is already reported as STALE above.
      */}
      <div className="mt-3">
        <div className="label-micro mb-1">Room activity and duty · forwarded verbatim</div>
        <KV
          rows={[
            ['Last meaningful Room seq', show(entry.last_meaningful_seq)],
            ['Last activity at', entry.last_activity_at ?? 'UNKNOWN'],
            ['Activity freshness', entry.activity_freshness],
            ['Duty task', show(entry.duty_current_task)],
            ['Capacity note', entry.duty_capacity_note ?? 'no capacity note'],
            ['Capacity reset at', entry.duty_capacity_reset_at ?? 'no capacity reset declared'],
            ['Execution assignment', show(entry.execution_current_assignment)],
            ['Assignment confidence', entry.execution_assignment_confidence],
            ['Assignment source', show(entry.execution_assignment_source)],
            ['Execution task', show(entry.execution_current_task)],
            ['Task source', show(entry.execution_task_source)],
            ['Session lease', entry.has_session ? 'HELD' : 'NONE'],
            ['Duty restrictions', entry.duty_restrictions ?? 'none declared'],
            ['Duty evidence count', String(entry.duty_evidence_count)],
          ]}
        />
      </div>

      <p className="mt-3 text-2xs text-muted-foreground">
        Declared seat metadata is a Founder declaration, not a measurement. Live process state is
        read from the Herdr broker at render time and is never held in a projection. Duty and
        execution are forwarded from canonical source and are never reconciled here — where they
        disagree, the disagreement is listed under floor constraints and shown there.
      </p>
    </>
  );
}
