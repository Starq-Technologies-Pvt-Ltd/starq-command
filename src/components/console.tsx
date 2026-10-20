/**
 * Phase 7 — dense console primitives.
 *
 * These are the shared Building vocabulary. ERP and Hoadha both render from
 * this file, which is the mechanism by which the two rooms stay visibly the
 * same product while carrying different accent tokens.
 *
 * THE ONE RULE THIS FILE ENFORCES
 *
 * A value is never rendered without its honesty state having been decided
 * first. `Stat`, `Chip` and `Unknownish` all take a value that may be absent,
 * and every one of them renders absence as an explicit UNKNOWN rather than as
 * a zero, a blank cell or a comfortable gap. A missing ERP hold state and a
 * missing Hoadha loop are different facts, and both must be visible.
 *
 * This file computes no business truth. Every number arrives pre-computed from
 * a canonical projection and is rendered as it arrived.
 */
import * as React from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, CircleDashed, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Render-only formatter. Never coerces, never defaults, never invents. */
export function show(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'UNKNOWN';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Tones are semantic, never decorative. See index.css for the token map. */
export type Tone = 'ok' | 'stale' | 'drift' | 'unknown' | 'hold' | 'founder' | 'room' | 'muted';

/**
 * Map a canonical state string onto a tone.
 *
 * This is a PRESENTATION mapping only. It does not promote, demote or
 * reinterpret a state: an unrecognised value maps to `unknown`, which is
 * exactly the claim it deserves. Anything not listed here is never given a
 * healthy-looking tone by omission.
 */
const STATE_TONE: Record<string, Tone> = {
  // Surface / projection integrity states.
  OK: 'ok',
  IN_SYNC: 'ok',
  MATCH: 'ok',
  SOURCE_READ: 'ok',
  AVAILABLE: 'ok',
  // Present but moved, or explicitly not verified.
  STALE: 'stale',
  PARTIAL: 'stale',
  PENDING: 'stale',
  REVIEW: 'stale',
  IN_PROGRESS: 'stale',
  // Real disagreement or real fault.
  DRIFT: 'drift',
  FAIL: 'drift',
  BLOCKED: 'drift',
  ABSENT: 'drift',
  ERROR: 'drift',
  // Explicitly held by the Founder.
  ON_HOLD: 'hold',
  HELD: 'hold',
  // Decided by the Founder, carried forward.
  CARRIED: 'founder',
  // Could not be established.
  UNAVAILABLE: 'unknown',
  UNREADABLE: 'unknown',
  UNKNOWN: 'unknown',
};

export function toneOf(state: unknown): Tone {
  const key = typeof state === 'string' ? state.trim().toUpperCase() : '';
  return STATE_TONE[key] ?? 'muted';
}

export function Chip({
  value,
  tone,
  title,
}: {
  value: unknown;
  tone?: Tone;
  title?: string;
}) {
  const t = tone ?? toneOf(value);
  const isUnknown = value === undefined || value === null || value === '' || value === 'UNKNOWN';
  return (
    <span className="chip" data-tone={t} title={title ?? show(value)}>
      {isUnknown ? <CircleDashed className="h-2.5 w-2.5 shrink-0" /> : null}
      {isUnknown ? 'UNKNOWN' : show(value)}
    </span>
  );
}

/**
 * Stat — one cell of the first-screen stat rail.
 *
 * `sub` is the qualifier that keeps the number honest. "326" with the sub
 * "live records · 33 proposed, separate" is a fact; "326" alone reads as a
 * total, and a total is a different claim.
 */
export function Stat({
  k,
  v,
  sub,
  tone,
  rank,
}: {
  k: string;
  v: React.ReactNode | null | undefined;
  sub?: React.ReactNode;
  tone?: Tone;
  /**
   * `primary` marks the cell that IS this route's defining state.
   *
   * Gap map WF-HIER-02 found every count on the rail carrying equal visual
   * weight, so counts became the product's language even where the contract
   * says a count establishes nothing. Declaring the one primary cell per rail
   * makes that a property of the markup rather than of the eye: the rest keep
   * their number and their qualifier and simply stop competing with it.
   */
  rank?: 'primary' | 'support';
}) {
  const unknown = v === null || v === undefined || v === 'UNKNOWN' || v === '';
  return (
    <div
      className="stat"
      data-tone={tone ?? (unknown ? 'unknown' : undefined)}
      data-rank={rank ?? 'support'}
    >
      <span className="k">{k}</span>
      <span className={unknown ? 'v unknown' : 'v'}>{unknown ? 'UNKNOWN' : v}</span>
      {sub ? <span className="s">{sub}</span> : null}
    </div>
  );
}

export function StatRail({ children }: { children: React.ReactNode }) {
  return <div className="stat-rail">{children}</div>;
}

/** Panel head: title, optional count, and a slot for toolbar controls. */
export function PanelHead({
  title,
  count,
  children,
}: {
  title: string;
  count?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="head">
      <h2>{title}</h2>
      {count !== undefined && count !== null ? (
        <span className="chip" data-tone="muted">
          {count}
        </span>
      ) : null}
      <span className="spacer" />
      {children}
    </div>
  );
}

export function Panel({
  title,
  count,
  toolbar,
  children,
  className,
}: {
  title?: string;
  count?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `command-panel ${className}` : 'command-panel'}>
      {title ? (
        <PanelHead title={title} count={count}>
          {toolbar}
        </PanelHead>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Room head — the identity band.
 *
 * The room mark is a two-letter monogram in the room's accent. It is
 * decorative in the strict sense that it asserts no truth; it exists so an
 * operator with two rooms open in two tabs knows instantly which is which.
 */
export function RoomHead({
  mark,
  title,
  sub,
  right,
}: {
  mark: string;
  title: string;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="room-head">
      <span className="mark" aria-hidden="true">
        {mark}
      </span>
      <div className="min-w-0">
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {right ? <div className="right">{right}</div> : null}
    </header>
  );
}

/** Key/value ledger. Used for source provenance and declared state. */
export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v ?? 'UNKNOWN'}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/**
 * Focus rail — the CURRENT FOCUS block inside a room.
 *
 * Rendered as prose plus a room-accent rule rather than as a heading, because
 * a heading invites reading and a rail invites scanning.
 */
export function FocusRail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="focus-rail">
      <span className="mark">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Empty / unavailable state.
 *
 * A source that could not be read is never rendered as an empty list. The two
 * are different facts and the second one hides a real fault.
 */
export function SourceGap({ reason, detail }: { reason: string; detail?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3 py-3 text-xs">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-truth-unknown" />
      <div className="min-w-0">
        <p className="!text-truth-unknown" style={{ fontStyle: 'normal' }}>
          {reason}
        </p>
        {detail ? <p>{detail}</p> : null}
      </div>
    </div>
  );
}

/**
 * Evidence drawer.
 *
 * Renders the record as a readable ledger first and raw JSON second. The JSON
 * is kept because it is the literal source shape, but it is no longer the only
 * way to read a record — which was the actual usability defect: a drawer whose
 * sole content is a JSON blob forces the operator to mentally parse a tree to
 * answer "which task is this and where did it come from".
 */
export function Drawer({
  title,
  crumb,
  record,
  close,
}: {
  title: string;
  crumb?: React.ReactNode;
  record: unknown;
  close: () => void;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      prior?.focus();
    };
  }, []);

  const entries =
    record && typeof record === 'object' && !Array.isArray(record)
      ? Object.entries(record as Record<string, unknown>)
      : [];

  return (
    <dialog ref={ref} onCancel={close} className="command-drawer" aria-label={title}>
      <header>
        <div className="min-w-0">
          {crumb ? <div className="crumb">{crumb}</div> : null}
          <h2>{title}</h2>
        </div>
        <button type="button" onClick={close} aria-label="Close detail" autoFocus>
          <X className="h-3 w-3" />
          <span className="sr-only">Close</span>
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length ? (
          <dl className="kv">
            {entries.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>
                  {typeof v === 'object' && v !== null ? (
                    <span className="text-muted-foreground">
                      {Array.isArray(v) ? `[${v.length} items]` : '{object}'} — see raw below
                    </span>
                  ) : (
                    show(v)
                  )}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        ) : (
          <pre>{show(record)}</pre>
        )}
        <div className="px-3 py-2">
          <div className="label-micro" style={{ fontSize: '9px' }}>
            Raw source shape
          </div>
        </div>
        <pre>{JSON.stringify(record, null, 2)}</pre>
      </div>
    </dialog>
  );
}

/** Row rail tone for a task status — used to make 300 rows scannable. */
export function rowTone(status: unknown): Tone {
  const key = typeof status === 'string' ? status.trim().toUpperCase() : '';
  if (key === 'DONE' || key === 'COMPLETE' || key === 'COMPLETED') return 'ok';
  if (key === 'BLOCKED' || key === 'DRIFT') return 'drift';
  if (key === 'IN_PROGRESS' || key === 'NEXT' || key === 'PARTIAL') return 'stale';
  if (key === 'PLANNED' || key === 'TODO' || key === 'NOT_ASSESSED') return 'unknown';
  return 'muted';
}

/** A labelled group of mutually exclusive filter buttons. */
export function SegmentedFilter<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string; count?: number | null }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="command-toolbar" role="group" aria-label={label}>
      <span className="label-micro" style={{ fontSize: '9px' }}>
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          data-variant={value === o.id ? 'active' : undefined}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.count !== undefined && o.count !== null ? (
            <span className="ml-1 opacity-60">{o.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * A link that carries an arrow — every forward navigation affordance.
 *
 * GAP MAP WF-VIS-03, closed in the seq 8411 polish wave.
 *
 * The finding was that `GoLink` was `inline-flex` + chevron and nothing else:
 * no colour, no underline, no weight, no hover state. It was therefore
 * typographically identical to the body text it sat inside, which made the
 * single most repeated navigation affordance in the product invisible as a
 * link. An operator scanning for "where do I go next" had nothing to scan for.
 *
 * The treatment is deliberately restrained — a foreground-coloured underline
 * that thickens on hover, plus the accent chevron. No box, no fill, no
 * background. It has to read as a link inside dense prose without competing
 * with a truth chip for attention.
 *
 * `--go-accent` lets a room-scoped link pick up its room accent while a
 * neutral link stays neutral; it defaults to the primary token so the
 * affordance is never weaker than the surrounding text.
 */
export function GoLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={cn('go-link', className)} data-go-link="">
      <span className="go-link-text">{children}</span>
      <ChevronRight className="go-link-chevron h-3 w-3 shrink-0" />
    </a>
  );
}

/**
 * SLIM STATUS — a truth token inline, its supporting provenance on demand.
 *
 * Founder QA seq 8411: reduce the persistent DERIVED_PROJECTION / READ-ONLY
 * footprint without losing the declaration.
 *
 * The verdict is the `<summary>` and is always visible: an operator must never
 * have to click to discover that what they are reading is a projection. The
 * disclosure carries only the auditing detail — contract version, generation
 * timestamp, resolved workspace — which is consulted when checking a claim,
 * not on every glance.
 *
 * Rendered as `<details>` so the open state is in the accessibility tree
 * without an aria-expanded that has to be hand-synchronised.
 */
export function SlimStatus({
  token,
  title,
  children,
}: {
  /** The always-visible verdict. A machine/status token, never a sentence. */
  token: React.ReactNode;
  /** Accessible name for the disclosure. */
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="slim-status" data-slim-status={title}>
      <summary aria-label={title}>
        {token}
        <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-60" />
      </summary>
      <div className="slim-status-body">{children}</div>
    </details>
  );
}

/**
 * PRE-COMMENT — orientation copy that must not cost the work area its budget.
 *
 * Founder QA seq 8410 measured #attention/exceptions at 430x932 putting its
 * first declared record at 97.4% of the viewport, and #attention/conflicts at
 * 103.1% — entirely below the fold. The cause was orientation prose rendered
 * inline above the queue.
 *
 * The prose is NOT deleted. Phase 5 render guards assert the scope statements
 * are present in rendered markup, and they are load-bearing honesty claims. So
 * the full text moves into a closed `<details>` and a short inline `lead`
 * states the same claim in one line. An operator gets orientation without a
 * scroll; an operator auditing how the surface reads opens one disclosure.
 */
export function PreComment({
  lead,
  children,
}: {
  /** One-line inline statement. Must stand alone as a summary. */
  lead: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="pre-comment" data-pre-comment="">
      <summary>{lead}</summary>
      <div className="pre-comment-body">{children}</div>
    </details>
  );
}