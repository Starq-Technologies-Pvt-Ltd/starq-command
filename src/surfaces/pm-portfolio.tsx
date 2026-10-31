/**
 * Project boards index — Command as the new Nexus.
 */
import * as React from 'react';
import { Chip, GoLink, Panel, SourceGap } from '@/components/console';
import {
  PM_STATUS_LABELS,
  pmBoardHref,
  pmIsScratch,
  pmNexusSources,
  pmPort,
  pmPortfolio,
  pmProjects,
  pmQuery,
  type PmNexusSource,
  type PmNexusSourceRecord,
  type PmPortfolio,
  type PmProject,
  type PmStatus,
} from '@/lib/pm-client';
import { OrgOperateSnapshot } from '@/surfaces/org-operate';

export interface ProjectGroup {
  name: string;
  ids: readonly string[];
}

export const PROJECT_GROUPS: readonly ProjectGroup[] = [
  { name: 'Products', ids: ['erp', 'hoadha', 'hoadha-social', 'hoadha-concierge', 'buzzlab'] },
  { name: 'Studio', ids: ['command', 'studio', 'devops'] },
  { name: 'Governance', ids: ['foundation', 'founder-decisions'] },
  { name: 'Services', ids: ['dynamics'] },
  { name: 'Future Companies', ids: ['academy', 'pay'] },
  { name: 'Personal', ids: ['antrac-erp', 'orgsync', 'biography'] },
  { name: 'Historical Products', ids: ['portal', 'pos', 'starqbooks'] },
];

const KNOWN_LABELS: Record<string, string> = {
  erp: 'starqERP',
  hoadha: 'Hoadha',
  'hoadha-social': 'Hoadha Social',
  'hoadha-concierge': 'Hoadha Concierge',
  buzzlab: 'Buzzlab',
  command: 'Command',
  studio: 'Studio',
  devops: 'DevOps',
  foundation: 'Foundation',
  'founder-decisions': 'Decisions',
  dynamics: 'Dynamics',
  academy: 'Academy',
  pay: 'StarqPay',
  'antrac-erp': 'Antrac ERP',
  orgsync: 'OrgSync',
  biography: 'Biography',
  portal: 'Portal',
  pos: 'StarqPOS',
  starqbooks: 'StarqBooks',
};

export function getOperationalQualifier(
  projectId: string,
  holdState?: string | null,
  customQualifier?: string | null,
): { label: string; tone: 'hold' | 'stale' | 'muted' | 'room'; note?: string } {
  if (customQualifier) {
    return {
      label: customQualifier,
      tone: customQualifier.includes('HOLD') ? 'hold' : customQualifier.includes('HISTORICAL') ? 'muted' : 'stale',
    };
  }
  if (projectId === 'erp') {
    return {
      label: 'ACTIVE (CP2 #12690 HOLD)',
      tone: 'hold',
      note: 'Normal ERP roadmap active per Founder #14394. Residual hold: CP2 #12690 (payment-command neutrality).',
    };
  }
  if (projectId === 'hoadha') {
    return {
      label: 'PRE-ACTIVATION',
      tone: 'stale',
      note: 'Awaiting runtime initialization & identity binding.',
    };
  }
  if (['portal', 'pos', 'starqbooks'].includes(projectId)) {
    return {
      label: 'HISTORICAL',
      tone: 'muted',
      note: 'Preserved archive. No active execution pipeline.',
    };
  }
  if (holdState) {
    return {
      label: holdState,
      tone: 'hold',
    };
  }
  return {
    label: 'ACTIVE',
    tone: 'room',
  };
}

export function PmNav({ current }: { current: string }) {
  const [projects, setProjects] = React.useState<PmProject[]>([]);

  React.useEffect(() => {
    let active = true;
    void pmProjects().then((res) => {
      if (active && res.ok && Array.isArray(res.data.projects)) {
        setProjects(res.data.projects);
      }
    }).catch(() => { /* PM projects unavailable */ });
    return () => { active = false; };
  }, []);

  const projectMap = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const [id, name] of Object.entries(KNOWN_LABELS)) {
      map.set(id, { id, name });
    }
    for (const p of projects) {
      map.set(p.id, { id: p.id, name: p.name });
    }
    return map;
  }, [projects]);

  const knownGroupIds = React.useMemo(() => new Set<string>(PROJECT_GROUPS.flatMap((g) => g.ids)), []);
  const extraProjects = React.useMemo(() => {
    return projects.filter((p) => !knownGroupIds.has(p.id));
  }, [projects, knownGroupIds]);

  const allGroups = React.useMemo(() => {
    const base: Array<{ name: string; ids: readonly string[] }> = PROJECT_GROUPS.map((g) => ({ name: g.name, ids: [...g.ids] }));
    if (extraProjects.length > 0) {
      base.push({ name: 'Other', ids: extraProjects.map((p) => p.id) });
    }
    return base;
  }, [extraProjects]);

  return (
    <nav className="flex flex-col gap-2 border-b border-border bg-card/10 px-3 py-2 text-xs" aria-label="Project boards">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`#studio/projects${pmQuery()}`}
          aria-current={current === 'portfolio' ? 'page' : undefined}
          className={`rounded px-2 py-0.5 font-medium transition-colors ${
            current === 'portfolio'
              ? 'bg-[hsl(var(--room))] text-white font-semibold underline'
              : 'hover:bg-muted hover:underline'
          }`}
        >
          All boards
        </a>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-2xs">
        {allGroups.map((g) => (
          <div key={g.name} className="flex flex-wrap items-center gap-1.5" data-nav-group={g.name}>
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">{g.name}:</span>
            <div className="flex flex-wrap items-center gap-1">
              {g.ids.map((id) => {
                const item = projectMap.get(id) ?? { id, name: id };
                const isCurrent = current === id;
                return (
                  <a
                    key={id}
                    href={`${pmBoardHref(id)}${pmQuery()}`}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={`rounded px-1.5 py-0.5 transition-colors ${
                      isCurrent
                        ? 'bg-accent font-semibold text-accent-foreground underline'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground underline-offset-2 hover:underline'
                    }`}
                  >
                    {item.name}
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

export function PmPortfolioSnapshot() {
  const [data, setData] = React.useState<PmPortfolio | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void pmPortfolio().then((result) => {
      if (!active) return;
      if (result.ok) { setData(result.data); setProblem(null); }
      else { setData(null); setProblem(result.message); }
    });
    return () => { active = false; };
  }, []);

  return (
    <section aria-label="Project boards" data-pm-portfolio-snapshot="">
      <Panel
        title="Project boards"
        count={data ? `${data.projects.length} boards` : 'PM summary UNKNOWN'}
        toolbar={<GoLink href="#studio/projects">Open all boards →</GoLink>}
      >
        <div className="body grid gap-2">
          {problem ? <SourceGap reason="PM boards unavailable." detail={problem} /> : null}
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {(data?.projects ?? []).map((project) => {
              const qualifier = getOperationalQualifier(project.id, project.hold?.state, project.execution_qualifier);
              return (
                <li key={project.id} className="rounded border border-border p-2" data-project-snapshot={project.id}>
                  <div className="flex items-start justify-between gap-2">
                    <strong className="text-xs leading-tight">
                      <GoLink href={`${pmBoardHref(project.id)}${pmQuery()}`}>{project.name}</GoLink>
                    </strong>
                    <div className="flex items-center gap-1.5">
                      <Chip value={qualifier.label} tone={qualifier.tone} />
                      <Chip value={`${project.open} open`} tone="room" />
                    </div>
                  </div>
                  <div className="mt-1 text-2xs text-muted-foreground">
                    {project.total} cards · To do {project.counts.TODO ?? 0} · Next {project.counts.NEXT ?? 0} · In progress {project.counts.IN_PROGRESS ?? 0} · Blocked {project.counts.BLOCKED ?? 0} · Done {project.counts.DONE ?? 0}
                  </div>
                </li>
              );
            })}
          </ul>
          {!data && !problem ? <p className="text-2xs text-muted-foreground">Loading boards…</p> : null}
        </div>
      </Panel>
    </section>
  );
}

export function PmPortfolioSurface() {
  const [data, setData] = React.useState<PmPortfolio | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await pmPortfolio();
    if (res.ok) { setData(res.data); setProblem(null); }
    else { setProblem(res.message); }
    setLoading(false);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const visible = (data?.projects ?? []).filter((project) => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return true;
    return `${project.name} ${project.id} ${project.prefix}`.toLocaleLowerCase().includes(query);
  });

  return (
    <section className="command-stack" aria-label="Project portfolio" data-pm="portfolio">
      <OrgOperateSnapshot />
      <Panel
        title="Project boards"
        count={data ? `${visible.length} boards` : loading ? 'LOADING' : 'UNAVAILABLE'}
        toolbar={(
          <>
            {pmIsScratch() ? <Chip value={`SCRATCH :${pmPort()}`} tone="drift" /> : null}
            <button type="button" className="go-link" onClick={() => void load()} disabled={loading}>Refresh</button>
          </>
        )}
      >
        <PmNav current="portfolio" />
        <label className="mx-3 grid gap-1 py-2 text-2xs text-muted-foreground">
          Find a board
          <input
            type="search"
            aria-label="Filter projects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Board name"
            className="w-full rounded border border-border bg-surface-0 px-2 py-1.5 text-xs text-foreground"
          />
        </label>

        {/* WP-4 / WP-5 Truthful Progress & Founder Oversight Notice Banner */}
        <div role="status" className="mx-3 my-2 rounded border border-[hsl(var(--stale,_#eab308))]/40 bg-[hsl(var(--stale,_#eab308))]/10 p-3 text-xs text-foreground">
          <div className="flex items-center gap-2 font-semibold text-[hsl(var(--stale,_#eab308))]">
            <span className="chip" data-tone="stale">GOVERNANCE NOTICE</span>
            <span>Truthful Progress & Operational Readiness</span>
          </div>
          <p className="mt-1 text-2xs text-muted-foreground leading-relaxed">
            Historical ticket status does not indicate operational software readiness. Codebase audit, runtime verification, and Founder authorization are required before activation. Projects marked ON HOLD (DEC-100) or PRE-ACTIVATION cannot execute live tasks until authorized.
          </p>
        </div>

        {problem && !data ? (
          <SourceGap reason="PM service unavailable." detail={`${problem} Start it with: npm run os:start`} />
        ) : null}
        {data ? (
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3" data-project-grid="pm-portfolio">
            {visible.map((p) => {
              const qualifier = getOperationalQualifier(p.id, p.hold?.state, p.execution_qualifier);
              const done = p.counts.DONE ?? 0;
              const historicalClosed = p.done_historical ?? done;
              return (
                <article key={p.id} data-project={p.id} className="grid content-start gap-3 rounded-lg border border-border bg-card/40 p-3">
                  <header className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="font-semibold leading-tight">
                          <GoLink href={`${pmBoardHref(p.id)}${pmQuery()}`}>{p.name}</GoLink>
                        </h3>
                        <Chip value={qualifier.label} tone={qualifier.tone} />
                      </div>
                      <span className="mono text-2xs text-muted-foreground">{p.prefix} · {p.total} cards</span>
                    </div>
                    <Chip value={`${p.open} open`} tone="room" />
                  </header>

                  {/* Multi-tier progress display per DEC-072 / R-1 */}
                  <div className="grid gap-1.5 rounded border border-border/60 bg-surface-0/60 p-2 text-2xs">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Historical tasks closed:</span>
                      <span className="mono font-semibold text-foreground">{historicalClosed} / {(p.historical_total != null ? p.historical_total : 'UNKNOWN/SOURCE GAP')} (historical only; live accepted-work completion: SOURCE GAP)</span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Tasks with commit:</span>
                      <span className="mono font-semibold text-foreground">{p.metrics?.committed?.count ?? 0} / {done} ({p.metrics?.committed?.percent ?? 0}%)</span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Verified acceptance:</span>
                      <span className="mono font-semibold text-foreground">{p.metrics?.proven?.count ?? 0} / {done} ({p.metrics?.proven?.percent ?? 0}%)</span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Plan capability:</span>
                      <span className="mono font-semibold text-foreground">
                        {p.metrics?.capability
                          ? `${p.metrics.capability.implemented} / ${p.metrics.capability.total} (${p.metrics.capability.percent}%)`
                          : 'NO CURRENT PLAN'}
                      </span>
                    </div>
                    {qualifier.note ? (
                      <p className="mt-0.5 border-t border-border/40 pt-1 text-[10px] text-muted-foreground">
                        {qualifier.note}
                      </p>
                    ) : null}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs sm:grid-cols-3">
                    {data.statuses.map((status) => (
                      <div key={status} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{PM_STATUS_LABELS[status as PmStatus] ?? status}</dt>
                        <dd className="mono">{p.counts[status as PmStatus] ?? 0}</dd>
                      </div>
                    ))}
                  </dl>
                  {p.blocked ? <p className="text-2xs text-truth-drift font-medium">{p.blocked} blocked</p> : null}
                </article>
              );
            })}
            {visible.length === 0 ? (
              <p className="col-span-full text-xs text-muted-foreground" data-project-filter-empty="">
                {data.projects.length === 0 ? 'No boards yet.' : 'No boards match this filter.'}
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>
      <PmSourceArchivePanel />
    </section>
  );
}

function PmSourceArchivePanel() {
  const [sources, setSources] = React.useState<PmNexusSource[]>([]);
  const [records, setRecords] = React.useState<PmNexusSourceRecord[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  const loadSources = React.useCallback(async () => {
    setLoading(true);
    const res = await pmNexusSources();
    if (res.ok) { setSources(res.data.sources); setProblem(null); }
    else setProblem(res.message);
    setLoading(false);
  }, []);

  React.useEffect(() => { void loadSources(); }, [loadSources]);

  const inspect = async (sourceFile: string) => {
    const res = await pmNexusSources(sourceFile);
    if (res.ok) {
      setSelected(sourceFile);
      setRecords(res.data.records ?? []);
      setProblem(null);
    } else setProblem(res.message);
  };

  const visible = records.filter((record) => {
    const raw = record.raw_payload as Record<string, unknown>;
    const task = raw.task && typeof raw.task === 'object' ? raw.task as Record<string, unknown> : raw;
    return `${task.id ?? ''} ${task.title ?? ''} ${record.raw_status ?? ''} ${record.resolution}`
      .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });

  return (
    <Panel
      title="Source records & history"
      count={loading ? 'LOADING' : `${sources.length} preserved sources`}
      toolbar={<button type="button" className="go-link" onClick={() => void loadSources()} disabled={loading}>Refresh</button>}
    >
      <div className="body grid gap-3" data-pm-source-archive="">
        <p className="prose-note">Original task payloads, relationships, histories and source hashes remain inspectable here. Command’s active board fields are a working projection of those records.</p>
        {problem ? <SourceGap reason="Source records unavailable." detail={problem} /> : null}
        <ul className="grid gap-2 md:grid-cols-2">
          {sources.map((source) => (
            <li key={source.source_file} className="rounded border border-border p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block break-all text-2xs">{source.source_file}</strong>
                  <span className="text-2xs text-muted-foreground">
                    {source.preserved_rows}/{source.row_count} rows · {source.duplicate_rows} duplicate · {source.archived_rows} archived
                  </span>
                </div>
                <button type="button" className="go-link shrink-0" onClick={() => void inspect(source.source_file)}>
                  {selected === source.source_file ? 'Inspected' : 'Inspect'}
                </button>
              </div>
              <div className="mt-1 break-all font-mono text-2xs text-muted-foreground">SHA-256 {source.content_sha256}</div>
            </li>
          ))}
        </ul>
        {selected ? (
          <div className="grid gap-2 border-t border-border pt-3" data-source-file={selected}>
            <label className="grid gap-1 text-2xs text-muted-foreground">
              Filter {selected} rows
              <input aria-label="Filter source records" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <ul className="grid gap-2">
              {visible.map((record) => {
                const raw = record.raw_payload as Record<string, unknown>;
                const task = raw.task && typeof raw.task === 'object' ? raw.task as Record<string, unknown> : raw;
                const id = String(task.id ?? `row-${record.source_row_index + 1}`);
                return (
                  <li key={`${record.source_row_index}-${record.payload_sha256}`} className="rounded border border-border p-2">
                    <details>
                      <summary className="cursor-pointer text-2xs">
                        {id} · {String(task.title ?? 'Untitled source row')} · {record.raw_status ?? 'UNKNOWN'} · {record.resolution}
                      </summary>
                      <div className="mt-2 break-all font-mono text-2xs text-muted-foreground">Row {record.source_row_index + 1} · record SHA-256 {record.payload_sha256}</div>
                      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-2xs text-muted-foreground">{JSON.stringify(raw, null, 2)}</pre>
                    </details>
                  </li>
                );
              })}
              {!visible.length ? <li className="text-2xs text-muted-foreground">No source rows match.</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
