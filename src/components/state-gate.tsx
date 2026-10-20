import { AlertTriangle, Ban, CircleDashed, FileWarning, Loader2, Radio, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import type { SurfaceState } from '@/lib/contracts';
import { SURFACE_TONE } from '@/lib/states';

/**
 * StateGate — the structural honesty boundary.
 *
 * Every surface in Command renders through this. There is no code path that
 * shows data without declaring which of these states it is in:
 *
 *   LOADING     — we are measuring. Skeletons only, no values.
 *   UNAVAILABLE — canonical truth cannot be reached. Say so; never blank.
 *   STALE       — data is present but older than its source. Label every value.
 *   DRIFT       — the projection disagrees with its canonical provenance.
 *   READY       — render.
 *
 * The important property: STALE and DRIFT still render their data, because
 * hiding it would be worse. They render it *labelled*, so the Founder can see
 * the last known truth and knows not to treat it as current.
 */

export function SurfaceBadge({
  state,
  className,
  label,
}: {
  state: SurfaceState;
  className?: string;
  label?: string;
}) {
  const tone = SURFACE_TONE[state] ?? SURFACE_TONE.UNAVAILABLE;
  return (
    <Badge variant="outline" className={cn(tone.chip, className)}>
      <span className={cn('h-1 w-1 rounded-full', tone.dot)} />
      {label ?? tone.label}
    </Badge>
  );
}

export function LoadingState({ label = 'Reading canonical sources' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}…</p>
      <p className="text-xs text-muted-foreground/70">
        Command is reading derived projections. It does not infer values while waiting.
      </p>
    </div>
  );
}

export function UnavailableState({
  reason,
  detail,
  onRetry,
}: {
  reason: string;
  detail?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl animate-fade-rise py-10">
      <div className="rounded-lg border border-truth-unknown/30 bg-truth-unknown-soft/40 p-5">
        <div className="flex items-start gap-3">
          <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-truth-unknown" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">Truth unavailable</h3>
            <p className="mt-1 text-sm text-muted-foreground">{reason}</p>
            {detail ? (
              <pre className="mt-3 overflow-x-auto rounded border border-border bg-surface-1 p-2 font-mono text-2xs text-muted-foreground">
                {detail}
              </pre>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground/80">
              This is <span className="font-medium text-foreground">UNKNOWN</span>, not “nothing to report”.
              Command will not present an absence of data as an absence of problems.
            </p>
            {onRetry ? (
              <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" />
                Retry read
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * StaleBanner — the ONE owner of the STALE explanation.
 *
 * GAP MAP WF-SHELL-04. This banner used to be a large bordered block that
 * repeated the recorded/live hashes AND a methodology sentence, before route
 * identity and before the work area. It was visually heavier than most route
 * answers, which pushed actual work below the fold.
 *
 * THE SPLIT, and why it is not information loss:
 *
 *   compact rail (always visible)  · STALE · one-line consequence · generated at
 *   bounded detail (on request)    · recorded/live hashes · the full hint
 *
 * The STATE and its CONSEQUENCE are what an operator must not miss, so they are
 * never behind a disclosure. The hashes are the evidence for that state and
 * are diagnostic depth; the hint is methodology. Both remain reachable in one
 * click and are removed from the critical path.
 *
 * `<details>` rather than a button plus conditional JSX, so the disclosure
 * state is in the accessibility tree without an aria-expanded kept in sync by
 * hand.
 */
export function StaleBanner({
  reason,
  recorded,
  live,
  hint,
  generatedAt,
}: {
  reason?: string | null;
  recorded?: string | null;
  live?: string | null;
  hint?: string;
  generatedAt?: string | null;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-truth-stale/30 bg-truth-stale-soft/60 px-3 py-1.5 text-xs animate-fade-rise"
      data-stale-banner=""
    >
      <Radio className="h-3.5 w-3.5 shrink-0 text-truth-stale" />
      <span className="font-semibold uppercase tracking-wider text-truth-stale">STALE</span>
      <span className="text-foreground/90">
        {reason ?? 'The source moved after this projection was generated.'}
      </span>
      {generatedAt ? (
        <span className="font-mono text-2xs text-muted-foreground">
          generated {generatedAt}
        </span>
      ) : null}
      {/*
        The detail exists only when there IS detail. With no hashes and no hint
        a disclosure would be an empty affordance, which is worse than none.
      */}
      {recorded || live || hint ? (
        <details className="stale-detail">
          <summary>Stale detail</summary>
          <div className="stale-detail-body">
            {recorded && live ? (
              <p className="font-mono text-2xs text-muted-foreground">
                recorded {recorded} · live {live}
              </p>
            ) : null}
            {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function DriftBanner({
  sources,
  detail,
}: {
  sources: string[];
  detail?: string | null;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-truth-drift/40 bg-truth-drift-soft/70 px-3 py-2 text-xs animate-fade-rise"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-truth-drift" />
      <span className="font-semibold uppercase tracking-wider text-truth-drift">DRIFT</span>
      <span className="text-foreground/90">
        {detail ?? 'The rendered projection disagrees with its canonical source.'}
      </span>
      {sources.length ? (
        <span className="font-mono text-2xs text-muted-foreground">{sources.join(', ')}</span>
      ) : null}
      <span className="text-muted-foreground">
        The canonical source wins. What you see here is out of date, not authoritative.
      </span>
    </div>
  );
}

/**
 * HoldBanner — persistent, non-dismissible, on every screen.
 *
 * The Founder must never have to ask whether the ERP is running. This banner
 * is rendered from contract.json -> hold_state, not from a hardcoded string,
 * so if the hold is ever lifted in canonical source it changes here too.
 */
export function HoldBanner({
  implementation,
  authority,
  effective,
  restartRequires,
  convergenceNotRewrite,
}: {
  implementation: string;
  authority?: string;
  effective?: string;
  restartRequires?: string;
  convergenceNotRewrite?: boolean;
}) {
  const onHold = implementation === 'ON_HOLD';
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-xs',
        onHold
          ? 'border-truth-hold/30 bg-truth-hold-soft/50 text-foreground'
          : 'border-truth-ok/30 bg-truth-ok-soft/40 text-foreground',
      )}
    >
      {onHold ? (
        <Ban className="h-3.5 w-3.5 shrink-0 text-truth-hold" />
      ) : (
        <Radio className="h-3.5 w-3.5 shrink-0 text-truth-ok" />
      )}
      <span
        className={cn(
          'font-semibold uppercase tracking-[0.12em]',
          onHold ? 'text-truth-hold' : 'text-truth-ok',
        )}
      >
        {onHold ? 'StarqERP implementation ON HOLD' : `StarqERP implementation ${implementation}`}
      </span>
      {effective ? <span className="text-muted-foreground">since {effective}</span> : null}
      {authority ? (
        <span className="rounded-sm border border-border px-1.5 py-px font-mono text-2xs text-muted-foreground">
          authority {authority}
        </span>
      ) : null}
      {restartRequires ? (
        <span className="text-muted-foreground">
          restart requires {restartRequires.toLowerCase()}
        </span>
      ) : null}
      {convergenceNotRewrite ? (
        <span className="text-muted-foreground/80 italic">convergence, not rewrite</span>
      ) : null}
    </div>
  );
}

export function UnknownValue({ label = 'UNKNOWN', reason }: { label?: string; reason?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-truth-unknown" title={reason}>
      <CircleDashed className="h-3 w-3" />
      <span className="font-mono text-2xs uppercase tracking-wider">{label}</span>
    </span>
  );
}

export function AbsentSource({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
      <FileWarning className="h-3.5 w-3.5" />
      <span>
        Absent at source: <span className="font-mono">{path}</span>
      </span>
    </div>
  );
}
