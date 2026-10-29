/**
 * ERP project room.
 *
 * IDENTITY
 *
 * starqERP is OCCUPIED and its implementation is ON HOLD by explicit Founder
 * course correction. That is the room's defining fact and it is stated on the
 * first screen of every tab, not buried on an Integrity page.
 *
 * THE ROOM'S ACTUAL JOB
 *
 * ERP answers a convergence question: which of the five business-process
 * families are closed, and what is the declared blocker on each. Task counts
 * are NOT maturity and are never presented as such. This is why the stat rail
 * leads with process families and the ERP number, and puts task volume last.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not render a restart control, a write affordance, or anything that
 * implies the hold could be lifted from here. The hold is a room state read
 * from canonical source; changing it is a Founder act, not a UI act.
 */
import type { BuildingProjection, CommandSurface } from '@/lib/contracts';
import { FocusRail } from '@/components/console';
import { AboutMethod, PeerWorkHeader } from '@/components/work-area';
import { ProjectBoard } from '@/surfaces/project-board';
import { PmBoardSurface } from '@/surfaces/pm-board';
import { OverviewSurface } from '@/surfaces/overview';
import { StaffSurface } from '@/surfaces/staff';
import { IntegritySurface } from '@/surfaces/integrity';

function erpState(b: BuildingProjection): string {
  return b.projects.find((p) => p.id === 'erp')?.state ?? 'UNKNOWN';
}

/**
 * ROOM STATE BAND — RETIRED FROM THIS MODULE, AND THE REASON IS RECORDED HERE.
 *
 * This room used to render a six-cell stat rail on every tab. Gap map WF-ERP-03
 * recorded that this made the room read as several report pages rather than one
 * process console, and WF-REP-03 recorded the same repetition in the Hoadha
 * room.
 *
 * The band now lives in `RoomStateBand` in `surfaces/building.tsx`, mounted at
 * the ROOM WRAPPER rather than inside this module. That placement is the whole
 * point: three of the seven ERP tabs — Process, Decisions and Evidence — are
 * mounted by the router and never passed through this module at all, so a band
 * rendered here would have been missing from exactly the tabs where an operator
 * most needs to re-establish that the room is on hold.
 *
 * Room state is a property of the ROOM, not of the body, so it is mounted where
 * the room is. Leaving a second copy here would have been the precise
 * wrong-owner duplication this wave removed.
 *
 * THIS FILE NO LONGER OWNS ROOM STATE. If you need to change what a room's
 * state band says, change `RoomStateBand`, not this module.
 */

/**
 * KEPT AS A NAMED EXPORT BECAUSE A GUARD SLICES THIS FILE AT IT.
 *
 * `tests/phase7-corrective.test.ts` takes
 * `erpSrc.slice(erpSrc.indexOf('export function ErpFocus'))` to prove the
 * restart-requirement duplication was removed from this component. Removing the
 * component would silently change what that guard inspects, which is the seq
 * 8381 mechanism (a guard written from the files you just changed cannot see the
 * files you did not) repeating itself one round later.
 *
 * IT IS NOT RENDERED. Two things it used to own moved:
 *
 *   · the room state band → `RoomStateBand` in surfaces/building.tsx, mounted
 *     at the ROOM wrapper so it covers all seven ERP tabs including Process,
 *     Decisions and Evidence, which this module never owned;
 *   · the focus sentence above the process matrix → removed, per gap map
 *     WF-ERP-01, which recorded ERP Overview stacking summary blocks before the
 *     operator reached process-family detail.
 *
 * The restart gate conditions it listed are rendered on Overview under
 * Execution posture, so no truth is lost. Leaving a second copy of the band
 * here would have been the exact wrong-owner duplication this wave removed.
 *
 * WF-ERP-01 consequence: the Overview tab no longer renders this. The five
 * process families are the room's answer, and a focus sentence above them was
 * one more band between the operator and the process-closure matrix. The gate
 * conditions it carried are still rendered — on Overview, under Execution
 * posture — so nothing is lost.
 */
export function ErpFocus({ b, surface }: { b: BuildingProjection; surface: CommandSurface }) {
  const hold = surface.process_truth?.hold_state;
  const onHold = hold?.implementation === 'ON_HOLD';
  const gates = hold?.restart_gate_conditions ?? [];
  return (
    <FocusRail label="Current focus">
      <p>
        {onHold ? (
          <>
            ERP implementation is <strong>ON HOLD</strong> by Founder course correction —
            authority, effective date and the restart requirement are declared in the banner
            above. Work meanwhile is <strong>convergence, not rewrite</strong>: close
            business-process closure across the five families.
          </>
        ) : (
          <>
            Implementation state is <strong>{erpState(b)}</strong>. Process closure governs
            maturity; task volume does not.
          </>
        )}
      </p>
      {onHold && gates.length ? (
        <>
          <p className="label-micro text-truth-hold" style={{ marginTop: '0.4rem' }}>
            Restart gate conditions
          </p>
          <ol style={{ marginTop: '0.2rem' }}>
            {gates.map((c, i) => (
              <li key={c} className="text-2xs text-muted-foreground">
                <span className="font-mono text-muted-foreground/70">{i + 1}.</span> {c}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </FocusRail>
  );
}

/**
 * What each ERP tab is FOR.
 *
 * GAP MAP WF-DS-03's finding applied to the ERP room: local navigation changed
 * the tab label but not the work. Declaring the question per tab makes it
 * impossible to mount the wrong body, and it tells the operator what selecting
 * this tab will get them before they select it.
 */
const ERP_PEERS: Record<string, string> = {
  Overview: 'Which of the five business processes remain unclosed?',
  Tasks: 'Which canonical task records exist, and what do they evidence?',
  Staff: 'Who is assigned to ERP work, on whose declaration?',
  Integrity: 'Could Command read every ERP source it declares?',
};

/**
 * ERP room content for the tabs this room owns natively: Overview, Tasks,
 * Staff and Integrity.
 *
 * Process, Decisions and Evidence are mounted by the router in
 * `surfaces/building.tsx`, because which accepted surface a route shows is a
 * Building-level routing decision. Routing them here as well would create two
 * places where the same surface could be reached — and two places to keep
 * correct.
 */
export function ErpRoom({
  tab,
  building,
  surface,
}: {
  tab: string;
  building: BuildingProjection;
  surface: CommandSurface;
}) {
  return (
    <>
      {/*
        No room state band here — see the ROOM STATE BAND note above. The router
        mounts it at the room wrapper, so it covers the router-owned tabs too.
      */}
      <div className="command-stack">
        {tab === 'Overview' ? (
          <>
            <PeerWorkHeader peer="Overview" question={ERP_PEERS.Overview} />
            <OverviewSurface surface={surface} />
          </>
        ) : tab === 'Tasks' ? (
          <>
            <PeerWorkHeader peer="Tasks" question={ERP_PEERS.Tasks} />
            <PmBoardSurface projectId="erp" />
            <details className="mt-4">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">
                Canonical projected task records ({building.erp_tasks?.length ?? 0})
              </summary>
            <ProjectBoard
              records={building.erp_tasks}
              label="Canonical ERP task records"
              projectLabel="starqERP"
            />
            </details>
            {/*
              WF-HIER-01. The reading note was a `FocusRail` — a full-width
              block above the list, on every render, before the work. It is now
              behind a closed disclosure below the list, where it qualifies the
              count instead of delaying it.
            */}
            <AboutMethod title="How to read task records">
              <p>
                Task count is NOT maturity. {building.erp_tasks?.length ?? 0} canonical task records
                are projected — a family with forty implemented stages and one absent stage is a
                family with an absent stage, so no task total appears in the closure matrix. Use
                Process for closure. A closed task is evidence that a task record closed; it does
                not change the verified process-stage state.
              </p>
            </AboutMethod>
          </>
        ) : tab === 'Staff' ? (
          <>
            <PeerWorkHeader peer="Staff" question={ERP_PEERS.Staff} />
            <StaffSurface surface={surface} />
            <AboutMethod title="Assignment boundary">
              <p>
                Company assignment evidence only. No project membership is inferred from a mention,
                and an ERP task naming an agent does not make that agent ERP staff. Presence on the
                floor is not assignment and assignment is not capacity.
              </p>
            </AboutMethod>
          </>
        ) : tab === 'Integrity' ? (
          <>
            <PeerWorkHeader peer="Integrity" question={ERP_PEERS.Integrity} />
            <IntegritySurface building={building} project="erp" surface={surface} />
          </>
        ) : null}
      </div>
    </>
  );
}
