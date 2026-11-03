/**
 * STARQ // COMMAND — Building / project projection origin.
 *
 * WHY THIS FILE EXISTS
 *
 * Phase 7 must instantiate two real Dev Studio project rooms (starqERP and
 * Hoadha). Hoadha's data is NOT in the frozen Phase 5 read surface, so it has
 * to be projected from somewhere.
 *
 * The Founder's decision (Room seq 8361) is explicit:
 *
 *   "do not add Hoadha assembly directly into frozen server/data-service.mjs.
 *    Hoadha must be exposed through the separate read-only Building/project
 *    projection path already established for Phase 7.
 *    data-service.mjs remains protected tonight."
 *
 * So the Building projection is NOT attached to the data service. It is served
 * from its own origin, on its own port, by its own process entry point. The
 * frozen data service is byte-for-byte untouched.
 *
 * This is the same architectural move Phase 2 already made for the health
 * floor and Phase 3 for the Dev Studio floor: a new truth is ATTACHED and
 * exposed on its own, never folded into an accepted contract.
 *
 * READ-ONLY, STRUCTURALLY
 *
 * Exactly as the data service does it, and for the same reason: writes are
 * refused by the transport before any route is dispatched, not by policy text.
 * There is no POST/PUT/PATCH/DELETE handler to reach even if one were added.
 * Every response carries the DERIVED_PROJECTION and READ_ONLY stamps so a
 * consumer cannot mistake this for a canonical source.
 *
 * WHAT IT IS NOT
 *
 * It does not reconcile, ingest, activate or mutate anything. It reads declared
 * canonical files read-only through the existing containment/symlink guard and
 * a closed source allowlist, and reports what it read. Where a source is
 * missing or malformed it says so; it never manufactures a healthy empty board.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace } from './paths.mjs';
import { buildBuilding, BUILDING_SOURCES, NEXUS_TASK_SOURCES, isPathContained, readBuildingSource, resolveNexusTaskSourcePath } from './building.mjs';
import { HISTORICAL_NEXUS_WORKSPACE_ROOT } from './historical-pm-snapshot.mjs';
import { readNexusLibraryDocument, searchNexusLibrary } from './nexus-library.mjs';
import { nexusCortexNeighborhood, nexusCortexStats, searchNexusCortex } from './nexus-cortex.mjs';

/**
 * The Building projection needs exactly one value from the ERP surface: the
 * source-derived implementation hold state. Rather than re-deriving it (which
 * would create a second, drifting copy of an accepted contract) we read it from
 * the frozen data service's own exported builder.
 *
 * This is an IMPORT of a frozen module, not a modification of it. The bytes of
 * data-service.mjs are unchanged; Phase 5 behaviour is untouched.
 */
async function erpHoldState() {
  try {
    const mod = await import('./data-service.mjs');
    // The CACHED surface. This origin only needs the ERP hold state from it,
    // and paying for a full re-assembly to read one field is what put
    // /api/building past the client's abort budget.
    const surface = await mod.cachedPhase3Surface();
    return surface;
  } catch (err) {
    // The ERP half is optional for this origin. If the frozen service cannot
    // be reached, we report UNKNOWN rather than failing the whole projection.
    return { process_truth: { hold_state: { implementation: 'UNKNOWN' } }, _reason: err.message };
  }
}

// -- BUILDING PROJECTION CACHE ----------------------------------------------
/**
 * Keyed on resolved source paths and file metadata plus the ERP surface's own
 * assembly time, re-checked after assembly so a torn read is served but never
 * stored. generated_at keeps the real derivation time; a projection_cache
 * block declares HIT or MISS.
 */
let buildingCache = null;

export function buildingFingerprint(workspaceRoot, surface = null) {
  const parts = [];
  for (const rel of BUILDING_SOURCES) {
    let p = 'ABSENT';
    if (NEXUS_TASK_SOURCES.includes(rel)) {
      if (!workspaceRoot) {
        p = 'UNAVAILABLE';
      } else {
        try {
          const selected = resolveNexusTaskSourcePath(workspaceRoot, rel);
          const selectedRoot = fs.realpathSync(selected.source_root);
          const real = fs.realpathSync(selected.path);
          if (!isPathContained(real, selectedRoot)) {
            p = `${selected.source_role}:UNREADABLE:REFUSED_ESCAPE`;
          } else {
            const st = fs.statSync(real);
            const contentHash = st.isFile() && st.size <= 8 * 1024 * 1024
              ? crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex')
              : null;
            if (!st.isFile() || st.size > 8 * 1024 * 1024) {
              p = `${selected.source_role}:UNREADABLE:OUTSIDE_READ_BOUND`;
            } else {
              p = `${selected.source_role}:${real}:${st.size}:${Math.trunc(st.mtimeMs)}:${Math.trunc(st.ctimeMs)}:${contentHash}`;
            }
          }
        } catch (error) {
          const state = error?.code === 'ENOENT' ? 'UNAVAILABLE' : 'UNREADABLE';
          const reason = /refused|outside|escapes|escape|link|safely/i.test(error?.message ?? '')
            ? 'REFUSED'
            : error?.code ?? 'READ_ERROR';
          p = `${state}:${reason}`;
        }
      }
    } else {
      try {
        const st = fs.statSync(path.join(workspaceRoot ?? '.', rel));
        p = st.size + ':' + Math.trunc(st.mtimeMs);
      } catch {
        try {
          const st = fs.statSync(rel);
          p = st.size + ':' + Math.trunc(st.mtimeMs);
        } catch { /* ABSENT */ }
      }
    }
    parts.push(rel + '=' + p);
  }
  // The ERP status is projected from the data service's decision contract, not
  // from a Building source file. Include the consumed value in this cache key
  // so a DEC-109 update invalidates an already assembled Building projection.
  parts.push(`erp-hold-state=${JSON.stringify(surface?.process_truth?.hold_state ?? null)}`);
  return parts.join('|');
}

export async function buildBuildingProjectionCached() {
  const resolved = resolveWorkspace();
  const workspaceRoot = typeof resolved === 'string' ? resolved : resolved?.root ?? null;
  const surface = await erpHoldState();
  const before = buildingFingerprint(workspaceRoot, surface);

  if (buildingCache && buildingCache.key === before) {
    buildingCache.hits += 1;
    return {
      ...buildingCache.projection,
      projection_cache: {
        state: 'HIT',
        generated_at: buildingCache.projection.generated_at,
        served_at: new Date().toISOString(),
        build_ms: buildingCache.build_ms,
        hits_since_assembly: buildingCache.hits,
      },
    };
  }

  const startedAt = Date.now();
  const projection = await buildBuildingProjection(surface);
  const buildMs = Date.now() - startedAt;
  const afterSurface = await erpHoldState();
  const after = buildingFingerprint(workspaceRoot, afterSurface);

  if (after !== before) {
    return {
      ...projection,
      projection_cache: { state: 'NOT_CACHED_TORN_READ', build_ms: buildMs },
    };
  }

  buildingCache = { key: before, projection, hits: 0, build_ms: buildMs };
  return {
    ...projection,
    projection_cache: { state: 'MISS', generated_at: projection.generated_at, served_at: new Date().toISOString(), build_ms: buildMs },
  };
}

export async function buildBuildingProjection(surfaceOverride = null) {
  // `resolveWorkspace()` returns { root, source, attempted? } — the read guard
  // needs the resolved path string, not the descriptor. Passing the descriptor
  // makes every source read fail with a TypeError, which the projection
  // correctly reports as UNREADABLE rather than as a healthy empty board.
  const resolved = resolveWorkspace();
  const workspaceRoot = typeof resolved === 'string' ? resolved : resolved?.root ?? null;
  const surface = surfaceOverride ?? await erpHoldState();
  const building = buildBuilding(workspaceRoot, surface, {
    historicalWorkspaceRoot: HISTORICAL_NEXUS_WORKSPACE_ROOT,
  });
  return {
    ...building,
    generated_at: new Date().toISOString(),
    workspace: {
      root: workspaceRoot,
      source: typeof resolved === 'string' ? 'resolveWorkspace()' : resolved?.source ?? 'UNKNOWN',
    },
    endpoint: '/api/building',
    origin: 'building-projection',
    reads: BUILDING_SOURCES,
    writes: [],
  };
}

// ── HTTP: thin, local, read-only. GET only. ────────────────────────────────
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-starq-command-authority': 'DERIVED_PROJECTION',
    'x-starq-command-access': 'READ_ONLY',
  });
  res.end(body);
}

const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function createBuildingService() {
  return http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Read-only surface. Writes are refused structurally, before dispatch.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end(
      JSON.stringify({ error: 'STARQ // COMMAND building projection is READ-ONLY.' }),
    );
  }

  if (url.pathname === '/api/building') {
    try {
      return sendJson(res, 200, await buildBuildingProjectionCached());
    } catch (err) {
      return sendJson(res, 500, { error: err.message, state: 'UNREADABLE' });
    }
  }

  if (url.pathname === '/api/building/health') {
    try {
      const p = await buildBuildingProjectionCached();
      const integrity = p.hoadha?.integrity ?? 'UNAVAILABLE';
      const healthy = integrity === 'SOURCE_READ';
      return sendJson(res, healthy ? 200 : 503, {
        generated_at: p.generated_at,
        origin: p.origin,
        integrity,
        healthy,
        sources_checked: p.sources?.length ?? 0,
        authority_note:
          'DERIVED_PROJECTION. Separate read-only Building/project origin. data-service.mjs is untouched. Only integrity=SOURCE_READ is healthy; UNAVAILABLE/DRIFT fail closed.',
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message, state: 'UNREADABLE' });
    }
  }

  if (url.pathname === '/api/building/raw') {
    // Building evidence belongs to this separate origin.  The frozen data
    // service deliberately cannot serve Nexus/Hoadha sources, so this route
    // shares the exact closed allowlist and read boundary used by the builder.
    const rel = url.searchParams.get('path') || '';
    if (!BUILDING_SOURCES.includes(rel)) {
      return sendJson(res, 403, {
        error: 'path outside the declared Building read-only surface',
        reads: BUILDING_SOURCES,
      });
    }
    const resolved = resolveWorkspace();
    const workspaceRoot = typeof resolved === 'string' ? resolved : resolved?.root ?? null;
    const source = readBuildingSource(workspaceRoot, rel);
    if (source.state !== 'AVAILABLE' || typeof source.content !== 'string') {
      return sendJson(res, source.state === 'UNAVAILABLE' ? 404 : 422, {
        error: source.reason ?? 'source is not readable',
        path: rel,
        state: source.state,
      });
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(rel)] || 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-starq-command-authority': 'DERIVED_PROJECTION',
      'x-starq-command-access': 'READ_ONLY',
    });
    return res.end(req.method === 'HEAD' ? undefined : source.content);
  }

  if (url.pathname === '/api/building/library/search') {
    try {
      return sendJson(res, 200, searchNexusLibrary({
        query: url.searchParams.get('q') || '',
        domain: url.searchParams.get('domain') || '',
        limit: url.searchParams.get('limit') || 40,
        offset: url.searchParams.get('offset') || 0,
      }));
    } catch (err) {
      const status = err.code === 'ENOENT' ? 503 : 500;
      return sendJson(res, status, {
        state: status === 503 ? 'UNAVAILABLE' : 'UNREADABLE',
        authority: 'RECOVERED_SOURCE_COPY',
        read_only: true,
        error: err.message,
        documents: [],
      });
    }
  }

  if (url.pathname === '/api/building/library/document') {
    try {
      return sendJson(res, 200, readNexusLibraryDocument(url.searchParams.get('path')));
    } catch (err) {
      const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
      return sendJson(res, status, {
        state: status === 404 || status === 413 ? 'UNAVAILABLE' : 'UNREADABLE',
        authority: 'RECOVERED_SOURCE_COPY',
        read_only: true,
        error: err.message,
      });
    }
  }

  if (url.pathname === '/api/building/cortex/stats') {
    try { return sendJson(res, 200, nexusCortexStats()); }
    catch (err) { return sendJson(res, 503, { state: 'UNAVAILABLE', authority: 'RECOVERED_SOURCE_COPY', read_only: true, error: err.message }); }
  }

  if (url.pathname === '/api/building/cortex/search') {
    try {
      return sendJson(res, 200, searchNexusCortex({
        query: url.searchParams.get('q') || '',
        type: url.searchParams.get('type') || '',
        limit: url.searchParams.get('limit') || 12,
      }));
    } catch (err) { return sendJson(res, 503, { state: 'UNAVAILABLE', authority: 'RECOVERED_SOURCE_COPY', read_only: true, error: err.message, nodes: [] }); }
  }

  if (url.pathname === '/api/building/cortex/neighborhood') {
    try {
      const result = nexusCortexNeighborhood({
        id: url.searchParams.get('id') || '',
        depth: url.searchParams.get('depth') || 1,
        limit: url.searchParams.get('limit') || 56,
      });
      return sendJson(res, result.state === 'NOT_FOUND' ? 404 : 200, result);
    } catch (err) { return sendJson(res, 503, { state: 'UNAVAILABLE', authority: 'RECOVERED_SOURCE_COPY', read_only: true, error: err.message, focus: null, nodes: [], edges: [] }); }
  }

  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not found' }));
  });
}

const port = Number(process.env.BUILDING_SERVICE_PORT || 5178);
const server = createBuildingService();
export { server };

// Keep import-based offline verification from binding a live service socket.
// Direct execution by the lifecycle child remains the only bind path.
const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isDirectRun) {
  server.listen(port, '127.0.0.1', () => {
    console.log(`STARQ // COMMAND building projection (READ-ONLY) on http://127.0.0.1:${port}`);
    console.log('  separate origin — frozen server/data-service.mjs is not modified');
  });
}
