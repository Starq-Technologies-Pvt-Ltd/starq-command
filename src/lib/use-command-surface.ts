import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BuildingProjection,
  CommandSurface,
  GatesResponse,
  Health,
  SurfaceState,
} from './contracts';

/**
 * The single read-only data boundary for the UI.
 *
 * Nothing here computes business truth. It fetches the assembled read-only
 * surface and carries the four honesty states through to the renderer:
 *
 *   LOADING     — request in flight, nothing known yet
 *   UNAVAILABLE — data service or canonical source unreachable
 *   STALE       — reachable, but the projection no longer matches its source
 *   DRIFT       — reachable, but the contract disagrees with its provenance
 *   READY       — reachable and in sync
 *
 * There is deliberately no "empty but fine" state. If Command cannot see the
 * truth, it says so; it never renders a calm blank and lets the Founder
 * assume all is well.
 */

export type LoadStatus = 'LOADING' | 'READY' | 'UNAVAILABLE' | 'ERROR';

/** Hung listeners must fail closed so PM fallback and honesty banners can render. */
const FETCH_TIMEOUT_MS = 4000;

export interface SurfaceResponse {
  status: LoadStatus;
  surface: CommandSurface | null;
  health: Health | null;
  error: string | null;
  lastFetchedAt: string | null;
  refresh: () => Promise<void>;
  refreshing: boolean;
}

/** Map the server's surface state onto a render status, honestly. */
function statusFor(surface: CommandSurface | null, ok: boolean): LoadStatus {
  if (!ok || !surface) return 'UNAVAILABLE';
  const overall: SurfaceState = surface.health?.overall ?? 'OK';
  if (overall === 'OK') return 'READY';
  // STALE / DRIFT / UNREADABLE are all still renderable states — the data is
  // present and we label it loudly rather than hiding it.
  return 'READY';
}

export function useCommandSurface(pollMs = 15000): SurfaceResponse {
  const [status, setStatus] = useState<LoadStatus>('LOADING');
  const [surface, setSurface] = useState<CommandSurface | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/surface', {
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`data service returned ${res.status}`);
      const data = (await res.json()) as CommandSurface;
      if (!mounted.current) return;
      setSurface(data);
      setHealth(data.health ?? null);
      setStatus(statusFor(data, true));
      setError(null);
      setLastFetchedAt(new Date().toISOString());
    } catch (err) {
      if (!mounted.current) return;
      setStatus('UNAVAILABLE');
      setError(err instanceof Error ? err.message : String(err));
      // Deliberately do NOT clear a previously good surface. Losing the data
      // service must not silently blank a surface the Founder is reading; it
      // must mark what is on screen as no longer refreshable.
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    if (!pollMs) return () => { mounted.current = false; };
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
    };
  }, [refresh, pollMs]);

  return { status, surface, health, error, lastFetchedAt, refresh, refreshing };
}

/**
 * The `buildingStale` transition, as a pure function so it can be PROVEN rather
 * than asserted by reading source.
 *
 * OpenCode finding N1 (seq 8369, HIGH): the failure path read
 * `setBuildingStale((prev) => (prev ? true : prev))`, which returns `prev` on
 * both branches. It was a no-op, `buildingStale` could never become true, and a
 * failed Building refresh rendered as a healthy room.
 *
 * Two things must hold, and only the second is obvious:
 *
 *   1. A failure AFTER a good projection was read must set stale = true.
 *   2. A failure on the VERY FIRST fetch must set stale = FALSE. There is no
 *      projection on screen to be stale, and `BuildingOriginBanner` renders
 *      "the last successfully read Building projection … NOT current" when
 *      stale is true — wording that would be a lie with nothing retained.
 *
 * `hasProjection` is "has a good projection EVER been read this session", not
 * "did the last fetch fail".
 */
export function nextBuildingStale(hasProjection: boolean): boolean {
  return hasProjection;
}

/**
 * Phase 7 — the Building / project projection, from its OWN origin.
 *
 * Per Room seq 8361 the Hoadha projection is deliberately NOT served by the
 * frozen data service. It is a separate read-only origin, so this fetch is
 * deliberately separate from `useCommandSurface` and deliberately tolerant:
 *
 *   - The ERP half of Command keeps working if this origin is down. The
 *     Building payload is attached to the surface rather than replacing it, so
 *     a dead Building origin degrades the two project rooms and nothing else.
 *   - The previous good projection is deliberately retained on failure, for
 *     the same reason the surface hook retains its own: losing a read origin
 *     must not silently blank a surface the Founder is reading. It is marked
 *     stale instead.
 *
 * This is a DERIVED_PROJECTION. It is never an SSOT.
 */
export interface BuildingResponse {
  building: BuildingProjection | null;
  buildingStatus: LoadStatus;
  buildingError: string | null;
  buildingStale: boolean;
}

export function useBuildingProjection(pollMs = 30000): BuildingResponse {
  const [building, setBuilding] = useState<BuildingProjection | null>(null);
  const [buildingStatus, setBuildingStatus] = useState<LoadStatus>('LOADING');
  const [buildingError, setBuildingError] = useState<string | null>(null);
  const [buildingStale, setBuildingStale] = useState(false);
  const mounted = useRef(true);
  /**
   * Whether a good projection has EVER been read this session.
   *
   * `buildingStale` means "a projection is on screen and it is no longer
   * current". It is NOT the same as "the last fetch failed": if the very first
   * fetch fails there is nothing on screen to be stale, and the banner must say
   * unreachable rather than NOT current. A ref, not derived state, because the
   * catch block needs the answer without re-rendering.
   */
  const hasProjection = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const load = async () => {
      try {
        const res = await fetch('/api/building', {
          cache: 'no-store',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`building projection returned ${res.status}`);
        const data = (await res.json()) as BuildingProjection;
        if (!mounted.current) return;
        hasProjection.current = true;
        setBuilding(data);
        setBuildingStatus('READY');
        setBuildingError(null);
        setBuildingStale(false);
      } catch (err) {
        if (!mounted.current) return;
        setBuildingStatus('UNAVAILABLE');
        setBuildingError(err instanceof Error ? err.message : String(err));
        // Retain the last good projection and mark it stale rather than
        // blanking the project rooms. This goes through the pure transition so
        // the "was anything ever read?" question has one answer, testable
        // without a DOM.
        setBuildingStale(nextBuildingStale(hasProjection.current));
      }
    };
    void load();
    if (!pollMs) return () => { mounted.current = false; };
    const id = window.setInterval(() => void load(), pollMs);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
    };
  }, [pollMs]);

  return { building, buildingStatus, buildingError, buildingStale };
}

/** Read-only provenance fetch for the evidence drawer. */
export async function fetchRawSource(relPath: string): Promise<{ ok: boolean; body: string; error?: string }> {
  try {
    const res = await fetch(`/api/raw?path=${encodeURIComponent(relPath)}`, { cache: 'no-store' });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, body: '', error: detail || `HTTP ${res.status}` };
    }
    return { ok: true, body: await res.text() };
  } catch (err) {
    return { ok: false, body: '', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run the read-only reconciliation gates.
 *
 * This is a GET that happens to execute two read-only scripts. It is NOT a
 * write, and the distinction is why the gate runner has a closed allowlist on
 * the server rather than accepting a script path from here: a caller-supplied
 * path would turn a read route into arbitrary execution.
 *
 * The UI calls this only from an explicit button. Nothing here runs on a poll.
 */
export async function runGates(): Promise<{
  ok: boolean;
  payload: GatesResponse | null;
  error: string | null;
}> {
  try {
    const res = await fetch('/api/gates', { cache: 'no-store' });
    if (!res.ok) {
      return { ok: false, payload: null, error: `data service returned ${res.status}` };
    }
    return { ok: true, payload: (await res.json()) as GatesResponse, error: null };
  } catch (err) {
    return { ok: false, payload: null, error: err instanceof Error ? err.message : String(err) };
  }
}
