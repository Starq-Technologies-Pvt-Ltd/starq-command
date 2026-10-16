/**
 * Company OS — the whole skyscraper, as one surface inside Command.
 *
 * WHAT THIS IS
 *
 * Founder ruling seq 8486/8487: Starq Command must represent Starq Technologies
 * Pvt. Ltd. AS A COMPANY, with Dev Studio as ONE FLOOR inside it. AG's contract
 * (seq 8488) fixes the chain: company -> floor -> room -> seat -> occupant ->
 * acting capacity -> delegation -> authority boundary.
 *
 * It lives inside the existing Command shell, on one nav item, beside Overview
 * and Evidence. It is NOT a second dashboard: it reads the same read-only
 * surface, adds no endpoint of its own, and creates no second source of truth.
 *
 * THE FOUR OBJECTS, AND WHY THE UI NEVER MERGES THEM
 *
 *   Seat             a durable organizational FUNCTION
 *   Occupant         who currently fills it
 *   Acting capacity  which seat that occupant is exercising right now
 *   Delegation       who may EXECUTE beneath it
 *
 * A company surface that renders "Mustarq, 41 roles" has answered none of the
 * four questions. So every panel names which object it is showing, and the
 * Founder panel deliberately renders an UNKNOWN active hat next to a menu of
 * candidate seats — because the honest state is that nobody has declared which
 * hat is on, and picking one would be Command inventing authority.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 *   - No live model, PID or process state. That is Herdr's, and the staff
 *     surface already joins it.
 *   - No health, usage or capacity numbers. Capacity class lives on the seat
 *     profile in the staff surface.
 *   - No ranking or maturity. This is a structure, not a scoreboard.
 *   - No Jev in any headcount. Jev is infrastructure, and this surface refuses
 *     to count it as a person.
 */
import type { CommandSurface, CompanyOsProjection } from '@/lib/contracts';
import {
  Chip,
  FocusRail,
  KV,
  Panel,
  RoomHead,
  SourceGap,
  Stat,
  StatRail,
} from '@/components/console';
import { AboutMethod, PeerWorkHeader } from '@/components/work-area';

/**
 * State vocabulary for rooms and floors.
 *
 * FUTURE_DORMANT is toned differently from ACTIVE on purpose and not for
 * decoration: a dormant initiative rendered in the same weight as a live one is
 * how a Founder reads "we run StarqPay" when the entity condition is unmet.
 */
const ROOM_STATE_TONE: Record<string, { label: string; chip: string }> = {
  ACTIVE: { label: 'ACTIVE', chip: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30' },
  FUTURE_DORMANT: {
    label: 'FUTURE / DORMANT',
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  },
  UNKNOWN: {
    label: 'UNKNOWN',
    chip: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  },
};

/** Seat states, kept literal so an unrecognised value is visible, not coerced. */
const SEAT_STATE_LABEL: Record<string, string> = {
  OCCUPIED_FOUNDER: 'OCCUPIED — FOUNDER',
  OCCUPIED_HUMAN: 'OCCUPIED — HUMAN',
  DELEGATED_AI: 'DELEGATED — AI / AUTOMATION',
  VACANT_UNFILLED: 'VACANT / UNFILLED',
  FUTURE_DORMANT: 'FUTURE / DORMANT',
  UNKNOWN: 'UNKNOWN',
};

const SEAT_STATE_TONE: Record<string, string> = {
  OCCUPIED_FOUNDER: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30',
  OCCUPIED_HUMAN: 'bg-truth-ok-soft text-truth-ok border-truth-ok/30',
  // Delegated execution is NOT the same as occupied, and it is NOT authority.
  // Toned as unknown so it can never be misread as a filled executive seat.
  DELEGATED_AI: 'bg-truth-stale-soft text-truth-stale border-truth-stale/30',
  VACANT_UNFILLED: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  FUTURE_DORMANT: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  UNKNOWN: 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
};

function roomTone(state: string) {
  return ROOM_STATE_TONE[state] ?? ROOM_STATE_TONE.UNKNOWN;
}

/**
 * The unavailable state.
 *
 * Deliberately NOT an empty building. A company surface that renders "0 floors,
 * 0 rooms" when its source is missing is indistinguishable from a company that
 * genuinely has no structure yet, and the first reading would be believed.
 */
function CompanyOsUnavailable({ company }: { company: CompanyOsProjection }) {
  return (
    <div data-surface-signature="company-os-unavailable" className="room-root" data-room="company">
      <RoomHead
        mark="CO"
        title="Company OS"
        sub="Starq Technologies Pvt. Ltd. as a company"
      />
      <SourceGap
        reason={`COMPANY SEAT REGISTRY UNAVAILABLE — ${company.reason ?? 'no reason recorded'}`}
        detail={`Source: ${company.path ?? 'company-seats.json'}. This surface renders structure from a declared registry and never from prose. An absent registry is reported as an absence, not drawn as an empty company.`}
      />
    </div>
  );
}

/** The exec band. Answers "is this a company, and is it whole?" in one screen. */
function CompanyOsRail({ company }: { company: CompanyOsProjection }) {
  const c = company.counts;
  const sep = company.separation;
  if (!c) {
    return (
      <StatRail>
        <Stat k="Company OS" v={null} sub="no declared counts" />
      </StatRail>
    );
  }
  return (
    <StatRail>
      <Stat
        k="Floors"
        v={c.floors}
        tone={c.floors ? 'ok' : 'unknown'}
        sub="Dev Studio is ONE of these, not the building"
      />
      <Stat
        k="Rooms"
        v={`${c.rooms_active} active / ${c.rooms_dormant} dormant`}
        tone={c.rooms_dormant ? 'stale' : 'ok'}
        sub={`${c.devstudio_rooms} in Dev Studio · ${c.devstudio_rooms_dormant} of those dormant`}
      />
      {/*
        SEATS vs OCCUPANTS, side by side and never merged.

        This is the single most important number pair on the surface. 41 seats
        held by 1 person is a COMPANY with a thin bench, not a one-person org
        with 41 titles. Rendering "41" alone would read as a headcount and
        collapse the exact distinction the whole model exists to hold.
      */}
      <Stat
        k="Seats / Occupants"
        v={`${c.seats} / ${c.distinct_occupants}`}
        tone="founder"
        sub={
          sep?.seats_per_occupant
            ? `${sep.seats_per_occupant} seats per occupant · a seat is a FUNCTION, not a person`
            : 'seats are functions, not people'
        }
      />
      <Stat
        k="Seats claiming authority"
        v={c.seats_claiming_authority}
        tone={c.seats_claiming_authority > 1 ? 'stale' : 'ok'}
        sub="only a Founder seat with a canonical source may"
      />
      <Stat
        k="Infrastructure"
        v={c.infrastructure}
        tone="unknown"
        sub={`${c.infrastructure_claiming_staff} counted as staff · Jev is not a person`}
      />
    </StatRail>
  );
}

/**
 * Structure — the building tree.
 *
 * Every floor, and under Dev Studio every one of the eight project rooms
 * including the dormant ones. Dormant rooms are rendered in place with their
 * activation conditions, not moved to a footnote: a gated room that vanishes
 * from the portfolio is indistinguishable from a room that does not exist.
 */
function StructureTab({ company }: { company: CompanyOsProjection }) {
  const roomsByFloor = new Map<string, typeof company.rooms>();
  for (const room of company.rooms) {
    const key = room.floor_id ?? '';
    if (!roomsByFloor.has(key)) roomsByFloor.set(key, []);
    roomsByFloor.get(key)!.push(room);
  }
  const seatsByFloor = new Map<string, number>();
  for (const seat of company.seats) {
    if (!seat.floor_id) continue;
    seatsByFloor.set(seat.floor_id, (seatsByFloor.get(seat.floor_id) ?? 0) + 1);
  }

  const ordered = [...company.floors].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));

  return (
    <>
      <PeerWorkHeader
        peer="Structure"
        question="What floors does this company have, and what is on each one?"
      />
      <FocusRail label="Reading the building">
        <p>
          The company is the building and Dev Studio is one floor inside it. Every declared floor
          is listed, including the ones with no staff yet — a floor with no seats is a real
          organisational statement, not an omission.
        </p>
      </FocusRail>
      <FocusRail label="Reporting line">
        <p className="prose-note" data-testid="advisory-reporting-disclaimer">
          <span className="inline-block px-1.5 py-0.5 mr-2 font-mono text-3xs border bg-truth-stale-soft text-truth-stale border-truth-stale/30">
            ADVISORY
          </span>
          Proposed Accountability Mapping (Advisory). Ratified designations and standings per Chapter 22.
        </p>
      </FocusRail>
      {ordered.map((floor) => {
        const rooms = [...(roomsByFloor.get(floor.id) ?? [])].sort(
          (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0),
        );
        const tone = roomTone(floor.state);
        return (
          <Panel
            key={floor.id}
            title={`Floor ${floor.ordinal} — ${floor.name}`}
            count={`${seatsByFloor.get(floor.id) ?? 0} seats · ${rooms.length} rooms`}
          >
            <div className="body">
              <div className="mb-2">
                <span
                  className={`inline-block px-1.5 py-0.5 mr-2 font-mono text-3xs border ${tone.chip}`}
                >
                  {tone.label}
                </span>
                {floor.division_type ? (
                  <span className="font-mono text-3xs text-muted-foreground mr-2">
                    {floor.division_type}
                  </span>
                ) : null}
                {floor.above_operating_company ? (
                  <span className="font-mono text-3xs text-muted-foreground">
                    ABOVE OPERATING COMPANY
                  </span>
                ) : null}
              </div>
              {floor.purpose ? <p className="prose-note mb-2">{floor.purpose}</p> : null}
              {floor.note ? <p className="prose-note mb-2">{floor.note}</p> : null}
              {/*
                A floor declaring itself an officer surface is a governance
                defect. It is refused at load and reported here if it ever
                appears, rather than rendered as though it were normal.
              */}
              {floor.is_corporate_officer_surface ? (
                <p className="duty-verdict" data-duty-state="CONFLICT">
                  CONFLICT — this floor declares a corporate-officer surface. No agent or automated
                  division is an officer of the company. Refused at load.
                </p>
              ) : null}
              {rooms.length ? (
                <div className="command-table-wrap short scroll-hint mt-2">
                  <table>
                    <caption>Rooms on this floor · dormant rooms shown truthfully</caption>
                    <thead>
                      <tr>
                        <th style={{ width: '3rem' }}>#</th>
                        <th style={{ width: '14rem' }}>Room</th>
                        <th style={{ width: '11rem' }}>State</th>
                        <th>Purpose and gate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rooms.map((room) => {
                        const rt = roomTone(room.state);
                        return (
                          <tr key={room.id}>
                            <td className="num">{room.ordinal ?? '—'}</td>
                            <td>{room.name}</td>
                            <td>
                              <span
                                className={`inline-block px-1.5 py-0.5 font-mono text-3xs border ${rt.chip}`}
                              >
                                {room.state_label ?? rt.label}
                              </span>
                            </td>
                            <td className="prose">
                              {room.purpose}
                              {/*
                                A dormant room carries its activation
                                conditions in place. This is the single most
                                load-bearing honesty rule on the surface: the
                                Founder must be able to see WHAT is gated and
                                WHY without opening a second document.
                              */}
                              {room.activation_conditions.length ? (
                                <span className="block mt-1 font-mono text-3xs text-muted-foreground">
                                  GATED ON: {room.activation_conditions.join(' · ')}
                                </span>
                              ) : null}
                              {room.entity_gate ? (
                                <span className="block mt-1 font-mono text-3xs text-amber-400">
                                  {room.entity_gate} [{room.entity_gate_state ?? 'UNKNOWN'}]
                                </span>
                              ) : null}
                              {room.note ? (
                                <span className="block mt-1 text-3xs text-muted-foreground">
                                  {room.note}
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="prose-note mt-2">
                  No declared rooms on this floor. That is a fact about the registry, not a claim
                  that the floor has no work.
                </p>
              )}
            </div>
          </Panel>
        );
      })}
    </>
  );
}

/**
 * Seats — every seat, with occupant, state and delegation as SEPARATE columns.
 *
 * The columns are separate because the four objects are separate. A single
 * "role" column would answer none of the four questions the contract requires.
 */
function SeatsTab({ company }: { company: CompanyOsProjection }) {
  const floorName = new Map(company.floors.map((f) => [f.id, f.name]));
  const ordered = [...company.seats].sort((a, b) => {
    const fa = company.floors.find((f) => f.id === a.floor_id)?.ordinal ?? 99;
    const fb = company.floors.find((f) => f.id === b.floor_id)?.ordinal ?? 99;
    if (fa !== fb) return fa - fb;
    return a.seat_id.localeCompare(b.seat_id);
  });

  return (
    <>
      <PeerWorkHeader
        peer="Seats"
        question="Which organisational functions exist, who fills them, and who may execute beneath them?"
      />
      <FocusRail label="Seat is not person">
        <p>
          A seat is a durable function. An occupant is whoever currently fills it. Delegation is who
          may execute beneath it. Delegated execution is never authority, and no agent is an officer
          of this company by appearing anywhere on this surface.
        </p>
      </FocusRail>
      <Panel title="Company seat registry" count={`${company.seats.length} seats`}>
        <div className="body">
          <div className="command-table-wrap tall scroll-hint">
            <table>
              <caption>
                Seats · occupant and delegation are separate facts and are never merged
              </caption>
              <thead>
                <tr>
                  <th style={{ width: '13rem' }}>Seat</th>
                  <th style={{ width: '11rem' }}>Floor / Area</th>
                  <th style={{ width: '11rem' }}>Seat state</th>
                  <th style={{ width: '7rem' }}>Occupant</th>
                  <th>Delegated execution</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((seat) => (
                  <tr key={seat.seat_id}>
                    <td>
                      <div>{seat.seat_name}</div>
                      <div className="font-mono text-3xs text-muted-foreground">
                        {seat.seat_id}
                      </div>
                      {seat.business_activity ? (
                        <div className="font-mono text-3xs text-muted-foreground">
                          {seat.business_activity}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-2xs">
                      {seat.floor_id ? (floorName.get(seat.floor_id) ?? seat.floor_id) : 'UNKNOWN'}
                      {seat.room_id ? (
                        <div className="font-mono text-3xs text-muted-foreground">
                          {seat.room_id}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`inline-block px-1.5 py-0.5 font-mono text-3xs border ${
                          SEAT_STATE_TONE[seat.seat_state] ?? SEAT_STATE_TONE.UNKNOWN
                        }`}
                      >
                        {SEAT_STATE_LABEL[seat.seat_state] ?? seat.seat_state}
                      </span>
                      {/* An incoherent occupancy is reported here rather than
                          repaired: an occupied seat with no occupant is not
                          rendered as occupied. */}
                      {!seat.occupant_coherent ? (
                        <div className="font-mono text-3xs text-amber-400 mt-1">
                          OCCUPANCY INCOHERENT — see conflicts
                        </div>
                      ) : null}
                    </td>
                    <td className="text-2xs">
                      {seat.occupant_id ?? (
                        <span className="text-muted-foreground">NONE</span>
                      )}
                      <div className="font-mono text-3xs text-muted-foreground">
                        {seat.occupant_type}
                      </div>
                    </td>
                    <td className="text-2xs">
                      {seat.delegations.length ? (
                        <>
                          <span className="font-mono">{seat.delegations.join(' · ')}</span>
                          <div className="font-mono text-3xs text-muted-foreground">
                            EXECUTION ONLY — GRANTS NO AUTHORITY
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">none declared</span>
                      )}
                      {seat.delegation_note ? (
                        <div className="text-3xs text-muted-foreground mt-1">
                          {seat.delegation_note}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>
    </>
  );
}

/** Portfolio — the room inventory, with the dormant ones given equal footing. */
function PortfolioTab({ company }: { company: CompanyOsProjection }) {
  const floorName = new Map(company.floors.map((f) => [f.id, f.name]));
  const active = company.rooms.filter((r) => r.state === 'ACTIVE');
  const dormant = company.rooms.filter((r) => r.state !== 'ACTIVE');

  return (
    <>
      <PeerWorkHeader
        peer="Portfolio"
        question="What does this company actually operate, and what is declared but not yet live?"
      />
      <FocusRail label="Dormant is not absent">
        <p>
          Dormant initiatives are listed with their gates. A gated initiative that disappears from
          the portfolio is indistinguishable from one that was never intended — and StarqPay and
          Starq Academy both have entity conditions that are not met.
        </p>
      </FocusRail>
      <div className="command-split">
        <Panel title="Operating rooms" count={`${active.length} active`}>
          <div className="body">
            {active.length ? (
              <ul className="work-row-list">
                {active.map((room) => (
                  <li key={room.id} className="work-row" data-selected="false">
                    <span className="k">{room.floor_id ?? '—'}</span>
                    <span className="r">{room.name}</span>
                    <span className="v">{room.purpose ?? 'no purpose declared'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <SourceGap reason="No room is declared active." />
            )}
          </div>
        </Panel>
        <Panel title="Declared, not yet live" count={`${dormant.length} dormant`}>
          <div className="body">
            {dormant.length ? (
              <ul className="work-row-list">
                {dormant.map((room) => (
                  <li key={room.id} className="work-row" data-selected="false">
                    <span className="k">{room.floor_id ?? '—'}</span>
                    <span className="r">{room.name}</span>
                    <span className="v">
                      {room.state_label ?? 'FUTURE / DORMANT'}
                      {room.entity_gate ? ` · ${room.entity_gate}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <SourceGap reason="No dormant room is declared." />
            )}
            {/*
              THE HOADHAA BOUNDARY, rendered where it is easy to find.

              Two organizational owners and one technology product. Getting this
              backwards is how a commercial conversation becomes an engineering
              task, so the split is stated in full rather than implied by which
              floor a room sits on.
            */}
            {(() => {
              const hoadha = company.rooms.find((r) => r.id === 'devstudio-03-hoadha');
              if (!hoadha?.boundary) return null;
              return (
                <div className="mt-3">
                  <div className="label-micro mb-1">Hoadhaa boundary · two owners</div>
                  <p className="prose-note mb-2">{hoadha.boundary.rule}</p>
                  <KV
                    rows={[
                      [
                        'Dev Studio owns (technology)',
                        hoadha.boundary.devstudio_owns.join(' · '),
                      ],
                      [
                        'Starq Dynamics owns (commercial)',
                        hoadha.boundary.dynamics_owns.join(' · '),
                      ],
                      ['Source', hoadha.boundary.source],
                    ]}
                  />
                </div>
              );
            })()}
          </div>
        </Panel>
      </div>
      <p className="mt-2 prose-note">
        Floors: {[...new Set(company.rooms.map((r) => floorName.get(r.floor_id ?? '') ?? r.floor_id))]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </>
  );
}

/**
 * Founder — the acting-capacity surface, and the most safety-critical panel here.
 *
 * It renders the UNKNOWN active hat NEXT TO the menu of candidate seats, never
 * instead of it. The architecture brief gives EXAMPLES of acting capacity; an
 * example is not a declaration. No canonical source records which hat is on, so
 * Command says so — and the reserved-authority list is rendered beside it so the
 * boundary is visible at the same moment as the gap.
 */
function FounderTab({ company }: { company: CompanyOsProjection }) {
  const f = company.founder;
  if (!f) {
    return (
      <Panel title="Founder acting capacity">
        <SourceGap reason="NO FOUNDER BLOCK DECLARED." detail="The registry declares no Founder record, so no acting capacity is shown and none is inferred." />
      </Panel>
    );
  }
  const seatById = new Map(company.seats.map((s) => [s.seat_id, s]));
  const activeSeat = f.current_acting_capacity ? seatById.get(f.current_acting_capacity) : null;

  return (
    <>
      <PeerWorkHeader
        peer="Founder"
        question="Who is exercising which seat, and what stays reserved regardless?"
      />
      <StatRail>
        <Stat k="Occupant" v={f.display_as ?? f.person_id ?? 'UNKNOWN'} tone="founder" sub="person, not a role" />
        <Stat
          k="Current acting capacity"
          v={f.current_acting_capacity_state === 'DECLARED' ? f.current_acting_capacity : 'UNKNOWN'}
          tone={f.current_acting_capacity_state === 'DECLARED' ? 'ok' : 'unknown'}
          sub={
            f.current_acting_capacity_state === 'DECLARED'
              ? 'declared in the registry'
              : 'not declared by any canonical source'
          }
        />
        <Stat
          k="Authority effect"
          v="NONE"
          tone="unknown"
          sub="acting capacity records WHICH seat, never HOW MUCH"
        />
        <Stat
          k="Reserved to Founder"
          v={f.reserved_to_founder.length}
          tone="founder"
          sub="not exercisable by any agent or surface"
        />
      </StatRail>

      <div className="command-split">
        <Panel title="Acting capacity" count={f.current_acting_capacity_state}>
          <div className="body">
            {/*
              THE HAT. Rendered as its own state, not as a person field.

              When it is UNKNOWN that is the honest reading, and the reason is
              printed rather than hidden — a reader must be able to tell "no hat
              declared" apart from "hat not displayed".
            */}
            <KV
              rows={[
                ['Person', f.display_as ?? f.person_id ?? 'UNKNOWN'],
                ['Room handles', f.room_handles.join(' · ')],
                ['Authority level', f.authority_level],
                ['Authority source', f.authority_level_source ?? 'UNKNOWN'],
                [
                  'CURRENT ACTING CAPACITY',
                  f.current_acting_capacity_state === 'DECLARED'
                    ? `${f.current_acting_capacity} — ${activeSeat?.seat_name ?? 'UNKNOWN SEAT'}`
                    : 'UNKNOWN — not declared',
                ],
                ['Acting capacity authority effect', f.acting_capacity_authority_effect],
              ]}
            />
            {f.current_acting_capacity_note ? (
              <p className="mt-2 prose-note">{f.current_acting_capacity_note}</p>
            ) : null}
            {f.handle_note ? <p className="mt-1 prose-note">{f.handle_note}</p> : null}

            <div className="mt-3">
              <div className="label-micro mb-1">
                Permanent capacities · a menu of hats, NOT an active one
              </div>
              <div className="flex flex-wrap gap-1">
                {f.permanent_capacities.map((cap) => (
                  <span
                    key={cap}
                    className="inline-block px-1.5 py-0.5 font-mono text-3xs border border-truth-founder/40 bg-truth-founder-soft text-truth-founder"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>

            {f.candidate_seats.length ? (
              <div className="mt-3">
                <div className="label-micro mb-1">
                  Seats that COULD be exercised · candidates, not active
                </div>
                <ul>
                  {f.candidate_seats.map((id) => {
                    const seat = seatById.get(id);
                    return (
                      <li key={id} className="font-mono text-2xs text-muted-foreground">
                        {seat?.seat_name ?? id} <span className="text-3xs">({id})</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1 prose-note">
                  A candidate seat is not a hat being worn. Nothing here is rendered as the Founder's
                  current capacity.
                </p>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Reserved to the Founder" count={`${f.reserved_to_founder.length} reserved`}>
          <div className="body">
            {/*
              Rendered beside the gap, not buried under it. The reserved list is a
              constraint on the SYSTEM: nothing in Command, Herdr, the Room or
              any delegated execution may exercise these.
            */}
            <ul>
              {f.reserved_to_founder.map((r) => (
                <li key={r} className="text-2xs mb-1">
                  · {r}
                </li>
              ))}
            </ul>
            {f.reserved_note ? <p className="mt-2 prose-note">{f.reserved_note}</p> : null}
            <p className="mt-2 prose-note">
              {company.authority_model.detail ?? ''}
            </p>
            {company.authority_model.builder_is_verifier ? (
              <p className="mt-2 duty-verdict" data-duty-state="RESERVED">
                {company.authority_model.builder_is_verifier}
              </p>
            ) : null}
          </div>
        </Panel>
      </div>
    </>
  );
}

/**
 * Infrastructure — the systems that are NOT staff.
 *
 * Jev is the reason this panel exists. It is genuinely useful, it genuinely
 * runs, and putting it anywhere near a headcount would be a category error the
 * Founder ruled against twice (seq 8479, seq 8481).
 */
function InfrastructureTab({ company }: { company: CompanyOsProjection }) {
  return (
    <>
      <PeerWorkHeader
        peer="Infrastructure"
        question="Which systems serve this company without being anyone in it?"
      />
      <FocusRail label="Infrastructure is not staff">
        <p>
          Command, Herdr and the Room are surfaces and systems, not people. Jev is retrieval and
          classification infrastructure — advisory only, never an authority source, and never counted
          as a seat or a headcount anywhere on this surface.
        </p>
      </FocusRail>
      <Panel title="Shared infrastructure" count={`${company.shared_infrastructure.length} systems`}>
        <div className="body">
          <div className="command-table-wrap scroll-hint">
            <table>
              <caption>Infrastructure · is_staff is false for every row and cannot be otherwise</caption>
              <thead>
                <tr>
                  <th style={{ width: '9rem' }}>System</th>
                  <th style={{ width: '12rem' }}>Kind</th>
                  <th style={{ width: '11rem' }}>Authority</th>
                  <th>Owns</th>
                </tr>
              </thead>
              <tbody>
                {company.shared_infrastructure.map((sys) => (
                  <tr key={sys.id}>
                    <td>
                      {sys.name}
                      <div className="font-mono text-3xs text-muted-foreground">
                        NOT STAFF · NOT A SEAT
                      </div>
                    </td>
                    <td className="text-2xs">{sys.kind}</td>
                    <td>
                      <Chip value={sys.authority} />
                    </td>
                    <td className="prose">
                      {sys.owns}
                      {sys.operating_order ? (
                        <span className="block mt-1 font-mono text-3xs text-muted-foreground">
                          ORDER: {sys.operating_order}
                        </span>
                      ) : null}
                      {sys.never_overrides.length ? (
                        <span className="block mt-1 font-mono text-3xs text-amber-400">
                          NEVER OVERRIDES: {sys.never_overrides.join(' · ')}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>
    </>
  );
}

/**
 * Registry conflicts — refused claims, stated rather than applied.
 *
 * A registry that can hand a seat authority by editing a JSON field would be
 * exactly the "authority created by tooling" the Founder ruled out. So when the
 * loader refuses a claim it says so HERE, naming the row, instead of quietly
 * dropping it.
 */
function CompanyOsConflicts({ company }: { company: CompanyOsProjection }) {
  if (!company.conflicts.length && !company.problems.length) return null;
  return (
    <Panel
      title="Registry conflicts and validation"
      count={`${company.conflicts.length} conflicts · ${company.problems.length} problems`}
    >
      <div className="body">
        {company.conflicts.map((c, i) => (
          <div key={`${c.kind}-${c.subject}-${i}`} className="mb-2">
            <span className="font-mono text-2xs text-amber-400">{c.kind}</span>
            <span className="font-mono text-2xs text-muted-foreground"> · {c.subject}</span>
            <p className="prose-note">{c.detail}</p>
            <p className="prose-note">{c.resolution}</p>
          </div>
        ))}
        {company.problems.map((p, i) => (
          <p key={i} className="prose-note text-amber-400">
            VALIDATION: {p}
          </p>
        ))}
      </div>
    </Panel>
  );
}

/**
 * CompanyOsSurface — one nav item, five tabs, the whole company.
 */
export function CompanyOsSurface({
  surface,
  tab = 'Structure',
}: {
  surface: CommandSurface;
  tab?: string;
}) {
  const company = surface.company_os;
  if (!company) {
    return (
      <div data-surface-signature="company-os-missing" className="room-root" data-room="company">
        <RoomHead mark="CO" title="Company OS" sub="Starq Technologies Pvt. Ltd. as a company" />
        <SourceGap
          reason="COMPANY OS PROJECTION ABSENT"
          detail="This build carries no company_os block. It is reported as absent rather than drawn as an empty company."
        />
      </div>
    );
  }
  if (!company.available) {
    return <CompanyOsUnavailable company={company} />;
  }

  return (
    <div data-surface-signature="company-os" className="room-root" data-room="company">
      <RoomHead
        mark="CO"
        title={company.company?.legal_name ?? 'Starq Technologies Pvt. Ltd.'}
        sub={`${company.company?.short_name ?? ''} as a company · Dev Studio is one floor of ${company.counts?.floors ?? '?'}`}
      />
      <CompanyOsRail company={company} />

      <div className="command-stack mt-3">
        {tab === 'Seats' ? <SeatsTab company={company} /> : null}
        {tab === 'Portfolio' ? <PortfolioTab company={company} /> : null}
        {tab === 'Founder' ? <FounderTab company={company} /> : null}
        {tab === 'Infrastructure' ? <InfrastructureTab company={company} /> : null}
        {tab !== 'Seats' && tab !== 'Portfolio' && tab !== 'Founder' && tab !== 'Infrastructure' ? (
          <StructureTab company={company} />
        ) : null}

        <CompanyOsConflicts company={company} />

        <AboutMethod title="How to read the Company OS">
          <p>
            Four objects stay four objects here. A <strong>seat</strong> is a durable organisational
            function. An <strong>occupant</strong> is whoever fills it. <strong>Acting capacity</strong>{' '}
            records which seat is being exercised right now. <strong>Delegation</strong> records who
            may execute beneath it. None of the four is a synonym for another, and this surface never
            renders them as one column.
          </p>
          <p className="mt-2">
            A seat grants no authority. Acting capacity grants no authority. Delegation grants no
            authority. No tooling creates authority, and no agent is an officer of this company by
            appearing on this surface. The only seat permitted to carry a grant is the Founder seat,
            and only when it cites the canonical registry that confers it.
          </p>
          <p className="mt-2">
            Structure is read from a declared machine-readable registry, never inferred from
            free-form prose. Where a value is not declared this surface says UNKNOWN — including the
            Founder's current acting capacity, which no canonical source records. Dormant rooms are
            rendered in place with their activation and entity gates rather than hidden.
          </p>
          <p className="mt-2">
            The human-readable governance source remains authoritative. This registry is its
            projection; where the two disagree, the governance text wins and the registry is drift.
          </p>
        </AboutMethod>
      </div>
    </div>
  );
}
