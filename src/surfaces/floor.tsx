import {
  Activity,
  AlertOctagon,
  Fingerprint,
  MonitorSmartphone,
  Scale,
  UserCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UnknownValue } from '@/components/state-gate';
import { cn, formatCount, formatTimestamp, formatUptime, isUnknown } from '@/lib/utils';
import { CONSTRAINT_TONE, EXECUTION_TONE, STAFF_CLASS_TONE } from '@/lib/states';
import type {
  AssignmentRow,
  CommandSurface,
  FloorConstraint,
  FloorEvent,
  FloorPayload,
  RosterEntry,
} from '@/lib/contracts';

/**
 * Dev Studio Floor — the Phase 3 surface.
 *
 * WHAT IT ANSWERS
 *
 * Who is on the floor, what does canonical source say each of them is doing, and
 * what is the evidence that anything moved. That is the operational question
 * the Founder actually asks, and it is a different question from Phase 2's
 * "is the control plane healthy" and Phase 1's "does the projection match its
 * sources".
 *
 * FIVE SEPARATIONS THIS SURFACE ENFORCES
 *
 *   1. BEING is not DOING. `nexus` is RETIRED and its execution state may read
 *      `active`. Both are canonical facts and both are shown, in separate
 *      columns, with different chips. Neither is collapsed into the other.
 *
 *   2. THE TWO CURRENT-TASK TRUTHS STAY SEPARATE. `activity.json` and
 *      `staff-state.json` both record a current task and they disagree on all
 *      14 handles that carry both. Command renders both with their provenance
 *      and never picks one. The disagreement is called out, not resolved.
 *
 *   3. A MENTION IS NOT AN ASSIGNMENT. The canonical mention index runs to 186
 *      entries per agent. It is forwarded as a COUNT, it sits in its own column
 *      under a heading that says what it is, and it never appears in an
 *      assignment field.
 *
 *   4. AGE IS NEVER RECOMPUTED HERE. `hours_since_last_activity` is frozen at
 *      ingest and is wrong by exactly the projection's age. This surface renders
 *      `last_activity_at` beside the projection's own `generated_at`, so the
 *      reader can see the whole offset themselves. No `Date.now()` appears in
 *      this file — that is asserted by test, not by intention.
 *
 *   5. ACTIVITY IS NOT MATURITY. The feed carries `process_family_context` and
 *      deliberately does NOT carry `process_stage`. Busy activity against a
 *      family does not make that family more complete, and the payload makes
 *      the omission structurally impossible rather than merely discouraged.
 *
 * THIS COMPONENT COMPUTES NOTHING
 *
 * Every count, grouping and filter was applied server-side in `server/floor.mjs`
 * and arrives here as a fact. There is no scoring, no weighting, no percentage
 * and no time arithmetic in this file. That is the Phase 1 architecture guard
 * doing its job, and it is why the roster cannot drift into becoming a maturity
 * board.
 */

function chip(tone: string | undefined): string {
  return cn(
    'inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wider',
    tone ?? 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  );
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="label-micro">{label}</p>
      <p className="truncate font-mono text-2xs text-foreground/90" title={value ?? undefined}>
        {isUnknown(value) ? <span className="text-truth-unknown">UNKNOWN</span> : value}
      </p>
    </div>
  );
}

/** One canonical signal flag, or nothing. Absence is never rendered as a pass. */
function SignalFlag({ on, label }: { on: boolean; label: string }) {
  if (!on) return null;
  return (
    <span className="inline-flex items-center rounded border border-truth-founder/30 bg-truth-founder-soft px-1 py-0.5 font-mono text-2xs uppercase tracking-wider text-truth-founder">
      {label}
    </span>
  );
}

export function FloorSurface({ surface }: { surface: CommandSurface }) {
  const floor = surface.floor ?? null;

  if (!floor) {
    return (
      <div className="p-4">
        <UnknownValue reason="Dev Studio Floor payload not present in the assembled surface" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <FloorHeader floor={floor} />
      <ProjectionStaleness floor={floor} />
      <ConstraintsRail constraints={floor.constraints} />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <RosterCard floor={floor} />
        <div className="flex flex-col gap-4">
          <SessionsCard floor={floor} />
          <RuntimeCard floor={floor} />
        </div>
      </div>

      <AssignmentsCard floor={floor} />
      <ActivityFeedCard floor={floor} />
      <ExcludedCard floor={floor} />
    </div>
  );
}

function FloorHeader({ floor }: { floor: FloorPayload }) {
  const c = floor.roster.counts;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-truth-ok" />
          <CardTitle>Dev Studio Floor</CardTitle>
          <Badge variant="outline" className="border-truth-ok/30 bg-truth-ok-soft text-truth-ok">
            PHASE 3 · LIVE
          </Badge>
          <Badge variant="outline" className="ml-auto border-truth-stale/30 bg-truth-stale-soft text-truth-stale">
            DERIVED_PROJECTION · READ-ONLY
          </Badge>
        </div>
        <CardDescription>
          Who is on the floor, what canonical source records about each of them, and what is the
          evidence that anything moved. Nothing on this surface is inferred, merged or scored.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <HeaderStat label="Observed on the bus" value={formatCount(c.observed)} />
        <HeaderStat label="Active staff" value={formatCount(c.active_staff)} tone="ok" />
        <HeaderStat label="Retired" value={formatCount(c.retired)} tone="unknown" />
        <HeaderStat label="System" value={formatCount(c.system)} tone="unknown" />
        <HeaderStat label="Unknown identity" value={formatCount(c.unknown_identity)} tone="drift" />
        <HeaderStat label="Truth disagreements" value={formatCount(c.truth_disagreements)} tone="founder" />
      </CardContent>
    </Card>
  );
}

function HeaderStat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'ok' | 'unknown' | 'drift' | 'founder';
}) {
  const toneClass = {
    default: 'text-foreground',
    ok: 'text-truth-ok',
    unknown: 'text-truth-unknown',
    drift: 'text-truth-drift',
    founder: 'text-truth-founder',
  }[tone];
  return (
    <div className="rounded-md border border-border bg-surface-1/50 px-3 py-2">
      <p className="label-micro">{label}</p>
      <p className={cn('font-mono text-lg leading-tight', toneClass)}>{value}</p>
    </div>
  );
}

/**
 * The staleness declaration, in its own card, before any execution value.
 *
 * Founder ruling 3: Phase 3 ships against a stale activity projection and must
 * say so with the ingest timestamp. The regeneration step is NAMED and Command
 * does not perform it, because the ingester writes to the control board and
 * Command is read-only by construction.
 */
function ProjectionStaleness({ floor }: { floor: FloorPayload }) {
  const p = floor.execution_projection;
  const isStale = p.state === 'STALE';

  return (
    <Card className={cn(isStale ? 'border-truth-stale/40 bg-truth-stale-soft/40' : 'border-border')}>
      <CardContent className="flex items-start gap-3 p-3.5">
        <AlertOctagon className={cn('mt-0.5 h-4 w-4 shrink-0', isStale ? 'text-truth-stale' : 'text-truth-ok')} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Execution projection state: {p.state}
          </p>
          <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
            {p.reason ??
              'The Room ledger has not moved since this projection was generated.'}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Meta label="Projection generated_at" value={formatTimestamp(p.generated_at)} />
            <Meta
              label="Recorded ledger digest"
              value={(p.ledger?.recorded_sha256_prefix as string) ?? null}
            />
            <Meta label="Live ledger digest" value={(p.ledger?.live_sha256_prefix as string) ?? null} />
          </div>
          <p className="mt-2 border-t border-border pt-2 text-2xs leading-relaxed text-muted-foreground">
            {p.ingest_note} Every execution value on this page was true as of{' '}
            <span className="font-mono text-foreground/90">{formatTimestamp(p.generated_at)}</span>.
            No age shown anywhere on this surface is recomputed from the current clock.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The constraints rail.
 *
 * Every entry is a condition that, if smoothed over, would make the roster
 * lie. Shown before the roster, not after it, so a reader meets the caveats
 * before the picture rather than after they have drawn a conclusion from it.
 */
function ConstraintsRail({ constraints }: { constraints: FloorConstraint[] }) {
  if (constraints.length === 0) {
    return (
      <Card>
        <CardContent className="p-3.5">
          <p className="text-xs text-muted-foreground">
            No identity conflicts, unknown identities, staleness or truth disagreements are recorded
            in this projection.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-truth-drift/25">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-truth-drift" />
          <CardTitle className="text-sm">Constraints and carried disagreements</CardTitle>
          <Badge variant="outline" className="ml-auto border-truth-drift/30 bg-truth-drift-soft text-truth-drift">
            {constraints.length} RECORDED · NONE AUTO-RESOLVED
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {constraints.map((c, i) => {
          const tone = CONSTRAINT_TONE[c.kind] ?? CONSTRAINT_TONE.IDENTITY_CONFLICT;
          return (
            <div
              key={`${c.kind}-${c.subject}-${i}`}
              className={cn('rounded-md border bg-surface-1/40 px-3 py-2', tone.accent)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={chip(tone.chip)}>{c.kind}</span>
                <span className="font-mono text-xs font-semibold text-foreground">{c.subject}</span>
              </div>
              <p className="mt-1 text-2xs leading-relaxed text-foreground/90">{c.detail}</p>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                <span className="uppercase tracking-wider text-muted-foreground/70">source</span>{' '}
                <span className="font-mono">{c.canonical_source}</span> ·{' '}
                <span className="uppercase tracking-wider text-muted-foreground/70">handling</span>{' '}
                {c.resolution}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * The roster.
 *
 * Retirement, system status and unknown identity are rendered as their own
 * visual state on every tile, so a retired identity cannot be mistaken for a
 * working one by position, colour, or omission. The classification chip is
 * drawn from `STAFF_CLASS_TONE`; an unrecognised canonical value falls through
 * to UNKNOWN rather than to a default that looks like STAFF.
 */
function RosterCard({ floor }: { floor: FloorPayload }) {
  const entries = floor.roster.entries;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <UserCheck className="h-4 w-4 text-truth-ok" />
          <CardTitle className="text-sm">Staff roster</CardTitle>
          <Badge variant="outline" className="ml-auto border-border text-muted-foreground">
            {entries.length} OBSERVED
          </Badge>
        </div>
        <CardDescription>
          Classification comes from the canonical staff record. An identity with no canonical entry
          is shown as UNKNOWN IDENTITY — never inferred, never merged into a neighbouring handle.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-2">
          {entries.map((e) => (
            <RosterTile key={e.handle} entry={e} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RosterTile({ entry }: { entry: RosterEntry }) {
  const classification = STAFF_CLASS_TONE[entry.staff_classification] ?? STAFF_CLASS_TONE.UNKNOWN;
  const showRetired = entry.is_retired;

  return (
    <div
      className={cn(
        'rounded-md border bg-surface-1/40 p-2.5',
        showRetired
          ? 'border-truth-unknown/40 bg-truth-unknown-soft/20'
          : entry.is_active_staff
            ? 'border-truth-ok/30'
            : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'font-mono text-xs font-semibold',
            entry.identity_present ? 'text-foreground' : 'text-truth-drift',
          )}
        >
          {entry.handle}
        </span>
        <span className={chip(classification.chip)}>{classification.label}</span>

        {/* RETIRED is stated in words on every affected tile. */}
        {showRetired ? (
          <span className={chip(EXECUTION_TONE.RETIRED)}>RETIRED — NOT ACTIVE STAFF</span>
        ) : null}

        {!entry.identity_present ? (
          <span className={chip(EXECUTION_TONE.CONFLICT)}>CONFLICT · UNKNOWN IDENTITY</span>
        ) : null}

        {entry.is_system ? <span className={chip(EXECUTION_TONE.SYSTEM)}>SYSTEM</span> : null}

        {entry.has_conflict ? (
          <span className={cn(chip(EXECUTION_TONE.CONFLICT), 'shrink whitespace-normal break-words')}>
            {entry.conflict_types.join(' · ')}
          </span>
        ) : null}
      </div>

      <p className="mt-1 truncate text-2xs text-muted-foreground" title={entry.role ?? undefined}>
        {entry.identity_present ? (entry.role ?? 'ROLE UNKNOWN') : 'NO CANONICAL IDENTITY RECORD'}
        {entry.is_legacy ? ' · LEGACY ALIAS' : ''}
        {entry.is_revoked ? ' · REVOKED' : ''}
      </p>

      <Separator className="my-2" />

      <div className="grid grid-cols-2 gap-2">
        <Meta label="Execution state" value={entry.current_state} />
        <Meta label="State confidence" value={entry.current_state_confidence} />
        <Meta label="Ledger freshness" value={entry.activity_freshness} />
        <Meta label="last_activity_at" value={formatTimestamp(entry.last_activity_at)} />
      </div>

      <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
        <span className="uppercase tracking-wider text-muted-foreground/70">lifetime</span>{' '}
        <span className="font-mono text-foreground/80">{formatCount(entry.lifetime_events)}</span>{' '}
        events in the whole ledger history ·{' '}
        <span className="uppercase tracking-wider text-muted-foreground/70">mentions</span>{' '}
        <span className="font-mono text-foreground/80">{formatCount(entry.mentioned_task_count)}</span>{' '}
        <span className="text-muted-foreground/80">(a mention is not an assignment)</span>
      </p>

      {entry.duty_restrictions ? (
        <p className="mt-2 rounded border border-truth-hold/40 bg-truth-hold-soft/30 px-2 py-1 text-2xs leading-relaxed text-foreground/90">
          <span className="font-mono uppercase tracking-wider text-truth-hold">founder restriction</span>{' '}
          {entry.duty_restrictions}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Assignments — the execution side only.
 *
 * The duty side is deliberately NOT in this table. It lives on the roster tile
 * and, where the two disagree, in the constraints rail with both values. A
 * single "current task" column spanning two canonical sources would be a merge,
 * and a merge is a decision Command is not entitled to make.
 */
function AssignmentsCard({ floor }: { floor: FloorPayload }) {
  const rows = floor.assignments;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Activity className="h-4 w-4 text-truth-ok" />
          <CardTitle className="text-sm">Assignments — execution side only</CardTitle>
          <Badge variant="outline" className="ml-auto border-border text-muted-foreground">
            SOURCE: activity.json
          </Badge>
        </div>
        <CardDescription>
          Only the execution projection is shown here. Duty and status context comes from
          staff-state.json and is rendered on the roster — where the two disagree, the
          disagreement is listed in the constraints rail with both values intact.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Handle</TableHead>
              <TableHead>Current assignment</TableHead>
              <TableHead>Current task</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead className="text-right">Mentions</TableHead>
              <TableHead>last_activity_at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <AssignmentRowView key={r.handle} row={r} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AssignmentRowView({ row }: { row: AssignmentRow }) {
  return (
    <TableRow className={cn(row.is_retired && 'opacity-60')}>
      <TableCell className="font-mono text-xs">
        {row.handle}
        {row.is_retired ? (
          <span className={cn('ml-1.5', chip(EXECUTION_TONE.RETIRED))}>RETIRED</span>
        ) : null}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {row.current_assignment ?? <span className="text-truth-unknown">UNKNOWN</span>}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {row.current_task ?? <span className="text-truth-unknown">UNKNOWN</span>}
      </TableCell>
      <TableCell className="text-2xs text-muted-foreground">
        {row.task_confidence}
        {row.task_source ? (
          <span className="block font-mono text-muted-foreground/70">{row.task_source}</span>
        ) : null}
      </TableCell>
      {/* Mentions live in their own column, under their own heading. */}
      <TableCell className="text-right">
        <span className="font-mono text-xs" title={row.mention_note}>
          {formatCount(row.mention_count)}
        </span>
      </TableCell>
      <TableCell className="font-mono text-2xs text-muted-foreground">
        {formatTimestamp(row.last_activity_at)}
      </TableCell>
    </TableRow>
  );
}

/**
 * The signal-filtered feed.
 *
 * The filter's own arithmetic is displayed above the feed, including the signal
 * LOSS figure. A filter that claims to preserve evidence should be able to
 * prove it lost nothing — and if the loss figure is ever non-zero, the guarantee
 * text on screen changes with it, because the payload computes it rather than
 * the component asserting it.
 */
function ActivityFeedCard({ floor }: { floor: FloorPayload }) {
  const feed = floor.activity;
  const f = feed.filter;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Fingerprint className="h-4 w-4 text-truth-ok" />
          <CardTitle className="text-sm">Meaningful recent activity</CardTitle>
          <Badge variant="outline" className="ml-auto border-border text-muted-foreground">
            WINDOW seq {feed.window.broker_sequence_min ?? '?'}–{feed.window.broker_sequence_max ?? '?'}
          </Badge>
        </div>
        <CardDescription>{f.rule}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <HeaderStat label="Events in window" value={formatCount(f.window_total)} />
          <HeaderStat label="Carrying a signal flag" value={formatCount(f.signal_total)} tone="ok" />
          <HeaderStat label="Shown in feed" value={formatCount(f.shown)} tone="ok" />
          <HeaderStat label="Filtered out" value={formatCount(f.filtered_out)} tone="unknown" />
          <HeaderStat
            label="Signal loss"
            value={formatCount(f.signal_loss)}
            tone={f.signal_loss === 0 ? 'ok' : 'drift'}
          />
        </div>

        <p
          className={cn(
            'rounded-md border px-3 py-2 text-2xs leading-relaxed',
            f.signal_loss === 0
              ? 'border-truth-ok/30 bg-truth-ok-soft/30 text-foreground/90'
              : 'border-truth-drift/40 bg-truth-drift-soft/40 text-foreground/90',
          )}
        >
          <span className="font-mono uppercase tracking-wider">filter guarantee</span> {f.guarantee}.
          Flags checked: <span className="font-mono">{f.signal_flags.join(', ')}</span>. An event
          carrying any of them is shown regardless of sender, so a machine-generated post carrying
          real evidence is never dropped as chatter.
        </p>

        <p className="text-2xs leading-relaxed text-muted-foreground">
          <span className="uppercase tracking-wider">no maturity reading</span> — a row may name the
          process family it touched. That is activity <em>against</em> a family, never progress
          <em> of</em> one. Busy work on Order-to-Cash does not make Order-to-Cash more complete,
          and this feed carries no stage or maturity field at all.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>seq</TableHead>
              <TableHead>Handle</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Signals</TableHead>
              <TableHead>Family context</TableHead>
              <TableHead>Provenance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {feed.events.slice(0, 60).map((e) => (
              <EventRowView key={e.event_id} event={e} />
            ))}
          </TableBody>
        </Table>

        {feed.events.length > 60 ? (
          <p className="text-2xs text-muted-foreground">
            Showing the first {60} of {formatCount(feed.events.length)} signal-bearing events,
            newest first. The full feed is served at <span className="font-mono">/api/floor</span>.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EventRowView({ event }: { event: FloorEvent }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-2xs text-muted-foreground">{event.broker_sequence}</TableCell>
      <TableCell className="font-mono text-xs">{event.handle}</TableCell>
      {/* Absent canonical action renders UNKNOWN. Never inferred from prose. */}
      <TableCell className="font-mono text-xs">
        {event.action ?? <span className="text-truth-unknown">UNKNOWN</span>}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {event.task ?? <span className="text-truth-unknown">UNKNOWN</span>}
      </TableCell>
      <TableCell>
        <span className={chip(EXECUTION_TONE[event.state])}>{event.state}</span>
        <span className="ml-1 text-2xs text-muted-foreground">{event.state_confidence}</span>
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap gap-1">
          <SignalFlag on={event.is_blocker} label="blocker" />
          <SignalFlag on={event.is_handoff} label="handoff" />
          <SignalFlag on={event.needs_founder} label="needs founder" />
          <SignalFlag on={event.has_evidence} label="evidence" />
          {!event.is_blocker && !event.is_handoff && !event.needs_founder && !event.has_evidence ? (
            <span className="text-2xs text-muted-foreground/70">—</span>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="font-mono text-2xs text-muted-foreground">
        {event.process_family_context ?? <span className="text-truth-unknown">UNKNOWN</span>}
      </TableCell>
      <TableCell className="font-mono text-2xs text-muted-foreground">
        <span title={`body_sha ${event.body_sha ?? 'UNKNOWN'}`}>body {event.body_sha ?? 'UNKNOWN'}</span>
        <span className="block" title={`record_hash ${event.record_hash ?? 'UNKNOWN'}`}>
          record {event.record_hash ?? 'UNKNOWN'}
        </span>
      </TableCell>
    </TableRow>
  );
}

/**
 * Session presence.
 *
 * A lease is presence, not activity — the two are separate panels for exactly
 * that reason, and the count is explicitly labelled so it can never be read as
 * a headcount of people currently working.
 */
function SessionsCard({ floor }: { floor: FloorPayload }) {
  const s = floor.sessions;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <MonitorSmartphone className="h-4 w-4 text-truth-ok" />
          <CardTitle className="text-sm">Session presence</CardTitle>
          <Badge
            variant="outline"
            className={cn(
              'ml-auto',
              s.available
                ? 'border-border text-muted-foreground'
                : 'border-truth-unavailable/30 bg-truth-unavailable-soft text-truth-unavailable',
            )}
          >
            {s.available ? `${s.count} LEASES` : s.state}
          </Badge>
        </div>
        <CardDescription>{s.meaning}</CardDescription>
      </CardHeader>
      <CardContent>
        {s.available ? (
          <div className="space-y-1.5">
            <p className="rounded border border-truth-stale/30 bg-truth-stale-soft/30 px-2 py-1 text-2xs text-foreground/90">
              <span className="font-mono uppercase tracking-wider text-truth-stale">not a work
              count</span> — {formatCount(s.count)} identity lease
              {s.count === 1 ? '' : 's'} held. A lease is presence, not activity.
            </p>
            {s.entries.map((e) => (
              <div
                key={e.handle}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border bg-surface-1/40 px-2 py-1.5"
              >
                <span className="font-mono text-xs font-semibold">{e.handle}</span>
                <span className="font-mono text-2xs text-muted-foreground">{e.instance_id ?? 'UNKNOWN'}</span>
                <span className="font-mono text-2xs text-muted-foreground/80">
                  claimed {formatTimestamp(e.claimed_at)}
                </span>
                <span className="font-mono text-2xs text-muted-foreground/80">
                  last seen {formatTimestamp(e.last_seen_at)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-2xs text-muted-foreground">
            {s.reason ?? 'Session presence could not be read. Absence of leases is not absence of staff.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Runtime, forwarded from the Phase 2 health floor rather than measured twice.
 *
 * Provider health is absent by Founder ruling — no canonical field carries it,
 * and inferring one would be fabricating a fact. Its absence is declared rather
 * than left to look like an oversight.
 */
function RuntimeCard({ floor }: { floor: FloorPayload }) {
  const r = floor.runtime;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Activity className="h-4 w-4 text-truth-ok" />
          <CardTitle className="text-sm">Runtime serving this surface</CardTitle>
          <Badge variant="outline" className="ml-auto border-border text-muted-foreground">
            PHASE 2 · FORWARDED
          </Badge>
        </div>
        <CardDescription>{r.measured_by}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Meta label="State" value={r.state} />
          <Meta label="Node" value={r.node_version ?? null} />
          <Meta label="Platform" value={r.platform ?? null} />
          <Meta label="Uptime" value={formatUptime(r.uptime_seconds ?? null)} />
        </div>
        <p className="text-2xs leading-relaxed text-muted-foreground">{r.detail}</p>
        <p className="rounded border border-truth-unknown/30 bg-truth-unknown-soft/30 px-2 py-1 text-2xs leading-relaxed text-foreground/90">
          <span className="font-mono uppercase tracking-wider text-truth-unknown">
            provider health: excluded
          </span>{' '}
          {floor.excluded.provider_health}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * What this surface deliberately does not carry.
 *
 * Declared on screen, not only in source, so a reader can tell the difference
 * between "absent by ruling" and "absent by oversight" — and so the next person
 * to be asked "why doesn't it show X?" finds the answer already on the page.
 */
function ExcludedCard({ floor }: { floor: FloorPayload }) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">
          Deliberately not on this surface
        </CardTitle>
        <CardDescription>
          Absent by decision, not by omission. None of these is inferred or approximated elsewhere in
          the product to fill the gap.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 md:grid-cols-2">
          {Object.entries(floor.excluded).map(([k, v]) => (
            <div key={k} className="rounded border border-border bg-surface-1/40 px-2 py-1.5">
              <dt className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                {k.replace(/_/g, ' ')}
              </dt>
              <dd className="mt-0.5 text-2xs leading-relaxed text-foreground/85">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
