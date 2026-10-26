import * as React from 'react';
import {
  Activity,
  Archive,
  Cpu,
  FileCheck2,
  Fingerprint,
  Gauge,
  HardDrive,
  Link2,
  PlayCircle,
  ShieldQuestion,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UnknownValue } from '@/components/state-gate';
import { EvidenceList, SnapshotLink } from '@/components/evidence-peek';
import { cn, formatBytes, formatCount, formatTimestamp, formatUptime } from '@/lib/utils';
import { DIMENSION_TONE, FIX_LOCUS_TONE, STAGE_TONE, worstStage } from '@/lib/states';
import { runGates } from '@/lib/use-command-surface';
import type { CommandSurface, DimensionState, GatesResponse, HealthDimension } from '@/lib/contracts';

/**
 * Truth & Health — the Phase 2 floor.
 *
 * THE ORGANISING IDEA
 *
 * A projection can be perfectly in sync with its canonical source while the
 * runtime serving it cannot verify the ledger, cannot run its own gates, and
 * cannot reach half its declared inputs. Phase 1 proved that the data is real.
 * Phase 2 asks the question Phase 1 deliberately did not: is the thing serving
 * that data healthy?
 *
 * The answer is never one word. It is a set of dimensions, each read
 * independently, each with its own state, and no aggregate permitted to stand
 * in for a dimension that was never read.
 *
 * FOUR SEPARATIONS THIS SURFACE ENFORCES VISUALLY
 *
 *   1. STALE / DRIFT / UNAVAILABLE / UNKNOWN are four different facts.
 *      UNAVAILABLE says nothing about whether the truth would have agreed.
 *      UNKNOWN says nobody checked. Neither is ever rendered as a pass.
 *
 *   2. CURRENT health is physically separated from PRESERVED HISTORICAL issues.
 *      A frozen epoch-1 failure is real evidence and stays visible forever; it
 *      is also not a live fault and never reddens the present.
 *
 *   3. SOURCE-fixed is not RUNTIME-fixed. Where a carried issue is actually
 *      fixed is a fact with a citation, not a reassurance.
 *
 *   4. A BLOCKED TOOL is not an UNAVAILABLE TRUTH. health.mjs cannot execute on
 *      this runtime; the integrity truth beneath it is reachable and verified.
 *      Merging those two claims would either slander the ledger or hide a
 *      broken tool.
 *
 * This surface computes nothing. Every number, state and verdict is forwarded
 * from the read-only data service, which forwards it from canonical source.
 */
export function TruthSurface({ surface }: { surface: CommandSurface }) {
  const floor = surface.health_floor ?? null;
  const summary = surface.health_floor_summary ?? null;

  if (!floor) {
    return (
      <div className="p-4">
        <UnknownValue reason="health floor not present in the assembled surface" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <FloorHeader floor={floor} summary={summary} />

      <StateLegend />

      {/* ── Separation 4, stated before any number is shown ─────────────── */}
      <Card className="border-truth-founder/25 bg-truth-founder-soft/25">
        <CardContent className="flex items-start gap-3 p-3.5">
          <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-truth-founder" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">{floor.principle}</p>
            <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
              The projection conditions below describe whether Command&rsquo;s data matches its
              sources. The health dimensions below describe whether the system serving that data
              can be trusted to have read them. Both are true at once, and neither substitutes for
              the other.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <CurrentHealthCard floor={floor} />
        <div className="flex flex-col gap-4">
          <ProjectionConditions surface={surface} />
          <ExecutionFreshness surface={surface} />
        </div>
      </div>

      <LedgerIntegrityCard floor={floor} />

      {/* Separation 2: the past, quarantined from the present. */}
      <PreservedHistoryCard floor={floor} />

      {/* Separation 3: where is it actually fixed? */}
      <FixStatusCard floor={floor} />

      <div className="grid gap-4 xl:grid-cols-2">
        <SourceReachabilityCard floor={floor} />
        <ProvenanceCard surface={surface} />
      </div>

      <WorkStateHealthCard surface={surface} />
      <ProcessTruthCard surface={surface} />
      <RuntimeCard floor={floor} />
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function FloorHeader({ floor, summary }: { floor: NonNullable<CommandSurface['health_floor']>; summary: CommandSurface['health_floor_summary'] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" />
              Control-plane health
            </CardTitle>
            <DimensionBadge state={floor.state} />
          </div>
          <CardDescription>
            {summary
              ? `${summary.dimensions_healthy} of ${summary.dimensions_total} dimensions read healthy · ${summary.dimensions_assessed} actually assessed · ${summary.preserved_historical_count} preserved historical epoch(s) held separately`
              : floor.principle}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Counts are forwarded, never tallied here. `assessed` is shown
              beside `healthy` so a floor of mostly-UNKNOWN cannot be mistaken
              for a healthy one. */}
          <div className="flex flex-wrap gap-2">
            {summary
              ? Object.entries(summary.by_state).map(([state, count]) => (
                  <div
                    key={state}
                    className="flex min-w-[6rem] flex-col gap-0.5 rounded-md border border-border bg-surface-0/50 px-2.5 py-1.5"
                  >
                    <DimensionBadge state={state as DimensionState} />
                    <span className="tnum text-sm font-semibold">{formatCount(count)}</span>
                  </div>
                ))
              : null}
          </div>
          <p className="mt-3 text-2xs text-muted-foreground">
            Floor assessed {formatTimestamp(floor.generated_at)} · authority{' '}
            <span className="font-mono">{floor.authority ?? 'DERIVED_PROJECTION'}</span>
          </p>
        </CardContent>
      </Card>

      <Card className="flex flex-col justify-between">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            Portable snapshot
          </CardTitle>
          <CardDescription>
            A versioned, serialisable envelope for a future client. No remote access, no sync, no
            writes — the local Command stays authoritative.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <SnapshotLink scope="summary" />
            <SnapshotLink scope="full" />
          </div>
          <p className="text-2xs leading-relaxed text-muted-foreground">
            The envelope carries its schema version, the projection version it was built from, a
            generated timestamp, per-source provenance and freshness, and the explicit state of
            every dimension. Absolute host paths are stripped, so the same snapshot is meaningful
            on a machine that is not this one.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function DimensionBadge({ state }: { state: DimensionState }) {
  const tone = DIMENSION_TONE[state] ?? DIMENSION_TONE.UNKNOWN;
  return (
    <Badge variant="outline" className={cn('font-mono', tone.chip)} title={tone.meaning}>
      <span className={cn('h-1 w-1 rounded-full', tone.dot)} />
      {tone.label}
    </Badge>
  );
}

/**
 * The vocabulary, always on screen.
 *
 * A state that happens not to occur today is still a state the Founder has to
 * be able to read when it does. Without this legend, DRIFT would be invisible
 * on a healthy afternoon and would only ever be encountered at the moment it
 * mattered most — which is the worst possible time to have to look up what a
 * word means.
 *
 * These are CONTROL-PLANE states and they are not the process-stage states. A
 * stage can be `absent` while the ledger is `OK`; the two vocabularies answer
 * different questions and are deliberately given different chips.
 */
function StateLegend() {
  const order: DimensionState[] = ['OK', 'FAIL', 'STALE', 'DRIFT', 'UNAVAILABLE', 'UNREADABLE', 'UNKNOWN'];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
          What each state on this floor means
        </CardTitle>
        <CardDescription>
          Control-plane states. These are not the process-stage states — an ERP stage can be{' '}
          <span className="font-mono">absent</span> while the ledger is{' '}
          <span className="font-mono">OK</span>, and both facts stand.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {order.map((s) => {
            const tone = DIMENSION_TONE[s];
            return (
              <li
                key={s}
                className="flex items-start gap-2 rounded-md border border-border bg-surface-0/40 px-2.5 py-1.5"
              >
                <Badge variant="outline" className={cn('shrink-0 font-mono', tone.chip)}>
                  <span className={cn('h-1 w-1 rounded-full', tone.dot)} />
                  {tone.label}
                </Badge>
                <span className="text-2xs leading-relaxed text-muted-foreground">{tone.meaning}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ── Current health ──────────────────────────────────────────────────────────

function CurrentHealthCard({ floor }: { floor: NonNullable<CommandSurface['health_floor']> }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Current health — every dimension, read independently
        </CardTitle>
        <CardDescription>
          A dimension that could not be read says so. It is never rendered as a pass, and the
          overall verdict below cannot stand in for any row.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dimension</TableHead>
              <TableHead className="w-32">State</TableHead>
              <TableHead>What was actually observed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {floor.current_health.map((d) => (
              <DimensionRow key={d.id} dimension={d} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DimensionRow({ dimension: d }: { dimension: HealthDimension }) {
  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <p className="text-xs font-medium">{d.label}</p>
          <p className="font-mono text-2xs text-muted-foreground/80">{d.id}</p>
        </TableCell>
        <TableCell className="align-top">
          <DimensionBadge state={d.state} />
        </TableCell>
        <TableCell className="align-top">
          <p className="text-2xs leading-relaxed text-foreground/85">{d.detail}</p>
          <DimensionFacts d={d} />
          {d.evidence?.length ? (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-2xs text-muted-foreground hover:text-foreground">
                {d.evidence.length} canonical source{d.evidence.length === 1 ? '' : 's'}
              </summary>
              <div className="mt-1.5">
                <EvidenceList paths={d.evidence} label="" />
              </div>
            </details>
          ) : null}
        </TableCell>
      </TableRow>
    </>
  );
}

/** The per-dimension numbers, each forwarded and each with its own guard. */
function DimensionFacts({ d }: { d: HealthDimension }) {
  const facts: Array<[string, string]> = [];

  if (d.id === 'ledgerIntegrity') {
    facts.push(['epoch', d.epoch_id ?? 'UNKNOWN']);
    facts.push(['records checked', formatCount(d.records_checked ?? null)]);
    facts.push(['failures', formatCount(d.failure_count ?? null)]);
    facts.push(['anchor consistent', d.anchor_consistent === null ? 'UNKNOWN' : d.anchor_consistent ? 'yes' : 'NO']);
    if (d.verified_at) facts.push(['verified at', formatTimestamp(d.verified_at)]);
  }
  if (d.id === 'sourceReachability') {
    facts.push(['sources checked', formatCount(d.checked ?? null)]);
    if (d.unreachable?.length) facts.push(['unreachable', d.unreachable.join(', ')]);
  }
  if (d.id === 'runtime') {
    facts.push(['node', d.node_version ?? 'UNKNOWN']);
    facts.push(['platform', d.platform ?? 'UNKNOWN']);
    facts.push(['uptime', formatUptime(d.uptime_seconds ?? null)]);
  }
  if (d.id === 'healthTool') {
    facts.push(['underlying truth reachable', d.underlying_truth_reachable ? 'yes' : 'NO']);
    if (d.lines?.length) facts.push(['offending lines', d.lines.join(', ')]);
    if (d.remediation_owner) facts.push(['fix belongs to', d.remediation_owner]);
    if (d.command_did_not_modify) facts.push(['Command modified it', 'no — canonical, read-only']);
  }
  if (d.id === 'identityLease') {
    facts.push(['lease files', formatCount(d.lease_count ?? null)]);
  }
  if (d.id === 'destructiveGuard') {
    facts.push(['installed', d.installed ? 'yes' : 'no']);
    if (d.probe_policy) facts.push(['probe policy', d.probe_policy]);
  }

  if (!facts.length) return null;
  return (
    <dl className="mt-1.5 grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
      {facts.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-2">
          <dt className="text-2xs text-muted-foreground">{k}</dt>
          <dd className="truncate font-mono text-2xs text-foreground/85">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Projection conditions (Phase 1) kept visibly separate ───────────────────

function ProjectionConditions({ surface }: { surface: CommandSurface }) {
  const conditions = surface.health?.conditions ?? [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-primary" />
          Projection conditions
        </CardTitle>
        <CardDescription>
          Does the data match its sources? A different question from whether the system is healthy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {conditions.map((c) => (
          <div key={c.key} className="flex items-center justify-between gap-2">
            <span className="text-xs">{c.key}</span>
            <span className="font-mono text-2xs text-muted-foreground">{c.state}</span>
          </div>
        ))}
        <Separator />
        <p className="text-2xs text-muted-foreground">
          Worst-wins aggregate:{' '}
          <span className="font-mono text-foreground/85">{surface.health?.overall ?? 'UNKNOWN'}</span>
        </p>
      </CardContent>
    </Card>
  );
}

function ExecutionFreshness({ surface }: { surface: CommandSurface }) {
  const et = surface.execution_truth;
  const ledger = et.ledger;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-primary" />
          Execution freshness
        </CardTitle>
        <CardDescription>
          The Room ledger is append-only and never stops moving. The question is only whether the
          projection has kept up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <KV k="Projection generated" v={formatTimestamp(et.generated_at)} />
        <Separator />
        <KV k="Ledger state" v={<span className="font-mono">{et.state}</span>} />
        <Separator />
        <KV k="Recorded hash" v={<span className="font-mono text-2xs">{ledger?.recorded_sha256_prefix ?? 'UNKNOWN'}</span>} />
        <Separator />
        <KV k="Live hash" v={<span className="font-mono text-2xs">{ledger?.live_sha256_prefix ?? 'UNKNOWN'}</span>} />
        <Separator />
        <KV k="Records in ledger" v={formatCount(ledger?.records_total ?? null)} />
        <Separator />
        <KV k="Max broker sequence" v={formatCount(ledger?.max_broker_sequence ?? null)} />
        {et.reason ? (
          <p className="pt-1 text-2xs leading-relaxed text-truth-stale">{et.reason}</p>
        ) : null}
        <p className="text-2xs text-muted-foreground">
          Command does not re-ingest. When the ledger moves ahead of the projection, the honest
          response is to say STALE and name the regeneration step — not to quietly re-sync and
          present old execution truth as current.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Ledger integrity ────────────────────────────────────────────────────────

function LedgerIntegrityCard({ floor }: { floor: NonNullable<CommandSurface['health_floor']> }) {
  const li = floor.ledger_integrity;
  const current = li?.current ?? null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-primary" />
            Room / ledger integrity — current epoch only
          </CardTitle>
          {li ? <DimensionBadge state={li.state} /> : null}
        </div>
        <CardDescription>
          {li?.method ?? 'Verdict is imported from the canonical verifier; Command re-derives nothing.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!li || !current ? (
          <UnknownValue reason={li?.detail ?? 'ledger integrity not assessed'} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-2 text-xs">
              <KV k="Epoch" v={<span className="font-mono text-2xs">{current.epoch_id ?? 'UNKNOWN'}</span>} />
              <Separator />
              <KV k="Parent epoch" v={<span className="font-mono text-2xs">{current.parent_epoch ?? 'none'}</span>} />
              <Separator />
              <KV k="Records verified" v={formatCount(current.records_checked)} />
              <Separator />
              <KV k="Failures" v={formatCount(current.failure_count)} />
              <Separator />
              <KV
                k="Anchor self-consistent"
                v={
                  <span className={current.anchor_consistent ? 'text-truth-ok' : 'text-truth-drift'}>
                    {current.anchor_consistent ? 'yes' : 'NO'}
                  </span>
                }
              />
              {current.anchor_problems?.length ? (
                <ul className="space-y-0.5 pt-1">
                  {current.anchor_problems.map((p) => (
                    <li key={p} className="text-2xs text-truth-drift">
                      {p}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="label-micro">Anchor locator</p>
              {current.anchor ? (
                <div className="space-y-1 rounded-md border border-border bg-surface-0/50 p-2.5 font-mono text-2xs text-muted-foreground">
                  <p>seq {current.anchor.broker_sequence ?? '?'} · line {current.anchor.line ?? '?'} · idx {current.anchor.record_index ?? '?'}</p>
                  <p className="break-all">eventId {current.anchor.event_id ?? 'UNKNOWN'}</p>
                  <p className="break-all">recordHash {current.anchor.record_hash ?? 'UNKNOWN'}</p>
                </div>
              ) : (
                <UnknownValue />
              )}
              {current.failures?.length ? (
                <div className="space-y-1">
                  <p className="label-micro">Failures — all reported, never truncated to the first</p>
                  {current.failures.map((f, i) => (
                    <p key={i} className="rounded border border-truth-drift/30 bg-truth-drift-soft/40 p-2 font-mono text-2xs text-truth-drift">
                      line {String(f.line ?? '?')} seq {String(f.seq ?? '?')} —{' '}
                      {(f.reasons as string[] | undefined)?.join('; ')}
                    </p>
                  ))}
                </div>
              ) : null}
              <EvidenceList paths={li.evidence ?? []} label="Canonical verifier" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Preserved history — deliberately fenced off ─────────────────────────────

function PreservedHistoryCard({ floor }: { floor: NonNullable<CommandSurface['health_floor']> }) {
  const epochs = floor.preserved_historical ?? [];
  return (
    <Card className="border-truth-founder/25">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-truth-founder" />
            Preserved historical issues — reported, never repaired
          </CardTitle>
          <Badge variant="outline" className="border-truth-founder/30 bg-truth-founder-soft text-truth-founder">
            EXCLUDED FROM THE CURRENT VERDICT
          </Badge>
        </div>
        <CardDescription>{floor.preserved_historical_note}</CardDescription>
      </CardHeader>
      <CardContent>
        {!epochs.length ? (
          <p className="text-xs text-muted-foreground">No frozen epochs recorded.</p>
        ) : (
          <div className="space-y-3">
            {epochs.map((e) => (
              <div key={e.epoch_id} className="rounded-md border border-truth-founder/25 bg-surface-0/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{e.epoch_id}</span>
                  <Badge variant="outline" className="border-truth-founder/30 bg-truth-founder-soft text-truth-founder">
                    {e.verdict}
                  </Badge>
                  <Badge variant="outline" className="border-dashed">
                    IMMUTABLE
                  </Badge>
                  <Badge variant="outline" className="border-dashed">
                    affects current verdict: no
                  </Badge>
                </div>
                {e.note ? <p className="mt-1.5 text-2xs text-muted-foreground">{e.note}</p> : null}
                {e.known_failures?.map((kf, i) => (
                  <div key={i} className="mt-2 rounded border border-border bg-surface-1/50 p-2">
                    <p className="font-mono text-2xs text-foreground/85">
                      seq {String(kf.seq ?? '?')} · line {String(kf.line ?? '?')}
                    </p>
                    {Array.isArray(kf.reasons) ? (
                      <p className="mt-0.5 text-2xs text-truth-drift">{(kf.reasons as string[]).join('; ')}</p>
                    ) : null}
                    {kf.disposition ? (
                      <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
                        {String(kf.disposition)}
                      </p>
                    ) : null}
                  </div>
                ))}
                {e.policy ? (
                  <p className="mt-2 font-mono text-2xs text-muted-foreground/80">
                    policy:{' '}
                    {Object.entries(e.policy)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' · ')}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Fix status ──────────────────────────────────────────────────────────────

function FixStatusCard({ floor }: { floor: NonNullable<CommandSurface['health_floor']> }) {
  const entries = floor.fix_status ?? [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          Where is each issue actually fixed?
        </CardTitle>
        <CardDescription>
          Source-fixed and runtime-fixed are different facts with different consequences. A defect
          in canonical code does not go away because this machine is healthy, and a healthy machine
          does not repair a canonical defect.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map((f) => {
          const tone = FIX_LOCUS_TONE[f.locus] ?? FIX_LOCUS_TONE.NONE;
          return (
            <div key={f.id} className="rounded-md border border-border bg-surface-0/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">{f.title}</span>
                <Badge variant="outline" className={cn('font-mono', tone.chip)} title={tone.meaning}>
                  {tone.label}
                </Badge>
                <DimensionBadge state={f.state} />
              </div>
              <p className="mt-1.5 text-2xs leading-relaxed text-foreground/85">{f.detail}</p>
              <p className="mt-1 text-2xs italic text-muted-foreground/80">{tone.meaning}</p>
              <div className="mt-2">
                <EvidenceList paths={f.evidence} label="Cited canonical source" />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Sources, provenance, work state, process truth, runtime ─────────────────

function SourceReachabilityCard({ floor }: { floor: NonNullable<CommandSurface['health_floor']> }) {
  const reach = floor.source_reachability;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" />
            Source reachability
          </CardTitle>
          {reach ? <DimensionBadge state={reach.state} /> : null}
        </div>
        <CardDescription>
          Can Command see each canonical source at all? Unreachable is never reported as drift.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!reach ? (
          <UnknownValue reason="reachability not assessed" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="w-28">State</TableHead>
                <TableHead className="w-24">Size</TableHead>
                <TableHead className="w-28">Modified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reach.sources.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <p className="font-mono text-2xs">{s.path}</p>
                    <p className="text-2xs text-muted-foreground">{s.role}</p>
                  </TableCell>
                  <TableCell>
                    <DimensionBadge state={s.state} />
                  </TableCell>
                  <TableCell className="tnum text-2xs text-muted-foreground">{formatBytes(s.bytes)}</TableCell>
                  <TableCell className="font-mono text-2xs text-muted-foreground">
                    {formatTimestamp(s.modified_at).slice(0, 16)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ProvenanceCard({ surface }: { surface: CommandSurface }) {
  const prov = surface.provenance;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-primary" />
            Provenance — recorded vs live
          </CardTitle>
          <span className="font-mono text-2xs text-muted-foreground">{prov.state}</span>
        </div>
        <CardDescription>
          The contract records what it was generated from. Re-hashing those exact files is the
          only honest drift test — a hash Command chose itself would prove nothing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Declared source</TableHead>
              <TableHead className="w-28">State</TableHead>
              <TableHead>Recorded / live</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(prov.sources ?? []).map((s) => (
              <TableRow key={s.name}>
                <TableCell>
                  <p className="text-2xs font-medium">{s.name}</p>
                  <p className="truncate font-mono text-2xs text-muted-foreground">{s.path}</p>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-2xs">{s.state}</span>
                </TableCell>
                <TableCell className="font-mono text-2xs">
                  <span className={s.recorded === s.live ? 'text-foreground/85' : 'text-truth-drift'}>
                    {s.recorded ?? '—'} / {s.live ?? '—'}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function WorkStateHealthCard({ surface }: { surface: CommandSurface }) {
  const wt = surface.work_truth;
  const counts = wt.counts ?? {};
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Work-state health
          </CardTitle>
          <span className="font-mono text-2xs text-muted-foreground">{wt.state}</span>
        </div>
        <CardDescription>
          Work-state distribution forwarded from the canonical work model. L1 counts are
          informational; they are never the ERP number and are labelled as such wherever they
          appear.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!wt.available ? (
          <UnknownValue reason={wt.reason ?? 'work truth unavailable'} />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {Object.entries(counts).map(([state, count]) => (
                <div
                  key={state}
                  className="flex min-w-[5.5rem] flex-col gap-0.5 rounded-md border border-border bg-surface-0/50 px-2.5 py-1.5"
                >
                  <span className="label-micro">{state}</span>
                  <span className="tnum text-sm font-semibold">{formatCount(count)}</span>
                </div>
              ))}
            </div>
            {wt.global_blocker ? (
              <div className="rounded-md border border-truth-hold/30 bg-truth-hold-soft/30 p-3">
                <p className="text-xs font-medium">Global blocker — {wt.global_blocker.type}</p>
                <p className="mt-1 text-2xs leading-relaxed text-foreground/85">{wt.global_blocker.description}</p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  authority <span className="font-mono">{wt.global_blocker.authority}</span> · effect:{' '}
                  {wt.global_blocker.effect}
                </p>
              </div>
            ) : null}
            <p className="text-2xs leading-relaxed text-muted-foreground">
              {String(wt.maturity?.honesty_rule ?? wt.historical_completion_rule?.rule ?? '')}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ProcessTruthCard({ surface }: { surface: CommandSurface }) {
  const pt = surface.process_truth;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" />
            Process truth — verified stage state, family by family
          </CardTitle>
          <span className="font-mono text-2xs text-muted-foreground">{pt.state}</span>
        </div>
        <CardDescription>
          Stage classifications are forwarded verbatim from the contract, which parsed them from
          the canonical roadmap. Command never re-derives a stage, and colour is by the worst stage
          in a family — never by an average.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!pt.available ? (
          <UnknownValue reason={pt.reason ?? 'process truth unavailable'} />
        ) : (
          <div className="space-y-3">
            {pt.process_families.map((f) => {
              const worst = worstStage(f.stages.map((s) => s.state));
              const tone = STAGE_TONE[worst];
              return (
                <div key={f.id} className="rounded-md border border-border bg-surface-0/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-2xs text-muted-foreground">{f.id}</span>
                    <span className="text-xs font-medium">{f.name}</span>
                    <span className={cn('rounded-sm border px-1.5 py-px text-2xs', tone.chip)}>
                      worst: {tone.label}
                    </span>
                    <span className="tnum text-2xs text-muted-foreground">{f.stages.length} stages</span>
                  </div>
                  {f.headline ? <p className="mt-1 text-2xs text-muted-foreground">{f.headline}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {f.stages.map((s) => {
                      const st = STAGE_TONE[s.state] ?? STAGE_TONE.UNKNOWN;
                      return (
                        <span
                          key={s.stage}
                          className={cn('rounded-sm border px-1.5 py-px text-2xs', st.chip)}
                          title={s.note ?? s.stage}
                        >
                          {s.stage}: {st.label}
                        </span>
                      );
                    })}
                  </div>
                  {f.critical_blocker ? (
                    <p className="mt-2 text-2xs text-truth-drift">critical blocker: {f.critical_blocker}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RuntimeCard({
  floor,
}: {
  floor: NonNullable<CommandSurface['health_floor']>;
}) {
  const [gates, setGates] = React.useState<GatesResponse | null>(null);
  const [running, setRunning] = React.useState(false);
  const [gateError, setGateError] = React.useState<string | null>(null);

  const run = React.useCallback(async () => {
    setRunning(true);
    setGateError(null);
    try {
      const res = await runGates();
      if (!res.ok) {
        setGateError(res.error);
        setGates(null);
      } else {
        setGates(res.payload);
      }
    } finally {
      setRunning(false);
    }
  }, []);

  const runtime = floor.runtime ?? {};
  const declaredGates = floor.tool_health?.reconciliation_gates;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            Runtime &amp; tooling health
          </CardTitle>
          {floor.tool_health ? <DimensionBadge state={floor.tool_health.state} /> : null}
        </div>
        <CardDescription>
          What is actually installed and runnable on the machine serving this surface.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <KV k="Node" v={<span className="font-mono text-2xs">{String(runtime.node_version ?? 'UNKNOWN')}</span>} />
          <KV k="Platform" v={<span className="font-mono text-2xs">{String(runtime.platform ?? 'UNKNOWN')} · {String(runtime.arch ?? 'UNKNOWN')}</span>} />
          <KV k="Command version" v={<span className="font-mono text-2xs">{String(runtime.app_version ?? 'UNKNOWN')}</span>} />
          <KV k="Snapshot schema" v={<span className="font-mono text-2xs">{String(runtime.snapshot_schema_version ?? 'UNKNOWN')}</span>} />
          <KV k="Uptime" v={formatUptime((runtime.uptime_seconds as number) ?? null)} />
          <KV k="Memory (rss)" v={formatBytes((runtime.rss_bytes as number) ?? null)} />
          <KV k="Workspace resolution" v={<span className="font-mono text-2xs">{String(runtime.workspace_resolution ?? 'UNKNOWN')}</span>} />
          <KV k="Mode" v={<span className="font-mono text-2xs">{String(runtime.mode ?? 'UNKNOWN')}</span>} />
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="label-micro">Reconciliation gates</p>
            <Button variant="outline" size="xs" onClick={() => void run()} disabled={running}>
              <PlayCircle className="h-3 w-3" />
              {running ? 'Running read-only gates…' : 'Run read-only gates'}
            </Button>
          </div>
          <p className="text-2xs leading-relaxed text-muted-foreground">
            {declaredGates?.execution_policy ??
              'Command executes a read-only gate only on explicit request. It never runs the ingester, which would write to the control board.'}
          </p>
          {declaredGates && !gates ? (
            <div className="space-y-1">
              {(declaredGates.gates ?? []).map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-2 rounded border border-border bg-surface-0/40 px-2.5 py-1.5">
                  <span className="truncate font-mono text-2xs text-muted-foreground">{g.path}</span>
                  <DimensionBadge state={g.state} />
                </div>
              ))}
            </div>
          ) : null}
          {gateError ? <p className="text-2xs text-truth-unknown">gate run failed: {gateError}</p> : null}
          {gates ? (
            <div className="space-y-1.5">
              <p className="text-2xs text-muted-foreground">
                ran {formatTimestamp(gates.ran_at)} — {gates.detail}
              </p>
              {gates.gates.map((g) => (
                <div key={g.id} className="rounded border border-border bg-surface-0/40 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">{g.label ?? g.id}</span>
                    <DimensionBadge state={g.state} />
                    <span className="font-mono text-2xs text-muted-foreground">
                      exit {g.exit_code ?? 'n/a'} · verdict {g.verdict ?? 'none'}
                    </span>
                  </div>
                  {g.truth_impact ? (
                    <p className="mt-1 text-2xs text-truth-unknown">{g.truth_impact}</p>
                  ) : null}
                  {g.stdout_tail?.length ? (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-2xs text-muted-foreground hover:text-foreground">
                        gate output
                      </summary>
                      <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface-1 p-2 font-mono text-[10px] leading-relaxed text-foreground/80">
                        {g.stdout_tail.join('\n')}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ))}
              <div className="rounded border border-dashed border-border p-2.5">
                <p className="label-micro">Never executed from Command</p>
                {gates.refused.map((r) => (
                  <p key={r.id} className="mt-0.5 text-2xs text-muted-foreground">
                    <span className="font-mono">{r.script}</span> — {r.reason}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <Separator />

        <p className="text-2xs leading-relaxed text-muted-foreground">
          {/*
            R4. This read "Hold authority in force: {authority} · restart
            requires {restart_requires}". Both values are canonical and both are
            rendered by HoldBanner above every ERP tab, so the prose now points
            at the owner instead of repeating it.

            What it keeps is the epistemic caveat, which is the actual purpose of
            the sentence on a Truth surface: Command presents this, it does not
            decide it. That distinction is not carried by the banner.
          */}
          The canonical hold record — authority, effective date and the restart
          requirement — is declared in the hold banner above. Command presents
          it; it does not decide it.
        </p>
      </CardContent>
    </Card>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="label-micro">{k}</span>
      <span className="truncate text-right text-foreground/90">{v}</span>
    </div>
  );
}
