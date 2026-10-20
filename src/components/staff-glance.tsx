import type { RosterCounts, RosterEntry } from '@/lib/contracts';

/**
 * CMD-DI-1-1 — staff glance board.
 *
 * Props only. No hooks, no fetches, no classification of the forwarded roster.
 * The six labels are the glance vocabulary. A count renders only when that
 * bucket arrives already declared. Until the server supplies those buckets,
 * each one stays UNKNOWN. A missing bucket is not zero, and RosterCounts is
 * a different census — it is never copied onto these labels.
 */

export const GLANCE_STATES = [
  { key: 'working', label: 'WORKING' },
  { key: 'idle', label: 'IDLE' },
  { key: 'blocked', label: 'BLOCKED' },
  { key: 'awaiting_review', label: 'AWAITING_REVIEW' },
  { key: 'unavailable', label: 'UNAVAILABLE' },
  { key: 'unknown', label: 'UNKNOWN' },
] as const;

export type GlanceStateKey = (typeof GLANCE_STATES)[number]['key'];

/** Authoritative glance buckets. Absent, null, or non-numeric means unavailable. */
export type StaffGlanceBuckets = Partial<Record<GlanceStateKey, number | null>>;

function declaredCount(
  buckets: StaffGlanceBuckets | null | undefined,
  key: GlanceStateKey,
): number | undefined {
  if (!buckets || !Object.prototype.hasOwnProperty.call(buckets, key)) return undefined;
  const value = buckets[key];
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return undefined;
}

export function StaffGlance({
  staff,
  counts,
  buckets = null,
}: {
  staff: readonly RosterEntry[];
  counts: RosterCounts | null;
  buckets?: StaffGlanceBuckets | null;
}) {
  const rosterForwarded = Array.isArray(staff);
  const censusForwarded = counts !== null && counts !== undefined;

  return (
    <section className="command-panel" aria-label="Staff glance" data-staff-glance="">
      <div className="body" style={{ padding: '0.65rem 0.75rem' }}>
        <p className="label-micro">Staff glance</p>
        <p className="mt-1 text-2xs text-muted-foreground">
          Duty buckets are {buckets ? 'read from the supplied map' : 'UNAVAILABLE'}. Roster{' '}
          {rosterForwarded ? 'forwarded' : 'UNAVAILABLE'}, census{' '}
          {censusForwarded ? 'forwarded' : 'UNAVAILABLE'}. This view does not classify identities.
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="list">
          {GLANCE_STATES.map((state) => {
            const count = declaredCount(buckets, state.key);
            const available = count !== undefined;
            return (
              <li
                key={state.label}
                className="min-w-0 rounded-md border border-border bg-surface-0 px-2 py-1.5"
                data-glance-state={state.label}
                data-glance-availability={available ? 'declared' : 'UNAVAILABLE'}
              >
                <span className="label-token block">{state.label}</span>
                <span className="mt-1 block font-mono text-xs text-foreground">
                  {available ? count : 'UNKNOWN'}
                </span>
              </li>
            );
          })}
        </ul>
        <div
          className="mt-2 flex h-1.5 overflow-hidden rounded-sm border border-border"
          aria-hidden="true"
        >
          {GLANCE_STATES.map((state) => (
            <span
              key={state.label}
              className="min-w-0 flex-1 bg-truth-unknown/35"
              data-glance-bar={state.label}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
