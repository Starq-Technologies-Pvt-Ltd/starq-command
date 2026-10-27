/**
 * Portfolio view over the PM service. Projects are shown side by side and are
 * never summed into one board: each row is one project's own tasks.
 */
import * as React from 'react';
import { Chip, GoLink, Panel, SourceGap } from '@/components/console';
import { PM_BOARD_HREF, pmIsScratch, pmPort, pmPortfolio, pmProjects, pmQuery, pmTaskHref, pmTasks, type PmPortfolio, type PmStatus, type PmTask } from '@/lib/pm-client';

const LANE_SHORT: Record<PmStatus, string> = {
  BACKLOG: 'Backlog', READY: 'Ready', IN_PROGRESS: 'In progress', REVIEW: 'Review',
  VERIFICATION: 'Verif.', ACCEPTANCE: 'Accept.', CLOSED: 'Closed', BLOCKED: 'Blocked', FOUNDER_GATE: 'Gate',
};

// Display-only project catalog from the canonical corporate portfolio and
// permanent-board doctrine. It carries no execution state or task records.
const PORTFOLIO_ENTRIES = [
  { id: 'command', pmId: 'command', name: 'Command OS', classification: 'Permanent project', plane: 'Organization', horizon: 'CURRENT · current active project', boardSequence: 'Current project', portfolioRole: 'How Starq builds and operates the commercial ecosystem.', purpose: 'Company/Agent operating system used internally and potentially reusable externally later.', source: 'Corporate Library 05, 06 and 15' },
  { id: 'user-account', pmId: null, name: 'Starq User Account', classification: 'Permanent project', plane: 'Commercial / product', horizon: 'NEXT · first board redefinition wave', boardSequence: '1 of 5 · first board redefinition wave after Command', portfolioRole: 'Shared identity and account foundation across Starq services.', purpose: 'A human identity persists as commercial context changes; identity remains distinct from authority.', source: 'Corporate Library 06, 11 and 15' },
  { id: 'scg', pmId: null, name: 'Starq Commercial Graph (sCG)', classification: 'Permanent project', plane: 'Commercial / product', horizon: 'NEXT · first board redefinition wave', boardSequence: '2 of 5 · first board redefinition wave after Command', portfolioRole: 'How do commercial objects, evidence, authority, and relationships connect?', purpose: 'Protected, evidence-backed model of commercial objects and relationships.', source: 'Corporate Library 06, 10 and 15' },
  { id: 'hoadhaa', pmId: 'hoadha', name: 'Hoadhaa', classification: 'Permanent project', plane: 'Commercial / product', horizon: 'NEXT · first board redefinition wave', boardSequence: '3 of 5 · first board redefinition wave after Command', portfolioRole: 'Where can people discover and act on what is commercially possible?', purpose: 'Human commerce environment, initially focused on Greater Malé and real commercial nodes.', source: 'Corporate Library 06, 08 and 15' },
  { id: 'erp', pmId: 'erp', name: 'starqERP', classification: 'Permanent project', plane: 'Commercial / product', horizon: 'NEXT · implementation remains subject to DEC-100', boardSequence: '4 of 5 · first board redefinition wave after Command', portfolioRole: 'Can the business operate correctly around a commercial offer?', purpose: 'Private operational business truth; StarqPOS is its retail operational edge.', source: 'Corporate Library 06, 09 and 15; DEC-100 hold remains separate' },
  { id: 'starq-ai', pmId: null, name: 'Commerce Intelligence / starqAI', classification: 'Permanent project', plane: 'Commercial / product', horizon: 'NEXT · first board redefinition wave', boardSequence: '5 of 5 · first board redefinition wave after Command', portfolioRole: 'How can Starq reason over the commercial world and requirements?', purpose: 'Reasoning layer for requirements, constraints, and commercially viable paths.', source: 'Corporate Library 06, 10 and 15' },
  { id: 'starq-pay', pmId: null, name: 'StarqPay', classification: 'Permanent project', plane: 'Commercial / product', horizon: 'FUTURE / GATED', boardSequence: 'Not in first board redefinition wave', portfolioRole: 'How does value move through the ecosystem?', purpose: 'Payments, settlement, and value movement; activation requires legal, regulatory, entity, security, and financial-control prerequisites.', source: 'Corporate Library 06, 12 and 15' },
  { id: 'starq-academy', pmId: null, name: 'Starq Academy', classification: 'Permanent project', plane: 'Commercial / product', horizon: 'FUTURE / GATED', boardSequence: 'Not in first board redefinition wave', portfolioRole: 'How do participants learn and grow capability?', purpose: 'Merchant onboarding, operator training, workforce development, future certifications, and ecosystem education.', source: 'Corporate Library 06, 12 and 15' },
  { id: 'movement-logistics', pmId: null, name: 'Movement / Logistics', classification: 'Permanent project', plane: 'Commercial / product', horizon: 'ENABLED FUTURE / PROJECT DEFINITION REQUIRED', boardSequence: 'Not in first board redefinition wave', portfolioRole: 'How does the physical outcome move?', purpose: 'Fulfillment, local delivery, cargo, inter-island movement, manifests, service areas, returns, and route constraints.', source: 'Corporate Library 06, 12 and 15' },
  // Nexus showed these names as Starq Technologies workspace projects. Current
  // canonical sources distinguish two as operating capabilities and provide no
  // current Starq Web project record. Keep the labels visible without inheriting
  // Nexus task state or claiming current activity.
  { id: 'starq-studio', pmId: null, name: 'Starq Studio / Dev Studio', classification: 'Operating capability · not a product project', plane: 'Organization', horizon: 'CURRENT · canonical engineering organization', boardSequence: 'Company operating capability; not a product-board sequence item', portfolioRole: 'Builds and operates the approved technology portfolio.', purpose: 'Primary product engineering, software architecture, technical design, quality assurance, and runtime execution organization.', source: 'Corporate Library Chapter 22; C-6 projection conflict remains open' },
  { id: 'starq-dynamics', pmId: null, name: 'Starq Dynamics', classification: 'Commercial operating arm · not a product project', plane: 'Organization / commercial operations', horizon: 'Rollout sequence declared; current activity UNKNOWN', boardSequence: 'Company operating arm; not a product-board sequence item', portfolioRole: 'Turns Starq technology into a functioning market operation.', purpose: 'Commercial operating function for merchant acquisition, onboarding, relationships, subscriptions, customer success, account management, revenue operations, and local expansion.', source: 'Corporate Library 13' },
  { id: 'starq-web', pmId: null, name: 'Starq Web · Nexus-era label', classification: 'Historical Nexus label · canonical mapping UNKNOWN', plane: 'UNKNOWN · no current canonical portfolio mapping', horizon: 'UNKNOWN · current project status not established', boardSequence: 'UNKNOWN · no current canonical board mapping', portfolioRole: 'UNKNOWN · no current canonical project role established', purpose: 'Nexus previously displayed a separate Starq Web project. No matching current canonical portfolio or permanent-board record was established; no tasks or status are carried forward.', source: 'Historical Nexus catalog only; not current authority' },
] as const;

export function PmNav({ current }: { current: 'portfolio' | 'command' | 'erp' | 'hoadha' }) {
  const items: [typeof current, string, string][] = [
    ['portfolio', 'Portfolio', '#studio/projects'],
    ['command', 'Command board', PM_BOARD_HREF.command],
    ['erp', 'starqERP board', PM_BOARD_HREF.erp],
    ['hoadha', 'Hoadhaa board', PM_BOARD_HREF.hoadha],
  ];
  return (
    <nav className="flex flex-wrap gap-3 px-3 py-2 text-xs" aria-label="Project boards">
      {items.map(([key, label, href]) => (
        <a key={key} href={`${href}${pmQuery()}`} aria-current={current === key ? 'page' : undefined} className={current === key ? 'font-semibold underline' : 'underline-offset-2 hover:underline'}>
          {label}
        </a>
      ))}
    </nav>
  );
}

/**
 * Compact project/work index for Overview. It deliberately has no Building
 * dependency, so the project register remains visible when that projection is
 * unavailable. PM fields are shown only when the PM summary returns a row.
 */
export function PmPortfolioSnapshot() {
  const [data, setData] = React.useState<PmPortfolio | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void pmPortfolio().then((result) => {
      if (!active) return;
      if (result.ok) {
        setData(result.data);
        setProblem(null);
      } else {
        setData(null);
        setProblem(result.message);
      }
    });
    return () => { active = false; };
  }, []);

  const pmById = new Map((data?.projects ?? []).map((project) => [project.id, project]));
  return (
    <section aria-label="Project and work overview" data-pm-portfolio-snapshot="">
      <Panel
        title="Projects and recorded work"
        count={data ? `${data.projects.length} PM boards · ${PORTFOLIO_ENTRIES.length} portfolio entries` : 'PM summary UNKNOWN'}
        toolbar={<GoLink href="#studio/projects">Open full portfolio →</GoLink>}
      >
        <div className="body grid gap-2">
          <p className="text-2xs text-muted-foreground">
            Project domains and sequence come from the canonical portfolio. Counts below are PM records, not project health or independent acceptance.
            {data?.pending_room_sync ? ` ${data.pending_room_sync} Room sync item(s) are pending.` : ''}
          </p>
          {problem ? <SourceGap reason="PM work summary unavailable." detail={problem} /> : null}
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {PORTFOLIO_ENTRIES.map((entry) => {
              const project = entry.pmId ? pmById.get(entry.pmId) : undefined;
              const href = entry.pmId ? PM_BOARD_HREF[entry.pmId] : null;
              return (
                <li key={entry.id} className="rounded border border-border p-2" data-project-snapshot={entry.id}>
                  <div className="flex items-start justify-between gap-2">
                    <strong className="text-xs leading-tight">
                      {href ? <GoLink href={`${href}${pmQuery()}`}>{entry.name}</GoLink> : entry.name}
                    </strong>
                    <Chip value={project ? 'PM BOARD' : entry.id === 'starq-web' ? 'HISTORICAL' : 'NO PM BOARD'} tone={project ? 'room' : 'unknown'} />
                  </div>
                  <p className="mt-1 text-2xs text-muted-foreground">{entry.portfolioRole}</p>
                  <div className="mt-1 text-2xs">
                    {project
                      ? `Open ${project.open}/${project.total} · In progress ${project.counts.IN_PROGRESS} · Blocked ${project.blocked} · Founder gate ${project.founder_gate} · Closed ${project.counts.CLOSED}`
                      : 'Current work, ownership, progress, and project health are UNKNOWN without a mapped PM board.'}
                  </div>
                  <p className="mt-1 text-3xs text-muted-foreground">{entry.boardSequence}</p>
                </li>
              );
            })}
          </ul>
          {!data && !problem ? <p className="text-2xs text-muted-foreground">Loading PM summary; project register is available above.</p> : null}
          {data?.generated_at ? <p className="text-3xs text-muted-foreground">PM summary generated {data.generated_at}.</p> : null}
        </div>
      </Panel>
    </section>
  );
}

export function PmPortfolioSurface() {
  const [data, setData] = React.useState<PmPortfolio | null>(null);
  const [descriptions, setDescriptions] = React.useState<Record<string, string> | null>(null);
  const [taskRows, setTaskRows] = React.useState<Record<string, { tasks: PmTask[] | null; error: string | null }>>({});
  const [metadataProblem, setMetadataProblem] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setData(null);
    setDescriptions(null);
    setTaskRows({});
    const [res, projectRes] = await Promise.all([pmPortfolio(), pmProjects()]);
    if (res.ok) { setData(res.data); setProblem(null); } else { setProblem(res.message); }
    if (projectRes.ok) {
      setDescriptions(Object.fromEntries(
        projectRes.data.projects.map((project) => [project.id, project.description]),
      ));
      setMetadataProblem(null);
    } else {
      setDescriptions(null);
      setMetadataProblem(projectRes.message);
    }
    if (res.ok) {
      const taskResults = await Promise.all(res.data.projects.map(async (project) => {
        const result = await pmTasks(project.id);
        return [project.id, result.ok
          ? { tasks: result.data.tasks, error: null }
          : { tasks: null, error: result.message }] as const;
      }));
      setTaskRows(Object.fromEntries(taskResults));
    }
    setLoading(false);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const visibleProjects = data?.projects.filter((project) => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return true;
    const canonical = PORTFOLIO_ENTRIES.find((entry) => entry.pmId === project.id);
    const tasks = taskRows[project.id]?.tasks ?? [];
    return [project.name, canonical?.name, canonical?.classification, canonical?.source, canonical?.portfolioRole, canonical?.boardSequence, project.prefix, project.source_gap, project.hold.state, descriptions?.[project.id], canonical?.purpose, canonical?.plane, canonical?.horizon,
      ...tasks.flatMap((task) => [task.id, task.title, task.description, task.status, task.owner, task.verifier, task.notes])]
      .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(query));
  }) ?? [];
  const missingCanonicalProjects = PORTFOLIO_ENTRIES.filter((catalogProject) =>
    !data?.projects.some((project) => project.id === catalogProject.pmId),
  );
  const visibleCanonicalGaps = missingCanonicalProjects.filter((project) => {
    const query = search.trim().toLocaleLowerCase();
    return !query || `${project.name} ${project.classification} ${project.source} ${project.portfolioRole} ${project.boardSequence} ${project.plane} ${project.horizon} ${project.purpose}`.toLocaleLowerCase().includes(query);
  });

  return (
    <section className="command-stack" aria-label="Project portfolio" data-pm="portfolio">
      <Panel
        title="Project portfolio"
        count={data ? `${visibleProjects.length} PM · ${visibleCanonicalGaps.length} unregistered` : loading ? 'LOADING' : 'UNAVAILABLE'}
        toolbar={(
          <>
            {pmIsScratch() ? <Chip value={`SCRATCH INSTANCE :${pmPort()}`} tone="drift" /> : null}
            <button type="button" className="go-link" onClick={() => void load()} disabled={loading}>Refresh</button>
          </>
        )}
      >
        <PmNav current="portfolio" />
        <label className="mx-3 grid gap-1 py-2 text-2xs text-muted-foreground">
          Find a project
          <input
            type="search"
            aria-label="Filter projects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, purpose, task, owner, hold, or source gap"
            className="w-full rounded border border-border bg-surface-0 px-2 py-1.5 text-xs text-foreground"
          />
        </label>
        {problem && !data ? (
          <SourceGap reason="PM service unavailable." detail={`${problem} Start it with: npm run pm:start`} />
        ) : null}
        {data ? (
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3" data-project-grid="pm-portfolio">
            <p className="col-span-full text-2xs text-muted-foreground">
              PM cards show records in the Command PM source. The registry also preserves canonical portfolio domains and Nexus-era workspace labels while distinguishing projects from operating capabilities and unresolved historical labels. Missing PM registration means work and status are UNKNOWN, not zero or complete. Counts and task evidence are never combined across projects.
              {data.pending_room_sync > 0 ? ` ${data.pending_room_sync} Room post(s) are pending across this portfolio.` : ''}
            </p>
              {visibleProjects.map((p) => {
                const canonical = PORTFOLIO_ENTRIES.find((project) => project.pmId === p.id);
                const taskState = taskRows[p.id];
                const tasks = taskState?.tasks ?? [];
                const blockers = tasks.filter((task) => task.status === 'BLOCKED');
                const gates = tasks.filter((task) => task.status === 'FOUNDER_GATE');
                const closed = p.counts.CLOSED;
                const completion = p.total > 0 ? Math.round((closed / p.total) * 100) : null;
                return (
              <article
                key={p.id}
                data-project={p.id}
                className="grid content-start gap-3 rounded-lg border border-border bg-card/40 p-3"
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold leading-tight">
                      <GoLink href={`${PM_BOARD_HREF[p.id] ?? `#studio/${p.id}`}${pmQuery()}`}>{canonical?.name ?? p.name}</GoLink>
                    </h3>
                    <span className="mono text-2xs text-muted-foreground">{canonical && canonical.name !== p.name ? `PM board: ${p.name} · ${p.prefix}` : p.prefix}</span>
                  </div>
                  {p.hold.state
                    ? <Chip value={p.hold.state} title={p.hold.source} />
                    : <Chip value="NO PM HOLD" tone="muted" title={p.hold.source} />}
                </header>

                <p className="min-h-10 text-xs leading-relaxed text-muted-foreground" data-project-description={descriptions?.[p.id] ? 'declared' : 'unknown'}>
                  {descriptions?.[p.id]?.trim()
                    ? descriptions[p.id]
                    : metadataProblem
                      ? 'Description unavailable from the PM project metadata source.'
                      : 'Project description is UNKNOWN.'}
                </p>

                <dl className="grid gap-1 rounded border border-border p-2 text-2xs sm:grid-cols-2">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Portfolio plane</dt>
                    <dd>{canonical?.plane ?? 'UNKNOWN · no canonical mapping'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Canonical purpose</dt>
                    <dd className="text-right">{canonical?.purpose ?? 'UNKNOWN · no canonical mapping'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Planning horizon</dt>
                    <dd className="text-right">{canonical?.horizon ?? 'UNKNOWN · no canonical mapping'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Project status</dt>
                    <dd>UNKNOWN · PM records task lanes, not project health</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Current mission</dt>
                    <dd>UNKNOWN · no current PM mission field</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Group</dt>
                    <dd>{canonical?.classification ?? 'UNKNOWN · no portfolio classification'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Canonical portfolio role</dt>
                    <dd>{canonical?.portfolioRole ?? 'UNKNOWN · no canonical mapping'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Board sequence</dt>
                    <dd className="text-right">{canonical?.boardSequence ?? 'UNKNOWN · no canonical sequence'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Next target</dt>
                    <dd>UNKNOWN · no current PM target field</dd>
                  </div>
                </dl>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-border p-2">
                    <div className="text-2xs text-muted-foreground">Open / total</div>
                    <strong>{p.open} / {p.total}</strong>
                  </div>
                  <div className="rounded border border-border p-2">
                    <div className="text-2xs text-muted-foreground">Unassigned</div>
                    <strong>{p.unassigned}</strong>
                  </div>
                  <div className="rounded border border-border p-2">
                    <div className="text-2xs text-muted-foreground">Blocked</div>
                    <strong>{p.blocked}</strong>
                  </div>
                  <div className="rounded border border-border p-2">
                    <div className="text-2xs text-muted-foreground">Founder gate</div>
                    <strong>{p.founder_gate}</strong>
                  </div>
                </div>

                <div className="grid gap-2 rounded border border-border p-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Board progress · CLOSED / total</span>
                    <strong>{closed} / {p.total}{completion === null ? '' : ` (${completion}%)`}</strong>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-surface-0" aria-label={completion === null ? 'No PM tasks recorded' : `${completion}% of PM records are CLOSED`}>
                    <div className="h-full bg-accent" style={{ width: `${completion ?? 0}%` }} />
                  </div>
                  <p className="text-2xs text-muted-foreground">This is the PM board's CLOSED lane count; it does not claim independent project acceptance.</p>
                </div>

                <section className="grid gap-2 border-t border-border pt-2" aria-label={`${p.name} recorded blockers and Founder gates`}>
                  <h4 className="text-2xs font-semibold">Recorded blockers and Founder gates</h4>
                  {taskState?.error ? (
                    <p className="text-2xs text-muted-foreground">Task details unavailable: {taskState.error}</p>
                  ) : !taskState ? (
                    <p className="text-2xs text-muted-foreground">Task details are UNKNOWN.</p>
                  ) : blockers.length === 0 && gates.length === 0 ? (
                    <p className="text-2xs text-muted-foreground">No records in BLOCKED or FOUNDER_GATE lanes.</p>
                  ) : (
                    [...blockers, ...gates].map((task) => (
                      <article key={task.id} className="grid gap-1 rounded border border-border px-2 py-1.5 text-2xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <GoLink href={pmTaskHref(p.id, task.id)}>{task.id} · {task.title}</GoLink>
                          <Chip value={task.status} tone={task.status === 'BLOCKED' ? 'stale' : 'drift'} />
                        </div>
                        <div><span className="text-muted-foreground">Owner:</span> {task.owner} · <span className="text-muted-foreground">Verifier:</span> {task.verifier}</div>
                        {task.description ? <p className="whitespace-pre-wrap">{task.description}</p> : null}
                        {task.notes ? <p className="whitespace-pre-wrap text-muted-foreground">{task.notes}</p> : null}
                        {task.depends_on.length ? <div className="text-muted-foreground">Recorded dependencies: {task.depends_on.join(', ')}</div> : null}
                        <div className="text-muted-foreground">
                          Evidence refs: {task.evidence_refs.length
                            ? task.evidence_refs.map((ref) => `#${ref.sequence} [${ref.kind}] ${ref.purpose}`).join(' · ')
                            : 'UNKNOWN / none recorded'}
                        </div>
                      </article>
                    ))
                  )}
                </section>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-2xs sm:grid-cols-3">
                  {data.statuses.map((status) => (
                    <div key={status} className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{LANE_SHORT[status]}</dt>
                      <dd className="mono">{p.counts[status]}</dd>
                    </div>
                  ))}
                </dl>

                <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-2xs">
                  <span className="text-muted-foreground">Room sync</span>
                  {p.pending_room_sync > 0
                    ? <Chip value={`${p.pending_room_sync} PENDING`} tone="stale" />
                    : <Chip value="CLEAR" tone="ok" />}
                </div>
                {p.source_gap ? (
                  <p className="rounded border border-border px-2 py-1.5 text-2xs text-muted-foreground" data-source-gap="">
                    <strong>Source gap:</strong> {p.source_gap}
                  </p>
                ) : null}
              </article>
                );
              })}
            {visibleProjects.length === 0 && visibleCanonicalGaps.length === 0 ? (
              <p className="col-span-full text-xs text-muted-foreground" data-project-filter-empty="">
                {data.projects.length === 0
                  ? 'The PM portfolio returned no project records.'
                  : 'No projects match this filter.'}
              </p>
            ) : null}
          </div>
        ) : null}
        <section className="grid grid-cols-1 gap-3 px-3 pb-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Canonical portfolio entries without PM records">
          {visibleCanonicalGaps.map((project) => (
            <article key={project.id} data-project-catalog={project.id} className="grid content-start gap-3 rounded-lg border border-dashed border-border bg-card/20 p-3">
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold leading-tight">{project.name}</h3>
              <span className="text-2xs text-muted-foreground">{project.classification} · {data ? 'no PM project record' : 'PM registration unavailable'}</span>
                </div>
                <Chip value={data ? 'UNREGISTERED' : 'UNKNOWN'} tone="unknown" />
              </header>
              <p className="text-xs leading-relaxed text-muted-foreground">{project.purpose}</p>
              <dl className="grid gap-1 rounded border border-border p-2 text-2xs">
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Portfolio plane</dt><dd>{project.plane}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Planning horizon</dt><dd>{project.horizon}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Project status</dt><dd>UNKNOWN</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Current mission / next target</dt><dd>UNKNOWN</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Canonical portfolio role</dt><dd>{project.portfolioRole}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Board sequence</dt><dd>{project.boardSequence}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Progress / blockers</dt><dd>UNKNOWN</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Owner / evidence</dt><dd>UNKNOWN</dd></div>
              </dl>
              <p className="text-2xs text-muted-foreground">Source: {project.source}. No PM task source or current board is mapped to this entry. No task state or progress was imported from Nexus.</p>
            </article>
          ))}
        </section>
      </Panel>
    </section>
  );
}
