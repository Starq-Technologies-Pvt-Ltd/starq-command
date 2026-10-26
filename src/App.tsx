import * as React from 'react';
import { BuildingSurface } from '@/surfaces/building';
import { PmBoardSurface } from '@/surfaces/pm-board';
import { PmPortfolioSurface } from '@/surfaces/pm-portfolio';
import { parseBuildingRoute, routeHash, type BuildingRoute } from '@/lib/building-route';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { Rail, RoomSwitcher, TopBar, type ViewId } from '@/components/shell';
import {
  DriftBanner,
  HoldBanner,
  LoadingState,
  StaleBanner,
  UnavailableState,
} from '@/components/state-gate';
import { useBuildingProjection, useCommandSurface } from '@/lib/use-command-surface';
import { cn } from '@/lib/utils';

/**
 * STARQ // COMMAND — application root.
 *
 * Structure of truth, outermost first:
 *   1. Hold banner        — persistent, non-dismissible, from canonical state
 *   2. Drift banner       — projection disagrees with its canonical provenance
 *   3. Stale banner       — projection older than its source
 *   4. Surface            — only rendered once the above have been declared
 *
 * A value is never visible without its honesty state having been declared
 * above it.
 */
export default function App() {
  const {
    status,
    surface: baseSurface,
    health,
    error,
    lastFetchedAt,
    refresh,
    refreshing,
  } = useCommandSurface();

  /**
   * Phase 7 (Room seq 8361): the Building/project projection — and therefore the
   * Hoadha room — is served by a SEPARATE read-only origin, not by the frozen
   * data service. It is attached to the surface here so the whole tree below can
   * keep reading `surface.building` unchanged.
   *
   * Attaching rather than replacing is deliberate: if the Building origin is
   * down, the ERP half of Command still renders and the two project rooms
   * report UNAVAILABLE. It never blanks the operating surface.
   */
  const { building, buildingStatus, buildingError, buildingStale } = useBuildingProjection();
  const surface = baseSurface && building ? { ...baseSurface, building } : baseSurface;
  const [route, setRoute] = React.useState<BuildingRoute>(() =>
    parseBuildingRoute(typeof window === 'undefined' ? '' : window.location.hash),
  );
  const view = route.view as ViewId;
  const pmFallbackRoute = pmRouteWithoutCoreProjection(route);
  const [railExpanded, setRailExpanded] = React.useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth > 800,
  );
  React.useEffect(() => {
    const onResize = () => setRailExpanded(window.innerWidth > 800);
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Hash routing keeps surfaces linkable and survives a reload — this is an
  // operating surface the Founder will bookmark and return to.
  const mainRef = React.useRef<HTMLElement>(null);
  const positions = React.useRef<Record<string, number>>({});
  React.useEffect(() => {
    const onHash = () => {
      positions.current[routeHash(route)] = mainRef.current?.scrollTop ?? 0;
      setRoute(parseBuildingRoute(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [route]);
  React.useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = positions.current[routeHash(route)] ?? 0;
    document.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [route]);
  const select = React.useCallback((id: ViewId) => {
    const tab = id === 'attention' ? 'Decisions' : id === 'evidence' ? 'Sources' : id === 'system' ? 'Health' : 'Overview';
    window.location.hash = routeHash({ view: id, room: null, tab });
    if (window.innerWidth <= 800) setRailExpanded(false);
  }, []);

  const founder = surface?.identities?.founder ?? null;

  return (
    <div className={cn('command-app flex h-screen w-screen overflow-hidden bg-surface-0', railExpanded && 'rail-open')}>
      <a
        className="command-skip"
        href="#command-main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to current surface
      </a>
      <Rail
        active={view}
        onSelect={select}
        health={health}
        expanded={railExpanded}
        onToggle={() => setRailExpanded((v) => !v)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
              <TopBar
                founderDisplay={founder?.display_name ?? null}
                founderHandle={founder?.operational_handle ?? null}
                workspaceRoot={surface?.workspace?.root ?? null}
                authority={surface?.process_truth?.authority ?? null}
                assembledAt={surface?.assembled_at ?? lastFetchedAt}
                refreshing={refreshing}
                onRefresh={() => void refresh()}
              >
                {surface?.building ? (
                  <RoomSwitcher
                    rooms={[
                      {
                        id: 'erp',
                        label: 'starqERP',
                        state:
                          surface.building.projects.find((p) => p.id === 'erp')?.state ?? 'UNKNOWN',
                        href: '#studio/erp/overview',
                      },
                      {
                        id: 'hoadha',
                        label: 'Hoadha',
                        state: surface.building.hoadha.execution,
                        href: '#studio/hoadha/overview',
                      },
                    ]}
                  />
                ) : null}
              </TopBar>

        {route.room === 'erp' && surface?.process_truth?.hold_state ? (
          <HoldBanner
            implementation={surface.process_truth.hold_state.implementation}
            authority={surface.process_truth.hold_state.authority}
            effective={surface.process_truth.hold_state.effective}
            restartRequires={surface.process_truth.hold_state.restart_requires}
            convergenceNotRewrite={surface.process_truth.hold_state.convergence_not_rewrite}
          />
        ) : null}

        {/*
                  PERSISTENT CONTEXT — two lines, and the OWNERSHIP MATRIX that
                  gap map WF-SHELL-01 asked for.

                  Before this wave, projection state, workspace/authority, the
                  breadcrumb, source state, current focus, the stale banner, the
                  room head and the footer each carried overlapping state, so
                  the first useful work area began several diagnostic bands down.

                  The matrix, one owner per persistent fact:

                    line 1 (location)      YOU ARE HERE -> company/floor/room/section
                    line 2 (status)        PROJECTION · N/M in sync · SOURCES · CURRENT FOCUS
                    HoldBanner (above)     canonical ERP hold record          [state-gate.tsx]
                    StaleBanner (in main)  STALE state + consequence          [state-gate.tsx]
                    DriftBanner (in main) canonical provenance disagreement  [state-gate.tsx]
                    room state chips       room-local qualifier beside a node

                  What may repeat is the COMPACT qualifier. What must not repeat
                  is a full canonical record, and no fact below re-presents the
                  hold record — that is HoldBanner's, and the R4 census guard
                  fails if any surface file reads it again.

                  The context bar is persistent, which is what earns the right
                  to restate: it is orientation, and it answers "which room am I
                  in and is it current" without reading the page.
                */}
                <div className="command-context" aria-live="polite">
                  <div className="context-location">
                    <button
                      type="button"
                      className="mobile-nav-trigger"
                      aria-label="Open navigation"
                      onClick={() => setRailExpanded(true)}
                    >
                      MENU
                    </button>
                    <span className="font-mono !text-muted-foreground/80">YOU ARE HERE</span>
                    <span className="room-root" data-room={route.room ?? 'studio'} style={{ display: 'contents' }}>
                      <a href="#overview">Starq Technologies</a>
                      <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                      {route.view === 'studio' ? (
                        <a href="#studio">Dev Studio</a>
                      ) : (
                        <span className="capitalize">{route.view}</span>
                      )}
                      {route.room ? (
                        <>
                          <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                          <a href={`#studio/${route.room}/overview`}>
                            {route.room === 'erp' ? 'starqERP' : 'Hoadha'}
                          </a>
                          <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                          <span style={{ color: 'hsl(var(--room))' }}>{route.tab}</span>
                        </>
                      ) : route.view === 'studio' ? (
                        <>
                          <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                          <span style={{ color: 'hsl(var(--room))' }}>{route.tab}</span>
                        </>
                      ) : null}
                    </span>
                  </div>
                  {/*
                    Goose R1: below 800px the rail's Projection state block was
                    display:none, which deleted the "N/M conditions in sync"
                    count outright. It is re-homed HERE, on the pinned bar that
                    exists at every width, so the count is never lost — only
                    compressed. The rail keeps the badge; this bar keeps the
                    number. Both derive from the same `health`, so they cannot
                    disagree.
                  */}
                  <div className="context-status">
                    <span className="focus">
                      <span className="font-mono !text-muted-foreground/80">
                        PROJECTION {health?.overall ?? 'UNAVAILABLE'}
                      </span>
                      {health ? (
                        <span className="font-mono">
                          {health.counts.ok}/{health.counts.total} in sync
                        </span>
                      ) : null}
                    </span>
                    <span className="focus">
                      <span className="font-mono !text-muted-foreground/80">
                        SOURCES {surface?.building?.hoadha.integrity ?? 'UNAVAILABLE'}
                      </span>
                    </span>
                    <span className="focus">
                      <span className="font-mono !text-muted-foreground/80">CURRENT FOCUS</span>
                      {route.room === 'erp'
                        ? `${surface?.process_truth?.hold_state?.implementation ?? 'UNKNOWN'} · process closure`
                        : route.room === 'hoadha'
                          ? 'PREPARED / NOT STARTED · no H0 activation'
                          : 'dual-room preparation · acceptance pending'}
                    </span>
                  </div>
                </div>
        <main
          id="command-main"
          tabIndex={-1}
          ref={mainRef}
          className="surface-grid flex-1 overflow-y-auto"
        >
          {status === 'LOADING' && !surface ? <LoadingState /> : null}

          {status === 'UNAVAILABLE' && !surface ? (
            <>
              <UnavailableState
                reason={
                  pmFallbackRoute
                    ? 'The core data service is unavailable. This PM surface uses its separate service.'
                    : 'The read-only data service is not reachable.'
                }
                detail={error}
                onRetry={() => void refresh()}
              />
              {pmFallbackRoute ? (
                <div className="px-4 pb-4" data-pm-without-core-projection="">
                  {pmFallbackRoute.kind === 'portfolio' ? (
                    <PmPortfolioSurface />
                  ) : (
                    <PmBoardSurface projectId={pmFallbackRoute.projectId} />
                  )}
                </div>
              ) : null}
            </>
          ) : null}

          {/*
            The data service dropped out mid-session but we already hold a
            surface. We do NOT blank it: the last known truth stays on screen
            and is marked as no longer refreshable.
          */}
          {status === 'UNAVAILABLE' && surface ? (
            <div className="p-4">
              <div className="flex items-start gap-3 rounded-md border border-truth-drift/40 bg-truth-drift-soft/60 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-truth-drift" />
                <div>
                  <p className="font-semibold uppercase tracking-wider text-truth-drift">
                    Data service unreachable
                  </p>
                  <p className="mt-0.5 text-foreground/90">
                    What follows is the last successfully read projection and is{' '}
                    <span className="font-medium">NOT current</span>. {error}
                  </p>
                </div>
              </div>
              <div className={cn('mt-4 opacity-70')}>
                {<BuildingSurface route={route} surface={surface} />}
              </div>
            </div>
          ) : null}

          {status === 'READY' && surface ? (
            <div className="flex flex-col">
              <GlobalBanners surface={surface} />
              {/*
                Phase 7: the Building/project projection is a SEPARATE read-only
                origin (Room seq 8361). Its honesty state is declared here, above
                the project rooms, for the same reason every other state is:
                a value is never visible without its honesty state having been
                declared above it. ERP keeps rendering either way.
              */}
              <BuildingOriginBanner
                status={buildingStatus}
                stale={buildingStale}
                error={buildingError}
              />
              {<BuildingSurface route={route} surface={surface} />}
            </div>
          ) : null}
        </main>

        {/*
          FOOTER — seq 8417 correction 1.

          This band restated what two other persistent elements already own.
          The context bar's second row carries `PROJECTION <state>` and
          N/M in sync; the topbar's slim status carries the authority token. A
          third restatement of projection state plus a full-width
          DERIVED_PROJECTION / READ-ONLY string plus the whole authority note
          was duplicated truth, and the `truncate` on the note meant the
          Founder could not read the end of it at narrow widths — the one
          place the doctrine was too long to finish saying.

          It is now ONE compact status: the projection verdict inline, and the
          full doctrine behind a disclosure that wraps rather than truncates.
          Nothing is removed. An operator still gets the complete authority
          note; they get it by opening it, and they get all of it.
        */}
        <footer className="command-footer" data-command-footer="">
          <span className="command-footer-token">STARQ // COMMAND</span>
          <span className="command-footer-dot" aria-hidden="true" />
          <span className="command-footer-token">DERIVED_PROJECTION · READ-ONLY</span>
          <span className="command-footer-sep" aria-hidden="true" />
          <details className="command-footer-more">
            <summary>Authority and projection doctrine</summary>
            <div className="command-footer-body">
              <p>
                {surface?.authority_note ??
                  'Command renders canonical truth. Where it disagrees, the canonical source wins.'}
              </p>
              <p className="command-footer-note">
                Projection {health?.overall ?? 'UNAVAILABLE'}
                {health ? ` · ${health.counts.ok}/${health.counts.total} conditions in sync` : ''}
                {surface?.assembled_at ? ` · assembled ${surface.assembled_at}` : ''}
              </p>
              <p className="command-footer-note">
                Read-only. Command renders these contracts and never writes them, and it exposes no
                write path to any canonical source or to the Room ledger.
              </p>
            </div>
          </details>
        </footer>
      </div>
    </div>
  );
}

type PmFallbackRoute =
  | { kind: 'portfolio' }
  | { kind: 'board'; projectId: 'command' | 'erp' | 'hoadha' };

/**
 * The PM service has its own API and state gate. Keep these routes reachable
 * when the unrelated core projection service is unavailable, while the
 * UnavailableState above continues to qualify the rest of Command.
 */
function pmRouteWithoutCoreProjection(route: BuildingRoute): PmFallbackRoute | null {
  if (route.view !== 'studio') return null;
  if (route.projectId?.toLowerCase() === 'command') {
    return { kind: 'board', projectId: 'command' };
  }
  if (route.room === 'erp' && route.tab === 'Tasks') {
    return { kind: 'board', projectId: 'erp' };
  }
  if (route.room === 'hoadha' && route.tab === 'Board') {
    return { kind: 'board', projectId: 'hoadha' };
  }
  if (route.room === null && !route.projectId && route.tab === 'Projects') {
    return { kind: 'portfolio' };
  }
  return null;
}

/**
 * The Building/project origin's own honesty state.
 *
 * Phase 7 moved Hoadha onto a separate read-only origin, so it can fail
 * independently of the ERP data service. That independence is real and must be
 * visible: a Founder looking at the Hoadha room has to be able to tell a
 * genuinely empty room from a room whose projection origin is down.
 *
 * Renders nothing when the origin is healthy — the common case should not
 * spend vertical space on a non-problem.
 */
function BuildingOriginBanner({
  status,
  stale,
  error,
}: {
  status: string;
  stale: boolean;
  error: string | null;
}) {
  if (status === 'READY' && !stale) return null;

  const tone =
    status === 'LOADING' ? 'unknown' : stale ? 'drift' : 'unavailable';

  return (
    <div className="px-4 pt-3">
      <div
        className={cn(
          'flex items-start gap-3 rounded-md border px-3 py-2 text-xs',
          tone === 'drift' && 'border-truth-drift/40 bg-truth-drift-soft/60',
          tone === 'unknown' && 'border-truth-unknown/30 bg-truth-unknown-soft/50',
          tone === 'unavailable' && 'border-truth-unknown/30 bg-truth-unknown-soft/50',
        )}
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-truth-unknown" />
        <div>
          <p className="font-semibold uppercase tracking-wider text-truth-unknown">
            {status === 'LOADING'
              ? 'Building projection loading'
              : stale
                ? 'Building projection NOT current'
                : 'Building projection unreachable'}
          </p>
          <p className="mt-0.5 text-foreground/90">
            {stale ? (
              <>
                The project rooms below are the last successfully read Building
                projection and are <span className="font-medium">NOT current</span>.{' '}
                ERP truth is unaffected — it comes from a separate read origin.
              </>
            ) : status === 'LOADING' ? (
              'Reading the separate read-only Building/project origin.'
            ) : (
              <>
                The separate read-only Building/project origin is not reachable,
                so the starqERP and Hoadha rooms cannot be projected.{' '}
                {error}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Drift and staleness are declared above every surface, always. */
function GlobalBanners({ surface }: { surface: import('@/lib/contracts').CommandSurface }) {
  const prov = surface.provenance;
  const et = surface.execution_truth;

  return (
    <div className="flex flex-col gap-2 px-4 pt-3">
      {prov?.state === 'DRIFT' ? (
        <DriftBanner
          sources={prov.drifted ?? []}
          detail="The contract's recorded provenance hashes no longer match the canonical files on disk."
        />
      ) : null}

      {prov?.state === 'UNAVAILABLE' && prov.sources?.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-truth-unknown/30 bg-truth-unknown-soft/50 px-3 py-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-truth-unknown">
            SOURCE ABSENT
          </span>
          <span className="text-foreground/90">
            Declared provenance source not found: {(prov.missing ?? []).join(', ')}
          </span>
        </div>
      ) : null}

      {et?.available && et.state === 'STALE' ? (
        <StaleBanner
          reason={et.reason ?? undefined}
          recorded={et.ledger?.recorded_sha256_prefix ?? undefined}
          live={et.ledger?.live_sha256_prefix ?? undefined}
          generatedAt={et.generated_at ?? undefined}
          hint="Execution truth below is the last ingested projection. Regeneration is required before it can be called current."
        />
      ) : null}
    </div>
  );
}
