import { cn } from '@/lib/utils';
import type { CommandSurface } from '@/lib/contracts';
import { KV, Panel, SourceGap } from '@/components/console';
import { PeerWorkHeader, QualifierRow } from '@/components/work-area';

/**
 * System — HEALTH. Runtime, projection dimensions and contract state.
 *
 * GAP MAP WF-SYS-01 (HIGH), WF-SYS-03, WF-REP-02.
 *
 * WHAT WAS WRONG
 *
 * The Health landing carried, directly beneath the health cards, the complete
 * declared read-only source list, the identity registry and the staff-state
 * table. The gap map's finding was that the page "reads as a source inventory
 * page rather than a health watch face", and the product contract is explicit:
 * "The large source table belongs under Sources, never as the default System
 * landing view."
 *
 * This was also the mechanism by which Evidence and System became
 * interchangeable — two destinations that both opened on an inventory of the
 * same files. Evidence answers "where did this claim come from"; System answers
 * "is Command healthy". They now open on different questions.
 *
 * WHERE THE THREE BLOCKS WENT
 *
 *   declared read-only sources → System → Sources  (what this runtime may read)
 *   identity registry         → System → Sources  (registry completeness)
 *   staff state               → System → Sources  (duty evidence backing the roster)
 *   runtime / launcher state  → System → Runtime  (is the PROCESS up)
 *   contract version/authority → System → Contracts
 *   every health dimension    → System → Projection
 *
 * Nothing is deleted. Every field listed above is still read and still rendered;
 * it is rendered by the peer whose question it answers.
 *
 * HEALTH STOPS AFTER HEALTH, and the boundary is load-bearing
 *
 * Health answers one question: is the projection current and are its dimensions
 * individually healthy? It shows runtime state, projection dimensions,
 * workspace resolution, contract state and the latest degradation — and then a
 * concise lifecycle status with links to the peers that own the rest. A health
 * page that scrolls into an inventory has stopped answering its question.
 */
export function SystemSurface({ surface }: { surface: CommandSurface }) {
  const pt = surface.process_truth;
  const et = surface.execution_truth;
  const conditions = surface.health?.conditions ?? [];
  const health = surface.health;

  /*
    Degraded = any dimension not reporting OK. The comparison is against `OK`
    only, because `HealthCondition.state` is the `SurfaceState` vocabulary
    (OK / STALE / DRIFT / UNAVAILABLE / UNREADABLE) — there is no IN_SYNC on a
    health condition, and writing one in would be inventing a state the
    contract does not declare.
  */
  const degraded = conditions.filter((c) => c.state !== 'OK');

  return (
    <>
      <PeerWorkHeader
        peer="Health"
        question="Is Command's projection current, and is every dimension individually healthy?"
      />
      <QualifierRow>
        <span>overall {health?.overall ?? 'UNKNOWN'}</span>
        <span>
          {health?.counts.ok ?? 'UNKNOWN'}/{health?.counts.total ?? 'UNKNOWN'} conditions in sync
        </span>
        <span>degraded dimensions {degraded.length || 'none'}</span>
        <span>workspace {surface.workspace.root ?? 'UNRESOLVED'}</span>
      </QualifierRow>

      <div className="executive-grid" style={{ paddingTop: '0.6rem' }}>
        <Panel title="Runtime state" count="process, not data" className="rank-primary">
          <div className="body">
            <KV
              rows={[
                ['Mode', 'local-first · read-only'],
                ['Command UI version', uiVersion()],
                [
                  'Workspace resolved',
                  surface.workspace.root ?? 'UNRESOLVED',
                ],
                ['Resolution', surface.workspace.source ?? 'UNKNOWN'],
                ['Surface assembled', surface.assembled_at ?? 'UNKNOWN'],
              ]}
            />
            <p className="mt-2 text-2xs text-muted-foreground">
              Whether the Command PROCESS is up is a separate question from whether its projection is
              current, and it is answered on Runtime.
            </p>
          </div>
        </Panel>

        <Panel title="Projection dimensions" count={`${conditions.length} reported`} className="rank-primary">
          <div className="body">
            {conditions.length ? (
              <div className="space-y-1.5">
                {conditions.map((c) => (
                  <div key={c.key} className="flex items-center justify-between gap-2">
                    <span className="text-2xs">{c.key}</span>
                    <span
                      className={cn(
                        'rounded-sm border px-1.5 py-px font-mono text-2xs',
                        c.state === 'OK'
                          ? 'border-truth-ok/30 bg-truth-ok-soft text-truth-ok'
                          : c.state === 'STALE'
                            ? 'border-truth-stale/30 bg-truth-stale-soft text-truth-stale'
                            : 'border-truth-unknown/30 bg-truth-unknown-soft text-truth-unknown',
                      )}
                    >
                      {c.state}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <SourceGap reason="No health conditions declared at this projection." />
            )}
            <p className="mt-2 text-2xs text-muted-foreground">
              Each truth layer reports independently. There is no aggregate that could mask a failing
              dimension. OK confirms that a projection was readable; it does not establish current
              operational work, canonical-source agreement, or accepted completion.
            </p>
          </div>
        </Panel>

        <Panel title="Contract state" count={pt.version ?? 'UNKNOWN'} className="rank-support">
          <div className="body">
            <KV
              rows={[
                ['Contract', pt.version ?? 'UNKNOWN'],
                ['Status', pt.status ?? 'UNKNOWN'],
                ['Authority', pt.authority ?? 'UNKNOWN'],
                ['Generated', pt.generated_at ?? 'UNKNOWN'],
                ['Execution state', et.state],
              ]}
            />
            <p className="mt-2 text-2xs text-muted-foreground">
              Command renders these contracts and never writes them. Full version history and
              timestamps are on Contracts.
            </p>
          </div>
        </Panel>

        {/*
          LATEST REPORTED FAILURE. The contract requires freshness and the latest
          reported failure in the first viewport, and this is the one honest
          place to put it: it is a health statement, not an inventory row.
        */}
        <Panel title="Latest reported degradation" count={degraded.length || 'none declared'}>
          <div className="body">
            {degraded.length ? (
              <ul className="executive-list">
                {degraded.map((c) => (
                  <li key={c.key}>
                    <span className="font-medium text-foreground/90">{c.key}</span>
                    <span>{c.state}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-2xs text-muted-foreground">
                No dimension reports a degraded state at this projection.
              </p>
            )}
            {et.reason ? (
              <p className="mt-2 text-2xs text-truth-stale">{et.reason}</p>
            ) : null}
          </div>
        </Panel>
      </div>

      {/*
        CONCISE LIFECYCLE STATUS PLUS THE PEER OWNERSHIP MAP (WF-SYS-03).

        The gap map asked for "one compact cross-linking status row" instead of
        repeated full blocks. This is it: each destination named once, with what
        it owns, so an operator knows which surface to open instead of hunting
        for the same inventory in two places.
      */}
      <Panel title="Where the rest of System lives" count="one owner per fact" className="rank-method">
        <div className="body">
          <KV
            rows={[
              ['Runtime', 'is the Command process up — launcher state, ports, owned PIDs'],
              ['Sources', 'what this runtime may read, identity registry, staff duty state'],
              ['Contracts', 'contract version, status, authority and generation timestamps'],
              ['Projection', 'every health dimension, reported independently'],
              ['Evidence', 'claim provenance — see Evidence → Sources for per-source detail'],
              ['Room Integrity', 'project-specific reconciliation, owned by each room'],
            ]}
          />
          <p className="mt-2 text-2xs text-muted-foreground">
            Command reports projection state honestly. It does not infer service readiness from
            browser presence or task counts, and it exposes no restart or control action here.
          </p>
        </div>
      </Panel>
    </>
  );
}

function uiVersion(): string {
  const meta = import.meta as unknown as { env?: Record<string, string> };
  return meta.env?.VITE_APP_VERSION ?? '0.1.0 (local-first)';
}
