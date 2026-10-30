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
  pmRepositoryStatus,
  REPOSITORY_STATUS_POLL_MS,
  readRepositoryStatus,
  type PmNexusSource,
  type PmNexusSourceRecord,
  type PmPortfolio,
  type PmProject,
  type PmStatus,
  type RepositoryStatusFeed,
  type RepositorySyncState,
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
  { name: 'Historical Products', ids: ['portal', 'pos'] },
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
};

export function getOperationalQualifier(
  projectId: string,
  holdState?: string | null,
  customQualifier?: string | null,
  authorityUpdate?: { lifted_by: string; scope: string } | null,
): { label: string; tone: 'hold' | 'stale' | 'muted' | 'room'; note?: string } {
  if (projectId === 'erp') {
    return {
      label: 'ACTIVE',
      tone: 'room',
      note: authorityUpdate?.lifted_by
        ? `Operating authority: ACTIVE per ${authorityUpdate.lifted_by} (${authorityUpdate.scope}). Historical DEC-100 superseded.`
        : 'Operating authority: ACTIVE per Founder #16183/#16185/#16211. Historical DEC-100 superseded.',
    };
  }
  if (customQualifier) {
    return {
      label: customQualifier,
      tone: customQualifier.includes('HOLD') ? 'hold' : customQualifier.includes('HISTORICAL') ? 'muted' : 'stale',
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
    return projects.filter((p) => p.id !== 'starqbooks' && !knownGroupIds.has(p.id));
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

  const visibleProjects = (data?.projects ?? []).filter((project) => project.id !== 'starqbooks');

  return (
    <section aria-label="Project boards" data-pm-portfolio-snapshot="">
      <Panel
        title="Project boards"
        count={data ? `${visibleProjects.length} boards` : 'PM summary UNKNOWN'}
        toolbar={<GoLink href="#studio/projects">Open all boards →</GoLink>}
      >
        <div className="body grid gap-2">
          {problem ? <SourceGap reason="PM boards unavailable." detail={problem} /> : null}
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleProjects.map((project) => {
              const qualifier = getOperationalQualifier(project.id, project.hold?.state, project.execution_qualifier, project.hold?.authority_update);
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

export function CommandDailyActions({ data, problem, loading }: {
  data: PmPortfolio | null;
  problem: string | null;
  loading: boolean;
}) {
  const commandProject = (data?.projects ?? []).find((p) => p.id === 'command');
  const openCount = commandProject?.open ?? 0;
  const blockedCount = commandProject?.blocked ?? 0;
  const unassignedCount = commandProject?.unassigned ?? 0;
  const totalCount = commandProject?.total ?? 0;
  const sourceGap = commandProject?.source_gap ?? null;

  return (
    <section aria-label="Command daily actions" data-pm-daily-actions="">
      <Panel title="Command daily actions" count={commandProject ? `${openCount} open` : 'PM summary UNKNOWN'}>
        <div className="body grid gap-2">
          {problem ? <SourceGap reason="PM portfolio unavailable." detail={problem} /> : null}
          {commandProject ? (
            <>
              <div className="flex flex-wrap gap-2 text-2xs">
                <Chip value={`${openCount} open`} tone="room" />
                <Chip value={`${blockedCount} blocked`} tone={blockedCount > 0 ? 'hold' : 'muted'} />
                <Chip value={`${unassignedCount} unassigned`} tone={unassignedCount > 0 ? 'stale' : 'muted'} />
                <Chip value={`${totalCount} total`} tone="muted" />
              </div>
              {sourceGap ? <SourceGap reason="Source gap." detail={String(sourceGap)} /> : null}
            </>
          ) : problem ? null : loading ? (
            <p className="text-2xs text-muted-foreground" role="status">Loading Command actions…</p>
          ) : (
            <SourceGap reason="Command project row missing." detail="PM portfolio returned no project with id command; counts are unavailable." />
          )}
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
    else { setData(null); setProblem(res.message); }
    setLoading(false);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const visible = (data?.projects ?? []).filter((project) => {
    if (project.id === 'starqbooks') return false;
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
        <RepositoryStatusPanel />
        {data ? (
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3" data-project-grid="pm-portfolio">
            {visible.map((p) => {
              const qualifier = getOperationalQualifier(p.id, p.hold?.state, p.execution_qualifier, p.hold?.authority_update);
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
                      <span className="mono font-semibold text-foreground">{historicalClosed} / {p.total} ({p.metrics?.claimed?.percent ?? (p.total > 0 ? Math.round((done / p.total) * 100) : 0)}%)</span>
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
      <CommandDailyActions data={data} problem={problem} loading={loading} />
      <PmSourceArchivePanel />
    </section>
  );
}

function syncTone(state: RepositorySyncState): 'ok' | 'stale' | 'unknown' | 'drift' {
  if (state === 'CURRENT') return 'ok';
  if (state === 'STALE') return 'stale';
  if (state === 'UNRESOLVED') return 'drift';
  return 'unknown';
}

function showFact(value: string | number | null): string {
  if (value === null || value === '') return 'UNKNOWN';
  return String(value);
}

function showUpstream(value: string | null): string {
  if (!value) return 'UNKNOWN';
  if (value.includes('://') || value.includes('@')) return 'REDACTED';
  return value;
}

function showAheadBehind(ahead: number | null, behind: number | null): string {
  if (ahead === null || behind === null) return 'UNKNOWN';
  return `${ahead} ahead / ${behind} behind`;
}

export function RepositoryStatusPanel() {
  const [feed, setFeed] = React.useState<RepositoryStatusFeed | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await pmRepositoryStatus();
      if (!active) return;
      if (!res.ok) {
        setFeed(null);
        setProblem(res.message);
      } else {
        const read = readRepositoryStatus(res.data);
        if (!read.ok) {
          setFeed(null);
          setProblem(read.reason);
        } else {
          setFeed(read.feed);
          setProblem(null);
        }
      }
      setLoading(false);
    };
    void load();
    const timer = setInterval(() => { void load(); }, REPOSITORY_STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const count = problem ? 'UNAVAILABLE' : loading ? 'LOADING' : `${feed?.repositories.length ?? 0} repos`;
  return (
    <Panel title="Repository sync" count={count}>
      <div className="body grid gap-2" data-repository-status="">
        <p className="prose-note">
          Git branch, HEAD, ahead/behind, dirty files, and the last origin fetch are sync facts.
          They do not mark a task done, verified, or ready.
        </p>
        {problem ? <SourceGap reason="Repository status unavailable." detail={problem} /> : null}
        {feed ? (
          <ul className="grid gap-2">
            {feed.repositories.map((repo) => (
              <li
                key={repo.project_id}
                className="rounded border border-border p-2"
                data-repository={repo.project_id}
                data-sync-state={repo.state}
              >
                <div className="flex items-start justify-between gap-2">
                  <strong className="text-xs">{repo.project_id}</strong>
                  <Chip value={repo.state} tone={syncTone(repo.state)} />
                </div>
                <dl className="mt-1 grid gap-1 text-2xs text-muted-foreground">
                  <div className="flex justify-between gap-2"><dt>Branch</dt><dd className="mono text-foreground">{showFact(repo.branch)}</dd></div>
                  <div className="flex justify-between gap-2"><dt>HEAD</dt><dd className="mono text-foreground" title={repo.head ?? undefined}>{showFact(repo.head)}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Upstream</dt><dd className="mono text-foreground">{showUpstream(repo.upstream)}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Ahead / behind</dt><dd className="mono text-foreground">{showAheadBehind(repo.ahead, repo.behind)}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Dirty files</dt><dd className="mono text-foreground">{showFact(repo.dirty_file_count)}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Last origin fetch</dt><dd className="mono text-foreground">{showFact(repo.last_origin_fetch)}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Commit time</dt><dd className="mono text-foreground">{showFact(repo.commit_time)}</dd></div>
                </dl>
                {repo.reason ? <p className="mt-1 text-2xs text-muted-foreground">{repo.reason}</p> : null}
              </li>
            ))}
            {feed.repositories.length === 0 ? (
              <li className="text-2xs text-muted-foreground">No repository rows were returned.</li>
            ) : null}
          </ul>
        ) : null}
        {feed?.generated_at ? (
          <p className="text-2xs text-muted-foreground">Status generated {feed.generated_at}. Polled every 30 seconds.</p>
        ) : null}
      </div>
    </Panel>
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
