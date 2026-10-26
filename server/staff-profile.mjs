/**
 * THE CANONICAL DEV STUDIO STAFF PROFILE — slow-moving seat metadata, one file.
 *
 * WHY THIS FILE EXISTS
 *
 * Founder directive (Room seq 8473, recon'd by Elder at seq 8474, build
 * authorised at seq 8475): the Starq Command main staff surface must represent
 * the real 10-seat Dev Studio roster, and must be able to say, per seat:
 *
 *   · provider / owner
 *   · product / client
 *   · capacity class (paid L1 vs free / offload)
 *   · normal host / runtime
 *   · role family (builder vs verifier)
 *
 * Those five facts are NOT derivable from any canonical source on disk. No
 * identity record carries a provider, a product, a cost class or a host. They
 * are DECLARED commercial and staffing facts, so they are declared here, once,
 * in one place, and nothing else in Command is allowed to hold a second copy.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN
 *
 *   · No live model. Founder recorded for OpenCode / Pi / Goose that "live
 *     model/provider may vary", and no harness on this floor exposes a uniform
 *     live-model signal. A declared model string here would be a second SSOT
 *     that silently drifts the moment a session changes provider, so the field
 *     does not exist. UNKNOWN is honest; a stale string is not.
 *   · No usage, quota or reset. There is no uniform provider API behind these
 *     seats. `staff-state.json` carries Founder-updated capacity notes and those
 *     are still the place usage is recorded; Command forwards them and does not
 *     synthesise a meter beside them.
 *   · No live PID, online state, launch policy or turn holder. Those are
 *     observed at runtime and are joined from Herdr, the Room ledger and the
 *     identity leases. Nothing in this file may ever hold one.
 *
 * WHAT IT REPLACES
 *
 * `src/schemas/seat-registry.ts` (`CANONICAL_STARQ_FLEET`) held a parallel,
 * unwired roster that contradicted this one — stale models, Vision and Deadpool
 * tagged as paid Google L1/L2 seats when they are Nous free offload seats,
 * Cursor at the wrong tier, and Copilot absent entirely. It is marked
 * superseded and is not consulted by the staff surface. See STAFF_PROFILE_AUTHORITY.
 */

/**
 * The two capacity classes, kept literal so an unrecognised value is visible
 * rather than silently rendered as "free".
 *
 * `PAID_L1` and `FREE_SUPPORT` are the Founder's own split from seq 8473 —
 * "Paid L1 seats" (Elder, Codex, Antigravity, Cursor, Copilot) against "Free /
 * offload seats" (Vision, Deadpool, OpenCode, Pi, Goose). This is a DECLARED
 * commercial classification, not a measurement: no signal on this floor
 * distinguishes a paid seat from a free one, so the axis is declared and it says
 * so.
 */
export const CAPACITY_CLASS = Object.freeze({
  PAID_L1: 'PAID_L1',
  FREE_SUPPORT: 'FREE_SUPPORT',
  UNKNOWN: 'UNKNOWN',
});

/** Normal host / runtime. Declared as the NORMAL home, not as a live reading. */
export const NORMAL_HOST = Object.freeze({
  WINDOWS: 'WINDOWS',
  WSL: 'WSL',
  UNKNOWN: 'UNKNOWN',
});

/** Role family. Mirrors the builder/verifier separation the floor enforces. */
export const ROLE_FAMILY = Object.freeze({
  BUILDER: 'BUILDER',
  VERIFIER: 'VERIFIER',
  BUILDER_VERIFIER: 'BUILDER_VERIFIER',
  BUILDER_VERIFIER_SUPPORT: 'BUILDER_VERIFIER_SUPPORT',
  UNKNOWN: 'UNKNOWN',
});

/**
 * The ten canonical Dev Studio seats.
 *
 * `handle` is the ROOM/identity handle — the key every other canonical source
 * is joined on. It is deliberately not the Herdr seat id: Elder is `claude` in
 * the Room and `elder` in the Herdr manifest, and conflating the two is how a
 * roster ends up unable to find its own people. `herdr_seat_id` carries the
 * manifest id, and it is `null` where the manifest declares no row for the seat
 * — an absent join is reported, never faked.
 *
 * Order is the Founder's own roster order from seq 8473, paid seats first.
 */
export const STAFF_PROFILE = Object.freeze(
  [
    {
      handle: 'claude',
      seat_label: 'Elder',
      herdr_seat_id: 'elder',
      provider_owner: 'Anthropic',
      product_client: 'Claude / Claude Code CLI',
      capacity_class: CAPACITY_CLASS.PAID_L1,
      normal_host: NORMAL_HOST.WSL,
      harness: 'Claude Code CLI',
      role_family: ROLE_FAMILY.BUILDER_VERIFIER,
    },
    {
      handle: 'codex',
      seat_label: 'Codex',
      herdr_seat_id: 'codex',
      provider_owner: 'OpenAI',
      product_client: 'Codex CLI',
      capacity_class: CAPACITY_CLASS.PAID_L1,
      normal_host: NORMAL_HOST.WINDOWS,
      harness: 'Codex CLI',
      role_family: ROLE_FAMILY.BUILDER,
    },
    {
      handle: 'antigravity',
      seat_label: 'Antigravity',
      herdr_seat_id: 'antigravity',
      provider_owner: 'Google',
      product_client: 'Gemini / Antigravity',
      capacity_class: CAPACITY_CLASS.PAID_L1,
      normal_host: NORMAL_HOST.WINDOWS,
      harness: 'Antigravity / AGY',
      role_family: ROLE_FAMILY.BUILDER_VERIFIER,
    },
    {
      handle: 'cursor',
      seat_label: 'Cursor',
      herdr_seat_id: 'cursor',
      provider_owner: 'SpaceX',
      product_client: 'Cursor / SpaceXAI stack',
      capacity_class: CAPACITY_CLASS.PAID_L1,
      normal_host: NORMAL_HOST.WINDOWS,
      harness: 'Cursor',
      role_family: ROLE_FAMILY.BUILDER,
    },
    {
      handle: 'copilot',
      seat_label: 'Copilot',
      // No row exists in the Herdr manifest for this seat. The join reports the
      // absence; it does not manufacture a seat id.
      herdr_seat_id: null,
      provider_owner: 'GitHub / Microsoft',
      product_client: 'VS Code Copilot + Copilot CLI',
      capacity_class: CAPACITY_CLASS.PAID_L1,
      normal_host: NORMAL_HOST.WINDOWS,
      harness: 'VS Code Copilot + Copilot CLI',
      role_family: ROLE_FAMILY.BUILDER,
    },
    {
      handle: 'vision',
      seat_label: 'Vision',
      herdr_seat_id: 'vision',
      provider_owner: 'Nous Research',
      product_client: 'Hermes Agent (vision profile)',
      capacity_class: CAPACITY_CLASS.FREE_SUPPORT,
      normal_host: NORMAL_HOST.WINDOWS,
      harness: 'Hermes Agent',
      role_family: ROLE_FAMILY.VERIFIER,
    },
    {
      handle: 'deadpool',
      seat_label: 'Deadpool',
      herdr_seat_id: 'deadpool',
      provider_owner: 'Nous Research',
      product_client: 'Hermes Agent (deadpool profile)',
      capacity_class: CAPACITY_CLASS.FREE_SUPPORT,
      normal_host: NORMAL_HOST.WSL,
      harness: 'Hermes Agent',
      role_family: ROLE_FAMILY.BUILDER,
    },
    {
      handle: 'opencode',
      seat_label: 'OpenCode',
      // The Herdr manifest declares no OpenCode row.
      herdr_seat_id: null,
      provider_owner: 'VARIES BY SESSION',
      product_client: 'OpenCode CLI',
      capacity_class: CAPACITY_CLASS.FREE_SUPPORT,
      normal_host: NORMAL_HOST.WINDOWS,
      harness: 'OpenCode CLI',
      role_family: ROLE_FAMILY.BUILDER_VERIFIER,
    },
    {
      handle: 'pi',
      seat_label: 'Pi',
      herdr_seat_id: 'pi',
      provider_owner: 'VARIES BY SESSION',
      product_client: 'Pi agent / runtime',
      capacity_class: CAPACITY_CLASS.FREE_SUPPORT,
      normal_host: NORMAL_HOST.WINDOWS,
      harness: 'Pi agent / runtime',
      role_family: ROLE_FAMILY.BUILDER,
    },
    {
      handle: 'goose',
      seat_label: 'Goose',
      herdr_seat_id: 'goose',
      provider_owner: 'VARIES BY SESSION',
      product_client: 'Goose agent / runtime',
      capacity_class: CAPACITY_CLASS.FREE_SUPPORT,
      normal_host: NORMAL_HOST.WINDOWS,
      harness: 'Goose agent / runtime',
      role_family: ROLE_FAMILY.BUILDER,
    },
  ].map(Object.freeze),
);

/** Handle → profile entry. Frozen so no caller can grow the roster at runtime. */
const BY_HANDLE = Object.freeze(
  Object.fromEntries(STAFF_PROFILE.map((seat) => [seat.handle, seat])),
);

/** The canonical handles, in declared order. */
export const CANONICAL_STAFF_HANDLES = Object.freeze(STAFF_PROFILE.map((s) => s.handle));

/** Is this handle one of the ten canonical Dev Studio seats? */
export function isCanonicalStaffHandle(handle) {
  return Object.hasOwn(BY_HANDLE, handle);
}

/** The declared profile for a handle, or `null` when the handle is not a seat. */
export function staffProfileFor(handle) {
  return BY_HANDLE[handle] ?? null;
}

/**
 * Why a handle is absent from the canonical ten, stated rather than implied.
 *
 * A suppression reason is required because "this person is not shown" and "this
 * row was lost" must never look the same to a reader. Every non-canonical handle
 * gets one of these reasons and the count travels with the payload.
 */
export const SUPPRESSION_REASON = Object.freeze({
  FOUNDER:
    'FOUNDER / MISSION CONTROL — not a Dev Studio staff seat. The Founder sits above this roster, not absent from it.',
  RETIRED: 'RETIRED IDENTITY — canonical registry records this handle as retired',
  HISTORICAL: 'HISTORICAL / GHOST IDENTITY — not one of the canonical Dev Studio seats',
  UNDECLARED: 'UNDECLARED IDENTITY — no canonical Dev Studio seat profile covers this handle',
  SYSTEM: 'SYSTEM PARTICIPANT — a machine participant on the bus, not a staff seat',
});

/** Authority level the identity registry gives the Founder. */
const FOUNDER_AUTHORITY_LEVEL = 'ROOT_GENESIS';

/**
 * Decide whether a roster row belongs on the main staff surface, and say why.
 *
 * Order matters, and getting it wrong is not cosmetic.
 *
 * The Founder check comes FIRST because the Founder handle (`ali`, `mustarq`) is
 * observed in the Room ledger, is not one of the ten seats, and would otherwise
 * fall through to the generic "historical / ghost" reason. Labelling the Founder
 * a ghost identity is not a rounding error — it asserts that the person who owns
 * the floor used to be on it and no longer is. The Founder is above the roster,
 * which is a different statement, so it gets its own reason and is checked
 * before anything else.
 *
 * A machine participant is likewise suppressed as a SYSTEM row rather than a
 * ghost, because a `SYSTEM` classification is a different fault from a stale
 * handle and would be fixed differently.
 *
 * Never called with anything but a canonical roster row, so it cannot invent a
 * suppression for a handle that was never observed.
 */
export function suppressionReasonFor({ handle, isCanonicalSeat, isRetired, isSystem, authorityLevel }) {
  if (isCanonicalSeat) return null;
  if (authorityLevel === FOUNDER_AUTHORITY_LEVEL) return SUPPRESSION_REASON.FOUNDER;
  if (isRetired) return SUPPRESSION_REASON.RETIRED;
  if (isSystem) return SUPPRESSION_REASON.SYSTEM;
  return SUPPRESSION_REASON.HISTORICAL;
}

/**
 * Provenance and the limits of this file. Travels into the surface payload so a
 * reader can see what the profile is and, more importantly, what it is not.
 */
export const STAFF_PROFILE_AUTHORITY = Object.freeze({
  name: 'CANONICAL_DEV_STUDIO_STAFF_PROFILE',
  authority: 'DECLARED_SEAT_METADATA',
  is_ssot_for_live_state: false,
  source: 'Founder Room seq 8473 roster (recon seq 8474, build authorised seq 8475)',
  supersedes: 'src/schemas/seat-registry.ts :: CANONICAL_STARQ_FLEET',
  note:
    'Declared commercial and staffing metadata only. It is authoritative for provider/owner, product/client, capacity class, normal host and role family, and for NOTHING else.',
  excludes: Object.freeze({
    live_model:
      'NOT PRESENT BY RULING — no uniform live-model signal exists per harness. Founder recorded that OpenCode, Pi and Goose vary by session. UNKNOWN beats a string that drifts.',
    live_pid_and_state: 'JOINED FROM HERDR AT RENDER TIME — never held here',
    turn_holder: 'JOINED FROM IDENTITY LEASES AT RENDER TIME — never held here',
    usage_and_quota:
      'NOT PRESENT BY RULING — there is no uniform provider billing API behind these seats. usage stays manual and Founder-updated in staff-state.json.',
    assignment_and_duty: 'JOINED FROM activity.json AND staff-state.json — never held here',
    room_state: 'JOINED FROM the Room ledger via activity.json — never held here',
  }),
});
