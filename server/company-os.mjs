/**
 * STARQ // COMMAND — Company OS seat registry loader. READ-ONLY BY CONSTRUCTION.
 *
 * WHAT THIS MODULE IS FOR
 *
 * The skyscraper brief (seq 8486/8487) requires Command to represent Starq
 * Technologies Pvt. Ltd. AS A COMPANY: seven floors, the Dev Studio project
 * rooms, Starq Dynamics, R&D, future entities, company seats, and a Founder
 * acting-capacity surface. The human-readable governance source stays
 * authoritative; this reads the machine-readable projection of it and refuses to
 * be anything more.
 *
 * THE FOUR OBJECTS STAY FOUR OBJECTS
 *
 * AG's contract (seq 8488) and the brief both insist that Seat, Occupant, Acting
 * Capacity and Delegation are four DISTINCT concepts. Collapsing any pair of them
 * is the specific failure this module exists to prevent:
 *
 *   - collapsing Seat into Occupant is what makes a company look like one person;
 *   - collapsing Acting Capacity into Occupant is what makes a role change look
 *     like an identity change, and what lets a hat silently widen authority;
 *   - collapsing Delegation into Seat is what turns delegated execution into a
 *     corporate officer.
 *
 * So they are four separate shapes here, they are never merged, and the payload
 * carries a count proving they are distinct.
 *
 * AUTHORITY IS NEVER MANUFACTURED HERE
 *
 * Three structural rules, each of which is a property of this loader rather than
 * a convention a future editor could quietly drop:
 *
 *   1. NO PROSE IS EXECUTABLE AUTHORITY. Every value is read from a declared
 *      field. Nothing is parsed out of `starq governance.txt` or the brief at
 *      runtime, so there is no sentence that can become a permission.
 *   2. A SEAT GRANTS NO AUTHORITY. `authority_granted` is forwarded from the
 *      registry, and this loader asserts that no non-Founder seat carries one.
 *      A seat that arrives claiming authority is reported as a CONFLICT, not
 *      honoured.
 *   3. ACTING CAPACITY GRANTS NO AUTHORITY. It records WHICH seat an occupant is
 *      exercising. It never widens what they may decide, and the payload says so
 *      in a field the renderer cannot drop.
 *
 * JEV IS NOT STAFF
 *
 * Shared infrastructure is carried as its own collection with `is_staff: false`
 * and never counted as a seat. An advisory retrieval utility that appeared in a
 * headcount would be a category error the Founder has explicitly ruled against
 * (seq 8479, seq 8481).
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 *   - No live model, provider, PID or process state. That is Herdr's, joined at
 *     render time by the existing staff surface.
 *   - No health, staging, capacity or usage numbers. Capacity class per seat is
 *     declared in the staff profile and is not restated here.
 *   - No ranking, scoring, maturity or percentage. This is a structure, not a
 *     scoreboard.
 *   - No write capability of any kind. readFileSync is the only syscall used.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Vocabulary kept literal so an unrecognised value is visible, never coerced. */
export const ROOM_STATE = Object.freeze({
  ACTIVE: 'ACTIVE',
  FUTURE_DORMANT: 'FUTURE_DORMANT',
  UNKNOWN: 'UNKNOWN',
});

export const SEAT_STATE = Object.freeze({
  OCCUPIED_FOUNDER: 'OCCUPIED_FOUNDER',
  OCCUPIED_HUMAN: 'OCCUPIED_HUMAN',
  DELEGATED_AI: 'DELEGATED_AI',
  VACANT_UNFILLED: 'VACANT_UNFILLED',
  FUTURE_DORMANT: 'FUTURE_DORMANT',
  UNKNOWN: 'UNKNOWN',
});

/** The only authority level a seat may carry, and only with a declared source. */
const ROOT_GENESIS = 'ROOT_GENESIS';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function strArray(v) {
  return Array.isArray(v) ? v.filter(isNonEmptyString) : [];
}

/**
 * Load and validate the company seat registry.
 *
 * Returns a shape where `available: false` NEVER collapses into "a company with
 * no floors". An unreadable registry reports UNAVAILABLE with its reason, and the
 * renderer says so — because a company surface that renders an empty building
 * when its source is missing is worse than one that admits it cannot see the
 * building.
 *
 * `problems` is carried, not thrown. A malformed entry is surfaced as a
 * CONFLICT against the specific id so the operator knows which row to fix, and
 * the valid remainder still renders.
 */
export function loadCompanyOs(workspaceRoot, relativePath) {
  const unavailable = (reason, extra = {}) => ({
    available: false,
    state: 'UNAVAILABLE',
    reason,
    path: relativePath,
    authority: 'UNAVAILABLE',
    is_ssot: false,
    company: null,
    floors: [],
    rooms: [],
    seats: [],
    shared_infrastructure: [],
    founder: null,
    counts: null,
    problems: [],
    conflicts: [],
    ...extra,
  });

  if (!workspaceRoot) {
    return unavailable('workspace root unresolved');
  }

  let raw;
  try {
    raw = fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8');
  } catch (err) {
    return unavailable(
      err.code === 'ENOENT'
        ? 'company seat registry not found on disk'
        : `company seat registry could not be read: ${err.message}`,
    );
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return unavailable(`company seat registry is not valid JSON: ${err.message}`);
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return unavailable('company seat registry is not an object');
  }

  const problems = [];
  const conflicts = [];

  /*
    Every validation message NAMES the offending row.

    A problem reported as `rooms[12]` sends an operator to the array to count
    entries; a problem reported as `rooms[12] (devstudio-09-mystery)` sends them
    straight to it. The second is the only one worth acting on, and an
    unactionable validation message is a validation message that gets ignored.
  */

  // ── Company ───────────────────────────────────────────────────────────────
  const company = doc.company && typeof doc.company === 'object' ? doc.company : null;
  if (!company || !isNonEmptyString(company.company_id)) {
    problems.push('company.company_id is required');
  }

  // ── Floors ────────────────────────────────────────────────────────────────
  const floorRows = Array.isArray(doc.floors) ? doc.floors : [];
  if (floorRows.length === 0) problems.push('floors must not be empty');

  const floors = [];
  const seenFloorIds = new Set();
  floorRows.forEach((f, i) => {
    if (!f || typeof f !== 'object' || !isNonEmptyString(f.id)) {
      problems.push(`floors[${i}] must be an object with a string id`);
      return;
    }
    if (seenFloorIds.has(f.id)) {
      problems.push(`duplicate floor id ${JSON.stringify(f.id)}`);
      return;
    }
    seenFloorIds.add(f.id);
    if (!Number.isInteger(f.ordinal)) {
      problems.push(`floors[${i}] (${f.id}) ordinal must be an integer`);
    }
    if (!ROOM_STATE[f.state ?? 'UNKNOWN']) {
      problems.push(`floors[${i}] (${f.id}) state ${JSON.stringify(f.state)} is not a declared room state`);
    }
    floors.push({
      id: f.id,
      ordinal: f.ordinal ?? null,
      name: f.name ?? f.id,
      purpose: f.purpose ?? null,
      state: f.state ?? ROOM_STATE.UNKNOWN,
      division_type: f.division_type ?? null,
      // A floor that claims to be a corporate-officer surface is a governance
      // defect, not a configuration choice, and is reported as a conflict.
      is_corporate_officer_surface: f.is_corporate_officer_surface === true,
      above_operating_company: f.above_operating_company === true,
      note: f.note ?? null,
    });
  });

  // ── Rooms ─────────────────────────────────────────────────────────────────
  const roomRows = Array.isArray(doc.rooms) ? doc.rooms : [];
  const rooms = [];
  const seenRoomIds = new Set();
  roomRows.forEach((r, i) => {
    if (!r || typeof r !== 'object' || !isNonEmptyString(r.id)) {
      problems.push(`rooms[${i}] must be an object with a string id`);
      return;
    }
    if (seenRoomIds.has(r.id)) {
      problems.push(`duplicate room id ${JSON.stringify(r.id)}`);
      return;
    }
    seenRoomIds.add(r.id);
    if (!ROOM_STATE[r.state ?? 'UNKNOWN']) {
      problems.push(`rooms[${i}] (${r.id}) state ${JSON.stringify(r.state)} is not a declared room state`);
    }
    if (r.floor_id && !seenFloorIds.has(r.floor_id)) {
      problems.push(`rooms[${i}] (${r.id}) floor_id ${JSON.stringify(r.floor_id)} names no declared floor`);
    }
    // A dormant room with no activation condition is an un-openable room, which
    // is almost certainly a mistake in the registry rather than an intention.
    const dormant = r.state === ROOM_STATE.FUTURE_DORMANT;
    const conditions = strArray(r.activation_conditions);
    if (dormant && conditions.length === 0) {
      problems.push(`rooms[${i}] (${r.id}) is FUTURE_DORMANT with no declared activation condition`);
    }
    if (r.entity_gate && r.entity_gate_state === undefined) {
      problems.push(`rooms[${i}] (${r.id}) declares an entity_gate with no entity_gate_state`);
    }
    rooms.push({
      id: r.id,
      floor_id: r.floor_id ?? null,
      ordinal: r.ordinal ?? null,
      name: r.name ?? r.id,
      state: r.state ?? ROOM_STATE.UNKNOWN,
      state_label: r.state_label ?? null,
      purpose: r.purpose ?? null,
      future_entity: r.future_entity === true,
      activation_conditions: conditions,
      entity_gate: r.entity_gate ?? null,
      entity_gate_state: r.entity_gate_state ?? null,
      boundary: r.boundary ?? null,
      note: r.note ?? null,
    });
  });

  // ── Seats ─────────────────────────────────────────────────────────────────
  const seatRows = Array.isArray(doc.seats) ? doc.seats : [];
  const seats = [];
  const seenSeatIds = new Set();
  seatRows.forEach((s, i) => {
    if (!s || typeof s !== 'object' || !isNonEmptyString(s.seat_id)) {
      problems.push(`seats[${i}] must be an object with a string seat_id`);
      return;
    }
    if (seenSeatIds.has(s.seat_id)) {
      problems.push(`duplicate seat id ${JSON.stringify(s.seat_id)}`);
      return;
    }
    seenSeatIds.add(s.seat_id);
    if (!SEAT_STATE[s.seat_state ?? 'UNKNOWN']) {
      problems.push(`seats[${i}] (${s.seat_id}) seat_state ${JSON.stringify(s.seat_state)} is not a declared seat state`);
    }
    if (s.floor_id && !seenFloorIds.has(s.floor_id)) {
      problems.push(`seats[${i}] (${s.seat_id}) floor_id ${JSON.stringify(s.floor_id)} names no declared floor`);
    }
    if (s.room_id && !seenRoomIds.has(s.room_id)) {
      problems.push(`seats[${i}] (${s.seat_id}) room_id ${JSON.stringify(s.room_id)} names no declared room`);
    }

    const granted = strArray(s.authority_granted);

    /*
      RULE 2, ENFORCED: a seat grants no authority.

      The one legitimate exception is the Founder seat, and only when the grant
      names a canonical authority level AND cites the canonical source that
      confers it. Anything else claiming authority is a governance defect. It is
      reported as a CONFLICT and the grant is NOT carried forward — a registry
      that can hand a seat power by editing a JSON field would be exactly the
      "authority created by tooling" the Founder ruled out.
    */
    const founderSeat = s.seat_state === SEAT_STATE.OCCUPIED_FOUNDER;
    const citesCanonicalSource = isNonEmptyString(s.authority_granted_source);
    let effectiveAuthority = [];
    if (granted.length > 0) {
      if (founderSeat && granted.includes(ROOT_GENESIS) && citesCanonicalSource) {
        effectiveAuthority = granted;
      } else {
        effectiveAuthority = [];
        conflicts.push({
          kind: 'SEAT_CLAIMS_UNSUPPORTED_AUTHORITY',
          subject: s.seat_id,
          detail:
            `seat_state ${JSON.stringify(s.seat_state)} claims authority ${JSON.stringify(granted)} `
            + `without being a Founder seat citing a canonical authority source.`,
          resolution:
            'REFUSED AND REPORTED — a seat grants no authority. The claim is not carried into the surface, and the registry row is named so it can be corrected at source.',
        });
      }
    }

    // Occupancy coherence: a seat may not claim an occupant it does not have.
    let occupant = s.occupant_id ?? null;
    if (s.seat_state === SEAT_STATE.VACANT_UNFILLED && occupant) {
      conflicts.push({
        kind: 'OCCUPANT_STATE_INCOHERENT',
        subject: s.seat_id,
        detail: 'seat_state is VACANT_UNFILLED but the registry declares an occupant_id.',
        resolution: 'OCCUPANT FORWARDED AS DECLARED — the contradiction is reported, not silently repaired.',
      });
    }
    if (s.seat_state === SEAT_STATE.OCCUPIED_FOUNDER && !occupant) {
      conflicts.push({
        kind: 'OCCUPANT_STATE_INCOHERENT',
        subject: s.seat_id,
        detail: 'seat_state is OCCUPIED_FOUNDER but the registry declares no occupant_id.',
        resolution: 'REPORTED — an occupied seat with no occupant is not rendered as occupied.',
      });
    }

    seats.push({
      seat_id: s.seat_id,
      seat_name: s.seat_name ?? s.seat_id,
      floor_id: s.floor_id ?? null,
      room_id: s.room_id ?? null,
      organizational_area: s.organizational_area ?? null,
      business_activity: s.business_activity ?? null,

      // ── OBJECT 1: the seat (a durable function) ──────────────────────────
      seat_state: s.seat_state ?? SEAT_STATE.UNKNOWN,

      // ── OBJECT 2: the occupant (who fills it) ───────────────────────────
      occupant_id: occupant,
      occupant_type: occupant ? (s.occupant_type ?? 'UNKNOWN') : 'NONE',
      occupant_coherent:
        !(s.seat_state === SEAT_STATE.OCCUPIED_FOUNDER && !occupant) &&
        !(s.seat_state === SEAT_STATE.VACANT_UNFILLED && occupant),

      // ── OBJECT 3: acting capacity (which seat is being exercised) ───────
      // A CANDIDATE is a seat that COULD be exercised. It is emphatically not
      // an active hat, and the two are never rendered in the same field.
      current_acting_status: s.current_acting_status ?? 'NOT_DECLARED',
      acting_capacity_candidate: s.acting_capacity_candidate === true,
      acting_capacity_authority_effect: 'NONE',

      // ── OBJECT 4: delegation (who may execute beneath) ──────────────────
      delegations: strArray(s.delegations),
      delegation_note: s.delegation_note ?? null,

      authority_granted: effectiveAuthority,
      authority_granted_declared: granted,
      authority_reserved: strArray(s.authority_reserved),
      authority_source: s.authority_granted_source ?? null,
      scope: s.scope ?? null,
      source_reference: s.source_reference ?? null,
      note: s.note ?? null,
    });
  });

  // ── Shared infrastructure (never staff, never a seat) ─────────────────────
  const infraRows = Array.isArray(doc.shared_infrastructure) ? doc.shared_infrastructure : [];
  const shared_infrastructure = infraRows.map((i, idx) => {
    if (!i || typeof i !== 'object') {
      problems.push(`shared_infrastructure[${idx}] must be an object`);
      return null;
    }
    // An infrastructure entry that declares itself staff would corrupt every
    // headcount on the floor. Refused, not rendered.
    if (i.is_staff === true || i.is_seat === true) {
      conflicts.push({
        kind: 'INFRASTRUCTURE_CLAIMS_TO_BE_STAFF',
        subject: i.id ?? `shared_infrastructure[${idx}]`,
        detail: 'A shared-infrastructure entry declares is_staff or is_seat.',
        resolution:
          'REFUSED AND REPORTED — infrastructure is not staff. It is excluded from every seat count regardless of what the registry claims.',
      });
      return null;
    }
    return {
      id: i.id ?? `infrastructure-${idx}`,
      name: i.name ?? i.id ?? 'UNKNOWN',
      kind: i.kind ?? 'UNKNOWN',
      is_staff: false,
      is_seat: false,
      owns: i.owns ?? null,
      authority: i.authority ?? 'UNKNOWN',
      operating_order: i.operating_order ?? null,
      never_overrides: strArray(i.never_overrides),
      note: i.note ?? null,
      source: i.source ?? null,
    };
  }).filter(Boolean);

  // ── Founder + acting capacity ─────────────────────────────────────────────
  const f = doc.founder && typeof doc.founder === 'object' ? doc.founder : null;
  let founder = null;
  if (!f) {
    problems.push('founder block is required');
  } else {
    const handles = strArray(f.room_handles);
    const declaredActing = f.current_acting_capacity ?? null;

    /*
      RULE 3, ENFORCED: acting capacity grants no authority, and an undeclared
      one is UNKNOWN.

      The architecture brief (section 13) gives EXAMPLES of acting capacity. An
      example is not a declaration. If the registry does not name a current
      acting capacity, this reports UNKNOWN — it does not pick the first
      candidate, does not fall back to "Founder", and does not let a seat that is
      a candidate render as though it were being exercised.

      A declared value that does not name a real seat is a CONFLICT, because a
      hat that names nothing is not a hat.
    */
    let actingState = f.current_acting_capacity_state ?? 'UNKNOWN';
    if (declaredActing === null || !isNonEmptyString(declaredActing)) {
      actingState = 'UNKNOWN';
    } else if (declaredActing === ROOT_GENESIS) {
      conflicts.push({
        kind: 'ACTING_CAPACITY_AMBIGUOUS',
        subject: f.person_id ?? 'founder',
        detail:
          'current_acting_capacity names the authority level rather than a SEAT. '
          + 'Acting capacity records which seat is being exercised, not how much authority the occupant has.',
        resolution: 'REPORTED AND NOT RENDERED AS AN ACTIVE HAT — a capacity must name a seat_id.',
      });
      actingState = 'CONFLICT';
    } else if (!seenSeatIds.has(declaredActing)) {
      conflicts.push({
        kind: 'ACTING_CAPACITY_UNKNOWN_SEAT',
        subject: f.person_id ?? 'founder',
        detail: `current_acting_capacity ${JSON.stringify(declaredActing)} names no declared seat_id.`,
        resolution: 'REPORTED AND NOT RENDERED AS AN ACTIVE HAT.',
      });
      actingState = 'CONFLICT';
    }

    founder = {
      person_id: f.person_id ?? null,
      display_as: f.display_as ?? null,
      room_handles: handles,
      handle_note: f.handle_note ?? null,
      authority_level: f.authority_level ?? 'UNKNOWN',
      authority_level_source: f.authority_level_source ?? null,
      permanent_capacities: strArray(f.permanent_capacities),
      current_acting_capacity: actingState === 'UNKNOWN' || actingState === 'CONFLICT' ? null : declaredActing,
      current_acting_capacity_state: actingState,
      current_acting_capacity_note: f.current_acting_capacity_note ?? null,
      acting_capacity_authority_effect: f.acting_capacity_authority_effect ?? 'NONE',
      reserved_to_founder: strArray(f.reserved_to_founder),
      reserved_note: f.reserved_note ?? null,
      // Every seat the Founder could be exercising. A MENU, not an active hat.
      candidate_seats: seats.filter((s) => s.acting_capacity_candidate).map((s) => s.seat_id),
    };
  }

  const authorityModel = doc.authority_model ?? {};

  /*
    Declared once, measured twice. The counts and the separation flags below read
    the SAME sets, so a count and a flag can never disagree about the same
    population — which is the only way two numbers on one screen stay honest.
  */
  const distinctSeatIds = new Set(seats.map((s) => s.seat_id));
  const distinctOccupants = new Set(seats.map((s) => s.occupant_id).filter(Boolean));

  return {
    available: true,
    state: 'OK',
    path: relativePath,
    authority: doc.authority ?? 'UNKNOWN',
    is_ssot: doc.is_ssot !== false,
    ssot_note: doc.ssot_note ?? null,
    provenance: doc.provenance ?? null,
    version: doc.version ?? 'UNKNOWN',

    authority_model: {
      rule: authorityModel.rule ?? null,
      authority_binds_to: authorityModel.authority_binds_to ?? null,
      seat_grants_authority: false,
      acting_capacity_grants_authority: false,
      delegation_grants_authority: false,
      tooling_creates_authority: false,
      detail: authorityModel.detail ?? null,
      builder_is_verifier: authorityModel.builder_is_verifier ?? null,
    },
    prose_is_not_authority: doc.prose_is_not_authority ?? null,

    company: company
      ? {
          company_id: company.company_id,
          legal_name: company.legal_name ?? company.company_id,
          short_name: company.short_name ?? company.company_id,
          entity_type: company.entity_type ?? 'UNKNOWN',
          incorporation_state: company.incorporation_state ?? 'UNKNOWN',
          incorporation_note: company.incorporation_note ?? null,
          primary_occupant: company.primary_occupant ?? null,
          structure_note: company.structure_note ?? null,
        }
      : null,

    floors,
    rooms,
    seats,
    shared_infrastructure,
    founder,
    seat_states: doc.seat_states ?? {},

    counts: {
      floors: floors.length,
      floors_active: floors.filter((x) => x.state === ROOM_STATE.ACTIVE).length,
      rooms: rooms.length,
      rooms_active: rooms.filter((x) => x.state === ROOM_STATE.ACTIVE).length,
      rooms_dormant: rooms.filter((x) => x.state === ROOM_STATE.FUTURE_DORMANT).length,
      devstudio_rooms: rooms.filter((x) => x.floor_id === 'devstudio').length,
      devstudio_rooms_dormant: rooms.filter(
        (x) => x.floor_id === 'devstudio' && x.state === ROOM_STATE.FUTURE_DORMANT,
      ).length,
      seats: seats.length,
      seats_occupied_founder: seats.filter((x) => x.seat_state === SEAT_STATE.OCCUPIED_FOUNDER).length,
      seats_vacant: seats.filter((x) => x.seat_state === SEAT_STATE.VACANT_UNFILLED).length,
      seats_dormant: seats.filter((x) => x.seat_state === SEAT_STATE.FUTURE_DORMANT).length,
      seats_with_delegation: seats.filter((x) => x.delegations.length > 0).length,
      seats_claiming_authority: seats.filter((x) => x.authority_granted.length > 0).length,
      infrastructure: shared_infrastructure.length,
      infrastructure_claiming_staff: 0,
      distinct_occupants: distinctOccupants.size,
    },

    /*
      The four objects, proven distinct. A company where these collapse into one
      another is the failure this whole model exists to prevent, so the payload
      carries the evidence rather than asserting the principle in a comment.

      Every flag below is a MEASUREMENT over the loaded registry. If one ever
      reads false, the surface is showing a collapsed model, and the reader is
      told rather than left to assume the principle still holds.
    */
    separation: {
      objects: ['seat', 'occupant', 'acting_capacity', 'delegation'],
      seat_ids_unique: distinctSeatIds.size === seats.length,
      // More seats than occupants is the POSITIVE evidence that a SEAT is not
      // an OCCUPANT. If these were equal, every seat would be its own occupant
      // and the company would be indistinguishable from a headcount.
      seat_is_not_occupant: distinctSeatIds.size > distinctOccupants.size,
      seats_per_occupant: distinctOccupants.size
        ? Number((seats.length / distinctOccupants.size).toFixed(2))
        : null,
      // Acting capacity, when declared, must be a REFERENCE to a real seat and
      // never a second copy of the occupant's identity.
      acting_capacity_is_a_seat_reference:
        founder?.current_acting_capacity_state === 'UNKNOWN' ||
        founder?.current_acting_capacity_state === 'CONFLICT' ||
        (isNonEmptyString(founder?.current_acting_capacity) &&
          distinctSeatIds.has(founder.current_acting_capacity)),
      // Delegation names EXECUTION beneath a seat. A delegation equal to its own
      // seat id would mean the seat executes itself - the officer error.
      delegation_is_not_the_seat: seats.every((s) => !s.delegations.includes(s.seat_id)),
      // No agent occupies a company seat. Occupants are PERSON, NONE or an
      // explicitly UNKNOWN value the renderer must not dress up as a person.
      no_agent_occupies_a_seat: seats.every(
        (s) =>
          s.occupant_type === 'PERSON' ||
          s.occupant_type === 'NONE' ||
          s.occupant_type === 'UNKNOWN',
      ),
      infrastructure_counted_as_staff: false,
      note:
        'Many seats, one occupant: that is a company, not a one-person org. The separation is measured, not asserted.',
    },

    problems,
    conflicts,
  };
}
