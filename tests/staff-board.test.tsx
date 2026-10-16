/**
 * tests/staff-board.test.tsx
 *
 * ── STAFF / CAPACITY INTEGRATION — FOUNDER ROOM SEQ 8475 ────────────────────
 *
 * Elder recon'd the staff board at seq 8474. The Founder authorised the build at
 * seq 8475. These tests are the evidence that the build did what it was told and
 * nothing it was not.
 *
 * The load-bearing claim is not "the board now shows ten seats". It is that the
 * board can now tell the difference between a DECLARED fact, an OBSERVED fact
 * and a LIVE fact — because that is what makes ten rows trustworthy rather than
 * merely tidy.
 *
 * Every test below is written so that the obvious wrong implementation fails it.
 * A test that only passes on the correct code is decoration; a test that goes red
 * when the guarantee is removed is a guard.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPhase3Surface } from '../server/data-service.mjs';
import { buildFloor } from '../server/floor.mjs';
import {
  STAFF_PROFILE,
  STAFF_PROFILE_AUTHORITY,
  CANONICAL_STAFF_HANDLES,
  isCanonicalStaffHandle,
} from '../server/staff-profile.mjs';
import { StaffSurface, CapacityPanel } from '@/surfaces/staff';
import { SEAT_REGISTRY_AUTHORITY } from '@/schemas/seat-registry';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const SERVER = path.join(PKG, 'server');

const surface = await buildPhase3Surface();
const floor = surface.floor!;
const staff = floor.staff!;

const html = renderToStaticMarkup(React.createElement(StaffSurface, { surface }));
const text = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const capacityHtml = renderToStaticMarkup(React.createElement(CapacityPanel, { surface }));

// The Founder's own roster, Room seq 8473. Restated here as an independent
// expectation rather than imported from the implementation, so a change to the
// profile cannot quietly redefine what "correct" means.
const FOUNDER_ROSTER: Array<[string, string, string, string]> = [
  // handle, seat label, provider/owner, capacity class
  ['claude', 'Elder', 'Anthropic', 'PAID_L1'],
  ['codex', 'Codex', 'OpenAI', 'PAID_L1'],
  ['antigravity', 'Antigravity', 'Google', 'PAID_L1'],
  ['cursor', 'Cursor', 'SpaceX', 'PAID_L1'],
  ['copilot', 'Copilot', 'GitHub / Microsoft', 'PAID_L1'],
  ['vision', 'Vision', 'Nous Research', 'FREE_SUPPORT'],
  ['deadpool', 'Deadpool', 'Nous Research', 'FREE_SUPPORT'],
  ['opencode', 'OpenCode', 'VARIES BY SESSION', 'FREE_SUPPORT'],
  ['pi', 'Pi', 'VARIES BY SESSION', 'FREE_SUPPORT'],
  ['goose', 'Goose', 'VARIES BY SESSION', 'FREE_SUPPORT'],
];

const GHOST_HANDLES = [
  'nexus',
  'qoder',
  'vscode',
  'alfred',
  'athena',
  'bursar',
  'openclaw',
  'devin',
  'opencode2',
  'mastracode',
  'format-watchdog',
];

describe('SEQ 8475 A — the declared profile is the Founder roster, and only that', () => {
  it('declares exactly the ten canonical Dev Studio seats', () => {
    expect(CANONICAL_STAFF_HANDLES).toHaveLength(10);
    expect([...CANONICAL_STAFF_HANDLES].sort()).toEqual(
      FOUNDER_ROSTER.map(([h]) => h).sort(),
    );
  });

  it('carries the Founder-declared provider and capacity class for every seat', () => {
    for (const [handle, label, provider, capacity] of FOUNDER_ROSTER) {
      const seat = STAFF_PROFILE.find((s) => s.handle === handle);
      expect(seat, `no profile row for ${handle}`).toBeTruthy();
      expect(seat!.seat_label).toBe(label);
      expect(seat!.provider_owner).toBe(provider);
      expect(seat!.capacity_class).toBe(capacity);
    }
  });

  it('splits paid L1 from free/offload 5 and 5, as the Founder grouped them', () => {
    // The Founder listed "Paid L1 seats" (Elder, Codex, Antigravity, Cursor,
    // Copilot) against "Free / offload seats" (Vision, Deadpool, OpenCode, Pi,
    // Goose). costClass is the axis Elder proposed and the Founder approved by
    // ordering the build against it.
    const paid = staff.canonical_seats.filter(
      (s) => s.staff_profile?.capacity_class === 'PAID_L1',
    );
    const free = staff.canonical_seats.filter(
      (s) => s.staff_profile?.capacity_class === 'FREE_SUPPORT',
    );
    expect(paid.map((s) => s.handle).sort()).toEqual(
      ['antigravity', 'claude', 'codex', 'copilot', 'cursor'],
    );
    expect(free.map((s) => s.handle).sort()).toEqual(
      ['deadpool', 'goose', 'opencode', 'pi', 'vision'],
    );
    expect(STAFF_PROFILE.filter((s) => s.capacity_class === 'UNKNOWN')).toHaveLength(0);
  });

  it('declares no ghost or historical handle as a seat', () => {
    for (const ghost of GHOST_HANDLES) {
      expect(isCanonicalStaffHandle(ghost), `${ghost} must not be a canonical seat`).toBe(false);
    }
    // And nothing canonical is a retired identity.
    for (const seat of STAFF_PROFILE) {
      const row = staff.canonical_seats.find((s) => s.handle === seat.handle)!;
      expect(row.is_retired, `${seat.handle} is declared as a retired seat`).toBe(false);
    }
  });

  it('declares every seat with a normal host, a product and a role family', () => {
    for (const seat of STAFF_PROFILE) {
      expect(seat.normal_host, `${seat.handle} has no normal host`).not.toBe('UNKNOWN');
      expect(seat.product_client.length).toBeGreaterThan(0);
      expect(seat.role_family).not.toBe('UNKNOWN');
    }
    // The Founder's host declarations, verified individually because the Elder
    // conflict is only safe if the OTHER nine are unambiguous.
    const hostOf = (h: string) =>
      STAFF_PROFILE.find((s) => s.handle === h)!.normal_host;
    expect(hostOf('claude')).toBe('WSL');
    expect(hostOf('deadpool')).toBe('WSL');
    for (const h of ['codex', 'antigravity', 'cursor', 'copilot', 'vision', 'opencode', 'pi', 'goose']) {
      expect(hostOf(h), `${h} host`).toBe('WINDOWS');
    }
  });
});

describe('SEQ 8475 B — the profile holds no live state, and says so', () => {
  it('carries no live PID, online state, assignment, usage or Room state', () => {
    /*
      The directive: "do not hard-code live PID, online state, assignment, usage,
      or Room state." This is the check that the declared profile stayed a
      declaration.

      Checked over the SEAT OBJECTS, not the raw file text. A word-ban over the
      source would fail on the module's own `excludes` block — which names
      `usage_and_quota` precisely in order to say usage is NOT here — and a guard
      that cannot distinguish "declares usage" from "declares that it does not
      declare usage" is a guard that gets deleted rather than satisfied.

      So: the ban is on the shape of each seat record, which is the thing that
      could actually be filled in with a stale value.
    */
    for (const seat of STAFF_PROFILE) {
      const keys = Object.keys(seat).map((k) => k.toLowerCase());
      for (const banned of ['pid', 'online', 'is_running', 'running', 'state', 'status']) {
        expect(keys, `${seat.handle} declares a live "${banned}" field`).not.toContain(banned);
      }
      for (const banned of ['assignment', 'current_task', 'duty', 'usage', 'quota', 'tokens']) {
        expect(keys, `${seat.handle} declares a "${banned}" field`).not.toContain(banned);
      }
      for (const banned of ['seq', 'sequence', 'last_seen', 'claimed_at', 'room_state', 'broker']) {
        expect(keys, `${seat.handle} declares a Room/session "${banned}" field`).not.toContain(banned);
      }
    }
    // And the exact permitted shape. If a future field is added, this fails and
    // the addition has to justify itself against a declared limit.
    expect(Object.keys(STAFF_PROFILE[0]).sort()).toEqual(
      [
        'capacity_class',
        'handle',
        'harness',
        'herdr_seat_id',
        'normal_host',
        'product_client',
        'provider_owner',
        'role_family',
        'seat_label',
      ].sort(),
    );
  });

  it('declares its own limits in the payload, so absence reads as ruling not oversight', () => {
    const excludes = STAFF_PROFILE_AUTHORITY.excludes as Record<string, string>;
    for (const key of [
      'live_model',
      'live_pid_and_state',
      'turn_holder',
      'usage_and_quota',
      'assignment_and_duty',
      'room_state',
    ]) {
      expect(excludes[key], `no declared exclusion for ${key}`).toBeTruthy();
    }
    expect(STAFF_PROFILE_AUTHORITY.is_ssot_for_live_state).toBe(false);
    // And the floor payload says the same, independently of the profile module.
    expect(floor.excluded.live_pid_and_process_state).toMatch(/NOT IN THIS PAYLOAD BY DESIGN/);
    expect(floor.excluded.live_model).toMatch(/ABSENT BY RULING/);
    expect(floor.excluded.usage_and_quota).toMatch(/ABSENT BY RULING/);
  });

  it('ships no live PID or process state in the Herdr join', () => {
    // Belt and braces over the source-level ban: whatever the profile file says,
    // the Herdr join in the assembled projection must contain no live process
    // value at all.
    //
    // Scoped to the join, NOT to the whole payload. `floor.sessions` legitimately
    // carries lease `pid` values — that is canonical lease data the floor has
    // always forwarded — and asserting over the whole serialisation would flag
    // pre-existing correct behaviour and train the guard to be ignored.
    for (const seat of staff.canonical_seats) {
      const herdr = seat.herdr as Record<string, unknown> | null;
      expect(herdr, `${seat.handle} must carry an explicit Herdr join, not null`).toBeTruthy();
      for (const banned of ['pid', 'state', 'session_id', 'alive', 'uptime', 'is_running']) {
        expect(
          Object.keys(herdr!),
          `the Herdr join must not carry a live "${banned}"`,
        ).not.toContain(banned);
      }
    }
    // The declared launch facts are present, and are boolean/static only.
    const serialised = JSON.stringify(staff.canonical_seats.map((s) => s.herdr));
    expect(/"launchable"\s*:/.test(serialised)).toBe(true);
    expect(/"declared_runtime"\s*:/.test(serialised)).toBe(true);
  });

  it('refuses to name a turn-holder from a lease', () => {
    /*
      "join identity leases for active session / current turn" — done honestly.

      A lease says a handle is HELD. Naming one holder the turn-holder would be
      Command deciding who is working, from presence, which is the exact
      inference this product is built to refuse. So the join reports every
      holder and declines the question.
    */
    expect(staff.session_leases.turn_holder).toBe('UNKNOWN');
    expect(staff.session_leases.turn_holder_reason).toMatch(/NOT DERIVABLE FROM A LEASE/);
    expect(Array.isArray(staff.session_leases.holders)).toBe(true);
    expect(staff.session_leases.source).toBe('agent-comms/cursors/identity-leases');
  });
});

describe('SEQ 8475 C — suppression is curation, never deletion', () => {
  it('leaves floor.roster.entries complete and reconciles every observed handle', () => {
    // The roster is the evidence. It must still hold every handle the ledger
    // observes, or "we are hiding people" stops being auditable.
    expect(floor.roster.entries.length).toBe(surface.execution_truth.agents.length);
    expect(staff.roster_still_complete).toBe(true);
    expect(staff.accounting).toMatch(/^COMPLETE/);
    expect(staff.observed_in_ledger + staff.suppressed_count).toBe(floor.roster.entries.length);
  });

  it('suppresses every ghost with a stated reason and none of the ten', () => {
    expect(staff.suppressed_count).toBeGreaterThan(0);
    for (const s of staff.suppressed) {
      expect(s.reason, `${s.handle} suppressed with no reason`).toBeTruthy();
      expect(isCanonicalStaffHandle(s.handle)).toBe(false);
    }
    for (const handle of CANONICAL_STAFF_HANDLES) {
      expect(
        staff.suppressed.find((s) => s.handle === handle),
        `canonical seat ${handle} must never be suppressed`,
      ).toBeUndefined();
    }
  });

  it('distinguishes a retired identity from a historical ghost from a system row', () => {
    // These are different faults and would be fixed differently, so one blanket
    // "not a seat" reason would destroy information the operator needs.
    const byHandle = new Map(staff.suppressed.map((s) => [s.handle, s]));
    expect(byHandle.get('nexus')?.reason).toMatch(/RETIRED IDENTITY/);
    expect(byHandle.get('nexus')?.is_retired).toBe(true);

    const ghost = byHandle.get('qoder');
    expect(ghost?.reason).toMatch(/HISTORICAL \/ GHOST IDENTITY/);
    expect(ghost?.is_retired).toBe(false);

    expect(byHandle.get('format-watchdog')?.reason).toMatch(/SYSTEM PARTICIPANT/);
  });

  it('never calls the Founder a ghost, a retired seat or a machine', () => {
    /*
      Caught by rendering the real surface: `ali` is observed in the Room ledger,
      is not one of the ten seats, and fell straight through to the generic
      "HISTORICAL / GHOST IDENTITY" reason.

      That is not a cosmetic mislabel. It asserts that the person who owns this
      floor used to be on it and no longer is. The Founder is ABOVE the roster —
      a different statement, and one the Founder would have every reason to
      object to on reading their own board.

      So the Founder handle carries its own reason, and the check is over every
      ROOT_GENESIS identity in the registry rather than one hard-coded handle.
    */
    const registry = JSON.parse(
      readFileSync(
        path.join(surface.workspace.root!, 'agent-comms/protocol/v1/identities.json'),
        'utf8',
      ),
    );
    const founders = registry.identities.filter(
      (i: { authorityLevel?: string }) => i.authorityLevel === 'ROOT_GENESIS',
    );
    expect(founders.length, 'the fixture must contain Founder identities').toBeGreaterThan(0);

    const suppressedByHandle = new Map(staff.suppressed.map((s) => [s.handle, s]));
    for (const founder of founders) {
      const row = suppressedByHandle.get(founder.canonicalHandle);
      if (!row) continue;
      expect(row.reason, `${founder.canonicalHandle} must not be labelled a ghost`).toMatch(
        /FOUNDER \/ MISSION CONTROL/,
      );
      expect(row.reason).not.toMatch(/GHOST|RETIRED IDENTITY|SYSTEM PARTICIPANT/);
      expect(row.is_retired).toBe(false);
      expect(row.is_system).toBe(false);
    }
    // And the rendered page must say so.
    expect(text).toMatch(/FOUNDER \/ MISSION CONTROL/);
    // `ali` is the observed Founder handle on the live ledger; assert the
    // specific regression directly so a refactor cannot hide it.
    expect(suppressedByHandle.get('ali')?.reason ?? '').toMatch(/FOUNDER \/ MISSION CONTROL/);
  });

  it('keeps a declared seat on the board even when the ledger has never seen it', () => {
    /*
      `copilot` is a declared paid seat with no row in the activity projection.
      Dropping it would make "this seat exists and has said nothing"
      indistinguishable from "this seat does not exist" — and the second reading
      is the one that quietly deletes people from a floor.
    */
    const copilot = staff.canonical_seats.find((s) => s.handle === 'copilot');
    expect(copilot, 'copilot is a declared seat and must be present').toBeTruthy();
    expect(copilot!.observed_in_ledger).toBe(false);
    expect(copilot!.absence_reason).toMatch(/DECLARED SEAT, NOT OBSERVED/);
    // UNKNOWN, never null-silently and never inferred.
    expect(copilot!.current_state).toBe('UNKNOWN');
    expect(copilot!.execution_current_assignment).toBeNull();
    expect(copilot!.execution_assignment_confidence).toBe('UNKNOWN');
    // Its declared metadata still renders — that is the point of declaring it.
    expect(copilot!.staff_profile?.capacity_class).toBe('PAID_L1');
    expect(staff.declared_not_observed).toContain('copilot');
  });

  it('renders the ten on the main surface and states what it left off', () => {
    for (const [handle] of FOUNDER_ROSTER) {
      expect(text, `canonical seat ${handle} missing from the main staff surface`).toContain(
        handle,
      );
    }
    // Ghosts are not on the board. Only asserted for ghosts the ledger actually
    // observes: `identities.json` carries 22 handles and the activity projection
    // does not cover all of them, so "absent from the roster" and "suppressed
    // from the board" are different facts and conflating them would hide a real
    // gap in the projection.
    const observed = new Set(floor.roster.entries.map((e) => e.handle));
    const observedGhosts = GHOST_HANDLES.filter((g) => observed.has(g));
    expect(observedGhosts.length, 'the fixture must contain observed ghost handles').toBeGreaterThan(0);
    for (const ghost of observedGhosts) {
      expect(
        staff.suppressed.some((s) => s.handle === ghost),
        `${ghost} is observed but neither a seat nor suppressed`,
      ).toBe(true);
      expect(text.includes(`>${ghost}<`), `${ghost} must not be a rendered board row`).toBe(false);
    }
    // But the suppression itself is on screen, with its count and its reason.
    expect(text).toMatch(/Not on the main staff surface/);
    expect(text).toContain(String(staff.suppressed_count));
    expect(text).toMatch(/curation of the main surface, not a deletion/);
    expect(text).toMatch(/COMPLETE/);
  });
});

describe('SEQ 8475 D — the Herdr join is read-only, declared, and never overreaches', () => {
  it('reads the manifest and joins declared launch facts by seat id', () => {
    expect(staff.herdr_manifest.available).toBe(true);
    expect(staff.herdr_manifest.authority).toBe('HERDR_FLOOR_MANIFEST');
    expect(staff.herdr_manifest.seat_count).toBeGreaterThan(0);
    expect(staff.herdr_manifest.live_state_source).toMatch(/api\/herdr\/state/);

    // Declared values come from the manifest, not from the profile. Asserted
    // against the file itself so the assertion cannot be satisfied by the
    // implementation asserting its own output back at itself.
    const manifest = JSON.parse(
      readFileSync(
        path.join(surface.workspace.root!, '00_STARQ_HQ/operations/herdr-floor/manifest.json'),
        'utf8',
      ),
    );
    for (const row of manifest.agents) {
      const joined = staff.canonical_seats.find((s) => s.herdr?.seat_id === row.id);
      if (!joined) continue;
      expect(joined.herdr!.declared_runtime).toBe(row.runtime);
      expect(joined.herdr!.launchable).toBe(row.launchable);
      expect(joined.herdr!.startup_policy).toBe(row.startup_policy);
    }
  });

  it('reports a seat with no manifest row as ABSENT, never as unlaunchable', () => {
    // `opencode` is a declared free seat and the manifest declares no row for it.
    // Absence is not a refusal to launch, and inventing a seat id to fill the
    // gap would be exactly the unverifiable claim the manifest forbids.
    const opencode = staff.canonical_seats.find((s) => s.handle === 'opencode')!;
    expect(opencode.staff_profile?.herdr_seat_id).toBeNull();
    expect(opencode.herdr?.declared).toBe(false);
    expect(opencode.herdr?.launchable).toBeNull();
    expect(opencode.herdr?.absent_reason).toMatch(/declares no Herdr seat id/);

    expect(staff.canonical_seats.filter((s) => s.herdr?.declared === false)).toHaveLength(
      staff.canonical_seats.filter((s) => s.herdr && !s.herdr.declared).length,
    );
    expect(
      staff.canonical_seats.some((s) => s.herdr?.declared === false && s.herdr?.launchable === false),
      'an absent manifest row must never be reported as launchable:false',
    ).toBe(false);
  });

  it('reports a host disagreement with both values and never adjudicates it', () => {
    /*
      Elder was the live case: the Founder roster declared WSL while the Herdr
      manifest launched Windows. Command recorded both and refused a verdict,
      because "which is canonical" is a Founder decision.

      The manifest was later reconciled to WSL (Founder ruling seq 8481), so on
      the live surface the two sources now AGREE and the constraint is absent.
      Asserting "the conflict exists" would therefore pin one data snapshot and
      break the next time either source is corrected.

      So the guarantee under test is the RULE, not the snapshot: when the two
      declared sources disagree, Command must emit both values, name both
      sources, and record no resolution. Proven here against a synthetic surface
      that deliberately disagrees — which is what makes it a guard rather than a
      snapshot.
    */
    const disagreeing = buildFloor({
      surface: {
        execution_truth: { agents: [] },
        identities: { byHandle: {} },
        staff_state: { byHandle: {} },
        sessions: { byHandle: {} },
        // A manifest that still launches Elder on Windows, contradicting the
        // declared WSL profile.
        herdr_manifest: {
          available: true,
          state: 'OK',
          authority: 'HERDR_FLOOR_MANIFEST',
          count: 1,
          bySeatId: {
            elder: {
              seat_id: 'elder',
              label: 'Elder',
              declared_runtime: 'windows',
              startup_policy: 'FLOOR_LAUNCH',
              launchable: true,
              terminal: true,
              executable_present: true,
              identity_probe: 'windows',
              herdr_kind: 'claude',
              evidence: 'synthetic disagreeing row',
            },
          },
        },
      },
    });

    const elder = disagreeing.staff!.canonical_seats.find((s) => s.handle === 'claude')!;
    // Both declared values survive, unmerged.
    expect(elder.staff_profile?.normal_host).toBe('WSL');
    expect(elder.herdr?.declared_runtime).toBe('windows');
    expect(elder.herdr_host_conflict).toBe(true);

    const conflict = disagreeing.constraints.find((c) => c.kind === 'HERDR_HOST_CONFLICT');
    expect(conflict, 'a real disagreement must be a first-class constraint').toBeTruthy();
    expect(conflict!.subject).toBe('claude');
    expect(conflict!.detail).toMatch(/WSL/);
    expect(conflict!.detail).toMatch(/windows/);
    // Both sources named, and explicitly no verdict.
    expect(conflict!.canonical_source).toMatch(/staff-profile\.mjs/);
    expect(conflict!.canonical_source).toMatch(/manifest\.json/);
    expect(conflict!.resolution).toMatch(/NOT RESOLVED BY COMMAND/);
    expect(conflict!.resolution).toMatch(/Founder decision/);
    expect(disagreeing.roster.counts.herdr_host_conflicts).toBe(1);

    // And on the LIVE surface the two sources currently agree, so the conflict
    // is genuinely absent rather than suppressed. Verified against the shipped
    // manifest, not assumed.
    const liveElder = staff.canonical_seats.find((s) => s.handle === 'claude')!;
    expect(liveElder.staff_profile?.normal_host).toBe(liveElder.herdr?.declared_runtime?.toUpperCase());
    expect(floor.roster.counts.herdr_host_conflicts).toBe(0);
    expect(
      floor.constraints.find((c) => c.kind === 'HERDR_HOST_CONFLICT'),
      'agreement must not leave a stale conflict constraint behind',
    ).toBeUndefined();
  });

  it('keeps the Herdr manifest out of the /api/raw allowlist', () => {
    // The join needed a read, not a served file. Widening the evidence drawer
    // would have been a wider door opened for no requirement.
    expect(surface.read_only_sources).not.toContain(
      '00_STARQ_HQ/operations/herdr-floor/manifest.json',
    );
    expect(floor.phase3 ?? surface.phase3?.reads).toContain('herdr-floor/manifest.json');
  });

  it('preserves the provider ruling verbatim instead of rewriting it', () => {
    // RULING 1 (Phase 3) held that no canonical provider field exists and that
    // it is dropped rather than inferred. The seq 8475 declaration does not
    // overturn that — a declared provider is not a canonical provider field.
    // The original text is kept so the record and its guard both stay honest,
    // and the new fact is declared beside it under its own key.
    expect(floor.excluded.provider_health).toMatch(/EXCLUDED BY FOUNDER RULING/);
    expect(floor.excluded.provider_health).toMatch(/no canonical provider field exists/);
    expect(floor.excluded.declared_provider_metadata).toMatch(/PRESENT BY FOUNDER DECLARATION/);
  });
});

describe('SEQ 8475 E — the stale CANONICAL_STARQ_FLEET is not made authoritative', () => {
  it('is marked superseded and non-authoritative at its own declaration', () => {
    expect(SEAT_REGISTRY_AUTHORITY.status).toBe('SUPERSEDED');
    expect(SEAT_REGISTRY_AUTHORITY.authoritative).toBe(false);
    expect(SEAT_REGISTRY_AUTHORITY.superseded_by).toBe(
      'server/staff-profile.mjs :: STAFF_PROFILE',
    );
    // And the file says so in prose, so a human opening it is told too.
    const src = readFileSync(path.join(PKG, 'src', 'schemas', 'seat-registry.ts'), 'utf8');
    expect(src).toMatch(/SUPERSEDED/);
    expect(src).toMatch(/DO NOT BUILD ON THIS FILE/);
  });

  it('is read by neither the floor assembly nor the staff surface', () => {
    // "Not authoritative" is only true if nothing on the live path consults it.
    //
    // Matched on IMPORT/REQUIRE specifiers, not on the bare name: `floor.mjs`
    // names `CANONICAL_STARQ_FLEET` in its `excluded` declarations, in order to
    // state that the fleet is NOT read. A substring ban would flag the very
    // sentence that records the supersession and would have to be deleted to go
    // green — which is how a guard teaches a team to route around it.
    for (const file of ['floor.mjs', 'data-service.mjs', 'staff-profile.mjs']) {
      const src = readFileSync(path.join(SERVER, file), 'utf8');
      expect(
        src,
        `${file} must not import the superseded fleet`,
      ).not.toMatch(/(from|import|require\()\s*['"][^'"]*seat-registry/);
    }
    const staffSrc = readFileSync(path.join(PKG, 'src', 'surfaces', 'staff.tsx'), 'utf8');
    expect(staffSrc).not.toMatch(/from\s*['"][^'"]*seat-registry/);
    expect(staffSrc).not.toMatch(/CANONICAL_STARQ_FLEET\s*[.,;)\]]/);
  });

  it('does not reproduce the stale fleet values the Founder corrected', () => {
    // The specific errors Elder listed. Each would put a wrong provider, a wrong
    // paid tier or a phantom seat back on the board.
    const staleValues = [
      'Claude 3.7 Sonnet',
      'o3-mini',
      'Google Deepmind',
      'Gemini 2.5',
      'L1_EXECUTIVE',
      'L2_OPERATIONAL',
      'unlaunchable_archive',
      'Hermes Profile',
      'Hermes Engine',
    ];
    const rendered = `${text} ${JSON.stringify(floor)}`;
    for (const value of staleValues) {
      expect(rendered, `stale fleet value "${value}" reached the staff payload`).not.toContain(
        value,
      );
    }
    // The phantom rows are not seats, and Copilot — which the fleet omitted
    // entirely — is.
    expect(isCanonicalStaffHandle('hermes')).toBe(false);
    expect(isCanonicalStaffHandle('unlaunchable_archive')).toBe(false);
    expect(isCanonicalStaffHandle('copilot')).toBe(true);
  });
});

describe('SEQ 8475 F — the board still refuses to infer', () => {
  it('renders capacity as a declared class with no usage meter beside it', () => {
    // The Founder's question is "can a cheaper seat absorb this before burning L1
    // quota". The honest answer on a floor with no billing API is the declared
    // split plus an explicit statement that nothing is being metered.
    expect(capacityHtml).toContain('Paid L1 seats');
    expect(capacityHtml).toContain('Free / offload seats');
    expect(capacityHtml).toMatch(/declared — burn these last/);
    expect(text).toMatch(/declared capacity class · no live usage meter exists/);
    expect(text).toMatch(/Capacity class is a declared commercial fact, not a measurement/);
    // No invented meter in the payload itself. Scoped to `text` MINUS the
    // forwarded canonical capacity-note prose: staff-state.json carries
    // Founder-updated usage notes that legitimately contain phrases like
    // "% used", and Command forwards declared text verbatim rather than
    // rewriting it. Checking the payload for invented fields is the real guard —
    // a synthesised meter would be a field, not a word.
    const inventedFields = ['usage_percent', 'quota_remaining', 'tokens_used', 'credits_left'];
    for (const field of inventedFields) {
      expect(JSON.stringify(floor), `invented meter field ${field}`).not.toContain(field);
    }
    expect(floor.excluded.usage_and_quota).toMatch(/No meter is synthesised/);
  });

  it('keeps duty and execution separate and never merges them', () => {
    // The seq 8475 directive joined more sources onto this board. Joining more is
    // exactly when a surface starts reconciling two truths it does not own, so
    // the pre-existing separation is re-proved rather than assumed intact.
    for (const seat of staff.canonical_seats) {
      if (!seat.truth_disagreement) continue;
      expect(seat.truth_disagreement.values_differ).toBe(
        seat.truth_disagreement.execution_side.value !==
          seat.truth_disagreement.duty_side.value,
      );
      expect(seat.truth_disagreement.resolution).toMatch(/NOT RESOLVED BY COMMAND/);
    }
    expect(floor.roster.counts.truth_disagreements).toBeGreaterThanOrEqual(0);
  });

  it('keeps a broker that cannot be read as UNKNOWN, never as offline', () => {
    // Server-rendered, the live join has not run: `useEffect` does not fire under
    // renderToStaticMarkup, so the board must render its not-yet-read state
    // honestly rather than pretending the seats are down.
    //
    // "We did not ask" and "it is not running" are different facts, and
    // conflating them is how an operator stops a working seat believing it is
    // dead. So the honest strings are required and OFFLINE is banned outright.
    expect(text).toMatch(/NOT YET READ|NOT REACHABLE|Live process state was not read/);
    expect(text).toMatch(/Live PID NONE RECORDED|Live process state UNKNOWN|Live process state EXITED/);
    expect(text).toContain('UNKNOWN');
    // The declared launch facts are still shown — they are a different claim
    // from a live reading, and dropping them would lose real information.
    expect(text).toMatch(/Declared launch runtime/);
    // The live state must never read as a broker verdict we did not receive.
    //
    // Scoped to the LIVE row, not the whole page: `Duty state OFFLINE` is
    // canonical staff-state.json text about Elder's declared duty, and it is
    // forwarded verbatim. Banning the word across the page would flag correct
    // forwarded duty state, and a guard that fires on honest data gets disabled.
    const liveRow = text.match(/Live process state ([A-Z_]+)/)?.[1];
    expect(liveRow, 'the live process state row must render a declared verdict').toBeTruthy();
    expect(liveRow).toBe('UNKNOWN');
    expect(liveRow).not.toBe('OFFLINE');
    // And the reason the live value is missing is on screen next to it.
    expect(text).toMatch(/Live process state was NOT read/);
  });

  it('adds no write capability and no outbound transport to the server', () => {
    for (const file of ['floor.mjs', 'data-service.mjs', 'staff-profile.mjs']) {
      const src = readFileSync(path.join(SERVER, file), 'utf8');
      for (const forbidden of [
        'writeFileSync',
        'appendFileSync',
        'renameSync',
        'unlinkSync',
        'mkdirSync',
      ]) {
        expect(src, `${file} must not gain ${forbidden}`).not.toContain(forbidden);
      }
      // The Herdr join is a local file read plus a payload field. It must not
      // have become a server-side HTTP call to the broker.
      expect(src, `${file} must not open an outbound request`).not.toMatch(
        /\b(fetch|axios|https?\.request|undici)\b/,
      );
    }
  });
});

describe('SEQ 8475 G — the curation survives an empty or absent projection', () => {
  it('renders the declared ten even when the ledger observes nobody', () => {
    // The board must not collapse to "no staff" because a projection is empty or
    // stale. That collapse is the one failure mode that would delete the entire
    // roster, and it is why the profile and the ledger are joined, not merged.
    const empty = buildFloor({
      surface: {
        execution_truth: { agents: [] },
        identities: { byHandle: {} },
        staff_state: { byHandle: {} },
        sessions: { byHandle: {} },
        herdr_manifest: { available: false, bySeatId: {}, seats: [], state: 'UNAVAILABLE' },
      },
    });

    expect(empty.roster.entries).toEqual([]);
    expect(empty.staff!.canonical_count).toBe(10);
    expect(empty.staff!.observed_in_ledger).toBe(0);
    expect(empty.staff!.declared_not_observed).toHaveLength(10);
    expect(empty.staff!.suppressed_count).toBe(0);
    // Accounting still reconciles: 0 observed canonical + 0 suppressed = 0 rows.
    expect(empty.staff!.accounting).toMatch(/^COMPLETE/);

    // With no manifest readable, every seat reports the absence rather than
    // inheriting a launch fact it has no source for.
    for (const seat of empty.staff!.canonical_seats) {
      expect(seat.herdr?.declared).toBe(false);
      expect(seat.herdr?.launchable).toBeNull();
    }
    expect(
      empty.constraints.find((c) => c.kind === 'HERDR_MANIFEST_UNAVAILABLE'),
      'an unreadable manifest must be declared, not silently absent',
    ).toBeTruthy();
    expect(
      empty.constraints.find((c) => c.kind === 'HERDR_MANIFEST_UNAVAILABLE')!.resolution,
    ).toMatch(/never assumed false/);
  });
});
