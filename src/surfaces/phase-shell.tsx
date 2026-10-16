import { Construction } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ViewId } from '@/components/shell';

/**
 * PhaseShell — an honest placeholder for a surface whose phase is not yet
 * authorised.
 *
 * This is deliberately NOT an empty dashboard. An empty dashboard reads as
 * "there is nothing here", which is a false operational claim. This reads as
 * "this surface has not been built yet, and here is exactly why it is
 * permitted to be absent" — which is true.
 */
export function PhaseShell({
  phase,
  title,
  intent,
  willShow,
  constraints,
}: {
  phase: number;
  title: string;
  intent: string;
  willShow: string[];
  constraints: string[];
}) {
  return (
    <div className="flex items-start justify-center p-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Construction className="h-4 w-4 text-truth-stale" />
            <CardTitle>{title}</CardTitle>
            <Badge variant="outline" className="ml-auto border-truth-stale/30 bg-truth-stale-soft text-truth-stale">
              PHASE {phase} · NOT YET AUTHORISED
            </Badge>
          </div>
          <CardDescription>{intent}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="label-micro mb-2">This surface will show</p>
            <ul className="space-y-1">
              {willShow.map((w) => (
                <li key={w} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="mt-1.5 h-0.5 w-0.5 shrink-0 rounded-full bg-muted-foreground" />
                  {w}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label-micro mb-2">Constraints that will bind it</p>
            <ul className="space-y-1">
              {constraints.map((c) => (
                <li key={c} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="mt-1.5 h-0.5 w-0.5 shrink-0 rounded-full bg-truth-hold" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <p className="border-t border-border pt-3 text-2xs text-muted-foreground/80">
            This surface shows no data because its phase has not been authorised
            yet — not because the studio is quiet. An authorised surface would be
            assembled from canonical source; this one deliberately is not.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export const PHASE_INTENTS: Partial<Record<ViewId, Omit<Parameters<typeof PhaseShell>[0], 'title'>>> = {
  // Every phase authorised so far has left this registry:
  //   `truth`     (Phase 2) -> surfaces/truth.tsx
  //   `floor`     (Phase 3) -> surfaces/floor.tsx
  //   `process`   (Phase 4) -> surfaces/process.tsx
  //   `attention` (Phase 5) -> surfaces/attention.tsx, DECLARED EXCEPTIONS ONLY
  //
  // Phase 5 left on Founder authorisation. Its registry entry is deliberately
  // NOT carried forward: the promises it made were ruled down BEFORE
  // implementation, and keeping them here would re-assert claims the Founder
  // struck. Specifically ruled out by the B1-B5 decisions:
  //
  //   "What changed since the Founder last looked" -> DROPPED (B2: no trustworthy
  //     canonical viewed watermark exists; cursors/ali.json is stale and outside
  //     the declared read-only surface)
  //   "An evidence drawer with provenance"          -> DROPPED (B1: the ledger is
  //     17 MB against an 8 MB /api/raw cap; no ledger-body drill-down)
  //   "Release and verification state"              -> DROPPED (no canonical
  //     release artefact exists; gate and provenance state is already live on
  //     Truth & Health)
  //   "A concise daily operational picture"         -> DROPPED (B5: no day
  //     boundary or timezone convention is declared anywhere)
  //   "A decision waiting days is a different problem from one waiting hours"
  //                                                  -> DROPPED (B4: no canonical
  //     open-decision timestamp exists, so an age would be arithmetic against an
  //     invented baseline)
  //
  // What survived is narrower, and is exactly what surfaces/attention.tsx
  // builds: declared exceptions only — discrepancies canonical source flags
  // `founder_decision_required`, the DEC-100 hold and its restart gate,
  // declared process blockers, and declared integrity conflicts. No ranking, no
  // score, and no attention derived from message text.
  //
  // The registry is intentionally EMPTY rather than repopulated with a Phase 6
  // shell. No phase beyond 5 is authorised, so no later surface is described
  // here at all.
};

export function PhaseShellFor({ view }: { view: ViewId }) {
  const spec = PHASE_INTENTS[view];
  if (!spec) return null;
  /*
    The registry above is intentionally EMPTY, so this function always returns
    null today. The title ternary that used to branch on `view === 'process'`
    was removed with the dead `truth`/`floor`/`process` members of ViewId
    (Goose R8): those views survive only as legacy hash rewrites in
    building-route.ts, so a title branch keyed on one of them described a route
    the type no longer admits.
  */
  return <PhaseShell title="Not yet authorised" {...spec} />;
}
