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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace } from './paths.mjs';
import { buildBuilding, BUILDING_SOURCES } from './building.mjs';

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
    const surface = await mod.buildPhase3Surface();
    return surface;
  } catch (err) {
    // The ERP half is optional for this origin. If the frozen service cannot
    // be reached, we report UNKNOWN rather than failing the whole projection.
    return { process_truth: { hold_state: { implementation: 'UNKNOWN' } }, _reason: err.message };
  }
}

export async function buildBuildingProjection() {
  // `resolveWorkspace()` returns { root, source, attempted? } — the read guard
  // needs the resolved path string, not the descriptor. Passing the descriptor
  // makes every source read fail with a TypeError, which the projection
  // correctly reports as UNREADABLE rather than as a healthy empty board.
  const resolved = resolveWorkspace();
  const workspaceRoot = typeof resolved === 'string' ? resolved : resolved?.root ?? null;
  const surface = await erpHoldState();
  const building = buildBuilding(workspaceRoot, surface);
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
      return sendJson(res, 200, await buildBuildingProjection());
    } catch (err) {
      return sendJson(res, 500, { error: err.message, state: 'UNREADABLE' });
    }
  }

  if (url.pathname === '/api/building/health') {
    try {
      const p = await buildBuildingProjection();
      return sendJson(res, 200, {
        generated_at: p.generated_at,
        origin: p.origin,
        integrity: p.hoadha?.integrity ?? 'UNAVAILABLE',
        sources_checked: p.sources?.length ?? 0,
        authority_note:
          'DERIVED_PROJECTION. Separate read-only Building/project origin. data-service.mjs is untouched.',
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message, state: 'UNREADABLE' });
    }
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
