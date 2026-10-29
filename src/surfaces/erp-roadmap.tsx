import * as React from 'react';
import { Panel, Chip, SourceGap } from '@/components/console';
import { pmGetRoadmaps, type PmRoadmapsData } from '@/lib/pm-client';
import { GitBranch } from 'lucide-react';

export function ErpRoadmapSurface() {
  const [data, setData] = React.useState<PmRoadmapsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    pmGetRoadmaps()
      .then((res) => {
        if (!active) return;
        if (res.ok) {
          setData(res.data);
          setLoading(false);
        } else {
          setError(res.message || 'PM roadmaps endpoint returned error');
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err?.message || 'Failed to load ERP roadmap data');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-4">
        <Panel title="ERP Roadmap & Approved Plan Model">
          <p className="text-xs text-muted-foreground">Loading ERP plan generations and process bindings from PM service...</p>
        </Panel>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4">
        <Panel title="ERP Roadmap & Approved Plan Model">
          <SourceGap reason={error || 'ERP roadmap data unavailable'} />
        </Panel>
      </div>
    );
  }

  const generations = data.plan_generations || [];
  const approvedPlan = data.current_approved_plan;
  const stageBindings = data.stage_bindings || [];
  const milestones = data.milestones || [];

  const boundCount = stageBindings.filter((s) => s.bound_status === 'BOUND').length;
  const unboundCount = stageBindings.filter((s) => s.bound_status === 'NO CARDS BOUND').length;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="erp-roadmap-surface">
      {/* 1. Header Banner */}
      <Panel title="ERP Roadmap & Current Approved Plan (W3 / R-6 / M-2 / M-5)">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-emerald-500" />
            <span className="font-semibold text-foreground text-sm">
              Current Approved Plan: Generation 3 (SERP-460..SERP-467)
            </span>
            <Chip value="CURRENT APPROVED" tone="ok" />
          </div>
          <div className="text-xs text-muted-foreground">
            Authority: <span className="font-mono text-foreground">{approvedPlan?.authority || 'Founder #14394'}</span> · Date: {approvedPlan?.approved_date || '2026-10-26'}
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded border border-border/60 bg-surface-0/30 p-2.5">
            <span className="text-muted-foreground text-2xs uppercase tracking-wider block">Plan Authority Status</span>
            <span className="font-medium text-foreground mt-0.5 block">General DEC-100 Freeze LIFTED</span>
            <span className="text-muted-foreground text-2xs block mt-1">#14394 authorized normal ERP engineering. Residual CP2 HOLD #12690 applies only to payment-dispatch garage scope.</span>
          </div>
          <div className="rounded border border-border/60 bg-surface-0/30 p-2.5">
            <span className="text-muted-foreground text-2xs uppercase tracking-wider block">Current Plan Cards</span>
            <span className="font-medium text-foreground mt-0.5 block">{approvedPlan?.cards?.length || 8} Active Cards Bound</span>
            <span className="font-mono text-emerald-500 text-2xs block mt-1">SERP-460..SERP-467</span>
          </div>
          <div className="rounded border border-border/60 bg-surface-0/30 p-2.5">
            <span className="text-muted-foreground text-2xs uppercase tracking-wider block">Process Stage Binding</span>
            <span className="font-medium text-foreground mt-0.5 block">{boundCount} Bound / {unboundCount} No Cards Bound</span>
            <span className="text-muted-foreground text-2xs block mt-1">41 of 49 stages explicitly bound to work packages.</span>
          </div>
        </div>
      </Panel>

      {/* 2. Plan Generations */}
      <Panel title="ERP Plan Generations (M-2)">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {generations.map((gen) => {
            const isCurrent = gen.status === 'CURRENT';
            return (
              <div
                key={gen.id}
                className={`rounded border p-3 flex flex-col justify-between ${
                  isCurrent
                    ? 'border-emerald-500/50 bg-emerald-950/10'
                    : 'border-border/60 bg-surface-0/20'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-xs font-semibold text-foreground">{gen.id}</span>
                    <Chip value={gen.status} tone={isCurrent ? 'ok' : 'muted'} />
                  </div>
                  <h4 className="mt-1 font-medium text-foreground text-xs">{gen.title}</h4>
                  <p className="mt-1 text-2xs text-muted-foreground line-clamp-3">{gen.description}</p>
                </div>
                <div className="mt-3 pt-2 border-t border-border/40 text-2xs text-muted-foreground flex justify-between">
                  <span>Card count:</span>
                  <span className="font-mono font-medium text-foreground">{gen.card_count}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* 3. Milestones */}
      <Panel title="Convergence Milestones (5 Business Process Chains)">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground text-2xs uppercase">
                <th className="py-2 pr-3">Chain</th>
                <th className="py-2 px-3">Milestone</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Target Date</th>
                <th className="py-2 pl-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {milestones.map((m) => (
                <tr key={m.id} className="hover:bg-surface-0/20">
                  <td className="py-2 pr-3 font-mono text-foreground font-medium">{m.chain}</td>
                  <td className="py-2 px-3 text-foreground">{m.name}</td>
                  <td className="py-2 px-3">
                    <Chip value={m.status} tone={m.status === 'ACHIEVED' ? 'ok' : m.status === 'IN_PROGRESS' ? 'stale' : 'muted'} />
                  </td>
                  <td className="py-2 px-3 font-mono text-muted-foreground">{m.target_date || 'TBD'}</td>
                  <td className="py-2 pl-3 text-2xs text-muted-foreground">{m.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* 4. Process Stage Bindings (49 Stages) */}
      <Panel title="Process Stage Bindings (M-5 / 49 Stages)">
        <div className="flex items-center justify-between pb-2 text-xs text-muted-foreground">
          <span>Mapping between canonical process stages and active Gen 3 work packages</span>
          <span className="font-mono">{boundCount} BOUND · {unboundCount} NO CARDS BOUND</span>
        </div>
        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-background border-b border-border/60 text-muted-foreground text-2xs uppercase">
              <tr>
                <th className="py-2 pr-3">Chain</th>
                <th className="py-2 px-3">Process Stage</th>
                <th className="py-2 px-3">Binding Status</th>
                <th className="py-2 pl-3">Bound Work Packages</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {stageBindings.map((sb) => {
                const isBound = sb.bound_status === 'BOUND';
                return (
                  <tr key={`${sb.chain}-${sb.stage}`} className="hover:bg-surface-0/20">
                    <td className="py-1.5 pr-3 font-mono text-2xs text-muted-foreground">{sb.chain}</td>
                    <td className="py-1.5 px-3 font-medium text-foreground">{sb.stage}</td>
                    <td className="py-1.5 px-3">
                      <Chip value={sb.bound_status} tone={isBound ? 'ok' : 'drift'} />
                    </td>
                    <td className="py-1.5 pl-3">
                      {sb.bound_cards && sb.bound_cards.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {sb.bound_cards.map((c) => (
                            <span
                              key={c}
                              className="rounded border border-emerald-500/40 bg-emerald-950/20 px-1 py-px font-mono text-2xs text-emerald-400"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="font-mono text-2xs text-muted-foreground/60">NO CURRENT CARD</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
