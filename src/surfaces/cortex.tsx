import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Network, Search } from 'lucide-react';

interface CortexNode {
  id: string;
  type: string;
  title?: string;
  summary?: string;
  canonicalPath?: string;
  domain?: string;
  status?: string;
  docClass?: string;
}

interface CortexEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  provenance?: Record<string, unknown>;
}

interface CortexNeighborhood {
  state: string;
  focus: CortexNode | null;
  nodes: CortexNode[];
  edges: CortexEdge[];
  truncated?: boolean;
}

interface CortexStats {
  node_count: number;
  edge_count: number;
  node_types: Record<string, number>;
  edge_types: Record<string, number>;
  modified_at: string;
  sha256: string;
}

const DEFAULT_FOCUS = 'project:starq-erp';

function colorFor(type: string) {
  if (['task', 'packet', 'mission'].includes(type)) return '#f59e0b';
  if (['project', 'company', 'seat', 'person'].includes(type)) return '#10b981';
  if (['document', 'spec', 'plan', 'artifact', 'file'].includes(type)) return '#8b5cf6';
  if (['commit', 'branch', 'review', 'pr', 'test', 'migration', 'worktree'].includes(type)) return '#ef4444';
  return '#38bdf8';
}

export function CortexSurface() {
  const [stats, setStats] = useState<CortexStats | null>(null);
  const [graph, setGraph] = useState<CortexNeighborhood>({ state: 'LOADING', focus: null, nodes: [], edges: [] });
  const [focusId, setFocusId] = useState(DEFAULT_FOCUS);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CortexNode[]>([]);
  const [depth, setDepth] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNeighborhood = useCallback(async (id: string, hops = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ id, depth: String(hops), limit: '56' });
      const response = await fetch(`/api/building/cortex/neighborhood?${params}`, { cache: 'no-store' });
      const payload = await response.json() as CortexNeighborhood & { error?: string };
      if (!response.ok) throw new Error(payload.error || `Cortex returned ${response.status}`);
      setGraph(payload);
      setFocusId(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/building/cortex/stats', { cache: 'no-store' })
      .then(async (response) => {
        const value = await response.json() as CortexStats & { error?: string };
        if (!response.ok) throw new Error(value.error || `Cortex returned ${response.status}`);
        setStats(value);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    void loadNeighborhood(DEFAULT_FOCUS, 1);
  }, [loadNeighborhood]);

  useEffect(() => {
    if (!query.trim()) { setHits([]); return; }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, limit: '10' });
      fetch(`/api/building/cortex/search?${params}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((payload: { nodes?: CortexNode[] }) => setHits(payload.nodes ?? []))
        .catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const focus = graph.nodes.find((node) => node.id === focusId) ?? graph.focus;
  const positions = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>();
    const current = graph.nodes.find((node) => node.id === focusId) ?? graph.focus;
    if (!current) return result;
    result.set(current.id, { x: 450, y: 275 });
    const others = graph.nodes.filter((node) => node.id !== current.id);
    const radius = others.length > 28 ? 215 : others.length > 15 ? 185 : 155;
    others.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(others.length, 1)) * Math.PI * 2;
      result.set(node.id, { x: 450 + Math.cos(angle) * radius, y: 275 + Math.sin(angle) * radius });
    });
    return result;
  }, [graph.nodes, graph.focus, focusId]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams({ q: query, limit: '10' });
    fetch(`/api/building/cortex/search?${params}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: { nodes?: CortexNode[] }) => setHits(payload.nodes ?? []))
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };

  const openRelatedSurface = () => {
    if (!focus) return;
    const target = focus.type === 'document' ? '#library' :
      ['company'].includes(focus.type) ? '#company/structure' :
        ['seat', 'person'].includes(focus.type) ? '#company/seats' :
          ['task', 'project', 'packet', 'mission'].includes(focus.type) ? '#studio/projects' : '#evidence/sources';
    window.location.hash = target;
  };

  return (
    <div className="room-root" data-room="cortex">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-violet-400/30 bg-violet-400/10 text-violet-300"><Network className="h-4 w-4" /></span>
          <div>
            <p className="label-micro">Recovered from StarqNexus · provenance retained</p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight">Cortex</h1>
            <p className="mt-1 text-xs text-muted-foreground">Explore connected projects, tasks, documents, people, decisions, and evidence.</p>
          </div>
        </div>
        <span className="chip" data-tone={stats ? 'ok' : 'unknown'}>{stats ? `${stats.node_count.toLocaleString()} nodes · ${stats.edge_count.toLocaleString()} links` : 'Graph unavailable'}</span>
      </header>

      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_22rem] md:p-5">
        <section className="min-w-0 rounded-lg border border-border bg-surface-1/40">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
            <form onSubmit={submit} className="relative flex min-w-[16rem] flex-1 items-center gap-2 rounded-md border border-border bg-surface-0 px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <label className="sr-only" htmlFor="cortex-search">Search connected knowledge</label>
              <input id="cortex-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search connected knowledge…" className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
              <button type="submit" className="sr-only">Search</button>
              {hits.length ? (
                <div className="absolute left-0 right-0 top-10 z-10 max-h-64 overflow-auto rounded-md border border-border bg-surface-1 shadow-xl">
          {hits.map((node) => <button type="button" key={node.id} onClick={() => { setQuery(''); setHits([]); void loadNeighborhood(node.id, depth); }} className="block w-full border-b border-border/70 px-3 py-2 text-left hover:bg-foreground/[0.05]"><span className="block truncate text-xs font-medium">{node.title || node.id}</span><span className="mt-1 block truncate font-mono text-2xs text-muted-foreground">{node.type} · {node.id}</span></button>)}
                </div>
              ) : null}
            </form>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">Connections
              <select value={depth} onChange={(event) => { const next = Number(event.target.value); setDepth(next); void loadNeighborhood(focusId, next); }} className="rounded-md border border-border bg-surface-0 px-2 py-2 text-xs text-foreground">
                <option value={1}>Direct</option><option value={2}>2 steps</option><option value={3}>3 steps</option>
              </select>
            </label>
          </div>

          <div className="relative overflow-hidden">
            <svg viewBox="0 0 900 550" role="img" aria-label="Cortex relationship graph" className="h-[58vh] min-h-[380px] w-full">
              <defs><pattern id="cortex-grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="currentColor" opacity="0.14" /></pattern></defs>
              <rect width="900" height="550" fill="url(#cortex-grid)" />
              {graph.edges.map((edge) => {
                const from = positions.get(edge.from); const to = positions.get(edge.to);
                if (!from || !to) return null;
                return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#64748b" strokeOpacity="0.38" strokeWidth="1.2"><title>{edge.type}: {edge.from} → {edge.to}</title></line>;
              })}
              {graph.nodes.map((node) => {
                const point = positions.get(node.id); if (!point) return null;
                const active = node.id === focusId;
                const color = colorFor(node.type);
                return (
                  <g key={node.id} role="button" tabIndex={0} aria-label={`${node.type}: ${node.title || node.id}`} onClick={() => void loadNeighborhood(node.id, depth)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') void loadNeighborhood(node.id, depth); }} className="cursor-pointer">
                    <circle cx={point.x} cy={point.y} r={active ? 25 : 16} fill={color} fillOpacity={active ? 0.92 : 0.75} stroke={active ? '#ffffff' : color} strokeWidth={active ? 2.2 : 1.2} />
                    <text x={point.x} y={point.y + (active ? 39 : 29)} textAnchor="middle" className="fill-foreground text-[10px]">{(node.title || node.id).slice(0, 22)}</text>
                    <title>{node.type} · {node.title || node.id}</title>
                  </g>
                );
              })}
            </svg>
            {graph.truncated ? <div className="absolute bottom-3 left-3 rounded border border-truth-stale/30 bg-surface-0/90 px-2 py-1 text-2xs text-muted-foreground">Connection view limited to the nearest 56 records.</div> : null}
            {loading ? <div className="absolute right-3 top-3 rounded bg-surface-0/90 px-2 py-1 text-2xs text-muted-foreground">Loading links…</div> : null}
          </div>
        </section>

        <aside className="min-w-0 rounded-lg border border-border bg-surface-1/40 p-4">
          {error ? <div role="alert" className="mb-3 rounded border border-truth-drift/40 bg-truth-drift-soft/50 p-2 text-xs text-truth-drift">{error}</div> : null}
          {focus ? <>
            <p className="label-micro">Selected record</p>
            <h2 className="mt-2 text-sm font-semibold">{focus.title || focus.id}</h2>
            <p className="mt-1 break-all font-mono text-2xs text-muted-foreground">{focus.id}</p>
            <div className="mt-3 flex flex-wrap gap-1.5"><span className="chip" data-tone="room">{focus.type}</span>{focus.status ? <span className="chip" data-tone="unknown">{focus.status}</span> : null}{focus.docClass ? <span className="chip" data-tone="unknown">{focus.docClass}</span> : null}</div>
            {focus.summary ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{focus.summary}</p> : null}
            {focus.canonicalPath ? <p className="mt-3 break-all font-mono text-2xs text-muted-foreground">{focus.canonicalPath}</p> : null}
            <button type="button" onClick={openRelatedSurface} className="mt-4 inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/15">Open related Command view <ArrowUpRight className="h-3.5 w-3.5" /></button>
            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-2 flex items-center justify-between"><p className="label-micro">Connections</p><span className="text-2xs text-muted-foreground">{graph.edges.length}</span></div>
              <div className="max-h-[34vh] space-y-1 overflow-auto">
                {graph.edges.map((edge) => {
                  const otherId = edge.from === focus.id ? edge.to : edge.from;
                  const other = graph.nodes.find((node) => node.id === otherId);
                  return <button type="button" key={edge.id} onClick={() => void loadNeighborhood(otherId, depth)} className="block w-full rounded px-2 py-2 text-left hover:bg-foreground/[0.045]"><span className="block text-2xs font-semibold text-primary/90">{edge.type}</span><span className="mt-0.5 block truncate text-xs">{other?.title || other?.id || otherId}</span><span className="mt-0.5 block truncate font-mono text-2xs text-muted-foreground">{other?.type || 'record'} · {otherId}</span></button>;
                })}
                {!graph.edges.length ? <p className="text-xs text-muted-foreground">No direct links in this source snapshot.</p> : null}
              </div>
            </div>
          </> : <p className="text-sm text-muted-foreground">Choose a result or graph node to inspect its links.</p>}
          {stats ? <p className="mt-5 border-t border-border pt-3 text-2xs text-muted-foreground">Snapshot {new Date(stats.modified_at).toLocaleString()} · SHA-256 {stats.sha256.slice(0, 12)}</p> : null}
        </aside>
      </div>
    </div>
  );
}

