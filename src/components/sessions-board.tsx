import type { SessionLease, Sessions } from '@/lib/contracts';

export interface DeclaredHerdrPane {
  id: string;
  handle: string | null;
  source: string;
}

export interface LiveHerdrPaneState {
  state: string;
  source: string | null;
  detail?: string | null;
}

export interface HerdrPaneRow {
  declared: DeclaredHerdrPane;
  live?: LiveHerdrPaneState | null;
}

function valueOrUnknown(value: string | null | undefined) {
  return value === null || value === undefined || value === '' ? 'UNKNOWN' : value;
}

function LeaseRow({ lease, fallbackHandle }: { lease: SessionLease; fallbackHandle: string }) {
  return (
    <li className="rounded border border-border bg-surface-0 px-3 py-2">
      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className="tier-label">ID</dt>
        <dd className="tier-label-mono">{valueOrUnknown(lease.instance_id)}</dd>
        <dt className="tier-label">HANDLE</dt>
        <dd className="tier-label-mono">{valueOrUnknown(lease.handle || fallbackHandle)}</dd>
        <dt className="tier-label">HOST</dt>
        <dd className="tier-label-mono">{valueOrUnknown(lease.hostname)}</dd>
        <dt className="tier-label">OPEN TIME</dt>
        <dd className="tier-label-mono">{valueOrUnknown(lease.claimed_at)}</dd>
      </dl>
    </li>
  );
}

/**
 * CMD-DI-1-2 — render-only separation of declared session leases and Herdr
 * pane observations. Callers forward the projection; this component never
 * fetches, polls, infers a live state, or turns an unavailable source into zero.
 */
export function SessionsBoard({
  sessions,
  panes,
}: {
  sessions: Sessions;
  panes: readonly HerdrPaneRow[];
}) {
  const leaseRows = Object.entries(sessions.byHandle);

  return (
    <section className="grid gap-3 lg:grid-cols-2" aria-label="Sessions and Herdr panes" data-sessions-board="">
      <section className="command-panel rank-support" aria-labelledby="sessions-board-sessions">
        <div className="head">
          <h2 id="sessions-board-sessions">Sessions</h2>
          <span className="chip" data-tone={sessions.available ? 'muted' : 'unknown'}>
            {sessions.available ? sessions.count : 'UNAVAILABLE'}
          </span>
        </div>
        <div className="body space-y-2">
          <p className="tier-prose">
            Lease records are declared by {valueOrUnknown(sessions.source)}. They describe session
            presence only and do not establish live execution state.
          </p>
          {!sessions.available ? (
            <p className="tier-body" data-sessions-availability="UNAVAILABLE">
              UNAVAILABLE{sessions.reason ? ` — ${sessions.reason}` : ''}
            </p>
          ) : leaseRows.length === 0 ? (
            <p className="tier-body">No lease rows were declared by the available source.</p>
          ) : (
            <ul className="space-y-2" role="list">
              {leaseRows.map(([handle, lease]) => (
                <LeaseRow key={handle} lease={lease} fallbackHandle={handle} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="command-panel rank-support" aria-labelledby="sessions-board-herdr">
        <div className="head">
          <h2 id="sessions-board-herdr">Herdr panes</h2>
          <span className="chip" data-tone="muted">
            DECLARED / LIVE SEPARATE
          </span>
        </div>
        <div className="body space-y-2">
          <p className="tier-prose">
            Manifest declarations and broker observations are separate records. A missing live row
            is unavailable evidence, not a zero-pane result.
          </p>
          {panes.length === 0 ? (
            <p className="tier-body">No Herdr pane declarations were supplied.</p>
          ) : (
            <ul className="space-y-2" role="list">
              {panes.map(({ declared, live }) => (
                <li key={declared.id} className="rounded border border-border bg-surface-0 px-3 py-2">
                  <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
                    <dt className="tier-label">DECLARED PANE</dt>
                    <dd className="tier-label-mono">{declared.id}</dd>
                    <dt className="tier-label">DECLARED HANDLE</dt>
                    <dd className="tier-label-mono">{valueOrUnknown(declared.handle)}</dd>
                    <dt className="tier-label">DECLARED SOURCE</dt>
                    <dd className="tier-label-mono">{declared.source}</dd>
                    <dt className="tier-label">LIVE STATE</dt>
                    <dd
                      className="tier-label-mono"
                      data-pane-live-state={live === null || live === undefined ? 'UNAVAILABLE' : live.state}
                    >
                      {live === null || live === undefined ? 'UNAVAILABLE' : live.state}
                    </dd>
                    <dt className="tier-label">LIVE SOURCE</dt>
                    <dd className="tier-label-mono">
                      {live === null || live === undefined ? 'UNAVAILABLE' : valueOrUnknown(live.source)}
                    </dd>
                    {live?.detail ? (
                      <>
                        <dt className="tier-label">LIVE DETAIL</dt>
                        <dd className="tier-body">{live.detail}</dd>
                      </>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </section>
  );
}
