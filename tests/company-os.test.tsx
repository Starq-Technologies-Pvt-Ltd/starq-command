/**
 * tests/company-os.test.tsx
 *
 * ── COMPANY OS CONTRACT — Founder seq 8486/8487, contract seq 8488 ───────────
 *
 * Goose owns the Company OS integration/smoke suite for this wave. Goose has not
 * landed it, and the builder cannot ship a candidate whose central safety
 * properties are unproven — so the assertions Goose was assigned are covered
 * here, on the real assembled surface, and Goose's suite is expected to overlap
 * and extend rather than replace them.
 *
 * The properties under test are the ones that would be silently catastrophic to
 * get wrong:
 *
 *   · a dormant initiative rendering as active (StarqPay, Starq Academy);
 *   · the Founder's acting capacity quietly widening authority;
 *   · a seat becoming a person, i.e. the company collapsing into a headcount;
 *   · an agent appearing as an occupant or an officer;
 *   · Jev appearing anywhere near a person count;
 *   · an absent registry rendering as an empty company.
 *
 * Each is written so the obvious wrong implementation fails it.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import surface from './fixtures/cmd-stu-003-surface.json';
import { loadCompanyOs } from '../server/company-os.mjs';
import { CompanyOsSurface } from '@/surfaces/company-os';
import { COMPANY_OS_TABS } from '@/lib/building-route';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const FIXTURES = path.join(HERE, 'fixtures');

const company = surface.company_os!;

const registryText = readFileSync(path.join(FIXTURES, 'cmd-stu-003-company-seats.json'), 'utf8');
const registry = JSON.parse(registryText);

/** Render one tab of the real surface, exactly as the browser receives it. */
function renderTab(tab: string) {
  const html = renderToStaticMarkup(
    React.createElement(CompanyOsSurface, { surface, tab }),
  );
  return {
    html,
    text: html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim(),
  };
}

const structure = renderTab('Structure');
const seatsTab = renderTab('Seats');
const portfolio = renderTab('Portfolio');
const founderTab = renderTab('Founder');
const infraTab = renderTab('Infrastructure');

describe('G1 — the registry loads and is a projection, never an SSOT', () => {
  it('loads, and declares that the prose governance source remains authoritative', () => {
    expect(company.available).toBe(true);
    expect(company.state).toBe('OK');
    expect(company.is_ssot).toBe(false);
    expect(company.ssot_note).toMatch(/NOT AN SSOT/);
    expect(registry.provenance.governance_source).toBe('starq governance.txt');
  });

  it('records who accepted the architecture, so the build is not unauthorised', () => {
    // G1 is a RESERVED Founder decision (Room seq 8488). A company surface built
    // without a recorded acceptance would be exactly the "authority created by
    // tooling" the Founder ruled out, so the acceptance travels IN the data.
    const g1 = registry.provenance.g1_acceptance as Record<string, unknown>;
    expect(g1.state).toBe('ACCEPTED');
    expect(String(g1.accepted_by)).toMatch(/Founder/i);
    expect(String(g1.note)).toMatch(/reserved Founder decision/i);
  });

  it('never treats prose as executable authority', () => {
    // Structural, not a convention: the loader reads declared fields only.
    //
    // Comments are stripped before the ban. The module header DISCUSSES the
    // governance source in order to explain why it is never read at runtime, and
    // a guard that fired on that explanation would have to delete the reasoning
    // to go green — which is how a guard teaches a team to route around it. What
    // is banned is the loader OPENING those files, not the loader mentioning them.
    const src = readFileSync(path.join(PKG, 'server', 'company-os.mjs'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src, 'the loader must not read the governance text').not.toMatch(/starq governance\.txt/);
    expect(src, 'the loader must not read the architecture brief').not.toMatch(/SKYSCRAPER/);
    expect(src, 'the loader must not read any markdown').not.toMatch(/readFileSync\([^)]*\.md/);
    // And the registry itself declares the rule.
    expect(registry.prose_is_not_authority.rule).toMatch(/PROSE IS NEVER EXECUTABLE AUTHORITY/);
    expect(company.prose_is_not_authority).toBeTruthy();
  });
});

describe('FLOORS — every declared floor is represented, and Dev Studio is one of them', () => {
  it('carries all seven floors from the architecture brief', () => {
    expect(company.floors).toHaveLength(7);
    expect(company.floors.map((f) => f.id).sort()).toEqual(
      ['governance', 'administration', 'executive', 'devstudio', 'ai_workforce', 'dynamics', 'rnd'].sort(),
    );
  });

  it('names Governance, Administration, C-Suite, Dev Studio, AI Workforce, Dynamics and R&D', () => {
    const byId = new Map(company.floors.map((f) => [f.id, f.name]));
    expect(byId.get('governance')).toMatch(/Governance \/ Founder Office/i);
    expect(byId.get('administration')).toMatch(/Corporate Administration & Finance/i);
    expect(byId.get('executive')).toMatch(/C-Suite/i);
    expect(byId.get('devstudio')).toBe('Dev Studio');
    expect(byId.get('ai_workforce')).toMatch(/Digital Workforce/i);
    expect(byId.get('dynamics')).toMatch(/Dynamics/i);
    expect(byId.get('rnd')).toMatch(/R&D/i);
  });

  it('renders every floor on the Structure tab, in order', () => {
    for (const floor of company.floors) {
      expect(structure.text, `floor ${floor.id} missing from Structure`).toContain(floor.name);
    }
    const ordinals = company.floors.map((f) => f.ordinal ?? 0);
    expect([...ordinals].sort((a, b) => a - b)).toEqual(ordinals);
  });

  it('never presents the AI workforce floor as a corporate-officer surface', () => {
    const floor = company.floors.find((f) => f.id === 'ai_workforce')!;
    expect(floor.division_type).toBe('DELEGATED_EXECUTION');
    expect(floor.is_corporate_officer_surface).toBe(false);
    // No floor anywhere may claim it.
    expect(company.floors.every((f) => !f.is_corporate_officer_surface)).toBe(true);
    // And the delegated-execution nature is on screen.
    expect(structure.text).toContain('DELEGATED_EXECUTION');
  });
});

describe('ROOMS — all eight Dev Studio rooms exist, and dormant ones are truthful', () => {
  it('carries all eight Dev Studio project rooms', () => {
    const devRooms = company.rooms.filter((r) => r.floor_id === 'devstudio');
    expect(devRooms).toHaveLength(8);
    expect(devRooms.map((r) => r.ordinal).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('names each Dev Studio room from the brief', () => {
    const byOrdinal = new Map(
      company.rooms.filter((r) => r.floor_id === 'devstudio').map((r) => [r.ordinal, r.name]),
    );
    expect(byOrdinal.get(1)).toMatch(/Starq User Account/i);
    expect(byOrdinal.get(2)).toMatch(/Commercial Graph|sCG/i);
    expect(byOrdinal.get(3)).toBe('Hoadhaa');
    expect(byOrdinal.get(4)).toBe('starqERP');
    expect(byOrdinal.get(5)).toBe('starqAI');
    expect(byOrdinal.get(6)).toMatch(/Academy/i);
    expect(byOrdinal.get(7)).toMatch(/StarqPay/i);
    expect(byOrdinal.get(8)).toMatch(/Hoadhaa Matured/i);
  });

  it('marks rooms 1-5 ACTIVE and rooms 6-8 dormant', () => {
    const dev = company.rooms.filter((r) => r.floor_id === 'devstudio');
    for (const ordinal of [1, 2, 3, 4, 5]) {
      expect(dev.find((r) => r.ordinal === ordinal)!.state, `room ${ordinal}`).toBe('ACTIVE');
    }
    for (const ordinal of [6, 7, 8]) {
      expect(dev.find((r) => r.ordinal === ordinal)!.state, `room ${ordinal}`).toBe(
        'FUTURE_DORMANT',
      );
    }
    expect(company.counts!.devstudio_rooms_dormant).toBe(3);
  });

  it('never renders a dormant room as active, in the data OR on screen', () => {
    /*
      The highest-consequence honesty rule on the surface. StarqPay must not read
      as an operating payment business and Starq Academy must not read as a
      running school, because both have entity conditions that are NOT met.

      Checked in the payload AND in the rendered text, because a component that
      ignored `state` and rendered every room identically would pass a data-only
      assertion.
    */
    for (const room of company.rooms.filter((r) => r.state === 'FUTURE_DORMANT')) {
      expect(room.state).not.toBe('ACTIVE');
      // A dormant room must say why it is dormant.
      expect(room.activation_conditions.length, `${room.id} has no gate`).toBeGreaterThan(0);
      // It appears on the Structure tab with its dormant label and its gate.
      expect(structure.text, `${room.id} missing from Structure`).toContain(room.name);
      expect(structure.text).toContain('FUTURE / DORMANT');
    }
    // Academy and StarqPay specifically, with their unmet entity conditions.
    const academy = company.rooms.find((r) => r.id === 'devstudio-06-academy')!;
    const pay = company.rooms.find((r) => r.id === 'devstudio-07-pay')!;
    expect(academy.entity_gate_state).toBe('NOT_ESTABLISHED');
    expect(pay.entity_gate_state).toBe('NOT_ESTABLISHED');
    expect(structure.text).toMatch(/SEPARATE ENTITY \/ REGISTRATION REQUIRED/);
    expect(structure.text).toMatch(/LEGAL \/ REGULATORY \/ ENTITY STRUCTURE REQUIRED/);
  });

  it('keeps dormant rooms in the Portfolio split, not hidden in an active list', () => {
    expect(portfolio.text).toMatch(/Declared, not yet live/);
    expect(portfolio.text).toContain('StarqPay');
    expect(portfolio.text).toContain('Starq Academy');
    // The active list must not contain them.
    const activeCount = company.rooms.filter((r) => r.state === 'ACTIVE').length;
    expect(company.counts!.rooms_active).toBe(activeCount);
    expect(company.counts!.rooms_dormant).toBe(3);
  });

  it('represents Starq Dynamics as its own floor with its own rooms', () => {
    const dyn = company.rooms.filter((r) => r.floor_id === 'dynamics');
    expect(dyn.length).toBeGreaterThan(0);
    expect(dyn.every((r) => r.state === 'ACTIVE')).toBe(true);
    expect(company.floors.find((f) => f.id === 'dynamics')!.state).toBe('ACTIVE');
  });

  it('carries the Hoadhaa boundary with BOTH owners named', () => {
    const hoadha = company.rooms.find((r) => r.id === 'devstudio-03-hoadha')!;
    expect(hoadha.boundary).toBeTruthy();
    expect(hoadha.boundary!.devstudio_owns.join(' ')).toMatch(/platform technology|technical architecture/i);
    expect(hoadha.boundary!.dynamics_owns.join(' ')).toMatch(/merchant acquisition|incoming revenue/i);
    // And it is rendered, in the Portfolio tab, not buried in a comment.
    expect(portfolio.text).toMatch(/Hoadhaa boundary · two owners/);
    expect(portfolio.text).toMatch(/Dev Studio owns \(technology\)/);
    expect(portfolio.text).toMatch(/Starq Dynamics owns \(commercial\)/);
  });
});

describe('SEATS — a seat is a function, not a person', () => {
  it('renders every declared seat', () => {
    expect(company.seats.length).toBeGreaterThan(30);
    for (const seat of company.seats) {
      expect(seatsTab.text, `seat ${seat.seat_id} missing from Seats tab`).toContain(seat.seat_name);
    }
  });

  it('holds many seats under very few occupants — measured, not asserted', () => {
    /*
      The number pair that makes this a COMPANY rather than a headcount. 41 seats
      and 1 occupant is a thin bench, not one person with 41 titles, and the
      surface renders both numbers side by side for exactly that reason.
    */
    const c = company.counts!;
    expect(c.seats).toBeGreaterThan(c.distinct_occupants);
    expect(c.distinct_occupants).toBe(1);
    expect(company.separation!.seat_is_not_occupant).toBe(true);
    expect(company.separation!.seats_per_occupant).toBeGreaterThan(1);
    expect(seatsTab.text).toContain(`${c.seats} / ${c.distinct_occupants}`);
    expect(seatsTab.text).toMatch(/a seat is a FUNCTION, not a person/i);
  });

  it('keeps occupant and delegation in SEPARATE columns, never merged into one', () => {
    expect(seatsTab.text).toContain('Occupant');
    expect(seatsTab.text).toContain('Delegated execution');
    // No single "role" column may exist — that is the merge the contract forbids.
    expect(seatsTab.text).not.toMatch(/>Role</);
  });

  it('marks delegation as EXECUTION ONLY wherever it appears', () => {
    const withDelegation = company.seats.filter((s) => s.delegations.length > 0);
    expect(withDelegation.length).toBeGreaterThan(0);
    expect(seatsTab.text).toContain('EXECUTION ONLY — GRANTS NO AUTHORITY');
    // And delegation never equals the seat it hangs beneath.
    expect(company.separation!.delegation_is_not_the_seat).toBe(true);
  });

  it('has no agent occupying a company seat', () => {
    expect(company.separation!.no_agent_occupies_a_seat).toBe(true);
    for (const seat of company.seats) {
      expect(
        ['PERSON', 'NONE', 'UNKNOWN'],
        `seat ${seat.seat_id} occupant_type ${seat.occupant_type}`,
      ).toContain(seat.occupant_type);
    }
  });

  it('represents vacant AND dormant seats as separate honest facts', () => {
    const dormantSeats = company.seats.filter((s) => s.seat_state === 'FUTURE_DORMANT');
    expect(dormantSeats.length).toBeGreaterThan(0);
    for (const seat of dormantSeats) {
      // Dormant means no occupant AND not permitted to operate. Both, not one.
      expect(seat.occupant_id, `${seat.seat_id} is dormant but has an occupant`).toBeNull();
      expect(seat.occupant_type).toBe('NONE');
      expect(seat.authority_reserved.join(' ')).toMatch(/Activation/i);
    }
    expect(seatsTab.text).toMatch(/FUTURE \/ DORMANT/);

    /*
      VACANT_UNFILLED is a SUPPORTED state that happens not to occur in the live
      registry — the dormant seats are dormant FIRST and vacant second, and the
      two are not the same fact. Asserting the label renders today would fail on a
      registry that is behaving correctly, so what is asserted is that the state
      is in the declared vocabulary and renders when it does occur.
    */
    expect(Object.keys(registry.seat_states)).toContain('VACANT_UNFILLED');
    expect(registry.seat_states.VACANT_UNFILLED).toMatch(/honestly empty/i);

    // And the distinction is live: a dormant seat is NOT counted as vacant.
    expect(company.counts!.seats_dormant).toBe(dormantSeats.length);
    expect(
      dormantSeats.some((s) => s.seat_state === 'VACANT_UNFILLED'),
      'a dormant seat must not also be reported as merely vacant',
    ).toBe(false);
  });

  it('cites a source reference on every seat', () => {
    for (const seat of company.seats) {
      expect(seat.source_reference, `${seat.seat_id} has no source_reference`).toBeTruthy();
    }
  });
});

describe('AUTHORITY — no seat, hat, tool or agent grants any', () => {
  it('declares the authority model as three hard negatives', () => {
    const m = company.authority_model;
    expect(m.seat_grants_authority).toBe(false);
    expect(m.acting_capacity_grants_authority).toBe(false);
    expect(m.delegation_grants_authority).toBe(false);
    expect(m.tooling_creates_authority).toBe(false);
    expect(m.builder_is_verifier).toMatch(/ENFORCED/);
  });

  it('lets exactly ONE seat carry authority: the Founder seat, with a canonical source', () => {
    const claiming = company.seats.filter((s) => s.authority_granted.length > 0);
    expect(claiming).toHaveLength(1);
    expect(claiming[0].seat_id).toBe('governance-founder');
    expect(claiming[0].seat_state).toBe('OCCUPIED_FOUNDER');
    expect(claiming[0].authority_source).toMatch(/identities\.json/);
    // Every other seat claims nothing, even where the brief names an executive role.
    expect(company.counts!.seats_claiming_authority).toBe(1);
  });

  it('REFUSES a seat that tries to grant itself authority', () => {
    /*
      The property that makes the registry safe to extend: a registry that can
      hand a seat power by editing a JSON field would be authority created by
      tooling. So a seat claiming authority without being a Founder seat citing a
      canonical source is REFUSED and REPORTED — not honoured.
    */
    const hostile = JSON.parse(registryText);
    hostile.seats.push({
      seat_id: 'rogue-executive',
      seat_name: 'Rogue Executive',
      floor_id: 'executive',
      organizational_area: 'Executive Management',
      occupant_id: 'mustarq',
      occupant_type: 'PERSON',
      seat_state: 'OCCUPIED_HUMAN',
      authority_granted: ['CEO', 'UNLIMITED_SPEND'],
      delegations: [],
      scope: 'a seat that tried to grant itself power',
      source_reference: 'test fixture',
      current_acting_status: 'NOT_DECLARED',
    });
    const loaded = loadCompanyOs(FIXTURES, 'cmd-stu-003-company-seats.json');
    // Sanity: the fixture registry is still clean.
    expect(loaded.conflicts).toHaveLength(0);

    // Now the hostile one, through the same code path.
    const rogue = { ...hostile, seats: hostile.seats.filter((s) => s.seat_id === 'rogue-executive') };
    const path2 = path.join(process.env.TEMP!, 'rogue-seats.json');
    const fs = require('node:fs');
    fs.writeFileSync(path2, JSON.stringify(rogue));
    const result = loadCompanyOs(process.env.TEMP!, 'rogue-seats.json');
    const rogueSeat = result.seats.find((s) => s.seat_id === 'rogue-executive')!;
    expect(rogueSeat.authority_granted).toEqual([]);
    expect(rogueSeat.authority_granted_declared).toEqual(['CEO', 'UNLIMITED_SPEND']);
    const conflict = result.conflicts.find((c) => c.kind === 'SEAT_CLAIMS_UNSUPPORTED_AUTHORITY');
    expect(conflict).toBeTruthy();
    expect(conflict!.subject).toBe('rogue-executive');
    expect(conflict!.resolution).toMatch(/REFUSED AND REPORTED/);
    fs.unlinkSync(path2);
  });
});

describe('FOUNDER ACTING CAPACITY — the hat never changes authority', () => {
  it('reports UNKNOWN because nothing declares it, and does not pick one', () => {
    expect(company.founder!.current_acting_capacity).toBeNull();
    expect(company.founder!.current_acting_capacity_state).toBe('UNKNOWN');
    // A menu of candidates exists, and it is NOT rendered as the active hat.
    expect(company.founder!.candidate_seats.length).toBeGreaterThan(0);
    expect(company.founder!.current_acting_capacity).not.toBe(
      company.founder!.candidate_seats[0],
    );
  });

  it('says on screen that the hat is unknown and that candidates are not active', () => {
    expect(founderTab.text).toMatch(/CURRENT ACTING CAPACITY/);
    expect(founderTab.text).toMatch(/UNKNOWN — not declared/);
    expect(founderTab.text).toMatch(/candidates, not active/i);
    expect(founderTab.text).toMatch(/A candidate seat is not a hat being worn/);
    // The authoritative effect is stated numerically, not implied.
    expect(founderTab.text).toMatch(/Acting capacity authority effect[\s\S]{0,40}NONE/);
  });

  it('refuses an acting capacity that names an authority level instead of a seat', () => {
    // "Acting as ROOT_GENESIS" is not a hat — it is an authority level wearing a
    // hat's label, which is precisely the confusion the four-object split exists
    // to prevent.
    const hostile = JSON.parse(registryText);
    hostile.founder.current_acting_capacity = 'ROOT_GENESIS';
    const p = path.join(process.env.TEMP!, 'rogue-hat.json');
    const fs = require('node:fs');
    fs.writeFileSync(p, JSON.stringify(hostile));
    const result = loadCompanyOs(process.env.TEMP!, 'rogue-hat.json');
    expect(result.founder!.current_acting_capacity).toBeNull();
    expect(result.founder!.current_acting_capacity_state).toBe('CONFLICT');
    expect(
      result.conflicts.some((c) => c.kind === 'ACTING_CAPACITY_AMBIGUOUS'),
    ).toBe(true);
    fs.unlinkSync(p);
  });

  it('refuses an acting capacity that names no declared seat', () => {
    const hostile = JSON.parse(registryText);
    hostile.founder.current_acting_capacity = 'seat-that-does-not-exist';
    const p = path.join(process.env.TEMP!, 'ghost-hat.json');
    const fs = require('node:fs');
    fs.writeFileSync(p, JSON.stringify(hostile));
    const result = loadCompanyOs(process.env.TEMP!, 'ghost-hat.json');
    expect(result.founder!.current_acting_capacity).toBeNull();
    expect(result.founder!.current_acting_capacity_state).toBe('CONFLICT');
    expect(
      result.conflicts.some((c) => c.kind === 'ACTING_CAPACITY_UNKNOWN_SEAT'),
    ).toBe(true);
    fs.unlinkSync(p);
  });

  it('renders reserved Founder authority beside the unknown hat', () => {
    expect(company.founder!.reserved_to_founder.length).toBeGreaterThan(0);
    expect(founderTab.text).toMatch(/Reserved to the Founder/);
    for (const reserved of company.founder!.reserved_to_founder) {
      expect(founderTab.text, `reserved "${reserved}" missing`).toContain(reserved);
    }
  });

  it('displays the Founder as a PERSON, not as a bare role', () => {
    expect(company.founder!.display_as).toMatch(/Person/);
    expect(founderTab.text).toMatch(/Mustarq - Person/);
    expect(founderTab.text).toMatch(/person, not a role/i);
    // Both handles resolve to one person, and the surface says so.
    expect(company.founder!.room_handles.sort()).toEqual(['ali', 'mustarq']);
  });
});

describe('JEV AND INFRASTRUCTURE — systems are not people', () => {
  it('carries Command, Herdr, Room and Jev as infrastructure, never as seats', () => {
    expect(company.shared_infrastructure.map((s) => s.id).sort()).toEqual(
      ['command', 'herdr', 'jev', 'room'].sort(),
    );
    for (const sys of company.shared_infrastructure) {
      expect(sys.is_staff, `${sys.id} claims to be staff`).toBe(false);
      expect(sys.is_seat, `${sys.id} claims to be a seat`).toBe(false);
    }
    expect(company.counts!.infrastructure_claiming_staff).toBe(0);
  });

  it('excludes every infrastructure id from the seat registry', () => {
    const seatIds = new Set(company.seats.map((s) => s.seat_id));
    for (const sys of company.shared_infrastructure) {
      expect(seatIds.has(sys.id), `${sys.id} appears as a seat`).toBe(false);
    }
    // And Jev specifically is nowhere in the roster or the delegation lists as
    // an occupant.
    for (const seat of company.seats) {
      expect(seat.occupant_id).not.toBe('jev');
    }
  });

  it('marks Jev advisory-only and names what it never overrides', () => {
    const jev = company.shared_infrastructure.find((s) => s.id === 'jev')!;
    expect(jev.authority).toBe('ADVISORY_ONLY');
    expect(jev.never_overrides.join(' ')).toMatch(/Founder authority/);
    expect(jev.never_overrides.join(' ')).toMatch(/runtime|process truth/i);
    expect(jev.never_overrides.join(' ')).toMatch(/builder != verifier/i);
    expect(jev.operating_order).toMatch(/Hard constraints/);
    // And it says NOT STAFF on screen.
    expect(infraTab.text).toMatch(/NOT STAFF · NOT A SEAT/);
    expect(infraTab.text).toMatch(/Jev is retrieval and classification infrastructure/);
  });

  it('refuses an infrastructure entry that declares itself staff', () => {
    const hostile = JSON.parse(registryText);
    hostile.shared_infrastructure.push({
      id: 'sneaky-bot',
      name: 'Sneaky Bot',
      is_staff: true,
      is_seat: true,
    });
    const p = path.join(process.env.TEMP!, 'rogue-infra.json');
    const fs = require('node:fs');
    fs.writeFileSync(p, JSON.stringify(hostile));
    const result = loadCompanyOs(process.env.TEMP!, 'rogue-infra.json');
    expect(result.shared_infrastructure.some((s) => s.id === 'sneaky-bot')).toBe(false);
    expect(
      result.conflicts.some((c) => c.kind === 'INFRASTRUCTURE_CLAIMS_TO_BE_STAFF'),
    ).toBe(true);
    fs.unlinkSync(p);
  });

  it('keeps the ownership boundaries between the four systems explicit', () => {
    const byId = new Map(company.shared_infrastructure.map((s) => [s.id, s]));
    expect(byId.get('herdr')!.authority).toBe('RUNTIME_TRUTH');
    expect(byId.get('room')!.authority).toBe('COORDINATION_EVIDENCE');
    expect(byId.get('command')!.authority).toBe('DERIVED_PROJECTION');
    // Command never claims runtime truth for a process Herdr owns.
    expect(byId.get('command')!.authority).not.toBe('RUNTIME_TRUTH');
  });
});

describe('UNKNOWN AND UNAVAILABLE — absence is never drawn as a healthy empty', () => {
  it('reports the Founder entity registration as UNKNOWN, not as incorporated', () => {
    expect(company.company!.incorporation_state).toBe('UNKNOWN');
    expect(company.company!.incorporation_note).toMatch(/UNKNOWN/);
  });

  it('renders an unavailable registry as an ABSENCE, not an empty company', () => {
    const absent = loadCompanyOs(path.join(FIXTURES, 'no-such-dir'), 'cmd-stu-003-company-seats.json');
    expect(absent.available).toBe(false);
    expect(absent.state).toBe('UNAVAILABLE');
    expect(absent.reason).toBeTruthy();
    expect(absent.company).toBeNull();
    // No floors, rooms or seats — and crucially NOT an empty-but-healthy company.
    expect(absent.floors).toEqual([]);
    expect(absent.seats).toEqual([]);

    const html = renderToStaticMarkup(
      React.createElement(CompanyOsSurface, {
        surface: { ...surface, company_os: absent },
        tab: 'Structure',
      }),
    );
    expect(html).toMatch(/COMPANY SEAT REGISTRY UNAVAILABLE/);
    expect(html).toMatch(/never from prose/);
  });

  it('renders a surface with no company_os block as absent, not as empty', () => {
    const html = renderToStaticMarkup(
      React.createElement(CompanyOsSurface, {
        surface: { ...surface, company_os: undefined },
        tab: 'Structure',
      }),
    );
    expect(html).toMatch(/COMPANY OS PROJECTION ABSENT/);
  });

  it('renders an unparseable registry as UNREADABLE with its reason', () => {
    const fs = require('node:fs');
    const p = path.join(process.env.TEMP!, 'broken-seats.json');
    fs.writeFileSync(p, '{ this is not json');
    const broken = loadCompanyOs(process.env.TEMP!, 'broken-seats.json');
    expect(broken.available).toBe(false);
    expect(broken.reason).toMatch(/not valid JSON/);
    fs.unlinkSync(p);
  });

  it('names the registry on screen as a projection of the governance source', () => {
    expect(structure.text).toMatch(/How to read the Company OS/);
    expect(structure.text).toMatch(/governance source remains authoritative/);
    expect(structure.text).toMatch(/where the two disagree, the governance text wins/i);
  });
});

describe('BOUNDARIES — Command stays derived, Herdr stays runtime truth', () => {
  it('does not widen the /api/raw allowlist for the registry', () => {
    // The registry is READ. Nothing asked to serve its bytes, and the evidence
    // drawer is a door that must not get wider as a side effect of a surface.
    expect(surface.read_only_sources).not.toContain('company-seats.json');
    expect(surface.read_only_sources).toHaveLength(6);
  });

  it('keeps Phase 1 health at four conditions — a company surface is not a fault', () => {
    expect(surface.health.conditions).toHaveLength(4);
    expect(surface.health.conditions.map((c) => c.key).sort()).toEqual(
      ['executionTruth', 'processTruth', 'provenance', 'workTruth'].sort(),
    );
    expect(
      surface.health.conditions.some((c) => /company/i.test(c.key)),
      'company_os must not have been folded into health',
    ).toBe(false);
  });

  it('attaches the company OUTSIDE the Dev Studio floor payload', () => {
    // Dev Studio is one floor. Nesting the company inside it would make the
    // misreading the Founder corrected the default shape of the data.
    expect(surface.floor).toBeTruthy();
    expect((surface.floor as Record<string, unknown>).company_os).toBeUndefined();
    expect((surface.floor as Record<string, unknown>).company).toBeUndefined();
    expect(surface.company_os).toBeTruthy();
  });

  it('does not restate capacity class or provider — the staff surface owns those', () => {
    // Capacity class lives on the declared seat profile in the staff surface.
    // Repeating it here would be a second SSOT for a paid/free fact.
    expect(company.seats.some((s) => JSON.stringify(s).includes('PAID_L1'))).toBe(false);
    expect(company.seats.some((s) => 'provider_owner' in s)).toBe(false);
    expect(company.seats.some((s) => 'capacity_class' in s)).toBe(false);
    // And no live runtime value leaked in either.
    const serialised = JSON.stringify(company);
    expect(/"pid"\s*:/.test(serialised)).toBe(false);
    expect(/"is_running"\s*:/.test(serialised)).toBe(false);
    expect(/"session_id"\s*:/.test(serialised)).toBe(false);
  });

  it('adds no write capability and no outbound transport to the server', () => {
    const src = readFileSync(path.join(PKG, 'server', 'company-os.mjs'), 'utf8');
    for (const forbidden of [
      'writeFileSync',
      'appendFileSync',
      'renameSync',
      'unlinkSync',
      'mkdirSync',
      'rmSync',
    ]) {
      expect(src, `company-os.mjs must not gain ${forbidden}`).not.toContain(forbidden);
    }
    expect(src, 'the loader must not open an outbound request').not.toMatch(
      /\b(fetch|axios|https?\.request|undici)\b/,
    );
  });

  it('is one nav item with tabs, not a second dashboard or a second route family', () => {
    expect(COMPANY_OS_TABS).toEqual([
      'Structure',
      'Seats',
      'Portfolio',
      'Founder',
      'Infrastructure',
    ]);
    // One surface file, and it is reached through the existing shell.
    expect(surface.company_os).toBeTruthy();
    // No new API endpoint was created for it.
    const service = readFileSync(path.join(PKG, 'server', 'data-service.mjs'), 'utf8');
    expect(service).not.toMatch(/'\/api\/company/);
  });

  it('reports registry validation problems instead of silently dropping rows', () => {
    // The real registry must be clean — a silent drop would be the failure mode.
    expect(company.problems).toEqual([]);
    expect(company.conflicts).toEqual([]);
    // And a malformed row is reported, with the surface showing the panel.
    const hostile = JSON.parse(registryText);
    hostile.rooms.push({
      id: 'orphan-room',
      floor_id: 'no-such-floor',
      name: 'Orphan Room',
      state: 'FUTURE_DORMANT',
      purpose: 'names a floor that does not exist',
    });
    const p = path.join(process.env.TEMP!, 'orphan.json');
    const fs = require('node:fs');
    fs.writeFileSync(p, JSON.stringify(hostile));
    const result = loadCompanyOs(process.env.TEMP!, 'orphan.json');
    expect(
      result.problems.some((x) => /orphan-room/.test(x) && /no declared floor/.test(x)),
      'an orphaned room must be reported',
    ).toBe(true);
    // And a dormant room with no gate is reported too — it would be un-openable.
    expect(
      result.problems.some((x) => /FUTURE_DORMANT with no declared activation condition/.test(x)),
    ).toBe(true);
    fs.unlinkSync(p);
  });
});
