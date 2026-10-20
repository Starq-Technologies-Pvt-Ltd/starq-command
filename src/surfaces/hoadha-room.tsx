/**
 * Hoadha project room.
 *
 * IDENTITY
 *
 * Hoadha is PREPARED and NOT STARTED. It is a roadmap that has been read and
 * reconciled, not a project in flight. The room's accent is violet — distinct
 * from ERP's cyan — while the panel language, chips, hairlines and type scale
 * are byte-identical to ERP's. That is the whole of the visual distinction:
 * same product, different room.
 *
 * THE ROOM'S ACTUAL JOB
 *
 * Hoadha answers a commercial-closure question: where does commercial-discovery
 * truth stop being closed? Six loops, eleven waves, and a live/proposed
 * separation that must never be blurred. 326 live records and 33 proposed
 * additions are two different collections, shown as two different tables.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not activate H0, it does not convert a proposed task into a live one,
 * it does not compute a percentage of readiness, and it does not infer a staff
 * assignment from the company roster. Where source is silent it says UNKNOWN.
 */
import * as React from 'react';
import type { BuildingProjection, CommandSurface } from '@/lib/contracts';
import {
  Chip,
  GoLink,
  KV,
  Panel,
  SegmentedFilter,
  SourceGap,
  show,
} from '@/components/console';
import { AboutMethod, PeerWorkHeader, QualifierRow } from '@/components/work-area';
import { ProjectBoard } from '@/surfaces/project-board';
import { StaffSurface } from '@/surfaces/staff';
import { IntegritySurface } from '@/surfaces/integrity';

type H = BuildingProjection['hoadha'];

/**
 * ROOM STATE BAND — RETIRED FROM THIS MODULE.
 *
 * This room used to render a six-cell stat rail on every tab. Gap map WF-REP-03
 * recorded the same per-tab repetition here that WF-ERP-03 found in ERP.
 *
 * The band now lives in `RoomStateBand` in `surfaces/building.tsx`, mounted at
 * the ROOM WRAPPER. Room state is a property of the room, not of the body, and
 * mounting it in the room module would have produced a second owner for the
 * same band.
 */

/**
 * HoadhaFocus — the compact execution-state band (WF-HOA-02).
 *
 * GAP MAP: "Prepare truthful commercial-discovery closure" plus four blocker IDs
 * and a long method sentence occupied a large focus panel before the actual
 * loop/wave work. The finding was that execution prohibition is critical but the
 * panel had become methodology rather than operational state.
 *
 * WHAT IS COMPACT AND ALWAYS VISIBLE: NOT STARTED, no H0 activation, the
 * declared blocker IDs. Those are the facts an operator must not scroll past.
 *
 * WHAT MOVED: `execution_basis` — the long rationale sentence — into
 * `AboutMethod` below. It is interpretation, not state, and it was the reason
 * the band was tall.
 */
export function HoadhaFocus({ h }: { h: H }) {
  return (
    <div className="hoadha-state-band" data-hoadha-state="">
      <span>Execution</span>
      <strong>{show(h.execution)}</strong>
      {/*
        WF-HOA-02: the prohibition is stated ONCE here, on the line that
        carries the execution state, and it is a compact qualifier rather than a
        paragraph. It was previously repeated as a full sentence in a 12px
        weight that competed with NOT STARTED for the eye.
      */}
      <span className="qualifier">
        a prepared roadmap is not execution authorization · no H0 activation from this surface
      </span>
      {h.blockers.length ? (
        <span className="qualifier text-truth-unknown">
          blockers <span className="font-mono">{h.blockers.join(' · ')}</span>
        </span>
      ) : (
        <span className="qualifier">no blockers declared</span>
      )}
    </div>
  );
}

/** Wave ladder — H0..H10 as a compact horizontal rail, not a wide table. */
function WaveRail({ h }: { h: H }) {
  const current = h.current_wave;
  const byId = new Map(h.waves.map((w) => [w.id, w]));
  const ids = Array.from({ length: 11 }, (_, i) => `H${i}`);
  return (
    <Panel title="Wave ladder" count={`current ${show(current)}`}>
      <div className="flex flex-wrap gap-1 p-2">
        {ids.map((id) => {
          const w = byId.get(id);
          const isCurrent = id === current;
          return (
            <div
              key={id}
              title={w ? `${w.title} — ${w.objective}` : `${id} not present at source`}
              className="min-w-[3.6rem] flex-1 rounded-sm border px-1.5 py-1"
              style={{
                borderColor: isCurrent
                  ? 'hsl(var(--room) / 0.6)'
                  : 'hsl(var(--border))',
                background: isCurrent ? 'hsl(var(--room-soft))' : 'transparent',
              }}
            >
              <div
                className="font-mono text-[10px] font-semibold"
                style={{ color: isCurrent ? 'hsl(var(--room))' : undefined }}
              >
                {id}
              </div>
              <div className="truncate text-[9px] text-muted-foreground">
                {w ? w.title.replace(/^H\d+\s*/, '') : 'ABSENT'}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border px-2.5 py-1.5">
        <p className="prose-note">
          Wave position is roadmap position, not progress. A wave is not started until the floor
          records it as such.
        </p>
      </div>
    </Panel>
  );
}

/** Loop closure grid — the six loops with their declared blocker. */
function LoopGrid({ h }: { h: H }) {
  if (!h.loops.length)
    return (
      <Panel title="Loop closure">
        <SourceGap
          reason="Roadmap loops are not available at source."
          detail="The machine roadmap did not parse into six valid loops. No loops are invented."
        />
      </Panel>
    );
  return (
    <Panel title="Loop closure" count={`${h.loops.length} canonical loops`}>
      <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
        {h.loops.map((l) => (
          <div key={l.id} className="bg-surface-1 p-2">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] font-semibold">{l.id}</span>
              <span className="truncate text-[11px]">{l.name}</span>
              <span className="ml-auto">
                <Chip value={l.state} />
              </span>
            </div>
            <p className="mt-1 !text-[10px]">
              <span className="label-micro mr-1" style={{ fontSize: '8.5px' }}>
                gap
              </span>
              {l.blocker}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span className="label-micro" style={{ fontSize: '8.5px' }}>
                trace
              </span>
              {l.tasks.length ? (
                l.tasks.slice(0, 6).map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[9.5px] text-muted-foreground"
                  >
                    {t}
                  </span>
                ))
              ) : (
                <span className="font-mono text-[9.5px] text-truth-unknown">
                  {l.tasks === undefined || (l.tasks as unknown) === null
                    ? 'UNKNOWN'
                    : 'no task trace at source'}
                </span>
              )}
              {l.tasks.length > 6 ? (
                <span className="font-mono text-[9.5px] text-muted-foreground">
                  +{l.tasks.length - 6}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-2.5 py-1.5">
        <p className="prose-note">
          No task-completion percentage is computed here. A loop is closed by declared source
          state, not by counting its tasks.
        </p>
      </div>
    </Panel>
  );
}

/** Loop stage matrix — 16 stage assessments, compact. */
function StageMatrix({ h }: { h: H }) {
  if (!h.stages.length)
    return (
      <Panel title="Loop stage matrix">
        <SourceGap reason="Stage matrix is not available at source." />
      </Panel>
    );
  return (
    <Panel title="Loop stage matrix" count={`${h.stages.length} stage assessments`}>
      <div className="command-table-wrap">
        <table>
          <caption>
            Project-native stages · source evidence is not live proof
          </caption>
          <thead>
            <tr>
              <th style={{ width: '4rem' }}>Loop</th>
              <th style={{ width: '9rem' }}>Stages</th>
              <th style={{ width: '7rem' }}>State</th>
              <th>Evidence / blocker</th>
            </tr>
          </thead>
          <tbody>
            {h.stages.map((s, i) => (
              <tr key={`${s.loop}-${i}`}>
                <td className="mono">{s.loop}</td>
                <td className="mono">{s.stages}</td>
                <td>
                  <Chip value={s.state} />
                </td>
                <td>{s.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Prepared evidence index — claims mapped to their repository evidence. */
function EvidenceIndex({ h }: { h: H }) {
  if (!h.evidence.length)
    return (
      <Panel title="Evidence index">
        <SourceGap reason="Evidence index is not available at source." />
      </Panel>
    );
  return (
    <Panel title="Evidence index" count={`${h.evidence.length} claims`}>
      <div className="command-table-wrap">
        <table>
          <caption>Prepared evidence references · deployment unverified</caption>
          <thead>
            <tr>
              <th style={{ width: '32%' }}>Claim</th>
              <th>Repository evidence</th>
              <th style={{ width: '9rem' }}>Verified</th>
            </tr>
          </thead>
          <tbody>
            {h.evidence.map((e, i) => (
              <tr key={`${e.claim}-${i}`}>
                <td>{e.claim}</td>
                <td className="mono">{e.evidence}</td>
                <td>
                  <span className="chip" data-tone="unknown">
                    UNVERIFIED
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border px-2.5 py-1.5">
        <p className="prose-note">
          A claim with a repository reference is a prepared claim, not a deployed one. Production
          state is {h.production}.
        </p>
      </div>
    </Panel>
  );
}

/** What each Hoadha tab is FOR — same discipline as the ERP peers. */
const HOADHA_PEERS: Record<string, string> = {
  Overview: 'Is this room prepared, has anything started, and what blocks it?',
  Loops: 'Where does commercial-discovery truth stop being closed?',
  Board: 'Which canonical records are live, and which are only proposed?',
  Waves: 'What are the H0–H10 entry conditions and exit invariants?',
  Stages: 'Which loop stages are assessed, and on what evidence?',
  Evidence: 'Which repository references back each prepared claim?',
  Staff: 'Is any Hoadha-specific assignment declared?',
  Integrity: 'Did the expected board counts reconcile against source reads?',
};

/**
 * Hoadha room.
 *
 * GAP MAP WF-HOA-01 (HIGH), WF-HOA-02, WF-HOA-03, WF-WRONG-04.
 *
 * WHAT WAS WRONG
 *
 * Overview stacked the stat rail, a long focus panel, the Wave ladder, the Loop
 * closure grid, the Board and authority card, a "Go deeper" link list AND the
 * full Stage matrix. The contract says explicitly that Overview should be
 * compact and must not stack the full ladder/matrix/board/evidence product, and
 * the finding was that it was "a full report assembled inside the Overview
 * watch face" — so an operator could not form a simple prepared/not-started
 * mental model from the first view.
 *
 * THE RECOMPOSITION
 *
 *   · EXECUTION BAND — PREPARED / NOT STARTED, no H0 activation, declared
 *     blockers, and the 326/33 separation, all compact and always visible.
 *   · SIX-LOOP SUMMARY — one row per loop with its declared state and blocker.
 *     A summary, not the grid: the grid with task traces belongs to Loops.
 *   · WAVE POINTER — current wave and its neighbours, not the eleven-cell
 *     ladder. The ladder belongs to Waves.
 *   · EXECUTION BASIS — the long rationale sentence, behind a disclosure.
 *
 * Nothing is deleted. Every deep renderer that used to be stacked here is
 * still mounted on its named peer: Wave ladder → Waves, Loop grid → Loops,
 * Stage matrix → Stages, Evidence index → Evidence, authority state → Integrity.
 *
 * WHAT THIS FILE STILL DOES NOT DO
 *
 * It does not activate H0, convert a proposed task into a live one, compute a
 * readiness percentage, or infer a staff assignment from the company roster.
 * 326 and 33 are two collections and are never summed into one number.
 */
export function HoadhaRoom({
  tab,
  building,
  surface,
}: {
  tab: string;
  building: BuildingProjection;
  surface: CommandSurface;
}) {
  const h = building.hoadha;
  return (
    <>
      {/*
        No room state band here — see the ROOM STATE BAND note above. The router
        mounts it at the room wrapper, so it covers every Hoadha tab.
      */}
      <div className="command-stack">
        {tab === 'Overview' ? <HoadhaFocus h={h} /> : null}
        <PeerWorkHeader peer={tab} question={HOADHA_PEERS[tab] ?? tab} />

        {tab === 'Overview' ? (
          <HoadhaOverview h={h} />
        ) : tab === 'Loops' ? (
          <>
            <LoopGrid h={h} />
            <StageMatrix h={h} />
            <AboutMethod title="What loop closure means here">
              <p>
                Loop state and the declared blocker come from the canonical roadmap; Command computes
                no score. A loop is closed by declared source state, not by counting its tasks, and no
                task-completion percentage appears anywhere in this room.
              </p>
            </AboutMethod>
          </>
        ) : tab === 'Board' ? (
          <HoadhaBoard h={h} />
        ) : tab === 'Waves' ? (
          <>
            <WaveRail h={h} />
            <Panel title="Wave entry and exit invariants" count={`${h.waves.length} waves`}>
              <div className="command-table-wrap tall">
                <table>
                  <caption>
                    Current roadmap wave {show(h.current_wave)} · execution NOT STARTED
                  </caption>
                  <thead>
                    <tr>
                      <th style={{ width: '11rem' }}>Wave</th>
                      <th style={{ width: '26%' }}>Objective</th>
                      <th style={{ width: '22%' }}>Entry</th>
                      <th>Exit invariant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.waves.map((w) => (
                      <tr
                        key={w.id}
                        aria-selected={w.id === h.current_wave}
                        className={w.id === h.current_wave ? 'row-rail' : undefined}
                      >
                        <td
                          className="mono"
                          style={
                            w.id === h.current_wave
                              ? { borderLeftColor: 'hsl(var(--room))' }
                              : undefined
                          }
                        >
                          {w.title}
                        </td>
                        <td>{w.objective}</td>
                        <td>{w.entry}</td>
                        <td>{w.invariant}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <AboutMethod title="What a wave position means">
              <p>
                H0–H10 are planning waves with entry conditions and exit invariants. A wave position is
                not progress, and an exit invariant is not a completion claim. A wave is not started
                until the floor records it as such, and execution is {show(h.execution)}.
              </p>
            </AboutMethod>
          </>
        ) : tab === 'Stages' ? (
          <>
            <StageMatrix h={h} />
            <AboutMethod title="What a stage assessment means">
              <p>
                Stage evidence is project-native. A stage marked implemented in a prepared roadmap is
                not a deployed capability — production is {h.production}. Command does not verify
                either claim on its own.
              </p>
            </AboutMethod>
          </>
        ) : tab === 'Evidence' ? (
          <>
            <EvidenceIndex h={h} />
            <AboutMethod title="What a prepared evidence reference proves">
              <p>
                Prepared evidence references prove a file exists in the repository. They do not prove
                deployment, and Command does not verify either claim on its own. Every row is stamped
                UNVERIFIED because no source declares otherwise.
              </p>
            </AboutMethod>
          </>
        ) : tab === 'Staff' ? (
          <>
            <Panel title="Room-specific assignment">
              <SourceGap
                reason="UNKNOWN — no Hoadha staff assignment source declared."
                detail="A prepared roadmap is not an execution roster. Nothing is inferred from the company floor."
              />
            </Panel>
            <StaffSurface surface={surface} />
            <AboutMethod title="Assignment boundary">
              <p>
                No prepared room-specific staff assignment source is declared. The company roster
                below is shown for reference and does not establish a Hoadha assignment. Presence on
                Dev Studio is not project assignment.
              </p>
            </AboutMethod>
          </>
        ) : tab === 'Integrity' ? (
          <IntegritySurface building={building} project="hoadha" surface={surface} />
        ) : null}
      </div>
    </>
  );
}

/**
 * The compact Overview watch face.
 *
 * Everything here is a SUMMARY whose deep form lives on a named peer. The test
 * applied is the contract's own: could an operator form a "prepared, not
 * started, here is the wave, here is what blocks it" model from this one
 * viewport? If a block is needed to answer that, it belongs on a peer instead.
 */
function HoadhaOverview({ h }: { h: H }) {
  const waveIndex = /^H(\d+)$/.exec(h.current_wave)?.[1];
  const currentNum = waveIndex ? Number(waveIndex) : null;
  const neighbours =
    currentNum === null
      ? []
      : [currentNum - 1, currentNum, currentNum + 1]
          .filter((n) => n >= 0 && n <= 10)
          .map((n) => `H${n}`);

  return (
    <>
      {/*
        SIX-LOOP SUMMARY. One comparable row per loop with its declared state
        and blocker. The full grid — including task traces and the +N overflow —
        is on Loops; a summary here is what the contract asks for and it is
        enough to answer "where has closure stopped".
      */}
      <Panel title="Loop closure summary" count={`${h.loops.length} canonical loops`} className="rank-primary">
        {h.loops.length ? (
          <div className="command-table-wrap short">
            <table>
              <caption>
                Declared loop state · no score is computed from task counts
              </caption>
              <thead>
                <tr>
                  <th style={{ width: '4rem' }}>Loop</th>
                  <th style={{ width: '12rem' }}>Name</th>
                  <th style={{ width: '7rem' }}>State</th>
                  <th>Declared blocker</th>
                </tr>
              </thead>
              <tbody>
                {h.loops.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.id}</td>
                    <td>{l.name}</td>
                    <td>
                      <Chip value={l.state} />
                    </td>
                    <td className="text-2xs">{l.blocker}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <SourceGap
            reason="Roadmap loops are not available at source."
            detail="The machine roadmap did not parse into six valid loops. No loops are invented."
          />
        )}
        <GoLink href="#studio/hoadha/loops">Full loop closure with task traces →</GoLink>
      </Panel>

      <div className="command-split wide">
        {/*
          WAVE POINTER. The current wave and its immediate neighbours, with the
          full H0–H11 ladder on Waves. "Which wave are we at" is an Overview
          question; "what does every wave require" is a Waves question.
        */}
        <Panel title="Current wave" count={show(h.current_wave)} className="rank-primary">
          <div className="body">
            <KV
              rows={[
                ['Current wave', show(h.current_wave)],
                ['Roadmap source', show(h.source_status)],
                ['Ladder position', waveIndex ? `wave ${waveIndex} of H0–H10` : 'UNKNOWN'],
                ['Execution', show(h.execution)],
                ['Production', show(h.production)],
              ]}
            />
            {neighbours.length ? (
              <div className="mt-2">
                <p className="label-sec mb-1">Neighbouring waves</p>
                <div className="flex flex-wrap gap-1">
                  {neighbours.map((id) => (
                    <span
                      key={id}
                      className="chip"
                      data-tone={id === h.current_wave ? 'room' : 'muted'}
                    >
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <GoLink href="#studio/hoadha/waves">Full wave ladder →</GoLink>
          </div>
        </Panel>

        {/*
          COLLECTION SEPARATION. 326 live and 33 proposed are two collections.
          The contract forbids ever combining them into one operational total,
          so this block shows them as two labelled facts with a count each and
          no sum anywhere.
        */}
        <Panel title="Collections" count="never summed" className="rank-primary">
          <div className="body">
            <KV
              rows={[
                ['Live records', h.live_count === null ? 'UNKNOWN' : `${h.live_count}`],
                ['Proposed additions', h.proposed_count === null ? 'UNKNOWN' : `${h.proposed_count}`],
                ['Integration', show(h.integration)],
                ['Authority', 'Hoadha owns public discovery; ERP/POS owns private operational truth'],
              ]}
            />
            <p className="mt-2 text-2xs text-muted-foreground">
              The two rooms do not merge their authority, and the two collections are not one total.
              Adding a proposed task does not change the live count.
            </p>
            <GoLink href="#studio/hoadha/board">Open the board →</GoLink>
          </div>
        </Panel>
      </div>

      {/*
        EXECUTION BASIS, behind a disclosure (WF-HOA-02). It was the long method
        sentence inside the focus panel, and it is the reason that panel was
        tall enough to push the loop work down the page. Preserved verbatim, one
        click away, and no longer in the critical path.
      */}
      <AboutMethod title="Execution basis">
        <p>{h.execution_basis}</p>
        <p className="mt-2">
          A prepared roadmap is not execution authorization. Nothing on this surface activates H0,
          converts a proposed task into a live one, or computes a readiness percentage.
        </p>
      </AboutMethod>
    </>
  );
}

/**
 * BOARD — live and proposed as an explicit, mutually exclusive choice.
 *
 * GAP MAP WF-HOA-03 (MEDIUM): "the board's collection choice and counts require
 * scanning the surrounding room rail/stat rail to understand what is active",
 * and the intended outcome is that "collection selector, active collection,
 * count, and 'not live' qualifier remain adjacent to the board rows at all
 * widths".
 *
 * So the two collections are a SEGMENTED CONTROL with both counts inside it, the
 * active collection is named in words, and the non-active collection carries an
 * explicit "not live" qualifier. Switching clears the selection, because a record
 * selected from Live is not a record selected from Proposed and leaving the
 * selection pointing at a record from the other collection would be a lie about
 * what is selected.
 */
function HoadhaBoard({ h }: { h: H }) {
  const [collection, setCollection] = React.useState<'live' | 'proposed'>('live');
  const liveRecords =
    h.boards.every((b) => b.count !== null)
      ? h.boards.flatMap((b) => b.records)
      : null;
  const proposedRecords = h.proposed_count === null ? null : h.proposed;

  const records = collection === 'live' ? liveRecords : proposedRecords;

  return (
    <>
      {/*
        THE CONTROL ITSELF. `role="group"` with `aria-pressed` on each option, so
        the mutually exclusive choice is announced as a choice. Both counts are
        inside the control, which is what makes "which collection am I in and
        how big is the other one" answerable without leaving the control.
      */}
      <div className="collection-switch" data-collection-switch={collection}>
        <SegmentedFilter
          label="Collection"
          value={collection}
          onChange={(next) => setCollection(next)}
          options={[
            { id: 'live', label: 'Live', count: h.live_count ?? null },
            { id: 'proposed', label: 'Proposed', count: h.proposed_count ?? null },
          ]}
        />
        <QualifierRow>
          <span>
            active collection <strong>{collection === 'live' ? 'LIVE' : 'PROPOSED'}</strong> ·{' '}
            {h.live_count ?? 'UNKNOWN'} live
          </span>
          <span>
            {h.proposed_count ?? 'UNKNOWN'} proposed ·{' '}
            {collection === 'live'
              ? 'proposed records are NOT live and are not shown'
              : 'proposed records are NOT live'}
          </span>
          <span>the two collections are never summed</span>
        </QualifierRow>
      </div>

      <ProjectBoard
        key={collection}
        records={records}
        label={
          collection === 'live'
            ? 'Canonical live Hoadha boards'
            : 'Proposed HCD roadmap additions'
        }
        projectLabel="Hoadha"
      />

      {/*
        BOTH COLLECTIONS REMAIN REACHABLE. The active one is shown as the work
        body; the other is one click away and its count is always visible in the
        control. Nothing is deleted by the selection.
      */}
      <Panel title="The other collection" count={collection === 'live' ? 'proposed' : 'live'}>
        <div className="body">
          <p className="text-2xs text-muted-foreground">
            {collection === 'live'
              ? `${h.proposed_count ?? 'UNKNOWN'} proposed roadmap additions are held in a separate planning collection. They are not live records, and adding one does not change the live count of ${h.live_count ?? 'UNKNOWN'}.`
              : `${h.live_count ?? 'UNKNOWN'} live records are the canonical board. Selecting this collection does not merge the two, and the proposed additions remain a separate collection.`}
          </p>
          <GoLink
            href={collection === 'live' ? '#studio/hoadha/board' : '#studio/hoadha/board'}
          >
            {collection === 'live' ? 'Show proposed instead' : 'Show live instead'} →
          </GoLink>
        </div>
      </Panel>

      <AboutMethod title="How to read the board">
        <p>
          Two collections, never summed. The live board is what the canonical packet records now; the
          proposed additions are a separate planning collection with their own states. Wave position is
          roadmap position, not progress, and execution is {show(h.execution)}. This surface provides
          no execution authorization and no board mutation.
        </p>
      </AboutMethod>
    </>
  );
}
