/**
 * Founder seven-need operational scan for Command Overview.
 *
 * Forwards already-projected CommandSurface fields and the separate PM
 * portfolio payload. Does not invent counts, merge origins, or label a
 * stopped service as live. HISTORICAL Nexus board counts are not used as
 * native task-board facts.
 */
import * as React from 'react';
import type { CommandSurface } from '@/lib/contracts';
import { Chip, GoLink, Panel, SourceGap } from '@/components/console';
import { pmPortfolio, type PmPortfolio, type PmPortfolioProject } from '@/lib/pm-client';

type NeedCard = {
  id: string;
  title: string;
  href: string;
  state: string;
  facts: string[];
  asOf: string | null;
  origin: string;
};

function pmBoardLine(project: PmPortfolioProject | undefined, id: string): string {
  if (!project) return `${id}: no PM project row`;
  return `${project.id} open ${project.open}/${project.total} · blocked ${project.blocked} · founder gate ${project.founder_gate} (PM records, not acceptance)`;
}

function buildCards(surface: CommandSurface | null, pm: PmPortfolio | null, pmProblem: string | null, pmTried: boolean): NeedCard[] {
  const assembled = surface?.assembled_at ?? null;
  const command = pm?.projects.find((p) => p.id === 'command');
  const erpPm = pm?.projects.find((p) => p.id === 'erp');
  const hoadhaPm = pm?.projects.find((p) => p.id === 'hoadha');

  const pmState = !pmTried ? 'LOADING' : pm ? 'PM RECORDS' : 'UNAVAILABLE';
  const pmAsOf = pm?.generated_at ?? null;

  const floor = surface?.floor ?? null;
  const assignmentRows = floor?.assignments ?? null;
  const assignedDeclared = assignmentRows
    ? assignmentRows.filter((row) => row.current_assignment).length
    : null;
  const activityEvents = floor?.activity?.events ?? surface?.execution_truth?.activity_events ?? null;

  const pt = surface?.process_truth;
  const wt = surface?.work_truth;
  const discrepancies = pt?.reconciliation?.known_discrepancies;
  const discrepanciesPresent = pt?.reconciliation?.known_discrepancies_present;
  const founderDecisions = Array.isArray(discrepancies)
    ? discrepancies.filter((d) => d.founder_decision_required === true).length
    : null;
  const declaredBlockers = pt?.available
    ? pt.process_families.flatMap((family) =>
        family.critical_blocker
          ? [family.critical_blocker]
          : family.stages.filter((stage) => stage.blocked_by).map((stage) => stage.blocked_by as string),
      ).length
    : null;

  const provenance = surface?.provenance;

  return [
    {
      id: 'projects',
      title: 'Projects',
      href: '#studio/projects',
      state: pmState,
      origin: 'GET /api/pm/portfolio (:5176) · not Building Nexus boards',
      asOf: pmAsOf,
      facts: pm
        ? [
            `${pm.projects.length} PM project row(s) in portfolio payload`,
            pm.projects.map((p) => `${p.id} ${p.open}/${p.total}`).join(' · ') || 'payload lists no projects',
          ]
        : [pmTried ? (pmProblem ?? 'PM portfolio UNAVAILABLE') : 'PM portfolio request in flight', 'Building project rooms are a separate origin'],
    },
    {
      id: 'boards',
      title: 'Task boards',
      href: '#studio/projects',
      state: pmState,
      origin: 'GET /api/pm/portfolio (:5176) · native PM boards only',
      asOf: pmAsOf,
      facts: pm
        ? [pmBoardLine(command, 'command'), `${pmBoardLine(erpPm, 'erp')} · ${pmBoardLine(hoadhaPm, 'hoadha')}`]
        : [
            pmTried ? (pmProblem ?? 'PM boards UNAVAILABLE') : 'PM board request in flight',
            'Nexus ERP/Hoadha task JSON is HISTORICAL_SNAPSHOT, not a native PM board',
          ],
    },
    {
      id: 'assignments',
      title: 'Assignments',
      href: '#studio/staff',
      state: !surface ? 'UNAVAILABLE' : floor ? 'PROJECTED' : 'UNAVAILABLE',
      origin: 'surface.floor.assignments (execution rows; mentions are not assignments)',
      asOf: floor?.generated_at ?? assembled,
      facts: !surface
        ? ['Core /api/surface UNAVAILABLE', 'Assignment rows not projected']
        : !floor
          ? ['surface.floor is null — assignment table UNAVAILABLE', 'Staff duty is a separate column on #studio/staff']
          : [
              `${assignmentRows?.length ?? 'UNKNOWN'} assignment row(s) projected`,
              `${assignedDeclared ?? 'UNKNOWN'} row(s) declare current_assignment · nulls stay UNKNOWN, not unassigned`,
            ],
    },
    {
      id: 'activity',
      title: 'Workforce activity',
      href: '#studio/activity',
      state: !surface ? 'UNAVAILABLE' : activityEvents ? 'PROJECTED' : 'UNAVAILABLE',
      origin: 'surface.floor.activity.events else execution_truth.activity_events',
      asOf: floor?.generated_at ?? surface?.execution_truth?.generated_at ?? assembled,
      facts: !surface
        ? ['Core /api/surface UNAVAILABLE', 'Activity window not projected']
        : activityEvents
          ? [
              `${activityEvents.length} event(s) in the projected window (not lifetime totals)`,
              `execution_truth.state ${surface.execution_truth?.state ?? 'UNKNOWN'} · evidence of activity, not process maturity`,
            ]
          : ['No activity array on floor or execution_truth', 'That is UNAVAILABLE, not zero activity'],
    },
    {
      id: 'progress',
      title: 'Delivery progress',
      href: '#studio/erp/process',
      state: !surface ? 'UNAVAILABLE' : pt?.available ? (pt.state ?? 'PROJECTED') : 'UNAVAILABLE',
      origin: 'process_truth + work_truth · PM open counts are records, not closure',
      asOf: pt?.generated_at ?? wt?.generated_at ?? assembled,
      facts: !surface
        ? ['Core /api/surface UNAVAILABLE', 'Process/work truth not projected']
        : [
            pt?.available
              ? `hold_state.implementation ${pt.hold_state?.implementation ?? 'UNKNOWN'} · process_truth.state ${pt.state}`
              : `process_truth.available false · ${pt?.reason ?? 'UNAVAILABLE'}`,
            wt?.available
              ? `work_truth L4 maturity ${wt.maturity?.L4?.maturity ?? 'UNKNOWN'} (not acceptance) · global_blocker_present ${String(wt.global_blocker_present ?? 'UNKNOWN')}`
              : `work_truth.available false · ${wt?.reason ?? 'UNAVAILABLE'}`,
          ],
    },
    {
      id: 'evidence',
      title: 'Evidence',
      href: '#evidence/sources',
      state: !surface ? 'UNAVAILABLE' : provenance?.state ?? 'UNKNOWN',
      origin: 'surface.provenance (readable sources, not claim correctness)',
      asOf: assembled,
      facts: !surface
        ? ['Core /api/surface UNAVAILABLE', 'Provenance census not projected']
        : [
            `checked ${provenance?.checked ?? 'UNKNOWN'} · missing ${provenance?.missing?.length ?? 'UNKNOWN'} · drifted ${provenance?.drifted?.length ?? 'UNKNOWN'}`,
            provenance?.reason ?? 'Source readability only; /api/raw peek is a separate route',
          ],
    },
    {
      id: 'attention',
      title: 'Founder attention',
      href: '#attention/decisions',
      state: !surface
        ? 'UNAVAILABLE'
        : discrepanciesPresent === false
          ? 'UNKNOWN'
          : pt?.available
            ? 'DECLARED RECORDS'
            : 'UNAVAILABLE',
      origin: 'process_truth.reconciliation.known_discrepancies where founder_decision_required',
      asOf: pt?.generated_at ?? assembled,
      facts: !surface
        ? ['Core /api/surface UNAVAILABLE', 'Attention queue not projected']
        : discrepanciesPresent === false
          ? ['known_discrepancies_present is false — schema gap, not zero decisions', 'Do not read this as an empty Founder queue']
          : [
              `${founderDecisions ?? 'UNKNOWN'} founder_decision_required record(s) · ${declaredBlockers ?? 'UNKNOWN'} declared process blocker string(s) · not ranked`,
              `ERP hold ${pt?.hold_state?.implementation ?? 'UNKNOWN'} · activity needs_founder is not this queue`,
            ],
    },
  ];
}

export function SevenNeedOverview({ surface }: { surface: CommandSurface | null }) {
  const [pm, setPm] = React.useState<PmPortfolio | null>(null);
  const [pmProblem, setPmProblem] = React.useState<string | null>(null);
  const [pmTried, setPmTried] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void pmPortfolio().then((res) => {
      if (cancelled) return;
      setPmTried(true);
      if (res.ok) {
        setPm(res.data);
        setPmProblem(null);
      } else {
        setPm(null);
        setPmProblem(`${res.state}: ${res.message}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = buildCards(surface, pm, pmProblem, pmTried);

  return (
    <Panel
      title="Seven operational needs"
      count="scan, then open the owning surface"
      className="seven-need-overview"
    >
      <div className="body">
        <p className="text-2xs text-muted-foreground">
          Daily-driver index for projects, boards, assignments, activity, delivery, evidence, and
          Founder attention. Each chip is the originating payload&apos;s honesty state. Counts are
          forwarded, never scored. A stopped origin is UNAVAILABLE, not empty.
        </p>
        {!surface ? (
          <SourceGap
            reason="Core Command surface UNAVAILABLE."
            detail="Cards below still name each need. Surface-backed facts stay UNAVAILABLE until /api/surface is reachable. PM cards use :5176 independently."
          />
        ) : null}
        <ul className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3" data-seven-need-overview="">
          {cards.map((card) => (
            <li key={card.id} className="rounded border border-border p-2" data-need={card.id}>
              <div className="flex items-start justify-between gap-2">
                <strong className="text-xs leading-tight">{card.title}</strong>
                <Chip value={card.state} />
              </div>
              <p className="mt-1 text-3xs text-muted-foreground">{card.origin}</p>
              {card.facts.map((fact) => (
                <p key={fact} className="mt-1 text-2xs">
                  {fact}
                </p>
              ))}
              <p className="mt-1 text-3xs text-muted-foreground">as-of {card.asOf ?? 'UNKNOWN'}</p>
              <GoLink href={card.href}>Open owning surface →</GoLink>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
