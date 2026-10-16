/**
 * Company shell — Building, Dev Studio, Founder Attention, Evidence, System.
 *
 * These are the cross-room surfaces. Their job is to make the Building legible
 * as a Building: which rooms exist, which are occupied, which are prepared, and
 * what the Founder is being asked to decide.
 *
 * FIRST-SCREEN RULE
 *
 * Every one of these surfaces opens with a stat rail and a focus rail. An
 * operator who lands on Company Overview must be able to name the two rooms
 * and their states without scrolling or clicking.
 */
import type { BuildingProjection, CommandSurface } from '@/lib/contracts';
import {
  Chip,
  FocusRail,
  GoLink,
  KV,
  Panel,
  RoomHead,
  SourceGap,
  Stat,
  StatRail,
} from '@/components/console';
import { AboutMethod, PeerWorkHeader } from '@/components/work-area';
import { StaffGlance } from '@/components/staff-glance';
import { ActivityPanel, CapacityPanel, StaffSurface } from '@/surfaces/staff';
import { PmPortfolioSnapshot } from '@/surfaces/pm-portfolio';

/**
 * Executive company snapshot: what is happening now.
 *
 * GAP MAP WF-OV-01, WF-OV-02, WF-OV-03, WF-MISS-01.
 *
 * WHAT WAS WRONG
 *
 * The first viewport gave equal visual weight to Current Focus, room state,
 * four blockers, system/integrity and four activity rows. Nothing was
 * identified as the most material current concern, so the Founder had to do the
 * synthesis manually — which is the one job an executive watch face exists to do.
 *
 * The recomposition, in priority order:
 *
 *   1. EXECUTIVE HEADLINE   projection state · room states · declared
 *                           attention count, in one bounded band. The
 *                           five-second answer to "is anything wrong".
 *   2. ATTENTION / BLOCKERS the primary work pane. Declared only.
 *   3. ROOM STATE           ERP and Hoadha cards, with the qualifiers each
 *                           room must never lose (ON_HOLD; PREPARED /
 *                           NOT STARTED with live/proposed kept separate).
 *   4. CURRENT FOCUS        derived from declared state (WF-OV-02), with the
 *                           standing doctrine sentence demoted to method.
 *   5. SYSTEM / ACTIVITY    short supporting rails with cross-links to their
 *                           owning surfaces, not re-rendered detail.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Building topology (Building owns it), source tables (System/Evidence own
 * them), process families (ERP Process owns them), task listings (ERP Tasks
 * owns them) and methodology (AboutMethod). Every one of those is a census row
 * with a named owner; re-rendering it here is what made Overview and Building
 * near-duplicates in the first place.
 *
 * NOTHING IS RANKED OR INFERRED
 *
 * Blockers are selected by the presence of a declared `critical_blocker` or
 * `blocked_by`. Activity is shown in canonical chronological order. The
 * attention COUNT is a count of declared records, never a score, and never a
 * claim about which record matters most — the product contract forbids ranking
 * and this surface does not rank.
 */
export function ExecutiveOverview({ surface }: { surface: CommandSurface }) {
  const building = surface.building;
  if (!building) {
    return (
      <div data-surface-signature="company-executive-overview" className="room-root" data-room="studio">
        <RoomHead mark="ST" title="Starq Technologies" sub="Project register available · Building projection unavailable" />
        <SourceGap
          reason="Building projection unavailable."
          detail="Building-dependent room, process, and health fields remain UNKNOWN. The PM-backed project register is shown independently below."
        />
        <PmPortfolioSnapshot />
      </div>
    );
  }

  const erp = building.projects.find((project) => project.id === 'erp');
  const hoadha = building.projects.find((project) => project.id === 'hoadha');
  const blockers = surface.process_truth.process_families
    .flatMap((family) =>
      family.critical_blocker
        ? [{ label: family.name, value: family.critical_blocker }]
        : family.stages
            .filter((stage) => stage.blocked_by)
            .slice(0, 1)
            .map((stage) => ({ label: family.name, value: stage.blocked_by as string })),
    )
    .slice(0, 4);
  const activity = (surface.execution_truth.activity_events ?? []).slice(0, 4);
  const health = surface.health ?? {
    overall: 'UNKNOWN' as const,
    conditions: [],
    counts: { ok: 0, total: 0 },
  };
  const workspace = surface.workspace ?? { root: null };

  /*
    The declared attention count. This is a COUNT OF DECLARED RECORDS across
    the three families that require Founder awareness: founder decisions, ERP
    hold, and process blockers. It is deliberately not a "priority" figure and
    is never compared against a threshold — see the doctrine note at the top of
    this file and gap map WF-HIER-02 ("counts become the product's visual
    language even where the contract says counts do not establish maturity").
    It is rendered small, inside the headline band, for the same reason.
  */
  const declaredDecisions = (surface.process_truth.reconciliation?.known_discrepancies ?? [])
    .filter((d) => d.founder_decision_required === true).length;
  const attentionCount = declaredDecisions + blockers.length;

  /*
    WF-OV-02: the focus line used to be a standing doctrine sentence ("Dual-room
    preparation · Command summarizes → Room proves") that repeated elsewhere and
    carried no current-change marker. It is now DERIVED from declared state: the
    ERP hold implementation, the Hoadha execution state, and the declared
    attention count, each read from canonical source and each rendered with its
    own honesty state. Where a fact is absent it says UNKNOWN rather than
    substituting a doctrine phrase — a doctrine sentence is a true statement and
    a poor answer to "what is happening now".
  */
  const holdImplementation = surface.process_truth.hold_state?.implementation ?? 'UNKNOWN';

  return (
    <div data-surface-signature="company-executive-overview" className="room-root" data-room="studio">
      <RoomHead
        mark="ST"
        title="Starq Technologies"
        sub="Executive operating snapshot · what is happening now"
      />

      {/*
        (1) EXECUTIVE HEADLINE. One band that answers, in order: is the
        projection current, what is each room doing, and how much declared
        attention exists. This is the element the previous composition lacked.
      */}
      <div className="executive-headline" data-executive-headline="">
        <div className="headline-item">
          <span className="label-micro">Projection</span>
          <Chip value={health.overall} />
          <span className="hint">
            {health.conditions.length
              ? `${health.counts.ok}/${health.counts.total} conditions in sync`
              : 'no health conditions declared'}
          </span>
        </div>
        <div className="headline-item">
          <span className="label-micro">starqERP</span>
          <Chip value={erp?.state ?? 'UNKNOWN'} tone={erp?.state === 'ON_HOLD' ? 'hold' : undefined} />
          <span className="hint">{erp?.classification ?? 'UNKNOWN'} · process closure</span>
        </div>
        <div className="headline-item">
          <span className="label-micro">Hoadha</span>
          <Chip value={`${hoadha?.classification ?? 'UNKNOWN'} / ${building.hoadha.execution}`} tone="room" />
          <span className="hint">
            live {building.hoadha.live_count ?? 'UNKNOWN'} · proposed{' '}
            {building.hoadha.proposed_count ?? 'UNKNOWN'} · never summed
          </span>
        </div>
        <div className="headline-item">
          <span className="label-micro">Declared attention</span>
          <span className="tnum" data-attention-count={attentionCount}>
            {attentionCount}
          </span>
          <span className="hint">
            {declaredDecisions} decision{declaredDecisions === 1 ? '' : 's'} · {blockers.length}{' '}
            blocker{blockers.length === 1 ? '' : 's'} · not ranked
          </span>
        </div>
      </div>

      <div className="executive-grid">
        {/*
          (2) ATTENTION / BLOCKERS — the primary work pane. Declared blockers
          only, each with the family it belongs to, so the operator can route
          straight to ERP Process without re-deriving which family is blocked.
        */}
        <Panel
          title="Needs attention"
          count={blockers.length || 'none declared'}
          className="executive-primary rank-primary"
        >
          <div className="body">
            {blockers.length ? (
              <ul className="executive-list">
                {blockers.map((blocker) => (
                  <li key={`${blocker.label}:${blocker.value}`}>
                    <span className="font-medium text-foreground/90">{blocker.label}</span>
                    <span>{blocker.value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-2xs text-muted-foreground">
                No declared process blocker was projected. That is an empty declared set, not a
                claim that nothing blocks.
              </p>
            )}
            {declaredDecisions ? (
              <p className="mt-2 text-2xs text-truth-founder">
                {declaredDecisions} founder decision{declaredDecisions === 1 ? '' : 's'} carried
                forward and unresolved.
              </p>
            ) : null}
            <GoLink href="#attention/decisions">Founder Attention →</GoLink>
          </div>
        </Panel>

        {/*
          (3) ROOM STATE. The two room cards, carrying the qualifiers the
          product contract requires them to carry: ERP visibly ON_HOLD, Hoadha
          visibly PREPARED / NOT STARTED with live and proposed kept apart.
        */}
        <Panel title="Room state" count="2 rooms" className="rank-primary">
          <div className="executive-room-grid">
            <ExecutiveRoomCard
              label="starqERP"
              state={erp?.state ?? 'UNKNOWN'}
              detail="Private operational truth · process closure"
              href="#studio/erp/overview"
              tone="hold"
            />
            <ExecutiveRoomCard
              label="Hoadha"
              state={`${hoadha?.classification ?? 'UNKNOWN'} / ${building.hoadha.execution}`}
              detail={`Live ${building.hoadha.live_count ?? 'UNKNOWN'} · Proposed ${building.hoadha.proposed_count ?? 'UNKNOWN'} · never summed`}
              href="#studio/hoadha/overview"
              tone="room"
            />
          </div>
        </Panel>

        {/*
          (4) CURRENT FOCUS — seq 8417 correction 4.

          THE DUPLICATION THIS REMOVES.

          This page stated ERP's and Hoadha's states THREE times: in the
          executive headline, again in the Room state cards, and a third time in
          this panel's first sentence — which recomposed the same two values
          into a third format. An operator scanning for "what is ERP doing" had
          three places to find the same answer, and the third was a paragraph
          rather than a value.

          The first sentence is removed because it is not new information on this
          page: headline and cards both carry it, in comparable form, with chips
          that can be scanned. What survives is what is unique to this panel —
          the focus judgement itself, which appears nowhere else:

            · the named focus directive
            · the declared attention count in context

          The persistent doctrine line remains in the global context bar and the
          method stays behind AboutMethod, exactly as before. Nothing is lost;
          one of three renderings of the same fact is.
        */}
        <Panel title="Current focus" className="executive-focus">
          <div className="body">
            <p className="tier-prose">
              Inspect project-native closure before trusting task completion. Acceptance remains
              pending.
            </p>
            <p className="mt-1 text-2xs text-muted-foreground">
              {attentionCount} declared attention record{attentionCount === 1 ? '' : 's'} across the
              Building · ERP is <strong className="text-foreground/90">{holdImplementation}</strong>
              , Hoadha is{' '}
              <strong className="text-foreground/90">{building.hoadha.execution}</strong>
            </p>
            <GoLink href="#studio/erp/overview">
              Inspect ERP process closure →
            </GoLink>
          </div>
        </Panel>

        {/*
          (5) SYSTEM — a compact status rail with cross-links, not a re-render
          of System Health. WF-REP-02: repeated full blocks across non-owning
          surfaces is what made Evidence and System interchangeable. This is a
          pointer; System owns the diagnostic.
        */}
        <Panel title="System" count={health.overall} className="rank-method">
          <div className="body">
            <KV
              rows={[
                ['Projection', <Chip key="projection" value={health.overall} />],
                ['Building sources', `${building.sources.filter((source) => source.state === 'AVAILABLE').length}/${building.sources.length}`],
                ['Workspace', workspace.root ?? 'UNRESOLVED'],
              ]}
            />
            <GoLink href="#system/health">System Health →</GoLink>
          </div>
        </Panel>

        {/*
          WF-OV-03 / WF-MISS-01: activity carries state/project context so a row
          means something, and an unknown task is a QUALIFIER rather than the
          row's dominant content. Order is canonical; nothing is ranked.
        */}
        <Panel title="Recent activity" count={activity.length || 'none projected'} className="rank-method">
          <div className="body">
            {activity.length ? (
              <ul className="executive-list">
                {activity.map((event) => (
                  <li key={event.event_id}>
                    <span className="font-mono text-2xs text-foreground/90">{event.agent.handle}</span>
                    <span>
                      {event.action ?? event.state}
                      {event.project ? ` · ${event.project}` : ''}
                      {event.task ? ` · ${event.task}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-2xs text-muted-foreground">Activity projection unavailable.</p>
            )}
            <GoLink href="#studio/activity">Open activity →</GoLink>
          </div>
        </Panel>
      </div>

      <PmPortfolioSnapshot />

      {/*
        WF-HIER-01. The interpretation guidance moves behind a disclosure. It
        is not deleted — it is the same text, one click away, and no longer
        between the operator and the work.
      */}
      <AboutMethod title="About this overview">
        <p>
          Command summarizes; Room proves. Command is a DERIVED_PROJECTION: where it disagrees with
          canonical source, the canonical source wins. Nothing on this page is ranked, scored or
          inferred — blockers appear because canonical source declares a blocker, and the attention
          count is a count of declared records rather than a measure of importance. Building
          topology lives on Building, process families on ERP Process, task records on ERP Tasks,
          and runtime health on System.
        </p>
      </AboutMethod>
    </div>
  );
}

function ExecutiveRoomCard({
  label,
  state,
  detail,
  href,
  tone,
}: {
  label: string;
  state: string;
  detail: string;
  href: string;
  tone: 'hold' | 'room';
}) {
  return (
      <a href={href} className="executive-room-card" data-tone={tone}>
        {/*
          WF-OV-01 / WF-HIER-03: the room name was a 10px uppercase micro-label
          above a mono state — so the STATE read as the card's title and the room
          name read as a caption. On Overview the operator's question is "what is
          each room doing", so the state is the comparable value and the name is
          the identity. Both are now readable; neither is a micro-label.
        */}
        <span className="room-name">{label}</span>
        <strong className="room-state">{state}</strong>
        <span>{detail}</span>
        <span className="text-primary">Enter room →</span>
      </a>
    );
}

/**
 * Company Overview — Building topology.
 *
 * GAP MAP WF-BLD-01, WF-BLD-02, WF-WRONG-05.
 *
 * WHAT WAS WRONG
 *
 * The stat rail repeated ERP/Hoadha/326/33/integrity facts that were already in
 * Overview and the persistent room switcher. Building should establish
 * STRUCTURE; repeated operating-state metrics blur ownership with Overview and
 * consume the surface that topology needs.
 *
 * And the topology read as a formatted inventory: five UNKNOWN floor rows at
 * equal weight with the active Dev Studio floor, so the containment the
 * metaphor depends on was not visible.
 *
 * THE RECOMPOSITION
 *
 *   · the stat rail keeps ONLY structural qualifiers — company, declared
 *     floors, active floor, declared rooms. Operating state moves to node
 *     metadata beside the node that owns it (census: DEDUPLICATE to the named
 *     owner).
 *   · the tree is a bounded topology with an explicit company root, a floor
 *     band, the Dev Studio container and room nodes under it.
 *   · UNKNOWN floors collapse into a declared-but-unprojected group, visibly
 *     secondary to the active floor rather than equal to it.
 *   · room state travels WITH the room node, as node metadata, not as a second
 *     executive rail.
 *
 * WHAT IT MUST NOT CONTAIN (product contract §6)
 *
 * No activity feed, no Founder Attention summary, no health summary, no
 * duplicate of Overview's room-state dashboard, and no generic "Navigate" list
 * as the main content. Those are the checks the recovery gate asserts and the
 * reason Overview and Building are no longer near-duplicates.
 */
export function CompanyOverview({ building }: { building: BuildingProjection }) {
  const erp = building.projects.find((p) => p.id === 'erp');
  const hoadha = building.projects.find((p) => p.id === 'hoadha');
  const ai = building.projects.find((p) => p.id === 'ai');
  const h = building.hoadha;

  /*
    The declared-but-unprojected floors. WF-BLD-01 asked for a collapsed
    "declared but unprojected floors" group rather than equal-weight UNKNOWN
    rows: a floor with no operational provider is a structural declaration, not
    a peer of the one floor that is operating. The names are unchanged — this is
    a grouping of existing declared facts, not a removal of any.
  */
  const unprojectedFloors = [
    'Executive / Founder',
    'Commercial / Market',
    'Company Operations',
    'Finance / Administration',
    'Infrastructure / Systems',
  ];

  return (
    <div data-surface-signature="building-topology" className="room-root" data-room="studio">
      <RoomHead
        mark="HQ"
        title="Starq Technologies"
        sub="Building topology · floors, ownership and authority boundaries"
      />
      {/*
        STRUCTURAL QUALIFIERS ONLY. Every cell here is a count of a
        STRUCTURAL thing: how many floors are declared, which floor is active,
        how many rooms are declared. Room execution state, live/proposed counts
        and integrity are NOT here — they belong to Overview (executive) and to
        the room that owns them. That is the census DEDUPLICATE decision made
        structural rather than merely recorded.
      */}
      <StatRail>
              {/*
                THE COMPANY, AS AN IDENTITY (seq 8411).

                Founder instruction: "give Starq Technologies proper human-facing
                identity treatment. It must not read as a database value."

                This cell previously rendered `building.company` — a projection field
                — through the same `Stat` treatment as "Declared floors: 6", so the
                name of the organisation and a count of its floors were typographically
                the same kind of thing. The organisation is the root everything else
                hangs from; it is not a metric.

                So the declared value is still shown — verbatim, because it is
                canonical and Command does not rename it — but it is presented as the
                organisation's identity: the display name leads, and the declared
                projection value is kept as its provenance qualifier underneath.
              */}
              <div className="company-identity" data-company-identity={building.company}>
                <span className="company-identity-name">Starq Technologies</span>
                <span className="company-identity-role">Organisational root · every floor and room below</span>
                <span className="company-identity-declared">
                  declared as <span className="font-mono">{building.company}</span>
                </span>
              </div>
              <Stat k="Declared floors" v="6" tone="room" sub="1 active · 5 unprojected" />
        <Stat k="Active floor" v={building.floor} tone="room" sub="current projection" />
        <Stat
          k="Declared rooms"
          v={building.projects.length}
          sub={`${building.projects.filter((p) => p.classification === 'OCCUPIED').length} occupied`}
        />
        <Stat
          k="Declared sources"
          v={building.sources.length}
          sub={`${building.sources.filter((s) => s.state === 'AVAILABLE').length} read at this projection`}
        />
      </StatRail>
      <div className="command-stack">
        <Panel title="Organization tree" count="Starq Technologies → floors → rooms" className="rank-primary">
          <div className="building-tree">
            <div className="building-node root"><strong>Starq Technologies</strong><span>company authority</span></div>
            {/*
              The active floor is presented FIRST and as a container, because
              containment is the thing the metaphor has to communicate. It was
              previously fifth, after five UNKNOWN floors of equal weight.
            */}
            <div className="building-node floor"><strong>{building.floor}</strong><span>active operating floor · contains {building.projects.length} declared rooms</span></div>
            <div className="building-rooms">
              {/*
                ROOM STATE AS NODE METADATA (WF-BLD-02). Each room node carries
                its own state qualifier beside its identity — that is where
                "current room state beside each room" belongs per the product
                contract. It is NOT a second stat rail, and it does not repeat
                the executive counts Overview already owns.
              */}
              <a className="building-node room" href="#studio/erp/overview">
                <strong>starqERP</strong>
                <span>{erp?.classification ?? 'UNKNOWN'} · {erp?.state ?? 'UNKNOWN'} · private operational truth</span>
                <span className="node-state">process closure governs maturity</span>
              </a>
              <a className="building-node room" href="#studio/hoadha/overview">
                <strong>Hoadha</strong>
                <span>{hoadha?.classification ?? 'UNKNOWN'} · {hoadha?.state ?? 'UNKNOWN'} · public commercial discovery</span>
                <span className="node-state">live {h.live_count ?? 'UNKNOWN'} · proposed {h.proposed_count ?? 'UNKNOWN'} · never summed</span>
              </a>
              <div className="building-node room">
                <strong>{ai?.name ?? 'starqAI'}</strong>
                <span>{ai?.classification ?? 'UNKNOWN'} · {ai?.state ?? 'NO OPERATIONAL SOURCE'} · framework only</span>
                <span className="node-state">declared, not occupied</span>
              </div>
            </div>
            {/*
              Declared but unprojected floors, grouped and visually secondary.
              Collapsed because a floor with no operational source has nothing
              to inspect; the names remain one click away, which satisfies both
              "available but visibly secondary" and the census requirement that
              no meaningful baseline item disappears.
            */}
            <details className="building-unprojected">
              <summary>
                Declared but unprojected floors · {unprojectedFloors.length}
              </summary>
              <div className="building-unprojected-body">
                {unprojectedFloors.map((floor) => (
                  <div className="building-node unknown" key={floor}>
                    <strong>{floor}</strong>
                    <span>UNKNOWN · no operational source declared</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </Panel>

        <Panel title="Authority and dependencies" className="rank-support">
          <div className="body building-relations">
            <KV rows={[
              ['Project → floor', 'starqERP / Hoadha → Dev Studio'],
              ['Room authority', 'each room owns separate truth; no inheritance'],
              ['ERP source', erp?.source ?? 'UNKNOWN'],
              ['Hoadha source', hoadha?.source ?? 'UNKNOWN'],
              ['Undeclared floors', 'UNKNOWN · no activity fabricated'],
            ]} />
          </div>
        </Panel>

        {/*
          The room-specific caveat becomes a disclosure rather than a panel.
          It is genuinely structural — "no activity is inferred from adjacency"
          is a topology claim — but it is interpretation guidance about the
          surface, and gap map WF-HIER-01 found exactly this kind of block
          sitting between the operator and the structure.
        */}
        <AboutMethod title="About building topology">
          <p>
            Declared floors without operational providers remain UNKNOWN and are grouped above rather
            than shown as peers of the operating floor. Building shows declared relationships without
            inferring activity, ownership or authority from adjacency. Current operating state lives on
            Overview; runtime and projection health live on System; claim provenance lives on Evidence.
          </p>
        </AboutMethod>
      </div>
    </div>
  );
}

/**
 * Dev Studio — the first operating floor.
 *
 * GAP MAP WF-DS-01, WF-DS-03.
 *
 * WHAT WAS WRONG
 *
 * Dev Studio Overview was "a miniature Building/health dashboard": a stat rail,
 * Current Focus, capacity/reviewer state and "Rooms on this floor". The floor's
 * question is who is working on what, with what capacity and activity — and the
 * composition foregrounded room topology and review caveats instead.
 *
 * THE RECOMPOSITION
 *
 *   · OVERVIEW — floor constraints and declared capacity first, then a compact
 *     staff/activity signal and direct project-room entry. Reviewer
 *     methodology moves behind AboutMethod, per the gap-map direction to move
 *     it "below the fold/About".
 *   · STAFF      — roster with selected-detail (staff.tsx).
 *   · PROJECTS   — project-room mapping. It was previously indistinguishable
 *     from Overview's rooms panel.
 *   · CAPACITY   — declared capacity only, UNKNOWN preserved (staff.tsx).
 *   · ACTIVITY   — bounded chronological events with detail (staff.tsx).
 *
 * Every peer now renders a `PeerWorkHeader` stating the question it answers,
 * which is what makes local navigation change the WORK AREA rather than only
 * the tab label.
 *
 * PRESERVED, not simplified away
 *
 * Presence is not assignment, capacity remains UNKNOWN where no quota is
 * declared, and no reviewer completion is inferred from presence on the floor.
 */
export function DevStudio({
  tab,
  surface,
}: {
  tab: string;
  surface: CommandSurface;
}) {
  const b = surface.building;
  if (tab === 'Staff') return <StaffSurface surface={surface} />;
  if (tab === 'Activity') return <ActivityPanel surface={surface} />;
  if (tab === 'Capacity') return <CapacityPanel surface={surface} buildingCapacity={b?.capacity} />;

  /*
    PROJECTS owns the project-room mapping (WF-DS-03). It was previously the
    "Rooms on this floor" panel, which shared room/state framing with Overview
    and made the two peers hard to tell apart. It is now a distinct work area
    whose job is mapping: which declared room belongs to which project, under
    which floor, sourced from where.
  */
  if (tab === 'Projects') return <ProjectsWorkArea surface={surface} />;

  const rosterCount = surface.floor?.roster?.entries?.length ?? null;
  const eventCount = surface.floor?.activity?.events?.length ?? null;
  const activeStaff = (surface.floor?.roster?.entries ?? []).filter((e) => e.is_active_staff).length;

  return (
    <>
      <PeerWorkHeader
        peer="Overview"
        question="What constrains this floor right now, who is on it, and which room do I enter next?"
        links={<GoLink href="#studio/staff">Staff →</GoLink>}
      />
      {/*
        The floor rail answers the FLOOR question, so it carries floor
        constraints and floor-level counts. Room execution state and integrity
        are NOT repeated here — the room chips in the topology and the room
        headers already own those, and WF-REP-01 found the triple presentation
        to be exactly what diluted the owner.
      */}
      <StatRail>
        <Stat
          k="Declared floor"
          v={b?.floor ?? surface.phase3?.name}
          tone={b || surface.phase3?.name ? 'room' : 'unknown'}
          sub={b?.company ?? 'read-surface declaration · runtime availability is separate'}
        />
        <Stat
          k="Capacity"
          v={b?.capacity.state ?? 'UNKNOWN'}
          tone="unknown"
          sub="declared only · no canonical quota projection"
          rank="primary"
        />
        <Stat
          k="Registered active staff"
          v={rosterCount === null ? null : activeStaff}
          sub={rosterCount === null ? 'floor projection unavailable' : `of ${rosterCount} identities`}
        />
        <Stat k="Recent events" v={eventCount} sub="activity is not process state" />
      </StatRail>

      {/*
        FLOOR CONSTRAINTS FIRST. This is the thing that actually constrains the
        floor, and it was previously third behind room topology and reviewer
        methodology. The declared blockers stay visible and stay declared.
      */}
      <FocusRail label="Floor constraints">
        <p>
          {b?.capacity.state ?? 'UNKNOWN'} capacity — {b?.capacity.reason ?? 'Building projection unavailable.'}
        </p>
        <p style={{ marginTop: '0.3rem' }}>
          Prepared room blockers:{' '}
          <span className="font-mono break-words">{b?.hoadha.blockers.join(' · ') || 'UNKNOWN'}</span>
        </p>
      </FocusRail>

      {/*
        CMD-DI-1-5. Glance sits on Dev Studio Overview only. Counts come from
        props; this surface does not classify the roster into glance buckets.
        ERP Overview (overview.tsx) is a different surface and is not mounted here.
      */}
      <StaffGlance
        staff={surface.floor?.roster?.entries ?? []}
        counts={surface.floor?.roster?.counts ?? null}
        buckets={surface.floor?.staff_glance_counts ?? null}
      />

      <div className="command-split">
        {/*
          ROOM ENTRY. The product contract requires Dev Studio Overview to give
          "direct links into starqERP and Hoadha rooms", so the mapping itself
          lives on Projects and this is the entry affordance with the state
          qualifier the contract requires visible beside it.
        */}
        <Panel title="Project rooms on this floor" count={b ? `${b.projects.length} declared` : 'UNAVAILABLE'}>
          <div className="body">
            {b ? (
              <KV rows={b.projects.map((p) => [p.name, `${p.classification} · ${p.state}`])} />
            ) : (
              <SourceGap reason="Building projection unavailable. Project-room mapping is UNKNOWN." />
            )}
            <div className="mt-2 flex flex-col gap-1">
              <GoLink href="#studio/projects">Project mapping →</GoLink>
              <GoLink href="#studio/staff">Staff / assignment trace →</GoLink>
              <GoLink href="#studio/capacity">Declared capacity →</GoLink>
              <GoLink href="#studio/activity">Activity provenance →</GoLink>
            </div>
          </div>
        </Panel>
        {/*
          WF-DS-01 asked for a compact floor activity/capacity strip. The
          reviewer methodology that was previously a full panel moves to
          AboutMethod below — it is interpretation guidance, not floor state.
        */}
        <Panel title="Declared capacity and session state">
          <div className="body">
            <KV
              rows={[
                ['Declared capacity', b?.capacity.state ?? 'UNKNOWN'],
                ['Reason', b?.capacity.reason ?? 'Building projection unavailable.'],
                [
                  'Sessions',
                  surface.floor?.sessions?.available
                    ? `${surface.floor.sessions.count} · not a measure of work`
                    : 'UNAVAILABLE',
                ],
                ['Runtime', surface.floor?.runtime?.state ?? 'UNKNOWN'],
              ]}
            />
          </div>
        </Panel>
      </div>

      <AboutMethod title="About floor capacity and review">
        <p>
          Capacity is read from what the floor declares, never from session presence and never from a
          provider quota. Review states must be read in their project evidence — no reviewer completion
          is inferred from presence on the floor. Presence on Dev Studio is not project assignment: an
          identity appears on the roster because canonical identity and floor sources name it, and its
          assignment column reads UNKNOWN when no assignment source declares one. Project-room mapping is
          its own work area under Projects.
        </p>
      </AboutMethod>
    </>
  );
}

/**
 * PROJECTS — project-room mapping as a distinct work area (WF-DS-03).
 *
 * Answers "which declared project room sits on this floor, what is its
 * classification and state, and where does its truth come from". It is
 * deliberately NOT a second Overview: Overview links here, and here the mapping
 * is the whole job.
 */
function ProjectsWorkArea({ surface }: { surface: CommandSurface }) {
  const b = surface.building;
  if (!b) return <SourceGap reason="Building projection unavailable." />;
  return (
    <>
      <PeerWorkHeader
        peer="Projects"
        question="Which declared project room sits on this floor, and what is its state and source?"
        links={<GoLink href="#studio">Floor overview →</GoLink>}
      />
      <Panel title="Project-room mapping" count={`${b.projects.length} declared rooms`}>
        <div className="command-table-wrap">
          <table>
            <caption>
              Declared rooms · floor containment and canonical source · occupancy and execution state
              are separate facts
            </caption>
            <thead>
              <tr>
                <th style={{ width: '9rem' }}>Room</th>
                <th style={{ width: '8rem' }}>Classification</th>
                <th style={{ width: '9rem' }}>State</th>
                <th>Source</th>
                <th style={{ width: '11rem' }}>Enter</th>
              </tr>
            </thead>
            <tbody>
              {b.projects.map((p) => (
                <tr key={p.id}>
                  <td className="row-rail" data-tone={p.classification === 'OCCUPIED' ? 'room' : 'unknown'}>
                    <span className="mono">{p.name}</span>
                  </td>
                  <td>{p.classification}</td>
                  <td>
                    <Chip value={p.state} />
                  </td>
                  <td className="mono">{p.source ?? 'UNKNOWN'}</td>
                  <td>
                    {p.classification === 'OCCUPIED' ? (
                      <GoLink href={`#studio/${p.id}/overview`}>Open room</GoLink>
                    ) : (
                      <span className="text-2xs text-muted-foreground">
                        no operational source
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-2.5 py-1.5">
          <p className="prose-note">
            A room being OCCUPIED is not evidence that its business process is closed. Process
            closure is owned by the room itself, and task completion is not maturity.
          </p>
        </div>
      </Panel>
    </>
  );
}
