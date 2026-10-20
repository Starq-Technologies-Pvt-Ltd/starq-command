import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BuildingProjection, CommandSurface } from '@/lib/contracts';
import { parseBuildingRoute } from '@/lib/building-route';
import { BuildingSurface } from '@/surfaces/building';

/**
 * CMD-DI-2-4 — Evidence -> Rooms read-only conversation record.
 *
 * The peer under test is `EvidenceRoomsPeer` in src/surfaces/building.tsx,
 * dispatched at the `tab === 'Rooms'` branch. It is NOT evidence.tsx, which
 * owns Sources only. There is no src/surfaces/room.tsx and none is created.
 *
 * The claim under test is the honesty claim: Command renders the conversation
 * record it can prove, and states the unavailability of what it cannot — rather
 * than synthesizing a message, rendering absence as an empty conversation, or
 * implying a healthy conversation that was never read.
 */

const building: BuildingProjection = {
  authority: 'STARQ',
  access: 'READ_ONLY',
  company: 'Starq Technologies',
  floor: 'Dev Studio',
  capacity: { state: 'UNKNOWN', reason: 'not declared' },
  projects: [
    {
      id: 'erp',
      name: 'starqERP',
      classification: 'OCCUPIED',
      state: 'HOLD',
      source: '00_STARQ_HQ/operations/starqerp-control-board/contract.json',
    },
    {
      id: 'hoadha',
      name: 'Hoadha',
      classification: 'PREPARED',
      state: 'NOT STARTED',
      source: '03_PROJECTS/hoadha/HOADHA_DEV_STUDIO/roadmap.machine.json',
    },
  ],
  sources: [
    {
      source: '03_PROJECTS/hoadha/HOADHA_DEV_STUDIO/roadmap.machine.json',
      state: 'AVAILABLE',
      sha256: 'abc123',
      modified_at: '2026-10-10T00:00:00.000Z',
      reason: 'read',
    },
  ],
  erp_tasks: null,
  note: 'test projection',
  hoadha: {
    integrity: 'SOURCE_READ',
    source_status: 'AVAILABLE',
    current_wave: 'NONE',
    execution: 'NOT STARTED',
    execution_basis: 'NONE',
    production: 'UNVERIFIED',
    integration: 'UNVERIFIED',
    loops: [],
    blockers: [],
    boards: [],
    live_count: null,
    proposed_count: null,
    proposed: [],
    waves: [],
    stages: [],
    evidence: [],
    board_snapshot: null,
  },
};

/** A projection whose execution truth IS readable, with a declared ledger. */
function surfaceWithLedger(overrides: Record<string, unknown> = {}): CommandSurface {
  return {
    building,
    execution_truth: {
      available: true,
      state: 'READY',
      reason: null,
      generated_at: '2026-10-10T12:00:00.000Z',
      ledger: {
        recorded_sha256_prefix: 'deadbeef',
        live_sha256_prefix: 'deadbeef',
        state: 'OK',
        reason: null,
        records_total: 8537,
        broker_records: 8350,
        max_broker_sequence: 8344,
      },
      agents: [],
      activity_events: [],
      conflicts: [],
    },
    process_truth: {
      execution_truth_layer_meta: {
        activity_ledger: {
          path: 'agent-comms/room.jsonl',
          access: 'READ_ONLY',
        },
      },
    },
    ...overrides,
  } as unknown as CommandSurface;
}

function renderRooms(surface: CommandSurface): string {
  return renderToStaticMarkup(
    <BuildingSurface route={parseBuildingRoute('#evidence/rooms')} surface={surface} />,
  );
}

/** The peer that OWNS the ledger anchor, for cross-peer ownership assertions. */
function renderHashes(surface: CommandSurface): string {
  return renderToStaticMarkup(
    <BuildingSurface route={parseBuildingRoute('#evidence/hashes')} surface={surface} />,
  );
}

describe('CMD-DI-2-4 · CORRECTIVE #1 — ledger status is not conversation-record state', () => {
  // Vision rejected the previous candidate for exactly this: with
  // execution_truth.available=true and ledger.state='OK', the panel rendered
  // "Conversation record — OK". contracts.ts establishes activity-ledger
  // information only; it never establishes that a conversation record exists.
  it('renders ledger.state as an ACTIVITY-LEDGER status', () => {
    const html = renderRooms(surfaceWithLedger());
    expect(html).toMatch(/Activity ledger status[\s\S]{0,400}>OK</);
  });

  it('never presents ledger.state as the conversation-record state', () => {
    const html = renderRooms(surfaceWithLedger());
    // The panel badge sits beside the title "Conversation record". It must not
    // carry the ledger's value, in any state.
    expect(html).not.toMatch(/Conversation record[\s\S]{0,60}>OK</);
    expect(html).not.toMatch(/>OK<\/span>[\s\S]{0,400}Conversation record/);
    // The conversation-record rows must be UNDECLARED / UNKNOWN, never the
    // ledger's 'OK'.
    expect(html).toMatch(/Conversation record[\s\S]{0,300}>UNDECLARED</);
    expect(html).toMatch(/Conversation record state[\s\S]{0,300}>UNKNOWN</);
  });

  it('reports the conversation record as undeclared even when the ledger is healthy', () => {
    for (const ledgerState of ['OK', 'STALE', 'UNAVAILABLE', 'UNREADABLE']) {
      const html = renderRooms(
        surfaceWithLedger({
          execution_truth: {
            available: true,
            state: 'READY',
            reason: null,
            ledger: {
              recorded_sha256_prefix: 'deadbeef',
              live_sha256_prefix: 'deadbeef',
              state: ledgerState,
              reason: null,
              records_total: 8537,
              broker_records: 8350,
              max_broker_sequence: 8344,
            },
            agents: [],
            activity_events: [],
            conflicts: [],
          },
        }),
      );
      expect(html, `ledger ${ledgerState}`).toContain('UNDECLARED');
      expect(html, `ledger ${ledgerState}`).toMatch(/Conversation record state[\s\S]{0,300}>UNKNOWN</);
    }
  });

  it('asserts no canonical backing relationship between ledger and conversation', () => {
    const html = renderRooms(surfaceWithLedger());
    // The rejected wording asserted a backing relationship the contract lacks.
    expect(html).not.toContain('canonical ledger backs');
    expect(html).not.toContain('backs every conversation record');
    expect(html).not.toContain('backed by');
    // The corrected wording states the absence of an authorized contract.
    expect(html).toContain('No conversation contract is declared');
    expect(html).toContain('rather than inferred');
    // And states that no conclusion is drawn from the ledger.
    expect(html).toContain('draws no conclusion about a conversation record');
  });

  it('ADVERSARIAL REGRESSION: the peer must not map ledger.state into conversation state', async () => {
    // Source-level guard. A future edit that reintroduces the mapping would
    // render a confident state for a record the contract never declares, and
    // renderToStaticMarkup alone would not catch a subtle reintroduction.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'surfaces', 'building.tsx'), 'utf8');

    const start = src.indexOf('function EvidenceRoomsPeer');
    const end = src.indexOf('\nfunction ', start + 1);
    const peerRaw = src.slice(start, end === -1 ? undefined : end);
    expect(peerRaw.length).toBeGreaterThan(0);

    // Count CODE, not prose. This peer documents the rejected past behaviour in
    // comments, and those comments legitimately name `et.ledger?.state`.
    const peer = peerRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // 1. The ledger state may be read ONLY inside an activity-ledger row.
    const reads = [...peer.matchAll(/et\.ledger\??\.state/g)];
    expect(reads.length, `expected exactly one ledger.state read in code, found ${reads.length}`).toBe(1);

    // 2. The conversation-record rows must be literal, never derived.
    expect(peer).toMatch(/\[\s*'Conversation record',\s*<span/);
    expect(peer).toMatch(/\[\s*'Conversation record state',\s*<span/);
    // Neither row may interpolate a ledger value.
    expect(peer).not.toMatch(/'Conversation record',\s*[^<]*et\.ledger/);
    expect(peer).not.toMatch(/'Conversation record state',\s*[^<]*et\.ledger/);

    // 3. The panel badge must not be derived from the ledger.
    const panel = peer.slice(peer.indexOf('<Panel title="Conversation record"'));
    expect(panel.slice(0, 200)).toMatch(/count="UNDECLARED"/);

    // 4. No mapping helper may exist in this peer at all.
    expect(peer).not.toMatch(/conversationState\s*=|conversation.*state\s*=\s*et\.ledger/i);
  });
});

describe('CMD-DI-2-4 · Evidence -> Rooms renders the authoritative conversation record', () => {
  it('renders the ledger identity and state declared by the projection', () => {
    const html = renderRooms(surfaceWithLedger());
    expect(html).toContain('Conversation record');
    // The ledger status is labelled as the ledger's, and asserted as such.
    expect(html).toMatch(/Activity ledger status[\s\S]{0,400}>OK</);
    expect(html).toContain('Ledger reason');
  });

  it('labels ledger counts as global rather than per-room', () => {
    const html = renderRooms(surfaceWithLedger());
    // A global ledger must never read as a property of the selected room.
    expect(html).toContain('not partitioned by project room');
  });

  it('does NOT duplicate the ledger anchor owned by Evidence -> Hashes', () => {
    const html = renderRooms(surfaceWithLedger());
    // SEQ 8417 CORRECTION 3 removed exactly this duplication from System >
    // Sources. These facts belong to the anchor peer and must not reappear here.
    expect(html).not.toContain('Ledger lines (physical)');
    expect(html).not.toContain('Broker records (envelopes)');
    expect(html).not.toContain('Max broker sequence');
    expect(html).not.toContain('Recorded hash');
    expect(html).not.toContain('Live hash');
    // Nor the raw counts themselves.
    expect(html).not.toContain('8537');
    expect(html).not.toContain('8350');
    expect(html).not.toContain('8344');
    expect(html).not.toContain('deadbeef');
    // Instead it points at the owning peer.
    expect(html).toContain('Open the ledger anchor');
    expect(html).toContain('#evidence/hashes');
  });

  it('distinguishes the three ledger quantities by name in the owning peer', () => {
    // The disambiguation must survive where it lives — in Hashes, untouched.
    const html = renderHashes(surfaceWithLedger());
    expect(html).toContain('Ledger lines (physical)');
    expect(html).toContain('Broker records (envelopes)');
    expect(html).toContain('Max broker sequence');
  });
});

describe('CMD-DI-2-4 · message bodies are declared unavailable, never synthesized', () => {
  it('states message bodies are unavailable and gives the reason', () => {
    const html = renderRooms(surfaceWithLedger());
    expect(html).toContain('Message bodies');
    expect(html).toContain('not available to Command');
  });

  it('does not invent a single message record', () => {
    const html = renderRooms(surfaceWithLedger());
    // House row markup is data-work-row / work-row-list, so a message list
    // written to house style WOULD pass a naive element check. Assert on the
    // house markers plus the English affordances a writer would actually use.
    expect(html).not.toContain('data-message-');
    expect(html).not.toContain('data-work-row="message');
    expect(html).not.toMatch(/aria-label="[^"]*message/i);
    for (const verb of ['Send', 'Reply', 'Compose', 'Post ', 'Add note', 'New entry', 'Delete', 'Edit']) {
      expect(html, `write affordance "${verb}" present`).not.toContain(verb);
    }
    // Absence must never be rendered as an empty-but-healthy conversation.
    expect(html).not.toContain('Conversation is empty');
    expect(html).not.toContain('0 messages');
    expect(html).not.toContain('No messages');
  });

  it('explains all three causes of unavailability', () => {
    const html = renderRooms(surfaceWithLedger());
    expect(html).toContain('No parsed message contract exists');
    expect(html).toContain('refuses to inline any file above a fixed 8 MiB cap');
    expect(html).toContain('conversation partitioning is undefined');
  });
});

describe('CMD-DI-2-4 · read-only boundary is intact', () => {
  it('exposes no write affordance anywhere in the peer', () => {
    const html = renderRooms(surfaceWithLedger());
    expect(html).not.toMatch(/method="post"/i);
    expect(html).not.toMatch(/method="put"/i);
    expect(html).not.toMatch(/method="patch"/i);
    expect(html).not.toMatch(/method="delete"/i);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/contenteditable/i);
    expect(html).not.toMatch(/onSubmit/i);
  });

  it('introduces no hidden mutation path in source (rendered HTML cannot show one)', async () => {
    // A fetch(..., { method: 'POST' }) written into this peer produces ZERO bytes
    // in renderToStaticMarkup, so the assertions above cannot observe it. The
    // check has to be made against the source of the peer itself.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'surfaces', 'building.tsx'), 'utf8');

    // Isolate the peer so unrelated fetchers elsewhere in the file cannot mask it.
    const start = src.indexOf('function EvidenceRoomsPeer');
    const after = src.indexOf('\n/**', start + 1);
    const peer = src.slice(start, after === -1 ? undefined : after);

    expect(peer.length).toBeGreaterThan(0);
    expect(peer, 'peer performs a fetch').not.toMatch(/fetch\s*\(/);
    expect(peer, 'peer issues a mutating verb').not.toMatch(/method\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    expect(peer, 'peer opens a socket').not.toMatch(/XMLHttpRequest|sendBeacon|EventSource|WebSocket/);
    expect(peer, 'peer holds effect-driven state').not.toMatch(/useEffect/);
    // The only state hook the peer may use is selection, which is not persistence.
    const hooks = [...peer.matchAll(/React\.use([A-Za-z]+)/g)].map((m) => m[1]);
    expect([...new Set(hooks)].sort()).toEqual(['Callback', 'State']);
  });

  it('states the no-write-path guarantee in its own words', () => {
    const html = renderRooms(surfaceWithLedger());
    expect(html).toContain('exposes no write path to the ledger');
  });
});

describe('CMD-DI-2-4 · unavailable truth is preserved as unavailable', () => {
  // The fixture deliberately carries a POPULATED ledger alongside
  // available:false. If the availability gate were removed, these counts would
  // render — so these assertions can actually fail, which they could not when the
  // fixture merely omitted `ledger`.
  function unreadableTruth(): CommandSurface {
    return surfaceWithLedger({
      execution_truth: {
        available: false,
        state: 'UNAVAILABLE',
        reason: 'room ledger not found',
        ledger: {
          recorded_sha256_prefix: 'deadbeef',
          live_sha256_prefix: 'deadbeef',
          state: 'OK',
          reason: null,
          records_total: 8537,
          broker_records: 8350,
          max_broker_sequence: 8344,
        },
        agents: [],
        activity_events: [],
        conflicts: [],
      },
    });
  }

  it('renders an absent read as UNKNOWN, never as an empty conversation', () => {
    const html = renderRooms(unreadableTruth());
    expect(html).toContain('Conversation record');
    expect(html).toContain('room ledger not found');
    // Corrective #1: the badge reports the conversation record, not the ledger,
    // so an unreadable ledger does not downgrade it to a ledger-derived state.
    expect(html).toContain('UNDECLARED');
    // An absent read is an absent read.
    expect(html).toContain('not an empty conversation');
  });

  it('leaks no count or hash into the unavailable branch', () => {
    const html = renderRooms(unreadableTruth());
    // Each of these exists in the fixture and would render if the gate were gone.
    expect(html, 'records_total leaked').not.toContain('8537');
    expect(html, 'broker_records leaked').not.toContain('8350');
    expect(html, 'max_broker_sequence leaked').not.toContain('8344');
    expect(html, 'ledger hash leaked').not.toContain('deadbeef');
    // And it must not claim freshness it could not establish.
    expect(html).not.toMatch(/Conversation record[\s\S]{0,300}>OK</);
  });

  it('does not claim ledger freshness it could not establish', () => {
    const html = renderRooms(
      surfaceWithLedger({
        execution_truth: {
          available: true,
          state: 'STALE',
          reason: 'room ledger changed since last ingest; regeneration required',
          ledger: {
            recorded_sha256_prefix: 'aaaa',
            live_sha256_prefix: 'bbbb',
            state: 'STALE',
            reason: 'room ledger changed since last ingest; regeneration required',
            records_total: null,
            broker_records: null,
            max_broker_sequence: null,
          },
          agents: [],
          activity_events: [],
          conflicts: [],
        },
      }),
    );
    // The ledger's own status and reason surface, labelled as the ledger's.
    expect(html).toMatch(/Activity ledger status[\s\S]{0,400}>STALE</);
    expect(html).toContain('regeneration required');
    // And the conversation record is still undeclared, not STALE. Compare the
    // segment BETWEEN the two adjacent labels rather than using a fixed window,
    // which would otherwise span into the ledger row and false-positive.
    const from = html.indexOf('Conversation record state');
    const to = html.indexOf('Activity ledger status');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const stateSegment = html.slice(from, to);
    expect(stateSegment).toContain('UNKNOWN');
    expect(stateSegment, 'conversation-record state must not take the ledger value').not.toContain(
      'STALE',
    );
    expect(html).toContain('UNDECLARED');
  });
});

describe('CMD-DI-2-4 · provenance and the pre-existing room index are preserved', () => {
  it('still renders the per-room provenance index', () => {
    const html = renderRooms(surfaceWithLedger());
    expect(html).toContain('Room provenance index');
    expect(html).toContain('starqERP');
    expect(html).toContain('Hoadha');
  });

  it('keeps a room whose source is not in the census at UNKNOWN, not AVAILABLE', () => {
    const html = renderRooms(surfaceWithLedger());
    // erp's source is deliberately absent from `building.sources`.
    expect(html).toContain('1/2');
    expect(html).toContain('UNKNOWN');
    expect(html).toContain('not in the declared source census');
  });

  it('preserves the declaring source path for the selected room', () => {
    const html = renderRooms(surfaceWithLedger());
    expect(html).toContain('Declaring source');
    // The detail pane shows the FIRST declared room (erp) by default; its source
    // is deliberately absent from the census, which is the absent-read case.
    expect(html).toContain('starqerp-control-board/contract.json');
    expect(html).toContain('not in the declared source census');
  });
});

describe('CMD-DI-2-4 · Work / Evidence-Rooms separation', () => {
  it('renders no Work concept and does not claim package ownership', () => {
    const html = renderRooms(surfaceWithLedger());
    expect(html).not.toContain('Work package');
    expect(html).not.toContain('work-package');
    expect(html).not.toContain('WorkPackage');
    expect(html).not.toContain('board_lane');
    expect(html).not.toContain('work_packages');
    // Work is a DELIVERY concept and must not appear in Evidence at all.
    expect(html).not.toContain('Delivery');
  });

  it('states the Rooms question as a room question, not a work question', () => {
    const html = renderRooms(surfaceWithLedger());
    // Attributes to THIS change, not to a router-emitted data-peer label that
    // is present on every evidence peer regardless of implementation.
    expect(html).toContain('Conversation record');
    expect(html).toContain('not partitioned by project room');
    expect(html).toContain('no write path to the ledger');
  });

  it('does not repurpose the Rooms peer into a Work surface', () => {
    const html = renderRooms(surfaceWithLedger());
    // The Work surface owns board lanes and package identity. Neither may appear.
    expect(html).not.toContain('Lane');
    expect(html).not.toContain('verifier');
    expect(html).not.toContain('current_stage');
    // And the conversation surface must remain conversation-scoped.
    expect(html).toContain('Conversation record');
  });
});

describe('CMD-DI-2-4 · no duplicate Room surface and no ownership migration', () => {
  it('dispatches Rooms from building.tsx, not from evidence.tsx', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const root = process.cwd();
    const buildingSrc = readFileSync(path.join(root, 'src', 'surfaces', 'building.tsx'), 'utf8');
    const evidenceSrc = readFileSync(path.join(root, 'src', 'surfaces', 'evidence.tsx'), 'utf8');

    // Rooms is dispatched here and lives here.
    expect(buildingSrc).toContain('EvidenceRoomsPeer');
    expect(buildingSrc).toContain("tab === 'Rooms'");

    // evidence.tsx must not RENDER or DISPATCH Rooms. It legitimately records
    // the ownership map ("room_index: 'Evidence -> Rooms'"), which is the
    // ownership statement, not a migration — so the assertion is on dispatch and
    // rendering, not on the word appearing anywhere in the file.
    expect(evidenceSrc).not.toContain("tab === 'Rooms'");
    expect(evidenceSrc).not.toContain('EvidenceRoomsPeer');
    expect(evidenceSrc).not.toContain('peer="Rooms"');
    expect(evidenceSrc).not.toContain('EvidencePeer');
    // The ownership map still points at Evidence -> Rooms, unchanged.
    expect(evidenceSrc).toContain("room_index:");
    expect(evidenceSrc).toContain('Rooms');
    expect(evidenceSrc).toContain('peer="Sources"');
  });

  it('does not create the forbidden src/surfaces/room.tsx', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    expect(fs.existsSync(path.join(process.cwd(), 'src', 'surfaces', 'room.tsx'))).toBe(false);
  });
});

describe('CMD-DI-2-4 · accepted CMD-DI-2-2 project/route behavior is not regressed', () => {
  // Behavioural, not a grep. The accepted 2-2 contract is that projectIdFromRoute
  // accepts a generic project id and REJECTS a reserved Studio token, falling
  // back to a valid hash rather than routing nowhere.
  it('still accepts a generic project id from the route', async () => {
    const { projectIdFromRoute } = await import('@/lib/building-route');
    expect(projectIdFromRoute('#studio/mercury')).toBe('mercury');
    expect(projectIdFromRoute('#studio/acme-widgets')).toBe('acme-widgets');
    expect(projectIdFromRoute('#studio/projects/board?project_id=mercury')).toBe('mercury');
  });

  it('still rejects reserved Studio tokens as project ids', async () => {
    const { projectIdFromRoute, STUDIO_TABS } = await import('@/lib/building-route');
    for (const reserved of STUDIO_TABS.map((t) => t.toLowerCase())) {
      expect(projectIdFromRoute(`#studio/${reserved}`), `"${reserved}" must be reserved`).toBeNull();
      // A reserved token in the query must not become a project id either.
      expect(
        projectIdFromRoute(`#studio/projects/board?project_id=${reserved}`),
        `query "${reserved}" must be reserved`,
      ).toBeNull();
    }
  });

  it('still preserves a valid hash project when the query token is reserved', async () => {
    // The accepted 2-2 behaviour: a reserved query token does not ERASE a valid
    // hash project id.
    const { projectIdFromRoute } = await import('@/lib/building-route');
    expect(projectIdFromRoute('#studio/mercury/board?project_id=projects')).toBe('mercury');
  });

  it('still renders a generic project board end to end', () => {
    const generic = surfaceWithLedger();
    const html = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#studio/projects/board')} surface={generic} />,
    );
    // A generic project must reach a rendered board, not an empty pane.
    expect(html).toContain('room-root');
    expect(html.length).toBeGreaterThan(600);
    expect(html).not.toContain('This route names no project room');
  });

  it('leaves the canonical six Studio tabs untouched', async () => {
    const { STUDIO_TABS } = await import('@/lib/building-route');
    expect(STUDIO_TABS).toEqual(['Overview', 'Staff', 'Projects', 'Capacity', 'Activity', 'Herdr']);
  });

  it('does not alter the Evidence peer dispatch order', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'surfaces', 'building.tsx'), 'utf8');
    // Scope to the EvidencePeer function only. Slicing to end-of-file would
    // also count SystemSurface's own `tab === 'Sources'` branch.
    const start = src.indexOf('function EvidencePeer');
    const end = src.indexOf('\nfunction ', start + 1);
    const peer = src.slice(start, end === -1 ? undefined : end);
    expect(peer.length).toBeGreaterThan(0);

    const order = ['Sources', 'Projection', 'Hashes', 'Rooms'];
    const positions = order.map((t) => peer.indexOf(`tab === '${t}'`));
    // Every branch present, unique, and in the accepted order.
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const t of order) {
      const occurrences = peer.split(`tab === '${t}'`).length - 1;
      expect(occurrences, `tab === '${t}' appears ${occurrences} times`).toBe(1);
    }
    // Rooms must receive the surface it needs and evidence.tsx must not.
    expect(peer).toContain('<EvidenceRoomsPeer building={building} surface={surface} />');
  });
});