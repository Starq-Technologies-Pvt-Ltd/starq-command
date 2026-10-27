/**
 * Building router.
 *
 * This is the only place that decides which surface renders for a given route.
 * Everything below it is a surface; everything above it is the shell.
 *
 * ROOM ACCENT SCOPING
 *
 * `.room-root[data-room=...]` sets `--room` / `--room-soft` for the whole
 * subtree. That is how ERP (cyan) and Hoadha (violet) share one visual
 * language and still read as two different rooms. Nested truth chips keep
 * their own tokens, so an ERP ON HOLD chip stays violet-on-violet-aware
 * instead of inheriting the room tint.
 *
 * ROOM STATE IS NOT ROUTER STATE
 *
 * This file reads hold and prepared states; it never sets, clears or infers
 * them. Room state arrives from the projection.
 */
import * as React from 'react';
import type { BuildingProjection, CommandSurface } from '@/lib/contracts';
import {
  ATTENTION_TABS,
  COMPANY_OS_TABS,
  EVIDENCE_TABS,
  ERP_TABS,
  HOADHA_TABS,
  STUDIO_TABS,
  SYSTEM_TABS,
  routeHash,
  type BuildingRoute,
} from '@/lib/building-route';
import { Chip, GoLink, KV, Panel, RoomHead, SourceGap, Stat, show } from '@/components/console';
import { UnknownValue } from '@/components/state-gate';
import { PeerWorkHeader, QualifierRow, WorkArea, WorkRow } from '@/components/work-area';
import { CompanyOverview, DevStudio, ExecutiveOverview } from '@/surfaces/company';
import { CompanyOsSurface } from '@/surfaces/company-os';
import { ErpRoom } from '@/surfaces/erp-room';
import { ProjectBoard } from '@/surfaces/project-board';
import { HoadhaRoom } from '@/surfaces/hoadha-room';
import { IntegritySurface } from '@/surfaces/integrity';
import { StaffSurface } from '@/surfaces/staff';
import { FloorSurface } from '@/surfaces/floor';
import { ProcessSurface } from '@/surfaces/process';
import { AttentionSurface } from '@/surfaces/attention';
import { EvidenceSurface } from '@/surfaces/evidence';
import { SystemSurface } from '@/surfaces/system';
import { HerdrSurface } from '@/surfaces/herdr';
import { WorkPackagesRoute } from '@/surfaces/work-packages-route';
import { StudioGroupLegend } from '@/components/shell';
import { CommandBoardSurface } from '@/surfaces/command-board';
import { PmBoardSurface } from '@/surfaces/pm-board';
import { PmPortfolioSurface } from '@/surfaces/pm-portfolio';
import { HistoricalPmSurface } from '@/surfaces/historical-pm';

/**
 * CMD-PM-MIN. The writable PM boards need only the PM service, so they are
 * mounted without waiting for the Building projection. `standalone` routes
 * render even when that projection is unavailable.
 */
function pmRouteFor(route: BuildingRoute): { project: 'command' | 'erp' | 'hoadha' | null; standalone: boolean } | null {
  if (route.view !== 'studio') return null;
  if (route.projectId?.toLowerCase() === 'command') return { project: 'command', standalone: true };
  if (route.room === 'erp' && route.tab === 'Tasks') return { project: 'erp', standalone: false };
  if (route.room === 'hoadha' && route.tab === 'Board') return { project: 'hoadha', standalone: false };
  if (route.room === null && !route.projectId && route.tab === 'Projects') return { project: null, standalone: false };
  return null;
}

/**
 * Tab rail.
 *
 * Counts are attached per tab so navigation itself carries information: an
 * operator can see that Board holds 326 live records before entering it.
 */
function TabRail({
  route,
  tabs,
  counts,
}: {
  route: BuildingRoute;
  tabs: readonly string[];
  counts?: Record<string, React.ReactNode>;
}) {
  return (
    <nav className="command-tabs" aria-label="Sections">
      {tabs.map((tab) => (
        <a
          key={tab}
          href={routeHash({ ...route, tab })}
          aria-current={route.tab === tab ? 'page' : undefined}
        >
          {tab}
          {counts?.[tab] !== undefined && counts?.[tab] !== null ? (
            <span className="count">{counts[tab]}</span>
          ) : null}
        </a>
      ))}
    </nav>
  );
}

function CompanyPeerRail({ route, tabs }: { route: BuildingRoute; tabs: readonly string[] }) {
  return <TabRail route={route} tabs={tabs} />;
}

/**
 * Founder Attention peers.
 *
 * GAP MAP WF-ATT-02: Exceptions, Conflicts, Holds and History were compact
 * key/value cards while Decisions was a giant grouped article — one destination
 * behaving like a working queue on one tab and a report on another.
 *
 * All five now render through the SAME `AttentionQueue`, which owns the
 * list/detail composition. This function no longer builds rows itself: it hands
 * the peer name to the surface and the surface selects over declared canonical
 * fields. That is the whole correction — the peer differences are now DATA
 * differences, not component differences, so they cannot drift apart.
 */
function AttentionPeer({ tab, surface }: { tab: string; surface: CommandSurface }) {
  return <AttentionSurface surface={surface} peer={tab} />;
}

/**
 * Evidence peers.
 *
 * GAP MAP WF-EVD-01, WF-EVD-02, WF-WRONG-02.
 *
 * WHAT WAS WRONG: Sources rendered the full source table AND the projection
 * provenance block below it, so the default peer was a source inventory wall
 * with provenance stacked underneath — even though Projection and Hashes each
 * had a dedicated peer. Full paths, timestamps and hashes dominated the first
 * comparison label, which is what the product means by exposing implementation
 * structure instead of helping the operator inspect a claim.
 *
 * THE OWNERSHIP SPLIT, and why Evidence and System stop being interchangeable:
 *
 *   SOURCES     this peer's job. Compact comparable rows keyed on role, state
 *               and freshness; full path and hash on selection only.
 *   PROJECTION  how the projection was ASSEMBLED — dimensions, checks, the
 *               generated timestamp. Moved here from Sources.
 *   HASHES      the recorded/live comparison that proves which bytes were read.
 *   DECISIONS   where a Founder decision record's provenance comes from.
 *   ROOMS       room provenance and index. Read-only; no mirroring, no ack.
 *
 * Evidence answers "where did this claim come from". System answers "is Command
 * healthy". Neither renders the other's table.
 */
function EvidencePeer({ tab, building, surface }: { tab: string; building?: BuildingProjection; surface: CommandSurface }) {
  if (tab === 'Sources') return <EvidenceSurface surface={surface} />;
  if (tab === 'Projection') return <EvidenceProjectionPeer surface={surface} />;
  if (tab === 'Hashes') return <EvidenceHashesPeer surface={surface} />;
  if (tab === 'Rooms') {
    if (!building)
      return (
        <SourceGap
          reason="Room provenance index UNAVAILABLE."
          detail="Building projection unavailable. Room identities and source census cannot be established."
        />
      );
    return <EvidenceRoomsPeer building={building} surface={surface} />;
  }
  return <EvidenceDecisionsPeer surface={surface} />;
}

/**
 * PROJECTION — assembly dimensions, NOT the source list (WF-EVD-02).
 *
 * The provenance summary that Sources used to render below its table is here,
 * where the product contract puts it. It reports what was checked and what
 * state resulted; the per-source hash comparison lives on Hashes.
 */
function EvidenceProjectionPeer({ surface }: { surface: CommandSurface }) {
  const prov = surface.provenance;
  const et = surface.execution_truth;
  return (
    <>
      <PeerWorkHeader
        peer="Projection"
        question="How was this projection assembled, and what state did each dimension report?"
      />
      <QualifierRow>
        <span>provenance {prov?.state ?? 'UNKNOWN'}</span>
        <span>{prov?.checked ?? 'UNKNOWN'} sources checked</span>
        <span>generated {et.generated_at ?? 'UNKNOWN'}</span>
      </QualifierRow>
      <Panel title="Projection assembly" count={`${prov?.checked ?? 'UNKNOWN'} checked`}>
        <div className="body">
          <KV
            rows={[
              ['Provenance state', prov?.state ?? 'UNKNOWN'],
              ['Sources checked', prov?.checked ?? 'UNKNOWN'],
              ['Drifted', prov?.drifted?.join(', ') || 'none declared'],
              ['Missing', prov?.missing?.join(', ') || 'none declared'],
              ['Reason', prov?.reason ?? 'UNKNOWN'],
              ['Execution state', et.state],
              ['Projection generated', et.generated_at ?? 'UNKNOWN'],
            ]}
          />
          <p className="mt-3 text-2xs text-muted-foreground">
            Agreement here is what makes the projection trustworthy. It proves which bytes were
            read, not that what those bytes say is correct, deployed or accepted.
          </p>
          <GoLink href="#evidence/sources">Inspect a source →</GoLink>
          <GoLink href="#evidence/hashes">Recorded vs live hashes →</GoLink>
        </div>
      </Panel>
    </>
  );
}

/** HASHES — the recorded/live ledger comparison, which is a Ledger fact. */
function EvidenceHashesPeer({ surface }: { surface: CommandSurface }) {
  const et = surface.execution_truth;
  const meta = surface.process_truth.execution_truth_layer_meta?.activity_ledger as
    | Record<string, unknown>
    | undefined;
  const m = (k: string) => {
    const v = meta?.[k];
    return v === null || v === undefined || v === '' ? 'UNKNOWN' : String(v);
  };
  return (
    <>
      <PeerWorkHeader
        peer="Hashes"
        question="Which bytes did the last ingest record, and how do they compare to the live ledger now?"
      />
      {!et.available ? (
        <Panel title="Ledger anchor">
          <SourceGap reason={et.reason ?? 'execution truth unavailable'} />
        </Panel>
      ) : (
        <Panel title="Ledger anchor" count={et.ledger?.state ?? 'UNKNOWN'}>
                  <div className="body">
                    {/*
                      THESE THREE NUMBERS, EXPLAINED (seq 8411).

                      Founder QA seq 8410 measured this peer rendering three adjacent
                      counts — Records 8537, Broker records 8350, Max broker sequence
                      8344 — under labels that did not distinguish what each one
                      counted. An operator cannot tell them apart, and two of them
                      differing by ~190 invites exactly the wrong inference: that
                      records are missing.

                      They are three different quantities and the labels now say which:

                        Ledger lines      every physical line in room.jsonl
                        Broker records    lines carrying a broker record envelope
                        Max broker seq    the highest brokerSequence assigned

                      The gap between the first two is non-envelope lines (comments,
                      separators), which is a property of the file format, not a loss
                      of records. That distinction is stated rather than left for the
                      operator to infer from two numbers that disagree.
                    */}
                    <p className="tier-prose mb-2">
                      Three different quantities, in one file: physical lines, broker-record envelopes, and
                      the highest assigned sequence.
                    </p>
                    <KV
                      rows={[
                        ['Ledger path', m('path')],
                        ['Access', m('access')],
                        ['Ledger lines (physical)', et.ledger?.records_total ?? 'UNKNOWN'],
                        ['Broker records (envelopes)', et.ledger?.broker_records ?? 'UNKNOWN'],
                        ['Max broker sequence (highest assigned)', et.ledger?.max_broker_sequence ?? 'UNKNOWN'],
                        ['Recorded hash', et.ledger?.recorded_sha256_prefix ?? 'UNKNOWN'],
                        ['Live hash', et.ledger?.live_sha256_prefix ?? 'UNKNOWN'],
                        ['Freshness', et.ledger?.state ?? 'UNKNOWN'],
                        ['Reason', et.ledger?.reason ?? 'no reason declared'],
                        ['Projection generated', et.generated_at ?? 'UNKNOWN'],
                      ]}
                    />
                  </div>
                </Panel>
      )}
    </>
  );
}

/**
 * ROOMS — room provenance and index.
 *
 * GAP MAP WF-EVD-03, closed in the seq 8411 polish wave.
 *
 * THE DEFECT THIS FIXES
 *
 * The peer asked a two-part question — "Which canonical source declares each
 * room, and can Command read it?" — and answered only the first half. It
 * rendered a plain `KV` list of room → path and stopped. There was no read
 * verdict, no selection and no detail, so the Founder had to leave the peer and
 * find System > Sources to get the answer to the second half of the question
 * the peer itself posed. Founder QA seq 8410 measured the cost: 275px of
 * vertical budget spent returning an index.
 *
 * The primitive already existed and was already in use — Evidence > Sources
 * owns a `WorkArea` with selection and a detail pane (evidence.tsx:146). This
 * peer now uses it rather than inventing a second pattern.
 *
 * WHAT THE READ VERDICT IS, PRECISELY
 *
 * It is the DECLARED state of the room's own canonical source, as the Building
 * projection reports it. It is not a Command opinion about whether the room is
 * healthy, whether its work is progressing, or whether anyone has read it
 * lately. The peer still mirrors no ledger, acknowledges no event, and exposes
 * no write path — that sentence is retained verbatim below.
 */
function EvidenceRoomsPeer({
  building,
  surface,
}: {
  building: BuildingProjection;
  surface: CommandSurface;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const rooms = building.projects;
  const selected = rooms.find((r) => r.id === selectedId) ?? rooms[0] ?? null;

  const onSelect = React.useCallback((id: string) => setSelectedId(id), []);

  /*
    A room's read verdict comes from the Building `sources` list, which is the
    declared source census. Matching is on the declared source path, and a room
    whose source is not in the census renders UNKNOWN rather than being assumed
    readable — an absent read and a healthy read are different facts.
  */
  const readVerdict = (source: string | undefined): string => {
    if (!source) return 'UNKNOWN';
    const match = building.sources.find((s) => s.source === source);
    return match?.state ?? 'UNKNOWN';
  };

  /*
    CONVERSATION RECORD — what is authoritative, and what is not available.

    CMD-DI-2-4 asked for a read-only chronological conversation view sourced
    from room.jsonl. Before rendering anything, the availability of that source
    was checked rather than assumed. Three facts, all verified against the
    deployed code, decide what this peer may honestly show:

      1. NO MESSAGE CONTRACT EXISTS. There is no `messages`, `conversation`,
         `transcript` or `chat` field anywhere in src/lib/contracts.ts, and no
         server route parses one. `ExecutionTruth.ledger` carries three hash
         prefixes and three counts — not a single message body.

      2. THE READ PATH HAS A FIXED INLINE CAP. /api/raw refuses to inline any file
         larger than 8 MiB (server/data-service.mjs, 413 'file too large to
         inline'). This peer makes no claim about whether the ledger fits under
         that cap — it does not stat the file, and the contract supplies no
         byte count. The cap is stated; the ledger's size is not asserted.

      3. THE LEDGER IS GLOBAL, NOT PER-ROOM. It is the agent comms room ledger.
         It is not partitioned by project room, so attributing any of its counts
         to a selected room would be fabrication.

      4. THE LEDGER IS NOT A CONVERSATION RECORD. Corrective #1 (Vision). The
         contract establishes activity-ledger information — hashes, counts, a
         state and a reason. It does not establish that a conversation record
         exists, what state it is in, or that any conversation record is backed
         by this ledger. `ledger.state` is therefore never read as a
         conversation-record state, and the conversation record is reported as
         UNDECLARED regardless of how the ledger reads.

    Therefore this peer proves NO conversation record. It states that fact,
    states that message bodies are unavailable, and opens no write path. It
    does not synthesize a message, does not render an empty list as if the
    conversation were empty, and does not borrow the ledger's status to fill a
    gap the contract leaves open.

    The ledger path, access mode, counts, hashes and freshness are NOT rendered
    here. Evidence -> Hashes owns them. See the OWNERSHIP note on the panel below.
  */
  const et = surface.execution_truth;
  const ledgerKnown = et.available;

  return (
    <>
      <PeerWorkHeader
        peer="Rooms"
        question="Which canonical source declares each room, and can Command read it?"
      />
      <QualifierRow>
        <span>{rooms.length} declared rooms</span>
        {/*
          `0/0 sources readable` is a vacuously healthy fraction: it reads as
          "nothing unreadable" when in fact no room was declared at all. Absent
          is not healthy, so the absent case says so rather than rendering a
          ratio.
        */}
        {rooms.length === 0 ? (
          <span>no room declared</span>
        ) : (
          <span>
            {rooms.filter((r) => readVerdict(r.source) === 'AVAILABLE').length}/{rooms.length} sources
            readable
          </span>
        )}
        <span>conversation record · message bodies unavailable · no write path</span>
      </QualifierRow>
      <WorkArea
              label="Room provenance index"
              rows={rooms.map((r) => r.id)}
        selectedId={selected?.id ?? null}
        onSelect={onSelect}
        count={`${rooms.length} declared`}
        list={
          <ul className="work-row-list" role="listbox" aria-label="Declared rooms">
            {rooms.map((r) => {
              const verdict = readVerdict(r.source);
              return (
                <WorkRow
                  key={r.id}
                  id={r.id}
                  selected={r.id === selected?.id}
                  onSelect={onSelect}
                  tone={verdict === 'AVAILABLE' ? 'ok' : 'unknown'}
                >
                  {/* Room name leads — it is the human-facing identity — and the
                      read verdict is the comparable value. */}
                  <span className="k">{r.name}</span>
                  <span className="r">{verdict}</span>
                </WorkRow>
              );
            })}
          </ul>
        }
        detailTitle={selected ? selected.name : 'Room detail'}
        detail={
          selected ? (
            <>
              <PeerWorkHeader peer={selected.name} question={selected.classification} />
              <div className="mt-2">
                <KV
                  rows={[
                    ['Room', selected.name],
                    ['Classification', selected.classification ?? 'UNKNOWN'],
                    ['Room state', selected.state ?? 'UNKNOWN'],
                    [
                      'Source readable',
                      <span
                        key="verdict"
                        className={
                          readVerdict(selected.source) === 'AVAILABLE'
                            ? 'text-truth-ok'
                            : 'text-truth-unknown'
                        }
                      >
                        {readVerdict(selected.source)}
                      </span>,
                    ],
                  ]}
                />
              </div>
              <div className="mt-3">
                <p className="label-sec mb-1">Declaring source</p>
                {/* break-all: a truncated path is not inspectable, and this is
                    the selected-detail pane. */}
                <p className="break-all font-mono text-2xs text-muted-foreground">
                  {selected.source ?? 'UNKNOWN'}
                </p>
              </div>
              {(() => {
                const match = building.sources.find((s) => s.source === selected.source);
                return match ? (
                  <div className="mt-3 border-t border-border pt-2">
                    <p className="label-sec mb-1">Source census</p>
                    <KV
                      rows={[
                        ['Declared state', match.state],
                        ['Modified', match.modified_at ?? 'UNKNOWN'],
                        ['sha256', match.sha256 ?? 'UNKNOWN'],
                        ['Reason', match.reason ?? 'no reason declared'],
                      ]}
                    />
                  </div>
                ) : (
                  <p className="mt-3 border-t border-border pt-2 text-2xs text-truth-unknown">
                    This room's declaring source is not in the declared source census, so Command
                    cannot state whether it is readable. That is an absent read, not a healthy
                    room.
                  </p>
                );
              })()}
              <p className="mt-3 border-t border-border pt-2 text-2xs text-muted-foreground">
                Room index only. Command does not mirror the Room ledger, does not acknowledge any
                event, and exposes no write path to it.
              </p>
            </>
          ) : (
            <SourceGap reason="No room was declared by canonical source at this projection." />
          )
        }
      />
      {/*
        CONVERSATION RECORD — the read-only half of CMD-DI-2-4.

        Deliberately a separate panel below the provenance index, not merged into
        it: the index is per-room, the conversation record is global. Keeping them
        in one block would invite the operator to read a global ledger count as a
        property of whichever room is selected, which would be false.

        OWNERSHIP. This panel deliberately does NOT re-render the ledger anchor.
        `Evidence -> Hashes` owns the ledger counts, hashes and freshness
        (building.tsx, EvidenceHashesPeer), and its seq 8410/8411 comment is
        explicit that the three counts sit next to each other on purpose because
        separating them invites a wrong inference. Rendering them here too would
        give the operator two copies of the same three numbers under two
        questions — the exact duplication that SEQ 8417 CORRECTION 3 removed from
        `System > Sources`, which fixed the problem by dropping the table and
        leaving a summary plus a link.

        SEMANTICS — CORRECTIVE #1 (Vision rejection, 2026-10-10).

        An earlier revision of this panel titled the panel's value "Conversation
        record" and filled it from `et.ledger?.state`. That was a semantic
        overreach and Vision rejected it correctly.

        `ExecutionTruth.ledger` establishes ACTIVITY-LEDGER information and
        nothing more: two hash prefixes, three counts, a `state`, and a `reason`.
        It does NOT establish:
          - that a conversation record exists;
          - any state of such a record;
          - a canonical relationship in which every conversation record is
            backed by that ledger.

        Reading `ledger.state` as a conversation-record state therefore asserts a
        relationship the contract does not contain, and would render a confident
        "OK" for a conversation nobody has established exists. The panel now
        renders the ledger state ONLY as what it is — an activity-ledger status —
        and reports the conversation record itself as UNDECLARED. The absence of
        an authorized conversation contract is the fact the surface must state;
        it is not something to be papered over with a neighbouring value.
      */}
      {/*
        The count badge sits beside the title "Conversation record", so it must
        report the CONVERSATION RECORD's status and nothing else. Corrective #1:
        it is UNDECLARED unconditionally — not derived from the activity ledger,
        whose readability does not establish that a conversation record exists.
        Previously this badge was fed `et.ledger?.state`, which rendered
        "Conversation record — OK" for a record the contract never declares.
      */}
      <Panel title="Conversation record" count="UNDECLARED">
        <div className="body">
          {!ledgerKnown ? (
            <SourceGap
              reason={et.reason ?? 'execution truth unavailable'}
              detail="The activity ledger's declared state could not be read at this projection, so Command cannot state its status either. That is an absent read, not an empty conversation."
            />
          ) : (
            <>
              <p className="tier-prose mb-2">
                No conversation contract is declared. Command has no authorized source that
                establishes whether a conversation record exists or what state it is in, so that is
                reported as undeclared rather than inferred.
              </p>
              <KV
                rows={[
                  [
                    'Conversation record',
                    <span key="undeclared" className="text-truth-unknown">
                      UNDECLARED
                    </span>,
                  ],
                  [
                    'Conversation record state',
                    <span key="unknown" className="text-truth-unknown">
                      UNKNOWN
                    </span>,
                  ],
                  [
                    'Activity ledger status',
                    // Read from ExecutionTruth.ledger, and ONLY ever described as
                    // such. This value is NOT the conversation record's state and
                    // is never mapped into one.
                    et.ledger?.state ?? 'UNKNOWN',
                  ],
                  ['Ledger reason', et.ledger?.reason ?? 'no reason declared'],
                ]}
              />
              <p className="mt-3 text-2xs text-muted-foreground">
                The activity ledger is <strong>global</strong> — it is not partitioned by project
                room, so nothing below is a property of whichever room is selected above. Its path,
                access mode, line and envelope counts, hashes and freshness are owned by the anchor
                peer and stated there once. Command draws no conclusion about a conversation record
                from any of them.
              </p>
              <GoLink href="#evidence/hashes">Open the ledger anchor</GoLink>
              <div className="mt-3 border-t border-border pt-2">
                <p className="label-sec mb-1">Message bodies</p>
                <SourceGap
                  reason="Message bodies are not available to Command at this contract."
                  detail={
                    <ul className="mt-1 list-disc pl-4">
                      <li>
                        No parsed message contract exists — the projection carries ledger hashes and
                        counts, never message content.
                      </li>
                      <li>
                        The declared read path refuses to inline any file above a fixed 8 MiB cap,
                        so an archive that exceeds it is refused rather than truncated.
                      </li>
                      <li>
                        Per-project conversation partitioning is undefined; there is no channel or
                        thread identity to partition by.
                      </li>
                    </ul>
                  }
                />
              </div>
            </>
          )}
          <p className="mt-3 text-2xs text-muted-foreground">
            No message is synthesized, listed, or summarized here. Command does not compose, send,
            reply to, edit or delete any Room record, and exposes no write path to the ledger.
          </p>
        </div>
      </Panel>
    </>
  );
}

/** DECISIONS — where a Founder decision record's provenance comes from. */
function EvidenceDecisionsPeer({ surface }: { surface: CommandSurface }) {
  const pt = surface.process_truth;
  const discrepancies = pt.reconciliation?.known_discrepancies ?? [];
  return (
    <>
      <PeerWorkHeader
        peer="Decisions"
        question="Which canonical field does each Founder decision record come from?"
      />
      <Panel title="Decision record provenance" count={`${discrepancies.length} declared`}>
        <div className="body">
          <KV
            rows={[
              ['Decision records', discrepancies.length],
              ['Canonical source', 'contract.json → reconciliation.known_discrepancies'],
              ['Process authority', pt.authority ?? 'UNKNOWN'],
              ['Eligibility', 'canonical founder_decision_required flag only'],
            ]}
          />
          {discrepancies.length ? (
            <ul className="work-row-list mt-2" style={{ maxHeight: '30vh' }}>
              {discrepancies.map((d) => (
                <li className="work-row" key={d.id} data-work-row={d.id} data-tone="founder">
                  <span className="k">{d.id}</span>
                  <span className="r">{d.item}</span>
                  <span className="v">
                    {d.founder_decision_required
                      ? 'founder_decision_required = true'
                      : 'declared, not flagged as a Founder decision'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-2xs text-muted-foreground">
            A record appearing here proves the canonical field was read. It does not mean the decision
            was reviewed, accepted or acted on.
          </p>
        </div>
      </Panel>
    </>
  );
}

/**
 * System peers.
 *
 * GAP MAP WF-SYS-01, WF-SYS-02, WF-SYS-03, WF-REP-02.
 *
 * System owns Command's OWN runtime and control plane: is this process
 * healthy, what workspace did it resolve, what contract version is it reading,
 * and what is the declared input set. It does NOT own claim provenance — that
 * is Evidence — and it does not own project reconciliation, which is each
 * room's Integrity.
 *
 * The old Health landing rendered the full declared source list, the identity
 * registry and the staff-state table directly beneath the health cards, which
 * is why the surface read as a source inventory and why Evidence and System
 * were interchangeable. Those blocks now live on their named peers and Health
 * stops after health.
 */
function SystemPeer({ tab, building, surface }: { tab: string; building?: BuildingProjection; surface: CommandSurface }) {
  if (tab === 'Health') return <SystemSurface surface={surface} />;
  if (tab === 'Sources') return <SystemSourcesPeer surface={surface} building={building} />;
  if (tab === 'Runtime') return <SystemRuntimePeer surface={surface} />;
  if (tab === 'Contracts') return <SystemContractsPeer surface={surface} />;
  return <SystemProjectionPeer surface={surface} />;
}

/**
 * SOURCES — the declared input set, which is what System owns here.
 *
 * SEQ 8417 CORRECTION 3 — Evidence vs System duplication.
 *
 * This peer previously rendered BOTH the declared allowlist AND a per-source
 * reachability count, while Evidence > Sources rendered the same reachability
 * per source. Two peers answering "can Command read it" is the duplication
 * this pass removes.
 *
 * The split is now unambiguous and follows from the two questions:
 *
 *   System  > Sources  WHAT this runtime is PERMITTED to read.
 *                        The allowlist is a control-plane fact: it is what the
 *                        data service refuses to widen. It belongs here because
 *                        it is the boundary, not the evidence.
 *   Evidence > Sources  WHETHER each declared source WAS read, and what it
 *                        says. Per-source reachability, hashes and provenance
 *                        are inspection facts and belong on the inspection peer.
 *
 * So the reachability detail leaves this peer entirely and becomes a summary
 * with a link. The allowlist stays, because it is not duplicated anywhere
 * else — it is the only place the read boundary is stated as a boundary.
 */
function SystemSourcesPeer({ surface, building }: { surface: CommandSurface; building?: BuildingProjection }) {
  const declared = surface.read_only_sources ?? [];
  const reachability = building?.sources;
  const readable = reachability?.filter((s) => s.state === 'AVAILABLE').length;
  const unreadable = reachability?.filter((s) => s.state !== 'AVAILABLE') ?? [];
  return (
    <>
      <PeerWorkHeader
        peer="Sources"
        question="What is this runtime permitted to read, and what could it not reach?"
      />
      <QualifierRow>
        <span>{declared.length} declared read-only paths</span>
        <span>
          {readable ?? 'UNKNOWN'}/{reachability?.length ?? 'UNKNOWN'} declared sources reachable
        </span>
      </QualifierRow>
      <div className="command-stack">
        {/* Health summary. The per-source detail is Evidence's; this states the
            aggregate and, when something failed, names it. A summary that
            hides a failure would be worse than the duplication, so anything
            unreachable is named inline and the full inspection is one click. */}
        <Panel
          title="Source reachability"
          count={!reachability ? 'UNAVAILABLE' : unreadable.length ? `${unreadable.length} unreachable` : 'all reachable'}
        >
          <div className="body">
            {!reachability ? (
              <SourceGap
                reason="Building source census UNAVAILABLE."
                detail="Source reachability is UNKNOWN until the Building projection is available."
              />
            ) : (
              <div className="stat-rail">
                <Stat
                  k="Declared sources"
                  v={reachability.length}
                  sub="in the Building source census"
                />
                <Stat
                  k="Reachable"
                  v={readable}
                  tone={unreadable.length ? 'stale' : 'ok'}
                  sub={unreadable.length ? 'some declared inputs could not be read' : 'all declared inputs read'}
                />
              </div>
            )}
            {unreadable.length ? (
              <ul className="mt-2 space-y-1">
                {unreadable.map((s) => (
                  <li key={s.source} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <Chip value={s.state} />
                    <span className="break-all font-mono text-2xs text-muted-foreground">
                      {s.source}
                    </span>
                    {s.reason ? (
                      <span className="basis-full text-2xs text-muted-foreground">{s.reason}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3">
              <GoLink href="#evidence/sources" className="go-link-wrap">
                Inspect every source — path, state, modified time, hash and content →
              </GoLink>
            </div>
          </div>
        </Panel>
        <Panel title="Declared read-only source set" count={`${declared.length} paths`}>
          <div className="body">
            {declared.length ? (
              <ul className="grid gap-1 sm:grid-cols-2">
                {declared.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface-0/50 px-2.5 py-1.5"
                  >
                    <span className="h-1 w-1 shrink-0 rounded-full bg-truth-ok" />
                    <span className="truncate font-mono text-2xs text-muted-foreground">{p}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <SourceGap reason="No read-only source set declared at this projection." />
            )}
            <p className="mt-3 text-2xs text-muted-foreground">
              The data service refuses any path outside this list, so a projection can never quietly
              widen its own inputs. This is the boundary, stated once. Per-source reachability, hashes
              and content live on Evidence &gt; Sources.
            </p>
          </div>
        </Panel>
        <Panel title="Identity registry" count={surface.identities.available ? (surface.identities.count ?? 'UNKNOWN') : 'UNAVAILABLE'}>
          <div className="body">
            {!surface.identities.available ? (
              <UnknownValue reason={surface.identities.reason ?? 'identity registry unavailable'} />
            ) : (
              <KV
                rows={[
                  ['Registry version', surface.identities.version ?? 'UNKNOWN'],
                  ['Registered identities', surface.identities.count ?? 'UNKNOWN'],
                  [
                    'Founder presentation',
                    surface.identities.founder
                      ? `${surface.identities.founder.display_name} · @${surface.identities.founder.operational_handle}`
                      : 'UNKNOWN',
                  ],
                ]}
              />
            )}
            {/*
              LEGACY ALIASES. Kept, not removed: a legacy alias is a compatibility
              fact the operator needs when a handle in the ledger does not match a
              registered handle. It was previously rendered on the Health landing,
              which is the wrong owner for a registry detail.
            */}
            {surface.identities.available ? (
              <div className="mt-3">
                <p className="label-sec mb-1">Legacy aliases (compatibility only)</p>
                <ul className="space-y-0.5">
                  {Object.values(surface.identities.byHandle)
                    .filter((i) => i.is_legacy)
                    .map((i) => (
                      <li key={i.handle} className="text-2xs text-muted-foreground">
                        <span className="font-mono">@{i.handle}</span> → {i.legacy_alias_of} ·{' '}
                        {i.role?.slice(0, 60)}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    </>
  );
}

/**
 * RUNTIME — is Command ITSELF operating (WF-SYS-02, WF-MISS-03).
 *
 * The distinction this peer exists to make: projection health says the DATA is
 * current; runtime readiness says the PROCESS is up. Conflating them is what
 * made "Command renders" read as "Command is working". That half is delivered
 * structurally and is enforced by a gate.
 *
 * THE LAUNCHER SNAPSHOT — HONEST STATE, AND AN OPEN RESIDUAL
 *
 * `scripts/command-lifecycle.mjs` already writes `.command-runtime/state.json`
 * recording the children it owns, the ports, the PIDs, the log directory and the
 * readiness checks. Gap map WF-SYS-02 asked for that artifact to be surfaced.
 *
 * IT CANNOT BE, WITHOUT A CHANGE THIS WAVE IS NOT PERMITTED TO MAKE.
 *
 * `/api/raw` is restricted by `server/path-guard.mjs` to the canonical
 * `read_only_sources` list — control-board contract, room ledger, identities and
 * staff state. `.command-runtime/state.json` is not canonical and is not on that
 * list, and `server/data-service.mjs` is FROZEN, so the list cannot be widened
 * here. The read below therefore resolves to a refusal, and the panel renders
 * UNKNOWN.
 *
 * That is the correct rendered state, not a workaround: UNKNOWN is precisely
 * what the gap map asked for when no launcher snapshot is readable, and the
 * refusal is the frozen read guard working as designed. Reporting it as
 * anything else — a guessed READY, an empty shell, or a second origin quietly
 * serving launcher state it does not own — would be worse than the honest
 * UNKNOWN.
 *
 * The reader is kept, and kept correct, because the moment a legitimate read
 * path exists this panel starts working with no further change. It is read-only,
 * fires once when the peer opens, and adds no polling and no control action.
 * DECLARED RESIDUAL, carried to the Founder: surfacing it needs either a
 * freeze-governed widening of the canonical read set or an explicitly-owned
 * runtime origin. Both are governance acts, not implementation.
 */
function SystemRuntimePeer({ surface }: { surface: CommandSurface }) {
  /**
   * The launcher snapshot type.
   *
   * Every field is OPTIONAL because the artifact is written by a launcher that
   * may have been killed mid-write, and because a launcher from an older version
   * will not carry fields a newer one adds. An absent field is rendered UNKNOWN
   * at the point of display rather than defaulted here — defaulting in the
   * reader is how an absent diagnostic becomes a healthy-looking one.
   */
  type LauncherSnapshot = {
    state?: string;
    ports?: Record<string, number>;
    children?: { name: string; pid?: number }[];
    started_at?: string;
    ready_at?: string | null;
    readiness?: { name: string; ready: boolean }[];
  };

  const [snapshot, setSnapshot] = React.useState<LauncherSnapshot | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    /*
      Read-only GET of the launcher state artifact. There is no write verb, no
      control action and no polling loop: the read happens once when the peer is
      opened, which is the same discipline gap map WF-SYS-02 required ("do not
      add polling or control buttons in this UI round").
    */
    void (async () => {
      try {
        const res = await fetch(
          `/api/raw?path=${encodeURIComponent('.command-runtime/state.json')}`,
        );
        if (!res.ok) return;
        const body = (await res.json()) as { body?: string };
        if (typeof body?.body !== 'string' || !body.body) return;
        const parsed = JSON.parse(body.body) as LauncherSnapshot;
        if (!cancelled && parsed && typeof parsed === 'object') setSnapshot(parsed);
      } catch {
        // Absent or unreadable launcher state is UNKNOWN, never a failure. The
        // launcher may simply never have been used on this machine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const launcher = snapshot;

  return (
    <>
      <PeerWorkHeader
        peer="Runtime"
        question="Is Command itself running, on which workspace, and which ports does it own?"
      />
      <QualifierRow>
        <span>projection {surface.health?.overall ?? 'UNKNOWN'}</span>
        <span>workspace {surface.workspace.root ?? 'UNRESOLVED'}</span>
        <span>resolved via {surface.workspace.source ?? 'UNKNOWN'}</span>
      </QualifierRow>
      <div className="command-stack">
        <Panel title="Process runtime" count={launcher ? (launcher.state ?? 'UNKNOWN') : 'UNKNOWN'}>
          <div className="body">
            <KV
              rows={[
                [
                  'Launcher state',
                  launcher ? (launcher.state ?? 'UNKNOWN') : 'UNKNOWN — launcher has not run',
                ],
                ['Started', launcher?.started_at ?? 'UNKNOWN'],
                ['Ready at', launcher?.ready_at ?? 'UNKNOWN'],
                [
                  'Owned ports',
                  launcher
                    ? Object.entries(launcher.ports ?? {})
                        .map(([name, port]) => `${name} ${port}`)
                        .join(' · ') || 'UNKNOWN'
                    : 'UNKNOWN',
                ],
                [
                  'Owned children',
                  launcher
                    ? (launcher.children ?? [])
                        .map((c) => `${c.name} PID ${c.pid ?? 'UNKNOWN'}`)
                        .join(' · ') || 'none recorded'
                    : 'UNKNOWN',
                ],
                [
                  'Readiness checks',
                  launcher
                    ? (launcher.readiness ?? [])
                        .map((c) => `${c.name} ${c.ready ? 'READY' : 'NOT READY'}`)
                        .join(' · ') || 'none recorded'
                    : 'UNKNOWN',
                ],
              ]}
            />
            <p className="mt-3 text-2xs text-muted-foreground">
              Launcher state would be LOCAL and NON-CANONICAL: it records which processes this
              machine&apos;s launcher started, and it is not a business-truth source. It reads{' '}
              <strong>UNKNOWN</strong> here because the frozen read guard restricts raw reads to
              declared canonical sources and this artifact is not one — that refusal is the guard
              working, not a failed runtime. Logs live beside the state file under{' '}
              <span className="font-mono">.command-runtime/logs</span>.
            </p>
          </div>
        </Panel>
        <Panel title="Projection readiness (data, not process)">
          <div className="body">
            <KV
              rows={[
                ['Runtime node', 'local-first · read-only'],
                ['Workspace resolved', surface.workspace.root ?? 'UNRESOLVED'],
                ['Resolution source', surface.workspace.source ?? 'UNKNOWN'],
                ['Surface assembled', surface.assembled_at ?? 'UNKNOWN'],
                ['Data service', surface.execution_truth.state],
              ]}
            />
            <p className="mt-3 text-2xs text-muted-foreground">
              Projection health and process readiness are separate questions and are reported
              separately. Command does not infer service readiness from browser presence.
            </p>
            <GoLink href="#system/health">Projection health →</GoLink>
          </div>
        </Panel>
      </div>
    </>
  );
}

/** CONTRACTS — which contract version this runtime is reading, and its authority. */
function SystemContractsPeer({ surface }: { surface: CommandSurface }) {
  const pt = surface.process_truth;
  const wt = surface.work_truth;
  const et = surface.execution_truth;
  return (
    <>
      <PeerWorkHeader
        peer="Contracts"
        question="Which contract version is this runtime reading, under whose authority, and when was it generated?"
      />
      <Panel title="Control-plane contracts" count={pt.version ?? 'UNKNOWN'}>
        <div className="body">
          <KV
            rows={[
              ['Process contract version', pt.version ?? 'UNKNOWN'],
              ['Process contract status', pt.status ?? 'UNKNOWN'],
              ['Process contract authority', pt.authority ?? 'UNKNOWN'],
              ['Process contract generated', pt.generated_at ?? 'UNKNOWN'],
              ['Work model generated', wt.generated_at ?? 'UNKNOWN'],
              ['Activity generated', et.generated_at ?? 'UNKNOWN'],
              ['Authority note', surface.authority_note ?? 'UNKNOWN'],
            ]}
          />
          <p className="mt-3 text-2xs text-muted-foreground">
            Command renders these contracts and never writes them. Where Command disagrees with a
            canonical contract, the contract wins and the disagreement is marked DRIFT.
          </p>
        </div>
      </Panel>
    </>
  );
}

/** PROJECTION — every health dimension, each reported independently. */
function SystemProjectionPeer({ surface }: { surface: CommandSurface }) {
  const conditions = surface.health?.conditions ?? [];
  const health = surface.health;
  return (
    <>
      <PeerWorkHeader
        peer="Projection"
        question="Which dimension of the projection is healthy, and which is not?"
      />
      <QualifierRow>
        <span>overall {health?.overall ?? 'UNKNOWN'}</span>
        <span>{health?.counts.ok ?? 'UNKNOWN'}/{health?.counts.total ?? 'UNKNOWN'} in sync</span>
      </QualifierRow>
      <Panel title="Projection dimensions" count={`${conditions.length} reported`}>
        <div className="body">
          <KV rows={conditions.map((c) => [c.key, c.state] as [string, string])} />
          <p className="mt-3 text-2xs text-muted-foreground">
            Each truth layer reports independently. There is no aggregate that could mask a failing
            dimension — the overall state is a declaration, not a computation over these rows.
          </p>
        </div>
      </Panel>
    </>
  );
}

/**
 * The ERP hold: ONE owning surface in the ERP room.
 *
 * Goose R4 counted the hold fact presented three times inside the ERP room
 * alone — `HoldBanner` (App.tsx), the room-head authority/effective chips
 * (RoomHeadline here), and `ErpFocus`'s restart sentence (erp-room.tsx) — and
 * seven times across the product.
 *
 * The owner is `HoldBanner`. It is persistent, non-dismissible, pinned above
 * every surface and rendered from canonical `hold_state`, so it is the one
 * place an operator is guaranteed to see the hold. This room head therefore
 * states ROOM state, not hold state: the ERP `ON_HOLD` chip is the room's
 * projection state, which is a different fact from the canonical hold record
 * already carried by the banner directly above it.
 *
 * What is deliberately NOT repeated here: authority, effective date and the
 * restart requirement. They are on the banner, one scroll-free element above,
 * on every ERP tab.
 */
function RoomHeadline({
  route,
  b,
}: {
  route: BuildingRoute;
  b: BuildingProjection;
}) {
  const erp = b.projects.find((p) => p.id === 'erp');

  if (route.room === 'erp')
    return (
      <RoomHead
        mark="ERP"
        title="starqERP"
        sub={
          <>
            Occupied · private operational truth · POS stays inside this room · process closure
            governs maturity
          </>
        }
        right={
          <>
            <Chip value={erp?.state ?? 'UNKNOWN'} tone="hold" />
            {/*
              Room state only. The canonical hold record — authority, effective
              date, restart requirement — is declared by HoldBanner above and is
              deliberately not restated here (Goose R4).
            */}
            <span className="chip" data-tone="muted">
              hold declared above
            </span>
          </>
        }
      />
    );

  if (route.room === 'hoadha')
    return (
      <RoomHead
        mark="Hᴅ"
        title="Hoadha"
        sub={
          <>
            Prepared room · public commercial discovery · roadmap {show(b.hoadha.current_wave)} · a
            prepared roadmap is not execution authorization
          </>
        }
        right={
          <>
            <span className="chip" data-tone="room">
              PREPARED / {b.hoadha.execution}
            </span>
            <span className="chip" data-tone={b.hoadha.integrity === 'SOURCE_READ' ? 'ok' : 'stale'}>
              integrity {b.hoadha.integrity}
            </span>
            <span className="chip" data-tone="unknown">
              production {b.hoadha.production}
            </span>
          </>
        }
      />
    );

  return <StudioHeadline building={b} />;
}

function StudioHeadline({ building }: { building?: BuildingProjection }) {
  return (
    <RoomHead
      mark="DS"
      title="Dev Studio"
      sub={<>First operating floor · Staff → floor → project assignment → role → packet → evidence</>}
      right={
        <>
          <span className="chip" data-tone="room">
            {building?.projects.filter((p) => p.classification === 'OCCUPIED').length ?? 'UNKNOWN'} occupied
          </span>
          <span className="chip" data-tone="muted">
            capacity {building?.capacity.state ?? 'UNKNOWN'}
          </span>
        </>
      }
    />
  );
}

/**
 * Room content.
 *
 * The three accepted Phase 3/4/5 surfaces — Floor, Process and Attention — are
 * mounted HERE, in the router, rather than being re-exported from a room
 * module. That is deliberate: the routing decision "this room shows the
 * accepted Process surface, that room shows the accepted Attention surface" is
 * a Building-level fact, and burying it inside a room module would make the
 * cross-room routing unprovable by reading the router.
 */
function RoomContent({
  route,
  surface,
  building,
}: {
  route: BuildingRoute;
  surface: CommandSurface;
  building: BuildingProjection;
}) {
  if (route.room === 'hoadha') {
    if (route.tab === 'Board')
      return (
        <>
          <PmBoardSurface projectId="hoadha" />
          <GoLink href="#building">Historical Nexus records (HISTORICAL_SNAPSHOT · READ_ONLY · not native tasks) →</GoLink>
          <HoadhaRoom tab={route.tab} building={building} surface={surface} />
        </>
      );
    return <HoadhaRoom tab={route.tab} building={building} surface={surface} />;
  }

  if (route.room === 'erp') {
    if (route.tab === 'Tasks')
      return (
        <>
          <PmBoardSurface projectId="erp" />
          <GoLink href="#building">Historical Nexus records (HISTORICAL_SNAPSHOT · READ_ONLY · not native tasks) →</GoLink>
          <ErpRoom tab={route.tab} building={building} surface={surface} />
        </>
      );
    if (route.tab === 'Process')
      return (
        <div className="command-stack">
          <FocusNote>
            Process closure governs maturity. A family with ten implemented stages and one absent
            stage is a family with an absent stage — the rollup is a worst-stage selection, never
            an average.
          </FocusNote>
          <ProcessSurface surface={surface} />
        </div>
      );
    if (route.tab === 'Decisions')
      return (
        <div className="command-stack">
          <FocusNote>
            Founder decisions are carried forward, never auto-resolved. Command surfaces them from
            the Room ledger and the control-board contract; it does not decide, rank or reconcile
            them.
          </FocusNote>
          <AttentionPeer tab={route.tab} surface={surface} />
        </div>
      );
    if (route.tab === 'Evidence')
      return (
        <div className="command-stack">
          <FocusNote>
            Command summarizes → Room proves. Evidence here proves a file was read, not that a
            release was accepted or a claim verified.
          </FocusNote>
          <EvidenceSurface surface={surface} />
        </div>
      );
    return <ErpRoom tab={route.tab} building={building} surface={surface} />;
  }

  return <StudioContent route={route} surface={surface} />;
}

function StudioContent({ route, surface }: { route: BuildingRoute; surface: CommandSurface }) {
  // Dev Studio. The accepted Phase 3 Floor surface is mounted here, beneath the
  // richer roster view, because the floor projection is the evidence the roster
  // is read against.
  if (route.tab === 'Staff')
    return (
      <>
        <StaffSurface surface={surface} />
        <div className="command-stack">
          <Panel title="Original floor projection" count={surface.floor?.phase ?? null}>
            <div className="body">
              <details>
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Full floor projection and declared disagreements
                </summary>
                <FloorSurface surface={surface} />
              </details>
            </div>
          </Panel>
        </div>
      </>
    );
  if (route.tab === 'Integrity')
    return surface.building
      ? <IntegritySurface building={surface.building} project="erp" surface={surface} />
      : <SourceGap reason="Building projection unavailable." />;
  if (route.tab === 'Herdr')
    return <HerdrSurface />;
  if (route.tab === 'Projects')
    return (
      <>
        <PmPortfolioSurface />
        <DevStudio tab={route.tab} surface={surface} />
        <CommandBoardSurface />
      </>
    );
  return <DevStudio tab={route.tab} surface={surface} />;
}

export function BuildingSurface({
  route,
  surface,
}: {
  route: BuildingRoute;
  surface: CommandSurface;
}) {
  const b = surface.building;

  /*
    COMPANY OS — dispatched BEFORE the building-projection guard, deliberately.

    The company is the building; the Building projection is only the two project
    rooms. Gating the Company surface on that projection would make the whole
    company unreadable whenever the dual-room projection is absent, which is the
    exact inversion the Founder corrected at seq 8487: Dev Studio is one floor,
    not the building, and it must not be the thing the company depends on.

    It also carries its own tab rail, because it is a peer of Overview and
    Evidence rather than a Dev Studio tab — the false `aria-current` that made
    the cross-room rails wrong (Goose R2) is exactly what putting this on
    STUDIO_TABS would reintroduce.
  */
  if (route.view === 'company') {
    return (
      <div className="room-root" data-room="company">
        <TabRail
          route={route}
          tabs={COMPANY_OS_TABS}
          counts={{
            Structure: surface.company_os?.counts?.floors ?? null,
            Seats: surface.company_os?.counts?.seats ?? null,
            Portfolio: surface.company_os?.counts?.rooms ?? null,
            Founder: surface.company_os?.founder?.reserved_to_founder.length ?? null,
            Infrastructure: surface.company_os?.shared_infrastructure.length ?? null,
          }}
        />
        <CompanyOsSurface surface={surface} tab={route.tab} />
      </div>
    );
  }

  /*
    CMD-DI-3-2b. Work is its own surface. It does not replace Evidence → Rooms,
    and it does not read the building projection to invent package rows.
    No list has been supplied, so availability stays UNKNOWN rather than empty.
  */
  if (route.view === 'work') {
    return (
      <div className="room-root" data-room="work">
        <GoLink href="#studio/overview">Dev Studio →</GoLink>
        <WorkPackagesRoute />
      </div>
    );
  }

  const pmRoute = pmRouteFor(route);
  if (pmRoute && (pmRoute.standalone || (!b && pmRoute.project !== null))) {
    return (
      <div className="room-root" data-room="studio" data-pm-route={pmRoute.project ?? 'portfolio'}>
        {pmRoute.project ? <PmBoardSurface projectId={pmRoute.project} /> : <PmPortfolioSurface />}
        {pmRoute.project === 'command' ? <GoLink href="#studio/projects">Historical CMD-DI board (pinned, read-only) →</GoLink> : null}
        {pmRoute.project === 'erp' || pmRoute.project === 'hoadha' ? (
          <GoLink href="#building">Historical Nexus records (HISTORICAL_SNAPSHOT · READ_ONLY · not native tasks) →</GoLink>
        ) : null}
      </div>
    );
  }

  // The executive landing page can still show canonical projects and PM
  // records when the Building projection is absent. Building-specific signals
  // remain explicitly unavailable inside ExecutiveOverview.
  if (!b && route.view === 'overview') return <ExecutiveOverview surface={surface} />;

  const tabs =
    route.room === 'erp'
      ? ERP_TABS
      : route.room === 'hoadha'
        ? HOADHA_TABS
        : STUDIO_TABS;

  // ── Cross-room surfaces ────────────────────────────────────────────────
  //
  // Founder Attention renders NO tab rail, deliberately and identically to
  // Evidence and System below.
  //
  // It previously rendered STUDIO_TABS against a route of
  // `{view:'attention', room:null, tab:'Overview'}` (parseBuildingRoute always
  // returns that for a non-studio view). The consequence was a FALSE current
  // marker: TabRail marks `route.tab === tab` with aria-current="page", which
  // index.css paints with the room accent underline — so the operator was told
  // "Overview" was the current tab while looking at Founder Attention, and all
  // five tabs navigated away from where they were (Goose R2). Evidence and
  // System never had this because they render no rail.
  //
  // The cross-room surfaces are reached from the primary rail, not from a
  // studio tab list, so the honest fix is to have no tab list to be wrong about.
  if (route.view === 'attention')
    return (
      <div className="room-root" data-room="studio">
        <RoomHead
          mark="FA"
          title="Founder Attention"
          sub="Carried decisions and declared exceptions · surfaced, never auto-resolved"
          right={
            <>
              <span className="chip" data-tone={b ? 'room' : 'unknown'}>
                Hoadha {b?.hoadha.source_status ?? 'UNKNOWN'}
              </span>
              <span className="chip" data-tone="unknown">
                production {b?.hoadha.production ?? 'UNKNOWN'}
              </span>
            </>
          }
        />
        <CompanyPeerRail route={route} tabs={ATTENTION_TABS} />
        <div className="command-stack">
          <div className="surface-peer-label" data-peer={route.tab.toLowerCase()}>{route.tab}</div>
          {route.tab !== 'Decisions' ? <FocusNote>No Founder ruling is inferred from a prepared room. This peer shows only declared canonical records and carries their source.</FocusNote> : null}
          <AttentionPeer tab={route.tab} surface={surface} />
        </div>
      </div>
    );

  if (route.view === 'evidence')
    return (
      <div className="room-root" data-room="studio">
        <RoomHead
          mark="EV"
          title="Evidence"
          sub="Command summarizes → Room proves · a hash proves bytes read, not truth claimed"
        />
        <CompanyPeerRail route={route} tabs={EVIDENCE_TABS} />
        <div className="command-stack">
          <div className="surface-peer-label" data-peer={route.tab.toLowerCase()}>{route.tab}</div>
          {route.tab !== 'Sources' ? <FocusNote>Evidence establishes source access and provenance. It never establishes deployment, acceptance or correctness.</FocusNote> : null}
          <EvidencePeer tab={route.tab} building={b} surface={surface} />
        </div>
      </div>
    );

  if (route.view === 'system')
    return (
      <div className="room-root" data-room="studio">
        <RoomHead
          mark="SY"
          title="System"
          sub="Building source health and control-plane dimensions"
          right={
            <>
              <span
                className="chip"
                data-tone={!b ? 'unknown' : b.hoadha.integrity === 'SOURCE_READ' ? 'ok' : 'stale'}
              >
                Hoadha {b?.hoadha.integrity ?? 'UNKNOWN'}
              </span>
              <span className="chip" data-tone="unknown">
                build/release UNVERIFIED
              </span>
            </>
          }
        />
        <CompanyPeerRail route={route} tabs={SYSTEM_TABS} />
        <div className="command-stack">
          <div className="surface-peer-label" data-peer={route.tab.toLowerCase()}>{route.tab}</div>
          {route.tab !== 'Health' ? <FocusNote>ERP hold is a room state, not a system fault. Runtime and projection claims remain separately qualified.</FocusNote> : null}
          <SystemPeer tab={route.tab} building={b} surface={surface} />
        </div>
      </div>
    );

  // ── Company / Dev Studio ───────────────────────────────────────────────
  //
  // `view === 'studio'` covers BOTH Dev Studio itself and the project rooms,
  // because a room deep link is `#studio/<room>/<tab>`. So the room scope is
  // decided by `route.room`, never by `route.view` alone — otherwise a
  // Hoadha deep link renders inside the studio accent and the two rooms stop
  // being visually distinguishable on the single most important navigation.
  const room = route.room;
  const isProjectRoom = room === 'erp' || room === 'hoadha';

  // Studio has its own floor-backed surfaces. An absent Building projection
  // must not hide their content or the navigation between them.
  if (route.view === 'studio' && !isProjectRoom && !route.projectId)
    return (
      <div className="room-root" data-room="studio">
        <StudioHeadline building={b} />
        {/*
          CMD-DI-1-4. Grouping is a legend over the existing Studio tab
          set. Tab identity, order, and hrefs stay on TabRail and on
          STUDIO_TABS. Project-room rails below are untouched.
        */}
        <StudioGroupLegend tab={route.tab} />
        <TabRail
          route={route}
          tabs={tabs}
          counts={{
            Staff: surface.floor?.roster?.entries?.length ?? null,
            Activity: surface.floor?.activity?.events?.length ?? null,
          }}
        />
        <GoLink href="#work">Read-only work feed →</GoLink>
        <StudioContent route={route} surface={surface} />
      </div>
    );

  // Only the Building topology and project-room projections require Building.
  // The origin warning remains owned by App; this guard cannot replace peers.
  if (!b)
    return (
      <div className="room-root">
        <RoomHead mark="—" title="Building projection unavailable" />
        <SourceGap
          reason="The data service has not supplied the dual-room projection."
          detail="No room may be entered from an absent projection."
        />
      </div>
    );

  if (route.view === 'studio' && route.projectId) {
    return (
      <div className="room-root" data-room="studio" data-project-id={route.projectId}>
        <ProjectBoard
          building={b}
          projectId={route.projectId}
          label={`${route.projectId} project board`}
          projectLabel={route.projectId}
        />
      </div>
    );
  }

  if (route.view === 'overview' || route.view === 'building') {
    if (!isProjectRoom)
      return (
        <div className="room-root" data-room="studio">
          {route.view === 'overview' ? <ExecutiveOverview surface={surface} /> : (
            <>
              <CompanyOverview building={b} />
              <HistoricalPmSurface historical={b.historical_pm} />
            </>
          )}
        </div>
      );
  }

  // ── Project rooms ──────────────────────────────────────────────────────
  if (!isProjectRoom)
    return (
      <div className="room-root">
        <RoomHead mark="—" title="No room selected" />
        <SourceGap reason="This route names no project room." />
      </div>
    );

  const h = b.hoadha;
  const counts =
    room === 'erp'
      ? {
          Tasks: b.erp_tasks?.length ?? null,
                    Staff: surface.floor?.roster?.entries?.length ?? null,
          Integrity: (
            <SourcePanelCount building={b} project="erp" />
          ),
        }
      : {
          Loops: h.loops.length || null,
          Board: h.live_count,
          Waves: h.waves.length || null,
          Stages: h.stages.length || null,
          Evidence: h.evidence.length || null,
          Integrity: (
            <SourcePanelCount building={b} project="hoadha" />
          ),
        };

  return (
      <div className="room-root" data-room={room}>
        <RoomHeadline route={route} b={b} />
        {/*
          THE ROOM STATE BAND, mounted HERE rather than inside either room
          module.

          Gap map WF-ERP-03 found every ERP tab repeating a six-cell stat rail,
          and the honest structural answer is that room STATE is not a property
          of the body — it is a property of the ROOM. Three of the ERP tabs
          (Process, Decisions, Evidence) are mounted by this router rather than
          by the room module, so a band rendered from inside the room module
          would have been missing from exactly the tabs where an operator most
          needs to re-establish that the room is on hold.

          Mounting it at the room wrapper makes "room state is visible on every
          tab" a structural property of the room rather than a promise each body
          has to keep. Neither room module renders it any more, so there is one
          owner.
        */}
        <RoomStateBand room={room} building={b} surface={surface} />
        <TabRail route={route} tabs={tabs} counts={counts} />
        <RoomContent route={route} surface={surface} building={b} />
      </div>
    );
  }

/**
 * ROOM STATE BAND — identity, state, and the qualifiers a room must never lose.
 *
 * One band, every tab, both rooms. It carries the ERP ON_HOLD chip and the
 * Hoadha PREPARED / NOT STARTED chip with the live/proposed separation stated,
 * because those are the two states the product contract forbids being routed
 * around.
 *
 * It does NOT carry the canonical hold record — authority, effective date,
 * restart requirement. That belongs to `HoldBanner` above and is not restated
 * here (Goose R4).
 */
function RoomStateBand({
  room,
  building,
  surface,
}: {
  room: 'erp' | 'hoadha';
  building: BuildingProjection;
  surface: CommandSurface;
}) {
  if (room === 'hoadha') {
    const h = building.hoadha;
    return (
      <div className="room-state-band" data-room-state-band="hoadha">
        <span className="label-micro">Hoadha</span>
        <Chip value={`PREPARED / ${h.execution}`} tone="room" />
        <span className="text-2xs text-muted-foreground">
          no H0 activation · live {h.live_count ?? 'UNKNOWN'} and proposed{' '}
          {h.proposed_count ?? 'UNKNOWN'} are two collections, never summed
        </span>
        <span className="spacer" />
        <GoLink href="#studio/hoadha/board">Board →</GoLink>
        <GoLink href="#studio/hoadha/loops">Loops →</GoLink>
      </div>
    );
  }

  const state = building.projects.find((p) => p.id === 'erp')?.state ?? 'UNKNOWN';
  const hold = surface.process_truth?.hold_state;
  return (
    <div className="room-state-band" data-room-state-band="erp">
      <span className="label-micro">starqERP</span>
      <Chip value={state} tone={state === 'ON_HOLD' ? 'hold' : 'room'} />
      <span className="text-2xs text-muted-foreground">
        {hold ? 'hold declared in the banner above' : 'hold state unreadable from source'} ·
        process closure governs maturity
      </span>
      <span className="spacer" />
      <span className="text-2xs text-muted-foreground">
        {surface.process_truth?.available
          ? `${(surface.process_truth.convergence_gaps ?? []).length} convergence gaps`
          : 'process truth unavailable'}
      </span>
      <GoLink href="#studio/erp/process">Process →</GoLink>
    </div>
  );
}

function SourcePanelCount({
  building,
  project,
}: {
  building: BuildingProjection;
  project: 'erp' | 'hoadha';
}) {
  const rows = building.sources.filter((s) =>
    project === 'hoadha' ? !s.source.includes('starq-erp') : s.source.includes('starq-erp'),
  );
  const ok = rows.filter((s) => s.state === 'AVAILABLE').length;
  return (
    <span className={ok === rows.length ? 'text-truth-ok' : 'text-truth-stale'}>
      {ok}/{rows.length}
    </span>
  );
}

/**
 * FOCUS NOTE — the one caveat a peer must state before its records.
 *
 * Founder QA seq 8411: compress/restructure repeated method/provenance
 * explanation without removing truth.
 *
 * Measured cost of this block at 430x932 on #attention/exceptions: 115px,
 * which is a seventh of the viewport spent on a sentence that qualifies
 * everything below it. The caveat is genuinely load-bearing — "no Founder
 * ruling is inferred from a prepared room" is what stops these peers reading
 * as judgement — so it does NOT move behind a disclosure.
 *
 * What changed is its weight and its shape. It was a filled rail with a
 * 0.6rem/0.7rem pad and an all-caps 9px mark, reading as a banner. It is now
 * a single quiet line: a left rule in the room accent, one short sans label,
 * and the caveat as prose. Same words, same placement, roughly a third of the
 * vertical cost, and it stops competing with the records for attention.
 */
function FocusNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="focus-rail">
      <span className="mark">Read first</span>
      <p>{children}</p>
    </div>
  );
}

