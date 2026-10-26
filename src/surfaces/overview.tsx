import { CircleSlash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { UnknownValue } from '@/components/state-gate';
import { Chip, GoLink, KV, Panel } from '@/components/console';
import { AboutMethod } from '@/components/work-area';
import { cn, formatCount, formatMaturity } from '@/lib/utils';
import { STAGE_TONE, worstStage } from '@/lib/states';
import type { CommandSurface } from '@/lib/contracts';

/**
 * ERP Overview — which business processes remain unclosed.
 *
 * GAP MAP WF-ERP-01 (BLOCKER), WF-ERP-02, WF-ERP-03, WF-WRONG-03.
 *
 * WHAT WAS WRONG
 *
 * The surface opened with `40.31%` "ERP process maturity" set in a 5xl hero
 * number. The surrounding text said task count is not maturity and process
 * closure governs, and the finding was that the visual prominence of the
 * number defeats its own caveat: the page read as a progress dashboard wearing
 * an ERP label. Underneath it sat the hold block, an execution panel, four
 * statistic cards and the carried decisions — so the process-closure question
 * the room exists to answer was buried under summary and diagnostic repetition.
 *
 * THE RECOMPOSITION, in the order the product contract requires:
 *
 *   1. compact ON_HOLD identity — the room's defining state, stated first
 *   2. THE FIVE PROCESS FAMILIES as the hero work area, with per-family stage
 *      state and declared blocker
 *   3. critical blockers, with the family each belongs to
 *   4. direct Process / Tasks links
 *   5. maturity as a COMPACT QUALIFIED METRIC — still present, still caveated,
 *      no longer the biggest thing on the page
 *   6. task count LAST, explicitly labelled evidentiary
 *
 * NOTHING RECOMPUTED
 *
 * Every number here is forwarded from a canonical projection. The maturity
 * percentage is not recalculated, rounded differently, or re-derived; it is
 * rendered as the contract computed it and demoted from hero to qualified
 * metric. Demoting a number's visual weight is not editing its value, and the
 * Phase 5/Phase 6 guards on `formatMaturity` are untouched.
 *
 * ON_HOLD IS PRESERVED, AND STILL OWED TO ONE OWNER
 *
 * The canonical hold record — authority, effective date, restart requirement —
 * belongs to `HoldBanner` and is not restated here (Goose R4, Room seq 8383).
 * What this surface shows is the room's `ON_HOLD` identity plus the ordered
 * restart gate conditions, which are a list the one-line banner has nowhere to
 * put.
 */
export function OverviewSurface({ surface }: { surface: CommandSurface }) {
  const pt = surface.process_truth;
  const wt = surface.work_truth;
  const et = surface.execution_truth;

  const l4 = wt.maturity?.L4 ?? null;
  const l1 = wt.maturity?.L1 ?? null;
  const hold = pt.hold_state;
  const discrepancies = pt.reconciliation?.known_discrepancies ?? [];
  const families = pt.process_families ?? [];
  const gaps = pt.convergence_gaps ?? [];
  const conflicts = et.conflicts ?? [];
  const onHold = hold?.implementation === 'ON_HOLD';

  const agents = et.agents ?? [];
  const staleAgents = agents.filter((a) => a.activity_freshness === 'STALE');
  const currentAgents = agents.length - staleAgents.length;

  const founderWaiting = discrepancies.filter((d) => d.founder_decision_required === true);

  /*
    THE FIVE CANONICAL FAMILIES, and the reason they are primary.

    A family's state here is its WORST STAGE, never an average. That is not a
    styling choice: a family with ten implemented stages and one absent stage IS
    a family with an absent stage, and any average over its stages would report
    91% for a family that has not closed. `worstStage` selects; it does not
    aggregate. The rollup is therefore the same number the contract computed,
    presented per family rather than as one headline.

    Each family row is a link into Process, because the operator's next action
    after seeing "this family is not closed" is to inspect the stages — and
    that inspection is the room's primary destination.
  */
  const familyRows = families.map((f) => ({
    family: f,
    worst: worstStage(f.stages.map((s) => s.state)),
    blocker: f.critical_blocker ?? f.stages.find((s) => Boolean(s.blocked_by))?.blocked_by ?? null,
  }));

  /*
    CRITICAL BLOCKERS, each attributed to its family.

    Selecting over declared fields only: `family.critical_blocker` first, and a
    stage `blocked_by` where no family-level blocker is declared. Nothing is
    inferred from how a stage's state looks, and the list is not ordered by
    severity — there is no severity on this surface.
  */
  const blockers = families.flatMap((f) => {
    if (f.critical_blocker) return [{ family: f.name, blocker: f.critical_blocker }];
    return f.stages
      .filter((s) => Boolean(s.blocked_by))
      .map((s) => ({ family: `${f.name} — ${s.stage}`, blocker: s.blocked_by as string }));
  });

  return (
    <div className="flex flex-col gap-3 p-4">
      {/*
        (1) COMPACT ON_HOLD IDENTITY. The room's defining fact, one band, above
        everything. This is room STATE, not the canonical hold record — the
        banner above already owns authority, effective date and the restart
        requirement.
      */}
      <div className="room-state-band" data-room-state-band="erp">
        <span className="label-micro">starqERP</span>
        <Chip value={onHold ? hold?.implementation ?? 'ON_HOLD' : 'UNKNOWN'} tone="hold" />
        <span className="text-2xs text-muted-foreground">
          private operational truth · POS stays inside this room · process closure governs maturity
        </span>
        <span className="spacer" />
        <GoLink href="#studio/erp/process">Process →</GoLink>
        <GoLink href="#studio/erp/tasks">Tasks →</GoLink>
      </div>

      {/* (2) THE FIVE PROCESS FAMILIES — the hero work area. */}
      <Panel title="Process closure by family" count={`${families.length} canonical families`} className="rank-primary">
        <div className="body">
          {familyRows.length ? (
            <div className="command-table-wrap">
              <table>
                <caption>
                  The five canonical process families · each family's state is its WORST stage, never
                  an average · task completion is not maturity
                </caption>
                <thead>
                  <tr>
                    <th style={{ width: '12rem' }}>Family</th>
                    <th style={{ width: '9rem' }}>Closure state</th>
                    <th style={{ width: '6rem' }}>Stages</th>
                    <th>Declared blocker</th>
                  </tr>
                </thead>
                <tbody>
                  {familyRows.map(({ family: f, worst, blocker }) => {
                    /*
                      `STAGE_TONE[worst]` is a TOTAL lookup by contract, but
                      `worstStage` returns whatever string canonical source put
                      in `stage.state`. If a projection ever carries a stage state
                      outside the declared vocabulary, indexing straight into the
                      map returns undefined and `.chip` throws — which takes the
                      ENTIRE room down rather than degrading one cell.

                      The fallback is UNKNOWN, which is the honest answer for a
                      state this product does not recognise, and it matches the
                      discipline the rest of Command follows: an unrecognised
                      value is never given a healthy-looking tone by omission.
                    */
                    const tone = STAGE_TONE[worst] ?? STAGE_TONE.UNKNOWN;
                    return (
                      <tr key={f.id} data-erp-family={f.id}>
                        <td className="row-rail" data-tone={f.critical_blocker ? 'drift' : 'room'}>
                          <span className="mono">{f.id}</span>
                          <div className="text-[10px] text-muted-foreground">{f.name}</div>
                        </td>
                        <td>
                          <span className={cn('rounded-sm border px-1.5 py-px text-2xs', tone.chip)}>
                            {tone.label}
                          </span>
                        </td>
                        <td className="tnum text-2xs text-muted-foreground">{f.stages.length}</td>
                        <td className="text-2xs text-foreground/90">
                          {blocker ?? (
                            <span className="text-muted-foreground">
                              no blocker declared · not evidence of closure
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <UnknownValue reason="process truth unavailable — no process families were read." />
          )}
          <p className="mt-2 text-2xs text-muted-foreground">
            A family's state is its worst stage. Ten implemented stages and one absent stage is a
            family with an absent stage, so no average over stages appears here.
          </p>
        </div>
      </Panel>

      {/* (3) CRITICAL BLOCKERS. */}
      <Panel title="Declared blockers" count={blockers.length || 'none declared'} className="rank-primary">
        <div className="body">
          {blockers.length ? (
            <ul className="executive-list">
              {blockers.map((b) => (
                <li key={`${b.family}:${b.blocker}`}>
                  <span className="font-medium text-foreground/90">{b.family}</span>
                  <span>{b.blocker}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-2xs text-muted-foreground">
              No blocker is declared at source. That is an empty declared set, not a claim that
              nothing blocks.
            </p>
          )}
        </div>
      </Panel>

      {/* (4) MATURITY — compact, qualified, demoted. */}
      <Panel title="Maturity diagnostic" count={l4 ? formatMaturity(l4.maturity) : 'UNKNOWN'} className="rank-method">
        <div className="body">
          {l4 && wt.available ? (
            <>
              {/*
                WF-ERP-01 / WF-WRONG-03, measured: this was `text-lg` (18px) —
                the LARGEST number on the ERP Overview page — on a diagnostic
                whose own caption says "a qualified diagnostic, not the room's
                headline". Visual prominence was overriding the caveat, which is
                exactly the BLOCKER finding. It is now the record tier, in the
                same weight as every other declared value on this surface, so
                the five-family matrix above it is unambiguously the answer.
              */}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="tnum text-[12.5px] font-semibold text-foreground/85">{formatMaturity(l4.maturity)}</span>
                <span className="font-mono text-2xs text-muted-foreground">
                  raw {formatMaturity(l4.raw)}
                </span>
                {l4.any_family_has_absent_stage ? (
                  <span className="text-2xs text-truth-drift">a family has an absent stage</span>
                ) : null}
              </div>
              <Progress value={l4.maturity} className="mt-2" />
              <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">{l4.excludes}</p>
            </>
          ) : (
            <UnknownValue reason="work truth projection unavailable" />
          )}
          <p className="mt-2 text-2xs text-muted-foreground">
            A qualified diagnostic, not the room's headline. The five families above are the process
            truth; this number is the contract's rollup of it.
          </p>
        </div>
      </Panel>

      {/* (5) EXECUTION POSTURE AND RESTART GATE. */}
      <div className="command-split">
        <Panel title="Execution posture" count={onHold ? 'BLOCKED BY HOLD' : 'RUNNING'}>
          <div className="body">
            {onHold && hold?.restart_gate_conditions?.length ? (
              <>
                <p className="label-sec mb-1">Restart gate conditions</p>
                <ul className="space-y-1">
                  {hold.restart_gate_conditions.map((c) => (
                    <li key={c} className="flex gap-1.5 text-2xs text-muted-foreground">
                      <CircleSlash className="mt-0.5 h-2.5 w-2.5 shrink-0 text-truth-hold" />
                      {c}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-2xs text-muted-foreground">
                Authority, effective date and the restart requirement are declared in the hold banner
                above.
                {onHold ? ' No restart gate conditions are recorded in canonical source.' : ''}
              </p>
            )}
            <p className="mt-2 text-2xs text-muted-foreground">
              A Founder-imposed hold on implementation, not a technical dependency. Nothing on this
              surface authorises or schedules a restart.
            </p>
          </div>
        </Panel>

        {/*
          (6) TASK COUNT — LAST, and explicitly evidentiary. It was previously a
          hero metric; the doctrine says task completion is evidence, not
          maturity, so it now reads as what it is.
        */}
        <Panel title="Task records" count={`${wt.tasks?.length ?? 'UNKNOWN'} · evidence only`} className="rank-method">
          <div className="body">
            <KV
              rows={[
                ['Task records', wt.tasks?.length ?? 'UNKNOWN'],
                ['Corrective lineages', wt.corrective_lineage?.length ?? 'UNKNOWN'],
                [
                  'Work states',
                  Object.keys(wt.counts ?? {}).length || 'UNKNOWN',
                ],
              ]}
            />
            <p className="mt-2 text-2xs text-muted-foreground">
              Task count is NOT maturity. A closed task never raises ERP maturity unless it
              changes the verified process-stage state on Process.
            </p>
            <GoLink href="#studio/erp/tasks">Open task records →</GoLink>
          </div>
        </Panel>
      </div>

      {/* CARRIED DECISIONS. */}
      <Panel title="Carried decisions" count={founderWaiting.length || 'none declared'} className="rank-method">
        <div className="body">
          {!pt.available ? (
            <UnknownValue reason="process truth unavailable" />
          ) : founderWaiting.length === 0 ? (
            <p className="text-2xs text-muted-foreground">
              No discrepancy carries founder_decision_required = true at this projection.
            </p>
          ) : (
            <ul className="work-row-list" style={{ maxHeight: '32vh' }}>
              {discrepancies.map((d) => (
                <li
                  className="work-row"
                  key={d.id}
                  data-work-row={d.id}
                  data-tone={d.founder_decision_required ? 'founder' : 'unknown'}
                >
                  <span className="k">{d.id}</span>
                  <span className="r">{d.item}</span>
                  <span className="v">
                    roadmap: {d.roadmap_says ?? 'n/a'} · local board: {d.local_board_says ?? 'n/a'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-2xs text-muted-foreground">
            Recorded and surfaced, never auto-resolved. Command does not reconcile these.
          </p>
          <GoLink href="#attention/decisions">Founder Attention →</GoLink>
        </div>
      </Panel>

      {/* (7) EXECUTION SUMMARY — below the process work, as supporting evidence. */}
      <ExecutionSummary
        agents={agents.length}
        staleAgents={staleAgents.length}
        currentAgents={currentAgents}
        founderWaiting={founderWaiting.length}
        conflicts={conflicts.length}
        et={et}
      />

      {/* THE THREE TRUTHS, kept separate. */}
      <div className="grid gap-3 lg:grid-cols-3">
        <TruthColumn
          title="Process truth"
          source="contract.json → process_families"
          available={pt.available}
          state={pt.state}
          lines={
            pt.available
              ? [
                  `${families.length} canonical process families`,
                  `${families.reduce((n, f) => n + (f.stages?.length ?? 0), 0)} verified stage classifications`,
                  `${gaps.length} convergence gaps registered`,
                  'Parsed from the canonical roadmap — never re-derived',
                ]
              : []
          }
        />
        <TruthColumn
          title="Execution truth"
          source="activity.json ← Room ledger"
          available={et.available}
          state={et.state}
          lines={
            et.available
              ? [
                  `${agents.length} identities observed`,
                  `${currentAgents} current · ${staleAgents.length} stale`,
                  `staleness rule: ${pt.execution_truth_layer_meta?.staleness?.stale_after_hours ?? 'UNKNOWN'}h`,
                  'Activity never changes process maturity',
                ]
              : []
          }
        />
        <TruthColumn
          title="Work truth"
          source="command_work_model.json"
          available={wt.available}
          state={wt.state}
          lines={
            wt.available
              ? [
                  `${wt.tasks?.length ?? 0} tasks mapped onto process closure`,
                  `${Object.keys(wt.counts ?? {}).length} work states in the vocabulary`,
                  `${wt.corrective_lineage?.length ?? 0} corrective lineages recorded`,
                  'L1 is informational — never the ERP number',
                ]
              : []
          }
        />
      </div>

      {/*
        WF-HIER-01. Convergence gaps and the L1 task breakdown are diagnostic
        depth below the work, not part of it. They move behind a closed
        disclosure — preserved, reachable, and no longer pushing the process
        matrix down the page.
      */}
      <AboutMethod title="Convergence gaps and task breakdown">
        <div className="space-y-3">
          {pt.available && gaps.length ? (
            <div>
              <p className="label-sec mb-1.5">Convergence gap register</p>
              <ul className="space-y-2">
                {gaps.map((g) => (
                  <li key={g.id} className="border-l-2 border-truth-drift pl-2">
                    <p className="text-2xs">
                      <span className="font-mono text-muted-foreground">{g.id}</span> {g.title}
                    </p>
                    {g.chains?.length ? (
                      <p className="text-2xs text-muted-foreground">chains: {g.chains.join(', ')}</p>
                    ) : null}
                    {g.why ? <p className="text-2xs text-muted-foreground">{g.why}</p> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-2xs text-muted-foreground">
                Ranked structural gaps. Gap state is canonical; the ranking order is the contract's.
              </p>
            </div>
          ) : null}

          {l1 && wt.available ? (
            <div>
              <p className="label-sec mb-1.5">Task execution progress · INFORMATIONAL ONLY</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(l1.counts ?? {}).map(([state, count]) => (
                  <div
                    key={state}
                    className="flex min-w-[5.5rem] flex-col gap-1 rounded-md border border-border bg-surface-0/50 px-2.5 py-1.5"
                  >
                    <span className="label-micro">{state}</span>
                    <span className="tnum text-sm font-semibold">{formatCount(count)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-2xs text-muted-foreground">
                {l1.note} NOT ERP MATURITY.
              </p>
            </div>
          ) : null}
        </div>
      </AboutMethod>
    </div>
  );
}

/**
 * EXECUTION SUMMARY — the four counts that were previously a hero metric row.
 *
 * WF-ERP-01 named the 5xl maturity number as the problem, but the same finding
 * applies to a four-card count row directly beneath it: counts are evidence, and
 * WF-HIER-02 warns that counts become the product's visual language "even where
 * the contract says counts do not establish maturity, capacity or work".
 *
 * These four remain fully visible and fully labelled. They are simply below the
 * process-closure work area instead of above it, which is the whole correction.
 */
function ExecutionSummary({
  agents,
  staleAgents,
  currentAgents,
  founderWaiting,
  conflicts,
  et,
}: {
  agents: number;
  staleAgents: number;
  currentAgents: number;
  founderWaiting: number;
  conflicts: number;
  et: CommandSurface['execution_truth'];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric
        label="Live agents"
        value={et.available ? formatCount(agents) : null}
        sub={et.available ? `${currentAgents} current · ${staleAgents} stale` : undefined}
        tone={et.available ? 'ok' : 'unknown'}
      />
      <Metric
        label="Founder decisions open"
        value={formatCount(founderWaiting)}
        sub={founderWaiting ? 'carried, not reconciled' : 'none recorded'}
        tone={founderWaiting ? 'drift' : 'ok'}
      />
      <Metric
        label="Identity conflicts"
        value={et.available ? formatCount(conflicts) : null}
        sub={conflicts ? 'surfaced, never merged' : 'none recorded'}
        tone={conflicts ? 'stale' : 'ok'}
      />
      <Metric
        label="Ledger events in window"
        value={et.available ? formatCount(et.activity_events?.length ?? 0) : null}
        sub={et.ledger?.state === 'STALE' ? 'projection stale vs ledger' : 'projection current'}
        tone={et.ledger?.state === 'STALE' ? 'stale' : 'ok'}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | null;
  sub?: string;
  tone: 'ok' | 'stale' | 'drift' | 'unknown';
}) {
  const dot = {
    ok: 'bg-truth-ok',
    stale: 'bg-truth-stale',
    drift: 'bg-truth-drift',
    unknown: 'bg-truth-unknown',
  }[tone];

  return (
    <Card className="frost">
      <CardContent className="p-3.5">
        <div className="flex items-center gap-2">
          <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
          <span className="label-micro">{label}</span>
        </div>
        {value === null ? (
          <div className="mt-2">
            <UnknownValue />
          </div>
        ) : (
          <p className="tnum mt-1.5 text-2xl font-semibold leading-none">{value}</p>
        )}
        {sub ? <p className="mt-1.5 text-2xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function TruthColumn({
  title,
  source,
  available,
  state,
  lines,
}: {
  title: string;
  source: string;
  available: boolean;
  state: string;
  lines: string[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs">{title}</CardTitle>
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              available ? 'bg-truth-ok' : 'bg-truth-unknown',
            )}
          />
        </div>
        <CardDescription className="font-mono text-2xs">{source}</CardDescription>
      </CardHeader>
      <CardContent>
        {!available ? (
          <UnknownValue reason={`${source} unavailable`} />
        ) : (
          <ul className="space-y-1.5">
            {lines.map((l) => (
              <li key={l} className="flex gap-1.5 text-2xs leading-relaxed text-muted-foreground">
                <span className="mt-1.5 h-0.5 w-0.5 shrink-0 rounded-full bg-muted-foreground" />
                {l}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
          <span className="label-micro">State</span>
          <span className="font-mono text-2xs text-muted-foreground">{state}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/** Worst-stage family summary. Colour by worst, never by average. */
export function FamilyStrip({ surface }: { surface: CommandSurface }) {
  const pt = surface.process_truth;
  if (!pt.available) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {pt.process_families.map((f) => {
        const worst = worstStage(f.stages.map((s) => s.state));
        const tone = STAGE_TONE[worst];
        return (
          <div
            key={f.id}
            className="flex items-center gap-2 rounded-md border border-border bg-surface-0/50 px-2.5 py-1.5"
          >
            <span className="font-mono text-2xs text-muted-foreground">{f.id}</span>
            <span className="text-xs font-medium">{f.name}</span>
            <span className={cn('rounded-sm border px-1.5 py-px text-2xs', tone.chip)}>{tone.label}</span>
            <span className="tnum text-2xs text-muted-foreground">{f.stages.length} stages</span>
          </div>
        );
      })}
    </div>
  );
}

export { Button };
